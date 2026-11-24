const { db } = require("../firebase");
const { logAuthEvent } = require("./roamingAuthService");
const { checkEntitlementEligibility } = require("./roamingEntitlementService");
const { getRoamingSession, SESSION_STATUSES, ACTIVE_STATUSES, RoamingSessionError } = require("./roamingSessionService");
const {
  resolveAAAAdapter,
  isAAAAdapterAvailable,
  getAAAAdapterEntry,
  RoamingAAAAdapterRegistryError,
} = require("./roamingAAAAdapterRegistry");
const { RoamingAAAAdapter, RoamingAAAAdapterError, nowIso } = require("./roamingAAAAdapter");
const { resolveMikroTikContext } = require("./roamingRegistryService");
const { MikrotikEnforcementAdapter } = require("./mikrotik/mikrotikEnforcementAdapter");
const { createMockRouterOsTransport } = require("./mikrotik/mockRouterOsTransport");
const { createMikroTikTransport } = require("./mikrotik/routerOsTransport");
const { createStaticTestSecretResolver, createProductionSecretResolver } = require("./mikrotik/secrets");
const { createRouterOsClient, getCircuitBreakerStatus, CIRCUIT_STATES, buildHealthCommand } = require("./mikrotik/routerOsClient");
const { isMikrotikApiEnabled, isTestModeAllowed, assertMikrotikApiEnabled } = require("./mikrotik/featureFlag");

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

  // Special handling for MikroTik adapter: resolve context and create adapter instance
  if (key === "mikrotik") {
    // Check global flag BEFORE creating adapter or any test dependencies.
    // In production, the global flag MUST be explicitly enabled.
    // In non-production, test mode is allowed.
    const isProd = process.env.NODE_ENV === "production";
    if (!isMikrotikApiEnabled() && !isTestModeAllowed()) {
      throw new RoamingEnforcementError(
        503,
        "ADAPTER_DISABLED",
        "MikroTik adapter is disabled: ROAMING_MIKROTIK_API_ENABLED is not true",
        { reason: "global_kill_switch" },
      );
    }

    const context = await resolveMikroTikContext(session);

    // Determine test mode: only allowed in non-production environments.
    // Never enable test mode from request/session input.
    const isTestMode = process.env.NODE_ENV !== "production";

    // Create transport: mock in test/non-production; fail closed in production (no live transport yet).
    let transport;
    let secretResolver;
    if (process.env.NODE_ENV !== "production") {
      transport = createMockRouterOsTransport({ script: [] });
      secretResolver = createStaticTestSecretResolver({});

      const client = createRouterOsClient({
        transport,
        sleepMs: async () => {},
      });

      const adapter = new MikrotikEnforcementAdapter({
        device: context.device,
        remainingRaus: context.remainingRaus,
        secretResolver,
        client,
        testMode: true,
        timeoutMs: context.routerConfig.timeoutMs,
        retries: context.routerConfig.retries,
        identityKey: process.env.MIKROTIK_IDENTITY_KEY,
      });

      return { adapter, key, transport };
    } else {
      // Production: resolve secret once, construct live transport, client, and adapter.
      // If transport creation succeeds but client or adapter construction fails,
      // close the already-created transport before propagating the original error.
      let productionTransport = null;
      try {
        const productionSecretResolver = createProductionSecretResolver({
          encryptionKey: process.env.MIKROTIK_SECRET_ENCRYPTION_KEY,
        });

        const resolvedPassword = await productionSecretResolver.resolveSecret({
          secretReference: context.routerConfig.apiSecretRef,
          ownerId: context.device.ownerId,
          deviceId: context.device.deviceId,
        });

        productionTransport = createMikroTikTransport({
          host: context.routerConfig.host,
          port: context.routerConfig.port,
          tls: context.routerConfig.tls,
          credentials: {
            username: context.routerConfig.apiUsername,
            password: resolvedPassword,
          },
          timeoutMs: context.routerConfig.timeoutMs,
          retries: context.routerConfig.retries,
          connectTimeoutMs: 10000,
        });

        const client = createRouterOsClient({
          transport: productionTransport,
          sleepMs: async () => {},
          timeoutMs: context.routerConfig.timeoutMs,
          retries: context.routerConfig.retries,
        });

        secretResolver = productionSecretResolver;

        const adapter = new MikrotikEnforcementAdapter({
          device: context.device,
          remainingRaus: context.remainingRaus,
          secretResolver,
          client,
          testMode: false,
          timeoutMs: context.routerConfig.timeoutMs,
          retries: context.routerConfig.retries,
          identityKey: process.env.MIKROTIK_IDENTITY_KEY,
          apiPassword: resolvedPassword,
        });

        transport = productionTransport;
        return { adapter, key, transport };
      } catch (err) {
        // Construction failure: close any transport that was created before
        // propagating the original error. Cleanup failure must never mask it.
        if (productionTransport && typeof productionTransport.close === "function") {
          try {
            await productionTransport.close();
          } catch (closeErr) {
            try {
              await logAuthEvent({
                eventType: "enforcement_transport_construction_cleanup_failed",
                operation: "resolveAdapter",
                sessionId: session.sessionId,
                aaaAdapterKey: key,
                success: false,
                reason: "transport_construction_cleanup_failed",
              });
            } catch (diagErr) {
              // Diagnostic recording failure must never mask the original error.
            }
          }
        }
        throw err;
      }
    }
  }

  // Standard adapter resolution for other adapter types
  const entry = getAAAAdapterEntry(key);
  if (entry && !entry.enabled) {
    throw new RoamingEnforcementError(
      503,
      "ADAPTER_DISABLED",
      `AAA adapter '${key}' is explicitly disabled`
    );
  }

  if (!entry || entry.state === "error") {
    throw new RoamingEnforcementError(
      503,
      "ADAPTER_UNAVAILABLE",
      `AAA adapter '${key}' is registered but unavailable (state: ${entry ? entry.state : "not_registered"})`
    );
  }

  let adapter;
  try {
    adapter = resolveAAAAdapter(key);
  } catch (err) {
    if (err instanceof RoamingAAAAdapterRegistryError) {
      throw new RoamingEnforcementError(
        503,
        err.code === "ADAPTER_NOT_FOUND"
          ? "ADAPTER_UNAVAILABLE"
          : "ADAPTER_UNAVAILABLE",
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

  const caps = typeof adapter.getCapabilities === "function" ? adapter.getCapabilities() : {};
  if (caps && caps.provisionAccess === false) {
    throw new RoamingEnforcementError(
      501,
      "ADAPTER_NOT_IMPLEMENTED",
      `Adapter '${key}' does not support provisionAccess capability`
    );
  }

  return { adapter, key };
}

function checkAdapterCapability(adapter, operation) {
  const caps = typeof adapter.getCapabilities === "function" ? adapter.getCapabilities() : {};
  if (caps && caps[operation] === false) {
    throw new RoamingEnforcementError(
      501,
      "ADAPTER_NOT_IMPLEMENTED",
      `Adapter '${adapter.aaaAdapterKey}' does not support ${operation} capability`
    );
  }
}

async function provisionSessionEnforcement(sessionId, context = {}, idempotencyKey = null, metadata = {}) {
  const { session } = await validateSessionForEnforcement(sessionId, context);
  const { adapter, key, transport } = await resolveAdapterForSession(session);

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
      checkAdapterCapability(adapter, "provisionAccess");
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
  } finally {
    if (transport && typeof transport.close === "function") {
      try {
        await transport.close();
      } catch (closeErr) {
        // Sanitized internal diagnostic: cleanup failure must not mask
        // the original operation error or expose credentials.
        try {
          await logAuthEvent({
            eventType: "enforcement_transport_cleanup_failed",
            operation: "provision",
            sessionId,
            aaaAdapterKey: key,
            success: false,
            reason: "transport_cleanup_failed",
          });
        } catch (diagErr) {
          // Diagnostic recording failure must never mask the original error.
        }
      }
    }
  }
}

async function revokeSessionEnforcement(sessionId, context = {}, reason = "admin_revoked") {
  const { session } = await validateSessionForEnforcement(sessionId, context);
  const { adapter, key, transport } = await resolveAdapterForSession(session);

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
      checkAdapterCapability(adapter, "revokeAccess");
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

    return {
      success: true,
      sessionId,
      enforcement: result.enforcement,
      alreadyRevoked: false,
      adapterResult: result,
    };
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
  } finally {
    if (transport && typeof transport.close === "function") {
      try {
        await transport.close();
      } catch (closeErr) {
        // Sanitized internal diagnostic: cleanup failure must not mask
        // the original operation error or expose credentials.
        try {
          await logAuthEvent({
            eventType: "enforcement_transport_cleanup_failed",
            operation: "revoke",
            sessionId,
            aaaAdapterKey: key,
            success: false,
            reason: "transport_cleanup_failed",
          });
        } catch (diagErr) {
          // Diagnostic recording failure must never mask the original error.
        }
      }
    }
  }
}

async function disconnectSessionEnforcement(sessionId, context = {}) {
  const { session } = await validateSessionForEnforcement(sessionId, context);
  const { adapter, key, transport } = await resolveAdapterForSession(session);

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
      checkAdapterCapability(adapter, "disconnect");
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

    return {
      success: true,
      sessionId,
      enforcement: result.enforcement,
      alreadyDisconnected: false,
      adapterResult: result,
    };
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
  } finally {
    if (transport && typeof transport.close === "function") {
      try {
        await transport.close();
      } catch (closeErr) {
        // Sanitized internal diagnostic: cleanup failure must not mask
        // the original operation error or expose credentials.
        try {
          await logAuthEvent({
            eventType: "enforcement_transport_cleanup_failed",
            operation: "disconnect",
            sessionId,
            aaaAdapterKey: key,
            success: false,
            reason: "transport_cleanup_failed",
          });
        } catch (diagErr) {
          // Diagnostic recording failure must never mask the original error.
        }
      }
    }
  }
}

async function getSessionUsage(sessionId, context = {}) {
  const { session } = await validateSessionForEnforcement(sessionId, context);
  const { adapter, key, transport } = await resolveAdapterForSession(session);

  try {
    let usage;
    try {
      checkAdapterCapability(adapter, "getUsage");
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
  } finally {
    if (transport && typeof transport.close === "function") {
      try {
        await transport.close();
      } catch (closeErr) {
        // Sanitized internal diagnostic: cleanup failure must not mask
        // the original operation error or expose credentials.
        try {
          await logAuthEvent({
            eventType: "enforcement_transport_cleanup_failed",
            operation: "usage",
            sessionId,
            aaaAdapterKey: key,
            success: false,
            reason: "transport_cleanup_failed",
          });
        } catch (diagErr) {
          // Diagnostic recording failure must never mask the original error.
        }
      }
    }
  }
}

/**
 * Session-scoped MikroTik router health check.
 *
 * Requires explicit authenticated session and user/owner context. Validates
 * the session via validateSessionForEnforcement() before constructing the
 * inline MikroTik adapter or contacting the router.
 *
 * For CLOSED circuits: calls transport.execute() directly with buildHealthCommand()
 * (never adapter.checkHealth(), client.health(), or executeCommand()), so the
 * circuit breaker's canExecute()/recordFailure()/recordSuccess() are never
 * triggered by this path.
 *
 * For OPEN/HALF_OPEN: returns DEGRADED without router contact or breaker
 * state transition.
 *
 * @param {string} sessionId - Roaming session ID (required)
 * @param {object} context - Authenticated context with userId and/or ownerId (required)
 * @returns {Promise<object>} Health result
 */
async function checkMikroTikRouterHealth(sessionId, context) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new RoamingEnforcementError(
      400,
      "VALIDATION_ERROR",
      "Session ID is required for MikroTik router health check"
    );
  }

  if (!context || typeof context !== "object") {
    throw new RoamingEnforcementError(
      400,
      "VALIDATION_ERROR",
      "Authenticated context is required for MikroTik router health check"
    );
  }

  if (
    context.userId === undefined &&
    context.ownerId === undefined
  ) {
    throw new RoamingEnforcementError(
      400,
      "VALIDATION_ERROR",
      "Context must include userId or ownerId"
    );
  }

  const resolvedUserId = context.userId || null;
  const resolvedOwnerId = context.ownerId || null;

  if (resolvedUserId === null && resolvedOwnerId === null) {
    throw new RoamingEnforcementError(
      400,
      "VALIDATION_ERROR",
      "Context must include userId or ownerId"
    );
  }

  // Full session authorization: status, expiry, ownership, entitlement
  const validation = await validateSessionForEnforcement(sessionId, context);
  const session = validation.session;

  // Device ownership, hotspot, managed-network, API-enabled, secret-ref, remaining-RAU validation
  let contextResolved;
  try {
    contextResolved = await resolveMikroTikContext(session);
  } catch (err) {
    throw new RoamingEnforcementError(
      503,
      "ADAPTER_UNAVAILABLE",
      `MikroTik context resolution failed: ${err.message}`
    );
  }

  const { host, port } = contextResolved.routerConfig;

  // Read-only circuit breaker inspection — no creation, no state change, no probe consumption
  const breakerStatus = getCircuitBreakerStatus(host, port);

  if (breakerStatus.state === CIRCUIT_STATES.OPEN || breakerStatus.state === CIRCUIT_STATES.HALF_OPEN) {
    return {
      adapterKey: "mikrotik",
      healthy: false,
      state: "degraded",
      reason: breakerStatus.state === CIRCUIT_STATES.OPEN ? "circuit_open" : "half_open",
      breaker: breakerStatus,
      checkedAt: new Date().toISOString(),
    };
  }

  // CLOSED: construct inline adapter/client/transport, probe via transport.execute() directly
  let transport = null;
  try {
    const { transport: resolvedTransport } = await resolveAdapterForSession(session);
    transport = resolvedTransport;

    const result = await transport.execute({
      command: buildHealthCommand(),
      attempt: 1,
    });

    if (!result || result.ok !== true) {
      throw new RoamingEnforcementError(
        503,
        "ADAPTER_UNHEALTHY",
        "MikroTik router health probe returned an unsuccessful result",
        { details: result }
      );
    }

    return {
      adapterKey: "mikrotik",
      healthy: true,
      state: "healthy",
      details: {
        reachable: true,
        state: "reachable",
        attempts: result.attempts || 1,
        checkedAt: new Date().toISOString(),
      },
      breaker: breakerStatus,
      checkedAt: new Date().toISOString(),
    };
  } catch (probeErr) {
    if (probeErr instanceof RoamingEnforcementError) {
      throw probeErr;
    }
    throw new RoamingEnforcementError(
      503,
      "ADAPTER_UNHEALTHY",
      `MikroTik router health check failed: ${probeErr.message}`
    );
  } finally {
    if (transport && typeof transport.close === "function") {
      try {
        await transport.close();
      } catch (closeErr) {
        try {
          await logAuthEvent({
            eventType: "enforcement_transport_cleanup_failed",
            operation: "mikrotik_router_health",
            sessionId,
            aaaAdapterKey: "mikrotik",
            success: false,
            reason: "transport_cleanup_failed",
          });
        } catch (diagErr) {
          // Diagnostic recording failure must never mask the original error.
        }
      }
    }
  }
}

async function checkEnforcementHealth(adapterKey, session = null) {
  if (!adapterKey || typeof adapterKey !== "string") {
    throw new RoamingEnforcementError(
      400,
      "VALIDATION_ERROR",
      "Adapter key is required for health check"
    );
  }

  // MikroTik-specific branch using the inline construction path
  if (adapterKey === "mikrotik") {
    if (!session || typeof session !== "object") {
      throw new RoamingEnforcementError(
        400,
        "VALIDATION_ERROR",
        "Session is required for MikroTik health check"
      );
    }

    let context;
    try {
      context = await resolveMikroTikContext(session);
    } catch (err) {
      throw new RoamingEnforcementError(
        503,
        "ADAPTER_UNAVAILABLE",
        `MikroTik context resolution failed: ${err.message}`
      );
    }

    const { host, port } = context.routerConfig;

    // Read-only circuit breaker inspection — no state change, no creation, no probe consumption
    const breakerStatus = getCircuitBreakerStatus(host, port);

    if (breakerStatus.state === CIRCUIT_STATES.OPEN || breakerStatus.state === CIRCUIT_STATES.HALF_OPEN) {
      return {
        adapterKey,
        healthy: false,
        state: "degraded",
        reason: breakerStatus.state === CIRCUIT_STATES.OPEN ? "circuit_open" : "half_open",
        breaker: breakerStatus,
        checkedAt: new Date().toISOString(),
      };
    }

    // CLOSED: proceed with inline adapter construction and direct health probe
    let transport = null;
    try {
      const { adapter, transport: resolvedTransport } = await resolveAdapterForSession(session);
      transport = resolvedTransport;

      const health = await adapter.checkHealth();

      return {
        adapterKey,
        healthy: health && health.healthy === true,
        state: "healthy",
        details: health,
        breaker: breakerStatus,
        checkedAt: new Date().toISOString(),
      };
    } catch (adapterErr) {
      throw new RoamingEnforcementError(
        503,
        "ADAPTER_UNHEALTHY",
        `MikroTik adapter '${adapterKey}' health check failed: ${adapterErr.message}`
      );
    } finally {
      if (transport && typeof transport.close === "function") {
        try {
          await transport.close();
        } catch (closeErr) {
          try {
            await logAuthEvent({
              eventType: "enforcement_transport_cleanup_failed",
              operation: "health",
              sessionId: session.sessionId,
              aaaAdapterKey: adapterKey,
              success: false,
              reason: "transport_cleanup_failed",
            });
          } catch (diagErr) {
            // Diagnostic recording failure must never mask the original error.
          }
        }
      }
    }
  }

  // Existing AAA path for non-MikroTik adapters (unchanged)
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
  checkMikroTikRouterHealth,
  isValidEnforcementTransition,
};
