// backend/firebase.js
// Force Firestore to prefer REST over gRPC (helps in restricted networks)
process.env.FIRESTORE_PREFER_REST = process.env.FIRESTORE_PREFER_REST || "1";
process.env.GOOGLE_CLOUD_DISABLE_GRPC =
  process.env.GOOGLE_CLOUD_DISABLE_GRPC || "1";

const admin = require("firebase-admin");
const { Firestore } = require("@google-cloud/firestore");

// Use environment variables for production, fallback to serviceAccountKey.json for development
let serviceAccount;

/**
 * Normalize a private key string from environment variable.
 * Handles multiple escaping scenarios:
 * - Literal \n sequences (escaped newlines)
 * - Actual newlines (already correct)
 * - Windows \r\n line endings
 * - Surrounding quotes
 * - Extra whitespace
 * Validates PEM structure before returning.
 */
function normalizePrivateKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") {
    throw new Error("FIREBASE_PRIVATE_KEY is missing or not a string");
  }

  // Remove surrounding quotes if present
  let key = rawKey.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }

  // Replace escaped newline sequences (\n) with actual newlines
  // This handles both \\n and \n in the raw string
  key = key.replace(/\\n/g, "\n");

  // Normalize Windows line endings
  key = key.replace(/\r\n/g, "\n");

  // Trim whitespace again after replacements
  key = key.trim();

  // Validate PEM structure
  const beginMarker = "-----BEGIN PRIVATE KEY-----";
  const endMarker = "-----END PRIVATE KEY-----";

  if (!key.includes(beginMarker) || !key.includes(endMarker)) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY does not appear to be a valid PEM private key. " +
      "Expected '-----BEGIN PRIVATE KEY-----' and '-----END PRIVATE KEY-----' boundaries."
    );
  }

  // Ensure proper line breaks around markers for OpenSSL compatibility
  // Some environments concatenate everything on one line
  key = key
    .replace(new RegExp(beginMarker.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&") + "\\s*"), beginMarker + "\n")
    .replace(new RegExp("\\s*" + endMarker.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")), "\n" + endMarker);

  // Ensure the key body has line breaks (OpenSSL expects max 64 chars per line)
  // Split into header, body, footer
  const beginIndex = key.indexOf(beginMarker);
  const endIndex = key.indexOf(endMarker);
  const header = key.substring(0, beginIndex + beginMarker.length);
  const footer = key.substring(endIndex);
  let body = key.substring(beginIndex + beginMarker.length, endIndex).trim();

  // If body doesn't have newlines, it might be a single-line base64 string
  // Re-wrap to 64 chars per line for OpenSSL compatibility
  if (!body.includes("\n") && body.length > 0) {
    const wrapped = body.match(/.{1,64}/g);
    if (wrapped) {
      body = "\n" + wrapped.join("\n") + "\n";
    }
  } else if (body.includes("\n")) {
    // Ensure body starts and ends with newline
    body = "\n" + body.trim() + "\n";
  }

  return header + body + footer;
}

// Check if we have all required environment variables for production
const hasAllEnvVars =
  process.env.FIREBASE_PRIVATE_KEY &&
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL;

if (process.env.NODE_ENV === "production" && hasAllEnvVars) {
  // Production: use environment variables
  let privateKey;
  try {
    privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  } catch (e) {
    console.error("Failed to parse FIREBASE_PRIVATE_KEY:", e.message);
    throw new Error("Invalid FIREBASE_PRIVATE_KEY format: " + e.message);
  }

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
  try {
    serviceAccount = require("./serviceAccountKey.json");
    console.log(
      "Using local serviceAccountKey.json for Firebase configuration",
    );
  } catch (error) {
    console.error("Error loading serviceAccountKey.json:", error.message);
    throw new Error(
      "Firebase service account key not found. Please ensure serviceAccountKey.json exists in the backend directory.",
    );
  }
}

if (!admin.apps.length) {
  console.log(
    "Initializing Firebase with project ID:",
    serviceAccount.project_id,
  );
  console.log("Service account has private_key:", !!serviceAccount.private_key);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });

  console.log("Firebase initialized successfully");
}

const db = admin.firestore();

// Performance optimizations
db.settings({
  preferRest: true,
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
          `Slow Firestore query on ${collectionPath}: ${duration}ms`,
        );
      }
      return snapshot;
    });
  };

  return collection;
};

module.exports = { admin, db };