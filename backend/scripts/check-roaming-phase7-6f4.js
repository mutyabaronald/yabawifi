/**
 * Phase 7.6F.4 — Production Credit Wiring Tests.
 *
 * Tests the actual production wiring that triggers wallet credit
 * after a roaming settlement is created during RAU consumption.
 *
 * Run: node backend/scripts/check-roaming-phase7-6f4.js
 */
const {
  INITIAL_SETTLEMENT_STATUS,
} = require("../services/roamingSettlementService");
const {
  creditRoamingSettlement,
} = require("../services/roamingSettlementCreditService");
const { triggerSettlementCredit, backfillCalculatedSettlements } = require("../services/roamingSettlementCreditGateway");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log("PASS: " + msg); passed++; }
  else { console.error("FAIL: " + msg); failed++; }
}
function assertEqual(a, b, m) {
  assert(a === b, m + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")");
}

const ENT = "ent-f4";
const SESS = "sess-f4";
const HOME = "home-f4";
const VISITED = "visited-f4";
const HOTSPOT = "hotspot-f4";
const CURSOR = "2025-01-15T00:30:00.000Z";
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
    createdAt: "2025-01-15T00:30:00.000Z",
    updatedAt: "2025-01-15T00:30:00.000Z",
    ...overrides,
  };
}

function makeFakeDb(docs) {
  const store = JSON.parse(JSON.stringify(docs));
  let activeTx = null;
  const tx = {
    get(ref) {
      const row = store[ref.coll] && store[ref.coll][ref.id];
      return Promise.resolve({
        exists: !!row,
        data: () => (row ? { ...row } : undefined),
        id: ref.id,
      });
    },
    set(ref, data, options) {
      store[ref.coll] = store[ref.coll] || {};
      if (options && options.merge) {
        store[ref.coll][ref.id] = { ...(store[ref.coll][ref.id] || {}), ...data };
      } else {
        store[ref.coll][ref.id] = { ...data };
      }
    },
    update(ref, data) {
      store[ref.coll] = store[ref.coll] || {};
      store[ref.coll][ref.id] = { ...(store[ref.coll][ref.id] || {}), ...data };
    },
  };
  return {
    collection(name) {
      const coll = name;
      return {
        doc(id) { return { coll, id }; },
        where(field, op, value) {
          let limitVal = Infinity;
          const obj = {
            limit(n) { limitVal = n; return obj; },
            get: async () => {
              const docs = store[coll] || {};
              const matching = Object.entries(docs).filter(([_, data]) => {
                if (op === "==") return data[field] === value;
                return false;
              }).slice(0, limitVal);
              return {
                empty: matching.length === 0,
                docs: matching.map(([id, data]) => ({ id, data: () => ({ ...data }) })),
              };
            },
          };
          return obj;
        },
      };
    },
    runTransaction(fn) {
      // Simulate Firestore transaction semantics: a concurrent
      // transaction is ABORTED and AUTOMATICALLY RETRIED after the
      // active one completes (Firestore retries with backoff).
      // The retry re-reads the document store, so a second concurrent
      // credit attempt will observe the settlement already "credited"
      // and return the skip path.
      const maxAttempts = 10;

      function attempt(tryNum) {
        if (activeTx !== null) {
          if (tryNum >= maxAttempts) {
            return Promise.reject(new Error("Aborted at client (max retries exceeded)"));
          }
          // Abort: yield to the event loop so the active tx can finish, then retry
          return new Promise((resolve) => setImmediate(resolve)).then(() => attempt(tryNum + 1));
        }
        activeTx = true;
        return Promise.resolve()
          .then(() => fn(tx))
          .then((result) => { activeTx = null; return result; })
          .catch((e) => {
            activeTx = null;
            if (e && e.message && e.message.includes("Aborted") && tryNum < maxAttempts - 1) {
              return new Promise((resolve) => setImmediate(resolve)).then(() => attempt(tryNum + 1));
            }
            throw e;
          });
      }
      return attempt(0);
    },
    _store: store,
  };
}

function makeBillingResult(settlement) {
  return {
    consumed: 20,
    remainingMinutes: 40,
    usedMinutes: 20,
    exhausted: false,
    billed: true,
    billable: 20,
    settlement: {
      created: true,
      idempotent: false,
      settlement: settlement,
      skipped: false,
    },
  };
}

async function test(name, fn) {
  try { await fn(); }
  catch (e) { console.error("CRASH in " + name + ": " + (e && e.stack ? e.stack : e)); failed++; }
}

async function main() {
  console.log("=== Phase 7.6F.4: Production Credit Wiring ===\n");

  // ---- A. Successful production credit ----
  console.log("--- A. Successful production credit via trigger ---");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const billing = makeBillingResult(makeSettlement());
    const r = await triggerSettlementCredit(billing.settlement, { db });
    assert(r.triggered, "credit was triggered");
    assert(r.creditResult, "creditResult returned");
    assert(r.creditResult.credited, "wallet credited");
    assertEqual(r.creditResult.amount, 333, "exact settlementAmount credited");
    assertEqual(r.creditResult.status, "credited", "settlement status = credited");
    assertEqual(db._store.wallets[VISITED].balance, 1333, "visited wallet: 1000 + 333 = 1333");
    assertEqual(db._store.wallets[VISITED].transactions[0].type, "roaming_credit", "transaction type is roaming_credit");
    assertEqual(db._store.wallets[VISITED].transactions[0].referenceId, IDEMPOTENCY_KEY, "referenceId = idempotencyKey");
  }

  // ---- B. Retry (second call) ----
  console.log("\n--- B. Retry: second trigger is a no-op ---");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    const billing = makeBillingResult(makeSettlement());
    const r1 = await triggerSettlementCredit(billing.settlement, { db });
    const r2 = await triggerSettlementCredit(billing.settlement, { db });
    assert(r1.creditResult.credited, "first call credits");
    assert(!r2.creditResult.credited, "second call does NOT credit");
    assertEqual(r2.creditResult.skipped, true, "second call skipped");
    assertEqual(db._store.wallets[VISITED].balance, 333, "balance unchanged on retry (333)");
    assertEqual(db._store.wallets[VISITED].transactions.length, 1, "only 1 transaction");
  }

  // ---- C. Concurrent processing ----
  console.log("\n--- C. Concurrent processing: exactly one credit ---");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    const billing = makeBillingResult(makeSettlement());
    const results = await Promise.allSettled([
      triggerSettlementCredit(billing.settlement, { db }),
      triggerSettlementCredit(billing.settlement, { db }),
    ]);
    const fulfilled = results.filter(r => r.status === "fulfilled").map(r => r.value);

    // Both concurrent calls must eventually complete (Firestore retries aborts)
    assertEqual(fulfilled.length, 2, "both concurrent attempts completed");

    // Invariant 1: exactly one wallet credit applied
    const creditedCount = fulfilled.filter(r => r.creditResult && r.creditResult.credited).length;
    assert(creditedCount === 1, "exactly one credit from concurrent attempts");

    // Invariant 2: wallet balance increased by settlementAmount exactly once
    assertEqual(db._store.wallets[VISITED].balance, 333, "wallet balance = 0 + 333 (exactly one credit)");

    // Invariant 3: at most one roaming_credit transaction for this settlement
    const roamingCredits = (db._store.wallets[VISITED].transactions || []).filter(
      (t) => t.type === "roaming_credit" && t.referenceId === IDEMPOTENCY_KEY
    );
    assertEqual(roamingCredits.length, 1, "exactly one roaming_credit transaction for this settlement");

    // Invariant 4: settlement ends in credited
    assertEqual(db._store.roaming_settlements[IDEMPOTENCY_KEY].status, "credited", "settlement status = credited after concurrent processing");

    // Invariant 5: subsequent retry is a no-op
    const balanceBefore = db._store.wallets[VISITED].balance;
    const txCountBefore = db._store.wallets[VISITED].transactions.length;
    const retryResult = await triggerSettlementCredit(billing.settlement, { db });
    assert(!retryResult.creditResult.credited, "retry does not re-credit");
    assertEqual(retryResult.creditResult.skipped, true, "retry is skipped (already credited)");
    assertEqual(db._store.wallets[VISITED].balance, balanceBefore, "balance unchanged on retry");
    assertEqual(db._store.wallets[VISITED].transactions.length, txCountBefore, "no new transaction on retry");
  }

  // ---- D. Failed credit (transient failure) ----
  console.log("\n--- D. Failed credit: settlement remains retryable ---");
  {
    const billing = makeBillingResult(makeSettlement());
    const badDb = {
      collection(name) {
        return {
          doc(id) { return { coll: name, id: id }; },
          where: () => ({ get: async () => ({ empty: true, docs: [] }) }),
        };
      },
      runTransaction(fn) { return Promise.reject(new Error("Firestore connection lost")); },
    };
    const r = await triggerSettlementCredit(billing.settlement, { db: badDb });
    assert(r.error !== null, "error is reported, not thrown");
    assert(r.error.includes("Firestore") || r.error.includes("lost"), "error captured");
  }

  // ---- D2. Transient failure doesn't corrupt settlement ----
  console.log("--- D2. Transient failure leaves settlement in 'calculated' ---");
  {
    const settlement = makeSettlement();
    const billing = makeBillingResult(settlement);
    const badDb = {
      collection(name) {
        return {
          doc(id) { return { coll: name, id: id }; },
          where: () => ({ get: async () => ({ empty: true, docs: [] }) }),
        };
      },
      runTransaction(fn) { return Promise.reject(new Error("transient")); },
    };
    await triggerSettlementCredit(billing.settlement, { db: badDb });
    assertEqual(settlement.status, "calculated", "settlement remains 'calculated' after failure");
  }

  // ---- E. Client data cannot redirect credit ----
  console.log("\n--- E. Client data cannot redirect credit ---");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: {
        [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] },
        "attacker-wallet": { ownerId: "attacker-wallet", balance: 0, transactions: [] },
      },
    });
    const fakeBilling = {
      settlement: {
        created: true,
        idempotent: false,
        skipped: false,
        settlement: { ...makeSettlement(), settlementAmount: 9999, visitedOwnerId: "attacker-wallet" },
      },
    };
    const r = await triggerSettlementCredit(fakeBilling.settlement, { db });
    // Credit service loads settlement from Firestore by ID — uses stored values
    assertEqual(db._store.wallets[VISITED].balance, 333, "credit uses stored settlementAmount (333), not client data");
    assertEqual(db._store.wallets["attacker-wallet"].balance, 0, "attacker wallet untouched");
  }

  // ---- F. Platform protection ----
  console.log("\n--- F. Platform wallet receives no roaming credit ---");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: {
        [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] },
        platform: { id: "platform", balance: 1000, transactions: [] },
      },
    });
    const billing = makeBillingResult(makeSettlement());
    await triggerSettlementCredit(billing.settlement, { db });
    assertEqual(db._store.wallets.platform.balance, 1000, "platform balance unchanged (1000)");
    assertEqual(db._store.wallets.platform.transactions.length, 0, "no platform transactions");
    assert(!db._store.wallets.platform.transactions.some(t => t.type === "roaming_credit"), "no roaming_credit in platform");
  }

  // ---- G. Existing wallet history preserved ----
  console.log("\n--- G. Existing purchase transactions preserved ---");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: {
        [VISITED]: { ownerId: VISITED, balance: 500, transactions: [
          { type: "credit", amount: 500, date: "2025-01-01T00:00:00.000Z", description: "Package sale: test" },
        ] },
      },
    });
    const billing = makeBillingResult(makeSettlement());
    const r = await triggerSettlementCredit(billing.settlement, { db });
    assertEqual(r.creditResult.wallet.transactions[0].type, "roaming_credit", "newest first");
    assertEqual(r.creditResult.wallet.transactions[1].type, "credit", "purchase preserved");
    assertEqual(r.creditResult.wallet.transactions[1].description, "Package sale: test", "purchase description preserved");
    assertEqual(r.creditResult.wallet.balance, 833, "500 + 333 = 833");
  }

  // ---- H. Skipped settlement (no billing consumed) ----
  console.log("\n--- H. Skipped settlement (consumed=0) ---");
  {
    const billing = {
      consumed: 0,
      billed: false,
      settlement: { created: false, idempotent: false, settlement: null, skipped: true, reason: "no_consumption" },
    };
    const db = makeFakeDb({
      roaming_settlements: {},
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const r = await triggerSettlementCredit(billing.settlement, { db });
    assert(!r.triggered, "not triggered for skipped settlement");
    assertEqual(db._store.wallets[VISITED].balance, 1000, "balance unchanged");
  }

  // ---- I. Idempotent settlement re-billing ----
  console.log("\n--- I. Idempotent settlement re-billing ---");
  {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement({ status: "calculated" }) },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    const billing = makeBillingResult(makeSettlement());
    const r1 = await triggerSettlementCredit(billing.settlement, { db });
    assert(r1.creditResult.credited, "first trigger credits");
    // Simulate re-billing that finds same settlement already credited
    db._store.roaming_settlements[IDEMPOTENCY_KEY] = makeSettlement({ status: "credited", creditedAt: "2025-01-15T00:31:00.000Z" });
    const r2 = await triggerSettlementCredit(billing.settlement, { db });
    assert(!r2.creditResult.credited, "second trigger does not re-credit");
    assertEqual(db._store.wallets[VISITED].balance, 333, "balance unchanged (333)");
  }

  // ---- J. Zero-amount settlement semantics ----
  console.log("\n--- J. Zero-amount settlement ---");
  {
    // A. zero settlement starts as calculated
    const zeroSettlement = makeSettlement({ consumedRaus: 0, settlementAmount: 0 });
    assertEqual(zeroSettlement.status, "calculated", "A: zero settlement starts as calculated");

    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: zeroSettlement },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 500, transactions: [] } },
    });
    const billing = makeBillingResult(zeroSettlement);
    const r = await triggerSettlementCredit(billing.settlement, { db });

    // B. first credit attempt changes it to credited
    assert(r.creditResult.success, "B: success = true");
    assertEqual(r.creditResult.status, "credited", "B: result status = credited");
    assertEqual(db._store.roaming_settlements[IDEMPOTENCY_KEY].status, "credited", "B: settlement status = credited in store");

    // C. no wallet transaction is written
    assertEqual(db._store.wallets[VISITED].transactions.length, 0, "C: no wallet transaction written");
    assertEqual(r.creditResult.wallet, null, "C: wallet is null in result");

    // D. wallet balance is unchanged
    assertEqual(db._store.wallets[VISITED].balance, 500, "D: wallet balance unchanged (500)");

    // Zero-amount is NOT "skipped" — it was processed (finalized), just without a wallet write
    assertEqual(r.creditResult.skipped, false, "B: zero-amount is not skipped (finalized for first time)");
    assertEqual(r.creditResult.credited, false, "B: no wallet credit made (credited=false)");

    // E. second credit attempt does not modify anything
    const balanceBefore = db._store.wallets[VISITED].balance;
    const txCountBefore = db._store.wallets[VISITED].transactions.length;
    const r2 = await triggerSettlementCredit(billing.settlement, { db });
    assert(!r2.creditResult.credited, "E: second attempt does not credit");
    assertEqual(r2.creditResult.skipped, true, "E: second attempt is skipped (already credited)");
    assertEqual(db._store.wallets[VISITED].balance, balanceBefore, "E: balance unchanged on retry");
    assertEqual(db._store.wallets[VISITED].transactions.length, txCountBefore, "E: no new transaction on retry");
  }

  // F. backfill does not count zero-amount settlement as an error or retry
  console.log("\n--- J-F. Backfill with zero-amount settlement (first-time) ---");
  {
    const zeroSettlement = makeSettlement({ consumedRaus: 0, settlementAmount: 0 });
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: zeroSettlement },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 500, transactions: [] } },
    });
    const result = await backfillCalculatedSettlements({
      db,
      creditFn: async (settlementId) => creditRoamingSettlement(settlementId, { db }),
    });
    assertEqual(result.attempted, 1, "F: backfill attempted 1 settlement");
    assertEqual(result.credited, 0, "F: zero-amount not counted as wallet credit");
    assertEqual(result.alreadyCredited, 1, "F: zero-amount counted as alreadyCredited");
    assertEqual(result.errors, 0, "F: zero-amount not counted as error");
    assertEqual(result.errorDetails.length, 0, "F: no error details for zero-amount");
  }

  // G. zero-value behavior does not affect positive settlements
  console.log("\n--- J-G. Zero-value does not affect positive settlements ---");
  {
    const zeroKey = "ent-zero:sess-zero:T0";
    const zeroSettlement = makeSettlement({
      id: zeroKey,
      idempotencyKey: zeroKey,
      entitlementId: "ent-zero",
      sessionId: "sess-zero",
      consumedRaus: 0,
      settlementAmount: 0,
    });
    const db = makeFakeDb({
      roaming_settlements: {
        [zeroKey]: zeroSettlement,
        [IDEMPOTENCY_KEY]: makeSettlement(),
      },
      wallets: {
        [VISITED]: { ownerId: VISITED, balance: 500, transactions: [] },
      },
    });

    // Credit the zero-amount settlement first
    const zeroBilling = makeBillingResult(zeroSettlement);
    await triggerSettlementCredit(zeroBilling.settlement, { db });
    assertEqual(db._store.roaming_settlements[zeroKey].status, "credited", "G: zero settlement credited");
    assertEqual(db._store.wallets[VISITED].balance, 500, "G: balance unchanged after zero credit");
    assertEqual(db._store.wallets[VISITED].transactions.length, 0, "G: no transactions after zero credit");

    // Positive settlement still works normally
    const posBilling = makeBillingResult(makeSettlement());
    const r = await triggerSettlementCredit(posBilling.settlement, { db });
    assert(r.creditResult.credited, "G: positive settlement credited after zero");
    assertEqual(db._store.wallets[VISITED].balance, 833, "G: 500 + 333 = 833");
    assertEqual(db._store.wallets[VISITED].transactions.length, 1, "G: exactly 1 roaming_credit transaction");
    assertEqual(db._store.wallets[VISITED].transactions[0].referenceId, IDEMPOTENCY_KEY, "G: transaction for positive settlement");
    assertEqual(db._store.roaming_settlements[IDEMPOTENCY_KEY].status, "credited", "G: positive settlement credited");
  }

  // ---- K. Gateway API verification ----
  console.log("\n--- K. Gateway API verification ---");
  test("K1. triggerSettlementCredit is exported", () => {
    assert(typeof triggerSettlementCredit === "function", "triggerSettlementCredit is a function");
  });

  test("K2. backfillCalculatedSettlements is exported", () => {
    const gateway = require("../services/roamingSettlementCreditGateway");
    assert(typeof gateway.backfillCalculatedSettlements === "function", "backfillCalculatedSettlements is exported");
  });

  // ---- L. Settlement loaded fresh by ID ----
  console.log("\n--- L. Settlement loaded fresh by ID ---");
  await test("L1. Credit service loads settlement from Firestore by ID", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement({ settlementAmount: 333 }) },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] } },
    });
    const fakeBilling = {
      settlement: {
        created: true,
        idempotent: false,
        skipped: false,
        settlement: { ...makeSettlement(), settlementAmount: 9999, visitedOwnerId: "attacker-wallet" },
      },
    };
    await triggerSettlementCredit(fakeBilling.settlement, { db });
    assertEqual(db._store.wallets[VISITED].balance, 1333, "credit uses stored settlementAmount (333), not client data");
    assertEqual(db._store.wallets["attacker-wallet"], undefined, "no attacker wallet created");
  });

  // ---- M. RAU consumption survives credit failure ----
  console.log("\n--- M. RAU consumption survives credit failure ---");
  await test("M1. Consumption result is returned regardless of credit outcome", async () => {
    const billing = makeBillingResult(makeSettlement());
    const badDb = {
      collection(name) {
        return {
          doc(id) { return { coll: name, id: id }; },
          where: () => ({ get: async () => ({ empty: true, docs: [] }) }),
        };
      },
      runTransaction(fn) { return Promise.reject(new Error("boom")); },
    };
    const r = await triggerSettlementCredit(billing.settlement, { db: badDb });
    assert(r.error !== null, "error is reported, not thrown");
    assert(billing.consumed === 20, "original billing result is unaffected by credit error");
    assert(billing.settlement.settlement.settlementAmount === 333, "settlement record in billing result is intact");
  });

  // ---- N. Trigger only fires on created/idempotent settlements ----
  console.log("\n--- N. Trigger respects settlement skip ---");
  await test("N1. Trigger does not fire for legacy settlement (skipped) ", async () => {
    const billing = {
      consumed: 20,
      billed: true,
      settlement: { created: false, idempotent: false, settlement: null, skipped: true, reason: "legacy: no commercial snapshot" },
    };
    const db = makeFakeDb({
      roaming_settlements: {},
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    const r = await triggerSettlementCredit(billing.settlement, { db });
    assert(!r.triggered, "not triggered for legacy settlement");
    assertEqual(r.error, null, "no error (just skipped)");
  });

  // ---- O. Settlement ID uniqueness ----
  console.log("\n--- O. Settlement ID is the idempotency key ---");
  await test("O1. Settlement ID equals idempotency key", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    const r = await triggerSettlementCredit(makeBillingResult(makeSettlement()).settlement, { db });
    assertEqual(r.creditResult.wallet.transactions[0].referenceId, IDEMPOTENCY_KEY, "referenceId = idempotency key");
    assertEqual(db._store.roaming_settlements[IDEMPOTENCY_KEY].creditedTxId, IDEMPOTENCY_KEY, "creditedTxId = idempotency key");
  });

  console.log("\n========================================");
  console.log("Phase 7.6F.4 Results: " + passed + " passed, " + failed + " failed");
  console.log("========================================");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e && e.stack ? e.stack : e);
  process.exit(1);
});
