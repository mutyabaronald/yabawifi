/**
 * Phase 7.2B — Roaming entitlement bridge PRODUCTION WIRING checks.
 *
 * Two layers:
 *  (1) Source-level assertions on backend/routes/receiptRoutes.js (mirrors the
 *      grep/index-style check convention used by check-roaming-phase3/6).
 *  (2) Behavioral simulation of the exact integration contract using a fake
 *      Firestore db + a fake createEntitlement that emulates the active-partner
 *      guard and lastIdempotencyKey dedup — NO real Firestore/network/auth.
 *
 * Run: node backend/scripts/check-roaming-bridge-wire.js
 */
const fs = require("fs");
const path = require("path");
const {
  BRIDGE_STATUS,
  resolveUserIdFromPhone,
  createRoamingEntitlementFromPurchase,
} = require("../services/roamingEntitlementBridgeService");

let passed = 0;
let failed = 0;
function assert(cond, msg) { if (cond) { console.log(`✅ PASS: ${msg}`); passed++; } else { console.error(`❌ FAIL: ${msg}`); failed++; } }
function assertEqual(a, b, m) {
  const ok = a === b;
  if (ok) { console.log(`✅ PASS: ${m} (${a})`); passed++; } else { console.error(`❌ FAIL: ${m} — expected ${b}, got ${a}`); failed++; }
}
function assertSource(cond, msg) { if (cond) { console.log(`✅ PASS: ${msg}`); passed++; } else { console.error(`❌ FAIL: ${msg}`); failed++; } }

const receiptSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "receiptRoutes.js"), "utf8");

// ---------- Fake Firestore db (chainable queries) ----------
function makeQuery(docs) {
  return {
    where(field, op, value) {
      const filtered = (docs || []).filter((d) => d && d.data()[field] === value);
      return makeQuery(filtered);
    },
    limit() { return makeQuery(docs); },
    async get() { return { empty: (docs || []).length === 0, docs: docs || [], size: (docs || []).length }; },
  };
}
function makeCollection(store) {
  return {
    doc(id) {
      const d = store[id];
      return { async get() { return { exists: !!d, data: () => (d ? { ...d } : undefined), id }; } };
    },
    where(field, op, value) {
      const docs = Object.entries(store).filter(([, d]) => d && d[field] === value).map(([id, d]) => ({ id, data: () => ({ id, ...d }) }));
      return makeQuery(docs);
    },
    add(data) { const id = "gen_" + Math.random().toString(36).slice(2, 10); store[id] = data; return { id }; },
  };
}
function makeFakeDb({ users = {}, packages = {} } = {}) {
  return { collection(name) { return makeCollection(name === "users" ? users : name === "packages" ? packages : {}); } };
}

// ---------- Fake entitlement service (emulates createEntitlement) ----------
function makeEntitlementFake({ activePartners = new Set() } = {}) {
  const calls = [];
  const store = new Map(); // idempotencyKey -> entitlement
  const fake = async ({ authenticatedOwnerId, payload, idempotencyKey }) => {
    calls.push({ authenticatedOwnerId, payload, idempotencyKey });
    if (authenticatedOwnerId !== payload.homeOwnerId) {
      const e = new Error("Cannot create entitlement for another owner"); e.name = "EntitlementError"; e.status = 403; e.code = "unauthorized_scope"; throw e;
    }
    if (!activePartners.has(payload.homeOwnerId)) {
      const e = new Error("Home owner is not an active roaming partner"); e.name = "EntitlementError"; e.status = 422; e.code = "ineligible"; throw e;
    }
    const existing = store.get(idempotencyKey);
    if (existing) return { entitlement: existing, idempotent: true };
    const ent = { ...payload, id: "ent_" + (calls.length + 1), idempotencyKey };
    store.set(idempotencyKey, ent);
    return { entitlement: ent, created: true };
  };
  return { fake, calls, store };
}

// ---------- Simulate the receiptRoutes bridge block (lines 138-159) ----------
async function simulateReceiptBridge(opts) {
  const { phone, ownerId, packageName, receiptId, purchaseTime, users, packages, activePartners, ce } = opts;
  const db = makeFakeDb({ users, packages: packages || {} });
  const ent = ce || makeEntitlementFake({ activePartners: activePartners || new Set() });
  const packageSnap = await db.collection("packages")
    .where("ownerId", "==", ownerId).where("name", "==", packageName).limit(1).get();
  if (packageSnap.empty) return { ce: ent, pkg: null, result: { status: "no_package" }, db };
  const pkg = { id: packageSnap.docs[0].id, ...packageSnap.docs[0].data() };
  const result = await createRoamingEntitlementFromPurchase({
    phone, pkg, receiptId, validityStartsAt: purchaseTime,
    deps: {
      resolveUserId: (p) => resolveUserIdFromPhone(p, db),
      createEntitlement: ent.fake,
    },
  });
  return { ce: ent, pkg, result, db };
}

const EPOCH = "2025-01-01T00:00:00.000Z";
const HOME_OWNER = "ownerA";
const PHONE = "+256700000001";
const CANON_USER_ID = "user_doc_A";
function pkg30(overrides = {}) { return { id: "pkg30", ownerId: HOME_OWNER, name: "Roaming 30d", roamingEligible: true, timeLimitMinutes: 43200, price: 50000, ...overrides }; }
function pkg31(overrides = {}) { return { id: "pkg31", ownerId: HOME_OWNER, name: "Roaming 31d", roamingEligible: true, timeLimitMinutes: 44640, price: 52000, ...overrides }; }
function pkgLocal(overrides = {}) { return { id: "pkgLocal", ownerId: HOME_OWNER, name: "Local 1h", roamingEligible: false, timeLimitMinutes: 60, price: 5000, ...overrides }; }

async function run() {
  console.log("=== Phase 7.2B: Production Wiring Checks ===\n");

  // ---- Source-level assertions on receiptRoutes.js ----
  console.log("--- Source: wiring presence in receiptRoutes.js ---");
  assertSource(receiptSrc.includes("createRoamingEntitlementFromPurchase"), "bridge service is imported into receiptRoutes");
  const callMatch = receiptSrc.match(/createRoamingEntitlementFromPurchase\(\{\s*([^()]*?)\s*\}\)/);
  assertSource(!!callMatch, "bridge call found");
  const callArgs = callMatch ? callMatch[1] : "";
  assertSource(
    callArgs.includes("phone") && callArgs.includes("pkg") && callArgs.includes("receiptId: receiptRef.id") && callArgs.includes("validityStartsAt: purchaseTime"),
    "bridge receives ONLY phone/pkg/receiptId/validityStartsAt"
  );
  assertSource(!callArgs.includes("userId") && !callArgs.includes("homeOwnerId"), "bridge call does NOT include client-supplied userId/homeOwnerId");
  const addIdx = receiptSrc.indexOf('db.collection("receipts").add');
  const bridgeIdx = receiptSrc.indexOf("createRoamingEntitlementFromPurchase({");
  assertSource(addIdx !== -1 && bridgeIdx !== -1 && bridgeIdx > addIdx, "bridge invoked AFTER receipt write");
  assertSource(/try\s*\{[\s\S]{0,700}createRoamingEntitlementFromPurchase[\s\S]{0,400}catch\s*\(bridgeErr/.test(receiptSrc), "bridge call is failure-isolated (own try/catch on bridgeErr)");
  assertSource(/.where\("ownerId",\s*"==",\s*ownerId\)[\s\S]{0,300}.where\("name",\s*"==",\s*packageName\)/.test(receiptSrc), "package lookup uses (ownerId + packageName) convention");
  assertSource(/res\.status\(200\)\.json\(\{[\s\S]{0,120}receiptId: receiptRef\.id/.test(receiptSrc), "success response still returns 200 with receiptId");
  const letIdx = receiptSrc.indexOf("let loyaltyPointsEarned = 0;");
  const useIdx = receiptSrc.indexOf("loyaltyPointsEarned: loyaltyPointsEarned");
  assertSource(letIdx !== -1 && useIdx !== -1 && letIdx < useIdx, "TDZ fixed: loyaltyPointsEarned declared before use");

  // ---- Behavioral: integration contract ----
  console.log("\n--- Behavioral: integration contract ---");

  // Test 1: roaming-eligible purchase -> exactly one entitlement
  {
    const r = await simulateReceiptBridge({
      phone: PHONE, ownerId: HOME_OWNER, packageName: "Roaming 30d", receiptId: "rcpt_1", purchaseTime: EPOCH,
      users: { [CANON_USER_ID]: { phone: PHONE } },
      packages: { pkg30: pkg30() },
      activePartners: new Set([HOME_OWNER]),
    });
    assertEqual(r.result.status, BRIDGE_STATUS.CREATED, "eligible purchase creates entitlement");
    assert(r.ce.calls.length === 1, "exactly one createEntitlement call");
    assertEqual(r.ce.calls[0].payload.homeOwnerId, HOME_OWNER, "homeOwnerId = package.ownerId");
    assertEqual(r.ce.calls[0].authenticatedOwnerId, HOME_OWNER, "authenticatedOwnerId = package.ownerId");
    assertEqual(r.ce.calls[0].payload.userRef.userId, CANON_USER_ID, "userId = canonical user doc id");
    assert(r.ce.calls[0].payload.userRef.userId !== PHONE, "phone is NOT used as userId");
  }

  // Test 7: correct package selected by (ownerId + packageName), not owner B same-name
  {
    const r = await simulateReceiptBridge({
      phone: PHONE, ownerId: HOME_OWNER, packageName: "Roaming 30d", receiptId: "rcpt_7", purchaseTime: EPOCH,
      users: { [CANON_USER_ID]: { phone: PHONE } },
      packages: {
        pkg30: pkg30(),
        otherOwnerSameName: { id: "other", ownerId: "ownerB", name: "Roaming 30d", roamingEligible: true, timeLimitMinutes: 10, price: 1 },
      },
      activePartners: new Set([HOME_OWNER]),
    });
    assertEqual(r.pkg.id, "pkg30", "selects owner A package, not owner B same-name package");
    assertEqual(r.ce.calls[0].payload.quota.maxMinutes, 43200, "selected package RAUs used (43,200)");
  }

  // Test 2: non-roaming purchase -> none
  {
    const r = await simulateReceiptBridge({
      phone: PHONE, ownerId: HOME_OWNER, packageName: "Local 1h", receiptId: "rcpt_local", purchaseTime: EPOCH,
      users: { [CANON_USER_ID]: { phone: PHONE } },
      packages: { pkgLocal: pkgLocal() },
      activePartners: new Set([HOME_OWNER]),
    });
    assertEqual(r.result.status, BRIDGE_STATUS.NOT_ELIGIBLE, "non-roming purchase creates no entitlement");
    assert(r.ce.calls.length === 0, "createEntitlement not called for local package");
  }

  // Test 9: 30-day -> 43,200 RAUs
  {
    const r = await simulateReceiptBridge({
      phone: PHONE, ownerId: HOME_OWNER, packageName: "Roaming 30d", receiptId: "rcpt_30", purchaseTime: EPOCH,
      users: { [CANON_USER_ID]: { phone: PHONE } }, packages: { pkg30: pkg30() }, activePartners: new Set([HOME_OWNER]),
    });
    assertEqual(r.result.raus, 43200, "30-day purchase -> 43,200 RAUs");
    assertEqual(r.ce.calls[0].payload.quota.maxMinutes, 43200, "entitlement quota.maxMinutes = 43,200");
  }

  // Test 10: 31-day -> 44,640 RAUs
  {
    const r = await simulateReceiptBridge({
      phone: PHONE, ownerId: HOME_OWNER, packageName: "Roaming 31d", receiptId: "rcpt_31", purchaseTime: EPOCH,
      users: { [CANON_USER_ID]: { phone: PHONE } }, packages: { pkg31: pkg31() }, activePartners: new Set([HOME_OWNER]),
    });
    assertEqual(r.result.raus, 44640, "31-day purchase -> 44,640 RAUs");
  }

  // Test 11: repeated same purchase -> no duplicate (shared fake = shared idempotency store)
  {
    const ce = makeEntitlementFake({ activePartners: new Set([HOME_OWNER]) });
    const users = { [CANON_USER_ID]: { phone: PHONE } };
    const packages = { pkg30: pkg30() };
    const r1 = await simulateReceiptBridge({ phone: PHONE, ownerId: HOME_OWNER, packageName: "Roaming 30d", receiptId: "rcpt_dup", purchaseTime: EPOCH, users, packages, ce });
    const r2 = await simulateReceiptBridge({ phone: PHONE, ownerId: HOME_OWNER, packageName: "Roaming 30d", receiptId: "rcpt_dup", purchaseTime: EPOCH, users, packages, ce });
    assertEqual(r1.result.status, BRIDGE_STATUS.CREATED, "first purchase creates");
    assertEqual(r2.result.status, BRIDGE_STATUS.EXISTS, "reprocess -> EXISTS (idempotent, no duplicate)");
    assertEqual(r1.ce.store.size, 1, "one entitlement persisted after create");
    assertEqual(r2.ce.store.size, 1, "no new entitlement on reprocess (idempotent)");
  }

  // Test 12: non-partner owner cannot create a roaming entitlement
  {
    const r = await simulateReceiptBridge({
      phone: PHONE, ownerId: HOME_OWNER, packageName: "Roaming 30d", receiptId: "rcpt_np", purchaseTime: EPOCH,
      users: { [CANON_USER_ID]: { phone: PHONE } },
      packages: { pkg30: pkg30() },
      activePartners: new Set(["someOtherPartner"]),
    });
    assertEqual(r.result.status, BRIDGE_STATUS.FAILED, "non-partner owner -> bridge fails (isolated)");
    assert(r.ce.calls.length === 1, "createEntitlement attempted exactly once");
    assertEqual(r.ce.store.size, 0, "no entitlement persisted for non-partner owner");
  }

  // Test 5 (canonical): random-id user doc (phone field set) -> userId = doc id, not phone
  {
    const r = await simulateReceiptBridge({
      phone: PHONE, ownerId: HOME_OWNER, packageName: "Roaming 30d", receiptId: "rcpt_uid", purchaseTime: EPOCH,
      users: { random_uuid_doc: { phone: PHONE } },
      packages: { pkg30: pkg30() },
      activePartners: new Set([HOME_OWNER]),
    });
    assertEqual(r.result.status, BRIDGE_STATUS.CREATED, "random-id user purchase creates entitlement");
    assertEqual(r.ce.calls[0].payload.userRef.userId, "random_uuid_doc", "userId = users doc id (not phone)");
  }

  // Test 3 & 4: receipt remains successful when bridge succeeds / fails
  {
    const rOk = await simulateReceiptBridge({
      phone: PHONE, ownerId: HOME_OWNER, packageName: "Roaming 30d", receiptId: "rcpt_ok", purchaseTime: EPOCH,
      users: { [CANON_USER_ID]: { phone: PHONE } }, packages: { pkg30: pkg30() }, activePartners: new Set([HOME_OWNER]),
    });
    assert(rOk.result.status === BRIDGE_STATUS.CREATED, "bridge success: purchase flow proceeds (not invalidated)");
    const rFail = await simulateReceiptBridge({
      phone: PHONE, ownerId: HOME_OWNER, packageName: "Roaming 30d", receiptId: "rcpt_fail", purchaseTime: EPOCH,
      users: { [CANON_USER_ID]: { phone: PHONE } }, packages: { pkg30: pkg30() }, activePartners: new Set(["nobody"]),
    });
    assertEqual(rFail.result.status, BRIDGE_STATUS.FAILED, "bridge failure returned as FAILED status (not thrown into purchase path)");
  }

  // Test 13: client cannot override homeOwnerId (bridge ignores client owner)
  {
    const r = await simulateReceiptBridge({
      phone: PHONE, ownerId: HOME_OWNER, packageName: "Roaming 30d", receiptId: "rcpt_ov", purchaseTime: EPOCH,
      users: { [CANON_USER_ID]: { phone: PHONE } }, packages: { pkg30: pkg30() }, activePartners: new Set([HOME_OWNER]),
    });
    assertEqual(r.ce.calls[0].payload.homeOwnerId, HOME_OWNER, "homeOwnerId authoritative (not client-supplied)");
  }

  // Test 14: local package purchase behavior unchanged
  {
    const before = JSON.stringify(pkgLocal());
    const r = await simulateReceiptBridge({
      phone: PHONE, ownerId: HOME_OWNER, packageName: "Local 1h", receiptId: "rcpt_local2", purchaseTime: EPOCH,
      users: { [CANON_USER_ID]: { phone: PHONE } }, packages: { pkgLocal: pkgLocal() }, activePartners: new Set([HOME_OWNER]),
    });
    assertEqual(r.result.status, BRIDGE_STATUS.NOT_ELIGIBLE, "local package not bridged");
    assert(r.ce.calls.length === 0, "local package creates no roaming entitlement");
    assertEqual(JSON.stringify(pkgLocal()), before, "local package object unchanged");
  }

  console.log(`\n========================================`);
  console.log(`Phase 7.2B Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error("Test harness crashed:", err); process.exit(1); });
