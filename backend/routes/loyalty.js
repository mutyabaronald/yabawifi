const express = require("express");
const router = express.Router();
const { db } = require("../firebase");

// Get user loyalty data for a specific hotspot
router.get("/users/:phone/loyalty/:hotspotId", async (req, res) => {
  try {
    const { phone, hotspotId } = req.params;
    
    // Get user's loyalty data for this hotspot
    const loyaltySnap = await db.collection("hotspot_loyalty")
      .where("hotspotId", "==", hotspotId)
      .where("userPhone", "==", phone)
      .limit(1)
      .get();

    let loyaltyData = {
      availablePoints: 0,
      totalEarned: 0,
      totalSpent: 0,
      memberTier: 'Bronze',
      progressToNext: 0,
      pointsNeeded: 0,
      nextTier: 'Silver'
    };

    if (!loyaltySnap.empty) {
      const doc = loyaltySnap.docs[0];
      const data = doc.data();
      
      loyaltyData = {
        availablePoints: data.availablePoints || 0,
        totalEarned: data.totalEarned || 0,
        totalSpent: data.totalSpent || 0,
        memberTier: data.memberTier || 'Bronze',
        progressToNext: data.progressToNext || 0,
        pointsNeeded: data.pointsNeeded || 0,
        nextTier: data.nextTier || 'Silver'
      };
    }

    // Calculate tier progression
    const tiers = ['Bronze', 'Silver', 'Gold', 'Platinum'];
    const currentTierIndex = tiers.indexOf(loyaltyData.memberTier);
    const nextTier = tiers[currentTierIndex + 1] || 'Platinum';
    
    // Calculate points needed for next tier
    const tierThresholds = { 'Bronze': 0, 'Silver': 500, 'Gold': 1500, 'Platinum': 3000 };
    const currentThreshold = tierThresholds[loyaltyData.memberTier];
    const nextThreshold = tierThresholds[nextTier];
    const pointsNeeded = nextThreshold - loyaltyData.availablePoints;
    
    // Calculate progress percentage
    const progressToNext = nextThreshold > 0 ? 
      Math.min(((loyaltyData.availablePoints - currentThreshold) / (nextThreshold - currentThreshold)) * 100, 100) : 0;

    loyaltyData.pointsNeeded = Math.max(0, pointsNeeded);
    loyaltyData.progressToNext = Math.max(0, progressToNext);
    loyaltyData.nextTier = nextTier;

    res.json(loyaltyData);
  } catch (error) {
    console.error("Error fetching user loyalty data:", error);
    res.status(500).json({ error: "Failed to fetch loyalty data" });
  }
});

// Get rewards for a specific hotspot (for user dashboard)
router.get("/hotspots/:hotspotId/rewards", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    
    // Get rewards configured for this hotspot
    const rewardsSnap = await db.collection("loyalty_rewards")
      .where("hotspotId", "==", hotspotId)
      .where("status", "==", "active")
      .orderBy("pointsRequired", "asc")
      .get();

    const rewards = rewardsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // If no custom rewards, provide default ones
    if (rewards.length === 0) {
      const defaultRewards = [
        {
          id: 'default-1',
          title: 'Free 1 Hour Access',
          value: '1000',
          pointsRequired: 100,
          icon: '⏰',
          status: 'active'
        },
        {
          id: 'default-2',
          title: 'Free Daily Package',
          value: '5000',
          pointsRequired: 500,
          icon: '📅',
          status: 'active'
        },
        {
          id: 'default-3',
          title: 'Free Weekly Package',
          value: '25000',
          pointsRequired: 2500,
          icon: '📆',
          status: 'active'
        }
      ];
      
      res.json({ rewards: defaultRewards });
    } else {
      res.json({ rewards });
    }
  } catch (error) {
    console.error("Error fetching rewards:", error);
    res.status(500).json({ error: "Failed to fetch rewards" });
  }
});

// Get earning methods for a specific hotspot (for user dashboard)
router.get("/hotspots/:hotspotId/earning-methods", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    
    // Get earning methods configured for this hotspot
    const methodsSnap = await db.collection("loyalty_earning_methods")
      .where("hotspotId", "==", hotspotId)
      .where("status", "==", "active")
      .get();

    let methods = methodsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // If no custom methods, provide default ones with dynamic descriptions
    if (methods.length === 0) {
      // Get hotspot info to check if loyalty is configured
      const hotspotSnap = await db.collection("hotspots")
        .doc(hotspotId)
        .get();
      
      let defaultPoints = {
        purchase: 10,
        referral: 50,
        daily_login: 5,
        review: 10
      };
      
      if (hotspotSnap.exists) {
        const hotspotData = hotspotSnap.data();
        // Use owner-configured points if available
        if (hotspotData.loyaltyConfig) {
          defaultPoints = {
            ...defaultPoints,
            ...hotspotData.loyaltyConfig.defaultPoints
          };
        }
      }
      
      methods = [
        {
          id: 'default-1',
          title: 'Purchase Packages',
          description: `Earn ${defaultPoints.purchase} points per 1000 UGX spent`,
          points: defaultPoints.purchase,
          icon: '📦',
          type: 'purchase',
          status: 'active'
        },
        {
          id: 'default-2',
          title: 'Refer Friends',
          description: `Get ${defaultPoints.referral} points per successful referral`,
          points: defaultPoints.referral,
          icon: '👥',
          type: 'referral',
          status: 'active'
        },
        {
          id: 'default-3',
          title: 'Daily Login',
          description: `Earn ${defaultPoints.daily_login} points for daily app usage`,
          points: defaultPoints.daily_login,
          icon: '🎯',
          type: 'daily_login',
          status: 'active'
        },
        {
          id: 'default-4',
          title: 'Rate Hotspots',
          description: `Get ${defaultPoints.review} points for each review`,
          points: defaultPoints.review,
          icon: '⭐',
          type: 'review',
          status: 'active'
        }
      ];
    } else {
      // Update descriptions to show actual point values from owner config
      methods = methods.map(method => ({
        ...method,
        description: method.description || `${method.title}: Earn ${method.points} points`
      }));
    }

    res.json({ methods });
  } catch (error) {
    console.error("Error fetching earning methods:", error);
    res.status(500).json({ error: "Failed to fetch earning methods" });
  }
});

// Redeem a reward
router.post("/users/:phone/loyalty/:hotspotId/redeem", async (req, res) => {
  try {
    const { phone, hotspotId } = req.params;
    const { rewardId, pointsRequired } = req.body;

    // Check if user has enough points
    const loyaltySnap = await db.collection("hotspot_loyalty")
      .where("hotspotId", "==", hotspotId)
      .where("userPhone", "==", phone)
      .limit(1)
      .get();

    if (loyaltySnap.empty) {
      return res.status(400).json({ 
        success: false, 
        message: "No loyalty account found for this hotspot" 
      });
    }

    const loyaltyDoc = loyaltySnap.docs[0];
    const loyaltyData = loyaltyDoc.data();

    if (loyaltyData.availablePoints < pointsRequired) {
      return res.status(400).json({ 
        success: false, 
        message: "Not enough points to redeem this reward" 
      });
    }

    // Get reward details
    const rewardSnap = await db.collection("loyalty_rewards").doc(rewardId).get();
    if (!rewardSnap.exists) {
      return res.status(400).json({ 
        success: false, 
        message: "Reward not found" 
      });
    }

    const rewardData = rewardSnap.data();

    // Deduct points and record redemption
    await db.runTransaction(async (transaction) => {
      // Update loyalty points
      transaction.update(loyaltyDoc.ref, {
        availablePoints: loyaltyData.availablePoints - pointsRequired,
        totalSpent: (loyaltyData.totalSpent || 0) + pointsRequired,
        lastUpdated: new Date().toISOString()
      });

      // Record redemption transaction
      transaction.set(db.collection("loyalty_redemptions").doc(), {
        userId: phone,
        hotspotId,
        rewardId,
        rewardTitle: rewardData.title,
        pointsSpent: pointsRequired,
        redeemedAt: new Date().toISOString(),
        status: 'completed'
      });
    });

    res.json({ 
      success: true, 
      message: `Successfully redeemed ${rewardData.title}`,
      remainingPoints: loyaltyData.availablePoints - pointsRequired
    });

  } catch (error) {
    console.error("Error redeeming reward:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to redeem reward" 
    });
  }
});

// Award points to user (for admin use)
router.post("/users/:phone/loyalty/:hotspotId/award", async (req, res) => {
  try {
    const { phone, hotspotId } = req.params;
    const { points, reason, packageName, packagePrice } = req.body;

    if (!points || points <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid points amount" 
      });
    }

    // Get or create loyalty account
    const loyaltySnap = await db.collection("hotspot_loyalty")
      .where("hotspotId", "==", hotspotId)
      .where("userPhone", "==", phone)
      .limit(1)
      .get();

    let loyaltyDoc;
    let loyaltyData = {
      availablePoints: 0,
      totalEarned: 0,
      totalSpent: 0,
      memberTier: 'Bronze',
      lastUpdated: new Date().toISOString()
    };

    if (loyaltySnap.empty) {
      // Create new loyalty account
      loyaltyData = {
        ...loyaltyData,
        hotspotId,
        userPhone: phone,
        createdAt: new Date().toISOString()
      };
      
      loyaltyDoc = await db.collection("hotspot_loyalty").add(loyaltyData);
    } else {
      loyaltyDoc = loyaltySnap.docs[0];
      loyaltyData = loyaltyDoc.data();
    }

    // Calculate new values
    const newAvailablePoints = (loyaltyData.availablePoints || 0) + points;
    const newTotalEarned = (loyaltyData.totalEarned || 0) + points;

    // Update loyalty account
    await loyaltyDoc.update({
      availablePoints: newAvailablePoints,
      totalEarned: newTotalEarned,
      lastUpdated: new Date().toISOString()
    });

    // Record the transaction
    await db.collection("hotspot_loyalty_transactions").add({
      hotspotId,
      userPhone: phone,
      points: points,
      reason: reason || 'Points awarded',
      packageName: packageName || null,
      packagePrice: packagePrice || null,
      type: 'award',
      createdAt: new Date().toISOString()
    });

    res.json({ 
      success: true, 
      message: `Awarded ${points} points to ${phone}`,
      newBalance: newAvailablePoints
    });

  } catch (error) {
    console.error("Error awarding points:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to award points" 
    });
  }
});

// Award points for daily login
router.post("/users/:phone/loyalty/:hotspotId/daily-login", async (req, res) => {
  try {
    const { phone, hotspotId } = req.params;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
    // Check if user already got points for today
    const todayTransaction = await db.collection("hotspot_loyalty_transactions")
      .where("hotspotId", "==", hotspotId)
      .where("userPhone", "==", phone)
      .where("type", "==", "daily_login")
      .where("date", "==", today)
      .limit(1)
      .get();
    
    if (!todayTransaction.empty) {
      return res.json({ 
        success: false, 
        message: "Daily login points already awarded today",
        alreadyAwarded: true
      });
    }
    
    // Get hotspot earning methods to find daily login points
    const methodsSnap = await db.collection("loyalty_earning_methods")
      .where("hotspotId", "==", hotspotId)
      .where("type", "==", "daily_login")
      .where("status", "==", "active")
      .limit(1)
      .get();
    
    if (methodsSnap.empty) {
      return res.json({ 
        success: false, 
        message: "Daily login not configured for this hotspot",
        notConfigured: true
      });
    }
    
    const method = methodsSnap.docs[0].data();
    const points = method.points || 5; // Default 5 points
    
    // Award points using existing award function
    const awardResponse = await db.collection("hotspot_loyalty")
      .where("hotspotId", "==", hotspotId)
      .where("userPhone", "==", phone)
      .limit(1)
      .get();
    
    let loyaltyDoc;
    let loyaltyData = { availablePoints: 0, totalEarned: 0 };
    
    if (awardResponse.empty) {
      // Create new loyalty account
      loyaltyData = {
        hotspotId,
        userPhone: phone,
        availablePoints: points,
        totalEarned: points,
        totalSpent: 0,
        memberTier: 'Bronze',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
      
      loyaltyDoc = await db.collection("hotspot_loyalty").add(loyaltyData);
    } else {
      loyaltyDoc = awardResponse.docs[0];
      loyaltyData = loyaltyDoc.data();
      
      // Update existing account
      await loyaltyDoc.update({
        availablePoints: (loyaltyData.availablePoints || 0) + points,
        totalEarned: (loyaltyData.totalEarned || 0) + points,
        lastUpdated: new Date().toISOString()
      });
    }
    
    // Record the transaction
    await db.collection("hotspot_loyalty_transactions").add({
      hotspotId,
      userPhone: phone,
      points: points,
      reason: 'Daily login bonus',
      type: 'daily_login',
      date: today,
      createdAt: new Date().toISOString()
    });
    
    res.json({ 
      success: true, 
      message: `Awarded ${points} points for daily login`,
      pointsAwarded: points,
      newBalance: (loyaltyData.availablePoints || 0) + points
    });
    
  } catch (error) {
    console.error("Error awarding daily login points:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to award daily login points" 
    });
  }
});

// Award points for referral
router.post("/users/:phone/loyalty/:hotspotId/referral", async (req, res) => {
  try {
    const { phone, hotspotId } = req.params;
    const { referredPhone, referralCode } = req.body;
    
    if (!referredPhone || !referralCode) {
      return res.status(400).json({ 
        success: false, 
        message: "Referral phone and code required" 
      });
    }
    
    // Check if this referral was already processed
    const existingReferral = await db.collection("hotspot_loyalty_transactions")
      .where("hotspotId", "==", hotspotId)
      .where("userPhone", "==", phone)
      .where("type", "==", "referral")
      .where("referredPhone", "==", referredPhone)
      .limit(1)
      .get();
    
    if (!existingReferral.empty) {
      return res.json({ 
        success: false, 
        message: "Referral already processed for this user",
        alreadyProcessed: true
      });
    }
    
    // Get hotspot earning methods to find referral points
    const methodsSnap = await db.collection("loyalty_earning_methods")
      .where("hotspotId", "==", hotspotId)
      .where("type", "==", "referral")
      .where("status", "==", "active")
      .limit(1)
      .get();
    
    if (methodsSnap.empty) {
      return res.json({ 
        success: false, 
        message: "Referral rewards not configured for this hotspot",
        notConfigured: true
      });
    }
    
    const method = methodsSnap.docs[0].data();
    const points = method.points || 50; // Default 50 points
    
    // Award points
    const awardResponse = await db.collection("hotspot_loyalty")
      .where("hotspotId", "==", hotspotId)
      .where("userPhone", "==", phone)
      .limit(1)
      .get();
    
    let loyaltyDoc;
    let loyaltyData = { availablePoints: 0, totalEarned: 0 };
    
    if (awardResponse.empty) {
      // Create new loyalty account
      loyaltyData = {
        hotspotId,
        userPhone: phone,
        availablePoints: points,
        totalEarned: points,
        totalSpent: 0,
        memberTier: 'Bronze',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
      
      loyaltyDoc = await db.collection("hotspot_loyalty").add(loyaltyData);
    } else {
      loyaltyDoc = awardResponse.docs[0];
      loyaltyData = loyaltyDoc.data();
      
      // Update existing account
      await loyaltyDoc.update({
        availablePoints: (loyaltyData.availablePoints || 0) + points,
        totalEarned: (loyaltyData.totalEarned || 0) + points,
        lastUpdated: new Date().toISOString()
      });
    }
    
    // Record the transaction
    await db.collection("hotspot_loyalty_transactions").add({
      hotspotId,
      userPhone: phone,
      points: points,
      reason: `Referral bonus for ${referredPhone}`,
      type: 'referral',
      referredPhone: referredPhone,
      referralCode: referralCode,
      createdAt: new Date().toISOString()
    });
    
    res.json({ 
      success: true, 
      message: `Awarded ${points} points for successful referral`,
      pointsAwarded: points,
      newBalance: (loyaltyData.availablePoints || 0) + points
    });
    
  } catch (error) {
    console.error("Error awarding referral points:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to award referral points" 
    });
  }
});

// Award points for rating/review
router.post("/users/:phone/loyalty/:hotspotId/rating", async (req, res) => {
  try {
    const { phone, hotspotId } = req.params;
    const { rating, review, packageName } = req.body;
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ 
        success: false, 
        message: "Valid rating (1-5) required" 
      });
    }
    
    // Check if user already rated this hotspot today
    const today = new Date().toISOString().split('T')[0];
    const existingRating = await db.collection("hotspot_loyalty_transactions")
      .where("hotspotId", "==", hotspotId)
      .where("userPhone", "==", phone)
      .where("type", "==", "rating")
      .where("date", "==", today)
      .limit(1)
      .get();
    
    if (!existingRating.empty) {
      return res.json({ 
        success: false, 
        message: "Rating already submitted today",
        alreadySubmitted: true
      });
    }
    
    // Get hotspot earning methods to find rating points
    const methodsSnap = await db.collection("loyalty_earning_methods")
      .where("hotspotId", "==", hotspotId)
      .where("type", "==", "review")
      .where("status", "==", "active")
      .limit(1)
      .get();
    
    if (methodsSnap.empty) {
      return res.json({ 
        success: false, 
        message: "Rating rewards not configured for this hotspot",
        notConfigured: true
      });
    }
    
    const method = methodsSnap.docs[0].data();
    const points = method.points || 10; // Default 10 points
    
    // Award points
    const awardResponse = await db.collection("hotspot_loyalty")
      .where("hotspotId", "==", hotspotId)
      .where("userPhone", "==", phone)
      .limit(1)
      .get();
    
    let loyaltyDoc;
    let loyaltyData = { availablePoints: 0, totalEarned: 0 };
    
    if (awardResponse.empty) {
      // Create new loyalty account
      loyaltyData = {
        hotspotId,
        userPhone: phone,
        availablePoints: points,
        totalEarned: points,
        totalSpent: 0,
        memberTier: 'Bronze',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
      
      loyaltyDoc = await db.collection("hotspot_loyalty").add(loyaltyData);
    } else {
      loyaltyDoc = awardResponse.docs[0];
      loyaltyData = loyaltyDoc.data();
      
      // Update existing account
      await loyaltyDoc.update({
        availablePoints: (loyaltyData.availablePoints || 0) + points,
        totalEarned: (loyaltyData.totalEarned || 0) + points,
        lastUpdated: new Date().toISOString()
      });
    }
    
    // Record the transaction
    await db.collection("hotspot_loyalty_transactions").add({
      hotspotId,
      userPhone: phone,
      points: points,
      reason: `Rating bonus (${rating}/5 stars)`,
      type: 'rating',
      rating: rating,
      review: review || null,
      packageName: packageName || null,
      date: today,
      createdAt: new Date().toISOString()
    });
    
    res.json({ 
      success: true, 
      message: `Awarded ${points} points for rating submission`,
      pointsAwarded: points,
      newBalance: (loyaltyData.availablePoints || 0) + points
    });
    
  } catch (error) {
    console.error("Error awarding rating points:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to award rating points" 
    });
  }
});

// Get loyalty statistics for an owner
router.get("/owners/:ownerId/stats", async (req, res) => {
  try {
    const { ownerId } = req.params;
    
    // Get all hotspots for this owner
    const hotspotsSnap = await db.collection("hotspots")
      .where("ownerId", "==", ownerId)
      .get();
    
    const hotspotIds = hotspotsSnap.docs.map(doc => doc.id);
    
    if (hotspotIds.length === 0) {
      return res.json({
        totalUsers: 0,
        totalPointsAwarded: 0,
        totalPointsRedeemed: 0,
        activeRewards: 0
      });
    }

    // Get loyalty accounts for all hotspots
    const loyaltySnap = await db.collection("hotspot_loyalty")
      .where("hotspotId", "in", hotspotIds)
      .get();
    
    let totalUsers = 0;
    let totalPointsAwarded = 0;
    let totalPointsRedeemed = 0;
    
    loyaltySnap.forEach(doc => {
      const data = doc.data();
      totalUsers++;
      totalPointsAwarded += data.totalEarned || 0;
      totalPointsRedeemed += data.totalSpent || 0;
    });

    // Get active rewards count
    const rewardsSnap = await db.collection("loyalty_rewards")
      .where("hotspotId", "in", hotspotIds)
      .where("status", "==", "active")
      .get();
    
    const activeRewards = rewardsSnap.size;

    res.json({
      totalUsers,
      totalPointsAwarded,
      totalPointsRedeemed,
      activeRewards
    });
  } catch (error) {
    console.error("Error fetching loyalty stats:", error);
    res.status(500).json({ error: "Failed to fetch loyalty statistics" });
  }
});

// Server-Sent Events stream for live loyalty statistics per owner
router.get("/owners/:ownerId/stream", async (req, res) => {
  try {
    const { ownerId } = req.params;
    if (!ownerId) return res.status(400).end();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (payload) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {}
    };

    // Get all hotspots for this owner
    const hotspotsSnap = await db.collection("hotspots")
      .where("ownerId", "==", ownerId)
      .get();
    
    const hotspotIds = hotspotsSnap.docs.map(doc => doc.id);

    if (hotspotIds.length === 0) {
      send({ 
        success: true, 
        stats: {
          totalUsers: 0,
          totalPointsAwarded: 0,
          totalPointsRedeemed: 0,
          activeRewards: 0
        },
        rewards: [],
        earningMethods: []
      });
      return res.end();
    }

    // Set up real-time listeners for loyalty data
    const unsubscribeLoyalty = db.collection("hotspot_loyalty")
      .where("hotspotId", "in", hotspotIds)
      .onSnapshot(async (loyaltySnapshot) => {
        try {
          let totalUsers = 0;
          let totalPointsAwarded = 0;
          let totalPointsRedeemed = 0;
          
          loyaltySnapshot.forEach(doc => {
            const data = doc.data();
            totalUsers++;
            totalPointsAwarded += data.totalEarned || 0;
            totalPointsRedeemed += data.totalSpent || 0;
          });

          // Get rewards data
          const rewardsSnap = await db.collection("loyalty_rewards")
            .where("hotspotId", "in", hotspotIds)
            .where("status", "==", "active")
            .get();
          
          const rewards = rewardsSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));

          // Get earning methods data
          const earningMethodsSnap = await db.collection("loyalty_earning_methods")
            .where("hotspotId", "in", hotspotIds)
            .where("status", "==", "active")
            .get();
          
          const earningMethods = earningMethodsSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));

          const stats = {
            totalUsers,
            totalPointsAwarded,
            totalPointsRedeemed,
            activeRewards: rewards.length
          };

          send({ success: true, stats, rewards, earningMethods });
        } catch (err) {
          send({ success: false, error: err?.message || "loyalty_stream_error" });
        }
      }, (err) => {
        send({ success: false, error: err?.message || "loyalty_stream_error" });
      });

    req.on("close", () => {
      try { unsubscribeLoyalty && unsubscribeLoyalty(); } catch {}
      res.end();
    });
  } catch (e) {
    try {
      res.write(`data: ${JSON.stringify({ success: false, error: "init_failed" })}\n\n`);
      res.end();
    } catch {}
  }
});

// Get rewards for an owner
router.get("/owners/:ownerId/rewards", async (req, res) => {
  try {
    const { ownerId } = req.params;
    
    // Get all hotspots for this owner
    const hotspotsSnap = await db.collection("hotspots")
      .where("ownerId", "==", ownerId)
      .get();
    
    const hotspotIds = hotspotsSnap.docs.map(doc => doc.id);
    
    if (hotspotIds.length === 0) {
      return res.json({ rewards: [] });
    }

    // Get rewards for all hotspots
    const rewardsSnap = await db.collection("loyalty_rewards")
      .where("hotspotId", "in", hotspotIds)
      .orderBy("pointsRequired", "asc")
      .get();
    
    const rewards = rewardsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({ rewards });
  } catch (error) {
    console.error("Error fetching rewards:", error);
    res.status(500).json({ error: "Failed to fetch rewards" });
  }
});

// Get earning methods for an owner
router.get("/owners/:ownerId/earning-methods", async (req, res) => {
  try {
    const { ownerId } = req.params;
    
    // Get all hotspots for this owner
    const hotspotsSnap = await db.collection("hotspots")
      .where("ownerId", "==", ownerId)
      .get();
    
    const hotspotIds = hotspotsSnap.docs.map(doc => doc.id);
    
    if (hotspotIds.length === 0) {
      return res.json({ methods: [] });
    }

    // Get earning methods for all hotspots
    const methodsSnap = await db.collection("loyalty_earning_methods")
      .where("hotspotId", "in", hotspotIds)
      .get();
    
    const methods = methodsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({ methods });
  } catch (error) {
    console.error("Error fetching earning methods:", error);
    res.status(500).json({ error: "Failed to fetch earning methods" });
  }
});

// Create a new reward
router.post("/rewards", async (req, res) => {
  try {
    const { title, description, pointsRequired, value, icon, status, hotspotId } = req.body;
    
    const rewardData = {
      title,
      description,
      pointsRequired: parseInt(pointsRequired),
      value: parseInt(value),
      icon,
      status,
      hotspotId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const rewardRef = await db.collection("loyalty_rewards").add(rewardData);
    
    res.json({ 
      success: true, 
      rewardId: rewardRef.id,
      message: "Reward created successfully" 
    });
  } catch (error) {
    console.error("Error creating reward:", error);
    res.status(500).json({ error: "Failed to create reward" });
  }
});

// Update a reward
router.put("/rewards/:rewardId", async (req, res) => {
  try {
    const { rewardId } = req.params;
    const updateData = {
      ...req.body,
      updatedAt: new Date().toISOString()
    };

    await db.collection("loyalty_rewards").doc(rewardId).update(updateData);
    
    res.json({ 
      success: true, 
      message: "Reward updated successfully" 
    });
  } catch (error) {
    console.error("Error updating reward:", error);
    res.status(500).json({ error: "Failed to update reward" });
  }
});

// Delete a reward
router.delete("/rewards/:rewardId", async (req, res) => {
  try {
    const { rewardId } = req.params;
    
    await db.collection("loyalty_rewards").doc(rewardId).delete();
    
    res.json({ 
      success: true, 
      message: "Reward deleted successfully" 
    });
  } catch (error) {
    console.error("Error deleting reward:", error);
    res.status(500).json({ error: "Failed to delete reward" });
  }
});

// Create a new earning method
router.post("/earning-methods", async (req, res) => {
  try {
    const { title, description, points, icon, type, status, hotspotId } = req.body;
    
    const methodData = {
      title,
      description,
      points: parseInt(points),
      icon,
      type,
      status,
      hotspotId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const methodRef = await db.collection("loyalty_earning_methods").add(methodData);
    
    res.json({ 
      success: true, 
      methodId: methodRef.id,
      message: "Earning method created successfully" 
    });
  } catch (error) {
    console.error("Error creating earning method:", error);
    res.status(500).json({ error: "Failed to create earning method" });
  }
});

// Update an earning method
router.put("/earning-methods/:methodId", async (req, res) => {
  try {
    const { methodId } = req.params;
    const updateData = {
      ...req.body,
      updatedAt: new Date().toISOString()
    };

    await db.collection("loyalty_earning_methods").doc(methodId).update(updateData);
    
    res.json({ 
      success: true, 
      message: "Earning method updated successfully" 
    });
  } catch (error) {
    console.error("Error updating earning method:", error);
    res.status(500).json({ error: "Failed to update earning method" });
  }
});

// Delete an earning method
router.delete("/earning-methods/:methodId", async (req, res) => {
  try {
    const { methodId } = req.params;
    
    await db.collection("loyalty_earning_methods").doc(methodId).delete();
    
    res.json({ 
      success: true, 
      message: "Earning method deleted successfully" 
    });
  } catch (error) {
    console.error("Error deleting earning method:", error);
    res.status(500).json({ error: "Failed to delete earning method" });
  }
});

module.exports = router;
