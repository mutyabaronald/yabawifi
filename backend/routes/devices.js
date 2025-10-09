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

// ─────────────────────────────────────────────────────────────
// 1) Create device (called by frontend wizard Step 1)
// ─────────────────────────────────────────────────────────────
router.post("/api/devices", async (req, res) => {
  try {
    const {
      ownerId,
      deviceName,
      deviceType = "mikrotik", // default to mikrotik
      serviceType, // "hotspot" | "pppoe"
      interfaces,  // array of ports like ["ether2","ether3"]
    } = req.body;

    if (!ownerId || !deviceName || !serviceType) {
      return res.status(400).json({ 
        success: false, 
        message: "ownerId, deviceName, and serviceType are required." 
      });
    }

    const iface = Array.isArray(interfaces) ? interfaces : toArray(interfaces);
    const deviceId = uuidv4();
    const token = generateToken();

    const doc = {
      deviceId,
      ownerId,
      deviceName,
      deviceType,
      serviceType,
      interfaces: iface,
      status: "pending",
      token,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("devices").doc(deviceId).set(doc);

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

    // Very basic example. You'll expand this with real hotspot/pppoe setup.
    // NOTE: RouterOS CLI is picky—test & refine on lab device.
    const iface = device.interfaces?.[0] || "ether2";

    const scriptLines = [];

    // 0) Basic safety & API
    scriptLines.push(
      `/ip/service set api address=0.0.0.0/0 disabled=no`,
      `/user add name=yaba_api group=full password=${crypto.randomBytes(6).toString("hex")} disabled=no`,
    );

    if (device.serviceType === "hotspot") {
      // 1) Hotspot quick-setup (simplified — adjust to your network)
      scriptLines.push(
        `:put "Configuring Hotspot on ${iface}"`,
        `/ip address add address=10.10.10.1/24 interface=${iface} comment="YABA Hotspot"`,
        `/ip pool add name=hs_pool ranges=10.10.10.2-10.10.10.254`,
        `/ip dhcp-server add name=hs_dhcp interface=${iface} address-pool=hs_pool disabled=no`,
        `/ip dhcp-server network add address=10.10.10.0/24 gateway=10.10.10.1 dns-server=8.8.8.8,1.1.1.1`,
        `/ip hotspot profile add name=hs_prof hotspot-address=10.10.10.1 dns-name=yaba.login local-address=10.10.10.1 html-directory=hotspot`,
        `/ip hotspot add name=hs1 interface=${iface} profile=hs_prof disabled=no`,
      );
    }

    if (device.serviceType === "pppoe") {
      // Minimal placeholder — you'll add full PPPoE server config later
      scriptLines.push(
        `:put "Configuring PPPoE (placeholder)"`,
        `/interface pppoe-server server add service-name=yaba_pppoe interface=${iface} disabled=no`,
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

module.exports = router;
