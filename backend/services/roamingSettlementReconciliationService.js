/**
 * Phase 7.6E — Roaming Settlement Reconciliation & Integrity
 *
 * READ-ONLY reconciliation layer that verifies the roaming_settlements ledger
 * agrees with the authoritative Phase 7.3 RAU consumption records.
 *
 * This module NEVER writes, credits, transfers, or modifies any financial
 * record. It only reads Firestore and produces an observational report.
 *
 * Reconciliation invariants verified:
 *   - sum(settlement.consumedRaus) <= session.billedMinutes       (per session)
 *   - sum(settlement.consumedRaus) <= entitlement.quota.usedMinutes (per entitlement)
 *   - settlementAmount == floor(consumedRaus * rateNumerator / rateDenominator)
 *   - sum(settlementAmount) <= entitlement.commercial.originalPrice
 *   - ownership: homeOwnerId from entitlement, visitedOwnerId/hotspotId from session
 *   - idempotency: no duplicate doc IDs, idempotency keys, or entitlement+session+cursor
 *
 * Run: node backend/scripts/check-roaming-phase7-6e.js
 */

const { db: defaultDb } = require("../firebase");
const {
  SETTLEMENT_COLLECTION,
  INITIAL_SETTLEMENT_STATUS,
} = require("./roamingSettlementService");
const { validateCommercial } = require("./roamingEntitlementService");
const { getEntitlement } = require("./roamingEntitlementService");
const { getRoamingSession } = require("./roamingSessionService");

const RECON_STATUS = Object.freeze({
  RECONCILED: "reconciled",
  PARTIAL: "partial",
  SKIPPED: "skipped",
  INVALID: "invalid",
  LEGACY: "legacy_no_commercial",
});

const RECON_COLLECTIONS = Object.freeze({
  SETTLEMENTS: SETTLEMENT_COLLECTION,
  SESSIONS: "roaming_sessions",
  ENTITLEMENTS: "roaming_entitlements",
});

function validateCommercialSafe(commercial) {
  try {
    validateCommercial(commercial);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * PURE: verify that a settlement's monetary amount matches the immutable
 * snapshot formula: settlementAmount == floor(consumedRaus * rateNum / rateDen)
 *
 * @param {{consumedRaus:number, rateNumerator:number, rateDenominator:number, settlementAmount:number}} s
 * @returns {{valid:boolean, expectedAmount:number, actualAmount:number, error?:string}}
 */
function verifySettlementAmount(s) {
  const { consumedRaus, rateNumerator, rateDenominator, settlementAmount } = s;
  if (!Number.isInteger(consumedRaus) || consumedRaus < 0) {
    return { valid: false, expectedAmount: NaN, actualAmount: settlementAmount, error: "consumedRaus must be a non-negative integer" };
  }
  if (!Number.isInteger(rateNumerator) || !Number.isInteger(rateDenominator) || rateDenominator <= 0) {
    return { valid: false, expectedAmount: NaN, actualAmount: settlementAmount, error: "invalid rateNumerator/rateDenominator" };
  }
  if (!Number.isInteger(settlementAmount) || settlementAmount < 0) {
    return { valid: false, expectedAmount: NaN, actualAmount: settlementAmount, error: "settlementAmount must be a non-negative integer" };
  }
  const expectedAmount = Math.floor((consumedRaus * rateNumerator) / rateDenominator);
  const valid = expectedAmount === settlementAmount;
  return {
    valid,
    expectedAmount,
    actualAmount: settlementAmount,
    error: valid ? undefined : `amount mismatch: expected ${expectedAmount}, got ${settlementAmount}`,
  };
}

/**
 * PURE: verify sum(settlementAmount) <= originalPrice for the commercial snapshot.
 */
function verifyEconomicCeiling(settlementAmounts, commercial) {
  const total = settlementAmounts.reduce((sum, a) => sum + (Number.isInteger(a) ? a : 0), 0);
  const ceiling = commercial ? commercial.originalPrice : 0;
  const valid = total <= ceiling;
  return { valid, total, ceiling, error: valid ? undefined : `total settlement amount ${total} exceeds originalPrice ${ceiling}` };
}

/**
 * PURE: verify consumedRaus <= grantedRaus (snapshot level).
 */
function verifyRauCeiling(consumedRaus, commercial) {
  if (!commercial || !Number.isInteger(commercial.grantedRaus)) {
    return { valid: false, error: "missing or invalid commercial.grantedRaus" };
  }
  const valid = consumedRaus <= commercial.grantedRaus;
  return { valid, error: valid ? undefined : `consumedRaus (${consumedRaus}) > grantedRaus (${commercial.grantedRaus})` };
}

/**
 * PURE: verify ownership consistency between settlement, entitlement, and session.
 * - homeOwnerId: must equal entitlement.homeOwnerId
 * - visitedOwnerId: must equal session.visitedOwnerId
 * - visitedHotspotId: must equal session.visitedHotspotId
 * - entitlementId/sessionId: must match the linked docs
 * - session.homeOwnerId: if present, must match entitlement.homeOwnerId (cross-owner guard)
 *
 * @returns {{valid:boolean, mismatches:string[]}}
 */
function verifyOwnership(settlement, entitlement, session) {
  const mismatches = [];

  if (!entitlement) {
    mismatches.push("entitlement missing");
    return { valid: false, mismatches };
  }
  if (!entitlement.homeOwnerId) {
    mismatches.push("entitlement.homeOwnerId missing");
  }
  if (settlement.homeOwnerId !== entitlement.homeOwnerId) {
    mismatches.push(`homeOwnerId mismatch: settlement=${settlement.homeOwnerId}, entitlement=${entitlement.homeOwnerId || "missing"}`);
  }
  if (!session) {
    mismatches.push("session missing");
    return { valid: false, mismatches };
  }
  if (!session.visitedOwnerId) {
    mismatches.push("session.visitedOwnerId missing");
  }
  if (settlement.visitedOwnerId !== session.visitedOwnerId) {
    mismatches.push(`visitedOwnerId mismatch: settlement=${settlement.visitedOwnerId}, session=${session.visitedOwnerId || "missing"}`);
  }
  if (!session.visitedHotspotId) {
    mismatches.push("session.visitedHotspotId missing");
  }
  if (settlement.visitedHotspotId !== session.visitedHotspotId) {
    mismatches.push(`visitedHotspotId mismatch: settlement=${settlement.visitedHotspotId}, session=${session.visitedHotspotId || "missing"}`);
  }
  if (settlement.entitlementId !== entitlement.id) {
    mismatches.push(`entitlementId mismatch: settlement=${settlement.entitlementId}, entitlement=${entitlement.id || "missing"}`);
  }
  if (session.entitlementId && settlement.entitlementId !== session.entitlementId) {
    mismatches.push(`entitlementId/session mismatch: settlement=${settlement.entitlementId}, session=${session.entitlementId}`);
  }
  if (settlement.sessionId !== session.id) {
    mismatches.push(`sessionId mismatch: settlement=${settlement.sessionId}, session=${session.id || "missing"}`);
  }
  if (session.homeOwnerId && entitlement.homeOwnerId && session.homeOwnerId !== entitlement.homeOwnerId) {
    mismatches.push(`session.homeOwnerId (${session.homeOwnerId}) != entitlement.homeOwnerId (${entitlement.homeOwnerId}) — cross-owner contamination`);
  }

  return { valid: mismatches.length === 0, mismatches };
}

/**
 * PURE: compute residual economic value from the historical snapshot.
 * READ-ONLY: no value is transferred or credited.
 *
 * @returns {{remainingRaus, consumedValue, residualTheoretical, residualActual, roundingDiff}}
 */
function computeResidualValue(commercial, consumedRaus) {
  if (!commercial || !validateCommercialSafe(commercial)) {
    return { remainingRaus: 0, consumedValue: 0, residualTheoretical: 0, residualActual: 0, roundingDiff: 0 };
  }
  const remainingRaus = commercial.grantedRaus - consumedRaus;
  if (remainingRaus < 0) {
    return { remainingRaus: 0, consumedValue: 0, residualTheoretical: 0, residualActual: 0, roundingDiff: 0 };
  }
  const consumedValue = Math.floor((consumedRaus * commercial.rateNumerator) / commercial.rateDenominator);
  const residualTheoretical = Math.floor((remainingRaus * commercial.rateNumerator) / commercial.rateDenominator);
  const residualActual = commercial.originalPrice - consumedValue;
  return {
    remainingRaus: remainingRaus,
    consumedValue,
    residualTheoretical,
    residualActual,
    roundingDiff: residualActual - residualTheoretical,
  };
}

/**
 * PURE: validate a single settlement against its entitlement + session.
 * @returns {{valid:boolean, checks:{status:boolean, amount:boolean, rauCeiling:boolean, ownership:boolean}, errors:string[]}}
 */
function validateSettlement(settlement, entitlement, session) {
  const errors = [];

  const statusOk = settlement.status === INITIAL_SETTLEMENT_STATUS;
  if (!statusOk) {
    errors.push(`unexpected status: ${settlement.status} (expected ${INITIAL_SETTLEMENT_STATUS})`);
  }

  const amountCheck = verifySettlementAmount(settlement);
  if (!amountCheck.valid) {
    errors.push(`amount: ${amountCheck.error}`);
  }

  let rauCeiling = true;
  if (entitlement && entitlement.commercial) {
    const rauCheck = verifyRauCeiling(settlement.consumedRaus, entitlement.commercial);
    if (!rauCheck.valid) {
      rauCeiling = false;
      errors.push(`rauCeiling: ${rauCheck.error}`);
    }
  } else {
    rauCeiling = false;
    errors.push("no commercial snapshot for RAU ceiling check");
  }

  const ownership = verifyOwnership(settlement, entitlement, session);
  if (!ownership.valid) {
    errors.push(...ownership.mismatches.map((m) => `ownership: ${m}`));
  }

  return {
    valid: errors.length === 0,
    checks: { status: statusOk, amount: amountCheck.valid, rauCeiling, ownership: ownership.valid },
    errors,
  };
}

/**
 * PURE: detect duplicate settlement identifiers.
 * Checks:
 *   - duplicate Firestore doc IDs (`id`)
 *   - duplicate `idempotencyKey` values
 *   - duplicate composite key (entitlementId + sessionId + billingCursor)
 *
 * @param {Array<{id?, idempotencyKey?, entitlementId?, sessionId?, billingCursor?}>} settlements
 * @returns {{duplicates:{docIds:string[], idempotencyKeys:string[], compositeKeys:string[]}, valid:boolean}}
 */
function validateIdempotency(settlements) {
  const docIds = new Map();
  const idempotencyKeys = new Map();
  const compositeKeys = new Map();
  const dupDocIds = [];
  const dupIdemKeys = [];
  const dupComposite = [];

  for (const s of settlements) {
    const idKey = s.id || null;
    if (idKey) {
      if (docIds.has(idKey)) dupDocIds.push(idKey);
      else docIds.set(idKey, true);
    }

    const iKey = s.idempotencyKey || null;
    if (iKey) {
      if (idempotencyKeys.has(iKey)) dupIdemKeys.push(iKey);
      else idempotencyKeys.set(iKey, true);
    }

    const cKey = [s.entitlementId, s.sessionId, s.billingCursor].filter(Boolean).join(":");
    if (cKey) {
      if (compositeKeys.has(cKey)) dupComposite.push(cKey);
      else compositeKeys.set(cKey, true);
    }
  }

  return {
    duplicates: { docIds: dupDocIds, idempotencyKeys: dupIdemKeys, compositeKeys: dupComposite },
    valid: dupDocIds.length === 0 && dupIdemKeys.length === 0 && dupComposite.length === 0,
  };
}

/**
 * PURE: session-level reconciliation.
 * Exact when sum(consumedRaus) == session.billedMinutes; partial when less.
 * Invalid when settlement RAUs exceed billedMinutes.
 *
 * @returns {{valid:boolean, sessionBilledMinutes:number, settlementRaus:number, exact:boolean, error?:string}}
 */
function validateSessionReconciliation(session, settlements) {
  const sessionBilledMinutes = Number(session.billedMinutes) || 0;
  const settlementRaus = settlements.reduce((sum, s) => sum + (Number(s.consumedRaus) || 0), 0);
  const valid = settlementRaus <= sessionBilledMinutes;
  const exact = settlementRaus === sessionBilledMinutes;
  return {
    valid,
    sessionBilledMinutes,
    settlementRaus,
    exact,
    error: valid
      ? (exact ? undefined : `settled RAUs (${settlementRaus}) < billedMinutes (${sessionBilledMinutes}) — partial`)
      : `settlement RAUs (${settlementRaus}) > session.billedMinutes (${sessionBilledMinutes})`,
  };
}

/**
 * PURE: entitlement-level reconciliation.
 *  - sum(consumedRaus) <= entitlement.quota.usedMinutes
 *  - sum(settlementAmount) <= commercial.originalPrice
 *  - consumedRaus <= grantedRaus
 *  - usedMinutes <= grantedRaus
 *  - remainingMinutes >= 0
 *
 * @returns {{valid:boolean, exact:boolean, entitlementUsedMinutes:number, settlementRaus:number, totalAmount:number, ceiling:number, grantedRaus:number, remainingMinutes:number, errors:string[]}}
 */
function validateEntitlementReconciliation(entitlement, settlements) {
  const errors = [];
  const quota = entitlement.quota || {};
  const entitlementUsedMinutes = Number(quota.usedMinutes) || 0;
  const settlementRaus = settlements.reduce((sum, s) => sum + (Number(s.consumedRaus) || 0), 0);
  const totalAmount = settlements.reduce((sum, s) => sum + (Number(s.settlementAmount) || 0), 0);
  const grantedRaus = entitlement.commercial ? entitlement.commercial.grantedRaus : 0;
  const remainingMinutes = Number.isFinite(Number(quota.remainingMinutes)) ? Number(quota.remainingMinutes) : 0;

  if (settlementRaus > entitlementUsedMinutes) {
    errors.push(`settlement RAUs (${settlementRaus}) > entitlement.quota.usedMinutes (${entitlementUsedMinutes})`);
  }
  if (settlementRaus > grantedRaus) {
    errors.push(`settlement RAUs (${settlementRaus}) > grantedRaus (${grantedRaus})`);
  }
  if (entitlementUsedMinutes > grantedRaus) {
    errors.push(`entitlement usedMinutes (${entitlementUsedMinutes}) > grantedRaus (${grantedRaus})`);
  }
  if (remainingMinutes < 0) {
    errors.push(`negative remainingMinutes: ${remainingMinutes}`);
  }

  if (entitlement.commercial) {
    if (totalAmount > entitlement.commercial.originalPrice) {
      errors.push(`total settlement amount (${totalAmount}) > originalPrice (${entitlement.commercial.originalPrice})`);
    }
  } else {
    errors.push("no commercial snapshot for ceiling check");
  }

  const exact = settlementRaus === entitlementUsedMinutes && entitlement.commercial ? totalAmount <= entitlement.commercial.originalPrice : false;

  return {
    valid: errors.length === 0,
    exact,
    entitlementUsedMinutes,
    settlementRaus,
    totalAmount,
    ceiling: entitlement.commercial ? entitlement.commercial.originalPrice : 0,
    grantedRaus,
    remainingMinutes,
    errors,
  };
}

// ---- Firestore read-only loaders (injectable) ----

async function loadById(collection, id, deps = {}) {
  const db = deps.db || defaultDb;
  const snap = await db.collection(collection).doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function loadSettlementsByEntitlement(entitlementId, deps = {}) {
  const db = deps.db || defaultDb;
  const snap = await db
    .collection(SETTLEMENT_COLLECTION)
    .where("entitlementId", "==", entitlementId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadSettlementsBySession(sessionId, deps = {}) {
  const db = deps.db || defaultDb;
  const snap = await db
    .collection(SETTLEMENT_COLLECTION)
    .where("sessionId", "==", sessionId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadSessionsByEntitlement(entitlementId, deps = {}) {
  const db = deps.db || defaultDb;
  const snap = await db
    .collection(RECON_COLLECTIONS.SESSIONS)
    .where("entitlementId", "==", entitlementId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * ASYNC: Reconcile a single session + its settlements + entitlement (read-only).
 */
async function reconcileSession(sessionId, deps = {}) {
  const entLoader = deps.getEntitlement || getEntitlement;
  const sesLoader = deps.getRoamingSession || getRoamingSession;
  const loadByEnt = deps.loadSettlementsByEntitlement || loadSettlementsByEntitlement;
  const loadBySes = deps.loadSettlementsBySession || loadSettlementsBySession;

  const [session, settlements] = await Promise.all([
    sesLoader(sessionId),
    loadBySes(sessionId, deps),
  ]);

  if (!session.entitlementId) {
    return {
      status: RECON_STATUS.SKIPPED,
      sessionId,
      reason: "session has no entitlementId (local/non-roaming)",
      settlementCount: 0,
      skipped: true,
      checks: null,
    };
  }

  const entitlement = await entLoader(session.entitlementId);
  return _reconcile(entitlement, session, settlements, deps);
}

/**
 * ASYNC: Reconcile all settlements for an entitlement across all linked sessions.
 * Read-only: queries Firestore collections only.
 */
async function reconcileEntitlement(entitlementId, deps = {}) {
  const entLoader = deps.getEntitlement || getEntitlement;
  const sesByEnt = deps.loadSessionsByEntitlement || loadSessionsByEntitlement;
  const loadByEnt = deps.loadSettlementsByEntitlement || loadSettlementsByEntitlement;

  const [entitlement, sessions, settlements] = await Promise.all([
    entLoader(entitlementId),
    sesByEnt(entitlementId, deps),
    loadByEnt(entitlementId, deps),
  ]);

  const sessionMap = new Map(sessions.map((s) => [s.id, { ...s }]));

  const sessionResults = Array.from(sessionMap.values()).map((session) => {
    const sesSettlements = settlements.filter((s) => s.sessionId === session.id);
    return _reconcile(entitlement, session, sesSettlements, deps);
  });

  const noEntitlementSettlements = settlements.filter((s) => !sessionMap.has(s.sessionId));

  const entitlementResult = _reconcileEntitlementLevel(entitlement, settlements);

  const anyInvalid =
    sessionResults.some((r) => r.status === RECON_STATUS.INVALID) ||
    noEntitlementSettlements.length > 0 ||
    !entitlementResult.valid;

  const anyPartial =
    !anyInvalid &&
    (sessionResults.some((r) => r.status === RECON_STATUS.PARTIAL) || !entitlementResult.exact);

  const allReconciled =
    !anyInvalid &&
    !anyPartial &&
    sessionResults.every((r) => r.status === RECON_STATUS.RECONCILED) &&
    entitlementResult.valid &&
    entitlementResult.exact &&
    noEntitlementSettlements.length === 0;

  let status;
  if (!entitlement.commercial) {
    status = RECON_STATUS.LEGACY;
  } else if (allReconciled) {
    status = RECON_STATUS.RECONCILED;
  } else if (anyInvalid) {
    status = RECON_STATUS.INVALID;
  } else {
    status = RECON_STATUS.PARTIAL;
  }

  return {
    status,
    entitlementId,
    settlementCount: settlements.length,
    sessionCount: sessionMap.size,
    orphanedSettlements: noEntitlementSettlements.map((s) => s.idempotencyKey || s.id || s.billingCursor),
    perSession: sessionResults,
    entitlementLevel: entitlementResult,
  };
}

function _reconcile(entitlement, session, settlements, deps) {
  if (!entitlement.commercial) {
    return {
      status: RECON_STATUS.LEGACY,
      entitlementId: entitlement.id,
      sessionId: session.id,
      reason: "entitlement has no commercial snapshot (legacy/non-roaming)",
      settlementCount: settlements.length,
      skipped: true,
      checks: null,
    };
  }

  const idem = validateIdempotency(settlements);

  const perSettlement = settlements.map((s) => {
    let v;
    try {
      v = validateSettlement(s, entitlement, session);
    } catch (e) {
      v = { valid: false, checks: {}, errors: [e.message] };
    }
    return {
      id: s.id || s.idempotencyKey,
      valid: v.valid,
      checks: v.checks,
      errors: v.errors,
    };
  });

  const sessionReconciliation = validateSessionReconciliation(session, settlements);
  const entitlementReconciliation = validateEntitlementReconciliation(entitlement, settlements);
  const ceilingCheck = verifyEconomicCeiling(
    settlements.map((s) => s.settlementAmount),
    entitlement.commercial
  );

  const consumedRausTotal = settlements.reduce((sum, s) => sum + (Number(s.consumedRaus) || 0), 0);
  const residual = computeResidualValue(entitlement.commercial, consumedRausTotal);

  const allValid =
    idem.valid &&
    sessionReconciliation.valid &&
    entitlementReconciliation.valid &&
    ceilingCheck.valid &&
    perSettlement.every((p) => p.valid);

  let status;
  if (!allValid) {
    status = RECON_STATUS.INVALID;
  } else if (sessionReconciliation.exact && entitlementReconciliation.exact) {
    status = RECON_STATUS.RECONCILED;
  } else {
    status = RECON_STATUS.PARTIAL;
  }

  return {
    status,
    entitlementId: entitlement.id,
    sessionId: session.id,
    skipped: false,
    settlementCount: settlements.length,
    checks: {
      idempotency: idem,
      sessionReconciliation,
      entitlementReconciliation,
      economicCeiling: ceilingCheck,
      perSettlement: perSettlement.map((p) => ({
        id: p.id,
        valid: p.valid,
        checks: p.checks,
        errors: p.errors,
      })),
      residual,
    },
    errors: [
      ...(idem.valid ? [] : [`idempotency: ${JSON.stringify(idem.duplicates)}`]),
      ...(sessionReconciliation.valid ? [] : [sessionReconciliation.error]),
      ...(entitlementReconciliation.errors || []).map((e) => `entitlement: ${e}`),
      ...(ceilingCheck.valid ? [] : [ceilingCheck.error]),
      ...perSettlement.filter((p) => !p.valid).flatMap((p) => p.errors || []),
    ],
  };
}

function _reconcileEntitlementLevel(entitlement, settlements) {
  if (!entitlement.commercial) {
    return { valid: false, exact: false, errors: ["legacy: no commercial snapshot"], ceiling: 0, totalAmount: 0 };
  }
  return validateEntitlementReconciliation(entitlement, settlements);
}

module.exports = {
  RECON_STATUS,
  RECON_COLLECTIONS,
  INITIAL_SETTLEMENT_STATUS,
  verifySettlementAmount,
  verifyEconomicCeiling,
  verifyRauCeiling,
  verifyOwnership,
  computeResidualValue,
  validateSettlement,
  validateIdempotency,
  validateSessionReconciliation,
  validateEntitlementReconciliation,
  loadSettlementsByEntitlement,
  loadSettlementsBySession,
  loadSessionsByEntitlement,
  loadById,
  reconcileSession,
  reconcileEntitlement,
};
