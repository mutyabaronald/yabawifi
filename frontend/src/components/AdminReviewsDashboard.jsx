import React, { useState, useEffect } from 'react';

const AdminReviewsDashboard = ({ hotspotId, ownerId }) => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewsEnabled, setReviewsEnabled] = useState(true);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [stats, setStats] = useState({
    totalReviews: 0,
    averageRating: 0,
    recentReviews: 0
  });

  useEffect(() => {
    fetchReviews();
    fetchStats();
  }, [hotspotId]);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/reviews/hotspots/${hotspotId}/reviews/admin?ownerId=${ownerId}`);
      const result = await response.json();
      
      if (result.success) {
        setReviews(result.reviews);
        setReviewsEnabled(result.reviewsEnabled);
      } else {
        setError(result.message);
      }
    } catch (error) {
      console.error('Failed to fetch reviews:', error);
      setError('Failed to fetch reviews');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`/api/reviews/hotspots/${hotspotId}/stats?ownerId=${ownerId}`);
      const result = await response.json();
      
      if (result.success) {
        setStats(result.stats);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const handleToggleReviews = async () => {
    try {
      const response = await fetch(`/api/reviews/hotspots/${hotspotId}/reviews/toggle`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerId,
          enabled: !reviewsEnabled
        })
      });

      const result = await response.json();
      
      if (result.success) {
        setReviewsEnabled(!reviewsEnabled);
        // Refresh reviews to show/hide based on new setting
        fetchReviews();
      } else {
        setError(result.message);
      }
    } catch (error) {
      console.error('Failed to toggle reviews:', error);
      setError('Failed to toggle reviews');
    }
  };

  const handleReply = async (reviewId) => {
    if (!replyText.trim()) return;

    try {
      setSubmittingReply(true);
      const response = await fetch(`/api/reviews/reviews/${reviewId}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerId,
          reply: replyText.trim()
        })
      });

      const result = await response.json();
      
      if (result.success) {
        // Update the review with the reply
        setReviews(reviews.map(review => 
          review.id === reviewId 
            ? { ...review, adminReply: result.reply }
            : review
        ));
        setReplyingTo(null);
        setReplyText('');
        setError('');
      } else {
        setError(result.message);
      }
    } catch (error) {
      console.error('Failed to submit reply:', error);
      setError('Failed to submit reply');
    } finally {
      setSubmittingReply(false);
    }
  };

  const maskPhoneNumber = (phone) => {
    if (!phone || phone.length < 3) return phone;
    return 'x'.repeat(phone.length - 3) + phone.slice(-3);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRatingColor = (rating) => {
    if (rating >= 4) return '#10b981';
    if (rating >= 3) return '#f59e0b';
    return '#ef4444';
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading reviews...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>Reviews & Ratings</h2>
          <p style={styles.subtitle}>Manage customer feedback for your hotspot</p>
        </div>
        <div style={styles.headerRight}>
          <button
            onClick={handleToggleReviews}
            style={{
              ...styles.toggleButton,
              backgroundColor: reviewsEnabled ? '#10b981' : '#6b7280'
            }}
          >
            {reviewsEnabled ? 'Reviews Enabled' : 'Reviews Disabled'}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{stats.totalReviews}</div>
          <div style={styles.statLabel}>Total Reviews</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{stats.averageRating.toFixed(1)}</div>
          <div style={styles.statLabel}>Average Rating</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{stats.recentReviews}</div>
          <div style={styles.statLabel}>This Month</div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div style={styles.error}>
          ❌ {error}
          <button 
            onClick={() => setError('')} 
            style={styles.errorClose}
          >
            ✕
          </button>
        </div>
      )}

      {/* Reviews List */}
      <div style={styles.reviewsSection}>
        <h3 style={styles.sectionTitle}>
          Customer Reviews ({reviews.length})
        </h3>
        
        {reviews.length === 0 ? (
          <div style={styles.emptyState}>
            <p>No reviews yet. Reviews will appear here once customers start rating your hotspot.</p>
          </div>
        ) : (
          <div style={styles.reviewsList}>
            {reviews.map((review) => (
              <div key={review.id} style={styles.reviewCard}>
                {/* Review Header */}
                <div style={styles.reviewHeader}>
                  <div style={styles.reviewerInfo}>
                    <div style={styles.avatar}>
                      {review.userProfilePic ? (
                        <img 
                          src={review.userProfilePic} 
                          alt="Profile" 
                          style={styles.profilePic}
                        />
                      ) : (
                        <div style={styles.defaultAvatar}>
                          {review.userName ? review.userName.charAt(0).toUpperCase() : 'U'}
                        </div>
                      )}
                    </div>
                    <div style={styles.reviewerDetails}>
                      <div style={styles.reviewerName}>
                        {review.userName || 'Anonymous User'}
                      </div>
                      <div style={styles.reviewerPhone}>
                        {maskPhoneNumber(review.userPhone)}
                      </div>
                      <div style={styles.reviewDate}>
                        {formatDate(review.createdAt)}
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
                            color: star <= review.rating ? '#f59e0b' : '#d1d5db'
                          }}
                        >
                          {star <= review.rating ? '★' : '☆'}
                        </span>
                      ))}
                    </div>
                    <div style={styles.ratingNumber}>
                      {review.rating}/5
                    </div>
                  </div>
                </div>

                {/* Review Content */}
                {review.review && (
                  <div style={styles.reviewContent}>
                    <p style={styles.reviewText}>{review.review}</p>
                  </div>
                )}

                {/* Package Info */}
                {review.packageName && (
                  <div style={styles.packageInfo}>
                    <span style={styles.packageLabel}>Package:</span>
                    <span style={styles.packageName}>{review.packageName}</span>
                    <span style={styles.packagePrice}>{review.packagePrice} UGX</span>
                  </div>
                )}

                {/* Admin Reply */}
                {review.adminReply && (
                  <div style={styles.adminReply}>
                    <div style={styles.replyHeader}>
                      <span style={styles.replyLabel}>Your Reply:</span>
                      <span style={styles.replyDate}>
                        {formatDate(review.adminReply.createdAt)}
                      </span>
                    </div>
                    <p style={styles.replyText}>{review.adminReply.reply}</p>
                  </div>
                )}

                {/* Reply Action */}
                {!review.adminReply && (
                  <div style={styles.replySection}>
                    {replyingTo === review.id ? (
                      <div style={styles.replyForm}>
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Write your reply..."
                          style={styles.replyInput}
                          rows="3"
                          disabled={submittingReply}
                        />
                        <div style={styles.replyActions}>
                          <button
                            onClick={() => {
                              setReplyingTo(null);
                              setReplyText('');
                            }}
                            style={styles.cancelButton}
                            disabled={submittingReply}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleReply(review.id)}
                            style={styles.submitReplyButton}
                            disabled={submittingReply || !replyText.trim()}
                          >
                            {submittingReply ? 'Sending...' : 'Send Reply'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReplyingTo(review.id)}
                        style={styles.replyButton}
                      >
                        Reply to Review
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    padding: '24px',
    backgroundColor: '#f9fafb',
    minHeight: '100vh'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '32px',
    padding: '24px',
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
  },
  headerLeft: {
    flex: 1
  },
  title: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#1f2937',
    margin: '0 0 8px 0'
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
    margin: 0
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center'
  },
  toggleButton: {
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginBottom: '32px'
  },
  statCard: {
    backgroundColor: 'var(--surface)',
    padding: '24px',
    borderRadius: '12px',
    textAlign: 'center',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
  },
  statNumber: {
    fontSize: '32px',
    fontWeight: '700',
    color: '#3b82f6',
    marginBottom: '8px'
  },
  statLabel: {
    fontSize: '14px',
    color: '#6b7280',
    fontWeight: '500'
  },
  error: {
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  errorClose: {
    background: 'none',
    border: 'none',
    color: '#dc2626',
    cursor: 'pointer',
    fontSize: '18px'
  },
  reviewsSection: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
  },
  sectionTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 24px 0'
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px 24px',
    color: '#6b7280'
  },
  reviewsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  reviewCard: {
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '20px',
    backgroundColor: '#fafafa'
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
    gap: '16px'
  },
  avatar: {
    width: '48px',
    height: '48px',
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
    fontSize: '20px',
    fontWeight: '600'
  },
  reviewerDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  reviewerName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1f2937'
  },
  reviewerPhone: {
    fontSize: '14px',
    color: '#6b7280',
    fontFamily: 'monospace'
  },
  reviewDate: {
    fontSize: '12px',
    color: '#9ca3af'
  },
  ratingDisplay: {
    textAlign: 'right'
  },
  stars: {
    display: 'flex',
    gap: '2px',
    marginBottom: '4px'
  },
  star: {
    fontSize: '18px'
  },
  ratingNumber: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151'
  },
  reviewContent: {
    marginBottom: '16px'
  },
  reviewText: {
    fontSize: '14px',
    color: '#374151',
    lineHeight: '1.5',
    margin: 0
  },
  packageInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#f3f4f6',
    borderRadius: '8px'
  },
  packageLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  packageName: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151'
  },
  packagePrice: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#10b981'
  },
  adminReply: {
    backgroundColor: '#eff6ff',
    border: '1px solid #dbeafe',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px'
  },
  replyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  replyLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#1e40af',
    textTransform: 'uppercase'
  },
  replyDate: {
    fontSize: '12px',
    color: '#6b7280'
  },
  replyText: {
    fontSize: '14px',
    color: '#1e40af',
    margin: 0,
    lineHeight: '1.5'
  },
  replySection: {
    borderTop: '1px solid #e5e7eb',
    paddingTop: '16px'
  },
  replyButton: {
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  replyForm: {
    marginTop: '16px'
  },
  replyInput: {
    width: '100%',
    padding: '12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    resize: 'vertical',
    fontFamily: 'inherit',
    marginBottom: '12px'
  },
  replyActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end'
  },
  cancelButton: {
    padding: '8px 16px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  submitReplyButton: {
    padding: '8px 16px',
    backgroundColor: '#10b981',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  loading: {
    textAlign: 'center',
    padding: '48px',
    fontSize: '18px',
    color: '#6b7280'
  }
};

export default AdminReviewsDashboard;
