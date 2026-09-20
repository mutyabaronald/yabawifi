/**
 * Roaming Entitlement Bridge Service (Phase 7.2 / 7.2A)
 *
 * Bridges a SUCCESSFUL package purchase into a roaming entitlement, ADDITIVELY.
 * The existing purchase flow remains authoritative; this service only acts on
 * packages explicitly marked roaming-eligible.
 *
 * Reuse / conventions (all identified from existing repository code):
 *  - RAU derivation     : rauCalculationService.calculateRAUs (Phase 7.1)
 *  - Entitlement model  : roamingEntitlementService.createEntitlement
 *    (existing validity { startsAt, expiresAt }, existing lastIdempotencyKey
 *     dedup, existing ownership guard authenticatedOwnerId === homeOwnerId,
 *     existing active-roaming-partner requirement).
 *  - RAU storage        : the EXISTING `quota.maxMinutes` field (1 RAU == 1 min).
 *    No new schema field is invented; no monetary field is copied.
 *  - Eligibility mark   : package.roamingEligible (additive boolean; absent/false
 *    => a normal local package, untouched).
 *  - homeOwnerId        : package.ownerId (== receipt.ownerId); never client-supplied.
 *  - userId             : Firestore `users` document ID resolved from `phone` with
 *    the SAME lookup auth.js uses (doc(phone), then where("phone")); phone is a
 *    contact/login attribute, NOT the canonical userId. Mirrors the roaming auth
 *    path so the stored userRef.userId matches the JWT `sub` issued later.
 *  - Validity           : validFrom = authoritative purchase start; expiresAt =
 *    validFrom + package.timeLimitMinutes (authoritative duration; no hard-coded
 *    month lengths).
 *  - Idempotency        : receipt ID passed idempotencyKey (existing lastIdempotencyKey
 *    dedup => one entitlement per purchase).
 *
 * Ordering / cost: the package is loaded and eligibility checked BEFORE any user
 * or entitlement lookups, so non-roaming purchases incur only a single package read
 * and create no roaming entitlements.
 *
 * Failure isolation: every failure is caught, logged via console.error (project
 * convention), and returned as a status — it NEVER throws into the purchase path.
 *
 * Testability: Firestore access, resolveUserId, loadPackage, createEntitlement and
 * calculateRAUs are injectable via `deps`, so the bridge is fully testable without
 * Firestore / network / auth.
 */

const { calculateRAUs, RauCalculationError } = require("./rauCalculationService");
const {
  createEntitlement,
  validateCommercial,
} = require("./roamingEntitlementService");

const MS_PER_MINUTE = 60000;

const BRIDGE_STATUS = Object.freeze({
  CREATED: "created",
  EXISTS: "exists",
  NOT_ELIGIBLE: "not_roaming_eligible",
  INVALID: "invalid",
  FAILED: "failed",
});

const DEFAULT_SCOPE = "federation";
const DEFAULT_ACTOR = "system:roaming-bridge";
const DEFAULT_SOURCE = "package";

/**
 * Resolve a canonical user ID from a phone number, mirroring auth.js
 * (roamingRoutes/auth.js `verifyUserIdentity`) exactly:
 *   1) db.collection("users").doc(phone).get()      -> userId = doc.id
 *   2) db.collection("users").where("phone","==",phone).limit(1).get() -> doc.id
 * Returns null when no user record exists (bridge will not invent an identity).
 *
 * @param {string} phone
 * @param {object} [db] - injectable Firestore db (tests)
 * @returns {Promise<string|null>}
 */
async function resolveUserIdFromPhone(phone, db) {
  if (!phone || typeof phone !== "string") return null;
  const database = db || require("../firebase").db;
  const direct = await database.collection("users").doc(phone).get();
  if (direct && direct.exists) return direct.id;
  const q = await database.collection("users").where("phone", "==", phone).limit(1).get();
  if (q && !q.empty) return q.docs[0].id;
  return null;
}

async function loadPackageDefault(db, packageId) {
  const snap = await db.collection("packages").doc(packageId).get();
  if (!snap || !snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Build the immutable historical commercial snapshot for a roaming entitlement.
 *
 * Economic model (Phase 7.6):
 *   1 connected eligible roaming minute = 1 RAU.
 *   RAU settlement rate = original package price / total RAUs granted.
 *
 * - originalPrice: authoritative PACKAGE ACCESS price at purchase time, taken
 *   from the package doc resolved server-side at bridge time (packageData.price).
 *   It is NOT the receipt payment total (which in the future will include the
 *   separate 5% YabaLink Service Fee — Phase 7.8); settlement economics use the
 *   package price, which stays immutable once snapshotted here.
 * - grantedRaus: total RAUs granted = quota.maxMinutes (Phase 7.1).
 * - rateNumerator/rateDenominator: integer-only UGX-per-RAU representation so
 *   future settlement math stays integer-safe (no floating-point money).
 *
 * Returns null when the inputs cannot be validated as integers, so no invalid
 * commercial snapshot is ever persisted (existing access-unit behaviour is
 * unchanged in that case).
 *
 * @param {object} packageData - package doc resolved at bridge time (price, etc.)
 * @param {number} grantedRaus - Phase 7.1 RAU allowance (== quota.maxMinutes)
 * @returns {{originalPrice:number, grantedRaus:number, rateNumerator:number, rateDenominator:number}|null}
 */
function buildCommercialSnapshot(packageData, grantedRaus) {
  const originalPrice = Number(packageData && packageData.price);
  if (!Number.isInteger(originalPrice) || originalPrice < 0) return null;
  if (!Number.isInteger(grantedRaus) || grantedRaus <= 0) return null;
  const snapshot = {
    originalPrice,
    grantedRaus,
    rateNumerator: originalPrice,
    rateDenominator: grantedRaus,
  };
  validateCommercial(snapshot);
  return snapshot;
}

/**
 * Bridge a completed purchase into a roaming entitlement.
 *
 * Accepts a preloaded `pkg` (preferred when the caller already resolved it, e.g.
 * receiptRoutes resolving via the existing (ownerId + packageName) lookup) or a
 * `packageId` (resolved internally via loadPackage).
 *
 * @param {object} ctx
 * @param {string} ctx.phone          - customer phone (contact attribute; resolves to userId).
 * @param {string} [ctx.packageId]    - purchased package document ID (alternative to pkg).
 * @param {object} [ctx.pkg]          - preloaded package { id, ownerId, timeLimitMinutes, roamingEligible, ... }.
 * @param {string} ctx.receiptId      - purchase identifier (idempotency key).
 * @param {string} ctx.validityStartsAt - ISO8601 access start (authoritative purchase time).
 * @param {string} [ctx.scope]        - entitlement scope (default "federation").
 * @param {object} [ctx.scopeRefs]    - scope refs for owner/hotspot scope.
 * @param {string} [ctx.source]       - entitlement source (default "package").
 * @param {string} [ctx.actor]        - audit actor (default "system:roaming-bridge").
 * @param {object} [ctx.deps]         - injectable deps for testing.
 * @returns {Promise<{status, entitlement?, raus?, reason?}>}
 */
async function createRoamingEntitlementFromPurchase(ctx) {
  if (!ctx || typeof ctx !== "object") {
    return { status: BRIDGE_STATUS.INVALID, reason: "purchase context is required" };
  }

  const {
    phone,
    packageId,
    pkg,
    receiptId,
    validityStartsAt,
    scope = DEFAULT_SCOPE,
    scopeRefs = null,
    source = DEFAULT_SOURCE,
    actor = DEFAULT_ACTOR,
    deps = {},
  } = ctx;

  // Failure isolation: never propagate into the (already successful) purchase path.
  try {
    if (!phone || typeof phone !== "string") {
      return { status: BRIDGE_STATUS.INVALID, reason: "phone is required" };
    }
    if (!receiptId || typeof receiptId !== "string") {
      return { status: BRIDGE_STATUS.INVALID, reason: "receiptId is required" };
    }
    if (!validityStartsAt || typeof validityStartsAt !== "string") {
      return { status: BRIDGE_STATUS.INVALID, reason: "validityStartsAt is required" };
    }
    const start = new Date(validityStartsAt);
    if (Number.isNaN(start.getTime())) {
      return { status: BRIDGE_STATUS.INVALID, reason: "validityStartsAt is not a valid ISO8601 timestamp" };
    }
    if (!pkg && !packageId) {
      return { status: BRIDGE_STATUS.INVALID, reason: "packageId or pkg is required" };
    }

    // --- Load the authoritative package (preload or by id) ---
    let packageData = pkg;
    if (!packageData) {
      const loadPackage = deps.loadPackage || ((id) => loadPackageDefault(require("../firebase").db, id));
      packageData = await loadPackage(packageId);
    }
    if (!packageData) {
      return { status: BRIDGE_STATUS.INVALID, reason: "package not found" };
    }

    // Business rule: ONLY packages explicitly marked roaming-eligible are bridged.
    // Checked BEFORE any user/partner lookups so local packages are O(1) and never
    // produce a roaming entitlement.
    if (packageData.roamingEligible !== true) {
      return { status: BRIDGE_STATUS.NOT_ELIGIBLE, reason: "package is not roaming-eligible" };
    }

    // homeOwnerId = package.ownerId (authoritative grantor), never client-supplied.
    const homeOwnerId = packageData.ownerId;
    if (!homeOwnerId || typeof homeOwnerId !== "string") {
      return { status: BRIDGE_STATUS.INVALID, reason: "package.ownerId is required" };
    }

    // Authoritative duration: package.timeLimitMinutes (NOT hard-coded months).
    const timeLimitMinutes = Number(packageData.timeLimitMinutes);
    if (!Number.isFinite(timeLimitMinutes) || timeLimitMinutes <= 0) {
      return {
        status: BRIDGE_STATUS.INVALID,
        reason: "roaming-eligible package must have a positive timeLimitMinutes",
      };
    }

    const expiresAt = new Date(start.getTime() + timeLimitMinutes * MS_PER_MINUTE).toISOString();

    // --- Compute RAU allowance via Phase 7.1 ---
    const calculateRAUsFn = deps.calculateRAUs || calculateRAUs;
    let raus;
    try {
      raus = calculateRAUsFn(validityStartsAt, expiresAt);
    } catch (e) {
      if (e instanceof RauCalculationError) {
        return { status: BRIDGE_STATUS.INVALID, reason: e.message };
      }
      return { status: BRIDGE_STATUS.INVALID, reason: "RAU calculation failed" };
    }

    // --- Resolve canonical user identity (mirrors auth.js) ---
    const resolveUserId = deps.resolveUserId || ((p) => resolveUserIdFromPhone(p));
    const userId = await resolveUserId(phone);
    if (!userId) {
      return { status: BRIDGE_STATUS.INVALID, reason: "no canonical user found for phone" };
    }

    // Federation scope requires a non-null scopeRefs object per createEntitlement
    // validation. Owner/hotspot scopes require their respective arrays.
    const scopeRefsForPayload = scopeRefs || (scope === "federation" ? {} : undefined);

    // --- Create the roaming entitlement via the existing service ---
    const createEntitlementFn = deps.createEntitlement || createEntitlement;
    const result = await createEntitlementFn({
      authenticatedOwnerId: homeOwnerId, // owner acts as grantor; createEntitlement validates partnership
      actor,
      idempotencyKey: receiptId, // existing lastIdempotencyKey dedup => idempotent
      payload: {
        homeOwnerId,
        userRef: { userId, phone, authType: "phone_password" },
        scope,
        scopeRefs: scopeRefsForPayload,
        status: "active",
        source,
        validity: { startsAt: validityStartsAt, expiresAt },
        // RAU allowance on the EXISTING quota.maxMinutes (1 RAU == 1 minute).
        // Package price is intentionally NOT copied onto the entitlement.
     // Phase 7.3: usedMinutes=0 (consumed), remainingMinutes=grant (read-only
     // maxMinutes preserved as the original grant). consumed/remaining are
     // server-managed; never client-supplied.
     quota: {
       maxSessions: null,
       maxMinutes: raus,
       maxMegabytes: null,
       usedMinutes: 0,
       remainingMinutes: raus,
     },
     // Phase 7.6A: immutable historical purchase economics. Snapshotted from the
     // authoritative package price (server-resolved at bridge time) and the
     // Phase 7.1 RAU allowance. Preserved so future package-price edits do not
     // alter an already-sold entitlement's settlement economics. null when inputs
     // are not valid integers (existing access-unit behaviour unchanged).
     commercial: buildCommercialSnapshot(packageData, raus),
   },
    });

    const created = Boolean(result && result.created);
    return {
      status: created ? BRIDGE_STATUS.CREATED : BRIDGE_STATUS.EXISTS,
      entitlement: result && result.entitlement,
      raus,
      reason: created ? "roaming entitlement created" : "roaming entitlement already existed (idempotent)",
    };
  } catch (err) {
    console.error("Roaming bridge failed (purchase unaffected):", err && err.message ? err.message : err);
    return { status: BRIDGE_STATUS.FAILED, reason: "bridge failed; purchase unaffected" };
  }
}

module.exports = {
  BRIDGE_STATUS,
  DEFAULT_SCOPE,
  DEFAULT_ACTOR,
  DEFAULT_SOURCE,
  MS_PER_MINUTE,
  resolveUserIdFromPhone,
  createRoamingEntitlementFromPurchase,
  buildCommercialSnapshot,
  calculateRAUs,
};
