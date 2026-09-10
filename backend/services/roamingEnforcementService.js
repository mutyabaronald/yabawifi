const { db } = require("../firebase");
const { logAuthEvent } = require("./roamingAuthService");
const { checkEntitlementEligibility } = require("./roamingEntitlementService");
const { getRoamingSession, SESSION_STATUSES, ACTIVE_STATUSES, RoamingSessionError } = require("./roamingSessionService");
const {
  resolveAAAAdapter,
  isAAAAdapterAvailable,
  RoamingAAAAdapterRegistryError,
} = require("./roamingAAAAdapterRegistry");
const { RoamingAAAAdapterError, nowIso } = require("./roamingAAAAdapter");

const ENFORCEMENT_STATUSES = Object.freeze([
  "pending",
  "provisioning",
  "provisioned",
  "revoked",
  "disconnected",
  "failed",
]);

const PROVISIONED_STATUSES = Object.freeze(["provisioned"]);

const ENFORCEMENT_STATE_TRANSITIONS = Object.freeze({
  pending: ["provisioning", "failed"],
  provisioning: ["provisioned", "failed"],
  provisioned: ["revoked", "disconnected", "failed"],
  revoked: [],
  disconnected: [],
  failed: [],
});

const SESSION_ENFORCEABLE_STATUSES = Object.freeze(["authorized", "active"]);

function isValidEnforcementTransition(from, to) {
  const allowed = ENFORCEMENT_STATE_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

class RoamingEnforcementError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "RoamingEnforcementError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function validateEnforcementContext(context) {
  const required = ["sessionId", "userId", "homeOwnerId", "visitedOwnerId", "visitedHotspotId", "entitlementId"];
  for (const field of required) {
    if (context[field] === undefined || context[field] === null || context[field] === "") {
      throw new RoamingEnforcementError(
        400,
        "VALIDATION_ERROR",
        `Context field '${field}' is required for enforcement`
      );
    }
  }
}

async function validateSessionForEnforcement(sessionId, context) {
  const sessionContext = { userId: context.userId };
  const session = await getRoamingSession(sessionId, sessionContext);

  if (!SESSION_ENFORCEABLE_STATUSES.includes(session.status)) {
    throw new RoamingEnforcementError(
      403,
      "SESSION_NOT_ENFORCEABLE",
      `Session in status '${session.status}' cannot be enforced`
    );
  }

  if (session.expiresAt && new Date() > new Date(session.expiresAt)) {
    throw new RoamingEnforcementError(
      401,
      "SESSION_EXPIRED",
      "Roaming session has expired and cannot be enforced"
    );
  }

  validateEnforcementContext({
    sessionId,
    userId: session.userRef.userId,
    homeOwnerId: session.homeOwnerId,
    visitedOwnerId: session.visitedOwnerId,
    visitedHotspotId: session.visitedHotspotId,
    entitlementId: session.entitlementId,
  });

  if (context.userId && session.userRef.userId !== context.userId) {
    throw new RoamingEnforcementError(
      403,
      "CONTEXT_MISMATCH",
      "User can only enforce their own sessions"
    );
  }

  if (context.ownerId) {
    if (
      session.homeOwnerId !== context.ownerId &&
      session.visitedOwnerId !== context.ownerId
    ) {
      throw new RoamingEnforcementError(
        403,
        "CONTEXT_MISMATCH",
        "Owner can only enforce sessions in their own network"
      );
    }
  }

  const eligibility = await checkEntitlementEligibility({
    userId: session.userRef.userId,
    visitedOwnerId: session.visitedOwnerId,
    visitedHotspotId: session.visitedHotspotId,
  });

  if (!eligibility.eligible) {
    throw new RoamingEnforcementError(
      403,
      "ENTITLEMENT_INVALID",
      `User is no longer entitled: ${eligibility.reason}`
    );
  }

  if (eligibility.entitlementId && eligibility.entitlementId !== session.entitlementId) {
    throw new RoamingEnforcementError(
      403,
      "CONTEXT_MISMATCH",
      "Session entitlement does not match current eligibility"
    );
  }

  return { session, eligibility };
}

async function resolveAdapterForSession(session) {
  if (!session.aaaAdapterKey || typeof session.aaaAdapterKey !== "string") {
    throw new RoamingEnforcementError(
      404,
      "ADAPTER_NOT_CONFIGURED",
      "No AAA adapter configured for this session"
    );
  }

  const key = session.aaaAdapterKey;

  if (!isAAAAdapterAvailable(key)) {
    throw new RoamingEnforcementError(
      503,
      "ADAPTER_UNAVAILABLE",
      `AAA adapter '${key}' is registered but unavailable`
    );
  }

  let adapter;
  try {
    adapter = resolveAAAAdapter(key);
  } catch (err) {
    if (err instanceof RoamingAAAAdapterRegistryError) {
      throw new RoamingEnforcementError(
        503,
        "ADAPTER_UNAVAILABLE",
        `AAA adapter '${key}' is not available: ${err.message}`
      );
    }
    throw new RoamingEnforcementError(
      503,
      "ADAPTER_UNAVAILABLE",
      "Failed to resolve AAA adapter"
    );
  }

  if (typeof adapter.provisionAccess !== "function") {
    throw new RoamingEnforcementError(
      501,
      "ADAPTER_NOT_IMPLEMENTED",
      `Adapter '${key}' does not implement required enforcement methods`
    );
  }

  return { adapter, key };
}

async function provisionSessionEnforcement(sessionId, context = {}, idempotencyKey = null, metadata = {}) {
  const { session } = await validateSessionForEnforcement(sessionId, context);
  const { adapter, key } = await resolveAdapterForSession(session);

  let result;
  try {
    result = await db.runTransaction(async (transaction) => {
      const enforcementRef = db.collection("roaming_enforcements").doc(sessionId);
      const enforcementDoc = await transaction.get(enforcementRef);

      if (idempotencyKey) {
        const existingSnap = await db
          .collection("roaming_enforcements")
          .where("idempotencyKey", "==", idempotencyKey)
          .limit(1)
          .get();

        if (!existingSnap.empty) {
          const existingDoc = existingSnap.docs[0];
          const existing = { id: existingDoc.id, ...existingDoc.data() };

          if (existing.sessionId !== sessionId) {
            throw new RoamingEnforcementError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Idempotency key exists for a different session"
            );
          }

          if (existing.status === "provisioned" || existing.status === "revoked" || existing.status === "disconnected") {
            return { isExisting: true, enforcement: existing };
          }
        }
      } else if (enforcementDoc.exists) {
        const existing = { id: enforcementDoc.id, ...enforcementDoc.data() };
        if (PROVISIONED_STATUSES.includes(existing.status)) {
          return { isExisting: true, enforcement: existing };
        }
      }

      if (enforcementDoc.exists) {
        const existing = enforcementDoc.data();
        if (existing.status === "provisioning" || existing.status === "pending") {
          throw new RoamingEnforcementError(
            409,
            "ENFORCEMENT_IN_PROGRESS",
            "Enforcement is already in progress for this session"
          );
        }
        if (!isValidEnforcementTransition(existing.status, "provisioned")) {
          throw new RoamingEnforcementError(
            409,
            "INVALID_ENFORCEMENT_STATE",
            `Cannot transition from ${existing.status} to provisioned`
          );
        }
      }

      const now = nowIso();
      const enforcementData = {
        enforcementId: enforcementRef.id,
        sessionId,
        userRef: session.userRef,
        homeOwnerId: session.homeOwnerId,
        visitedOwnerId: session.visitedOwnerId,
        visitedHotspotId: session.visitedHotspotId,
        entitlementId: session.entitlementId,
        aaaAdapterKey: key,
        status: "provisioning",
        provisionedAt: now,
        revokedAt: null,
        disconnectedAt: null,
        lastUsageAt: null,
        idempotencyKey: idempotencyKey || null,
        metadata: metadata || {},
        createdAt: enforcementDoc.exists ? enforcementDoc.data().createdAt : now,
        updatedAt: now,
      };

      transaction.set(enforcementRef, enforcementData, { merge: true });

      return { isExisting: false, enforcement: { id: enforcementRef.id, ...enforcementData } };
    });

    if (result.isExisting) {
      await logAuthEvent({
        eventType: "enforcement_provision_idempotent",
        userId: session.userRef.userId,
        entitlementId: session.entitlementId,
        homeOwnerId: session.homeOwnerId,
        visitedOwnerId: session.visitedOwnerId,
        visitedHotspotId: session.visitedHotspotId,
        sessionId,
        aaaAdapterKey: key,
        success: true,
      });

      return {
        success: true,
        sessionId,
        enforcement: result.enforcement,
        alreadyEnforced: true,
      };
    }

    let provisionResult;
    try {
      provisionResult = await adapter.provisionAccess(
        RoamingAAAAdapter.buildContext({
          sessionId,
          userRef: session.userRef,
          homeOwnerId: session.homeOwnerId,
          visitedOwnerId: session.visitedOwnerId,
          visitedHotspotId: session.visitedHotspotId,
          entitlementId: session.entitlementId,
          aaaAdapterKey: key,
        })
      );
    } catch (adapterErr) {
      const transaction = await db.runTransaction(async (t) => {
        const enfRef = db.collection("roaming_enforcements").doc(sessionId);
        t.set(enfRef, { status: "failed", updatedAt: nowIso() }, { merge: true });
      });

      await logAuthEvent({
        eventType: "enforcement_provision_failed",
        userId: session.userRef.userId,
        entitlementId: session.entitlementId,
        homeOwnerId: session.homeOwnerId,
        visitedOwnerId: session.visitedOwnerId,
        visitedHotspotId: session.visitedHotspotId,
        sessionId,
        aaaAdapterKey: key,
        success: false,
        reason: adapterErr.message,
      });

      if (adapterErr instanceof RoamingAAAAdapterError) {
        throw new RoamingEnforcementError(
          502,
          "ADAPTER_FAILURE",
          `AAA adapter '${key}' failed during provisioning: ${adapterErr.message}`
        );
      }
      throw new RoamingEnforcementError(
        502,
        "ADAPTER_FAILURE",
        "AAA adapter failed during provisioning"
      );
    }

    const updateTransaction = await db.runTransaction(async (transaction) => {
      const enfRef = db.collection("roaming_enforcements").doc(sessionId);
      const enfDoc = await transaction.get(enfRef);
      if (!enfDoc.exists) {
        throw new RoamingEnforcementError(
          404,
          "ENFORCEMENT_NOT_FOUND",
          "Enforcement record not found"
        );
      }
      const current = { id: enfDoc.id, ...enfDoc.data() };
      if (current.status === "failed") {
        throw new RoamingEnforcementError(
          409,
          "ENFORCEMENT_FAILED",
          "Enforcement already marked as failed"
        );
      }
      transaction.set(
        enfRef,
        {
          status: "provisioned",
          provisionedAt: current.provisionedAt,
          updatedAt: nowIso(),
        },
        { merge: true }
      );
      return { id: enfDoc.id, ...enfDoc.data(), status: "provisioned", updatedAt: nowIso() };
    });

    await logAuthEvent({
      eventType: "enforcement_provisioned",
      userId: session.userRef.userId,
      entitlementId: session.entitlementId,
      homeOwnerId: session.homeOwnerId,
      visitedOwnerId: session.visitedOwnerId,
      visitedHotspotId: session.visitedHotspotId,
      sessionId,
      aaaAdapterKey: key,
      success: true,
    });

    return {
      success: true,
      sessionId,
      enforcement: { ...result.enforcement, status: "provisioned" },
      alreadyEnforced: false,
      adapterResult: provisionResult,
    };
  } catch (err) {
    if (err instanceof RoamingEnforcementError) throw err;
    if (err instanceof RoamingAAAAdapterError) {
      throw new RoamingEnforcementError(
        502,
        "ADAPTER_FAILURE",
        "AAA adapter error during provisioning"
      );
    }
    throw new RoamingEnforcementError(
      500,
      "SERVER_ERROR",
      "Failed to provision roaming session enforcement"
    );
  }
}

async function revokeSessionEnforcement(sessionId, context = {}, reason = "admin_revoked") {
  const { session } = await validateSessionForEnforcement(sessionId, context);
  const { adapter, key } = await resolveAdapterForSession(session);

  let result;
  try {
    result = await db.runTransaction(async (transaction) => {
      const enfRef = db.collection("roaming_enforcements").doc(sessionId);
      const enfDoc = await transaction.get(enfRef);

      if (!enfDoc.exists) {
        throw new RoamingEnforcementError(
          404,
          "ENFORCEMENT_NOT_FOUND",
          "No enforcement record for this session"
        );
      }

      const existing = { id: enfDoc.id, ...enfDoc.data() };

      if (existing.status === "revoked") {
        return { alreadyRevoked: true, enforcement: existing };
      }

      if (!isValidEnforcementTransition(existing.status, "revoked")) {
        throw new RoamingEnforcementError(
          409,
          "INVALID_ENFORCEMENT_STATE",
          `Cannot transition from ${existing.status} to revoked`
        );
      }

      transaction.set(
        enfRef,
        {
          status: "revoked",
          revokedAt: nowIso(),
          endReason: reason,
          updatedAt: nowIso(),
        },
        { merge: true }
      );

      return {
        alreadyRevoked: false,
        enforcement: { ...existing, status: "revoked", revokedAt: nowIso() },
      };
    });

    if (result.alreadyRevoked) {
      await logAuthEvent({
        eventType: "enforcement_revoke_idempotent",
        userId: session.userRef.userId,
        entitlementId: session.entitlementId,
        homeOwnerId: session.homeOwnerId,
        visitedOwnerId: session.visitedOwnerId,
        visitedHotspotId: session.visitedHotspotId,
        sessionId,
        aaaAdapterKey: key,
        success: true,
      });

      return result;
    }

    try {
      await adapter.revokeAccess(
        RoamingAAAAdapter.buildContext({
          sessionId,
          userRef: session.userRef,
          homeOwnerId: session.homeOwnerId,
          visitedOwnerId: session.visitedOwnerId,
          visitedHotspotId: session.visitedHotspotId,
          entitlementId: session.entitlementId,
          aaaAdapterKey: key,
        })
      );
    } catch (adapterErr) {
      await logAuthEvent({
        eventType: "enforcement_revoke_adapter_failed",
        userId: session.userRef.userId,
        entitlementId: session.entitlementId,
        homeOwnerId: session.homeOwnerId,
        visitedOwnerId: session.visitedOwnerId,
        visitedHotspotId: session.visitedHotspotId,
        sessionId,
        aaaAdapterKey: key,
        success: false,
        reason: adapterErr.message,
      });

      if (adapterErr instanceof RoamingAAAAdapterError) {
        throw new RoamingEnforcementError(
          502,
          "ADAPTER_FAILURE",
          `AAA adapter '${key}' failed during revocation: ${adapterErr.message}`
        );
      }
      throw new RoamingEnforcementError(
        502,
        "ADAPTER_FAILURE",
        "AAA adapter failed during revocation"
      );
    }

    await logAuthEvent({
      eventType: "enforcement_revoked",
      userId: session.userRef.userId,
      entitlementId: session.entitlementId,
      homeOwnerId: session.homeOwnerId,
      visitedOwnerId: session.visitedOwnerId,
      visitedHotspotId: session.visitedHotspotId,
      sessionId,
      aaaAdapterKey: key,
      success: true,
    });

    return result;
  } catch (err) {
    if (err instanceof RoamingEnforcementError) throw err;
    if (err instanceof RoamingAAAAdapterError) {
      throw new RoamingEnforcementError(
        502,
        "ADAPTER_FAILURE",
        "AAA adapter error during revocation"
      );
    }
    throw new RoamingEnforcementError(
      500,
      "SERVER_ERROR",
      "Failed to revoke roaming session enforcement"
    );
  }
}

async function disconnectSessionEnforcement(sessionId, context = {}) {
  const { session } = await validateSessionForEnforcement(sessionId, context);
  const { adapter, key } = await resolveAdapterForSession(session);

  let result;
  try {
    result = await db.runTransaction(async (transaction) => {
      const enfRef = db.collection("roaming_enforcements").doc(sessionId);
      const enfDoc = await transaction.get(enfRef);

      if (!enfDoc.exists) {
        throw new RoamingEnforcementError(
          404,
          "ENFORCEMENT_NOT_FOUND",
          "No enforcement record for this session"
        );
      }

      const existing = { id: enfDoc.id, ...enfDoc.data() };

      if (existing.status === "disconnected") {
        return { alreadyDisconnected: true, enforcement: existing };
      }

      if (!isValidEnforcementTransition(existing.status, "disconnected")) {
        throw new RoamingEnforcementError(
          409,
          "INVALID_ENFORCEMENT_STATE",
          `Cannot transition from ${existing.status} to disconnected`
        );
      }

      transaction.set(
        enfRef,
        {
          status: "disconnected",
          disconnectedAt: nowIso(),
          updatedAt: nowIso(),
        },
        { merge: true }
      );

      return {
        alreadyDisconnected: false,
        enforcement: { ...existing, status: "disconnected", disconnectedAt: nowIso() },
      };
    });

    if (result.alreadyDisconnected) {
      await logAuthEvent({
        eventType: "enforcement_disconnect_idempotent",
        userId: session.userRef.userId,
        entitlementId: session.entitlementId,
        homeOwnerId: session.homeOwnerId,
        visitedOwnerId: session.visitedOwnerId,
        visitedHotspotId: session.visitedHotspotId,
        sessionId,
        aaaAdapterKey: key,
        success: true,
      });

      return result;
    }

    try {
      await adapter.disconnect(
        RoamingAAAAdapter.buildContext({
          sessionId,
          userRef: session.userRef,
          homeOwnerId: session.homeOwnerId,
          visitedOwnerId: session.visitedOwnerId,
          visitedHotspotId: session.visitedHotspotId,
          entitlementId: session.entitlementId,
          aaaAdapterKey: key,
        })
      );
    } catch (adapterErr) {
      await logAuthEvent({
        eventType: "enforcement_disconnect_adapter_failed",
        userId: session.userRef.userId,
        entitlementId: session.entitlementId,
        homeOwnerId: session.homeOwnerId,
        visitedOwnerId: session.visitedOwnerId,
        visitedHotspotId: session.visitedHotspotId,
        sessionId,
        aaaAdapterKey: key,
        success: false,
        reason: adapterErr.message,
      });

      throw new RoamingEnforcementError(
        502,
        "ADAPTER_FAILURE",
        "AAA adapter failed during disconnect"
      );
    }

    await logAuthEvent({
      eventType: "enforcement_disconnected",
      userId: session.userRef.userId,
      entitlementId: session.entitlementId,
      homeOwnerId: session.homeOwnerId,
      visitedOwnerId: session.visitedOwnerId,
      visitedHotspotId: session.visitedHotspotId,
      sessionId,
      aaaAdapterKey: key,
      success: true,
    });

    return result;
  } catch (err) {
    if (err instanceof RoamingEnforcementError) throw err;
    if (err instanceof RoamingAAAAdapterError) {
      throw new RoamingEnforcementError(
        502,
        "ADAPTER_FAILURE",
        "AAA adapter error during disconnect"
      );
    }
    throw new RoamingEnforcementError(
      500,
      "SERVER_ERROR",
      "Failed to disconnect roaming session enforcement"
    );
  }
}

async function getSessionUsage(sessionId, context = {}) {
  const { session } = await validateSessionForEnforcement(sessionId, context);
  const { adapter, key } = await resolveAdapterForSession(session);

  let usage;
  try {
    usage = await adapter.getUsage(
      RoamingAAAAdapter.buildContext({
        sessionId,
        userRef: session.userRef,
        homeOwnerId: session.homeOwnerId,
        visitedOwnerId: session.visitedOwnerId,
        visitedHotspotId: session.visitedHotspotId,
        entitlementId: session.entitlementId,
        aaaAdapterKey: key,
      })
    );
  } catch (adapterErr) {
    throw new RoamingEnforcementError(
      502,
      "ADAPTER_FAILURE",
      "AAA adapter failed during usage retrieval"
    );
  }

  try {
    const enfRef = db.collection("roaming_enforcements").doc(sessionId);
    const enfDoc = await enfRef.get();
    if (enfDoc.exists) {
      await enfRef.set(
        {
          lastUsageAt: nowIso(),
          updatedAt: nowIso(),
          usage: {
            usedMinutes: usage.usedMinutes || 0,
            usedMegabytes: usage.usedMegabytes || 0,
          },
        },
        { merge: true }
      );
    }
  } catch (err) {
    // Non-fatal: enforcement record update failed, but usage is returned
  }

  await logAuthEvent({
    eventType: "enforcement_usage_retrieved",
    userId: session.userRef.userId,
    entitlementId: session.entitlementId,
    homeOwnerId: session.homeOwnerId,
    visitedOwnerId: session.visitedOwnerId,
    visitedHotspotId: session.visitedHotspotId,
    sessionId,
    aaaAdapterKey: key,
    success: true,
  });

  return {
    sessionId,
    usage: {
      usedMinutes: usage.usedMinutes || 0,
      usedMegabytes: usage.usedMegabytes || 0,
    },
    adapterKey: key,
    lastSampledAt: usage.lastSampledAt || null,
  };
}

async function checkEnforcementHealth(adapterKey) {
  if (!adapterKey || typeof adapterKey !== "string") {
    throw new RoamingEnforcementError(
      400,
      "VALIDATION_ERROR",
      "Adapter key is required for health check"
    );
  }

  if (!isAAAAdapterAvailable(adapterKey)) {
    throw new RoamingEnforcementError(
      503,
      "ADAPTER_UNAVAILABLE",
      `AAA adapter '${adapterKey}' is registered but unavailable`
    );
  }

  let adapter;
  try {
    adapter = resolveAAAAdapter(adapterKey);
  } catch (err) {
    throw new RoamingEnforcementError(
      503,
      "ADAPTER_UNAVAILABLE",
      `AAA adapter '${adapterKey}' is not available: ${err.message}`
    );
  }

  let health;
  try {
    health = await adapter.checkHealth();
  } catch (adapterErr) {
    throw new RoamingEnforcementError(
      503,
      "ADAPTER_UNHEALTHY",
      `AAA adapter '${adapterKey}' health check failed: ${adapterErr.message}`
    );
  }

  return {
    adapterKey: adapterKey,
    healthy: health && health.healthy === true,
    details: health,
  };
}

module.exports = {
  RoamingEnforcementError,
  ENFORCEMENT_STATUSES,
  PROVISIONED_STATUSES,
  ENFORCEMENT_STATE_TRANSITIONS,
  SESSION_ENFORCEABLE_STATUSES,
  validateSessionForEnforcement,
  resolveAdapterForSession,
  provisionSessionEnforcement,
  revokeSessionEnforcement,
  disconnectSessionEnforcement,
  getSessionUsage,
  checkEnforcementHealth,
  isValidEnforcementTransition,
};
