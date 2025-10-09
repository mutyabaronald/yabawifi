import React, { useState, useEffect } from 'react';

const LoyaltyProgram = ({ userPhone, currentHotspotId }) => {
  const [loyaltyData, setLoyaltyData] = useState({
    availablePoints: 0,
    totalEarned: 0,
    totalSpent: 0,
    memberTier: 'Bronze',
    progressToNext: 0,
    pointsNeeded: 0,
    nextTier: 'Silver'
  });
  const [lastUpdated, setLastUpdated] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [earningMethods, setEarningMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Fetch loyalty data when component mounts or hotspot changes
  useEffect(() => {
    console.log('LoyaltyProgram useEffect - userPhone:', userPhone, 'currentHotspotId:', currentHotspotId);
    
    if (userPhone && currentHotspotId) {
      fetchLoyaltyData();
    } else {
      console.log('Missing required props - userPhone:', userPhone, 'currentHotspotId:', currentHotspotId);
      setLoading(false);
    }
  }, [userPhone, currentHotspotId]);

  // Auto-refresh loyalty data every 30 seconds when connected
  useEffect(() => {
    if (!userPhone || !currentHotspotId) return;

    const interval = setInterval(() => {
      console.log('Auto-refreshing loyalty data...');
      fetchLoyaltyData();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [userPhone, currentHotspotId]);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const fetchLoyaltyData = async () => {
    try {
      setLoading(true);
      setError('');
      
      // Fetch loyalty data for the current hotspot
      const [loyaltyRes, rewardsRes, earningRes] = await Promise.all([
        fetch(`/api/loyalty/users/${userPhone}/loyalty/${currentHotspotId}`),
        fetch(`/api/loyalty/hotspots/${currentHotspotId}/rewards`),
        fetch(`/api/loyalty/hotspots/${currentHotspotId}/earning-methods`)
      ]);

      console.log('Loyalty response:', loyaltyRes);
      console.log('Rewards response:', rewardsRes);
      console.log('Earning response:', earningRes);

      if (loyaltyRes.ok) {
        const loyaltyData = await loyaltyRes.json();
        console.log('Loyalty data:', loyaltyData);
        
        // Validate loyalty data
        if (!loyaltyData || typeof loyaltyData.availablePoints !== 'number') {
          throw new Error('Invalid loyalty data received from server');
        }
        
        setLoyaltyData(loyaltyData);
        setLastUpdated(new Date());
      } else {
        console.error('Loyalty response not ok:', loyaltyRes.status, loyaltyRes.statusText);
        if (loyaltyRes.status === 404) {
          throw new Error('No loyalty account found for this hotspot');
        } else if (loyaltyRes.status === 500) {
          throw new Error('Server error while fetching loyalty data');
        } else {
          throw new Error(`Failed to fetch loyalty data: ${loyaltyRes.status}`);
        }
      }

      if (rewardsRes.ok) {
        const rewardsData = await rewardsRes.json();
        console.log('Rewards data:', rewardsData);
        
        // Validate rewards data
        if (!rewardsData.rewards || !Array.isArray(rewardsData.rewards)) {
          throw new Error('Invalid rewards data received from server');
        }
        
        setRewards(rewardsData.rewards);
      } else {
        console.error('Rewards response not ok:', rewardsRes.status, rewardsRes.statusText);
        if (rewardsRes.status === 404) {
          throw new Error('No rewards found for this hotspot');
        } else {
          throw new Error(`Failed to fetch rewards: ${rewardsRes.status}`);
        }
      }

      if (earningRes.ok) {
        const earningData = await earningRes.json();
        console.log('Earning data:', earningData);
        
        // Validate earning methods data
        if (!earningData.methods || !Array.isArray(earningData.methods)) {
          throw new Error('Invalid earning methods data received from server');
        }
        
        setEarningMethods(earningData.methods);
      } else {
        console.error('Earning response not ok:', earningRes.status, earningRes.statusText);
        if (earningRes.status === 404) {
          throw new Error('No earning methods found for this hotspot');
        } else {
          throw new Error(`Failed to fetch earning methods: ${earningRes.status}`);
        }
      }

    } catch (err) {
      console.error('Failed to fetch loyalty data:', err);
      setError(err.message || 'Failed to load loyalty program data');
    } finally {
      setLoading(false);
    }
  };

  const handleRedeemReward = async (rewardId, pointsRequired) => {
    if (loyaltyData.availablePoints < pointsRequired) {
      alert('Not enough points to redeem this reward');
      return;
    }

    try {
      const response = await fetch(`/api/loyalty/users/${userPhone}/loyalty/${currentHotspotId}/redeem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rewardId: rewardId,
          pointsRequired: pointsRequired
        }),
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Successfully redeemed ${result.message}!`);
        // Refresh loyalty data
        fetchLoyaltyData();
      } else {
        const errorData = await response.json();
        alert(`Failed to redeem reward: ${errorData.message || 'Please try again.'}`);
      }
    } catch (err) {
      console.error('Failed to redeem reward:', err);
      alert('Failed to redeem reward. Please try again.');
    }
  };

  const handleDailyLogin = async () => {
    try {
      const response = await fetch(`/api/loyalty/users/${userPhone}/loyalty/${currentHotspotId}/daily-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      const result = await response.json();
      
      if (result.success) {
        alert(`🎉 Daily login bonus! +${result.pointsAwarded} points added to your account.`);
        fetchLoyaltyData(); // Refresh data
      } else if (result.alreadyAwarded) {
        alert('✅ You already claimed your daily login bonus today!');
      } else if (result.notConfigured) {
        alert('⚠️ Daily login rewards are not configured for this hotspot.');
      } else {
        alert(`Failed to claim daily login: ${result.message}`);
      }
    } catch (err) {
      console.error('Failed to claim daily login:', err);
      alert('Failed to claim daily login. Please try again.');
    }
  };

  const handleReferral = async () => {
    const referredPhone = prompt('Enter the phone number of the friend you want to refer:');
    if (!referredPhone) return;
    
    const referralCode = prompt('Enter your referral code (if you have one):') || 'USER_REFERRAL';
    
    try {
      const response = await fetch(`/api/loyalty/users/${userPhone}/loyalty/${currentHotspotId}/referral`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          referredPhone: referredPhone,
          referralCode: referralCode
        })
      });

      const result = await response.json();
      
      if (result.success) {
        alert(`🎉 Referral successful! +${result.pointsAwarded} points added to your account.`);
        fetchLoyaltyData(); // Refresh data
      } else if (result.alreadyProcessed) {
        alert('⚠️ This referral has already been processed.');
      } else if (result.notConfigured) {
        alert('⚠️ Referral rewards are not configured for this hotspot.');
      } else {
        alert(`Failed to process referral: ${result.message}`);
      }
    } catch (err) {
      console.error('Failed to process referral:', err);
      alert('Failed to process referral. Please try again.');
    }
  };

  const handleRating = async () => {
    const rating = prompt('Rate this hotspot (1-5 stars):');
    if (!rating || rating < 1 || rating > 5) {
      alert('Please enter a valid rating between 1 and 5.');
      return;
    }
    
    const review = prompt('Write a review (optional):') || '';
    
    try {
      const response = await fetch(`/api/loyalty/users/${userPhone}/loyalty/${currentHotspotId}/rating`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rating: parseInt(rating),
          review: review
        })
      });

      const result = await response.json();
      
      if (result.success) {
        alert(`🎉 Rating submitted! +${result.pointsAwarded} points added to your account.`);
        fetchLoyaltyData(); // Refresh data
      } else if (result.alreadySubmitted) {
        alert('✅ You already submitted a rating today!');
      } else if (result.notConfigured) {
        alert('⚠️ Rating rewards are not configured for this hotspot.');
      } else {
        alert(`Failed to submit rating: ${result.message}`);
      }
    } catch (err) {
      console.error('Failed to submit rating:', err);
      alert('Failed to submit rating. Please try again.');
    }
  };

  const getTierColor = (tier) => {
    switch (tier.toLowerCase()) {
      case 'bronze': return '#92400e';
      case 'silver': return '#374151';
      case 'gold': return '#92400e';
      case 'platinum': return '#3730a3';
      default: return '#374151';
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.headerContent}>
            <div>
              <h1 style={styles.title}>Loyalty Program</h1>
              <p style={styles.subtitle}>Earn points and get rewarded for using YABAnect</p>
            </div>
            <div style={styles.headerRight}>
              <div style={styles.statusIndicators}>
                <div style={{...styles.connectionStatus, backgroundColor: '#6b7280'}}>
                  🟡 Loading...
                </div>
              </div>
              <button style={styles.refreshButton} disabled>
                ⏳ Refreshing...
              </button>
            </div>
          </div>
        </div>
        
        <div style={styles.loadingContainer}>
          <div style={styles.loadingSpinner}></div>
          <p>Loading your loyalty program data...</p>
          <p style={styles.loadingSubtext}>This may take a few seconds</p>
        </div>
      </div>
    );
  }

  if (!userPhone || !currentHotspotId) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>
          Unable to load loyalty program. Please connect to a WiFi hotspot first.
        </p>
        <p style={styles.errorSubtext}>
          userPhone: {userPhone || 'Not set'} | 
          currentHotspotId: {currentHotspotId || 'Not set'}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <div style={styles.errorIcon}>⚠️</div>
        <p style={styles.errorText}>{error}</p>
        <p style={styles.errorSubtext}>
          {!isOnline ? 'You appear to be offline. Please check your internet connection.' : 
           'There was an issue loading your loyalty data. Please try again.'}
        </p>
        <button onClick={fetchLoyaltyData} style={styles.retryButton} disabled={!isOnline}>
          {isOnline ? 'Retry' : 'Retry (Offline)'}
        </button>
      </div>
    );
  }

  // Calculate points needed for unavailable rewards
  const calculatePointsNeeded = (pointsRequired) => {
    const pointsNeeded = pointsRequired - loyaltyData.availablePoints;
    return Math.max(0, pointsNeeded);
  };

  return (
    <div style={styles.container}>
      {/* Header Section */}
      <div style={styles.header}>
        <div style={styles.headerContent}>
          <div>
            <h1 style={styles.title}>Loyalty Program</h1>
            <p style={styles.subtitle}>Earn points and get rewarded for using YABAnect</p>
          </div>
          <div style={styles.headerRight}>
            <div style={styles.statusIndicators}>
              <div style={{
                ...styles.connectionStatus,
                backgroundColor: isOnline ? '#10b981' : '#ef4444'
              }}>
                {isOnline ? '🟢' : '🔴'} {isOnline ? 'Online' : 'Offline'}
              </div>
              {lastUpdated && (
                <div style={styles.lastUpdated}>
                  Last updated: {lastUpdated.toLocaleTimeString()}
                </div>
              )}
            </div>
            <button onClick={fetchLoyaltyData} style={styles.refreshButton} disabled={loading || !isOnline}>
              {loading ? '⏳' : '🔄'} {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Your Loyalty Status Section */}
      <div style={styles.loyaltyStatusCard}>
        <div style={styles.loyaltyStatusHeader}>
          <div style={styles.loyaltyStatusLeft}>
            <h2 style={styles.loyaltyStatusTitle}>Your Loyalty Status</h2>
            <div style={styles.memberBadge}>
              {loyaltyData.memberTier} Member
            </div>
          </div>
          <div style={styles.pointsDisplay}>
            <div style={styles.availablePoints}>{loyaltyData.availablePoints}</div>
            <div style={styles.availablePointsLabel}>Available Points</div>
          </div>
        </div>
        
        <div style={styles.progressSection}>
          <div style={styles.progressLabel}>Progress to {loyaltyData.nextTier}</div>
          <div style={styles.progressBar}>
            <div 
              style={{
                ...styles.progressFill,
                width: `${Math.min(loyaltyData.progressToNext, 100)}%`
              }}
            ></div>
          </div>
          <div style={styles.progressText}>
            {loyaltyData.pointsNeeded} points needed
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={{...styles.summaryIcon, backgroundColor: '#10b981'}}>✅</div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryLabel}>Total Earned</div>
            <div style={styles.summaryValue}>{loyaltyData.totalEarned.toLocaleString()}</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={{...styles.summaryIcon, backgroundColor: '#ec4899'}}>📉</div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryLabel}>Total Spent</div>
            <div style={styles.summaryValue}>{loyaltyData.totalSpent.toLocaleString()}</div>
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={{...styles.summaryIcon, backgroundColor: '#f59e0b'}}>💰</div>
          <div style={styles.summaryContent}>
            <div style={styles.summaryLabel}>Conversion Rate</div>
            <div style={styles.summaryValue}>100 pts = 1000 UGX</div>
          </div>
        </div>
      </div>

      {/* How to Earn Points Section */}
      <div style={styles.earningSection}>
        <h3 style={styles.sectionTitle}>How to Earn Points</h3>
        {earningMethods.length > 0 ? (
          <div style={styles.earningGrid}>
            {earningMethods.map((method, index) => (
              <div key={method.id || index} style={styles.earningCard}>
                <div style={styles.earningIcon}>{method.icon}</div>
                <div style={styles.earningContent}>
                  <h4 style={styles.earningTitle}>{method.title}</h4>
                  <p style={styles.earningDescription}>{method.description}</p>
                  <div style={styles.earningPoints}>+{method.points} points</div>
                  {method.type === 'daily_login' && (
                    <button 
                      onClick={() => handleDailyLogin()}
                      style={styles.actionButton}
                    >
                      Claim Daily Login
                    </button>
                  )}
                  {method.type === 'referral' && (
                    <button 
                      onClick={() => handleReferral()}
                      style={styles.actionButton}
                    >
                      Refer a Friend
                    </button>
                  )}
                  {method.type === 'review' && (
                    <button 
                      onClick={() => handleRating()}
                      style={styles.actionButton}
                    >
                      Rate Hotspot
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={styles.emptyState}>
            <p>No earning methods configured for this hotspot yet.</p>
          </div>
        )}
      </div>

      {/* Available Rewards Section */}
      <div style={styles.rewardsSection}>
        <h3 style={styles.sectionTitle}>Available Rewards</h3>
        {rewards.length > 0 ? (
          <div style={styles.rewardsGrid}>
            {rewards.map((reward, index) => {
              const canRedeem = loyaltyData.availablePoints >= reward.pointsRequired;
              const pointsNeeded = calculatePointsNeeded(reward.pointsRequired);
              
              return (
                <div key={reward.id || index} style={styles.rewardCard}>
                  <div style={styles.rewardIcon}>{reward.icon}</div>
                  <div style={styles.rewardContent}>
                    <h4 style={styles.rewardTitle}>{reward.title}</h4>
                    <p style={styles.rewardSubtitle}>Worth {reward.value} UGX</p>
                    <div style={styles.rewardPoints}>{reward.pointsRequired} Points</div>
                    <div style={{
                      ...styles.rewardAvailability,
                      color: canRedeem ? '#10b981' : '#6b7280'
                    }}>
                      {canRedeem 
                        ? 'Available to redeem' 
                        : `Need ${pointsNeeded} more points`
                      }
                    </div>
                    <button
                      onClick={() => handleRedeemReward(reward.id, reward.pointsRequired)}
                      disabled={!canRedeem}
                      style={{
                        ...styles.redeemButton,
                        ...(canRedeem ? styles.redeemButtonActive : styles.redeemButtonDisabled)
                      }}
                    >
                      {canRedeem ? 'Redeem Now' : 'Not Available'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={styles.emptyState}>
            <p>No rewards configured for this hotspot yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
    backgroundColor: '#f9fafb',
    minHeight: '100vh',
  },
  header: {
    marginBottom: '30px',
  },
  headerContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '20px',
  },
  headerRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '8px',
  },
  statusIndicators: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '4px',
  },
  connectionStatus: {
    fontSize: '12px',
    color: '#ffffff',
    padding: '4px 8px',
    borderRadius: '12px',
    fontWeight: '500',
  },
  lastUpdated: {
    fontSize: '12px',
    color: '#6b7280',
    fontStyle: 'italic',
  },
  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
    margin: 0,
  },
  loyaltyStatusCard: {
    background: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)',
    borderRadius: '16px',
    padding: '32px',
    marginBottom: '30px',
    color: '#ffffff',
    boxShadow: '0 10px 25px rgba(139, 92, 246, 0.3)',
  },
  loyaltyStatusHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '24px',
    flexWrap: 'wrap',
    gap: '20px',
  },
  loyaltyStatusLeft: {
    flex: 1,
  },
  loyaltyStatusTitle: {
    fontSize: '24px',
    fontWeight: '600',
    margin: '0 0 16px 0',
  },
  memberBadge: {
    display: 'inline-block',
    padding: '8px 16px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    color: '#ffffff',
    backdropFilter: 'blur(10px)',
  },
  pointsDisplay: {
    textAlign: 'right',
  },
  availablePoints: {
    fontSize: '48px',
    fontWeight: 'bold',
    lineHeight: 1,
  },
  availablePointsLabel: {
    fontSize: '14px',
    opacity: 0.9,
  },
  progressSection: {
    marginTop: '20px',
  },
  progressLabel: {
    fontSize: '16px',
    marginBottom: '12px',
    opacity: 0.9,
  },
  progressBar: {
    width: '100%',
    height: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '8px',
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'var(--surface)',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: '14px',
    opacity: 0.8,
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '40px',
  },
  summaryCard: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    padding: '24px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  summaryIcon: {
    fontSize: '24px',
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    color: '#ffffff',
  },
  summaryContent: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '4px',
  },
  summaryValue: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#1f2937',
  },
  earningSection: {
    marginBottom: '40px',
  },
  sectionTitle: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 20px 0',
  },
  earningGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
  },
  earningCard: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    padding: '24px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    textAlign: 'center',
  },
  earningIcon: {
    fontSize: '32px',
    marginBottom: '16px',
  },
  earningTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 8px 0',
  },
  earningDescription: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '0 0 12px 0',
    lineHeight: 1.4,
  },
  earningPoints: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#10b981',
    marginBottom: '12px',
  },
  actionButton: {
    width: '100%',
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '12px',
    fontWeight: '500',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  rewardsSection: {
    marginBottom: '40px',
  },
  rewardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '24px',
  },
  rewardCard: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    padding: '24px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  rewardIcon: {
    fontSize: '32px',
    marginBottom: '16px',
  },
  rewardTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 8px 0',
  },
  rewardSubtitle: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '0 0 12px 0',
  },
  rewardPoints: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#7c3aed',
    marginBottom: '8px',
  },
  rewardAvailability: {
    fontSize: '14px',
    marginBottom: '16px',
    fontWeight: '500',
  },
  redeemButton: {
    width: '100%',
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  redeemButtonActive: {
    backgroundColor: '#10b981',
    color: '#ffffff',
  },
  redeemButtonDisabled: {
    backgroundColor: '#f3f4f6',
    color: '#6b7280',
    cursor: 'not-allowed',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    gap: '16px',
  },
  loadingSubtext: {
    fontSize: '14px',
    color: '#6b7280',
    margin: 0,
  },
  loadingSpinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f4f6',
    borderTop: '4px solid #667eea',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    gap: '16px',
  },
  errorIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  errorText: {
    color: '#dc2626',
    fontSize: '16px',
    textAlign: 'center',
    fontWeight: '600',
  },
  errorSubtext: {
    color: '#6b7280',
    fontSize: '14px',
    textAlign: 'center',
    marginTop: '8px',
  },
  refreshButton: {
    padding: '8px 16px',
    backgroundColor: '#667eea',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    color: '#6b7280',
    fontSize: '16px',
    fontStyle: 'italic',
  },
  retryButton: {
    padding: '12px 24px',
    backgroundColor: '#667eea',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
};

export default LoyaltyProgram;
