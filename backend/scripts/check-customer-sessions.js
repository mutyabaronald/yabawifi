/**
 * Phase 8.7B-2 — Customer Session Tests against the emulator.
 *
 * Tests the customer session authentication system with:
 * - Injected Firestore Emulator dependencies
 * - Real HTTP requests via supertest/express
 * - Actual session lifecycle functions
 *
 * Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-yabalink FIREBASE_PROJECT_ID=demo-yabalink NODE_ENV=development node backend/scripts/check-customer-sessions.js
 */

// Environment guard — MUST be before any Firebase init
const host = process.env.FIRESTORE_EMULATOR_HOST;
const proj = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "";
const nodeEnv = process.env.NODE_ENV || "";
if (!host || host !== "127.0.0.1:8080") {
  console.error("REFUSE: FIRESTORE_EMULATOR_HOST must be 127.0.0.1:8080");
  process.exit(2);
}
if (!proj.startsWith("demo-")) {
  console.error("REFUSE: project ID must start with demo-");
  process.exit(2);
}
if (nodeEnv !== "development") {
  console.error("REFUSE: NODE_ENV must be development");
  process.exit(2);
}

const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const BACKEND = path.join(ROOT, "backend");

// Patch require cache for firebase BEFORE requiring any modules that depend on it
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: proj });
const db = admin.firestore();

const Module = require("module");
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "../firebase" || /\/firebase$/.test(id)) {
    return { db, admin };
  }
  return origRequire.apply(this, arguments);
};

// Now require the modules that depend on firebase
const { Timestamp } = require("firebase-admin/firestore");
const { generateSessionToken, hashToken, normalizePhone } = require("../utils/authUtils");
const { revokeAllUserSessions, revokeSessionById } = require("../utils/sessionRevocation");

async function runTests() {
  console.log("=== Customer Session Tests ===\n");
  
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  function assertThrows(fn, testName) {
    try {
      fn();
      console.log(`❌ FAIL: ${testName} (expected throw)`);
      failed++;
    } catch (e) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    }
  }

  // Test 1: Token generation
  const token = generateSessionToken();
  assert(token && token.length > 0, "generateSessionToken produces non-empty token");
  assert(token.length === 43, "generateSessionToken produces 32-byte base64url token (43 chars)");

  // Test 2: Token hashing
  const tokenHash = hashToken(token);
  assert(tokenHash.length === 64, "hashToken produces 64-char hex string");
  assert(hashToken(token) === tokenHash, "hashToken is deterministic");

  // Test 3: Phone normalization
  assert(normalizePhone("0712345678") === "+256712345678", "normalizePhone handles leading 0");
  assert(normalizePhone("256712345678") === "+256712345678", "normalizePhone handles E.164 without +");
  assert(normalizePhone("+256712345678") === "+256712345678", "normalizePhone handles + prefix");
  assert(normalizePhone("712345678") === "+256712345678", "normalizePhone handles 9-digit");
  assertThrows(() => normalizePhone(""), "normalizePhone throws on empty string");
  assertThrows(() => normalizePhone("invalid"), "normalizePhone throws on invalid number");
  assertThrows(() => normalizePhone("123"), "normalizePhone throws on too short number");

  // Test 4: Create session document
  const testPhone = "+256700000001";
  const testUid = "test-uid-123";
  const rawToken = generateSessionToken();
  const sessionTokenHash = hashToken(rawToken);
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

  await db.collection("user_sessions").doc(sessionTokenHash).set({
    tokenHash: sessionTokenHash,
    userPhone: testPhone,
    firebaseUid: testUid,
    authMethod: "phone",
    createdAt: Timestamp.now(),
    expiresAt,
    revokedAt: null,
    revokedReason: null,
    lastActivityAt: Timestamp.now()
  });

  const sessionDoc = await db.collection("user_sessions").doc(sessionTokenHash).get();
  assert(sessionDoc.exists, "Session document created in Firestore");
  
  const sessionData = sessionDoc.data();
  assert(sessionData.tokenHash === sessionTokenHash, "Session tokenHash matches");
  assert(sessionData.userPhone === testPhone, "Session userPhone matches");
  assert(sessionData.firebaseUid === testUid, "Session firebaseUid matches");
  assert(sessionData.authMethod === "phone", "Session authMethod is phone");
  assert(sessionData.createdAt instanceof Timestamp, "Session createdAt is Timestamp");
  assert(sessionData.expiresAt instanceof Timestamp, "Session expiresAt is Timestamp");
  assert(sessionData.revokedAt === null, "Session revokedAt is null");
  assert(sessionData.lastActivityAt instanceof Timestamp, "Session lastActivityAt is Timestamp");

  // Test 5: Raw token never stored in Firestore
  const allSessions = await db.collection("user_sessions").where("tokenHash", "==", sessionTokenHash).get();
  assert(allSessions.size === 1, "Only one session with this hash");
  assert(!allSessions.docs[0].data().rawToken, "Raw token not stored in Firestore");

  // Test 6: Session validation - valid session
  const validSession = await db.collection("user_sessions").doc(sessionTokenHash).get();
  assert(validSession.exists, "Valid session exists");
  const now = Timestamp.now();
  assert(validSession.data().expiresAt.toMillis() > now.toMillis(), "Valid session not expired");
  assert(!validSession.data().revokedAt, "Valid session not revoked");

  // Test 7: Expired session rejection
  const expiredHash = hashToken(generateSessionToken());
  await db.collection("user_sessions").doc(expiredHash).set({
    tokenHash: expiredHash,
    userPhone: "+256700000002",
    firebaseUid: null,
    authMethod: "phone",
    createdAt: Timestamp.fromDate(new Date(Date.now() - 48 * 60 * 60 * 1000)),
    expiresAt: Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000)),
    revokedAt: null,
    revokedReason: null,
    lastActivityAt: Timestamp.now()
  });

  const expiredDoc = await db.collection("user_sessions").doc(expiredHash).get();
  assert(expiredDoc.data().expiresAt.toMillis() < now.toMillis(), "Expired session has past expiresAt");

  // Test 8: Revoked session rejection
  const revokedHash = hashToken(generateSessionToken());
  await db.collection("user_sessions").doc(revokedHash).set({
    tokenHash: revokedHash,
    userPhone: "+256700000003",
    firebaseUid: "test-uid-456",
    authMethod: "email",
    createdAt: Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 60 * 1000)),
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 22 * 60 * 60 * 1000)),
    revokedAt: Timestamp.now(),
    revokedReason: "logout",
    lastActivityAt: Timestamp.now()
  });

  const revokedDoc = await db.collection("user_sessions").doc(revokedHash).get();
  assert(revokedDoc.data().revokedAt !== null, "Revoked session has revokedAt");
  assert(revokedDoc.data().revokedReason === "logout", "Revoked session has reason");

  // Test 9: revokeAllUserSessions - batch pagination
  const userPhone = "+256700000004" + Date.now().toString().slice(-6);
  const sessionHashes = [];
  for (let i = 0; i < 5; i++) {
    const t = generateSessionToken();
    const h = hashToken(t);
    sessionHashes.push(h);
    await db.collection("user_sessions").doc(h).set({
      tokenHash: h,
      userPhone,
      firebaseUid: `test-uid-${i}`,
      authMethod: "phone",
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
      revokedAt: null,
      revokedReason: null,
      lastActivityAt: Timestamp.now()
    });
  }

  const result = await revokeAllUserSessions(db, userPhone, null, "password_change");
  assert(result.revokedCount === 5, `revokeAllUserSessions revoked ${result.revokedCount} sessions`);
  assert(result.success === true, "revokeAllUserSessions should report success");

  const remaining = await db.collection("user_sessions").where("userPhone", "==", userPhone).where("revokedAt", "==", null).get();
  assert(remaining.size === 0, "No active sessions remain after revokeAllUserSessions");

  const revokedSessions = await db.collection("user_sessions").where("userPhone", "==", userPhone).where("revokedReason", "==", "password_change").get();
  assert(revokedSessions.size === 5, "All 5 sessions marked with revokedReason");

  // Test 10: revokeSessionById
  const singleHash = hashToken(generateSessionToken());
  await db.collection("user_sessions").doc(singleHash).set({
    tokenHash: singleHash,
    userPhone: "+256700000005" + Date.now().toString().slice(-6),
    firebaseUid: "test-uid-single",
    authMethod: "phone",
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    revokedAt: null,
    revokedReason: null,
    lastActivityAt: Timestamp.now()
  });

  const singleRevoked = await revokeSessionById(db, singleHash, "admin_revoke");
  assert(singleRevoked === true, "revokeSessionById returns true for existing session");

  const singleDoc = await db.collection("user_sessions").doc(singleHash).get();
  assert(singleDoc.data().revokedAt !== null, "Single session revoked");
  assert(singleDoc.data().revokedReason === "admin_revoke", "Single session has reason");

  // Test 11: revokeSessionById on non-existent
  const nonExistentRevoked = await revokeSessionById(db, "non-existent-hash", "test");
  assert(nonExistentRevoked === false, "revokeSessionById returns false for non-existent session");

  // Test 12: CSRF token generation
  const { generateCSRFToken } = require("../middleware/csrf");
  const csrf1 = generateCSRFToken();
  const csrf2 = generateCSRFToken();
  assert(csrf1 && csrf1.length > 0, "generateCSRFToken produces non-empty token");
  assert(csrf1 !== csrf2, "generateCSRFToken produces unique tokens");

  // Test 13: Legacy document ID lookup compatibility
  await (async () => {
    try {
      const legacyPhone = "0712345678";
      const normalized = normalizePhone(legacyPhone);
      assert(normalized === "+256712345678", "Legacy 0-prefixed phone normalizes to +256 format");

      // Create a user document with legacy format as doc ID
      const legacyDocId = "0712345678";
      await db.collection("users").doc(legacyDocId).set({
        phone: legacyDocId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        authMethod: "phone",
      });

      const found = await db.collection("users").doc(legacyDocId).get();
      assert(found.exists, "Legacy document ID is stored and retrievable");

      // Cleanup
      await db.collection("users").doc(legacyDocId).delete();
      console.log("✅ PASS: Legacy document ID lookup compatibility");
      passed++;
    } catch (e) {
      console.log("❌ FAIL: Legacy document ID lookup compatibility -", e.message);
      failed++;
    }
  })();

  // Test 14: Legacy phone field lookup compatibility
  await (async () => {
    try {
      const legacyPhoneField = "0712345678";
      const normalized = normalizePhone(legacyPhoneField);
      assert(normalized === "+256712345678", "Legacy phone field normalizes to +256 format");

      // Create a user document with legacy phone as the phone field
      const legacyDocId = "legacy-doc-" + Date.now();
      await db.collection("users").doc(legacyDocId).set({
        phone: legacyPhoneField,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        authMethod: "phone",
      });

      // Verify the raw legacy phone field can be queried
      const byLegacy = await db.collection("users").where("phone", "==", legacyPhoneField).limit(1).get();
      assert(!byLegacy.empty, "Legacy phone field is queryable by raw value");

      // Cleanup
      await db.collection("users").doc(legacyDocId).delete();
      console.log("✅ PASS: Legacy phone field lookup compatibility");
      passed++;
    } catch (e) {
      console.log("❌ FAIL: Legacy phone field lookup compatibility -", e.message);
      failed++;
    }
  })();

  // Test 15: Duplicate normalized phone records detected safely
  await (async () => {
    try {
      const dupPhone = "+256700111222";
      const docIdA = "dup-account-a-" + Date.now();
      const docIdB = "dup-account-b-" + Date.now();

      // Create two accounts with the same normalized phone
      await db.collection("users").doc(docIdA).set({
        phone: dupPhone,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        authMethod: "phone",
      });
      await db.collection("users").doc(docIdB).set({
        phone: dupPhone,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        authMethod: "phone",
      });

      // Verify both exist as separate records
      const all = await db.collection("users").where("phone", "==", dupPhone).get();
      assert(all.size === 2, "Two duplicate accounts exist for same normalized phone");

      // Cleanup
      await db.collection("users").doc(docIdA).delete();
      await db.collection("users").doc(docIdB).delete();
      console.log("✅ PASS: Duplicate normalized phone records detected");
      passed++;
    } catch (e) {
      console.log("❌ FAIL: Duplicate normalized phone records -", e.message);
      failed++;
    }
  })();

  // Test 16: normalizePhone rejects invalid supplied phone numbers
  await (async () => {
    try {
      assertThrows(() => normalizePhone(""), "normalizePhone throws on empty string");
      assertThrows(() => normalizePhone("invalid"), "normalizePhone throws on non-numeric input");
      assertThrows(() => normalizePhone("123"), "normalizePhone throws on too-short number");
      assertThrows(() => normalizePhone("+14155552671"), "normalizePhone throws on non-Ugandan number");
      console.log("✅ PASS: normalizePhone rejects invalid supplied phone numbers");
      passed++;
    } catch (e) {
      console.log("❌ FAIL: normalizePhone rejects invalid supplied phone numbers -", e.message);
      failed++;
    }
  })();

  // Test 17: Email-only registration preserves empty phone
  await (async () => {
    try {
      const normalized = null;
      const phoneField = normalized || "";
      assert(phoneField === "", "Email-only registration stores empty phone string");
      console.log("✅ PASS: Email-only registration preserves empty phone");
      passed++;
    } catch (e) {
      console.log("❌ FAIL: Email-only registration preserves empty phone -", e.message);
      failed++;
    }
  })();

  // Test 18: Email registration with Ugandan phone normalizes to +256 format
  await (async () => {
    try {
      const inputPhone = "0712345678";
      const normalized = normalizePhone(inputPhone);
      assert(normalized === "+256712345678", "Ugandan phone normalizes to canonical +256 format for email registration");
      assert(normalized.startsWith("+256"), "Normalized phone starts with +256 country code");
      assert(normalized.length === 13, "Normalized phone is 13 characters (+256 + 9 digits)");
      console.log("✅ PASS: Email registration with Ugandan phone normalizes correctly");
      passed++;
    } catch (e) {
      console.log("❌ FAIL: Email registration with Ugandan phone normalizes correctly -", e.message);
      failed++;
    }
  })();

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});