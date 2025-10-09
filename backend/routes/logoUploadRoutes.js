const express = require("express");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const streamifier = require("streamifier");
const { db } = require("../firebase");
const router = express.Router();

// Multer config for file upload
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Configure Cloudinary (expects env vars to be set)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

router.post("/uploadLogo/:ownerId", upload.single("logo"), async (req, res) => {
  try {
    const ownerId = req.params.ownerId;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const streamUpload = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "wifi-logos" },
          (error, result) => (error ? reject(error) : resolve(result))
        );
        streamifier.createReadStream(file.buffer).pipe(stream);
      });

    const result = await streamUpload();
    const logoUrl = result.secure_url;

    await db.collection("owners").doc(ownerId).set({ logoUrl }, { merge: true });

    res.status(200).json({ 
      success: true,
      logoUrl,
      message: "Logo uploaded successfully"
    });
  } catch (error) {
    console.error("Error uploading logo:", error);
    res.status(500).json({ error: "Failed to upload logo" });
  }
});

// Remove logo endpoint
router.delete("/remove/:ownerId", async (req, res) => {
  try {
    const ownerId = req.params.ownerId;
    
    // Remove logoUrl from owner document
    await db.collection("owners").doc(ownerId).update({
      logoUrl: null
    });

    res.status(200).json({ 
      success: true,
      message: "Logo removed successfully" 
    });
  } catch (error) {
    console.error("Error removing logo:", error);
    res.status(500).json({ error: "Failed to remove logo" });
  }
});

module.exports = router;
