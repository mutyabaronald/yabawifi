const express = require("express");
const { db } = require("../firebase");

const router = express.Router();

// POST /api/support/submit
router.post("/submit", async (req, res) => {
  try {
    const { ownerId, category, issue, userId, userPhone } = req.body || {};
    if (!ownerId || !category || !issue) {
      return res.status(400).json({ message: "ownerId, category and issue are required" });
    }
    const id = `${ownerId}-${Date.now()}`;
    const payload = {
      id,
      ownerId,
      category,
      issue,
      userId: userId || null,
      userPhone: userPhone || null,
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.collection("support_requests").doc(id).set(payload);
    // Create admin notification for owner
    const adminNotif = {
      ownerId,
      type: "support_request",
      title: "New support request",
      message: `${userPhone || 'User'} submitted a ${category} request`,
      relatedId: id,
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    await db.collection("admin_notifications").add(adminNotif);
    return res.json({ success: true, id });
  } catch (e) {
    console.error("support submit error", e);
    return res.status(500).json({ message: "Failed to submit support request" });
  }
});

// GET /api/support/requests (for owner)
router.get("/requests", async (req, res) => {
  try {
    const { ownerId, limit = 50, status } = req.query || {};
    if (!ownerId) return res.status(400).json({ message: "ownerId is required" });
    let ref = db.collection("support_requests").where("ownerId", "==", ownerId).orderBy("createdAt", "desc");
    const snap = await ref.get();
    let items = snap.docs.map(d => d.data());
    if (status) items = items.filter(i => i.status === status);
    return res.json({ requests: items.slice(0, Number(limit) || 50) });
  } catch (e) {
    console.error("support requests list error", e);
    return res.status(500).json({ message: "Failed to fetch requests" });
  }
});

// GET /api/support/my (for user)
router.get("/my", async (req, res) => {
  try {
    const { userPhone, limit = 50 } = req.query || {};
    if (!userPhone) return res.status(400).json({ message: "userPhone is required" });
    const snap = await db.collection("support_requests").where("userPhone", "==", userPhone).orderBy("createdAt", "desc").get();
    const items = snap.docs.map(d => d.data());
    return res.json({ requests: items.slice(0, Number(limit) || 50) });
  } catch (e) {
    console.error("support my list error", e);
    return res.status(500).json({ message: "Failed to fetch your requests" });
  }
});

// POST /api/support/reply (owner replies to a request)
router.post("/reply", async (req, res) => {
  try {
    const { ownerId, requestId, message, responderName } = req.body || {};
    if (!ownerId || !requestId || !message) {
      return res.status(400).json({ message: "ownerId, requestId, message are required" });
    }
    const reqRef = db.collection("support_requests").doc(requestId);
    const doc = await reqRef.get();
    if (!doc.exists) return res.status(404).json({ message: "Request not found" });
    const data = doc.data();
    if (data.ownerId !== ownerId) return res.status(403).json({ message: "Unauthorized" });
    const reply = {
      message,
      responder: responderName || "Owner Support",
      createdAt: new Date().toISOString(),
    };
    const updates = {
      replies: [...(data.replies || []), reply],
      status: "answered",
      updatedAt: new Date().toISOString(),
    };
    await reqRef.set(updates, { merge: true });
    // Notify user
    if (data.userPhone) {
      await db.collection("user_notifications").add({
        userPhone: data.userPhone,
        type: "support_reply",
        title: "Support replied",
        message: message.slice(0, 120),
        relatedId: requestId,
        isRead: false,
        createdAt: new Date().toISOString(),
      });
    }
    return res.json({ success: true });
  } catch (e) {
    console.error("support reply error", e);
    return res.status(500).json({ message: "Failed to send reply" });
  }
});

module.exports = router;
