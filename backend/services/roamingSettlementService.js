const {
  computeRauSettlementValue,
  validateCommercial,
  getEntitlement,
} = require("./roamingEntitlementService");
const { getRoamingSession } = require("./roamingSessionService");
const { v4: uuidv4 } = require("uuid");
const { db: defaultDb } = require("../firebase");

const SETTLEMENT_COLLECTION = "roaming_settlements";

const SETTLEMENT_STATUS = Object.freeze([
  "calculated",
  "pending_credit",
  "credited",
  "failed",
]);

const INITIAL_SETTLEMENT_STATUS = "calculated";

class RoamingSettlementError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function buildIdempotencyKey({ entitlementId, sessionId, billingCursor }) {
  if (!entitlementId || typeof entitlementId !== "string") {
    throw new RoamingSettlementError(400, "VALIDATION_ERROR", "entitlementId is required for idempotency key");
  }
  if (!sessionId || typeof sessionId !== "string") {
    throw new RoamingSettlementError(400, "VALIDATION_ERROR", "sessionId is required for idempotency key");
  }
  if (!billingCursor || typeof billingCursor !== "string") {
    throw new RoamingSettlementError(400, "VALIDATION_ERROR", "billingCursor (lastBilledAt) is required for idempotency key");
  }
  return `${entitlementId}:${sessionId}:${billingCursor}`;
}

function calculateSettlementAmount(consumedRaus, commercial) {
  if (!commercial || typeof commercial !== "object") {
    throw new RoamingSettlementError(400, "VALIDATION_ERROR", "commercial snapshot is required");
  }
  validateCommercial(commercial);
  const consumed = Number(consumedRaus);
  if (!Number.isInteger(consumed) || consumed < 0) {
    throw new RoamingSettlementError(400, "VALIDATION_ERROR", "consumedRaus must be a non-negative integer");
  }
  if (consumed > commercial.grantedRaus) {
    throw new RoamingSettlementError(
      400,
      "VALIDATION_ERROR",
      `consumedRaus (${consumed}) cannot exceed grantedRaus (${commercial.grantedRaus})`
    );
  }
  return computeRauSettlementValue(consumed, commercial);
}

function validateSettlementInput({ entitlement, session, consumedRaus, billingCursor }) {
  if (!entitlement) {
    throw new RoamingSettlementError(404, "NOT_FOUND", "entitlement not found");
  }
  if (!session) {
    throw new RoamingSettlementError(404, "NOT_FOUND", "session not found");
  }
  if (!entitlement.commercial || typeof entitlement.commercial !== "object") {
    throw new RoamingSettlementError(400, "VALIDATION_ERROR", "entitlement missing commercial snapshot");
  }
  validateCommercial(entitlement.commercial);

  const consumed = Number(consumedRaus);
  if (!Number.isInteger(consumed) || consumed < 0) {
    throw new RoamingSettlementError(400, "VALIDATION_ERROR", "consumedRaus must be a non-negative integer");
  }
  if (consumed > entitlement.commercial.grantedRaus) {
    throw new RoamingSettlementError(
      400,
      "VALIDATION_ERROR",
      `consumedRaus (${consumed}) cannot exceed grantedRaus (${entitlement.commercial.grantedRaus})`
    );
  }

  if (!entitlement.homeOwnerId || typeof entitlement.homeOwnerId !== "string") {
    throw new RoamingSettlementError(400, "VALIDATION_ERROR", "entitlement.homeOwnerId is required");
  }
  const visitedOwnerId = session.visitedOwnerId;
  if (!visitedOwnerId || typeof visitedOwnerId !== "string") {
    throw new RoamingSettlementError(400, "VALIDATION_ERROR", "session.visitedOwnerId is required");
  }
  const visitedHotspotId = session.visitedHotspotId;
  if (!visitedHotspotId || typeof visitedHotspotId !== "string") {
    throw new RoamingSettlementError(400, "VALIDATION_ERROR", "session.visitedHotspotId is required");
  }

  if (session.entitlementId && session.entitlementId !== entitlement.id) {
    throw new RoamingSettlementError(
      403,
      "OWNERSHIP_MISMATCH",
      "session does not belong to the specified entitlement"
    );
  }

  const cursor = billingCursor || session.lastBilledAt;
  return {
    homeOwnerId: entitlement.homeOwnerId,
    visitedOwnerId,
    visitedHotspotId,
    billingCursor: cursor,
    rateNumerator: entitlement.commercial.rateNumerator,
    rateDenominator: entitlement.commercial.rateDenominator,
    grantedRaus: entitlement.commercial.grantedRaus,
  };
}

function buildSettlement({ entitlement, session, consumedRaus, billingCursor }) {
  const derived = validateSettlementInput({ entitlement, session, consumedRaus, billingCursor });
  const idempotencyKey = buildIdempotencyKey({
    entitlementId: entitlement.id,
    sessionId: session.id,
    billingCursor: derived.billingCursor,
  });
  const settlementAmount = calculateSettlementAmount(consumedRaus, entitlement.commercial);
  return {
    id: idempotencyKey,
    idempotencyKey,
    entitlementId: entitlement.id,
    sessionId: session.id,
    homeOwnerId: derived.homeOwnerId,
    visitedOwnerId: derived.visitedOwnerId,
    visitedHotspotId: derived.visitedHotspotId,
    consumedRaus: Number(consumedRaus),
    rateNumerator: derived.rateNumerator,
    rateDenominator: derived.rateDenominator,
    settlementAmount,
    billingCursor: derived.billingCursor,
    status: INITIAL_SETTLEMENT_STATUS,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

async function createSettlement({
  entitlementId,
  sessionId,
  consumedRaus,
  billingCursor,
  idempotencyKey: idempotencyKeyOverride,
  deps = {},
}) {
  const getEntitlementFn = deps.getEntitlement || getEntitlement;
  const getSessionFn = deps.getRoamingSession || ((id) => getRoamingSession(id));
  const firestore = deps.db || defaultDb;

  const [entitlement, session] = await Promise.all([
    getEntitlementFn(entitlementId),
    getSessionFn(sessionId),
  ]);

  const record = buildSettlement({ entitlement, session, consumedRaus, billingCursor });
  const key = idempotencyKeyOverride || record.idempotencyKey;

  let result;
  await firestore.runTransaction(async (transaction) => {
    const ref = firestore.collection(SETTLEMENT_COLLECTION).doc(key);
    const existing = await transaction.get(ref);
    if (existing.exists) {
      const data = existing.data ? existing.data() : { ...existing };
      result = { settlement: { id: key, ...data }, created: false, idempotent: true };
      return;
    }
    transaction.set(ref, record);
    result = { settlement: record, created: true, idempotent: false };
  });

  return result;
}

/**
 * Write a settlement record inside an EXISTING Firestore transaction.
 *
 * Phase 7.6D integration: pairs authoritative Phase 7.3 RAU consumption
 * with settlement creation in a single atomic commit. Either both the
 * consumption update and the settlement record persist, or neither does.
 *
 * Non-fatal semantics: if buildSettlement throws (e.g. entitlement has no
 * commercial snapshot — legacy/non-roaming entitlements), this returns
 * { skipped: true } so the caller's consumption commit is unaffected.
 * The settlement can be backfilled by a reconciliation job scanning
 * un-billed billing intervals.
 *
 * Idempotency: uses the same exists-guard as createSettlement — a retry
 * of the same billing interval (same idempotency key) resolves to the
 * existing record instead of creating a duplicate.
 *
 * NO money movement: the settlement remains status="calculated".
 *
 * @param {{transaction, firestore, entitlement, session, consumedRaus, billingCursor}} opts
 * @returns {Promise<{created, idempotent, settlement, skipped, reason?}>}
 */
async function writeSettlementInTransaction({ transaction, firestore, entitlement, session, consumedRaus, billingCursor }) {
  let record;
  try {
    record = buildSettlement({ entitlement, session, consumedRaus, billingCursor });
  } catch (e) {
    return { created: false, idempotent: false, settlement: null, skipped: true, reason: e.message };
  }
  const key = record.idempotencyKey;
  const ref = firestore.collection(SETTLEMENT_COLLECTION).doc(key);
  const existing = await transaction.get(ref);
  if (existing.exists) {
    const data = existing.data ? existing.data() : { ...existing };
    return { created: false, idempotent: true, settlement: { id: key, ...data }, skipped: false };
  }
  transaction.set(ref, record);
  return { created: true, idempotent: false, settlement: record, skipped: false };
}

function handleError(res, err) {
  if (err instanceof RoamingSettlementError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }
  console.error("[roaming-settlement] unexpected error:", err);
  return res.status(500).json({
    success: false,
    error: "internal_error",
    message: err && err.message ? err.message : "Internal server error",
  });
}

module.exports = {
  SETTLEMENT_STATUS,
  INITIAL_SETTLEMENT_STATUS,
  RoamingSettlementError,
  SETTLEMENT_COLLECTION,
  buildIdempotencyKey,
  calculateSettlementAmount,
  validateSettlementInput,
  buildSettlement,
  createSettlement,
  writeSettlementInTransaction,
  handleError,
};
