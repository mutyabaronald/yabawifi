const express = require("express");
const router = express.Router();
const { db } = require("../firebase");

// Get admin notifications (for hotspot owners)
router.get("/admin/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { limit = 50 } = req.query;

    const notificationsSnapshot = await db
      .collection("admin_notifications")
      .where("ownerId", "==", ownerId)
      .orderBy("createdAt", "desc")
      .limit(parseInt(limit))
      .get();

    const notifications = [];
    notificationsSnapshot.forEach(doc => {
      notifications.push({ id: doc.id, ...doc.data() });
    });

    res.json({
      success: true,
      notifications
    });
  } catch (error) {
    console.error("Error fetching admin notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications"
    });
  }
});

// Get user notifications
router.get("/user/:userPhone", async (req, res) => {
  try {
    const { userPhone } = req.params;
    const { limit = 50 } = req.query;

    const notificationsSnapshot = await db
      .collection("user_notifications")
      .where("userPhone", "==", userPhone)
      .orderBy("createdAt", "desc")
      .limit(parseInt(limit))
      .get();

    const notifications = [];
    notificationsSnapshot.forEach(doc => {
      notifications.push({ id: doc.id, ...doc.data() });
    });

    res.json({
      success: true,
      notifications
    });
  } catch (error) {
    console.error("Error fetching user notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications"
    });
  }
});

// Mark admin notification as read
router.put("/admin/:notificationId/read", async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { ownerId } = req.body;

    if (!ownerId) {
      return res.status(400).json({
        success: false,
        message: "Owner ID required"
      });
    }

    // Verify ownership
    const notificationRef = db.collection("admin_notifications").doc(notificationId);
    const notificationDoc = await notificationRef.get();

    if (!notificationDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    const notificationData = notificationDoc.data();
    if (notificationData.ownerId !== ownerId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    // Mark as read
    await notificationRef.update({
      isRead: true,
      readAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: "Notification marked as read"
    });
  } catch (error) {
    console.error("Error marking admin notification as read:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read"
    });
  }
});

// Mark user notification as read
router.put("/user/:notificationId/read", async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { userPhone } = req.body;

    if (!userPhone) {
      return res.status(400).json({
        success: false,
        message: "User phone required"
      });
    }

    // Verify ownership
    const notificationRef = db.collection("user_notifications").doc(notificationId);
    const notificationDoc = await notificationRef.get();

    if (!notificationDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    const notificationData = notificationDoc.data();
    if (notificationData.userPhone !== userPhone) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    // Mark as read
    await notificationRef.update({
      isRead: true,
      readAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: "Notification marked as read"
    });
  } catch (error) {
    console.error("Error marking user notification as read:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read"
    });
  }
});

// Mark all admin notifications as read
router.put("/admin/:ownerId/read-all", async (req, res) => {
  try {
    const { ownerId } = req.params;

    const notificationsSnapshot = await db
      .collection("admin_notifications")
      .where("ownerId", "==", ownerId)
      .where("isRead", "==", false)
      .get();

    const batch = db.batch();
    notificationsSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        isRead: true,
        readAt: new Date().toISOString()
      });
    });

    await batch.commit();

    res.json({
      success: true,
      message: `Marked ${notificationsSnapshot.size} notifications as read`
    });
  } catch (error) {
    console.error("Error marking all admin notifications as read:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read"
    });
  }
});

// Mark all user notifications as read
router.put("/user/:userPhone/read-all", async (req, res) => {
  try {
    const { userPhone } = req.params;

    const notificationsSnapshot = await db
      .collection("user_notifications")
      .where("userPhone", "==", userPhone)
      .where("isRead", "==", false)
      .get();

    const batch = db.batch();
    notificationsSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        isRead: true,
        readAt: new Date().toISOString()
      });
    });

    await batch.commit();

    res.json({
      success: true,
      message: `Marked ${notificationsSnapshot.size} notifications as read`
    });
  } catch (error) {
    console.error("Error marking all user notifications as read:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read"
    });
  }
});

// Delete admin notification
router.delete("/admin/:notificationId", async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { ownerId } = req.query;

    if (!ownerId) {
      return res.status(400).json({
        success: false,
        message: "Owner ID required"
      });
    }

    // Verify ownership
    const notificationRef = db.collection("admin_notifications").doc(notificationId);
    const notificationDoc = await notificationRef.get();

    if (!notificationDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    const notificationData = notificationDoc.data();
    if (notificationData.ownerId !== ownerId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    // Delete notification
    await notificationRef.delete();

    res.json({
      success: true,
      message: "Notification deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting admin notification:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete notification"
    });
  }
});

// Delete user notification
router.delete("/user/:notificationId", async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { userPhone } = req.query;

    if (!userPhone) {
      return res.status(400).json({
        success: false,
        message: "User phone required"
      });
    }

    // Verify ownership
    const notificationRef = db.collection("user_notifications").doc(notificationId);
    const notificationDoc = await notificationRef.get();

    if (!notificationDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    const notificationData = notificationDoc.data();
    if (notificationData.userPhone !== userPhone) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    // Delete notification
    await notificationRef.delete();

    res.json({
      success: true,
      message: "Notification deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting user notification:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete notification"
    });
  }
});

// Get unread notification counts
router.get("/counts/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { type } = req.query; // 'admin' or 'user'

    let collectionName, fieldName;
    if (type === 'admin') {
      collectionName = 'admin_notifications';
      fieldName = 'ownerId';
    } else {
      collectionName = 'user_notifications';
      fieldName = 'userPhone';
    }

    const unreadSnapshot = await db
      .collection(collectionName)
      .where(fieldName, "==", userId)
      .where("isRead", "==", false)
      .get();

    res.json({
      success: true,
      unreadCount: unreadSnapshot.size
    });
  } catch (error) {
    console.error("Error fetching notification counts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification counts"
    });
  }
});

module.exports = router;
