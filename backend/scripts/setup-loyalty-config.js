const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}

const db = admin.firestore();

async function setupLoyaltyConfig() {
  try {
    console.log('🚀 Setting up loyalty configuration for existing hotspots...\n');
    
    // Get all hotspots
    const hotspotsSnap = await db.collection("hotspots").get();
    
    if (hotspotsSnap.empty) {
      console.log('❌ No hotspots found in database');
      return;
    }
    
    console.log(`📊 Found ${hotspotsSnap.size} hotspots\n`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const doc of hotspotsSnap.docs) {
      const hotspotData = doc.data();
      const hotspotId = doc.id;
      
      // Check if loyalty config already exists
      if (hotspotData.loyaltyConfig) {
        console.log(`⏭️  Skipping ${hotspotData.hotspotName || hotspotData.name || hotspotId} - already configured`);
        skippedCount++;
        continue;
      }
      
      // Set default loyalty configuration
      const defaultConfig = {
        enabled: true,
        defaultPoints: {
          purchase: 10,
          referral: 50,
          daily_login: 5,
          review: 10
        },
        customEarningMethods: [],
        customRewards: [],
        createdAt: new Date().toISOString()
      };
      
      try {
        // Update hotspot with loyalty config
        await db.collection("hotspots").doc(hotspotId).update({
          loyaltyConfig: defaultConfig
        });
        
        console.log(`✅ Updated ${hotspotData.hotspotName || hotspotData.name || hotspotId} with loyalty config`);
        updatedCount++;
        
        // Create earning methods for this hotspot
        await createEarningMethods(hotspotId, defaultConfig.defaultPoints);
        
      } catch (error) {
        console.error(`❌ Failed to update ${hotspotId}:`, error.message);
      }
    }
    
    console.log('\n🎯 Setup Complete!');
    console.log(`✅ Updated: ${updatedCount} hotspots`);
    console.log(`⏭️  Skipped: ${skippedCount} hotspots (already configured)`);
    console.log(`📊 Total: ${hotspotsSnap.size} hotspots`);
    
    if (updatedCount > 0) {
      console.log('\n💡 Next steps:');
      console.log('1. Hotspots now have default loyalty configuration');
      console.log('2. Owners can customize point values via the owner dashboard');
      console.log('3. Users can start earning points immediately');
    }
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
  } finally {
    process.exit(0);
  }
}

async function createEarningMethods(hotspotId, defaultPoints) {
  try {
    // Delete existing earning methods for this hotspot
    const existingMethods = await db.collection("loyalty_earning_methods")
      .where("hotspotId", "==", hotspotId)
      .get();
    
    const deletePromises = existingMethods.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);
    
    // Create new earning methods based on configuration
    const methodsToCreate = [];
    
    if (defaultPoints.purchase > 0) {
      methodsToCreate.push({
        hotspotId,
        title: 'Purchase Packages',
        description: `Earn ${defaultPoints.purchase} points per 1000 UGX spent`,
        points: defaultPoints.purchase,
        icon: '📦',
        type: 'purchase',
        status: 'active',
        createdAt: new Date().toISOString()
      });
    }
    
    if (defaultPoints.referral > 0) {
      methodsToCreate.push({
        hotspotId,
        title: 'Refer Friends',
        description: `Get ${defaultPoints.referral} points per successful referral`,
        points: defaultPoints.referral,
        icon: '👥',
        type: 'referral',
        status: 'active',
        createdAt: new Date().toISOString()
      });
    }
    
    if (defaultPoints.daily_login > 0) {
      methodsToCreate.push({
        hotspotId,
        title: 'Daily Login',
        description: `Earn ${defaultPoints.daily_login} points for daily app usage`,
        points: defaultPoints.daily_login,
        icon: '🎯',
        type: 'daily_login',
        status: 'active',
        createdAt: new Date().toISOString()
      });
    }
    
    if (defaultPoints.review > 0) {
      methodsToCreate.push({
        hotspotId,
        title: 'Rate Hotspots',
        description: `Get ${defaultPoints.review} points for each review`,
        points: defaultPoints.review,
        icon: '⭐',
        type: 'review',
        status: 'active',
        createdAt: new Date().toISOString()
      });
    }
    
    // Create all methods in batch
    if (methodsToCreate.length > 0) {
      const batch = db.batch();
      methodsToCreate.forEach(method => {
        const docRef = db.collection("loyalty_earning_methods").doc();
        batch.set(docRef, method);
      });
      await batch.commit();
    }
    
  } catch (error) {
    console.error(`Error creating earning methods for ${hotspotId}:`, error);
  }
}

// Run the setup
setupLoyaltyConfig();
