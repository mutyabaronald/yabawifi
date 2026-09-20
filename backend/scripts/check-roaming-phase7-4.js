/**
 * Phase 7.4 — Customer Roaming Usage & History checks.
 *
 * Offline & deterministic. `getRoamingUsageForPhone` is exercised with a fake
 * Firestore + fake resolveUserIdFromPhone. Read-only view: the service never
 * writes; it derives userId from the phone server-side and scopes all queries
 * to that user.
 *
 * Run: node backend/scripts/check-roaming-phase7-4.js
 */
const path = require("path");
const { execSync } = require("child_process");
const { getRoamingUsageForPhone } = require("../services/roamingUsageService");

let passed = 0;
let failed = 0;
function assert(cond, msg) { if (cond) { console.log(`✅ PASS: ${msg}`); passed++; } else { console.error(`❌ FAIL: ${msg}`); failed++; } }
function assertEqual(a, b, m) { const ok = a === b; ok ? (console.log(`✅ PASS: ${m} (${a})`), passed++) : (console.error(`❌ FAIL: ${m} — expected ${b}, got ${a}`), failed++); }

const EPOCH = "2025-01-01T00:00:00.000Z";
function iso(min) { return new Date(new Date(EPOCH).getTime() + min * 60000).toISOString(); }

// --- Fake Firestore (read-only collections) ---
function makeFakeDb({ entitlements = {}, sessions = [] } = {}) {
  const entStore = { ...entitlements };
  const sesStore = {};
  for (const s of sessions) sesStore[s.id] = s;

  const makeCollection = (store) => {
    const builder = {
      _filter: null,
      _sortField: null,
      _sortDir: "asc",
      _limit: Infinity,
      where(field, op, value) { this._filter = { field, op, value }; return this; },
      orderBy(field, dir) { this._sortField = field; this._sortDir = dir || "asc"; return this; },
      limit(n) { this._limit = n; return this; },
      get() {
        const self = this;
        let docs = Object.values(store);
        if (self._filter) {
          const resolve = (d) => self._filter.field.split(".").reduce((o, p) => o && o[p], d);
          docs = docs.filter((d) => {
            const v = resolve(d);
            if (self._filter.op === "==") return v === self._filter.value;
            if (self._filter.op === "in") return (self._filter.value || []).includes(v);
            return true;
          });
        }
        if (self._sortField) {
          docs = [...docs].sort((a, b) => {
            const av = a[self._sortField], bv = b[self._sortField];
            if (self._sortDir === "desc") return String(bv).localeCompare(String(av));
            return String(av).localeCompare(String(bv));
          });
        }
        docs = docs.slice(0, self._limit);
        return { docs: docs.map((d) => ({ id: d.id, data: () => ({ ...d }) })), size: docs.length };
      },
    };
    return {
      doc(id) {
        const ref = { _store: store, _id: id };
        ref.get = async () => { const d = store[id]; return { exists: !!d, data: () => (d ? { ...d } : undefined), id }; };
        ref.set = async () => ({ merge: () => ({}) });
        ref.update = async () => ({});
        return ref;
      },
      where(field, op, value) { const q = Object.create(builder); q._filter = { field, op, value }; q._sortField = null; q._sortDir = "asc"; q._limit = Infinity; return q; },
    };
  };
  return {
    collection(name) {
      const store = name === "roaming_entitlements" ? entStore : name === "roaming_sessions" ? sesStore : { __err: true };
      return makeCollection(store);
    },
    _ent: entStore,
    _ses: sesStore,
  };
}

function resolveUserIdFromPhoneFake(phoneToUserId) {
  return async (phone) => phoneToUserId[phone] || null;
}

// Build a session doc shape as the service expects it.
function sess({ id, userId, entitlementId, status, startedAt, endedAt, visitedHotspotId, packageName, quota }) {
  return { id, userRef: { userId }, entitlementId, status, startedAt, endedAt, visitedHotspotId, packageName, quota };
}

async function main() {
  console.log("=== Phase 7.4: Customer Roaming Usage & History ===\n");

  const ent = (id, { granted, used, remaining, packageHint = "Roam 1d" }) => ({
    id, quota: { maxMinutes: granted, maxMegabytes: null, maxSessions: 1, usedMinutes: used, remainingMinutes: remaining },
    packageHint,
    status: "active", validity: { startsAt: EPOCH, expiresAt: iso(120) },
  });

  console.log("--- 1. Customer retrieves OWN roaming history ---");
  {
    const phone = "+25600001";
    const userId = "userA";
    const entitlement = ent("ent1", { granted: 60, used: 20, remaining: 40 });
    const s = sess({ id: "ses1", userId, entitlementId: "ent1", status: "terminated", startedAt: iso(0), endedAt: iso(20), visitedHotspotId: "hot1" });
    const fdb = makeFakeDb({ entitlements: { ent1: entitlement }, sessions: [s] });
    const r = await getRoamingUsageForPhone(phone, { resolveUserIdFromPhone: resolveUserIdFromPhoneFake({ [phone]: userId }), db: fdb, nowIso: iso(40) });
    assertEqual(r.userId, userId, "userId resolved server-side from phone");
    assertEqual(r.history.length, 1, "completed session present in history");
    assert(r.history[0].rausConsumed === 20, "RAUs consumed matches authoritative Phase 7.3 (20)");
    assertEqual(r.history[0].rausRemaining, 40, "remaining matches authoritative (40)");
    assertEqual(r.history[0].rausGranted, 60, "granted = 60 (read-only)");
    assertEqual(r.history[0].status, "terminated", "completed session shows terminated");
  }

  console.log("\n--- 2. Customer cannot retrieve ANOTHER customer's history ---");
  {
    const attacker = "+25699999";
    const victim = "+25600001";
    const victimEnt = ent("vent", { granted: 60, used: 20, remaining: 40 });
    const s = sess({ id: "vses", userId: "victimU", entitlementId: "vent", status: "terminated", startedAt: iso(0), endedAt: iso(20), visitedHotspotId: "hot1" });
    const fdb = makeFakeDb({ entitlements: { vent: victimEnt }, sessions: [s] });
    // Attacker's phone resolves to attackerU; only sessions for attackerU are returned.
    const r = await getRoamingUsageForPhone(attacker, { resolveUserIdFromPhone: resolveUserIdFromPhoneFake({ [attacker]: "attackerU" }), db: fdb, nowIso: iso(40) });
    assertEqual(r.history.length, 0, "attacker sees 0 sessions (no cross-user leakage)");
    assert(r.active === null, "attacker sees no active session");
    // Victim still sees their own.
    const rv = await getRoamingUsageForPhone(victim, { resolveUserIdFromPhone: resolveUserIdFromPhoneFake({ [victim]: "victimU" }), db: fdb, nowIso: iso(40) });
    assertEqual(rv.history.length, 1, "victim sees their own history");
  }

  console.log("\n--- 3. userId not client-overridable ---");
  {
    const src = require("fs").readFileSync(path.join(__dirname, "..", "services", "roamingUsageService.js"), "utf8");
    assert(!/req\.params\.userId|req\.body\.userId|req\.query\.userId/.test(src), "roamingUsageService never reads client userId (only phone)");
    const routeSrc = require("fs").readFileSync(path.join(__dirname, "..", "routes", "users.js"), "utf8");
    // The route signature only exposes :phone
    assert(/:\phone\/roaming-usage/.test(routeSrc), "route is /:phone/roaming-usage (no userId param)");
    assert(!/roaming-usage.*userId|userId.*roaming-usage/.test(routeSrc.replace(/getRoamingUsageForPhone/, "")), "route does not forward a client userId");
  }

  console.log("\n--- 4. entitlementId not client-overridable ---");
  {
    const src = require("fs").readFileSync(path.join(__dirname, "..", "services", "roamingUsageService.js"), "utf8");
    assert(!/req\.params\.entitlementId|req\.body\.entitlementId|req\.query\.entitlementId/.test(src), "service does not take client entitlementId; entitlement loaded from session.entitlementId");
  }

  console.log("\n--- 5. Customer sees completed roaming sessions ---");
  {
    const phone = "+25600002";
    const userId = "userB";
    const e = ent("e2", { granted: 120, used: 45, remaining: 75 });
    const s1 = sess({ id: "b1", userId, entitlementId: "e2", status: "terminated", startedAt: iso(0), endedAt: iso(30) });
    const s2 = sess({ id: "b2", userId, entitlementId: "e2", status: "terminated", startedAt: iso(40), endedAt: iso(60) });
    const fdb = makeFakeDb({ entitlements: { e2: e }, sessions: [s1, s2] });
    const r = await getRoamingUsageForPhone(phone, { resolveUserIdFromPhone: resolveUserIdFromPhoneFake({ [phone]: userId }), db: fdb, nowIso: iso(90) });
    assertEqual(r.history.length, 2, "both completed sessions in history");
    assert(r.history.every((h) => h.status === "terminated"), "history entries are completed (terminated)");
  }

  console.log("\n--- 6. Customer sees active roaming session ---");
  {
    const phone = "+25600003";
    const userId = "userC";
    const e = ent("e3", { granted: 60, used: 10, remaining: 50 });
    const s = sess({ id: "c1", userId, entitlementId: "e3", status: "active", startedAt: iso(0), visitedHotspotId: "hotC" });
    const fdb = makeFakeDb({ entitlements: { e3: e }, sessions: [s] });
    const now = iso(15);
    const r = await getRoamingUsageForPhone(phone, { resolveUserIdFromPhone: resolveUserIdFromPhoneFake({ [phone]: userId }), db: fdb, nowIso: now });
    assert(r.active !== null, "active session returned");
    assertEqual(r.active.status, "active", "active status shown");
    assertEqual(r.active.rausRemaining, 50, "active shows authoritative remaining (50)");
    assert(r.active.connectedMinutes >= 15, "active connectedMinutes derived server-side from startedAt (floor)");
  }

  console.log("\n--- 7 & 8. RAUs consumed/remaining match authoritative Phase 7.3 ---");
  {
    const phone = "+25600004";
    const userId = "userD";
    // Entitlement as Phase 7.3 would leave it after billing 20 + 25 = 45.
    const e = ent("e4", { granted: 60, used: 45, remaining: 15 });
    const s = sess({ id: "d1", userId, entitlementId: "e4", status: "terminated", startedAt: iso(0), endedAt: iso(45) });
    const fdb = makeFakeDb({ entitlements: { e4: e }, sessions: [s] });
    const r = await getRoamingUsageForPhone(phone, { resolveUserIdFromPhone: resolveUserIdFromPhoneFake({ [phone]: userId }), db: fdb, nowIso: iso(45) });
    assertEqual(r.history[0].rausConsumed, 45, "consumed = 45 (matches Phase 7.3 usedMinutes)");
    assertEqual(r.history[0].rausRemaining, 15, "remaining = 15 (matches Phase 7.3 remainingMinutes)");
    assertEqual(r.summary.totalRaUsConsumed, 45, "summary totalRaUsConsumed = 45");
  }

  console.log("\n--- 9. Disconnected time not falsely shown as connected ---");
  {
    const phone = "+25600005";
    const userId = "userE";
    const e = ent("e5", { granted: 60, used: 20, remaining: 40 });
    // terminated session with startedAt iso(0), endedAt iso(20) -> connectedMinutes 20, NOT billed-up-to-now.
    const s = sess({ id: "e1", userId, entitlementId: "e5", status: "terminated", startedAt: iso(0), endedAt: iso(20) });
    const fdb = makeFakeDb({ entitlements: { e5: e }, sessions: [s] });
    const r = await getRoamingUsageForPhone(phone, { resolveUserIdFromPhone: resolveUserIdFromPhoneFake({ [phone]: userId }), db: fdb, nowIso: iso(50) });
    assertEqual(r.history[0].connectedMinutes, 20, "disconnected session bills only up to endedAt (20), not to now (50)");
    assert(r.active === null, "disconnected session is not presented as active");
  }

  console.log("\n--- 10. Expired entitlements/sessions remain historically visible ---");
  {
    const phone = "+25600006";
    const userId = "userF";
    const e = { id: "e6", quota: { maxMinutes: 60, maxMegabytes: null, maxSessions: 1, usedMinutes: 60, remainingMinutes: 0 }, packageHint: "Roam 1d", status: "expired", validity: { startsAt: EPOCH, expiresAt: iso(60) } };
    const s = sess({ id: "f1", userId, entitlementId: "e6", status: "terminated", startedAt: iso(0), endedAt: iso(60) });
    const fdb = makeFakeDb({ entitlements: { e6: e }, sessions: [s] });
    const r = await getRoamingUsageForPhone(phone, { resolveUserIdFromPhone: resolveUserIdFromPhoneFake({ [phone]: userId }), db: fdb, nowIso: iso(120) });
    assertEqual(r.history.length, 1, "expired entitlement/session still visible in history");
    assertEqual(r.history[0].rausRemaining, 0, "expired: remaining shown as-is (0)");
    assertEqual(r.history[0].rausGranted, 60, "expired: grant still shown (60)");
  }

  console.log("\n--- 11. Local / non-roaming sessions unchanged ---");
  {
    const src = require("fs").readFileSync(path.join(__dirname, "..", "services", "roamingUsageService.js"), "utf8");
    assert(!/wifi_sessions/.test(src), "roamingUsageService does not touch local wifi_sessions collection");
    const routeSrc = require("fs").readFileSync(path.join(__dirname, "..", "routes", "users.js"), "utf8");
    // Existing local customer routes still present.
    assert(/:\phone\/active-packages/.test(routeSrc), "existing local /:phone/active-packages route preserved");
    assert(/:\phone\/transactions/.test(routeSrc), "existing local /:phone/transactions route preserved");
    // A user with only local sessions (no roaming_sessions) gets empty roaming view.
    const phone = "+25600007";
    const userId = "userG";
    const fdb = makeFakeDb({ entitlements: {}, sessions: [] });
    const r = await getRoamingUsageForPhone(phone, { resolveUserIdFromPhone: resolveUserIdFromPhoneFake({ [phone]: userId }), db: fdb, nowIso: iso(0) });
    assertEqual(r.history.length, 0, "non-roaming user sees empty roaming history (local behavior intact)");
    assert(r.active === null, "non-roaming user: no active roaming session");
  }

  console.log("\n--- 12. Owner / private accounting not exposed ---");
  {
    const phone = "+25600008";
    const userId = "userH";
    const e = { id: "e8", quota: { maxMinutes: 60, maxMegabytes: null, maxSessions: 1, usedMinutes: 20, remainingMinutes: 40 }, packageHint: "Roam 1d", status: "active", validity: { startsAt: EPOCH, expiresAt: iso(120) }, ownerWallet: 999999, settlementBps: 500, payoutAmount: 42 };
    const s = sess({ id: "h1", userId, entitlementId: "e8", status: "terminated", startedAt: iso(0), endedAt: iso(20), visitedHotspotId: "hotH", homeOwnerId: "ownerA" });
    const fdb = makeFakeDb({ entitlements: { e8: e }, sessions: [s] });
    const r = await getRoamingUsageForPhone(phone, { resolveUserIdFromPhone: resolveUserIdFromPhoneFake({ [phone]: userId }), db: fdb, nowIso: iso(40) });
    const blob = JSON.stringify(r);
    assert(!blob.includes("ownerWallet"), "owner wallet not exposed to customer");
    assert(!blob.includes("settlementBps"), "settlement not exposed to customer");
    assert(!blob.includes("payoutAmount"), "payout/settlement not exposed to customer");
    assert(!blob.includes("homeOwnerId"), "homeOwnerId not exposed to customer");
    assert(!blob.includes("visitedOwnerId"), "visitedOwnerId not exposed to customer");
    assert(!blob.includes("price"), "package price not exposed to customer (no monetization view)");
  }

  console.log("\n--- 11b. Read-only: no writes performed ---");
  {
    let writes = 0;
    const phone = "+25600009";
    const userId = "userI";
    const e = ent("e9", { granted: 60, used: 20, remaining: 40 });
    const s = sess({ id: "i1", userId, entitlementId: "e9", status: "active", startedAt: iso(0) });
    const fdb = makeFakeDb({ entitlements: { e9: e }, sessions: [s] });
    // Wrap collection.doc(...).get to detect any set/update/write calls.
    const orig = fdb.collection;
    fdb.collection = function (name) {
      const c = orig.call(this, name);
      const docOrig = c.doc.bind(c);
      c.doc = function (id) {
        const ref = docOrig(id);
        ref.set = async () => { writes++; return { merge: () => ({}) }; };
        ref.update = async () => { writes++; return {}; };
        return ref;
      };
      return c;
    };
    const r = await getRoamingUsageForPhone(phone, { resolveUserIdFromPhone: resolveUserIdFromPhoneFake({ [phone]: userId }), db: fdb, nowIso: iso(10) });
    assertEqual(writes, 0, "roaming-usage is read-only (0 writes)");
    assert(r.active !== null, "read still returns active session");
  }

  console.log("\n--- Regression: re-run existing check scripts ---");
  function rerun(rel) {
    try { execSync(`node ${rel}`, { cwd: path.resolve(__dirname, "..", ".."), stdio: ["pipe", "pipe", "pipe"] }); assert(true, `${rel} PASS (exit 0)`); }
    catch (e) { const out = (e.stdout || e.stderr || "").toString().split("\n").slice(-8).join("\n").trim(); assert(false, `${rel} FAIL — ${out}`); }
  }
  rerun("backend/scripts/check-rau-calculation.js");   // Phase 7.1
  rerun("backend/scripts/check-rau-bridge.js");        // Phase 7.2 / 7.2A
  rerun("backend/scripts/check-roaming-bridge-wire.js"); // Phase 7.2B
  rerun("backend/scripts/check-roaming-phase7-3.js");   // Phase 7.3
  rerun("backend/scripts/check-roaming-phase3.js");     // Phase 3
  rerun("backend/scripts/check-roaming-phase6.js");     // Phase 6

  console.log(`\n========================================`);
  console.log(`Phase 7.4 Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error("Test harness crashed:", err && err.stack ? err.stack : err); process.exit(1); });
