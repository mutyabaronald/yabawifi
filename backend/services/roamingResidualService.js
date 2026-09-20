/**
 * Phase 7.7 — Unused RAU Expiry Retention
 *
 * When a roaming entitlement reaches its validity.expiresAt and still has
 * unused RAUs, the unused economic value remains with YabaLink. This service
 * creates an immutable accounting record in `roaming_residuals`.
 *
 * NO wallet modification occurs in this service. No platform wallet, no
 * owner wallet, no payout, no payment. The retained value is represented
 * ONLY by the roaming_residuals ledger record.
 *
 * Concurrency model: the Firestore transaction IS the boundary. The
 * entitlement document (read inside the same transaction) gates both
 * residual creation and the status transition to "expired". After the
 * transaction commits, the Phase 7.3 consumption engine rejects further
 * RAU consumption because entitlement.status !== "active".
 */

const { validateCommercial, computeRauSettlementValue } = require("./roamingEntitlementService");
const { db: defaultDb } = require("../firebase");

const RESIDUAL_COLLECTION = "roaming_residuals";
const ENTITLEMENT_COLLECTION = "roaming_entitlements";

const RESIDUAL_STATUS = Object.freeze({
  PENDING: "pending",
  FINALIZED: "finalized",
  SKIPPED: "skipped",
});

const FINAL_RESIDUAL_STATUSES = ["finalized", "skipped"];

function nowIso() {
  return new Date().toISOString();
}

function buildIdempotencyKey(entitlementId) {
  if (!entitlementId || typeof entitlementId !== "string") {
    throw new Error("entitlementId is required for residual idempotency key");
  }
  return `${entitlementId}:residual`;
}

function validateCommercialSafe(commercial) {
  try {
    validateCommercial(commercial);
    return true;
  } catch (_) {
    return false;
  }
}

function validateQuotaForResidual(quota) {
  const errors = [];
  if (!quota || typeof quota !== "object") {
    return { valid: false, errors: ["quota is required"] };
  }

  const maxMinutes = Number(quota.maxMinutes);
  const usedMinutes = Number(quota.usedMinutes);
  const remainingInput = quota.remainingMinutes;
  const remainingMinutes = Number.isFinite(Number(remainingInput))
    ? Number(remainingInput)
    : (Number.isInteger(maxMinutes) && Number.isInteger(usedMinutes)
      ? maxMinutes - usedMinutes
      : NaN);

  if (!Number.isInteger(maxMinutes) || maxMinutes < 0) {
    errors.push(`quota.maxMinutes must be a non-negative integer, got ${quota.maxMinutes}`);
  }
  if (!Number.isInteger(usedMinutes) || usedMinutes < 0) {
    errors.push(`quota.usedMinutes must be a non-negative integer, got ${quota.usedMinutes}`);
  }
  if (!Number.isInteger(remainingMinutes) || remainingMinutes < 0) {
    errors.push(`quota.remainingMinutes must be a non-negative integer, got ${remainingInput}`);
  }
  if (Number.isInteger(remainingMinutes) && Number.isInteger(maxMinutes) && remainingMinutes > maxMinutes) {
    errors.push(`remainingMinutes (${remainingMinutes}) exceeds maxMinutes (${maxMinutes})`);
  }

  return {
    valid: errors.length === 0,
    errors,
    values: { maxMinutes, usedMinutes, remainingMinutes },
  };
}

function classifyEligibility(entitlement, nowIsoValue) {
  if (!entitlement) {
    return { eligible: false, reason: "entitlement is null" };
  }

  if (entitlement.status === "revoked") {
    return { eligible: false, reason: "revoked entitlements are out of scope for residual processing" };
  }

  if (entitlement.status !== "active" && entitlement.status !== "expired") {
    return { eligible: false, reason: `entitlement status '${entitlement.status}' is not eligible for expiry processing` };
  }

  const validity = entitlement.validity || {};
  const expiresAt = validity.expiresAt;
  if (!expiresAt || typeof expiresAt !== "string") {
    return { eligible: false, reason: "entitlement has no validity.expiresAt" };
  }

  const expired = new Date(expiresAt).getTime() <= new Date(nowIsoValue).getTime();
  if (!expired) {
    return { eligible: false, reason: `entitlement expiresAt (${expiresAt}) is in the future` };
  }

  return { eligible: true, reason: null };
}

async function finalizeEntitlementResidual(entitlementId, deps = {}) {
  const firestore = deps.db || defaultDb;
  const nowIsoValue = deps.nowIso || nowIso();

  try {
    const txResult = await firestore.runTransaction(async (transaction) => {
      const entitlementRef = firestore.collection(ENTITLEMENT_COLLECTION).doc(entitlementId);
      const entitlementSnap = await transaction.get(entitlementRef);

      if (!entitlementSnap.exists) {
        return {
          success: false,
          status: "not_found",
          finalized: false,
          idempotent: false,
          skipped: true,
          retainedAmount: 0,
          errors: [`entitlement ${entitlementId} not found`],
          residual: null,
          entitlement: null,
        };
      }

      const entitlement = entitlementSnap.data
        ? { id: entitlementSnap.id, ...entitlementSnap.data() }
        : { id: entitlementSnap.id };

      const eligibility = classifyEligibility(entitlement, nowIsoValue);
      if (!eligibility.eligible) {
        return {
          success: true,
          status: "not_eligible",
          finalized: false,
          idempotent: true,
          skipped: true,
          retainedAmount: 0,
          errors: eligibility.reason ? [eligibility.reason] : [],
          residual: null,
          entitlement,
        };
      }

      const quota = entitlement.quota || {};
      const quotaValidation = validateQuotaForResidual(quota);
      const { maxMinutes, usedMinutes, remainingMinutes } = quotaValidation.values;

      const commercial = entitlement.commercial || null;
      const commercialValid = validateCommercialSafe(commercial);

      let retainedAmount;
      let outcomeStatus;
      let errors = [];
      let consumedRaus;
      let remainingRaus;
      let grantedRaus;

      const validForComputation =
        quotaValidation.valid &&
        commercialValid &&
        Number.isInteger(remainingMinutes) &&
        remainingMinutes >= 0 &&
        Number.isInteger(maxMinutes) &&
        maxMinutes > 0;

      if (validForComputation) {
        grantedRaus = commercial.grantedRaus;
        remainingRaus = remainingMinutes;
        consumedRaus = grantedRaus - remainingRaus;
        retainedAmount = computeRauSettlementValue(remainingRaus, commercial);
        outcomeStatus = RESIDUAL_STATUS.FINALIZED;
      } else {
        if (!quotaValidation.valid) {
          errors = [...quotaValidation.errors];
        }
        if (!commercialValid) {
          errors = [...errors, "commercial snapshot is invalid or missing"];
        }
        if (Number.isInteger(remainingMinutes) && remainingMinutes < 0) {
          errors = [...errors, `remainingMinutes is negative (${remainingMinutes}) — not clamped`];
        }
        if (
          Number.isInteger(remainingMinutes) &&
          Number.isInteger(maxMinutes) &&
          remainingMinutes > maxMinutes
        ) {
          errors = [...errors, `remainingMinutes (${remainingMinutes}) exceeds maxMinutes (${maxMinutes})`];
        }

        grantedRaus = commercialValid ? commercial.grantedRaus : (Number.isInteger(maxMinutes) ? maxMinutes : 0);
        remainingRaus = Number.isInteger(remainingMinutes) ? remainingMinutes : 0;
        consumedRaus = Number.isInteger(grantedRaus) && Number.isInteger(remainingRaus)
          ? grantedRaus - remainingRaus
          : 0;
        retainedAmount = 0;
        outcomeStatus = RESIDUAL_STATUS.SKIPPED;
      }

      const residualId = buildIdempotencyKey(entitlementId);
      const residualRef = firestore.collection(RESIDUAL_COLLECTION).doc(residualId);
      const residualSnap = await transaction.get(residualRef);

      if (residualSnap.exists) {
        const existingData = residualSnap.data
          ? residualSnap.data()
          : {};
        if (FINAL_RESIDUAL_STATUSES.includes(existingData.status)) {
          return {
            success: true,
            status: existingData.status,
            finalized: false,
            idempotent: true,
            skipped: existingData.status === RESIDUAL_STATUS.SKIPPED,
            retainedAmount: existingData.retainedAmount || 0,
            errors: [],
            residual: { id: residualId, idempotencyKey: residualId, ...existingData },
            entitlement,
          };
        }
      }

      const createdAt =
        (residualSnap.exists && residualSnap.data && residualSnap.data().createdAt) ||
        nowIsoValue;

      const residual = {
        id: residualId,
        idempotencyKey: residualId,
        entitlementId,
        userId: entitlement.userRef ? entitlement.userRef.userId : null,
        homeOwnerId: entitlement.homeOwnerId || null,
        commercial: commercialValid ? { ...commercial } : null,
        quota: {
          maxMinutes,
          usedMinutes,
          remainingMinutes: Number.isInteger(remainingMinutes) ? remainingMinutes : null,
        },
        consumedRaus,
        remainingRaus,
        retainedAmount,
        status: outcomeStatus,
        skipped: outcomeStatus === RESIDUAL_STATUS.SKIPPED,
        errors,
        createdAt,
        finalizedAt: nowIsoValue,
      };

      transaction.set(residualRef, residual);

      if (entitlement.status === "active") {
        transaction.update(entitlementRef, {
          status: "expired",
          updatedAt: nowIsoValue,
        });
      }

      return {
        success: true,
        status: outcomeStatus,
        finalized: outcomeStatus === RESIDUAL_STATUS.FINALIZED,
        idempotent: false,
        skipped: outcomeStatus === RESIDUAL_STATUS.SKIPPED,
        retainedAmount,
        errors,
        residual: { ...residual },
        entitlement: {
          id: entitlement.id,
          status: "expired",
          quota: { maxMinutes, usedMinutes, remainingMinutes },
          commercial: commercialValid ? { ...commercial } : null,
        },
      };
    });

    return txResult;
  } catch (err) {
    return {
      success: false,
      status: "error",
      finalized: false,
      idempotent: false,
      skipped: false,
      retainedAmount: 0,
      errors: [err.message || String(err)],
      residual: null,
      entitlement: null,
    };
  }
}

module.exports = {
  RESIDUAL_COLLECTION,
  RESIDUAL_STATUS,
  FINAL_RESIDUAL_STATUSES,
  buildIdempotencyKey,
  validateCommercialSafe,
  validateQuotaForResidual,
  classifyEligibility,
  finalizeEntitlementResidual,
};
