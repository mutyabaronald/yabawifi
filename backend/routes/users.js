const express = require("express");
const router = express.Router();
const { db } = require("../firebase");

// User authentication endpoint - Optimized for performance
router.post("/auth", async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        error: "Phone number and password are required",
      });
    }

    // Optimize: Use direct document access instead of query (much faster)
    let userDoc, userData;

    try {
      // Try direct document access first (phone as document ID)
      userDoc = await db.collection("users").doc(phone).get();
      if (userDoc.exists) {
        userData = userDoc.data();
      } else {
        userDoc = null;
        userData = null;
      }
    } catch (err) {
      userDoc = null;
      userData = null;
    }

    // Fallback to query if direct access failed
    if (!userDoc || !userDoc.exists) {
      const userQuery = db
        .collection("users")
        .where("phone", "==", phone)
        .limit(1);
      const snapshot = await userQuery.get();

      if (snapshot.empty) {
        // Register new user - use phone as document ID for faster future lookups
        await db.collection("users").doc(phone).set({
          phone,
          password,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        return res.json({
          success: true,
          isNewUser: true,
          message: "Account created successfully",
        });
      } else {
        userDoc = snapshot.docs[0];
        userData = userDoc.data();
      }
    }

    // Check if this is an auto-created user (no password set yet)
    if (!userData.password || userData.password === "") {
      // This is an auto-created user from payment/voucher, set their password
      await db.collection("users").doc(phone).update({
        phone,
        password,
        updatedAt: new Date().toISOString(),
        passwordSetAt: new Date().toISOString(),
      });

      return res.json({
        success: true,
        isNewUser: true,
        message: "Password set successfully",
      });
    } else if (userData.password !== password) {
      return res.status(401).json({
        success: false,
        error: "Incorrect password",
      });
    }

    // Valid existing user
    return res.json({
      success: true,
      isNewUser: false,
      message: "Login successful",
    });
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(500).json({
      success: false,
      error: "Authentication failed. Please try again.",
    });
  }
});

// Get user transactions
router.get("/:phone/transactions", async (req, res) => {
  try {
    const { phone } = req.params;

    // Get all receipts (purchases and vouchers)
    const receiptsSnap = await db
      .collection("receipts")
      .where("phone", "==", phone)
      .orderBy("time", "desc")
      .limit(50)
      .get();

    let transactions = receiptsSnap.docs.map((d) => {
      const data = d.data();
      // Determine transaction type based on payment method
      let type = "purchase";
      if (data.paymentMethod === "voucher") {
        type = "voucher";
      } else if (data.paymentMethod === "points") {
        type = "points";
      }

      return {
        id: d.id,
        type,
        packageName: data.packageName,
        amount: data.amount || 0,
        time: data.time,
        createdAt: data.time, // For compatibility
        status: data.status || "completed",
        ownerId: data.ownerId,
        hotspotName: data.hotspotName,
        voucherCode: data.voucherCode,
        loyaltyPointsEarned: data.loyaltyPointsEarned,
        originalPrice: data.packageValue || data.amount, // For calculating savings
        ...data,
      };
    });

    // Get loyalty points transactions
    try {
      const loyaltySnap = await db
        .collection("hotspot_loyalty_transactions")
        .where("userPhone", "==", phone)
        .orderBy("createdAt", "desc")
        .limit(20)
        .get();

      const loyaltyTransactions = loyaltySnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          type: "points",
          packageName: data.packageName || "WiFi Access",
          amount: 0, // Free when using points
          time: data.createdAt,
          createdAt: data.createdAt,
          status: "completed",
          ownerId: data.ownerId,
          hotspotName: data.hotspotName,
          pointsUsed: data.pointsUsed,
          loyaltyPointsEarned: data.pointsEarned,
          originalPrice: data.originalPrice || 0,
          ...data,
        };
      });

      // Merge and sort all transactions by time
      transactions = [...transactions, ...loyaltyTransactions]
        .sort(
          (a, b) =>
            new Date(b.time || b.createdAt) - new Date(a.time || a.createdAt)
        )
        .slice(0, 50);
    } catch (err) {
      console.warn("Failed to fetch loyalty transactions:", err);
      // Continue with just receipts if loyalty fails
    }

    res.json(transactions);
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// Get user active packages with session management
router.get("/:phone/active-packages", async (req, res) => {
  try {
    const { phone } = req.params;

    // Get active WiFi sessions for this user
    const sessionsSnap = await db
      .collection("wifi_sessions")
      .where("userPhone", "==", phone)
      .where("status", "in", ["active", "connected"])
      .get();

    const activeSessions = sessionsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Get package details for active sessions
    const activePackages = [];
    for (const session of activeSessions) {
      if (session.packageId) {
        try {
          const packageDoc = await db
            .collection("packages")
            .doc(session.packageId)
            .get();
          if (packageDoc.exists) {
            const packageData = packageDoc.data();
            const timeRemaining = calculateTimeRemaining(
              session.startTime,
              packageData.timeLimitMinutes
            );
            const dataRemaining = calculateDataRemaining(
              session.dataUsed,
              packageData.dataLimitMB
            );

            activePackages.push({
              id: session.packageId,
              packageName: packageData.name,
              hotspotId: session.hotspotId,
              hotspotName: session.hotspotName,
              startTime: session.startTime,
              remaining: timeRemaining,
              dataUsed: session.dataUsed || 0,
              dataLimit: packageData.dataLimitMB,
              expiresAt: session.expiresAt,
              status:
                timeRemaining > 0 && dataRemaining > 0 ? "active" : "expired",
            });
          }
        } catch (err) {
          console.error(`Error fetching package ${session.packageId}:`, err);
        }
      }
    }

    res.json(activePackages);
  } catch (error) {
    console.error("Error fetching active packages:", error);
    res.status(500).json({ error: "Failed to fetch active packages" });
  }
});

// Check if user has active session at a specific hotspot
router.get("/:phone/session-status/:hotspotId", async (req, res) => {
  try {
    const { phone, hotspotId } = req.params;

    // Check for active session at this hotspot
    const sessionSnap = await db
      .collection("wifi_sessions")
      .where("userPhone", "==", phone)
      .where("hotspotId", "==", hotspotId)
      .where("status", "in", ["active", "connected"])
      .limit(1)
      .get();

    if (sessionSnap.empty) {
      return res.json({ hasActiveSession: false });
    }

    const session = sessionSnap.docs[0].data();
    const packageDoc = await db
      .collection("packages")
      .doc(session.packageId)
      .get();

    if (!packageDoc.exists) {
      return res.json({ hasActiveSession: false });
    }

    const packageData = packageDoc.data();
    const timeRemaining = calculateTimeRemaining(
      session.startTime,
      packageData.timeLimitMinutes
    );
    const dataRemaining = calculateDataRemaining(
      session.dataUsed,
      packageData.dataLimitMB
    );

    if (timeRemaining <= 0 || dataRemaining <= 0) {
      // Session expired, update status
      await db.collection("wifi_sessions").doc(sessionSnap.docs[0].id).update({
        status: "expired",
        updatedAt: new Date().toISOString(),
      });
      return res.json({ hasActiveSession: false });
    }

    res.json({
      hasActiveSession: true,
      session: {
        id: sessionSnap.docs[0].id,
        packageName: packageData.name,
        timeRemaining,
        dataRemaining,
        startTime: session.startTime,
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    console.error("Error checking session status:", error);
    res.status(500).json({ error: "Failed to check session status" });
  }
});

// Create or resume WiFi session
router.post("/:phone/sessions", async (req, res) => {
  try {
    const { phone } = req.params;
    const {
      hotspotId,
      hotspotName,
      packageId,
      packageName,
      paymentMethod,
      paymentReference,
    } = req.body;

    if (!hotspotId || !packageId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Check if user already has an active session at this hotspot
    const existingSessionSnap = await db
      .collection("wifi_sessions")
      .where("userPhone", "==", phone)
      .where("hotspotId", "==", hotspotId)
      .where("status", "in", ["active", "connected"])
      .limit(1)
      .get();

    if (!existingSessionSnap.empty) {
      const existingSession = existingSessionSnap.docs[0];
      const sessionData = existingSession.data();

      // Check if existing session is still valid
      const packageDoc = await db
        .collection("packages")
        .doc(sessionData.packageId)
        .get();
      if (packageDoc.exists) {
        const packageData = packageDoc.data();
        const timeRemaining = calculateTimeRemaining(
          sessionData.startTime,
          packageData.timeLimitMinutes
        );
        const dataRemaining = calculateDataRemaining(
          sessionData.dataUsed,
          packageData.dataLimitMB
        );

        if (timeRemaining > 0 && dataRemaining > 0) {
          // Resume existing session
          await existingSession.ref.update({
            status: "connected",
            lastConnected: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          return res.json({
            success: true,
            action: "resumed",
            sessionId: existingSession.id,
            message: "Resumed existing WiFi session",
          });
        }
      }
    }

    // Get package details to calculate expiration
    const packageDoc = await db.collection("packages").doc(packageId).get();
    if (!packageDoc.exists) {
      return res.status(404).json({ error: "Package not found" });
    }

    const packageData = packageDoc.data();
    const startTime = new Date();
    const expiresAt = new Date(
      startTime.getTime() + packageData.timeLimitMinutes * 60 * 1000
    );

    // Create new session
    const sessionRef = await db.collection("wifi_sessions").add({
      userPhone: phone,
      hotspotId,
      hotspotName,
      packageId,
      packageName,
      paymentMethod: paymentMethod || "unknown",
      paymentReference: paymentReference || null,
      startTime: startTime.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "active",
      dataUsed: 0,
      createdAt: startTime.toISOString(),
      updatedAt: startTime.toISOString(),
    });

    res.json({
      success: true,
      action: "created",
      sessionId: sessionRef.id,
      message: "New WiFi session created",
    });
  } catch (error) {
    console.error("Error creating WiFi session:", error);
    res.status(500).json({ error: "Failed to create WiFi session" });
  }
});

// Update session data usage
router.put("/:phone/sessions/:sessionId/usage", async (req, res) => {
  try {
    const { phone, sessionId } = req.params;
    const { dataUsed } = req.body;

    if (typeof dataUsed !== "number" || dataUsed < 0) {
      return res.status(400).json({ error: "Invalid data usage amount" });
    }

    const sessionRef = db.collection("wifi_sessions").doc(sessionId);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return res.status(404).json({ error: "Session not found" });
    }

    const sessionData = sessionDoc.data();
    if (sessionData.userPhone !== phone) {
      return res.status(403).json({ error: "Unauthorized access to session" });
    }

    await sessionRef.update({
      dataUsed,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, dataUsed });
  } catch (error) {
    console.error("Error updating session usage:", error);
    res.status(500).json({ error: "Failed to update session usage" });
  }
});

// Disconnect from WiFi session
router.put("/:phone/sessions/:sessionId/disconnect", async (req, res) => {
  try {
    const { phone, sessionId } = req.params;

    const sessionRef = db.collection("wifi_sessions").doc(sessionId);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return res.status(404).json({ error: "Session not found" });
    }

    const sessionData = sessionDoc.data();
    if (sessionData.userPhone !== phone) {
      return res.status(403).json({ error: "Unauthorized access to session" });
    }

    await sessionRef.update({
      status: "disconnected",
      disconnectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, message: "Session disconnected" });
  } catch (error) {
    console.error("Error disconnecting session:", error);
    res.status(500).json({ error: "Failed to disconnect session" });
  }
});

// Get user loyalty points for a specific hotspot
router.get("/:phone/loyalty/:hotspotId", async (req, res) => {
  try {
    const { phone, hotspotId } = req.params;

    // Get loyalty record for this user at this specific hotspot
    const loyaltyRef = db
      .collection("hotspot_loyalty")
      .doc(`${phone}_${hotspotId}`);
    const doc = await loyaltyRef.get();

    if (!doc.exists) {
      // Create new loyalty record if none exists
      const newRecord = {
        userPhone: phone,
        hotspotId: hotspotId,
        points: 0,
        totalEarned: 0,
        totalRedeemed: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await loyaltyRef.set(newRecord);
      return res.json(newRecord);
    }

    res.json(doc.data());
  } catch (error) {
    console.error("Error fetching loyalty points:", error);
    res.status(500).json({ error: "Failed to fetch loyalty points" });
  }
});

// Award loyalty points for a specific hotspot
router.post("/:phone/loyalty/:hotspotId/award", async (req, res) => {
  try {
    const { phone, hotspotId } = req.params;
    const { points, reason, packageName, packagePrice } = req.body;

    if (!points || points <= 0) {
      return res.status(400).json({ error: "Invalid points amount" });
    }

    const loyaltyRef = db
      .collection("hotspot_loyalty")
      .doc(`${phone}_${hotspotId}`);

    const result = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(loyaltyRef);

      let currentData;
      if (!doc.exists) {
        currentData = {
          userPhone: phone,
          hotspotId: hotspotId,
          points: 0,
          totalEarned: 0,
          totalRedeemed: 0,
          createdAt: new Date().toISOString(),
        };
      } else {
        currentData = doc.data();
      }

      const newData = {
        ...currentData,
        points: (currentData.points || 0) + points,
        totalEarned: (currentData.totalEarned || 0) + points,
        updatedAt: new Date().toISOString(),
      };

      transaction.set(loyaltyRef, newData);

      // Log the loyalty transaction
      transaction.set(db.collection("hotspot_loyalty_transactions").doc(), {
        userPhone: phone,
        hotspotId: hotspotId,
        type: "earned",
        points: points,
        reason: reason || "WiFi package purchase",
        packageName: packageName || null,
        packagePrice: packagePrice || null,
        timestamp: new Date().toISOString(),
      });

      return { newBalance: newData.points };
    });

    res.json({
      success: true,
      pointsAwarded: points,
      newBalance: result.newBalance,
      hotspotId: hotspotId,
    });
  } catch (error) {
    console.error("Error awarding loyalty points:", error);
    res.status(500).json({ error: "Failed to award points" });
  }
});

// Redeem loyalty points for a specific hotspot
router.post("/:phone/loyalty/:hotspotId/redeem", async (req, res) => {
  try {
    const { phone, hotspotId } = req.params;
    const { rewardPackageId } = req.body;

    if (!rewardPackageId) {
      return res.status(400).json({ error: "Reward package ID is required" });
    }

    // Get the loyalty reward package details
    const rewardPackageDoc = await db
      .collection("packages")
      .doc(rewardPackageId)
      .get();
    if (!rewardPackageDoc.exists) {
      return res
        .status(404)
        .json({ error: "Loyalty reward package not found" });
    }

    const rewardPackage = rewardPackageDoc.data();

    // Verify this is a loyalty reward package
    if (rewardPackage.type !== "loyalty_reward") {
      return res
        .status(400)
        .json({ error: "Invalid package type for loyalty redemption" });
    }

    // Verify the package belongs to the hotspot owner
    const hotspotDoc = await db.collection("hotspots").doc(hotspotId).get();
    if (!hotspotDoc.exists) {
      return res.status(404).json({ error: "Hotspot not found" });
    }

    const hotspotData = hotspotDoc.data();
    if (rewardPackage.ownerId !== hotspotData.ownerId) {
      return res
        .status(403)
        .json({
          error: "Loyalty reward package does not belong to this hotspot",
        });
    }

    const pointsRequired = rewardPackage.pointsRequired;
    const rewardName = rewardPackage.name;
    const rewardType = rewardPackage.rewardType;
    const rewardValue = rewardPackage.rewardValue;

    const loyaltyRef = db
      .collection("hotspot_loyalty")
      .doc(`${phone}_${hotspotId}`);

    const result = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(loyaltyRef);

      if (!doc.exists) {
        throw new Error("User loyalty record not found for this hotspot");
      }

      const currentData = doc.data();
      const currentPoints = currentData.points || 0;

      if (currentPoints < pointsRequired) {
        throw new Error(
          `Insufficient loyalty points. You need ${pointsRequired} points but have ${currentPoints}`
        );
      }

      const newData = {
        ...currentData,
        points: currentPoints - pointsRequired,
        totalRedeemed: (currentData.totalRedeemed || 0) + pointsRequired,
        lastRedeemed: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      transaction.set(loyaltyRef, newData);

      // Log the loyalty transaction
      transaction.set(db.collection("hotspot_loyalty_transactions").doc(), {
        userPhone: phone,
        hotspotId: hotspotId,
        type: "redeemed",
        points: -pointsRequired,
        packageName: rewardName,
        packageValue: 0,
        rewardType: rewardType,
        rewardValue: rewardValue,
        timestamp: new Date().toISOString(),
      });

      // Create a transaction record for the free package
      transaction.set(db.collection("receipts").doc(), {
        phone,
        amount: 0,
        packageName: rewardName,
        paymentMethod: "loyalty_points",
        pointsUsed: pointsRequired,
        hotspotId: hotspotId,
        rewardType: rewardType,
        rewardValue: rewardValue,
        status: "Success",
        time: new Date().toISOString(),
        ownerId: hotspotData.ownerId,
      });

      return {
        newBalance: newData.points,
        rewardDetails: {
          name: rewardName,
          type: rewardType,
          value: rewardValue,
          pointsUsed: pointsRequired,
        },
      };
    });

    res.json({
      success: true,
      pointsRedeemed: pointsRequired,
      newBalance: result.newBalance,
      hotspotId: hotspotId,
      reward: result.rewardDetails,
      message: `Successfully redeemed ${pointsRequired} points for ${rewardName}!`,
    });
  } catch (error) {
    console.error("Error redeeming points:", error);
    const message = error.message || "Failed to redeem points";
    res.status(400).json({ error: message });
  }
});

// Get all loyalty balances for a user across all hotspots
router.get("/:phone/loyalty", async (req, res) => {
  try {
    const { phone } = req.params;

    // Get all loyalty records for this user across all hotspots
    const loyaltySnap = await db
      .collection("hotspot_loyalty")
      .where("userPhone", "==", phone)
      .get();

    const loyaltyBalances = loyaltySnap.docs.map((doc) => {
      const data = doc.data();
      return {
        hotspotId: data.hotspotId,
        points: data.points || 0,
        totalEarned: data.totalEarned || 0,
        totalRedeemed: data.totalRedeemed || 0,
        lastEarned: data.lastEarned,
        lastRedeemed: data.lastRedeemed,
        updatedAt: data.updatedAt,
      };
    });

    res.json(loyaltyBalances);
  } catch (error) {
    console.error("Error fetching loyalty balances:", error);
    res.status(500).json({ error: "Failed to fetch loyalty balances" });
  }
});

// Helper functions
function calculateTimeRemaining(startTime, timeLimitMinutes) {
  if (!startTime || !timeLimitMinutes) return 0;

  const start = new Date(startTime);
  const now = new Date();
  const elapsedMinutes = (now - start) / (1000 * 60);
  const remaining = timeLimitMinutes - elapsedMinutes;

  return Math.max(0, Math.floor(remaining));
}

function calculateDataRemaining(dataUsed, dataLimitMB) {
  if (!dataLimitMB) return Infinity; // Unlimited data

  const dataUsedMB = dataUsed / (1024 * 1024); // Convert bytes to MB
  const remaining = dataLimitMB - dataUsedMB;

  return Math.max(0, remaining);
}

module.exports = router;
