/**
 * Phase 7.6E — Roaming Settlement Reconciliation & Integrity.
 *
 * READ-ONLY reconciliation layer verifying the roaming_settlements ledger
 * agrees with authoritative Phase 7.3 RAU consumption.
 *
 * Run: node backend/scripts/check-roaming-phase7-6e.js
 */
const {
  RECON_STATUS,
  INITIAL_SETTLEMENT_STATUS,
  verifySettlementAmount,
  verifyEconomicCeiling,
  verifyRauCeiling,
  computeResidualValue,
  validateIdempotency,
  verifyOwnership,
  validateSettlement,
  validateSessionReconciliation,
  validateEntitlementReconciliation,
  reconcileSession,
  reconcileEntitlement,
} = require("../services/roamingSettlementReconciliationService.js");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log("PASS: " + msg); passed++; }
  else { console.error("FAIL: " + msg); failed++; }
}
function assertEqual(a, b, m) {
  assert(a === b, m + " (expected " + b + ", got " + a + ")");
}
function test(name, fn) {
  try { fn(); }
  catch (e) { console.error("CRASH in " + name + ": " + (e && e.stack ? e.stack : e)); failed++; }
}

function main() {
  console.log("=== Phase 7.6E: Reconciliation harness ===\n");
  test("recon service exports RECON_STATUS", () => {
    assert(RECON_STATUS && RECON_STATUS.RECONCILED === "reconciled", "RECON_STATUS.RECONCILED defined");
    assert(RECON_STATUS.PARTIAL === "partial", "RECON_STATUS.PARTIAL defined");
    assert(RECON_STATUS.LEGACY === "legacy_no_commercial", "RECON_STATUS.LEGACY defined");
  });

  // ---- 1. verifySettlementAmount ----
  test("1. verifySettlementAmount: correct amount passes", () => {
    const s = { consumedRaus: 5, rateNumerator: 1000, rateDenominator: 60, settlementAmount: 83 };
    const r = verifySettlementAmount(s);
    assert(r.valid, "5*1000/60=83 (floor) is valid");
    assertEqual(r.expectedAmount, 83, "expected amount = 83");
    assertEqual(r.actualAmount, 83, "actual amount = 83");
  });

  test("1. verifySettlementAmount: incorrect amount fails", () => {
    const s = { consumedRaus: 5, rateNumerator: 1000, rateDenominator: 60, settlementAmount: 100 };
    const r = verifySettlementAmount(s);
    assert(!r.valid, "incorrect amount (100) is invalid");
    assert(r.error && r.error.includes("mismatch"), "error describes mismatch");
  });

  test("1. verifySettlementAmount: zero RAUs produces zero settlement", () => {
    const s = { consumedRaus: 0, rateNumerator: 1000, rateDenominator: 60, settlementAmount: 0 };
    const r = verifySettlementAmount(s);
    assert(r.valid, "0 RAUs -> 0 amount is valid");
    assertEqual(r.expectedAmount, 0, "expected amount = 0");
    assertEqual(r.actualAmount, 0, "actual amount = 0");
  });

  test("1. verifySettlementAmount: negative consumedRaus rejected", () => {
    const s = { consumedRaus: -1, rateNumerator: 1000, rateDenominator: 60, settlementAmount: 0 };
    const r = verifySettlementAmount(s);
    assert(!r.valid, "negative consumedRaus rejected");
  });

  test("1. verifySettlementAmount: fractional consumedRaus rejected", () => {
    const s = { consumedRaus: 5.5, rateNumerator: 1000, rateDenominator: 60, settlementAmount: 91 };
    const r = verifySettlementAmount(s);
    assert(!r.valid, "fractional consumedRaus rejected");
  });

  // ---- 2. verifyEconomicCeiling ----
  test("2. verifyEconomicCeiling: total below originalPrice passes", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = verifyEconomicCeiling([333, 166], commercial);
    assert(r.valid, "499 < 1000 passes");
    assertEqual(r.total, 499, "total = 499");
    assertEqual(r.ceiling, 1000, "ceiling = 1000");
  });

  test("2. verifyEconomicCeiling: total equal to originalPrice passes", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = verifyEconomicCeiling([1000], commercial);
    assert(r.valid, "1000 == 1000 passes (boundary)");
    assertEqual(r.total, 1000, "total = 1000");
  });

  test("2. verifyEconomicCeiling: total above originalPrice fails", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = verifyEconomicCeiling([1001], commercial);
    assert(!r.valid, "1001 > 1000 fails");
    assert(r.error && r.error.includes("exceeds"), "error describes ceiling breach");
  });

  // ---- 3. verifyRauCeiling ----
  test("3. verifyRauCeiling: consumed RAUs <= granted passes", () => {
    const commercial = { grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60, originalPrice: 1000 };
    assert(verifyRauCeiling(60, commercial).valid, "60 <= 60 passes (exact)");
    assert(verifyRauCeiling(30, commercial).valid, "30 <= 60 passes");
    assert(verifyRauCeiling(0, commercial).valid, "0 <= 60 passes");
  });

  test("3. verifyRauCeiling: consumed RAUs > granted fails", () => {
    const commercial = { grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60, originalPrice: 1000 };
    const r = verifyRauCeiling(61, commercial);
    assert(!r.valid, "61 > 60 fails");
    assert(r.error && r.error.includes("61") && r.error.includes("60"), "error describes violation");
  });

  test("3. verifyRauCeiling: missing commercial rejected", () => {
    assert(!verifyRauCeiling(5, null).valid, "null commercial rejected");
    assert(!verifyRauCeiling(5, {}).valid, "empty commercial rejected");
  });

  // ---- 4. computeResidualValue ----
  test("4. computeResidualValue: remaining RAUs calculated correctly", () => {
    const commercial = { grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60, originalPrice: 1000 };
    const r = computeResidualValue(commercial, 20);
    assertEqual(r.remainingRaus, 40, "remaining = 60-20 = 40");
    assertEqual(r.consumedValue, 333, "consumedValue = floor(20*1000/60) = 333");
    assertEqual(r.residualTheoretical, 666, "residualTheoretical = floor(40*1000/60) = 666");
    assertEqual(r.residualActual, 667, "residualActual = 1000-333 = 667");
  });

  test("4. computeResidualValue: rounding is documented, not fixed", () => {
    const commercial = { grantedRaus: 3, rateNumerator: 100, rateDenominator: 3, originalPrice: 100 };
    // consumed 2 RAUs: floor(2*100/3) = floor(66.67) = 66
    // remaining 1 RAU: floor(1*100/3) = floor(33.33) = 33
    // residualActual = 100 - 66 = 34
    // roundingDiff = 34 - 33 = 1
    const r = computeResidualValue(commercial, 2);
    assertEqual(r.remainingRaus, 1, "remaining = 3-2 = 1");
    assertEqual(r.consumedValue, 66, "consumedValue = floor(2*100/3) = 66");
    assertEqual(r.residualTheoretical, 33, "residualTheoretical = floor(1*100/3) = 33");
    assertEqual(r.residualActual, 34, "residualActual = 100-66 = 34");
    assertEqual(r.roundingDiff, 1, "rounding diff = 34-33 = 1 (documented, not 'fixed')");
  });

  test("4. computeResidualValue: zero consumed => full residual", () => {
    const commercial = { grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60, originalPrice: 1000 };
    const r = computeResidualValue(commercial, 0);
    assertEqual(r.remainingRaus, 60, "remaining = 60");
    assertEqual(r.residualActual, 1000, "residualActual = 1000");
    assertEqual(r.residualTheoretical, 1000, "residualTheoretical = 1000");
    assertEqual(r.roundingDiff, 0, "rounding diff = 0");
  });

  test("4. computeResidualValue: full consumption => zero residual", () => {
    const commercial = { grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60, originalPrice: 1000 };
    const r = computeResidualValue(commercial, 60);
    assertEqual(r.remainingRaus, 0, "remaining = 0");
    assertEqual(r.residualActual, 0, "residualActual = 0");
    assertEqual(r.residualTheoretical, 0, "residualTheoretical = 0");
  });

  // ---- 5. validateIdempotency ----
  test("5. validateIdempotency: valid combinations pass", () => {
    const settlements = [
      { id: "s1", idempotencyKey: "e1:s1:T1", entitlementId: "e1", sessionId: "s1", billingCursor: "T1" },
      { id: "s2", idempotencyKey: "e1:s1:T2", entitlementId: "e1", sessionId: "s1", billingCursor: "T2" },
      { id: "s3", idempotencyKey: "e1:s2:T1", entitlementId: "e1", sessionId: "s2", billingCursor: "T1" },
    ];
    const r = validateIdempotency(settlements);
    assert(r.valid, "3 distinct keys are valid");
    assertEqual(r.duplicates.docIds.length, 0, "no dup doc IDs");
    assertEqual(r.duplicates.idempotencyKeys.length, 0, "no dup idempotency keys");
    assertEqual(r.duplicates.compositeKeys.length, 0, "no dup composite keys");
  });

  test("5. validateIdempotency: duplicate composite key detected", () => {
    const settlements = [
      { id: "s1", idempotencyKey: "e1:s1:T1", entitlementId: "e1", sessionId: "s1", billingCursor: "T1" },
      { id: "s2", idempotencyKey: "e1:s1:T1", entitlementId: "e1", sessionId: "s1", billingCursor: "T1" },
    ];
    const r = validateIdempotency(settlements);
    assert(!r.valid, "duplicate key is invalid");
    assertEqual(r.duplicates.compositeKeys.length, 1, "1 duplicate composite key detected");
    assertEqual(r.duplicates.idempotencyKeys.length, 1, "1 duplicate idempotency key detected");
  });

  test("5. validateIdempotency: duplicate doc ID detected", () => {
    const settlements = [
      { id: "same-id", idempotencyKey: "e1:s1:T1", entitlementId: "e1", sessionId: "s1", billingCursor: "T1" },
      { id: "same-id", idempotencyKey: "e1:s1:T2", entitlementId: "e1", sessionId: "s1", billingCursor: "T2" },
    ];
    const r = validateIdempotency(settlements);
    assert(!r.valid, "duplicate doc ID is invalid");
    assertEqual(r.duplicates.docIds.length, 1, "1 duplicate doc ID detected");
  });

  test("5. validateIdempotency: malformed/missing identity rejected gracefully", () => {
    const settlements = [
      { idempotencyKey: null, entitlementId: null, sessionId: null, billingCursor: null },
    ];
    const r = validateIdempotency(settlements);
    assert(r.valid, "all-null identity produces no duplicates (graceful)");
    assertEqual(r.duplicates.compositeKeys.length, 0, "no composite key formed");
  });

  // ---- Session: validateSessionReconciliation ----
  test("6. validateSessionReconciliation: exact match passes", () => {
    const session = { billedMinutes: 10, id: "s1" };
    const settlements = [
      { consumedRaus: 4, idempotencyKey: "e1:s1:T1", billingCursor: "T1" },
      { consumedRaus: 6, idempotencyKey: "e1:s1:T2", billingCursor: "T2" },
    ];
    const r = validateSessionReconciliation(session, settlements);
    assert(r.valid, "4+6=10 == billedMinutes 10 is valid");
    assertEqual(r.sessionBilledMinutes, 10, "sessionBilledMinutes = 10");
    assertEqual(r.settlementRaus, 10, "settlementRaus = 10");
    assert(r.exact, "exact reconciliation");
    assertEqual(r.error, undefined, "no error on exact match");
  });

  test("6. validateSessionReconciliation: partial (settled < billed) is valid", () => {
    const session = { billedMinutes: 10, id: "s1" };
    const settlements = [
      { consumedRaus: 3, idempotencyKey: "e1:s1:T1", billingCursor: "T1" },
    ];
    const r = validateSessionReconciliation(session, settlements);
    assert(r.valid, "3 < 10 is valid (partial)");
    assertEqual(r.settlementRaus, 3, "settlementRaus = 3");
    assert(!r.exact, "not exact");
    assert(r.error && r.error.includes("partial"), "error mentions partial");
  });

  test("6. validateSessionReconciliation: settlement RAUs exceed billed is rejected", () => {
    const session = { billedMinutes: 5, id: "s1" };
    const settlements = [
      { consumedRaus: 3, idempotencyKey: "e1:s1:T1", billingCursor: "T1" },
      { consumedRaus: 3, idempotencyKey: "e1:s1:T2", billingCursor: "T2" },
    ];
    const r = validateSessionReconciliation(session, settlements);
    assert(!r.valid, "3+3=6 > 5 is invalid");
    assertEqual(r.sessionBilledMinutes, 5, "sessionBilledMinutes = 5");
    assertEqual(r.settlementRaus, 6, "settlementRaus = 6");
    assert(r.error && r.error.includes("billedMinutes"), "error describes exceed");
  });

  test("6. validateSessionReconciliation: missing session identity handled", () => {
    const session = {};
    const settlements = [
      { consumedRaus: 5, idempotencyKey: "e1:s1:T1", billingCursor: "T1" },
    ];
    const r = validateSessionReconciliation(session, settlements);
    assertEqual(r.sessionBilledMinutes, 0, "billedMinutes defaults to 0 when missing");
    assert(!r.valid, "5 > 0 is invalid (missing session identity)");
  });

  test("6. validateSessionReconciliation: invalid/malformed input handled gracefully", () => {
    const session = { billedMinutes: "abc", id: "s1" };
    const settlements = [
      { consumedRaus: "not-a-number", idempotencyKey: "e1:s1:T1", billingCursor: "T1" },
    ];
    const r = validateSessionReconciliation(session, settlements);
    assertEqual(r.sessionBilledMinutes, 0, "non-numeric billedMinutes → 0");
    assertEqual(r.settlementRaus, 0, "non-numeric consumedRaus → 0 (graceful)");
    assert(r.valid, "0 <= 0 is valid (graceful handling of malformed input)");
  });

  // ---- Entitlement: validateEntitlementReconciliation ----
  test("7. validateEntitlementReconciliation: valid entitlement/settlement passes", () => {
    const entitlement = {
      id: "e1",
      commercial: { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 30, remainingMinutes: 30 },
    };
    const settlements = [
      { consumedRaus: 10, settlementAmount: 166, idempotencyKey: "e1:s1:T1" },
      { consumedRaus: 20, settlementAmount: 333, idempotencyKey: "e1:s2:T1" },
    ];
    const r = validateEntitlementReconciliation(entitlement, settlements);
    assert(r.valid, "10+20=30 <= 30 used, 499 <= 1000 price, 30 <= 60 granted");
    assertEqual(r.settlementRaus, 30, "settlementRaus = 10+20 = 30");
    assertEqual(r.totalAmount, 499, "totalAmount = 499");
    assertEqual(r.grantedRaus, 60, "grantedRaus = 60");
    assertEqual(r.remainingMinutes, 30, "remainingMinutes = 30");
    assertEqual(r.errors.length, 0, "no errors");
  });

  test("7. validateEntitlementReconciliation: settlement RAUs exceed entitlement used is rejected", () => {
    const entitlement = {
      id: "e1",
      commercial: { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 30, remainingMinutes: 30 },
    };
    const settlements = [
      { consumedRaus: 20, settlementAmount: 333, idempotencyKey: "e1:s1:T1" },
      { consumedRaus: 20, settlementAmount: 333, idempotencyKey: "e1:s2:T1" },
    ];
    const r = validateEntitlementReconciliation(entitlement, settlements);
    assert(!r.valid, "20+20=40 > 30 usedMinutes is invalid");
    assert(r.errors.some(e => e.includes("usedMinutes")), "error mentions usedMinutes violation");
  });

  test("7. validateEntitlementReconciliation: consumed RAUs exceed granted RAUs is rejected", () => {
    const entitlement = {
      id: "e1",
      commercial: { originalPrice: 1000, grantedRaus: 30, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 50, remainingMinutes: -20 },
    };
    const settlements = [
      { consumedRaus: 40, settlementAmount: 666, idempotencyKey: "e1:s1:T1" },
    ];
    const r = validateEntitlementReconciliation(entitlement, settlements);
    assert(!r.valid, "40 > 30 granted is invalid");
    assert(r.errors.some(e => e.includes("grantedRaus")), "error mentions grantedRaus violation");
    assert(r.errors.some(e => e.includes("remainingMinutes")), "error mentions negative remainingMinutes");
  });

  test("7. validateEntitlementReconciliation: total settlement amount exceeds originalPrice is rejected", () => {
    const entitlement = {
      id: "e1",
      commercial: { originalPrice: 500, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 30, remainingMinutes: 30 },
    };
    const settlements = [
      { consumedRaus: 30, settlementAmount: 501, idempotencyKey: "e1:s1:T1" },
    ];
    const r = validateEntitlementReconciliation(entitlement, settlements);
    assert(!r.valid, "501 > 500 originalPrice is invalid");
    assert(r.errors.some(e => e.includes("originalPrice")), "error mentions originalPrice violation");
  });

  test("7. validateEntitlementReconciliation: missing commercial snapshot is rejected", () => {
    const entitlement = {
      id: "e1",
      quota: { usedMinutes: 30, remainingMinutes: 30 },
    };
    const settlements = [
      { consumedRaus: 10, settlementAmount: 166, idempotencyKey: "e1:s1:T1" },
    ];
    const r = validateEntitlementReconciliation(entitlement, settlements);
    assert(!r.valid, "no commercial → invalid");
    assert(r.errors.some(e => e.includes("commercial")), "error mentions missing commercial");
  });

  test("7. validateEntitlementReconciliation: missing/invalid entitlement data is rejected", () => {
    const entitlement = null;
    const settlements = [
      { consumedRaus: 10, settlementAmount: 166, idempotencyKey: "e1:s1:T1" },
    ];
    let threw = false;
    try {
      validateEntitlementReconciliation(entitlement, settlements);
    } catch (e) {
      threw = true;
    }
    assert(threw, "null entitlement throws (undefined access)");
  });

  // ---- Ownership: verifyOwnership ----
  test("8. verifyOwnership: correct homeOwnerId passes", () => {
    const settlement = { homeOwnerId: "owner-home", visitedOwnerId: "owner-visited", visitedHotspotId: "hotspot-1", entitlementId: "e1", sessionId: "s1" };
    const entitlement = { id: "e1", homeOwnerId: "owner-home" };
    const session = { id: "s1", visitedOwnerId: "owner-visited", visitedHotspotId: "hotspot-1" };
    const r = verifyOwnership(settlement, entitlement, session);
    assert(r.valid, "all ownership fields match");
    assertEqual(r.mismatches.length, 0, "no mismatches");
  });

  test("8. verifyOwnership: correct visitedOwnerId passes", () => {
    const settlement = { homeOwnerId: "home-1", visitedOwnerId: "visited-1", visitedHotspotId: "hotspot-A", entitlementId: "e1", sessionId: "s1" };
    const entitlement = { id: "e1", homeOwnerId: "home-1" };
    const session = { id: "s1", visitedOwnerId: "visited-1", visitedHotspotId: "hotspot-A" };
    const r = verifyOwnership(settlement, entitlement, session);
    assert(r.valid, "visitedOwnerId matches session");
    assertEqual(r.mismatches.length, 0, "no mismatches");
  });

  test("8. verifyOwnership: correct visitedHotspotId passes", () => {
    const settlement = { homeOwnerId: "home-1", visitedOwnerId: "visited-1", visitedHotspotId: "hotspot-B", entitlementId: "e1", sessionId: "s1" };
    const entitlement = { id: "e1", homeOwnerId: "home-1" };
    const session = { id: "s1", visitedOwnerId: "visited-1", visitedHotspotId: "hotspot-B" };
    const r = verifyOwnership(settlement, entitlement, session);
    assert(r.valid, "visitedHotspotId matches session");
    assertEqual(r.mismatches.length, 0, "no mismatches");
  });

  test("8. verifyOwnership: home and visited owners correctly distinguished", () => {
    const settlement = { homeOwnerId: "home-1", visitedOwnerId: "visited-1", visitedHotspotId: "hotspot-1", entitlementId: "e1", sessionId: "s1" };
    const entitlement = { id: "e1", homeOwnerId: "home-1" };
    const session = { id: "s1", visitedOwnerId: "visited-1", visitedHotspotId: "hotspot-1" };
    const r = verifyOwnership(settlement, entitlement, session);
    assert(r.valid, "homeOwnerId from entitlement, visitedOwnerId from session — distinct but valid");
    assertEqual(r.mismatches.length, 0, "no mismatches");
  });

  test("8. verifyOwnership: cross-owner mismatch fails", () => {
    const settlement = { homeOwnerId: "attacker", visitedOwnerId: "visited-1", visitedHotspotId: "hotspot-1", entitlementId: "e1", sessionId: "s1" };
    const entitlement = { id: "e1", homeOwnerId: "real-home-owner" };
    const session = { id: "s1", visitedOwnerId: "visited-1", visitedHotspotId: "hotspot-1" };
    const r = verifyOwnership(settlement, entitlement, session);
    assert(!r.valid, "homeOwnerId mismatch detected");
    assert(r.mismatches.some(m => m.includes("homeOwnerId mismatch")), "mismatch describes homeOwnerId");
  });

  test("8. verifyOwnership: visitedOwnerId mismatch fails", () => {
    const settlement = { homeOwnerId: "home-1", visitedOwnerId: "attacker", visitedHotspotId: "hotspot-1", entitlementId: "e1", sessionId: "s1" };
    const entitlement = { id: "e1", homeOwnerId: "home-1" };
    const session = { id: "s1", visitedOwnerId: "real-visited", visitedHotspotId: "hotspot-1" };
    const r = verifyOwnership(settlement, entitlement, session);
    assert(!r.valid, "visitedOwnerId mismatch detected");
    assert(r.mismatches.some(m => m.includes("visitedOwnerId mismatch")), "mismatch describes visitedOwnerId");
  });

  test("8. verifyOwnership: client-supplied ownership cannot override authoritative records", () => {
    const settlement = {
      homeOwnerId: "client-forged-home",
      visitedOwnerId: "client-forged-visited",
      visitedHotspotId: "client-forged-hotspot",
      entitlementId: "e1",
      sessionId: "s1",
    };
    const entitlement = { id: "e1", homeOwnerId: "authoritative-home" };
    const session = { id: "s1", visitedOwnerId: "authoritative-visited", visitedHotspotId: "authoritative-hotspot" };
    const r = verifyOwnership(settlement, entitlement, session);
    assert(!r.valid, "forged client ownership does not override authoritative records");
    assert(r.mismatches.length >= 3, "at least 3 mismatches (home, visited, hotspot)");
    assert(r.mismatches.every(m => m.includes("mismatch")), "all mismatches describe field mismatches");
  });

  test("8. verifyOwnership: missing entitlement is rejected", () => {
    const settlement = { homeOwnerId: "home-1", visitedOwnerId: "visited-1", visitedHotspotId: "hotspot-1", entitlementId: "e1", sessionId: "s1" };
    const r = verifyOwnership(settlement, null, {});
    assert(!r.valid, "null entitlement rejected");
    assert(r.mismatches.some(m => m.includes("entitlement missing")), "error mentions entitlement missing");
  });

  test("8. verifyOwnership: missing session is rejected", () => {
    const settlement = { homeOwnerId: "home-1", visitedOwnerId: "visited-1", visitedHotspotId: "hotspot-1", entitlementId: "e1", sessionId: "s1" };
    const entitlement = { id: "e1", homeOwnerId: "home-1" };
    const r = verifyOwnership(settlement, entitlement, null);
    assert(!r.valid, "null session rejected");
    assert(r.mismatches.some(m => m.includes("session missing")), "error mentions session missing");
  });

  // ---- Cross-owner security ----
  test("9. CROSS-OWNER: homeOwnerId !== visitedOwnerId is NOT a failure", () => {
    const settlement = {
      homeOwnerId: "home-aaa",
      visitedOwnerId: "visited-bbb",
      visitedHotspotId: "hotspot-1",
      entitlementId: "e1",
      sessionId: "s1",
    };
    const entitlement = { id: "e1", homeOwnerId: "home-aaa" };
    const session = { id: "s1", visitedOwnerId: "visited-bbb", visitedHotspotId: "hotspot-1", entitlementId: "e1" };
    const r = verifyOwnership(settlement, entitlement, session);
    assert(r.valid, "different home/visited owners are valid roaming — NOT an ownership failure");
    assertEqual(r.mismatches.length, 0, "no mismatches for legitimate cross-owner roaming");
  });

  test("9. CROSS-OWNER: corrupted settlement visitedOwnerId mismatch fails", () => {
    const settlement = {
      homeOwnerId: "home-aaa",
      visitedOwnerId: "attacker-ccc",
      visitedHotspotId: "hotspot-1",
      entitlementId: "e1",
      sessionId: "s1",
    };
    const entitlement = { id: "e1", homeOwnerId: "home-aaa" };
    const session = { id: "s1", visitedOwnerId: "visited-bbb", visitedHotspotId: "hotspot-1" };
    const r = verifyOwnership(settlement, entitlement, session);
    assert(!r.valid, "corrupted visitedOwnerId does not match authoritative session");
    assert(r.mismatches.some(m => m.includes("visitedOwnerId mismatch")), "error flags visitedOwnerId mismatch");
  });

  test("9. CROSS-OWNER: session.homeOwnerId matching entitlement.homeOwnerId across different visited is valid", () => {
    const settlement = {
      homeOwnerId: "home-x",
      visitedOwnerId: "visited-y",
      visitedHotspotId: "hotspot-9",
      entitlementId: "e1",
      sessionId: "s1",
    };
    const entitlement = { id: "e1", homeOwnerId: "home-x" };
    const session = {
      id: "s1",
      visitedOwnerId: "visited-y",
      visitedHotspotId: "hotspot-9",
      homeOwnerId: "home-x",
      entitlementId: "e1",
    };
    const r = verifyOwnership(settlement, entitlement, session);
    assert(r.valid, "session.homeOwnerId matches entitlement.homeOwnerId — no contamination");
    assertEqual(r.mismatches.length, 0, "no mismatches");
  });

  test("9. CROSS-OWNER: session.homeOwnerId conflicting with entitlement.homeOwnerId is flagged", () => {
    const settlement = {
      homeOwnerId: "home-x",
      visitedOwnerId: "visited-y",
      visitedHotspotId: "hotspot-9",
      entitlementId: "e1",
      sessionId: "s1",
    };
    const entitlement = { id: "e1", homeOwnerId: "real-home-x" };
    const session = {
      id: "s1",
      visitedOwnerId: "visited-y",
      visitedHotspotId: "hotspot-9",
      homeOwnerId: "impersonator",
      entitlementId: "e1",
    };
    const r = verifyOwnership(settlement, entitlement, session);
    assert(!r.valid, "session.homeOwnerId (impersonator) != entitlement.homeOwnerId (real-home-x)");
    assert(r.mismatches.some(m => m.includes("cross-owner contamination")), "error flags cross-owner contamination");
  });

  // ---- Session/Entitlement accounting consistency ----
  test("10. ACCOUNTING: settlement consumedRaus <= session billedMinutes", () => {
    const session = { id: "s1", billedMinutes: 100 };
    const settlements = [
      { consumedRaus: 40, idempotencyKey: "e1:s1:T1" },
      { consumedRaus: 30, idempotencyKey: "e1:s1:T2" },
    ];
    const r = validateSessionReconciliation(session, settlements);
    assert(r.valid, "40+30=70 <= 100 billedMinutes is valid");
    assertEqual(r.settlementRaus, 70, "settlementRaus = 70");
  });

  test("10. ACCOUNTING: settlement consumedRaus <= entitlement consumption", () => {
    const entitlement = {
      id: "e1",
      commercial: { originalPrice: 1200, grantedRaus: 100, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 70, remainingMinutes: 50 },
    };
    const settlements = [
      { consumedRaus: 40, settlementAmount: 666, idempotencyKey: "e1:s1:T1" },
      { consumedRaus: 30, settlementAmount: 500, idempotencyKey: "e1:s2:T1" },
    ];
    const r = validateEntitlementReconciliation(entitlement, settlements);
    assert(r.valid, "40+30=70 <= 70 usedMinutes, 1166 <= 1200 price, 70 <= 100 granted");
    assertEqual(r.settlementRaus, 70, "settlementRaus = 70 equals usedMinutes");
    assertEqual(r.totalAmount, 1166, "totalAmount = 666+500 = 1166");
  });

  test("10. ACCOUNTING: consumed RAUs cannot exceed granted RAUs", () => {
    const entitlement = {
      id: "e1",
      commercial: { originalPrice: 1000, grantedRaus: 50, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 60, remainingMinutes: -10 },
    };
    const settlements = [
      { consumedRaus: 55, settlementAmount: 916, idempotencyKey: "e1:s1:T1" },
    ];
    const r = validateEntitlementReconciliation(entitlement, settlements);
    assert(!r.valid, "55 > 50 granted is invalid");
    assert(r.errors.some(e => e.includes("grantedRaus")), "error mentions grantedRaus violation");
  });

  test("10. ACCOUNTING: settlement cannot reference an unrelated session", () => {
    const session = { id: "real-session-1", billedMinutes: 30, entitlementId: "e1" };
    const settlements = [
      { consumedRaus: 30, idempotencyKey: "e1:wrong-session:T1", sessionId: "wrong-session", entitlementId: "e1" },
    ];
    const r = validateSessionReconciliation(session, settlements);
    assert(r.valid, "validateSessionReconciliation checks sum RAUs vs billedMinutes (30 <= 30)");
    // The session-identity mismatch is verified via verifyOwnership instead:
    const entitlement = { id: "e1", homeOwnerId: "home-1" };
    const ownership = verifyOwnership(settlements[0], entitlement, session);
    assert(!ownership.valid, "settlement references unrelated sessionId");
    assert(ownership.mismatches.some(m => m.includes("sessionId mismatch")), "ownership flags sessionId mismatch");
  });

  test("10. ACCOUNTING: settlement cannot reference an unrelated entitlement", () => {
    const entitlement = { id: "real-entitlement", homeOwnerId: "home-1", commercial: { originalPrice: 1000, grantedRaus: 60 } };
    const session = { id: "s1", visitedOwnerId: "v1", visitedHotspotId: "h1" };
    const settlement = {
      consumedRaus: 10,
      settlementAmount: 166,
      entitlementId: "wrong-entitlement",
      sessionId: "s1",
      homeOwnerId: "home-1",
      visitedOwnerId: "v1",
      visitedHotspotId: "h1",
    };
    const ownership = verifyOwnership(settlement, entitlement, session);
    assert(!ownership.valid, "settlement references unrelated entitlementId");
    assert(ownership.mismatches.some(m => m.includes("entitlementId mismatch")), "ownership flags entitlementId mismatch");
  });

  // ---- Legacy / non-roaming behavior ----
  test("11. LEGACY: reconcileEntitlement returns LEGACY status when no commercial snapshot", async () => {
    const entitlement = {
      id: "e-legacy",
      // no commercial property → legacy/non-roaming
    };
    const deps = {
      getEntitlement: async () => entitlement,
      loadSessionsByEntitlement: async () => [],
      loadSettlementsByEntitlement: async () => [],
    };
    const r = await reconcileEntitlement("e-legacy", deps);
    assertEqual(r.status, RECON_STATUS.LEGACY, "legacy entitlement (no commercial) → LEGACY status");
    assert(!r.entitlementLevel.valid, "legacy entitlement is invalid (no commercial)");
    assert(r.entitlementLevel.errors.some(e => e.includes("commercial")), "error explains missing commercial");
  });

  test("11. LEGACY: reconcileSession returns SKIPPED when session has no entitlementId", async () => {
    const session = {
      id: "s-local",
      billedMinutes: 30,
      // no entitlementId → local/non-roaming session
    };
    const deps = {
      getRoamingSession: async () => session,
      loadSettlementsBySession: async () => [
        { consumedRaus: 10, settlementAmount: 166, idempotencyKey: "e1:s-local:T1" },
      ],
    };
    const r = await reconcileSession("s-local", deps);
    assertEqual(r.status, RECON_STATUS.SKIPPED, "session without entitlementId → SKIPPED");
    assert(r.skipped, "skipped flag is true");
    assertEqual(r.reason, "session has no entitlementId (local/non-roaming)", "reason explains skip");
  });

  test("11. LEGACY: reconcileSession returns LEGACY when entitlement has no commercial", async () => {
    const session = { id: "s1", billedMinutes: 30, entitlementId: "e-legacy" };
    const entitlement = { id: "e-legacy" /* no commercial */ };
    const deps = {
      getEntitlement: async () => entitlement,
      getRoamingSession: async () => session,
      loadSettlementsByEntitlement: async () => [],
      loadSettlementsBySession: async () => [{ consumedRaus: 10, settlementAmount: 166 }],
    };
    const r = await reconcileSession("s1", deps);
    assertEqual(r.status, RECON_STATUS.LEGACY, "entitlement without commercial → LEGACY");
    assert(r.skipped, "legacy is skipped");
    assert(r.reason.includes("commercial"), "reason mentions commercial snapshot");
  });

  test("11. LEGACY: legacy settlement is not treated as roaming settlement", async () => {
    const session = { id: "s1", billedMinutes: 30, entitlementId: "e-no-commercial" };
    const entitlement = { id: "e-no-commercial", quota: { usedMinutes: 30, remainingMinutes: 0 } };
    const deps = {
      getEntitlement: async () => entitlement,
      getRoamingSession: async () => session,
      loadSettlementsByEntitlement: async () => [],
      loadSettlementsBySession: async () => [{ consumedRaus: 30, settlementAmount: 500 }],
    };
    const r = await reconcileSession("s1", deps);
    assertEqual(r.status, RECON_STATUS.LEGACY, "no commercial snapshot → LEGACY, not roaming reconciliation");
    assert(r.checks === null, "no checks performed on legacy");
  });

  // ---- Economic Ceiling (reconciliation level) ----
  test("12. verifyEconomicCeiling: settlement below originalPrice is valid", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = verifyEconomicCeiling([333], commercial);
    assert(r.valid, "333 < 1000 is valid");
    assertEqual(r.total, 333, "total = 333");
  });

  test("12. verifyEconomicCeiling: settlement equal to originalPrice is valid (boundary)", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = verifyEconomicCeiling([1000], commercial);
    assert(r.valid, "1000 == 1000 is valid (boundary)");
    assertEqual(r.ceiling, 1000, "ceiling = 1000");
  });

  test("12. verifyEconomicCeiling: settlement above originalPrice is rejected", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = verifyEconomicCeiling([1001], commercial);
    assert(!r.valid, "1001 > 1000 is rejected");
  });

  test("12. verifyEconomicCeiling: cumulative settlement amounts exceeding originalPrice detected", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = verifyEconomicCeiling([500, 501], commercial);
    assert(!r.valid, "500+501=1001 > 1000 is rejected");
    assertEqual(r.total, 1001, "cumulative total = 1001");
    assert(r.error && r.error.includes("exceeds"), "error describes ceiling breach");
  });

  test("12. verifyEconomicCeiling: uses historical snapshot values, not current price", () => {
    const commercial = { originalPrice: 800, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = verifyEconomicCeiling([800], commercial);
    assert(r.valid, "800 <= 800 (historical snapshot) is valid even if current price is higher");
    assertEqual(r.ceiling, 800, "ceiling comes from commercial snapshot (800), not external price");
  });

  // ---- RAU Economic Safety ----
  test("13. RAU safety: consumedRaus cannot exceed grantedRaus", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 30, rateNumerator: 1000, rateDenominator: 60 };
    const r = verifyRauCeiling(31, commercial);
    assert(!r.valid, "31 > 30 granted is rejected");
    assert(r.error && r.error.includes("grantedRaus"), "error mentions grantedRaus");
  });

  test("13. RAU safety: settlement consumedRaus cannot exceed entitlement usedMinutes", () => {
    const entitlement = {
      id: "e1",
      commercial: { originalPrice: 1000, grantedRaus: 100, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 30, remainingMinutes: 70 },
    };
    const settlements = [{ consumedRaus: 31, settlementAmount: 516 }];
    const r = validateEntitlementReconciliation(entitlement, settlements);
    assert(!r.valid, "31 > 30 usedMinutes is rejected");
    assert(r.errors.some(e => e.includes("usedMinutes")), "error mentions usedMinutes violation");
  });

  test("13. RAU safety: settlement amount consistent with rateNumerator/rateDenominator", () => {
    const r = verifySettlementAmount({ consumedRaus: 10, rateNumerator: 1000, rateDenominator: 60, settlementAmount: 166 });
    assert(r.valid, "10*1000/60=166 (floor) is consistent");
    assertEqual(r.expectedAmount, 166, "expected = 166");
  });

  test("13. RAU safety: manipulated settlementAmount does not pass with valid consumedRaus", () => {
    const result = verifySettlementAmount({ consumedRaus: 10, rateNumerator: 1000, rateDenominator: 60, settlementAmount: 999 });
    assert(!result.valid, "consumedRaus=10 valid but settlementAmount=999 fails (expected 166)");
    assert(result.error && result.error.includes("mismatch"), "error identifies amount mismatch");
  });

  test("13. RAU safety: manipulated consumedRaus does not pass with valid settlementAmount", () => {
    const result = verifySettlementAmount({ consumedRaus: 50, rateNumerator: 1000, rateDenominator: 60, settlementAmount: 166 });
    assert(!result.valid, "consumedRaus=50 valid but settlementAmount=166 fails (expected 833)");
    assert(result.error && result.error.includes("mismatch"), "error identifies amount mismatch");
  });

  // ---- Residual Value ----
  test("14. residual: partially consumed entitlement produces positive residual", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = computeResidualValue(commercial, 20);
    assert(r.residualActual > 0, "partial consumption (20/60) leaves positive residual");
    assert(r.residualTheoretical > 0, "theoretical residual also positive");
  });

  test("14. residual: fully consumed entitlement produces zero residual", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = computeResidualValue(commercial, 60);
    assertEqual(r.remainingRaus, 0, "remaining RAUs = 0");
    assertEqual(r.residualActual, 0, "actual residual = 0 (all consumed)");
  });

  test("14. residual: zero consumption produces full package value as residual", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = computeResidualValue(commercial, 0);
    assertEqual(r.residualActual, 1000, "full originalPrice as residual");
    assertEqual(r.residualTheoretical, 1000, "theoretical = floor(60*1000/60) = 1000");
    assertEqual(r.roundingDiff, 0, "no rounding diff at full consumption");
  });

  test("14. residual: residual value never becomes negative", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r1 = computeResidualValue(commercial, 60);
    const r2 = computeResidualValue(commercial, 61);
    assert(r1.residualActual >= 0, "exact consumption: residual >= 0");
    assert(r2.residualActual >= 0, "over consumption: residual still >= 0 (clamped)");
    assertEqual(r2.remainingRaus, 0, "remaining RAUs clamped to 0 at overflow");
  });

  test("14. residual: rounding strategy is floor-based, consistent with integer-money", () => {
    const commercial = { originalPrice: 1, grantedRaus: 3, rateNumerator: 1, rateDenominator: 3 };
    const r = computeResidualValue(commercial, 2);
    assertEqual(r.consumedValue, 0, "floor(2*1/3) = 0");
    assertEqual(r.residualTheoretical, 0, "floor(1*1/3) = 0");
    assertEqual(r.residualActual, 1, "1 - 0 = 1");
    assertEqual(r.roundingDiff, 1, "rounding diff = 1 (floor strategy)");
  });

  test("14. residual: does not create wallet transfer (purely observational)", () => {
    const commercial = { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 };
    const r = computeResidualValue(commercial, 20);
    const keys = Object.keys(r);
    assert(!keys.includes("walletCredit") && !keys.includes("transfer") && !keys.includes("payout"), "no financial mutation fields");
    assert(r.residualActual > 0, "residual is informational only, not a transfer");
  });

  // ---- Idempotency Safety ----
  test("15. idempotency: same settlement identity detected as duplicate", () => {
    const settlements = [
      { id: "dup-id", idempotencyKey: "k1", entitlementId: "e1", sessionId: "s1", billingCursor: "T1" },
      { id: "dup-id", idempotencyKey: "k2", entitlementId: "e1", sessionId: "s2", billingCursor: "T2" },
    ];
    const r = validateIdempotency(settlements);
    assert(!r.valid, "same doc ID is a duplicate");
    assertEqual(r.duplicates.docIds.length, 1, "1 duplicate doc ID detected");
  });

  test("15. idempotency: same deterministic composite identity detected", () => {
    const settlements = [
      { id: "s1", idempotencyKey: "e1:s1:T1", entitlementId: "e1", sessionId: "s1", billingCursor: "T1" },
      { id: "s2", idempotencyKey: "e1:s1:T2", entitlementId: "e1", sessionId: "s1", billingCursor: "T1" },
    ];
    const r = validateIdempotency(settlements);
    assert(!r.valid, "same composite key (entitlementId+sessionId+billingCursor) is a duplicate");
    assertEqual(r.duplicates.compositeKeys.length, 1, "1 duplicate composite key detected");
  });

  test("15. idempotency: duplicate settlement documents identified", () => {
    const settlements = [
      { id: "s1", idempotencyKey: "k1", entitlementId: "e1", sessionId: "s1", billingCursor: "T1" },
      { id: "s1", idempotencyKey: "k1", entitlementId: "e1", sessionId: "s1", billingCursor: "T1" },
    ];
    const r = validateIdempotency(settlements);
    assert(!r.valid, "identical doc IDs and idempotency keys are duplicates");
    assertEqual(r.duplicates.docIds.length, 1, "1 dup doc ID");
    assertEqual(r.duplicates.idempotencyKeys.length, 1, "1 dup idempotency key");
    assertEqual(r.duplicates.compositeKeys.length, 1, "1 dup composite key");
  });

  test("15. idempotency: different legitimate billing cursors NOT treated as duplicates", () => {
    const settlements = [
      { id: "s1", idempotencyKey: "e1:s1:T1", entitlementId: "e1", sessionId: "s1", billingCursor: "T1" },
      { id: "s2", idempotencyKey: "e1:s1:T2", entitlementId: "e1", sessionId: "s1", billingCursor: "T2" },
      { id: "s3", idempotencyKey: "e1:s1:T3", entitlementId: "e1", sessionId: "s1", billingCursor: "T3" },
    ];
    const r = validateIdempotency(settlements);
    assert(r.valid, "different billing cursors (T1, T2, T3) are NOT duplicates");
    assertEqual(r.duplicates.compositeKeys.length, 0, "no duplicate composite keys");
  });

  test("15. idempotency: duplicate does not become a second independent payable settlement", () => {
    const settlements = [
      { id: "s1", idempotencyKey: "dup", entitlementId: "e1", sessionId: "s1", billingCursor: "T1", settlementAmount: 500 },
      { id: "s2", idempotencyKey: "dup", entitlementId: "e1", sessionId: "s1", billingCursor: "T1", settlementAmount: 500 },
    ];
    const r = validateIdempotency(settlements);
    assert(!r.valid, "duplicate idempotency key flagged");
    assert(r.duplicates.idempotencyKeys.includes("dup"), "duplicate idempotency key is 'dup'");
    const totalAmount = settlements.reduce((sum, s) => sum + s.settlementAmount, 0);
    assertEqual(totalAmount, 1000, "raw sum would double-count = 1000");
    assert(!r.valid, "reconciliation INVALID because duplicates are flagged");
  });

  // ---- INVALID Status ----
  test("16. INVALID: invalid ownership relationship produces INVALID via reconcileSession", async () => {
    const session = { id: "s1", visitedOwnerId: "real-visited", visitedHotspotId: "hotspot-1", entitlementId: "e1" };
    const entitlement = {
      id: "e1",
      homeOwnerId: "real-home",
      commercial: { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 10, remainingMinutes: 50 },
    };
    const settlements = [{
      id: "s-wrong",
      consumedRaus: 10,
      settlementAmount: 166,
      rateNumerator: 1000,
      rateDenominator: 60,
      entitlementId: "e1",
      sessionId: "s1",
      status: INITIAL_SETTLEMENT_STATUS,
      homeOwnerId: "attacker-home",
      visitedOwnerId: "real-visited",
      visitedHotspotId: "hotspot-1",
    }];
    const deps = {
      getEntitlement: async () => entitlement,
      getRoamingSession: async () => session,
      loadSettlementsByEntitlement: async () => settlements,
      loadSettlementsBySession: async () => settlements,
    };
    const r = await reconcileSession("s1", deps);
    assertEqual(r.status, RECON_STATUS.INVALID, "invalid ownership → RECON_STATUS.INVALID");
  });

  test("16. INVALID: malformed settlement amount produces INVALID via reconcileSession", async () => {
    const session = { id: "s1", visitedOwnerId: "v1", visitedHotspotId: "h1", entitlementId: "e1" };
    const entitlement = {
      id: "e1",
      homeOwnerId: "home-1",
      commercial: { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 10, remainingMinutes: 50 },
    };
    const settlements = [{
      id: "s-bad",
      consumedRaus: 10,
      settlementAmount: 9999,
      rateNumerator: 1000,
      rateDenominator: 60,
      entitlementId: "e1",
      sessionId: "s1",
      status: INITIAL_SETTLEMENT_STATUS,
      homeOwnerId: "home-1",
      visitedOwnerId: "v1",
      visitedHotspotId: "h1",
    }];
    const deps = {
      getEntitlement: async () => entitlement,
      getRoamingSession: async () => session,
      loadSettlementsByEntitlement: async () => settlements,
      loadSettlementsBySession: async () => settlements,
    };
    const r = await reconcileSession("s1", deps);
    assertEqual(r.status, RECON_STATUS.INVALID, "malformed amount → RECON_STATUS.INVALID");
  });

  test("16. INVALID: RAU ceiling breach produces INVALID via reconcileSession", async () => {
    const session = { id: "s1", visitedOwnerId: "v1", visitedHotspotId: "h1", entitlementId: "e1" };
    const entitlement = {
      id: "e1",
      homeOwnerId: "home-1",
      commercial: { originalPrice: 500, grantedRaus: 30, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 30, remainingMinutes: 0 },
    };
    const settlements = [{
      id: "s-rau",
      consumedRaus: 40,
      settlementAmount: 666,
      rateNumerator: 1000,
      rateDenominator: 60,
      entitlementId: "e1",
      sessionId: "s1",
      status: INITIAL_SETTLEMENT_STATUS,
      homeOwnerId: "home-1",
      visitedOwnerId: "v1",
      visitedHotspotId: "h1",
    }];
    const deps = {
      getEntitlement: async () => entitlement,
      getRoamingSession: async () => session,
      loadSettlementsByEntitlement: async () => settlements,
      loadSettlementsBySession: async () => settlements,
    };
    const r = await reconcileSession("s1", deps);
    assertEqual(r.status, RECON_STATUS.INVALID, "RAU ceiling breach → RECON_STATUS.INVALID");
  });

  test("16. INVALID: valid settlement produces RECONCILED (not INVALID) via reconcileSession", async () => {
    const session = { id: "s1", visitedOwnerId: "v1", visitedHotspotId: "h1", entitlementId: "e1", billedMinutes: 10 };
    const entitlement = {
      id: "e1",
      homeOwnerId: "home-1",
      commercial: { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 10, remainingMinutes: 50 },
    };
    const settlements = [{
      id: "s-ok",
      consumedRaus: 10,
      settlementAmount: 166,
      rateNumerator: 1000,
      rateDenominator: 60,
      entitlementId: "e1",
      sessionId: "s1",
      status: INITIAL_SETTLEMENT_STATUS,
      homeOwnerId: "home-1",
      visitedOwnerId: "v1",
      visitedHotspotId: "h1",
      idempotencyKey: "e1:s1:T1",
      billingCursor: "T1",
    }];
    const deps = {
      getEntitlement: async () => entitlement,
      getRoamingSession: async () => session,
      loadSettlementsByEntitlement: async () => settlements,
      loadSettlementsBySession: async () => settlements,
    };
    const r = await reconcileSession("s1", deps);
    assertEqual(r.status, RECON_STATUS.RECONCILED, "valid settlement → RECONCILED");
  });

  // ---- Financial Safety: No Money Movement ----
  test("17. FINANCIAL: reconciliation returns result only, no financial mutation invoked", async () => {
    let walletCreditCalled = false;
    let debitWalletCalled = false;
    let transferCreated = false;
    let mtnDisbursed = false;
    let airtelDisbursed = false;
    let feeApplied = false;

    const session = { id: "s1", visitedOwnerId: "v1", visitedHotspotId: "h1", entitlementId: "e1", billedMinutes: 10 };
    const entitlement = {
      id: "e1",
      homeOwnerId: "home-1",
      commercial: { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 },
      quota: { usedMinutes: 10, remainingMinutes: 50 },
    };
    const settlements = [{
      id: "s1",
      consumedRaus: 10,
      settlementAmount: 166,
      rateNumerator: 1000,
      rateDenominator: 60,
      entitlementId: "e1",
      sessionId: "s1",
      status: INITIAL_SETTLEMENT_STATUS,
      homeOwnerId: "home-1",
      visitedOwnerId: "v1",
      visitedHotspotId: "h1",
      idempotencyKey: "e1:s1:T1",
      billingCursor: "T1",
    }];
    const deps = {
      getEntitlement: async () => entitlement,
      getRoamingSession: async () => session,
      loadSettlementsByEntitlement: async () => settlements,
      loadSettlementsBySession: async () => settlements,
      walletCredit: async () => { walletCreditCalled = true; return true; },
      debitWallet: async () => { debitWalletCalled = true; return true; },
      createTransfer: async () => { transferCreated = true; return true; },
      disburseMTN: async () => { mtnDisbursed = true; return true; },
      disburseAirtel: async () => { airtelDisbursed = true; return true; },
      applyFee: async () => { feeApplied = true; return true; },
    };
    const r = await reconcileSession("s1", deps);
    assert(!walletCreditCalled, "no walletCredit invoked");
    assert(!debitWalletCalled, "no debitWallet invoked");
    assert(!transferCreated, "no transfer created");
    assert(!mtnDisbursed, "no MTN disbursement invoked");
    assert(!airtelDisbursed, "no Airtel disbursement invoked");
    assert(!feeApplied, "no fee applied");
    assert(r.status !== undefined, "reconciliation still produces a status result");
  });

  test("17. FINANCIAL: reconciliation service exports contain NO financial mutation functions", () => {
    const reconModule = require("../services/roamingSettlementReconciliationService.js");
    const exportedKeys = Object.keys(reconModule).sort();
    const financialFunctions = exportedKeys.filter(k =>
      k.includes("credit") || k.includes("debit") || k.includes("transfer") ||
      k.includes("disburse") || k.includes("payout") || k.includes("fee") || k.includes("withdraw")
    );
    assertEqual(financialFunctions.length, 0, "no financial mutation functions exported");
  });

  test("17. FINANCIAL: settlement status remains 'calculated', not 'credited' or 'paid'", () => {
    assertEqual(INITIAL_SETTLEMENT_STATUS, "calculated", "initial settlement status is 'calculated'");
    const reconModule = require("../services/roamingSettlementReconciliationService.js");
    const noStatusTransition = !Object.keys(reconModule).some(k =>
      k.includes("credit") || k.includes("markPaid") || k.includes("transitionStatus")
    );
    assert(noStatusTransition, "no status-transition functions exported (no credited/paid)");
  });

  console.log("\n========================================");
  console.log("Phase 7.6E Results: " + passed + " passed, " + failed + " failed");
  console.log("========================================");
  if (failed > 0) process.exit(1);
}

main();