/**
 * Phase 7.6F — Roaming Settlement Credit Service.
 *
 * Converts a valid, reconciled roaming settlement from:
 *   status = "calculated"
 * to:
 *   status = "credited"
 *
 * while atomically crediting the visited-owner's wallet
 * (wallets/{settlement.visitedOwnerId}) with exactly
 * settlement.settlementAmount.
 *
 * Design principles:
 * - The settlement document is the authoritative financial state machine.
 * - Settlement.status === "calculated" is the PRIMARY idempotency guard.
 * - Wallet transaction referenceId is a SECONDARY audit-only check.
 * - The wallet transaction array (capped at 100 entries) is never the
 *   primary idempotency mechanism.
 * - ONE Firestore runTransaction for atomic wallet credit + status update.
 * - NO purchase commission, NO fees, NO MTN/Airtel disbursement, NO
 *   platform wallet modification. Pure visited-owner credit.
 * - Financial integrity is verified from the settlement's own stored
 *   historical values (consumedRaus, rateNumerator, rateDenominator,
 *   settlementAmount) — NOT from any current package or client input.
 */

const { db: defaultDb } = require("../firebase");
const {
  SETTLEMENT_COLLECTION,
  SETTLEMENT_STATUS,
  INITIAL_SETTLEMENT_STATUS,
  RoamingSettlementError,
  calculateSettlementAmount,
  validateSettlementInput,
} = require("./roamingSettlementService");
const { validateCommercial } = require("./roamingEntitlementService");

const WALLET_COLLECTION = "wallets";

/**
 * Verify the financial/monetary integrity of a settlement record using
 * only the values stored ON the settlement itself (historical snapshot).
 *
 * @param {object} s — settlement document data
 * @returns {{valid:boolean, errors:string[]}}
 */
function verifySettlementFinancialIntegrity(s) {
  const errors = [];

  if (!Number.isInteger(s.consumedRaus) || s.consumedRaus < 0) {
    errors.push(`consumedRaus must be a non-negative integer (got ${s.consumedRaus})`);
  }
  if (!Number.isInteger(s.rateNumerator) || s.rateNumerator < 0) {
    errors.push(`rateNumerator must be a non-negative integer (got ${s.rateNumerator})`);
  }
  if (!Number.isInteger(s.rateDenominator) || s.rateDenominator <= 0) {
    errors.push(`rateDenominator must be a positive integer (got ${s.rateDenominator})`);
  }
  if (!Number.isInteger(s.settlementAmount) || s.settlementAmount < 0) {
    errors.push(`settlementAmount must be a non-negative integer (got ${s.settlementAmount})`);
  }

  if (Number.isInteger(s.consumedRaus) && s.consumedRaus >= 0
      && Number.isInteger(s.rateNumerator) && s.rateNumerator >= 0
      && Number.isInteger(s.rateDenominator) && s.rateDenominator > 0
      && Number.isInteger(s.settlementAmount) && s.settlementAmount >= 0) {
    const expected = Math.floor((s.consumedRaus * s.rateNumerator) / s.rateDenominator);
    if (expected !== s.settlementAmount) {
      errors.push(`monetary mismatch: expected ${expected}, got ${s.settlementAmount}`);
    }
    if (s.settlementAmount > s.rateNumerator) {
      errors.push(`settlementAmount (${s.settlementAmount}) exceeds package value (rateNumerator ${s.rateNumerator})`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Verify that a settlement document ID equals its idempotencyKey.
 * This prevents a settlement from being credited via a mismatched key.
 *
 * @param {object} s — settlement document data
 * @param {string} settlementId — the document ID passed to the function
 * @returns {{valid:boolean, errors:string[]}}
 */
function verifyIdempotencyKeyMatches(s, settlementId) {
  const errors = [];
  if (!s.idempotencyKey) {
    errors.push("settlement.idempotencyKey is missing");
  } else if (s.idempotencyKey !== settlementId) {
    errors.push(`idempotencyKey (${s.idempotencyKey}) does not match document ID (${settlementId})`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate all preconditions for crediting a settlement.
 *
 * @param {object} s — settlement document data
 * @param {string} settlementId — the document ID
 * @returns {{valid:boolean, errors:string[], skipped:boolean}}
 */
function validateCreditPreconditions(s, settlementId) {
  const errors = [];
  let skipped = false;

  if (!s) {
    return { valid: false, errors: ["settlement not found"], skipped: false };
  }

  const keyCheck = verifyIdempotencyKeyMatches(s, settlementId);
  errors.push(...keyCheck.errors);

  if (s.status !== INITIAL_SETTLEMENT_STATUS) {
    if (s.status === "credited") {
      skipped = true;
    } else {
      errors.push(`settlement status is '${s.status}', expected '${INITIAL_SETTLEMENT_STATUS}'`);
    }
  }

  if (!s.visitedOwnerId || typeof s.visitedOwnerId !== "string") {
    errors.push("settlement.visitedOwnerId is missing or invalid");
  }
  if (!s.entitlementId) errors.push("settlement.entitlementId is missing");
  if (!s.sessionId) errors.push("settlement.sessionId is missing");
  if (!s.billingCursor) errors.push("settlement.billingCursor is missing");

  const integrity = verifySettlementFinancialIntegrity(s);
  errors.push(...integrity.errors);

  return { valid: errors.length === 0, errors, skipped };
}

/**
 * Credit a valid roaming settlement to the visited owner's wallet.
 *
 * Exactly-once semantics:
 * - Primary guard: settlement.status === "calculated" (checked in transaction)
 * - Secondary guard: wallet.transactions has no entry with referenceId === idempotencyKey
 * - Both checks + writes occur in a single Firestore runTransaction
 *
 * Zero-amount settlements are NOT credited (no empty wallet transaction).
 * Their status transitions to "credited" without a wallet write, with
 * creditedAt set for audit trail. This is deterministic and safe.
 *
 * @param {string} settlementId — the roaming_settlements document ID
 * @param {object} [deps={}] — dependency injection
 * @param {object} [deps.db] — Firestore instance (defaults to production db)
 * @returns {Promise<{success:boolean, status:string, credited:boolean, amount:number, skipped:boolean, errors:string[], settlement:null|object, wallet:null|object}>}
 */
async function creditRoamingSettlement(settlementId, deps = {}) {
  const firestore = deps.db || defaultDb;

  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const settlementRef = firestore.collection(SETTLEMENT_COLLECTION).doc(settlementId);
      const snap = await transaction.get(settlementRef);

      if (!snap.exists) {
        return {
          success: false,
          status: "not_found",
          credited: false,
          skipped: false,
          amount: 0,
          errors: [`settlement ${settlementId} not found`],
          settlement: null,
          wallet: null,
        };
      }

      const settlement = { id: snap.id, ...snap.data() };

      const preconditions = validateCreditPreconditions(settlement, settlementId);
      if (preconditions.skipped) {
        return {
          success: true,
          status: "credited",
          credited: false,
          skipped: true,
          amount: 0,
          errors: [],
          settlement,
          wallet: null,
        };
      }
      if (!preconditions.valid) {
        return {
          success: false,
          status: settlement.status || "invalid",
          credited: false,
          skipped: false,
          amount: 0,
          errors: preconditions.errors,
          settlement,
          wallet: null,
        };
      }

      if (settlement.settlementAmount === 0) {
        transaction.update(settlementRef, {
          status: "credited",
          creditedAt: new Date().toISOString(),
          creditedTxId: null,
        });
        return {
          success: true,
          status: "credited",
          credited: false,
          skipped: false,
          amount: 0,
          errors: [],
          settlement: { ...settlement, status: "credited" },
          wallet: null,
        };
      }

      const walletRef = firestore.collection(WALLET_COLLECTION).doc(settlement.visitedOwnerId);
      const walletSnap = await transaction.get(walletRef);

      let walletData;
      if (walletSnap.exists) {
        walletData = walletSnap.data();
      } else {
        walletData = { ownerId: settlement.visitedOwnerId, balance: 0, transactions: [] };
      }

      const existingTx = (walletData.transactions || []).find(
        (t) => t.referenceId === settlement.idempotencyKey
      );
      if (existingTx) {
        return {
          success: true,
          status: "credited",
          credited: false,
          skipped: true,
          amount: settlement.settlementAmount,
          errors: [],
          settlement,
          wallet: { ...walletData },
        };
      }

      const currentBalance = Number(walletData.balance) || 0;
      const newBalance = currentBalance + settlement.settlementAmount;
      const now = new Date().toISOString();
      const txEntry = {
        type: "roaming_credit",
        amount: settlement.settlementAmount,
        date: now,
        description: `Roaming settlement: ${settlement.sessionId} @ ${settlement.visitedHotspotId || settlement.visitedOwnerId}`,
        referenceId: settlement.idempotencyKey,
        settlementId: settlement.id,
        entitlementId: settlement.entitlementId,
        sessionId: settlement.sessionId,
        visitedHotspotId: settlement.visitedHotspotId,
      };

      transaction.set(
        walletRef,
        {
          ownerId: settlement.visitedOwnerId,
          balance: newBalance,
          transactions: [txEntry, ...(walletData.transactions || [])].slice(0, 100),
        },
        { merge: true }
      );

      transaction.update(settlementRef, {
        status: "credited",
        creditedAt: now,
        creditedTxId: settlement.idempotencyKey,
      });

      const updatedWallet = {
        ownerId: settlement.visitedOwnerId,
        balance: newBalance,
        transactions: [txEntry, ...(walletData.transactions || [])].slice(0, 100),
      };

      return {
        success: true,
        status: "credited",
        credited: true,
        skipped: false,
        amount: settlement.settlementAmount,
        errors: [],
        settlement: { ...settlement, status: "credited" },
        wallet: updatedWallet,
      };
    });

    return result;
  } catch (err) {
    return {
      success: false,
      status: "error",
      credited: false,
      skipped: false,
      amount: 0,
      errors: [err.message || String(err)],
      settlement: null,
      wallet: null,
    };
  }
}

module.exports = {
  WALLET_COLLECTION,
  verifySettlementFinancialIntegrity,
  verifyIdempotencyKeyMatches,
  validateCreditPreconditions,
  creditRoamingSettlement,
};
