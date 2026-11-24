// Phase 8.5B — MikroTik enforcement adapter (mocked transport only).
//
// This adapter translates the existing YabaLink enforcement contract
// (RoamingAAAAdapter) into the Phase 8.5A MikroTik hotspot-control primitives.
//
// DESIGN CONSTRAINTS
//   * NO live RouterOS transport — uses injected mocked/in-memory transport only.
//   * NO production secret resolution — uses injected test resolver only.
//   * NO registration in server.js — the live enforcement seam uses
//     RoamingAAAAdapter.buildContext which does not carry device/remainingRaus/
//     secretResolver/client. This adapter is dependency-injected and can be
//     exercised directly by tests. A future phase wires it into the live seam
//     once the context contract is extended.
//   * REUSES Phase 8.5A primitives — provisionUser, removeUser,
//     disconnectActiveUser, checkHealth, buildHotspotUserConfig,
//     deriveRouterUsername, generateHotspotPassword, assertMutationAllowed.
//   * FAILS CLOSED — global/device kill switches, network-control checks,
//     missing secret reference, invalid snapshot all prevent any transport call.
//
// CONTRACT WITH ROAMINGAAAADAPTER
//   Extends RoamingAAAAdapter so it could be registered later. Implements
//   provisionAccess, revokeAccess, disconnect, getUsage, checkHealth.
//   Advertises capabilities exactly matching Phase 8.5A reach: provisionAccess,
//   revokeAccess, disconnect, getUsage, checkHealth (all true).
//
// INPUT CONTEXT (beyond the base buildContext fields)
//   The adapter requires additional fields that the live context does NOT yet
//   carry. Callers MUST supply them via the injected config or by extending
//   the context object passed to the method:
//
//   REQUIRED for mutation (provision/revoke/disconnect):
//     - device: full device document (must satisfy assertMutationAllowed)
//     - remainingRaus: integer > 0 (authoritative RAU count from entitlement)
//     - secretResolver: { resolveSecret(args) -> Promise<string> }
//     - client: RouterOS client from createRouterOsClient() or null (injected)
//
//   OPTIONAL:
//     - routerUsername: pre-derived username (else derived via identity)
//     - routerPassword: pre-generated HotSpot password (else generated)
//     - testMode: boolean (allows operation when global flag is off in non-production)
//
//   NOT YET CARRIED BY LIVE SEAM (documented gap):
//     The live RoamingAAAAdapter.buildContext in
//     backend/services/roamingAAAAdapter.js:116-133 does NOT include device,
//     remainingRaus, secretResolver, or client. Until that contract is extended,
//     this adapter cannot be registered in server.js without modifying the
//     forbidden files. This adapter is therefore exercised directly by the
//     Phase 8.5B checker.

const {
  RoamingAAAAdapter,
  RoamingAAAAdapterError,
  ENFORCEMENT_RESULT_SUCCESS,
} = require("../roamingAAAAdapter");

const {
  mikrotikError,
  MIKROTIK_ERROR_CODES,
  isMikrotikError,
  describeMikrotikError,
} = require("./errors");

const {
  NETWORK_CONTROL_MODES,
  isMikrotikApiEnabled,
} = require("./featureFlag");

const {
  deriveRouterUsername,
  generateHotspotPassword,
} = require("./identity");

const {
  createStaticTestSecretResolver,
} = require("./secrets");

const {
  buildHotspotUserConfig,
  provisionUser,
  removeUser,
  disconnectActiveUser,
  checkHealth,
  assertMutationAllowed,
} = require("./hotspotUserService");

const {
  createRouterOsClient,
  MIKROTIK_DEFAULT_TIMEOUT_MS,
  MIKROTIK_DEFAULT_RETRIES,
} = require("./routerOsClient");

const MIKROTIK_ADAPTER_KEY = "mikrotik";
const MIKROTIK_ENFORCEMENT_MODE = "mikrotik_routeros";

const MIKROTIK_ADAPTER_CAPABILITIES = Object.freeze({
  authenticate: false,
  authorize: false,
  provisionAccess: true,
  revokeAccess: true,
  disconnect: true,
  getUsage: true,
  checkHealth: true,
});

function unsupportedMethod(method) {
  return new RoamingAAAAdapterError(
    501,
    "ADAPTER_NOT_IMPLEMENTED",
    `MikroTik adapter does not support ${method} in Phase 8.5B`,
    { method, adapterKey: MIKROTIK_ADAPTER_KEY, supported: Object.keys(MIKROTIK_ADAPTER_CAPABILITIES) },
  );
}

function mapMikrotikToAdapterError(err) {
  if (err instanceof RoamingAAAAdapterError) return err;
  if (isMikrotikError(err)) {
    const aaa = err.aaaError || { code: "ADAPTER_FAILURE", status: 502 };
    const mapped = new RoamingAAAAdapterError(
      aaa.status,
      aaa.code,
      err.message ? err.message : "MikroTik router control failure",
      { mikrotikCode: err.code, details: err.details },
    );
    return mapped;
  }
  return new RoamingAAAAdapterError(
    502,
    "ADAPTER_FAILURE",
    err && err.message ? err.message : "Unknown MikroTik adapter error",
    { original: describeMikrotikError(err) },
  );
}

class MikrotikEnforcementAdapter extends RoamingAAAAdapter {
  constructor(config = {}) {
    super({
      ...config,
      aaaAdapterKey: MIKROTIK_ADAPTER_KEY,
      enforcementMode: MIKROTIK_ENFORCEMENT_MODE,
      capabilities: { ...MIKROTIK_ADAPTER_CAPABILITIES },
    });

    // Injected dependencies (required for mutation operations)
    this._device = config.device || null;
    this._remainingRaus = config.remainingRaus;
    this._secretResolver = config.secretResolver || null;
    this._client = config.client || null;

    // Optional pre-derived credentials
    this._routerUsername = config.routerUsername || null;
    this._routerPassword = config.routerPassword || null;
    this._identityKey = config.identityKey || null;
    this._apiPassword = config.apiPassword || null;

    // Test mode (allows operation when global flag is off in non-production)
    this._testMode = config.testMode === true;
    this._timeoutMs = config.timeoutMs;
    this._retries = config.retries;

    // Internal state for idempotency tracking
    this._provisionedSessions = new Map();
  }

  getCapabilities() {
    return MIKROTIK_ADAPTER_CAPABILITIES;
  }

  /**
   * Non-sensitive description of the adapter wiring.
   */
  describe() {
    return {
      adapterKey: MIKROTIK_ADAPTER_KEY,
      enforcementMode: MIKROTIK_ENFORCEMENT_MODE,
      phase: "8.5B",
      registeredInServer: false,
      capabilities: { ...MIKROTIK_ADAPTER_CAPABILITIES },
      deviceBound: Boolean(this._device && this._device.deviceId),
      secretResolverInjected: Boolean(this._secretResolver && typeof this._secretResolver.resolveSecret === "function"),
      clientInjected: Boolean(this._client && typeof this._client.addHotspotUser === "function"),
      testMode: this._testMode,
    };
  }

  toJSON() {
    return this.describe();
  }

  _requireMutationContext(context) {
    if (!context || typeof context !== "object") {
      throw new RoamingAAAAdapterError(400, "VALIDATION_ERROR", "Adapter context is required");
    }
    if (!this._device) {
      throw new RoamingAAAAdapterError(
        503,
        "ADAPTER_UNAVAILABLE",
        "MikroTik adapter requires a device to be bound",
        { missing: "device" },
      );
    }
    // Owner isolation: a session may only be enforced on the device owned by the
    // session's visitedOwnerId. The visited router belongs to the visited hotspot
    // owner, not the user's home network owner. This prevents Owner A from
    // provisioning network access on Owner B's router.
    if (!this._device.ownerId || typeof this._device.ownerId !== "string" || this._device.ownerId.trim().length === 0) {
      throw new RoamingAAAAdapterError(
        403,
        "UNAUTHORIZED_SCOPE",
        "Device has no valid owner identifier",
        { reason: "device_owner_missing" },
      );
    }
    if (!context.visitedOwnerId || typeof context.visitedOwnerId !== "string" || context.visitedOwnerId.trim().length === 0) {
      throw new RoamingAAAAdapterError(
        403,
        "UNAUTHORIZED_SCOPE",
        "Session context missing valid visitedOwnerId",
        { reason: "visited_owner_missing" },
      );
    }
    if (this._device.ownerId !== context.visitedOwnerId) {
      throw new RoamingAAAAdapterError(
        403,
        "UNAUTHORIZED_SCOPE",
        "Device owner does not match session visitedOwnerId",
        { deviceOwnerId: "[REDACTED]", reason: "owner_mismatch" },
      );
    }
    if (this._remainingRaus === undefined || this._remainingRaus === null) {
      throw new RoamingAAAAdapterError(
        503,
        "ADAPTER_UNAVAILABLE",
        "MikroTik adapter requires remainingRaus to be supplied",
        { missing: "remainingRaus" },
      );
    }
    if (!this._secretResolver || typeof this._secretResolver.resolveSecret !== "function") {
      throw new RoamingAAAAdapterError(
        503,
        "ADAPTER_UNAVAILABLE",
        "MikroTik adapter requires a secret resolver",
        { missing: "secretResolver" },
      );
    }
    if (!this._client || typeof this._client.addHotspotUser !== "function") {
      throw new RoamingAAAAdapterError(
        503,
        "ADAPTER_UNAVAILABLE",
        "MikroTik adapter requires a RouterOS client",
        { missing: "client" },
      );
    }
  }

  /**
   * Build the hotspot user configuration from context + injected state.
   */
  _buildConfig(context) {
    this._requireMutationContext(context);

    // Derive or use pre-supplied router username
    const routerUsername =
      this._routerUsername || deriveRouterUsername({
        sessionId: context.sessionId,
        homeOwnerId: context.homeOwnerId,
      }, { identityKey: this._identityKey || undefined });

    // Generate or use pre-supplied hotspot password
    const routerPassword = this._routerPassword || generateHotspotPassword();

    // Build config using Phase 8.5A primitives
    return buildHotspotUserConfig({
      routerUsername,
      routerPassword,
      remainingRaus: this._remainingRaus,
      session: {
        sessionId: context.sessionId,
        homeOwnerId: context.homeOwnerId,
        visitedOwnerId: context.visitedOwnerId,
        visitedHotspotId: context.visitedHotspotId,
      },
      entitlement: {
        entitlementId: context.entitlementId,
      },
      device: this._device,
    });
  }

  async provisionAccess(context) {
    this._requireMutationContext(context);

    // Idempotency: same session -> same username -> report as already provisioned
    if (this._provisionedSessions.has(context.sessionId)) {
      return {
        result: ENFORCEMENT_RESULT_SUCCESS,
        alreadyProvisioned: true,
        sessionId: context.sessionId,
      };
    }

    try {
      const config = this._buildConfig(context);

      // Call Phase 8.5A provisionUser with all injected dependencies
      const result = await provisionUser({
        device: this._device,
        config,
        secretResolver: this._secretResolver,
        client: this._client,
        apiPassword: this._apiPassword,
        testMode: this._testMode,
        timeoutMs: this._timeoutMs,
        retries: this._retries,
      });

      // Track for idempotency
      this._provisionedSessions.set(context.sessionId, {
        provisionedAt: new Date().toISOString(),
        routerUsername: config.routerUsername,
        routerPassword: config.routerPassword,
      });

      return Object.freeze({
        result: ENFORCEMENT_RESULT_SUCCESS,
        alreadyProvisioned: result.alreadyExisted,
        sessionId: context.sessionId,
        enforcementState: {
          routerUsername: result.routerUsername,
          networkControl: result.networkControl,
          limitUptimeSeconds: result.limitUptimeSeconds,
          sharedUsers: result.sharedUsers,
          sharedUsersSource: result.sharedUsersSource,
          sharedUsersUndetermined: result.sharedUsersUndetermined,
        },
      });
    } catch (err) {
      throw mapMikrotikToAdapterError(err);
    } finally {
      this._apiPassword = null;
    }
  }

  async revokeAccess(context) {
    this._requireMutationContext(context);

    const sessionRecord = this._provisionedSessions.get(context.sessionId);
    if (!sessionRecord) {
      return {
        result: ENFORCEMENT_RESULT_SUCCESS,
        alreadyRevoked: true,
        sessionId: context.sessionId,
      };
    }

    try {
      const config = this._buildConfig(context);

      const result = await removeUser({
        device: this._device,
        config,
        secretResolver: this._secretResolver,
        client: this._client,
        apiPassword: this._apiPassword,
        testMode: this._testMode,
        timeoutMs: this._timeoutMs,
        retries: this._retries,
      });

      // Clear provisioned state
      this._provisionedSessions.delete(context.sessionId);

      return Object.freeze({
        result: ENFORCEMENT_RESULT_SUCCESS,
        alreadyRevoked: result.alreadyAbsent,
        sessionId: context.sessionId,
      });
    } catch (err) {
      throw mapMikrotikToAdapterError(err);
    } finally {
      this._apiPassword = null;
    }
  }

  async disconnect(context) {
    this._requireMutationContext(context);

    const sessionRecord = this._provisionedSessions.get(context.sessionId);
    if (!sessionRecord || sessionRecord.disconnected) {
      return {
        result: ENFORCEMENT_RESULT_SUCCESS,
        alreadyDisconnected: true,
        sessionId: context.sessionId,
      };
    }

    try {
      const config = this._buildConfig(context);

      const result = await disconnectActiveUser({
        device: this._device,
        config,
        secretResolver: this._secretResolver,
        client: this._client,
        apiPassword: this._apiPassword,
        testMode: this._testMode,
        timeoutMs: this._timeoutMs,
        retries: this._retries,
      });

      // Mark as disconnected but keep the provisioned user
      sessionRecord.disconnected = true;
      sessionRecord.disconnectedAt = new Date().toISOString();
      this._provisionedSessions.set(context.sessionId, sessionRecord);

      return Object.freeze({
        result: ENFORCEMENT_RESULT_SUCCESS,
        alreadyDisconnected: result.alreadyAbsent,
        sessionId: context.sessionId,
      });
    } catch (err) {
      throw mapMikrotikToAdapterError(err);
    } finally {
      this._apiPassword = null;
    }
  }

  async getUsage(context) {
    this._requireMutationContext(context);

    const sessionRecord = this._provisionedSessions.get(context.sessionId);
    if (!sessionRecord) {
      return {
        usedMinutes: 0,
        usedMegabytes: 0,
        sessionId: context.sessionId,
        lastSampledAt: null,
      };
    }

    // The mocked transport has no real usage accounting; return zeros.
    // A future live transport would poll the router for session usage.
    return Object.freeze({
      usedMinutes: 0,
      usedMegabytes: 0,
      sessionId: context.sessionId,
      lastSampledAt: sessionRecord.provisionedAt || null,
    });
  }

  async checkHealth() {
    // Health check does not require mutation context (device-level flag not required)
    if (!this._device) {
      throw new RoamingAAAAdapterError(
        503,
        "ADAPTER_UNAVAILABLE",
        "MikroTik adapter requires a device to be bound for health check",
        { missing: "device" },
      );
    }
    if (!this._secretResolver || typeof this._secretResolver.resolveSecret !== "function") {
      throw new RoamingAAAAdapterError(
        503,
        "ADAPTER_UNAVAILABLE",
        "MikroTik adapter requires a secret resolver for health check",
        { missing: "secretResolver" },
      );
    }
    if (!this._client || typeof this._client.health !== "function") {
      throw new RoamingAAAAdapterError(
        503,
        "ADAPTER_UNAVAILABLE",
        "MikroTik adapter requires a RouterOS client for health check",
        { missing: "client" },
      );
    }

    try {
      const result = await checkHealth({
        device: this._device,
        secretResolver: this._secretResolver,
        client: this._client,
        apiPassword: this._apiPassword,
        testMode: this._testMode,
      });

      return Object.freeze({
        healthy: result.reachable,
        adapterKey: MIKROTIK_ADAPTER_KEY,
        mode: MIKROTIK_ENFORCEMENT_MODE,
        phase: "8.5B",
        capabilities: { ...MIKROTIK_ADAPTER_CAPABILITIES },
        transportEnabled: isMikrotikApiEnabled(),
        details: result,
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      throw mapMikrotikToAdapterError(err);
    } finally {
      this._apiPassword = null;
    }
  }

  // Unsupported in Phase 8.5B — these are AUTH operations, not network enforcement.
  async authenticate() {
    throw unsupportedMethod("authenticate");
  }

  async authorize() {
    throw unsupportedMethod("authorize");
  }
}

module.exports = {
  MikrotikEnforcementAdapter,
  MIKROTIK_ADAPTER_KEY,
  MIKROTIK_ENFORCEMENT_MODE,
  MIKROTIK_ADAPTER_CAPABILITIES,
};