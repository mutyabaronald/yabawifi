"use strict";

// Phase 8.5D-B.2.4 — checkMikroTikRouterHealth verification.
//
// Exercises checkMikroTikRouterHealth() with session authorization,
// read-only circuit-breaker inspection, direct transport.execute() probe,
// and guaranteed transport cleanup.
//
// Strictly read-only with respect to production implementation files. No
// production code is modified. No real sockets, routers, or Firebase.

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
const Module = require("module");

// =============================================================================
// Firebase mock — must be set in require.cache BEFORE any module that
// requires ../firebase is loaded (secrets.js at line 2 does this).
// =============================================================================

const servicesDir = path.dirname(require.resolve("../services/roamingEnforcementService.js"));
const firebasePath = require.resolve("../firebase.js", { paths: [servicesDir] });

const firebaseMock = {
  db: null,
  admin: {
    firestore: () => firebaseMock.db,
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
  },
};

function makeFirebaseModule() {
  const m = new Module(firebasePath, null);
  m.filename = firebasePath;
  m.paths = Module._nodeModulePaths(path.dirname(firebasePath));
  m.exports = firebaseMock;
  return m;
}

require.cache[firebasePath] = makeFirebaseModule();

// =============================================================================
// Now safe to load modules that depend on firebase
// =============================================================================

const { MockFirestore } = require("./helpers/mock-firestore");
const { test, describe, report, ta } = require("./helpers/test-runner");

const secretsModule = require("../services/mikrotik/secrets");
const {
  createStaticTestSecretResolver: realCreateStaticTestSecretResolver,
} = secretsModule;
const {
  mikrotikError,
  MIKROTIK_ERROR_CODES,
} = require("../services/mikrotik/errors");
const routerOsClientModule = require("../services/mikrotik/routerOsClient");
const {
  createRouterOsClient,
  getCircuitBreakerStatus,
  getCircuitBreaker,
  resetCircuitBreakers,
  CIRCUIT_STATES,
  buildHealthCommand,
} = routerOsClientModule;

// =============================================================================
// Test fixtures
// =============================================================================

const VISITED_OWNER_ID = "owner-visited-1";
const HOME_OWNER_ID = "owner-home-1";
const USER_ID = "user-1";
const SESSION_ID = "session-mikrotik-health-1";
const HOTSPOT_ID = "hotspot-visited-1";
const DEVICE_ID = "device-visited-1";
const ENTITLEMENT_ID = "entitlement-1";
const SECRET_REF = "rsec_" + crypto.randomUUID();

const TEST_DEVICE = {
  deviceId: DEVICE_ID,
  ownerId: VISITED_OWNER_ID,
  deviceName: "Visited Router",
  vendor: "mikrotik",
  networkControl: "yabalink_managed",
  routerOsApiEnabled: true,
  routerOsApiPort: 8728,
  routerOsHost: "192.168.1.10",
  routerOsApiUsername: "api-user",
  routerOsApiSecretRef: SECRET_REF,
  routerOsTls: false,
};

const TEST_ENTITLEMENT = {
  entitlementId: ENTITLEMENT_ID,
  status: "active",
  quota: {
    remainingMinutes: 60,
    maxSessions: 1,
  },
};

const TEST_HOTSPOT = {
  hotspotId: HOTSPOT_ID,
  ownerId: VISITED_OWNER_ID,
  partnerStatus: "active",
  enforcementMode: "local_adapter",
  aaaAdapterKey: "mikrotik",
  deviceLink: {
    deviceId: DEVICE_ID,
    routerId: null,
  },
};

const TEST_SESSION = {
  sessionId: SESSION_ID,
  id: SESSION_ID,
  status: "authorized",
  userRef: { userId: USER_ID },
  homeOwnerId: HOME_OWNER_ID,
  visitedOwnerId: VISITED_OWNER_ID,
  visitedHotspotId: HOTSPOT_ID,
  entitlementId: ENTITLEMENT_ID,
  aaaAdapterKey: "mikrotik",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};

const ROUTER_HOST = "192.168.1.10";
const ROUTER_PORT = 8728;

// =============================================================================
// Helpers
// =============================================================================

const ENFORCEMENT_CACHE_KEYS = [
  require.resolve("../services/roamingEnforcementService.js"),
  require.resolve("../services/roamingRegistryService.js"),
  require.resolve("../services/roamingAuthService.js"),
  require.resolve("../services/roamingSessionService.js"),
  require.resolve("../services/roamingEntitlementService.js"),
  require.resolve("../services/roamingAAAAdapter.js"),
  require.resolve("../services/roamingAAAAdapterRegistry.js"),
  require.resolve("../services/mikrotik/mikrotikEnforcementAdapter.js"),
  require.resolve("../services/mikrotik/secrets.js"),
  require.resolve("../services/mikrotik/routerOsClient.js"),
  require.resolve("../services/mikrotik/mockRouterOsTransport.js"),
  require.resolve("../services/mikrotik/routerOsTransport.js"),
  require.resolve("../services/mikrotik/featureFlag.js"),
  require.resolve("../services/mikrotik/identity.js"),
  require.resolve("../services/mikrotik/hotspotUserService.js"),
  require.resolve("../services/mikrotik/errors.js"),
];

let enforcement;
let checkMikroTikRouterHealth;

function resetFirestore(extraMocks = {}) {
  const mockDb = new MockFirestore();
  firebaseMock.db = mockDb;

  mockDb.collection("roaming_hotspots").doc(HOTSPOT_ID).set(TEST_HOTSPOT);
  mockDb.collection("devices").doc(DEVICE_ID).set(TEST_DEVICE);
  mockDb.collection("roaming_entitlements").doc(ENTITLEMENT_ID).set(TEST_ENTITLEMENT);
  mockDb.collection("roaming_sessions").doc(SESSION_ID).set(TEST_SESSION);

  // Clear all caches so modules load fresh
  for (const key of ENFORCEMENT_CACHE_KEYS) {
    delete require.cache[key];
  }
  require.cache[firebasePath] = makeFirebaseModule();

  // Mock secrets.js via require.cache with the test secret resolver
  const secretsPath = require.resolve("../services/mikrotik/secrets.js");
  const secretsMock = {
    ...secretsModule,
    createStaticTestSecretResolver: () =>
      realCreateStaticTestSecretResolver({
        [SECRET_REF]: "test-router-api-password",
      }),
    createProductionSecretResolver: () => {
      if (
        process.env.NODE_ENV === "production" &&
        !process.env.MIKROTIK_SECRET_ENCRYPTION_KEY
      ) {
        throw mikrotikError(
          MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
          "A MikroTik secret encryption key is required in production.",
          { field: "encryptionKey" },
        );
      }
      return {
        mode: "production_encrypted",
        isProduction: true,
        async resolveSecret() {
          return "test-router-api-password";
        },
        listReferences() { return []; },
      };
    },
  };
  require.cache[secretsPath] = (() => {
    const m = new Module(secretsPath, null);
    m.filename = secretsPath;
    m.paths = Module._nodeModulePaths(path.dirname(secretsPath));
    m.exports = secretsMock;
    return m;
  })();

  // Mock entitlement service via require.cache so validateSessionForEnforcement
  // gets a deterministic eligible result without hitting real Firebase.
  const entitlementPath = require.resolve("../services/roamingEntitlementService.js");
  const entitlementMock = {
    checkEntitlementEligibility: async () => ({
      eligible: true,
      entitlementId: ENTITLEMENT_ID,
    }),
  };
  require.cache[entitlementPath] = (() => {
    const m = new Module(entitlementPath, null);
    m.filename = entitlementPath;
    m.paths = Module._nodeModulePaths(path.dirname(entitlementPath));
    m.exports = entitlementMock;
    return m;
  })();

  // Mock routerOsClient.js via require.cache so both this test file and
  // roamingEnforcementService.js share the same circuitBreakers Map.
  const clientPath = require.resolve("../services/mikrotik/routerOsClient.js");
  require.cache[clientPath] = (() => {
    const m = new Module(clientPath, null);
    m.filename = clientPath;
    m.paths = Module._nodeModulePaths(path.dirname(clientPath));
    m.exports = routerOsClientModule;
    return m;
  })();

  enforcement = require("../services/roamingEnforcementService");
  checkMikroTikRouterHealth = enforcement.checkMikroTikRouterHealth;

  // Reset circuit breakers between tests for isolation
  resetCircuitBreakers();
}

function buildContext(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    userId: USER_ID,
    homeOwnerId: HOME_OWNER_ID,
    visitedOwnerId: VISITED_OWNER_ID,
    visitedHotspotId: HOTSPOT_ID,
    entitlementId: ENTITLEMENT_ID,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  // ===========================================================================
  // A. Authorization — missing/invalid inputs
  // ===========================================================================
  await describe("checkMikroTikRouterHealth — authorization", async () => {
    await test("rejects missing sessionId", async () => {
      resetFirestore();
      resetCircuitBreakers();

      try {
        await checkMikroTikRouterHealth(undefined, { userId: USER_ID });
        ta.fail("Should have thrown for undefined sessionId");
      } catch (err) {
        ta.strictEqual(err.code, "VALIDATION_ERROR");
        ta.ok(err.message.includes("Session ID is required"));
      }
    });

    await test("rejects empty sessionId", async () => {
      resetFirestore();
      resetCircuitBreakers();

      try {
        await checkMikroTikRouterHealth("", { userId: USER_ID });
        ta.fail("Should have thrown for empty sessionId");
      } catch (err) {
        ta.strictEqual(err.code, "VALIDATION_ERROR");
      }
    });

    await test("rejects missing context", async () => {
      resetFirestore();
      resetCircuitBreakers();

      try {
        await checkMikroTikRouterHealth(SESSION_ID, undefined);
        ta.fail("Should have thrown for undefined context");
      } catch (err) {
        ta.strictEqual(err.code, "VALIDATION_ERROR");
        ta.ok(err.message.includes("Authenticated context is required"));
      }
    });

    await test("rejects context without userId or ownerId", async () => {
      resetFirestore();
      resetCircuitBreakers();

      try {
        await checkMikroTikRouterHealth(SESSION_ID, {});
        ta.fail("Should have thrown for context without userId/ownerId");
      } catch (err) {
        ta.strictEqual(err.code, "VALIDATION_ERROR");
        ta.ok(err.message.includes("userId or ownerId"));
      }
    });

    await test("rejects context with only null userId and null ownerId", async () => {
      resetFirestore();
      resetCircuitBreakers();

      try {
        await checkMikroTikRouterHealth(SESSION_ID, { userId: null, ownerId: null });
        ta.fail("Should have thrown for null context values");
      } catch (err) {
        ta.strictEqual(err.code, "VALIDATION_ERROR");
      }
    });
  });

  // ===========================================================================
  // B. Authorization — session validation via validateSessionForEnforcement
  // ===========================================================================
  await describe("checkMikroTikRouterHealth — session authorization", async () => {
    await test("rejects session not found", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const mockDb = new MockFirestore();
      firebaseMock.db = mockDb;
      mockDb.collection("roaming_hotspots").doc(HOTSPOT_ID).set(TEST_HOTSPOT);
      mockDb.collection("devices").doc(DEVICE_ID).set(TEST_DEVICE);
      mockDb.collection("roaming_entitlements").doc(ENTITLEMENT_ID).set(TEST_ENTITLEMENT);
      // No session in the DB

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        delete require.cache[key];
      }
      require.cache[firebasePath] = makeFirebaseModule();

      const secretsPath = require.resolve("../services/mikrotik/secrets.js");
      const secretsMock = {
        ...secretsModule,
        createStaticTestSecretResolver: () =>
          realCreateStaticTestSecretResolver({ [SECRET_REF]: "test-router-api-password" }),
        createProductionSecretResolver: () => ({
          mode: "production_encrypted",
          isProduction: true,
          async resolveSecret() { return "test-router-api-password"; },
          listReferences() { return []; },
        }),
      };
      require.cache[secretsPath] = (() => {
        const m = new Module(secretsPath, null);
        m.filename = secretsPath;
        m.paths = Module._nodeModulePaths(path.dirname(secretsPath));
        m.exports = secretsMock;
        return m;
      })();

      const clientPath = require.resolve("../services/mikrotik/routerOsClient.js");
      require.cache[clientPath] = (() => {
        const m = new Module(clientPath, null);
        m.filename = clientPath;
        m.paths = Module._nodeModulePaths(path.dirname(clientPath));
        m.exports = routerOsClientModule;
        return m;
      })();

      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      try {
        await localCheck("nonexistent-session", { userId: USER_ID });
        ta.fail("Should have thrown for nonexistent session");
      } catch (err) {
        ta.ok(err.code === "NOT_FOUND" || err.code === "VALIDATION_ERROR", `Expected NOT_FOUND or VALIDATION_ERROR, got ${err.code}`);
      }
    });

    await test("rejects session with non-enforceable status", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const mockDb = new MockFirestore();
      firebaseMock.db = mockDb;
      mockDb.collection("roaming_hotspots").doc(HOTSPOT_ID).set(TEST_HOTSPOT);
      mockDb.collection("devices").doc(DEVICE_ID).set(TEST_DEVICE);
      mockDb.collection("roaming_entitlements").doc(ENTITLEMENT_ID).set(TEST_ENTITLEMENT);
      const expiredSession = { ...TEST_SESSION, status: "expired", sessionId: "expired-session-1", id: "expired-session-1" };
      mockDb.collection("roaming_sessions").doc("expired-session-1").set(expiredSession);

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        delete require.cache[key];
      }
      require.cache[firebasePath] = makeFirebaseModule();

      const secretsPath = require.resolve("../services/mikrotik/secrets.js");
      const secretsMock = {
        ...secretsModule,
        createStaticTestSecretResolver: () =>
          realCreateStaticTestSecretResolver({ [SECRET_REF]: "test-router-api-password" }),
        createProductionSecretResolver: () => ({
          mode: "production_encrypted",
          isProduction: true,
          async resolveSecret() { return "test-router-api-password"; },
          listReferences() { return []; },
        }),
      };
      require.cache[secretsPath] = (() => {
        const m = new Module(secretsPath, null);
        m.filename = secretsPath;
        m.paths = Module._nodeModulePaths(path.dirname(secretsPath));
        m.exports = secretsMock;
        return m;
      })();

      const clientPath = require.resolve("../services/mikrotik/routerOsClient.js");
      require.cache[clientPath] = (() => {
        const m = new Module(clientPath, null);
        m.filename = clientPath;
        m.paths = Module._nodeModulePaths(path.dirname(clientPath));
        m.exports = routerOsClientModule;
        return m;
      })();

      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      try {
        await localCheck("expired-session-1", { userId: USER_ID });
        ta.fail("Should have thrown for expired session");
      } catch (err) {
        ta.ok(
          err.code === "SESSION_NOT_ENFORCEABLE" || err.code === "SESSION_EXPIRED",
          `Expected SESSION_NOT_ENFORCEABLE or SESSION_EXPIRED, got ${err.code}`
        );
      }
    });

    await test("rejects context userId mismatch", async () => {
      resetFirestore();
      resetCircuitBreakers();

      try {
        await checkMikroTikRouterHealth(SESSION_ID, { userId: "different-user" });
        ta.fail("Should have thrown for context userId mismatch");
      } catch (err) {
        ta.strictEqual(err.code, "CONTEXT_MISMATCH");
      }
    });

    await test("rejects context ownerId mismatch", async () => {
      resetFirestore();
      resetCircuitBreakers();

      try {
        await checkMikroTikRouterHealth(SESSION_ID, { ownerId: "different-owner" });
        ta.fail("Should have thrown for context ownerId mismatch");
      } catch (err) {
        ta.strictEqual(err.code, "CONTEXT_MISMATCH");
      }
    });
  });

  // ===========================================================================
  // C. CLOSED circuit — direct transport.execute() probe
  // ===========================================================================
  await describe("checkMikroTikRouterHealth — CLOSED circuit", async () => {
    await test("uses transport.execute() with buildHealthCommand()", async () => {
      resetFirestore();
      resetCircuitBreakers();

      let executeCommand = null;
      let executeCalled = false;

      // Mock routerOsClient so resolveAdapterForSession gets a client with a
      // transport whose execute() we can spy on
      const clientModulePath = require.resolve("../services/mikrotik/routerOsClient.js");
      require.cache[clientModulePath] = (() => {
        const m = new Module(clientModulePath, null);
        m.filename = clientModulePath;
        m.paths = Module._nodeModulePaths(path.dirname(clientModulePath));
        m.exports = {
          ...routerOsClientModule,
          createRouterOsClient: () => ({
            health: async () => Object.freeze({ reachable: true }),
            close: async () => { },
          }),
        };
        return m;
      })();

      // Mock mockRouterOsTransport so createMockRouterOsTransport returns a
      // transport with a tracked execute() method
      const mockTransportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportPath] = (() => {
        const m = new Module(mockTransportPath, null);
        m.filename = mockTransportPath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportPath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async execute(request) {
                executeCalled = true;
                executeCommand = request && request.command;
                return { ok: true, attempts: 1 };
              },
              async close() { },
            });
          },
        };
        return m;
      })();

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      const result = await localCheck(SESSION_ID, { userId: USER_ID });
      ta.strictEqual(executeCalled, true, "transport.execute() was called");
      ta.strictEqual(executeCommand, buildHealthCommand(), "transport.execute() called with buildHealthCommand()");
      ta.strictEqual(result.healthy, true);
      ta.strictEqual(result.state, "healthy");
      ta.strictEqual(result.adapterKey, "mikrotik");
    });

    await test("does not call adapter.checkHealth()", async () => {
      resetFirestore();
      resetCircuitBreakers();

      let checkHealthCalled = false;

      const clientModulePath = require.resolve("../services/mikrotik/routerOsClient.js");
      require.cache[clientModulePath] = (() => {
        const m = new Module(clientModulePath, null);
        m.filename = clientModulePath;
        m.paths = Module._nodeModulePaths(path.dirname(clientModulePath));
        m.exports = {
          ...routerOsClientModule,
          createRouterOsClient: () => ({
            health: async () => { checkHealthCalled = true; return Object.freeze({ reachable: true }); },
            close: async () => { },
          }),
        };
        return m;
      })();

      const mockTransportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportPath] = (() => {
        const m = new Module(mockTransportPath, null);
        m.filename = mockTransportPath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportPath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async execute() { return { ok: true, attempts: 1 }; },
              async close() { },
            });
          },
        };
        return m;
      })();

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      await localCheck(SESSION_ID, { userId: USER_ID });
      ta.strictEqual(checkHealthCalled, false, "adapter.checkHealth() was NOT called");
    });

    await test("does not mutate breaker state or counters", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      breaker.recordFailure("timeout");
      const failureCountBefore = breaker.failureCount;
      ta.strictEqual(failureCountBefore, 1);

      const mockTransportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportPath] = (() => {
        const m = new Module(mockTransportPath, null);
        m.filename = mockTransportPath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportPath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async execute() { return { ok: true, attempts: 1 }; },
              async close() { },
            });
          },
        };
        return m;
      })();

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;

      const result = await localCheck(SESSION_ID, { userId: USER_ID });

      const statusAfter = getCircuitBreakerStatus(ROUTER_HOST, ROUTER_PORT);
      ta.strictEqual(statusAfter.state, CIRCUIT_STATES.CLOSED);
      ta.strictEqual(statusAfter.failureCount, failureCountBefore, "Failure count unchanged");
      ta.strictEqual(statusAfter.halfOpenProbes, 0, "Half-open probes unchanged");
      ta.strictEqual(result.healthy, true);
    });

    await test("returns healthy result with sanitized details", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const mockTransportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportPath] = (() => {
        const m = new Module(mockTransportPath, null);
        m.filename = mockTransportPath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportPath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async execute() { return { ok: true, attempts: 1 }; },
              async close() { },
            });
          },
        };
        return m;
      })();

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      const result = await localCheck(SESSION_ID, { userId: USER_ID });
      const resultStr = JSON.stringify(result);
      ta.ok(!resultStr.includes("password"), "Result must not contain password");
      ta.ok(!resultStr.includes(SECRET_REF), "Result must not contain secret ref");
      ta.ok(!resultStr.includes("apiPassword"), "Result must not contain apiPassword");
      ta.ok(!resultStr.includes("test-router-api-password"), "Result must not contain resolved password");
      ta.strictEqual(result.healthy, true);
      ta.ok(result.checkedAt);
    });
  });

  // ===========================================================================
  // D. OPEN circuit — DEGRADED without router contact
  // ===========================================================================
  await describe("checkMikroTikRouterHealth — OPEN circuit", async () => {
    await test("returns DEGRADED without router contact when circuit is OPEN", async () => {
      resetFirestore();
      resetCircuitBreakers();

      let executeCalled = false;

      const mockTransportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportPath] = (() => {
        const m = new Module(mockTransportPath, null);
        m.filename = mockTransportPath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportPath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async execute() { executeCalled = true; return { ok: true }; },
              async close() { },
            });
          },
        };
        return m;
      })();

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      // Create and OPEN the breaker
      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("timeout");
      }
      ta.strictEqual(breaker.state, CIRCUIT_STATES.OPEN);

      const result = await localCheck(SESSION_ID, { userId: USER_ID });
      ta.strictEqual(result.healthy, false);
      ta.strictEqual(result.state, "degraded");
      ta.strictEqual(result.reason, "circuit_open");
      ta.strictEqual(executeCalled, false, "No router contact when circuit is OPEN");
      ta.ok(result.checkedAt);
    });

    await test("OPEN circuit does not transition breaker state", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("timeout");
      }
      ta.strictEqual(breaker.state, CIRCUIT_STATES.OPEN);

      const mockTransportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportPath] = (() => {
        const m = new Module(mockTransportPath, null);
        m.filename = mockTransportPath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportPath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async execute() { return { ok: true }; },
              async close() { },
            });
          },
        };
        return m;
      })();

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      await localCheck(SESSION_ID, { userId: USER_ID });

      ta.strictEqual(breaker.state, CIRCUIT_STATES.OPEN, "Breaker still OPEN after health check");
      ta.strictEqual(breaker.halfOpenProbes, 0, "No probes consumed");
    });
  });

  // ===========================================================================
  // E. HALF_OPEN circuit — DEGRADED without router contact
  // ===========================================================================
  await describe("checkMikroTikRouterHealth — HALF_OPEN circuit", async () => {
    await test("returns DEGRADED without router contact when circuit is HALF_OPEN", async () => {
      resetFirestore();
      resetCircuitBreakers();

      let executeCalled = false;

      const mockTransportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportPath] = (() => {
        const m = new Module(mockTransportPath, null);
        m.filename = mockTransportPath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportPath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async execute() { executeCalled = true; return { ok: true }; },
              async close() { },
            });
          },
        };
        return m;
      })();

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      breaker.state = CIRCUIT_STATES.HALF_OPEN;
      breaker.halfOpenProbes = 0;
      ta.strictEqual(breaker.state, CIRCUIT_STATES.HALF_OPEN);

      const result = await localCheck(SESSION_ID, { userId: USER_ID });
      ta.strictEqual(result.healthy, false);
      ta.strictEqual(result.state, "degraded");
      ta.strictEqual(result.reason, "half_open");
      ta.strictEqual(executeCalled, false, "No router contact when circuit is HALF_OPEN");
    });

    await test("HALF_OPEN circuit does not consume recovery probes", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      breaker.state = CIRCUIT_STATES.HALF_OPEN;
      breaker.halfOpenProbes = 1;

      const mockTransportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportPath] = (() => {
        const m = new Module(mockTransportPath, null);
        m.filename = mockTransportPath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportPath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async execute() { return { ok: true }; },
              async close() { },
            });
          },
        };
        return m;
      })();

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      await localCheck(SESSION_ID, { userId: USER_ID });
      ta.strictEqual(breaker.halfOpenProbes, 1, "Probe count unchanged after HALF_OPEN health check");
    });
  });

  // ===========================================================================
  // F. Transport cleanup — guaranteed close
  // ===========================================================================
  await describe("Transport cleanup — guaranteed close", async () => {
    await test("transport is closed after successful probe", async () => {
      resetFirestore();
      resetCircuitBreakers();

      let transportCloseCalled = false;

      const mockTransportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportPath] = (() => {
        const m = new Module(mockTransportPath, null);
        m.filename = mockTransportPath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportPath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async execute() { return { ok: true, attempts: 1 }; },
              async close() { transportCloseCalled = true; },
            });
          },
        };
        return m;
      })();

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      await localCheck(SESSION_ID, { userId: USER_ID });
      ta.strictEqual(transportCloseCalled, true, "Transport close called after successful probe");
    });

    await test("transport is closed after failed probe", async () => {
      resetFirestore();
      resetCircuitBreakers();

      let transportCloseCalled = false;

      const mockTransportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportPath] = (() => {
        const m = new Module(mockTransportPath, null);
        m.filename = mockTransportPath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportPath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async execute() {
                throw new Error("Simulated probe failure");
              },
              async close() { transportCloseCalled = true; },
            });
          },
        };
        return m;
      })();

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      try {
        await localCheck(SESSION_ID, { userId: USER_ID });
        ta.fail("Should have thrown for failed probe");
      } catch (err) {
        ta.strictEqual(transportCloseCalled, true, "Transport close called after failed probe");
        ta.ok(err.code === "ADAPTER_UNHEALTHY" || err.message.includes("health check failed"), `Expected ADAPTER_UNHEALTHY, got ${err.code}: ${err.message}`);
      }
    });

    await test("cleanup error does not mask original probe error", async () => {
      resetFirestore();
      resetCircuitBreakers();

      let transportCloseCalled = false;
      let closeWillThrow = true;

      const mockTransportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportPath] = (() => {
        const m = new Module(mockTransportPath, null);
        m.filename = mockTransportPath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportPath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async execute() {
                throw new Error("Simulated probe failure");
              },
              async close() {
                transportCloseCalled = true;
                if (closeWillThrow) {
                  throw new Error("Simulated close failure");
                }
              },
            });
          },
        };
        return m;
      })();

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      const localEnforcement = require("../services/roamingEnforcementService");
      const localCheck = localEnforcement.checkMikroTikRouterHealth;
      resetCircuitBreakers();

      try {
        await localCheck(SESSION_ID, { userId: USER_ID });
        ta.fail("Should have thrown");
      } catch (err) {
        // Original probe error should propagate, not the close error
        ta.ok(err.message.includes("Simulated probe failure"), `Original error should propagate, got: ${err.message}`);
        ta.ok(!err.message.includes("Simulated close failure"), "Close error should not mask original error");
      }
    });
  });

  // ===========================================================================
  // G. Existing non-MikroTik AAA health checks unchanged
  // ===========================================================================
  await describe("checkEnforcementHealth — non-MikroTik AAA unchanged", async () => {
    await test("rejects missing adapter key", async () => {
      resetFirestore();

      try {
        await enforcement.checkEnforcementHealth("");
        ta.fail("Should have thrown for empty adapter key");
      } catch (err) {
        ta.strictEqual(err.code, "VALIDATION_ERROR");
      }
    });

    await test("MikroTik branch still requires session parameter", async () => {
      resetFirestore();

      try {
        await enforcement.checkEnforcementHealth("mikrotik");
        ta.fail("Should have thrown for MikroTik without session");
      } catch (err) {
        ta.strictEqual(err.code, "VALIDATION_ERROR");
        ta.ok(err.message.includes("Session is required"));
      }
    });
  });

  const allPassed = report();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
