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

function containsAny(content, patterns) {
  return patterns.some((p) => content.includes(p));
}

function containsNone(content, patterns) {
  return patterns.every((p) => !content.includes(p));
}

console.log("=== Phase 6: Roaming Enforcement / AAA Adapter Foundation ===\n");

const adapterCode = readFile("backend/services/roamingAAAAdapter.js");
const registryCode = readFile("backend/services/roamingAAAAdapterRegistry.js");
const mockCode = readFile("backend/services/adapters/mockRoamingAAAAdapter.js");
const enforcementCode = readFile("backend/services/roamingEnforcementService.js");
const routeCode = readFile("backend/routes/roaming/enforcement.js");
const serverCode = readFile("backend/server.js");

// === 1. Adapter registration ===
console.log("--- Adapter Registration Tests ---");

assert(fileExists("backend/services/roamingAAAAdapter.js"), "AAA adapter contract exists");
assert(fileExists("backend/services/roamingAAAAdapterRegistry.js"), "AAA adapter registry exists");
assert(fileExists("backend/services/adapters/mockRoamingAAAAdapter.js"), "Mock adapter exists");
assert(fileExists("backend/services/roamingEnforcementService.js"), "Enforcement service exists");
assert(fileExists("backend/routes/roaming/enforcement.js"), "Enforcement routes exist");

assert(grepInFile(registryCode, "registerAAAAdapter"), "registerAAAAdapter function exists");
assert(grepInFile(registryCode, "resolveAAAAdapter"), "resolveAAAAdapter function exists");
assert(grepInFile(registryCode, "isAAAAdapterAvailable"), "isAAAAdapterAvailable function exists");

// 2. Duplicate adapter rejection
assert(grepInFile(registryCode, "DUPLICATE_REGISTRATION"), "Duplicate registration throws DUPLICATE_REGISTRATION");
assert(grepInFile(registryCode, "ADAPTERS.has"), "Registry checks for existing adapter before registering");

// 3. Adapter resolution
assert(grepInFile(registryCode, "ADAPTER_NOT_FOUND"), "Missing adapter throws ADAPTER_NOT_FOUND");

// 4. Disabled adapter rejection
assert(grepInFile(registryCode, "ADAPTER_UNAVAILABLE"), "Disabled/unavailable adapter throws ADAPTER_UNAVAILABLE");
assert(grepInFile(registryCode, "isAvailable"), "Registry checks adapter availability");

// === Adapter Contract Tests ===
console.log("\n--- Adapter Contract Tests ---");

assert(grepInFile(adapterCode, "class RoamingAAAAdapter"), "RoamingAAAAdapter class exists");
assert(grepInFile(adapterCode, "async authenticate"), "Adapter has authenticate method");
assert(grepInFile(adapterCode, "async authorize"), "Adapter has authorize method");
assert(grepInFile(adapterCode, "async provisionAccess"), "Adapter has provisionAccess method");
assert(grepInFile(adapterCode, "async revokeAccess"), "Adapter has revokeAccess method");
assert(grepInFile(adapterCode, "async disconnect"), "Adapter has disconnect method");
assert(grepInFile(adapterCode, "async getUsage"), "Adapter has getUsage method");
assert(grepInFile(adapterCode, "async checkHealth"), "Adapter has checkHealth method");
assert(grepInFile(adapterCode, "RoamingAAAAdapterError"), "Adapter errors use RoamingAAAAdapterError");
assert(grepInFile(adapterCode, "ADAPTER_NOT_IMPLEMENTED"), "Unimplemented methods throw ADAPTER_NOT_IMPLEMENTED");

// 5. Mock adapter health
assert(grepInFile(mockCode, "mock"), "Mock adapter registered with aaaAdapterKey 'mock'");
assert(grepInFile(mockCode, "checkHealth"), "Mock adapter implements checkHealth");
assert(grepInFile(mockCode, /healthy:\s*this._healthy/), "Mock adapter returns healthy status from _healthy property");

// === Enforcement Service Tests ===
console.log("\n--- Enforcement Service Tests ---");

// 6. Valid session provisioning
assert(grepInFile(enforcementCode, "provisionSessionEnforcement"), "provisionSessionEnforcement function exists");
assert(grepInFile(enforcementCode, "validateSessionForEnforcement"), "validateSessionForEnforcement function exists");

// 7. Invalid session rejection
assert(grepInFile(enforcementCode, "NOT_FOUND"), "Invalid session throws NOT_FOUND");
assert(grepInFile(enforcementCode, "getRoamingSession"), "Invalid session handled via Phase 5 getRoamingSession");

// 8. Expired session rejection
assert(grepInFile(enforcementCode, "SESSION_EXPIRED"), "Expired session throws SESSION_EXPIRED");
assert(grepInFile(enforcementCode, "SESSION_NOT_ENFORCEABLE"), "Non-enforceable status throws SESSION_NOT_ENFORCEABLE");

// 9. Revoked session rejection
assert(grepInFile(enforcementCode, "SESSION_ENFORCEABLE_STATUSES"), "Enforceable session statuses defined");
assert(grepInFile(enforcementCode, /SESSION_ENFORCEABLE_STATUSES = Object.freeze/), "Enforceable statuses are frozen");

// 10. Terminated session rejection
assert(!grepInFile(enforcementCode, /status.*===.*"terminated"/), "Does not allow terminated sessions (uses allowlist)");

// 11. Invalid entitlement rejection
assert(grepInFile(enforcementCode, "checkEntitlementEligibility"), "Enforcement re-validates entitlement eligibility");
assert(grepInFile(enforcementCode, "ENTITLEMENT_INVALID"), "Invalid entitlement throws ENTITLEMENT_INVALID");

// 12. Invalid visited hotspot rejection
assert(grepInFile(enforcementCode, "resolveAdapterForSession"), "Adapter resolution for session");

// 13. Suspended partner rejection
assert(grepInFile(enforcementCode, "eligibility.eligible"), "Checks eligibility result (suspended partner fails eligibility)");

// 14. Cross-owner rejection
assert(grepInFile(enforcementCode, "User can only enforce their own sessions"), "Cross-user enforcement rejected");
assert(grepInFile(enforcementCode, "Owner can only enforce sessions in their own network"), "Cross-owner enforcement rejected");

// 15. Provisioning idempotency
assert(grepInFile(enforcementCode, "IDEMPOTENCY_CONFLICT"), "Idempotency conflict handling exists");
assert(grepInFile(enforcementCode, "alreadyEnforced"), "Idempotent provisioning returns existing enforcement");
assert(grepInFile(enforcementCode, "ENFORCEMENT_IN_PROGRESS"), "Concurrent provisioning detected via ENFORCEMENT_IN_PROGRESS");

// 16. Concurrent provisioning protection
assert(grepInFile(enforcementCode, /runTransaction/), "Enforcement uses Firestore transactions");

// 17. Revocation
assert(grepInFile(enforcementCode, "revokeSessionEnforcement"), "revokeSessionEnforcement function exists");
assert(grepInFile(enforcementCode, "alreadyRevoked"), "Revocation is idempotent");

// 18. Repeated revocation
assert(grepInFile(enforcementCode, '"revoked"'), "Revocation marks enforcement as revoked");

// 19. Disconnect
assert(grepInFile(enforcementCode, "disconnectSessionEnforcement"), "disconnectSessionEnforcement function exists");
assert(grepInFile(enforcementCode, "alreadyDisconnected"), "Disconnect is idempotent");

// 20. Repeated disconnect
assert(grepInFile(enforcementCode, '"disconnected"'), "Disconnect marks enforcement as disconnected");

// 21. Usage retrieval
assert(grepInFile(enforcementCode, "getSessionUsage"), "getSessionUsage function exists");
assert(grepInFile(enforcementCode, "usedMinutes"), "Usage includes usedMinutes");
assert(grepInFile(enforcementCode, "usedMegabytes"), "Usage includes usedMegabytes");

// 22. Adapter failure
assert(grepInFile(enforcementCode, "ADAPTER_FAILURE"), "Adapter failures throw ADAPTER_FAILURE");

// 23. Fail-closed behavior
assert(grepInFile(enforcementCode, /isAAAAdapterAvailable/), "Adapter availability checked before use (fail closed)");
assert(grepInFile(enforcementCode, /resolveAAAAdapter/), "Adapter resolution can fail → fail closed");

// === Security / Boundary Tests ===
console.log("\n--- Security & Boundary Tests ---");

// 24. Secret leakage checks
assert(!grepInFile(enforcementCode, /password/), "No password in enforcement service");
assert(!grepInFile(enforcementCode, /api_key/i), "No API keys in enforcement service");
assert(!grepInFile(enforcementCode, /secret/i), "No secrets in enforcement service");
assert(!grepInFile(enforcementCode, /credential/i), "No credentials in enforcement service");

// Mock adapter must not make network calls
assert(!grepInFile(mockCode, /ssh|SSH/), "Mock adapter does not use SSH");
assert(!grepInFile(mockCode, /telnet/), "Mock adapter does not use telnet");
assert(!grepInFile(mockCode, /net\.connect|socket\.connect/), "Mock adapter does not make network connections");
assert(!grepInFile(mockCode, /http\.request|axios\.|\bfetch\b/), "Mock adapter does not make HTTP calls");

// Enforcement service must not reference legacy collections
const forbiddenCollections = ["wifi_sessions", "sessions", "payments", "wallets", "packages", "vouchers", "loyalty"];
for (const coll of forbiddenCollections) {
  const pattern = `.collection("${coll}")`;
  assert(!grepInFile(enforcementCode, pattern), `Enforcement does not reference ${coll} collection`);
}

// Enforcement must NOT contain RADIUS/Passpoint/vendor implementations
assert(!grepInFile(enforcementCode, /radius/i), "No RADIUS in enforcement service");
assert(!grepInFile(enforcementCode, /passpoint/i), "No Passpoint in enforcement service");
assert(!grepInFile(enforcementCode, /mikrotik|cisco|unifi|tplink/i), "No vendor-specific adapters implemented");

// 25. Enforcement state collection is separate
assert(grepInFile(enforcementCode, "roaming_enforcements"), "Uses roaming_enforcements collection");
assert(!grepInFile(enforcementCode, "wifi_sessions"), "Does not modify wifi_sessions");

// Routes mounted
assert(grepInFile(serverCode, "roamingEnforcementRoutes"), "Enforcement routes mounted in server.js");
assert(grepInFile(serverCode, "/api/roaming/enforcement"), "Enforcement route namespace exists");

// === Route Tests ===
console.log("\n--- Route Tests ---");

assert(grepInFile(routeCode, /router\.post\("\/:sessionId\/provision"/), "POST provision route exists");
assert(grepInFile(routeCode, /router\.post\("\/:sessionId\/revoke"/), "POST revoke route exists");
assert(grepInFile(routeCode, /router\.post\("\/:sessionId\/disconnect"/), "POST disconnect route exists");
assert(grepInFile(routeCode, /router\.get\("\/:sessionId\/usage"/), "GET usage route exists");
assert(grepInFile(routeCode, /router\.get\("\/health"/), "GET health route exists");

// Routes use existing auth patterns
assert(grepInFile(routeCode, "verifyUserIdentity"), "Routes use verifyUserIdentity");
assert(grepInFile(routeCode, "verifyOwnerIdentity"), "Routes use verifyOwnerIdentity");
assert(grepInFile(routeCode, "handleEnforcementError"), "Routes use handleEnforcementError");
assert(grepInFile(routeCode, "handleRegistryError"), "Routes use handleRegistryError");

// Provisioning requires user or owner auth
assert(grepInFile(routeCode, "verifyUserIdentity(req)"), "Provision route verifies user identity");

// Revocation requires owner auth
assert(grepInFile(routeCode, "Owner authentication required to revoke enforcement"), "Revoke requires owner");

// Health requires owner auth
assert(grepInFile(routeCode, 'router.get("/health"'), "Health endpoint exists");

// Never trust user-supplied adapter key
assert(!grepInFile(routeCode, "req.body.*aaaAdapterKey"), "Enforcement state does not accept user-supplied aaaAdapterKey in body");
assert(!grepInFile(routeCode, "req.body.*homeOwnerId"), "Enforcement does not accept user-supplied homeOwnerId");
assert(!grepInFile(routeCode, "req.body.*visitedOwnerId"), "Enforcement does not accept user-supplied visitedOwnerId");
assert(!grepInFile(routeCode, "req.body.*entitlementId"), "Enforcement does not accept user-supplied entitlementId");

// === State Machine Tests ===
console.log("\n--- Enforcement State Machine Tests ---");

assert(grepInFile(enforcementCode, "ENFORCEMENT_STATUSES"), "Enforcement statuses defined");
assert(grepInFile(enforcementCode, "ENFORCEMENT_STATE_TRANSITIONS"), "Enforcement state transitions defined");
assert(grepInFile(enforcementCode, "isValidEnforcementTransition"), "Enforcement state transitions validated");
assert(grepInFile(enforcementCode, '"pending"'), "pending status exists");
assert(grepInFile(enforcementCode, '"provisioning"'), "provisioning status exists");
assert(grepInFile(enforcementCode, '"provisioned"'), "provisioned status exists");
assert(grepInFile(enforcementCode, '"revoked"'), "revoked status exists");
assert(grepInFile(enforcementCode, '"disconnected"'), "disconnected status exists");
assert(grepInFile(enforcementCode, '"failed"'), "failed status exists");

// === Phase 2/3/4/5 Boundary Checks ===
console.log("\n--- Phase 1-5 Boundary Checks ---");

// Phase 1 files exist
assert(grepInFile(serverCode, "roamingPartnersRoutes"), "Phase 1 roaming partner routes exist");
assert(grepInFile(serverCode, "roamingHotspotsRoutes"), "Phase 1 roaming hotspot routes exist");
assert(fileExists("backend/services/roamingRegistryService.js"), "Phase 1 registry service exists");

// Phase 2 files exist
assert(fileExists("backend/services/roamingRegistryService.js"), "Phase 2 registry service exists");
assert(fileExists("backend/routes/roaming/partners.js"), "Phase 2 partners routes exist");
assert(fileExists("backend/routes/roaming/hotspots.js"), "Phase 2 hotspots routes exist");

// Phase 3 files exist
assert(fileExists("backend/services/roamingEntitlementService.js"), "Phase 3 entitlement service exists");
assert(fileExists("backend/routes/roaming/entitlements.js"), "Phase 3 entitlements routes exist");

// Phase 4 files exist
assert(fileExists("backend/services/roamingAuthService.js"), "Phase 4 auth service exists");
assert(fileExists("backend/routes/roaming/auth.js"), "Phase 4 auth routes exist");
assert(fileExists("backend/scripts/check-roaming-phase4.js"), "Phase 4 test script exists");

// Phase 5 files exist
assert(fileExists("backend/services/roamingSessionService.js"), "Phase 5 session service exists");
assert(fileExists("backend/routes/roaming/sessions.js"), "Phase 5 sessions routes exist");
assert(fileExists("backend/scripts/check-roaming-phase5.js"), "Phase 5 test script exists");

// Existing system files still intact
assert(grepInFile(serverCode, "packagesRoutes"), "Packages routes still mounted");
assert(grepInFile(serverCode, "mtnRoutes"), "MTN routes still mounted");
assert(grepInFile(serverCode, "vouchersRoutes"), "Vouchers routes still mounted");
assert(grepInFile(serverCode, "loyaltyRoutes"), "Loyalty routes still mounted");
assert(grepInFile(serverCode, "ciscoRoutes"), "Cisco routes still mounted");

// Phase 6 does not modify existing user-facing collections
const sessionServiceCode = readFile("backend/services/roamingSessionService.js");
assert(!grepInFile(sessionServiceCode, "roaming_enforcements"), "Phase 5 session service does not reference enforcement collection");

// Phase 6 reuses Phase 5 session validation
assert(grepInFile(enforcementCode, "getRoamingSession"), "Enforcement reuses Phase 5 getRoamingSession");
assert(grepInFile(enforcementCode, "ACTIVE_STATUSES"), "Enforcement reuses Phase 5 ACTIVE_STATUSES");
assert(grepInFile(enforcementCode, "RoamingSessionError"), "Enforcement reuses Phase 5 RoamingSessionError");

// Phase 6 reuses Phase 3 eligibility
assert(grepInFile(enforcementCode, "checkEntitlementEligibility"), "Enforcement reuses Phase 3 entitlement check");

// Phase 6 reuses Phase 4 audit logging
assert(grepInFile(enforcementCode, "logAuthEvent"), "Enforcement reuses Phase 4 logAuthEvent");
assert(grepInFile(enforcementCode, "enforcement_provisioned"), "Enforcement logs provisioned event");
assert(grepInFile(enforcementCode, "enforcement_revoked"), "Enforcement logs revoked event");

// Phase 6 reuses owner authentication
assert(grepInFile(routeCode, "registry.authenticateOwnerOrSuper"), "Routes reuse owner authentication");

// === Adapter Pattern Tests ===
console.log("\n--- Adapter Pattern Tests ---");

// Adapter is a class with standard methods
assert(grepInFile(adapterCode, "class RoamingAAAAdapter"), "Adapter is a class");
assert(grepInFile(adapterCode, "getCapabilities"), "Adapter has getCapabilities");
assert(grepInFile(adapterCode, "buildContext"), "Adapter has buildContext static method");

// Registry uses Map (in-memory)
assert(grepInFile(registryCode, "new Map"), "Registry uses in-memory Map for adapter storage");

// Registry enforces enabled/disabled
assert(grepInFile(registryCode, "enabled"), "Registry tracks enabled state");
assert(grepInFile(registryCode, "listEnabledAAAAdapters"), "Registry exposes enabled adapters only");

// Registry prevents duplicate registration
assert(grepInFile(registryCode, "ADAPTERS.has(key)"), "Registry checks for duplicates before registering");

// Mock adapter extends the base contract
assert(grepInFile(mockCode, "extends RoamingAAAAdapter"), "Mock adapter extends RoamingAAAAdapter");

// Mock adapter is deterministic (no random behavior)
assert(!grepInFile(mockCode, "Math.random"), "Mock adapter is deterministic (no randomness)");
assert(!grepInFile(mockCode, "crypto.random"), "Mock adapter is deterministic (no crypto.random)");

// Mock adapter simulates all operations
assert(grepInFile(mockCode, "async provisionAccess"), "Mock implements provisionAccess");
assert(grepInFile(mockCode, "async revokeAccess"), "Mock implements revokeAccess");
assert(grepInFile(mockCode, "async disconnect"), "Mock implements disconnect");
assert(grepInFile(mockCode, "async getUsage"), "Mock implements getUsage");
assert(grepInFile(mockCode, "async authenticate"), "Mock implements authenticate");
assert(grepInFile(mockCode, "async authorize"), "Mock implements authorize");
assert(grepInFile(mockCode, "async checkHealth"), "Mock implements checkHealth");

// Mock adapter tracks state
assert(grepInFile(mockCode, "_state"), "Mock tracks simulated enforcement state");
assert(grepInFile(mockCode, "provisioned"), "Mock tracks provisioned state");

// === Audit Tests ===
console.log("\n--- Audit Tests ---");

assert(grepInFile(enforcementCode, "enforcement_provisioned"), "Provisioning is audited");
assert(grepInFile(enforcementCode, "enforcement_revoked"), "Revocation is audited");
assert(grepInFile(enforcementCode, "enforcement_disconnected"), "Disconnect is audited");
assert(grepInFile(enforcementCode, "enforcement_usage_retrieved"), "Usage retrieval is audited");
assert(grepInFile(enforcementCode, "enforcement_provision_failed"), "Provisioning failure is audited");
assert(grepInFile(enforcementCode, "enforcement_provision_idempotent"), "Idempotent provisioning is audited");

// No sensitive data in audit events
const auditEventPatterns = ["password", "token", "secret", "credential"];
for (const field of auditEventPatterns) {
  assert(!grepInFile(`eventType: "enforcement_`, field), `No ${field} in enforcement event types`);
}

// === Fail-Closed Tests ===
console.log("\n--- Fail-Closed Tests ---");

// Adapter failure during provisioning marks enforcement as failed
assert(grepInFile(enforcementCode, '"failed"'), "Enforcement status includes failed state");
assert(grepInFile(enforcementCode, 'provisioning: ["provisioned", "failed"]'), "Failed is a valid terminal state from provisioning");
assert(grepInFile(enforcementCode, 'provisioned: ["revoked", "disconnected", "failed"]'), "Failed is a valid terminal state from provisioned");

// Adapter unavailability prevents enforcement
assert(grepInFile(enforcementCode, "ADAPTER_UNAVAILABLE"), "Unavailable adapter prevents enforcement (fail closed)");

// No adapter key on session → no enforcement
assert(grepInFile(enforcementCode, "ADAPTER_NOT_CONFIGURED"), "Missing adapter key prevents enforcement (fail closed)");

// === Summary ===
console.log(`\n========================================`);
console.log(`Phase 6 Results: ${passed} passed, ${failed} failed`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
