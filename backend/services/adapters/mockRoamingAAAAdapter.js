const { RoamingAAAAdapter, RoamingAAAAdapterError, ENFORCEMENT_RESULT_SUCCESS, ENFORCEMENT_RESULT_FAILURE } = require("../roamingAAAAdapter");

const MOCK_ADAPTER_KEY = "mock";

const isMockAllowed = () =>
  String(process.env.ROAMING_MOCK_AAA_ENABLED || "false").toLowerCase() === "true";

class MockRoamingAAAAdapter extends RoamingAAAAdapter {
  constructor(config = {}) {
    super({
      ...config,
      aaaAdapterKey: MOCK_ADAPTER_KEY,
      enforcementMode: "local_adapter",
      capabilities: {
        authenticate: true,
        authorize: true,
        provisionAccess: true,
        revokeAccess: true,
        disconnect: true,
        getUsage: true,
        checkHealth: true,
      },
    });

    this._state = new Map();
    this._healthy = true;
    this._failNext = null;
  }

  _safetyCheck() {
    if (!isMockAllowed()) {
      throw new RoamingAAAAdapterError(
        503,
        "MOCK_ADAPTER_DISABLED",
        "Mock AAA adapter is disabled. Set ROAMING_MOCK_AAA_ENABLED=true for development/test."
      );
    }
  }

  _failIfMocked(err) {
    this._safetyCheck();
    if (this._failNext) {
      const e = this._failNext;
      this._failNext = null;
      throw e;
    }
  }

  _record(sessionId, data) {
    let entry = this._state.get(sessionId);
    if (!entry) {
      entry = {
        sessionId,
        provisioned: false,
        revoked: false,
        disconnected: false,
        usage: { usedMinutes: 0, usedMegabytes: 0 },
        provisionedAt: null,
        revokedAt: null,
        disconnectedAt: null,
      };
    }
    Object.assign(entry, data);
    this._state.set(sessionId, entry);
    return entry;
  }

  async authenticate(context) {
    this._failIfMocked();
    if (!context || !context.sessionId) {
      throw new RoamingAAAAdapterError(400, "VALIDATION_ERROR", "sessionId required for authenticate");
    }
    return { authenticated: true, sessionId: context.sessionId, method: "mock-simulated" };
  }

  async authorize(context) {
    this._failIfMocked();
    if (!context || !context.sessionId) {
      throw new RoamingAAAAdapterError(400, "VALIDATION_ERROR", "sessionId required for authorize");
    }
    const entry = this._state.get(context.sessionId);
    if (!entry) {
      return { authorized: false, reason: "no_provisioning_record", sessionId: context.sessionId };
    }
    return {
      authorized: entry.provisioned && !entry.revoked && !entry.disconnected,
      sessionId: context.sessionId,
      status: entry.provisioned ? "provisioned" : "not_provisioned",
    };
  }

  async provisionAccess(context) {
    this._failIfMocked();
    if (!context || !context.sessionId) {
      throw new RoamingAAAAdapterError(400, "VALIDATION_ERROR", "sessionId required for provisionAccess");
    }

    const existing = this._state.get(context.sessionId);
    if (existing && existing.provisioned && !existing.revoked && !existing.disconnected) {
      return {
        result: ENFORCEMENT_RESULT_SUCCESS,
        alreadyProvisioned: true,
        sessionId: context.sessionId,
      };
    }

    const entry = this._record(context.sessionId, {
      provisioned: true,
      provisionedAt: new Date().toISOString(),
      revoked: false,
      disconnected: false,
      revokedAt: null,
      disconnectedAt: null,
    });

    return {
      result: ENFORCEMENT_RESULT_SUCCESS,
      alreadyProvisioned: false,
      sessionId: context.sessionId,
      enforcementState: entry,
    };
  }

  async revokeAccess(context) {
    this._failIfMocked();
    if (!context || !context.sessionId) {
      throw new RoamingAAAAdapterError(400, "VALIDATION_ERROR", "sessionId required for revokeAccess");
    }

    const existing = this._state.get(context.sessionId);
    if (!existing || !existing.provisioned) {
      return {
        result: ENFORCEMENT_RESULT_SUCCESS,
        alreadyRevoked: true,
        sessionId: context.sessionId,
      };
    }

    if (existing.revoked) {
      return {
        result: ENFORCEMENT_RESULT_SUCCESS,
        alreadyRevoked: true,
        sessionId: context.sessionId,
      };
    }

    const entry = this._record(context.sessionId, {
      revoked: true,
      revokedAt: new Date().toISOString(),
    });

    return {
      result: ENFORCEMENT_RESULT_SUCCESS,
      alreadyRevoked: false,
      sessionId: context.sessionId,
      enforcementState: entry,
    };
  }

  async disconnect(context) {
    this._failIfMocked();
    if (!context || !context.sessionId) {
      throw new RoamingAAAAdapterError(400, "VALIDATION_ERROR", "sessionId required for disconnect");
    }

    const existing = this._state.get(context.sessionId);
    if (!existing || existing.disconnected) {
      return {
        result: ENFORCEMENT_RESULT_SUCCESS,
        alreadyDisconnected: true,
        sessionId: context.sessionId,
      };
    }

    const entry = this._record(context.sessionId, {
      disconnected: true,
      disconnectedAt: new Date().toISOString(),
    });

    return {
      result: ENFORCEMENT_RESULT_SUCCESS,
      alreadyDisconnected: false,
      sessionId: context.sessionId,
      enforcementState: entry,
    };
  }

  async getUsage(context) {
    this._failIfMocked();
    if (!context || !context.sessionId) {
      throw new RoamingAAAAdapterError(400, "VALIDATION_ERROR", "sessionId required for getUsage");
    }

    const entry = this._state.get(context.sessionId);
    if (!entry) {
      return {
        usedMinutes: 0,
        usedMegabytes: 0,
        sessionId: context.sessionId,
      };
    }

    return {
      usedMinutes: entry.usage.usedMinutes,
      usedMegabytes: entry.usage.usedMegabytes,
      sessionId: context.sessionId,
      lastSampledAt: entry.provisionedAt || null,
    };
  }

  async setUsage(sessionId, usedMinutes, usedMegabytes) {
    const entry = this._record(sessionId, {});
    entry.usage = { usedMinutes, usedMegabytes };
    return entry;
  }

  async induceFailure(err) {
    this._failNext = err || new RoamingAAAAdapterError(500, "MOCK_ADAPTER_FAILURE", "Simulated adapter failure");
  }

  async checkHealth() {
    this._failIfMocked();
    return {
      healthy: this._healthy,
      adapterKey: MOCK_ADAPTER_KEY,
      mode: "local_adapter",
      capabilities: this.getCapabilities(),
    };
  }

  setHealthy(value) {
    this._healthy = value;
  }
}

module.exports = {
  MockRoamingAAAAdapter,
  MOCK_ADAPTER_KEY,
};
