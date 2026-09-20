/**
 * Phase 7.6A — Historical Commercial Snapshot + Integer-Safe Rate Math (no money movement).
 *
 * This phase ONLY:
 *  - captures an immutable `commercial` snapshot on roaming_entitlements at purchase time
 *    (Task 1),
 *  - validates integer-safe commercial invariants (Task 2),
 *  - provides a PURE, side-effect-free rate-application function
 *    (computeRauSettlementValue) so the integer-safe settlement math can be
 *    verified against production code WITHOUT moving money, crediting wallets,
 *    or writing settlement records,
 *  - leaves Task 3 (owners.js shadowed routes), Task 4 (25% commission
 *    consolidation), Task 5 (wallet architecture) and Task 6/7 (settlement
 *    records + reconciliation) as INSPECTION/DESIGN ONLY (see final report).
 *
 * Run: node backend/scripts/check-roaming-phase7-6.js
 *
 * IMPORTANT: NO Firestore collection used here is a wallet/payout collection.
 * The entitlement fake is a plain in-memory Map. No wallets/payouts/payments
 * are read or written. This test performs no money movement.
 */
const path = require("path");
const {
  createRoamingEntitlementFromPurchase,
  buildCommercialSnapshot,
  BRIDGE_STATUS,
} = require("../services/roamingEntitlementBridgeService");
const {
  validateCommercial,
  computeRauSettlementValue,
} = require("../services/roamingEntitlementService");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`✅ PASS: ${msg}`); passed++; }
  else { console.error(`❌ FAIL: ${msg}`); failed++; }
}
function assertEqual(a, b, m) {
  const ok = a === b;
  ok ? (console.log(`✅ PASS: ${m} (${a})`), passed++) : (console.error(`❌ FAIL: ${m} — expected ${b}, got ${a}`), failed++);
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

function makeCreateEntitlementFake() {
  const calls = [];
  const store = new Map();
  const fake = async ({ idempotencyKey, payload, authenticatedOwnerId }) => {
    calls.push({ idempotencyKey, payload, authenticatedOwnerId });
    const existing = store.get(idempotencyKey);
    if (existing) return { entitlement: existing, created: false, idempotent: true };
    const ent = { ...payload, id: "ent_" + (calls.length + 1) };
    store.set(idempotencyKey, ent);
    return { entitlement: ent, created: true };
  };
  return { fake, calls, store };
}
function makePackageLoader(packagesById) {
  return async (packageId) => (packagesById[packageId] ? { ...packagesById[packageId] } : null);
}
function makeResolveUserId(userId) {
  return async (phone) => (phone ? userId : null);
}

const pkgRoaming = {
  id: "pkg_roaming",
  ownerId: HOME_OWNER,
  name: "Roaming 1h",
  roamingEligible: true,
  timeLimitMinutes: 60,
  price: 5000,
};

// Phase 7.6 design rate formula (integer-safe truncation toward zero for >=0):
//   value = floor(consumedRaus * rateNumerator / rateDenominator)
// Kept here as the authoritative reference that computeRauSettlementValue implements.
function designApplyRate(consumedRaus, num, den) {
  return Math.floor((consumedRaus * num) / den);
}

async function main() {
  console.log("=== Phase 7.6A: Historical Commercial Snapshot + Integer-Safe Rate Math ===\n");

  console.log("--- 1. Historical package price snapshot is captured & preserved ---");
  {
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx(),
      deps: {
        resolveUserId: makeResolveUserId(USER_ID),
        loadPackage: makePackageLoader({ pkg_roaming: { ...pkgRoaming } }),
        createEntitlement: ce.fake,
      },
    });
    assertEqual(result.status, BRIDGE_STATUS.CREATED, "roaming package bridges");
    const commercial = ce.calls[0].payload.commercial;
    assert(commercial, "commercial snapshot attached to entitlement");
    assertEqual(commercial.originalPrice, 5000, "originalPrice = package.price (5000 UGX)");
    assert(Number.isInteger(commercial.originalPrice), "originalPrice is integer UGX");
    assertEqual(commercial.rateNumerator, 5000, "rateNumerator = originalPrice");
  }

  console.log("\n--- 2. Historical granted RAU snapshot (count, not money) ---");
  {
    const ce = makeCreateEntitlementFake();
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx(),
      deps: {
        resolveUserId: makeResolveUserId(USER_ID),
        loadPackage: makePackageLoader({ pkg_roaming: { ...pkgRoaming } }),
        createEntitlement: ce.fake,
      },
    });
    const commercial = ce.calls[0].payload.commercial;
    assertEqual(commercial.grantedRaus, 60, "grantedRaus = Phase 7.1 RAU allowance (60)");
    assertEqual(commercial.rateDenominator, 60, "rateDenominator = grantedRaus");
    assert(Number.isInteger(commercial.grantedRaus), "grantedRaus is integer");
    assertEqual(commercial.grantedRaus, ce.calls[0].payload.quota.maxMinutes, "grantedRaus == quota.maxMinutes (immutable grant)");
  }

  console.log("\n--- 3. 1 connected eligible roaming minute = 1 RAU ---");
  {
    const ce = makeCreateEntitlementFake();
    await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_30", receiptId: "r30" }),
      deps: {
        resolveUserId: makeResolveUserId(USER_ID),
        loadPackage: makePackageLoader({ pkg_30: { ...pkgRoaming, timeLimitMinutes: 43200, price: 50000 } }),
        createEntitlement: ce.fake,
      },
    });
    const p = ce.calls[0].payload;
    assertEqual(p.commercial.grantedRaus, 43200, "grantedRaus = 43,200 for 30-day validity (not hard-coded month)");
    assertEqual(p.commercial.grantedRaus, p.quota.maxMinutes, "grantedRaus == quota.maxMinutes == billedMinutes basis (1 RAU = 1 min)");
  }

  console.log("\n--- 4. Consumed RAUs produce proportional monetary value ---");
  {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    // A consumes 20 RAUs
    assertEqual(computeRauSettlementValue(20, commercial), designApplyRate(20, 1000, 60), "20 RAUs value matches design formula");
    assertEqual(computeRauSettlementValue(20, commercial), 333, "20 RAUs => floor(20*1000/60) = 333 UGX");
    // B consumes 25 RAUs
    assertEqual(computeRauSettlementValue(25, commercial), designApplyRate(25, 1000, 60), "25 RAUs value matches design formula");
    assertEqual(computeRauSettlementValue(25, commercial), 416, "25 RAUs => floor(25*1000/60) = 416 UGX");
    // C consumes 15 RAUs
    assertEqual(computeRauSettlementValue(15, commercial), designApplyRate(15, 1000, 60), "15 RAUs value matches design formula");
    assertEqual(computeRauSettlementValue(15, commercial), 250, "15 RAUs => floor(15*1000/60) = 250 UGX");
  }

  console.log("\n--- 5. Total settlement cannot exceed package economic value ---");
  {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    // 20 + 25 + 15 = 60 consumed (all granted RAUs)
    const total = 20 + 25 + 15;
    assertEqual(total, 60, "all 60 granted RAUs consumed");
    const allocated = designApplyRate(20, 1000, 60) + designApplyRate(25, 1000, 60) + designApplyRate(15, 1000, 60);
    assert(allocated <= commercial.originalPrice, "sum of floor() values <= originalPrice (no overspend)");
    assertEqual(allocated, 999, "20+25+15 => 333+416+250 = 999 (<= 1000 package price)");
    // residual is bounded by integer truncation, never exceeds package value
    const residual = commercial.originalPrice - allocated;
    assert(0 <= residual && residual <= commercial.grantedRaus, "residual bounded by grantedRaus and >= 0");
  }

  console.log("\n--- 6. Integer-safe money calculations (no floats) ---");
  {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const v = computeRauSettlementValue(1, commercial);
    assert(Number.isInteger(v), "settlement value is an integer");
    // No floating point money fields anywhere in the snapshot
    for (const k of ["originalPrice", "grantedRaus", "rateNumerator", "rateDenominator"]) {
      assert(Number.isInteger(commercial[k]), `commercial.${k} is integer`);
    }
    // 1 RAU value is floor(1*1000/60) = 16 (truncation, no float artifacts)
    assertEqual(v, 16, "1 RAU => 16 UGX (integer, truncated)");
  }

  console.log("\n--- 7. Multiple visited owners / entitlements are independent ---");
  {
    const ce = makeCreateEntitlementFake();
    const pkgA = { ...pkgRoaming, id: "pkg_a", ownerId: "homeA", price: 1000 };
    const pkgB = { ...pkgRoaming, id: "pkg_b", ownerId: "homeB", price: 2000 };
    await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_a", receiptId: "rA" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader({ pkg_a: pkgA }), createEntitlement: ce.fake },
    });
    await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_b", receiptId: "rB" }),
      deps: { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader({ pkg_b: pkgB }), createEntitlement: ce.fake },
    });
    const commA = ce.calls[0].payload.commercial;
    const commB = ce.calls[1].payload.commercial;
    assertEqual(commA.originalPrice, 1000, "entitlement A originalPrice independent (1000)");
    assertEqual(commB.originalPrice, 2000, "entitlement B originalPrice independent (2000)");
    assert(commA.rateDenominator !== commB.rateDenominator || commA.originalPrice !== commB.originalPrice, "distinct economics per entitlement");
  }

  console.log("\n--- 8. Client cannot control settlement inputs (price/RAUs not trusted) ---");
  {
    const ce = makeCreateEntitlementFake();
    // Attacker tries to inject a fake price via ctx; bridge MUST ignore it and
    // use the server-resolved package.price.
    const result = await createRoamingEntitlementFromPurchase({
      ...baseCtx(),
      packagePrice: 999999, // attacker-supplied; must be ignored
      ctxPrice: 999999,
      deps: {
        resolveUserId: makeResolveUserId(USER_ID),
        loadPackage: makePackageLoader({ pkg_roaming: { ...pkgRoaming } }),
        createEntitlement: ce.fake,
      },
    });
    assertEqual(result.status, BRIDGE_STATUS.CREATED, "bridge still creates entitlement");
    const commercial = ce.calls[0].payload.commercial;
    assertEqual(commercial.originalPrice, 5000, "originalPrice = package.price (5000), NOT client-supplied 999999");
    assert(commercial.originalPrice !== 999999, "client-supplied price rejected");
  }

  console.log("\n--- 9. Rate derivation is exact (originalPrice/grantedRaus) ---");
  {
    const commercial = buildCommercialSnapshot({ price: 1050 }, 42);
    assertEqual(commercial.originalPrice, 1050, "originalPrice from package price");
    assertEqual(commercial.grantedRaus, 42, "grantedRaus from Phase 7.1 allowance");
    assertEqual(commercial.rateNumerator, 1050, "rateNumerator = originalPrice");
    assertEqual(commercial.rateDenominator, 42, "rateDenominator = grantedRaus");
  }

  console.log("\n--- 10. Invalid commercial snapshots rejected ---");
  {
    let threw = false;
    try { validateCommercial({ originalPrice: -1, grantedRaus: 60, rateNumerator: -1, rateDenominator: 60 }); }
    catch (e) { threw = true; }
    assert(threw, "negative originalPrice rejected");

    threw = false;
    try { validateCommercial({ originalPrice: 1000, grantedRaus: 0, rateNumerator: 1000, rateDenominator: 0 }); }
    catch (e) { threw = true; }
    assert(threw, "zero grantedRaus rejected (must be positive)");

    threw = false;
    try { validateCommercial({ originalPrice: 1000, grantedRaus: 60, rateNumerator: 999, rateDenominator: 60 }); }
    catch (e) { threw = true; }
    assert(threw, "rateNumerator != originalPrice rejected");

    threw = false;
    try { validateCommercial({ originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 59 }); }
    catch (e) { threw = true; }
    assert(threw, "rateDenominator != grantedRaus rejected");

    threw = false;
    try { computeRauSettlementValue(-5, { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 }); }
    catch (e) { threw = true; }
    assert(threw, "negative consumedRaus rejected");

    threw = false;
    try { computeRauSettlementValue(1.5, { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 }); }
    catch (e) { threw = true; }
    assert(threw, "fractional consumedRaus rejected (integer-only)");
  }

  console.log("\n--- 11. buildCommercialSnapshot returns null on invalid price (graceful) ---");
  {
    // Package without price -> snapshot not attached; existing access-unit
    // behaviour unchanged (no invalid monetary snapshot persisted).
    const nil = buildCommercialSnapshot({ ownerId: HOME_OWNER, roamingEligible: true, timeLimitMinutes: 60 }, 60);
    assert(!nil, "no price => no commercial snapshot (null)");

    const nil2 = buildCommercialSnapshot({ price: "free" }, 60);
    assert(!nil2, "non-numeric price => null snapshot");

    const nil3 = buildCommercialSnapshot({ price: 1000 }, 0);
    assert(!nil3, "grantedRaus <= 0 => null snapshot");
  }

  console.log("\n--- 12. Idempotency: reprocess keeps identical commercial snapshot ---");
  {
    const ce = makeCreateEntitlementFake();
    const deps = { resolveUserId: makeResolveUserId(USER_ID), loadPackage: makePackageLoader({ pkg_roaming: { ...pkgRoaming } }), createEntitlement: ce.fake };
    const r1 = await createRoamingEntitlementFromPurchase({ ...baseCtx({ receiptId: "r_dup" }), deps });
    const r2 = await createRoamingEntitlementFromPurchase({ ...baseCtx({ receiptId: "r_dup" }), deps });
    assertEqual(r2.status, BRIDGE_STATUS.EXISTS, "reprocess returns EXISTS (idempotent)");
    assertEqual(r2.entitlement.commercial.originalPrice, r1.entitlement.commercial.originalPrice, "originalPrice identical on idempotent reprocess");
    assertEqual(r2.entitlement.commercial.grantedRaus, r1.entitlement.commercial.grantedRaus, "grantedRaus identical on idempotent reprocess");
  }

  console.log("\n--- 13. Cross-owner isolation: commercial is bound to the granted entitlement ---");
  {
    const ce = makeCreateEntitlementFake();
    await createRoamingEntitlementFromPurchase({
      ...baseCtx({ packageId: "pkg_roaming", receiptId: "rX" }),
      deps: {
        resolveUserId: makeResolveUserId(USER_ID),
        loadPackage: makePackageLoader({ pkg_roaming: { ...pkgRoaming, ownerId: "homeA", price: 1000 } }),
        createEntitlement: ce.fake,
      },
    });
    assertEqual(ce.calls[0].payload.homeOwnerId, "homeA", "commercial bound to homeOwner=homeA, not client-chosen");
    assertEqual(ce.calls[0].authenticatedOwnerId, "homeA", "createEntitlement ownership guard holds");
  }

  console.log("\n--- 14. No money-movement collections touched by this phase ---");
  {
    // Static guard: the bridge + entitlement service must not reference wallet/payout
    // movement collections. (This phase only ADDS the `commercial` field.)
    const fs = require("fs");
    const read = (rel) => fs.readFileSync(path.resolve(__dirname, "..", "..", rel), "utf8");
    const bridge = read("backend/services/roamingEntitlementBridgeService.js");
    const ent = read("backend/services/roamingEntitlementService.js");
    assert(!/collection\(["']wallets["']\)/.test(bridge) && !/collection\(["']wallets["']\)/.test(ent), "bridge/entitlement-service do NOT touch `wallets` collection");
    assert(!/collection\(["']payout_splits["']\)/.test(bridge) && !/collection\(["']payout_splits["']\)/.test(ent), "bridge/entitlement-service do NOT touch `payout_splits` collection");
    assert(!/collection\(["']payout_transfers["']\)/.test(bridge) && !/collection\(["']payout_transfers["']\)/.test(ent), "bridge/entitlement-service do NOT touch `payout_transfers` collection");
    assert(!bridge.includes("disbursement") && !ent.includes("disbursement"), "no MTN disbursement calls in bridge/entitlement-service");
    assert(!bridge.includes("payout") && !ent.includes("payout"), "no payout logic in bridge/entitlement-service");
  }

  console.log(`\n========================================`);
  console.log(`Phase 7.6A Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test harness crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
