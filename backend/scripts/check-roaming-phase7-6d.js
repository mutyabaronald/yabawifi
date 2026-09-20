/**
 * Phase 7.6D — Connect Authoritative RAU Consumption to Roaming Settlement Ledger.
 *
 * Verifies that Phase 7.3 authoritative billing (billConnectedMinutes /
 * finalBillOnDisconnect) produces a corresponding roaming_settlements record
 * with status="calculated". NO wallet credit, NO money movement.
 *
 * Run: node backend/scripts/check-roaming-phase7-6d.js
 */
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const {
  RauConsumptionError,
  wholeMinutesElapsed,
  applyBilling,
  runConsumptionTxn,
  billConnectedMinutes,
  finalBillOnDisconnect,
  CONSUMABLE_SESSION_STATUSES,
} = require("../services/roamingRauConsumptionService");
const {
  SETTLEMENT_STATUS,
  INITIAL_SETTLEMENT_STATUS,
  RoamingSettlementError,
  SETTLEMENT_COLLECTION,
  buildIdempotencyKey,
  calculateSettlementAmount,
  buildSettlement,
  createSettlement,
  writeSettlementInTransaction,
} = require("../services/roamingSettlementService");
const { EntitlementError, validateCommercial } = require("../services/roamingEntitlementService");
const { buildCommercialSnapshot } = require("../services/roamingEntitlementBridgeService");
const { RoamingSessionError } = require("../services/roamingSessionService");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`\u2705 PASS: ${msg}`); passed++; }
  else { console.error(`\u274c FAIL: ${msg}`); failed++; }
}
function assertEqual(a, b, m) {
  const ok = a === b;
  ok ? (console.log(`\u2705 PASS: ${m} (${a})`), passed++) : (console.error(`\u274c FAIL: ${m} \u2014 expected ${b}, got ${a}`), failed++);
}

const EPOCH = "2025-01-01T00:00:00.000Z";
function iso(min) {
  return new Date(new Date(EPOCH).getTime() + min * 60000).toISOString();
}

const HOME = "homeA";
const VISITED = "visitedB";
const HOTSPOT = "hotspotB1";
const USER = "userA";

// --- Fake Firestore with MVCC transaction model (extends Phase 7.3 fake) ---
function makeFakeDb(initial = {}) {
  const stores = {
    roaming_entitlements: { ...(initial.roaming_entitlements || {}) },
    roaming_sessions: { ...(initial.roaming_sessions || {}) },
    roaming_settlements: { ...(initial.roaming_settlements || {}) },
  };

  const versions = new Map();
  const bump = (key) => versions.set(key, (versions.get(key) || 0) + 1);

  const db = {
    collection(name) {
      const store = stores[name] || (stores[name] = {});
      return {
        doc(id) {
          return { id, coll: name, _store: store };
        },
        where: () => ({ get: async () => ({ empty: true, docs: [] }) }),
      };
    },
    runTransaction(fn) {
      return (async () => {
        for (let tryNo = 0; tryNo < 5; tryNo++) {
          const readVersions = new Map();
          const readSet = new Set();
          const staged = new Map();
          const snapshot = (ref) => {
            readSet.add(`${ref.coll}:${ref.id}`);
            readVersions.set(`${ref.coll}:${ref.id}`, versions.get(`${ref.coll}:${ref.id}`) || 0);
            const d = ref._store[ref.id];
            return { exists: !!d, data: () => (d ? { ...d } : undefined), id: ref.id };
          };
          const tx = {
            get(ref) { return snapshot(ref); },
            set(ref, data, opts) {
              const prev = ref._store[ref.id] ? { ...ref._store[ref.id] } : {};
              staged.set(`${ref.coll}:${ref.id}`, {
                ref,
                data: opts && opts.merge ? { ...prev, ...data } : { ...data },
              });
            },
          };
          const result = await fn(tx);
          let conflict = false;
          for (const key of readSet) {
            if ((versions.get(key) || 0) !== readVersions.get(key)) { conflict = true; break; }
          }
          if (conflict && staged.size > 0) { continue; }
          for (const [, { ref, data }] of staged) {
            ref._store[ref.id] = data;
            bump(`${ref.coll}:${ref.id}`);
          }
          return result;
        }
        throw new Error("runTransaction: max retries exceeded (conflict)");
      })();
    },
    _stores: stores,
  };
  return db;
}

function makeFakes(db, opts = {}) {
  const disconnectCalls = [];
  const getSession = async (id) => {
    const d = db._stores["roaming_sessions"][id];
    if (!d) throw new RoamingSessionError(404, "NOT_FOUND", "session not found");
    if (opts.userId && d.userRef && d.userRef.userId !== opts.userId) {
      throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Access denied");
    }
    if (opts.ownerId) {
      if (d.homeOwnerId !== opts.ownerId && d.visitedOwnerId !== opts.ownerId) {
        throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Access denied for this owner");
      }
    }
    return { ...d };
  };
  const getEntitlement = async (id) => {
    const d = db._stores["roaming_entitlements"][id];
    if (!d) throw new RauConsumptionError(500, "ENTITLEMENT_NOT_FOUND", "ent not found");
    return { ...d };
  };
  const runTxn = (descriptor) =>
    runConsumptionTxn(db, {
      sessionId: descriptor.sessionId,
      entitlementId: descriptor.entitlementId,
      context: descriptor.context,
      serverNow: descriptor.serverNow,
      disconnectSessionEnforcement: descriptor.disconnectSessionEnforcement,
    });
  const disconnectFn =
    opts.disconnectFn ||
    (async () => { disconnectCalls.push(true); });
  return { getSession, getEntitlement, runTxn, disconnectFn, disconnectCalls };
}

// --- Test data builders ---
function makeEntitlement(id, opts = {}) {
  const granted = opts.grantedMinutes !== undefined ? opts.grantedMinutes : 60;
  const c = opts.commercialSnapshots
    ? opts.commercialSnapshots
    : buildCommercialSnapshot(
        { id: "pkg", ownerId: HOME, roamingEligible: true, timeLimitMinutes: granted, price: opts.price || 1000 },
        granted
      );
  const used = opts.usedMinutes || 0;
  const remaining = opts.remainingMinutes !== undefined ? opts.remainingMinutes : granted - used;
  return {
    id,
    userRef: { userId: USER, phone: "+1234567890", authType: "phone_password" },
    homeOwnerId: opts.homeOwnerId || HOME,
    visitedOwnerId: opts.visitedOwnerId || undefined,
    scope: opts.scope || "federation",
    scopeRefs: opts.scopeRefs || {},
    status: opts.status || "active",
    validity: opts.validity || { startsAt: EPOCH, expiresAt: "2099-12-31T23:59:59.000Z" },
    quota: {
      maxSessions: 1,
      maxMinutes: granted,
      maxMegabytes: null,
      usedMinutes: used,
      remainingMinutes: remaining,
    },
    commercial: opts.includeCommercial !== false ? c : undefined,
    source: "package",
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}

function makeSession(sid, opts = {}) {
  return {
    id: sid,
    userRef: { userId: USER, phone: "+1234567890", authType: "phone_password" },
    homeOwnerId: opts.homeOwnerId || HOME,
    visitedOwnerId: opts.visitedOwnerId || VISITED,
    visitedHotspotId: opts.visitedHotspotId || HOTSPOT,
    entitlementId: opts.entitlementId,
    agreementId: "ag",
    authPath: "ap",
    status: opts.status || "active",
    startedAt: opts.startedAt || EPOCH,
    lastActivityAt: opts.lastActivityAt || opts.startedAt || EPOCH,
    expiresAt: opts.expiresAt || "2099-12-31T23:59:59.000Z",
    usedMinutes: opts.usedMinutes || 0,
    usedMegabytes: 0,
    endedAt: opts.endedAt || null,
    endReason: opts.endReason || null,
    tokenJti: opts.tokenJti || "jti1",
    idempotencyKey: opts.idempotencyKey || null,
    metadata: {},
    billedMinutes: opts.billedMinutes || 0,
    lastBilledAt: opts.lastBilledAt || null,
    rauExhaustedAt: opts.rauExhaustedAt || null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}

function settlementsIn(db) {
  return Object.values(db._stores[SETTLEMENT_COLLECTION] || {});
}
function settlementCount(db) {
  return Object.keys(db._stores[SETTLEMENT_COLLECTION] || {}).length;
}
function findSettlement(db, key) {
  return db._stores[SETTLEMENT_COLLECTION] && db._stores[SETTLEMENT_COLLECTION][key];
}

async function main() {
  console.log("=== Phase 7.6D: Authoritative RAU Consumption \u2192 Settlement Ledger ===\n");

  // ---- 1-3. Single interval ----
  console.log("--- 1-3. Single interval: 5 billed RAUs \u2192 one settlement ---");
  {
    const ent = makeEntitlement("ent1d", { grantedMinutes: 60, price: 1000 });
    const ses = makeSession("ses1d", {
      entitlementId: "ent1d",
      entitlementId: "ent1d",
      startedAt: EPOCH,
      lastBilledAt: null,
      billedMinutes: 0,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent1d: ent },
      roaming_sessions: { ses1d: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER });
    const result = await billConnectedMinutes({
      sessionId: "ses1d",
      context: { userId: USER },
      deps: {
        getSession: f.getSession,
        getEntitlement: f.getEntitlement,
        runTxn: f.runTxn,
        disconnectSessionEnforcement: f.disconnectFn,
        serverNowIso: iso(5),
      },
    });

    assertEqual(result.consumed, 5, "consumed = 5 RAUs");
    assert(result.billed, "billing was performed");
    assert(result.settlement && result.settlement.created, "settlement was created");
    assertEqual(settlementCount(db), 1, "exactly ONE settlement record");
    const s = result.settlement.settlement;
    assertEqual(s.consumedRaus, 5, "settlement.consumedRaus = 5");
    assertEqual(s.billingCursor, iso(5), "billingCursor = serverNow");
    assertEqual(s.status, "calculated", "status = calculated (NOT credited)");
    assertEqual(s.settlementAmount, calculateSettlementAmount(5, ent.commercial), "settlement amount correct");
    assertEqual(s.homeOwnerId, HOME, "homeOwnerId from entitlement");
    assertEqual(s.visitedOwnerId, VISITED, "visitedOwnerId from session");
    assertEqual(s.visitedHotspotId, HOTSPOT, "visitedHotspotId from session");
    assertEqual(s.entitlementId, "ent1d", "entitlementId correct");
    assertEqual(s.sessionId, "ses1d", "sessionId correct");
    assert(!s.credited, "no credited flag");
  }

  // ---- 4-7. Multiple intervals (5 + 7 + 4 + 4 = 20) ----
  console.log("\n--- 4-7. Multiple intervals: 5 + 7 + 4 + 4 = 20 ---");
  {
    const ent = makeEntitlement("ent2d", { grantedMinutes: 60, price: 1000 });
    const ses = makeSession("ses2d", {
      entitlementId: "ent2d",
      startedAt: EPOCH,
      lastBilledAt: null,
      billedMinutes: 0,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent2d: ent },
      roaming_sessions: { ses2d: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER });

    const cursors = [iso(5), iso(12), iso(16), iso(20)];
    let totalConsumed = 0;

    for (let i = 0; i < cursors.length; i++) {
      const r = await billConnectedMinutes({
        sessionId: "ses2d",
        context: { userId: USER },
        deps: {
          getSession: f.getSession,
          getEntitlement: f.getEntitlement,
          runTxn: f.runTxn,
          disconnectSessionEnforcement: f.disconnectFn,
          serverNowIso: cursors[i],
        },
      });
      totalConsumed += r.consumed;
    }

    assertEqual(totalConsumed, 20, "total consumed = 20 (5+7+4+4)");
    assertEqual(settlementCount(db), 4, "four settlement records created");
    const settlements = settlementsIn(db);
    const consumedValues = settlements.map((s) => s.consumedRaus).sort((a, b) => a - b);
    assertEqual(consumedValues.join(","), "4,4,5,7", "settlements contain {5,7,4,4} RAUs");
    const totalSettledRaus = settlements.reduce((sum, s) => sum + s.consumedRaus, 0);
    assertEqual(totalSettledRaus, 20, "sum of settlement consumedRaus = 20");
    const totalSettledAmount = settlements.reduce((sum, s) => sum + s.settlementAmount, 0);
    assert(totalSettledAmount <= ent.commercial.originalPrice, "sum(settlementAmount) <= originalPrice (historical ceiling)");
    const uniqueCursors = new Set(settlements.map((s) => s.billingCursor));
    assertEqual(uniqueCursors.size, 4, "four distinct billing cursors");
    const uniqueKeys = new Set(settlements.map((s) => s.idempotencyKey));
    assertEqual(uniqueKeys.size, 4, "four distinct idempotency keys");
  }

  // ---- 8-10. Retry: same billing event twice ----
  console.log("\n--- 8-10. Retry: same billing event -> exactly one settlement ---");
  {
    const ent = makeEntitlement("ent3d", { grantedMinutes: 60, price: 1000 });
    const ses = makeSession("ses3d", {
      entitlementId: "ent3d",
      startedAt: EPOCH,
      lastBilledAt: null,
      billedMinutes: 0,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent3d: ent },
      roaming_sessions: { ses3d: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER });

    const deps = {
      getSession: f.getSession,
      getEntitlement: f.getEntitlement,
      runTxn: f.runTxn,
      disconnectSessionEnforcement: f.disconnectFn,
      serverNowIso: iso(5),
    };

    const r1 = await billConnectedMinutes({ sessionId: "ses3d", context: { userId: USER }, deps });
    assert(r1.settlement && r1.settlement.created, "first call creates settlement");

    // Retry with same cursor — should be idempotent
    const r2 = await billConnectedMinutes({ sessionId: "ses3d", context: { userId: USER }, deps });
    assertEqual(r2.consumed, 0, "retry with same cursor: consumed = 0 (already billed)");
    assert(!r2.settlement || r2.settlement.skipped || !r2.settlement.created, "retry does NOT create new settlement");
    assertEqual(settlementCount(db), 1, "still exactly ONE settlement after retry");

    const s = findSettlement(db, "ent3d:ses3d:" + iso(5));
    assert(s, "settlement doc exists at expected idempotency key");
    assertEqual(s.settlementAmount, 83, "settlement amount = floor(5*1000/60) = 83");
  }

  // ---- 11-12. Finalization without duplication ----
  console.log("\n--- 11-12. Final interval settled; termination does not duplicate ---");
  {
    const ent = makeEntitlement("ent4d", { grantedMinutes: 60, price: 1000 });
    const ses = makeSession("ses4d", {
      entitlementId: "ent4d",
      startedAt: EPOCH,
      lastBilledAt: null,
      billedMinutes: 0,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent4d: ent },
      roaming_sessions: { ses4d: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER });

    const deps = {
      getSession: f.getSession,
      getEntitlement: f.getEntitlement,
      runTxn: f.runTxn,
      disconnectSessionEnforcement: f.disconnectFn,
    };

    // Heartbeat 1: T0 -> T7 = 7 RAUs
    const h1 = await billConnectedMinutes({ sessionId: "ses4d", context: { userId: USER }, deps: { ...deps, serverNowIso: iso(7) } });
    assertEqual(h1.consumed, 7, "heartbeat 1 consumes 7");
    assert(h1.settlement && h1.settlement.created, "heartbeat 1 settlement created");

    // Final bill on terminate: T7 -> T9 = 2 RAUs
    const fb = await finalBillOnDisconnect({
      sessionId: "ses4d",
      context: { userId: USER },
      endedAt: iso(9),
      deps: { ...deps, serverNowIso: iso(9) },
    });
    assertEqual(fb.consumed, 2, "final bill consumes 2");
    assert(fb.settlement && fb.settlement.created, "final bill settlement created");

    assertEqual(settlementCount(db), 2, "exactly TWO settlements (7 + 2)");
    const totalRaus = settlementsIn(db).reduce((sum, s) => sum + s.consumedRaus, 0);
    assertEqual(totalRaus, 9, "total settled RAUs = 9 (7 + 2)");
    assert(findSettlement(db, "ent4d:ses4d:" + iso(7)), "settlement at T7 cursor exists");
    assert(findSettlement(db, "ent4d:ses4d:" + iso(9)), "settlement at T9 cursor exists");

    // Calling finalBillOnDisconnect again (session already has lastBilledAt = T9) => 0 consumed
    const fb2 = await finalBillOnDisconnect({
      sessionId: "ses4d",
      context: { userId: USER },
      endedAt: iso(9),
      deps: { ...deps, serverNowIso: iso(9) },
    });
    assertEqual(fb2.consumed, 0, "re-finalize with same cursor: 0 consumed");
    assertEqual(settlementCount(db), 2, "no new settlement on re-finalize (still 2)");
  }

  // ---- 13-15. Exhaustion ----
  console.log("\n--- 13-15. Exhaustion: final RAUs settled, no more after ---");
  {
    const ent = makeEntitlement("ent5d", { grantedMinutes: 10, price: 1000 });
    const ses = makeSession("ses5d", {
      entitlementId: "ent5d",
      startedAt: EPOCH,
      lastBilledAt: null,
      billedMinutes: 0,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent5d: ent },
      roaming_sessions: { ses5d: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER, disconnectFn: f_disconnect });

    function f_disconnect() { return Promise.resolve(); }
    const deps = {
      getSession: f.getSession,
      getEntitlement: f.getEntitlement,
      runTxn: f.runTxn,
      disconnectSessionEnforcement: f.disconnectFn,
    };

    // Bill 5 RAUs (half the entitlement)
    const r1 = await billConnectedMinutes({ sessionId: "ses5d", context: { userId: USER }, deps: { ...deps, serverNowIso: iso(5) } });
    assertEqual(r1.consumed, 5, "first interval consumes 5");
    assert(!r1.exhausted, "not exhausted after 5/10");
    assertEqual(settlementCount(db), 1, "settlement 1 created (5 RAUs)");

    // Bill 5 more (T5 -> T10), total 10 = full grant => exhaustion
    const r2 = await billConnectedMinutes({ sessionId: "ses5d", context: { userId: USER }, deps: { ...deps, serverNowIso: iso(10) } });
    assertEqual(r2.consumed, 5, "second interval consumes 5");
    assert(r2.exhausted, "exhausted after 10/10");
    assertEqual(settlementCount(db), 2, "settlement 2 created (5 RAUs, final before exhaustion)");

    const totalRaus = settlementsIn(db).reduce((sum, s) => sum + s.consumedRaus, 0);
    assertEqual(totalRaus, 10, "total settled RAUs = 10 (= full grant)");

    // Post-exhaustion: should bill 0, create no settlement
    const r3 = await billConnectedMinutes({ sessionId: "ses5d", context: { userId: USER }, deps: { ...deps, serverNowIso: iso(15) } });
    assertEqual(r3.consumed, 0, "post-exhaustion: 0 consumed");
    assertEqual(settlementCount(db), 2, "no settlement created beyond allowance (still 2)");

    // Verify the last settlement has the full originalPrice ceiling
    const totalAmount = settlementsIn(db).reduce((sum, s) => sum + s.settlementAmount, 0);
    assert(totalAmount <= ent.commercial.originalPrice, "sum(settlementAmount) <= originalPrice at exhaustion");
  }

  // ---- 16-18. Ownership correctness ----
  console.log("\n--- 16-18. Ownership: home/visited/hotspot correct ---");
  {
    const ent = makeEntitlement("ent6d", { grantedMinutes: 60, price: 1000, homeOwnerId: "homeX" });
    const ses = makeSession("ses6d", {
      entitlementId: "ent6d",
      homeOwnerId: "homeX",
      visitedOwnerId: "visY",
      visitedHotspotId: "hotZ",
      startedAt: EPOCH,
      lastBilledAt: null,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent6d: ent },
      roaming_sessions: { ses6d: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER });

    const r = await billConnectedMinutes({
      sessionId: "ses6d",
      context: { userId: USER },
      deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectFn, serverNowIso: iso(5) },
    });

    assert(r.billed, "billing performed");
    assert(r.settlement && r.settlement.created, "settlement created");
    const s = r.settlement.settlement;
    assertEqual(s.homeOwnerId, "homeX", "homeOwnerId from entitlement");
    assertEqual(s.visitedOwnerId, "visY", "visitedOwnerId from session");
    assertEqual(s.visitedHotspotId, "hotZ", "visitedHotspotId from session");
  }

  // ---- 19. Cross-owner mismatch rejected ----
  console.log("\n--- 19. Cross-owner mismatch rejected ---");
  {
    const ent = makeEntitlement("ent7d", { grantedMinutes: 60, price: 1000, homeOwnerId: "homeX" });
    const ses = makeSession("ses7d", {
      entitlementId: "ent7d",
      homeOwnerId: "homeX",
      visitedOwnerId: "visY",
      startedAt: EPOCH,
      lastBilledAt: null,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent7d: ent },
      roaming_sessions: { ses7d: { ...ses } },
    });

    // Owner "ownerX" tries to bill a session for homeX/visY
    const f = makeFakes(db, { ownerId: "ownerAttackZ" });
    let threw = false;
    try {
      await billConnectedMinutes({
        sessionId: "ses7d",
        context: { ownerId: "ownerAttackZ" },
        deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectFn, serverNowIso: iso(5) },
      });
    } catch (e) {
      threw = e instanceof RoamingSessionError;
    }
    assert(threw, "cross-owner billing rejected");
    assertEqual(settlementCount(db), 0, "no settlement on cross-owner rejection");
  }

  // ---- 20-21. Historical commercial snapshot ----
  console.log("\n--- 20-21. Historical economics: snapshot rate, not current price ---");
  {
    // Build a commercial snapshot with originalPrice=1000, grantedRaus=60
    const commercial = buildCommercialSnapshot(
      { id: "pkg", ownerId: HOME, roamingEligible: true, timeLimitMinutes: 60, price: 1000 },
      60
    );
    assertEqual(commercial.rateNumerator, 1000, "rateNumerator = originalPrice at snapshot time");
    assertEqual(commercial.rateDenominator, 60, "rateDenominator = grantedRaus at snapshot time");

    const ent = makeEntitlement("ent8d", {
      grantedMinutes: 60,
      commercialSnapshots: commercial,
      includeCommercial: true,
    });
    const ses = makeSession("ses8d", {
      entitlementId: "ent8d",
      startedAt: EPOCH,
      lastBilledAt: null,
      billedMinutes: 0,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent8d: ent },
      roaming_sessions: { ses8d: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER });

    const r = await billConnectedMinutes({
      sessionId: "ses8d",
      context: { userId: USER },
      deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectFn, serverNowIso: iso(10) },
    });

    const s = r.settlement.settlement;
    assertEqual(s.rateNumerator, 1000, "settlement uses snapshot numerator (1000)");
    assertEqual(s.rateDenominator, 60, "settlement uses snapshot denominator (60)");
    assertEqual(s.settlementAmount, 166, "10/60 * 1000 = 166 (floor)");

    // Verify: no "packages" or "receipts" reads for settlement calculation
    const consSrc = fs.readFileSync(path.resolve(__dirname, "..", "services", "roamingSettlementService.js"), "utf8");
    assert(!/packages["']\s*\]/.test(consSrc), "settlement service does NOT read packages collection");
    assert(!/receipts["']\s*\]/.test(consSrc), "settlement service does NOT read receipts collection");
  }

  // ---- 22-28. Financial safety ----
  console.log("\n--- 22-28. Financial safety: no money movement ---");
  {
    const consSrc = fs.readFileSync(path.resolve(__dirname, "..", "services", "roamingRauConsumptionService.js"), "utf8");
    const setSrc = fs.readFileSync(path.resolve(__dirname, "..", "services", "roamingSettlementService.js"), "utf8");
    const sessSrc = fs.readFileSync(path.resolve(__dirname, "..", "routes", "roaming", "sessions.js"), "utf8");
    const allSrc = consSrc + setSrc + sessSrc;

    assert(!/wallets/.test(allSrc), "22: no wallet references");
    assert(!/platform\s*[-\/]?\s*wallet/i.test(allSrc), "23: no platform wallet");
    assert(!/payout/i.test(allSrc), "24: no payout transfers");
    assert(!/mtn|Mtn|MTN|airtel|Airtel|disbursement/.test(allSrc), "25: no payment-provider calls");
    assert(!/serviceFee/i.test(allSrc), "26: no service fee");
    assert(!/withdrawalFee/i.test(allSrc), "27: no withdrawal fee");

    const receipt = fs.readFileSync(path.resolve(__dirname, "..", "..", "backend/routes/receiptRoutes.js"), "utf8");
    const mtn = fs.readFileSync(path.resolve(__dirname, "..", "..", "backend/routes/mtn.js"), "utf8");
    const sup = fs.readFileSync(path.resolve(__dirname, "..", "..", "backend/superRoutes.js"), "utf8");
    assert(/COMMISSION_PERCENTAGE\s*=\s*25/.test(receipt) && /COMMISSION_PERCENTAGE\s*=\s*25/.test(mtn), "28a: 25% commission unchanged in receiptRoutes + mtn");
    assert(/DEFAULT_RATE\s*=\s*25/.test(sup), "28b: DEFAULT_RATE=25 unchanged in superRoutes");
  }

  // ---- No zero-value settlements ----
  console.log("\n--- No zero-value settlement documents ---");
  {
    const ent = makeEntitlement("ent9d", { grantedMinutes: 60, price: 1000 });
    const ses = makeSession("ses9d", {
      entitlementId: "ent9d",
      startedAt: EPOCH,
      lastBilledAt: iso(10),
      billedMinutes: 10,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent9d: ent },
      roaming_sessions: { ses9d: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER });

    // No time elapsed since lastBilledAt (iso(10) -> iso(10)) => consumed = 0
    const r = await billConnectedMinutes({
      sessionId: "ses9d",
      context: { userId: USER },
      deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectFn, serverNowIso: iso(10) },
    });
    assertEqual(r.consumed, 0, "no elapsed time => consumed = 0");
    assert(!r.billed, "not billed (consumed=0)");
    assert(!r.settlement || r.settlement.skipped, "no settlement for zero consumption");
    assertEqual(settlementCount(db), 0, "no zero-value settlement document created");
  }

  // ---- Non-roaming session: no settlement ----
  console.log("\n--- Non-roaming session: no settlement ---");
  {
    const ent = makeEntitlement("ent10d", { grantedMinutes: 60, price: 1000 });
    const ses = makeSession("sesLocal", {
      entitlementId: null,
      startedAt: EPOCH,
      lastBilledAt: null,
      billedMinutes: 0,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent10d: ent },
      roaming_sessions: { sesLocal: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER });

    const r = await billConnectedMinutes({
      sessionId: "sesLocal",
      context: { userId: USER },
      deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectFn, serverNowIso: iso(10) },
    });
    assertEqual(r.consumed, 0, "non-roaming session: 0 consumed");
    assert(!r.billed, "non-roaming session: not billed");
    assertEqual(settlementCount(db), 0, "no settlement for non-roaming (local) session");
  }

  // ---- No commercial snapshot: consumption still commits, settlement skipped ----
  console.log("\n--- Legacy entitlement (no commercial): consumption commits, settlement skipped ---");
  {
    const ent = makeEntitlement("ent11d", { grantedMinutes: 60, price: 1000, includeCommercial: false });
    const ses = makeSession("ses11d", {
      entitlementId: "ent11d",
      startedAt: EPOCH,
      lastBilledAt: null,
      billedMinutes: 0,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent11d: ent },
      roaming_sessions: { ses11d: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER });

    const r = await billConnectedMinutes({
      sessionId: "ses11d",
      context: { userId: USER },
      deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectFn, serverNowIso: iso(5) },
    });
    assertEqual(r.consumed, 5, "consumption still happens (5 RAUs)");
    assert(r.billed, "consumption still commits");
    assert(!r.settlement || r.settlement.skipped || !r.settlement.created, "settlement skipped (no commercial snapshot)");
    assertEqual(settlementCount(db), 0, "no settlement for legacy entitlement");
    // Verify entitlement quota was still updated
    assertEqual(db._stores["roaming_entitlements"].ent11d.quota.usedMinutes, 5, "entitlement usedMinutes updated despite skipped settlement");
  }

  // ---- 14. Consistency check: consumed RAUs vs settlement consumedRaus ----
  console.log("\n--- 14. Consistency: consumed RAUs == sum(settlement.consumedRaus) ---");
  {
    const ent = makeEntitlement("ent12d", { grantedMinutes: 60, price: 1000 });
    const ses = makeSession("ses12d", {
      entitlementId: "ent12d",
      startedAt: EPOCH,
      lastBilledAt: null,
      billedMinutes: 0,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent12d: ent },
      roaming_sessions: { ses12d: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER });

    const deps = { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectFn };

    let totalConsumed = 0;
    // 3 heartbeats: iso(3) -> iso(10) -> iso(15) -> iso(20)
    // Intervals: 3, 7, 5
    const intervals = [iso(3), iso(10), iso(15), iso(20)];
    for (const cursor of intervals) {
      const r = await billConnectedMinutes({ sessionId: "ses12d", context: { userId: USER }, deps: { ...deps, serverNowIso: cursor } });
      totalConsumed += r.consumed;
    }

    const totalSettled = settlementsIn(db).reduce((sum, s) => sum + s.consumedRaus, 0);
    assertEqual(totalConsumed, 20, "authoritative total consumed = 20 (3+7+5+5)");
    assertEqual(totalSettled, 20, "sum of settlement.consumedRaus = 20");
    assertEqual(totalConsumed, totalSettled, "consumed RAUs == sum(settlement.consumedRaus)");

    const totalAmount = settlementsIn(db).reduce((sum, s) => sum + s.settlementAmount, 0);
    assert(totalAmount <= ent.commercial.originalPrice, "sum(settlementAmount) <= originalPrice");
  }

  // ---- Concurrent duplicate attempts ----
  console.log("\n--- Concurrent: same cursor -> one settlement ---");
  {
    const ent = makeEntitlement("ent13d", { grantedMinutes: 60, price: 1000 });
    const ses = makeSession("ses13d", {
      entitlementId: "ent13d",
      startedAt: EPOCH,
      lastBilledAt: null,
      billedMinutes: 0,
    });
    const db = makeFakeDb({
      roaming_entitlements: { ent13d: ent },
      roaming_sessions: { ses13d: { ...ses } },
    });
    const f = makeFakes(db, { userId: USER });

    const deps = {
      getSession: f.getSession,
      getEntitlement: f.getEntitlement,
      runTxn: f.runTxn,
      disconnectSessionEnforcement: f.disconnectFn,
      serverNowIso: iso(5),
    };

    const [r1, r2] = await Promise.all([
      billConnectedMinutes({ sessionId: "ses13d", context: { userId: USER }, deps }),
      billConnectedMinutes({ sessionId: "ses13d", context: { userId: USER }, deps }),
    ]);

    const totalConsumed = r1.consumed + r2.consumed;
    assertEqual(totalConsumed, 5, "concurrent same-cursor: total consumed = 5 (no double-spend)");
    assertEqual(settlementCount(db), 1, "exactly ONE settlement from concurrent attempts");
  }

  // ---- Route-level regression: sessions route still calls billConnectedMinutes ----
  console.log("\n--- Route wiring: sessions.js calls billConnectedMinutes + finalBillOnDisconnect ---");
  {
    const sessSrc = fs.readFileSync(path.resolve(__dirname, "..", "routes", "roaming", "sessions.js"), "utf8");
    assert(/billConnectedMinutes/.test(sessSrc), "sessions route imports billConnectedMinutes");
    assert(/finalBillOnDisconnect/.test(sessSrc), "sessions route imports finalBillOnDisconnect");
    // Settlement is created INSIDE billConnectedMinutes (via writeSettlementInTransaction
    // in the consumption txn), not by a separate route-level call.
    assert(!/await\s+createSettlement/.test(sessSrc), "route does NOT call createSettlement directly (delegated to consumption)");
    assert(!/import.*createSettlement|require.*createSettlement/.test(sessSrc), "route does not import createSettlement (delegated to consumption txn)");
  }

  // ---- Regression: existing phase suites ----
  console.log("\n--- Regression: existing Phase suites ---");
  {
    const scripts = [
      "backend/scripts/check-rau-calculation.js",
      "backend/scripts/check-rau-bridge.js",
      "backend/scripts/check-roaming-phase7-3.js",
      "backend/scripts/check-roaming-phase7-4.js",
      "backend/scripts/check-roaming-phase7-5.js",
      "backend/scripts/check-roaming-phase7-6.js",
      "backend/scripts/check-roaming-phase7-6b.js",
      "backend/scripts/check-roaming-phase7-6c.js",
      "backend/scripts/check-roaming-phase3.js",
      "backend/scripts/check-roaming-phase6.js",
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
  console.log(`Phase 7.6D Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test harness crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
