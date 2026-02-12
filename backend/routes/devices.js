const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

// 🔥 Firebase Admin (using existing structure)
const { admin, db } = require("../firebase");

// ✅ ENV VARS (set these in .env)
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || "http://localhost:5000"; // public URL reachable by routers
const CALLBACK_SECRET = process.env.CALLBACK_SECRET || "supersecret"; // simple shared secret for callbacks

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const toArray = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return String(val)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

async function appendDeviceLog(deviceId, entry) {
  try {
    if (!deviceId) return;
    const log = {
      level: entry?.level || "info",
      type: entry?.type || "event",
      message: entry?.message || "",
      meta: entry?.meta || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtISO: new Date().toISOString(),
    };
    await db
      .collection("devices")
      .doc(String(deviceId))
      .collection("logs")
      .add(log);
  } catch (err) {
    console.warn(
      "[devices] Failed to append device log:",
      err?.message || err
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 1) Create device (called by frontend wizard Step 1)
// ─────────────────────────────────────────────────────────────
router.post("/api/devices", async (req, res) => {
  try {
    const {
      ownerId,
      deviceName,
      routerIdentity, // Router identity/name (like "WeaveCo")
      deviceType = "mikrotik", // default to mikrotik
      serviceType, // "hotspot" | "pppoe" | ["hotspot", "pppoe"] (array or single)
      antiSharing = false, // Anti-sharing protection for hotspot
      interfaces,  // array of ports like ["ether2","ether3"]
    } = req.body;

    if (!ownerId || !deviceName || !serviceType) {
      return res.status(400).json({ 
        success: false, 
        message: "ownerId, deviceName, and serviceType are required." 
      });
    }

    // Normalize serviceType to array
    const serviceTypes = Array.isArray(serviceType) ? serviceType : [serviceType];
    if (serviceTypes.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "At least one service type must be selected." 
      });
    }

    const iface = Array.isArray(interfaces) ? interfaces : toArray(interfaces);
    const deviceId = uuidv4();
    const token = generateToken();

    const doc = {
      deviceId,
      ownerId,
      deviceName,
      routerIdentity: routerIdentity || "",
      deviceType,
      serviceType: serviceTypes, // Store as array
      antiSharing: antiSharing || false,
      interfaces: iface,
      status: "pending",
      token,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("devices").doc(deviceId).set(doc);
    appendDeviceLog(deviceId, {
      type: "device_created",
      message: `Device created: ${deviceName}`,
      meta: {
        deviceType,
        serviceType: serviceTypes,
        antiSharing: !!antiSharing,
        interfaces: iface,
        routerIdentity: routerIdentity || "",
      },
    });

    return res.json({
      success: true,
      device: doc,
      // Frontend will call this next to show copyable script:
      provisioningScriptUrl: `${APP_PUBLIC_URL}/api/provisioning/script?deviceId=${deviceId}`,
    });
  } catch (err) {
    console.error("Create device error:", err);
    res.status(500).json({ success: false, message: "Failed to create device." });
  }
});

// ─────────────────────────────────────────────────────────────
// 2) Return "Step 2" provisioning snippet to show in UI
//    MikroTik owner copies this into terminal
// ─────────────────────────────────────────────────────────────
router.get("/api/provisioning/script", async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).send("Missing deviceId");

    const snap = await db.collection("devices").doc(deviceId).get();
    if (!snap.exists) return res.status(404).send("Device not found");

    const device = snap.data();

    appendDeviceLog(deviceId, {
      type: "provisioning_script_requested",
      message: "Provisioning script requested",
      meta: { deviceType: device.deviceType || "mikrotik" },
    });

    // This is the VERY SIMPLE copy/paste snippet (Step 2 UI)
    const script = [
      `/tool fetch url="${APP_PUBLIC_URL}/provisioning/bootstrap?rId=${device.deviceId}&token=${device.token}" dst-path=bootstrap.rsc`,
      `/delay 2`,
      `/import file-name=bootstrap.rsc`,
    ].join("\n");

    res.set("Content-Type", "text/plain");
    return res.send(script);
  } catch (err) {
    console.error("Provisioning script error:", err);
    res.status(500).send("Internal error");
  }
});

// ─────────────────────────────────────────────────────────────
// 3) Bootstrap script (downloaded by MikroTik)
//    This is the heavy-lifting script imported by the router.
//    Tailor for hotspot/pppoe as needed.
// ─────────────────────────────────────────────────────────────
router.get("/provisioning/bootstrap", async (req, res) => {
  try {
    const { rId, token } = req.query;
    if (!rId || !token) return res.status(400).send("Missing rId/token");

    const ref = db.collection("devices").doc(rId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).send("Device not found");

    const device = snap.data();
    if (device.token !== token) return res.status(403).send("Invalid token");

    // Enhanced bootstrap script matching video tutorial requirements
    const serviceTypes = Array.isArray(device.serviceType) ? device.serviceType : [device.serviceType];
    const interfaces = device.interfaces || ["ether2"];
    
    const scriptLines = [];

    appendDeviceLog(rId, {
      type: "bootstrap_requested",
      message: "Bootstrap script requested by router",
      meta: {
        routerIdentity: device.routerIdentity || "",
        serviceType: serviceTypes,
        interfaces,
        antiSharing: !!device.antiSharing,
      },
    });

    // 0) Set router identity if provided
    if (device.routerIdentity) {
      scriptLines.push(
        `/system identity set name="${device.routerIdentity}"`,
        `:put "Router identity set to: ${device.routerIdentity}"`
      );
    }

    // 1) Basic safety & API setup
    const apiPassword = crypto.randomBytes(8).toString("hex");
    scriptLines.push(
      `/ip/service set api address=0.0.0.0/0 disabled=no`,
      `/user add name=yaba_api group=full password=${apiPassword} disabled=no`,
      `:put "API user created: yaba_api"`
    );

    // 2) Create bridge for all selected interfaces (as shown in video)
    scriptLines.push(
      `:put "Creating bridge for interfaces: ${interfaces.join(", ")}"`,
      `/interface bridge add name=bridge_yaba protocol-mode=none`
    );

    // Add all interfaces to bridge (except ether1 if it's the WAN port)
    interfaces.forEach(iface => {
      scriptLines.push(
        `/interface bridge port add bridge=bridge_yaba interface=${iface}`
      );
    });

    // 3) Configure services based on selected types
    if (serviceTypes.includes("hotspot")) {
      scriptLines.push(
        `:put "Configuring Hotspot service"`
      );

      // Use bridge interface for hotspot
      scriptLines.push(
        `/ip address add address=10.10.10.1/24 interface=bridge_yaba comment="YABA Hotspot"`,
        `/ip pool add name=hs_pool ranges=10.10.10.2-10.10.10.254`,
        `/ip dhcp-server add name=hs_dhcp interface=bridge_yaba address-pool=hs_pool disabled=no`,
        `/ip dhcp-server network add address=10.10.10.0/24 gateway=10.10.10.1 dns-server=8.8.8.8,1.1.1.1`
      );

      // Hotspot profile
      scriptLines.push(
        `/ip hotspot profile add name=hs_prof hotspot-address=10.10.10.1 dns-name=yaba.login local-address=10.10.10.1 html-directory=hotspot`
      );
      
      // Add anti-sharing if enabled
      if (device.antiSharing) {
        scriptLines.push(
          `/ip hotspot profile set hs_prof shared-users=1`,
          `:put "Anti-sharing protection enabled"`
        );
      }
      
      scriptLines.push(
        `/ip hotspot add name=hs1 interface=bridge_yaba profile=hs_prof disabled=no`
      );

      if (device.antiSharing) {
        scriptLines.push(
          `:put "Anti-sharing protection enabled"`
        );
      }
    }

    if (serviceTypes.includes("pppoe")) {
      scriptLines.push(
        `:put "Configuring PPPoE service"`
      );

      // PPPoE server configuration
      scriptLines.push(
        `/ip pool add name=pppoe_pool ranges=10.20.20.2-10.20.20.254`,
        `/ppp profile add name=pppoe_prof local-address=10.20.20.1 remote-address=pppoe_pool`,
        `/interface pppoe-server server add service-name=yaba_pppoe interface=bridge_yaba disabled=no`
      );
    }

    // 2) Call back to your server → mark connected
    const callbackUrl = `${APP_PUBLIC_URL}/api/devices/connected?rId=${encodeURIComponent(
      rId
    )}&secret=${encodeURIComponent(CALLBACK_SECRET)}&status=online`;
    scriptLines.push(
      `:delay 2`,
      `/tool fetch url="${callbackUrl}" keep-result=no`,
      `:put "YABA bootstrap complete"`
    );

    const out = scriptLines.join("\n");
    res.set("Content-Type", "text/plain");
    return res.send(out);
  } catch (err) {
    console.error("Bootstrap error:", err);
    res.status(500).send("Internal error");
  }
});

// ─────────────────────────────────────────────────────────────
// 4) Router callback: mark as connected/online
// ─────────────────────────────────────────────────────────────
router.get("/api/devices/connected", async (req, res) => {
  try {
    const { rId, secret, status, ip } = req.query;
    if (secret !== CALLBACK_SECRET) return res.status(403).send("Forbidden");

    const ref = db.collection("devices").doc(String(rId));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).send("Device not found");

    await ref.update({
      status: status === "online" ? "online" : "unknown",
      wanIp: ip || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    appendDeviceLog(String(rId), {
      type: "connected_callback",
      message: `Router callback received: ${status === "online" ? "online" : "unknown"}`,
      meta: { ip: ip || null },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("Device connected callback error:", err);
    res.status(500).json({ success: false });
  }
});

// ─────────────────────────────────────────────────────────────
// 5) Device status (used by Step 3 polling)
//    (Optional: integrate real MikroTik API check later)
// ─────────────────────────────────────────────────────────────
router.get("/api/devices/status/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const snap = await db.collection("devices").doc(id).get();
    if (!snap.exists) return res.status(404).json({ 
      success: false, 
      message: "Device not found" 
    });

    const d = snap.data();
    return res.json({
      success: true,
      status: d.status || "unknown",
      device: d,
    });
  } catch (err) {
    console.error("Status error:", err);
    res.status(500).json({ success: false });
  }
});

// ─────────────────────────────────────────────────────────────
// 6) Get all devices for an owner
// ─────────────────────────────────────────────────────────────
router.get("/api/devices/owner/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;
    
    const snapshot = await db.collection("devices")
      .where("ownerId", "==", ownerId)
      .orderBy("createdAt", "desc")
      .get();

    const devices = [];
    snapshot.forEach(doc => {
      devices.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return res.json({
      success: true,
      devices
    });
  } catch (err) {
    console.error("Get owner devices error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch devices" });
  }
});

// ─────────────────────────────────────────────────────────────
// 7) Update device
// ─────────────────────────────────────────────────────────────
router.put("/api/devices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated
    delete updateData.deviceId;
    delete updateData.ownerId;
    delete updateData.createdAt;
    
    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.collection("devices").doc(id).update(updateData);
    appendDeviceLog(id, {
      type: "device_updated",
      message: "Device updated",
      meta: {
        updatedFields: Object.keys(updateData || {}).filter(
          (k) => !["updatedAt"].includes(k)
        ),
      },
    });

    return res.json({
      success: true,
      message: "Device updated successfully"
    });
  } catch (err) {
    console.error("Update device error:", err);
    res.status(500).json({ success: false, message: "Failed to update device" });
  }
});

// ─────────────────────────────────────────────────────────────
// 8) Delete/unlink device
// ─────────────────────────────────────────────────────────────
router.delete("/api/devices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Best-effort: log the unlink before deleting the doc
    appendDeviceLog(id, { type: "device_unlinked", message: "Device unlinked" });
    await db.collection("devices").doc(id).delete();

    return res.json({
      success: true,
      message: "Device unlinked successfully"
    });
  } catch (err) {
    console.error("Delete device error:", err);
    res.status(500).json({ success: false, message: "Failed to unlink device" });
  }
});

// ─────────────────────────────────────────────────────────────
// 9) Ping router to test connectivity
// ─────────────────────────────────────────────────────────────
router.get("/api/devices/:id/ping", async (req, res) => {
  try {
    const { id } = req.params;
    const snap = await db.collection("devices").doc(id).get();
    
    if (!snap.exists) {
      return res.status(404).json({ 
        success: false, 
        message: "Device not found" 
      });
    }

    const device = snap.data();
    
    // Simple ping test - check if device has WAN IP and is marked online
    // In production, you'd ping the actual router IP via MikroTik API
    const isOnline = device.status === "online";
    const wanIp = device.wanIp || null;
    
    // Simulate ping time (in real implementation, ping actual router)
    const pingTime = isOnline ? Math.floor(Math.random() * 50) + 10 : null;

    appendDeviceLog(id, {
      type: "ping_test",
      message: isOnline ? "Ping test: reachable" : "Ping test: not reachable",
      meta: { status: isOnline ? "online" : "offline", pingTime, wanIp },
    });

    return res.json({
      success: isOnline,
      status: isOnline ? "online" : "offline",
      pingTime: pingTime,
      wanIp: wanIp,
      message: isOnline 
        ? `Router is reachable${wanIp ? ` at ${wanIp}` : ""}` 
        : "Router is not reachable. Please check connection and configuration."
    });
  } catch (err) {
    console.error("Ping error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to ping device" 
    });
  }
});

// ─────────────────────────────────────────────────────────────
// 10) Fetch device logs (UI "Router Logs")
// ─────────────────────────────────────────────────────────────
router.get("/api/devices/:id/logs", async (req, res) => {
  try {
    const { id } = req.params;
    const limitRaw = parseInt(String(req.query.limit || "200"), 10);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 200, 500));

    const deviceSnap = await db.collection("devices").doc(id).get();
    if (!deviceSnap.exists) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }

    const logsSnap = await db
      .collection("devices")
      .doc(id)
      .collection("logs")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const logs = logsSnap.docs.map((d) => {
      const data = d.data() || {};
      let createdAtISO = data.createdAtISO || null;
      try {
        if (!createdAtISO && data.createdAt && typeof data.createdAt.toDate === "function") {
          createdAtISO = data.createdAt.toDate().toISOString();
        }
      } catch (_) {}
      return {
        id: d.id,
        level: data.level || "info",
        type: data.type || "event",
        message: data.message || "",
        meta: data.meta || null,
        createdAtISO,
      };
    });

    return res.json({ success: true, logs });
  } catch (err) {
    console.error("Device logs error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch logs" });
  }
});

module.exports = router;
