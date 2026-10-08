/**
 * Phase 7.7 — Expired Entitlement Retention Cron
 *
 * Scans roaming_entitlements for active entitlements whose validity.expiresAt
 * has passed, and finalizes the unused-RAU residual accounting via
 * finalizeEntitlementResidual.
 *
 * Uses the existing node-cron pattern from ciscoExpiryCron.js.
 *
 * The worker NEVER touches: wallets, payments, payouts, MTN, Airtel.
 * It ONLY creates roaming_residuals records and transitions entitlements to expired.
 */
const cron = require("node-cron");
const { db } = require("../firebase");
const { finalizeEntitlementResidual, RESIDUAL_COLLECTION } = require("./roamingResidualService");

const ENTITLEMENT_COLLECTION = "roaming_entitlements";

async function processExpiringEntitlements(deps = {}) {
  const firestore = deps.db || db;
  const nowIso = new Date().toISOString();

  console.log(`[RoamingExpiryCron] Checking for expired roaming entitlements at ${nowIso}`);

  let activeSnap, expiredSnap;
  try {
    activeSnap = await firestore
      .collection(ENTITLEMENT_COLLECTION)
      .where("status", "==", "active")
      .where("validity.expiresAt", "<=", nowIso)
      .limit(1000)
      .get();

    expiredSnap = await firestore
      .collection(ENTITLEMENT_COLLECTION)
      .where("status", "==", "expired")
      .where("validity.expiresAt", "<=", nowIso)
      .limit(1000)
      .get();
  } catch (err) {
    console.error(`[RoamingExpiryCron] Failed to query expiring entitlements:`, err && err.message ? err.message : err);
    return;
  }

  const seen = new Set();
  const docs = [];
  for (const doc of activeSnap.docs) {
    if (!seen.has(doc.id)) { seen.add(doc.id); docs.push(doc); }
  }
  for (const doc of expiredSnap.docs) {
    if (!seen.has(doc.id)) { seen.add(doc.id); docs.push(doc); }
  }

  docs.forEach((doc) => {
    const entitlementId = doc.id;
    setImmediate(() => {
      finalizeEntitlementResidual(entitlementId, { db: firestore })
        .then((result) => {
          if (result.success) {
            if (result.finalized) {
              console.log(`[RoamingExpiryCron] Finalized residual for entitlement ${entitlementId}: retained ${result.retainedAmount} UGX (status=${result.status})`);
            } else if (result.skipped) {
              console.log(`[RoamingExpiryCron] Skipped residual for entitlement ${entitlementId}: ${result.errors.join("; ")}`);
            } else {
              console.log(`[RoamingExpiryCron] Not eligible for entitlement ${entitlementId}: ${result.errors.join("; ")}`);
            }
          } else {
            console.error(`[RoamingExpiryCron] Failed to finalize residual for entitlement ${entitlementId}: ${result.errors.join("; ")}`);
          }
        })
        .catch((err) => {
          console.error(`[RoamingExpiryCron] Unhandled error for entitlement ${entitlementId}:`, err && err.message ? err.message : err);
        });
    });
  });
}

cron.schedule("0 * * * *", processExpiringEntitlements);

module.exports = {
  processExpiringEntitlements,
  ENTITLEMENT_COLLECTION,
};
