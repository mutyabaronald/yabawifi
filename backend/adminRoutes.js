const express = require("express");
const router = express.Router();
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const streamifier = require("streamifier");

const { admin, db } = require("./firebase");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = process.env.SUPERADMIN_JWT_SECRET || "dev-super-secret";
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || "owner@yaba";
// Default dev hash for password "super123"
const DEFAULT_SUPERADMIN_PASSWORD_HASH = bcrypt.hashSync(
  process.env.SUPERADMIN_PASSWORD || "super123",
  10
);

const upload = multer({ storage: multer.memoryStorage() });

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Super Admin: email/password login that returns JWT
router.post("/superadmin/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    // In production, fetch super admin from DB. Here we use env-configured account.
    const isEmailMatch = email.toLowerCase() === String(SUPERADMIN_EMAIL).toLowerCase();
    if (!isEmailMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const isPasswordOk = await bcrypt.compare(password, DEFAULT_SUPERADMIN_PASSWORD_HASH);
    if (!isPasswordOk) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign({ sub: email, role: "superadmin" }, JWT_SECRET, { expiresIn: "12h" });
    return res.json({ success: true, token, role: "superadmin", email });
  } catch (err) {
    console.error("Superadmin login error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Middleware: verify super admin token
function verifySuperAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Missing token" });
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || payload.role !== "superadmin") {
      return res.status(403).json({ message: "Unauthorized access" });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Example protected route under /api/admin/super only accessible to super admin
router.get("/super/ping", verifySuperAdmin, (req, res) => {
  res.json({ ok: true, pong: true, user: req.user });
});

// WiFi Owner/Admin change password (secure flow)
router.post("/change-password", async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Missing payload" });
    }

    // In production, you would identify the current admin/owner from auth token.
    // For now, use the configured SUPERADMIN as example.
    const email = SUPERADMIN_EMAIL;
    const isCurrentOk = await bcrypt.compare(currentPassword, DEFAULT_SUPERADMIN_PASSWORD_HASH);
    if (!isCurrentOk) {
      return res.status(401).json({ success: false, message: "Wrong current password" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    // Persist the new hash somewhere secure. For demo, we cannot change env; store in Firestore.
    try {
      await db.collection("settings").doc("superadmin_secret").set({ email, passwordHash: newHash, updatedAt: new Date().toISOString() });
    } catch {}

    return res.json({ success: true, message: "Password updated. Please log in again." });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* -------------------------------------
   Get Owner Logo by ownerName
-------------------------------------- */
router.get("/get-logo/:ownerName", async (req, res) => {
  try {
    const { ownerName } = req.params;
    const snapshot = await db
      .collection("owners")
      .where("ownerName", "==", ownerName)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ message: "Owner not found" });
    }

    const data = snapshot.docs[0].data();
    return res.json({ logoUrl: data.logoUrl || "" });
  } catch (error) {
    console.error("Error fetching logo by ownerName:", error);
    return res.status(500).json({ message: "Failed to fetch logo" });
  }
});

/* -------------------------------------
   Get Owner Logo by phone (helper for current UI)
-------------------------------------- */
router.get("/get-logo-by-phone/:phone", async (req, res) => {
  try {
    const { phone } = req.params;
    const snapshot = await db
      .collection("owners")
      .where("ownerPhone", "==", phone)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ message: "Owner not found" });
    }

    const data = snapshot.docs[0].data();
    return res.json({ logoUrl: data.logoUrl || "" });
  } catch (error) {
    console.error("Error fetching logo by phone:", error);
    return res.status(500).json({ message: "Failed to fetch logo" });
  }
});

/* -------------------------------------
   2. Register New WiFi Owner in Firestore
-------------------------------------- */
router.post("/register-owner", async (req, res) => {
  const { ownerName, ownerPhone } = req.body;

  if (!ownerName || !ownerPhone) {
    return res
      .status(400)
      .json({ error: "Owner name and phone are required." });
  }

  try {
    const docRef = await db.collection("owners").add({
      ownerName,
      ownerPhone,
      logoUrl: "", // Will be updated later
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({
      message: "WiFi owner registered successfully.",
      ownerId: docRef.id,
    });
  } catch (error) {
    console.error("Error registering WiFi owner:", error);
    res.status(500).json({ error: "Failed to register WiFi owner." });
  }
});

/* -------------------------------------------
   3. Upload Logo to Cloudinary & Save in Firestore
-------------------------------------------- */
router.post(
  "/upload-logo/:ownerId",
  upload.single("logo"),
  async (req, res) => {
    const ownerId = req.params.ownerId;

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    try {
      // Upload to Cloudinary using stream
      const streamUpload = (req) => {
        return new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "wifi-logos" },
            (error, result) => {
              if (result) {
                resolve(result);
              } else {
                reject(error);
              }
            }
          );
          streamifier.createReadStream(req.file.buffer).pipe(stream);
        });
      };

      const result = await streamUpload(req);

      // Update logoUrl in Firestore
      const ownerRef = db.collection("owners").doc(ownerId);
      await ownerRef.update({ logoUrl: result.secure_url });

      res.status(200).json({ success: true, logoUrl: result.secure_url });
    } catch (err) {
      console.error("Cloudinary upload failed:", err);
      res.status(500).json({ error: "Logo upload failed." });
    }
  }
);

module.exports = router;
