const express = require("express");
const router = express.Router();
const { db } = require("../firebase");

// Add admin
router.post("/add", async (req, res) => {
  try {
    const { ownerId, userId, role } = req.body;
    if (!ownerId || !userId || !role) return res.status(400).json({ success: false });
    await db.collection("ownerAdmins").add({ ownerId, userId, role, createdAt: new Date().toISOString() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// Remove admin
router.post("/remove", async (req, res) => {
  try {
    const { ownerId, userId } = req.body;
    if (!ownerId || !userId) return res.status(400).json({ success: false });
    const snap = await db.collection("ownerAdmins").where("ownerId", "==", ownerId).where("userId", "==", userId).get();
    for (const doc of snap.docs) await doc.ref.delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// Set role
router.post("/set-role", async (req, res) => {
  try {
    const { ownerId, userId, role } = req.body;
    if (!ownerId || !userId || !role) return res.status(400).json({ success: false });
    const snap = await db.collection("ownerAdmins").where("ownerId", "==", ownerId).where("userId", "==", userId).get();
    for (const doc of snap.docs) await doc.ref.update({ role });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// List admins
router.get("/list", async (req, res) => {
  try {
    const { ownerId } = req.query;
    if (!ownerId) return res.json({ admins: [] });
    const snap = await db.collection("ownerAdmins").where("ownerId", "==", ownerId).get();
    const admins = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ admins });
  } catch (err) {
    res.status(500).json({ admins: [] });
  }
});

module.exports = router;
