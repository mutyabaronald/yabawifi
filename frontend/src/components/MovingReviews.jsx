import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './MovingReviews.css';

const MovingReviews = ({ hotspotId }) => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showReviews, setShowReviews] = useState(false);

  useEffect(() => {
    if (hotspotId) {
      fetchReviews();
    }
  }, [hotspotId]);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      
      // Check if reviews are enabled for this hotspot
      const hotspotResponse = await axios.get(`/api/hotspots/${hotspotId}`);
      const hotspot = hotspotResponse.data.hotspot;
      
      if (hotspot && hotspot.reviewsEnabled) {
        // Fetch reviews for this hotspot
        const reviewsResponse = await axios.get(`/api/reviews/hotspot/${hotspotId}?limit=10`);
        const reviewsData = reviewsResponse.data.reviews || [];
        
        // Filter for positive reviews (4-5 stars) and add some variety
        const positiveReviews = reviewsData.filter(review => review.rating >= 4);
        
        if (positiveReviews.length > 0) {
          setReviews(positiveReviews);
          setShowReviews(true);
        }
      }
    } catch (error) {
      console.error('Error fetching reviews:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !showReviews || reviews.length === 0) {
    return null;
  }

  return (
    <div className="moving-reviews-container">
      <div className="reviews-header">
        <h3>🌟 What Our Users Say</h3>
        <p>Real reviews from people using this hotspot</p>
      </div>
      
      <div className="reviews-track">
        <div className="reviews-content">
          {[...reviews, ...reviews].map((review, index) => (
            <div key={`${review.id}-${index}`} className="review-item">
              <div className="review-stars">
                {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
              </div>
              <p className="review-text">"{review.comment}"</p>
              <div className="review-author">
                <span className="author-name">{review.userName || 'Anonymous'}</span>
                <span className="review-date">
                  {new Date(review.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MovingReviews;
