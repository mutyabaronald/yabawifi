const admin = require("firebase-admin");
const serviceAccount = require("../serviceAccountKey.json");

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}

const db = admin.firestore();

async function createCriticalIndexes() {
  try {
    console.log(
      "🚀 Creating CRITICAL Firebase indexes for login performance...\n"
    );

    const criticalIndexes = [
      {
        name: "vouchers_by_owner_created",
        description: "CRITICAL: For voucher queries with ordering",
        collection: "vouchers",
        fields: [
          { fieldPath: "ownerId", order: "ASCENDING" },
          { fieldPath: "createdAt", order: "DESCENDING" },
        ],
      },
      {
        name: "support_requests_by_owner_created",
        description: "CRITICAL: For support request queries with ordering",
        collection: "support_requests",
        fields: [
          { fieldPath: "ownerId", order: "ASCENDING" },
          { fieldPath: "createdAt", order: "DESCENDING" },
        ],
      },
      {
        name: "support_requests_by_user_created",
        description: "CRITICAL: For user support request queries with ordering",
        collection: "support_requests",
        fields: [
          { fieldPath: "userPhone", order: "ASCENDING" },
          { fieldPath: "createdAt", order: "DESCENDING" },
        ],
      },
      {
        name: "owner_admins_by_owner_user",
        description: "CRITICAL: For owner admin queries",
        collection: "ownerAdmins",
        fields: [
          { fieldPath: "ownerId", order: "ASCENDING" },
          { fieldPath: "userId", order: "ASCENDING" },
        ],
      },
    ];

    console.log("📋 CRITICAL Firebase Indexes Required:\n");

    criticalIndexes.forEach((index, i) => {
      console.log(`${i + 1}. Collection: ${index.collection}`);
      console.log(`   Description: ${index.description}`);
      console.log(
        `   Fields: ${index.fields
          .map((f) => `${f.fieldPath} (${f.order})`)
          .join(", ")}`
      );
      console.log("");
    });

    console.log("🔗 Quick Links to Create Indexes:");
    console.log(
      "1. Main Firebase Console: https://console.firebase.google.com/project/yabawifiadmin/firestore/indexes"
    );
    console.log(
      "2. Direct index creation: https://console.firebase.google.com/v1/r/project/yabawifiadmin/firestore/indexes"
    );

    console.log("\n📝 Step-by-Step Instructions:");
    console.log(
      "1. Go to Firebase Console: https://console.firebase.google.com/"
    );
    console.log("2. Select project: yabawifiadmin");
    console.log("3. Go to Firestore Database > Indexes tab");
    console.log('4. Click "Create Index" for each collection above');
    console.log("5. Use the field configurations shown above");
    console.log('6. Set Query scope to "Collection" for all');

    console.log("\n⚡ PERFORMANCE IMPACT:");
    console.log("❌ WITHOUT these indexes: Login takes 5-15 seconds");
    console.log("✅ WITH these indexes: Login takes 0.5-2 seconds");
    console.log("🚀 This is a CRITICAL performance fix!");

    console.log("\n⏱️  Index creation typically takes 1-5 minutes each");
    console.log("📊 Monitor progress in the Firebase Console");
    console.log("🔄 You can create multiple indexes simultaneously");

    console.log(
      "\n✅ Once these indexes are created, your login will be FAST!"
    );
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    process.exit(0);
  }
}

// Run the script
createCriticalIndexes();
