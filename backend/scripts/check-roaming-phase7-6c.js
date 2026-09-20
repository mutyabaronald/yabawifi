/**
 * Phase 7.6C — Roaming Settlement Calculation & Immutable Ledger.
 *
 * Implements the settlement calculation + `roaming_settlements` immutable ledger.
 * This phase STOP at the settlement record: NO wallet credit, NO money movement.
 *
 * Run: node backend/scripts/check-roaming-phase7-6c.js
 */
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const {
  SETTLEMENT_STATUS,
  INITIAL_SETTLEMENT_STATUS,
  RoamingSettlementError,
  buildIdempotencyKey,
  calculateSettlementAmount,
  validateSettlementInput,
  buildSettlement,
  createSettlement,
} = require("../services/roamingSettlementService");
const { EntitlementError } = require("../services/roamingEntitlementService");
const { buildCommercialSnapshot } = require("../services/roamingEntitlementBridgeService");

function isSettlementError(e) {
  return e instanceof RoamingSettlementError || e instanceof EntitlementError;
}

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

const HOME = "homeA";
const VISITED = "visitedB";
const HOTSPOT = "hotspotB1";
const ENT = "ent1";
const SESS = "sess1";
const CURSOR = "2025-01-01T00:20:00.000Z";

function commercial(price, raus) {
  const c = buildCommercialSnapshot({ id: "p", ownerId: HOME, roamingEligible: true, timeLimitMinutes: raus, price }, raus);
  return c;
}

// --- Fakes ---
function makeFakeDb(docs) {
  const store = JSON.parse(JSON.stringify(docs));
  const tx = {
    get(ref) {
      const row = store[ref.coll] && store[ref.coll][ref.id];
      return Promise.resolve({ exists: !!row, data: () => (row ? { ...row } : undefined), id: ref.id });
    },
    set(ref, data) {
      store[ref.coll] = store[ref.coll] || {};
      store[ref.coll][ref.id] = { ...data };
      return undefined;
    },
  };
  return {
    collection(name) {
      const coll = name;
      return {
        doc(id) {
          return { coll, id };
        },
        where: () => ({ get: async () => ({ empty: true, docs: [] }) }),
      };
    },
    runTransaction(fn) { return Promise.resolve().then(() => fn(tx)); },
    _store: store,
  };
}

function makeEntitlementLoader(entitlements) {
  return async (id) => (entitlements[id] ? { ...entitlements[id] } : undefined);
}
function makeSessionLoader(sessions) {
  return async (id) => (sessions[id] ? { ...sessions[id] } : undefined);
}

async function main() {
  console.log("=== Phase 7.6C: Roaming Settlement Calculation & Immutable Ledger ===\n");

  console.log("--- 1-4. Settlement formula (floor) ---");
  {
    const c = commercial(1000, 60);
    assertEqual(calculateSettlementAmount(20, c), 333, "20 RAUs -> floor(20*1000/60)");
    assertEqual(calculateSettlementAmount(25, c), 416, "25 RAUs -> floor(25*1000/60)");
    assertEqual(calculateSettlementAmount(15, c), 250, "15 RAUs -> floor(15*1000/60)");
    assertEqual(calculateSettlementAmount(60, c), 1000, "60 RAUs -> 1000 (full package value)");
  }

  console.log("\n--- 5. Zero consumed RAUs ---");
  {
    const c = commercial(1000, 60);
    assertEqual(calculateSettlementAmount(0, c), 0, "0 RAUs -> 0 settlement (safe)");
  }

  console.log("\n--- 6/7/8/9. Integer-safe, no floats, ceiling, large ints ---");
  {
    const c = commercial(1000, 60);
    assert(Number.isInteger(calculateSettlementAmount(20, c)), "result is integer");
    assert(!/e\+/.test(String(calculateSettlementAmount(20, c))) && String(calculateSettlementAmount(20, c)).indexOf(".") === -1, "no floating-point literal in result");
    // ceiling: every unit consumed => package value
    assertEqual(calculateSettlementAmount(c.grantedRaus, c), c.originalPrice, "full consumption = originalPrice (never exceeds)");
    // large integers: 43200 RAUs, price 50000
    const cBig = commercial(50000, 43200);
    assertEqual(calculateSettlementAmount(43200, cBig), 50000, "large full consumption = 50000");
    assertEqual(calculateSettlementAmount(1, cBig), Math.floor(1 * 50000 / 43200), "large partial = floor(1*50000/43200)");
  }

  console.log("\n--- 10-13. Historical economics (snapshot, not current price) ---");
  {
    const c = commercial(1000, 60);
    // Settlement uses the snapshot's numerator/denominator, NOT a re-read package.
    assertEqual(c.rateNumerator, c.originalPrice, "rateNumerator = snapshot originalPrice");
    assertEqual(c.rateDenominator, c.grantedRaus, "rateDenominator = snapshot grantedRaus");
    // Even if "current" package price were different, settlement uses the snapshot.
    const record = buildSettlement({
      entitlement: { id: ENT, homeOwnerId: HOME, commercial: c, quota: { maxMinutes: 60 } },
      session: { id: SESS, visitedOwnerId: VISITED, visitedHotspotId: HOTSPOT, entitlementId: ENT, billedMinutes: 20, lastBilledAt: CURSOR },
      consumedRaus: 20,
    });
    assertEqual(record.rateNumerator, 1000, "settlement record uses snapshot numerator (1000, not any later price)");
    assertEqual(record.rateDenominator, 60, "settlement record uses snapshot denominator (60)");
    assertEqual(record.settlementAmount, 333, "settlement amount from snapshot rate");
  }

  console.log("\n--- 14-18. Ownership derivation & client override ---");
  {
    const c = commercial(1000, 60);
    const ent = { id: ENT, homeOwnerId: HOME, commercial: c, quota: { maxMinutes: 60 } };
    const sess = { id: SESS, visitedOwnerId: VISITED, visitedHotspotId: HOTSPOT, entitlementId: ENT, billedMinutes: 20, lastBilledAt: CURSOR };
    const record = buildSettlement({ entitlement: ent, session: sess, consumedRaus: 20 });
    assertEqual(record.homeOwnerId, HOME, "homeOwnerId comes from entitlement");
    assertEqual(record.visitedOwnerId, VISITED, "visitedOwnerId comes from session");
    assertEqual(record.visitedHotspotId, HOTSPOT, "visitedHotspotId comes from session");
    assertEqual(record.entitlementId, ENT, "entitlementId from entitlement");
    assertEqual(record.sessionId, SESS, "sessionId from session");
    // Client cannot supply owners: API only accepts entitlementId/sessionId, not owner fields.
    // Demonstrate that passing homeOwnerId/visitedOwnerId in the input is ignored.
    const dbOverride = makeFakeDb({ roaming_settlements: {} });
    const entsOverride = { [ENT]: { id: ENT, homeOwnerId: HOME, commercial: c, quota: { maxMinutes: 60 } } };
    const sessOverride = { id: SESS, visitedOwnerId: VISITED, visitedHotspotId: HOTSPOT, entitlementId: ENT, billedMinutes: 20, lastBilledAt: CURSOR };
    const depsOverride = { db: dbOverride, getEntitlement: makeEntitlementLoader(entsOverride), getRoamingSession: makeSessionLoader({ [SESS]: sessOverride }) };
    const rOverride = await createSettlement({
      entitlementId: ENT, sessionId: SESS, consumedRaus: 20, billingCursor: CURSOR,
      homeOwnerId: "clientAttacker", visitedOwnerId: "clientAttacker",
      deps: depsOverride,
    });
    assert(rOverride.created, "settlement created with client owner override attempt");
    assertEqual(rOverride.settlement.homeOwnerId, HOME, "client-supplied homeOwnerId ignored — record uses entitlement owner");
    assertEqual(rOverride.settlement.visitedOwnerId, VISITED, "client-supplied visitedOwnerId ignored — record uses session owner");
    assertEqual(record.homeOwnerId, HOME, "record homeOwnerId = entitlement (not client)");
    assertEqual(record.visitedOwnerId, VISITED, "record visitedOwnerId = session (not client)");
  }

  console.log("\n--- 18. Cross-owner / cross-entitlement mismatch rejected ---");
  {
    const c = commercial(1000, 60);
    const ent = { id: ENT, homeOwnerId: HOME, commercial: c, quota: { maxMinutes: 60 } };
    const sess = { id: SESS, visitedOwnerId: VISITED, visitedHotspotId: HOTSPOT, entitlementId: "OTHER_ENT", billedMinutes: 20, lastBilledAt: CURSOR };
    let threw = false;
    try { buildSettlement({ entitlement: ent, session: sess, consumedRaus: 20 }); }
    catch (e) { threw = e instanceof RoamingSettlementError; }
    assert(threw, "session belonging to a different entitlement rejected");
  }

  console.log("\n--- 19/20. Idempotency: same key -> one settlement ---");
  {
    const db = makeFakeDb({ roaming_settlements: {} });
    const c = commercial(1000, 60);
    const ents = { [ENT]: { id: ENT, homeOwnerId: HOME, commercial: c, quota: { maxMinutes: 60 } } };
    const sess = { id: SESS, visitedOwnerId: VISITED, visitedHotspotId: HOTSPOT, entitlementId: ENT, billedMinutes: 20, lastBilledAt: CURSOR };
    const deps = {
      db,
      getEntitlement: makeEntitlementLoader(ents),
      getRoamingSession: makeSessionLoader({ [SESS]: sess }),
    };
    const r1 = await createSettlement({ entitlementId: ENT, sessionId: SESS, consumedRaus: 20, billingCursor: CURSOR, deps });
    assert(r1.created, "first call creates settlement");
    assertEqual(r1.settlement.status, "calculated", "status = calculated (NOT credited)");
    assert(!r1.settlement.credited, "no credited flag present");
    const r2 = await createSettlement({ entitlementId: ENT, sessionId: SESS, consumedRaus: 20, billingCursor: CURSOR, deps });
    assert(!r2.created && r2.idempotent, "repeated call returns existing (idempotent)");
    assertEqual(r2.settlement.id, r1.settlement.id, "same idempotent id returned");
    assertEqual(r2.settlement.settlementAmount, 333, "idempotent re-return carries 333 (not recomputed differently)");
    assertEqual(countDocs(db, "roaming_settlements"), 1, "only ONE settlement doc for same key");
  }

  console.log("\n--- 21. Concurrent duplicate attempts -> transaction exists-guard ---");
  {
    // runTransaction guard: a second create within the same logical key hits the
    // exists check and does not write a second doc.
    const db = makeFakeDb({ roaming_settlements: {} });
    const c = commercial(1000, 60);
    const ents = { [ENT]: { id: ENT, homeOwnerId: HOME, commercial: c, quota: { maxMinutes: 60 } } };
    const sess = { id: SESS, visitedOwnerId: VISITED, visitedHotspotId: HOTSPOT, entitlementId: ENT, billedMinutes: 20, lastBilledAt: CURSOR };
    const deps = { db, getEntitlement: makeEntitlementLoader(ents), getRoamingSession: makeSessionLoader({ [SESS]: sess }) };
    await Promise.all([
      createSettlement({ entitlementId: ENT, sessionId: SESS, consumedRaus: 20, billingCursor: CURSOR, deps }),
      createSettlement({ entitlementId: ENT, sessionId: SESS, consumedRaus: 20, billingCursor: CURSOR, deps }),
    ]);
    assertEqual(countDocs(db, "roaming_settlements"), 1, "concurrent duplicate attempts yield exactly ONE doc (exists-guard)");
  }

  console.log("\n--- 22-26. Validation rejection ---");
  {
    const sess = { id: SESS, visitedOwnerId: VISITED, visitedHotspotId: HOTSPOT, entitlementId: ENT, billedMinutes: 20, lastBilledAt: CURSOR };
    let threw = false;
    try { buildSettlement({ entitlement: { id: ENT, homeOwnerId: HOME, commercial: null, quota: {} }, session: sess, consumedRaus: 20 }); } catch (e) { threw = e instanceof RoamingSettlementError; }
    assert(threw, "22: missing commercial snapshot rejected");

    const badDen = { originalPrice: 100, grantedRaus: 0, rateNumerator: 100, rateDenominator: 0 };
    try { validateSettlementInput({ entitlement: { id: ENT, homeOwnerId: HOME, commercial: badDen, quota: {} }, session: sess, consumedRaus: 0 }); } catch (e) { threw = isSettlementError(e); }
    assert(threw, "23: zero/negative denominator (grantedRaus=0) rejected");

    threw = false;
    const c = commercial(1000, 60);
    try { calculateSettlementAmount(-5, c); } catch (e) { threw = e instanceof RoamingSettlementError; }
    assert(threw, "24: negative consumedRaus rejected");

    threw = false;
    try { calculateSettlementAmount(12.5, c); } catch (e) { threw = e instanceof RoamingSettlementError; }
    assert(threw, "25: fractional consumedRaus rejected");

    threw = false;
    try { calculateSettlementAmount(61, c); } catch (e) { threw = e instanceof RoamingSettlementError; }
    assert(threw, "26: consumedRaus > grantedRaus rejected");
  }

  console.log("\n--- 27. Invalid owner/session relationship rejected ---");
  {
    const c = commercial(1000, 60);
    const sess = { id: SESS, visitedOwnerId: VISITED, visitedHotspotId: HOTSPOT, entitlementId: "DIFFERENT", billedMinutes: 20, lastBilledAt: CURSOR };
    let threw = false;
    try { buildSettlement({ entitlement: { id: ENT, homeOwnerId: HOME, commercial: c, quota: { maxMinutes: 60 } }, session: sess, consumedRaus: 20 }); } catch (e) { threw = e instanceof RoamingSettlementError; }
    assert(threw, "session entitlementId mismatch rejected");
  }

  console.log("\n--- 28-35. Financial safety (no money movement in service) ---");
  {
    const src = fs.readFileSync(path.resolve(__dirname, "..", "..", "backend/services/roamingSettlementService.js"), "utf8");
    assert(!/wallets/.test(src), "settlement service does NOT touch wallets collection");
    assert(!/payout_splits/.test(src), "no payout_splits writes");
    assert(!/payout_transfers/.test(src), "no payout_transfers writes");
    assert(!/collection\(["']payments["']\)/.test(src), "no payments collection writes");
    assert(!/disbursement/.test(src), "no MTN/Airtel disbursement");
    assert(!/serviceFee/i.test(src), "no 5% service fee logic");
    assert(!/0\.05\b/.test(src), "no 5% fee factor");

    const receipt = fs.readFileSync(path.resolve(__dirname, "..", "..", "backend/routes/receiptRoutes.js"), "utf8");
    const mtn = fs.readFileSync(path.resolve(__dirname, "..", "..", "backend/routes/mtn.js"), "utf8");
    const sup = fs.readFileSync(path.resolve(__dirname, "..", "..", "backend/superRoutes.js"), "utf8");
    assert(/COMMISSION_PERCENTAGE\s*=\s*25/.test(receipt) && /COMMISSION_PERCENTAGE\s*=\s*25/.test(mtn), "25% commission unchanged in receiptRoutes + mtn");
    assertEqual(Number((sup.match(/DEFAULT_RATE\s*=\s*25/)||[,0])[0] ? 25 : "n/a") ? 25 : 0, 25, "DEFAULT_RATE=25 unchanged in superRoutes");
    assert(!/serviceFee/i.test(receipt) && !/serviceFee/i.test(mtn) && !/serviceFee/i.test(sup), "no serviceFee on money paths");
  }

  console.log("\n--- 36-44. Regression: existing Phase suites ---");
  {
    const scripts = [
      "backend/scripts/check-rau-calculation.js",          // 7.1
      "backend/scripts/check-rau-bridge.js",               // 7.2/2A
      "backend/scripts/check-roaming-phase7-3.js",         // 7.3
      "backend/scripts/check-roaming-phase7-4.js",         // 7.4 (incl. nested regression)
      "backend/scripts/check-roaming-phase7-5.js",         // 7.5
      "backend/scripts/check-roaming-phase7-6.js",         // 7.6A
      "backend/scripts/check-roaming-phase7-6b.js",        // 7.6B
      "backend/scripts/check-roaming-phase3.js",           // 3
      "backend/scripts/check-roaming-phase6.js",           // 6
    ];
    for (const s of scripts) {
      try {
        execSync(`node ${s}`, { stdio: "ignore", timeout: 120000 });
        assert(true, `${path.basename(s)} PASS (exit 0)`);
      } catch (e) {
        assert(false, `${path.basename(s)} FAILED (exit ${e.status})`);
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Phase 7.6C Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);
  if (failed > 0) process.exit(1);
}

function countDocs(db, coll) {
  return db._store[coll] ? Object.keys(db._store[coll]).length : 0;
}

main().catch((err) => {
  console.error("Test harness crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
