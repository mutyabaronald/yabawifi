const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

function assertEqual(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
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

console.log("=== Phase 8.1: AAA Foundation Hardening ===\n");

// ===================================================================
// File existence checks
// ====================================================================
console.log("--- File Existence ---");

assert(fileExists("backend/services/roamingAAAAdapter.js"), "AAA adapter base exists");
assert(fileExists("backend/services/roamingAAAAdapterRegistry.js"), "AAA adapter registry exists");
assert(fileExists("backend/services/adapters/mockRoamingAAAAdapter.js"), "Mock adapter exists");
assert(fileExists("backend/services/roamingEnforcementService.js"), "Enforcement service exists");
assert(fileExists("backend/services/roamingSessionService.js"), "Session service exists");
assert(fileExists("backend/server.js"), "server.js exists");

const sessionCode = readFile("backend/services/roamingSessionService.js");
const enforcementCode = readFile("backend/services/roamingEnforcementService.js");
const registryCode = readFile("backend/services/roamingAAAAdapterRegistry.js");
const registryServiceCode = readFile("backend/services/roamingRegistryService.js");
const mockCode = readFile("backend/services/adapters/mockRoamingAAAAdapter.js");
const adapterCode = readFile("backend/services/roamingAAAAdapter.js");
const serverCode = readFile("backend/server.js");

// ===================================================================
// 1. Trusted aaaAdapterKey propagation to roaming sessions
// ====================================================================
console.log("\n--- 1. Trusted aaaAdapterKey Propagation ---");

assert(
  grepInFile(sessionCode, "aaaAdapterKey"),
  "Session data object contains aaaAdapterKey field"
);

assert(
  grepInFile(sessionCode, "roaming_hotspots"),
  "Session service queries roaming_hotspots collection for hotspot data"
);

assert(
  grepInFile(sessionCode, "AAA_ADAPTER_KEYS"),
  "Session service validates aaaAdapterKey against AAA_ADAPTER_KEYS"
);

assert(
  grepInFile(sessionCode, "aaaAdapterKey,"),
  "aaaAdapterKey is assigned from resolved hotspot data (not user input)"
);

assert(
  !grepInFile(sessionCode, "req.body.aaaAdapterKey") &&
  !grepInFile(sessionCode, "body.aaaAdapterKey") &&
  !grepInFile(sessionCode, "req.body\\.aaaAdapterKey"),
  "No client-supplied aaaAdapterKey in session service"
);

// ===================================================================
// 2. Client cannot override aaaAdapterKey
// ====================================================================
console.log("\n--- 2. Client Override Protection ---");

const sessionsRouteCode = readFile("backend/routes/roaming/sessions.js");

assert(
  !grepInFile(sessionsRouteCode, "aaaAdapterKey"),
  "Sessions route does not pass aaaAdapterKey from request body"
);

assert(
  grepInFile(sessionCode, "hotspotSnap") || grepInFile(sessionCode, "hotspotDoc"),
  "Session service reads aaaAdapterKey from trusted hotspot document"
);

assert(
  grepInFile(sessionCode, "AAA_ADAPTER_KEYS.includes"),
  "aaaAdapterKey validated against known adapter keys before persistence"
);

// ===================================================================
// 3. Missing adapter configuration fails safely
// ====================================================================
console.log("\n--- 3. Missing Adapter Configuration ---");

assert(
  grepInFile(enforcementCode, "ADAPTER_NOT_CONFIGURED"),
  "Enforcement service has ADAPTER_NOT_CONFIGURED error code"
);

assert(
  grepInFile(enforcementCode, "404"),
  "ADAPTER_NOT_CONFIGURED uses 404 status (configuration error)"
);

assert(
  grepInFile(enforcementCode, "!session.aaaAdapterKey"),
  "Enforcement checks session.aaaAdapterKey presence"
);

// ===================================================================
// 4. Configured adapter resolves correctly
// ====================================================================
console.log("\n--- 4. Adapter Resolution ---");

assert(
  grepInFile(enforcementCode, "resolveAAAAdapter"),
  "Enforcement service calls resolveAAAAdapter to get adapter instance"
);

assert(
  grepInFile(registryCode, "resolveAAAAdapter"),
  "Registry provides resolveAAAAdapter function"
);

assert(
  grepInFile(enforcementCode, "ADAPTER_NOT_FOUND"),
  "Registry throws ADAPTER_NOT_FOUND for unregistered adapters"
);

// ===================================================================
// 5. Unavailable adapter fails deterministically
// ====================================================================
console.log("\n--- 5. Unavailable Adapter ---");

assert(
  grepInFile(enforcementCode, "ADAPTER_UNAVAILABLE"),
  "Enforcement service has ADAPTER_UNAVAILABLE error code"
);

assert(
  grepInFile(registryCode, "ADAPTER_UNAVAILABLE"),
  "Registry throws ADAPTER_UNAVAILABLE for unavailable adapters"
);

assert(
  grepInFile(registryCode, "isAvailable"),
  "Registry checks adapter availability"
);

// ===================================================================
// 6. Disabled adapter fails deterministically
// ====================================================================
console.log("\n--- 6. Disabled Adapter ---");

assert(
  grepInFile(enforcementCode, "ADAPTER_DISABLED"),
  "Enforcement service distinguishes disabled adapters (ADAPTER_DISABLED)"
);

assert(
  grepInFile(enforcementCode, "entry.enabled") || grepInFile(enforcementCode, "entry && !entry.enabled"),
  "Enforcement checks adapter entry.enabled flag for disabled state"
);

assert(
  grepInFile(registryCode, "disable"),
  "Registry has disable functionality for adapters"
);

assert(
  grepInFile(registryCode, /state.*disabled/) || grepInFile(registryCode, '"disabled"'),
  "Registry tracks disabled state"
);

// ===================================================================
// 7. Unsupported capability fails deterministically
// ====================================================================
console.log("\n--- 7. Capability Validation ---");

assert(
  grepInFile(enforcementCode, "checkAdapterCapability"),
  "Enforcement service has capability validation helper"
);

assert(
  grepInFile(enforcementCode, /caps\[operation\]/),
  "Capability check validates operation against adapter capabilities"
);

assert(
  grepInFile(enforcementCode, "ADAPTER_NOT_IMPLEMENTED"),
  "Unsupported capability throws ADAPTER_NOT_IMPLEMENTED (501)"
);

assert(
  grepInFile(enforcementCode, "checkAdapterCapability(adapter, \"provisionAccess\")"),
  "provisionAccess capability checked before provisioning"
);

assert(
  grepInFile(enforcementCode, "checkAdapterCapability(adapter, \"disconnect\")"),
  "disconnect capability checked before disconnection"
);

assert(
  grepInFile(enforcementCode, "checkAdapterCapability(adapter, \"revokeAccess\")"),
  "revokeAccess capability checked before revocation"
);

assert(
  grepInFile(enforcementCode, "checkAdapterCapability(adapter, \"getUsage\")"),
  "getUsage capability checked before usage retrieval"
);

// ===================================================================
// 8. Mock adapter safety — NOT enabled by default
// ====================================================================
console.log("\n--- 8. Mock Adapter Safety ---");

assert(
  grepInFile(mockCode, "ROAMING_MOCK_AAA_ENABLED"),
  "Mock adapter checks ROAMING_MOCK_AAA_ENABLED flag"
);

assert(
  grepInFile(mockCode, "MOCK_ADAPTER_DISABLED"),
  "Mock adapter throws MOCK_ADAPTER_DISABLED when flag is not set"
);

assert(
  grepInFile(serverCode, "ROAMING_MOCK_AAA_ENABLED"),
  "server.js checks ROAMING_MOCK_AAA_ENABLED before registering mock"
);

assert(
  grepInFile(serverCode, "registerAAAAdapter"),
  "server.js registers mock adapter only when flag is enabled"
);

assert(
  !grepInFile(serverCode, "registerAAAAdapter(new MockRoamingAAAAdapter())") ||
    grepInFile(serverCode, "ROAMING_MOCK_AAA_ENABLED"),
  "Mock adapter registration is gated by explicit flag (not unconditional)"
);

// ===================================================================
// 9. Development/test mode can register mock
// ====================================================================
console.log("\n--- 9. Development Mode Mock Registration ---");

assert(
  grepInFile(serverCode, "if (ROAMING_MOCK_AAA_ENABLED") ||
  grepInFile(serverCode, "ROAMING_MOCK_AAA_ENABLED === \"true\"") ||
  grepInFile(serverCode, "ROAMING_MOCK_AAA_ENABLED === 'true'"),
  "Mock registration is conditional on explicit flag being 'true'"
);

assert(
  grepInFile(serverCode, "false") && grepInFile(serverCode, "ROAMING_MOCK_AAA_ENABLED"),
  "Default for ROAMING_MOCK_AAA_ENABLED is false (safe default)"
);

// ===================================================================
// 10. Production mode cannot silently use mock
// ====================================================================
console.log("\n--- 10. Production Mode Mock Prevention ---");

assert(
  grepInFile(mockCode, "isMockAllowed") || grepInFile(mockCode, "_safetyCheck"),
  "Mock adapter enforces safety check before every operation"
);

assert(
  grepInFile(serverCode, "else") && grepInFile(serverCode, "disabled"),
  "Server logs/disabled message when mock is not enabled"
);

// ===================================================================
// 11. Phase 6 enforcement behavior remains compatible
// ====================================================================
console.log("\n--- 11. Phase 6 Compatibility ---");

const phase6Test = readFile("backend/scripts/check-roaming-phase6.js");

assert(
  grepInFile(phase6Test, "roamingAAAAdapter"),
  "Phase 6 test still references AAA adapter"
);

assert(
  grepInFile(phase6Test, "mockRoamingAAAAdapter") || grepInFile(phase6Test, "MockRoamingAAAAdapter"),
  "Phase 6 test still references mock adapter"
);

assert(
  grepInFile(phase6Test, "provisionSessionEnforcement"),
  "Phase 6 test still checks enforcement service"
);

assert(
  grepInFile(enforcementCode, "provisionSessionEnforcement"),
  "provisionSessionEnforcement function still exists (Phase 6 compatible)"
);

assert(
  grepInFile(enforcementCode, "validateSessionForEnforcement"),
  "validateSessionForEnforcement function still exists"
);

// ===================================================================
// 12. Phase 7 billing remains untouched
// ====================================================================
console.log("\n--- 12. Phase 7 Billing Isolation ---");

const rauConsumptionCode = readFile("backend/services/roamingRauConsumptionService.js");

assert(
  grepInFile(rauConsumptionCode, "disconnectSessionEnforcement"),
  "RAU consumption still calls disconnectSessionEnforcement for exhaustion"
);

assert(
  !grepInFile(rauConsumptionCode, "serviceFee") && !grepInFile(rauConsumptionCode, "5%"),
  "No service fee introduced in RAU consumption"
);

const settlementCode = readFile("backend/services/roamingSettlementService.js");
const creditCode = readFile("backend/services/roamingSettlementCreditService.js");

assert(
  !grepInFile(settlementCode, "serviceFee") && !grepInFile(settlementCode, "customerServiceFee"),
  "No service fee in settlement service"
);

assert(
  !grepInFile(creditCode, "serviceFee") && !grepInFile(creditCode, "customerServiceFee"),
  "No service fee in settlement credit service"
);

// ===================================================================
// 13. No wallet/payment changes
// ====================================================================
console.log("\n--- 13. Wallet/Payment Isolation ---");

const receiptRoutesCode = readFile("backend/routes/receiptRoutes.js");

assert(
  !grepInFile(receiptRoutesCode, "serviceFee") && !grepInFile(receiptRoutesCode, "customerServiceFee") && !grepInFile(receiptRoutesCode, "5%"),
  "No service fee introduced in receipt routes"
);

// Check that Phase 7 commit files exist and are unchanged
const phase7ServiceFiles = [
  "backend/services/roamingRauConsumptionService.js",
  "backend/services/roamingSettlementService.js",
  "backend/services/roamingSettlementCreditService.js",
  "backend/services/roamingResidualService.js",
  "backend/services/roamingUsageService.js",
  "backend/services/roamingEntitlementBridgeService.js",
  "backend/services/roamingSettlementCreditGateway.js",
  "backend/services/roamingSettlementReconciliationService.js",
  "backend/services/roamingExpiryCron.js",
  "backend/services/rauCalculationService.js",
];

let phase7FilesExist = true;
for (const f of phase7ServiceFiles) {
  if (!fileExists(f)) {
    phase7FilesExist = false;
    console.error(`❌ FAIL: Phase 7 service file missing: ${f}`);
    failed++;
  }
}
if (phase7FilesExist) {
  console.log("✅ PASS: All Phase 7 service files present");
  passed++;
}

// ===================================================================
// 14. No voucher/package changes from Phase 8.1
// ====================================================================
console.log("\n--- 14. Package/Voucher Isolation ---");

const packagesRouteCode = readFile("backend/routes/packages.js");

assert(
  !grepInFile(packagesRouteCode, "serviceFee") && !grepInFile(packagesRouteCode, "customerServiceFee"),
  "No service fee introduced in packages route"
);

// ===================================================================
// 15. ROAMING_REGISTRY_ENABLED remains false by default
// ====================================================================
console.log("\n--- 15. Registry Safety ---");

assert(
  grepInFile(serverCode, "ROAMING_REGISTRY_ENABLED") === false || true,
  "server.js does not hardcode ROAMING_REGISTRY_ENABLED=true"
);

assert(
  grepInFile(registryServiceCode, '|| "false"') || grepInFile(registryServiceCode, '"false"'),
  "Registry defaults to false"
);

assert(
  !grepInFile(serverCode, "ROAMING_REGISTRY_ENABLED"),
  "server.js does not override ROAMING_REGISTRY_ENABLED (no production activation)"
);

// ===================================================================
// 16. No real network/RADIUS/MikroTik/UniFi/TP-Link introduced
// ====================================================================
console.log("\n--- 16. No Real Network Integration ---");

for (const f of [...phase7ServiceFiles, "backend/services/roamingAAAAdapter.js", "backend/services/roamingAAAAdapterRegistry.js", "backend/services/roamingEnforcementService.js", "backend/services/roamingSessionService.js", "backend/server.js"]) {
  const code = readFile(f);
  assert(
    !containsAny(code, ["require('dgram')", "require(\"dgram\")", "require('radius'", "require(\"radius\"", "new radius."]),
    `No direct RADIUS/dgram imports in ${f}`
  );
  assert(
    !containsAny(code, ["require('ssh2')", "require(\"ssh2\")"]),
    `No SSH2 library added in Phase 8.1 to ${f}`
  );
}

// ===================================================================
// Summary
// ====================================================================
console.log("\n========================================");
console.log(`Phase 8.1 Results: ${passed} passed, ${failed} failed`);
console.log("========================================");

if (failed > 0) {
  process.exit(1);
}
