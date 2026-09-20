/**
 * Phase 7.3 — Real-Time RAU Consumption checks.
 *
 * Offline & deterministic (no Firestore / network / auth). Pure helpers
 * (wholeMinutesElapsed, applyBilling) and billConnectedMinutes are exercised
 * with injected fakes that model the Firestore `runTransaction` read-recompute-
 * write contract (including conflict retry) and the eligibility gate.
 *
 * Run: node backend/scripts/check-roaming-phase7-3.js
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
  checkEntitlementEligibility,
} = require("../services/roamingEntitlementService");
const { RoamingSessionError } = require("../services/roamingSessionService");

let passed = 0;
let failed = 0;
function assert(cond, msg) { if (cond) { console.log(`✅ PASS: ${msg}`); passed++; } else { console.error(`❌ FAIL: ${msg}`); failed++; } }
function assertEqual(a, b, m) { const ok = a === b; ok ? (console.log(`✅ PASS: ${m} (${a})`), passed++) : (console.error(`❌ FAIL: ${m} — expected ${b}, got ${a}`), failed++); }

const EPOCH = "2025-01-01T00:00:00.000Z";
function iso(min) { return new Date(new Date(EPOCH).getTime() + min * 60000).toISOString(); }

// ---------------- Fake Firestore + MVCC txn model ----------------
function makeEntitlement(id, { granted, used, remaining, status = "active", scope = "federation", homeOwnerId = "ownerA", userId = "userA" } = {}) {
  return {
    id, userRef: { userId, phone: "+phone" }, homeOwnerId, scope, scopeRefs: {},
    status, validity: { startsAt: "2000-01-01T00:00:00.000Z", expiresAt: "2099-12-31T23:59:59.000Z" },
    quota: { maxSessions: 1, maxMinutes: granted, maxMegabytes: null, usedMinutes: used, remainingMinutes: remaining },
    createdAt: EPOCH, updatedAt: EPOCH,
  };
}
function makeSession(sid, { entitlementId, userId = "userA", homeOwnerId = "ownerA", visitedOwnerId = "ownerB", visitedHotspotId = "hot1", status = "active", startedAt = EPOCH, lastBilledAt = null, billedMinutes = 0 } = {}) {
  return {
    id: sid, userRef: { userId, phone: "+phone", authType: "phone_password" }, homeOwnerId, visitedOwnerId, visitedHotspotId,
    entitlementId, agreementId: "ag", authPath: "ap", status, startedAt,
    lastActivityAt: lastBilledAt || startedAt, usedMinutes: billedMinutes, endedAt: null, endReason: null,
    createdAt: startedAt, updatedAt: startedAt, lastBilledAt: lastBilledAt || null,
  };
}

function makeFakeDb(initialEntitlements = {}, initialSessions = {}) {
  const entStore = { ...initialEntitlements };
  const sesStore = { ...initialSessions };
  const storeFor = (coll) => (coll === "roaming_entitlements" ? entStore : coll === "roaming_sessions" ? sesStore : { __err: true });
  const versions = new Map();
  const bump = (key) => versions.set(key, (versions.get(key) || 0) + 1);

  const db = {
    collection(name) {
      const store = storeFor(name);
      return { doc(id) { return { id, coll: name, _store: store }; } };
    },
    runTransaction(fn) {
      // Minimal MVCC: callback re-reads committed state; if a doc it read
      // changed before commit, abort & retry (up to 3 attempts) => no double-spend.
      return (async () => {
        for (let tryNo = 0; tryNo < 3; tryNo++) {
          const readVersions = new Map();
          const readSet = new Set();
          const staged = new Map();
          const snapshot = (ref) => { readSet.add(`${ref.coll}:${ref.id}`); readVersions.set(`${ref.coll}:${ref.id}`, versions.get(`${ref.coll}:${ref.id}`) || 0); const d = ref._store[ref.id]; return { exists: !!d, data: () => (d ? { ...d } : undefined), id: ref.id }; };
          const tx = { get(ref) { return snapshot(ref); }, set(ref, data, opts) { const prev = ref._store[ref.id] ? { ...ref._store[ref.id] } : {}; staged.set(`${ref.coll}:${ref.id}`, { ref, data: opts && opts.merge ? { ...prev, ...data } : { ...data } }); } };
          const result = await fn(tx);
          let conflict = false;
          for (const key of readSet) { if ((versions.get(key) || 0) !== readVersions.get(key)) { conflict = true; break; } }
          if (conflict && staged.size > 0) { continue; } // retry against fresh state
          for (const [, { ref, data }] of staged) { ref._store[ref.id] = data; bump(`${ref.coll}:${ref.id}`); }
          return result;
        }
        throw new Error("runTransaction: max retries exceeded (conflict)");
      })();
    },
    _ent: entStore, _ses: sesStore,
  };
  return db;
}
function makeConsumptionFakes(db, opts = {}) {
  const disconnectCalls = [];
  const getSession = async (id) => {
    const d = db._ses[id];
    if (!d) throw new RoamingSessionError(404, "NOT_FOUND", "session not found");
    if (opts.userId && d.userRef.userId !== opts.userId) throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Access denied");
    if (opts.ownerId) { if (d.homeOwnerId !== opts.ownerId && d.visitedOwnerId !== opts.ownerId) throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Access denied for this owner"); }
    return d;
  };
  const getEntitlement = async (id) => {
    const d = db._ent[id];
    if (!d) throw new RauConsumptionError(500, "ENTITLEMENT_NOT_FOUND", "ent not found");
    return d;
  };
  const runTxn = (descriptor) => runConsumptionTxn(db, { sessionId: descriptor.sessionId, entitlementId: descriptor.entitlementId, context: descriptor.context, serverNow: descriptor.serverNow, disconnectSessionEnforcement: descriptor.disconnectSessionEnforcement });
  const disconnectSessionEnforcement = opts.disconnectFn || (async () => { disconnectCalls.push(true); });
  return { getSession, getEntitlement, disconnectSessionEnforcement, runTxn, disconnectCalls };
}

async function main() {
  console.log("=== Phase 7.3: Real-Time RAU Consumption Tests ===\n");

  console.log("--- Pure: RAU consumption math (tests 1-8) ---");
  {
    const r = applyBilling({ grantedMinutes: 60, usedMinutes: 0, remainingMinutes: 60, billedMinutes: 0, billableStartIso: EPOCH }, { billableEndIso: iso(20), serverNowIso: iso(20) });
    assertEqual(r.consumed, 20, "60 granted -> 20 consumed -> 40 remaining (consumed=20)");
    assertEqual(r.remainingMinutes, 40, "remaining = 40");
    assertEqual(r.usedMinutes, 20, "used = 20");
  }
  {
    const r = applyBilling({ grantedMinutes: 60, usedMinutes: 20, remainingMinutes: 40, billedMinutes: 20, billableStartIso: iso(20) }, { billableEndIso: iso(20), serverNowIso: iso(20) });
    assertEqual(r.consumed, 0, "disconnect (no elapsed) => 0 consumed");
  }
  {
    const r = applyBilling({ grantedMinutes: 60, usedMinutes: 20, remainingMinutes: 40, billedMinutes: 0, billableStartIso: iso(0) }, { billableEndIso: iso(25), serverNowIso: iso(25) });
    assertEqual(r.consumed, 25, "reconnect bills 25 (resumes from 40, not reset)");
    assertEqual(r.remainingMinutes, 15, "remaining after reconnect = 15");
  }
  {
    let state = { grantedMinutes: 60, usedMinutes: 0, remainingMinutes: 60, billedMinutes: 0, billableStartIso: EPOCH };
    let total = 0; const end = [iso(20), iso(45), iso(60)];
    for (let i = 0; i < 3; i++) {
      const r = applyBilling(state, { billableEndIso: end[i], serverNowIso: end[i] });
      state = { ...state, usedMinutes: r.usedMinutes, remainingMinutes: r.remainingMinutes, billedMinutes: r.billedMinutes, billableStartIso: end[i] };
      total += r.consumed;
      assertEqual(r.remainingMinutes, 60 - total, `after ${total} consumed, remaining = ${60 - total}`);
    }
    assertEqual(total, 60, "20+25+15 consumes exactly 60 RAUs");
    assertEqual(state.remainingMinutes, 0, "final remaining = 0 (exhausted by arithmetic)");
  }
  {
    const r = applyBilling({ grantedMinutes: 60, usedMinutes: 50, remainingMinutes: 10, billedMinutes: 50, billableStartIso: EPOCH }, { billableEndIso: iso(200), serverNowIso: iso(200) });
    assertEqual(r.consumed, 10, "never negative: consumed capped at remaining (10)");
    assertEqual(r.remainingMinutes, 0, "remaining floors at 0 (not -140)");
  }
  {
    const r = applyBilling({ grantedMinutes: 60, usedMinutes: 60, remainingMinutes: 0, billedMinutes: 60, billableStartIso: iso(60) }, { billableEndIso: iso(90), serverNowIso: iso(90) });
    assertEqual(r.consumed, 0, "exhausted entitlement bills 0 (capped safely)");
    assertEqual(r.remainingMinutes, 0, "remaining stays 0");
  }
  {
    const r1 = applyBilling({ grantedMinutes: 60, usedMinutes: 0, remainingMinutes: 60, billedMinutes: 0, billableStartIso: EPOCH }, { billableEndIso: iso(10), serverNowIso: iso(10) });
    assertEqual(r1.consumed, 10, "first bill consumes 10");
    const r2 = applyBilling({ grantedMinutes: 60, usedMinutes: 10, remainingMinutes: 50, billedMinutes: 10, billableStartIso: iso(10) }, { billableEndIso: iso(10), serverNowIso: iso(10) });
    assertEqual(r2.consumed, 0, "duplicate update (same time) consumes 0 (lastBilledAt advanced)");
  }
  assertEqual(wholeMinutesElapsed(EPOCH, new Date(new Date(EPOCH).getTime() + 60 * 1000 - 1).toISOString()), 0, "59:999 -> 0 RAUs (floor)");
  assertEqual(wholeMinutesElapsed(EPOCH, new Date(new Date(EPOCH).getTime() + 60 * 1000).toISOString()), 1, "exactly 1 min -> 1 RAU");

  console.log("\n--- Behavioral: consumption billing (tests 1-4) ---");
  {
    const ent = makeEntitlement("ent1", { granted: 60, used: 0, remaining: 60 });
    const ses = makeSession("ses1", { entitlementId: "ent1" });
    const db = makeFakeDb({ ent1: ent }, { ses1: ses });
    const f = makeConsumptionFakes(db, { userId: "userA" });
    const r = await billConnectedMinutes({ sessionId: "ses1", context: { userId: "userA" }, deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectSessionEnforcement, serverNowIso: iso(20) } });
    assertEqual(r.consumed, 20, "billConnectedMinutes consumes 20 over 20 min");
    assertEqual(r.remainingMinutes, 40, "remaining = 40 after billing");
    assertEqual(db._ent.ent1.quota.usedMinutes, 20, "entitlement.quota.usedMinutes = 20");
    assertEqual(db._ent.ent1.quota.remainingMinutes, 40, "entitlement.quota.remainingMinutes = 40");
    assertEqual(db._ent.ent1.quota.maxMinutes, 60, "entitlement.quota.maxMinutes UNCHANGED (read-only grant)");
    assertEqual(db._ses.ses1.billedMinutes, 20, "session.billedMinutes = 20");
    assertEqual(db._ses.ses1.lastBilledAt, iso(20), "session.lastBilledAt advanced to bill time");
    assert(r.billed, "billing actually wrote (billed=true)");
  }
  {
    const ent = makeEntitlement("ent2", { granted: 60, used: 20, remaining: 40 });
    const ses = makeSession("ses2", { entitlementId: "ent2", status: "terminated", startedAt: iso(0), lastBilledAt: iso(20) });
    const db = makeFakeDb({ ent2: ent }, { ses2: ses });
    const f = makeConsumptionFakes(db, { userId: "userA" });
    const r = await billConnectedMinutes({ sessionId: "ses2", context: { userId: "userA" }, deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectSessionEnforcement, serverNowIso: iso(40) } });
    assertEqual(r.consumed, 0, "terminated session consumes 0 (disconnect stops consumption)");
    assertEqual(db._ent.ent2.quota.remainingMinutes, 40, "remaining unchanged on terminated session");
  }
  {
    const ent = makeEntitlement("ent3", { granted: 60, used: 20, remaining: 40 });
    const sesB = makeSession("sesB", { entitlementId: "ent3", status: "active", startedAt: iso(25), lastBilledAt: null });
    const db = makeFakeDb({ ent3: ent }, { sesB });
    const f = makeConsumptionFakes(db, { userId: "userA" });
    const r = await billConnectedMinutes({ sessionId: "sesB", context: { userId: "userA" }, deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectSessionEnforcement, serverNowIso: iso(50) } });
    assertEqual(r.consumed, 25, "reconnect bills 25 (resumes from 40, not reset to 60)");
    assertEqual(r.remainingMinutes, 15, "remaining = 15 after reconnect session");
    assertEqual(db._ent.ent3.quota.usedMinutes, 45, "used = 20+25 = 45");
    assertEqual(db._ent.ent3.quota.remainingMinutes, 15, "remaining persisted = 15");
  }
  {
    const ent = makeEntitlement("ent4", { granted: 60, used: 0, remaining: 60 });
    const db = makeFakeDb({ ent4: ent }, {});
    const f = makeConsumptionFakes(db, { userId: "userA" });
    const run = async (sid, startMin, endMin) => {
      db._ses[sid] = makeSession(sid, { entitlementId: "ent4", status: "active", startedAt: iso(startMin), lastBilledAt: null });
      return billConnectedMinutes({ sessionId: sid, context: { userId: "userA" }, deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectSessionEnforcement, serverNowIso: iso(endMin) } });
    };
    const a = await run("sA", 0, 20);
    assertEqual(a.consumed, 20, "interval A consumes 20");
    db._ses.sA.status = "terminated";
    const b = await run("sB", 20, 45);
    assertEqual(b.consumed, 25, "interval B consumes 25");
    db._ses.sB.status = "terminated";
    const c = await run("sC", 45, 60);
    assertEqual(c.consumed, 15, "interval C consumes 15");
    assertEqual(db._ent.ent4.quota.usedMinutes, 60, "20+25+15 = 60 consumed");
    assertEqual(db._ent.ent4.quota.remainingMinutes, 0, "remaining = 0 after 20+25+15");
    assert(c.exhausted, "exhausted flag set at zero");
  }

  console.log("\n--- Behavioral: exhaustion gate (test 7) ---");
  {
    const userA = "userA"; const visB = "ownerB";
    const exhausted = makeEntitlement("exp1", { granted: 60, used: 60, remaining: 0, userId: userA, homeOwnerId: "ownerA" });
    const el = await checkEntitlementEligibility({ userId: userA, visitedOwnerId: visB, visitedHotspotId: "hot1" }, { listActiveEntitlements: async () => [exhausted], loadRoamingPartner: async () => ({ federationStatus: "active" }), loadRoamingHotspot: async () => ({ ownerId: visB, partnerStatus: "active" }) });
    assert(!el.eligible, "exhausted entitlement does NOT authorize a session");
    assertEqual(el.reason, "quota_exhausted", "reason = quota_exhausted");
    const good = makeEntitlement("good1", { granted: 60, used: 0, remaining: 60, userId: userA, homeOwnerId: "ownerA" });
    const el2 = await checkEntitlementEligibility({ userId: userA, visitedOwnerId: visB, visitedHotspotId: "hot1" }, { listActiveEntitlements: async () => [good], loadRoamingPartner: async () => ({ federationStatus: "active" }), loadRoamingHotspot: async () => ({ ownerId: visB, partnerStatus: "active" }) });
    assert(el2.eligible, "non-exhausted entitlement authorizes");
    assertEqual(el2.entitlementId, "good1", "authorized entitlement id returned");
  }

  console.log("\n--- Behavioral: duplicate & concurrency (tests 8-9) ---");
  {
    const ent = makeEntitlement("ent8", { granted: 60, used: 0, remaining: 60 });
    const ses = makeSession("ses8", { entitlementId: "ent8", startedAt: iso(0), lastBilledAt: null });
    const db = makeFakeDb({ ent8: ent }, { ses8: ses });
    const f = makeConsumptionFakes(db, { userId: "userA" });
    const d = { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectSessionEnforcement, serverNowIso: iso(10) };
    const r1 = await billConnectedMinutes({ sessionId: "ses8", context: { userId: "userA" }, deps: d });
    assertEqual(r1.consumed, 10, "first bill consumes 10");
    const r2 = await billConnectedMinutes({ sessionId: "ses8", context: { userId: "userA" }, deps: d });
    assertEqual(r2.consumed, 0, "duplicate update (no new elapsed) consumes 0");
    assertEqual(db._ent.ent8.quota.usedMinutes, 10, "no double-count: used stays 10");
  }
  {
    const ent = makeEntitlement("ent9", { granted: 60, used: 0, remaining: 60 });
    const ses = makeSession("ses9", { entitlementId: "ent9", startedAt: iso(0), lastBilledAt: null });
    const db = makeFakeDb({ ent9: ent }, { ses9: ses });
    const f = makeConsumptionFakes(db, { userId: "userA" });
    const sharedDeps = { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectSessionEnforcement, serverNowIso: iso(30) };
    const p1 = billConnectedMinutes({ sessionId: "ses9", context: { userId: "userA" }, deps: sharedDeps });
    const p2 = billConnectedMinutes({ sessionId: "ses9", context: { userId: "userA" }, deps: sharedDeps });
    const [r1, r2] = await Promise.all([p1, p2]);
    const total = r1.consumed + r2.consumed;
    assert(total <= 30, `concurrent same-interval billing never exceeds 30 (got ${total})`);
    assertEqual(db._ent.ent9.quota.remainingMinutes, 60 - total, "remaining = 60 - billed (no overspend)");
    assert(db._ent.ent9.quota.remainingMinutes >= 0, "remaining >= 0 (no negative balance)");
  }
  {
    const ent = makeEntitlement("ent9b", { granted: 60, used: 0, remaining: 60 });
    const db = makeFakeDb({ ent9b: ent }, {});
    const f = makeConsumptionFakes(db, { userId: "userA" });
    const d = { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectSessionEnforcement };
    db._ses.sX = makeSession("sX", { entitlementId: "ent9b", status: "active", startedAt: iso(0), lastBilledAt: null });
    const r1 = await billConnectedMinutes({ sessionId: "sX", context: { userId: "userA" }, deps: { ...d, serverNowIso: iso(30) } });
    db._ses.sX.status = "terminated";
    db._ses.sY = makeSession("sY", { entitlementId: "ent9b", status: "active", startedAt: iso(30), lastBilledAt: null });
    const r2 = await billConnectedMinutes({ sessionId: "sY", context: { userId: "userA" }, deps: { ...d, serverNowIso: iso(60) } });
    assertEqual(r1.consumed + r2.consumed, 60, "two distinct 30-min intervals consume exactly 60");
    assertEqual(db._ent.ent9b.quota.remainingMinutes, 0, "remaining = 0 at end");
  }

  console.log("\n--- Behavioral: client cannot control RAUs / cross-user / local (tests 10-13) ---");
  {
    const consSrc = fs.readFileSync(path.join(__dirname, "..", "services", "roamingRauConsumptionService.js"), "utf8");
    assert(!/rauCount|remainingMinutes\s*:\s*req|usedMinutes\s*:\s*req/i.test(consSrc), "no client RAU/count fields in consumption service");
  }
  {
    const sessSrc = fs.readFileSync(path.join(__dirname, "..", "routes", "roaming", "sessions.js"), "utf8");
    assert(!/req\.body\.rauCount|req\.body\.remainingMinutes|req\.body\.rau/.test(sessSrc), "sessions route does not let client control RAU fields (rauCount/remainingMinutes)");
  }
  {
    const ent = makeEntitlement("ent10", { granted: 60, used: 0, remaining: 60 });
    const ses = makeSession("ses10", { entitlementId: "ent10", startedAt: iso(0), lastBilledAt: null });
    const db = makeFakeDb({ ent10: ent }, { ses10: ses });
    const f = makeConsumptionFakes(db, { userId: "userA" });
    const r = await billConnectedMinutes({ sessionId: "ses10", context: { userId: "userA", rauCount: 9999, remainingMinutes: 1, usedMinutes: 999 }, deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectSessionEnforcement, serverNowIso: iso(5) } });
    assertEqual(r.consumed, 5, "client-supplied rauCount ignored (server computes 5 from time)");
    assertEqual(db._ent.ent10.quota.remainingMinutes, 55, "remaining from server bill (55), not client 1");
  }
  {
    const ent = makeEntitlement("ent11", { granted: 60, used: 0, remaining: 60, userId: "victimU" });
    const ses = makeSession("ses11", { entitlementId: "ent11", userId: "victimU" });
    const db = makeFakeDb({ ent11: ent }, { ses11: ses });
    const f = makeConsumptionFakes(db, { userId: "attackerU" });
    let threw = null;
    try { await billConnectedMinutes({ sessionId: "ses11", context: { userId: "attackerU" }, deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectSessionEnforcement, serverNowIso: iso(10) } }); } catch (e) { threw = e; }
    assert(threw instanceof RoamingSessionError, "cross-user billing rejected (RoamingSessionError)");
    assert(!f.disconnectCalls.length, "no disconnect for cross-user attempt");
    assertEqual(db._ent.ent11.quota.usedMinutes, 0, "victim entitlement untouched (used=0)");
    assertEqual(db._ent.ent11.quota.remainingMinutes, 60, "victim remaining untouched (60)");
  }
  {
    const ent = makeEntitlement("ent12", { granted: 60, used: 0, remaining: 60, homeOwnerId: "ownerA" });
    const ses = makeSession("ses12", { entitlementId: "ent12", homeOwnerId: "ownerA", visitedOwnerId: "ownerB" });
    const db = makeFakeDb({ ent12: ent }, { ses12: ses });
    const f = makeConsumptionFakes(db, { ownerId: "ownerX" });
    let threw = null;
    try { await billConnectedMinutes({ sessionId: "ses12", context: { ownerId: "ownerX" }, deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectSessionEnforcement, serverNowIso: iso(10) } }); } catch (e) { threw = e; }
    assert(threw instanceof RoamingSessionError, "cross-owner billing rejected");
    assertEqual(db._ent.ent12.quota.remainingMinutes, 60, "entitlement remaining unchanged (no client override)");
  }
  {
    const ent = makeEntitlement("ent13", { granted: 60, used: 0, remaining: 60 });
    const ses = { id: "sesLocal", userRef: { userId: "userA", phone: "+phone" }, entitlementId: null, status: "active", startedAt: iso(0), lastBilledAt: null };
    const db = makeFakeDb({ ent13: ent }, { sesLocal: ses });
    const f = makeConsumptionFakes(db, { userId: "userA" });
    const r = await billConnectedMinutes({ sessionId: "sesLocal", context: { userId: "userA" }, deps: { getSession: f.getSession, getEntitlement: f.getEntitlement, runTxn: f.runTxn, disconnectSessionEnforcement: f.disconnectSessionEnforcement, serverNowIso: iso(30) } });
    assertEqual(r.consumed, 0, "session without entitlementId consumes 0 (local behavior unchanged)");
    assertEqual(r.billed, false, "no billing write for non-roaming session");
    assertEqual(db._ent.ent13.quota.remainingMinutes, 60, "no entitlement debited for local session");
  }

  console.log("\n--- Regression: re-run existing check scripts (tests 14-18) ---");
  function rerun(rel) {
    try { execSync(`node ${rel}`, { cwd: path.resolve(__dirname, "..", ".."), stdio: ["pipe", "pipe", "pipe"] }); assert(true, `${rel} PASS (exit 0)`); }
    catch (e) { const out = (e.stdout || e.stderr || "").toString().split("\n").slice(-8).join("\n").trim(); assert(false, `${rel} FAIL — ${out}`); }
  }
  rerun("backend/scripts/check-rau-calculation.js");
  rerun("backend/scripts/check-rau-bridge.js");
  rerun("backend/scripts/check-roaming-bridge-wire.js");
  rerun("backend/scripts/check-roaming-phase3.js");
  rerun("backend/scripts/check-roaming-phase6.js");

  console.log(`\n========================================`);
  console.log(`Phase 7.3 Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error("Test harness crashed:", err && err.stack ? err.stack : err); process.exit(1); });
