import React, { useState } from 'react';

const ReviewPopup = ({ 
  isOpen, 
  onClose, 
  hotspotId, 
  userPhone, 
  packageName, 
  packagePrice,
  onSubmitSuccess 
}) => {
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (rating === 0) {
      setMessage('Please select a rating');
      return;
    }

    try {
      setSubmitting(true);
      setMessage('');

      const response = await fetch(`/api/reviews/hotspots/${hotspotId}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userPhone,
          rating,
          review,
          packageName,
          packagePrice
        })
      });

      const result = await response.json();

      if (result.success) {
        setMessage('✅ Review submitted successfully!');
        setTimeout(() => {
          onClose();
          if (onSubmitSuccess) onSubmitSuccess();
        }, 1500);
      } else if (result.alreadySubmitted) {
        setMessage('✅ You already reviewed this hotspot today!');
        setTimeout(() => onClose(), 2000);
      } else if (result.notEnabled) {
        setMessage('⚠️ Reviews are not enabled for this hotspot');
        setTimeout(() => onClose(), 2000);
      } else {
        setMessage(`❌ ${result.message}`);
      }
    } catch (error) {
      console.error('Failed to submit review:', error);
      setMessage('❌ Failed to submit review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      onClose();
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.popup}>
        <div style={styles.header}>
          <h2 style={styles.title}>Rate Your Experience</h2>
          <button 
            onClick={handleClose} 
            style={styles.closeButton}
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        <div style={styles.content}>
          <p style={styles.subtitle}>
            How was your experience with the {packageName} package?
          </p>

          {/* Rating Stars */}
          <div style={styles.ratingSection}>
            <p style={styles.ratingLabel}>Rate this hotspot:</p>
            <div style={styles.stars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  style={{
                    ...styles.star,
                    ...(rating >= star ? styles.starActive : styles.starInactive)
                  }}
                  disabled={submitting}
                >
                  {rating >= star ? '★' : '☆'}
                </button>
              ))}
            </div>
            <p style={styles.ratingText}>
              {rating === 0 && 'Select a rating'}
              {rating === 1 && 'Poor'}
              {rating === 2 && 'Fair'}
              {rating === 3 && 'Good'}
              {rating === 4 && 'Very Good'}
              {rating === 5 && 'Excellent'}
            </p>
          </div>

          {/* Review Text */}
          <div style={styles.reviewSection}>
            <label style={styles.reviewLabel}>
              Write a review (optional):
            </label>
            <textarea
              value={review}
              onChange={(e) => setReview(e.target.value)}
              placeholder="Tell us about your experience..."
              style={styles.reviewInput}
              rows="3"
              disabled={submitting}
            />
          </div>

          {/* Message Display */}
          {message && (
            <div style={{
              ...styles.message,
              backgroundColor: message.includes('✅') ? '#d1fae5' : 
                           message.includes('⚠️') ? '#fef3c7' : '#fee2e2',
              color: message.includes('✅') ? '#065f46' : 
                     message.includes('⚠️') ? '#92400e' : '#dc2626'
            }}>
              {message}
            </div>
          )}

          {/* Action Buttons */}
          <div style={styles.actions}>
            <button
              onClick={handleClose}
              style={styles.cancelButton}
              disabled={submitting}
            >
              Skip
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || rating === 0}
              style={{
                ...styles.submitButton,
                ...(submitting || rating === 0 ? styles.submitButtonDisabled : {})
              }}
            >
              {submitting ? 'Submitting...' : 'Submit Review'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px'
  },
  popup: {
    backgroundColor: 'var(--surface)',
    borderRadius: '16px',
    maxWidth: '500px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'hidden',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px 24px 0 24px',
    borderBottom: '1px solid #e5e7eb'
  },
  title: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    transition: 'all 0.2s'
  },
  content: {
    padding: '24px'
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
    margin: '0 0 24px 0',
    textAlign: 'center'
  },
  ratingSection: {
    marginBottom: '24px',
    textAlign: 'center'
  },
  ratingLabel: {
    fontSize: '16px',
    fontWeight: '500',
    color: '#374151',
    margin: '0 0 16px 0'
  },
  stars: {
    display: 'flex',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '8px'
  },
  star: {
    background: 'none',
    border: 'none',
    fontSize: '32px',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    transition: 'all 0.2s'
  },
  starActive: {
    color: '#f59e0b'
  },
  starInactive: {
    color: '#d1d5db'
  },
  ratingText: {
    fontSize: '14px',
    color: '#6b7280',
    margin: 0,
    fontStyle: 'italic'
  },
  reviewSection: {
    marginBottom: '24px'
  },
  reviewLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '8px'
  },
  reviewInput: {
    width: '100%',
    padding: '12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    resize: 'vertical',
    fontFamily: 'inherit'
  },
  message: {
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '24px',
    fontSize: '14px',
    fontWeight: '500',
    textAlign: 'center'
  },
  actions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end'
  },
  cancelButton: {
    padding: '12px 24px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  submitButton: {
    padding: '12px 24px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  submitButtonDisabled: {
    backgroundColor: '#9ca3af',
    cursor: 'not-allowed'
  }
};

export default ReviewPopup;
