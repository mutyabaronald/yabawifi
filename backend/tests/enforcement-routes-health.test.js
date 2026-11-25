"use strict";

// Phase 8.5D-B.2.4 — HTTP integration tests for GET /api/roaming/enforcement/:sessionId/health
//
// Tests authentication, owner isolation, session authorization, transport
// execution, and response sanitization at the Express route level.
//
// Strictly read-only with respect to production implementation files. No
// production code is modified. No real sockets, routers, or Firebase.
// Uses supertest against an Express app with the enforcement router mounted
// and all dependencies mocked via require.cache manipulation.

const assert = require("assert");
const crypto = require("crypto");
const express = require("express");
const request = require("supertest");
const path = require("path");
const Module = require("module");

const {
  MockFirestore,
} = require("./helpers/mock-firestore");
const { test, describe, report, ta } = require("./helpers/test-runner");

// =============================================================================
// Firebase mock — set in require.cache BEFORE any module that requires
// ../firebase is loaded.
// =============================================================================

const servicesDir = path.dirname(require.resolve("../services/roamingEnforcementService.js"));
const firebasePath = require.resolve("../firebase.js", { paths: [servicesDir] });

const firebaseMock = {
  db: null,
  admin: {
    auth: () => firebaseAdminMock,
    firestore: () => firebaseMock.db,
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
  },
};

let firebaseAdminMock = {
  verifyIdToken: async () => { throw new Error("not authenticated"); },
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
// Test fixtures
// =============================================================================

const VISITED_OWNER_ID = "owner-visited-1";
const HOME_OWNER_ID = "owner-home-1";
const USER_ID = "user-1";
const SESSION_ID = "session-http-health-1";
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

const SESSION_OTHER_USER = {
  sessionId: "session-other-user",
  id: "session-other-user",
  status: "authorized",
  userRef: { userId: "other-user" },
  homeOwnerId: HOME_OWNER_ID,
  visitedOwnerId: VISITED_OWNER_ID,
  visitedHotspotId: HOTSPOT_ID,
  entitlementId: ENTITLEMENT_ID,
  aaaAdapterKey: "mikrotik",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};

const SESSION_OTHER_OWNER = {
  sessionId: "session-other-owner",
  id: "session-other-owner",
  status: "authorized",
  userRef: { userId: USER_ID },
  homeOwnerId: "other-owner",
  visitedOwnerId: "other-visited-owner",
  visitedHotspotId: "other-hotspot",
  entitlementId: ENTITLEMENT_ID,
  aaaAdapterKey: "mikrotik",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};

// =============================================================================
// Auth state (module-level)
// =============================================================================

let currentUserAuth = null;
let userAuthShouldFail = false;
let currentOwnerAuth = null;
let ownerAuthShouldFail = false;

let MockRegistryError;

// =============================================================================
// Cache keys to clear between tests
// =============================================================================

const ENFORCEMENT_CACHE_KEYS = [
  require.resolve("../services/roamingEnforcementService.js"),
  require.resolve("../services/roamingRegistryService.js"),
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
  require.resolve("../routes/roaming/enforcement.js"),
  firebasePath,
];

// =============================================================================
// Mock module factories
// =============================================================================

function makeMockRegistry() {
  class RegistryError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  MockRegistryError = RegistryError;
  return {
    authenticateOwnerOrSuper: async (req) => {
      if (ownerAuthShouldFail || !currentOwnerAuth) {
        throw new RegistryError(401, "unauthenticated", "Authentication token required");
      }
      return { ...currentOwnerAuth };
    },
    RegistryError,
    resolveMikroTikContext: async (session) => ({
      device: TEST_DEVICE,
      routerUsername: "test-router-user",
      remainingRaus: 60,
      routerConfig: {
        host: TEST_DEVICE.routerOsHost,
        port: TEST_DEVICE.routerOsApiPort,
        apiUsername: TEST_DEVICE.routerOsApiUsername,
        apiSecretRef: TEST_DEVICE.routerOsApiSecretRef,
        tls: TEST_DEVICE.routerOsTls,
        timeoutMs: 5000,
        retries: 3,
      },
    }),
  };
}

function makeMockSessionService() {
  return {
    getRoamingSession: async (sessionId, context) => {
      if (!sessionId || typeof sessionId !== "string") {
        const err = new Error("Session ID is required");
        err.status = 400;
        err.code = "VALIDATION_ERROR";
        throw err;
      }
      let session;
      if (sessionId === SESSION_ID) {
        session = { ...TEST_SESSION };
      } else if (sessionId === "session-other-user") {
        session = { ...SESSION_OTHER_USER };
      } else if (sessionId === "session-other-owner") {
        session = { ...SESSION_OTHER_OWNER };
      } else {
        const err = new Error("Session not found");
        err.status = 404;
        err.code = "NOT_FOUND";
        throw err;
      }
      if (context.userId && session.userRef.userId !== context.userId) {
        const err = new Error("Access denied");
        err.status = 403;
        err.code = "CONTEXT_MISMATCH";
        throw err;
      }
      if (context.ownerId) {
        if (
          session.homeOwnerId !== context.ownerId &&
          session.visitedOwnerId !== context.ownerId
        ) {
          const err = new Error("Access denied for this owner");
          err.status = 403;
          err.code = "CONTEXT_MISMATCH";
          throw err;
        }
      }
      if (new Date() > new Date(session.expiresAt) && session.status === "authorized") {
        const err = new Error("Session has expired");
        err.status = 401;
        err.code = "EXPIRED_TOKEN";
        throw err;
      }
      return session;
    },
    SESSION_STATUSES: { authorized: "authorized", active: "active", expired: "expired" },
    ACTIVE_STATUSES: ["authorized", "active"],
    RoamingSessionError: class extends Error {
      constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
      }
    },
  };
}

function makeMockEntitlementService() {
  return {
    checkEntitlementEligibility: async () => ({
      eligible: true,
      entitlementId: ENTITLEMENT_ID,
    }),
  };
}

function makeMockSecrets() {
  const secretsModule = require("../services/mikrotik/secrets");
  const {
    createStaticTestSecretResolver: realCreateStaticTestSecretResolver,
  } = secretsModule;
  const {
    mikrotikError,
    MIKROTIK_ERROR_CODES,
  } = require("../services/mikrotik/errors");

  return {
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
    mikrotikError,
    MIKROTIK_ERROR_CODES,
  };
}

function makeMockRouterOsClient() {
  const routerOsClientModule = require("../services/mikrotik/routerOsClient");
  return {
    ...routerOsClientModule,
    createRouterOsClient: () => ({
      addHotspotUser: async () => Object.freeze({ ok: true }),
      removeHotspotUser: async () => Object.freeze({ ok: true }),
      removeActiveHotspotUser: async () => Object.freeze({ ok: true }),
      health: async () => Object.freeze({ reachable: true, state: "reachable", reason: null, attempts: 1 }),
      close: async () => { },
    }),
  };
}

function makeMockTransport() {
  let executeCalls = [];
  const transport = Object.freeze({
    name: "mock-transport",
    closed: false,
    calls: executeCalls,
    get callCount() { return executeCalls.length; },
    async execute(request) {
      executeCalls.push(request);
      return { ok: true, attempts: 1, reachable: true, state: "reachable" };
    },
    async close() { },
  });
  return { transport, executeCalls };
}

function makeMockFeatureFlag() {
  return {
    isMikrotikApiEnabled: () => false,
    isTestModeAllowed: () => true,
    assertMikrotikApiEnabled: (options = {}) => {
      if (options.testMode === true) {
        return { enabled: true, mode: "explicit_test_mode" };
      }
      const { mikrotikError, MIKROTIK_ERROR_CODES } = require("../services/mikrotik/errors");
      throw mikrotikError(
        MIKROTIK_ERROR_CODES.MIKROTIK_API_DISABLED,
        "MikroTik router control is disabled.",
        { envVar: "ROAMING_MIKROTIK_API_ENABLED" },
      );
    },
    NETWORK_CONTROL_MODES: { NONE: "none", YABALINK_MANAGED: "yabalink_managed", PARTNER_MANAGED: "partner_managed" },
    NETWORK_CONTROL_VALUES: ["none", "yabalink_managed", "partner_managed"],
    DEFAULT_ROUTER_OS_API_PORT: 8728,
  };
}

// =============================================================================
// App builder — uses require.cache manipulation (no module interceptor)
// =============================================================================

let db;
let app;
let transportExecuteCalls;

function resetTestState() {
  db = new MockFirestore();
  firebaseMock.db = db;
  currentUserAuth = null;
  userAuthShouldFail = false;
  currentOwnerAuth = null;
  ownerAuthShouldFail = false;

  // Seed Firestore
  db.collection("roaming_hotspots").doc(HOTSPOT_ID).set(TEST_HOTSPOT);
  db.collection("devices").doc(DEVICE_ID).set(TEST_DEVICE);
  db.collection("roaming_entitlements").doc(ENTITLEMENT_ID).set(TEST_ENTITLEMENT);
  db.collection("roaming_sessions").doc(SESSION_ID).set(TEST_SESSION);
  db.collection("roaming_sessions").doc("session-other-user").set(SESSION_OTHER_USER);
  db.collection("roaming_sessions").doc("session-other-owner").set(SESSION_OTHER_OWNER);

  // Clear all enforcement-related caches
  for (const key of ENFORCEMENT_CACHE_KEYS) {
    delete require.cache[key];
  }
  // Keep firebase mock in cache
  require.cache[firebasePath] = makeFirebaseModule();
}

function setUserAuth(auth) {
  currentUserAuth = auth;
}

function setUserAuthFail(shouldFail) {
  userAuthShouldFail = shouldFail;
}

function setOwnerAuth(auth) {
  currentOwnerAuth = auth;
}

function setOwnerAuthFail(shouldFail) {
  ownerAuthShouldFail = shouldFail;
}

function buildApp() {
  // Configure firebase admin mock
  firebaseAdminMock = {
    verifyIdToken: async (idToken) => {
      if (userAuthShouldFail || !currentUserAuth) {
        throw new Error("Invalid Firebase ID token");
      }
      return { uid: currentUserAuth.uid };
    },
  };

  // Inject all mocks into require.cache BEFORE loading enforcement route
  require.cache[firebasePath] = makeFirebaseModule();

  // roamingRegistryService
  const registryPath = require.resolve("../services/roamingRegistryService.js");
  require.cache[registryPath] = (() => {
    const m = new Module(registryPath, null);
    m.filename = registryPath;
    m.paths = Module._nodeModulePaths(path.dirname(registryPath));
    m.exports = makeMockRegistry();
    return m;
  })();

  // roamingSessionService
  const sessionPath = require.resolve("../services/roamingSessionService.js");
  require.cache[sessionPath] = (() => {
    const m = new Module(sessionPath, null);
    m.filename = sessionPath;
    m.paths = Module._nodeModulePaths(path.dirname(sessionPath));
    m.exports = makeMockSessionService();
    return m;
  })();

  // roamingEntitlementService
  const entitlementPath = require.resolve("../services/roamingEntitlementService.js");
  require.cache[entitlementPath] = (() => {
    const m = new Module(entitlementPath, null);
    m.filename = entitlementPath;
    m.paths = Module._nodeModulePaths(path.dirname(entitlementPath));
    m.exports = makeMockEntitlementService();
    return m;
  })();

  // mikrotik/secrets
  const secretsPath = require.resolve("../services/mikrotik/secrets.js");
  require.cache[secretsPath] = (() => {
    const m = new Module(secretsPath, null);
    m.filename = secretsPath;
    m.paths = Module._nodeModulePaths(path.dirname(secretsPath));
    m.exports = makeMockSecrets();
    return m;
  })();

  // mikrotik/routerOsClient
  const clientPath = require.resolve("../services/mikrotik/routerOsClient.js");
  require.cache[clientPath] = (() => {
    const m = new Module(clientPath, null);
    m.filename = clientPath;
    m.paths = Module._nodeModulePaths(path.dirname(clientPath));
    m.exports = makeMockRouterOsClient();
    return m;
  })();

  // mikrotik/mockRouterOsTransport
  const { transport, executeCalls } = makeMockTransport();
  transportExecuteCalls = executeCalls;
  const transportPath = require.resolve("../services/mikrotik/mockRouterOsTransport.js");
  require.cache[transportPath] = (() => {
    const m = new Module(transportPath, null);
    m.filename = transportPath;
    m.paths = Module._nodeModulePaths(path.dirname(transportPath));
    const realMock = require("../services/mikrotik/mockRouterOsTransport");
    m.exports = {
      ...realMock,
      createMockRouterOsTransport: (options = {}) => transport,
    };
    return m;
  })();

  // mikrotik/featureFlag
  const featureFlagPath = require.resolve("../services/mikrotik/featureFlag.js");
  require.cache[featureFlagPath] = (() => {
    const m = new Module(featureFlagPath, null);
    m.filename = featureFlagPath;
    m.paths = Module._nodeModulePaths(path.dirname(featureFlagPath));
    m.exports = makeMockFeatureFlag();
    return m;
  })();

  // Load enforcement route fresh
  const enforcementPath = require.resolve("../routes/roaming/enforcement.js");
  delete require.cache[enforcementPath];
  const router = require("../routes/roaming/enforcement.js");

  const testApp = express();
  testApp.use(express.json());
  testApp.use("/api/roaming/enforcement", router);
  return testApp;
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  // ===========================================================================
  // A. Authentication
  // ===========================================================================
  await describe("GET /:sessionId/health — authentication", async () => {
    await test("rejects unauthenticated requests", async () => {
      resetTestState();
      setUserAuth(null);
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`);
      ta.strictEqual(res.status, 401);
      ta.strictEqual(res.body.success, false);
    });

    await test("rejects requests with body-supplied identity when unauthenticated", async () => {
      resetTestState();
      setUserAuth(null);
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`)
        .send({ userId: USER_ID, ownerId: VISITED_OWNER_ID });
      ta.strictEqual(res.status, 401);
      ta.strictEqual(res.body.success, false);
    });

    await test("authenticated user can access their own session", async () => {
      resetTestState();
      setUserAuth({ uid: USER_ID, method: "firebase_id_token" });
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`)
        .set("Authorization", "Bearer valid-token");
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
      ta.strictEqual(res.body.sessionId, SESSION_ID);
      ta.strictEqual(res.body.adapterKey, "mikrotik");
      ta.strictEqual(res.body.healthy, true);
      ta.strictEqual(res.body.state, "healthy");
      ta.ok(res.body.checkedAt);
    });

    await test("query-string identity cannot override authenticated user identity", async () => {
      resetTestState();
      setUserAuth({ uid: USER_ID, method: "firebase_id_token" });
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health?userId=other-user&ownerId=other-owner`)
        .set("Authorization", "Bearer valid-token");
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
    });

    await test("request-body identity cannot override authenticated user identity", async () => {
      resetTestState();
      setUserAuth({ uid: USER_ID, method: "firebase_id_token" });
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`)
        .set("Authorization", "Bearer valid-token")
        .send({ userId: "other-user", ownerId: "other-owner" });
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
    });
  });

  // ===========================================================================
  // B. Owner isolation
  // ===========================================================================
  await describe("GET /:sessionId/health — owner isolation", async () => {
    await test("authenticated owner can check session in their visited network", async () => {
      resetTestState();
      setUserAuth(null);
      setOwnerAuth({ ownerId: VISITED_OWNER_ID, kind: "owner" });
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`);
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
      ta.strictEqual(res.body.healthy, true);
    });

    await test("authenticated owner can check session in their home network", async () => {
      resetTestState();
      setUserAuth(null);
      setOwnerAuth({ ownerId: HOME_OWNER_ID, kind: "owner" });
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`);
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
    });

    await test("owner cannot check session in another owner's network", async () => {
      resetTestState();
      setUserAuth(null);
      setOwnerAuth({ ownerId: "other-owner", kind: "owner" });
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`);
      ta.strictEqual(res.status, 403);
      ta.strictEqual(res.body.success, false);
    });

    await test("owner cannot check another owner's session via session-other-owner", async () => {
      resetTestState();
      setUserAuth(null);
      setOwnerAuth({ ownerId: VISITED_OWNER_ID, kind: "owner" });
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/session-other-owner/health`);
      ta.strictEqual(res.status, 403);
      ta.strictEqual(res.body.success, false);
    });
  });

  // ===========================================================================
  // C. User isolation
  // ===========================================================================
  await describe("GET /:sessionId/health — user isolation", async () => {
    await test("user cannot check another user's session", async () => {
      resetTestState();
      setUserAuth({ uid: USER_ID, method: "firebase_id_token" });
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/session-other-user/health`)
        .set("Authorization", "Bearer valid-token");
      ta.strictEqual(res.status, 403);
      ta.strictEqual(res.body.success, false);
    });

    await test("user with wrong uid cannot check session", async () => {
      resetTestState();
      setUserAuth({ uid: "different-user", method: "firebase_id_token" });
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`)
        .set("Authorization", "Bearer valid-token");
      ta.strictEqual(res.status, 403);
      ta.strictEqual(res.body.success, false);
    });
  });

  // ===========================================================================
  // D. Invalid session IDs
  // ===========================================================================
  await describe("GET /:sessionId/health — invalid sessions", async () => {
    await test("rejects nonexistent session ID", async () => {
      resetTestState();
      setUserAuth({ uid: USER_ID, method: "firebase_id_token" });
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/nonexistent-session/health`)
        .set("Authorization", "Bearer valid-token");
      ta.ok(res.status === 404 || res.status === 500);
      ta.strictEqual(res.body.success, false);
    });

    await test("rejects empty session ID", async () => {
      resetTestState();
      setUserAuth({ uid: USER_ID, method: "firebase_id_token" });
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement//health`)
        .set("Authorization", "Bearer valid-token");
      ta.ok(res.status === 400 || res.status === 404);
      if (res.status === 400) {
        ta.strictEqual(res.body.success, false);
      }
    });
  });

  // ===========================================================================
  // E. No transport contact on authorization failure
  // ===========================================================================
  await describe("GET /:sessionId/health — no router contact on auth failure", async () => {
    await test("unauthenticated request does not contact router", async () => {
      resetTestState();
      setUserAuth(null);
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`);
      ta.strictEqual(res.status, 401);
      ta.ok(transportExecuteCalls.length === 0, "No transport.execute() calls on unauthenticated request");
    });

    await test("cross-owner request does not contact router", async () => {
      resetTestState();
      setUserAuth(null);
      setOwnerAuth({ ownerId: "other-owner", kind: "owner" });
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`);
      ta.strictEqual(res.status, 403);
      ta.ok(transportExecuteCalls.length === 0, "No transport.execute() calls on cross-owner request");
    });

    await test("cross-user request does not contact router", async () => {
      resetTestState();
      setUserAuth({ uid: "different-user", method: "firebase_id_token" });
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`)
        .set("Authorization", "Bearer valid-token");
      ta.strictEqual(res.status, 403);
      ta.ok(transportExecuteCalls.length === 0, "No transport.execute() calls on cross-user request");
    });
  });

  // ===========================================================================
  // F. Sanitized response fields
  // ===========================================================================
  await describe("GET /:sessionId/health — sanitized response", async () => {
    await test("successful response contains only documented fields", async () => {
      resetTestState();
      setUserAuth({ uid: USER_ID, method: "firebase_id_token" });
      setOwnerAuth(null);
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`)
        .set("Authorization", "Bearer valid-token");
      ta.strictEqual(res.status, 200);
      const body = res.body;
      ta.strictEqual(body.success, true);
      ta.strictEqual(body.sessionId, SESSION_ID);
      ta.strictEqual(body.adapterKey, "mikrotik");
      ta.strictEqual(typeof body.healthy, "boolean");
      ta.strictEqual(body.state, "healthy");
      ta.ok(body.checkedAt);
      // No credential fields
      const bodyStr = JSON.stringify(body);
      ta.ok(!bodyStr.includes("password"), "Response must not contain password");
      ta.ok(!bodyStr.includes("secret"), "Response must not contain secret reference");
      ta.ok(!bodyStr.includes("apiPassword"), "Response must not contain apiPassword");
      ta.ok(!bodyStr.includes("routerOsApiSecretRef"), "Response must not contain secret ref field");
      ta.ok(!bodyStr.includes("test-router-api-password"), "Response must not contain resolved password");
    });

    await test("owner-only context returns sanitized response", async () => {
      resetTestState();
      setUserAuth(null);
      setOwnerAuth({ ownerId: VISITED_OWNER_ID, kind: "owner" });
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/${SESSION_ID}/health`);
      ta.strictEqual(res.status, 200);
      const bodyStr = JSON.stringify(res.body);
      ta.ok(!bodyStr.includes("password"), "Owner response must not contain password");
      ta.ok(!bodyStr.includes("secret"), "Owner response must not contain secret reference");
    });
  });

  // ===========================================================================
  // G. Legacy generic health route — MikroTik excluded
  // ===========================================================================
  await describe("GET /health (legacy) — MikroTik excluded", async () => {
    await test("rejects adapterKey=mikrotik on legacy route", async () => {
      resetTestState();
      setOwnerAuth({ ownerId: VISITED_OWNER_ID, kind: "owner" });
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/health?adapterKey=mikrotik`);
      ta.strictEqual(res.status, 400);
      ta.strictEqual(res.body.success, false);
      ta.strictEqual(res.body.error, "VALIDATION_ERROR");
      ta.ok(res.body.message.includes("session-scoped"), "Message should direct to session-scoped endpoint");
    });

    await test("legacy route without adapterKey returns 400", async () => {
      resetTestState();
      setOwnerAuth({ ownerId: VISITED_OWNER_ID, kind: "owner" });
      const app = buildApp();
      const res = await request(app)
        .get(`/api/roaming/enforcement/health`);
      ta.strictEqual(res.status, 400);
      ta.strictEqual(res.body.success, false);
    });
  });

  const allPassed = report();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
