"use strict";

// Phase 8.5D-A.2 — Inline MikroTik enforcement integration verification.
//
// Exercises the real inline adapter construction in
// backend/services/roamingEnforcementService.js resolveAdapterForSession()
// using isolated mocks: MockFirestore for Firebase, dependency injection for
// session/entitlement services, mock RouterOS transport, static test secret
// resolver.
//
// Strictly read-only with respect to production implementation files. No
// production code is modified. No real sockets, routers, or Firebase.

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");

const {
  MockFirestore,
} = require("./helpers/mock-firestore");
const { mockModule, installInterceptor, uninstallInterceptor, clearMocks } = require("./helpers/mock-modules");
const { test, describe, report, ta } = require("./helpers/test-runner");

// =============================================================================
// Module loading — mock firebase and session/entitlement services once,
// keep the interceptor active for the entire test run.
// =============================================================================

// Resolve the firebase.js path relative to roamingEnforcementService.js's
// directory so the interceptor matches when services require ../firebase.
const servicesDir = path.dirname(require.resolve("../services/roamingEnforcementService.js"));
const firebasePath = require.resolve("../firebase.js", { paths: [servicesDir] });

// Mutable firebase mock: db is a plain property updated by resetFirestore()
// before each test. roamingRegistryService.js captures `db` via
// `const { db } = require("../firebase")` at module load time, so the
// property must be set BEFORE the enforcement service is required.
const firebaseMock = {
  db: null,
  admin: {
    firestore: () => firebaseMock.db,
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
  },
};
mockModule(firebasePath, firebaseMock);

// Mutable session and entitlement service mocks.
// getRoamingSession returns the session object directly (not wrapped in { session: ... })
let sessionMockResult = null;
let entitlementMockResult = { eligible: true, entitlementId: null };

mockModule(require.resolve("../services/roamingSessionService.js"), {
  getRoamingSession: async () => sessionMockResult,
  SESSION_STATUSES: { authorized: "authorized", active: "active", expired: "expired" },
  ACTIVE_STATUSES: ["authorized", "active"],
  RoamingSessionError: class extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  },
});

mockModule(require.resolve("../services/roamingEntitlementService.js"), {
  checkEntitlementEligibility: async () => entitlementMockResult,
});

installInterceptor();

// Require mikrotik primitives (these don't depend on firebase.db at load time
// except secrets.js, which is loaded with the firebase mock already in place).
const {
  createMockRouterOsTransport,
} = require("../services/mikrotik/mockRouterOsTransport");
const {
  createRouterOsClient,
} = require("../services/mikrotik/routerOsClient");
const secretsModule = require("../services/mikrotik/secrets");
const {
  createStaticTestSecretResolver: realCreateStaticTestSecretResolver,
} = secretsModule;
const {
  mikrotikError,
  MIKROTIK_ERROR_CODES,
} = require("../services/mikrotik/errors");

// =============================================================================
// Test fixtures
// =============================================================================

const VISITED_OWNER_ID = "owner-visited-1";
const HOME_OWNER_ID = "owner-home-1";
const USER_ID = "user-1";
const SESSION_ID = "session-inline-1";
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

// =============================================================================
// Helpers
// =============================================================================

// Keys to clear from require.cache so the enforcement service and its
// dependencies load fresh with the current firebaseMock.db on each test.
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
  firebasePath,
];

let enforcement;
let resolveAdapterForSession;

function resetFirestore(extraMocks = {}) {
  // Set firebase mock db BEFORE requiring the enforcement service so that
  // roamingRegistryService.js captures the correct db at module load time.
  const mockDb = new MockFirestore();
  firebaseMock.db = mockDb;

  mockDb.collection("roaming_hotspots").doc(HOTSPOT_ID).set(TEST_HOTSPOT);
  mockDb.collection("devices").doc(DEVICE_ID).set(TEST_DEVICE);
  mockDb.collection("roaming_entitlements").doc(ENTITLEMENT_ID).set(TEST_ENTITLEMENT);

  sessionMockResult = TEST_SESSION;
  entitlementMockResult = { eligible: true, entitlementId: ENTITLEMENT_ID };

  // Clear cache and reload enforcement service so roamingRegistryService
  // picks up the new firebaseMock.db.
  for (const key of ENFORCEMENT_CACHE_KEYS) {
    delete require.cache[key];
  }
  // Also clear MOCK_REGISTRY so mockModule registrations are fresh.
  clearMocks();
  // Re-register mocks since clearMocks cleared MOCK_REGISTRY.
  mockModule(firebasePath, firebaseMock);
  // Mock secrets.js so createStaticTestSecretResolver returns a resolver
  // pre-populated with the test secret, so resolveAdapterForSession creates
  // an adapter that can resolve secrets during provisioning.
  // Also mock createProductionSecretResolver so production-mode tests can
  // resolve a secret without needing encrypted Firestore storage.
  mockModule(require.resolve("../services/mikrotik/secrets.js"), {
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
          "A MikroTik secret encryption key is required in production. Set MIKROTIK_SECRET_ENCRYPTION_KEY.",
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
  });
  mockModule(require.resolve("../services/roamingSessionService.js"), {
    getRoamingSession: async () => sessionMockResult,
    SESSION_STATUSES: { authorized: "authorized", active: "active", expired: "expired" },
    ACTIVE_STATUSES: ["authorized", "active"],
    RoamingSessionError: class extends Error {
      constructor(status, code, message) { super(message); this.status = status; this.code = code; }
    },
  });
  mockModule(require.resolve("../services/roamingEntitlementService.js"), {
    checkEntitlementEligibility: async () => entitlementMockResult,
  });

  // Register any extra mocks provided by the caller.
  for (const [modulePath, mockExports] of Object.entries(extraMocks)) {
    mockModule(modulePath, mockExports);
  }

  installInterceptor();
  try {
    enforcement = require("../services/roamingEnforcementService");
    resolveAdapterForSession = enforcement.resolveAdapterForSession;
  } finally {
    uninstallInterceptor();
  }
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

function wireAdapterWithTransport(adapter) {
  const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
  const client = createRouterOsClient({ transport, timeoutMs: 5000, retries: 3 });
  adapter._client = client;
  adapter._secretResolver = realCreateStaticTestSecretResolver({
    [SECRET_REF]: "test-router-api-password",
  });
  return transport;
}

// =============================================================================
async function main() {
  // ===========================================================================
  // A. Successful provisioning through the inline path
  // ===========================================================================
  await describe("Inline MikroTik — Successful Provisioning", async () => {
    await test("resolveAdapterForSession selects the inline mikrotik branch and returns an adapter", async () => {
      resetFirestore();

      const { adapter, key } = await resolveAdapterForSession(TEST_SESSION);
      ta.ok(adapter, "Adapter should be returned");
      ta.strictEqual(key, "mikrotik", "Key should be mikrotik");
      ta.strictEqual(adapter.getCapabilities().provisionAccess, true);
      ta.strictEqual(adapter.getCapabilities().revokeAccess, true);
      ta.strictEqual(adapter.getCapabilities().disconnect, true);
      ta.strictEqual(adapter.getCapabilities().getUsage, true);
      ta.strictEqual(adapter.getCapabilities().checkHealth, true);
      ta.strictEqual(adapter.getCapabilities().authenticate, false);
      ta.strictEqual(adapter.getCapabilities().authorize, false);
    });

    await test("adapter receives server-resolved device context from resolveMikroTikContext", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      const desc = adapter.describe();
      ta.strictEqual(desc.deviceBound, true, "Device should be bound");
      ta.strictEqual(desc.secretResolverInjected, true, "Secret resolver should be injected");
      ta.strictEqual(desc.clientInjected, true, "RouterOS client should be injected");
      ta.strictEqual(desc.testMode, true, "Test mode should be active in non-production");
    });

    await test("provisionAccess sends expected RouterOS command through mock transport", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      const transport = wireAdapterWithTransport(adapter);

      const context = buildEnforcementContext();
      const result = await adapter.provisionAccess(context);
      ta.strictEqual(result.result, "success");
      ta.strictEqual(result.sessionId, SESSION_ID);
      ta.ok(result.enforcementState.routerUsername, "Router username should be derived");
      ta.strictEqual(result.enforcementState.networkControl, "yabalink_managed");

      ta.ok(transport.callCount > 0, "Transport should have been called");
      const snapshot = transport.safeSnapshot();
      const addCall = snapshot.find((c) => c.command && c.command.includes("/ip hotspot user add"));
      ta.ok(addCall, "Should have an add hotspot user command");
      ta.ok(addCall.command.includes("name="), "Command should include username");
      ta.ok(addCall.command.includes("profile=hs_prof"), "Command should include profile");
      ta.ok(addCall.command.includes("limit-uptime=3600"), "Command should include limit-uptime from 60 RAUs");
    });

    await test("provisioning is idempotent for the same session", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      wireAdapterWithTransport(adapter);

      const context = buildEnforcementContext();
      const first = await adapter.provisionAccess(context);
      ta.strictEqual(first.alreadyProvisioned, false);

      const second = await adapter.provisionAccess(context);
      ta.strictEqual(second.alreadyProvisioned, true);
    });

    await test("no real network connection is attempted (mock transport only)", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      const transport = wireAdapterWithTransport(adapter);

      const context = buildEnforcementContext();
      await adapter.provisionAccess(context);

      ta.ok(Array.isArray(transport.calls), "Transport records calls in memory");
      ta.strictEqual(transport.name, "mock-routeros", "Transport should be a mock");
    });
  });

  // ===========================================================================
  // B. Revocation
  // ===========================================================================
  await describe("Inline MikroTik — Revocation", async () => {
    await test("revokeAccess sends remove user command through mock transport", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      const transport = wireAdapterWithTransport(adapter);

      const context = buildEnforcementContext();
      await adapter.provisionAccess(context);

      const callCountBefore = transport.callCount;
      const result = await adapter.revokeAccess(context);
      ta.strictEqual(result.result, "success");
      ta.strictEqual(result.sessionId, SESSION_ID);
      ta.ok(transport.callCount > callCountBefore, "Transport should have been called for revocation");

      const snapshot = transport.safeSnapshot();
      const removeCall = snapshot.find((c) => c.command && c.command.includes("/ip hotspot user remove"));
      ta.ok(removeCall, "Should have a remove hotspot user command");
    });

    await test("revocation is idempotent for unprovisioned session", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      wireAdapterWithTransport(adapter);

      const context = buildEnforcementContext();
      const result = await adapter.revokeAccess(context);
      ta.strictEqual(result.result, "success");
      ta.strictEqual(result.alreadyRevoked, true, "Revoking unprovisioned session should be idempotent");
    });

    await test("revocation after provisioning succeeds", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      wireAdapterWithTransport(adapter);

      const context = buildEnforcementContext();
      await adapter.provisionAccess(context);
      const result = await adapter.revokeAccess(context);
      ta.strictEqual(result.result, "success");
      ta.strictEqual(result.alreadyRevoked, false);
    });
  });

  // ===========================================================================
  // C. Disconnect
  // ===========================================================================
  await describe("Inline MikroTik — Disconnect", async () => {
    await test("disconnect sends remove active user command through mock transport", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      const transport = wireAdapterWithTransport(adapter);

      const context = buildEnforcementContext();
      await adapter.provisionAccess(context);

      const callCountBefore = transport.callCount;
      const result = await adapter.disconnect(context);
      ta.strictEqual(result.result, "success");
      ta.strictEqual(result.sessionId, SESSION_ID);
      ta.ok(transport.callCount > callCountBefore, "Transport should have been called for disconnect");

      const snapshot = transport.safeSnapshot();
      const disconnectCall = snapshot.find((c) => c.command && c.command.includes("/ip hotspot active remove"));
      ta.ok(disconnectCall, "Should have a remove active hotspot user command");
    });

    await test("disconnect is idempotent", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      wireAdapterWithTransport(adapter);

      const context = buildEnforcementContext();
      await adapter.provisionAccess(context);

      const first = await adapter.disconnect(context);
      ta.strictEqual(first.alreadyDisconnected, false);

      const second = await adapter.disconnect(context);
      ta.strictEqual(second.alreadyDisconnected, true);
    });

    await test("disconnect on unprovisioned session is handled gracefully", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      wireAdapterWithTransport(adapter);

      const context = buildEnforcementContext();
      const result = await adapter.disconnect(context);
      ta.strictEqual(result.result, "success");
      ta.strictEqual(result.alreadyDisconnected, true);
    });
  });

  // ===========================================================================
  // D. Health
  // ===========================================================================
  await describe("Inline MikroTik — Health Check", async () => {
    await test("health check uses mock transport and reports reachable", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      const transport = wireAdapterWithTransport(adapter);

      const result = await adapter.checkHealth();
      ta.strictEqual(result.healthy, true);
      ta.strictEqual(result.adapterKey, "mikrotik");
      ta.strictEqual(result.mode, "mikrotik_routeros");
      ta.ok(result.checkedAt);
      ta.ok(transport.callCount > 0, "Transport should have been called for health check");

      const snapshot = transport.safeSnapshot();
      const healthCall = snapshot.find((c) => c.command && c.command.includes("/system identity print"));
      ta.ok(healthCall, "Should have a health check command");
    });

    await test("health result is infrastructure-only, not customer connectivity proof", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      wireAdapterWithTransport(adapter);

      const result = await adapter.checkHealth();
      ta.ok(typeof result.healthy === "boolean", "Health returns a boolean");
      ta.strictEqual(result.adapterKey, "mikrotik", "Health is for the MikroTik adapter");
    });

    await test("unreachable mock router is reported accurately", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      const { createFailingTransport } = require("../services/mikrotik/mockRouterOsTransport");
      const failingTransport = createFailingTransport("network", "router unreachable", true);
      const failingClient = createRouterOsClient({ transport: failingTransport });

      adapter._client = failingClient;
      adapter._secretResolver = realCreateStaticTestSecretResolver({
        [SECRET_REF]: "test-router-api-password",
      });

      const result = await adapter.checkHealth();
      ta.strictEqual(result.healthy, false, "Unreachable router should report healthy=false");
    });
  });

  // ===========================================================================
  // E. Usage
  // ===========================================================================
  await describe("Inline MikroTik — Usage (Placeholder)", async () => {
    await test("getUsage returns zeros from placeholder, not measured usage", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);

      const result = await adapter.getUsage(buildEnforcementContext());
      ta.strictEqual(result.usedMinutes, 0);
      ta.strictEqual(result.usedMegabytes, 0);
      ta.strictEqual(result.sessionId, SESSION_ID);
      ta.strictEqual(result.lastSampledAt, null, "No lastSampledAt before provisioning");
    });

    await test("getUsage returns provisionedAt for known session but still zero usage", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      wireAdapterWithTransport(adapter);

      const context = buildEnforcementContext();
      await adapter.provisionAccess(context);

      const result = await adapter.getUsage(context);
      ta.strictEqual(result.usedMinutes, 0, "Placeholder returns zero minutes");
      ta.strictEqual(result.usedMegabytes, 0, "Placeholder returns zero megabytes");
      ta.ok(result.lastSampledAt, "lastSampledAt is provisionedAt, not a real measurement");
    });

    await test("usage placeholder is clearly identified as not real accounting", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);

      const result = await adapter.getUsage(buildEnforcementContext());
      ta.strictEqual(result.usedMinutes, 0);
      ta.strictEqual(result.usedMegabytes, 0);
    });
  });

  // ===========================================================================
  // F. Negative security tests
  // ===========================================================================
  await describe("Inline MikroTik — Negative Security Tests", async () => {
    await test("rejects device belonging to a different visited owner", async () => {
      resetFirestore();

      const crossOwnerSession = {
        ...TEST_SESSION,
        visitedOwnerId: "owner-other",
      };

      try {
        await resolveAdapterForSession(crossOwnerSession);
        ta.fail("Should have thrown for cross-owner device");
      } catch (err) {
        ta.ok(
          err.code === "UNAUTHORIZED_SCOPE" || err.code === "ADAPTER_NOT_CONFIGURED",
          "Expected owner scope or adapter not configured error, got: " + err.code
        );
      }
    });

    await test("rejects device not configured as yabalink_managed", async () => {
      resetFirestore();
      const unmanagedDevice = { ...TEST_DEVICE, networkControl: "none" };
      firebaseMock.db.collection("devices").doc(DEVICE_ID).set(unmanagedDevice);

      try {
        await resolveAdapterForSession(TEST_SESSION);
        ta.fail("Should have thrown for non-yabalink_managed device");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_DISABLED", "Expected ADAPTER_DISABLED for not yabalink_managed");
      }
    });

    await test("rejects device with routerOsApiEnabled !== true", async () => {
      resetFirestore();
      const disabledDevice = { ...TEST_DEVICE, routerOsApiEnabled: false };
      firebaseMock.db.collection("devices").doc(DEVICE_ID).set(disabledDevice);

      try {
        await resolveAdapterForSession(TEST_SESSION);
        ta.fail("Should have thrown for routerOsApiEnabled=false");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_DISABLED", "Expected ADAPTER_DISABLED for disabled API");
      }
    });

    await test("rejects inactive hotspot", async () => {
      resetFirestore();
      const inactiveHotspot = { ...TEST_HOTSPOT, partnerStatus: "suspended" };
      firebaseMock.db.collection("roaming_hotspots").doc(HOTSPOT_ID).set(inactiveHotspot);

      try {
        await resolveAdapterForSession(TEST_SESSION);
        ta.fail("Should have thrown for inactive hotspot");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_DISABLED", "Expected ADAPTER_DISABLED for inactive hotspot");
      }
    });

    await test("rejects hotspot with wrong adapter key", async () => {
      resetFirestore();
      const wrongAdapterHotspot = { ...TEST_HOTSPOT, aaaAdapterKey: "radius" };
      firebaseMock.db.collection("roaming_hotspots").doc(HOTSPOT_ID).set(wrongAdapterHotspot);

      try {
        await resolveAdapterForSession(TEST_SESSION);
        ta.fail("Should have thrown for wrong adapter key");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_NOT_CONFIGURED", "Expected ADAPTER_NOT_CONFIGURED");
      }
    });

    await test("rejects inactive or ineligible entitlement", async () => {
      resetFirestore();
      const inactiveEntitlement = { ...TEST_ENTITLEMENT, status: "expired" };
      firebaseMock.db.collection("roaming_entitlements").doc(ENTITLEMENT_ID).set(inactiveEntitlement);

      try {
        await resolveAdapterForSession(TEST_SESSION);
        ta.fail("Should have thrown for inactive entitlement");
      } catch (err) {
        ta.strictEqual(err.code, "ENTITLEMENT_EXHAUSTED", "Expected ENTITLEMENT_EXHAUSTED");
      }
    });

    await test("rejects missing or invalid remaining RAUs", async () => {
      resetFirestore();
      const exhaustedEntitlement = { ...TEST_ENTITLEMENT, quota: { remainingMinutes: 0 } };
      firebaseMock.db.collection("roaming_entitlements").doc(ENTITLEMENT_ID).set(exhaustedEntitlement);

      try {
        await resolveAdapterForSession(TEST_SESSION);
        ta.fail("Should have thrown for zero remaining RAUs");
      } catch (err) {
        ta.strictEqual(err.code, "ENTITLEMENT_EXHAUSTED", "Expected ENTITLEMENT_EXHAUSTED for zero RAUs");
      }
    });

    await test("rejects missing device configuration (no routerOsHost)", async () => {
      resetFirestore();
      const deviceNoHost = { ...TEST_DEVICE, routerOsHost: null };
      firebaseMock.db.collection("devices").doc(DEVICE_ID).set(deviceNoHost);

      try {
        await resolveAdapterForSession(TEST_SESSION);
        ta.fail("Should have thrown for missing host");
      } catch (err) {
        ta.ok(
          err.code === "ADAPTER_FAILURE" || err.code === "ADAPTER_NOT_CONFIGURED",
          "Expected adapter failure for missing host, got: " + err.code
        );
      }
    });

    await test("rejects missing secret reference", async () => {
      resetFirestore();
      const deviceNoSecret = { ...TEST_DEVICE, routerOsApiSecretRef: null };
      firebaseMock.db.collection("devices").doc(DEVICE_ID).set(deviceNoSecret);

      try {
        await resolveAdapterForSession(TEST_SESSION);
        ta.fail("Should have thrown for missing secret ref");
      } catch (err) {
        ta.ok(
          err.code === "ADAPTER_FAILURE" || err.code === "ADAPTER_NOT_CONFIGURED",
          "Expected adapter failure for missing secret ref, got: " + err.code
        );
      }
    });

    await test("client-supplied device IDs cannot override server-resolved device context", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      ta.strictEqual(adapter._device.deviceId, DEVICE_ID,
        "Device ID must come from server-resolved hotspot, not client input");
      ta.strictEqual(adapter._device.ownerId, VISITED_OWNER_ID,
        "Device owner must come from server-resolved device, not client input");
    });

    await test("client-supplied owner IDs cannot override trusted ownership", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      ta.strictEqual(adapter._device.ownerId, VISITED_OWNER_ID,
        "Device owner must be from trusted Firestore document, not client-supplied");
    });

    await test("client-supplied remaining RAUs cannot override entitlement data", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      ta.strictEqual(adapter._remainingRaus, 60,
        "Remaining RAUs must come from entitlement, not client input");
    });

    await test("credentials and secret values never appear in adapter description", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      const desc = JSON.stringify(adapter.describe());
      ta.ok(!desc.includes("password"), "Description must not contain password");
      ta.ok(!desc.includes(SECRET_REF), "Description must not contain secret reference");
      ta.ok(!desc.includes("routerOsApiSecretRef"), "Description must not contain secret ref field");
      ta.ok(!desc.includes("apiPassword"), "Description must not contain apiPassword");
    });

    await test("provision result does not expose router password", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      wireAdapterWithTransport(adapter);

      const result = await adapter.provisionAccess(buildEnforcementContext());
      const resultStr = JSON.stringify(result);
      ta.ok(!resultStr.includes("password"), "Result must not contain password");
      ta.ok(!resultStr.includes(SECRET_REF), "Result must not contain secret reference");
    });

    await test("production environment fails closed — mock transport not used", async () => {
      resetFirestore();
      const originalNodeEnv = process.env.NODE_ENV;
      const originalMikrotikEnabled = process.env.ROAMING_MIKROTIK_API_ENABLED;
      const originalIdentityKey = process.env.MIKROTIK_IDENTITY_KEY;
      const originalEncryptionKey = process.env.MIKROTIK_SECRET_ENCRYPTION_KEY;
      process.env.NODE_ENV = "production";
      // Enable the global flag so we reach the production transport check,
      // not the global kill switch.
      process.env.ROAMING_MIKROTIK_API_ENABLED = "true";
      // Provide an identity key so resolveMikroTikContext passes before
      // reaching the production transport check.
      process.env.MIKROTIK_IDENTITY_KEY = "test-identity-key-for-production-test";
      // Do NOT set encryption key — production must fail closed.

      try {
        try {
          await resolveAdapterForSession(TEST_SESSION);
          ta.fail("Should have thrown in production without encryption key");
        } catch (err) {
          // Production now attempts live transport. Without the encryption key,
          // createProductionSecretResolver fails closed before any transport
          // is created. Mock transport must never be selected in production.
          ta.notStrictEqual(
            err.code,
            "ADAPTER_DISABLED",
            "Production must not return the old live_transport_not_implemented placeholder"
          );
          ta.ok(
            err.code === "MIKROTIK_CONFIG_INVALID" || err.code === "ADAPTER_FAILURE" || err.code === "ADAPTER_DISABLED",
            "Expected fail-closed error in production without encryption key, got: " + err.code
          );
        }
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalMikrotikEnabled === undefined) {
          delete process.env.ROAMING_MIKROTIK_API_ENABLED;
        } else {
          process.env.ROAMING_MIKROTIK_API_ENABLED = originalMikrotikEnabled;
        }
        if (originalIdentityKey === undefined) {
          delete process.env.MIKROTIK_IDENTITY_KEY;
        } else {
          process.env.MIKROTIK_IDENTITY_KEY = originalIdentityKey;
        }
        if (originalEncryptionKey === undefined) {
          delete process.env.MIKROTIK_SECRET_ENCRYPTION_KEY;
        } else {
          process.env.MIKROTIK_SECRET_ENCRYPTION_KEY = originalEncryptionKey;
        }
      }
    });
  });

  // ===========================================================================
  // G. End-to-end enforcement service
  // ===========================================================================
  await describe("Inline MikroTik — End-to-End Enforcement Service", async () => {
    await test("provisionSessionEnforcement completes full lifecycle with inline adapter", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      ta.ok(adapter, "Adapter should be returned");

      const context = buildEnforcementContext();
      const result = await adapter.provisionAccess(context);
      ta.strictEqual(result.result, "success");
      ta.strictEqual(result.sessionId, SESSION_ID);
      ta.ok(result.enforcementState, "Enforcement state should be returned");
      ta.strictEqual(result.enforcementState.networkControl, "yabalink_managed");
    });

    await test("revokeSessionEnforcement completes full lifecycle with inline adapter", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      const context = buildEnforcementContext();

      await adapter.provisionAccess(context);
      const result = await adapter.revokeAccess(context);
      ta.strictEqual(result.result, "success");
      ta.strictEqual(result.sessionId, SESSION_ID);
    });

    await test("disconnectSessionEnforcement completes full lifecycle with inline adapter", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      const context = buildEnforcementContext();

      await adapter.provisionAccess(context);
      const result = await adapter.disconnect(context);
      ta.strictEqual(result.result, "success");
      ta.strictEqual(result.sessionId, SESSION_ID);
    });

    await test("getSessionUsage returns usage through inline adapter", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      ta.ok(adapter, "Adapter should be returned");

      const result = await adapter.getUsage(buildEnforcementContext());
      ta.strictEqual(result.usedMinutes, 0, "Placeholder returns zero minutes");
      ta.strictEqual(result.usedMegabytes, 0, "Placeholder returns zero megabytes");
      ta.strictEqual(result.sessionId, SESSION_ID);
    });
  });

  // ===========================================================================
  // H. Cleanup diagnostics and construction failure
  // ===========================================================================

  function failingCloseTransport() {
    return {
      name: "mock-failing-close",
      calls: [],
      get callCount() {
        return this.calls.length;
      },
      reset() {
        this.calls = [];
      },
      safeSnapshot() {
        return [];
      },
      async execute(request) {
        this.calls.push(request);
        return { ok: true };
      },
      async close() {
        throw new Error("transport close failed");
      },
    };
  }

  async function withProductionEnv(fn) {
    const originals = {
      NODE_ENV: process.env.NODE_ENV,
      ROAMING_MIKROTIK_API_ENABLED: process.env.ROAMING_MIKROTIK_API_ENABLED,
      MIKROTIK_IDENTITY_KEY: process.env.MIKROTIK_IDENTITY_KEY,
      MIKROTIK_SECRET_ENCRYPTION_KEY: process.env.MIKROTIK_SECRET_ENCRYPTION_KEY,
      SUPERADMIN_JWT_SECRET: process.env.SUPERADMIN_JWT_SECRET,
    };
    process.env.NODE_ENV = "production";
    process.env.ROAMING_MIKROTIK_API_ENABLED = "true";
    process.env.MIKROTIK_IDENTITY_KEY = "test-identity-key-for-production";
    process.env.MIKROTIK_SECRET_ENCRYPTION_KEY = "test-encryption-key-for-production";
    process.env.SUPERADMIN_JWT_SECRET = "test-superadmin-jwt-secret-for-production-tests";
    try {
      await fn();
    } finally {
      process.env.NODE_ENV = originals.NODE_ENV;
      if (originals.ROAMING_MIKROTIK_API_ENABLED === undefined) delete process.env.ROAMING_MIKROTIK_API_ENABLED;
      else process.env.ROAMING_MIKROTIK_API_ENABLED = originals.ROAMING_MIKROTIK_API_ENABLED;
      if (originals.MIKROTIK_IDENTITY_KEY === undefined) delete process.env.MIKROTIK_IDENTITY_KEY;
      else process.env.MIKROTIK_IDENTITY_KEY = originals.MIKROTIK_IDENTITY_KEY;
      if (originals.MIKROTIK_SECRET_ENCRYPTION_KEY === undefined) delete process.env.MIKROTIK_SECRET_ENCRYPTION_KEY;
      else process.env.MIKROTIK_SECRET_ENCRYPTION_KEY = originals.MIKROTIK_SECRET_ENCRYPTION_KEY;
      if (originals.SUPERADMIN_JWT_SECRET === undefined) delete process.env.SUPERADMIN_JWT_SECRET;
      else process.env.SUPERADMIN_JWT_SECRET = originals.SUPERADMIN_JWT_SECRET;
    }
  }

  await describe("Inline MikroTik — Cleanup Diagnostics and Construction Failure", async () => {
    let capturedLogEvents = [];

    function capturingLogAuthEvent(event) {
      capturedLogEvents.push({ ...event });
    }

    function failingCloseTransport() {
      return {
        name: "mock-failing-close",
        calls: [],
        get callCount() {
          return this.calls.length;
        },
        reset() {
          this.calls = [];
        },
        safeSnapshot() {
          return [];
        },
        async execute(request) {
          this.calls.push(request);
          return { ok: true };
        },
        async close() {
          throw new Error("transport close failed");
        },
      };
    }

    async function withProductionEnv(fn) {
      const originals = {
        NODE_ENV: process.env.NODE_ENV,
        ROAMING_MIKROTIK_API_ENABLED: process.env.ROAMING_MIKROTIK_API_ENABLED,
        MIKROTIK_IDENTITY_KEY: process.env.MIKROTIK_IDENTITY_KEY,
        MIKROTIK_SECRET_ENCRYPTION_KEY: process.env.MIKROTIK_SECRET_ENCRYPTION_KEY,
        SUPERADMIN_JWT_SECRET: process.env.SUPERADMIN_JWT_SECRET,
      };
      process.env.NODE_ENV = "production";
      process.env.ROAMING_MIKROTIK_API_ENABLED = "true";
      process.env.MIKROTIK_IDENTITY_KEY = "test-identity-key-for-production";
      process.env.MIKROTIK_SECRET_ENCRYPTION_KEY = "test-encryption-key-for-production";
      process.env.SUPERADMIN_JWT_SECRET = "test-superadmin-jwt-secret-for-production-tests";
      try {
        await fn();
      } finally {
        process.env.NODE_ENV = originals.NODE_ENV;
        if (originals.ROAMING_MIKROTIK_API_ENABLED === undefined) delete process.env.ROAMING_MIKROTIK_API_ENABLED;
        else process.env.ROAMING_MIKROTIK_API_ENABLED = originals.ROAMING_MIKROTIK_API_ENABLED;
        if (originals.MIKROTIK_IDENTITY_KEY === undefined) delete process.env.MIKROTIK_IDENTITY_KEY;
        else process.env.MIKROTIK_IDENTITY_KEY = originals.MIKROTIK_IDENTITY_KEY;
        if (originals.MIKROTIK_SECRET_ENCRYPTION_KEY === undefined) delete process.env.MIKROTIK_SECRET_ENCRYPTION_KEY;
        else process.env.MIKROTIK_SECRET_ENCRYPTION_KEY = originals.MIKROTIK_SECRET_ENCRYPTION_KEY;
        if (originals.SUPERADMIN_JWT_SECRET === undefined) delete process.env.SUPERADMIN_JWT_SECRET;
        else process.env.SUPERADMIN_JWT_SECRET = originals.SUPERADMIN_JWT_SECRET;
      }
    }

    await test("cleanup diagnostic recorded after successful provisioning followed by cleanup failure", async () => {
      capturedLogEvents = [];
      resetFirestore({
        [require.resolve("../services/mikrotik/mockRouterOsTransport.js")]: {
          createMockRouterOsTransport: failingCloseTransport,
        },
        [require.resolve("../services/roamingAuthService.js")]: {
          logAuthEvent: capturingLogAuthEvent,
        },
      });

      const result = await enforcement.provisionSessionEnforcement(SESSION_ID, buildEnforcementContext());
      ta.strictEqual(result.success, true, "Provisioning should succeed even when cleanup fails");

      ta.ok(
        capturedLogEvents.some(
          (e) => e.eventType === "enforcement_transport_cleanup_failed" && e.operation === "provision"
        ),
        "Cleanup diagnostic should be recorded for provision operation"
      );
      ta.ok(
        capturedLogEvents.every(
          (e) => !e.password && !e.apiPassword && !e.secretReference && !e.routerOsApiSecretRef
        ),
        "Diagnostic must not contain credentials or secret references"
      );
    });

    await test("cleanup diagnostic recorded after successful revocation followed by cleanup failure", async () => {
      capturedLogEvents = [];
      resetFirestore({
        [require.resolve("../services/mikrotik/mockRouterOsTransport.js")]: {
          createMockRouterOsTransport: failingCloseTransport,
        },
        [require.resolve("../services/roamingAuthService.js")]: {
          logAuthEvent: capturingLogAuthEvent,
        },
      });

      await enforcement.provisionSessionEnforcement(SESSION_ID, buildEnforcementContext());

      const result = await enforcement.revokeSessionEnforcement(SESSION_ID, {}, "admin_revoked");
      ta.strictEqual(result.success, true, "Revocation should succeed even when cleanup fails");

      ta.ok(
        capturedLogEvents.some(
          (e) => e.eventType === "enforcement_transport_cleanup_failed" && e.operation === "revoke"
        ),
        "Cleanup diagnostic should be recorded for revoke operation"
      );
    });

    await test("cleanup diagnostic recorded after successful disconnect followed by cleanup failure", async () => {
      capturedLogEvents = [];
      resetFirestore({
        [require.resolve("../services/mikrotik/mockRouterOsTransport.js")]: {
          createMockRouterOsTransport: failingCloseTransport,
        },
        [require.resolve("../services/roamingAuthService.js")]: {
          logAuthEvent: capturingLogAuthEvent,
        },
      });

      await enforcement.provisionSessionEnforcement(SESSION_ID, buildEnforcementContext());

      const result = await enforcement.disconnectSessionEnforcement(SESSION_ID, {});
      ta.strictEqual(result.success, true, "Disconnect should succeed even when cleanup fails");

      ta.ok(
        capturedLogEvents.some(
          (e) => e.eventType === "enforcement_transport_cleanup_failed" && e.operation === "disconnect"
        ),
        "Cleanup diagnostic should be recorded for disconnect operation"
      );
    });

    await test("cleanup diagnostic recorded after usage followed by cleanup failure", async () => {
      capturedLogEvents = [];
      resetFirestore({
        [require.resolve("../services/mikrotik/mockRouterOsTransport.js")]: {
          createMockRouterOsTransport: failingCloseTransport,
        },
        [require.resolve("../services/roamingAuthService.js")]: {
          logAuthEvent: capturingLogAuthEvent,
        },
      });

      const result = await enforcement.getSessionUsage(SESSION_ID, { userId: USER_ID });
      ta.strictEqual(result.sessionId, SESSION_ID, "Usage should succeed even when cleanup fails");

      ta.ok(
        capturedLogEvents.some(
          (e) => e.eventType === "enforcement_transport_cleanup_failed" && e.operation === "usage"
        ),
        "Cleanup diagnostic should be recorded for usage operation"
      );
    });

    await test("original operation error preserved when cleanup also fails", async () => {
      capturedLogEvents = [];
      resetFirestore({
        [require.resolve("../services/mikrotik/mockRouterOsTransport.js")]: {
          createMockRouterOsTransport: failingCloseTransport,
        },
        [require.resolve("../services/mikrotik/routerOsClient.js")]: {
          createRouterOsClient: () => ({
            addHotspotUser: async () => { throw new Error("adapter execution failed"); },
            removeHotspotUser: async () => { throw new Error("adapter execution failed"); },
            removeActiveHotspotUser: async () => { throw new Error("adapter execution failed"); },
            health: async () => { throw new Error("adapter execution failed"); },
            close: async () => { throw new Error("transport close failed"); },
          }),
        },
        [require.resolve("../services/roamingAuthService.js")]: {
          logAuthEvent: capturingLogAuthEvent,
        },
      });

      try {
        await enforcement.provisionSessionEnforcement(SESSION_ID, buildEnforcementContext());
        ta.fail("Should have thrown");
      } catch (err) {
        ta.ok(err, "Original adapter error should propagate when cleanup also fails");
        ta.ok(err.message.includes("adapter execution failed"), "Original error message should be preserved");
      }
    });

    await test("transport closed when client construction fails (production)", async () => {
      let transportCloseCalled = false;
      const failingClientTransport = {
        name: "mock",
        calls: [],
        get callCount() { return this.calls.length; },
        reset() { this.calls = []; },
        safeSnapshot() { return []; },
        async execute(request) { this.calls.push(request); return { ok: true }; },
        async close() { transportCloseCalled = true; },
      };

      await withProductionEnv(async () => {
        resetFirestore({
          [require.resolve("../services/mikrotik/routerOsTransport.js")]: {
            createMikroTikTransport: () => failingClientTransport,
          },
          [require.resolve("../services/mikrotik/routerOsClient.js")]: {
            createRouterOsClient: () => {
              throw new Error("client construction failed");
            },
          },
          [require.resolve("../services/passwordService.js")]: {
            getProductionSecret: (envVar, devDefault, name) => {
              if (process.env.NODE_ENV === "production" && (!process.env[envVar] || process.env[envVar] === devDefault)) {
                throw new Error(`${name} must be configured in production`);
              }
              return process.env[envVar] || devDefault;
            },
          },
          [require.resolve("../services/roamingAuthService.js")]: {
            logAuthEvent: capturingLogAuthEvent,
          },
        });

        try {
          await resolveAdapterForSession(TEST_SESSION);
          ta.fail("Should have thrown due to client construction failure");
        } catch (err) {
          ta.ok(err, "Original construction error should propagate");
        }

        ta.ok(transportCloseCalled, "Transport close should have been called after client construction failure");
      });
    });

    await test("transport closed when adapter construction fails (production)", async () => {
      let transportCloseCalled = false;
      const failingAdapterTransport = {
        name: "mock",
        calls: [],
        get callCount() { return this.calls.length; },
        reset() { this.calls = []; },
        safeSnapshot() { return []; },
        async execute(request) { this.calls.push(request); return { ok: true }; },
        async close() { transportCloseCalled = true; },
      };

      await withProductionEnv(async () => {
        resetFirestore({
          [require.resolve("../services/mikrotik/routerOsTransport.js")]: {
            createMikroTikTransport: () => failingAdapterTransport,
          },
          [require.resolve("../services/mikrotik/mikrotikEnforcementAdapter.js")]: {
            MikrotikEnforcementAdapter: class {
              constructor() {
                throw new Error("adapter construction failed");
              }
            },
          },
          [require.resolve("../services/passwordService.js")]: {
            getProductionSecret: (envVar, devDefault, name) => {
              if (process.env.NODE_ENV === "production" && (!process.env[envVar] || process.env[envVar] === devDefault)) {
                throw new Error(`${name} must be configured in production`);
              }
              return process.env[envVar] || devDefault;
            },
          },
          [require.resolve("../services/roamingAuthService.js")]: {
            logAuthEvent: capturingLogAuthEvent,
          },
        });

        try {
          await resolveAdapterForSession(TEST_SESSION);
          ta.fail("Should have thrown due to adapter construction failure");
        } catch (err) {
          ta.ok(err, "Original construction error should propagate");
        }

        ta.ok(transportCloseCalled, "Transport close should have been called after adapter construction failure");
      });
    });

    await test("no cleanup attempt when transport construction itself fails (production)", async () => {
      let transportCloseCalled = false;

      await withProductionEnv(async () => {
        resetFirestore({
          [require.resolve("../services/mikrotik/routerOsTransport.js")]: {
            createMikroTikTransport: () => {
              throw new Error("transport construction failed");
            },
          },
          [require.resolve("../services/passwordService.js")]: {
            getProductionSecret: (envVar, devDefault, name) => {
              if (process.env.NODE_ENV === "production" && (!process.env[envVar] || process.env[envVar] === devDefault)) {
                throw new Error(`${name} must be configured in production`);
              }
              return process.env[envVar] || devDefault;
            },
          },
          [require.resolve("../services/roamingAuthService.js")]: {
            logAuthEvent: capturingLogAuthEvent,
          },
        });

        try {
          await resolveAdapterForSession(TEST_SESSION);
          ta.fail("Should have thrown due to transport construction failure");
        } catch (err) {
          ta.ok(err, "Original construction error should propagate");
        }

        ta.ok(!transportCloseCalled, "Transport close should NOT be called when transport construction itself fails");
      });
    });

    await test("diagnostic contains no credentials or secret values", async () => {
      capturedLogEvents = [];
      resetFirestore({
        [require.resolve("../services/mikrotik/mockRouterOsTransport.js")]: {
          createMockRouterOsTransport: failingCloseTransport,
        },
        [require.resolve("../services/roamingAuthService.js")]: {
          logAuthEvent: capturingLogAuthEvent,
        },
      });

      const result = await enforcement.provisionSessionEnforcement(SESSION_ID, buildEnforcementContext());
      ta.strictEqual(result.success, true);

      const cleanupEvents = capturedLogEvents.filter(
        (e) => e.eventType === "enforcement_transport_cleanup_failed"
      );
      ta.ok(cleanupEvents.length > 0, "Should have at least one cleanup event");

      for (const event of cleanupEvents) {
        const eventStr = JSON.stringify(event);
        ta.ok(!eventStr.includes("password"), "Diagnostic must not contain password");
        ta.ok(!eventStr.includes("apiPassword"), "Diagnostic must not contain apiPassword");
        ta.ok(!eventStr.includes(SECRET_REF), "Diagnostic must not contain secret reference");
        ta.ok(!eventStr.includes("routerOsApiSecretRef"), "Diagnostic must not contain secret ref field");
        ta.ok(!eventStr.includes("test-router-api-password"), "Diagnostic must not contain resolved password");
      }
    });

    await test("adapter password is released after each operation (no unnecessary retention)", async () => {
      resetFirestore();

      const { adapter } = await resolveAdapterForSession(TEST_SESSION);
      const transport = wireAdapterWithTransport(adapter);

      // Manually set _apiPassword since non-production path doesn't set it
      adapter._apiPassword = "test-resolved-password";

      // _apiPassword should be set before the first operation
      ta.strictEqual(adapter._apiPassword, "test-resolved-password", "Adapter _apiPassword should be set before first operation");

      // First operation uses _apiPassword
      const result1 = await adapter.provisionAccess(buildEnforcementContext());
      ta.strictEqual(result1.result, "success");

      // _apiPassword should be released after the first operation
      ta.strictEqual(adapter._apiPassword, null, "Adapter _apiPassword should be null after first operation");

      // Second operation on same adapter instance should still work
      // (hotspotUserService falls back to secretResolver when apiPassword is null)
      const result2 = await adapter.revokeAccess(buildEnforcementContext());
      ta.strictEqual(result2.result, "success");

      // _apiPassword should still be null after second operation
      ta.strictEqual(adapter._apiPassword, null, "Adapter _apiPassword should be null after second operation");
    });
  });

  const allPassed = report();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
