// backend/firebase.js
const admin = require("firebase-admin");

// Use environment variables for production, fallback to serviceAccountKey.json for development
let serviceAccount;

if (process.env.NODE_ENV === "production") {
  // Production: use environment variables
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n") // Replace literal \n with actual newlines
    ?.replace(/"/g, ""); // Remove any quotes

  serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: privateKey,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url:
      process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
    universe_domain: "googleapis.com",
  };
} else {
  // Development: use local serviceAccountKey.json
  serviceAccount = require("./serviceAccountKey.json");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}

const db = admin.firestore();

// Performance optimizations
db.settings({
  // Enable offline persistence for better performance
  ignoreUndefinedProperties: true,
  // Optimize for read performance
  cacheSizeBytes: 50 * 1024 * 1024, // 50MB cache
});

// Connection pooling optimization
const originalGet = db.collection;
db.collection = function (collectionPath) {
  const collection = originalGet.call(this, collectionPath);

  // Add performance monitoring
  const originalGetDocs = collection.get;
  collection.get = function (options) {
    const startTime = Date.now();
    return originalGetDocs.call(this, options).then((snapshot) => {
      const duration = Date.now() - startTime;
      if (duration > 1000) {
        // Log slow queries
        console.warn(
          `Slow Firestore query on ${collectionPath}: ${duration}ms`
        );
      }
      return snapshot;
    });
  };

  return collection;
};

module.exports = { admin, db };
