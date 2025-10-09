const express = require("express");
const router = express.Router();
const { db } = require("../firebase");

// Get reviews for a specific hotspot
router.get("/hotspot/:hotspotId", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    const { limit = 10 } = req.query;

    // Get reviews for this hotspot
    const reviewsSnap = await db.collection("reviews")
      .where("hotspotId", "==", hotspotId)
      .where("status", "==", "approved")
      .orderBy("createdAt", "desc")
      .limit(parseInt(limit))
      .get();

    const reviews = reviewsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      reviews
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reviews'
    });
  }
});

// Create a new review
router.post("/", async (req, res) => {
  try {
    const { 
      hotspotId, 
      userId, 
      userName, 
      rating, 
      comment 
    } = req.body;

    if (!hotspotId || !userId || !rating || !comment) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields"
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: "Rating must be between 1 and 5"
      });
    }

    const reviewData = {
      hotspotId,
      userId,
      userName: userName || 'Anonymous',
      rating: parseInt(rating),
      comment,
      status: 'pending', // Reviews need approval
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection("reviews").add(reviewData);

    res.json({
      success: true,
      reviewId: docRef.id,
      message: "Review submitted successfully. It will be visible after approval."
    });
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create review'
    });
  }
});

// Update review status (for admin/owner)
router.patch("/:reviewId/status", async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { status } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status"
      });
    }

    await db.collection("reviews").doc(reviewId).update({
      status,
      updatedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `Review ${status} successfully`
    });
  } catch (error) {
    console.error('Error updating review status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update review status'
    });
  }
});

// Get reviews for owner (admin dashboard)
router.get("/owner/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { status, rating, limit = 50, offset = 0 } = req.query;

    // First get all hotspots owned by this owner
    const hotspotsSnap = await db.collection("hotspots")
      .where("ownerId", "==", ownerId)
      .get();

    const hotspotIds = hotspotsSnap.docs.map(doc => doc.id);

    if (hotspotIds.length === 0) {
      return res.json({
        success: true,
        reviews: [],
        totalCount: 0
      });
    }

    // Build query for reviews
    let query = db.collection("reviews")
      .where("hotspotId", "in", hotspotIds);

    // Apply filters
    if (status) {
      query = query.where("status", "==", status);
    }
    if (rating) {
      query = query.where("rating", "==", parseInt(rating));
    }

    // Order by creation date and apply pagination
    query = query.orderBy("createdAt", "desc")
      .offset(parseInt(offset))
      .limit(parseInt(limit));

    const reviewsSnap = await query.get();
    const reviews = reviewsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Get total count for pagination
    let countQuery = db.collection("reviews")
      .where("hotspotId", "in", hotspotIds);
    
    if (status) {
      countQuery = countQuery.where("status", "==", status);
    }
    if (rating) {
      countQuery = countQuery.where("rating", "==", parseInt(rating));
    }

    const countSnap = await countQuery.get();
    const totalCount = countSnap.size;

    res.json({
      success: true,
      reviews,
      totalCount,
      hasMore: reviews.length === parseInt(limit)
    });
  } catch (error) {
    console.error('Error fetching owner reviews:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reviews'
    });
  }
});

// Get review statistics for owner
router.get("/owner/:ownerId/stats", async (req, res) => {
  try {
    const { ownerId } = req.params;

    // Get all hotspots owned by this owner
    const hotspotsSnap = await db.collection("hotspots")
      .where("ownerId", "==", ownerId)
      .get();

    const hotspotIds = hotspotsSnap.docs.map(doc => doc.id);

    if (hotspotIds.length === 0) {
      return res.json({
        success: true,
        stats: {
          totalReviews: 0,
          averageRating: 0,
          ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
          published: 0,
          pending: 0,
          responded: 0,
          totalHelpful: 0
        }
      });
    }

    // Get all reviews for owner's hotspots
    const reviewsSnap = await db.collection("reviews")
      .where("hotspotId", "in", hotspotIds)
      .get();

    const reviews = reviewsSnap.docs.map(doc => doc.data());

    // Calculate statistics
    const totalReviews = reviews.length;
    const published = reviews.filter(r => r.status === 'approved').length;
    const pending = reviews.filter(r => r.status === 'pending').length;
    const responded = reviews.filter(r => r.ownerResponse).length;
    const totalHelpful = reviews.reduce((sum, r) => sum + (r.helpfulCount || 0), 0);

    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let totalRating = 0;

    reviews.forEach(review => {
      const rating = review.rating || 0;
      if (rating >= 1 && rating <= 5) {
        ratingDistribution[rating]++;
        totalRating += rating;
      }
    });

    const averageRating = totalReviews > 0 ? (totalRating / totalReviews).toFixed(1) : 0;

    res.json({
      success: true,
      stats: {
        totalReviews,
        averageRating: parseFloat(averageRating),
        ratingDistribution,
        published,
        pending,
        responded,
        totalHelpful
      }
    });
  } catch (error) {
    console.error('Error fetching review stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch review statistics'
    });
  }
});

// Admin actions on reviews (approve, reject, publish, etc.)
router.post("/:reviewId/:action", async (req, res) => {
  try {
    const { reviewId, action } = req.params;
    const { ownerId, reply } = req.body;

    const reviewRef = db.collection("reviews").doc(reviewId);
    const reviewDoc = await reviewRef.get();

    if (!reviewDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Review not found"
      });
    }

    const reviewData = reviewDoc.data();

    // Verify owner has access to this review
    const hotspotDoc = await db.collection("hotspots").doc(reviewData.hotspotId).get();
    if (!hotspotDoc.exists || hotspotDoc.data().ownerId !== ownerId) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized access to review"
      });
    }

    let updateData = {
      updatedAt: new Date().toISOString()
    };

    switch (action) {
      case 'approve':
        updateData.status = 'approved';
        break;
      case 'reject':
        updateData.status = 'rejected';
        break;
      case 'publish':
        updateData.status = 'published';
        break;
      case 'reply':
        if (!reply) {
          return res.status(400).json({
            success: false,
            error: "Reply text is required"
          });
        }
        updateData.ownerResponse = {
          reply: reply.trim(),
          createdAt: new Date().toISOString(),
          ownerId: ownerId
        };
        break;
      case 'helpful':
        updateData.helpfulCount = (reviewData.helpfulCount || 0) + 1;
        break;
      default:
        return res.status(400).json({
          success: false,
          error: "Invalid action"
        });
    }

    await reviewRef.update(updateData);

    res.json({
      success: true,
      message: `Review ${action} successful`
    });
  } catch (error) {
    console.error(`Error ${req.params.action} review:`, error);
    res.status(500).json({
      success: false,
      error: `Failed to ${req.params.action} review`
    });
  }
});

// Get reviews for specific hotspot (admin view)
router.get("/hotspots/:hotspotId/reviews/admin", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    const { ownerId } = req.query;

    // Verify owner has access to this hotspot
    const hotspotDoc = await db.collection("hotspots").doc(hotspotId).get();
    if (!hotspotDoc.exists || hotspotDoc.data().ownerId !== ownerId) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized access to hotspot"
      });
    }

    const reviewsSnap = await db.collection("reviews")
      .where("hotspotId", "==", hotspotId)
      .orderBy("createdAt", "desc")
      .get();

    const reviews = reviewsSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      reviews,
      reviewsEnabled: hotspotDoc.data().reviewsEnabled !== false
    });
  } catch (error) {
    console.error('Error fetching hotspot reviews:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch hotspot reviews'
    });
  }
});

// Get review statistics for specific hotspot
router.get("/hotspots/:hotspotId/stats", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    const { ownerId } = req.query;

    // Verify owner has access to this hotspot
    const hotspotDoc = await db.collection("hotspots").doc(hotspotId).get();
    if (!hotspotDoc.exists || hotspotDoc.data().ownerId !== ownerId) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized access to hotspot"
      });
    }

    const reviewsSnap = await db.collection("reviews")
      .where("hotspotId", "==", hotspotId)
      .get();

    const reviews = reviewsSnap.docs.map(doc => doc.data());

    // Calculate statistics
    const totalReviews = reviews.length;
    const published = reviews.filter(r => r.status === 'approved').length;
    const pending = reviews.filter(r => r.status === 'pending').length;
    const responded = reviews.filter(r => r.ownerResponse).length;

    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let totalRating = 0;

    reviews.forEach(review => {
      const rating = review.rating || 0;
      if (rating >= 1 && rating <= 5) {
        ratingDistribution[rating]++;
        totalRating += rating;
      }
    });

    const averageRating = totalReviews > 0 ? (totalRating / totalReviews).toFixed(1) : 0;

    // Get recent reviews (this month)
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);
    
    const recentReviews = reviews.filter(r => 
      new Date(r.createdAt) >= thisMonth
    ).length;

    res.json({
      success: true,
      stats: {
        totalReviews,
        averageRating: parseFloat(averageRating),
        recentReviews,
        ratingDistribution,
        published,
        pending,
        responded
      }
    });
  } catch (error) {
    console.error('Error fetching hotspot review stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch hotspot review statistics'
    });
  }
});

// Toggle reviews for hotspot
router.put("/hotspots/:hotspotId/reviews/toggle", async (req, res) => {
  try {
    const { hotspotId } = req.params;
    const { ownerId, enabled } = req.body;

    // Verify owner has access to this hotspot
    const hotspotRef = db.collection("hotspots").doc(hotspotId);
    const hotspotDoc = await hotspotRef.get();
    
    if (!hotspotDoc.exists || hotspotDoc.data().ownerId !== ownerId) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized access to hotspot"
      });
    }

    await hotspotRef.update({
      reviewsEnabled: enabled,
      updatedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `Reviews ${enabled ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error('Error toggling reviews:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle reviews'
    });
  }
});

// Reply to review
router.post("/reviews/:reviewId/reply", async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { ownerId, reply } = req.body;

    if (!reply || !reply.trim()) {
      return res.status(400).json({
        success: false,
        error: "Reply text is required"
      });
    }

    const reviewRef = db.collection("reviews").doc(reviewId);
    const reviewDoc = await reviewRef.get();

    if (!reviewDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Review not found"
      });
    }

    const reviewData = reviewDoc.data();

    // Verify owner has access to this review
    const hotspotDoc = await db.collection("hotspots").doc(reviewData.hotspotId).get();
    if (!hotspotDoc.exists || hotspotDoc.data().ownerId !== ownerId) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized access to review"
      });
    }

    const ownerResponse = {
      reply: reply.trim(),
      createdAt: new Date().toISOString(),
      ownerId: ownerId
    };

    await reviewRef.update({
      ownerResponse,
      updatedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: "Reply added successfully",
      reply: ownerResponse
    });
  } catch (error) {
    console.error('Error adding reply to review:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add reply to review'
    });
  }
});

module.exports = router;