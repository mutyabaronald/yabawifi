/**
 * Phase 7.4 — Customer roaming usage & history (read-only view).
 *
 * Authoritative data source: Phase 7.3's `roaming_sessions` + `roaming_entitlements`.
 *   granted  = entitlement.quota.maxMinutes      (read-only original grant)
 *   consumed = entitlement.quota.usedMinutes      (Phase 7.3 server-billed)
 *   remaining= entitlement.quota.remainingMinutes (Phase 7.3 server-managed)
 *
 * Security: the customer's canonical userId is resolved SERVER-SIDE from their
 * phone via `resolveUserIdFromPhone`; the client never supplies userId,
 * entitlementId, sessionId, homeOwnerId, visitedOwnerId, or RAU values. All
 * session lookups are scoped to the resolved userId. Owner identifiers are
 * intentionally NOT projected to the customer (no private accounting; no other
 * customers' data). This is a READ-ONLY view — it performs no writes.
 *
 * Testability: Firestore + identity helpers are injectable via `deps`, so tests
 * run offline with fakes (no network / no real Firestore).
 */

const { db } = require("../firebase");
const { resolveUserIdFromPhone } = require("./roamingEntitlementBridgeService");
const {
  wholeMinutesElapsed,
  CONSUMABLE_SESSION_STATUSES,
} = require("./roamingRauConsumptionService");

const SESSION_LIMIT = 100;

/**
 * Build a read-only customer roaming usage view for a phone.
 * @param {string} phone  customer's phone (the app's customer identity convention)
 * @param {object} [deps] { resolveUserIdFromPhone, db, nowIso }
 * @returns {Promise<{phone:string,userId:string|null,active:object|null,history:array,summary:object}>}
 */
async function getRoamingUsageForPhone(phone, deps = {}) {
  const resolveUser = deps.resolveUserIdFromPhone || resolveUserIdFromPhone;
  const firestore = deps.db || db;
  const nowIso = deps.nowIso || new Date().toISOString();

  if (!phone) {
    return { phone: phone || null, userId: null, active: null, history: [], summary: { totalSessions: 0, totalRaUsConsumed: 0, activeCount: 0 } };
  }

  // Authoritative identity — server-side only.
  const userId = await resolveUser(phone);
  if (!userId) {
    return { phone, userId: null, active: null, history: [], summary: { totalSessions: 0, totalRaUsConsumed: 0, activeCount: 0 } };
  }

  // Scoped to THIS user. History preserved regardless of expiry/status.
  const sessionsSnap = await firestore
    .collection("roaming_sessions")
    .where("userRef.userId", "==", userId)
    .orderBy("startedAt", "desc")
    .limit(SESSION_LIMIT)
    .get();

  const active = [];
  const history = [];
  let totalRaUsConsumed = 0;

  for (const doc of sessionsSnap.docs) {
    const s = doc.data();
    const entitlement = s.entitlementId
      ? await firestore.collection("roaming_entitlements").doc(s.entitlementId).get().then((d) => (d.exists ? d.data() : null))
      : null;
    const quota = (entitlement && entitlement.quota) || {};
    const rausGranted = quota.maxMinutes != null ? Number(quota.maxMinutes) : null;
    const rausConsumed = quota.usedMinutes != null ? Number(quota.usedMinutes) : null;
    const rausRemaining = quota.remainingMinutes != null ? Number(quota.remainingMinutes) : null;

    const stillConnected = CONSUMABLE_SESSION_STATUSES.has(s.status);
    const endIso = s.endedAt || (stillConnected ? nowIso : null);
    const connectedMinutes = endIso ? wholeMinutesElapsed(s.startedAt, endIso) : 0;

    // Owner identifiers deliberately omitted (no private accounting exposed).
    const rec = {
      sessionId: doc.id,
      entitlementId: s.entitlementId || null,
      packageName: (entitlement && (entitlement.packageHint || entitlement.packageName)) || s.packageName || "Roaming Access",
      hotspotId: s.visitedHotspotId || null,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt || null,
      connectedMinutes,
      rausConsumed,
      rausRemaining,
      rausGranted,
    };

    if (rausConsumed != null) totalRaUsConsumed += rausConsumed;
    if (stillConnected) active.push(rec);
    else history.push(rec);
  }

  return {
    phone,
    userId,
    active: active.length ? active[0] : null,
    history,
    summary: {
      totalSessions: sessionsSnap.size,
      totalRaUsConsumed,
      activeCount: active.length,
    },
  };
}

module.exports = { getRoamingUsageForPhone };
