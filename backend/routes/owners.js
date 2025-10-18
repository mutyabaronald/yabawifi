const express = require("express");
const multer = require("multer");
const { db } = require("../firebase"); // Your Firestore config
const cloudinary = require("cloudinary").v2;
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const bcrypt = require("bcryptjs");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Get owner info by phone number
router.get("/by-phone/:phone", async (req, res) => {
  try {
    const { phone } = req.params;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    // Find owner by phone
    const ownerQuery = db.collection("owners").where("ownerPhone", "==", phone);
    const snapshot = await ownerQuery.get();

    if (snapshot.empty) {
      return res.status(404).json({
        success: false,
        message: "Owner not found",
      });
    }

    const ownerDoc = snapshot.docs[0];
    const ownerData = ownerDoc.data();

    res.json({
      success: true,
      owner: {
        id: ownerDoc.id,
        ownerName: ownerData.ownerName,
        ownerPhone: ownerData.ownerPhone,
        ownerWhatsapp: ownerData.ownerWhatsapp,
        businessName: ownerData.businessName,
        logoUrl: ownerData.logoUrl,
      },
    });
  } catch (error) {
    console.error("Get owner by phone error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Owner Login - Optimized for performance
router.post("/login", async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Phone and password are required",
      });
    }

    // Optimize: Use document ID lookup if phone is the document ID, otherwise use query
    let ownerDoc, ownerData;

    try {
      // First try direct document access (faster if phone is used as doc ID)
      ownerDoc = await db.collection("owners").doc(phone).get();
      if (ownerDoc.exists) {
        ownerData = ownerDoc.data();
        // Verify the phone matches (in case doc ID is different)
        if (ownerData.ownerPhone !== phone) {
          ownerDoc = null;
        }
      } else {
        ownerDoc = null;
      }
    } catch (err) {
      ownerDoc = null;
    }

    // Fallback to query if direct access failed
    if (!ownerDoc || !ownerDoc.exists) {
      const ownerQuery = db
        .collection("owners")
        .where("ownerPhone", "==", phone)
        .limit(1);
      const snapshot = await ownerQuery.get();

      if (snapshot.empty) {
        return res.status(401).json({
          success: false,
          message: "Invalid phone number or password",
        });
      }

      ownerDoc = snapshot.docs[0];
      ownerData = ownerDoc.data();
    }

    // Check password (in production, use bcrypt to hash passwords)
    if (ownerData.password !== password) {
      return res.status(401).json({
        success: false,
        message: "Invalid phone number or password",
      });
    }

    // Generate simple token (in production, use JWT)
    const token = uuidv4();

    // Store token in Firestore for session management (async, don't wait)
    db.collection("owner_sessions")
      .doc(token)
      .set({
        ownerId: ownerDoc.id,
        phone: ownerData.ownerPhone,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      })
      .catch((err) => {
        console.warn("Session storage failed:", err);
      });

    // Return response immediately without waiting for session storage
    res.json({
      success: true,
      token,
      owner: {
        id: ownerDoc.id,
        ownerName: ownerData.ownerName,
        ownerPhone: ownerData.ownerPhone,
        businessName: ownerData.businessName,
        logoUrl: ownerData.logoUrl,
      },
    });
  } catch (error) {
    console.error("Owner login error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});

// Get Owner Profile (protected route)
router.get("/profile/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token required",
      });
    }

    // Verify token
    const sessionDoc = await db.collection("owner_sessions").doc(token).get();
    if (!sessionDoc.exists) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    const sessionData = sessionDoc.data();
    if (sessionData.ownerId !== ownerId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Check if session expired
    if (new Date(sessionData.expiresAt) < new Date()) {
      await sessionDoc.ref.delete();
      return res.status(401).json({
        success: false,
        message: "Session expired",
      });
    }

    // Get owner profile
    const ownerDoc = await db.collection("owners").doc(ownerId).get();
    if (!ownerDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Owner not found",
      });
    }

    const ownerData = ownerDoc.data();
    res.json({
      success: true,
      owner: {
        id: ownerDoc.id,
        ownerName: ownerData.ownerName,
        ownerPhone: ownerData.ownerPhone,
        businessName: ownerData.businessName,
        logoUrl: ownerData.logoUrl,
        ownerWhatsapp: ownerData.ownerWhatsapp,
        createdAt: ownerData.createdAt,
        tagline: ownerData.tagline || ownerData.motto || ownerData.slogan || "",
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Owner Registration
router.post("/register", async (req, res) => {
  try {
    const { ownerName, ownerPhone, password, businessName } = req.body;

    if (!ownerName || !ownerPhone || !password) {
      return res.status(400).json({
        success: false,
        message: "Owner name, phone, and password are required",
      });
    }

    // Check if phone already exists
    const existingQuery = db
      .collection("owners")
      .where("ownerPhone", "==", ownerPhone);
    const existingSnapshot = await existingQuery.get();

    if (!existingSnapshot.empty) {
      return res.status(400).json({
        success: false,
        message: "Phone number already registered",
      });
    }

    // Create new owner
    const newOwner = {
      ownerName,
      ownerPhone,
      // Store unhashed for backward compatibility; change-password route will migrate to hash on first change
      password,
      businessName: businessName || "",
      logoUrl: "",
      ownerWhatsapp: "", // WhatsApp number for user support
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const docRef = await db.collection("owners").add(newOwner);

    res.status(201).json({
      success: true,
      message: "Owner registered successfully",
      ownerId: docRef.id,
    });
  } catch (error) {
    console.error("Owner registration error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to register owner",
    });
  }
});

// POST /api/owners/change-password
router.post("/change-password", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    const { currentPassword, newPassword } = req.body || {};

    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication token required" });
    }
    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Missing passwords" });
    }

    // Resolve session → ownerId
    const sessionDoc = await db.collection("owner_sessions").doc(token).get();
    if (!sessionDoc.exists) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired session" });
    }
    const { ownerId } = sessionDoc.data();

    // Load owner
    const ownerRef = db.collection("owners").doc(ownerId);
    const ownerDoc = await ownerRef.get();
    if (!ownerDoc.exists) {
      return res
        .status(404)
        .json({ success: false, message: "Owner not found" });
    }
    const owner = ownerDoc.data();

    const stored = String(owner.password || "");
    let currentOk = false;
    if (stored.startsWith("$2a$") || stored.startsWith("$2b$")) {
      // hashed already
      currentOk = await bcrypt.compare(currentPassword, stored);
    } else {
      // legacy plaintext storage
      currentOk = stored === currentPassword;
    }
    if (!currentOk) {
      return res
        .status(401)
        .json({ success: false, message: "Wrong current password" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await ownerRef.set(
      { password: newHash, updatedAt: new Date().toISOString() },
      { merge: true }
    );

    // Invalidate session to force re-login
    try {
      await db.collection("owner_sessions").doc(token).delete();
    } catch {}

    return res.json({
      success: true,
      message: "Password updated. Please log in again.",
    });
  } catch (e) {
    console.error("owner change-password error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// PUT /api/owners/:id
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      ownerPhone,
      ownerWhatsapp,
      reviewsEnabled,
      ownerName,
      motto,
      slogan,
      tagline,
    } = req.body;
    if (!ownerPhone || !ownerWhatsapp) {
      return res
        .status(400)
        .json({ success: false, message: "Missing phone or WhatsApp." });
    }

    const updateData = {
      ownerPhone,
      ownerWhatsapp,
      updatedAt: new Date().toISOString(),
    };

    if (typeof reviewsEnabled === "boolean") {
      updateData.reviewsEnabled = reviewsEnabled;
    }
    if (ownerName) updateData.ownerName = ownerName;
    if (motto) updateData.motto = motto;
    if (slogan) updateData.slogan = slogan;
    if (tagline) updateData.tagline = tagline;

    await db.collection("owners").doc(id).set(updateData, { merge: true });
    const doc = await db.collection("owners").doc(id).get();
    res.json({ success: true, owner: { id: doc.id, ...doc.data() } });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Failed to update owner." });
  }
});

// Upload WiFi Owner Logo
router.post("/upload-logo", upload.single("logo"), async (req, res) => {
  try {
    const ownerId = req.body.ownerId;
    if (!ownerId) {
      return res.status(400).json({ error: "Owner ID is required" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload_stream(
      { folder: `wifi_logos/${ownerId}` },
      async (error, result) => {
        if (error) {
          console.error(error);
          return res
            .status(500)
            .json({ error: "Error uploading to Cloudinary" });
        }

        // Save URL in Firestore
        await db
          .collection("owners")
          .doc(ownerId)
          .set(
            {
              logoUrl: result.secure_url,
              ownerName: req.body.ownerName || "",
            },
            { merge: true }
          );

        res.json({
          message: "Logo uploaded successfully",
          logoUrl: result.secure_url,
        });
      }
    );

    // Write file buffer to Cloudinary
    uploadResult.end(req.file.buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error uploading logo" });
  }
});

// Get Logo & Owner Name by Owner ID
router.get("/logo/:ownerId", async (req, res) => {
  try {
    const ownerId = req.params.ownerId;
    const doc = await db.collection("owners").doc(ownerId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Owner not found" });
    }

    const data = doc.data();
    res.json({
      logoUrl: data.logoUrl || null,
      ownerName: data.ownerName || "",
      ownerPhone: data.ownerPhone || "",
      ownerWhatsapp: data.ownerWhatsapp || "",
      motto: data.motto || null,
      slogan: data.slogan || null,
      tagline: data.tagline || null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

// --- WALLET ENDPOINTS ---

// Get wallet balance
router.get("/:ownerId/wallet/balance", async (req, res) => {
  const { ownerId } = req.params;
  try {
    const walletRef = db.collection("wallets").doc(ownerId);
    const doc = await walletRef.get();
    if (!doc.exists) {
      // Create wallet if not exists
      await walletRef.set({ ownerId, balance: 0, transactions: [] });
      return res.json({ balance: 0 });
    }
    return res.json({ balance: doc.data().balance || 0 });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch wallet balance" });
  }
});

// Get wallet transaction history
router.get("/:ownerId/wallet/transactions", async (req, res) => {
  const { ownerId } = req.params;
  try {
    const walletRef = db.collection("wallets").doc(ownerId);
    const doc = await walletRef.get();
    if (!doc.exists) {
      return res.json({ transactions: [] });
    }
    return res.json({ transactions: doc.data().transactions || [] });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch wallet transactions" });
  }
});

// Request withdrawal
router.post("/:ownerId/wallet/withdraw", async (req, res) => {
  const { ownerId } = req.params;
  const { amount, mobileMoneyNumber, provider } = req.body; // provider: 'mtn' or 'airtel'
  if (!amount || amount <= 0 || !mobileMoneyNumber) {
    return res.status(400).json({ error: "Invalid withdrawal request" });
  }
  try {
    const walletRef = db.collection("wallets").doc(ownerId);
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(walletRef);
      if (!doc.exists) throw new Error("Wallet not found");
      const data = doc.data();
      if ((data.balance || 0) < amount) throw new Error("Insufficient balance");
      // Deduct balance
      transaction.update(walletRef, {
        balance: (data.balance || 0) - amount,
        transactions: [
          {
            type: "withdrawal",
            amount,
            date: new Date().toISOString(),
            description: `Withdrawal to ${mobileMoneyNumber}`,
          },
          ...(data.transactions || []),
        ].slice(0, 100), // keep last 100
      });
    });
    // --- MTN MoMo payout integration ---
    if (true) {
      // Get access token
      const tokenRes = await axios.post(
        `${process.env.MTN_BASE_URL}/disbursement/token/`,
        null,
        {
          headers: {
            "Ocp-Apim-Subscription-Key": process.env.MTN_PRIMARY_KEY,
          },
          auth: {
            username: process.env.MTN_API_USER,
            password: process.env.MTN_API_KEY,
          },
        }
      );
      const accessToken = tokenRes.data.access_token;
      // Prepare payout payload
      const externalId = `${
        process.env.MTN_REFERENCE_ID || "withdrawal"
      }-${ownerId}-${Date.now()}`;
      const payoutPayload = {
        amount: amount.toString(),
        currency: "UGX",
        externalId,
        payee: {
          partyIdType: "MSISDN",
          partyId: mobileMoneyNumber,
        },
        payerMessage: "Wi-Fi earnings withdrawal",
        payeeNote: "Thank you for using our platform",
      };
      // Send payout request
      await axios.post(
        `${process.env.MTN_BASE_URL}/disbursement/v1_0/transfer`,
        payoutPayload,
        {
          headers: {
            "X-Reference-Id": externalId,
            "X-Target-Environment": process.env.MTN_ENV || "sandbox",
            "Ocp-Apim-Subscription-Key": process.env.MTN_PRIMARY_KEY,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
    }
    // Non-MTN providers are not supported currently
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "Withdrawal failed" });
  }
});

// CSV export of owner statements (net earnings)
router.get("/:ownerId/reports/export/csv", async (req, res) => {
  const { ownerId } = req.params;
  try {
    const snap = await db
      .collection("payout_splits")
      .where("ownerId", "==", ownerId)
      .orderBy("createdAt", "desc")
      .limit(1000)
      .get();
    const rows = ["date,gross,commission,net,packageName"];
    snap.docs.forEach((d) => {
      const s = d.data();
      rows.push(
        `${s.createdAt},${s.grossAmount || 0},${s.commissionAmount || 0},${
          s.netAmount || 0
        },${(s.packageName || "").replace(/,/g, ";")}`
      );
    });
    const csv = rows.join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=owner_${ownerId}_statement.csv`
    );
    res.send(csv);
  } catch (e) {
    res.status(500).send("Failed to export owner statement");
  }
});

// --- OWNER PAYOUT ACCOUNT SETTINGS ---
// Get payout account
router.get("/:ownerId/payout-account", async (req, res) => {
  const { ownerId } = req.params;
  try {
    const doc = await db.collection("owner_payout_accounts").doc(ownerId).get();
    return res.json({ account: doc.exists ? doc.data() : null });
  } catch (e) {
    return res.status(500).json({ message: "Failed to fetch payout account" });
  }
});

// Save payout account
router.post("/:ownerId/payout-account", async (req, res) => {
  const { ownerId } = req.params;
  const { accountType, provider, accountNumber, accountName } = req.body || {};
  // Default to Mobile Money / MTN if not provided
  const resolvedType = accountType || "Mobile Money";
  const resolvedProvider = provider || "MTN";
  try {
    const payload = {
      accountType: resolvedType,
      provider: resolvedProvider,
      updatedAt: new Date().toISOString(),
    };
    if (accountNumber) payload.accountNumber = accountNumber;
    if (accountName) payload.accountName = accountName;
    await db
      .collection("owner_payout_accounts")
      .doc(ownerId)
      .set(payload, { merge: true });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ message: "Failed to save payout account" });
  }
});

module.exports = router;

// Get Logo & Owner Name by Owner ID

router.get("/logo/:ownerId", async (req, res) => {
  try {
    const ownerId = req.params.ownerId;

    const doc = await db.collection("owners").doc(ownerId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Owner not found" });
    }

    const data = doc.data();

    res.json({
      logoUrl: data.logoUrl || null,

      ownerName: data.ownerName || "",

      ownerPhone: data.ownerPhone || "",

      ownerWhatsapp: data.ownerWhatsapp || "",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({ error: "Server error" });
  }
});

// --- WALLET ENDPOINTS ---

// Get wallet balance

router.get("/:ownerId/wallet/balance", async (req, res) => {
  const { ownerId } = req.params;

  try {
    const walletRef = db.collection("wallets").doc(ownerId);

    const doc = await walletRef.get();

    if (!doc.exists) {
      // Create wallet if not exists

      await walletRef.set({ ownerId, balance: 0, transactions: [] });

      return res.json({ balance: 0 });
    }

    return res.json({ balance: doc.data().balance || 0 });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch wallet balance" });
  }
});

// Get wallet transaction history

router.get("/:ownerId/wallet/transactions", async (req, res) => {
  const { ownerId } = req.params;

  try {
    const walletRef = db.collection("wallets").doc(ownerId);

    const doc = await walletRef.get();

    if (!doc.exists) {
      return res.json({ transactions: [] });
    }

    return res.json({ transactions: doc.data().transactions || [] });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch wallet transactions" });
  }
});

// Request withdrawal

router.post("/:ownerId/wallet/withdraw", async (req, res) => {
  const { ownerId } = req.params;

  const { amount, mobileMoneyNumber, provider } = req.body; // provider: 'mtn' or 'airtel'

  if (!amount || amount <= 0 || !mobileMoneyNumber) {
    return res.status(400).json({ error: "Invalid withdrawal request" });
  }

  try {
    const walletRef = db.collection("wallets").doc(ownerId);

    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(walletRef);

      if (!doc.exists) throw new Error("Wallet not found");

      const data = doc.data();

      if ((data.balance || 0) < amount) throw new Error("Insufficient balance");

      // Deduct balance

      transaction.update(walletRef, {
        balance: (data.balance || 0) - amount,

        transactions: [
          {
            type: "withdrawal",
            amount,
            date: new Date().toISOString(),
            description: `Withdrawal to ${mobileMoneyNumber}`,
          },

          ...(data.transactions || []),
        ].slice(0, 100), // keep last 100
      });
    });

    // --- MTN MoMo payout integration ---

    if (true) {
      // Get access token

      const tokenRes = await axios.post(
        `${process.env.MTN_BASE_URL}/disbursement/token/`,

        null,

        {
          headers: {
            "Ocp-Apim-Subscription-Key": process.env.MTN_PRIMARY_KEY,
          },

          auth: {
            username: process.env.MTN_API_USER,

            password: process.env.MTN_API_KEY,
          },
        }
      );

      const accessToken = tokenRes.data.access_token;

      // Prepare payout payload

      const externalId = `${
        process.env.MTN_REFERENCE_ID || "withdrawal"
      }-${ownerId}-${Date.now()}`;

      const payoutPayload = {
        amount: amount.toString(),

        currency: "UGX",

        externalId,

        payee: {
          partyIdType: "MSISDN",

          partyId: mobileMoneyNumber,
        },

        payerMessage: "Wi-Fi earnings withdrawal",

        payeeNote: "Thank you for using our platform",
      };

      // Send payout request

      await axios.post(
        `${process.env.MTN_BASE_URL}/disbursement/v1_0/transfer`,

        payoutPayload,

        {
          headers: {
            "X-Reference-Id": externalId,

            "X-Target-Environment": process.env.MTN_ENV || "sandbox",

            "Ocp-Apim-Subscription-Key": process.env.MTN_PRIMARY_KEY,

            Authorization: `Bearer ${accessToken}`,

            "Content-Type": "application/json",
          },
        }
      );
    }

    // Non-MTN providers are not supported currently
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "Withdrawal failed" });
  }
});

// CSV export of owner statements (net earnings)
router.get("/:ownerId/reports/export/csv", async (req, res) => {
  const { ownerId } = req.params;
  try {
    const snap = await db
      .collection("payout_splits")
      .where("ownerId", "==", ownerId)
      .orderBy("createdAt", "desc")
      .limit(1000)
      .get();
    const rows = ["date,gross,commission,net,packageName"];
    snap.docs.forEach((d) => {
      const s = d.data();
      rows.push(
        `${s.createdAt},${s.grossAmount || 0},${s.commissionAmount || 0},${
          s.netAmount || 0
        },${(s.packageName || "").replace(/,/g, ";")}`
      );
    });
    const csv = rows.join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=owner_${ownerId}_statement.csv`
    );
    res.send(csv);
  } catch (e) {
    res.status(500).send("Failed to export owner statement");
  }
});

// --- OWNER PAYOUT ACCOUNT SETTINGS ---
// Get payout account
router.get("/:ownerId/payout-account", async (req, res) => {
  const { ownerId } = req.params;
  try {
    const doc = await db.collection("owner_payout_accounts").doc(ownerId).get();
    return res.json({ account: doc.exists ? doc.data() : null });
  } catch (e) {
    return res.status(500).json({ message: "Failed to fetch payout account" });
  }
});

// Save payout account
router.post("/:ownerId/payout-account", async (req, res) => {
  const { ownerId } = req.params;
  const { accountType, provider, accountNumber, accountName } = req.body || {};
  if (!accountType || !provider || !accountNumber || !accountName) {
    return res.status(400).json({ message: "All fields are required" });
  }
  try {
    await db.collection("owner_payout_accounts").doc(ownerId).set({
      accountType,
      provider,
      accountNumber,
      accountName,
      updatedAt: new Date().toISOString(),
    });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ message: "Failed to save payout account" });
  }
});

module.exports = router;
