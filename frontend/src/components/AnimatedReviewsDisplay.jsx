import React, { useState, useEffect } from 'react';

const AnimatedReviewsDisplay = ({ hotspotId }) => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const [reviewsEnabled, setReviewsEnabled] = useState(false);
  const [totalReviews, setTotalReviews] = useState(0);
  const [averageRating, setAverageRating] = useState(0);

  useEffect(() => {
    fetchPublicReviews();
    // Auto-rotate reviews every 5 seconds
    const interval = setInterval(() => {
      if (reviews.length > 1) {
        setCurrentReviewIndex((prev) => (prev + 1) % reviews.length);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [hotspotId, reviews.length]);

  const fetchPublicReviews = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/reviews/hotspots/${hotspotId}/reviews/public`);
      const result = await response.json();
      
      if (result.success) {
        setReviews(result.reviews);
        setReviewsEnabled(result.reviewsEnabled);
        setTotalReviews(result.reviews.length);
        
        if (result.reviews.length > 0) {
          const avgRating = result.reviews.reduce((sum, review) => sum + review.rating, 0) / result.reviews.length;
          setAverageRating(avgRating);
        }
      } else {
        setError(result.message);
      }
    } catch (error) {
      console.error('Failed to fetch public reviews:', error);
      setError('Failed to load reviews');
    } finally {
      setLoading(false);
    }
  };

  const maskPhoneNumber = (phone) => {
    if (!phone || phone.length < 3) return phone;
    return 'x'.repeat(phone.length - 3) + phone.slice(-3);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.ceil(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getRatingColor = (rating) => {
    if (rating >= 4) return '#10b981';
    if (rating >= 3) return '#f59e0b';
    return '#ef4444';
  };

  // Don't render if reviews are disabled
  if (!reviewsEnabled) {
    return null;
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingContainer}>
          <div style={styles.loadingSpinner}></div>
          <p style={styles.loadingText}>Loading reviews...</p>
        </div>
      </div>
    );
  }

  if (error || reviews.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.noReviewsContainer}>
          <div style={styles.noReviewsIcon}>⭐</div>
          <p style={styles.noReviewsText}>Be the first to review this hotspot!</p>
        </div>
      </div>
    );
  }

  const currentReview = reviews[currentReviewIndex];

  return (
    <div style={styles.container}>
      {/* Header with Stats */}
      <div style={styles.header}>
        <div style={styles.statsContainer}>
          <div style={styles.statItem}>
            <span style={styles.statNumber}>{totalReviews}</span>
            <span style={styles.statLabel}>Reviews</span>
          </div>
          <div style={styles.statDivider}></div>
          <div style={styles.statItem}>
            <span style={styles.statNumber}>{averageRating.toFixed(1)}</span>
            <span style={styles.statLabel}>Avg Rating</span>
          </div>
        </div>
        <div style={styles.reviewsLabel}>
          What people are saying
        </div>
      </div>

      {/* Animated Review Display */}
      <div style={styles.reviewDisplay}>
        <div style={styles.reviewCard}>
          {/* Review Header */}
          <div style={styles.reviewHeader}>
            <div style={styles.reviewerInfo}>
              <div style={styles.avatar}>
                {currentReview.userProfilePic ? (
                  <img 
                    src={currentReview.userProfilePic} 
                    alt="Profile" 
                    style={styles.profilePic}
                  />
                ) : (
                  <div style={styles.defaultAvatar}>
                    {currentReview.userName ? currentReview.userName.charAt(0).toUpperCase() : 'U'}
                  </div>
                )}
              </div>
              <div style={styles.reviewerDetails}>
                <div style={styles.reviewerName}>
                  {currentReview.userName || 'Anonymous User'}
                </div>
                <div style={styles.reviewerPhone}>
                  {maskPhoneNumber(currentReview.userPhone)}
                </div>
              </div>
            </div>
            <div style={styles.ratingDisplay}>
              <div style={styles.stars}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <span
                    key={star}
                    style={{
                      ...styles.star,
                      color: star <= currentReview.rating ? '#f59e0b' : '#d1d5db'
                    }}
                  >
                    {star <= currentReview.rating ? '★' : '☆'}
                  </span>
                ))}
              </div>
              <div style={styles.ratingNumber}>
                {currentReview.rating}/5
              </div>
            </div>
          </div>

          {/* Review Content */}
          {currentReview.review && (
            <div style={styles.reviewContent}>
              <p style={styles.reviewText}>"{currentReview.review}"</p>
            </div>
          )}

          {/* Review Footer */}
          <div style={styles.reviewFooter}>
            <span style={styles.reviewDate}>
              {formatDate(currentReview.createdAt)}
            </span>
            {currentReview.packageName && (
              <span style={styles.packageInfo}>
                • {currentReview.packageName} package
              </span>
            )}
          </div>
        </div>

        {/* Review Navigation Dots */}
        {reviews.length > 1 && (
          <div style={styles.navigationDots}>
            {reviews.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentReviewIndex(index)}
                style={{
                  ...styles.dot,
                  backgroundColor: index === currentReviewIndex ? '#3b82f6' : '#d1d5db'
                }}
                aria-label={`Go to review ${index + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Call to Action */}
      <div style={styles.callToAction}>
        <p style={styles.ctaText}>
          Share your experience and help others choose the best packages!
        </p>
      </div>
    </div>
  );
};

const styles = {
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '16px',
    padding: '24px',
    margin: '20px 0',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.2)'
  },
  header: {
    textAlign: 'center',
    marginBottom: '24px'
  },
  statsContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '24px',
    marginBottom: '16px'
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px'
  },
  statNumber: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#3b82f6'
  },
  statLabel: {
    fontSize: '12px',
    color: '#6b7280',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  statDivider: {
    width: '1px',
    height: '32px',
    backgroundColor: '#e5e7eb'
  },
  reviewsLabel: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#374151',
    margin: 0
  },
  reviewDisplay: {
    marginBottom: '24px'
  },
  reviewCard: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    transition: 'all 0.3s ease-in-out',
    animation: 'slideIn 0.5s ease-out'
  },
  reviewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px'
  },
  reviewerInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  avatar: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    overflow: 'hidden'
  },
  profilePic: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  defaultAvatar: {
    width: '100%',
    height: '100%',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    fontWeight: '600'
  },
  reviewerDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  reviewerName: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1f2937'
  },
  reviewerPhone: {
    fontSize: '12px',
    color: '#6b7280',
    fontFamily: 'monospace'
  },
  ratingDisplay: {
    textAlign: 'right'
  },
  stars: {
    display: 'flex',
    gap: '1px',
    marginBottom: '2px'
  },
  star: {
    fontSize: '16px'
  },
  ratingNumber: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#374151'
  },
  reviewContent: {
    marginBottom: '16px'
  },
  reviewText: {
    fontSize: '16px',
    color: '#374151',
    lineHeight: '1.6',
    margin: 0,
    fontStyle: 'italic'
  },
  reviewFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '12px',
    color: '#6b7280'
  },
  reviewDate: {
    fontWeight: '500'
  },
  packageInfo: {
    fontWeight: '500'
  },
  navigationDots: {
    display: 'flex',
    justifyContent: 'center',
    gap: '8px',
    marginTop: '16px'
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
    padding: 0
  },
  callToAction: {
    textAlign: 'center',
    padding: '16px',
    backgroundColor: '#f0f9ff',
    borderRadius: '8px',
    border: '1px solid #bae6fd'
  },
  ctaText: {
    fontSize: '14px',
    color: '#0369a1',
    margin: 0,
    fontWeight: '500'
  },
  loadingContainer: {
    textAlign: 'center',
    padding: '32px 16px'
  },
  loadingSpinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #e5e7eb',
    borderTop: '3px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 16px'
  },
  loadingText: {
    fontSize: '14px',
    color: '#6b7280',
    margin: 0
  },
  noReviewsContainer: {
    textAlign: 'center',
    padding: '32px 16px'
  },
  noReviewsIcon: {
    fontSize: '32px',
    marginBottom: '16px'
  },
  noReviewsText: {
    fontSize: '16px',
    color: '#6b7280',
    margin: 0,
    fontWeight: '500'
  }
};

// Add CSS animations
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);

export default AnimatedReviewsDisplay;
