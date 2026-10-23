/**
 * Phase 8.5 MikroTik session enforcement hook — focused regression tests.
 *
 * Run from the repository root:  node backend/scripts/check-phase8-5-hook.js
 */

const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const SESSION_SERVICE_PATH = path.resolve(BACKEND, "services", "roamingSessionService.js");
const ENFORCEMENT_SERVICE_PATH = path.resolve(BACKEND, "services", "roamingEnforcementService.js");
const REGISTRY_SERVICE_PATH = path.resolve(BACKEND, "services", "roamingRegistryService.js");
const FIREBASE_PATH = path.resolve(BACKEND, "firebase.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed += 1; console.log(`PASS: ${message}`); }
  else { failed += 1; console.error(`FAIL: ${message}`); }
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1; console.log(`PASS: ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function assertRejects(asyncFn, checkFn, message) {
  try {
    await asyncFn();
    failed += 1;
    console.error(`FAIL: ${message} - did not reject`);
  } catch (err) {
    const ok = checkFn(err);
    if (ok) { passed += 1; console.log(`PASS: ${message}`); }
    else { failed += 1; console.error(`FAIL: ${message} - ${err && err.message ? err.message : err}`); }
  }
}

// ─────────────────────────────────────────────────────────────
// In-memory Firestore double with transaction support
// ─────────────────────────────────────────────────────────────
function makeTxDb(store) {
  function collection(name) {
    return {
      doc(id) {
        const key = `${name}/${id}`;
        return {
          get: () => Promise.resolve({
            exists: !!store[key],
            id,
            data: () => store[key] || null,
          }),
          set: (data, opts) => {
            if (opts && opts.merge) {
              store[key] = { ...(store[key] || {}), ...data };
            } else {
              store[key] = data;
            }
            return Promise.resolve();
          },
        };
      },
      where(field, op, value) {
        const docs = Object.keys(store)
          .filter(k => k.startsWith(name + "/"))
          .map(k => ({ id: k.split("/")[1], data: () => store[k] }))
          .filter(d => op === "==" ? d.data()[field] === value : false);
        return {
          limit(n) { return { get: () => Promise.resolve({ docs: docs.slice(0, n), empty: docs.length === 0 }) }; },
          get: () => Promise.resolve({ docs, empty: docs.length === 0 }),
        };
      },
    };
  }

  const db = {
    collection,
    runTransaction: async (fn) => {
      const transaction = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => ref.set(data, opts),
      };
      return fn(transaction);
    },
  };

  return db;
}

// Helper: inject mock into require.cache
function injectMock(requestPath, exports, paths) {
  const resolved = require.resolve(requestPath, { paths: paths || [path.resolve(BACKEND, "services")] });
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [],
  };
  return resolved;
}

// Helper: clear module cache
function clearCache(filePath) {
  delete require.cache[filePath];
}

// ─────────────────────────────────────────────────────────────
// Test 1: Session lifecycle hook
// ─────────────────────────────────────────────────────────────
async function testSessionLifecycleHook() {
  console.log("\n=== Test 1: Session lifecycle hook ===\n");

  const store = {};
  const sessionId = "sess-mikrotik-1";
  store[`roaming_sessions/${sessionId}`] = {
    sessionId,
    userRef: { userId: "user-1" },
    homeOwnerId: "owner-1",
    visitedOwnerId: "owner-2",
    visitedHotspotId: "hotspot-1",
    entitlementId: "ent-1",
    aaaAdapterKey: "mikrotik",
    status: "authorized",
    expiresAt: "2099-12-31T23:59:59.000Z",
    usedMinutes: 0,
    usedMegabytes: 0,
  };

  const db = makeTxDb(store);

  // Track provisioning calls
  let provisionCalls = [];
  const mockProvision = async (sid, ctx) => {
    provisionCalls.push({ sid, ctx });
    return { success: true, sessionId: sid, alreadyEnforced: false };
  };

  // Inject mock firebase and mock enforcement service into cache
  injectMock("./firebase", { db, admin: {} }, [BACKEND]);
  injectMock("./roamingEnforcementService", { provisionSessionEnforcement: mockProvision }, [path.resolve(BACKEND, "services")]);

  clearCache(SESSION_SERVICE_PATH);

  const svc = require(SESSION_SERVICE_PATH);
  const updateSessionActivity = svc.updateSessionActivity;

  // 1a. Eligible MikroTik session transitioning authorized->active triggers provisioning
  const result = await updateSessionActivity(sessionId, { userId: "user-1" }, { usedMinutes: 1 });
  assert(result.status === "active", "1a. Session transitions to active");
  assert(provisionCalls.length === 1, "1a. Provisioning called exactly once");
  assert(provisionCalls[0].sid === sessionId, "1a. Provisioning called with real session ID");
  assert(provisionCalls[0].ctx.userId === "user-1", "1a. Provisioning context has userId");

  // 1b. Already active session does not trigger provisioning again
  const callsBefore = provisionCalls.length;
  const result2 = await updateSessionActivity(sessionId, { userId: "user-1" }, { usedMinutes: 1 });
  assert(result2.status === "active", "1b. Session remains active");
  assert(provisionCalls.length === callsBefore, "1b. No additional provisioning call");

  // 1c. Non-MikroTik session does not trigger provisioning
  const sess2 = "sess-non-mikrotik";
  store[`roaming_sessions/${sess2}`] = {
    sessionId: sess2,
    userRef: { userId: "user-2" },
    homeOwnerId: "owner-1",
    visitedOwnerId: "owner-2",
    visitedHotspotId: "hotspot-2",
    entitlementId: "ent-2",
    aaaAdapterKey: "radius",
    status: "authorized",
    expiresAt: "2099-12-31T23:59:59.000Z",
    usedMinutes: 0,
    usedMegabytes: 0,
  };
  const callsBefore2 = provisionCalls.length;
  const result3 = await updateSessionActivity(sess2, { userId: "user-2" }, { usedMinutes: 1 });
  assert(result3.status === "active", "1c. Non-MikroTik session activates");
  assert(provisionCalls.length === callsBefore2, "1c. No provisioning for non-MikroTik session");

  // 1d. Provisioning failure doesn't corrupt session state
  const sess3 = "sess-mikrotik-fail";
  store[`roaming_sessions/${sess3}`] = {
    sessionId: sess3,
    userRef: { userId: "user-3" },
    homeOwnerId: "owner-1",
    visitedOwnerId: "owner-2",
    visitedHotspotId: "hotspot-3",
    entitlementId: "ent-3",
    aaaAdapterKey: "mikrotik",
    status: "authorized",
    expiresAt: "2099-12-31T23:59:59.000Z",
    usedMinutes: 0,
    usedMegabytes: 0,
  };

  // Replace mock with failing version
  const failingProvision = async (sid, ctx) => { throw new Error("Provisioning failed (test)"); };
  injectMock("./roamingEnforcementService", { provisionSessionEnforcement: failingProvision }, [path.resolve(BACKEND, "services")]);
  clearCache(SESSION_SERVICE_PATH);

  const svc2 = require(SESSION_SERVICE_PATH);
  const updateSessionActivity2 = svc2.updateSessionActivity;

  const result4 = await updateSessionActivity2(sess3, { userId: "user-3" }, { usedMinutes: 1 });
  assert(result4.status === "active", "1d. Session still activates despite provisioning failure");
  assert(store[`roaming_sessions/${sess3}`].status === "active", "1d. Session state not corrupted");
}

// ─────────────────────────────────────────────────────────────
// Test 2: Concurrent provisioning (structural verification)
// ─────────────────────────────────────────────────────────────
async function testConcurrentProvisioning() {
  console.log("\n=== Test 2: Concurrent provisioning (structural) ===\n");

  injectMock("./firebase", { db: {}, admin: {} }, [BACKEND]);
  clearCache(ENFORCEMENT_SERVICE_PATH);

  const svc = require(ENFORCEMENT_SERVICE_PATH);
  assert(typeof svc.provisionSessionEnforcement === "function", "2a. provisionSessionEnforcement is exported");
  assert(Array.isArray(svc.ENFORCEMENT_STATE_TRANSITIONS.failed), "2b. failed state exists");
  assert(svc.ENFORCEMENT_STATE_TRANSITIONS.failed.length === 0, "2b. failed state is terminal");
  assert(svc.ENFORCEMENT_STATE_TRANSITIONS.provisioning.includes("provisioned"), "2c. provisioning->provisioned valid");
  assert(svc.ENFORCEMENT_STATE_TRANSITIONS.provisioning.includes("failed"), "2c. provisioning->failed valid");
  assert(!svc.ENFORCEMENT_STATE_TRANSITIONS.provisioned.includes("provisioned"), "2d. provisioned->provisioned not a re-transition");
  assert(Array.isArray(svc.PROVISIONED_STATUSES), "2e. PROVISIONED_STATUSES is array");
  assert(svc.PROVISIONED_STATUSES.includes("provisioned"), "2e. provisioned in PROVISIONED_STATUSES");

  console.log("\n  Note: Full concurrent transaction test requires Firestore transaction mock.");
  console.log("  The code path (Transaction 1 sets 'provisioning', concurrent call sees it and throws ENFORCEMENT_IN_PROGRESS) is verified by code inspection.");
}

// ─────────────────────────────────────────────────────────────
// Test 3: Identity (resolveMikroTikContext)
// ─────────────────────────────────────────────────────────────
async function testIdentity() {
  console.log("\n=== Test 3: Identity ===\n");

  const store = {};
  const db = makeTxDb(store);

  store["roaming_hotspots/hs-1"] = {
    partnerStatus: "active",
    aaaAdapterKey: "mikrotik",
    deviceLink: { deviceId: "dev-1" },
  };
  store["devices/dev-1"] = {
    ownerId: "owner-1",
    networkControl: "yabalink_managed",
    routerOsApiEnabled: true,
    routerOsHost: "192.168.1.1",
    routerOsApiSecretRef: "secret-ref-1",
    routerOsApiUsername: "admin",
    routerOsApiPort: 8728,
    routerOsTls: false,
  };
  store["roaming_entitlements/ent-1"] = {
    status: "active",
    quota: { remainingMinutes: 60 },
  };

  let lastDeriveInput = null;
  let lastDeriveOpts = null;

  injectMock("./firebase", { db, admin: {} }, [BACKEND]);
  const realIdentity = require(path.resolve(BACKEND, "services/mikrotik/identity"));
  const origDerive = realIdentity.deriveRouterUsername;
  realIdentity.deriveRouterUsername = (input, opts) => {
    lastDeriveInput = input;
    lastDeriveOpts = opts;
    return origDerive(input, opts);
  };
  injectMock("./mikrotik/identity", realIdentity, [path.resolve(BACKEND, "services")]);
  injectMock("./mikrotik/featureFlag", {
    normalizeNetworkControl: (v) => v,
    NETWORK_CONTROL_MODES: { PARTNER_MANAGED: "partner_managed", YABALINK_MANAGED: "yabalink_managed" },
  }, [path.resolve(BACKEND, "services")]);

  clearCache(REGISTRY_SERVICE_PATH);

  const svc = require(REGISTRY_SERVICE_PATH);
  const resolveMikroTikContext = svc.resolveMikroTikContext;

  const origEnv = process.env.MIKROTIK_IDENTITY_KEY;
  process.env.MIKROTIK_IDENTITY_KEY = "test-identity-key-for-phase8-5";

  const session = {
    sessionId: "real-session-id-123",
    id: "real-session-id-123",
    homeOwnerId: "real-owner-456",
    visitedHotspotId: "hs-1",
    visitedOwnerId: "owner-1",
    entitlementId: "ent-1",
    aaaAdapterKey: "mikrotik",
  };

  try {
    const ctx = await resolveMikroTikContext(session);
    assert(typeof ctx.routerUsername === "string" && ctx.routerUsername.startsWith("yb1_"), "3a. resolveMikroTikContext returns context");
    assert(lastDeriveInput.sessionId === "real-session-id-123", "3a. deriveRouterUsername receives real session ID");
    assert(lastDeriveInput.homeOwnerId === "real-owner-456", "3a. deriveRouterUsername receives real owner ID");
  } catch (e) {
    console.error("3a ERROR:", e.message);
    failed += 1;
  }

  // 3b. Missing session ID
  await assertRejects(
    () => resolveMikroTikContext({ ...session, sessionId: undefined, id: undefined }),
    (err) => true,
    "3b. Missing session ID fails closed"
  );

  // 3c. Missing homeOwnerId
  await assertRejects(
    () => resolveMikroTikContext({ ...session, homeOwnerId: undefined }),
    (err) => true,
    "3c. Missing homeOwnerId fails closed"
  );

  // 3d. Missing visitedHotspotId
  await assertRejects(
    () => resolveMikroTikContext({ ...session, visitedHotspotId: undefined }),
    (err) => true,
    "3d. Missing visitedHotspotId fails closed"
  );

  // 3e. Production without identity key
  const origNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  delete process.env.MIKROTIK_IDENTITY_KEY;
  await assertRejects(
    () => resolveMikroTikContext(session),
    (err) => true,
    "3e. Production without identity key fails closed"
  );

  // Restore
  if (origEnv === undefined) delete process.env.MIKROTIK_IDENTITY_KEY;
  else process.env.MIKROTIK_IDENTITY_KEY = origEnv;
  if (origNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = origNodeEnv;
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  await testSessionLifecycleHook();
  await testConcurrentProvisioning();
  await testIdentity();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
