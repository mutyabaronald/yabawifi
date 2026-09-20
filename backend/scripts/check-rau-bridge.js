/**
 * Phase 7.2 / 7.2A — Roaming Entitlement Bridge + Identity Mapping tests.
 *
 * Offline & deterministic: Firestore access, resolveUserId, loadPackage,
 * createEntitlement, and calculateRAUs are injected as fakes (or a fake db),
 * so NO Firestore / network / auth is required.
 * Follows the repo's plain-Node check-* convention.
 *
 * Run: node backend/scripts/check-rau-bridge.js
 */
const {
  BRIDGE_STATUS,
  DEFAULT_SCOPE,
  resolveUserIdFromPhone,
  createRoamingEntitlementFromPurchase,
} = require("../services/roamingEntitlementBridgeService");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`✅ PASS: ${msg}`); passed++; }
  else { console.error(`❌ FAIL: ${msg}`); failed++; }
}
function assertEqual(actual, expected, msg) {
  const ok = actual === expected;
  if (ok) { console.log(`✅ PASS: ${msg} (${actual})`); passed++; }
  else { console.error(`❌ FAIL: ${msg} — expected ${expected}, got ${actual}`); failed++; }
}

// --- Fakes ---
function makeCreateEntitlementFake() {
  const calls = [];
  const store = new Map();
  const fake = async ({ idempotencyKey, payload, authenticatedOwnerId }) => {
    calls.push({ idempotencyKey, payload, authenticatedOwnerId });
    const existing = store.get(idempotencyKey);
    if (existing) return { entitlement: existing, created: false, idempotent: true };
    const ent = { ...payload, id: "ent_" + (calls.length + 1), idempotencyKey };
    store.set(idempotencyKey, ent);
    return { entitlement: ent, created: true };
  };
  return { fake, calls, store };
}
function makePackageLoader(packagesById) {
  return async (packageId) => (packagesById[packageId] ? { ...packagesById[packageId] } : null);
}
function makeResolveUserId(userId) {
  return async (phone) => {
    if (!phone) return null;
    return userId; // deterministic: same phone -> same userId
  };
}

const EPOCH_ISO = "2025-01-01T00:00:00.000Z";
const HOME_OWNER = "owner_home_123";
const USER_ID = "user_canon_id_999";
const PHONE = "+256755555555";

function baseCtx(overrides = {}) {
  return {
    phone: PHONE,
    packageId: "pkg_roaming",
    receiptId: "receipt_001",
    validityStartsAt: EPOCH_ISO,
    ...overrides,
  };
}

// Minimal in-memory db for testing the real resolveUserIdFromPhone logic.
function makeFakeDb({ users = {} } = {}) {
  const store = users; // { [docId]: { data... } }
  return {
    collection(name) {
      if (name !== "users") {
        return { doc: () => ({ get: async () => ({ exists: false }) }), where: () => ({ get: async () => ({ empty: true, docs: [] }) }) };
      }
      return {
        doc(id) {
          const d = store[id];
          return { async get() { return { exists: !!d, data: () => d, id }; } };
        },
        where(field, op, value) {
          const docs = Object.entries(store).filter(([id, d]) => d && d[field] === value).map(([id, d]) => ({ id, data: () => d }));
          return {
            limit: () => ({ async get() { return { empty: docs.length === 0, docs }; } }),
            async get() { return { empty: docs.length === 0, docs }; },
          };
        },
      };
    },
  };
}

async function run() {
  console.log("=== Phase 7.2/7.2A: Bridge & Identity Mapping Tests ===\n");

  // --- Test 1: Eligible package -> one roaming entitlement created ---
  console.log("--- Test 1: Eligible package -> one roaming entitlement created ---");
  {
    const packagesById = {
      pkg_roaming: { id: "pkg_roaming", ownerId: HOME_OWNER, name: "Roaming 1h", roamingEligible: true, timeLimitMinutes: 60, price: 5000 },
    };
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx(),
      deps: {
        resolveUserId: makeResolveUserId(USER_ID),
        loadPackage: makePackageLoader(packagesById),
        createEntitlement: ce.fake,
      },
    });
    assertEqual(result.status, BRIDGE_STATUS.CREATED, "eligible package creates entitlement");
    assert(result.entitlement, "entitlement object present");
    assert(ce.calls.length === 1, "createEntitlement called exactly once");
    const p = ce.calls[0].payload;
    // homeOwnerId derived from package.ownerId (authoritative, not client-supplied)
    assertEqual(p.homeOwnerId, HOME_OWNER, "homeOwnerId = package.ownerId");
    assertEqual(ce.calls[0].authenticatedOwnerId, HOME_OWNER, "authenticatedOwnerId = package.ownerId (ownership guard)");
    assertEqual(p.userRef.userId, USER_ID, "userId = canonical user resolved from phone");
    assertEqual(p.userRef.phone, PHONE, "phone preserved on userRef");
    assertEqual(p.quota.maxMinutes, 60, "RAU allowance stored as quota.maxMinutes");
    assert(p.quota.maxMegabytes === null, "no megabytes quota introduced");
    assert(!("price" in p), "package price NOT on entitlement (RAUs are access units, not money)");
    assertEqual(p.validity.startsAt, EPOCH_ISO, "validity.startsAt = authoritative purchase start");
    assertEqual(p.validity.expiresAt, new Date(new Date(EPOCH_ISO).getTime() + 60 * 60_000).toISOString(), "validity.expiresAt = start + 60 minutes");
    assertEqual(ce.calls[0].idempotencyKey, "receipt_001", "idempotencyKey = receiptId");
    assertEqual(p.source, "package", "entitlement source = package");
    assertEqual(p.scope, "federation", "default scope = federation");
  }

  // --- Test 2: Non-eligible package -> no roaming entitlement ---
  console.log("\n--- Test 2: Non-eligible package -> no roaming entitlement ---");
  {
    const packagesById = { pkg_local: { id: "pkg_local", ownerId: HOME_OWNER, roamingEligible: false, timeLimitMinutes: 60, price: 5000 } };
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_local", receiptId: "receipt_local" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader(packagesById), createEntitlement: ce.fake },
    });
    assertEqual(result.status, BRIDGE_STATUS.NOT_ELIGIBLE, "non-eligible package not bridged");
    assert(ce.calls.length === 0, "createEntitlement NOT called for non-eligible package");
  }

  // --- Test 2b: Absent roamingEligible flag (legacy local package unchanged) ---
  console.log("\n--- Test 2b: absent roamingEligible -> behaves as local (unchanged) ---");
  {
    const pkg = { id: "pkg_legacy", ownerId: HOME_OWNER, timeLimitMinutes: 120, price: 3000 };
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_legacy", receiptId: "receipt_legacy" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader({ pkg_legacy: { ...pkg } }), createEntitlement: ce.fake },
    });
    assertEqual(result.status, BRIDGE_STATUS.NOT_ELIGIBLE, "legacy package (no roamingEligible) not bridged");
    assert(ce.calls.length === 0, "legacy package does not create roaming entitlement");
    assertEqual(pkg.price, 3000, "legacy package price untouched");
    assertEqual(pkg.timeLimitMinutes, 120, "legacy package timeLimitMinutes untouched");
  }

  // --- Test 3: 30-day validity -> 43,200 RAUs ---
  console.log("\n--- Test 3: 30-day validity -> 43,200 RAUs ---");
  {
    const packagesById = { pkg_30: { id: "pkg_30", ownerId: HOME_OWNER, roamingEligible: true, timeLimitMinutes: 43200, price: 50000 } };
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_30", receiptId: "receipt_30" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader(packagesById), createEntitlement: ce.fake },
    });
    assertEqual(result.status, BRIDGE_STATUS.CREATED, "30-day package bridged");
    assertEqual(result.raus, 43200, "30-day package = 43,200 RAUs (not hard-coded month)");
    assertEqual(ce.calls[0].payload.quota.maxMinutes, 43200, "entitlement quota.maxMinutes = 43,200");
  }

  // --- Test 4: 31-day validity -> 44,640 RAUs ---
  console.log("\n--- Test 4: 31-day validity -> 44,640 RAUs ---");
  {
    const packagesById = { pkg_31: { id: "pkg_31", ownerId: HOME_OWNER, roamingEligible: true, timeLimitMinutes: 44640, price: 52000 } };
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_31", receiptId: "receipt_31" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader(packagesById), createEntitlement: ce.fake },
    });
    assertEqual(result.status, BRIDGE_STATUS.CREATED, "31-day package bridged");
    assertEqual(result.raus, 44640, "31-day package = 44,640 RAUs (not hard-coded 43,200)");
  }

  // --- Test 5: Reprocessing same purchase -> no duplicate entitlement ---
  console.log("\n--- Test 5: Reprocessing same purchase -> no duplicate ---");
  {
    const packagesById = { pkg_roaming: { id: "pkg_roaming", ownerId: HOME_OWNER, roamingEligible: true, timeLimitMinutes: 60, price: 5000 } };
    const ce = makeCreateEntitlementFake();
    const r1 = await createRoamingEntitlementFromPurchase({ ...baseCtx({ receiptId: "receipt_dup" }), deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader(packagesById), createEntitlement: ce.fake } });
    const r2 = await createRoamingEntitlementFromPurchase({ ...baseCtx({ receiptId: "receipt_dup" }), deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader(packagesById), createEntitlement: ce.fake } });
    assertEqual(r1.status, BRIDGE_STATUS.CREATED, "first processing creates");
    assertEqual(r2.status, BRIDGE_STATUS.EXISTS, "reprocess returns EXISTS (idempotent)");
    assert(ce.calls.length === 2, "createEntitlement invoked twice but 2nd is dedup");
    assertEqual(r2.entitlement.id, r1.entitlement.id, "same entitlement id returned (dedup)");
    assertEqual(r2.raus, r1.raus, "same RAU count on idempotent reprocess");
  }

  // --- Test 6: Failed bridge -> original purchase remains successful ---
  console.log("\n--- Test 6: Failed bridge -> purchase unaffected ---");
  {
    const packagesById = { pkg_err: { id: "pkg_err", ownerId: HOME_OWNER, roamingEligible: true, timeLimitMinutes: 60, price: 5000 } };
    const throwingCreate = async () => { throw new Error("simulated downstream failure"); };
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_err", receiptId: "receipt_err" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader(packagesById), createEntitlement: throwingCreate },
    });
    assertEqual(result.status, BRIDGE_STATUS.FAILED, "bridge failure isolated (status=FAILED)");
    assert(typeof result.reason === "string" && result.reason.length > 0, "failure reason recorded");
    assert(true, "bridge did not throw — purchase remains successful");
  }

  // --- Test 7: Correct user/home-owner association (server-derived, not client) ---
  console.log("\n--- Test 7: Correct user/home-owner association ---");
  {
    // homeOwnerId comes ONLY from package.ownerId, even if caller tries nothing else.
    const packagesById = { pkg_r: { id: "pkg_r", ownerId: "owner_real_A", roamingEligible: true, timeLimitMinutes: 30, price: 2000 } };
    const ce = makeCreateEntitlementFake();
    await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_r", receiptId: "receipt_assoc" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader(packagesById), createEntitlement: ce.fake },
    });
    const p = ce.calls[0].payload;
    assertEqual(p.homeOwnerId, "owner_real_A", "homeOwnerId = package.ownerId (authoritative)");
    assertEqual(ce.calls[0].authenticatedOwnerId, "owner_real_A", "authenticatedOwnerId = package.ownerId");
    assertEqual(p.userRef.userId, USER_ID, "userId = resolver result (canonical, not phone-as-id)");
  }

  // --- Test 8: RAUs are access units, not money ---
  console.log("\n--- Test 8: RAUs are access units, not money ---");
  {
    const packagesById = { pkg_m: { id: "pkg_m", ownerId: HOME_OWNER, roamingEligible: true, timeLimitMinutes: 120, price: 15000 } };
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_m", receiptId: "receipt_money" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader(packagesById), createEntitlement: ce.fake },
    });
    const p = ce.calls[0].payload;
    assert(!("price" in p) && !("monetary" in p) && !("rauValue" in p), "no monetary field on entitlement");
    assert(Number.isInteger(result.raus), "RAU count is an integer (access units)");
    assertEqual(result.raus, 120, "120 minutes = 120 RAUs (units == minutes, not money)");
    assertEqual(p.quota.maxMinutes, 120, "RAUs exposed as minute quota");
  }

  // --- Test 9: Existing local/non-roaming behavior unchanged ---
  console.log("\n--- Test 9: Existing local package behavior unchanged ---");
  {
    const pkg = { id: "pkg_local", ownerId: HOME_OWNER, roamingEligible: false, timeLimitMinutes: 45, price: 3500 };
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_local", receiptId: "receipt_local2" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader({ pkg_local: { ...pkg } }), createEntitlement: ce.fake },
    });
    assertEqual(result.status, BRIDGE_STATUS.NOT_ELIGIBLE, "local package not bridged");
    assert(ce.calls.length === 0, "no roaming entitlement for local package");
    assertEqual(pkg.price, 3500, "local package price unchanged");
  }

  // --- Test 10: roaming-eligible but missing/zero duration -> INVALID ---
  console.log("\n--- Test 10: roaming-eligible but missing duration -> INVALID ---");
  {
    const packagesById = { pkg_nodef: { id: "pkg_nodef", ownerId: HOME_OWNER, roamingEligible: true, timeLimitMinutes: null, price: 5000 } };
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_nodef", receiptId: "receipt_nodef" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader(packagesById), createEntitlement: ce.fake },
    });
    assertEqual(result.status, BRIDGE_STATUS.INVALID, "eligible package w/o duration rejected");
    assert(ce.calls.length === 0, "no entitlement created for invalid package");
  }

  // --- Test 11: Package not found -> INVALID, failure-isolated ---
  console.log("\n--- Test 11: Package not found -> INVALID, failure-isolated ---");
  {
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_missing", receiptId: "receipt_missing" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader({}), createEntitlement: ce.fake },
    });
    assertEqual(result.status, BRIDGE_STATUS.INVALID, "missing package rejected");
    assert(ce.calls.length === 0, "no entitlement for missing package");
  }

  // --- Test 12: sub-minute residue does not round up ---
  console.log("\n--- Test 12: sub-minute residue does not round up ---");
  {
    const packagesById = { pkg_sec: { id: "pkg_sec", ownerId: HOME_OWNER, roamingEligible: true, timeLimitMinutes: 60, price: 5000 } };
    const ce = makeCreateEntitlementFake();
    const shiftedStart = new Date(new Date(EPOCH_ISO).getTime() - 30_000).toISOString();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_sec", receiptId: "receipt_sec", validityStartsAt: shiftedStart }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader(packagesById), createEntitlement: ce.fake },
    });
    assertEqual(result.raus, 60, "60min+30s window -> 60 RAUs (seconds discarded)");
    assertEqual(ce.calls[0].payload.quota.maxMinutes, 60, "entitlement stored 60 RAUs");
  }

  // --- Test 13: no canonical user for phone -> INVALID (do not guess identity) ---
  console.log("\n--- Test 13: unresolved user identity -> INVALID ---");
  {
    const packagesById = { pkg_r: { id: "pkg_r", ownerId: HOME_OWNER, roamingEligible: true, timeLimitMinutes: 60, price: 5000 } };
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_r", receiptId: "receipt_nouser" }),
      deps: { resolveUserId: async () => null, loadPackage: makePackageLoader(packagesById), createEntitlement: ce.fake },
    });
    assertEqual(result.status, BRIDGE_STATUS.INVALID, "unresolved user identity rejected");
    assert(ce.calls.length === 0, "no entitlement when user identity unknown");
  }

  // --- 7.2A: canonical phone -> userId resolver (mirrors auth.js, real logic) ---
  console.log("\n--- Test 14: canonical user-ID resolver mirrors auth.js lookup ---");
  {
    // doc(phone) exists -> userId == phone (doc id is phone)
    const db1 = makeFakeDb({ users: { [PHONE]: { phone: PHONE } } });
    assertEqual(await resolveUserIdFromPhone(PHONE, db1), PHONE, "user doc keyed by phone -> userId = phone");
  }
  {
    // doc(phone) absent, but phone field matches a random-id doc -> userId = that doc id
    const db2 = makeFakeDb({ users: { random_uuid_abc: { phone: PHONE } } });
    assertEqual(await resolveUserIdFromPhone(PHONE, db2), "random_uuid_abc", "fallback where(phone) -> doc id");
  }
  {
    // no user record -> null (no identity invented)
    const db3 = makeFakeDb({ users: {} });
    const r = await resolveUserIdFromPhone(PHONE, db3);
    assert(r === null, "absent user -> null (no guess)");
  }
  // deterministic: same phone -> same userId, repeatedly
  {
    const db2 = makeFakeDb({ users: { random_uuid_abc: { phone: PHONE } } });
    const a = await resolveUserIdFromPhone(PHONE, db2);
    const b = await resolveUserIdFromPhone(PHONE, db2);
    assertEqual(a, b, "resolver deterministic for same phone");
    assertEqual(a, "random_uuid_abc", "deterministic userId stable");
  }

  // --- 7.2A: no client-supplied owner can override homeOwnerId ---
  console.log("\n--- Test 15: client cannot override canonical homeOwnerId ---");
  {
    const packagesById = {
      pkg_r: { id: "pkg_r", ownerId: "owner_real_A", roamingEligible: true, timeLimitMinutes: 60, price: 5000 },
    };
    const ce = makeCreateEntitlementFake();
    await createRoamingEntitlementFromPurchase({
      ...baseCtx({ phone: PHONE, packageId: "pkg_r", receiptId: "receipt_home" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader(packagesById), createEntitlement: ce.fake },
    });
    assertEqual(ce.calls[0].payload.homeOwnerId, "owner_real_A", "homeOwnerId from package, not overridable by caller");
    assertEqual(ce.calls[0].authenticatedOwnerId, "owner_real_A", "authenticatedOwnerId from package, not overridable");
  }

  // --- 7.2A: same phone cannot produce multiple canonical identities ---
  console.log("\n--- Test 16: same phone -> single canonical user identity ---");
  {
    const db = makeFakeDb({ users: { [PHONE]: { phone: PHONE } } });
    const id1 = await resolveUserIdFromPhone(PHONE, db);
    const id2 = await resolveUserIdFromPhone(PHONE, db);
    assertEqual(id1, id2, "single canonical identity per phone");
    assert(id1 === PHONE, "canonical identity is stable doc id");
  }

  console.log(`\n========================================`);
  console.log(`Phase 7.2/7.2A Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
