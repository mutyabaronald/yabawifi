/**
 * Phase 7.6F — Roaming Settlement Credit Gateway.
 *
 * Production integration point: triggers wallet credit for a roaming settlement
 * after RAU consumption has committed the settlement with status "calculated".
 *
 * This module is the SINGLE production entry point for converting a roaming
 * settlement into a visited-owner wallet credit. All actual credit logic
 * lives in roamingSettlementCreditService.js.
 *
 * Design:
 * - Non-blocking: credit failures do NOT roll back RAU consumption.
 * - Retry-safe: the credit service itself is idempotent (primary guard:
 *   settlement.status === "calculated" checked atomically in Firestore tx).
 * - Settlement stays "calculated" if credit fails, allowing a later retry.
 * - No HTTP endpoint exposes this directly. Triggered internally after
 *   successful billing, or by a future operational backfill job.
 *
 * Usage:
 *   After billConnectedMinutes returns a result with a settlement:
 *     await triggerSettlementCredit(result.settlement, { db });
 *
 * @param {object} settlementResult — the settlement sub-object from billConnectedMinutes
 * @param {string} settlementResult.id — settlement document ID (idempotency key)
 * @param {boolean} settlementResult.created — whether this call created the settlement
 * @param {boolean} settlementResult.idempotent — whether the settlement already existed
 * @param {object} [deps] — optional: { db } for testing
 * @returns {Promise<{triggered:boolean, creditResult:null|object, error:null|string}>}
 */

const { creditRoamingSettlement } = require("./roamingSettlementCreditService");
const {
  INITIAL_SETTLEMENT_STATUS,
} = require("./roamingSettlementService");

/**
 * Trigger a wallet credit for a settlement that was created/idempotent
 * during RAU consumption billing.
 *
 * Only triggers credit when:
 * - settlement was created (newly) OR is an existing idempotent retry
 * - settlement has a valid ID
 * - settlement did not have an error/skip reason
 *
 * @param {object} settlementResult — from billConnectedMinutes' return
 * @param {string} settlementResult.id — document ID / idempotency key
 * @param {boolean} settlementResult.created
 * @param {boolean} settlementResult.idempotent
 * @param {boolean} settlementResult.skipped — if true, no settlement to credit
 * @param {string} [settlementResult.reason]
 * @param {object} [deps]
 * @returns {Promise<{triggered:boolean, creditResult:null|object, error:null|string}>}
 */
async function triggerSettlementCredit(settlementResult, deps = {}) {
  // If the settlement was skipped (e.g., legacy/no-commercial, or consumed=0),
  // there is no settlement document to credit. This is safe — legacy/non-roaming
  // settlements never generate roaming owner credits.
  if (!settlementResult || settlementResult.skipped) {
    return { triggered: false, creditResult: null, error: null };
  }

  // The settlement object may be nested under settlementResult.settlement
  // (as returned by billConnectedMinutes) or at the top level.
  const settlementObj = settlementResult.settlement || settlementResult;

  // Settlement ID is the document ID (= idempotency key). It must exist
  // for the credit service to load the settlement from Firestore.
  const settlementId = settlementResult.id || settlementObj.id || settlementObj.idempotencyKey;
  if (!settlementId) {
    return { triggered: false, creditResult: null, error: null };
  }

  // Only attempt credit if this billing call created a new settlement
  // or is an idempotent retry (existing settlement re-found).
  if (settlementResult.created === false && settlementResult.idempotent === false) {
    return { triggered: false, creditResult: null, error: null };
  }

  const firestore = deps.db;

  try {
    const creditResult = await creditRoamingSettlement(settlementId, firestore ? { db: firestore } : {});

    return {
      triggered: true,
      creditResult,
      error: creditResult.success ? null : (creditResult.errors || ["credit failed"]).join("; "),
    };
  } catch (err) {
    // Non-fatal: credit failure leaves settlement in "calculated" for retry.
    // RAU consumption has already committed successfully.
    return {
      triggered: false,
      creditResult: null,
      error: err.message || String(err),
    };
  }
}

/**
 * Backfill credit: iterate over settlements with status "calculated"
 * and attempt to credit each. Used by operational recovery jobs.
 *
 * This is a simple sequential scan — for large datasets, a batch/worker
 * pattern would be needed. In scope for this phase: sequential retry of
 * any settlement stuck in "calculated".
 *
 * @param {object} [deps] — { db: firestore, creditFn?: override }
 * @param {number} [limit=1000] — max settlements to scan
 * @returns {Promise<{attempted:number, credited:number, alreadyCredited:number, errors:number, errorDetails:string[]}>}
 */
async function backfillCalculatedSettlements(deps = {}, limit = 1000) {
  const { db: firestore = require("../firebase").db, creditFn = creditRoamingSettlement } = deps;

  const snapshot = await firestore
    .collection("roaming_settlements")
    .where("status", "==", INITIAL_SETTLEMENT_STATUS)
    .limit(limit)
    .get();

  let attempted = 0;
  let credited = 0;
  let alreadyCredited = 0;
  let errors = 0;
  const errorDetails = [];

  for (const doc of snapshot.docs) {
    attempted++;
    try {
      const result = await creditFn(doc.id);
      if (result.credited) {
        credited++;
      } else if (result.skipped) {
        alreadyCredited++;
      } else if (result.success && result.status === "credited" && !result.credited) {
        // Zero-amount settlement: status transitions to "credited" but no wallet write.
        alreadyCredited++;
      }
      if (result.errors && result.errors.length > 0 && !result.credited) {
        errors++;
        errorDetails.push(`settlement ${doc.id}: ${result.errors.join("; ")}`);
      }
    } catch (err) {
      errors++;
      errorDetails.push(`settlement ${doc.id}: ${err.message || String(err)}`);
    }
  }

  return { attempted, credited, alreadyCredited, errors, errorDetails };
}

module.exports = {
  triggerSettlementCredit,
  backfillCalculatedSettlements,
};
