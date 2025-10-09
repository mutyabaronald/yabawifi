const express = require("express");
const router = express.Router();
const { db } = require("../firebase");
const admin = require('firebase-admin');

// Get packages for a specific owner
router.get("/", async (req, res) => {
  try {
    const { ownerId, status, type } = req.query;
    
    if (!ownerId) {
      return res.status(400).json({ error: "Owner ID is required" });
    }

    let query = db.collection("packages").where("ownerId", "==", ownerId);
    
    if (status) {
      query = query.where("status", "==", status);
    }
    
    if (type) {
      query = query.where("type", "==", type);
    }

    const snapshot = await query.get();
    const packages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(packages);
  } catch (error) {
    console.error("Error fetching packages:", error);
    res.status(500).json({ error: "Failed to fetch packages" });
  }
});

// Create a new package
router.post("/", async (req, res) => {
  try {
    const { 
      name, 
      price, 
      timeLimitMinutes, 
      dataLimitMB, 
      speedLimitMbps, 
      ownerId,
      type, // "wifi_package" or "loyalty_reward"
      // WiFi package loyalty settings
      loyaltyPointsPerPackage,
      loyaltyPointsPer1000UGX,
      // Loyalty reward settings
      pointsRequired,
      rewardType, // "time_access", "data_access", "unlimited"
      rewardValue, // minutes, MB, or null for unlimited
      rewardDescription
    } = req.body;

    if (!name || !ownerId || !type) {
      return res.status(400).json({ error: "Name, ownerId, and type are required" });
    }

    let packageData = {
      name,
      ownerId,
      type,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (type === "wifi_package") {
      // WiFi package configuration
      if (!price) {
        return res.status(400).json({ error: "Price is required for WiFi packages" });
      }
      
      packageData = {
        ...packageData,
        price: Number(price),
        timeLimitMinutes: timeLimitMinutes ? Number(timeLimitMinutes) : null,
        dataLimitMB: dataLimitMB ? Number(dataLimitMB) : null,
        speedLimitMbps: speedLimitMbps ? Number(speedLimitMbps) : null,
        // Loyalty configuration for WiFi packages
        loyaltyPointsPerPackage: loyaltyPointsPerPackage ? Number(loyaltyPointsPerPackage) : 0,
        loyaltyPointsPer1000UGX: loyaltyPointsPer1000UGX ? Number(loyaltyPointsPer1000UGX) : 0,
        loyaltyEnabled: (loyaltyPointsPerPackage > 0 || loyaltyPointsPer1000UGX > 0)
      };
    } else if (type === "loyalty_reward") {
      // Loyalty reward configuration
      if (!pointsRequired || pointsRequired <= 0) {
        return res.status(400).json({ error: "Valid pointsRequired is required for loyalty rewards" });
      }
      
      if (!rewardType) {
        return res.status(400).json({ error: "rewardType is required for loyalty rewards" });
      }
      
      packageData = {
        ...packageData,
        pointsRequired: Number(pointsRequired),
        rewardType,
        rewardValue: rewardValue ? Number(rewardValue) : null,
        rewardDescription: rewardDescription || `${pointsRequired} points for ${rewardType}`,
        // Set price to 0 for loyalty rewards
        price: 0,
        timeLimitMinutes: rewardType === "time_access" ? rewardValue : null,
        dataLimitMB: rewardType === "data_access" ? rewardValue : null,
        speedLimitMbps: null
      };
    } else {
      return res.status(400).json({ error: "Invalid package type. Must be 'wifi_package' or 'loyalty_reward'" });
    }

    const docRef = await db.collection("packages").add(packageData);
    
    res.json({ 
      success: true, 
      packageId: docRef.id,
      message: "Package created successfully" 
    });
  } catch (error) {
    console.error("Error creating package:", error);
    res.status(500).json({ error: "Failed to create package" });
  }
});

// Update a package
router.put("/:packageId", async (req, res) => {
  try {
    const { packageId } = req.params;
    const { 
      name, 
      price, 
      timeLimitMinutes, 
      dataLimitMB, 
      speedLimitMbps,
      type,
      // WiFi package loyalty settings
      loyaltyPointsPerPackage,
      loyaltyPointsPer1000UGX,
      // Loyalty reward settings
      pointsRequired,
      rewardType,
      rewardValue,
      rewardDescription
    } = req.body;

    const updateData = {
      updatedAt: new Date().toISOString()
    };

    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    
    if (type === "wifi_package") {
      if (price !== undefined) updateData.price = Number(price);
      if (timeLimitMinutes !== undefined) updateData.timeLimitMinutes = timeLimitMinutes ? Number(timeLimitMinutes) : null;
      if (dataLimitMB !== undefined) updateData.dataLimitMB = dataLimitMB ? Number(dataLimitMB) : null;
      if (speedLimitMbps !== undefined) updateData.speedLimitMbps = speedLimitMbps ? Number(speedLimitMbps) : null;
      
      // Update loyalty configuration for WiFi packages
      if (loyaltyPointsPerPackage !== undefined) updateData.loyaltyPointsPerPackage = Number(loyaltyPointsPerPackage);
      if (loyaltyPointsPer1000UGX !== undefined) updateData.loyaltyPointsPer1000UGX = Number(loyaltyPointsPer1000UGX);
      
      // Update loyalty enabled status
      updateData.loyaltyEnabled = (
        (updateData.loyaltyPointsPerPackage > 0 || loyaltyPointsPerPackage > 0) || 
        (updateData.loyaltyPointsPer1000UGX > 0 || loyaltyPointsPer1000UGX > 0)
      );
    } else if (type === "loyalty_reward") {
      if (pointsRequired !== undefined) updateData.pointsRequired = Number(pointsRequired);
      if (rewardType !== undefined) updateData.rewardType = rewardType;
      if (rewardValue !== undefined) updateData.rewardValue = rewardValue ? Number(rewardValue) : null;
      if (rewardDescription !== undefined) updateData.rewardDescription = rewardDescription;
      
      // Update time/data limits based on reward type
      if (rewardType === "time_access") {
        updateData.timeLimitMinutes = rewardValue;
        updateData.dataLimitMB = null;
      } else if (rewardType === "data_access") {
        updateData.dataLimitMB = rewardValue;
        updateData.timeLimitMinutes = null;
      }
      
      // Set price to 0 for loyalty rewards
      updateData.price = 0;
    }

    await db.collection("packages").doc(packageId).update(updateData);
    
    res.json({ 
      success: true, 
      message: "Package updated successfully" 
    });
  } catch (error) {
    console.error("Error updating package:", error);
    res.status(500).json({ error: "Failed to update package" });
  }
});

// Launch a package (change status to launched)
router.put("/:packageId/launch", async (req, res) => {
  try {
    const { packageId } = req.params;
    
    await db.collection("packages").doc(packageId).update({
      status: "launched",
      updatedAt: new Date().toISOString()
    });
    
    res.json({ 
      success: true, 
      message: "Package launched successfully" 
    });
  } catch (error) {
    console.error("Error launching package:", error);
    res.status(500).json({ error: "Failed to launch package" });
  }
});

// Pause a package (change status to paused)
router.put("/:packageId/pause", async (req, res) => {
  try {
    const { packageId } = req.params;
    
    await db.collection("packages").doc(packageId).update({
      status: "paused",
      updatedAt: new Date().toISOString()
    });
    
    res.json({ 
      success: true, 
      message: "Package paused successfully" 
    });
  } catch (error) {
    console.error("Error pausing package:", error);
    res.status(500).json({ error: "Failed to pause package" });
  }
});

// Delete a package
router.delete("/:packageId", async (req, res) => {
  try {
    const { packageId } = req.params;
    
    await db.collection("packages").doc(packageId).delete();
    
    res.json({ 
      success: true, 
      message: "Package deleted successfully" 
    });
  } catch (error) {
    console.error("Error deleting package:", error);
    res.status(500).json({ error: "Failed to delete package" });
  }
});

// List hotspot-scoped packages under owners/{ownerId}/hotspots/{hotspotId}/packages
router.get('/:ownerId/:hotspotId', async (req, res) => {
  try {
    const { ownerId, hotspotId } = req.params;
    const snap = await admin
      .firestore()
      .collection(`owners/${ownerId}/hotspots/${hotspotId}/packages`)
      .get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, packages: items });
  } catch (e) {
    console.error('List hotspot packages error:', e);
    res.status(500).json({ success: false, message: 'Failed to list packages' });
  }
});

// Upsert discount for a hotspot-scoped package
// PUT /api/packages/:ownerId/:hotspotId/:packageId/discount
router.put('/:ownerId/:hotspotId/:packageId/discount', async (req, res) => {
  try {
    const { ownerId, hotspotId, packageId } = req.params;
    const { basePrice, name, validity, deviceLimit, discount } = req.body || {};
    const ref = admin.firestore().doc(`owners/${ownerId}/hotspots/${hotspotId}/packages/${packageId}`);

    // Ensure package doc exists and store base fields
    const toMerge = {};
    if (basePrice !== undefined) toMerge.basePrice = Number(basePrice);
    if (name !== undefined) toMerge.name = name;
    if (validity !== undefined) toMerge.validity = validity;
    if (deviceLimit !== undefined) toMerge.deviceLimit = Number(deviceLimit);
    if (discount !== undefined) toMerge.discount = discount;
    await ref.set({ ...toMerge, updatedAt: new Date().toISOString() }, { merge: true });

    const snap = await ref.get();
    res.json({ success: true, package: { id: packageId, ...snap.data() } });
  } catch (e) {
    console.error('Upsert discount error:', e);
    res.status(500).json({ success: false, message: 'Failed to update discount' });
  }
});

// Get loyalty rewards for a specific hotspot
router.get("/loyalty-rewards/:hotspotId", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    
    // Get the hotspot to find the owner
    const hotspotDoc = await db.collection("hotspots").doc(hotspotId).get();
    if (!hotspotDoc.exists) {
      return res.status(404).json({ error: "Hotspot not found" });
    }
    
    const hotspotData = hotspotDoc.data();
    const ownerId = hotspotData.ownerId;
    
    // Get loyalty reward packages for this owner
    const rewardsSnap = await db.collection("packages")
      .where("ownerId", "==", ownerId)
      .where("type", "==", "loyalty_reward")
      .where("status", "==", "launched")
      .get();
    
    const loyaltyRewards = rewardsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.json(loyaltyRewards);
  } catch (error) {
    console.error("Error fetching loyalty rewards:", error);
    res.status(500).json({ error: "Failed to fetch loyalty rewards" });
  }
});

// GET /api/packages/:ownerId/:hotspotId/:packageId/price
router.get('/:ownerId/:hotspotId/:packageId/price', async (req, res) => {
  try {
    const { ownerId, hotspotId, packageId } = req.params;
    const ref = admin.firestore().doc(`owners/${ownerId}/hotspots/${hotspotId}/packages/${packageId}`);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Package not found' });
    const data = snap.data();
    const basePrice = Number(data.basePrice || data.price || 0);
    let finalPrice = basePrice;
    const d = data.discount;
    if (d && d.active) {
      const now = new Date();
      const expiry = d.validUntil ? new Date(d.validUntil) : null;
      const notExpired = !expiry || expiry > now;
      if (notExpired) {
        if (d.type === 'percentage') {
          finalPrice = Math.max(0, Math.round(basePrice - (basePrice * Number(d.value || 0) / 100)));
        } else if (d.type === 'fixed') {
          finalPrice = Math.max(0, Math.round(basePrice - Number(d.value || 0)));
        }
      }
    }
    res.json({ basePrice, finalPrice, discount: d || null });
  } catch (e) {
    console.error('Price endpoint error:', e);
    res.status(500).json({ error: 'Failed to compute price' });
  }
});

module.exports = router;
