const express = require("express");
const router = express.Router();
const { db } = require("../firebase");
const axios = require("axios"); // Added axios for external API calls

// Helper function to create or update user account
async function createOrUpdateUser(phone) {
  try {
    // Check if user already exists
    const userQuery = db.collection("users").where("phone", "==", phone);
    const snapshot = await userQuery.get();
    
    if (snapshot.empty) {
      // Create new user account
      await db.collection("users").add({
        phone,
        password: "", // Empty password - user can set it later through login
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: "payment_auto_created"
      });
      console.log(`New user account created for ${phone}`);
    } else {
      // Update existing user's last activity
      const userDoc = snapshot.docs[0];
      await userDoc.ref.update({
        updatedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error("Error creating/updating user account:", error);
    // Don't fail the receipt save if user creation fails
  }
}

router.post("/save", async (req, res) => {
  const { phone, amount, packageName, ownerId } = req.body;

  try {
    const numericAmount = Number(amount) || 0;
    const COMMISSION_PERCENTAGE = 25;
    const commission = Math.round((numericAmount * COMMISSION_PERCENTAGE) / 100);

    // Create or update user account automatically
    await createOrUpdateUser(phone);

    // Save receipt
    const receiptRef = await db.collection("receipts").add({
      phone,
      amount: numericAmount,
      packageName,
      paymentMethod: "Mobile Money",
      ownerId,
      status: "Success",
      time: new Date().toISOString(),
      loyaltyPointsEarned: loyaltyPointsEarned,
    });

    // Award hotspot-specific loyalty points based on package configuration
    let loyaltyPointsEarned = 0;
    if (numericAmount > 0 && ownerId) {
      try {
        loyaltyPointsEarned = await awardHotspotSpecificLoyaltyPoints(phone, ownerId, packageName, numericAmount);
      } catch (err) {
        console.warn("Loyalty points award failed (non-blocking):", err.message);
        // Don't fail the receipt save if loyalty fails
      }
    }

    // Credit wallets: platform receives commission; owner receives net amount
    if (ownerId && numericAmount > 0) {
      const netAmount = numericAmount - commission;
      const ownerWalletRef = db.collection("wallets").doc(ownerId);
      const platformWalletRef = db.collection("wallets").doc("platform");
      await db.runTransaction(async (transaction) => {
        // Owner wallet
        const ownerDoc = await transaction.get(ownerWalletRef);
        let ownerData = { ownerId, balance: 0, transactions: [] };
        if (ownerDoc.exists) ownerData = ownerDoc.data();
        transaction.set(ownerWalletRef, {
          ownerId,
          balance: (ownerData.balance || 0) + netAmount,
          transactions: [
            { type: "credit", amount: netAmount, date: new Date().toISOString(), description: `Package sale: ${packageName}` },
            ...(ownerData.transactions || [])
          ].slice(0, 100)
        }, { merge: true });

        // Platform wallet (commission)
        const platformDoc = await transaction.get(platformWalletRef);
        let platformData = { id: "platform", balance: 0, transactions: [] };
        if (platformDoc.exists) platformData = platformDoc.data();
        transaction.set(platformWalletRef, {
          id: "platform",
          balance: (platformData.balance || 0) + commission,
          transactions: [
            { type: "commission", amount: commission, date: new Date().toISOString(), description: `Commission from ${ownerId} - ${packageName}` },
            ...(platformData.transactions || [])
          ].slice(0, 100)
        }, { merge: true });

        // Record payout split log
        transaction.set(db.collection("payout_splits").doc(), {
          ownerId,
          grossAmount: numericAmount,
          commissionAmount: commission,
          commissionRate: COMMISSION_PERCENTAGE,
          netAmount: netAmount,
          packageName,
          createdAt: new Date().toISOString(),
          status: "recorded"
        });
      });
    }

    // Create WiFi session for the user
    try {
      await createWiFiSession(phone, packageName, ownerId, receiptRef.id);
    } catch (err) {
      console.warn("WiFi session creation failed (non-blocking):", err.message);
      // Don't fail the receipt save if session creation fails
    }

    res.status(200).json({ 
      success: true, 
      message: "Payment successful!",
      receiptId: receiptRef.id,
      packageName,
      packagePrice: numericAmount,
      hotspotId: ownerId,
      shouldShowReview: true
    });
  } catch (error) {
    console.error("Error saving receipt:", error);
    res.status(500).json({ error: "Failed to save receipt" });
  }
});

// Helper function to award hotspot-specific loyalty points
async function awardHotspotSpecificLoyaltyPoints(phone, ownerId, packageName, amount) {
  try {
    // Get package details to check loyalty configuration
    const packagesSnap = await db.collection("packages")
      .where("ownerId", "==", ownerId)
      .where("name", "==", packageName)
      .limit(1)
      .get();
    
    if (packagesSnap.empty) {
      console.warn(`Package not found: ${packageName} for owner ${ownerId}`);
      return;
    }
    
    const packageDoc = packagesSnap.docs[0];
    const packageData = packageDoc.data();
    
    // Check if loyalty is enabled for this package
    if (!packageData.loyaltyEnabled) {
      console.log(`Loyalty not enabled for package: ${packageName}`);
      return;
    }
    
    // Calculate points based on package configuration
    let totalPoints = 0;
    
    // Points per package purchase
    if (packageData.loyaltyPointsPerPackage > 0) {
      totalPoints += packageData.loyaltyPointsPerPackage;
    }
    
    // Points per 1000 UGX spent
    if (packageData.loyaltyPointsPer1000UGX > 0) {
      const pointsFromAmount = Math.floor(amount / 1000) * packageData.loyaltyPointsPer1000UGX;
      totalPoints += pointsFromAmount;
    }
    
    if (totalPoints <= 0) {
      console.log(`No loyalty points to award for package: ${packageName}`);
      return;
    }
    
    // Get hotspot info for this owner
    const hotspotsSnap = await db.collection("hotspots")
      .where("ownerId", "==", ownerId)
      .limit(1)
      .get();
    
    let hotspotId = null;
    let hotspotName = "WiFi Hotspot";
    
    if (!hotspotsSnap.empty) {
      const hotspotData = hotspotsSnap.docs[0].data();
      hotspotId = hotspotsSnap.docs[0].id;
      hotspotName = hotspotData.hotspotName || hotspotData.name || "WiFi Hotspot";
    }
    
    if (!hotspotId) {
      console.warn(`No hotspot found for owner: ${ownerId}`);
      return;
    }
    
    // Award points to this specific hotspot
    const response = await axios.post(`/api/users/${phone}/loyalty/${hotspotId}/award`, {
      points: totalPoints,
      reason: `WiFi package purchase: ${packageName}`,
      packageName: packageName,
      packagePrice: amount
    });
    
    if (response.data.success) {
      console.log(`Awarded ${totalPoints} loyalty points to ${phone} at hotspot ${hotspotName}`);
      return totalPoints;
    }
    
    return 0;
    
  } catch (error) {
    console.error("Error awarding hotspot-specific loyalty points:", error);
    return 0; // Return 0 if there's an error
  }
}

// Helper function to create WiFi session
async function createWiFiSession(phone, packageName, ownerId, receiptId) {
  try {
    // Get package details
    const packagesSnap = await db.collection("packages")
      .where("ownerId", "==", ownerId)
      .where("name", "==", packageName)
      .limit(1)
      .get();
    
    if (packagesSnap.empty) {
      console.warn(`Package not found: ${packageName} for owner ${ownerId}`);
      return;
    }
    
    const packageDoc = packagesSnap.docs[0];
    const packageData = packageDoc.data();
    
    // Get hotspot info for this owner
    const hotspotsSnap = await db.collection("hotspots")
      .where("ownerId", "==", ownerId)
      .limit(1)
      .get();
    
    let hotspotId = null;
    let hotspotName = "WiFi Hotspot";
    
    if (!hotspotsSnap.empty) {
      const hotspotData = hotspotsSnap.docs[0].data();
      hotspotId = hotspotsSnap.docs[0].id;
      hotspotName = hotspotData.hotspotName || hotspotData.name || "WiFi Hotspot";
    }
    
    // Check if user already has an active session at this hotspot
    if (hotspotId) {
      const existingSessionSnap = await db.collection("wifi_sessions")
        .where("userPhone", "==", phone)
        .where("hotspotId", "==", hotspotId)
        .where("status", "in", ["active", "connected"])
        .limit(1)
        .get();
      
      if (!existingSessionSnap.empty) {
        // Resume existing session
        const existingSession = existingSessionSnap.docs[0];
        await existingSession.ref.update({
          status: "connected",
          lastConnected: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        return;
      }
    }
    
    // Create new session
    const startTime = new Date();
    const expiresAt = new Date(startTime.getTime() + (packageData.timeLimitMinutes * 60 * 1000));
    
    await db.collection("wifi_sessions").add({
      userPhone: phone,
      hotspotId: hotspotId || null,
      hotspotName,
      packageId: packageDoc.id,
      packageName,
      paymentMethod: "Mobile Money",
      paymentReference: receiptId,
      startTime: startTime.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "active",
      dataUsed: 0,
      createdAt: startTime.toISOString(),
      updatedAt: startTime.toISOString()
    });
    
    console.log(`WiFi session created for ${phone} at ${hotspotName}`);
  } catch (error) {
    console.error("Error creating WiFi session:", error);
    throw error;
  }
}

module.exports = router;

// List receipts by owner (basic endpoint for stats)
router.get("/owner/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { from, to, range } = req.query;

    let fromIso = from;
    let toIso = to;
    if (!fromIso || !toIso) {
      const now = new Date();
      let start = new Date(now);
      if (range === "today") {
        start.setHours(0, 0, 0, 0);
      } else if (range === "yesterday") {
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setHours(23, 59, 59, 999);
        fromIso = start.toISOString();
        toIso = end.toISOString();
      } else if (range === "30d") {
        start.setDate(start.getDate() - 30);
      } else {
        // default 7d
        start.setDate(start.getDate() - 7);
      }
      if (!fromIso) fromIso = start.toISOString();
      if (!toIso) toIso = now.toISOString();
    }

    let q = db.collection("receipts").where("ownerId", "==", ownerId);
    if (fromIso) q = q.where("time", ">=", fromIso);
    if (toIso) q = q.where("time", "<=", toIso);

    const snap = await q.get();
    const receipts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ receipts, from: fromIso, to: toIso });
  } catch (e) {
    console.error("list receipts error", e);
    res.status(500).json({ receipts: [] });
  }
});
