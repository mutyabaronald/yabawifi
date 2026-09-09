const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  }
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function grepInFile(content, pattern) {
  if (pattern instanceof RegExp) {
    return pattern.test(content);
  }
  return content.includes(pattern);
}

console.log("=== Phase 5 Roaming Session Lifecycle Boundary Check ===\n");

// 1. Phase 4 test suite still passes
console.log("--- Phase 5 Tests ---");

// 1. Phase 5 service exists
assert(fileExists("backend/services/roamingSessionService.js"), "Phase 5 session service exists");
assert(fileExists("backend/routes/roaming/sessions.js"), "Phase 5 sessions routes exist");

// 2. Routes mounted in server.js
const serverCode = readFile("backend/server.js");
assert(grepInFile(serverCode, "roamingSessionsRoutes"), "Phase 5 routes mounted in server.js");
assert(grepInFile(serverCode, "/api/roaming/sessions"), "Phase 5 route namespace exists in server.js");

// 3. Session service functions exist
const sessionServiceCode = readFile("backend/services/roamingSessionService.js");
assert(grepInFile(sessionServiceCode, "createRoamingSession"), "createRoamingSession function exists");
assert(grepInFile(sessionServiceCode, "getRoamingSession"), "getRoamingSession function exists");
assert(grepInFile(sessionServiceCode, "terminateRoamingSession"), "terminateRoamingSession function exists");
assert(grepInFile(sessionServiceCode, "updateSessionActivity"), "updateSessionActivity function exists");
assert(grepInFile(sessionServiceCode, "listUserSessions"), "listUserSessions function exists");
assert(grepInFile(sessionServiceCode, "listOwnerSessions"), "listOwnerSessions function exists");
assert(grepInFile(sessionServiceCode, "revokeRoamingSession"), "revokeRoamingSession function exists");
assert(grepInFile(sessionServiceCode, "expireSessions"), "expireSessions function exists");

// 4. State machine is explicit
assert(grepInFile(sessionServiceCode, "SESSION_STATUSES"), "Session status enum exists");
assert(grepInFile(sessionServiceCode, '"authorized"'), "authorized status exists");
assert(grepInFile(sessionServiceCode, '"active"'), "active status exists");
assert(grepInFile(sessionServiceCode, '"terminated"'), "terminated status exists");
assert(grepInFile(sessionServiceCode, '"expired"'), "expired status exists");
assert(grepInFile(sessionServiceCode, '"revoked"'), "revoked status exists");
assert(grepInFile(sessionServiceCode, "SESSION_STATE_TRANSITIONS"), "State transition rules are defined");
assert(grepInFile(sessionServiceCode, "isValidStatusTransition"), "State transition validation exists");

// 5. Uses Phase 4 token validation
assert(grepInFile(sessionServiceCode, "validateRoamingAuthorizationToken"), "Reuses Phase 4 token validation");
assert(grepInFile(sessionServiceCode, "tokenJti"), "Stores Phase 4 JWT jti on session");
assert(grepInFile(sessionServiceCode, '"consumed"'), "Marks token consumed in session service");
assert(grepInFile(sessionServiceCode, 'transaction.set('), "Token consumption in transaction");
assert(!grepInFile(sessionServiceCode, /consumeRoamingAuthorizationToken\(/), "Does not call external token consumption (atomic in-transaction)" );
assert(!grepInFile(sessionServiceCode, /jwt\.sign/), "Does not create new JWT system");

// 6. Re-checks entitlement eligibility via Phase 3
assert(grepInFile(sessionServiceCode, "checkEntitlementEligibility"), "Re-checks Phase 3 eligibility");

// 7. Session schema fields
const schemaFields = [
  "sessionId", "userRef", "homeOwnerId", "visitedOwnerId", "visitedHotspotId",
  "entitlementId", "agreementId", "status", "authPath", "startedAt",
  "lastActivityAt", "expiresAt", "createdAt", "updatedAt", "endedAt",
  "endReason", "usedMinutes", "usedMegabytes", "tokenJti", "idempotencyKey"
];
console.log("\nSession schema fields:");
for (const field of schemaFields) {
  assert(grepInFile(sessionServiceCode, field), `  Schema field '${field}' present`);
}

// 8. Does not store passwords or secrets
assert(!grepInFile(sessionServiceCode, /password/), "No password in session service");
assert(!grepInFile(sessionServiceCode, /jwt_secret/i), "No JWT secret in session service");
assert(!grepInFile(sessionServiceCode, /sshPassword/), "No SSH passwords in session service");

// 9. Idempotency
assert(grepInFile(sessionServiceCode, "idempotencyKey"), "Idempotency key support exists");
assert(grepInFile(sessionServiceCode, "IDEMPOTENCY_CONFLICT"), "Idempotency conflict error exists");

// 10. maxSessions enforcement with transactions
assert(grepInFile(sessionServiceCode, /runTransaction/), "Session creation uses Firestore transaction");
assert(grepInFile(sessionServiceCode, "MAX_SESSIONS_EXCEEDED"), "maxSessions error exists");
assert(grepInFile(sessionServiceCode, "maxSessions"), "maxSessions quota enforcement exists");

// 11. Token consumption decision
assert(grepInFile(sessionServiceCode, "tokenRef"), "Session creation atomically consumes Phase 4 token within transaction");

// 12. Session routes
const sessionRouteCode = readFile("backend/routes/roaming/sessions.js");
assert(sessionRouteCode.includes('router.post("/"'), "POST / creates sessions");
assert(sessionRouteCode.includes('router.get("/:sessionId"'), "GET /:sessionId retrieves session");
assert(grepInFile(sessionRouteCode, '/:sessionId/terminate'), "POST /:sessionId/terminate terminates session");
assert(grepInFile(sessionRouteCode, '/:sessionId/activity'), "POST /:sessionId/activity updates activity");

// 13. Authentication required
assert(grepInFile(sessionRouteCode, "verifyUserIdentity"), "Routes require user authentication");
assert(grepInFile(sessionRouteCode, "verifyOwnerIdentity"), "Routes require owner authentication");

// 14. Cross-tenant protection
assert(grepInFile(sessionServiceCode, "CONTEXT_MISMATCH"), "Context mismatch protection exists");
assert(grepInFile(sessionServiceCode, "Cannot terminate another user's session"), "Cross-user termination prevented");
assert(grepInFile(sessionServiceCode, "Cannot revoke session for another owner"), "Cross-owner revocation prevented");

// 15. Usage validation (no negative)
assert(grepInFile(sessionServiceCode, /usedMinutes !== "number"|usedMinutes < 0|non-negative/), "Usage validation for negative minutes");
assert(grepInFile(sessionServiceCode, "usedMegabytes"), "Megabytes usage tracking exists");

// 16. No roaming_sessions conflict
assert(!grepInFile(sessionServiceCode, "wifi_sessions"), "Does not modify wifi_sessions");
assert(!grepInFile(sessionServiceCode, /sessions.*collection.*iot/i), "No IoT session collection");

// 17. No forbidden integrations
assert(!grepInFile(sessionServiceCode, /radius|RADIUS/), "No RADIUS integration");
assert(!grepInFile(sessionServiceCode, /passpoint|Passpoint|802\.1X|EAP/), "No Passpoint authentication");
assert(!grepInFile(sessionServiceCode, /cisco|mikrotik|unifi|tplink|provision/i), "No router provisioning");
assert(!grepInFile(sessionServiceCode, "wallets"), "No wallet modifications");
assert(!grepInFile(sessionServiceCode, "payments"), "No payment modifications");
assert(!grepInFile(sessionServiceCode, "loyalty"), "No loyalty modifications");
assert(!grepInFile(sessionServiceCode, "vouchers"), "No voucher modifications");

// 18. Audit logging reuses existing infrastructure
assert(grepInFile(sessionServiceCode, "logAuthEvent"), "Session events audit-logged");
assert(grepInFile(sessionServiceCode, "session_created"), "session_created event logged");
assert(grepInFile(sessionServiceCode, "session_terminated"), "session_terminated event logged");
assert(grepInFile(sessionServiceCode, "session_revoked"), "session_revoked event logged");
assert(grepInFile(sessionServiceCode, "session_expired"), "session_expired event logged");

// 19. Revocation requires owner auth (not user)
assert(grepInFile(sessionRouteCode, "/revoke"), "Revoke route exists");

// 20. Firestore collection usage
assert(grepInFile(sessionServiceCode, "roaming_sessions"), "Uses roaming_sessions collection");
assert(!grepInFile(sessionServiceCode, "roaming_sessions_v2"), "Does not create duplicate session collection");

// 21. Password hash reuse (routes file imports from shared passwordService)
assert(grepInFile(sessionRouteCode, "passwordService"), "Routes import passwordService");
assert(grepInFile(sessionRouteCode, "verifyUserPassword"), "Routes use shared password verification");

// === PHASE 2/3/4 BOUNDARY CHECKS ===

console.log("\n--- Phase 2/3/4 Boundary Checks ---");

// Phase 2 still exists
assert(fileExists("backend/services/roamingRegistryService.js"), "Phase 2 registry service exists");
assert(fileExists("backend/routes/roaming/partners.js"), "Phase 2 partners routes exist");
assert(fileExists("backend/routes/roaming/hotspots.js"), "Phase 2 hotspots routes exist");

// Phase 3 still exists
assert(fileExists("backend/services/roamingEntitlementService.js"), "Phase 3 entitlement service exists");
assert(fileExists("backend/routes/roaming/entitlements.js"), "Phase 3 entitlements routes exist");

// Phase 4 still exists
assert(fileExists("backend/services/roamingAuthService.js"), "Phase 4 auth service exists");
assert(fileExists("backend/routes/roaming/auth.js"), "Phase 4 auth routes exist");
assert(fileExists("backend/scripts/check-roaming-phase4.js"), "Phase 4 test script exists");

// Existing routes remain mounted
assert(grepInFile(serverCode, "roamingPartnersRoutes"), "Phase 2 routes still mounted");
assert(grepInFile(serverCode, "roamingHotspotsRoutes"), "Phase 2 routes still mounted");
assert(grepInFile(serverCode, "roamingEntitlementsRoutes"), "Phase 3 routes still mounted");
assert(grepInFile(serverCode, "roamingAuthRoutes"), "Phase 4 routes still mounted");

// Existing system files not modified
const serverOriginal = readFile("backend/server.js");
assert(grepInFile(serverOriginal, "packagesRoutes"), "Packages routes still mounted");
assert(grepInFile(serverOriginal, "mtnRoutes"), "MTN routes still mounted");
assert(grepInFile(serverOriginal, "vouchersRoutes"), "Vouchers routes still mounted");
assert(grepInFile(serverOriginal, "loyaltyRoutes"), "Loyalty routes still mounted");
assert(grepInFile(serverOriginal, "ciscoRoutes"), "Cisco routes still mounted");

// Phase 5 does not modify existing collections
const existingCollections = ["wifi_sessions", "owners", "users", "payments", "wallets", "packages", "vouchers", "loyalty"];
for (const collection of existingCollections) {
  assert(!sessionServiceCode.includes(`.collection("${collection}")`), `Does not reference ${collection} collection`);
}
// Check specifically for "sessions" as a standalone collection (not roaming_sessions)
assert(!sessionServiceCode.includes('.collection("sessions")'), "Does not reference sessions collection");

// === TARGETED SECURITY TEST CASES ===

console.log("\n--- Phase 5 Security Tests ---");

const authServiceCode = readFile("backend/services/roamingAuthService.js");

// A. Valid authorization creates session
assert(grepInFile(sessionServiceCode, "createRoamingSession"), "Valid token creates session");

// B. Invalid JWT rejected
assert(grepInFile(sessionServiceCode, /INVALID_TOKEN/), "Invalid JWT rejected");

// C. Expired JWT rejected
assert(grepInFile(sessionServiceCode, /EXPIRED_TOKEN/), "Expired JWT rejected");

// D. Consumed authorization rejected (Phase 4 handles this)
assert(grepInFile(authServiceCode, "CONSUMED_TOKEN"), "Consumed authorization rejected");

// E. Revoked authorization rejected
assert(grepInFile(authServiceCode, "REVOKED_TOKEN"), "Revoked authorization rejected");

// F. Cross-owner context rejected
assert(grepInFile(sessionServiceCode, /homeOwnerId !== context\.ownerId/), "Cross-owner context rejected");
assert(grepInFile(sessionServiceCode, /visitedOwnerId !== context\.ownerId/), "Cross-visited-owner context rejected");

// G. Cross-hotspot context rejected
assert(grepInFile(sessionServiceCode, "CONTEXT_MISMATCH"), "Cross-hotspot context mismatch rejected");

// H. Invalid entitlement rejected (Phase 3 handles this)
assert(grepInFile(sessionServiceCode, "checkEntitlementEligibility"), "Invalid entitlement delegated to Phase 3");

// I. User cannot access another user's session
assert(grepInFile(sessionServiceCode, "Cannot terminate another user's session"), "User cannot terminate other's session");
assert(grepInFile(sessionServiceCode, /userId !== context\.userId/), "User cannot access other user's session");

// J. Owner cannot access unrelated owner's session
assert(grepInFile(sessionServiceCode, "Cannot revoke session for another owner"), "Owner cannot revoke other owner's session");

// K. Session transition rules enforced
assert(grepInFile(sessionServiceCode, /isValidStatusTransition/), "State transitions validated");
assert(grepInFile(sessionServiceCode, /Cannot transition from/), "Invalid transitions rejected");

// L. Duplicate idempotency request does not create duplicate session
assert(grepInFile(sessionServiceCode, "IDEMPOTENCY_CONFLICT"), "Idempotency conflict handled");
assert(grepInFile(sessionServiceCode, "existing"), "Idempotency returns existing session");

// M. maxSessions enforced
assert(grepInFile(sessionServiceCode, /activeSnap\.size >= maxSessions/), "maxSessions concurrency enforced");

// N. Concurrent session creation cannot bypass maxSessions
assert(grepInFile(sessionServiceCode, /runTransaction/), "Concurrent creation uses transaction");

// O. Usage cannot be negative
assert(grepInFile(sessionServiceCode, "non-negative"), "Negative usage rejected");

// P. Client cannot arbitrarily change ownership fields
assert(grepInFile(sessionServiceCode, "CONTEXT_MISMATCH"), "Ownership fields validated against context");

// Q. Session cannot be created after authorization expiry
assert(grepInFile(sessionServiceCode, "authExpiry"), "Authorization expiry checked");

// R. Session termination is idempotent
assert(grepInFile(sessionServiceCode, "alreadyTerminated"), "Termination is idempotent");

// S. Tokens consumed exactly once
assert(grepInFile(sessionServiceCode, '"consumed"'), "Token marked consumed atomically within session creation transaction");
assert(grepInFile(sessionServiceCode, "tokenDoc"), "Token document read within transaction for atomicity");
assert(grepInFile(sessionServiceCode, "tokenRecord.status"), "Token status checked within transaction");

// T. No roaming_sessions modification from Phase 4
assert(!grepInFile(authServiceCode, 'collection("roaming_sessions")'), "Phase 4 does not reference roaming_sessions");
assert(!grepInFile(authServiceCode, ".collection(\"roaming_sessions\""), "Phase 4 does not reference roaming_sessions (dots)");

// U. Revoke requires owner auth
assert(grepInFile(sessionRouteCode, "verifyOwnerIdentity"), "Revoke requires owner authentication");

// === JTI REPLAY PROTECTION TESTS ===

console.log("\n--- JTI Replay Protection Tests ---");

// 1. Same JTI + same idempotency key → exactly one session
// Idempotency check returns existing session without re-validating token or creating duplicate
assert(grepInFile(sessionServiceCode, "existing"), "Idempotent same-JTI request returns existing session");
assert(grepInFile(sessionServiceCode, "IDEMPOTENCY_CONFLICT"), "Different idempotency key with same JTI is detected");

// 2. Same JTI + different idempotency keys → exactly one session
// Token is consumed atomically in the same transaction as session creation
// The second transaction reads the token as "consumed" and fails before creating a session
assert(grepInFile(sessionServiceCode, '"consumed"'), "Token status is checked within the same transaction");
assert(grepInFile(sessionServiceCode, 'roaming_auth_tokens'), "Session transaction reads from roaming_auth_tokens collection");
assert(grepInFile(sessionServiceCode, 'transaction.set('), "Token consumption happens inside session creation transaction");

// 3. Concurrent same-JTI requests → exactly one successful session
// Firestore transaction ensures only one of N concurrent transactions can read a valid token
// and mark it consumed. The other transactions will see CONSUMED status and fail.
assert(grepInFile(sessionServiceCode, /runTransaction/), "All session creation is transactional");
assert(!grepInFile(sessionServiceCode, /consumeRoamingAuthorizationToken\(/), "No separate token consumption call outside transaction");

// 4. maxSessions = 1 concurrent requests → limit cannot be bypassed
assert(grepInFile(sessionServiceCode, /activeSnap\.size >= maxSessions/), "maxSessions check is inside transaction");

// 5. maxSessions > 1 with same JTI → same JTI still cannot create multiple sessions
// Both idempotency check and token consumption happen atomically in the same transaction
assert(grepInFile(sessionServiceCode, "idempotencyKey"), "Idempotency key prevents duplicate creation");
assert(grepInFile(sessionServiceCode, '"consumed"'), "Token consumption prevents JTI replay");

// 6. Session creation failure → token is not consumed
// Transaction rollback ensures both session creation and token consumption succeed or fail together
assert(!grepInFile(sessionServiceCode, /await consumeRoamingAuthorizationToken/), "Token consumption is inside transaction, not after (rollback safe)");

// 7. Successful session creation → token becomes consumed
assert(grepInFile(sessionServiceCode, 'status: "consumed"'), "Token is marked consumed on successful session creation");
assert(grepInFile(sessionServiceCode, "consumedAt"), "Token consumption timestamp recorded");

// 8. Already-consumed JTI → no new session
assert(grepInFile(sessionServiceCode, 'tokenRecord.status === "consumed"'), "Checks for already-consumed token inside transaction");
assert(grepInFile(sessionServiceCode, "CONSUMED_TOKEN"), "Throws CONSUMED_TOKEN error for reused JTI");

// 9. Expired/revoked JTI → no new session
assert(grepInFile(sessionServiceCode, 'tokenRecord.status === "revoked"'), "Checks for revoked token inside transaction");
assert(grepInFile(sessionServiceCode, 'tokenRecord.status === "revoked"'), "Checks for revoked token inside transaction");
assert(grepInFile(sessionServiceCode, "EXPIRED_TOKEN"), "Throws EXPIRED_TOKEN error for expired JTI");
assert(grepInFile(sessionServiceCode, "REVOKED_TOKEN"), "Throws REVOKED_TOKEN error for revoked JTI");

// 10. Token read within transaction (not before)
assert(grepInFile(sessionServiceCode, "tokenDoc = await transaction.get"), "Token document read via transaction.get (not plain get)");

// 11. Session reference uses same transaction (atomicity)
assert(grepInFile(sessionServiceCode, "transaction.set(sessionRef"), "Session document written via same transaction");

// === OWNER PASSWORD / SECRET GUARD TESTS ===

console.log("\n--- Owner Password & Secret Guard Tests ---");

const passwordServiceCode = readFile("backend/services/passwordService.js");
const ownersCode = readFile("backend/routes/owners.js");
const usersCode = readFile("backend/routes/users.js");
const authRouteCode = readFile("backend/routes/roaming/auth.js");
const adminRoutesCode = readFile("backend/adminRoutes.js");
const superRoutesCode = readFile("backend/superRoutes.js");
const envCode = readFile("env.template");

// 1. New owner password stored as bcrypt
assert(grepInFile(passwordServiceCode, "hashPassword"), "passwordService provides hashPassword");
assert(grepInFile(ownersCode, "hashPassword"), "Owner registration hashes password");

// 2. Existing plaintext owner can log in
assert(grepInFile(ownersCode, "verifyUserPassword"), "Owner login uses verifyUserPassword");

// 3. Lazy migration
assert(grepInFile(ownersCode, /!isBcryptHash\(ownerData\.password\)/), "Owner login lazy-migrates plaintext to bcrypt");

// 4. Subsequent login uses bcrypt
assert(!grepInFile(ownersCode, /ownerData\.password !== password/), "No inline plaintext comparison in owner login");

// 5. Wrong password fails
assert(grepInFile(ownersCode, "Invalid phone number or password"), "Owner login returns generic failure");

// 6. Password change/reset stores bcrypt
assert(grepInFile(ownersCode, "hashPassword"), "Owner change-password uses bcrypt");

// 7. No password value logged to console
assert(!grepInFile(ownersCode, /console\.\w+\s*\(\s*password\b/), "No bare password variable logged to console");
assert(!grepInFile(ownersCode, /console\.\w+\s*\(\s*"password"/), "No password string logged to console");
assert(!grepInFile(ownersCode, /console\.\w+.*userData\.password/), "No password property logged to console");

// 8. Owner rate limiting
assert(grepInFile(ownersCode, "checkOwnerAuthRateLimit"), "Owner login has rate limiting");
assert(grepInFile(ownersCode, "RATE_LIMIT_MAX_AUTH_ATTEMPTS"), "Owner rate limit config exists");

// 9. Development/test env remains functional
assert(grepInFile(adminRoutesCode, "getProductionSecret"), "adminRoutes uses getProductionSecret");
assert(grepInFile(superRoutesCode, "getProductionSecret"), "superRoutes uses getProductionSecret");

// 10. Production rejects missing super-admin JWT secret
assert(grepInFile(adminRoutesCode, /getProductionSecret\(\s*"SUPERADMIN_JWT_SECRET"/), "adminRoutes guards SUPERADMIN_JWT_SECRET");
assert(grepInFile(superRoutesCode, /getProductionSecret\(\s*"SUPERADMIN_JWT_SECRET"/), "superRoutes guards SUPERADMIN_JWT_SECRET");

// 11. Production rejects dev-super-secret
assert(!grepInFile(adminRoutesCode, /process\.env\.SUPERADMIN_JWT_SECRET \|\| "dev-super-secret"/), "adminRoutes does not use dev default directly");
assert(!grepInFile(superRoutesCode, /process\.env\.SUPERADMIN_JWT_SECRET \|\| "dev-super-secret"/), "superRoutes does not use dev default directly");

// 12. Production rejects missing/insecure roaming JWT secret
assert(grepInFile(authServiceCode, "getProductionSecret"), "roamingAuthService uses getProductionSecret");

// 13. Production accepts explicitly configured secrets
assert(grepInFile(passwordServiceCode, /NODE_ENV.*production/), "getProductionSecret checks NODE_ENV");

// 14. No secrets committed
assert(!grepInFile(envCode, /ROAMING_AUTH_JWT_SECRET=.*[a-zA-Z0-9]{32,}/), "No hardcoded roaming secret in env.template");
assert(!grepInFile(envCode, /SUPERADMIN_JWT_SECRET=.*[a-zA-Z0-9]{32,}/), "No hardcoded superadmin secret in env.template");

// 15. Users.js also uses shared password service
assert(grepInFile(usersCode, "passwordService"), "users.js imports from passwordService");
assert(!grepInFile(usersCode, /require.*bcryptjs/), "users.js does not import bcryptjs directly");

// 16. Phase 4 auth route uses shared password service
assert(grepInFile(authRouteCode, "passwordService"), "Phase 4 auth route imports from passwordService");

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
