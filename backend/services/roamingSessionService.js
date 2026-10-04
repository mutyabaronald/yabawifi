const { db } = require("../firebase");
const {
  validateRoamingAuthorizationToken,
  logAuthEvent,
  ERROR_CODES,
  RoamingAuthError,
} = require("./roamingAuthService");
const { checkEntitlementEligibility } = require("./roamingEntitlementService");
const { AAA_ADAPTER_KEYS } = require("./roamingAAAAdapter");
const { getAAAAdapterEntry } = require("./roamingAAAAdapterRegistry");
const { createRadiusProfileService } = require("./radiusProfiles");

const RADIUS_ADAPTER_KEY = "radius";

// Phase 8.3 (D-1): the RADIUS profile store is dependency-injected and inert by
// default. With nothing injected no profile ever resolves, so production cannot
// activate a RADIUS profile until the Phase 8.4 store is wired.
const RADIUS_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

let radiusProfileService = createRadiusProfileService();

function setRadiusProfileResolver(resolver) {
  radiusProfileService =
    resolver && typeof resolver.getProfile === "function"
      ? resolver
      : createRadiusProfileService();
  return radiusProfileService;
}

function resetRadiusProfileResolver() {
  radiusProfileService = createRadiusProfileService();
  return radiusProfileService;
}

function isRadiusAdapterRegistered(adapterKey) {
  if (adapterKey !== RADIUS_ADAPTER_KEY) return false;
  const entry = getAAAAdapterEntry(adapterKey);
  if (!entry || !entry.adapter) return false;
  return entry.adapter.aaaAdapterKey === RADIUS_ADAPTER_KEY;
}

/**
 * Phase 8.3 (D-1): resolve the trusted RADIUS profile id for a session.
 *
 * All four conditions must hold or nothing is returned and the caller omits the
 * field entirely - no partial resolution and never the raw stored string. Any
 * resolution failure is treated as "not resolvable" so the session falls back to
 * the profile default rather than failing.
 */
async function resolveRadiusProfileId(hotspot) {
  if (!hotspot || typeof hotspot !== "object") return null;

  const candidate = hotspot.radiusProfileId;
  if (typeof candidate !== "string") return null;
  if (!RADIUS_PROFILE_ID_PATTERN.test(candidate)) return null;
  if (hotspot.enforcementMode !== RADIUS_ADAPTER_KEY) return null;
  if (!isRadiusAdapterRegistered(hotspot.aaaAdapterKey)) return null;

  let profile = null;
  try {
    profile = await radiusProfileService.getProfile(candidate);
  } catch (err) {
    return null;
  }

  if (!profile || typeof profile !== "object") return null;
  if (profile.profileId !== candidate) return null;

  return candidate;
}

const SESSION_STATUSES = Object.freeze([
  "authorized",
  "active",
  "terminated",
  "expired",
  "revoked",
]);

const ACTIVE_STATUSES = Object.freeze(["authorized", "active"]);

const SESSION_STATE_TRANSITIONS = Object.freeze({
  authorized: ["active", "terminated", "expired", "revoked"],
  active: ["terminated", "expired", "revoked"],
  terminated: [],
  expired: [],
  revoked: [],
});

const DEFAULT_SESSION_TTL_HOURS = 24;

function nowIso() {
  return new Date().toISOString();
}

function isValidStatusTransition(from, to) {
  const allowed = SESSION_STATE_TRANSITIONS[from];
  return allowed && allowed.includes(to);
}

class RoamingSessionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "RoamingSessionError";
    this.status = status;
    this.code = code;
  }
}

function validateSessionContext(sessionData, expected) {
  const fields = ["homeOwnerId", "visitedOwnerId", "visitedHotspotId", "entitlementId", "userId"];
  for (const field of fields) {
    if (sessionData[field] !== expected[field]) {
      throw new RoamingSessionError(
        403,
        "CONTEXT_MISMATCH",
        "Session context does not match requester"
      );
    }
  }
}

async function createRoamingSession({
  token,
  idempotencyKey,
  metadata = {},
}) {
  if (!token || typeof token !== "string") {
    throw new RoamingSessionError(400, "VALIDATION_ERROR", "Token is required");
  }

  let claims;
  try {
    const result = await validateRoamingAuthorizationToken(token, {
      userId: undefined,
      visitedOwnerId: undefined,
      visitedHotspotId: undefined,
    });
    claims = result.claims;
  } catch (err) {
    if (err instanceof RoamingAuthError) throw err;
    throw new RoamingSessionError(401, "INVALID_TOKEN", "Invalid authorization token");
  }

  const {
    sub: userId,
    entitlementId,
    homeOwnerId,
    visitedOwnerId,
    visitedHotspotId,
    agreementId,
    authPath,
    jti,
    exp,
  } = claims;

  const authExpiry = new Date(exp * 1000);
  if (new Date() > authExpiry) {
    throw new RoamingSessionError(401, "EXPIRED_TOKEN", "Authorization token has expired");
  }

  const eligibility = await checkEntitlementEligibility({
    userId,
    visitedOwnerId,
    visitedHotspotId,
  });

  if (!eligibility.eligible) {
    await logAuthEvent({
      eventType: "session_creation_denied",
      userId,
      entitlementId,
      homeOwnerId,
      visitedOwnerId,
      visitedHotspotId,
      jti,
      success: false,
      reason: eligibility.reason,
    });
    return {
      success: false,
      authorized: false,
      reason: eligibility.reason,
      message: eligibility.message,
    };
  }

  if (eligibility.entitlementId && eligibility.entitlementId !== entitlementId) {
    throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Entitlement mismatch");
  }

  const quota = eligibility.quota || {};
  const maxSessions = quota.maxSessions || 1;

  const now = new Date();
  const entitlementExpiresAt = eligibility.expiresAt
    ? new Date(eligibility.expiresAt)
    : null;

   let sessionExpiresAt;
  if (entitlementExpiresAt && entitlementExpiresAt > now) {
    sessionExpiresAt = entitlementExpiresAt.toISOString();
  } else {
    sessionExpiresAt = new Date(
      now.getTime() + DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000
    ).toISOString();
  }

  // Phase 8.1: Resolve AAA adapter identity from TRUSTED server-side
  // hotspot registry data.  The client never supplies this — it is
  // determined by which hotspot the user authenticated against.
  // `visitedHotspotId` originates from the signed JWT claims (authoritative).
  const hotspotSnap = await db
    .collection("roaming_hotspots")
    .doc(visitedHotspotId)
    .get();
  let aaaAdapterKey = "unknown";
  let radiusProfileId = null;
  if (hotspotSnap.exists) {
    const hotspot = hotspotSnap.data();
    if (
      hotspot.aaaAdapterKey &&
      typeof hotspot.aaaAdapterKey === "string" &&
      AAA_ADAPTER_KEYS.includes(hotspot.aaaAdapterKey)
    ) {
      aaaAdapterKey = hotspot.aaaAdapterKey;
    }
    radiusProfileId = await resolveRadiusProfileId(hotspot);
  }

  let result;
  try {
    result = await db.runTransaction(async (transaction) => {
      if (idempotencyKey) {
        const existingSnap = await db
          .collection("roaming_sessions")
          .where("idempotencyKey", "==", idempotencyKey)
          .limit(1)
          .get();

        if (!existingSnap.empty) {
          const existingDoc = existingSnap.docs[0];
          const existing = existingDoc.data();

          if (
            existing.homeOwnerId !== homeOwnerId ||
            existing.visitedOwnerId !== visitedOwnerId ||
            existing.visitedHotspotId !== visitedHotspotId ||
            existing.entitlementId !== entitlementId ||
            existing.userRef.userId !== userId
          ) {
            throw new RoamingSessionError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Idempotency key exists with different context"
            );
          }

          return { isExisting: true, session: { id: existingDoc.id, ...existing } };
        }
      }

      const activeSnap = await db
        .collection("roaming_sessions")
        .where("userRef.userId", "==", userId)
        .where("entitlementId", "==", entitlementId)
        .where("status", "in", ACTIVE_STATUSES)
        .get();

      if (activeSnap.size >= maxSessions) {
        throw new RoamingSessionError(
          409,
          "MAX_SESSIONS_EXCEEDED",
          `Maximum of ${maxSessions} concurrent roaming session(s) reached`
        );
      }

      const sessionRef = db.collection("roaming_sessions").doc();
      const tokenRef = db.collection("roaming_auth_tokens").doc(jti);

      const tokenDoc = await transaction.get(tokenRef);

      if (!tokenDoc.exists) {
        throw new RoamingSessionError(401, "INVALID_TOKEN", "Authorization token not found");
      }

      const tokenRecord = tokenDoc.data();

      if (tokenRecord.status === "consumed") {
        throw new RoamingSessionError(401, "CONSUMED_TOKEN", "Authorization token already consumed");
      }

      if (tokenRecord.status === "revoked") {
        throw new RoamingSessionError(401, "REVOKED_TOKEN", "Authorization token revoked");
      }

      const tokenExpiresAt = new Date(tokenRecord.expiresAt);
      if (new Date() > tokenExpiresAt) {
        throw new RoamingSessionError(401, "EXPIRED_TOKEN", "Authorization token expired");
      }

      const sessionData = {
        sessionId: sessionRef.id,
        userRef: {
          userId,
          phone: claims.sub,
          authType: claims.sub,
        },
        homeOwnerId,
        visitedOwnerId,
        visitedHotspotId,
        entitlementId,
        agreementId,
        authPath,
        aaaAdapterKey,
        status: "authorized",
        startedAt: nowIso(),
        lastActivityAt: nowIso(),
        expiresAt: sessionExpiresAt,
        usedMinutes: 0,
        usedMegabytes: 0,
        endedAt: null,
        endReason: null,
        tokenJti: jti,
        idempotencyKey: idempotencyKey || null,
        metadata: metadata || {},
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      // Written only when the Phase 8.3 (D-1) predicate fully resolved a
      // trusted profile. Absent otherwise, so no raw stored value is persisted.
      if (radiusProfileId) {
        sessionData.radiusProfileId = radiusProfileId;
      }

      transaction.set(sessionRef, sessionData);

      transaction.set(
        tokenRef,
        {
          status: "consumed",
          consumedAt: nowIso(),
        },
        { merge: true }
      );

      return { isExisting: false, session: { id: sessionRef.id, ...sessionData } };
    });

    if (result.isExisting) {
      return {
        success: true,
        sessionId: result.session.id,
        session: result.session,
        existing: true,
      };
    }

    await logAuthEvent({
      eventType: "session_created",
      userId,
      entitlementId,
      homeOwnerId,
      visitedOwnerId,
      visitedHotspotId,
      jti,
      success: true,
    });

    return {
      success: true,
      sessionId: result.session.id,
      session: result.session,
      existing: false,
    };
  } catch (err) {
    if (err instanceof RoamingSessionError) throw err;
    if (err instanceof RoamingAuthError) throw err;
    throw new RoamingSessionError(
      500,
      "SERVER_ERROR",
      "Failed to create roaming session"
    );
  }
}

async function getRoamingSession(sessionId, context = {}) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new RoamingSessionError(400, "VALIDATION_ERROR", "Session ID is required");
  }

  const sessionSnap = await db.collection("roaming_sessions").doc(sessionId).get();

  if (!sessionSnap.exists) {
    throw new RoamingSessionError(404, "NOT_FOUND", "Session not found");
  }

  const session = { id: sessionSnap.id, ...sessionSnap.data() };

  if (context.userId) {
    if (session.userRef.userId !== context.userId) {
      throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Access denied");
    }
  }

  if (context.ownerId) {
    if (
      session.homeOwnerId !== context.ownerId &&
      session.visitedOwnerId !== context.ownerId
    ) {
      throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Access denied for this owner");
    }
  }

  if (new Date() > new Date(session.expiresAt) && session.status === "authorized") {
    throw new RoamingSessionError(401, "EXPIRED_TOKEN", "Session has expired");
  }

  return session;
}

async function terminateRoamingSession(sessionId, context = {}) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new RoamingSessionError(400, "VALIDATION_ERROR", "Session ID is required");
  }

  let result;
  try {
    result = await db.runTransaction(async (transaction) => {
      const sessionRef = db.collection("roaming_sessions").doc(sessionId);
      const sessionDoc = await transaction.get(sessionRef);

      if (!sessionDoc.exists) {
        throw new RoamingSessionError(404, "NOT_FOUND", "Session not found");
      }

      const session = sessionDoc.data();

      if (context.userId && session.userRef.userId !== context.userId) {
        throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Cannot terminate another user's session");
      }

      if (context.ownerId) {
        if (
          session.homeOwnerId !== context.ownerId &&
          session.visitedOwnerId !== context.ownerId
        ) {
          throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Cannot terminate session for another owner's network");
        }
      }

      if (session.status === "terminated") {
        return { alreadyTerminated: true, session: { id: sessionRef.id, ...session } };
      }

      if (session.status === "expired" || session.status === "revoked") {
        throw new RoamingSessionError(
          409,
          "INVALID_STATE",
          `Session is ${session.status} and cannot be terminated`
        );
      }

      if (!isValidStatusTransition(session.status, "terminated")) {
        throw new RoamingSessionError(
          409,
          "INVALID_STATE",
          `Cannot transition from ${session.status} to terminated`
        );
      }

      transaction.set(
        sessionRef,
        {
          status: "terminated",
          endedAt: nowIso(),
          endReason: context.reason || "user_terminated",
          updatedAt: nowIso(),
        },
        { merge: true }
      );

      const updated = { ...session, status: "terminated", endedAt: nowIso(), endReason: context.reason || "user_terminated" };
      return { alreadyTerminated: false, session: { id: sessionRef.id, ...updated } };
    });
  } catch (err) {
    if (err instanceof RoamingSessionError) throw err;
    throw new RoamingSessionError(
      500,
      "SERVER_ERROR",
      "Failed to terminate roaming session"
    );
  }

  await logAuthEvent({
    eventType: "session_terminated",
    userId: result.session.userRef.userId,
    entitlementId: result.session.entitlementId,
    homeOwnerId: result.session.homeOwnerId,
    visitedOwnerId: result.session.visitedOwnerId,
    visitedHotspotId: result.session.visitedHotspotId,
    jti: result.session.tokenJti,
    success: true,
  });

  return result;
}

async function updateSessionActivity(sessionId, context = {}, usage = {}) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new RoamingSessionError(400, "VALIDATION_ERROR", "Session ID is required");
  }

  const { usedMinutes = 0, usedMegabytes = 0 } = usage;

  if (typeof usedMinutes !== "number" || usedMinutes < 0) {
    throw new RoamingSessionError(400, "VALIDATION_ERROR", "usedMinutes must be a non-negative number");
  }

  if (typeof usedMegabytes !== "number" || usedMegabytes < 0) {
    throw new RoamingSessionError(400, "VALIDATION_ERROR", "usedMegabytes must be a non-negative number");
  }

  let result;
  try {
    result = await db.runTransaction(async (transaction) => {
      const sessionRef = db.collection("roaming_sessions").doc(sessionId);
      const sessionDoc = await transaction.get(sessionRef);

      if (!sessionDoc.exists) {
        throw new RoamingSessionError(404, "NOT_FOUND", "Session not found");
      }

      const session = sessionDoc.data();

      if (context.userId && session.userRef.userId !== context.userId) {
        throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Cannot update another user's session");
      }

      if (context.ownerId) {
        if (
          session.homeOwnerId !== context.ownerId &&
          session.visitedOwnerId !== context.ownerId
        ) {
          throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Cannot update session for another owner's network");
        }
      }

      if (session.status === "terminated" || session.status === "revoked") {
        throw new RoamingSessionError(
          409,
          "INVALID_STATE",
          `Session is ${session.status}`
        );
      }

      if (new Date() > new Date(session.expiresAt)) {
        transaction.set(
          sessionRef,
          {
            status: "expired",
            updatedAt: nowIso(),
          },
          { merge: true }
        );
        throw new RoamingSessionError(401, "EXPIRED_TOKEN", "Session has expired");
      }

      const newStatus = session.status === "authorized" ? "active" : session.status;

      transaction.set(
        sessionRef,
        {
          status: newStatus,
          lastActivityAt: nowIso(),
          usedMinutes: (session.usedMinutes || 0) + usedMinutes,
          usedMegabytes: (session.usedMegabytes || 0) + usedMegabytes,
          updatedAt: nowIso(),
        },
        { merge: true }
      );

      return { id: sessionRef.id, ...session, status: newStatus, lastActivityAt: nowIso() };
    });
  } catch (err) {
    if (err instanceof RoamingSessionError) throw err;
    throw new RoamingSessionError(
      500,
      "SERVER_ERROR",
      "Failed to update session activity"
    );
  }

  return result;
}

async function revokeRoamingSession(sessionId, context = {}, reason = "admin_revoked") {
  if (!sessionId || typeof sessionId !== "string") {
    throw new RoamingSessionError(400, "VALIDATION_ERROR", "Session ID is required");
  }

  if (!context.ownerId) {
    throw new RoamingSessionError(403, "UNAUTHORIZED", "Owner authentication required to revoke sessions");
  }

  let result;
  try {
    result = await db.runTransaction(async (transaction) => {
      const sessionRef = db.collection("roaming_sessions").doc(sessionId);
      const sessionDoc = await transaction.get(sessionRef);

      if (!sessionDoc.exists) {
        throw new RoamingSessionError(404, "NOT_FOUND", "Session not found");
      }

      const session = sessionDoc.data();

      if (
        session.homeOwnerId !== context.ownerId &&
        session.visitedOwnerId !== context.ownerId
      ) {
        throw new RoamingSessionError(403, "CONTEXT_MISMATCH", "Cannot revoke session for another owner's network");
      }

      if (session.status === "revoked") {
        return { alreadyRevoked: true, session: { id: sessionRef.id, ...session } };
      }

      if (session.status === "terminated") {
        throw new RoamingSessionError(
          409,
          "INVALID_STATE",
          "Session is already terminated"
        );
      }

      if (!isValidStatusTransition(session.status, "revoked")) {
        throw new RoamingSessionError(
          409,
          "INVALID_STATE",
          `Cannot transition from ${session.status} to revoked`
        );
      }

      transaction.set(
        sessionRef,
        {
          status: "revoked",
          endedAt: nowIso(),
          endReason: reason,
          updatedAt: nowIso(),
        },
        { merge: true }
      );

      return { alreadyRevoked: false, session: { id: sessionRef.id, ...session, status: "revoked" } };
    });
  } catch (err) {
    if (err instanceof RoamingSessionError) throw err;
    throw new RoamingSessionError(
      500,
      "SERVER_ERROR",
      "Failed to revoke roaming session"
    );
  }

  await logAuthEvent({
    eventType: "session_revoked",
    userId: result.session.userRef.userId,
    entitlementId: result.session.entitlementId,
    homeOwnerId: result.session.homeOwnerId,
    visitedOwnerId: result.session.visitedOwnerId,
    visitedHotspotId: result.session.visitedHotspotId,
    jti: result.session.tokenJti,
    success: true,
  });

  return result;
}

async function listUserSessions(userId, options = {}) {
  if (!userId) {
    throw new RoamingSessionError(400, "VALIDATION_ERROR", "User ID is required");
  }

  const { limit = 50 } = options;

  let query = db
    .collection("roaming_sessions")
    .where("userRef.userId", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(limit);

  const snap = await query.get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function listOwnerSessions(ownerId, options = {}, deps = {}) {
  if (!ownerId) {
    throw new RoamingSessionError(400, "VALIDATION_ERROR", "Owner ID is required");
  }

  const firestore = deps.db || db;
  const { limit = 50, status } = options;

  let query = firestore
    .collection("roaming_sessions")
    .where("visitedOwnerId", "==", ownerId)
    .orderBy("createdAt", "desc")
    .limit(limit);

  if (status) {
    query = query.where("status", "==", status);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function expireSessions() {
  const now = new Date().toISOString();
  const snap = await db
    .collection("roaming_sessions")
    .where("status", "in", ACTIVE_STATUSES)
    .where("expiresAt", "<=", now)
    .limit(500)
    .get();

  const batch = db.batch();
  const expired = [];

  snap.docs.forEach((doc) => {
    batch.update(doc.ref, {
      status: "expired",
      updatedAt: nowIso(),
    });
    const data = doc.data();
    if (data.endReason === null) {
      expired.push({ id: doc.id, ...data });
    }
  });

  if (snap.size > 0) {
    await batch.commit();
  }

  for (const session of expired) {
    await logAuthEvent({
      eventType: "session_expired",
      userId: session.userRef?.userId,
      entitlementId: session.entitlementId,
      homeOwnerId: session.homeOwnerId,
      visitedOwnerId: session.visitedOwnerId,
      visitedHotspotId: session.visitedHotspotId,
      jti: session.tokenJti,
      success: true,
    });
  }

  return { expired: snap.size };
}

module.exports = {
  SESSION_STATUSES,
  ACTIVE_STATUSES,
  RADIUS_ADAPTER_KEY,
  RADIUS_PROFILE_ID_PATTERN,
  RoamingSessionError,
  setRadiusProfileResolver,
  resetRadiusProfileResolver,
  resolveRadiusProfileId,
  createRoamingSession,
  getRoamingSession,
  terminateRoamingSession,
  updateSessionActivity,
  revokeRoamingSession,
  listUserSessions,
  listOwnerSessions,
  expireSessions,
};
