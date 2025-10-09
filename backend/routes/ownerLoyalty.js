const express = require("express");
const router = express.Router();
const { db } = require("../firebase");

// Get loyalty configuration for a hotspot
router.get("/hotspots/:hotspotId/config", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    
    // Get hotspot loyalty configuration
    const hotspotSnap = await db.collection("hotspots")
      .doc(hotspotId)
      .get();
    
    if (!hotspotSnap.exists) {
      return res.status(404).json({ 
        success: false, 
        message: "Hotspot not found" 
      });
    }
    
    const hotspotData = hotspotSnap.data();
    const loyaltyConfig = hotspotData.loyaltyConfig || {
      enabled: false,
      defaultPoints: {
        purchase: 10,
        referral: 50,
        daily_login: 5,
        review: 10
      },
      customEarningMethods: [],
      customRewards: []
    };
    
    res.json({ 
      success: true, 
      loyaltyConfig,
      hotspotName: hotspotData.hotspotName || hotspotData.name
    });
    
  } catch (error) {
    console.error("Error fetching loyalty config:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch loyalty configuration" 
    });
  }
});

// Update loyalty configuration for a hotspot
router.put("/hotspots/:hotspotId/config", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    const { 
      enabled, 
      defaultPoints, 
      customEarningMethods, 
      customRewards 
    } = req.body;
    
    // Validate input
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ 
        success: false, 
        message: "Enabled status must be boolean" 
      });
    }
    
    if (defaultPoints && typeof defaultPoints === 'object') {
      // Validate point values are numbers
      for (const [key, value] of Object.entries(defaultPoints)) {
        if (typeof value !== 'number' || value < 0) {
          return res.status(400).json({ 
            success: false, 
            message: `Invalid points value for ${key}: must be a positive number` 
          });
        }
      }
    }
    
    // Update hotspot with loyalty configuration
    await db.collection("hotspots")
      .doc(hotspotId)
      .update({
        loyaltyConfig: {
          enabled,
          defaultPoints: defaultPoints || {
            purchase: 10,
            referral: 50,
            daily_login: 5,
            review: 10
          },
          customEarningMethods: customEarningMethods || [],
          customRewards: customRewards || [],
          updatedAt: new Date().toISOString()
        }
      });
    
    // Update or create earning methods based on configuration
    if (enabled) {
      await updateEarningMethods(hotspotId, defaultPoints, customEarningMethods);
    }
    
    res.json({ 
      success: true, 
      message: "Loyalty configuration updated successfully" 
    });
    
  } catch (error) {
    console.error("Error updating loyalty config:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update loyalty configuration" 
    });
  }
});

// Helper function to update earning methods
async function updateEarningMethods(hotspotId, defaultPoints, customMethods) {
  try {
    // Delete existing earning methods for this hotspot
    const existingMethods = await db.collection("loyalty_earning_methods")
      .where("hotspotId", "==", hotspotId)
      .get();
    
    const deletePromises = existingMethods.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);
    
    // Create new earning methods based on configuration
    const methodsToCreate = [];
    
    // Add default methods with configured points
    if (defaultPoints) {
      if (defaultPoints.purchase > 0) {
        methodsToCreate.push({
          hotspotId,
          title: 'Purchase Packages',
          description: `Earn ${defaultPoints.purchase} points per 1000 UGX spent`,
          points: defaultPoints.purchase,
          icon: '📦',
          type: 'purchase',
          status: 'active',
          createdAt: new Date().toISOString()
        });
      }
      
      if (defaultPoints.referral > 0) {
        methodsToCreate.push({
          hotspotId,
          title: 'Refer Friends',
          description: `Get ${defaultPoints.referral} points per successful referral`,
          points: defaultPoints.referral,
          icon: '👥',
          type: 'referral',
          status: 'active',
          createdAt: new Date().toISOString()
        });
      }
      
      if (defaultPoints.daily_login > 0) {
        methodsToCreate.push({
          hotspotId,
          title: 'Daily Login',
          description: `Earn ${defaultPoints.daily_login} points for daily app usage`,
          points: defaultPoints.daily_login,
          icon: '🎯',
          type: 'daily_login',
          status: 'active',
          createdAt: new Date().toISOString()
        });
      }
      
      if (defaultPoints.review > 0) {
        methodsToCreate.push({
          hotspotId,
          title: 'Rate Hotspots',
          description: `Get ${defaultPoints.review} points for each review`,
          points: defaultPoints.review,
          icon: '⭐',
          type: 'review',
          status: 'active',
          createdAt: new Date().toISOString()
        });
      }
    }
    
    // Add custom methods
    if (customMethods && Array.isArray(customMethods)) {
      customMethods.forEach(method => {
        if (method.title && method.points > 0) {
          methodsToCreate.push({
            hotspotId,
            title: method.title,
            description: method.description || `Earn ${method.points} points`,
            points: method.points,
            icon: method.icon || '🎁',
            type: method.type || 'custom',
            status: 'active',
            createdAt: new Date().toISOString()
          });
        }
      });
    }
    
    // Create all methods in batch
    if (methodsToCreate.length > 0) {
      const batch = db.batch();
      methodsToCreate.forEach(method => {
        const docRef = db.collection("loyalty_earning_methods").doc();
        batch.set(docRef, method);
      });
      await batch.commit();
    }
    
  } catch (error) {
    console.error("Error updating earning methods:", error);
    throw error;
  }
}

// Get loyalty statistics for a hotspot
router.get("/hotspots/:hotspotId/stats", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    
    // Get total users enrolled in loyalty
    const usersSnap = await db.collection("hotspot_loyalty")
      .where("hotspotId", "==", hotspotId)
      .get();
    
    const totalUsers = usersSnap.size;
    let totalPointsAwarded = 0;
    let totalPointsRedeemed = 0;
    
    // Calculate total points awarded and redeemed
    usersSnap.docs.forEach(doc => {
      const data = doc.data();
      totalPointsAwarded += data.totalEarned || 0;
      totalPointsRedeemed += data.totalSpent || 0;
    });
    
    // Get recent transactions
    const transactionsSnap = await db.collection("hotspot_loyalty_transactions")
      .where("hotspotId", "==", hotspotId)
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();
    
    const recentTransactions = transactionsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.json({
      success: true,
      stats: {
        totalUsers,
        totalPointsAwarded,
        totalPointsRedeemed,
        activePoints: totalPointsAwarded - totalPointsRedeemed
      },
      recentTransactions
    });
    
  } catch (error) {
    console.error("Error fetching loyalty stats:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch loyalty statistics" 
    });
  }
});

// Get all earning methods for a hotspot (owner view)
router.get("/hotspots/:hotspotId/earning-methods", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    
    const methodsSnap = await db.collection("loyalty_earning_methods")
      .where("hotspotId", "==", hotspotId)
      .orderBy("createdAt", "desc")
      .get();
    
    const methods = methodsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.json({ 
      success: true, 
      methods 
    });
    
  } catch (error) {
    console.error("Error fetching earning methods:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch earning methods" 
    });
  }
});

// Create custom earning method
router.post("/hotspots/:hotspotId/earning-methods", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    const { title, description, points, icon, type } = req.body;
    
    if (!title || !points || points <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Title and valid points required" 
      });
    }
    
    const methodData = {
      hotspotId,
      title,
      description: description || `Earn ${points} points`,
      points,
      icon: icon || '🎁',
      type: type || 'custom',
      status: 'active',
      createdAt: new Date().toISOString()
    };
    
    const docRef = await db.collection("loyalty_earning_methods").add(methodData);
    
    res.json({ 
      success: true, 
      message: "Earning method created successfully",
      methodId: docRef.id
    });
    
  } catch (error) {
    console.error("Error creating earning method:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to create earning method" 
    });
  }
});

// Update earning method
router.put("/earning-methods/:methodId", async (req, res) => {
  try {
    const { methodId } = req.params;
    const { title, description, points, icon, type, status } = req.body;
    
    const updateData = {};
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (points && points > 0) updateData.points = points;
    if (icon) updateData.icon = icon;
    if (type) updateData.type = type;
    if (status) updateData.status = status;
    
    updateData.updatedAt = new Date().toISOString();
    
    await db.collection("loyalty_earning_methods")
      .doc(methodId)
      .update(updateData);
    
    res.json({ 
      success: true, 
      message: "Earning method updated successfully" 
    });
    
  } catch (error) {
    console.error("Error updating earning method:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update earning method" 
    });
  }
});

// Delete earning method
router.delete("/earning-methods/:methodId", async (req, res) => {
  try {
    const { methodId } = req.params;
    
    await db.collection("loyalty_earning_methods")
      .doc(methodId)
      .delete();
    
    res.json({ 
      success: true, 
      message: "Earning method deleted successfully" 
    });
    
  } catch (error) {
    console.error("Error deleting earning method:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to delete earning method" 
    });
  }
});

module.exports = router;
