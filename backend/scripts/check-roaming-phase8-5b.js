/**
 * Phase 8.5B - MikroTik enforcement adapter checks (mocked transport only).
 *
 * Run from the backend directory:  node scripts/check-roaming-phase8-5b.js
 *
 * Offline and deterministic. No router is contacted: every RouterOS interaction
 * runs through an INJECTED mock transport. No Firestore data is created or
 * modified, no secret is written to any file, and no customer traffic is
 * provisioned.
 *
 * Phase 8.5B does NOT register an AAA adapter in server.js and does NOT enable
 * ROAMING_MIKROTIK_API_ENABLED. The adapter is constructed directly with
 * dependency injection and exercised in-memory.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const MIKROTIK_DIR = path.resolve(ROOT, "backend/services/mikrotik");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`PASS: ${message}`);
  } else {
    failed += 1;
    console.error(
      `FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertThrows(fn, expectedCode, message) {
  try {
    fn();
    failed += 1;
    console.error(`FAIL: ${message} - no error thrown`);
  } catch (err) {
    const code = err && err.code;
    if (!expectedCode || code === expectedCode) {
      passed += 1;
      console.log(`PASS: ${message}`);
    } else {
      failed += 1;
      console.error(
        `FAIL: ${message} - expected code ${expectedCode}, got ${code} (${err && err.message})`,
      );
    }
  }
}

async function assertRejects(promise, expectedCode, message) {
  try {
    await promise;
    failed += 1;
    console.error(`FAIL: ${message} - promise resolved`);
  } catch (err) {
    const code = err && err.code;
    if (!expectedCode || code === expectedCode) {
      passed += 1;
      console.log(`PASS: ${message}`);
    } else {
      failed += 1;
      console.error(
        `FAIL: ${message} - expected code ${expectedCode}, got ${code} (${err && err.message})`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Constants and shared fixtures
// ─────────────────────────────────────────────────────────────
const TEST_SECRET = "dGhpcy1pcy1hLXRlc3Qtc2VjcmV0LW5vdC1hLXJlYWwta2V5";
const TEST_SECRET_REFERENCE = "projects/test/secrets/mikrotik-synthetic-8-5b";
const TEST_IDENTITY_KEY = "synthetic-identity-key-8-5b";

const {
  MIKROTIK_ERROR_CODES,
  mikrotikError,
  MikrotikError,
  isMikrotikError,
  describeMikrotikError,
} = require("../services/mikrotik/errors");
const {
  NETWORK_CONTROL_MODES,
  ROUTER_OS_API_STATES,
  DEFAULT_ROUTER_OS_API_PORT,
  isMikrotikApiEnabled,
  assertDeviceControlPermitsMutation,
} = require("../services/mikrotik/featureFlag");
const {
  ROUTER_USERNAME_PREFIX,
  deriveRouterUsername,
  generateHotspotPassword,
} = require("../services/mikrotik/identity");
const {
  createStaticTestSecretResolver,
  createDisabledProductionSecretResolver,
} = require("../services/mikrotik/secrets");
const {
  createRouterOsClient,
  buildAddHotspotUserCommand,
  buildRemoveHotspotUserCommand,
  buildRemoveActiveHotspotUserCommand,
  MIKROTIK_DEFAULT_TIMEOUT_MS,
  MikrotikTransportFailure,
  TRANSPORT_FAILURE_KINDS,
} = require("../services/mikrotik/routerOsClient");
const {
  limitUptimeFromRemainingRaus,
  resolveSharedUsers,
  buildHotspotUserConfig,
  provisionUser,
  removeUser,
  disconnectActiveUser,
  checkHealth,
  assertMutationAllowed,
  SECONDS_PER_RAU,
} = require("../services/mikrotik/hotspotUserService");
const {
  buildNetworkControlSnapshot,
  ENFORCEMENT_TRANSPORT,
} = require("../services/mikrotik/enforcementSnapshot");
const {
  createMockRouterOsTransport,
  createScriptedTransport,
  createFailingTransport,
} = require("../services/mikrotik/mockRouterOsTransport");
const {
  MikrotikEnforcementAdapter,
  MIKROTIK_ADAPTER_KEY,
  MIKROTIK_ADAPTER_CAPABILITIES,
  MIKROTIK_ENFORCEMENT_MODE,
} = require("../services/mikrotik/mikrotikEnforcementAdapter");
const {
  RoamingAAAAdapter,
  RoamingAAAAdapterError,
  ENFORCEMENT_RESULT_SUCCESS,
} = require("../services/roamingAAAAdapter");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeDevice(overrides = {}) {
  return {
    deviceId: "dev-1",
    ownerId: "own-1",
    networkControl: NETWORK_CONTROL_MODES.YABALINK_MANAGED,
    routerOsApiEnabled: true,
    routerOsApiPort: DEFAULT_ROUTER_OS_API_PORT,
    routerOsApiState: ROUTER_OS_API_STATES.UNCONFIGURED,
    routerOsHost: "router.example.invalid",
    routerOsApiUsername: "yaba_api",
    routerOsApiSecretRef: TEST_SECRET_REFERENCE,
    ...overrides,
  };
}

function makeClient(transport) {
  return createRouterOsClient({ transport, sleepMs: async () => {} });
}

function makeResolver(entries = {}) {
  const table = Object.assign({ [TEST_SECRET_REFERENCE]: TEST_SECRET }, entries);
  return createStaticTestSecretResolver(table);
}

function makeContext(overrides = {}) {
  return {
    sessionId: "sess-1",
    homeOwnerId: "own-1",
    visitedOwnerId: "own-2",
    visitedHotspotId: "hs-1",
    entitlementId: "ent-1",
    aaaAdapterKey: MIKROTIK_ADAPTER_KEY,
    ...overrides,
  };
}

function makeAdapter(opts = {}) {
  const transport = opts.transport || createMockRouterOsTransport({ script: [] });
  const client = opts.client || makeClient(transport);
  return {
    adapter: new MikrotikEnforcementAdapter({
      device: opts.device || makeDevice(opts.deviceOverride),
      remainingRaus: opts.remainingRaus !== undefined ? opts.remainingRaus : 10,
      secretResolver: opts.secretResolver || makeResolver(),
      client,
      transport,
      testMode: opts.testMode === true,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      routerUsername: opts.routerUsername || null,
      routerPassword: opts.routerPassword || null,
      identityKey: opts.identityKey || TEST_IDENTITY_KEY,
    }),
    transport,
    client,
  };
}

// ─────────────────────────────────────────────────────────────
// 1. Module loading
// ─────────────────────────────────────────────────────────────
function runModuleLoading() {
  assert(typeof createMockRouterOsTransport === "function", "mock transport loader is present");
  assert(typeof createScriptedTransport === "function", "scripted transport factory is present");
  assert(typeof createFailingTransport === "function", "failing transport factory is present");
  assert(typeof MikrotikEnforcementAdapter === "function", "adapter constructor is present");

  const expectedFiles = [
    "errors.js",
    "featureFlag.js",
    "identity.js",
    "secrets.js",
    "routerOsClient.js",
    "hotspotUserService.js",
    "enforcementSnapshot.js",
    "index.js",
    "mockRouterOsTransport.js",
    "mikrotikEnforcementAdapter.js",
  ];
  for (const rel of expectedFiles) {
    assert(
      fs.existsSync(path.join(MIKROTIK_DIR, rel)),
      `mikrotik/${rel} exists`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 2. Adapter capabilities
// ─────────────────────────────────────────────────────────────
function runAdapterCapabilities() {
  const { adapter } = makeAdapter({ testMode: true });
  const caps = adapter.getCapabilities();

  assert(adapter.aaaAdapterKey === MIKROTIK_ADAPTER_KEY, "adapter key is 'mikrotik'");
  assert(
    adapter.enforcementMode === MIKROTIK_ENFORCEMENT_MODE,
    "adapter reports mikrotik_routeros enforcement mode",
  );
  assert(typeof adapter.getCapabilities === "function", "adapter implements getCapabilities()");
  assert(caps.provisionAccess === true, "adapter advertises provisionAccess capability");
  assert(caps.revokeAccess === true, "adapter advertises revokeAccess capability");
  assert(caps.disconnect === true, "adapter advertises disconnect capability");
  assert(caps.getUsage === true, "adapter advertises getUsage capability");
  assert(caps.checkHealth === true, "adapter advertises checkHealth capability");
  assert(caps.authenticate === false, "adapter does NOT advertise authenticate capability");
  assert(caps.authorize === false, "adapter does NOT advertise authorize (authn/authz handled elsewhere)");

  assert(adapter instanceof RoamingAAAAdapter, "adapter extends RoamingAAAAdapter");

  // describe() must not leak secrets
  const desc = adapter.describe();
  const descJson = JSON.stringify(desc);
  assert(!descJson.includes(TEST_SECRET), "adapter.describe() carries no secret material");
  assertEqual(desc.adapterKey, "mikrotik", "describe reports mikrotik adapter key");
  assertEqual(desc.registeredInServer, false, "adapter reports itself as not registered in server");
}

// ─────────────────────────────────────────────────────────────
// 3. Mock transport
// ─────────────────────────────────────────────────────────────
async function runMockTransport() {
  // deterministic success
  const t1 = createMockRouterOsTransport({ script: [] });
  const r1 = await t1.execute({ command: "/system identity print", attempt: 1 });
  assertEqual(r1.ok, true, "mock transport: empty script returns default success");

  // command recording
  assertEqual(t1.callCount, 1, "mock transport: callCount reflects executed commands");
  assertEqual(t1.calls[0].command, "/system identity print", "mock transport: records command text");

  // command ordering
  const t2 = createMockRouterOsTransport({ script: [] });
  await t2.execute({ command: "cmd-1", attempt: 1 });
  await t2.execute({ command: "cmd-2", attempt: 2 });
  await t2.execute({ command: "cmd-3", attempt: 3 });
  assertEqual(
    [t2.calls[0].command, t2.calls[1].command, t2.calls[2].command],
    ["cmd-1", "cmd-2", "cmd-3"],
    "mock transport: commands recorded in call order",
  );

  // scripted success
  const t3 = createScriptedTransport([{ ok: true, data: "ok" }]);
  const r3 = await t3.execute({ command: "add", attempt: 1 });
  assertEqual(r3.ok, true, "scripted transport: scripted success result returned");
  assertEqual(r3.data, "ok", "scripted transport: scripted data preserved");

  // scripted failure
  const t4 = createFailingTransport(TRANSPORT_FAILURE_KINDS.TIMEOUT, "timed out");
  await assertRejects(
    t4.execute({ command: "add", attempt: 1 }),
    undefined,
    "failing transport: throws a failure",
  );
  assertEqual(t4.callCount, 1, "failing transport: records the failing attempt");

  // no network module required
  const files = fs.readdirSync(MIKROTIK_DIR).filter((f) => f.endsWith(".js"));
  const netModules = ["net", "tls", "dgram", "http", "https"];
  const mockSource = fs.readFileSync(path.join(MIKROTIK_DIR, "mockRouterOsTransport.js"), "utf8");
  for (const mod of netModules) {
    assert(!new RegExp(`require\\(["']${mod}["']\\)`).test(mockSource), `mock transport does not require("${mod}")`);
  }

  // safeSnapshot redacts
  const t5 = createMockRouterOsTransport({ script: [] });
  await t5.execute({
    command: "/ip hotspot user add name=u password=SECRET password=SECRET",
    credentials: { username: "yaba_api", password: "API-PW" },
    attempt: 1,
  });
  const safe = t5.safeSnapshot()[0];
  assert(!JSON.stringify(safe).includes("API-PW"), "safeSnapshot redacts credential password");
  assert(!JSON.stringify(safe).includes("SECRET"), "safeSnapshot redacts command-embedded password");
  assert(safe.command.includes("name=u"), "safeSnapshot preserves non-secret command args");
}

// ─────────────────────────────────────────────────────────────
// 4. Provision
// ─────────────────────────────────────────────────────────────
async function runProvision() {
  const { adapter, transport } = makeAdapter({ testMode: true, retries: 0 });
  const ctx = makeContext();

  const expectedUsername = deriveRouterUsername(
    { sessionId: ctx.sessionId, homeOwnerId: ctx.homeOwnerId },
    { identityKey: TEST_IDENTITY_KEY },
  );

  const result = await adapter.provisionAccess(ctx);

  assertEqual(result.result, ENFORCEMENT_RESULT_SUCCESS, "provision returns success result");
  assertEqual(result.sessionId, ctx.sessionId, "provision echoes the session id");
  assertEqual(result.enforcementState.routerUsername, expectedUsername, "provision uses the pseudonymous router username");
  assertEqual(
    result.enforcementState.limitUptimeSeconds,
    SECONDS_PER_RAU * 10,
    "provision applies RAU-derived limit-uptime (remainingRaus=10)",
  );
  assert(!JSON.stringify(result).includes(TEST_SECRET), "provision result carries no secret value");

  // exactly one command issued, in order
  assertEqual(transport.callCount, 1, "provision issues exactly one RouterOS command");
  const cmd = transport.calls[0].command;
  assert(cmd.startsWith("/ip hotspot user add"), "provision command is a hotspot user add");
  assert(cmd.includes(`name=${expectedUsername}`), "provision command targets the derived username");
  assert(cmd.includes("limit-uptime=600"), "provision command carries the RAU-derived uptime limit");
  assert(!cmd.includes("shared-users"), "provision command omits shared-users when undetermined");

  // The resolved API secret is passed via credentials channel, not the command.
  assertEqual(
    transport.calls[0].credentials.password,
    TEST_SECRET,
    "provision passes the resolved API secret via credentials (internal only)",
  );
  assertEqual(
    transport.calls[0].credentials.username,
    "yaba_api",
    "provision uses the device's configured API username",
  );

  // owner isolation: adapter should NOT provision if context.homeOwnerId !== device.ownerId
  await assertRejects(
    adapter.provisionAccess(
      makeContext({ homeOwnerId: "own-999" }),
    ),
    undefined,
    "provision refuses a context whose homeOwnerId does not match the device owner",
  );
}

// ─────────────────────────────────────────────────────────────
// 5. Remove
// ─────────────────────────────────────────────────────────────
async function runRemove() {
  const { adapter, transport } = makeAdapter({ testMode: true, retries: 0 });
  const ctx = makeContext();

  // Provision first so remove has a target
  await adapter.provisionAccess(ctx);
  transport.reset();

  const result = await adapter.revokeAccess(ctx);
  assertEqual(result.result, ENFORCEMENT_RESULT_SUCCESS, "remove returns success");
  assertEqual(result.sessionId, ctx.sessionId, "remove echoes the session id");
  assertEqual(result.alreadyRevoked, false, "remove reports not-already-revoked");

  assertEqual(transport.callCount, 1, "remove issues exactly one RouterOS command");
  const cmd = transport.calls[0].command;
  const expectedUsername = deriveRouterUsername(
    { sessionId: ctx.sessionId, homeOwnerId: ctx.homeOwnerId },
    { identityKey: TEST_IDENTITY_KEY },
  );
  assertEqual(cmd, `/ip hotspot user remove name=${expectedUsername}`, "remove command targets the derived username");
  assert(!JSON.stringify(result).includes(TEST_SECRET), "remove result carries no secret value");

  // idempotent remove: session already cleared, second call reports already revved
  transport.reset();
  const result2 = await adapter.revokeAccess(ctx);
  assertEqual(result2.result, ENFORCEMENT_RESULT_SUCCESS, "remove is idempotent (second call succeeds)");
  assertEqual(result2.alreadyRevoked, true, "remove second call: alreadyRevoked (session cleared)");
}

// ─────────────────────────────────────────────────────────────
// 6. Disconnect
// ─────────────────────────────────────────────────────────────
async function runDisconnect() {
  const { adapter, transport } = makeAdapter({ testMode: true, retries: 0 });
  const ctx = makeContext();

  await adapter.provisionAccess(ctx);
  transport.reset();

  const result = await adapter.disconnect(ctx);
  assertEqual(result.result, ENFORCEMENT_RESULT_SUCCESS, "disconnect returns success");
  assertEqual(result.sessionId, ctx.sessionId, "disconnect echoes the session id");

  assertEqual(transport.callCount, 1, "disconnect issues exactly one RouterOS command");
  const expectedUsername = deriveRouterUsername(
    { sessionId: ctx.sessionId, homeOwnerId: ctx.homeOwnerId },
    { identityKey: TEST_IDENTITY_KEY },
  );
  assert(
    transport.calls[0].command === `/ip hotspot active remove name=${expectedUsername}`,
    "disconnect targets the active session (distinct from user removal)",
  );
  assert(!JSON.stringify(result).includes(TEST_SECRET), "disconnect result carries no secret value");

  // idempotent disconnect
  transport.reset();
  const result2 = await adapter.disconnect(ctx);
  assertEqual(result2.result, ENFORCEMENT_RESULT_SUCCESS, "disconnect is idempotent");
}

// ─────────────────────────────────────────────────────────────
// 7. Health
// ─────────────────────────────────────────────────────────────
async function runHealth() {
  const { adapter, transport } = makeAdapter({ testMode: true });
  const health = await adapter.checkHealth();
  assertEqual(health.healthy, true, "mocked health succeeds");
  assertEqual(health.adapterKey, MIKROTIK_ADAPTER_KEY, "health reports mikrotik adapter key");
  assertEqual(health.capabilities.provisionAccess, true, "health reports capabilities");

  assertEqual(transport.callCount, 1, "health issues exactly one read-only command");
  assertEqual(
    transport.calls[0].command,
    "/system identity print",
    "health issues only the read-only identity command",
  );

  // simulated unhealthy
  const failTransport = createFailingTransport(TRANSPORT_FAILURE_KINDS.NETWORK, "unreachable");
  const failClient = makeClient(failTransport);
  const { adapter: unhealthyAdapter, transport: t2 } = makeAdapter({
    testMode: true,
    client: failClient,
    transport: failTransport,
  });
  const down = await unhealthyAdapter.checkHealth();
  assertEqual(down.healthy, false, "an unreachable router reports unhealthy");
}

// ─────────────────────────────────────────────────────────────
// 8. Global kill switch OFF
// ─────────────────────────────────────────────────────────────
async function runGlobalKillSwitch() {
  const realFlag = process.env.ROAMING_MIKROTIK_API_ENABLED;
  process.env.ROAMING_MIKROTIK_API_ENABLED = "false";
  try {
    assert(!isMikrotikApiEnabled(), "global flag is confirmed false");

    const { adapter, transport } = makeAdapter({ testMode: false });
    const ctx = makeContext();

    await assertRejects(
      adapter.provisionAccess(ctx),
      "ADAPTER_DISABLED",
      "global flag off: provision fails with ADAPTER_DISABLED",
    );
    assertEqual(transport.callCount, 0, "global flag off: no transport command executes");
    assert(!isMikrotikApiEnabled(), "global flag remains false (no mutation)");
  } finally {
    if (realFlag === undefined) delete process.env.ROAMING_MIKROTIK_API_ENABLED;
    else process.env.ROAMING_MIKROTIK_API_ENABLED = realFlag;
  }
}

// ─────────────────────────────────────────────────────────────
// 9. Device kill switch
// ─────────────────────────────────────────────────────────────
async function runDeviceKillSwitch() {
  const device = makeDevice({ routerOsApiEnabled: false });
  const { adapter, transport } = makeAdapter({ device, testMode: true, retries: 0 });
  const ctx = makeContext();

  await assertRejects(
    adapter.provisionAccess(ctx),
    "ADAPTER_DISABLED",
    "device flag off: provision fails with ADAPTER_DISABLED",
  );
  assertEqual(transport.callCount, 0, "device flag off: no transport command executes");
}

// ─────────────────────────────────────────────────────────────
// 10. Invalid control state
// ─────────────────────────────────────────────────────────────
async function runInvalidControlState() {
  // partner-managed
  const partnerDevice = makeDevice({ networkControl: "partner_managed" });
  const { adapter: a1, transport: t1 } = makeAdapter({ device: partnerDevice, testMode: true, retries: 0 });
  await assertRejects(
    a1.provisionAccess(makeContext()),
    "ADAPTER_DISABLED",
    "partner-managed: provision refused",
  );
  assertEqual(t1.callCount, 0, "partner-managed: no transport command executes");

  // none
  const noneDevice = makeDevice({ networkControl: "none" });
  const { adapter: a2, transport: t2 } = makeAdapter({ device: noneDevice, testMode: true, retries: 0 });
  await assertRejects(
    a2.provisionAccess(makeContext()),
    "ADAPTER_DISABLED",
    "networkControl none: provision refused",
  );
  assertEqual(t2.callCount, 0, "networkControl none: no transport command executes");

  // unknown value rejected at normalization
  assertThrows(
    () => assertDeviceControlPermitsMutation(makeDevice({ networkControl: "bogus" })),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "an invalid networkControl value is rejected",
  );
}

// ─────────────────────────────────────────────────────────────
// 11. Missing secret/reference
// ─────────────────────────────────────────────────────────────
async function runMissingSecret() {
  const deviceNoRef = makeDevice({ routerOsApiSecretRef: null });
  const { adapter, transport } = makeAdapter({ device: deviceNoRef, testMode: true, retries: 0 });
  const ctx = makeContext();

  await assertRejects(
    adapter.provisionAccess(ctx),
    "ADAPTER_FAILURE",
    "missing secret reference: provision fails",
  );
  assertEqual(transport.callCount, 0, "missing secret reference: no RouterOS command issued");

  // literal secret material on device rejected by assertNoLiteralSecretFields
  const { assertNoLiteralSecretFields } = require("../services/mikrotik/secrets");
  assertThrows(
    () => assertNoLiteralSecretFields({ routerOsApiPassword: TEST_SECRET }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "literal secret material on a device record is rejected",
  );
}

// ─────────────────────────────────────────────────────────────
// 12. Timeout
// ─────────────────────────────────────────────────────────────
async function runTimeout() {
  const failTransport = createFailingTransport(TRANSPORT_FAILURE_KINDS.TIMEOUT, "timed out");
  const failClient = makeClient(failTransport);
  const { adapter, transport } = makeAdapter({ testMode: true, client: failClient, transport: failTransport, retries: 0 });
  const ctx = makeContext();

  let caught = null;
  try {
    await adapter.provisionAccess(ctx);
  } catch (err) {
    caught = err;
  }
  assert(caught !== null, "timeout: provision rejects (no false success)");
  assert(caught instanceof RoamingAAAAdapterError, "timeout: error is a RoamingAAAAdapterError");
  assertEqual(caught.status, 502, "timeout: error status is 502");
  assertEqual(caught.code, "ADAPTER_FAILURE", "timeout: error code is ADAPTER_FAILURE");
  assertEqual(transport.callCount, 1, "timeout: transport attempted exactly once (retries=0)");
}

// ─────────────────────────────────────────────────────────────
// 13. RouterOS error
// ─────────────────────────────────────────────────────────────
async function runRouterOsError() {
  const failTransport = createFailingTransport(TRANSPORT_FAILURE_KINDS.AUTH, "bad credentials", false);
  const failClient = makeClient(failTransport);
  const { adapter, transport } = makeAdapter({ testMode: true, client: failClient, transport: failTransport, retries: 0 });
  const ctx = makeContext();

  await assertRejects(
    adapter.provisionAccess(ctx),
    "ADAPTER_FAILURE",
    "router auth error: provision fails with ADAPTER_FAILURE",
  );
  assertEqual(transport.callCount, 1, "router auth error: transport attempted exactly once (no retry for auth)");
}

// ─────────────────────────────────────────────────────────────
// 14. Repeated operations (idempotency)
// ─────────────────────────────────────────────────────────────
async function runRepeatedOperations() {
  const { adapter, transport } = makeAdapter({ testMode: true, retries: 0 });
  const ctx = makeContext();

  // repeated provision: second call is a no-op (internal idempotency), 0 transport calls
  transport.reset();
  const p1 = await adapter.provisionAccess(ctx);
  assertEqual(p1.result, ENFORCEMENT_RESULT_SUCCESS, "first provision succeeds");
  assertEqual(p1.alreadyProvisioned, false, "first provision reports not-already-provisioned");
  assertEqual(transport.callCount, 1, "first provision issues one command");

  const p2 = await adapter.provisionAccess(ctx);
  assertEqual(p2.result, ENFORCEMENT_RESULT_SUCCESS, "second provision succeeds");
  assertEqual(p2.alreadyProvisioned, true, "second provision reports alreadyProvisioned (internal idempotency, no router call)");
  assertEqual(transport.callCount, 1, "second provision issues zero additional transport calls");

  // repeated disconnect
  transport.reset();
  await adapter.disconnect(ctx);
  assertEqual(transport.callCount, 1, "first disconnect issues one command");
  const d2 = await adapter.disconnect(ctx);
  assertEqual(d2.result, ENFORCEMENT_RESULT_SUCCESS, "second disconnect succeeds (idempotent)");
  assertEqual(transport.callCount, 1, "second disconnect issues zero additional transport calls");
}

// ─────────────────────────────────────────────────────────────
// 15. RAU semantics
// ─────────────────────────────────────────────────────────────
function runRauSemantics() {
  assertEqual(SECONDS_PER_RAU, 60, "1 RAU = 60 seconds");
  assertEqual(limitUptimeFromRemainingRaus(1), 60, "1 remaining RAU -> 60s limit-uptime");
  assertEqual(limitUptimeFromRemainingRaus(10), 600, "10 remaining RAUs -> 600s limit-uptime");

  for (const input of [0, -5, undefined, 1.5]) {
    assertThrows(
      () => limitUptimeFromRemainingRaus(input),
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      `limitUptimeFromRemainingRaus(${input}) is refused`,
    );
  }

  // The adapter forwards remainingRaus to the existing translator.
  const config = buildHotspotUserConfig({
    routerUsername: deriveRouterUsername({ sessionId: "s", homeOwnerId: "o" }, { identityKey: TEST_IDENTITY_KEY }),
    routerPassword: generateHotspotPassword(),
    remainingRaus: 7,
    session: { sessionId: "s", homeOwnerId: "o" },
    entitlement: { entitlementId: "e" },
    device: makeDevice(),
  });
  assertEqual(config.limitUptimeSeconds, 420, "7 remaining RAUs -> 420s limit-uptime via config builder");
  assertEqual(
    config.limitUptimeAuthority,
    "yabalink_entitlement_only",
    "the config records that the RAU engine is the sole billing authority",
  );
}

// ─────────────────────────────────────────────────────────────
// 16. shared-users
// ─────────────────────────────────────────────────────────────
function runSharedUsers() {
  const { sharedUsers, sharedUsersUndetermined } = resolveSharedUsers({});
  assertEqual(sharedUsers, null, "undetermined shared-users yields no value");
  assert(sharedUsersUndetermined === true, "undetermined shared-users is explicitly flagged");

  // The provision command omits shared-users when undetermined
  const cmd = buildAddHotspotUserCommand({
    user: "yb1_abc",
    userPassword: "pw",
    profile: "hs_prof",
    limitUptimeSeconds: 600,
  });
  assert(!cmd.includes("shared-users"), "provision command omits shared-users when undetermined");
}

// ─────────────────────────────────────────────────────────────
// 17. Secret safety
// ─────────────────────────────────────────────────────────────
async function runSecretSafety() {
  const { adapter, transport } = makeAdapter({ testMode: true, retries: 0 });
  const result = await adapter.provisionAccess(makeContext());

  const resultJson = JSON.stringify(result);
  assert(!resultJson.includes(TEST_SECRET), "provision result has no secret value");

  // Inspect safe snapshot of recorded commands — no secret material at all
  const safe = transport.safeSnapshot();
  const safeJson = JSON.stringify(safe);
  assert(!safeJson.includes(TEST_SECRET), "recorded command snapshots have no API secret value");
  assert(safeJson.includes("[REDACTED]"), "safeSnapshot redacts credentials");

  // The raw command must contain the password field (RouterOS requires it inline),
  // but tests must never print it. Verify presence without exposure.
  const rawCmd = transport.calls[0].command;
  assert(rawCmd.includes("password="), "raw command carries an inline password token (RouterOS requirement)");
  assert(!rawCmd.includes(TEST_SECRET) && !resultJson.includes(TEST_SECRET), "no secret value in raw command or result");
}

// ─────────────────────────────────────────────────────────────
// 18. Failure isolation
// ─────────────────────────────────────────────────────────────
async function runFailureIsolation() {
  // Build a transport that fails, then confirm no payment/wallet/package/voucher/
  // RAU/settlement/loyalty modules are touched. We prove isolation by asserting
  // the adapter boundary does not require or call any of those modules.
  const adapterSource = fs.readFileSync(
    path.join(MIKROTIK_DIR, "mikrotikEnforcementAdapter.js"),
    "utf8",
  );
  const forbiddenTerms = [
    "wallet",
    "settlement",
    "commission",
    "ownerRevenue",
    "payment",
    "invoice",
    "price",
    "loyalty",
    "voucher",
    "package",
    "consumeRau",
    "billing",
  ];
  for (const term of forbiddenTerms) {
    assert(
      !new RegExp(`\\b${term}\\b`, "i").test(adapterSource),
      `adapter source contains no billing/payment/loyalty logic (${term})`,
    );
  }

  // A mocked failure must not produce a success result
  const failTransport = createFailingTransport(TRANSPORT_FAILURE_KINDS.TIMEOUT, "timed out");
  const failClient = makeClient(failTransport);
  const { adapter, transport } = makeAdapter({ testMode: true, client: failClient, transport: failTransport, retries: 0 });

  await assertRejects(
    adapter.provisionAccess(makeContext()),
    "ADAPTER_FAILURE",
    "failure does not claim success",
  );
  assertEqual(transport.callCount, 1, "failure isolation: exactly one attempt, not retried into success");

  // Failure must not leave the session in a provisioned state
  assert(!adapter._provisionedSessions.has("sess-1"), "failed provision does not register an internal provisioned state");
}

// ─────────────────────────────────────────────────────────────
// Architecture / security boundaries
// ─────────────────────────────────────────────────────────────
function runArchitectureSecurity() {
  // No live transport
  const netModules = ["net", "tls", "dgram", "http", "https"];
  for (const file of fs.readdirSync(MIKROTIK_DIR).filter((f) => f.endsWith(".js"))) {
    const source = fs.readFileSync(path.join(MIKROTIK_DIR, file), "utf8");
    for (const mod of netModules) {
      assert(
        !new RegExp(`require\\(["']${mod}["']\\)`).test(source),
        `mikrotik/${file} does not require("${mod}")`,
      );
    }
    assert(
      !/console\.(log|warn|error|info|debug)\s*\(/.test(source),
      `mikrotik/${file} contains no console output`,
    );
  }

  // No new npm dependencies
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "backend/package.json"), "utf8"));
  const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  const forbiddenPackages = ["node-routeros", "mikrotik", "routeros", "dgram", "radius", "freeradius"];
  for (const forbidden of forbiddenPackages) {
    assert(!(forbidden in deps), `no '${forbidden}' package dependency added`);
  }

  // Adapter not registered in server.js
  const serverSource = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  assert(!/mikrotikEnforcementAdapter/i.test(serverSource), "server.js does not register the MikroTik adapter");
  assert(!/ROAMING_MIKROTIK_API_ENABLED\s*=\s*true/.test(serverSource), "server.js does not activate ROAMING_MIKROTIK_API_ENABLED");
  assert(!/require.*mikrotikEnforcementAdapter/i.test(serverSource), "server.js does not load the MikroTik adapter");

  // Forbidden files untouched
  const boundaryFiles = [
    "backend/services/roamingEnforcementService.js",
    "backend/services/roamingAAAAdapter.js",
    "backend/services/roamingAAAAdapterRegistry.js",
    "backend/services/roamingRauConsumptionService.js",
    "backend/services/roamingEntitlementBridgeService.js",
    "backend/routes/users.js",
    "backend/services/ciscoService.js",
    "backend/ciscoExpiryCron.js",
  ];
  for (const rel of boundaryFiles) {
    const full = path.join(ROOT, rel);
    assert(fs.existsSync(full), `${rel} still exists`);
    const content = fs.readFileSync(full, "utf8");
    assert(!/mikrotikEnforcementAdapter/i.test(content), `${rel} untouched by Phase 8.5B`);
  }
}

// ─────────────────────────────────────────────────────────────
// Regression: earlier phases must still pass
// ─────────────────────────────────────────────────────────────
function runRegressions() {
  const regressions = [
    "check-roaming-phase8-5.js",
    "check-roaming-phase8-3.js",
    "check-roaming-phase8-2c.js",
    "check-roaming-phase7-6f4.js",
  ];
  for (const script of regressions) {
    try {
      const out = execFileSync(process.execPath, [path.join(ROOT, "backend/scripts", script)], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const m = out.match(/(\d+) passed, (\d+) failed/);
      const passedCount = m ? parseInt(m[1], 10) : 0;
      const failedCount = m ? parseInt(m[2], 10) : 0;
      assert(
        failedCount === 0 && passedCount > 0,
        `${script} passes (0 failed)`,
      );
    } catch (err) {
      const combined = `${(err.stdout || "")}${(err.stderr || "")}`;
      assert(false, `${script} FAILED: ${combined.split("\n").slice(-3).join(" | ")}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Phase 8.5B: MikroTik Enforcement Adapter (mocked transport) ===\n");

  runModuleLoading();
  runAdapterCapabilities();
  await runMockTransport();
  await runProvision();
  await runRemove();
  await runDisconnect();
  await runHealth();
  await runGlobalKillSwitch();
  await runDeviceKillSwitch();
  await runInvalidControlState();
  await runMissingSecret();
  await runTimeout();
  await runRouterOsError();
  await runRepeatedOperations();
  runRauSemantics();
  runSharedUsers();
  await runSecretSafety();
  await runFailureIsolation();
  runArchitectureSecurity();
  runRegressions();

  console.log("\n----------------------------------------");
  console.log(`Phase 8.5B checks: ${passed} passed, ${failed} failed`);
  console.log("----------------------------------------");

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Phase 8.5B checker crashed:", err);
  process.exitCode = 1;
});
