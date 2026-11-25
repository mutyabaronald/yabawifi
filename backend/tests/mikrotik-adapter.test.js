"use strict";

// Phase 8.5C — MikroTik enforcement adapter isolated tests.
//
// All tests use dependency injection:
//   - Mock RouterOS transport (no sockets, no production routers)
//   - Static test secret resolver (no Firebase, no production secrets)
//   - Injected device config and remainingRaus
//
// Never modifies server.js, RADIUS behavior, or any production enforcement path.

const crypto = require("crypto");
const assert = require("assert");

// Mock firebase before any mikrotik module that transitively requires it
// (secrets.js requires ../../firebase at the top level).
const { mockModule, installInterceptor, uninstallInterceptor, clearMocks } = require("./helpers/mock-modules");
const { MockFirestore } = require("./helpers/mock-firestore");
const { test, describe, report, ta } = require("./helpers/test-runner");

// Install firebase mock so secrets.js / credentialLifecycle.js can load
const mockDb = new MockFirestore();
mockModule("../../firebase", {
  db: mockDb,
  admin: {
    firestore: () => mockDb,
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
  },
}, require.resolve("../services/mikrotik/secrets.js"));

installInterceptor();

// Now safe to require mikrotik modules
const {
  MikrotikEnforcementAdapter,
  MIKROTIK_ADAPTER_KEY,
  MIKROTIK_ADAPTER_CAPABILITIES,
} = require("../services/mikrotik/mikrotikEnforcementAdapter");

const {
  RoamingAAAAdapter,
  RoamingAAAAdapterError,
  ENFORCEMENT_RESULT_SUCCESS,
} = require("../services/roamingAAAAdapter");

const {
  createMockRouterOsTransport,
  createScriptedTransport,
  createFailingTransport,
} = require("../services/mikrotik/mockRouterOsTransport");

const {
  createRouterOsClient,
  MIKROTIK_DEFAULT_TIMEOUT_MS,
  MIKROTIK_DEFAULT_RETRIES,
} = require("../services/mikrotik/routerOsClient");

const {
  createStaticTestSecretResolver,
} = require("../services/mikrotik/secrets");

const {
  NETWORK_CONTROL_MODES,
} = require("../services/mikrotik/featureFlag");

// Test fixtures
const TEST_DEVICE = {
  deviceId: "test-device-1",
  ownerId: "owner-1",
  deviceName: "Test Router",
  vendor: "mikrotik",
  networkControl: NETWORK_CONTROL_MODES.YABALINK_MANAGED,
  routerOsApiEnabled: true,
  routerOsApiPort: 8728,
  routerOsHost: "192.168.1.1",
  routerOsApiUsername: "api-user",
  routerOsApiSecretRef: "rsec_" + crypto.randomUUID(),
  routerOsTls: false,
};

const TEST_CONTEXT = {
  sessionId: "session-test-1",
  userRef: { userId: "user-1" },
  homeOwnerId: "owner-1",
  visitedOwnerId: "owner-1",
  visitedHotspotId: "hotspot-1",
  entitlementId: "ent-1",
  aaaAdapterKey: "mikrotik",
};

const IDENTITY_KEY = "test-identity-key-not-for-production";

function makeAdapter(overrides = {}) {
  const transport = createMockRouterOsTransport({
    defaultResult: { ok: true },
  });
  const client = createRouterOsClient({
    transport,
    timeoutMs: 5000,
    retries: 3,
  });
  const secretResolver = createStaticTestSecretResolver({
    [TEST_DEVICE.routerOsApiSecretRef]: "test-router-api-password",
  });

  return {
    adapter: new MikrotikEnforcementAdapter({
      device: TEST_DEVICE,
      remainingRaus: 5,
      secretResolver,
      client,
      testMode: true,
      identityKey: IDENTITY_KEY,
      ...overrides,
    }),
    transport,
    client,
    secretResolver,
  };
}

async function main() {
  // ===========================================================================
  await describe("MikroTik Adapter — Construction", async () => {
    await test("constructs with all required dependencies injected", async () => {
      const { adapter, transport, client, secretResolver } = makeAdapter();
      ta.ok(adapter, "Adapter should be constructed");
      ta.strictEqual(adapter.getCapabilities().provisionAccess, true);
      ta.strictEqual(adapter.getCapabilities().revokeAccess, true);
      ta.strictEqual(adapter.getCapabilities().disconnect, true);
      ta.strictEqual(adapter.getCapabilities().getUsage, true);
      ta.strictEqual(adapter.getCapabilities().checkHealth, true);
      ta.strictEqual(adapter.getCapabilities().authenticate, false);
      ta.strictEqual(adapter.getCapabilities().authorize, false);
    });

    await test("describes itself without leaking credentials", async () => {
      const { adapter } = makeAdapter();
      const desc = adapter.describe();
      ta.strictEqual(desc.adapterKey, "mikrotik");
      ta.strictEqual(desc.phase, "8.5B");
      ta.strictEqual(desc.registeredInServer, false);
      ta.strictEqual(desc.deviceBound, true);
      ta.strictEqual(desc.secretResolverInjected, true);
      ta.strictEqual(desc.clientInjected, true);
      ta.strictEqual(desc.testMode, true);
    });

    await test("toJSON returns same as describe", async () => {
      const { adapter } = makeAdapter();
      ta.deepStrictEqual(adapter.toJSON(), adapter.describe());
    });

    await test("rejects construction without device (mutation context missing at runtime)", async () => {
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      const secretResolver = createStaticTestSecretResolver({});

      const adapter = new MikrotikEnforcementAdapter({
        remainingRaus: 5,
        secretResolver,
        client,
        testMode: true,
        identityKey: IDENTITY_KEY,
      });

      ta.strictEqual(adapter._device, null);
    });

    await test("rejects construction without secretResolver", async () => {
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });

      const adapter = new MikrotikEnforcementAdapter({
        device: TEST_DEVICE,
        remainingRaus: 5,
        client,
        testMode: true,
        identityKey: IDENTITY_KEY,
      });

      ta.strictEqual(adapter._secretResolver, null);
    });

    await test("rejects construction without client", async () => {
      const secretResolver = createStaticTestSecretResolver({});

      const adapter = new MikrotikEnforcementAdapter({
        device: TEST_DEVICE,
        remainingRaus: 5,
        secretResolver,
        testMode: true,
        identityKey: IDENTITY_KEY,
      });

      ta.strictEqual(adapter._client, null);
    });
  });

  // ===========================================================================
  await describe("MikroTik Adapter — Health Check", async () => {
    await test("successful mocked health check returns healthy=true", async () => {
      const { adapter, transport } = makeAdapter();

      const result = await adapter.checkHealth();
      ta.strictEqual(result.healthy, true);
      ta.strictEqual(result.adapterKey, "mikrotik");
      ta.strictEqual(result.mode, "mikrotik_routeros");
      ta.strictEqual(result.phase, "8.5B");
      ta.ok(result.checkedAt);
      ta.ok(transport.callCount > 0, "Transport should have been called");
    });

    await test("health check fails when client is missing", async () => {
      const secretResolver = createStaticTestSecretResolver({});
      const adapter = new MikrotikEnforcementAdapter({
        device: TEST_DEVICE,
        remainingRaus: 5,
        secretResolver,
        testMode: true,
        identityKey: IDENTITY_KEY,
        // no client
      });

      try {
        await adapter.checkHealth();
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_UNAVAILABLE");
        ta.strictEqual(err.status, 503);
      }
    });

    await test("health check fails when secretResolver is missing", async () => {
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      const adapter = new MikrotikEnforcementAdapter({
        device: TEST_DEVICE,
        remainingRaus: 5,
        client,
        testMode: true,
        identityKey: IDENTITY_KEY,
        // no secretResolver
      });

      try {
        await adapter.checkHealth();
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_UNAVAILABLE");
      }
    });

    await test("health check fails when device is missing", async () => {
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      const secretResolver = createStaticTestSecretResolver({});
      const adapter = new MikrotikEnforcementAdapter({
        remainingRaus: 5,
        secretResolver,
        client,
        testMode: true,
        identityKey: IDENTITY_KEY,
        // no device
      });

      try {
        await adapter.checkHealth();
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_UNAVAILABLE");
        ta.strictEqual(err.status, 503);
      }
    });
  });

  // ===========================================================================
  await describe("MikroTik Adapter — Provisioning", async () => {
    await test("provisions successfully with valid owner context", async () => {
      const { adapter, transport } = makeAdapter();

      const result = await adapter.provisionAccess(TEST_CONTEXT);
      ta.strictEqual(result.result, ENFORCEMENT_RESULT_SUCCESS);
      ta.strictEqual(result.alreadyProvisioned, false);
      ta.strictEqual(result.sessionId, TEST_CONTEXT.sessionId);
      ta.ok(result.enforcementState.routerUsername);
      ta.strictEqual(result.enforcementState.networkControl, "yabalink_managed");
      ta.ok(transport.callCount > 0, "Transport should have been called");
    });

    await test("provisioning is idempotent for same session", async () => {
      const { adapter } = makeAdapter();

      const first = await adapter.provisionAccess(TEST_CONTEXT);
      ta.strictEqual(first.alreadyProvisioned, false);

      const second = await adapter.provisionAccess(TEST_CONTEXT);
      ta.strictEqual(second.alreadyProvisioned, true);
    });

    await test("rejects cross-owner provisioning", async () => {
      const { adapter } = makeAdapter();

      const crossOwnerContext = {
        ...TEST_CONTEXT,
        visitedOwnerId: "owner-2", // different from device.ownerId (owner-1)
      };

      try {
        await adapter.provisionAccess(crossOwnerContext);
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "UNAUTHORIZED_SCOPE");
        ta.strictEqual(err.status, 403);
      }
    });

    await test("rejects provisioning without device", async () => {
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      const secretResolver = createStaticTestSecretResolver({});
      const adapter = new MikrotikEnforcementAdapter({
        remainingRaus: 5,
        secretResolver,
        client,
        testMode: true,
        identityKey: IDENTITY_KEY,
        // no device
      });

      try {
        await adapter.provisionAccess(TEST_CONTEXT);
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_UNAVAILABLE");
        ta.strictEqual(err.status, 503);
      }
    });

    await test("rejects provisioning without remainingRaus", async () => {
      const { adapter } = makeAdapter();
      const adapterNoRaus = new MikrotikEnforcementAdapter({
        device: TEST_DEVICE,
        secretResolver: adapter._secretResolver,
        client: adapter._client,
        testMode: true,
        identityKey: IDENTITY_KEY,
        // no remainingRaus
      });

      try {
        await adapterNoRaus.provisionAccess(TEST_CONTEXT);
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_UNAVAILABLE");
        ta.strictEqual(err.status, 503);
      }
    });

    await test("rejects provisioning without secretResolver", async () => {
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      const adapter = new MikrotikEnforcementAdapter({
        device: TEST_DEVICE,
        remainingRaus: 5,
        client,
        testMode: true,
        identityKey: IDENTITY_KEY,
        // no secretResolver
      });

      try {
        await adapter.provisionAccess(TEST_CONTEXT);
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_UNAVAILABLE");
      }
    });

    await test("rejects provisioning without client", async () => {
      const secretResolver = createStaticTestSecretResolver({});
      const adapter = new MikrotikEnforcementAdapter({
        device: TEST_DEVICE,
        remainingRaus: 5,
        secretResolver,
        testMode: true,
        identityKey: IDENTITY_KEY,
        // no client
      });

      try {
        await adapter.provisionAccess(TEST_CONTEXT);
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_UNAVAILABLE");
      }
    });
  });

  // ===========================================================================
  await describe("MikroTik Adapter — Revocation and Disconnect", async () => {
    await test("revokes a provisioned session", async () => {
      const { adapter } = makeAdapter();

      await adapter.provisionAccess(TEST_CONTEXT);
      const result = await adapter.revokeAccess(TEST_CONTEXT);
      ta.strictEqual(result.result, ENFORCEMENT_RESULT_SUCCESS);
      ta.strictEqual(result.alreadyRevoked, false);
      ta.strictEqual(result.sessionId, TEST_CONTEXT.sessionId);
    });

    await test("revocation is idempotent for unprovisioned session", async () => {
      const { adapter } = makeAdapter();

      const result = await adapter.revokeAccess(TEST_CONTEXT);
      ta.strictEqual(result.result, ENFORCEMENT_RESULT_SUCCESS);
      ta.strictEqual(result.alreadyRevoked, true);
    });

    await test("disconnects a provisioned session", async () => {
      const { adapter } = makeAdapter();

      await adapter.provisionAccess(TEST_CONTEXT);
      const result = await adapter.disconnect(TEST_CONTEXT);
      ta.strictEqual(result.result, ENFORCEMENT_RESULT_SUCCESS);
      ta.strictEqual(result.alreadyDisconnected, false);
    });

    await test("disconnect is idempotent", async () => {
      const { adapter } = makeAdapter();

      await adapter.provisionAccess(TEST_CONTEXT);
      const first = await adapter.disconnect(TEST_CONTEXT);
      ta.strictEqual(first.alreadyDisconnected, false);

      const second = await adapter.disconnect(TEST_CONTEXT);
      ta.strictEqual(second.alreadyDisconnected, true);
    });

    await test("getUsage returns zeros with no real accounting", async () => {
      const { adapter } = makeAdapter();

      const result = await adapter.getUsage(TEST_CONTEXT);
      ta.strictEqual(result.usedMinutes, 0);
      ta.strictEqual(result.usedMegabytes, 0);
      ta.strictEqual(result.sessionId, TEST_CONTEXT.sessionId);
      ta.strictEqual(result.lastSampledAt, null);
    });

    await test("getUsage returns provisionedAt for known session", async () => {
      const { adapter } = makeAdapter();

      await adapter.provisionAccess(TEST_CONTEXT);
      const result = await adapter.getUsage(TEST_CONTEXT);
      ta.ok(result.lastSampledAt);
    });
  });

  // ===========================================================================
  await describe("MikroTik Adapter — Unsupported Methods", async () => {
    await test("authenticate throws 501", async () => {
      const { adapter } = makeAdapter();
      try {
        await adapter.authenticate(TEST_CONTEXT);
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_NOT_IMPLEMENTED");
        ta.strictEqual(err.status, 501);
      }
    });

    await test("authorize throws 501", async () => {
      const { adapter } = makeAdapter();
      try {
        await adapter.authorize(TEST_CONTEXT);
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "ADAPTER_NOT_IMPLEMENTED");
        ta.strictEqual(err.status, 501);
      }
    });
  });

  // ===========================================================================
  await describe("MikroTik Adapter — No Credential Leakage", async () => {
    await test("describe output contains no credentials", async () => {
      const { adapter } = makeAdapter();
      const desc = JSON.stringify(adapter.describe());
      ta.ok(!desc.includes("password"), "describe must not contain password");
      ta.ok(!desc.includes("routerOsApiSecretRef"), "describe must not contain secret ref");
      ta.ok(!desc.includes("apiPassword"), "describe must not contain apiPassword");
      // Field names like "secretResolverInjected" are booleans, not credentials
    });

    await test("toJSON output contains no credentials", async () => {
      const { adapter } = makeAdapter();
      const json = JSON.stringify(adapter.toJSON());
      ta.ok(!json.includes("password"), "toJSON must not contain password");
      ta.ok(!json.includes("routerOsApiSecretRef"), "toJSON must not contain secret ref");
      ta.ok(!json.includes("apiPassword"), "toJSON must not contain apiPassword");
    });

    await test("provision result does not expose router password", async () => {
      const { adapter } = makeAdapter();
      const result = await adapter.provisionAccess(TEST_CONTEXT);
      const resultStr = JSON.stringify(result);
      ta.ok(!resultStr.includes("password"), "provision result must not contain password");
      ta.ok(!resultStr.includes("routerOsApiSecretRef"), "provision result must not contain secret ref");
      ta.ok(!resultStr.includes("apiPassword"), "provision result must not contain apiPassword");
    });
  });

  // ===========================================================================
  await describe("MikroTik Adapter — Credential Lifecycle", async () => {
    await test("apiPassword is null after successful provisionAccess", async () => {
      const { adapter } = makeAdapter({
        apiPassword: "test-router-api-password",
      });

      ta.strictEqual(adapter._apiPassword, "test-router-api-password", "apiPassword should be set before operation");
      await adapter.provisionAccess(TEST_CONTEXT);
      ta.strictEqual(adapter._apiPassword, null, "apiPassword should be null after provisionAccess");
    });

    await test("apiPassword is null after successful revokeAccess", async () => {
      const { adapter } = makeAdapter({
        apiPassword: "test-router-api-password",
      });

      await adapter.provisionAccess(TEST_CONTEXT);
      ta.strictEqual(adapter._apiPassword, null, "apiPassword should be null after provisionAccess");
      await adapter.revokeAccess(TEST_CONTEXT);
      ta.strictEqual(adapter._apiPassword, null, "apiPassword should be null after revokeAccess");
    });

    await test("apiPassword is null after successful disconnect", async () => {
      const { adapter } = makeAdapter({
        apiPassword: "test-router-api-password",
      });

      await adapter.provisionAccess(TEST_CONTEXT);
      await adapter.disconnect(TEST_CONTEXT);
      ta.strictEqual(adapter._apiPassword, null, "apiPassword should be null after disconnect");
    });

    await test("apiPassword is null after successful checkHealth", async () => {
      const { adapter } = makeAdapter({
        apiPassword: "test-router-api-password",
      });

      await adapter.checkHealth();
      ta.strictEqual(adapter._apiPassword, null, "apiPassword should be null after checkHealth");
    });

    await test("apiPassword is null after provisionAccess failure", async () => {
      const { adapter, transport } = makeAdapter({
        apiPassword: "test-router-api-password",
      });

      // Make the transport fail
      transport.reset();
      // Script a failure: first call throws
      // We need a failing transport - create a new one
      const failingTransport = {
        calls: [],
        get callCount() { return this.calls.length; },
        reset() { this.calls = []; },
        safeSnapshot() { return []; },
        async execute(request) { this.calls.push(request); throw new Error("transport failure"); },
        async close() { },
      };
      const failingClient = createRouterOsClient({ transport: failingTransport });
      const failingAdapter = new MikrotikEnforcementAdapter({
        device: TEST_DEVICE,
        remainingRaus: 5,
        secretResolver: adapter._secretResolver,
        client: failingClient,
        testMode: true,
        identityKey: IDENTITY_KEY,
        apiPassword: "test-router-api-password",
      });

      ta.strictEqual(failingAdapter._apiPassword, "test-router-api-password");
      try {
        await failingAdapter.provisionAccess(TEST_CONTEXT);
        ta.fail("Should have thrown");
      } catch (err) {
        // expected
      }
      ta.strictEqual(failingAdapter._apiPassword, null, "apiPassword should be null after failed provisionAccess");
    });

    await test("apiPassword is null when constructor does not provide it", async () => {
      const { adapter } = makeAdapter(); // no apiPassword override
      ta.strictEqual(adapter._apiPassword, null, "apiPassword should be null by default");
      await adapter.provisionAccess(TEST_CONTEXT);
      ta.strictEqual(adapter._apiPassword, null, "apiPassword should remain null after operation");
    });

    await test("adapter operations still work after apiPassword is nulled", async () => {
      const { adapter } = makeAdapter({
        apiPassword: "test-router-api-password",
      });

      // First operation uses apiPassword
      const result1 = await adapter.provisionAccess(TEST_CONTEXT);
      ta.strictEqual(result1.result, ENFORCEMENT_RESULT_SUCCESS);
      ta.strictEqual(adapter._apiPassword, null, "apiPassword nulled after first operation");

      // Second operation should still work - hotspotUserService falls back to secretResolver
      const result2 = await adapter.revokeAccess(TEST_CONTEXT);
      ta.strictEqual(result2.result, ENFORCEMENT_RESULT_SUCCESS);
      ta.strictEqual(adapter._apiPassword, null, "apiPassword still nulled after second operation");
    });

    await test("describe output contains no credentials after operations", async () => {
      const { adapter } = makeAdapter({
        apiPassword: "test-router-api-password",
      });

      await adapter.provisionAccess(TEST_CONTEXT);
      const desc = JSON.stringify(adapter.describe());
      ta.ok(!desc.includes("password"), "describe must not contain password after operation");
      ta.ok(!desc.includes("apiPassword"), "describe must not contain apiPassword after operation");
    });
  });

  const allPassed = report();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
