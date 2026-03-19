// routes/deviceTracking.js
const express = require("express");
const { admin, db } = require("../firebase");
const router = express.Router();
const { checkCiscoConnection } = require("../services/ciscoService");

// POST /api/devices/connect
// body: { userId, macAddress, userAgent, deviceName, ipAddress, routerId }
router.post("/connect", async (req, res) => {
  try {
    const { userId, macAddress, userAgent, deviceName, ipAddress, routerId } =
      req.body;
    if (!userId || !macAddress)
      return res.status(400).json({ error: "missing userId or macAddress" });

    const deviceId = macAddress.toUpperCase();
    const deviceRef = admin
      .firestore()
      .doc(`users/${userId}/devices/${deviceId}`);

    await deviceRef.set(
      {
        macAddress: deviceId,
        deviceName: deviceName || null,
        userAgent: userAgent || null,
        ipAddress: ipAddress || null,
        routerId: routerId || null,
        firstSeen: admin.firestore.FieldValue.serverTimestamp(),
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        connectionCount: admin.firestore.FieldValue.increment(1),
        status: "online",
      },
      { merge: true },
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("connect error", e);
    return res.status(500).json({ error: "server_error" });
  }
});

// POST /api/devices/disconnect
// body: { userId, macAddress }
router.post("/disconnect", async (req, res) => {
  try {
    const { userId, macAddress } = req.body;
    if (!userId || !macAddress)
      return res.status(400).json({ error: "missing params" });

    const deviceId = macAddress.toUpperCase();
    const deviceRef = admin
      .firestore()
      .doc(`users/${userId}/devices/${deviceId}`);
    await deviceRef.update({
      status: "offline",
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("disconnect error", e);
    return res.status(500).json({ error: "server_error" });
  }
});

// GET /api/devices/owner/:ownerId
// returns all devices for users that belong to owner
router.get("/owner/:ownerId", async (req, res) => {
  try {
    const ownerId = req.params.ownerId;

    let snapshot;
    try {
      // Devices created by the onboarding wizard are stored in root `devices`
      snapshot = await db
        .collection("devices")
        .where("ownerId", "==", ownerId)
        .orderBy("createdAt", "desc")
        .get();
    } catch (err) {
      const isIndexError =
        (typeof err?.code === "string" &&
          err.code.toLowerCase() === "failed-precondition") ||
        err?.code === 9 ||
        (typeof err?.message === "string" &&
          err.message.toLowerCase().includes("index"));

      if (!isIndexError) throw err;

      snapshot = await db
        .collection("devices")
        .where("ownerId", "==", ownerId)
        .get();
    }

    const devices = snapshot.docs.map((doc) => {
      const data = doc.data() || {};
      const createdAtISO = data.createdAt?.toDate
        ? data.createdAt.toDate().toISOString()
        : data.createdAtISO || null;
      const updatedAtISO = data.updatedAt?.toDate
        ? data.updatedAt.toDate().toISOString()
        : data.updatedAtISO || null;

      return {
        id: doc.id,
        deviceId: data.deviceId || doc.id,
        ...data,
        createdAtISO,
        updatedAtISO,
      };
    });

    devices.sort((a, b) => {
      const aT = a.createdAtISO ? Date.parse(a.createdAtISO) : 0;
      const bT = b.createdAtISO ? Date.parse(b.createdAtISO) : 0;
      return bT - aT;
    });

    res.json({ success: true, devices });
  } catch (e) {
    console.error("owner devices error:", e?.message || e);
    console.error(e);
    res.json({ success: false, devices: [] });
  }
});

// GET /api/devices/owner/:ownerId/stats
// returns device statistics for owner
router.get("/owner/:ownerId/stats", async (req, res) => {
  try {
    const ownerId = req.params.ownerId;
    const snapshot = await db
      .collection("devices")
      .where("ownerId", "==", ownerId)
      .get();

    let totalDevices = 0;
    let onlineDevices = 0;
    const deviceTypes = {};
    const hotspotDevices = {};

    snapshot.forEach((doc) => {
      const device = doc.data() || {};
      totalDevices++;
      if (device.status === "online") onlineDevices++;

      const typeKey = device.deviceType || "unknown";
      deviceTypes[typeKey] = (deviceTypes[typeKey] || 0) + 1;

      const hotspotId = device.routerIdentity || device.deviceId || "unknown";
      hotspotDevices[hotspotId] = (hotspotDevices[hotspotId] || 0) + 1;
    });

    res.json({ totalDevices, onlineDevices, deviceTypes, hotspotDevices });
  } catch (e) {
    console.error("owner device stats error", e?.message || e);
    console.error(e);
    // Never crash the dashboard on stats errors
    res.json({
      totalDevices: 0,
      onlineDevices: 0,
      deviceTypes: {},
      hotspotDevices: {},
    });
  }
});

// GET /api/devices/:id/ssh-check
// Active SSH connection check for Cisco routers.
router.get("/:id/ssh-check", async (req, res) => {
  try {
    const { id } = req.params;
    const snap = await db.collection("devices").doc(String(id)).get();
    if (!snap.exists) {
      return res
        .status(404)
        .json({ success: false, message: "Device not found" });
    }
    const device = snap.data();
    if ((device.deviceType || "").toLowerCase() !== "cisco") {
      return res.status(400).json({
        success: false,
        message: "SSH check is only available for Cisco devices",
      });
    }

    // If already online and checked recently, don’t re-SSH.
    const lastCheckedMs = device.lastCheckedAtISO
      ? Date.parse(device.lastCheckedAtISO)
      : 0;
    const fresh = lastCheckedMs && Date.now() - lastCheckedMs < 60_000;
    if (device.status === "online" && fresh) {
      return res.json({
        success: true,
        status: "online",
        message: "Cisco router already marked online",
        model: device.routerModel || null,
        version: device.routerVersion || null,
      });
    }

    const result = await checkCiscoConnection(device);

    await db
      .collection("devices")
      .doc(String(id))
      .update({
        status: result.success ? "online" : "offline",
        routerModel: result.model || null,
        routerVersion: result.version || null,
        lastCheckedAtISO: new Date().toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return res.json({
      success: result.success,
      status: result.success ? "online" : "offline",
      message: result.message,
      model: result.model || null,
      version: result.version || null,
    });
  } catch (e) {
    console.error("cisco ssh-check error", e?.message || e);
    console.error(e);
    return res.status(500).json({
      success: false,
      status: "offline",
      message: e?.message || "Failed to SSH check Cisco device",
    });
  }
});

module.exports = router;
