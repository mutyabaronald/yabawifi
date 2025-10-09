import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './OwnerReferrals.css';

const OwnerReferrals = ({ ownerId, hotspotId }) => {
  const [campaigns, setCampaigns] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('campaigns');
  const [formData, setFormData] = useState({
    name: '',
    rewardType: 'loyalty_points',
    rewardValue: '',
    rewardMode: 'both',
    startDate: '',
    endDate: '',
    maxReferralsPerUser: 10,
    minPurchaseAmount: 0,
    description: ''
  });

  useEffect(() => {
    if (ownerId) {
      fetchCampaigns();
      fetchAnalytics();
    }
  }, [ownerId]);

  const fetchCampaigns = async () => {
    try {
      setLoading(true);
      const params = hotspotId ? { hotspotId } : {};
      const response = await axios.get(`/api/referrals/campaigns/${ownerId}`, { params });
      if (response.data.success) {
        setCampaigns(response.data.campaigns);
      }
    } catch (error) {
      console.error('Error fetching campaigns:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const params = hotspotId ? { hotspotId } : {};
      const response = await axios.get(`/api/referrals/analytics/${ownerId}`, { params });
      if (response.data.success) {
        setAnalytics(response.data.analytics);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    }
  };

  const handleCreateCampaign = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const response = await axios.post('/api/referrals/campaigns', {
        ...formData,
        ownerId,
        hotspotId: hotspotId || ownerId // Use hotspotId if available, fallback to ownerId
      });
      
      if (response.data.success) {
        setShowCreateModal(false);
        setFormData({
          name: '',
          rewardType: 'loyalty_points',
          rewardValue: '',
          rewardMode: 'both',
          startDate: '',
          endDate: '',
          maxReferralsPerUser: 10,
          minPurchaseAmount: 0,
          description: ''
        });
        fetchCampaigns();
        fetchAnalytics();
      }
    } catch (error) {
      console.error('Error creating campaign:', error);
      alert('Failed to create campaign');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCampaignStatus = async (campaignId, newStatus) => {
    try {
      const response = await axios.patch(`/api/referrals/campaigns/${ownerId}/${campaignId}`, {
        status: newStatus
      });
      
      if (response.data.success) {
        fetchCampaigns();
        fetchAnalytics();
      }
    } catch (error) {
      console.error('Error updating campaign:', error);
      alert('Failed to update campaign status');
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const getStatusBadge = (status) => {
    const statusClasses = {
      active: 'status-active',
      paused: 'status-paused',
      ended: 'status-ended'
    };
    return (
      <span className={`status-badge ${statusClasses[status] || ''}`}>
        {status}
      </span>
    );
  };

  const getRewardTypeLabel = (type) => {
    const labels = {
      loyalty_points: 'Loyalty Points',
      discount_coupon: 'Discount Coupon',
      entitlement: 'Free WiFi Time'
    };
    return labels[type] || type;
  };

  const getRewardModeLabel = (mode) => {
    const labels = {
      referrer: 'Referrer Only',
      referee: 'Referee Only',
      both: 'Both Users'
    };
    return labels[mode] || mode;
  };

  if (loading && campaigns.length === 0) {
    return (
      <div className="owner-referrals">
        <div className="loading">Loading referral campaigns...</div>
      </div>
    );
  }

  return (
    <div className="owner-referrals">
      <div className="referrals-header">
        <h2>Referral Campaign Management</h2>
        <p>Create and manage referral campaigns to grow your WiFi business</p>
      </div>

      <div className="referrals-tabs">
        <button
          className={`tab ${activeTab === 'campaigns' ? 'active' : ''}`}
          onClick={() => setActiveTab('campaigns')}
        >
          Campaigns
        </button>
        <button
          className={`tab ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          Analytics
        </button>
      </div>

      {activeTab === 'campaigns' && (
        <div className="campaigns-section">
          <div className="campaigns-header">
            <h3>Your Referral Campaigns</h3>
            <button
              className="btn-create"
              onClick={() => setShowCreateModal(true)}
            >
              + Create Campaign
            </button>
          </div>

          {campaigns.length === 0 ? (
            <div className="no-campaigns">
              <p>No referral campaigns yet. Create your first one to start growing!</p>
            </div>
          ) : (
            <div className="campaigns-grid">
              {campaigns.map((campaign) => (
                <div key={campaign.id} className="campaign-card">
                  <div className="campaign-header">
                    <h4>{campaign.name}</h4>
                    {getStatusBadge(campaign.status)}
                  </div>

                  <div className="campaign-details">
                    <div className="detail-row">
                      <span className="label">Reward Type:</span>
                      <span className="value">{getRewardTypeLabel(campaign.rewardType)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Reward Value:</span>
                      <span className="value">{campaign.rewardValue}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Reward Mode:</span>
                      <span className="value">{getRewardModeLabel(campaign.rewardMode)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Duration:</span>
                      <span className="value">
                        {new Date(campaign.startDate).toLocaleDateString()} - {new Date(campaign.endDate).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Max Referrals/User:</span>
                      <span className="value">{campaign.maxReferralsPerUser}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Min Purchase:</span>
                      <span className="value">UGX {campaign.minPurchaseAmount}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Total Referrals:</span>
                      <span className="value">{campaign.totalReferrals || 0}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Total Cost:</span>
                      <span className="value">UGX {campaign.totalCost || 0}</span>
                    </div>
                  </div>

                  <div className="campaign-actions">
                    {campaign.status === 'active' && (
                      <>
                        <button
                          className="btn-pause"
                          onClick={() => handleUpdateCampaignStatus(campaign.id, 'paused')}
                        >
                          Pause
                        </button>
                        <button
                          className="btn-end"
                          onClick={() => handleUpdateCampaignStatus(campaign.id, 'ended')}
                        >
                          End
                        </button>
                      </>
                    )}
                    {campaign.status === 'paused' && (
                      <button
                        className="btn-resume"
                        onClick={() => handleUpdateCampaignStatus(campaign.id, 'active')}
                      >
                        Resume
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'analytics' && (
        <div className="analytics-section">
          <h3>Referral Performance Overview</h3>
          {analytics ? (
            <div className="analytics-grid">
              <div className="metric-card">
                <h4>Total Referrals</h4>
                <div className="metric-value">{analytics.totalReferrals}</div>
              </div>
              <div className="metric-card">
                <h4>Total Rewards Cost</h4>
                <div className="metric-value">UGX {analytics.totalRewardsCost}</div>
              </div>
              <div className="metric-card">
                <h4>Conversion Rate</h4>
                <div className="metric-value">{analytics.conversionRate.toFixed(1)}%</div>
              </div>
            </div>
          ) : (
            <div className="loading">Loading analytics...</div>
          )}
        </div>
      )}

      {/* Create Campaign Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Create Referral Campaign</h3>
              <button
                className="modal-close"
                onClick={() => setShowCreateModal(false)}
              >
                ×
              </button>
            </div>

            <form className="campaign-form" onSubmit={handleCreateCampaign}>
              <div className="form-group">
                <label htmlFor="name">Campaign Name</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  placeholder="e.g., Summer Referral Bonus"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="rewardType">Reward Type</label>
                  <select
                    id="rewardType"
                    name="rewardType"
                    value={formData.rewardType}
                    onChange={handleInputChange}
                    required
                  >
                    <option value="loyalty_points">Loyalty Points</option>
                    <option value="discount_coupon">Discount Coupon</option>
                    <option value="entitlement">Free WiFi Time</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="rewardValue">Reward Value</label>
                  <input
                    type="number"
                    id="rewardValue"
                    name="rewardValue"
                    value={formData.rewardValue}
                    onChange={handleInputChange}
                    required
                    placeholder={formData.rewardType === 'loyalty_points' ? 'e.g., 50 (points)' : formData.rewardType === 'discount_coupon' ? 'e.g., 10 (percentage)' : 'e.g., 60 (minutes)'}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="rewardMode">Reward Mode</label>
                  <select
                    id="rewardMode"
                    name="rewardMode"
                    value={formData.rewardMode}
                    onChange={handleInputChange}
                    required
                  >
                    <option value="referrer">Referrer Only</option>
                    <option value="referee">Referee Only</option>
                    <option value="both">Both Users</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="maxReferralsPerUser">Max Referrals Per User</label>
                  <input
                    type="number"
                    id="maxReferralsPerUser"
                    name="maxReferralsPerUser"
                    value={formData.maxReferralsPerUser}
                    onChange={handleInputChange}
                    required
                    min="1"
                    max="100"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="startDate">Start Date</label>
                  <input
                    type="date"
                    id="startDate"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleInputChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="endDate">End Date</label>
                  <input
                    type="date"
                    id="endDate"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="minPurchaseAmount">Minimum Purchase Amount (UGX)</label>
                <input
                  type="number"
                  id="minPurchaseAmount"
                  name="minPurchaseAmount"
                  value={formData.minPurchaseAmount}
                  onChange={handleInputChange}
                  min="0"
                  placeholder="0 for no minimum"
                />
              </div>

              <div className="form-group">
                <label htmlFor="description">Description</label>
                <textarea
                  id="description"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Describe your referral campaign..."
                  rows="3"
                />
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                  disabled={loading}
                >
                  {loading ? 'Creating...' : 'Create Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default OwnerReferrals;
