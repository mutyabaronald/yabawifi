import React, { useState, useEffect } from 'react';

const OwnerLoyaltyConfig = ({ hotspotId, ownerId }) => {
  const [config, setConfig] = useState({
    enabled: false,
    defaultPoints: {
      purchase: 10,
      referral: 50,
      daily_login: 5,
      review: 10
    },
    customEarningMethods: [],
    customRewards: []
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (hotspotId) {
      fetchLoyaltyConfig();
    }
  }, [hotspotId]);

  const fetchLoyaltyConfig = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/owner/loyalty/hotspots/${hotspotId}/config`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setConfig(data.loyaltyConfig);
        }
      }
    } catch (error) {
      console.error('Failed to fetch loyalty config:', error);
      setMessage('Failed to load loyalty configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage('');
      
      const response = await fetch(`/api/owner/loyalty/hotspots/${hotspotId}/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config)
      });

      const result = await response.json();
      
      if (result.success) {
        setMessage('✅ Loyalty configuration saved successfully!');
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage(`❌ ${result.message}`);
      }
    } catch (error) {
      console.error('Failed to save loyalty config:', error);
      setMessage('❌ Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handlePointChange = (type, value) => {
    const newValue = parseInt(value) || 0;
    setConfig(prev => ({
      ...prev,
      defaultPoints: {
        ...prev.defaultPoints,
        [type]: newValue
      }
    }));
  };

  const handleToggle = () => {
    setConfig(prev => ({
      ...prev,
      enabled: !prev.enabled
    }));
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading loyalty configuration...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Loyalty Program Configuration</h2>
      
      {message && (
        <div style={styles.message}>
          {message}
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>Enable Loyalty Program</h3>
          <label style={styles.toggle}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={handleToggle}
            />
            <span style={styles.slider}></span>
          </label>
        </div>
        <p style={styles.description}>
          When enabled, users can earn points for various activities at your hotspot.
        </p>
      </div>

      {config.enabled && (
        <>
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Default Point Values</h3>
            <p style={styles.description}>
              Set how many points users earn for different activities:
            </p>
            
            <div style={styles.pointsGrid}>
              <div style={styles.pointItem}>
                <label style={styles.pointLabel}>Purchase Packages</label>
                <input
                  type="number"
                  min="0"
                  value={config.defaultPoints.purchase}
                  onChange={(e) => handlePointChange('purchase', e.target.value)}
                  style={styles.pointInput}
                  placeholder="10"
                />
                <span style={styles.pointUnit}>points per 1000 UGX</span>
              </div>

              <div style={styles.pointItem}>
                <label style={styles.pointLabel}>Refer Friends</label>
                <input
                  type="number"
                  min="0"
                  value={config.defaultPoints.referral}
                  onChange={(e) => handlePointChange('referral', e.target.value)}
                  style={styles.pointInput}
                  placeholder="50"
                />
                <span style={styles.pointUnit}>points per referral</span>
              </div>

              <div style={styles.pointItem}>
                <label style={styles.pointLabel}>Daily Login</label>
                <input
                  type="number"
                  min="0"
                  value={config.defaultPoints.daily_login}
                  onChange={(e) => handlePointChange('daily_login', e.target.value)}
                  style={styles.pointInput}
                  placeholder="5"
                />
                <span style={styles.pointUnit}>points per day</span>
              </div>

              <div style={styles.pointItem}>
                <label style={styles.pointLabel}>Rate Hotspot</label>
                <input
                  type="number"
                  min="0"
                  value={config.defaultPoints.review}
                  onChange={(e) => handlePointChange('review', e.target.value)}
                  style={styles.pointInput}
                  placeholder="10"
                />
                <span style={styles.pointUnit}>points per rating</span>
              </div>
            </div>
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Custom Earning Methods</h3>
            <p style={styles.description}>
              Add custom ways for users to earn points (coming soon).
            </p>
            <div style={styles.comingSoon}>
              🚧 Custom earning methods will be available in the next update
            </div>
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Custom Rewards</h3>
            <p style={styles.description}>
              Create custom rewards for users to redeem with their points (coming soon).
            </p>
            <div style={styles.comingSoon}>
              🚧 Custom rewards will be available in the next update
            </div>
          </div>
        </>
      )}

      <div style={styles.actions}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={styles.saveButton}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      <div style={styles.info}>
        <h4>💡 How it works:</h4>
        <ul style={styles.infoList}>
          <li>Users automatically earn points when they buy WiFi packages</li>
          <li>Daily login points are awarded once per day per user</li>
          <li>Referral points are awarded for each successful referral</li>
          <li>Rating points are awarded once per day per user</li>
          <li>All point values are configurable by you</li>
        </ul>
      </div>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
    backgroundColor: '#f9fafb',
    minHeight: '100vh',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '30px',
    textAlign: 'center',
  },
  message: {
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '20px',
    fontSize: '14px',
    fontWeight: '500',
  },
  section: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '24px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0',
  },
  description: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '0 0 20px 0',
    lineHeight: 1.5,
  },
  toggle: {
    position: 'relative',
    display: 'inline-block',
    width: '60px',
    height: '34px',
  },
  slider: {
    position: 'absolute',
    cursor: 'pointer',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    backgroundColor: '#ccc',
    transition: '.4s',
    borderRadius: '34px',
  },
  pointsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
  },
  pointItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  pointLabel: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
  },
  pointInput: {
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '16px',
    width: '100px',
  },
  pointUnit: {
    fontSize: '12px',
    color: '#6b7280',
    fontStyle: 'italic',
  },
  comingSoon: {
    padding: '16px',
    backgroundColor: '#fef3c7',
    border: '1px solid #f59e0b',
    borderRadius: '8px',
    color: '#92400e',
    textAlign: 'center',
    fontSize: '14px',
  },
  actions: {
    textAlign: 'center',
    marginTop: '32px',
  },
  saveButton: {
    padding: '12px 32px',
    fontSize: '16px',
    fontWeight: '600',
    backgroundColor: '#10b981',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  info: {
    backgroundColor: '#eff6ff',
    border: '1px solid #3b82f6',
    borderRadius: '12px',
    padding: '20px',
    marginTop: '32px',
  },
  infoList: {
    margin: '16px 0 0 20px',
    padding: 0,
  },
  infoList: {
    margin: '16px 0 0 20px',
    padding: 0,
    fontSize: '14px',
    color: '#1e40af',
    lineHeight: 1.6,
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '16px',
    color: '#6b7280',
  },
};

export default OwnerLoyaltyConfig;
