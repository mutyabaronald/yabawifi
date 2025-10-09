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

async function testLoyaltyIndexes() {
  try {
    console.log('🧪 Testing Firebase indexes for loyalty program...\n');
    
    const testQueries = [
      {
        name: 'hotspot_loyalty_transactions',
        description: 'Test user loyalty transactions query',
        query: () => db.collection('hotspot_loyalty_transactions')
          .where('userPhone', '==', '0712354679')
          .orderBy('createdAt', 'desc')
          .limit(5)
      },
      {
        name: 'hotspot_loyalty',
        description: 'Test user loyalty by hotspot query',
        query: () => db.collection('hotspot_loyalty')
          .where('hotspotId', '==', 'test-hotspot')
          .where('userPhone', '==', '0712354679')
          .limit(1)
      },
      {
        name: 'loyalty_rewards',
        description: 'Test rewards by hotspot and status query',
        query: () => db.collection('loyalty_rewards')
          .where('hotspotId', '==', 'test-hotspot')
          .where('status', '==', 'active')
          .orderBy('pointsRequired', 'asc')
          .limit(10)
      },
      {
        name: 'loyalty_earning_methods',
        description: 'Test earning methods by hotspot query',
        query: () => db.collection('loyalty_earning_methods')
          .where('hotspotId', '==', 'test-hotspot')
          .where('status', '==', 'active')
          .limit(10)
      },
      {
        name: 'loyalty_redemptions',
        description: 'Test redemptions by user query',
        query: () => db.collection('loyalty_redemptions')
          .where('userId', '==', '0712354679')
          .where('hotspotId', '==', 'test-hotspot')
          .orderBy('redeemedAt', 'desc')
          .limit(10)
      }
    ];

    console.log('📊 Testing each collection query...\n');
    
    for (const test of testQueries) {
      try {
        console.log(`🔍 Testing: ${test.name}`);
        console.log(`   Description: ${test.description}`);
        
        const query = test.query();
        const snapshot = await query.get();
        
        console.log(`   ✅ SUCCESS: Query executed without index errors`);
        console.log(`   📄 Results: ${snapshot.size} documents found`);
        console.log('');
        
      } catch (error) {
        if (error.code === 9) {
          console.log(`   ❌ FAILED: Index required for ${test.name}`);
          console.log(`   🔗 Create index: ${error.details}`);
        } else {
          console.log(`   ⚠️  WARNING: ${error.message}`);
        }
        console.log('');
      }
    }
    
    console.log('🎯 Index Test Complete!');
    console.log('✅ All queries should work without index errors');
    console.log('❌ If you see "Index required" errors, create the missing indexes');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run the test
testLoyaltyIndexes();
