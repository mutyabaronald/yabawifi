// Load environment variables from backend/.env
require("dotenv").config({ path: __dirname + "/.env" });
const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const adminRoutes = require("./adminRoutes");
const mtnRoutes = require("./routes/mtn");
const superRoutes = require("./superRoutes");
const routerRoutes = require("./routes/routers");
// const airtelRoutes = require("./routes/airtel");
// const admin = require("firebase-admin");
const receiptRoutes = require("./routes/receiptRoutes");
const logoRoutes = require("./routes/logoUploadRoutes");
const ownersRoutes = require("./routes/owners");
const usersRoutes = require("./routes/users");
const vouchersRoutes = require("./routes/vouchers");
const hotspotsRoutes = require("./routes/hotspots");
const loyaltyRoutes = require("./routes/loyalty");
const ownerLoyaltyRoutes = require("./routes/ownerLoyalty");
const reviewsRoutes = require("./routes/reviews");
const notificationsRoutes = require("./routes/notifications"); // Added

const ownerNotificationsRoutes = require("./routes/ownerNotifications");
const ownerAdminsRoutes = require("./routes/ownerAdmins");
const packagesRoutes = require("./routes/packages");
const devicesRoutes = require("./routes/devices");
const deviceTrackingRoutes = require("./routes/deviceTracking");
const statisticsRoutes = require("./routes/statistics-new");
const ownersSupportRoutes = require("./routes/ownersSupport");
const supportRoutes = require("./routes/support");
const brandingRoutes = require("./routes/branding");
const referralsRoutes = require("./routes/referrals");
const ciscoRoutes = require("./routes/ciscoRoutes");
require("./ciscoExpiryCron");

const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 5000;

// Verify Twilio configuration on startup
if (
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_VERIFY_SERVICE_SID
) {
  console.log("✅ Twilio SMS service configured");
} else {
  console.warn(
    "⚠️  Twilio SMS service not fully configured. Forgot password via SMS will not work.",
  );
  console.warn("   Missing:", {
    accountSid: !process.env.TWILIO_ACCOUNT_SID ? "TWILIO_ACCOUNT_SID" : "",
    authToken: !process.env.TWILIO_AUTH_TOKEN ? "TWILIO_AUTH_TOKEN" : "",
    serviceSid: !process.env.TWILIO_VERIFY_SERVICE_SID
      ? "TWILIO_VERIFY_SERVICE_SID"
      : "",
  });
}

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Cisco SSH check endpoint (defined early to guarantee routing)
app.get("/api/devices/:id/ssh-check", async (req, res) => {
  try {
    const { id } = req.params;
    const { db, admin } = require("./firebase");
    const { checkCiscoConnection } = require("./services/ciscoService");

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
  } catch (err) {
    console.error("Cisco ssh-check error (early route):", err);
    return res.status(500).json({
      success: false,
      status: "offline",
      message: err?.message || "Failed to SSH check Cisco device",
    });
  }
});
app.use("/api/admin", adminRoutes);
app.use("/api/statistics", statisticsRoutes);

// Test route directly in server.js
app.get("/api/test", (req, res) => {
  console.log("SERVER TEST ROUTE HIT!");
  res.json({
    message: "Server test route working",
    timestamp: new Date().toISOString(),
  });
});

// Test Twilio configuration endpoint
app.get("/api/test/twilio", (req, res) => {
  const config = {
    hasAccountSid: !!process.env.TWILIO_ACCOUNT_SID,
    hasAuthToken: !!process.env.TWILIO_AUTH_TOKEN,
    hasServiceSid: !!process.env.TWILIO_VERIFY_SERVICE_SID,
    accountSidPrefix: process.env.TWILIO_ACCOUNT_SID
      ? process.env.TWILIO_ACCOUNT_SID.substring(0, 5)
      : "N/A",
    authTokenPrefix: process.env.TWILIO_AUTH_TOKEN
      ? process.env.TWILIO_AUTH_TOKEN.substring(0, 5)
      : "N/A",
    serviceSidPrefix: process.env.TWILIO_VERIFY_SERVICE_SID
      ? process.env.TWILIO_VERIFY_SERVICE_SID.substring(0, 5)
      : "N/A",
    cwd: process.cwd(),
    nodeEnv: process.env.NODE_ENV,
  };
  res.json({
    message: "Twilio configuration check",
    configured:
      config.hasAccountSid && config.hasAuthToken && config.hasServiceSid,
    ...config,
  });
});

app.use(superRoutes);
app.use("/api/receipts", receiptRoutes);
app.use("/api/logo", logoRoutes);
app.use("/api/packages", packagesRoutes);
app.use("/api/owners", ownersRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/vouchers", vouchersRoutes);
app.use("/api/routers", routerRoutes);
app.use("/api", mtnRoutes);
app.use("/api/hotspots", hotspotsRoutes);

// Compatibility: some clients call /api/hotspots (no trailing slash)
// Express router mount should already handle this, but keep an explicit handler
// to avoid "Cannot GET /api/hotspots" in some setups.
app.get("/api/hotspots", async (req, res) => {
  try {
    const { db } = require("./firebase");
    const snap = await db.collection("hotspots").limit(200).get();
    const hotspots = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ success: true, hotspots });
  } catch (err) {
    console.error("Hotspots list error:", err?.message || err);
    res.status(500).json({ success: false, hotspots: [] });
  }
});
app.use("/api/loyalty", loyaltyRoutes);
app.use("/api/owner/loyalty", ownerLoyaltyRoutes);
app.use("/api/reviews", reviewsRoutes);
app.use("/api/notifications", notificationsRoutes); // Added

app.use("/api/owner", ownerNotificationsRoutes);
app.use("/api/owner/admins", ownerAdminsRoutes);
app.use("/api/owners", ownersSupportRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/branding", brandingRoutes);
app.use("/api/referrals", referralsRoutes);
app.use("/api/devices/cisco", ciscoRoutes);
app.use("/", devicesRoutes);
app.use("/api/devices", deviceTrackingRoutes);

// Cisco SSH check endpoint (compatibility/safety)
// Some deployments were not registering the router-based ssh-check route as expected.
// Keep this here to guarantee the endpoint exists.
app.get("/api/devices/:id/ssh-check", async (req, res) => {
  try {
    const { id } = req.params;
    const { db, admin } = require("./firebase");
    const { checkCiscoConnection } = require("./services/ciscoService");

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
    const fresh = lastCheckedMs && Date.now() - lastCheckedMs < 60_000; // 60s
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
  } catch (err) {
    console.error("Cisco ssh-check error (server.js):", err);
    return res.status(500).json({
      success: false,
      status: "offline",
      message: err?.message || "Failed to SSH check Cisco device",
    });
  }
});

// Serve static files from frontend directory (after all API routes)
app.use(express.static(path.join(__dirname, "../frontend")));

// Serve uploaded branding files
app.use(
  "/uploads/branding",
  express.static(path.join(__dirname, "uploads/branding")),
);

// Health check endpoint for Render.com
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "WiFi Automation API is running",
    timestamp: new Date().toISOString(),
  });
});

// Moved MTN integration into routes/mtn.js

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log("Routes registered:");
  console.log("- /api/statistics/*");
  console.log("- /api/test");
  console.log("- /api/reviews/*");
  console.log("- /api/owners/*");
  console.log("- /api/users/*");
  console.log("- /api/hotspots/*");
  console.log("- /api/loyalty/*");
  console.log("- /api/notifications/*");
  console.log("- /api/support/*");
  console.log("- /api/branding/*");
  console.log("- /api/referrals/*");
});
