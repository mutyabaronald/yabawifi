/**
 * Phase 8.3 - RADIUS roaming AAA adapter.
 *
 * Implements exactly three of the seven `RoamingAAAAdapter` operations:
 * `authenticate`, `authorize` and `checkHealth`. The remaining four fail closed
 * with a deterministic `radius_method_not_supported` error and are advertised
 * as unsupported capabilities.
 *
 * Design constraints carried from the Phase 8.3 decision lock:
 *
 * - RADIUS is an *authorization input* only. YabaLink remains authoritative for
 *   entitlement, quota and RAU accounting. Nothing here grants or consumes
 *   quota, and no Session-Timeout / Filter-Id / Class value is applied.
 * - `User-Name` is supplied by the internal caller through the adapter context.
 *   Deriving a production username (pseudonym, jti or otherwise) is deferred to
 *   Phase 8.4. This adapter never derives one from `userRef`, `phone` or any
 *   other subscriber identifier.
 * - All RADIUS infrastructure configuration comes from the injected profile
 *   store. No configuration is accepted from a request or context object.
 * - The shared secret is requested from the injected resolver at call time and
 *   is never stored, logged, serialized or placed in an error.
 * - All networking lives in `backend/services/radiusTransport/`. This file
 *   imports no networking module.
 */

const {
  RoamingAAAAdapter,
  RoamingAAAAdapterError,
} = require("../roamingAAAAdapter");

const {
  RADIUS_CODE_ACCESS_ACCEPT,
  RADIUS_CODE_ACCESS_REJECT,
  RADIUS_ATTRIBUTE_SESSION_TIMEOUT,
  RADIUS_ATTRIBUTE_FILTER_ID,
} = require("../radius");

const {
  RADIUS_ERROR_CODES,
  radiusError,
  isRadiusTransportError,
} = require("../radiusTransport/errors");

const {
  assertProfileUsable,
  assertNoClientSuppliedConfig,
} = require("../radiusTransport/profile");

const {
  createDisabledProductionSecretResolver,
} = require("../radiusTransport/secrets");

const {
  isRadiusTransportEnabled,
} = require("../radiusTransport/featureFlag");

const {
  createRadiusProfileService,
  RADIUS_PROFILE_ID_PATTERN,
} = require("../radiusProfiles");

const RADIUS_ADAPTER_KEY = "radius";
const RADIUS_ENFORCEMENT_MODE = "radius";

const RADIUS_METHOD_NOT_SUPPORTED = "radius_method_not_supported";

const UNSUPPORTED_METHODS = Object.freeze([
  "provisionAccess",
  "revokeAccess",
  "disconnect",
  "getUsage",
]);

const SUPPORTED_METHODS = Object.freeze([
  "authenticate",
  "authorize",
  "checkHealth",
]);

const RADIUS_ADAPTER_CAPABILITIES = Object.freeze({
  authenticate: true,
  authorize: true,
  provisionAccess: false,
  revokeAccess: false,
  disconnect: false,
  getUsage: false,
  checkHealth: true,
});

const MAX_RADIUS_PASSWORD_LENGTH = 128;

const ATTRIBUTE_NAMES = Object.freeze({
  [RADIUS_ATTRIBUTE_SESSION_TIMEOUT]: "Session-Timeout",
  [RADIUS_ATTRIBUTE_FILTER_ID]: "Filter-Id",
});

function validationError(message, details = {}) {
  return new RoamingAAAAdapterError(400, "VALIDATION_ERROR", message, details);
}

function unsupportedMethod(method) {
  return new RoamingAAAAdapterError(
    501,
    RADIUS_METHOD_NOT_SUPPORTED,
    `RADIUS adapter does not support ${method} in Phase 8.3`,
    { method, adapterKey: RADIUS_ADAPTER_KEY, phase: "8.3", supported: SUPPORTED_METHODS }
  );
}

/**
 * Map a Phase 8.2C transport failure onto the Phase 8.1 AAA error contract.
 * Non-transport errors pass through untouched.
 */
function toAdapterError(err) {
  if (err instanceof RoamingAAAAdapterError) return err;
  if (isRadiusTransportError(err)) return err.toAAAError();
  return err;
}

function readAttribute(attributes, type) {
  if (!attributes || typeof attributes !== "object") return null;
  const value = attributes[ATTRIBUTE_NAMES[type]];
  if (value === undefined || value === null) return null;
  return value;
}

class RadiusRoamingAAAAdapter extends RoamingAAAAdapter {
  constructor(config = {}) {
    super({
      ...config,
      aaaAdapterKey: RADIUS_ADAPTER_KEY,
      enforcementMode: RADIUS_ENFORCEMENT_MODE,
      capabilities: { ...RADIUS_ADAPTER_CAPABILITIES },
    });

    this.profileService =
      config.profileService && typeof config.profileService.getProfile === "function"
        ? config.profileService
        : createRadiusProfileService();

    this.secretResolver =
      config.secretResolver && typeof config.secretResolver.resolveSecret === "function"
        ? config.secretResolver
        : createDisabledProductionSecretResolver({
            reason: "no_secret_resolver_injected",
          });

    this._transportClient = config.transportClient || null;
    this._transportClientInjected = Boolean(config.transportClient);
    this._testMode = config.testMode === true;
  }

  getCapabilities() {
    return RADIUS_ADAPTER_CAPABILITIES;
  }

  getSupportedMethods() {
    return SUPPORTED_METHODS.slice();
  }

  getUnsupportedMethods() {
    return UNSUPPORTED_METHODS.slice();
  }

  /**
   * Non-sensitive description of the adapter wiring. Used by health reporting
   * and by tests that assert no secret is reachable from adapter state.
   */
  describe() {
    return {
      adapterKey: RADIUS_ADAPTER_KEY,
      enforcementMode: RADIUS_ENFORCEMENT_MODE,
      phase: "8.3",
      registeredInServer: false,
      capabilities: { ...RADIUS_ADAPTER_CAPABILITIES },
      supportedMethods: SUPPORTED_METHODS.slice(),
      unsupportedMethods: UNSUPPORTED_METHODS.slice(),
      profileStoreInjected: this.profileService.inert !== true,
      secretResolverMode: this.secretResolver.mode || "unknown",
      transportClientInjected: this._transportClientInjected,
      transportEnabled: isRadiusTransportEnabled(),
    };
  }

  toJSON() {
    return this.describe();
  }

  _getTransportClient() {
    if (this._transportClient) return this._transportClient;

    // Required lazily so that constructing an adapter without a transport does
    // not pull the UDP layer into the module graph.
    const { createRadiusClient } = require("../radiusTransport/client");

    this._transportClient = createRadiusClient({
      profileStore: this.profileService,
      secretResolver: this.secretResolver,
      testMode: this._testMode === true,
    });
    return this._transportClient;
  }

  /**
   * Resolve a trusted profile. The profile is never taken from the context.
   */
  async _resolveProfile(profileId) {
    if (typeof profileId !== "string" || !RADIUS_PROFILE_ID_PATTERN.test(profileId)) {
      throw radiusError(
        RADIUS_ERROR_CODES.RADIUS_PROFILE_NOT_FOUND,
        "A valid radiusProfileId is required for RADIUS adapter calls",
        { field: "radiusProfileId" }
      );
    }

    const profile = await this.profileService.getProfile(profileId);
    if (!profile) {
      throw radiusError(
        RADIUS_ERROR_CODES.RADIUS_PROFILE_NOT_FOUND,
        `No trusted RADIUS profile is configured for id '${profileId}'`,
        { profileId }
      );
    }

    assertProfileUsable(profile);
    return profile;
  }

  _assertExchangeContext(context) {
    if (!context || typeof context !== "object") {
      throw validationError("Adapter context is required");
    }

    assertNoClientSuppliedConfig(context);

    if (typeof context.userName !== "string" || context.userName.length === 0) {
      throw validationError(
        "context.userName is required and must be supplied by the trusted internal caller"
      );
    }
    if (context.userName.length > 253) {
      throw validationError("context.userName exceeds maximum length");
    }

    if (
      typeof context.password !== "string" ||
      context.password.length === 0 ||
      context.password.length > MAX_RADIUS_PASSWORD_LENGTH
    ) {
      throw validationError("context.password is required for RADIUS Access-Request");
    }
  }

  async _exchangeAccessRequest(context) {
    this._assertExchangeContext(context);

    const profile = await this._resolveProfile(context.radiusProfileId);
    const client = this._getTransportClient();

    const args = {
      profileId: profile.profileId,
      userName: context.userName,
      userPassword: context.password,
    };

    if (typeof context.calledStationId === "string") {
      args.calledStationId = context.calledStationId;
    }
    if (typeof context.callingStationId === "string") {
      args.callingStationId = context.callingStationId;
    }

    const result = await client.sendAccessRequest(args);

    return {
      profile,
      result,
      accepted: result.code === RADIUS_CODE_ACCESS_ACCEPT,
      rejected: result.code === RADIUS_CODE_ACCESS_REJECT,
    };
  }

  async authenticate(context) {
    try {
      const exchange = await this._exchangeAccessRequest(context);
      const { result, profile } = exchange;

      return Object.freeze({
        authenticated: exchange.accepted,
        adapterKey: RADIUS_ADAPTER_KEY,
        method: "radius_access_request",
        sessionId: context.sessionId || null,
        profileId: profile.profileId,
        code: result.code,
        codeName: result.codeName,
        reason: exchange.accepted ? null : exchange.rejected ? "access_reject" : "unexpected_response",
        attributes: result.attributes,
        attempts: result.attempts,
        rttMs: result.rttMs,
        radiusResult: result,
      });
    } catch (err) {
      throw toAdapterError(err);
    }
  }

  /**
   * Evaluate the RADIUS authorization result. This reads the Access-Accept
   * attributes as *observations only*: Session-Timeout and Filter-Id semantics
   * are deferred to Phase 8.4 and are not applied here. This method never
   * grants quota, never consumes RAU and never provisions access.
   */
  async authorize(context) {
    try {
      if (!context || typeof context !== "object") {
        throw validationError("Adapter context is required");
      }

      let exchange;

      if (context.radiusResult && typeof context.radiusResult === "object") {
        const profile = await this._resolveProfile(context.radiusProfileId);
        exchange = {
          profile,
          result: context.radiusResult,
          accepted: context.radiusResult.code === RADIUS_CODE_ACCESS_ACCEPT,
          rejected: context.radiusResult.code === RADIUS_CODE_ACCESS_REJECT,
        };
      } else {
        exchange = await this._exchangeAccessRequest(context);
      }

      const { result, profile } = exchange;
      const observedSessionTimeout = readAttribute(
        result.attributes,
        RADIUS_ATTRIBUTE_SESSION_TIMEOUT
      );
      const observedFilterId = readAttribute(
        result.attributes,
        RADIUS_ATTRIBUTE_FILTER_ID
      );

      return Object.freeze({
        authorized: exchange.accepted,
        adapterKey: RADIUS_ADAPTER_KEY,
        sessionId: context.sessionId || null,
        profileId: profile.profileId,
        code: result.code,
        codeName: result.codeName,
        reason: exchange.accepted
          ? "radius_accepted"
          : exchange.rejected
            ? "access_reject"
            : "unexpected_response",
        authoritativeForQuota: false,
        observedAttributes: Object.freeze({
          sessionTimeoutSeconds:
            typeof observedSessionTimeout === "number" ? observedSessionTimeout : null,
          filterId: typeof observedFilterId === "string" ? observedFilterId : null,
          appliedToSession: false,
        }),
      });
    } catch (err) {
      throw toAdapterError(err);
    }
  }

  /**
   * Wiring health only. Performs no network I/O and keeps no persistent state,
   * because Phase 8.4 owns live RADIUS health semantics.
   */
  async checkHealth() {
    const profileStoreInjected = this.profileService.inert !== true;
    const transportClientInjected = this._transportClientInjected;
    const secretResolverInjected = Boolean(
      this.secretResolver && typeof this.secretResolver.resolveSecret === "function"
    );
    const transportEnabled = isRadiusTransportEnabled();

    const missing = [];
    if (!profileStoreInjected) missing.push("profileService");
    if (!transportClientInjected) missing.push("transportClient");
    if (!secretResolverInjected) missing.push("secretResolver");

    return Object.freeze({
      healthy: missing.length === 0,
      adapterKey: RADIUS_ADAPTER_KEY,
      mode: RADIUS_ENFORCEMENT_MODE,
      phase: "8.3",
      capabilities: { ...RADIUS_ADAPTER_CAPABILITIES },
      transportEnabled,
      dependencies: Object.freeze({
        profileServiceInjected: profileStoreInjected,
        secretResolverInjected,
        transportClientInjected,
      }),
      missingDependencies: Object.freeze(missing),
      productionRegistered: false,
      checkedAt: new Date().toISOString(),
    });
  }

  async provisionAccess() {
    throw unsupportedMethod("provisionAccess");
  }

  async revokeAccess() {
    throw unsupportedMethod("revokeAccess");
  }

  async disconnect() {
    throw unsupportedMethod("disconnect");
  }

  async getUsage() {
    throw unsupportedMethod("getUsage");
  }
}

module.exports = {
  RadiusRoamingAAAAdapter,
  RADIUS_ADAPTER_KEY,
  RADIUS_ENFORCEMENT_MODE,
  RADIUS_METHOD_NOT_SUPPORTED,
  RADIUS_ADAPTER_CAPABILITIES,
  SUPPORTED_METHODS,
  UNSUPPORTED_METHODS,
};
