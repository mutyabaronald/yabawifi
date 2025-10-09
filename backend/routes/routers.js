const express = require("express");
const { db } = require("../firebase");
const PDFDocument = require("pdfkit");

const router = express.Router();

// Register or update a router to an owner
router.post("/register", async (req, res) => {
  try {
    const { routerId, ownerId, alias, location, macAddress, ssid, hostname } = req.body;
    if (!routerId || !ownerId) {
      return res.status(400).json({ error: "routerId and ownerId are required" });
    }

    await db.collection("routers").doc(routerId).set(
      {
        ownerId,
        alias: alias || "",
        location: location || "",
        macAddress: macAddress || "",
        ssid: ssid || "",
        hostname: hostname || "",
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Router register error:", err);
    res.status(500).json({ error: "Failed to register router" });
  }
});

// Detect which owner's network a user is on
router.get("/detect-owner", async (req, res) => {
  try {
    const { routerId, macAddress, ssid, hostname } = req.query;
    
    let ownerId = null;
    let routerDoc = null;

    // Try to find owner by routerId first (most precise)
    if (routerId) {
      const doc = await db.collection("routers").doc(routerId).get();
      if (doc.exists) {
        routerDoc = doc;
        ownerId = doc.data().ownerId;
      }
    }

    // Try by MAC address if routerId didn't work
    if (!ownerId && macAddress) {
      const snap = await db.collection("routers").where("macAddress", "==", macAddress).get();
      if (!snap.empty) {
        routerDoc = snap.docs[0];
        ownerId = routerDoc.data().ownerId;
      }
    }

    // Try by SSID if still no match
    if (!ownerId && ssid) {
      const snap = await db.collection("routers").where("ssid", "==", ssid).get();
      if (!snap.empty) {
        routerDoc = snap.docs[0];
        ownerId = routerDoc.data().ownerId;
      }
    }

    // Try by hostname as last resort
    if (!ownerId && hostname) {
      const snap = await db.collection("routers").where("hostname", "==", hostname).get();
      if (!snap.empty) {
        routerDoc = snap.docs[0];
        ownerId = routerDoc.data().ownerId;
      }
    }

    if (!ownerId) {
      return res.status(404).json({ 
        success: false, 
        message: "Could not detect WiFi owner. Please scan QR code or use direct link." 
      });
    }

    // Get owner details
    const ownerDoc = await db.collection("owners").doc(ownerId).get();
    const ownerData = ownerDoc.data() || {};

    res.json({
      success: true,
      ownerId,
      routerId: routerDoc?.id,
      ownerName: ownerData.ownerName,
      businessName: ownerData.businessName,
      logoUrl: ownerData.logoUrl,
      ownerPhone: ownerData.ownerPhone,
      ownerWhatsapp: ownerData.ownerWhatsapp,
    });

  } catch (err) {
    console.error("Owner detection error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to detect owner" 
    });
  }
});

// Ingest a single telemetry datapoint for a router
// Body example: { routerId, activeUsers, avgSpeedMbps, downtimeMin, device, ssid, macAddress }
router.post("/:routerId/ingest-metric", async (req, res) => {
  try {
    const { routerId } = req.params;
    const { activeUsers, avgSpeedMbps, downtimeMin, device, ssid, macAddress } = req.body || {};
    if (!routerId) return res.status(400).json({ error: "routerId required" });

    await db.collection("router_metrics").add({
      routerId,
      timestampISO: new Date().toISOString(),
      activeUsers: Number(activeUsers) || 0,
      avgSpeedMbps: Number(avgSpeedMbps) || 0,
      downtimeMin: Number(downtimeMin) || 0,
      device: device || null,
      ssid: ssid || null,
      macAddress: macAddress || null,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Ingest metric error:", err);
    res.status(500).json({ error: "Failed to ingest metric" });
  }
});

// Resolve owner by routerId
router.get("/:routerId/owner", async (req, res) => {
  try {
    const { routerId } = req.params;
    const doc = await db.collection("routers").doc(routerId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Router not found" });
    }
    const data = doc.data();
    res.json({ ownerId: data.ownerId });
  } catch (err) {
    console.error("Resolve owner error:", err);
    res.status(500).json({ error: "Failed to resolve owner" });
  }
});

// Get launched packages by routerId
router.get("/:routerId/packages", async (req, res) => {
  try {
    const { routerId } = req.params;
    const routerDoc = await db.collection("routers").doc(routerId).get();
    if (!routerDoc.exists) {
      return res.status(404).json({ error: "Router not found" });
    }
    const { ownerId } = routerDoc.data();
    const snap = await db
      .collection("packages")
      .where("ownerId", "==", ownerId)
      .where("status", "==", "launched")
      .get();
    const packages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ ownerId, packages });
  } catch (err) {
    console.error("Router packages error:", err);
    res.status(500).json({ error: "Failed to fetch packages" });
  }
});

// Branding for captive portal
router.get("/:routerId/portal-branding", async (req, res) => {
  try {
    const { routerId } = req.params;
    const routerDoc = await db.collection("routers").doc(routerId).get();
    if (!routerDoc.exists) {
      return res.status(404).json({ error: "Router not found" });
    }
    const { ownerId } = routerDoc.data();
    const ownerDoc = await db.collection("owners").doc(ownerId).get();
    const owner = ownerDoc.data() || {};
    res.json({ ownerId, logoUrl: owner.logoUrl || "", ownerName: owner.ownerName || "" });
  } catch (err) {
    console.error("Router branding error:", err);
    res.status(500).json({ error: "Failed to fetch branding" });
  }
});

// List routers for an owner
router.get("/by-owner/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const snap = await db.collection("routers").where("ownerId", "==", ownerId).get();
    const routers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ routers });
  } catch (err) {
    console.error("List routers error:", err);
    res.status(500).json({ error: "Failed to fetch routers" });
  }
});

// Aggregated telemetry endpoint for OwnerStats (placeholder values where data not tracked)
router.get("/:routerId/telemetry", async (req, res) => {
  try {
    const { routerId } = req.params;

    // Replace placeholder with real data from Firestore collection `router_metrics` (example schema)
    // Each doc example: { routerId, timestampISO, activeUsers, avgSpeedMbps, downtimeMin, device: 'Android' }
    // Aggregate recent window (last 60 minutes) for "active now" and average speed.
    let telemetry = null;
    const now = new Date();
    const fromIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    try {
      const snap = await db
        .collection("router_metrics")
        .where("routerId", "==", routerId)
        .where("timestampISO", ">=", fromIso)
        .get();
      const docs = snap.docs.map((d) => d.data());
      if (docs.length > 0) {
        const activeUsers = docs[docs.length - 1].activeUsers || 0;
        const avgSpeedMbps = Math.round(
          docs.reduce((s, d) => s + (Number(d.avgSpeedMbps) || 0), 0) / docs.length
        );
        const downtimeMin = docs.reduce((s, d) => s + (Number(d.downtimeMin) || 0), 0);
        const deviceCounts = new Map();
        for (const d of docs) {
          const key = (d.device || "Unknown");
          deviceCounts.set(key, (deviceCounts.get(key) || 0) + 1);
        }
        const deviceBreakdown = Array.from(deviceCounts.entries())
          .map(([label, count]) => ({ label, value: count }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5);
        telemetry = {
          activeUsers,
          avgSpeedMbps: isFinite(avgSpeedMbps) ? avgSpeedMbps : 0,
          downtimeMin,
          peakHours: [],
          deviceBreakdown,
        };
      }
    } catch (e) {
      // fall back to placeholder if metrics collection not found
    }

    if (!telemetry) {
      telemetry = {
        activeUsers: Math.floor(Math.random() * 8) + 2,
        avgSpeedMbps: 20 + Math.floor(Math.random() * 10),
        downtimeMin: 0,
        peakHours: ["18:00", "20:00"],
        deviceBreakdown: [
          { label: "Android", value: 68 },
          { label: "iOS", value: 26 },
          { label: "Windows", value: 6 },
        ],
      };
    }

    res.json({ routerId, telemetry });
  } catch (err) {
    console.error("Telemetry error:", err);
    res.status(500).json({ error: "Failed to fetch telemetry" });
  }
});

// Server-side PDF summary for an owner (simple report)
router.get("/report/owner/:ownerId.pdf", async (req, res) => {
  try {
    const { ownerId } = req.params;

    // Pull basic data for the report
    const receiptsSnap = await db
      .collection("receipts")
      .where("ownerId", "==", ownerId)
      .get();
    const receipts = receiptsSnap.docs.map((d) => d.data());
    const totalRevenue = receipts.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const packagesSnap = await db
      .collection("packages")
      .where("ownerId", "==", ownerId)
      .get();
    const packageNames = packagesSnap.docs.map((d) => d.data().packageName || d.data().name);

    // Start PDF
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=owner-${ownerId}-report.pdf`);
    doc.pipe(res);

    doc.fontSize(18).text("WiFi Owner Report", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Owner: ${ownerId}`, { align: "center" });
    doc.moveDown(1);

    doc.fontSize(14).text("Revenue Summary", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Total Revenue: UGX ${totalRevenue.toLocaleString()}`);
    doc.moveDown(1);

    doc.fontSize(14).text("Packages", { underline: true });
    doc.moveDown(0.5);
    for (const n of packageNames) {
      doc.text(`• ${n}`);
    }
    doc.moveDown(1);

    doc.fontSize(14).text("Recent Transactions", { underline: true });
    doc.moveDown(0.5);
    const recent = receipts.slice(-15).reverse();
    for (const r of recent) {
      doc.text(`${(r.time || "").slice(0,16)}  UGX ${(Number(r.amount)||0).toLocaleString()}  ${r.packageName || ""}  ${r.status || ""}`);
    }

    doc.end();
  } catch (err) {
    console.error("PDF report error:", err);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// Get portal branding for a router
router.get("/:routerId/portal-branding", async (req, res) => {
  try {
    const { routerId } = req.params;
    
    // Get router info
    const routerDoc = await db.collection("routers").doc(routerId).get();
    if (!routerDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: "Router not found" 
      });
    }

    const routerData = routerDoc.data();
    const ownerId = routerData.ownerId;

    // Get owner details
    const ownerDoc = await db.collection("owners").doc(ownerId).get();
    const ownerData = ownerDoc.data() || {};

    res.json({
      success: true,
      ownerId,
      routerId,
      ownerName: ownerData.ownerName,
      businessName: ownerData.businessName,
      logoUrl: ownerData.logoUrl,
      ownerPhone: ownerData.ownerPhone,
      ownerWhatsapp: ownerData.ownerWhatsapp,
    });

  } catch (err) {
    console.error("Portal branding error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to get portal branding" 
    });
  }
});

// Get packages for a router
router.get("/:routerId/packages", async (req, res) => {
  try {
    const { routerId } = req.params;
    
    // Get router info
    const routerDoc = await db.collection("routers").doc(routerId).get();
    if (!routerDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: "Router not found" 
      });
    }

    const routerData = routerDoc.data();
    const ownerId = routerData.ownerId;

    // Get packages for this owner
    const packagesSnapshot = await db.collection("packages")
      .where("ownerId", "==", ownerId)
      .where("status", "==", "launched")
      .get();

    const packages = packagesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      ownerId,
      packages
    });

  } catch (err) {
    console.error("Router packages error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to get packages" 
    });
  }
});

module.exports = router;


