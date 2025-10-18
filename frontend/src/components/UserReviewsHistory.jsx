import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';

const UserReviewsHistory = ({ userPhone, currentHotspotId }) => {
  const { isDark } = useTheme();
  const isDarkMode = isDark;
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({
    totalReviews: 0,
    averageRating: 0,
    totalReplies: 0
  });

  useEffect(() => {
    fetchUserReviews();
  }, [userPhone]);

  const fetchUserReviews = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/reviews/users/${userPhone}/reviews`);
      const result = await response.json();
      
      if (result.success) {
        setReviews(result.reviews);
        setStats({
          totalReviews: result.reviews.length,
          averageRating: result.reviews.length > 0 
            ? result.reviews.reduce((sum, review) => sum + review.rating, 0) / result.reviews.length 
            : 0,
          totalReplies: result.reviews.filter(review => review.adminReply).length
        });
      } else {
        setError(result.message);
      }
    } catch (error) {
      console.error('Failed to fetch user reviews:', error);
      setError('Failed to fetch your reviews');
    } finally {
      setLoading(false);
    }
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
      <div style={{...styles.container, backgroundColor: isDarkMode ? 'var(--n13)' : 'var(--n3)'}}>
        <div className="yaba-card" style={styles.loading}>Loading your reviews...</div>
      </div>
    );
  }

  return (
    <div style={{...styles.container, backgroundColor: isDarkMode ? 'var(--n13)' : 'var(--n3)'}}>
      {/* Header */}
      <div className="yaba-card" style={{...styles.header, backgroundColor: isDarkMode ? 'var(--n12)' : 'var(--n1)', color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>
        <div style={styles.headerLeft}>
          <h2 className="yaba-card-title" style={{...styles.title, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>My Reviews & Ratings</h2>
          <p className="yaba-muted" style={{...styles.subtitle, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Track your feedback and responses from hotspot owners</p>
        </div>
        <div style={styles.headerRight}>
          <button
            onClick={fetchUserReviews}
            className="yaba-btn yaba-btn--accent"
            style={styles.refreshButton}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={styles.statsGrid}>
        <div className="yaba-card" style={{...styles.statCard, backgroundColor: isDarkMode ? 'var(--n12)' : 'var(--n1)', color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>
          <div className="yaba-card-title" style={{...styles.statNumber, color: isDarkMode ? 'var(--accent)' : '#3b82f6'}}>{stats.totalReviews}</div>
          <div className="yaba-muted" style={{...styles.statLabel, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Reviews Given</div>
        </div>
        <div className="yaba-card" style={{...styles.statCard, backgroundColor: isDarkMode ? 'var(--n12)' : 'var(--n1)', color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>
          <div className="yaba-card-title" style={{...styles.statNumber, color: isDarkMode ? 'var(--accent)' : '#3b82f6'}}>{stats.averageRating.toFixed(1)}</div>
          <div className="yaba-muted" style={{...styles.statLabel, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Your Avg Rating</div>
        </div>
        <div className="yaba-card" style={{...styles.statCard, backgroundColor: isDarkMode ? 'var(--n12)' : 'var(--n1)', color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>
          <div className="yaba-card-title" style={{...styles.statNumber, color: isDarkMode ? 'var(--accent)' : '#3b82f6'}}>{stats.totalReplies}</div>
          <div className="yaba-muted" style={{...styles.statLabel, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Owner Replies</div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="yaba-card" style={{...styles.error, backgroundColor: isDarkMode ? 'var(--danger)' : '#fee2e2', color: isDarkMode ? 'var(--n1)' : '#dc2626'}}>
          ❌ {error}
          <button 
            onClick={() => setError('')} 
            className="yaba-btn yaba-btn--secondary"
            style={styles.errorClose}
          >
            ✕
          </button>
        </div>
      )}

      {/* Reviews List */}
      <div className="yaba-card" style={{...styles.reviewsSection, backgroundColor: isDarkMode ? 'var(--n12)' : 'var(--n1)', color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>
        <h3 className="yaba-card-title" style={{...styles.sectionTitle, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>
          Your Review History ({reviews.length})
        </h3>
        
        {reviews.length === 0 ? (
          <div style={{...styles.emptyState, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>
            <div style={styles.emptyIcon}>📝</div>
            <h4 className="yaba-card-title" style={{...styles.emptyTitle, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>No Reviews Yet</h4>
            <p className="yaba-muted" style={{...styles.emptyText, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>
              You haven't submitted any reviews yet. Rate and review hotspots after purchasing packages to see them here.
            </p>
          </div>
        ) : (
          <div style={styles.reviewsList}>
            {reviews.map((review) => (
              <div key={review.id} className="yaba-card yaba-elev-2" style={{...styles.reviewCard, backgroundColor: isDarkMode ? 'var(--n12)' : '#fafafa', border: isDarkMode ? '1px solid var(--n13)' : '1px solid #e5e7eb'}}>
                {/* Review Header */}
                <div style={styles.reviewHeader}>
                  <div style={styles.hotspotInfo}>
                    <div style={styles.hotspotIcon}>📶</div>
                    <div style={styles.hotspotDetails}>
                      <div className="yaba-card-title" style={{...styles.hotspotName, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>
                        {review.hotspotName || 'Hotspot'}
                      </div>
                      <div className="yaba-muted" style={{...styles.reviewDate, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>
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
                            color: star <= review.rating ? '#f59e0b' : (isDarkMode ? 'var(--n8)' : '#d1d5db')
                          }}
                        >
                          {star <= review.rating ? '★' : '☆'}
                        </span>
                      ))}
                    </div>
                    <div className="yaba-card-title" style={{...styles.ratingNumber, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>
                      {review.rating}/5
                    </div>
                  </div>
                </div>

                {/* Review Content */}
                {review.review && (
                  <div style={styles.reviewContent}>
                    <p className="yaba-muted" style={{...styles.reviewText, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>{review.review}</p>
                  </div>
                )}

                {/* Package Info */}
                {review.packageName && (
                  <div style={{...styles.packageInfo, backgroundColor: isDarkMode ? 'var(--n13)' : '#f3f4f6'}}>
                    <span className="yaba-muted" style={{...styles.packageLabel, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Package:</span>
                    <span className="yaba-card-title" style={{...styles.packageName, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>{review.packageName}</span>
                    <span className="yaba-card-title" style={{...styles.packagePrice, color: isDarkMode ? 'var(--success)' : '#10b981'}}>{review.packagePrice} UGX</span>
                  </div>
                )}

                {/* Admin Reply */}
                {review.adminReply ? (
                  <div style={{...styles.adminReply, backgroundColor: isDarkMode ? 'var(--n13)' : '#eff6ff', border: isDarkMode ? '1px solid var(--n12)' : '1px solid #dbeafe'}}>
                    <div style={styles.replyHeader}>
                      <span className="yaba-muted" style={{...styles.replyLabel, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Owner's Reply:</span>
                      <span className="yaba-muted" style={{...styles.replyDate, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>
                        {formatDate(review.adminReply.createdAt)}
                      </span>
                    </div>
                    <p className="yaba-muted" style={{...styles.replyText, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>{review.adminReply.reply}</p>
                  </div>
                ) : (
                  <div style={{...styles.noReply, backgroundColor: isDarkMode ? 'var(--n13)' : '#f3f4f6', border: isDarkMode ? '1px solid var(--n12)' : '1px solid #e5e7eb'}}>
                    <span className="yaba-muted" style={{...styles.noReplyText, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>
                      No reply from owner yet
                    </span>
                  </div>
                )}

                {/* Review Status */}
                <div style={{...styles.reviewStatus, borderTop: isDarkMode ? '1px solid var(--n12)' : '1px solid #e5e7eb'}}>
                  <span className="yaba-muted" style={{...styles.statusLabel, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Status:</span>
                  <span className="yaba-btn" style={{
                    ...styles.statusBadge,
                    backgroundColor: review.adminReply ? (isDarkMode ? 'var(--success)' : '#10b981') : (isDarkMode ? 'var(--warning)' : '#f59e0b')
                  }}>
                    {review.adminReply ? 'Replied' : 'Pending Reply'}
                  </span>
                </div>
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
    minHeight: '100vh'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '32px',
    padding: '24px',
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
  refreshButton: {
    padding: '12px 20px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginBottom: '32px'
  },
  statCard: {
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
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '16px'
  },
  emptyTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#374151',
    margin: '0 0 8px 0'
  },
  emptyText: {
    fontSize: '16px',
    lineHeight: '1.5',
    margin: 0
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
  hotspotInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  hotspotIcon: {
    fontSize: '32px'
  },
  hotspotDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  hotspotName: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1f2937'
  },
  reviewDate: {
    fontSize: '14px',
    color: '#6b7280'
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
  noReply: {
    backgroundColor: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    textAlign: 'center'
  },
  noReplyText: {
    fontSize: '14px',
    color: '#6b7280',
    fontStyle: 'italic'
  },
  reviewStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    paddingTop: '16px',
    borderTop: '1px solid #e5e7eb'
  },
  statusLabel: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151'
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#ffffff',
    textTransform: 'uppercase'
  },
  loading: {
    textAlign: 'center',
    padding: '48px',
    fontSize: '18px',
    color: '#6b7280'
  }
};

export default UserReviewsHistory;
