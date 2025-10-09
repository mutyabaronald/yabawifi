const express = require("express");
const { db } = require("../firebase");

const router = express.Router();

// GET /api/owners/:ownerId/support-settings
router.get("/:ownerId/support-settings", async (req, res) => {
  try {
    const { ownerId } = req.params;
    if (!ownerId) return res.status(400).json({ message: "ownerId is required" });

    const doc = await db.collection("owner_support_settings").doc(ownerId).get();
    if (!doc.exists) {
      return res.json({ settings: null });
    }
    return res.json({ settings: doc.data() });
  } catch (e) {
    console.error("support-settings get error", e);
    return res.status(500).json({ message: "Failed to fetch support settings" });
  }
});

// POST /api/owners/:ownerId/support-settings
router.post("/:ownerId/support-settings", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const payload = req.body || {};
    if (!ownerId) return res.status(400).json({ message: "ownerId is required" });

    const allowed = ["brandName","logoUrl","contact","channels","faqs","categories"]; // shallow validation
    const saveData = { updatedAt: new Date().toISOString() };
    allowed.forEach(k => { if (payload[k] !== undefined) saveData[k] = payload[k]; });

    await db.collection("owner_support_settings").doc(ownerId).set(saveData, { merge: true });
    const doc = await db.collection("owner_support_settings").doc(ownerId).get();
    return res.json({ success: true, settings: doc.data() });
  } catch (e) {
    console.error("support-settings save error", e);
    return res.status(500).json({ message: "Failed to save support settings" });
  }
});

module.exports = router;



