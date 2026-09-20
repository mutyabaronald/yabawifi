/**
 * Phase 7.6F.3 — Wallet Unit Tests for Roaming Settlement Credit.
 *
 * Focuses on the wallet-side guarantees of the credit operation:
 * - Wallet transaction record structure
 * - Balance computation correctness
 * - Transaction history cap enforcement (100 entries)
 * - Idempotency reference detection in wallet history
 * - Transaction ordering (newest first)
 * - Wallet auto-creation
 * - No platform wallet contamination
 * - No modification of existing purchase transactions
 *
 * Run: node backend/scripts/check-roaming-phase7-6f3.js
 */
const {
  INITIAL_SETTLEMENT_STATUS,
} = require("../services/roamingSettlementService");
const {
  WALLET_COLLECTION,
  verifySettlementFinancialIntegrity,
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

const ENT = "ent-f3-1";
const SESS = "sess-f3-1";
const HOME = "home-f3";
const VISITED = "visited-f3";
const HOTSPOT = "hotspot-f3";
const CURSOR = "2025-01-15T00:00:00.000Z";
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
    consumedRaus: 10,
    rateNumerator: 1000,
    rateDenominator: 60,
    settlementAmount: 166,
    billingCursor: CURSOR,
    status: INITIAL_SETTLEMENT_STATUS,
    createdAt: "2025-01-15T00:00:00.000Z",
    updatedAt: "2025-01-15T00:00:00.000Z",
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
        where: () => ({ get: async () => ({ empty: true, docs: [] }) }),
      };
    },
    runTransaction(fn) {
      return Promise.resolve().then(() => fn(tx));
    },
    _store: store,
  };
}

async function test(name, fn) {
  try { await fn(); }
  catch (e) { console.error("CRASH in " + name + ": " + (e && e.stack ? e.stack : e)); failed++; }
}

async function main() {
  console.log("=== Phase 7.6F.3: Wallet Unit Tests for Roaming Settlement Credit ===\n");

  // ---- 1. Wallet transaction record structure ----
  console.log("--- 1. Wallet transaction record structure ---");
  await test("1. Wallet transaction record structure", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    const tx = r.wallet.transactions[0];
    assertEqual(tx.type, "roaming_credit", "type = roaming_credit");
    assertEqual(tx.amount, 166, "amount = settlementAmount");
    assert(typeof tx.date === "string" && tx.date.includes("T"), "date is ISO8601");
    assert(tx.description.includes(SESS), "description contains sessionId");
    assert(tx.description.includes(HOTSPOT), "description contains visitedHotspotId");
    assertEqual(tx.referenceId, IDEMPOTENCY_KEY, "referenceId = idempotencyKey");
    assertEqual(tx.settlementId, IDEMPOTENCY_KEY, "settlementId = idempotencyKey");
    assertEqual(tx.entitlementId, ENT, "entitlementId included");
    assertEqual(tx.sessionId, SESS, "sessionId included");
    assertEqual(tx.visitedHotspotId, HOTSPOT, "visitedHotspotId included");
    const expectedKeys = ["type", "amount", "date", "description", "referenceId", "settlementId", "entitlementId", "sessionId", "visitedHotspotId"];
    const actualKeys = Object.keys(tx).sort();
    expectedKeys.forEach((k) => assert(actualKeys.includes(k), `transaction has field: ${k}`));
  });

  // ---- 2. Balance computation correctness ----
  console.log("\n--- 2. Balance computation correctness ---");
  await test("2a. Balance increases by settlementAmount", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 5000, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assertEqual(r.wallet.balance, 5166, "5000 + 166 = 5166");
    assertEqual(db._store.wallets[VISITED].balance, 5166, "stored balance = 5166");
  });

  await test("2b. Balance from zero starting point", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assertEqual(r.wallet.balance, 166, "0 + 166 = 166");
  });

  await test("2c. Balance precision (no floating point)", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement({ settlementAmount: 1000, rateNumerator: 1000, rateDenominator: 60, consumedRaus: 60 }) },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(Number.isInteger(r.wallet.balance), "balance is an integer");
    assertEqual(r.wallet.balance, 1000, "exact integer (no float drift)");
  });

  // ---- 3. Transaction history cap (100 entries) ----
  console.log("\n--- 3. Transaction history 100-entry cap ---");
  await test("3a. Wallet with fewer than 100 transactions grows", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [{ type: "credit", amount: 10, date: "2025-01-01T00:00:00.000Z", description: "prior" }] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assertEqual(r.wallet.transactions.length, 2, "1 existing + 1 new = 2");
    assertEqual(r.wallet.transactions[0].type, "roaming_credit", "newer first");
    assertEqual(r.wallet.transactions[1].type, "credit", "older second");
  });

  await test("3b. Wallet with exactly 100 transactions stays at 100", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      type: "credit", amount: 1, date: "2025-01-01T00:00:00.000Z", description: `txn ${i}`,
    }));
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: many } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assertEqual(r.wallet.transactions.length, 100, "capped at 100 (101 -> 100)");
    assertEqual(r.wallet.transactions[0].type, "roaming_credit", "newest is first");
    assertEqual(r.wallet.transactions[99].type, "credit", "oldest pushed off");
  });

  await test("3c. Wallet with 100 transactions pushes oldest off", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      type: "credit", amount: i, date: "2025-01-01T00:00:00.000Z", description: `txn-${i}`,
    }));
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: many } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assertEqual(r.wallet.transactions.length, 100, "still 100");
    const last = r.wallet.transactions[99];
    assertEqual(r.wallet.transactions[0].type, "roaming_credit", "newest is first");
    assertEqual(last.type, "credit", "oldest remaining is a credit");
    assert(last.description !== "txn-0", "txn-0 still present (pushed to index 1)");
    assertEqual(r.wallet.transactions[1].description, "txn-0", "txn-0 at index 1");
  });

  // ---- 4. Idempotency via wallet transaction referenceId ----
  console.log("\n--- 4. Idempotency via wallet transaction referenceId ---");
  await test("4a. Existing referenceId prevents double credit (secondary guard)", async () => {
    const existingTx = {
      type: "roaming_credit", amount: 166, date: "2025-01-10T00:00:00.000Z",
      description: "Roaming settlement: prior", referenceId: IDEMPOTENCY_KEY,
    };
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement({ status: "calculated" }) },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 166, transactions: [existingTx] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(!r.credited, "not credited (secondary guard detected referenceId)");
    assertEqual(r.skipped, true, "skipped");
    assertEqual(db._store.wallets[VISITED].balance, 166, "balance unchanged (166)");
    assertEqual(db._store.wallets[VISITED].transactions.length, 1, "still 1 transaction");
  });

  await test("4b. Without referenceId match, credit proceeds", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [{
        type: "credit", amount: 10, date: "2025-01-01T00:00:00.000Z",
        description: "purchase", referenceId: "OTHER-KEY",
      }] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(r.credited, "credited (no referenceId match)");
    assertEqual(db._store.wallets[VISITED].balance, 166, "balance = 0 + 166");
    assertEqual(db._store.wallets[VISITED].transactions.length, 2, "2 transactions");
  });

  // ---- 5. Transaction ordering (newest first) ----
  console.log("\n--- 5. Transaction ordering ---");
  await test("5a. New roaming credit appears before existing", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 100, transactions: [
        { type: "credit", amount: 100, date: "2025-01-01T00:00:00.000Z", description: "first" },
      ] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assertEqual(r.wallet.transactions[0].type, "roaming_credit", "newest is roaming_credit (first)");
    assertEqual(r.wallet.transactions[1].type, "credit", "older is second");
  });

  // ---- 6. Wallet auto-creation ----
  console.log("\n--- 6. Wallet auto-creation ---");
  await test("6a. Wallet created with correct ownerId", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: {},
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assertEqual(r.wallet.ownerId, VISITED, "auto-created wallet has visitedOwnerId");
    assertEqual(db._store.wallets[VISITED].ownerId, VISITED, "stored wallet ownerId");
  });

  await test("6b. Auto-created wallet has correct initial fields", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: {},
    });
    await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    const stored = db._store.wallets[VISITED];
    assert("ownerId" in stored, "has ownerId");
    assert("balance" in stored, "has balance");
    assert("transactions" in stored, "has transactions");
    assertEqual(stored.balance, 166, "balance initialized correctly");
  });

  // ---- 7. No platform wallet contamination ----
  console.log("\n--- 7. Platform wallet protection ---");
  await test("7a. Platform wallet receives no roaming_credit", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: {
        [VISITED]: { ownerId: VISITED, balance: 1000, transactions: [] },
        platform: { id: "platform", balance: 500, transactions: [] },
      },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assertEqual(db._store.wallets.platform.balance, 500, "platform balance unchanged (500)");
    assertEqual(db._store.wallets.platform.transactions.length, 0, "no platform transactions");
    assertEqual(r.wallet.ownerId, VISITED, "credit went to visited owner, not platform");
  });

  await test("7b. Platform wallet type is never 'roaming_credit'", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: {
        [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] },
        platform: { id: "platform", balance: 0, transactions: [] },
      },
    });
    await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    const allTxTypes = [];
    if (db._store.wallets.platform.transactions) {
      db._store.wallets.platform.transactions.forEach((t) => allTxTypes.push(t.type));
    }
    assert(!allTxTypes.includes("roaming_credit"), "no roaming_credit in platform wallet");
  });

  // ---- 8. No modification of existing purchase transactions ----
  console.log("\n--- 8. Existing purchase transactions preserved ---");
  await test("8a. Purchase 'credit' transactions remain unchanged", async () => {
    const purchaseTx = { type: "credit", amount: 500, date: "2025-01-01T00:00:00.000Z", description: "Package sale: test" };
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 500, transactions: [purchaseTx] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assertEqual(r.wallet.transactions[1].type, "credit", "type still 'credit' (not renamed)");
    assertEqual(r.wallet.transactions[1].description, "Package sale: test", "description unchanged");
  });

  await test("8b. Purchase 'commission' transactions in platform wallet unaffected", async () => {
    const commissionTx = { type: "commission", amount: 125, date: "2025-01-01T00:00:00.000Z", description: "Commission from owner-f3" };
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: {
        [VISITED]: { ownerId: VISITED, balance: 500, transactions: [] },
        platform: { id: "platform", balance: 125, transactions: [commissionTx] },
      },
    });
    await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    const tx = db._store.wallets.platform.transactions[0];
    assertEqual(tx.type, commissionTx.type, "platform commission type preserved");
    assertEqual(tx.amount, commissionTx.amount, "platform commission amount preserved");
    assertEqual(tx.description, commissionTx.description, "platform commission description preserved");
  });

  // ---- 9. Cross-owner credit isolation ----
  console.log("\n--- 9. Cross-owner credit isolation ---");
  await test("9a. Credit goes to visitedOwnerId, not homeOwnerId", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: {
        [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] },
        [HOME]: { ownerId: HOME, balance: 0, transactions: [] },
      },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assertEqual(r.wallet.ownerId, VISITED, "credit to visitedOwnerId");
    assertEqual(db._store.wallets[VISITED].balance, 166, "visited wallet credited (166)");
    assertEqual(db._store.wallets[HOME].balance, 0, "home wallet untouched (0)");
    assertEqual(db._store.wallets[HOME].transactions.length, 0, "no transactions on home wallet");
  });

  // ---- 10. Settlement status verification ----
  console.log("\n--- 10. Settlement status verification ---");
  await test("10a. Settlement status transitions to 'credited'", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assertEqual(db._store.roaming_settlements[IDEMPOTENCY_KEY].status, "credited", "status = credited");
    assert(db._store.roaming_settlements[IDEMPOTENCY_KEY].creditedAt, "creditedAt is set");
    assertEqual(db._store.roaming_settlements[IDEMPOTENCY_KEY].creditedTxId, IDEMPOTENCY_KEY, "creditedTxId set");
  });

  await test("10b. Settlement amount is immutable after credit", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement() },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    const s = db._store.roaming_settlements[IDEMPOTENCY_KEY];
    assertEqual(s.settlementAmount, 166, "settlementAmount unchanged after credit");
    assertEqual(s.consumedRaus, 10, "consumedRaus unchanged after credit");
    assertEqual(s.rateNumerator, 1000, "rateNumerator unchanged after credit");
    assertEqual(s.rateDenominator, 60, "rateDenominator unchanged after credit");
    assertEqual(s.homeOwnerId, HOME, "homeOwnerId unchanged after credit");
    assertEqual(s.visitedOwnerId, VISITED, "visitedOwnerId unchanged after credit");
  });

  // ---- 11. Financial integrity unit tests ----
  console.log("\n--- 11. Financial integrity verification ---");
  test("11a. Valid settlement passes integrity", () => {
    const r = verifySettlementFinancialIntegrity(makeSettlement());
    assert(r.valid, "valid settlement passes");
  });

  test("11b. Settlement with float amount fails integrity", () => {
    const r = verifySettlementFinancialIntegrity(makeSettlement({ settlementAmount: 166.5 }));
    assert(!r.valid, "float settlementAmount rejected");
  });

  test("11c. Settlement with negative consumedRaus fails integrity", () => {
    const r = verifySettlementFinancialIntegrity(makeSettlement({ consumedRaus: -5 }));
    assert(!r.valid, "negative consumedRaus rejected");
  });

  // ---- 12. Edge case: large settlement amount ----
  console.log("\n--- 12. Large settlement amount ---");
  await test("12a. Large settlement amount processes correctly", async () => {
    const bigKey = `${ENT}-big:sess-big:T0`;
    const big = makeSettlement({
      id: bigKey,
      idempotencyKey: bigKey,
      entitlementId: `${ENT}-big`,
      sessionId: "sess-big",
      consumedRaus: 3000,
      rateNumerator: 50000,
      rateDenominator: 3000,
      settlementAmount: 50000,
      visitedOwnerId: "v-owner-big",
      visitedHotspotId: "hotspot-big",
    });
    const db = makeFakeDb({
      roaming_settlements: { [bigKey]: big },
      wallets: { "v-owner-big": { ownerId: "v-owner-big", balance: 10000, transactions: [] } },
    });
    const r = await creditRoamingSettlement(bigKey, { db });
    assert(r.credited, "large settlement credited");
    assertEqual(r.wallet.balance, 60000, "10000 + 50000 = 60000");
  });

  // ---- 13. Settlement not found ----
  console.log("\n--- 13. Settlement not found ---");
  await test("13a. Non-existent settlement returns error", async () => {
    const db = makeFakeDb({
      roaming_settlements: {},
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    const r = await creditRoamingSettlement("nonexistent:settlement:key", { db });
    assert(!r.success, "fails for non-existent settlement");
    assertEqual(r.status, "not_found", "status is not_found");
    assertEqual(r.errors.length, 1, "1 error message");
    assert(!r.credited, "not credited");
  });

  // ---- 14. Wrong settlement status ----
  console.log("\n--- 14. Wrong settlement status ---");
  await test("14a. Non-calculated status rejected", async () => {
    const db = makeFakeDb({
      roaming_settlements: { [IDEMPOTENCY_KEY]: makeSettlement({ status: "failed" }) },
      wallets: { [VISITED]: { ownerId: VISITED, balance: 0, transactions: [] } },
    });
    const r = await creditRoamingSettlement(IDEMPOTENCY_KEY, { db });
    assert(!r.success, "failed status rejected");
    assert(!r.credited, "not credited");
  });

  // ---- 15. Idempotency key mismatch ----
  console.log("\n--- 15. Idempotency key mismatch ---");
  test("15a. Document ID != idempotencyKey rejected", () => {
    const r = validateCreditPreconditions(
      makeSettlement({ idempotencyKey: "wrong-key" }),
      IDEMPOTENCY_KEY
    );
    assert(!r.valid, "idempotencyKey mismatch rejected");
    assert(r.errors.some(e => e.includes("idempotencyKey")), "error mentions idempotencyKey");
  });

  console.log("\n========================================");
  console.log("Phase 7.6F.3 Results: " + passed + " passed, " + failed + " failed");
  console.log("========================================");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e && e.stack ? e.stack : e);
  process.exit(1);
});
