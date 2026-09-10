const { ENFORCEMENT_MODES, AAA_ADAPTER_KEYS } = require("./roamingRegistryService");

const AAA_ADAPTER_CAPABILITIES = Object.freeze({
  authenticate: "authentication",
  authorize: "authorization",
  provisionAccess: "provisioning",
  revokeAccess: "revocation",
  disconnect: "disconnection",
  getUsage: "usage_accounting",
  checkHealth: "health_check",
});

const ENFORCEMENT_RESULT_SUCCESS = "success";
const ENFORCEMENT_RESULT_FAILURE = "failure";
const ENFORCEMENT_RESULT_RETRY = "retry";

function nowIso() {
  return new Date().toISOString();
}

class RoamingAAAAdapterError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "RoamingAAAAdapterError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class RoamingAAAAdapter {
  constructor(config = {}) {
    this.aaaAdapterKey = config.aaaAdapterKey || "unknown";
    this.enforcementMode = config.enforcementMode || "local_adapter";
    this.capabilities = this._resolveCapabilities(config.capabilities || {});
  }

  _resolveCapabilities(input) {
    const caps = {
      authenticate: false,
      authorize: true,
      provisionAccess: false,
      revokeAccess: false,
      disconnect: false,
      getUsage: false,
      checkHealth: true,
    };
    for (const key of Object.keys(caps)) {
      if (typeof input[key] === "boolean") {
        caps[key] = input[key];
      }
    }
    return Object.freeze(caps);
  }

  getCapabilities() {
    return this.capabilities;
  }

  async authenticate(context) {
    throw new RoamingAAAAdapterError(
      501,
      "ADAPTER_NOT_IMPLEMENTED",
      `${this.aaaAdapterKey} adapter does not implement authenticate`
    );
  }

  async authorize(context) {
    throw new RoamingAAAAdapterError(
      501,
      "ADAPTER_NOT_IMPLEMENTED",
      `${this.aaaAdapterKey} adapter does not implement authorize`
    );
  }

  async provisionAccess(context) {
    throw new RoamingAAAAdapterError(
      501,
      "ADAPTER_NOT_IMPLEMENTED",
      `${this.aaaAdapterKey} adapter does not implement provisionAccess`
    );
  }

  async revokeAccess(context) {
    throw new RoamingAAAAdapterError(
      501,
      "ADAPTER_NOT_IMPLEMENTED",
      `${this.aaaAdapterKey} adapter does not implement revokeAccess`
    );
  }

  async disconnect(context) {
    throw new RoamingAAAAdapterError(
      501,
      "ADAPTER_NOT_IMPLEMENTED",
      `${this.aaaAdapterKey} adapter does not implement disconnect`
    );
  }

  async getUsage(context) {
    throw new RoamingAAAAdapterError(
      501,
      "ADAPTER_NOT_IMPLEMENTED",
      `${this.aaaAdapterKey} adapter does not implement getUsage`
    );
  }

  async checkHealth() {
    throw new RoamingAAAAdapterError(
      501,
      "ADAPTER_NOT_IMPLEMENTED",
      `${this.aaaAdapterKey} adapter does not implement checkHealth`
    );
  }

  static buildContext({ sessionId, userRef, homeOwnerId, visitedOwnerId, visitedHotspotId, entitlementId, aaaAdapterKey }) {
    if (!sessionId || typeof sessionId !== "string") {
      throw new RoamingAAAAdapterError(400, "VALIDATION_ERROR", "sessionId is required");
    }
    if (!userRef || !userRef.userId) {
      throw new RoamingAAAAdapterError(400, "VALIDATION_ERROR", "userRef.userId is required");
    }
    return Object.freeze({
      sessionId,
      userRef,
      homeOwnerId,
      visitedOwnerId,
      visitedHotspotId,
      entitlementId,
      aaaAdapterKey,
      provisionedAt: nowIso(),
    });
  }
}

module.exports = {
  RoamingAAAAdapter,
  RoamingAAAAdapterError,
  AAA_ADAPTER_CAPABILITIES,
  ENFORCEMENT_RESULT_SUCCESS,
  ENFORCEMENT_RESULT_FAILURE,
  ENFORCEMENT_RESULT_RETRY,
  ENFORCEMENT_MODES,
  AAA_ADAPTER_KEYS,
  nowIso,
};
