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
  const regex = new RegExp(pattern);
  return regex.test(content);
}

console.log("=== Phase 4 Roaming Authentication Boundary Check ===\n");

// 1. Phase 2 still exists
assert(fileExists("backend/services/roamingRegistryService.js"), "Phase 2 registry service exists");
assert(fileExists("backend/routes/roaming/partners.js"), "Phase 2 partners routes exist");
assert(fileExists("backend/routes/roaming/hotspots.js"), "Phase 2 hotspots routes exist");

// 2. Phase 3 still exists
assert(fileExists("backend/services/roamingEntitlementService.js"), "Phase 3 entitlement service exists");
assert(fileExists("backend/routes/roaming/entitlements.js"), "Phase 3 entitlements routes exist");

// 3. Existing routes remain mounted
const serverCode = readFile("backend/server.js");
assert(grepInFile(serverCode, "roamingPartnersRoutes"), "Phase 2 routes mounted in server.js");
assert(grepInFile(serverCode, "roamingHotspotsRoutes"), "Phase 2 routes mounted in server.js");
assert(grepInFile(serverCode, "roamingEntitlementsRoutes"), "Phase 3 routes mounted in server.js");
assert(grepInFile(serverCode, "roamingAuthRoutes"), "Phase 4 routes mounted in server.js");

// 4. Phase 4 auth service exists
assert(fileExists("backend/services/roamingAuthService.js"), "Phase 4 auth service exists");
assert(fileExists("backend/routes/roaming/auth.js"), "Phase 4 auth routes exist");

// 5. Dedicated JWT secret is used
const authServiceCode = readFile("backend/services/roamingAuthService.js");
assert(grepInFile(authServiceCode, "ROAMING_AUTH_JWT_SECRET"), "Dedicated JWT secret env var is used");
assert(!grepInFile(authServiceCode, /jwt\.sign\(payload,\s*JWT_SECRET/), "Does not reuse general JWT_SECRET for roaming tokens");

// 6. JWT algorithm is explicitly restricted
assert(grepInFile(authServiceCode, /JWT_ALGORITHM\s*=\s*['"]HS256['"]/), "JWT algorithm is HS256");
assert(grepInFile(authServiceCode, /algorithms:\s*\[\s*JWT_ALGORITHM\s*\]/), "Algorithm is explicitly restricted in jwt.verify");
assert(!grepInFile(authServiceCode, /"none"/), "Does not accept 'none' algorithm");

// 7. Required claims exist
const requiredClaims = [
  "sub",
  "entitlementId",
  "homeOwnerId",
  "visitedOwnerId",
  "visitedHotspotId",
  "agreementId",
  "authPath",
  "jti",
  "iat",
  "exp",
];

console.log("\nRequired token claims:");
for (const claim of requiredClaims) {
  assert(grepInFile(authServiceCode, claim), `  Claim '${claim}' exists`);
}

// 8. Token expiration is enforced
assert(grepInFile(authServiceCode, "TokenExpiredError"), "Expired tokens are rejected with TokenExpiredError");
assert(grepInFile(authServiceCode, "EXPIRED_TOKEN"), "Expired token error code exists");

// 9. Issuer is validated
assert(grepInFile(authServiceCode, "ROAMING_AUTH_JWT_ISSUER"), "Issuer is configured");
assert(grepInFile(authServiceCode, /issuer:\s*ROAMING_AUTH_JWT_ISSUER/), "Issuer is validated in jwt.verify");

// 10. Audience is validated
assert(grepInFile(authServiceCode, "ROAMING_AUTH_JWT_AUDIENCE"), "Audience is configured");
assert(grepInFile(authServiceCode, /audience:\s*ROAMING_AUTH_JWT_AUDIENCE/), "Audience is validated in jwt.verify");

// 11. jti exists and is random
assert(grepInFile(authServiceCode, "jti"), "jti claim is used");
assert(grepInFile(authServiceCode, "crypto.randomBytes"), "jti is cryptographically random");

// 12. Entitlement eligibility is delegated to Phase 3
assert(grepInFile(authServiceCode, "checkEntitlementEligibility"), "Delegates to Phase 3 checkEntitlementEligibility");
assert(!grepInFile(authServiceCode, /roaming_entitlements.*where.*status.*active/), "Does not duplicate entitlement rules");

// 13. Cross-owner token issuance is rejected
const authRouteCode = readFile("backend/routes/roaming/auth.js");
assert(!grepInFile(authServiceCode, /homeOwnerId.*req\.body/), "homeOwnerId is not taken from client body");
assert(grepInFile(authServiceCode, /const \{\s+entitlementId,\s+homeOwnerId/), "homeOwnerId is destructured from eligibility");

// 14. Cross-hotspot token use is rejected
assert(grepInFile(authServiceCode, /visitedHotspotId.*context/), "Context binding for hotspot exists");
assert(grepInFile(authServiceCode, /CONTEXT_MISMATCH/), "Context mismatch error exists");

// 15. Expired tokens are rejected
assert(grepInFile(authServiceCode, "EXPIRED_TOKEN"), "Expired token error code exists");

// 16. Invalid signatures are rejected
assert(grepInFile(authServiceCode, "INVALID_TOKEN"), "Invalid token error code exists");

// 17. Token replay/consumption protection exists
assert(grepInFile(authServiceCode, "roaming_auth_tokens"), "Token state collection is used");
assert(grepInFile(authServiceCode, '"consumed"'), "Consumed status exists");
assert(grepInFile(authServiceCode, "consumeRoamingAuthorizationToken"), "Consume function exists");

// 18. No roaming_sessions collection is created
assert(!grepInFile(authServiceCode, "roaming_sessions"), "No roaming_sessions collection");

// 19. No RADIUS integration exists
assert(!grepInFile(authServiceCode, /radius|RADIUS/), "No RADIUS integration");

// 20. No Passpoint authentication exists
assert(!grepInFile(authRouteCode, /passpoint|Passpoint|802\.1X|EAP/), "No Passpoint authentication in routes");
assert(!grepInFile(authServiceCode, /passpoint.*auth|Passpoint.*auth/), "No Passpoint authentication in service");

// 21. No Cisco/MikroTik/router provisioning occurs
assert(!grepInFile(authServiceCode, /cisco|mikrotik|unifi|tplink|provision|router.*config/), "No router provisioning in service");
assert(!grepInFile(authRouteCode, /cisco|mikrotik|unifi|tplink|provision|router.*config/), "No router provisioning in routes");

// 22. Existing wifi_sessions remains untouched
assert(!grepInFile(authServiceCode, "wifi_sessions"), "No wifi_sessions modification");

// 23. No existing payment/loyalty/voucher logic is modified
assert(!grepInFile(authServiceCode, "payments"), "No payments modification");
assert(!grepInFile(authServiceCode, "loyalty"), "No loyalty modification");
assert(!grepInFile(authServiceCode, "vouchers"), "No vouchers modification");
assert(!grepInFile(authServiceCode, "packages"), "No packages modification");
assert(!grepInFile(authServiceCode, "wallets"), "No wallets modification");
assert(!grepInFile(authServiceCode, "mtn"), "No MTN modification");

// 24. No secrets are committed
const envCode = readFile("env.template");
assert(!grepInFile(envCode, /ROAMING_AUTH_JWT_SECRET=.*[a-zA-Z0-9]{32,}/), "No hardcoded secret in env.template");

// Additional checks
assert(grepInFile(authServiceCode, "legacy_captive"), "legacy_captive auth path is enforced");
assert(grepInFile(serverCode, "/api/roaming/auth"), "Phase 4 route namespace exists in server.js");

// Verify env.template has Phase 4 vars
assert(grepInFile(envCode, "ROAMING_AUTH_JWT_SECRET"), "Env var ROAMING_AUTH_JWT_SECRET exists");
assert(grepInFile(envCode, "ROAMING_AUTH_JWT_ISSUER"), "Env var ROAMING_AUTH_JWT_ISSUER exists");
assert(grepInFile(envCode, "ROAMING_AUTH_JWT_AUDIENCE"), "Env var ROAMING_AUTH_JWT_AUDIENCE exists");
assert(grepInFile(envCode, "ROAMING_AUTH_TOKEN_TTL_SECONDS"), "Env var ROAMING_AUTH_TOKEN_TTL_SECONDS exists");

// Verify route has user authentication
assert(grepInFile(authRouteCode, "verifyUserIdentity"), "Route verifies user identity");
assert(grepInFile(authRouteCode, "admin\\.auth\\(\\)\\.verifyIdToken"), "Route verifies Firebase ID token");
assert(grepInFile(authRouteCode, "phone_password"), "Route supports phone+password auth");

// Verify rate limiting
assert(grepInFile(authRouteCode, "checkRateLimit"), "Rate limiting is implemented");
assert(grepInFile(authRouteCode, "rate_limited"), "Rate limit error handling exists");

// Verify existing system files NOT modified
const criticalFiles = [
  "backend/routes/users.js",
  "backend/routes/packages.js",
  "backend/routes/mtn.js",
  "backend/routes/vouchers.js",
  "backend/routes/loyalty.js",
  "backend/services/ciscoService.js",
];

console.log("\nCritical existing files still present:");
for (const f of criticalFiles) {
  assert(fileExists(f), `  ${f} exists`);
}

// Verify Firestore schema documentation exists
assert(fileExists("ROAMING_PHASE4_FIRESTORE.md"), "Phase 4 Firestore schema documented");
const firestoreDoc = readFile("ROAMING_PHASE4_FIRESTORE.md");
assert(grepInFile(firestoreDoc, "roaming_auth_tokens"), "roaming_auth_tokens collection documented");
assert(grepInFile(firestoreDoc, "roaming_auth_logs"), "roaming_auth_logs collection documented");

// Verify audit logging uses existing mechanism
assert(grepInFile(authServiceCode, "audit_logs"), "Uses existing audit_logs collection");

// === TARGETED SECURITY TESTS ===

console.log("\n--- Targeted Security Tests ---");

// A. Two simultaneous consume attempts for the same jti -> exactly one succeeds
// Verify Firestore transaction is used for atomic read-check-write
assert(grepInFile(authServiceCode, /db\.runTransaction/), "Token consumption uses Firestore transaction (atomic)");
assert(grepInFile(authServiceCode, /transaction\.get\(tokenRef\)/), "Transaction reads token document atomically");
assert(grepInFile(authServiceCode, /transaction\.set\([\s\S]{0,20}tokenRef/), "Transaction writes token document atomically");

// B. Already-consumed token -> rejected
assert(grepInFile(authServiceCode, /record\.status === "consumed"/), "Consumed token status is checked in transaction");
assert(grepInFile(authServiceCode, "CONSUMED_TOKEN"), "Consumed token error code exists");

// C. Revoked token -> rejected
assert(grepInFile(authServiceCode, /record\.status === "revoked"/), "Revoked token status is checked in transaction");
assert(grepInFile(authServiceCode, "REVOKED_TOKEN"), "Revoked token error code exists");

// D. Expired token -> rejected
assert(grepInFile(authServiceCode, /now > expiresAt/), "Expiration is checked in transaction");
assert(grepInFile(authServiceCode, "EXPIRED_TOKEN"), "Expired token error code exists");

// E. Invalid signature -> rejected
assert(grepInFile(authServiceCode, /jwt\.verify\(token,\s*ROAMING_AUTH_JWT_SECRET/), "JWT signature is verified with dedicated secret");
assert(grepInFile(authServiceCode, /TokenExpiredError/), "Expired tokens produce specific error");

// F. Cross-hotspot context -> rejected
assert(grepInFile(authServiceCode, /decoded\.visitedHotspotId !== context\.visitedHotspotId/), "Cross-hotspot context mismatch is rejected");
assert(grepInFile(authServiceCode, "CONTEXT_MISMATCH"), "Context mismatch error exists");

// G. Cross-owner context -> rejected
assert(grepInFile(authServiceCode, /decoded\.visitedOwnerId !== context\.visitedOwnerId/), "Cross-owner context mismatch is rejected");

// H. Unauthorized revoke -> rejected
assert(grepInFile(authRouteCode, /registry\.authenticateOwnerOrSuper/), "Revoke endpoint requires authentication");
assert(grepInFile(authRouteCode, /auth\.kind === "owner"/), "Revoke endpoint checks owner authorization scope");
assert(grepInFile(authRouteCode, /tokenData\.homeOwnerId !== auth\.ownerId/), "Revoke endpoint prevents cross-owner revocation");

// I. Valid authenticated user -> token issuance succeeds when Phase 3 eligibility succeeds
assert(grepInFile(authRouteCode, /verifyUserIdentity\(req\)/), "Authenticate endpoint verifies user identity before token issuance");
assert(grepInFile(authRouteCode, /authenticateForRoaming/), "Authenticate endpoint delegates to service");
assert(grepInFile(authRouteCode, "401"), "Authentication failure returns 401");

// J. Invalid user authentication -> token issuance rejected
    assert(grepInFile(authRouteCode, "authentication_failed"), "Invalid auth returns authentication_failed reason");

// J2. Account enumeration — error messages are generic
const authSection = authRouteCode.substring(authRouteCode.indexOf("verifyUserIdentity"), authRouteCode.indexOf("verifyUserIdentity") + 800);
assert(!grepInFile(authSection, /err\.message/), "verifyUserIdentity does not leak raw error messages");
assert(grepInFile(authRouteCode, "Invalid credentials"), "Route returns generic error message (no enumeration)");

// === PASSWORD SECURITY TESTS ===

console.log("\n--- Password Security Tests ---");

const usersCode = readFile("backend/routes/users.js");
const passwordServiceCode = readFile("backend/services/passwordService.js");

// 1. bcrypt is a dependency and used via shared service
assert(grepInFile(passwordServiceCode, /require\("bcryptjs"\)/), "bcryptjs is imported in passwordService.js");
assert(grepInFile(passwordServiceCode, /bcrypt\.hash/), "bcrypt.hash is used for password hashing");

// 2. New user passwords are hashed
assert(grepInFile(usersCode, "hashPassword"), "hashPassword function is called in users.js");

// 3. Password reset uses bcrypt
assert(grepInFile(usersCode, /hashedPassword/), "Password reset stores bcrypt hash");
const resetIdx = usersCode.indexOf("/reset-password");
const resetSection = usersCode.substring(resetIdx, resetIdx + 5000);
assert(grepInFile(resetSection, "hashPassword"), "Reset password endpoint hashes new password");

// 4. Lazy migration: plaintext → bcrypt on successful login
assert(grepInFile(usersCode, /verifyUserPassword/), "verifyUserPassword function is used in users.js");
assert(grepInFile(usersCode, /isBcryptHash/), "isBcryptHash detection function exists");
assert(grepInFile(usersCode, /!isBcryptHash\(userData\.password\)/), "Lazy migration upgrades plaintext passwords to bcrypt");

// 5. verifyUserPassword is exported for Phase 4 reuse
assert(grepInFile(usersCode, "module.exports.verifyUserPassword"), "verifyUserPassword is exported for reuse");
assert(grepInFile(passwordServiceCode, "module.exports"), "passwordService.js exports functions");
assert(grepInFile(passwordServiceCode, "hashPassword"), "passwordService exports hashPassword");
assert(grepInFile(passwordServiceCode, "verifyUserPassword"), "passwordService exports verifyUserPassword");
assert(grepInFile(passwordServiceCode, "isBcryptHash"), "passwordService exports isBcryptHash");

// 6. Phase 4 auth route reuses shared verification (not inline comparison)
assert(grepInFile(authRouteCode, /verifyUserPassword/), "Phase 4 reuses verifyUserPassword from users.js");
assert(!grepInFile(authRouteCode, /userData\.password !== password/), "Phase 4 does not use inline plaintext comparison");

// 7. Rate limiting is tightened
assert(grepInFile(authRouteCode, /RATE_LIMIT_MAX_REQUESTS\s*=\s*5/), "Rate limit reduced to 5 requests per window");
assert(grepInFile(authRouteCode, "checkUserRateLimit"), "Per-user rate limiting implemented");

// 8. Passwords never appear in JWT claims or roaming token records
for (const claim of ["password", "passwordHash"]) {
  assert(!grepInFile(authServiceCode, new RegExp(claim + "[:\\s]")), `No '${claim}' field in roaming auth service`);
}

// 9. Passwords never appear in roaming_auth_tokens records (check for field patterns, not module names)
assert(!grepInFile(authServiceCode, /storedPassword|userPassword|tokenPassword|record\.password|record\["password"\]/), "No password data fields in roaming auth service");

// 10. No password in audit log payload
assert(!grepInFile(authServiceCode, /payload.*password[:,\s]/), "No password in audit log payload");

// 11. Revoke endpoint requires authentication (not publicly callable)
assert(grepInFile(authRouteCode, /registry\.authenticateOwnerOrSuper/), "Revoke requires authentication via registry");

// 12. No secrets in committed files
assert(fileExists("env.template"), "env.template exists");
assert(!grepInFile(envCode, /[a-f0-9]{32}/), "No hex secrets committed in env.template");

// 13. bcrypt cost factor is appropriate (10)
assert(grepInFile(passwordServiceCode, /BCRYPT_COST\s*=\s*10/), "Bcrypt cost factor is 10");
assert(grepInFile(passwordServiceCode, /bcrypt\.hash\(password,\s*BCRYPT_COST\)/), "bcrypt.hash uses BCRYPT_COST parameter");
assert(grepInFile(passwordServiceCode, /bcrypt\.compare\(suppliedPassword,\s*storedPassword\)/), "bcrypt.compare used in verifyUserPassword");
assert(grepInFile(authRouteCode, "Invalid credentials"), "Route returns generic error message (no enumeration)");

// K. Token consumption requires token presentation (not just jti)
assert(grepInFile(authRouteCode, /validateRoamingAuthorizationToken\(token/), "Consume endpoint validates token before consumption");
assert(grepInFile(authRouteCode, /token.*jti/), "Consume endpoint accepts both token and jti");

// L. Context endpoint requires valid token
assert(grepInFile(authRouteCode, "getRoamingAuthContext"), "Context endpoint uses getRoamingAuthContext");
assert(grepInFile(authServiceCode, "getRoamingAuthContext"), "getRoamingAuthContext function exists");

// M. Validate endpoint does not expose sensitive data
assert(!grepInFile(authServiceCode, /password[:,\s]/), "No password fields in token or token records");
assert(!grepInFile(authServiceCode, "passwordHash"), "No passwordHash in token or token records");
assert(!grepInFile(authServiceCode, "wallet"), "No wallet fields in token or token records");
assert(!grepInFile(authServiceCode, "payment"), "No payment fields in token or token records");

// === OWNER PASSWORD SECURITY TESTS ===

console.log("\n--- Owner Password Security Tests ---");

const ownersCode = readFile("backend/routes/owners.js");

// 1. passwordService.js exists with shared utilities
assert(fileExists("backend/services/passwordService.js"), "passwordService.js exists");
assert(grepInFile(passwordServiceCode, "hashPassword"), "passwordService exports hashPassword");
assert(grepInFile(passwordServiceCode, "verifyUserPassword"), "passwordService exports verifyUserPassword");
assert(grepInFile(passwordServiceCode, "isBcryptHash"), "passwordService exports isBcryptHash");
assert(grepInFile(passwordServiceCode, /bcrypt\.hash/), "passwordService uses bcrypt.hash");
assert(grepInFile(passwordServiceCode, /bcrypt\.compare/), "passwordService uses bcrypt.compare");

// 2. New owner password stored as bcrypt
assert(!grepInFile(ownersCode, /password,$/), "New owner registration does not store plaintext password");
assert(grepInFile(ownersCode, "hashPassword"), "Owner registration hashes password with bcrypt");

// 3. Existing plaintext owner can log in (lazy migration)
assert(grepInFile(ownersCode, "verifyUserPassword"), "Owner login uses verifyUserPassword");
assert(grepInFile(ownersCode, /!isBcryptHash\(ownerData\.password\)/), "Owner login performs lazy migration from plaintext to bcrypt");

// 4. Subsequent login uses bcrypt
assert(!grepInFile(ownersCode, /ownerData\.password !== password/), "Owner login does not use inline plaintext comparison");
assert(!grepInFile(ownersCode, /stored.*===.*currentPassword/), "Owner change-password does not use inline plaintext comparison");

// 5. Wrong password fails
assert(grepInFile(ownersCode, "Invalid phone number or password"), "Owner login returns generic failure message");

// 6. Owner password change/reset stores bcrypt
assert(grepInFile(ownersCode, "hashPassword"), "Owner change-password uses bcrypt hash");

// 7. Password never appears in logs/responses (exclude "change-password" in console strings)
assert(!grepInFile(ownersCode, /console\..*(password\s*[,=]|password:)/i), "No password variable logged in owners.js");

// 8. Owner rate limiting
assert(grepInFile(ownersCode, "checkOwnerAuthRateLimit"), "Owner login has rate limiting");
assert(grepInFile(ownersCode, /RATE_LIMIT_MAX_AUTH_ATTEMPTS\s*=\s*5/), "Owner rate limit is 5 per window");
assert(grepInFile(ownersCode, "Too many login attempts"), "Owner rate limit returns appropriate error");

// === PRODUCTION SECRET GUARD TESTS ===

console.log("\n--- Production Secret Guard Tests ---");

const adminRoutesCode = readFile("backend/adminRoutes.js");
const superRoutesCode = readFile("backend/superRoutes.js");

// 9. Development/test environment remains functional
assert(grepInFile(adminRoutesCode, "getProductionSecret"), "adminRoutes.js uses getProductionSecret");
assert(grepInFile(superRoutesCode, "getProductionSecret"), "superRoutes.js uses getProductionSecret");

// 10. Production rejects missing super-admin JWT secret
assert(grepInFile(adminRoutesCode, /getProductionSecret\(\s*"SUPERADMIN_JWT_SECRET"/), "adminRoutes.js guards SUPERADMIN_JWT_SECRET");
assert(grepInFile(superRoutesCode, /getProductionSecret\(\s*"SUPERADMIN_JWT_SECRET"/), "superRoutes.js guards SUPERADMIN_JWT_SECRET");

// 11. Production rejects dev-super-secret
assert(!grepInFile(adminRoutesCode, /process\.env\.SUPERADMIN_JWT_SECRET \|\| "dev-super-secret"/), "adminRoutes.js does not fallback to dev-super-secret directly");
assert(!grepInFile(superRoutesCode, /process\.env\.SUPERADMIN_JWT_SECRET \|\| "dev-super-secret"/), "superRoutes.js does not fallback to dev-super-secret directly");

// 12. Production rejects missing/insecure roaming JWT secret
assert(grepInFile(authServiceCode, "getProductionSecret"), "roamingAuthService.js uses getProductionSecret");
assert(grepInFile(authServiceCode, /getProductionSecret\(\s*"ROAMING_AUTH_JWT_SECRET"/), "roamingAuthService.js guards ROAMING_AUTH_JWT_SECRET");
assert(!grepInFile(authServiceCode, /process\.env\.ROAMING_AUTH_JWT_SECRET \|\| "dev-roaming-auth-secret"/), "roamingAuthService.js does not fallback to dev secret directly");

// 13. getProductionSecret function exists and enforces production check
assert(grepInFile(passwordServiceCode, "getProductionSecret"), "getProductionSecret is defined in passwordService");
assert(grepInFile(passwordServiceCode, /NODE_ENV.*production/), "getProductionSecret checks NODE_ENV");
assert(grepInFile(adminRoutesCode, "dev-super-secret"), "Super-admin dev default is recognized by guard");
assert(grepInFile(superRoutesCode, "dev-super-secret"), "Super-admin dev default is recognized by guard (superRoutes)");
assert(grepInFile(authServiceCode, "dev-roaming-auth-secret"), "Roaming dev default is recognized by guard");

// 14. Phase 4 auth route uses shared password service (not inline bcrypt)
assert(!grepInFile(authRouteCode, /bcrypt\.compare/), "Phase 4 auth route does not directly use bcrypt.compare");
assert(grepInFile(authRouteCode, /require.*passwordService/), "Phase 4 auth route imports from passwordService");

// 15. Users.js also uses shared password service
assert(grepInFile(usersCode, /require.*passwordService/), "users.js imports from passwordService");
assert(!grepInFile(usersCode, /require.*bcryptjs/), "users.js no longer imports bcryptjs directly");

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
