/**
 * Phase 7.6F.2 — Roaming Settlement Credit Service.
 *
 * Tests the new creditRoamingSettlement function — exactly-once
 * wallet crediting of a valid roaming settlement.
 *
 * Run: node backend/scripts/check-roaming-phase7-6g2.js
 */
const {
  SETTLEMENT_COLLECTION,
  SETTLEMENT_STATUS,
  INITIAL_SETTLEMENT_STATUS,
} = require("../services/roamingSettlementService");
const {
  WALLET_COLLECTION,
  verifySettlementFinancialIntegrity,
  verifyIdempotencyKeyMatches,
  validateCreditPreconditions,
  creditRoamingSettlement,
} = require("../services/roamingSettlementCreditService");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log("PASS: " + msg); passed++; }
  else { console.error("FAIL: " + msg); failed++; }
}
function assertEqual(a, b, m) {
  assert(a === b, m + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")");
}

const HOME = "homeA";
const VISITED = "visitedB";
const HOTSPOT = "hotspotB1";
const ENT = "ent1";
const SESS = "sess1";
const CURSOR = "2025-01-01T00:20:00.000Z";
const IDEMPOTENCY_KEY = `${ENT}:${SESS}:${CURSOR}`;

function makeSettlement(overrides) {
  return {
    id: IDEMPOTENCY_KEY,
    idempotencyKey: IDEMPOTENCY_KEY,
    entitlementId: ENT,
    sessionId: SESS,
    homeOwnerId: HOME,
    visitedOwnerId: VISITED,
    visitedHotspotId: HOTSPOT,
    consumedRaus: 20,
    rateNumerator: 1000,
    rateDenominator: 60,
    settlementAmount: 333,
    billingCursor: CURSOR,
    status: INITIAL_SETTLEMENT_STATUS,
    createdAt: "2025-01-01T00:20:00.000Z",
    updatedAt: "2025-01-01T00:20:00.000Z",
    ...overrides,
  };
}

function makeFakeDb(docs) {
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
    set(ref, data, merge) {
      if (merge && merge.merge) {
        store[ref.coll] = store[ref.coll] || {};
        store[ref.coll][ref.id] = { ...(store[ref.coll][ref.id] || {}), ...data };
      } else {
        store[ref.coll] = store[ref.coll] || {};
        store[ref.coll][ref.id] = { ...data };
      }
      return undefined;
    },
    update(ref, data) {
      store[ref.coll] = store[ref.coll] || {};
      store[ref.coll][ref.id] = { ...(store[ref.coll][ref.id] || {}), ...data };
      return undefined;
    },
  };
  let txCount = 0;
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
    runTransaction(fn) {
      txCount++;
      return Promise.resolve().then(() => fn(tx));
    },
    _store: store,
    _txCount: () => txCount,
  };
}

function makeFakeDbConcurrent(docs) {
  const store = JSON.parse(JSON.stringify(docs));
  let activeTx = null;
  const tx = {
    get(ref) {
      return Promise.resolve({
        exists: !!store[ref.coll]?.[ref.id],
        data: () => (store[ref.coll]?.[ref.id] ? { ...store[ref.coll][ref.id] } : undefined),
        id: ref.id,
      });
    },
    set(ref, data, merge) {
      if (merge && merge.merge) {
        store[ref.coll] = store[ref.coll] || {};
        store[ref.coll][ref.id] = { ...(store[ref.coll][ref.id] || {}), ...data };
      } else {
        store[ref.coll] = store[ref.coll] || {};
        store[ref.coll][ref.id] = { ...data };
      }
    },
    update(ref, data) {
      store[ref.coll] = store[ref.coll] || {};
      store[ref.coll][ref.id] = { ...(store[ref.coll][ref.id] || {}), ...data };
    },
  };
  let abortCount = 0;
  return {
    collection(name) {
      const coll = name;
      return {
        doc(id) { return { coll, id }; },
        where: () => ({ get: async () => ({ empty: true, docs: [] }) }),
      };
    },
    runTransaction(fn) {
      if (activeTx !== null) {
        abortCount++;
        return Promise.reject(new Error("transaction conflict (concurrent write)"));
      }
      activeTx = true;
      return Promise.resolve()
        .then(() => fn(tx))
        .then((result) => {
          activeTx = null;
          return result;
        })
        .catch((e) => {
          activeTx = null;
          throw e;
        });
    },
    _store: store,
    _abortCount: () => abortCount,
  };
}

async function main() {
  console.log("=== Phase 7.6F.2: Roaming Settlement Credit Service ===\n");

  // ---- 1. Valid calculated settlement ----
  console.log("--- 1. Valid calculated settlement: wallet credited ----");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(r.success, "credit succeeds");
    assertEqual(r.status, "credited", "settlement status becomes credited");
    assert(r.credited, "wallet was credited");
    assertEqual(r.amount, 333, "exact settlementAmount credited");
    assert(r.wallet, "wallet object returned");
    assertEqual(r.wallet.balance, 1333, "balance increased by 333 (1000 + 333)");
    assertEqual(r.wallet.transactions[0].type, "roaming_credit", "transaction type is roaming_credit");
    assertEqual(r.wallet.transactions[0].amount, 333, "transaction amount is 333");
    assertEqual(r.wallet.transactions[0].referenceId, IDEMPOTENCY_KEY, "transaction has referenceId (idempotency key)");
    assertEqual(r.wallet.transactions[0].settlementId, IDEMPOTENCY_KEY, "transaction has settlementId");
    assertEqual(r.wallet.transactions[0].entitlementId, ENT, "transaction has entitlementId");
    assertEqual(r.wallet.transactions[0].sessionId, SESS, "transaction has sessionId");
    assertEqual(r.wallet.transactions[0].visitedHotspotId, HOTSPOT, "transaction has visitedHotspotId");
  }

  // ---- 2. Idempotent: same settlement called twice ----
  console.log("\n--- 2. Same settlement called twice: no double credit ----");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const r1 = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    const r2 = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(r1.credited, "first call credits");
    assertEqual(db._store.wallets[VISITED].balance, 1333, "balance is 1333 after first call");
    assert(!r2.credited, "second call does NOT credit again");
    assertEqual(r2.status, "credited", "second call sees status already credited");
    assertEqual(r2.skipped, true, "second call is skipped");
    assertEqual(db._store.wallets[VISITED].balance, 1333, "balance unchanged on second call (1333)");
    assertEqual(db._store.wallets[VISITED].transactions.length, 1, "only 1 transaction entry after 2 calls");
  }

  // ---- 3. Concurrent duplicate attempts ----
  console.log("\n--- 3. Concurrent duplicate attempts: exactly one credit ----");
  {
    const db = makeFakeDbConcurrent({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const results = await Promise.allSettled([
      creditRoamingSettlement(IDEMPOTENCY_KEY, { db }),
      creditRoamingSettlement(IDEMPOTENCY_KEY, { db }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const atLeastOneSuccess = fulfilled.some((r) => r.credited);
    const totalCredited = fulfilled.filter((r) => r.credited).length;
    assert(atLeastOneSuccess, "at least one concurrent attempt succeeds");
    assertEqual(totalCredited, 1, "exactly one credit succeeds");
    assertEqual(db._store.wallets[VISITED].balance, 1333, "balance is 1333 (only one credit)");
    assertEqual(db._store.wallets[VISITED].transactions.length, 1, "only one transaction entry");
  }

  // ---- 4. Wrong settlement amount ----
  console.log("\n--- 4. Wrong settlement amount: rejected, no credit ----");
  {
    const badSettlement = makeSettlement({ settlementAmount: 9999 });
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: badSettlement },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(!r.success, "credit rejected for wrong amount");
    assert(!r.credited, "no wallet credit");
    assertEqual(r.status, "calculated", "settlement remains calculated");
    assertEqual(db._store.wallets[VISITED].balance, 1000, "balance unchanged");
    assertEqual(db._store.wallets[VISITED].transactions.length, 0, "no transaction added");
    assert(r.errors.some(e => e.includes("mismatch")), "error describes amount mismatch");
  }

  // ---- 5. Invalid RAU/economic fields ----
  console.log("\n--- 5. Invalid RAU/economic fields: rejected ----");
  {
    const bad = makeSettlement({ consumedRaus: 50, settlementAmount: 333 });
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: bad },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(!r.success, "rejected for RAU/amount inconsistency");
    assert(!r.credited, "no wallet credit");
    assertEqual(db._store.wallets[VISITED].balance, 1000, "balance unchanged");
    assert(r.errors.some(e => e.includes("mismatch")), "error describes monetary mismatch");
  }

  test("5b. Invalid negative consumedRaus", () => {
    const r = verifySettlementFinancialIntegrity(makeSettlement({ consumedRaus: -1 }));
    assert(!r.valid, "negative consumedRaus rejected");
    assert(r.errors.some(e => e.includes("consumedRaus")), "error mentions consumedRaus");
  });

  test("5c. Invalid zero rateDenominator", () => {
    const r = verifySettlementFinancialIntegrity(makeSettlement({ rateDenominator: 0 }));
    assert(!r.valid, "zero rateDenominator rejected");
    assert(r.errors.some(e => e.includes("rateDenominator")), "error mentions rateDenominator");
  });

  test("5d. Idempotency key mismatch", () => {
    const r = verifyIdempotencyKeyMatches(
      makeSettlement({ idempotencyKey: "other:key" }),
      IDEMPOTENCY_KEY
    );
    assert(!r.valid, "idempotencyKey != documentId rejected");
    assert(r.errors.some(e => e.includes("idempotencyKey")), "error mentions idempotencyKey");
  });

  // ---- 6. Wrong/missing visitedOwnerId ----
  console.log("\n--- 6. Missing visitedOwnerId: rejected, no credit ----");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement({ visitedOwnerId: null }) },
      wallets: {},
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(!r.success, "rejected for missing visitedOwnerId");
    assert(!r.credited, "no wallet credit");
  }

  test("6b. Missing entitlementId rejected", () => {
    const r = validateCreditPreconditions(makeSettlement({ entitlementId: null }), IDEMPOTENCY_KEY);
    assert(!r.valid, "missing entitlementId rejected");
    assert(r.errors.some(e => e.includes("entitlementId")), "error mentions entitlementId");
  });

  test("6c. Missing sessionId rejected", () => {
    const r = validateCreditPreconditions(makeSettlement({ sessionId: null }), IDEMPOTENCY_KEY);
    assert(!r.valid, "missing sessionId rejected");
    assert(r.errors.some(e => e.includes("sessionId")), "error mentions sessionId");
  });

  // ---- 7. Legacy/non-reconcilable settlement ----
  console.log("\n--- 7. Legacy settlement (zero rateDenominator) rejected ----");
  {
    const legacySettlement = makeSettlement({
      rateDenominator: 0,
      rateNumerator: 0,
      consumedRaus: 0,
      settlementAmount: 0,
      status: INITIAL_SETTLEMENT_STATUS,
    });
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: legacySettlement },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(!r.success, "legacy (no valid rate) rejected");
    assert(!r.credited, "no wallet credit for legacy");
    assertEqual(db._store.wallets[VISITED].balance, 1000, "balance unchanged");
  }

  test("7b. Non-calculated status (already credited) is skipped, not re-credited", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement({ status: "credited" }) },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(r.success, "operation succeeds (idempotent read)");
    assert(!r.credited, "not re-credited");
    assertEqual(r.skipped, true, "skipped (already credited)");
    assertEqual(db._store.wallets[VISITED].balance, 1000, "balance unchanged");
  });

  test("7c. Failed status is rejected", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement({ status: "failed" }) },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(!r.success, "failed status rejected");
    assert(!r.credited, "no credit for failed settlement");
  });

  // ---- 8. Platform wallet protection ----
  console.log("\n--- 8. Platform wallet is NOT modified ----");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: {
        [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] },
        platform: { id: "platform", balance: 500, transactions: [] },
      },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(r.credited, "visited owner credited");
    assertEqual(db._store.wallets[VISITED].balance, 1333, "visited wallet = 1333");
    assertEqual(db._store.wallets.platform.balance, 500, "platform wallet unchanged (500)");
    assertEqual(db._store.wallets.platform.transactions.length, 0, "no platform transactions added");
    assertEqual(db._store.wallets[VISITED].transactions[0].type, "roaming_credit", "visited tx type = roaming_credit");
  }

  // ---- 9. Zero-amount settlement ----
  console.log("\n--- 9. Zero-amount settlement: no wallet credit ----");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement({ consumedRaus: 0, settlementAmount: 0 }) },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(r.success, "zero-amount settlement handled gracefully");
    assertEqual(r.status, "credited", "status becomes credited");
    assert(r.wallet === null, "no wallet credit written");
    assertEqual(db._store.wallets[VISITED].balance, 1000, "balance unchanged (no zero-value tx)");
    assertEqual(db._store.wallets[VISITED].transactions.length, 0, "no transaction entry for zero-amount");
    assertEqual(db._store.roaming_settlements[IDEMPOTENCY_KEY].status, "credited", "settlement status = credited");
  }

  // ---- 10. Existing wallet transactions preserved ----
  console.log("\n--- 10. Existing wallet transactions preserved ----");
  {
    const existingTx = { type: "credit", amount: 500, date: "2025-01-01T00:00:00.000Z", description: "Package sale: test" };
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 500, transactions: [existingTx] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(r.credited, "credit succeeds");
    assertEqual(r.wallet.transactions[0].type, "roaming_credit", "new roaming_credit is first");
    assertEqual(r.wallet.transactions[1].type, "credit", "existing purchase credit preserved at index 1");
    assertEqual(r.wallet.transactions[1].description, "Package sale: test", "existing description preserved");
    assertEqual(r.wallet.balance, 833, "balance = 500 + 333 = 833");
    assertEqual(db._store.wallets[VISITED].transactions.length, 2, "total 2 transactions");
  }

  // ---- 11. Wallet auto-created if missing ----
  console.log("\n--- 11. Wallet auto-created if not exists ----");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: {},
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(r.credited, "credit succeeds with auto-created wallet");
    assertEqual(r.wallet.balance, 333, "new wallet balance = 333 (0 + settlementAmount)");
    assertEqual(r.wallet.ownerId, VISITED, "wallet ownerId = visitedOwnerId");
    assertEqual(r.wallet.transactions[0].type, "roaming_credit", "first transaction is roaming_credit");
  }

  // ---- 12. 100-entry cap preserved ----
  console.log("\n--- 12. Wallet transaction 100-entry cap preserved ----");
  {
    const manyTxns = Array.from({ length: 100 }, (_, i) => ({
      type: "credit",
      amount: 1,
      date: "2025-01-01T00:00:00.000Z",
      description: `txn ${i}`,
    }));
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 100, transactions: manyTxns } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(r.credited, "credit succeeds");
    assertEqual(r.wallet.transactions.length, 100, "transaction array capped at 100 (101 → 100)");
    assertEqual(r.wallet.transactions[0].type, "roaming_credit", "newest entry is roaming_credit (first)");
    assertEqual(r.wallet.transactions[99].type, "credit", "oldest entry pushed off (was credit)");
  }

  // ---- 13. Financial integrity unit tests ----
  console.log("\n--- 13. Financial integrity verification ---");
  test("13a. Valid settlement passes integrity check", () => {
    const r = verifySettlementFinancialIntegrity(makeSettlement());
    assert(r.valid, "valid settlement passes integrity");
    assertEqual(r.errors.length, 0, "no integrity errors");
  });

  test("13b. Float consumedRaus rejected", () => {
    const r = verifySettlementFinancialIntegrity(makeSettlement({ consumedRaus: 20.5 }));
    assert(!r.valid, "float consumedRaus rejected");
  });

  test("13c. Float settlementAmount rejected", () => {
    const r = verifySettlementFinancialIntegrity(makeSettlement({ settlementAmount: 333.5 }));
    assert(!r.valid, "float settlementAmount rejected");
  });

  test("13d. Negative settlementAmount rejected", () => {
    const r = verifySettlementFinancialIntegrity(makeSettlement({ settlementAmount: -1 }));
    assert(!r.valid, "negative settlementAmount rejected");
  });

  test("13e. settlementAmount exceeds rateNumerator rejected", () => {
    const r = verifySettlementFinancialIntegrity(makeSettlement({ settlementAmount: 2000 }));
    assert(!r.valid, "settlementAmount > rateNumerator rejected");
    assert(r.errors.some(e => e.includes("exceeds")), "error mentions exceeds");
  });

  // ---- 14. Settlement status constants ----
  console.log("\n--- 14. Settlement status constants ---");
  test("14a. SETTLEMENT_STATUS includes credited", () => {
    assert(Array.isArray(SETTLEMENT_STATUS), "SETTLEMENT_STATUS is an array");
    assert(SETTLEMENT_STATUS.includes("calculated"), "includes 'calculated'");
    assert(SETTLEMENT_STATUS.includes("credited"), "includes 'credited'");
    assert(SETTLEMENT_STATUS.includes("failed"), "includes 'failed'");
    assert(SETTLEMENT_STATUS.includes("pending_credit"), "includes 'pending_credit'");
  });

  test("14b. INITIAL_SETTLEMENT_STATUS is calculated", () => {
    assertEqual(INITIAL_SETTLEMENT_STATUS, "calculated", "initial status is calculated");
  });

  console.log("\n========================================");
  console.log("Phase 7.6F.2 Results: " + passed + " passed, " + failed + " failed");
  console.log("========================================");
  if (failed > 0) process.exit(1);
}

function test(name, fn) {
  try { fn(); }
  catch (e) { console.error("CRASH in " + name + ": " + (e && e.stack ? e.stack : e)); failed++; }
}

main().catch((e) => {
  console.error("FATAL:", e && e.stack ? e.stack : e);
  process.exit(1);
});
