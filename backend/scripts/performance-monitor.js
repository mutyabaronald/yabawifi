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

async function testLoginPerformance() {
  try {
    console.log("🧪 Testing Login Performance...\n");

    const testPhone = "0712345678";
    const testPassword = "test123";

    // Test 1: Owner Login Performance
    console.log("1. Testing Owner Login Performance...");
    const ownerStart = Date.now();

    try {
      // Test direct document access
      const ownerDoc = await db.collection("owners").doc(testPhone).get();
      const ownerDirectTime = Date.now() - ownerStart;

      if (ownerDoc.exists) {
        console.log(`   ✅ Direct document access: ${ownerDirectTime}ms`);
      } else {
        console.log(`   ⚠️  Document not found, testing query...`);

        const queryStart = Date.now();
        const ownerQuery = db
          .collection("owners")
          .where("ownerPhone", "==", testPhone)
          .limit(1);
        const snapshot = await ownerQuery.get();
        const queryTime = Date.now() - queryStart;

        console.log(`   📊 Query time: ${queryTime}ms`);
        console.log(`   📄 Results: ${snapshot.size} documents`);
      }
    } catch (error) {
      console.log(`   ❌ Owner login test failed: ${error.message}`);
    }

    // Test 2: User Authentication Performance
    console.log("\n2. Testing User Authentication Performance...");
    const userStart = Date.now();

    try {
      // Test direct document access
      const userDoc = await db.collection("users").doc(testPhone).get();
      const userDirectTime = Date.now() - userStart;

      if (userDoc.exists) {
        console.log(`   ✅ Direct document access: ${userDirectTime}ms`);
      } else {
        console.log(`   ⚠️  Document not found, testing query...`);

        const queryStart = Date.now();
        const userQuery = db
          .collection("users")
          .where("phone", "==", testPhone)
          .limit(1);
        const snapshot = await userQuery.get();
        const queryTime = Date.now() - queryStart;

        console.log(`   📊 Query time: ${queryTime}ms`);
        console.log(`   📄 Results: ${snapshot.size} documents`);
      }
    } catch (error) {
      console.log(`   ❌ User auth test failed: ${error.message}`);
    }

    // Test 3: Session Storage Performance
    console.log("\n3. Testing Session Storage Performance...");
    const sessionStart = Date.now();

    try {
      const testToken = "test-token-" + Date.now();
      await db
        .collection("owner_sessions")
        .doc(testToken)
        .set({
          ownerId: "test-owner",
          phone: testPhone,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

      const sessionTime = Date.now() - sessionStart;
      console.log(`   ✅ Session storage: ${sessionTime}ms`);

      // Clean up test session
      await db.collection("owner_sessions").doc(testToken).delete();
    } catch (error) {
      console.log(`   ❌ Session storage test failed: ${error.message}`);
    }

    // Test 4: Index Status Check
    console.log("\n4. Checking Index Requirements...");

    const indexTests = [
      {
        name: "owners_by_phone",
        query: () =>
          db.collection("owners").where("ownerPhone", "==", testPhone).get(),
      },
      {
        name: "users_by_phone",
        query: () =>
          db.collection("users").where("phone", "==", testPhone).get(),
      },
      {
        name: "vouchers_by_code",
        query: () =>
          db.collection("vouchers").where("code", "==", "TEST123").get(),
      },
    ];

    for (const test of indexTests) {
      try {
        const start = Date.now();
        await test.query();
        const duration = Date.now() - start;

        if (duration > 2000) {
          console.log(
            `   ⚠️  ${test.name}: ${duration}ms (SLOW - index may be needed)`
          );
        } else {
          console.log(`   ✅ ${test.name}: ${duration}ms`);
        }
      } catch (error) {
        if (error.code === 9) {
          console.log(`   ❌ ${test.name}: INDEX REQUIRED - ${error.details}`);
        } else {
          console.log(`   ❌ ${test.name}: ${error.message}`);
        }
      }
    }

    console.log("\n📊 Performance Summary:");
    console.log("✅ < 500ms: Excellent");
    console.log("⚠️  500ms - 2s: Acceptable");
    console.log("❌ > 2s: Needs optimization");

    console.log("\n🚀 Recommendations:");
    console.log("1. Create missing Firebase indexes");
    console.log("2. Use phone numbers as document IDs when possible");
    console.log("3. Implement caching for frequently accessed data");
    console.log("4. Use direct document access instead of queries");
  } catch (error) {
    console.error("❌ Performance test failed:", error);
  } finally {
    process.exit(0);
  }
}

// Run the performance test
testLoginPerformance();
