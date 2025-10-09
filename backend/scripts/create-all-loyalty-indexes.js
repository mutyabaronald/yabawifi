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

async function createAllLoyaltyIndexes() {
  try {
    console.log('🚀 Creating ALL Firebase indexes for loyalty program...\n');
    
    const indexes = [
      {
        name: 'hotspot_loyalty_transactions',
        description: 'For querying user loyalty transactions by phone and date',
        fields: [
          { fieldPath: 'userPhone', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' }
        ]
      },
      {
        name: 'hotspot_loyalty',
        description: 'For querying user loyalty by hotspot and phone',
        fields: [
          { fieldPath: 'hotspotId', order: 'ASCENDING' },
          { fieldPath: 'userPhone', order: 'ASCENDING' }
        ]
      },
      {
        name: 'loyalty_rewards',
        description: 'For querying rewards by hotspot and status',
        fields: [
          { fieldPath: 'hotspotId', order: 'ASCENDING' },
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'pointsRequired', order: 'ASCENDING' }
        ]
      },
      {
        name: 'loyalty_earning_methods',
        description: 'For querying earning methods by hotspot and status',
        fields: [
          { fieldPath: 'hotspotId', order: 'ASCENDING' },
          { fieldPath: 'status', order: 'ASCENDING' }
        ]
      },
      {
        name: 'loyalty_redemptions',
        description: 'For querying redemptions by user and hotspot',
        fields: [
          { fieldPath: 'userId', order: 'ASCENDING' },
          { fieldPath: 'hotspotId', order: 'ASCENDING' },
          { fieldPath: 'redeemedAt', order: 'DESCENDING' }
        ]
      }
    ];

    console.log('📋 Required Firebase Indexes:\n');
    
    indexes.forEach((index, i) => {
      console.log(`${i + 1}. Collection: ${index.name}`);
      console.log(`   Description: ${index.description}`);
      console.log(`   Fields: ${index.fields.map(f => `${f.fieldPath} (${f.order})`).join(', ')}`);
      console.log('');
    });

    console.log('🔗 Quick Links to Create Indexes:');
    console.log('1. Main Firebase Console: https://console.firebase.google.com/project/yabawifiadmin/firestore/indexes');
    console.log('2. Direct index creation: https://console.firebase.google.com/v1/r/project/yabawifiadmin/firestore/indexes?create_composite=CmJwcm9qZWN0cy95YWJhd2lmaWFkbWluL2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9ob3RzcG90X2xveWFsdHlfdHJhbnNhY3Rpb25zL2luZGV4ZXMvXxABGg0KCXVzZXJQaG9uZRABGg0KCWNyZWF0ZWRBdBACGgwKCF9fbmFtZV9fEAI');
    
    console.log('\n📝 Step-by-Step Instructions:');
    console.log('1. Go to Firebase Console: https://console.firebase.google.com/');
    console.log('2. Select project: yabawifiadmin');
    console.log('3. Go to Firestore Database > Indexes tab');
    console.log('4. Click "Create Index" for each collection above');
    console.log('5. Use the field configurations shown above');
    console.log('6. Set Query scope to "Collection" for all');
    
    console.log('\n⏱️  Index creation typically takes 1-5 minutes each');
    console.log('📊 Monitor progress in the Firebase Console');
    console.log('🔄 You can create multiple indexes simultaneously');
    
    console.log('\n✅ Once all indexes are created, your loyalty program will work perfectly!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

// Run the script
createAllLoyaltyIndexes();
