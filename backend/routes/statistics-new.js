const express = require("express");
const router = express.Router();
const { db } = require("../firebase");

// Test route
router.get("/test", (req, res) => {
  console.log("NEW TEST ROUTE HIT!");
  res.json({ message: "New test route working", timestamp: new Date().toISOString() });
});

// Get total connected users across all hotspots since creation
router.get("/daily-users", async (req, res) => {
  try {
    console.log("=== NEW DAILY USERS API CALLED ===");
    console.log("Request URL:", req.url);
    console.log("Request method:", req.method);
    
    // Get all sessions (not just today)
    const sessionsSnap = await db.collection("sessions").get();
    
    let totalUsers = 0;
    const uniqueUsers = new Set();
    
    sessionsSnap.forEach((doc) => {
      const session = doc.data();
      totalUsers += 1;
      if (session.userId) {
        uniqueUsers.add(session.userId);
      }
    });
    
    // If no sessions found, get from receipts as fallback
    if (totalUsers === 0) {
      const receiptsSnap = await db.collection("receipts").get();
      
      receiptsSnap.forEach((doc) => {
        totalUsers += 1;
      });
    }
    
    console.log(`Total users found: ${totalUsers}, Unique users: ${uniqueUsers.size}`);
    
    const response = {
      dailyUsers: totalUsers, // Keeping the field name for frontend compatibility
      uniqueUsers: uniqueUsers.size
    };
    console.log("Daily users response:", response);
    console.log("=== SENDING RESPONSE ===");
    res.json(response);
  } catch (err) {
    console.error("Total users statistics error:", err);
    res.status(500).json({ 
      dailyUsers: 0, 
      uniqueUsers: 0 
    });
  }
});

// Get reviews and ratings statistics
router.get("/reviews", async (req, res) => {
  try {
    console.log("NEW Reviews API called");
    // Get all reviews from the reviews collection
    const reviewsSnap = await db.collection("reviews").get();
    let totalReviews = 0;
    let totalRating = 0;
    
    reviewsSnap.forEach((doc) => {
      const review = doc.data();
      totalReviews += 1;
      totalRating += Number(review.rating) || 0;
    });
    
    const averageRating = totalReviews > 0 ? (totalRating / totalReviews).toFixed(1) : 0;
    
    const response = {
      totalReviews: totalReviews,
      averageRating: parseFloat(averageRating),
      ratingStars: "★★★★☆" // 4.5 stars display
    };
    console.log("Reviews response:", response);
    res.json(response);
  } catch (err) {
    console.error("Reviews statistics error:", err);
    res.status(500).json({ 
      totalReviews: 0, 
      averageRating: 0, 
      ratingStars: "☆☆☆☆☆" 
    });
  }
});

// Get best-selling packages for a specific owner
router.get("/best-selling-packages/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;
    console.log(`Getting best-selling packages for owner: ${ownerId}`);
    
    // Get all receipts for this owner
    const receiptsSnap = await db.collection("receipts")
      .where("ownerId", "==", ownerId)
      .get();
    
    if (receiptsSnap.empty) {
      console.log("No receipts found for owner");
      return res.json({ bestSellingPackage: null, packageStats: [] });
    }
    
    // Count package purchases
    const packageCounts = {};
    receiptsSnap.forEach((doc) => {
      const receipt = doc.data();
      const packageName = receipt.packageName || receipt.package || "Unknown";
      packageCounts[packageName] = (packageCounts[packageName] || 0) + 1;
    });
    
    // Sort packages by purchase count
    const packageStats = Object.entries(packageCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    
    // Get the best-selling package
    const bestSellingPackage = packageStats.length > 0 ? packageStats[0] : null;
    
    console.log(`Best-selling package: ${bestSellingPackage?.name} with ${bestSellingPackage?.count} purchases`);
    
    res.json({
      bestSellingPackage,
      packageStats
    });
  } catch (err) {
    console.error("Best-selling packages error:", err);
    res.status(500).json({ 
      error: "Failed to get best-selling packages",
      bestSellingPackage: null,
      packageStats: []
    });
  }
});

module.exports = router;


