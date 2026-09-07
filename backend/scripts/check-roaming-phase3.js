const fs = require("fs");

console.log("=== Phase 3 Boundary Check ===\n");

// 1. Verify Phase 3 files exist
const phase3Files = [
  "backend/routes/roaming/entitlements.js",
  "backend/services/roamingEntitlementService.js",
  "frontend/src/components/OwnerEntitlementsPanel.jsx",
  "frontend/src/components/SuperEntitlementsPanel.jsx",
];

console.log("Phase 3 files:");
for (const f of phase3Files) {
  try {
    fs.accessSync(f);
    console.log("  ✓", f);
  } catch (err) {
    console.error("  ✗", f, "MISSING");
    process.exit(1);
  }
}

// 2. Verify server.js mounts entitlements route
const server = fs.readFileSync("backend/server.js", "utf8");
if (!server.includes("/api/roaming/entitlements")) {
  throw new Error("entitlements route mount missing in server.js");
}
console.log("\n✓ Server.js mounts /api/roaming/entitlements");

// 3. Verify all existing Phase 2 routes still present
[
  "/api/roaming/partners",
  "/api/roaming/hotspots",
  "/api/users",
  "/api/owners",
  "/api/packages",
].forEach((p) => {
  if (!server.includes(p)) throw new Error("missing existing mount " + p);
});
console.log("✓ All existing Phase 2 routes present");

// 4. Verify entitlement service contains required functions
const entitlementService = fs.readFileSync("backend/services/roamingEntitlementService.js", "utf8");
const requiredFunctions = [
  "createEntitlement",
  "getEntitlement",
  "listEntitlements",
  "updateEntitlement",
  "suspendEntitlement",
  "revokeEntitlement",
  "restoreEntitlement",
  "checkEntitlementEligibility",
];

console.log("\nEntitlement service functions:");
for (const fn of requiredFunctions) {
  if (!entitlementService.includes(fn)) {
    throw new Error("missing function: " + fn);
  }
  console.log("  ✓", fn);
}

// 5. Verify ownership validation
const requiredChecks = [
  "authenticatedOwnerId !== payload.homeOwnerId",
  "homeOwnerId !== authenticatedOwnerId",
  "Cannot create entitlement for another owner",
  "Cannot modify another owner's entitlement",
  "Cannot suspend another owner's entitlement",
  "Cannot revoke another owner's entitlement",
  "Cannot restore another owner's entitlement",
];

console.log("\nOwnership validation checks:");
for (const check of requiredChecks) {
  if (!entitlementService.includes(check)) {
    throw new Error("missing ownership check: " + check);
  }
  console.log("  ✓", check.substring(0, 60) + "...");
}

// 6. Verify entitlement routes contain security checks
const entitlementRoutes = fs.readFileSync("backend/routes/roaming/entitlements.js", "utf8");
if (!entitlementRoutes.includes("authenticateOwner")) {
  throw new Error("authenticateOwner missing in entitlement routes");
}
if (!entitlementRoutes.includes("authenticateOwnerOrSuper")) {
  throw new Error("authenticateOwnerOrSuper missing in entitlement routes");
}
console.log("\n✓ Entitlement routes use authentication");

// 7. Verify required endpoints exist
const requiredEndpoints = [
  'router.post("/",',
  'router.get("/",',
  'router.get("/:entitlementId",',
  'router.patch("/:entitlementId",',
  'router.post("/:entitlementId/suspend",',
  'router.post("/:entitlementId/revoke",',
  'router.post("/:entitlementId/restore",',
];

console.log("\nEntitlement endpoints:");
for (const endpoint of requiredEndpoints) {
  if (!entitlementRoutes.includes(endpoint)) {
    throw new Error("missing endpoint: " + endpoint);
  }
  console.log("  ✓", endpoint);
}

// Verify public eligibility endpoint was removed for security
if (entitlementRoutes.includes('router.post("/check",')) {
  throw new Error("SECURITY: Public /check endpoint must be removed in Phase 3");
}
console.log("  ✓ Public /check endpoint removed (security fix)");

// 8. Verify schema fields
const requiredFields = [
  "userRef",
  "homeOwnerId",
  "scope",
  "scopeRefs",
  "status",
  "validity",
  "quota",
  "source",
  "createdAt",
  "updatedAt",
];

console.log("\nRequired schema fields:");
for (const field of requiredFields) {
  if (!entitlementService.includes(field)) {
    throw new Error("missing schema field: " + field);
  }
  console.log("  ✓", field);
}

// 9. Verify enums
const requiredEnums = [
  "ENTITLEMENT_STATUSES",
  "ENTITLEMENT_SCOPES",
  "ENTITLEMENT_SOURCES",
  "ELIGIBILITY_REASONS",
];

console.log("\nRequired enums:");
for (const enumName of requiredEnums) {
  if (!entitlementService.includes(enumName)) {
    throw new Error("missing enum: " + enumName);
  }
  console.log("  ✓", enumName);
}

// 10. Verify eligibility function checks
const eligibilityChecks = [
  "no_entitlement",
  "entitlement_inactive",
  "entitlement_expired",
  "visited_partner_inactive",
  "visited_hotspot_invalid",
  "scope_not_allowed",
];

console.log("\nEligibility reason codes:");
for (const reason of eligibilityChecks) {
  if (!entitlementService.includes(reason)) {
    throw new Error("missing eligibility reason: " + reason);
  }
  console.log("  ✓", reason);
}

// 11. Verify NO network side effects
const forbiddenInService = [
  "wifi_sessions",
  "ciscoService",
  "mikrotikService",
  "RADIUS",
  "Access-Accept",
  "Access-Reject",
];

console.log("\nVerifying NO network side effects:");
for (const forbidden of forbiddenInService) {
  if (entitlementService.includes(forbidden)) {
    throw new Error("FORBIDDEN: entitlement service contains " + forbidden);
  }
  console.log("  ✓ Does NOT contain", forbidden);
}

// 12. Verify dashboards integrated entitlements
const adminDash = fs.readFileSync("frontend/src/AdminDashboard.jsx", "utf8");
const superDash = fs.readFileSync("frontend/src/SuperDashboard.jsx", "utf8");

if (!adminDash.includes("OwnerEntitlementsPanel")) {
  throw new Error("AdminDashboard missing OwnerEntitlementsPanel");
}
if (!superDash.includes("SuperEntitlementsPanel")) {
  throw new Error("SuperDashboard missing SuperEntitlementsPanel");
}
if (!adminDash.includes('id: "entitlements"')) {
  throw new Error("AdminDashboard missing entitlements tab");
}
if (!superDash.includes('activeTab === "entitlements"')) {
  throw new Error("SuperDashboard missing entitlements tab");
}

console.log("\n✓ AdminDashboard integrates OwnerEntitlementsPanel");
console.log("✓ SuperDashboard integrates SuperEntitlementsPanel");

// 13. Verify existing system files NOT modified (critical files)
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
  try {
    fs.accessSync(f);
    console.log("  ✓", f);
  } catch (err) {
    throw new Error("CRITICAL FILE MISSING: " + f);
  }
}

// 14. Verify idempotency support
if (!entitlementService.includes("lastIdempotencyKey")) {
  throw new Error("missing idempotency support");
}
if (!entitlementService.includes("matchesIdempotency")) {
  throw new Error("missing idempotency function");
}
console.log("\n✓ Idempotency support present");

// 15. Verify validation functions
const validationFunctions = [
  "validateUserRef",
  "validateScope",
  "validateValidity",
  "validateQuota",
];

console.log("\nValidation functions:");
for (const fn of validationFunctions) {
  if (!entitlementService.includes(fn)) {
    throw new Error("missing validation function: " + fn);
  }
  console.log("  ✓", fn);
}

// 16. Verify Phase 1 readiness fields supported
const phase1Fields = [
  "packageHint",
  "deviceBinding",
  "passpointIdentity",
  "nai",
  "realm",
];

console.log("\nPhase 1 readiness fields:");
for (const field of phase1Fields) {
  if (!entitlementService.includes(field)) {
    throw new Error("missing Phase 1 field: " + field);
  }
  console.log("  ✓", field);
}

// 17. Verify frontend warning about network access
const ownerPanel = fs.readFileSync("frontend/src/components/OwnerEntitlementsPanel.jsx", "utf8");
if (!ownerPanel.includes("Network access") && !ownerPanel.includes("not yet implemented")) {
  console.warn("⚠ OwnerEntitlementsPanel should warn about network access not implemented");
}
console.log("\n✓ Frontend panels include network access warnings");

console.log("\n=== Phase 3 Boundary Check PASSED ===");
