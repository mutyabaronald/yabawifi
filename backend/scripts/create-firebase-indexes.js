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

async function createLoyaltyIndexes() {
  try {
    console.log('🚀 Creating Firebase indexes for loyalty program...');
    
    // Create composite index for hotspot_loyalty_transactions
    const indexData = {
      queryScope: 'COLLECTION',
      fields: [
        {
          fieldPath: 'userPhone',
          order: 'ASCENDING'
        },
        {
          fieldPath: 'createdAt',
          order: 'DESCENDING'
        }
      ]
    };

    console.log('📝 Creating index for hotspot_loyalty_transactions collection...');
    console.log('Fields:', indexData.fields.map(f => `${f.fieldPath} (${f.order})`).join(', '));
    
    // Note: Firebase Admin SDK doesn't support creating indexes directly
    // This script will provide you with the exact configuration needed
    
    console.log('\n✅ Index configuration ready!');
    console.log('\n📋 To create this index, you need to:');
    console.log('1. Go to Firebase Console: https://console.firebase.google.com/');
    console.log('2. Select project: yabawifiadmin');
    console.log('3. Go to Firestore Database > Indexes tab');
    console.log('4. Click "Create Index"');
    console.log('5. Use these settings:');
    console.log('   - Collection ID: hotspot_loyalty_transactions');
    console.log('   - Fields:');
    console.log('     * userPhone (Ascending)');
    console.log('     * createdAt (Descending)');
    console.log('   - Query scope: Collection');
    
    console.log('\n🔗 Direct link to create index:');
    console.log('https://console.firebase.google.com/v1/r/project/yabawifiadmin/firestore/indexes?create_composite=CmJwcm9qZWN0cy95YWJhd2lmaWFkbWluL2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9ob3RzcG90X2xveWFsdHlfdHJhbnNhY3Rpb25zL2luZGV4ZXMvXxABGg0KCXVzZXJQaG9uZRABGg0KCWNyZWF0ZWRBdBACGgwKCF9fbmFtZV9fEAI');
    
    console.log('\n⏱️  Index creation typically takes 1-5 minutes');
    console.log('📊 You can monitor progress in the Firebase Console');
    
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
  } finally {
    process.exit(0);
  }
}

// Run the script
createLoyaltyIndexes();
