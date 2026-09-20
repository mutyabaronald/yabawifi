/**
 * Phase 7.3 — Real-Time RAU Consumption
 *
 * Economic model: 1 connected eligible roaming minute = 1 RAU. A roaming
 * entitlement holds a finite pool of granted RAUs; connected time consumes RAUs
 * and disconnected time does NOT.
 *
 * Design (see phase7-2A-identity-mapping-report.md / Phase 7 planning):
 *  - granted RAUs  = entitlement.quota.maxMinutes  (READ-ONLY, original grant)
 *  - consumed RAUs = entitlement.quota.usedMinutes (server-managed)
 *  - remaining RAUs= entitlement.quota.remainingMinutes (server-managed)
 *  - session-level accounting: roaming_sessions.billedMinutes, lastBilledAt,
 *    rauExhaustedAt (additive; absent on legacy/imported sessions => treated as 0/null)
 *
 * Consumption rule (1 connected minute = 1 RAU, server-computed, never client-supplied):
 *  - billable = floor((billableEnd - billableStart) / 60000), where
 *    billableStart = session.lastBilledAt || session.startedAt  (server timestamps)
 *    billableEnd   = server "now" on a heartbeat, or session.endedAt on disconnect
 *  - consumed = min(billable, remaining)  => never negative, never overspends
 *  - billedMinutes += consumed; lastBilledAt = billableEnd
 *  - a Firestore `runTransaction` reads BOTH session and entitlement and writes
 *    BOTH back atomically => concurrent heartbeats cannot double-count the same
 *    interval and cannot overspend (Firestore aborts/retry on doc conflict).
 *
 * Exhaustion: when remaining reaches 0, the entitlement must stop authorizing
 * (enforced in roamingEntitlementService.checkEntitlementEligibility) and the
 * active session is disconnected via the existing Phase 6
 * `disconnectSessionEnforcement`.
 *
 * Failure isolation: billing failures are logged and non-fatal to the session
 * heartbeat (at-least-once recovery on the next heartbeat: lastBilledAt is only
 * advanced on a successful write, so a lost bill is re-billed). We never let
 * remaining go below 0, so no extra roaming access is granted when accounting
 * cannot be verified.
 *
 * Testability: every Firestore/access boundary is injectable via `deps`,
 * mirroring the Phase 7.2 bridge convention (no Firestore/network needed for
 * tests). Pure helpers are exported for unit testing.
 */

const { db } = require("../firebase");
const { MS_PER_MINUTE } = require("./rauCalculationService");
const { disconnectSessionEnforcement } = require("./roamingEnforcementService");
const { getEntitlement } = require("./roamingEntitlementService");
const { getRoamingSession, ACTIVE_STATUSES, RoamingSessionError } = require("./roamingSessionService");
const { writeSettlementInTransaction } = require("./roamingSettlementService");

const MS_PER_SECOND = 1000;

class RauConsumptionError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "RauConsumptionError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * PURE: whole minutes between two ISO timestamps, floored (Phase 7.1 semantics).
 * Partial minutes are truncated, never rounded up. Returns 0 for <=0 elapsed.
 *
 * @param {string} fromIso
 * @param {string} toIso
 * @returns {number} non-negative integer minutes
 */
function wholeMinutesElapsed(fromIso, toIso) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) return 0;
  if (!(to instanceof Date) || Number.isNaN(to.getTime())) return 0;
  const diffMs = to.getTime() - from.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / MS_PER_MINUTE);
}

/**
 * PURE: apply one billing event to a consumption state.
 *
 * @param {object} state { grantedMinutes, usedMinutes, remainingMinutes, billedMinutes, billableStartIso }
 *        - grantedMinutes = original grant (maxMinutes)
 *        - usedMinutes    = already consumed
 *        - remainingMinutes= currently available
 *        - billedMinutes  = minutes billed for THIS session so far
 *        - billableStartIso = lastBilledAt || startedAt
 * @param {{billableEndIso:string, serverNowIso:string}} opts
 * @returns {{consumed:number, usedMinutes:number, remainingMinutes:number, billedMinutes:number, exhausted:boolean, billable:number}}
 */
function applyBilling(state, { billableEndIso, serverNowIso }) {
  const { grantedMinutes, usedMinutes, remainingMinutes, billedMinutes, billableStartIso } = state;
  const billableEnd = billableEndIso || serverNowIso;
  const billable = wholeMinutesElapsed(billableStartIso, billableEnd);

  let consumed = billable;
  if (consumed > remainingMinutes) {
    consumed = remainingMinutes; // cap: never overspend / never negative
  }
  if (consumed < 0) consumed = 0;

  const newUsed = usedMinutes + consumed;
  let newRemaining = grantedMinutes - newUsed;
  if (newRemaining < 0) newRemaining = 0;

  const newBilled = billedMinutes + consumed;
  const exhausted = newRemaining <= 0 && grantedMinutes > 0;

  return {
    consumed,
    usedMinutes: newUsed,
    remainingMinutes: newRemaining,
    billedMinutes: newBilled,
    exhausted,
    billable,
  };
}

const CONSUMABLE_SESSION_STATUSES = new Set(["authorized", "active"]);

/**
 * Server-side RAU consumption for one connected interval of a roaming session.
 *
 * Triggers: session activity heartbeat (POST /sessions/:id/activity), and the
 * final bill on disconnect/terminate/revoke.
 *
 * @param {object} ctx
 * @param {string} ctx.sessionId
 * @param {{userId?:string,ownerId?:string}} ctx.context  authoritative server context
 * @param {object} [ctx.deps] injectable: { getSession, getEntitlement, runTxn, disconnectSessionEnforcement, serverNowIso }
 * @returns {Promise<{consumed:number, remainingMinutes:number, usedMinutes:number, exhausted:boolean, billed:boolean}>}
 */
async function billConnectedMinutes({ sessionId, context = {}, deps = {} }) {
  const {
    getSession = getRoamingSession,
    getEntitlement: getEntitlementFn = getEntitlement,
    runTxn = defaultRunTxn,
    disconnectSessionEnforcement: disconnectFn = disconnectSessionEnforcement,
    serverNowIso: nowIsoValue = null,
  } = deps;

  // Ownership/context verification is delegated to getSession (it enforces
  // userId/homeOwnerId ownership). We additionally enforce owner context here.
  const serverNow = nowIsoValue || new Date().toISOString();

  let session;
  try {
    session = await getSession(sessionId, {
      userId: context.userId || undefined,
      ownerId: context.ownerId || undefined,
    });
  } catch (err) {
    if (err instanceof RoamingSessionError) throw err;
    throw new RauConsumptionError(500, "SESSION_LOOKUP_FAILED", "Cannot load session for RAU billing");
  }

  // Only bill while the session is actually connected (authorized/active).
  // terminated | expired | revoked => already disconnected: bill nothing.
  if (!CONSUMABLE_SESSION_STATUSES.has(session.status)) {
    return { consumed: 0, remainingMinutes: undefined, usedMinutes: undefined, exhausted: false, billed: false };
  }

  // Only roaming sessions that reference an entitlement consume RAUs.
  // Local/non-roaming sessions have no entitlementId => clean no-op, leaving
  // ordinary local session behavior completely unchanged.
  if (!session.entitlementId) {
    return { consumed: 0, remainingMinutes: undefined, usedMinutes: undefined, exhausted: false, billed: false };
  }

  // Already disconnected/terminated => consume nothing (disconnect stops RAUs).
  if (!CONSUMABLE_SESSION_STATUSES.has(session.status)) {
    return { consumed: 0, remainingMinutes: undefined, usedMinutes: undefined, exhausted: false, billed: false };
  }

  const entitlement = await getEntitlementFn(session.entitlementId);

  // Only active entitlements consume RAUs; suspended/expired/revoked cannot.
  if (entitlement.status !== "active") {
    return { consumed: 0, remainingMinutes: entitlement.quota && entitlement.quota.remainingMinutes, usedMinutes: entitlement.quota && entitlement.quota.usedMinutes, exhausted: false, billed: false };
  }

  const quota = entitlement.quota || {};
  const grantedMinutes = Number(quota.maxMinutes) || 0;
  const usedMinutes = Number(quota.usedMinutes) || 0;
  const remainingMinutes = Number.isFinite(Number(quota.remainingMinutes))
    ? Number(quota.remainingMinutes)
    : grantedMinutes - usedMinutes;

  // If remaining is explicitly tracked and already exhausted, bill nothing.
  if (remainingMinutes <= 0 && grantedMinutes > 0) {
    return { consumed: 0, remainingMinutes: 0, usedMinutes, exhausted: true, billed: false };
  }

  const billableStartIso = session.lastBilledAt || session.startedAt;
  if (!billableStartIso) {
    // Cannot bill without a start anchor; safety guard.
    return { consumed: 0, remainingMinutes, usedMinutes, exhausted: false, billed: false };
  }

  const billableEndIso = serverNow;
  const plan = applyBilling(
    {
      grantedMinutes,
      usedMinutes,
      remainingMinutes,
      billedMinutes: Number(session.billedMinutes) || 0,
      billableStartIso,
    },
    { billableEndIso, serverNowIso: serverNow }
  );

  if (plan.consumed === 0) {
    // No whole minute elapsed since last bill (or no interval to bill).
    return { consumed: 0, remainingMinutes, usedMinutes, exhausted: plan.exhausted, billed: false };
  }

  const result = await runTxn({
    sessionId,
    entitlementId: session.entitlementId,
    context,
    serverNow,
    disconnectSessionEnforcement: disconnectFn,
  });

  return result;
}

async function defaultRunTxn(descriptor) {
  return runConsumptionTxn(db, descriptor);
}

/**
 * Default Firestore txn: atomically deduct RAUs from the entitlement and advance
 * the session's billed cursor. On exhaustion the session is disconnected via the
 * existing enforcement architecture (outside the transaction write, matching the
 * Phase 6 pattern of txn-commit-then-adapter-call).
 *
 * Firestore `runTransaction` automatically aborts & retries on concurrent
 * modification of the read documents => concurrent heartbeats cannot double-bill
 * the same interval and cannot overspend.
 */
async function runConsumptionTxn(db, { sessionId, entitlementId, context, serverNow, disconnectSessionEnforcement: disconnectFn }) {
  const sessionRef = db.collection("roaming_sessions").doc(sessionId);
  const entRef = db.collection("roaming_entitlements").doc(entitlementId);
  let enforcementDisconnected = false;

  const txnResult = await db.runTransaction(async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists) {
      throw new RauConsumptionError(404, "SESSION_NOT_FOUND", "Session not found during RAU billing");
    }
    const session = sessionSnap.data();

    // Re-validate ownership inside the txn (defense in depth).
    if (context.userId && session.userRef && session.userRef.userId !== context.userId) {
      throw new RauConsumptionError(403, "CONTEXT_MISMATCH", "Cannot bill another user's session");
    }
    if (context.ownerId) {
      if (session.homeOwnerId !== context.ownerId && session.visitedOwnerId !== context.ownerId) {
        throw new RauConsumptionError(403, "CONTEXT_MISMATCH", "Cannot bill session for another owner's network");
      }
    }
    // Only bill while connected.
    if (!CONSUMABLE_SESSION_STATUSES.has(session.status)) {
      return { consumed: 0, remainingMinutes: 0, usedMinutes: 0, exhausted: false, billed: false };
    }

    const entSnap = await transaction.get(entRef);
    if (!entSnap.exists) {
      throw new RauConsumptionError(500, "ENTITLEMENT_NOT_FOUND", "Entitlement not found during RAU billing");
    }
    const entitlement = entSnap.data();
    if (entitlement.status !== "active") {
      return { consumed: 0, remainingMinutes: 0, usedMinutes: 0, exhausted: false, billed: false };
    }

    const quota = entitlement.quota || {};
    const grantedMinutes = Number(quota.maxMinutes) || 0;
    const usedMinutes = Number(quota.usedMinutes) || 0;
    let remainingMinutes = Number.isFinite(Number(quota.remainingMinutes))
      ? Number(quota.remainingMinutes)
      : grantedMinutes - usedMinutes;

    if (remainingMinutes <= 0 && grantedMinutes > 0) {
      return { consumed: 0, remainingMinutes: 0, usedMinutes, exhausted: true, billed: false };
    }

    const billableStartIso = session.lastBilledAt || session.startedAt;
    const computed = applyBilling(
      {
        grantedMinutes,
        usedMinutes,
        remainingMinutes,
        billedMinutes: Number(session.billedMinutes) || 0,
        billableStartIso,
      },
      { billableEndIso: serverNow, serverNowIso: serverNow }
    );

    if (computed.consumed === 0) {
      return { consumed: 0, remainingMinutes, usedMinutes, exhausted: computed.exhausted, billed: false };
    }

    const update = {
      quota: {
        maxSessions: quota.maxSessions != null ? quota.maxSessions : null,
        maxMinutes: grantedMinutes, // NEVER overwritten: original grant preserved
        maxMegabytes: quota.maxMegabytes != null ? quota.maxMegabytes : null,
        usedMinutes: usedMinutes + computed.consumed,
        remainingMinutes: computed.remainingMinutes,
      },
      updatedAt: serverNow,
    };
    transaction.set(entRef, update, { merge: true });

    const sessionUpdate = {
      billedMinutes: (Number(session.billedMinutes) || 0) + computed.consumed,
      lastBilledAt: serverNow,
      updatedAt: serverNow,
    };
    if (computed.exhausted) {
      sessionUpdate.rauExhaustedAt = serverNow;
    }
    transaction.set(sessionRef, sessionUpdate, { merge: true });

    // Phase 7.6D: create settlement record for this authoritative billing interval.
    // Atomic with consumption: settlement is committed or rolled back together with
    // the RAU deduction in the SAME Firestore transaction. Non-fatal: if the
    // entitlement lacks a commercial snapshot (legacy/non-roaming entitlement),
    // the settlement is skipped and consumption still commits (can be backfilled).
    let settlementResult = { created: false, idempotent: false, settlement: null, skipped: false, reason: "no_consumption" };
    if (computed.consumed > 0) {
      try {
        settlementResult = await writeSettlementInTransaction({
          transaction,
          firestore: db,
          entitlement: { id: entRef.id, ...entitlement },
          session: { id: sessionRef.id, ...session },
          consumedRaus: computed.consumed,
          billingCursor: serverNow,
        });
      } catch (settlementErr) {
        settlementResult = { created: false, idempotent: false, settlement: null, skipped: true, reason: settlementErr.message };
      }
    }

    return {
      consumed: computed.consumed,
      remainingMinutes: computed.remainingMinutes,
      usedMinutes: usedMinutes + computed.consumed,
      exhausted: computed.exhausted,
      billed: true,
      billable: computed.billable,
      settlement: settlementResult,
    };
  });

  if (txnResult.exhausted && txnResult.billed) {
    // Only disconnect on the transition that actually consumed the last RAUs.
    // (Already-exhausted sessions return billed:false, so we don't re-disconnect
    // on every subsequent heartbeat — disconnectSessionEnforcement is idempotent
    // regardless, this just avoids redundant adapter calls.)
    try {
      await disconnectFn(sessionId, context.userId ? { userId: context.userId } : (context.ownerId ? { ownerId: context.ownerId } : {}));
      enforcementDisconnected = true;
    } catch (disconnectErr) {
      // Non-fatal: the entitlement is now exhausted (remaining=0), so no further
      // roaming access can be authorized via checkEntitlementEligibility. The
      // enforcement disconnect is best-effort; a later connect attempt will be
      // rejected at the eligibility gate.
      console.error("RAU exhaustion: disconnect enforcement failed (non-fatal):", disconnectErr && disconnectErr.message ? disconnectErr.message : disconnectErr);
    }
  }

  return { ...txnResult, enforcementDisconnected };
}

 async function defaultRunTxn(descriptor) {
  return runConsumptionTxn(db, descriptor);
 }

/**
 * Final bill on disconnect/terminate/revoke: bill up to `endedAt` (or server now)
 * and close consumption for this session. Subsequent billing events are no-ops
 * because the session status leaves the consumable set.
 */
async function finalBillOnDisconnect({ sessionId, context = {}, endedAt, deps = {} }) {
  const billableEndIso = endedAt || new Date().toISOString();
  return billConnectedMinutes({
    sessionId,
    context,
    deps: { ...deps, serverNowIso: billableEndIso },
  });
}

module.exports = {
  RauConsumptionError,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  CONSUMABLE_SESSION_STATUSES,
  wholeMinutesElapsed,
  applyBilling,
  runConsumptionTxn,
  billConnectedMinutes,
  finalBillOnDisconnect,
};
