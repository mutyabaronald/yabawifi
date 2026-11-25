"use strict";

// Phase 8.5D-B.2.4 — MikroTik health check verification.
//
// Exercises checkEnforcementHealth() with the MikroTik-specific branch,
// including read-only circuit-breaker inspection, DEGRADED responses for
// OPEN/HALF_OPEN states, and guaranteed transport cleanup.
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

// Inject firebase mock into require.cache before loading any dependent module
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
} = routerOsClientModule;

// =============================================================================
// Test fixtures
// =============================================================================

const VISITED_OWNER_ID = "owner-visited-1";
const HOME_OWNER_ID = "owner-home-1";
const USER_ID = "user-1";
const SESSION_ID = "session-health-1";
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

const IDENTITY_KEY = "test-identity-key-not-for-production";

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
let checkEnforcementHealth;

function resetFirestore(extraMocks = {}) {
  const mockDb = new MockFirestore();
  firebaseMock.db = mockDb;

  mockDb.collection("roaming_hotspots").doc(HOTSPOT_ID).set(TEST_HOTSPOT);
  mockDb.collection("devices").doc(DEVICE_ID).set(TEST_DEVICE);
  mockDb.collection("roaming_entitlements").doc(ENTITLEMENT_ID).set(TEST_ENTITLEMENT);

  // Clear all caches so modules load fresh
  for (const key of ENFORCEMENT_CACHE_KEYS) {
    delete require.cache[key];
  }
  // Keep firebase mock in cache (it was cleared above)
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

  // Load enforcement service fresh (routerOsClient.js loads naturally with
  // getCircuitBreakerStatus since its cache was cleared).
  enforcement = require("../services/roamingEnforcementService");
  checkEnforcementHealth = enforcement.checkEnforcementHealth;

  // Reset circuit breakers between tests for isolation
  resetCircuitBreakers();
}

function buildEnforcementContext(overrides = {}) {
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
  // A. getCircuitBreakerStatus — read-only inspection
  // ===========================================================================
  await describe("getCircuitBreakerStatus — read-only inspection", async () => {
    await test("returns CLOSED default when no breaker is registered", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const status = getCircuitBreakerStatus(ROUTER_HOST, ROUTER_PORT);
      ta.strictEqual(status.state, CIRCUIT_STATES.CLOSED);
      ta.strictEqual(status.failureCount, 0);
      ta.strictEqual(status.successCount, 0);
      ta.strictEqual(status.halfOpenProbes, 0);
    });

    await test("does not create a breaker when none exists", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const status1 = getCircuitBreakerStatus(ROUTER_HOST, ROUTER_PORT);
      const status2 = getCircuitBreakerStatus(ROUTER_HOST, ROUTER_PORT);
      ta.deepStrictEqual(status1, status2, "Same result on repeated calls");
    });

    await test("does not change state of an existing CLOSED breaker", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      ta.strictEqual(breaker.state, CIRCUIT_STATES.CLOSED);

      const status = getCircuitBreakerStatus(ROUTER_HOST, ROUTER_PORT);
      ta.strictEqual(status.state, CIRCUIT_STATES.CLOSED);
      ta.strictEqual(breaker.state, CIRCUIT_STATES.CLOSED, "Breaker state unchanged after inspection");
    });

    await test("does not transition OPEN breaker to HALF_OPEN", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      breaker.state = CIRCUIT_STATES.OPEN;
      breaker.lastStateChange = Date.now() - 60000;

      const status = getCircuitBreakerStatus(ROUTER_HOST, ROUTER_PORT);
      ta.strictEqual(status.state, CIRCUIT_STATES.OPEN);
      ta.strictEqual(breaker.state, CIRCUIT_STATES.OPEN, "Breaker still OPEN after inspection");
    });

    await test("does not consume HALF_OPEN recovery probes", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      breaker.state = CIRCUIT_STATES.HALF_OPEN;
      breaker.halfOpenProbes = 1;

      const status = getCircuitBreakerStatus(ROUTER_HOST, ROUTER_PORT);
      ta.strictEqual(status.state, CIRCUIT_STATES.HALF_OPEN);
      ta.strictEqual(status.halfOpenProbes, 1, "Probe count unchanged after inspection");
      ta.strictEqual(breaker.halfOpenProbes, 1, "Breaker halfOpenProbes unchanged");
    });

    await test("returns existing breaker status without mutation", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      breaker.recordFailure("timeout");
      breaker.recordFailure("timeout");

      const status = getCircuitBreakerStatus(ROUTER_HOST, ROUTER_PORT);
      ta.strictEqual(status.state, CIRCUIT_STATES.CLOSED);
      ta.strictEqual(status.failureCount, 2, "Failure count preserved");
      ta.strictEqual(breaker.failureCount, 2, "Breaker failure count unchanged");
    });
  });

  // ===========================================================================
  // B. classifyTransportError — export verification
  // ===========================================================================
  await describe("classifyTransportError — export verification", async () => {
    await test("is exported from routerOsClient", async () => {
      resetFirestore();
      ta.strictEqual(typeof routerOsClientModule.classifyTransportError, "function");
    });

    await test("maps timeout kind to MIKROTIK_TIMEOUT", async () => {
      resetFirestore();
      const { classifyTransportError } = routerOsClientModule;

      const err = { kind: "timeout", retryable: true };
      const result = classifyTransportError(err);
      ta.strictEqual(result.kind, "timeout");
      ta.strictEqual(result.code, MIKROTIK_ERROR_CODES.MIKROTIK_TIMEOUT);
      ta.strictEqual(result.retryable, true);
    });

    await test("maps network kind to MIKROTIK_NETWORK_ERROR", async () => {
      resetFirestore();
      const { classifyTransportError } = routerOsClientModule;

      const err = { kind: "network", retryable: true };
      const result = classifyTransportError(err);
      ta.strictEqual(result.kind, "network");
      ta.strictEqual(result.code, MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_ERROR);
      ta.strictEqual(result.retryable, true);
    });

    await test("maps auth kind to MIKROTIK_AUTH_FAILED", async () => {
      resetFirestore();
      const { classifyTransportError } = routerOsClientModule;

      const err = { kind: "auth", retryable: false };
      const result = classifyTransportError(err);
      ta.strictEqual(result.kind, "auth");
      ta.strictEqual(result.code, MIKROTIK_ERROR_CODES.MIKROTIK_AUTH_FAILED);
      ta.strictEqual(result.retryable, false);
    });

    await test("maps protocol kind to MIKROTIK_INVALID_RESPONSE", async () => {
      resetFirestore();
      const { classifyTransportError } = routerOsClientModule;

      const err = { kind: "protocol", retryable: false };
      const result = classifyTransportError(err);
      ta.strictEqual(result.kind, "protocol");
      ta.strictEqual(result.code, MIKROTIK_ERROR_CODES.MIKROTIK_INVALID_RESPONSE);
      ta.strictEqual(result.retryable, false);
    });

    await test("maps unknown kind to TRANSPORT", async () => {
      resetFirestore();
      const { classifyTransportError } = routerOsClientModule;

      const err = { kind: "unknown_kind", retryable: false };
      const result = classifyTransportError(err);
      ta.strictEqual(result.kind, "transport");
      ta.strictEqual(result.code, MIKROTIK_ERROR_CODES.MIKROTIK_TRANSPORT_FAILURE);
    });

    await test("handles MikrotikTransportFailure from transport.execute()", async () => {
      resetFirestore();
      const { classifyTransportError, MikrotikTransportFailure } = routerOsClientModule;

      const err = new MikrotikTransportFailure("network", "router unreachable", true);
      const result = classifyTransportError(err);
      ta.strictEqual(result.kind, "network");
      ta.strictEqual(result.code, MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_ERROR);
      ta.strictEqual(result.retryable, true);
    });
  });

  // ===========================================================================
  // C. checkEnforcementHealth — MikroTik CLOSED circuit
  // ===========================================================================
  await describe("checkEnforcementHealth — MikroTik CLOSED circuit", async () => {
    await test("permits direct health probe when circuit is CLOSED", async () => {
      resetFirestore();
      resetCircuitBreakers();

      // Mock routerOsClient so resolveAdapterForSession gets a client with a
      // working health() method
      const clientModulePath = require.resolve("../services/mikrotik/routerOsClient.js");
      const healthResult = { reachable: true, state: "reachable", reason: null, attempts: 1, checkedAt: new Date().toISOString() };
      require.cache[clientModulePath] = (() => {
        const m = new Module(clientModulePath, null);
        m.filename = clientModulePath;
        m.paths = Module._nodeModulePaths(path.dirname(clientModulePath));
        m.exports = {
          ...routerOsClientModule,
          createRouterOsClient: () => ({
            addHotspotUser: async () => Object.freeze({ ok: true }),
            removeHotspotUser: async () => Object.freeze({ ok: true }),
            removeActiveHotspotUser: async () => Object.freeze({ ok: true }),
            health: async () => Object.freeze({ reachable: true, state: "reachable", reason: null, attempts: 1 }),
            close: async () => { },
          }),
        };
        return m;
      })();

      // Need to clear enforcement service cache too since it caches routerOsClient
      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      enforcement = require("../services/roamingEnforcementService");
      checkEnforcementHealth = enforcement.checkEnforcementHealth;

      const result = await checkEnforcementHealth("mikrotik", TEST_SESSION);
      ta.strictEqual(result.healthy, true);
      ta.strictEqual(result.state, "healthy");
      ta.strictEqual(result.adapterKey, "mikrotik");
      ta.ok(result.checkedAt);
    });
  });

  // ===========================================================================
  // D. checkEnforcementHealth — MikroTik OPEN circuit
  // ===========================================================================
  await describe("checkEnforcementHealth — MikroTik OPEN circuit", async () => {
    await test("returns DEGRADED without router contact when circuit is OPEN", async () => {
      resetFirestore();
      resetCircuitBreakers();

      // Create and OPEN the breaker
      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("timeout");
      }
      ta.strictEqual(breaker.state, CIRCUIT_STATES.OPEN);

      const result = await checkEnforcementHealth("mikrotik", TEST_SESSION);
      ta.strictEqual(result.healthy, false);
      ta.strictEqual(result.state, "degraded");
      ta.strictEqual(result.reason, "circuit_open");
      ta.ok(result.checkedAt);
      ta.ok(result.breaker);
      ta.strictEqual(result.breaker.state, CIRCUIT_STATES.OPEN);
    });

    await test("OPEN circuit response does not expose credentials", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("timeout");
      }

      const result = await checkEnforcementHealth("mikrotik", TEST_SESSION);
      const resultStr = JSON.stringify(result);
      ta.ok(!resultStr.includes("password"), "DEGRADED response must not contain password");
      ta.ok(!resultStr.includes(SECRET_REF), "DEGRADED response must not contain secret ref");
    });
  });

  // ===========================================================================
  // E. checkEnforcementHealth — MikroTik HALF_OPEN circuit
  // ===========================================================================
  await describe("checkEnforcementHealth — MikroTik HALF_OPEN circuit", async () => {
    await test("returns DEGRADED without router contact when circuit is HALF_OPEN", async () => {
      resetFirestore();
      resetCircuitBreakers();

      // Create and set HALF_OPEN state directly
      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      breaker.state = CIRCUIT_STATES.HALF_OPEN;
      breaker.halfOpenProbes = 0;
      ta.strictEqual(breaker.state, CIRCUIT_STATES.HALF_OPEN);

      const result = await checkEnforcementHealth("mikrotik", TEST_SESSION);
      ta.strictEqual(result.healthy, false);
      ta.strictEqual(result.state, "degraded");
      ta.strictEqual(result.reason, "half_open");
      ta.ok(result.checkedAt);
      ta.ok(result.breaker);
      ta.strictEqual(result.breaker.state, CIRCUIT_STATES.HALF_OPEN);
    });

    await test("HALF_OPEN circuit does not consume recovery probes", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      breaker.state = CIRCUIT_STATES.HALF_OPEN;
      breaker.halfOpenProbes = 1;

      const result = await checkEnforcementHealth("mikrotik", TEST_SESSION);
      ta.strictEqual(breaker.halfOpenProbes, 1, "Probe count unchanged after HALF_OPEN health check");
    });
  });

  // ===========================================================================
  // F. Transport cleanup — guaranteed close
  // ===========================================================================
  await describe("Transport cleanup — guaranteed close", async () => {
    await test("transport is closed after successful CLOSED health check", async () => {
      resetFirestore();
      resetCircuitBreakers();

      let transportCloseCalled = false;

      // Mock mockRouterOsTransport so createMockRouterOsTransport returns a
      // transport with a tracked close() method (this is what's used in
      // non-production mode by resolveAdapterForSession)
      const mockTransportModulePath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
      require.cache[mockTransportModulePath] = (() => {
        const m = new Module(mockTransportModulePath, null);
        m.filename = mockTransportModulePath;
        m.paths = Module._nodeModulePaths(path.dirname(mockTransportModulePath));
        const realMock = require("../services/mikrotik/mockRouterOsTransport");
        m.exports = {
          ...realMock,
          createMockRouterOsTransport: (options = {}) => {
            const base = realMock.createMockRouterOsTransport(options);
            return Object.freeze({
              ...base,
              async close() { transportCloseCalled = true; },
            });
          },
        };
        return m;
      })();

      // Mock routerOsClient so resolveAdapterForSession gets a working client
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

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      enforcement = require("../services/roamingEnforcementService");
      checkEnforcementHealth = enforcement.checkEnforcementHealth;

      const result = await checkEnforcementHealth("mikrotik", TEST_SESSION);
      ta.strictEqual(result.state, "healthy", "Health check should return healthy");
      ta.strictEqual(transportCloseCalled, true, "Transport close called after successful health check");
    });

    await test("no transport creation when circuit is OPEN (DEGRADED)", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("timeout");
      }

      const result = await checkEnforcementHealth("mikrotik", TEST_SESSION);
      ta.strictEqual(result.state, "degraded");
      ta.strictEqual(result.healthy, false);
    });

    await test("no transport creation when circuit is HALF_OPEN (DEGRADED)", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      breaker.state = CIRCUIT_STATES.HALF_OPEN;

      const result = await checkEnforcementHealth("mikrotik", TEST_SESSION);
      ta.strictEqual(result.state, "degraded");
      ta.strictEqual(result.healthy, false);
    });
  });

  // ===========================================================================
  // G. No credential leakage in health check
  // ===========================================================================
  await describe("No credential leakage", async () => {
    await test("CLOSED health check result does not expose credentials", async () => {
      resetFirestore();
      resetCircuitBreakers();

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

      for (const key of ENFORCEMENT_CACHE_KEYS) {
        if (key.includes("roamingEnforcementService")) {
          delete require.cache[key];
        }
      }
      enforcement = require("../services/roamingEnforcementService");
      checkEnforcementHealth = enforcement.checkEnforcementHealth;

      const result = await checkEnforcementHealth("mikrotik", TEST_SESSION);
      const resultStr = JSON.stringify(result);
      ta.ok(!resultStr.includes("password"), "Health result must not contain password");
      ta.ok(!resultStr.includes(SECRET_REF), "Health result must not contain secret reference");
      ta.ok(!resultStr.includes("apiPassword"), "Health result must not contain apiPassword");
      ta.ok(!resultStr.includes("routerOsApiSecretRef"), "Health result must not contain secret ref field");
      ta.ok(!resultStr.includes("test-router-api-password"), "Health result must not contain resolved password");
    });

    await test("DEGRADED response does not expose credentials", async () => {
      resetFirestore();
      resetCircuitBreakers();

      const breaker = getCircuitBreaker(ROUTER_HOST, ROUTER_PORT);
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("timeout");
      }

      const result = await checkEnforcementHealth("mikrotik", TEST_SESSION);
      const resultStr = JSON.stringify(result);
      ta.ok(!resultStr.includes("password"), "DEGRADED response must not contain password");
      ta.ok(!resultStr.includes(SECRET_REF), "DEGRADED response must not contain secret reference");
    });
  });

  // ===========================================================================
  // H. Non-MikroTik AAA health checks unchanged
  // ===========================================================================
  await describe("Non-MikroTik AAA health checks unchanged", async () => {
    await test("rejects missing adapter key", async () => {
      resetFirestore();

      try {
        await checkEnforcementHealth("");
        ta.fail("Should have thrown for empty adapter key");
      } catch (err) {
        ta.strictEqual(err.code, "VALIDATION_ERROR");
      }
    });

    await test("rejects undefined adapter key", async () => {
      resetFirestore();

      try {
        await checkEnforcementHealth(undefined);
        ta.fail("Should have thrown for undefined adapter key");
      } catch (err) {
        ta.strictEqual(err.code, "VALIDATION_ERROR");
      }
    });

    await test("MikroTik requires session parameter", async () => {
      resetFirestore();

      try {
        await checkEnforcementHealth("mikrotik");
        ta.fail("Should have thrown for MikroTik without session");
      } catch (err) {
        ta.strictEqual(err.code, "VALIDATION_ERROR");
        ta.ok(err.message.includes("Session is required"), "Error should mention session requirement");
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
