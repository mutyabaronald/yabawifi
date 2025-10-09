const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Get all campaigns for an owner
router.get('/campaigns/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { hotspotId } = req.query;
    
    console.log(`📊 Fetching campaigns for owner: ${ownerId}, hotspot: ${hotspotId}`);
    
    const campaignsRef = admin.firestore().collection('referralCampaigns');
    const snapshot = await campaignsRef.where('ownerId', '==', ownerId).get();
    
    const campaigns = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      campaigns.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
      });
    });
    
    console.log(`✅ Found ${campaigns.length} campaigns`);
    res.json({ success: true, campaigns });
  } catch (error) {
    console.error('❌ Error fetching campaigns:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get referrals for an owner
router.get('/list/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;
    
    console.log(`📊 Fetching referrals for owner: ${ownerId}`);
    
    const referralsRef = admin.firestore().collection('referrals');
    const snapshot = await referralsRef.where('ownerId', '==', ownerId).get();
    
    const referrals = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      referrals.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
      });
    });
    
    console.log(`✅ Found ${referrals.length} referrals`);
    res.json({ success: true, referrals });
  } catch (error) {
    console.error('❌ Error fetching referrals:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get analytics for an owner
router.get('/analytics/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;
    
    console.log(`📊 Fetching analytics for owner: ${ownerId}`);
    
    // Get campaigns count
    const campaignsRef = admin.firestore().collection('referralCampaigns');
    const campaignsSnapshot = await campaignsRef.where('ownerId', '==', ownerId).get();
    const totalCampaigns = campaignsSnapshot.size;
    
    // Get referrals count
    const referralsRef = admin.firestore().collection('referrals');
    const referralsSnapshot = await referralsRef.where('ownerId', '==', ownerId).get();
    const totalReferrals = referralsSnapshot.size;
    
    // Get successful referrals count
    const successfulReferrals = referralsSnapshot.docs.filter(doc => 
      doc.data().status === 'completed'
    ).length;
    
    // Calculate average conversion rate
    const avgConversion = totalReferrals > 0 ? Math.round((successfulReferrals / totalReferrals) * 100) : 0;
    
    const analytics = {
      totalCampaigns,
      totalReferrals,
      successfulReferrals,
      avgConversion
    };
    
    console.log(`✅ Analytics calculated:`, analytics);
    res.json({ success: true, ...analytics });
  } catch (error) {
    console.error('❌ Error fetching analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create a new campaign
router.post('/campaigns', async (req, res) => {
  try {
    const { ownerId, hotspotId, name, description, rewardType, rewardValue, rewardMode, startDate, endDate, maxReferralsPerUser, minPurchaseAmount } = req.body;
    
    console.log(`📝 Creating campaign for owner: ${ownerId}`);
    
    const campaignData = {
      ownerId,
      hotspotId,
      name,
      description,
      rewardType,
      rewardValue,
      rewardMode,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      maxReferralsPerUser: maxReferralsPerUser ? parseInt(maxReferralsPerUser) : null,
      minPurchaseAmount: minPurchaseAmount ? parseFloat(minPurchaseAmount) : null,
      status: 'active',
      referralCode: generateReferralCode(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const docRef = await admin.firestore().collection('referralCampaigns').add(campaignData);
    
    console.log(`✅ Campaign created with ID: ${docRef.id}`);
    res.json({ success: true, campaignId: docRef.id });
  } catch (error) {
    console.error('❌ Error creating campaign:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update a campaign
router.put('/campaigns/:campaignId', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { ownerId, ...updateData } = req.body;
    
    console.log(`📝 Updating campaign: ${campaignId}`);
    
    const campaignRef = admin.firestore().collection('referralCampaigns').doc(campaignId);
    const doc = await campaignRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }
    
    const campaignData = doc.data();
    if (campaignData.ownerId !== ownerId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    await campaignRef.update({
      ...updateData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ Campaign updated: ${campaignId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error updating campaign:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a campaign
router.delete('/campaigns/:campaignId', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { ownerId } = req.body;
    
    console.log(`🗑️ Deleting campaign: ${campaignId}`);
    
    const campaignRef = admin.firestore().collection('referralCampaigns').doc(campaignId);
    const doc = await campaignRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }
    
    const campaignData = doc.data();
    if (campaignData.ownerId !== ownerId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    await campaignRef.delete();
    
    console.log(`✅ Campaign deleted: ${campaignId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting campaign:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to generate referral code
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

module.exports = router;


