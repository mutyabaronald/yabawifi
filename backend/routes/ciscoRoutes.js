const express = require("express");
const { db } = require("../firebase");
const {
  onboardCiscoDevice,
  createVoucherUser,
  deleteVoucherUser,
  updateUserBandwidth,
  disconnectExpiredUsers,
  getConnectedUsers,
} = require("../services/ciscoService");

const router = express.Router();

// POST /onboard
router.post("/onboard", async (req, res) => {
  try {
    const {
      ip,
      sshPort,
      sshUser,
      sshPassword,
      enablePassword,
      locationId,
      ownerId,
    } = req.body || {};

    if (!ip || !sshUser || !sshPassword || !ownerId) {
      return res.status(400).json({
        success: false,
        message: "ip, sshUser, sshPassword, and ownerId are required",
      });
    }

    const deviceConn = {
      ip,
      sshPort: sshPort || 22,
      sshUser,
      sshPassword,
      enablePassword,
    };

    const onboardResult = await onboardCiscoDevice(deviceConn);
    if (!onboardResult.success) {
      return res.status(500).json({
        success: false,
        message: onboardResult.message,
        rawOutput: onboardResult.rawOutput,
      });
    }

    const nowIso = new Date().toISOString();
    const docRef = await db.collection("devices").add({
      type: "cisco",
      ip,
      sshPort: sshPort || 22,
      sshUser,
      sshPassword,
      enablePassword: enablePassword || null,
      model: onboardResult.model || null,
      version: onboardResult.version || null,
      locationId: locationId || null,
      ownerId,
      status: "active",
      createdAt: nowIso,
    });

    return res.json({
      success: true,
      deviceId: docRef.id,
      model: onboardResult.model || null,
      version: onboardResult.version || null,
      rawOutput: onboardResult.rawOutput,
    });
  } catch (err) {
    console.error("Cisco /onboard error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to onboard Cisco device",
    });
  }
});

// POST /users/create
router.post("/users/create", async (req, res) => {
  try {
    const {
      deviceId,
      username,
      password,
      downloadKbps,
      uploadKbps,
      expiresAt,
    } = req.body || {};

    if (!deviceId || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "deviceId, username, and password are required",
      });
    }

    const deviceSnap = await db.collection("devices").doc(deviceId).get();
    if (!deviceSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    const device = deviceSnap.data();
    const deviceConn = {
      ip: device.ip,
      sshPort: device.sshPort || 22,
      sshUser: device.sshUser,
      sshPassword: device.sshPassword,
      enablePassword: device.enablePassword,
    };

    const result = await createVoucherUser(deviceConn, {
      username,
      password,
      downloadKbps,
      uploadKbps,
      expiresAt,
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.message,
        rawOutput: result.rawOutput,
      });
    }

    const nowIso = new Date().toISOString();
    await db.collection("voucherSessions").add({
      deviceId,
      username,
      password,
      downloadKbps: Number(downloadKbps) || 0,
      uploadKbps: Number(uploadKbps) || 0,
      expiresAt: expiresAt || null,
      routerType: "cisco",
      status: "active",
      createdAt: nowIso,
    });

    return res.json({
      success: true,
      message: "Cisco voucher user created",
      rawOutput: result.rawOutput,
    });
  } catch (err) {
    console.error("Cisco /users/create error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create Cisco voucher user",
    });
  }
});

// DELETE /users/:username?deviceId=xxx
router.delete("/users/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const { deviceId } = req.query;

    if (!deviceId || !username) {
      return res.status(400).json({
        success: false,
        message: "deviceId and username are required",
      });
    }

    const deviceSnap = await db.collection("devices").doc(deviceId).get();
    if (!deviceSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    const device = deviceSnap.data();
    const deviceConn = {
      ip: device.ip,
      sshPort: device.sshPort || 22,
      sshUser: device.sshUser,
      sshPassword: device.sshPassword,
      enablePassword: device.enablePassword,
    };

    const result = await deleteVoucherUser(deviceConn, username);
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.message,
        rawOutput: result.rawOutput,
      });
    }

    const nowIso = new Date().toISOString();
    const sessionsSnap = await db
      .collection("voucherSessions")
      .where("deviceId", "==", deviceId)
      .where("username", "==", username)
      .where("routerType", "==", "cisco")
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (!sessionsSnap.empty) {
      const doc = sessionsSnap.docs[0];
      await doc.ref.update({
        status: "expired",
        disconnectedAt: nowIso,
      });
    }

    return res.json({
      success: true,
      message: "User disconnected from Cisco router",
      rawOutput: result.rawOutput,
    });
  } catch (err) {
    console.error("Cisco DELETE /users error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to delete Cisco voucher user",
    });
  }
});

// PUT /users/:username/bandwidth
router.put("/users/:username/bandwidth", async (req, res) => {
  try {
    const { username } = req.params;
    const { deviceId, downloadKbps, uploadKbps } = req.body || {};

    if (!deviceId || !username) {
      return res.status(400).json({
        success: false,
        message: "deviceId and username are required",
      });
    }

    const deviceSnap = await db.collection("devices").doc(deviceId).get();
    if (!deviceSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    const device = deviceSnap.data();
    const deviceConn = {
      ip: device.ip,
      sshPort: device.sshPort || 22,
      sshUser: device.sshUser,
      sshPassword: device.sshPassword,
      enablePassword: device.enablePassword,
    };

    const result = await updateUserBandwidth(
      deviceConn,
      username,
      downloadKbps,
      uploadKbps,
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.message,
        rawOutput: result.rawOutput,
      });
    }

    const sessionsSnap = await db
      .collection("voucherSessions")
      .where("deviceId", "==", deviceId)
      .where("username", "==", username)
      .where("routerType", "==", "cisco")
      .limit(1)
      .get();

    if (!sessionsSnap.empty) {
      const doc = sessionsSnap.docs[0];
      await doc.ref.update({
        downloadKbps: Number(downloadKbps) || 0,
        uploadKbps: Number(uploadKbps) || 0,
      });
    }

    return res.json({
      success: true,
      message: "User bandwidth updated on Cisco router",
      rawOutput: result.rawOutput,
    });
  } catch (err) {
    console.error("Cisco PUT /users/:username/bandwidth error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to update Cisco user bandwidth",
    });
  }
});

// GET /:deviceId/users
router.get("/:deviceId/users", async (req, res) => {
  try {
    const { deviceId } = req.params;

    const deviceSnap = await db.collection("devices").doc(deviceId).get();
    if (!deviceSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    const device = deviceSnap.data();
    const deviceConn = {
      ip: device.ip,
      sshPort: device.sshPort || 22,
      sshUser: device.sshUser,
      sshPassword: device.sshPassword,
      enablePassword: device.enablePassword,
    };

    const result = await getConnectedUsers(deviceConn);
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.message,
        rawOutput: result.rawOutput,
      });
    }

    return res.json({
      success: true,
      rawOutput: result.rawOutput,
    });
  } catch (err) {
    console.error("Cisco GET /:deviceId/users error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to get connected users from Cisco",
    });
  }
});

// POST /expire
router.post("/expire", async (req, res) => {
  try {
    const { deviceId, expiredUsernames } = req.body || {};

    if (!deviceId || !Array.isArray(expiredUsernames)) {
      return res.status(400).json({
        success: false,
        message: "deviceId and expiredUsernames[] are required",
      });
    }

    const deviceSnap = await db.collection("devices").doc(deviceId).get();
    if (!deviceSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    const device = deviceSnap.data();
    const deviceConn = {
      ip: device.ip,
      sshPort: device.sshPort || 22,
      sshUser: device.sshUser,
      sshPassword: device.sshPassword,
      enablePassword: device.enablePassword,
    };

    const result = await disconnectExpiredUsers(deviceConn, expiredUsernames);

    return res.json({
      success: result.success,
      message: result.message,
      results: result.results || [],
      rawOutput: result.rawOutput,
    });
  } catch (err) {
    console.error("Cisco POST /expire error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to expire Cisco users",
    });
  }
});

module.exports = router;
