const express = require("express");
const router = express.Router();
const { db } = require("../firebase");
const crypto = require("crypto");

function normalizeMsisdn(rawPhone) {
  const digitsOnly = String(rawPhone || "").replace(/\D/g, "");
  if (!digitsOnly) return "";
  if (digitsOnly.startsWith("256")) return digitsOnly;
  if (digitsOnly.startsWith("0")) return `256${digitsOnly.slice(1)}`;
  return digitsOnly;
}

function signQuote(payload) {
  const secret = process.env.VOUCHER_SECRET || "dev_voucher_secret";
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(json).digest("hex");
  return { payload, signature: sig };
}

// Helper function to create or update user account
async function createOrUpdateUser(phone) {
  try {
    // Check if user already exists
    const userQuery = db.collection("users").where("phone", "==", phone);
    const snapshot = await userQuery.get();
    
    if (snapshot.empty) {
      // Create new user account
      await db.collection("users").add({
        phone,
        password: "", // Empty password - user can set it later through login
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: "voucher_auto_created"
      });
      console.log(`New user account created for ${phone} via voucher`);
    } else {
      // Update existing user's last activity
      const userDoc = snapshot.docs[0];
      await userDoc.ref.update({
        updatedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error("Error creating/updating user account:", error);
    // Don't fail the voucher redemption if user creation fails
  }
}

// Generate voucher codes (for owners to create pre-paid vouchers)
router.post("/generate", async (req, res) => {
  try {
    const { 
      ownerId, 
      hotspotId, 
      code, 
      type = 'discount', 
      value, 
      usageLimit, 
      expiresAt,
      expiresInDays = 30,
      packageName
    } = req.body;
    
    if (!ownerId || !code || !value) {
      return res.status(400).json({ 
        success: false, 
        message: "Owner ID, voucher code, and value are required" 
      });
    }

    // Check if voucher code already exists
    const existingVoucher = await db.collection("vouchers")
      .where("code", "==", code.toUpperCase())
      .limit(1)
      .get();
    
    if (!existingVoucher.empty) {
      return res.status(400).json({
        success: false,
        message: "Voucher code already exists"
      });
    }

    let expiryDate = null;
    if (expiresAt) {
      expiryDate = new Date(expiresAt);
    } else {
      expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + Number(expiresInDays));
    }

    const voucherData = {
      code: code.toUpperCase(),
      ownerId,
      hotspotId: hotspotId || null,
      type, // 'discount' or 'free_access'
      packageValue: Number(value),
      packageName: packageName || null,
      usageLimit: usageLimit ? Number(usageLimit) : null,
      usageCount: 0,
      status: "active", // active, redeemed, expired, cancelled
      createdAt: new Date().toISOString(),
      expiresAt: expiryDate.toISOString(),
      redeemedAt: null,
      redeemedBy: null,
      redeemedByPhone: null
    };

    const docRef = await db.collection("vouchers").add(voucherData);
    
    res.json({
      success: true,
      message: "Voucher created successfully",
      voucher: {
        id: docRef.id,
        ...voucherData
      }
    });
  } catch (error) {
    console.error("Error generating voucher:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to create voucher" 
    });
  }
});

// Export vouchers CSV for an owner
router.get("/owner/:ownerId/export/csv", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const snapshot = await db.collection("vouchers").where("ownerId", "==", ownerId).orderBy("createdAt", "desc").get();
    const rows = ["code,type,value,usageCount,usageLimit,status,createdAt,expiresAt,redeemedAt,redeemedByPhone"]; 
    snapshot.forEach(doc => {
      const v = doc.data();
      rows.push([
        v.code, 
        v.type || 'discount', 
        v.packageValue, 
        v.usageCount || 0, 
        v.usageLimit || '∞', 
        v.status, 
        v.createdAt, 
        v.expiresAt, 
        v.redeemedAt || "", 
        v.redeemedByPhone || ""
      ].join(","));
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=vouchers_${ownerId}.csv`);
    res.send(rows.join("\n"));
  } catch (e) {
    console.error("CSV export error:", e);
    res.status(500).json({ success: false, message: "Failed to export vouchers" });
  }
});

// Export printable PDF with QR codes for an owner
router.get("/owner/:ownerId/export/pdf", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const snapshot = await db.collection("vouchers").where("ownerId", "==", ownerId).orderBy("createdAt", "desc").limit(200).get();
    const vouchers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    const PDFDocument = require("pdfkit");
    const QRCode = require("qrcode");
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=vouchers_${ownerId}.pdf`);
    doc.pipe(res);

    doc.fontSize(18).text("YABA WiFi Vouchers", { align: "center" });
    doc.moveDown();

    const cols = 3;
    const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / cols;
    let col = 0; let rowY = doc.y;

    for (const v of vouchers) {
      const x = doc.page.margins.left + col * colWidth + 10;
      const y = rowY;
      const boxW = colWidth - 20;
      const boxH = 120;
      doc.roundedRect(x, y, boxW, boxH, 8).stroke("#e5e7eb");
      doc.fontSize(12).text(`Code: ${v.code}`, x + 10, y + 10);
      doc.fontSize(10).text(`Type: ${v.type === 'free_access' ? 'Free Access' : 'Discount'}`, x + 10, y + 28);
      doc.fontSize(10).text(`Value: ${v.packageValue}${v.type === 'free_access' ? ' min' : '%'}`, x + 10, y + 44);
      doc.fontSize(10).text(`Expires: ${new Date(v.expiresAt).toLocaleDateString()}`, x + 10, y + 60);
      // QR contains just the code; could include portal URL with code prefilled if desired
      const qrPng = await QRCode.toDataURL(v.code, { margin: 0, width: 100 });
      const qrBase64 = qrPng.replace(/^data:image\/png;base64,/, "");
      doc.image(Buffer.from(qrBase64, 'base64'), x + boxW - 110, y + 10, { width: 100, height: 100 });

      col += 1;
      if (col === cols) { col = 0; rowY += boxH + 16; }
      if (rowY + boxH + 16 > doc.page.height - doc.page.margins.bottom) { doc.addPage(); rowY = doc.page.margins.top; }
    }

    doc.end();
  } catch (e) {
    console.error("PDF export error:", e);
    res.status(500).json({ success: false, message: "Failed to export vouchers" });
  }
});

// Redeem voucher code
router.post("/redeem", async (req, res) => {
  try {
    const { voucherCode, phone } = req.body;
    
    if (!voucherCode || !phone) {
      return res.status(400).json({ 
        success: false, 
        message: "Voucher code and phone number are required" 
      });
    }

    // Create or update user account automatically
    await createOrUpdateUser(phone);

    const result = await db.runTransaction(async (transaction) => {
      // Find voucher by code
      const vouchersQuery = db.collection("vouchers").where("code", "==", voucherCode.toUpperCase());
      const snapshot = await transaction.get(vouchersQuery);
      
      if (snapshot.empty) {
        throw new Error("Invalid voucher code");
      }

      const voucherDoc = snapshot.docs[0];
      const voucherData = voucherDoc.data();
      
      // Check if voucher is still active
      if (voucherData.status !== "active") {
        throw new Error("Voucher has already been used or is no longer valid");
      }

      // Check if voucher is expired
      if (new Date(voucherData.expiresAt) < new Date()) {
        // Mark as expired
        transaction.update(voucherDoc.ref, { status: "expired" });
        throw new Error("Voucher has expired");
      }

      // Check usage limit if set
      if (voucherData.usageLimit && voucherData.usageCount >= voucherData.usageLimit) {
        throw new Error("Voucher usage limit exceeded");
      }

      // Mark voucher as redeemed and increment usage count
      transaction.update(voucherDoc.ref, {
        status: "redeemed",
        redeemedAt: new Date().toISOString(),
        redeemedBy: phone,
        redeemedByPhone: phone,
        usageCount: (voucherData.usageCount || 0) + 1
      });

      // Create a transaction record for the voucher redemption
      const receiptData = {
        phone,
        amount: 0, // Free access via voucher
        packageName: voucherData.packageName,
        packageValue: voucherData.packageValue,
        paymentMethod: "voucher",
        voucherCode: voucherCode.toUpperCase(),
        ownerId: voucherData.ownerId,
        status: "Success",
        time: new Date().toISOString(),
      };

      const receiptRef = transaction.set(db.collection("receipts").doc(), receiptData);

      return {
        packageName: voucherData.packageName,
        packageValue: voucherData.packageValue,
        ownerId: voucherData.ownerId,
        receiptId: receiptRef.id
      };
    });

    // Create WiFi session for voucher redemption
    try {
      await createWiFiSessionFromVoucher(phone, result.packageName, result.ownerId, result.receiptId);
    } catch (err) {
      console.warn("WiFi session creation from voucher failed (non-blocking):", err.message);
      // Don't fail the voucher redemption if session creation fails
    }

    res.json({ 
      success: true, 
      package: {
        name: result.packageName,
        value: result.packageValue
      }
    });
  } catch (error) {
    console.error("Voucher redemption error:", error);
    res.status(400).json({ 
      success: false, 
      message: error.message || "Failed to redeem voucher" 
    });
  }
});

// Helper function to create WiFi session from voucher
async function createWiFiSessionFromVoucher(phone, packageName, ownerId, receiptId) {
  try {
    // Get package details
    const packagesSnap = await db.collection("packages")
      .where("ownerId", "==", ownerId)
      .where("name", "==", packageName)
      .limit(1)
      .get();
    
    if (packagesSnap.empty) {
      console.warn(`Package not found: ${packageName} for owner ${ownerId}`);
      return;
    }
    
    const packageDoc = packagesSnap.docs[0];
    const packageData = packageDoc.data();
    
    // Get hotspot info for this owner
    const hotspotsSnap = await db.collection("hotspots")
      .where("ownerId", "==", ownerId)
      .limit(1)
      .get();
    
    let hotspotId = null;
    let hotspotName = "WiFi Hotspot";
    
    if (!hotspotsSnap.empty) {
      const hotspotData = hotspotsSnap.docs[0].data();
      hotspotId = hotspotsSnap.docs[0].id;
      hotspotName = hotspotData.hotspotName || hotspotData.name || "WiFi Hotspot";
    }
    
    // Check if user already has an active session at this hotspot
    if (hotspotId) {
      const existingSessionSnap = await db.collection("wifi_sessions")
        .where("userPhone", "==", phone)
        .where("hotspotId", "==", hotspotId)
        .where("status", "in", ["active", "connected"])
        .limit(1)
        .get();
      
      if (!existingSessionSnap.empty) {
        // Resume existing session
        const existingSession = existingSessionSnap.docs[0];
        await existingSession.ref.update({
          status: "connected",
          lastConnected: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        return;
      }
    }
    
    // Create new session
    const startTime = new Date();
    const expiresAt = new Date(startTime.getTime() + (packageData.timeLimitMinutes * 60 * 1000));
    
    await db.collection("wifi_sessions").add({
      userPhone: phone,
      hotspotId: hotspotId || null,
      hotspotName,
      packageId: packageDoc.id,
      packageName,
      paymentMethod: "voucher",
      paymentReference: receiptId,
      startTime: startTime.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "active",
      dataUsed: 0,
      createdAt: startTime.toISOString(),
      updatedAt: startTime.toISOString()
    });
    
    console.log(`WiFi session created from voucher for ${phone} at ${hotspotName}`);
  } catch (error) {
    console.error("Error creating WiFi session from voucher:", error);
    throw error;
  }
}

// Check voucher status
router.get("/check/:code", async (req, res) => {
  try {
    const { code } = req.params;
    
    const snapshot = await db.collection("vouchers")
      .where("code", "==", code.toUpperCase())
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      return res.status(404).json({ 
        success: false, 
        message: "Voucher not found" 
      });
    }

    const voucherData = snapshot.docs[0].data();
    
    // Check if expired
    let status = voucherData.status;
    if (status === "active" && new Date(voucherData.expiresAt) < new Date()) {
      status = "expired";
      // Update status in database
      await snapshot.docs[0].ref.update({ status: "expired" });
    }

    res.json({
      success: true,
      voucher: {
        code: voucherData.code,
        packageName: voucherData.packageName,
        packageValue: voucherData.packageValue,
        status,
        expiresAt: voucherData.expiresAt,
        redeemedAt: voucherData.redeemedAt,
        redeemedBy: voucherData.redeemedByPhone
      }
    });
  } catch (error) {
    console.error("Error checking voucher:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to check voucher" 
    });
  }
});

// List vouchers for an owner
router.get("/owner/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { status, limit = 50 } = req.query;
    
    let snapshot;
    try {
      // Preferred: use Firestore ordering (requires composite index in some projects)
      let orderedQuery = db
        .collection("vouchers")
        .where("ownerId", "==", ownerId)
        .orderBy("createdAt", "desc");

      if (status) {
        orderedQuery = orderedQuery.where("status", "==", status);
      }

      orderedQuery = orderedQuery.limit(Number(limit));
      snapshot = await orderedQuery.get();
    } catch (err) {
      // Fallback: if missing index or similar, fetch without orderBy and sort in memory
      const isIndexError =
        (typeof err?.code === "string" && err.code.toLowerCase() === "failed-precondition") ||
        err?.code === 9 ||
        (typeof err?.message === "string" && err.message.toLowerCase().includes("index"));

      if (!isIndexError) throw err;

      let fallbackQuery = db.collection("vouchers").where("ownerId", "==", ownerId);
      if (status) {
        fallbackQuery = fallbackQuery.where("status", "==", status);
      }
      fallbackQuery = fallbackQuery.limit(Number(limit));
      snapshot = await fallbackQuery.get();
    }

    let vouchers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    // Ensure most recent first even when using fallback path
    vouchers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, vouchers });
  } catch (error) {
    console.error("Error fetching vouchers:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch vouchers" 
    });
  }
});

// Get voucher statistics for an owner
router.get("/owner/:ownerId/stats", async (req, res) => {
  try {
    const { ownerId } = req.params;
    
    const snapshot = await db.collection("vouchers")
      .where("ownerId", "==", ownerId)
      .get();
    
    const vouchers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const stats = {
      totalVouchers: vouchers.length,
      activeVouchers: vouchers.filter(v => v.status === 'active').length,
      redeemedVouchers: vouchers.filter(v => v.status === 'redeemed').length,
      expiredVouchers: vouchers.filter(v => v.status === 'expired').length,
      totalRedemptions: vouchers.reduce((sum, v) => sum + (v.usageCount || 0), 0),
      usageRate: vouchers.length > 0 ? 
        Math.round((vouchers.filter(v => v.status === 'redeemed').length / vouchers.length) * 100) : 0
    };
    
    res.json({ success: true, stats });
  } catch (error) {
    console.error("Error fetching voucher stats:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch voucher statistics" 
    });
  }
});

// Server-Sent Events stream for live voucher stats (and optional list) per owner
router.get("/owner/:ownerId/stream", async (req, res) => {
  try {
    const { ownerId } = req.params;
    if (!ownerId) return res.status(400).end();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (payload) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {}
    };

    // Initial snapshot then realtime updates
    const unsubscribe = db
      .collection("vouchers")
      .where("ownerId", "==", ownerId)
      .onSnapshot((snapshot) => {
        const vouchers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        vouchers.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        const stats = {
          totalVouchers: vouchers.length,
          activeVouchers: vouchers.filter((v) => v.status === "active").length,
          redeemedVouchers: vouchers.filter((v) => v.status === "redeemed").length,
          expiredVouchers: vouchers.filter((v) => v.status === "expired").length,
          totalRedemptions: vouchers.reduce((sum, v) => sum + (v.usageCount || 0), 0),
          usageRate:
            vouchers.length > 0
              ? Math.round((vouchers.filter((v) => v.status === "redeemed").length / vouchers.length) * 100)
              : 0,
        };
        send({ success: true, stats, vouchers });
      }, (err) => {
        send({ success: false, error: err?.message || "stream_error" });
      });

    req.on("close", () => {
      try { unsubscribe && unsubscribe(); } catch {}
      res.end();
    });
  } catch (e) {
    try {
      res.write(`data: ${JSON.stringify({ success: false, error: "init_failed" })}\n\n`);
      res.end();
    } catch {}
  }
});

// Apply voucher to a package (server-side calculation + signed quote)
router.post("/apply", async (req, res) => {
  try {
    const { voucherCode, ownerId, packageName, packagePrice, phone } = req.body;
    if (!voucherCode || !ownerId || !packageName || packagePrice === undefined) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }
    const msisdn = phone ? normalizeMsisdn(phone) : null;

    const snap = await db
      .collection("vouchers")
      .where("code", "==", String(voucherCode || "").toUpperCase())
      .limit(1)
      .get();
    if (snap.empty) return res.status(404).json({ success: false, message: "Invalid voucher code" });
    const doc = snap.docs[0];
    const v = doc.data();

    if (v.ownerId !== ownerId) {
      return res.status(403).json({ success: false, message: "Voucher owner mismatch" });
    }
    if (v.status !== "active") {
      return res.status(400).json({ success: false, message: `Voucher is ${v.status}` });
    }
    if (new Date(v.expiresAt) < new Date()) {
      await doc.ref.update({ status: "expired" });
      return res.status(400).json({ success: false, message: "Voucher has expired" });
    }
    if (v.usageLimit && (v.usageCount || 0) >= v.usageLimit) {
      return res.status(400).json({ success: false, message: "Voucher usage limit exceeded" });
    }
    if (v.packageName && v.packageName !== packageName) {
      return res.status(400).json({ success: false, message: `Voucher only valid for ${v.packageName}` });
    }

    const price = Number(packagePrice) || 0;
    let discounted = price;
    if (v.type === "discount") {
      const pct = Number(v.packageValue || 0);
      discounted = Math.max(0, Math.round(price * (1 - pct / 100)));
    } else if (v.type === "free_access") {
      discounted = 0;
    }

    const quote = signQuote({
      voucherCode: v.code,
      ownerId,
      packageName,
      originalAmount: price,
      amountToCharge: discounted,
      msisdn,
      ts: Date.now()
    });
    return res.json({ success: true, discountedAmount: discounted, quote });
  } catch (e) {
    console.error("Apply voucher error:", e);
    res.status(500).json({ success: false, message: "Failed to apply voucher" });
  }
});

// Cancel/deactivate voucher (for owners)
router.post("/:voucherId/cancel", async (req, res) => {
  try {
    const { voucherId } = req.params;
    const { ownerId } = req.body; // Verify ownership
    
    const voucherDoc = await db.collection("vouchers").doc(voucherId).get();
    
    if (!voucherDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: "Voucher not found" 
      });
    }

    const voucherData = voucherDoc.data();
    
    // Verify ownership
    if (voucherData.ownerId !== ownerId) {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied" 
      });
    }

    // Check if voucher can be cancelled
    if (voucherData.status === "redeemed") {
      return res.status(400).json({ 
        success: false, 
        message: "Cannot cancel a redeemed voucher" 
      });
    }

    // Cancel voucher
    await voucherDoc.ref.update({
      status: "cancelled",
      cancelledAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: "Voucher cancelled successfully"
    });
  } catch (error) {
    console.error("Error cancelling voucher:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to cancel voucher" 
    });
  }
});

module.exports = router;
