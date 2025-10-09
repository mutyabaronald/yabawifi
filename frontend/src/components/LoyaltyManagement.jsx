import React, { useState, useEffect, useRef } from 'react';

const LoyaltyManagement = ({ ownerId, selectedHotspotId = "all" }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [loyaltyStats, setLoyaltyStats] = useState({
    totalUsers: 0,
    totalPointsAwarded: 0,
    totalPointsRedeemed: 0,
    activeRewards: 0
  });
  const [rewards, setRewards] = useState([]);
  const [earningMethods, setEarningMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastUpdated, setLastUpdated] = useState(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    if (ownerId) {
      setupRealTimeListener();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [ownerId, selectedHotspotId]);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (ownerId) {
        setupRealTimeListener();
      }
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [ownerId]);

  const setupRealTimeListener = () => {
    if (!ownerId) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const streamUrl = selectedHotspotId === "all" 
        ? `/api/loyalty/owners/${ownerId}/stream`
        : `/api/loyalty/hotspots/${selectedHotspotId}/stream`;
      const eventSource = new EventSource(streamUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('Loyalty SSE connection opened');
        setLoading(false);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.success) {
            setLoyaltyStats(data.stats);
            setRewards(data.rewards || []);
            setEarningMethods(data.earningMethods || []);
            setLastUpdated(new Date());
          } else {
            console.error('Loyalty SSE error:', data.error);
            // Fallback to API polling
            fetchLoyaltyData();
          }
        } catch (err) {
          console.error('Error parsing loyalty SSE data:', err);
        }
      };

      eventSource.onerror = (error) => {
        console.error('Loyalty SSE connection error:', error);
        eventSource.close();
        // Fallback to API polling
        fetchLoyaltyData();
      };
    } catch (err) {
      console.error('Failed to setup loyalty SSE:', err);
      // Fallback to API polling
      fetchLoyaltyData();
    }
  };

  const fetchLoyaltyData = async () => {
    try {
      setLoading(true);
      
      // Fetch loyalty statistics
      const statsUrl = selectedHotspotId === "all" 
        ? `/api/loyalty/owners/${ownerId}/stats`
        : `/api/loyalty/hotspots/${selectedHotspotId}/stats`;
      const statsResponse = await fetch(statsUrl);
      if (statsResponse.ok) {
        const stats = await statsResponse.json();
        setLoyaltyStats(selectedHotspotId === "all" ? stats : stats.stats);
      }

      // Fetch rewards
      const rewardsUrl = selectedHotspotId === "all" 
        ? `/api/loyalty/owners/${ownerId}/rewards`
        : `/api/loyalty/hotspots/${selectedHotspotId}/rewards`;
      const rewardsResponse = await fetch(rewardsUrl);
      if (rewardsResponse.ok) {
        const rewardsData = await rewardsResponse.json();
        setRewards(rewardsData.rewards || []);
      }

      // Fetch earning methods
      const methodsUrl = selectedHotspotId === "all" 
        ? `/api/loyalty/owners/${ownerId}/earning-methods`
        : `/api/loyalty/hotspots/${selectedHotspotId}/earning-methods`;
      const methodsResponse = await fetch(methodsUrl);
      if (methodsResponse.ok) {
        const methodsData = await methodsResponse.json();
        setEarningMethods(methodsData.methods || []);
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch loyalty data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <p>Loading loyalty program...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Real-time Status Header */}
      <div style={styles.statusHeader}>
        <div style={styles.statusInfo}>
          <div style={styles.statusIndicator}>
            <div style={{
              ...styles.statusDot,
              backgroundColor: isOnline ? '#10b981' : '#ef4444'
            }}></div>
            <span style={styles.statusText}>
              {isOnline ? 'Live Data' : 'Offline'}
            </span>
          </div>
          {lastUpdated && (
            <div style={styles.lastUpdated}>
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          onClick={() => setActiveTab('overview')}
          style={{
            ...styles.tabButton,
            ...(activeTab === 'overview' ? styles.activeTab : {})
          }}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('rewards')}
          style={{
            ...styles.tabButton,
            ...(activeTab === 'rewards' ? styles.activeTab : {})
          }}
        >
          Rewards ({rewards.length})
        </button>
        <button
          onClick={() => setActiveTab('earning')}
          style={{
            ...styles.tabButton,
            ...(activeTab === 'earning' ? styles.activeTab : {})
          }}
        >
          Earning Methods ({earningMethods.length})
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div style={styles.overviewSection}>
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <div style={styles.statIcon}>👥</div>
              <div style={styles.statContent}>
                <div style={styles.statValue}>{loyaltyStats.totalUsers.toLocaleString()}</div>
                <div style={styles.statLabel}>Total Users</div>
              </div>
            </div>
            
            <div style={styles.statCard}>
              <div style={styles.statIcon}>⭐</div>
              <div style={styles.statContent}>
                <div style={styles.statValue}>{loyaltyStats.totalPointsAwarded.toLocaleString()}</div>
                <div style={styles.statLabel}>Points Awarded</div>
              </div>
            </div>
            
            <div style={styles.statCard}>
              <div style={styles.statIcon}>🎁</div>
              <div style={styles.statContent}>
                <div style={styles.statValue}>{loyaltyStats.totalPointsRedeemed.toLocaleString()}</div>
                <div style={styles.statLabel}>Points Redeemed</div>
              </div>
            </div>
            
            <div style={styles.statCard}>
              <div style={styles.statIcon}>🏆</div>
              <div style={styles.statContent}>
                <div style={styles.statValue}>{loyaltyStats.activeRewards.toLocaleString()}</div>
                <div style={styles.statLabel}>Active Rewards</div>
              </div>
            </div>
          </div>

          <div style={styles.infoSection}>
            <h3 style={styles.infoTitle}>Loyalty Program Benefits</h3>
            <p style={styles.infoText}>
              The loyalty program helps increase customer retention and engagement by rewarding users for their WiFi usage. 
              Users can earn points through various activities and redeem them for free WiFi access or other rewards.
            </p>
          </div>
        </div>
      )}

      {/* Rewards Tab */}
      {activeTab === 'rewards' && (
        <div style={styles.rewardsSection}>
          <div style={styles.sectionHeader}>
            <h3 style={styles.sectionTitle}>Manage Rewards</h3>
            <button style={styles.addButton}>
              + Add Reward
            </button>
          </div>

          <div style={styles.rewardsGrid}>
            {rewards.length > 0 ? rewards.map((reward) => (
              <div key={reward.id} style={styles.rewardCard}>
                <div style={styles.rewardHeader}>
                  <div style={styles.rewardIcon}>{reward.icon || '🎁'}</div>
                  <div style={styles.rewardInfo}>
                    <h4 style={styles.rewardTitle}>{reward.title || reward.name}</h4>
                    <p style={styles.rewardDescription}>{reward.description}</p>
                    <div style={styles.rewardDetails}>
                      <span style={styles.rewardPoints}>{reward.pointsRequired || reward.points} Points</span>
                      <span style={styles.rewardValue}>Worth {reward.value ? reward.value.toLocaleString() : 'N/A'} UGX</span>
                    </div>
                  </div>
                </div>
                
                <div style={styles.rewardActions}>
                  <button style={styles.activeStatus}>
                    {reward.status === 'active' ? 'Active' : 'Inactive'}
                  </button>
                  <button style={styles.editButton}>
                    Edit
                  </button>
                  <button style={styles.deleteButton}>
                    Delete
                  </button>
                </div>
              </div>
            )) : (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>🎁</div>
                <h3 style={styles.emptyTitle}>No Rewards Yet</h3>
                <p style={styles.emptyDescription}>Create your first reward to start engaging customers</p>
                <button style={styles.addButton}>+ Add Your First Reward</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Earning Methods Tab */}
      {activeTab === 'earning' && (
        <div style={styles.earningSection}>
          <div style={styles.sectionHeader}>
            <h3 style={styles.sectionTitle}>Manage Earning Methods</h3>
            <button style={styles.addButton}>
              + Add Earning Method
            </button>
          </div>

          <div style={styles.earningGrid}>
            {earningMethods.length > 0 ? earningMethods.map((method) => (
              <div key={method.id} style={styles.earningCard}>
                <div style={styles.earningHeader}>
                  <div style={styles.earningIcon}>{method.icon || '⭐'}</div>
                  <div style={styles.earningInfo}>
                    <h4 style={styles.earningTitle}>{method.title || method.name}</h4>
                    <p style={styles.earningDescription}>{method.description}</p>
                    <div style={styles.earningPoints}>+{method.points || method.pointsPerAction} points</div>
                  </div>
                </div>
                
                <div style={styles.earningActions}>
                  <button style={styles.activeStatus}>
                    {method.status === 'active' ? 'Active' : 'Inactive'}
                  </button>
                  <button style={styles.editButton}>
                    Edit
                  </button>
                  <button style={styles.deleteButton}>
                    Delete
                  </button>
                </div>
              </div>
            )) : (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>⭐</div>
                <h3 style={styles.emptyTitle}>No Earning Methods Yet</h3>
                <p style={styles.emptyDescription}>Set up ways for customers to earn loyalty points</p>
                <button style={styles.addButton}>+ Add Your First Method</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
  },
  statusHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    padding: '12px 16px',
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)'
  },
  statusInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    animation: 'pulse 2s infinite',
  },
  statusText: {
    fontSize: '14px',
    fontWeight: '500',
    color: 'var(--text-primary)'
  },
  lastUpdated: {
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  tabs: {
    display: 'flex',
    gap: '8px',
    marginBottom: '24px',
    borderBottom: '1px solid #e5e7eb',
  },
  tabButton: {
    padding: '12px 24px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#6b7280',
    borderBottom: '2px solid transparent',
    transition: 'all 0.2s',
  },
  activeTab: {
    color: '#2563eb',
    borderBottomColor: '#2563eb',
  },
  overviewSection: {
    marginBottom: '32px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginBottom: '32px',
  },
  statCard: {
    background: 'var(--surface)',
    padding: '24px',
    borderRadius: '12px',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    color: 'var(--text-primary)'
  },
  statIcon: {
    fontSize: '32px',
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    backgroundColor: '#f3f4f6',
  },
  statContent: {
    flex: 1,
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '4px',
  },
  statLabel: {
    fontSize: '14px',
    color: 'var(--text-muted)'
  },
  infoSection: {
    background: 'var(--surface)',
    padding: '24px',
    borderRadius: '12px',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)'
  },
  infoTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    margin: '0 0 12px 0',
  },
  infoText: {
    fontSize: '14px',
    color: 'var(--text-muted)',
    lineHeight: 1.6,
    margin: 0,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0,
  },
  addButton: {
    padding: '12px 24px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  rewardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
  },
  rewardCard: {
    background: 'var(--surface)',
    padding: '20px',
    borderRadius: '12px',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
  },
  rewardHeader: {
    display: 'flex',
    gap: '16px',
    marginBottom: '16px',
  },
  rewardIcon: {
    fontSize: '24px',
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    backgroundColor: '#f3f4f6',
  },
  rewardInfo: {
    flex: 1,
  },
  rewardTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    margin: '0 0 8px 0',
  },
  rewardDescription: {
    fontSize: '14px',
    color: 'var(--text-muted)',
    margin: '0 0 12px 0',
    lineHeight: 1.4,
  },
  rewardDetails: {
    display: 'flex',
    gap: '16px',
  },
  rewardPoints: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#7c3aed',
  },
  rewardValue: {
    fontSize: '14px',
    color: 'var(--text-muted)'
  },
  rewardActions: {
    display: 'flex',
    gap: '8px',
  },
  activeStatus: {
    padding: '6px 12px',
    backgroundColor: '#dcfce7',
    color: '#166534',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  editButton: {
    padding: '6px 12px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  deleteButton: {
    padding: '6px 12px',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  earningGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
  },
  earningCard: {
    background: 'var(--surface)',
    padding: '20px',
    borderRadius: '12px',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)'
  },
  earningHeader: {
    display: 'flex',
    gap: '16px',
    marginBottom: '16px',
  },
  earningIcon: {
    fontSize: '24px',
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    backgroundColor: '#f3f4f6',
  },
  earningInfo: {
    flex: 1,
  },
  earningTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    margin: '0 0 8px 0',
  },
  earningDescription: {
    fontSize: '14px',
    color: 'var(--text-muted)',
    margin: '0 0 12px 0',
    lineHeight: 1.4,
  },
  earningPoints: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#7c3aed',
  },
  earningActions: {
    display: 'flex',
    gap: '8px',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    gap: '16px',
  },
  loadingSpinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f4f6',
    borderTop: '4px solid #2563eb',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    textAlign: 'center',
    gridColumn: '1 / -1',
  },
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '16px',
    opacity: 0.6,
  },
  emptyTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#374151',
    margin: '0 0 8px 0',
  },
  emptyDescription: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '0 0 24px 0',
    maxWidth: '300px',
  },
};

export default LoyaltyManagement;
