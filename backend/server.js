require("dotenv").config();
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

const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});
app.use("/api/admin", adminRoutes);
app.use("/api/statistics", statisticsRoutes);

// Test route directly in server.js
app.get("/api/test", (req, res) => {
  console.log("SERVER TEST ROUTE HIT!");
  res.json({ message: "Server test route working", timestamp: new Date().toISOString() });
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
app.use("/", devicesRoutes);
app.use("/api/devices", deviceTrackingRoutes);

// Serve static files from frontend directory (after all API routes)
app.use(express.static(path.join(__dirname, "../frontend")));

// Serve uploaded branding files
app.use('/uploads/branding', express.static(path.join(__dirname, 'uploads/branding')));

// Health check endpoint for Render.com
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'WiFi Automation API is running',
    timestamp: new Date().toISOString()
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
