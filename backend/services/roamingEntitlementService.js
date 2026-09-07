const { v4: uuidv4 } = require("uuid");
const { db } = require("../firebase");

const ENTITLEMENT_STATUSES = Object.freeze([
  "active",
  "suspended",
  "expired",
  "revoked",
]);

const ENTITLEMENT_SCOPES = Object.freeze(["federation", "owner", "hotspot"]);

const ENTITLEMENT_SOURCES = Object.freeze([
  "manual",
  "package",
  "admin",
  "migration",
]);

const ELIGIBILITY_REASONS = Object.freeze([
  "eligible",
  "no_entitlement",
  "entitlement_inactive",
  "entitlement_expired",
  "entitlement_revoked",
  "entitlement_suspended",
  "home_owner_invalid",
  "visited_partner_inactive",
  "visited_hotspot_invalid",
  "scope_not_allowed",
  "quota_exhausted",
  "validity_not_started",
]);

class EntitlementError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new EntitlementError(
      400,
      "validation_error",
      `Invalid ${field}. Allowed: ${allowed.join(", ")}`
    );
  }
}

function validateUserRef(userRef) {
  if (!userRef || typeof userRef !== "object") {
    throw new EntitlementError(
      400,
      "validation_error",
      "userRef is required and must be an object"
    );
  }
  if (!userRef.userId || typeof userRef.userId !== "string") {
    throw new EntitlementError(
      400,
      "validation_error",
      "userRef.userId is required"
    );
  }
  if (userRef.phone && typeof userRef.phone !== "string") {
    throw new EntitlementError(400, "validation_error", "userRef.phone must be a string");
  }
  if (userRef.authType && typeof userRef.authType !== "string") {
    throw new EntitlementError(400, "validation_error", "userRef.authType must be a string");
  }
}

function validateScope(scope, scopeRefs) {
  assertEnum(scope, ENTITLEMENT_SCOPES, "scope");
  
  if (!scopeRefs || typeof scopeRefs !== "object") {
    throw new EntitlementError(
      400,
      "validation_error",
      "scopeRefs is required and must be an object"
    );
  }

  if (scope === "federation") {
    // Federation scope allows access across the entire federation
    return;
  }

  if (scope === "owner") {
    if (!Array.isArray(scopeRefs.ownerIds) || scopeRefs.ownerIds.length === 0) {
      throw new EntitlementError(
        400,
        "validation_error",
        "scopeRefs.ownerIds is required for owner scope"
      );
    }
  }

  if (scope === "hotspot") {
    if (!Array.isArray(scopeRefs.hotspotIds) || scopeRefs.hotspotIds.length === 0) {
      throw new EntitlementError(
        400,
        "validation_error",
        "scopeRefs.hotspotIds is required for hotspot scope"
      );
    }
  }
}

function validateValidity(validity) {
  if (!validity || typeof validity !== "object") {
    throw new EntitlementError(
      400,
      "validation_error",
      "validity is required and must be an object"
    );
  }
  if (validity.startsAt && typeof validity.startsAt !== "string") {
    throw new EntitlementError(400, "validation_error", "validity.startsAt must be ISO8601 string");
  }
  if (validity.expiresAt && typeof validity.expiresAt !== "string") {
    throw new EntitlementError(400, "validation_error", "validity.expiresAt must be ISO8601 string");
  }
}

function validateQuota(quota) {
  if (!quota) return;
  if (typeof quota !== "object") {
    throw new EntitlementError(400, "validation_error", "quota must be an object");
  }
  if (quota.maxSessions !== null && quota.maxSessions !== undefined) {
    if (typeof quota.maxSessions !== "number" || quota.maxSessions < 0) {
      throw new EntitlementError(400, "validation_error", "quota.maxSessions must be a non-negative number");
    }
  }
  if (quota.maxMinutes !== null && quota.maxMinutes !== undefined) {
    if (typeof quota.maxMinutes !== "number" || quota.maxMinutes < 0) {
      throw new EntitlementError(400, "validation_error", "quota.maxMinutes must be a non-negative number");
    }
  }
  if (quota.maxMegabytes !== null && quota.maxMegabytes !== undefined) {
    if (typeof quota.maxMegabytes !== "number" || quota.maxMegabytes < 0) {
      throw new EntitlementError(400, "validation_error", "quota.maxMegabytes must be a non-negative number");
    }
  }
}

async function loadOwner(ownerId) {
  const snap = await db.collection("owners").doc(ownerId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function loadRoamingPartner(ownerId) {
  const snap = await db.collection("roaming_partners").doc(ownerId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function loadRoamingHotspot(hotspotId) {
  const snap = await db.collection("roaming_hotspots").doc(hotspotId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

function matchesIdempotency(doc, key) {
  return Boolean(key && doc && doc.lastIdempotencyKey === key);
}

async function createEntitlement({
  authenticatedOwnerId,
  payload,
  actor,
  idempotencyKey,
}) {
  // Validate required fields
  if (!payload.homeOwnerId || typeof payload.homeOwnerId !== "string") {
    throw new EntitlementError(400, "validation_error", "homeOwnerId is required");
  }

  // Ownership check: authenticated owner must match homeOwnerId
  if (authenticatedOwnerId !== payload.homeOwnerId) {
    throw new EntitlementError(
      403,
      "unauthorized_scope",
      "Cannot create entitlement for another owner"
    );
  }

  validateUserRef(payload.userRef);
  validateScope(payload.scope, payload.scopeRefs);
  assertEnum(payload.status || "active", ENTITLEMENT_STATUSES, "status");
  assertEnum(payload.source || "manual", ENTITLEMENT_SOURCES, "source");
  validateValidity(payload.validity);
  validateQuota(payload.quota);

  // Verify home owner exists and is a valid roaming partner
  const homeOwner = await loadOwner(payload.homeOwnerId);
  if (!homeOwner) {
    throw new EntitlementError(404, "not_found", "Home owner not found");
  }

  const homePartner = await loadRoamingPartner(payload.homeOwnerId);
  if (!homePartner) {
    throw new EntitlementError(
      422,
      "ineligible",
      "Home owner is not a roaming partner"
    );
  }

  if (homePartner.federationStatus !== "active") {
    throw new EntitlementError(
      422,
      "ineligible",
      "Home owner is not an active roaming partner"
    );
  }

  // Validate scope references
  if (payload.scope === "owner" && payload.scopeRefs.ownerIds) {
    for (const ownerId of payload.scopeRefs.ownerIds) {
      const partner = await loadRoamingPartner(ownerId);
      if (!partner) {
        throw new EntitlementError(
          400,
          "validation_error",
          `Owner ${ownerId} is not a roaming partner`
        );
      }
    }
  }

  if (payload.scope === "hotspot" && payload.scopeRefs.hotspotIds) {
    for (const hotspotId of payload.scopeRefs.hotspotIds) {
      const hotspot = await loadRoamingHotspot(hotspotId);
      if (!hotspot) {
        throw new EntitlementError(
          400,
          "validation_error",
          `Hotspot ${hotspotId} is not registered for roaming`
        );
      }
    }
  }

  // Check idempotency by searching for existing entitlement with same key
  if (idempotencyKey) {
    const existingSnap = await db
      .collection("roaming_entitlements")
      .where("lastIdempotencyKey", "==", idempotencyKey)
      .limit(1)
      .get();
    
    if (!existingSnap.empty) {
      const existing = { id: existingSnap.docs[0].id, ...existingSnap.docs[0].data() };
      return { entitlement: existing, idempotent: true };
    }
  }

  const entitlementId = uuidv4();
  const timestamp = nowIso();

  const doc = {
    id: entitlementId,
    userRef: {
      userId: payload.userRef.userId,
      phone: payload.userRef.phone || null,
      authType: payload.userRef.authType || null,
    },
    homeOwnerId: payload.homeOwnerId,
    scope: payload.scope,
    scopeRefs: payload.scopeRefs,
    status: payload.status || "active",
    validity: {
      startsAt: payload.validity.startsAt || timestamp,
      expiresAt: payload.validity.expiresAt || null,
    },
    quota: payload.quota || {
      maxSessions: null,
      maxMinutes: null,
      maxMegabytes: null,
    },
    source: payload.source || "manual",
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actor,
    updatedBy: actor,
    lastIdempotencyKey: idempotencyKey || null,
  };

  // Optional Phase 1 readiness fields
  if (payload.packageHint) doc.packageHint = payload.packageHint;
  if (payload.deviceBinding) doc.deviceBinding = payload.deviceBinding;
  if (payload.passpointIdentity) doc.passpointIdentity = payload.passpointIdentity;
  if (payload.nai) doc.nai = payload.nai;
  if (payload.realm) doc.realm = payload.realm;

  await db.collection("roaming_entitlements").doc(entitlementId).set(doc);

  return { entitlement: doc, created: true };
}

async function getEntitlement(entitlementId) {
  const snap = await db.collection("roaming_entitlements").doc(entitlementId).get();
  if (!snap.exists) {
    throw new EntitlementError(404, "not_found", "Entitlement not found");
  }
  return { id: snap.id, ...snap.data() };
}

async function listEntitlements(filters = {}) {
  let query = db.collection("roaming_entitlements");

  if (filters.homeOwnerId) {
    query = query.where("homeOwnerId", "==", filters.homeOwnerId);
  }
  if (filters.userId) {
    query = query.where("userRef.userId", "==", filters.userId);
  }
  if (filters.status) {
    query = query.where("status", "==", filters.status);
  }

  query = query.limit(filters.limit || 100);

  const snap = await query.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function updateEntitlement({
  entitlementId,
  authenticatedOwnerId,
  payload,
  actor,
}) {
  const entitlement = await getEntitlement(entitlementId);

  // Ownership check
  if (entitlement.homeOwnerId !== authenticatedOwnerId) {
    throw new EntitlementError(
      403,
      "unauthorized_scope",
      "Cannot modify another owner's entitlement"
    );
  }

  // Immutable fields check
  if (payload.homeOwnerId && payload.homeOwnerId !== entitlement.homeOwnerId) {
    throw new EntitlementError(
      400,
      "validation_error",
      "homeOwnerId cannot be changed"
    );
  }
  if (payload.userRef && payload.userRef.userId !== entitlement.userRef.userId) {
    throw new EntitlementError(
      400,
      "validation_error",
      "userRef.userId cannot be changed"
    );
  }

  const update = {
    updatedAt: nowIso(),
    updatedBy: actor,
  };

  if (payload.status) {
    assertEnum(payload.status, ENTITLEMENT_STATUSES, "status");
    update.status = payload.status;
  }
  if (payload.validity) {
    validateValidity(payload.validity);
    update.validity = {
      ...entitlement.validity,
      ...payload.validity,
    };
  }
  if (payload.quota) {
    validateQuota(payload.quota);
    update.quota = {
      ...entitlement.quota,
      ...payload.quota,
    };
  }
  if (payload.scope) {
    validateScope(payload.scope, payload.scopeRefs || entitlement.scopeRefs);
    update.scope = payload.scope;
  }
  if (payload.scopeRefs) {
    validateScope(payload.scope || entitlement.scope, payload.scopeRefs);
    update.scopeRefs = payload.scopeRefs;
  }

  await db
    .collection("roaming_entitlements")
    .doc(entitlementId)
    .set(update, { merge: true });

  const updated = await getEntitlement(entitlementId);
  return { entitlement: updated };
}

async function suspendEntitlement({
  entitlementId,
  authenticatedOwnerId,
  reason,
  actor,
  idempotencyKey,
}) {
  const entitlement = await getEntitlement(entitlementId);

  if (entitlement.homeOwnerId !== authenticatedOwnerId) {
    throw new EntitlementError(
      403,
      "unauthorized_scope",
      "Cannot suspend another owner's entitlement"
    );
  }

  if (matchesIdempotency(entitlement, idempotencyKey)) {
    return { entitlement, idempotent: true };
  }

  const update = {
    status: "suspended",
    suspensionReason: reason || "owner_suspended",
    updatedAt: nowIso(),
    updatedBy: actor,
    lastIdempotencyKey: idempotencyKey || null,
  };

  await db
    .collection("roaming_entitlements")
    .doc(entitlementId)
    .set(update, { merge: true });

  const updated = await getEntitlement(entitlementId);
  return { entitlement: updated };
}

async function revokeEntitlement({
  entitlementId,
  authenticatedOwnerId,
  reason,
  actor,
  idempotencyKey,
}) {
  const entitlement = await getEntitlement(entitlementId);

  if (entitlement.homeOwnerId !== authenticatedOwnerId) {
    throw new EntitlementError(
      403,
      "unauthorized_scope",
      "Cannot revoke another owner's entitlement"
    );
  }

  if (matchesIdempotency(entitlement, idempotencyKey)) {
    return { entitlement, idempotent: true };
  }

  const update = {
    status: "revoked",
    revocationReason: reason || "owner_revoked",
    updatedAt: nowIso(),
    updatedBy: actor,
    lastIdempotencyKey: idempotencyKey || null,
  };

  await db
    .collection("roaming_entitlements")
    .doc(entitlementId)
    .set(update, { merge: true });

  const updated = await getEntitlement(entitlementId);
  return { entitlement: updated };
}

async function restoreEntitlement({
  entitlementId,
  authenticatedOwnerId,
  actor,
  idempotencyKey,
}) {
  const entitlement = await getEntitlement(entitlementId);

  if (entitlement.homeOwnerId !== authenticatedOwnerId) {
    throw new EntitlementError(
      403,
      "unauthorized_scope",
      "Cannot restore another owner's entitlement"
    );
  }

  if (entitlement.status !== "suspended" && entitlement.status !== "revoked") {
    throw new EntitlementError(
      400,
      "validation_error",
      "Only suspended or revoked entitlements can be restored"
    );
  }

  if (matchesIdempotency(entitlement, idempotencyKey)) {
    return { entitlement, idempotent: true };
  }

  const update = {
    status: "active",
    suspensionReason: null,
    revocationReason: null,
    updatedAt: nowIso(),
    updatedBy: actor,
    lastIdempotencyKey: idempotencyKey || null,
  };

  await db
    .collection("roaming_entitlements")
    .doc(entitlementId)
    .set(update, { merge: true });

  const updated = await getEntitlement(entitlementId);
  return { entitlement: updated };
}

async function checkEntitlementEligibility({
  userId,
  visitedOwnerId,
  visitedHotspotId,
}) {
  if (!userId) {
    return {
      eligible: false,
      reason: "no_entitlement",
      message: "User ID is required",
    };
  }

  if (!visitedOwnerId) {
    return {
      eligible: false,
      reason: "no_entitlement",
      message: "Visited owner ID is required",
    };
  }

  // Find active entitlements for this user
  const entitlementsSnap = await db
    .collection("roaming_entitlements")
    .where("userRef.userId", "==", userId)
    .where("status", "==", "active")
    .get();

  if (entitlementsSnap.empty) {
    return {
      eligible: false,
      reason: "no_entitlement",
      message: "No active entitlement found for user",
    };
  }

  // Check visited owner is an active roaming partner
  const visitedPartner = await loadRoamingPartner(visitedOwnerId);
  if (!visitedPartner) {
    return {
      eligible: false,
      reason: "visited_partner_inactive",
      message: "Visited owner is not a roaming partner",
    };
  }

  if (visitedPartner.federationStatus !== "active") {
    return {
      eligible: false,
      reason: "visited_partner_inactive",
      message: "Visited owner is not an active roaming partner",
    };
  }

  // Check visited hotspot if provided
  if (visitedHotspotId) {
    const visitedHotspot = await loadRoamingHotspot(visitedHotspotId);
    if (!visitedHotspot) {
      return {
        eligible: false,
        reason: "visited_hotspot_invalid",
        message: "Visited hotspot is not registered for roaming",
      };
    }

    if (visitedHotspot.partnerStatus !== "active") {
      return {
        eligible: false,
        reason: "visited_hotspot_invalid",
        message: "Visited hotspot is not active",
      };
    }

    if (visitedHotspot.ownerId !== visitedOwnerId) {
      return {
        eligible: false,
        reason: "visited_hotspot_invalid",
        message: "Hotspot does not belong to visited owner",
      };
    }
  }

  const now = new Date();

  // Check each entitlement for eligibility
  for (const doc of entitlementsSnap.docs) {
    const entitlement = { id: doc.id, ...doc.data() };

    // Check validity period
    if (entitlement.validity.startsAt) {
      const startsAt = new Date(entitlement.validity.startsAt);
      if (now < startsAt) {
        continue; // Not yet valid
      }
    }

    if (entitlement.validity.expiresAt) {
      const expiresAt = new Date(entitlement.validity.expiresAt);
      if (now > expiresAt) {
        continue; // Expired
      }
    }

    // Check home owner is still valid
    const homePartner = await loadRoamingPartner(entitlement.homeOwnerId);
    if (!homePartner || homePartner.federationStatus !== "active") {
      continue; // Home partner no longer active
    }

    // Check scope
    let scopeMatches = false;

    if (entitlement.scope === "federation") {
      // Federation scope allows access to any active partner
      scopeMatches = true;
    } else if (entitlement.scope === "owner") {
      // Owner scope - check if visited owner is in the list
      if (
        entitlement.scopeRefs.ownerIds &&
        entitlement.scopeRefs.ownerIds.includes(visitedOwnerId)
      ) {
        scopeMatches = true;
      }
    } else if (entitlement.scope === "hotspot") {
      // Hotspot scope - check if visited hotspot is in the list
      if (
        visitedHotspotId &&
        entitlement.scopeRefs.hotspotIds &&
        entitlement.scopeRefs.hotspotIds.includes(visitedHotspotId)
      ) {
        scopeMatches = true;
      }
    }

    if (!scopeMatches) {
      continue; // Scope doesn't match
    }

    // If we reach here, the entitlement is eligible
    return {
      eligible: true,
      reason: "eligible",
      message: "User has valid entitlement for requested access",
      entitlementId: entitlement.id,
      homeOwnerId: entitlement.homeOwnerId,
      visitedOwnerId,
      visitedHotspotId: visitedHotspotId || null,
      scope: entitlement.scope,
      quota: entitlement.quota,
    };
  }

  // No matching entitlement found
  return {
    eligible: false,
    reason: "scope_not_allowed",
    message: "No entitlement matches the requested access scope",
  };
}

function handleError(res, err) {
  if (err instanceof EntitlementError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }
  console.error("Roaming entitlement error:", err);
  return res.status(500).json({
    success: false,
    error: "server_error",
    message: "Entitlement request failed",
  });
}

module.exports = {
  EntitlementError,
  ENTITLEMENT_STATUSES,
  ENTITLEMENT_SCOPES,
  ENTITLEMENT_SOURCES,
  ELIGIBILITY_REASONS,
  createEntitlement,
  getEntitlement,
  listEntitlements,
  updateEntitlement,
  suspendEntitlement,
  revokeEntitlement,
  restoreEntitlement,
  checkEntitlementEligibility,
  handleError,
};
