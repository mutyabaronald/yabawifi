const express = require("express");
const router = express.Router();
const { db } = require("../firebase");

router.get("/notifications", async (req, res) => {
  try {
    const { ownerId } = req.query;
    if (!ownerId) return res.status(400).json({ notifications: [] });
    const notifications = [];
    // 1. Low balance (if owner.balance < 10,000)
    const ownerDoc = await db.collection("owners").doc(ownerId).get();
    const owner = ownerDoc.data() || {};
    if (typeof owner.balance === "number" && owner.balance < 10000) {
      notifications.push({
        type: "low_balance",
        message: `Your wallet balance is low (UGX ${owner.balance}). Please top up to avoid service interruption.`,
        date: new Date().toISOString(),
        read: false,
      });
    }
    // 2. Expiring vouchers (next 3 days)
    const now = new Date();
    const soon = new Date(now); soon.setDate(now.getDate() + 3);
    const vouchersSnap = await db.collection("vouchers")
      .where("ownerId", "==", ownerId)
      .where("status", "==", "active")
      .get();
    vouchersSnap.forEach(doc => {
      const v = doc.data();
      if (v.expiresAt && new Date(v.expiresAt) <= soon) {
        notifications.push({
          type: "voucher_expiry",
          message: `Voucher ${v.code} is expiring soon (${v.expiresAt.slice(0,10)}).`,
          date: v.expiresAt,
          read: false,
        });
      }
    });
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ notifications: [] });
  }
});

module.exports = router;
