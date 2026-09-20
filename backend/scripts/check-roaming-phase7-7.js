/**
 * Phase 7.7 — Unused RAU Expiry Retention.
 *
 * Verifies the roaming_residuals ledger: residual computation, idempotency,
 * concurrency safety, race handling, invalid-case handling, wallet protection,
 * and immutability.
 *
 * Run: node backend/scripts/check-roaming-phase7-7.js
 */
const {
  RESIDUAL_COLLECTION,
  RESIDUAL_STATUS,
  FINAL_RESIDUAL_STATUSES,
  buildIdempotencyKey,
  finalizeEntitlementResidual,
} = require("../services/roamingResidualService");

const { computeRauSettlementValue } = require("../services/roamingEntitlementService");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log("PASS: " + msg); passed++; }
  else { console.error("FAIL: " + msg); failed++; }
}
function assertEqual(a, b, m) {
  assert(a === b, m + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")");
}

const ENT = "ent-77";
const USER = "user-77";
const HOME = "home-77";
const EPOCH = "2025-01-01T00:00:00.000Z";
const EXPIRES_AT = "2025-01-15T00:00:00.000Z";
const NOW = "2025-01-16T00:00:00.000Z";

function makeCommercial(overrides) {
  return {
    originalPrice: 1000,
    grantedRaus: 60,
    rateNumerator: 1000,
    rateDenominator: 60,
    ...overrides,
  };
}

function makeEntitlement(overrides) {
  return {
    id: ENT,
    userRef: { userId: USER, phone: "+phone-77" },
    homeOwnerId: HOME,
    scope: "federation",
    scopeRefs: {},
    status: "active",
    source: "package",
    validity: { startsAt: EPOCH, expiresAt: EXPIRES_AT },
    quota: { maxMinutes: 60, usedMinutes: 0, remainingMinutes: 60 },
    commercial: makeCommercial(),
    createdAt: EPOCH,
    updatedAt: EPOCH,
    createdBy: "system:bridge",
    updatedBy: "system:bridge",
    lastIdempotencyKey: "receipt-77",
    ...overrides,
  };
}

function makeFakeDb(docs, options = {}) {
  const store = JSON.parse(JSON.stringify(docs));
  const tx = {
    get(ref) {
      const row = store[ref.coll] && store[ref.coll][ref.id];
      return Promise.resolve({
        exists: !!row,
        data: () => (row ? { ...row } : undefined),
        id: ref.id,
      });
    },
    set(ref, data) {
      store[ref.coll] = store[ref.coll] || {};
      store[ref.coll][ref.id] = { ...data };
    },
    update(ref, data) {
      store[ref.coll] = store[ref.coll] || {};
      store[ref.coll][ref.id] = { ...(store[ref.coll][ref.id] || {}), ...data };
    },
  };

  let activeTx = null;

  function runSerial(fn) {
    return Promise.resolve().then(() => fn(tx));
  }

  function runWithRetry(fn) {
    let attempts = 0;
    const maxAttempts = 20;

    function attempt() {
      if (activeTx !== null) {
        if (attempts >= maxAttempts) {
          return Promise.reject(new Error("Aborted at client (max retries)"));
        }
        attempts++;
        return new Promise((resolve) => setTimeout(resolve, 2)).then(attempt);
      }
      activeTx = true;
      return Promise.resolve()
        .then(() => fn(tx))
        .then((result) => { activeTx = null; return result; })
        .catch((e) => {
          activeTx = null;
          if (attempts < maxAttempts && e && e.message && e.message.includes("Aborted")) {
            attempts++;
            return new Promise((resolve) => setTimeout(resolve, 2)).then(attempt);
          }
          throw e;
        });
    }
    return attempt();
  }

  const runTransaction = options.withRetry ? runWithRetry : runSerial;

  return {
    collection(name) {
      const coll = name;
      return {
        doc(id) { return { coll, id }; },
        where(field, op, value) {
          return {
            limit(n) {
              return {
                get() {
                  const results = [];
                  const col = store[coll] || {};
                  for (const id of Object.keys(col)) {
                    const row = col[id];
                    if (field === "status" && op === "==" && row[field] === value) {
                      results.push({ id, data: () => ({ ...row }) });
                    }
                    if (field === "validity.expiresAt") {
                      const rowVal = row.validity && row.validity.expiresAt;
                      if (op === "<=" && rowVal && rowVal <= value) {
                        results.push({ id, data: () => ({ ...row }) });
                      }
                    }
                  }
                  return Promise.resolve({
                    empty: results.length === 0,
                    forEach(cb) { results.forEach(cb); },
                    size: results.length,
                  });
                },
              };
            },
            get() {
              const results = [];
              const col = store[coll] || {};
              for (const id of Object.keys(col)) {
                const row = col[id];
                if (field === "status" && op === "==" && row[field] === value) {
                  results.push({ id, data: () => ({ ...row }) });
                }
                if (field === "validity.expiresAt") {
                  const rowVal = row.validity && row.validity.expiresAt;
                  if (op === "<=" && rowVal && rowVal <= value) {
                    results.push({ id, data: () => ({ ...row }) });
                  }
                }
              }
              return Promise.resolve({
                empty: results.length === 0,
                forEach(cb) { results.forEach(cb); },
                size: results.length,
              });
            },
          };
        },
        get() {
          const col = store[coll] || {};
          const results = Object.entries(col).map(([id, row]) => ({
            id,
            data: () => ({ ...row }),
          }));
          return Promise.resolve({
            empty: results.length === 0,
            forEach(cb) { results.forEach(cb); },
            size: results.length,
          });
        },
      };
    },
    runTransaction,
    _store: store,
  };
}

async function runTests() {
  console.log("=== Phase 7.7: Unused RAU Expiry Retention ===\n");

  // ---- 1. Partially consumed (20/60) ----
  console.log("\n--- 1. Partially consumed (20/60) ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assert(r.success, "success = true");
    assertEqual(r.status, "finalized", "status = finalized");
    assertEqual(r.finalized, true, "finalized = true");
    assertEqual(r.retainedAmount, 666, "retained = floor(40*1000/60) = 666");
    assert(r.errors.length === 0, "no errors");
    assertEqual(db._store.roaming_entitlements[ENT].status, "expired", "entitlement status = expired");
    assertEqual(db._store.roaming_residuals[ENT + ":residual"].retainedAmount, 666, "residual record has retainedAmount=666");
  }

  // ---- 2. Fully consumed (60/60) ----
  console.log("\n--- 2. Fully consumed (60/60) ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 60, remainingMinutes: 0 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
      wallets: { platform: { balance: 1000, transactions: [] } },
      roaming_settlements: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assert(r.success, "success = true");
    assertEqual(r.status, "finalized", "status = finalized");
    assertEqual(r.retainedAmount, 0, "retained = 0 (fully consumed)");
    assertEqual(db._store.roaming_entitlements[ENT].status, "expired", "entitlement = expired");
  }

  // ---- 3. Zero consumed (0/60) ----
  console.log("\n--- 3. Zero consumed (0/60) ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 0, remainingMinutes: 60 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
      wallets: { platform: { balance: 1000, transactions: [] } },
      roaming_settlements: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r.retainedAmount, 1000, "retained = floor(60*1000/60) = 1000");
    assertEqual(r.status, "finalized", "status = finalized");
    assertEqual(db._store.roaming_entitlements[ENT].status, "expired", "entitlement = expired");
  }

  // ---- 4. Economic ceiling ----
  console.log("\n--- 4. Economic ceiling ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
      commercial: makeCommercial({ originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 60 }),
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    const consumedValue = computeRauSettlementValue(20, ent.commercial);
    assertEqual(consumedValue + r.retainedAmount, 333 + 666, "consumed(333) + retained(666) = 999");
    assert(consumedValue + r.retainedAmount <= ent.commercial.originalPrice, "consumed + retained <= originalPrice (999 <= 1000)");
  }

  // ---- 5. Double finalization (idempotency) ----
  console.log("\n--- 5. Double finalization ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r1 = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assert(r1.finalized, "first call finalizes");
    assertEqual(r1.retainedAmount, 666, "first: retained 666");
    const r2 = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r2.idempotent, true, "second call idempotent");
    assertEqual(r2.finalized, false, "second call not finalized");
    assertEqual(r2.retainedAmount, 666, "second: retained still 666 (immutable)");
    const residualDoc = db._store.roaming_residuals[ENT + ":residual"];
    assertEqual(residualDoc.status, "finalized", "residual doc status = finalized");
    assertEqual(residualDoc.retainedAmount, 666, "residual doc immutable retainedAmount");
  }

  // ---- 6. Concurrent finalization (22 concurrent → exactly one residual) ----
  console.log("\n--- 6. Concurrent finalization ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
      wallets: { platform: { balance: 1000, transactions: [] } },
    }, { withRetry: true });
    const results = await Promise.allSettled(
      Array.from({ length: 22 }, () =>
        finalizeEntitlementResidual(ENT, { db, nowIso: NOW })
      )
    );
    const finalized = results.filter((r) => r.status === "fulfilled" && r.value && r.value.finalized);
    assertEqual(finalized.length, 1, "exactly 1 finalization from 22 concurrent attempts");
    const residualKeys = Object.keys(db._store.roaming_residuals);
    assertEqual(residualKeys.length, 1, "exactly 1 residual document");
    assertEqual(db._store.roaming_residuals[ENT + ":residual"].retainedAmount, 666, "retained = 666");
    assertEqual(db._store.roaming_entitlements[ENT].status, "expired", "entitlement = expired");
    assertEqual(db._store.wallets.platform.balance, 1000, "platform balance unchanged");
  }

  // ---- 7. Consumption vs finalization race ----
  console.log("\n--- 7. Consumption vs finalization race ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    }, { withRetry: true });

    let consumptionCommitted = false;

    const consumptionPromise = new Promise((resolve) => {
      setTimeout(() => {
        if (!consumptionCommitted) {
          db._store.roaming_entitlements[ENT].quota.usedMinutes = 35;
          db._store.roaming_entitlements[ENT].quota.remainingMinutes = 25;
          consumptionCommitted = true;
        }
        resolve();
      }, 5);
    });

    const [residualResult] = await Promise.all([
      finalizeEntitlementResidual(ENT, { db, nowIso: NOW }),
      consumptionPromise,
    ]);

    assert(residualResult.success, "residual transaction completed");
    assert(residualResult.finalized, "residual finalized");
    assert(residualResult.retainedAmount === 666 || residualResult.retainedAmount === 416,
      "retained reflects either pre-consumption(666) or post-consumption(416) depending on tx timing");
  }

  // ---- 8. Final consumption commits before finalization reads ----
  console.log("\n--- 8. Final consumption commits before finalization reads ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    }, { withRetry: true });

    db._store.roaming_entitlements[ENT].quota.usedMinutes = 35;
    db._store.roaming_entitlements[ENT].quota.remainingMinutes = 25;

    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assert(r.success, "residual completed");
    assertEqual(r.retainedAmount, 416, "retained = floor(25*1000/60) = 416 (sees post-consumption value)");
    assertEqual(r.status, "finalized", "status = finalized");
  }

  // ---- 9. Finalization commits first, later consumption rejected ----
  console.log("\n--- 9. Finalization commits first, later consumption rejected ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(db._store.roaming_entitlements[ENT].status, "expired", "entitlement = expired");
    assert(
      db._store.roaming_entitlements[ENT].status !== "active",
      "status !== active — consumption engine would reject (roamingRauConsumptionService.js:177)"
    );
  }

  // ---- 10. No commercial snapshot → skipped ----
  console.log("\n--- 10. No commercial snapshot ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
      commercial: null,
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r.status, "skipped", "status = skipped");
    assertEqual(r.skipped, true, "skipped = true");
    assertEqual(r.retainedAmount, 0, "retainedAmount = 0");
    assert(r.errors.length > 0, "errors present");
    assert(r.errors.some((e) => e.includes("commercial")), "error mentions commercial");
    assertEqual(db._store.roaming_entitlements[ENT].status, "expired", "entitlement still transitions to expired");
    assertEqual(db._store.roaming_residuals[ENT + ":residual"].status, "skipped", "residual doc status = skipped");
  }

  // ---- 11. Zero granted RAUs ----
  console.log("\n--- 11. Zero granted RAUs ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 0, usedMinutes: 0, remainingMinutes: 0 },
      commercial: makeCommercial({ originalPrice: 0, grantedRaus: 0, rateNumerator: 0, rateDenominator: 0 }),
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r.retainedAmount, 0, "retained = 0 (zero grant)");
    assertEqual(db._store.roaming_entitlements[ENT].status, "expired", "entitlement = expired");
  }

  // ---- 12. Zero denominator → skipped ----
  console.log("\n--- 12. Zero denominator ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
      commercial: { originalPrice: 1000, grantedRaus: 60, rateNumerator: 1000, rateDenominator: 0 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r.status, "skipped", "status = skipped");
    assertEqual(r.retainedAmount, 0, "retainedAmount = 0");
    assert(r.errors.length > 0, "errors present");
    assert(r.errors.some((e) => e.includes("denominator") || e.includes("commercial")), "error mentions denominator or commercial");
  }

  // ---- 13. Negative remaining → skipped ----
  console.log("\n--- 13. Negative remaining ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 70, remainingMinutes: -10 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r.status, "skipped", "status = skipped (not clamped)");
    assertEqual(r.retainedAmount, 0, "retainedAmount = 0");
    assert(r.errors.length > 0, "errors present");
    assert(r.errors.some((e) => e.includes("negative")), "error mentions negative remaining");
  }

  // ---- 14. Remaining > granted ----
  console.log("\n--- 14. Remaining > granted ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 10, remainingMinutes: 70 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r.status, "skipped", "status = skipped");
    assert(r.errors.length > 0, "errors present");
    assert(r.errors.some((e) => e.includes("exceeds")), "error mentions exceeds");
  }

  // ---- 15. Already expired entitlement without residual ----
  console.log("\n--- 15. Already expired entitlement without residual ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
      status: "expired",
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assert(r.success, "processes already-expired entitlement");
    assertEqual(r.finalized, true, "finalized = true");
    assertEqual(r.retainedAmount, 666, "retained = 666");
    assertEqual(db._store.roaming_entitlements[ENT].status, "expired", "status stays expired (not reset to active)");
  }

  // ---- 16. Already finalized residual (immutability) ----
  console.log("\n--- 16. Already finalized residual ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 120, usedMinutes: 20, remainingMinutes: 100 },
      commercial: makeCommercial({ originalPrice: 2000, grantedRaus: 120, rateNumerator: 2000, rateDenominator: 120 }),
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r1 = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assert(r1.finalized, "first: finalized");
    assertEqual(r1.retainedAmount, 1666, "first: retained 1666 (floor(100*2000/120))");

    ent.quota = { maxMinutes: 120, usedMinutes: 20, remainingMinutes: 100 };
    const r2 = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r2.idempotent, true, "retry is idempotent no-op");
    assertEqual(r2.finalized, false, "retry not finalized");
    assertEqual(db._store.roaming_residuals[ENT + ":residual"].status, "finalized", "residual status unchanged");
    assertEqual(db._store.roaming_residuals[ENT + ":residual"].retainedAmount, 1666, "immutable: retainedAmount still 1666 (not recomputed to 1666)");
    assertEqual(db._store.roaming_residuals[ENT + ":residual"].consumedRaus, 20, "immutable: consumedRaus unchanged (20)");
    assertEqual(db._store.roaming_residuals[ENT + ":residual"].remainingRaus, 100, "immutable: remainingRaus unchanged (100)");
  }

  // ---- 17. Revoked entitlement ----
  console.log("\n--- 17. Revoked entitlement ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
      status: "revoked",
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r.status, "not_eligible", "status = not_eligible");
    assertEqual(r.skipped, true, "skipped = true");
    assertEqual(db._store.roaming_residuals[ENT + ":residual"], undefined, "no residual record created");
    assertEqual(db._store.roaming_entitlements[ENT].status, "revoked", "entitlement status unchanged (revoked)");
  }

  // ---- 18. Platform wallet unchanged ----
  console.log("\n--- 18. Platform wallet unchanged ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
      wallets: { platform: { balance: 1000, transactions: [] } },
      roaming_settlements: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
     assertEqual(
       JSON.stringify(db._store.wallets.platform),
       JSON.stringify({ balance: 1000, transactions: [] }),
       "platform wallet unchanged (balance + transactions)"
     );
    assertEqual(db._store.wallets.platform.transactions.length, 0, "no platform transactions added");
  }

  // ---- 19. No roaming_settlements created ----
  console.log("\n--- 19. No roaming_settlements created ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
      wallets: { platform: { balance: 1000, transactions: [] } },
      roaming_settlements: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(Object.keys(db._store.roaming_settlements).length, 0, "no roaming_settlements created");
  }

  // ---- 20. Historical economics unchanged ----
  console.log("\n--- 20. Historical economics unchanged ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
      commercial: makeCommercial({ originalPrice: 5000, grantedRaus: 60, rateNumerator: 5000, rateDenominator: 60 }),
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r.retainedAmount, 3333, "retained from historical snapshot: floor(40*5000/60) = 3333");
    const resid = db._store.roaming_residuals[ENT + ":residual"];
    assertEqual(resid.commercial.originalPrice, 5000, "snapshot preserves originalPrice=5000");
  }

  // ---- 21. Deterministic document ID ----
  console.log("\n--- 21. Deterministic document ID ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r.residual.id, ENT + ":residual", "idempotency key = ${entitlementId}:residual");
    assert(db._store.roaming_residuals[ENT + ":residual"], "residual doc created at deterministic ID");
    assertEqual(r.residual.idempotencyKey, ENT + ":residual", "idempotencyKey == document ID");
    assertEqual(r.residual.id, ENT + ":residual", "id == document ID");
  }

  // ---- 22. Immutable snapshot ----
  console.log("\n--- 22. Immutable snapshot ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 120, usedMinutes: 20, remainingMinutes: 100 },
      commercial: makeCommercial({ originalPrice: 2000, grantedRaus: 120, rateNumerator: 2000, rateDenominator: 120 }),
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r1 = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assert(r1.finalized, "first finalized");

    ent.quota = { maxMinutes: 999, usedMinutes: 999, remainingMinutes: 0 };
    const r2 = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r2.idempotent, true, "retry is idempotent no-op");
    assertEqual(
      JSON.stringify(db._store.roaming_residuals[ENT + ":residual"]),
      JSON.stringify({
        id: ENT + ":residual",
        idempotencyKey: ENT + ":residual",
        entitlementId: ENT,
        userId: USER,
        homeOwnerId: HOME,
        commercial: { originalPrice: 2000, grantedRaus: 120, rateNumerator: 2000, rateDenominator: 120 },
        quota: { maxMinutes: 120, usedMinutes: 20, remainingMinutes: 100 },
        consumedRaus: 20,
        remainingRaus: 100,
        retainedAmount: 1666,
        status: "finalized",
        skipped: false,
        errors: [],
        createdAt: NOW,
        finalizedAt: NOW,
      }),
      "immutable snapshot fields not rewritten by retry"
    );
    assertEqual(db._store.roaming_residuals[ENT + ":residual"].retainedAmount, 1666, "retainedAmount unchanged (1666, not recomputed to 0)");
  }

  // ---- Additional: Retry after skipped ----
  console.log("\n--- Additional: Retry after skipped ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
      commercial: null,
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r1 = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r1.status, "skipped", "first: skipped");
    const r2 = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r2.idempotent, true, "retry is no-op");
    assertEqual(r2.status, "skipped", "retry: still skipped");
  }

  // ---- Additional: Concurrent with retry → exactly one ----
  console.log("\n--- Additional: Concurrent with retry → exactly one ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
      wallets: { platform: { balance: 1000, transactions: [] } },
    }, { withRetry: true });
    const results = await Promise.allSettled(
      Array.from({ length: 22 }, () =>
        finalizeEntitlementResidual(ENT, { db, nowIso: NOW })
      )
    );
    const finalized = results.filter((r) => r.status === "fulfilled" && r.value && r.value.finalized);
    assertEqual(finalized.length, 1, "exactly 1 finalized");
    assertEqual(db._store.wallets.platform.balance, 1000, "platform balance never changed");
  }

  // ---- Additional: Large integer values ----
  console.log("\n--- Additional: Large integer values ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 44640, usedMinutes: 9996, remainingMinutes: 34640 },
      commercial: makeCommercial({ originalPrice: 50000000, grantedRaus: 44640, rateNumerator: 50000000, rateDenominator: 44640 }),
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assert(Number.isInteger(r.retainedAmount), "retainedAmount is integer");
    assertEqual(r.retainedAmount, 38799283, "large value: floor(34640*50000000/44640)");
    assert(r.retainedAmount + computeRauSettlementValue(10000, ent.commercial) <= 50000000, "ceiling holds for large values");
  }

  // ---- Additional: Missing entitlement ----
  console.log("\n--- Additional: Missing entitlement ---");
  {
    const db = makeFakeDb({
      roaming_entitlements: {},
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual("nonexistent-99", { db, nowIso: NOW });
    assertEqual(r.success, false, "success = false");
    assertEqual(r.status, "not_found", "status = not_found");
    assert(r.errors.some((e) => e.includes("not found")), "error mentions not found");
  }

  // ---- Additional: Invalid expiry timestamp ----
  console.log("\n--- Additional: Invalid expiry timestamp ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
      validity: { startsAt: EPOCH, expiresAt: null },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r.status, "not_eligible", "not eligible (undefined expiry)");
  }

  // ---- Additional: Not yet expired ----
  console.log("\n--- Additional: Not yet expired ---");
  {
    const ent = makeEntitlement({
      quota: { maxMinutes: 60, usedMinutes: 20, remainingMinutes: 40 },
      validity: { startsAt: EPOCH, expiresAt: "2025-12-31T00:00:00.000Z" },
    });
    const db = makeFakeDb({
      roaming_entitlements: { [ENT]: ent },
      roaming_residuals: {},
    });
    const r = await finalizeEntitlementResidual(ENT, { db, nowIso: NOW });
    assertEqual(r.status, "not_eligible", "not yet expired");
    assertEqual(r.skipped, true, "skipped = true");
    assertEqual(db._store.roaming_residuals[ENT + ":residual"], undefined, "no residual created");
    assertEqual(db._store.roaming_entitlements[ENT].status, "active", "status stays active");
  }

  console.log("\n========================================");
  console.log("Phase 7.7 Results: " + passed + " passed, " + failed + " failed");
  console.log("========================================");
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
