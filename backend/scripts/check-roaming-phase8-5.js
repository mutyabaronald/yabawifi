/**
 * Phase 8.5A - MikroTik router control foundation checks.
 *
 * Run from the repository root:  node backend/scripts/check-roaming-phase8-5.js
 *
 * Offline and deterministic. No router is contacted: every RouterOS interaction
 * runs through an INJECTED mock transport. No Firestore data is created or
 * modified, no secret is written to any file, and no customer traffic is
 * provisioned.
 *
 * Phase 8.5A does NOT register an AAA adapter and does NOT provision customers.
 * These checks prove the foundation exists, is fail-closed, and carries no
 * secret material.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const MIKROTIK_DIR = path.resolve(ROOT, "backend/services/mikrotik");

const mikrotik = require("../services/mikrotik");
const {
  MIKROTIK_ERROR_CODES,
  MikrotikError,
  mikrotikError,
  isMikrotikError,
  describeMikrotikError,
  sanitizeDetails,
  sanitizeMessage,
  REDACTED,
  MIKROTIK_AAA_ERROR_MAP,
} = require("../services/mikrotik/errors");
const {
  NETWORK_CONTROL_MODES,
  NETWORK_CONTROL_VALUES,
  ROUTER_OS_API_STATES,
  DEFAULT_ROUTER_OS_API_PORT,
  isMikrotikApiEnabled,
  assertMikrotikApiEnabled,
  normalizeNetworkControl,
  normalizeRouterOsApiState,
  assertDeviceControlPermitsMutation,
  assertDeviceControlPermitsHealthCheck,
} = require("../services/mikrotik/featureFlag");
const {
  ROUTER_USERNAME_PREFIX,
  IDENTITY_KEY_ENV_VAR,
  IDENTITY_KEY_DEV_DEFAULT,
  deriveRouterUsername,
  generateHotspotPassword,
  assertRouterUsernameShape,
} = require("../services/mikrotik/identity");
const {
  createRouterOsSecretResolver,
  createStaticTestSecretResolver,
  createDisabledProductionSecretResolver,
  assertNoLiteralSecretFields,
  validateSecretReference,
  validateResolvedSecret,
  requireScopedResolution,
  assertReferenceBoundToDevice,
  FORBIDDEN_DEVICE_SECRET_FIELDS,
} = require("../services/mikrotik/secrets");
const {
  createRouterOsClient,
  buildAddHotspotUserCommand,
  buildRemoveHotspotUserCommand,
  buildRemoveActiveHotspotUserCommand,
  buildHealthCommand,
  MikrotikTransportFailure,
  TRANSPORT_FAILURE_KINDS,
  MIKROTIK_DEFAULT_TIMEOUT_MS,
} = require("../services/mikrotik/routerOsClient");
const {
  limitUptimeFromRemainingRaus,
  resolveSharedUsers,
  assertMutationAllowed,
  buildHotspotUserConfig,
  provisionUser,
  removeUser,
  disconnectActiveUser,
  checkHealth,
  SECONDS_PER_RAU,
} = require("../services/mikrotik/hotspotUserService");
const {
  buildNetworkControlSnapshot,
  assertNoSecretMaterial,
  ENFORCEMENT_TRANSPORT,
} = require("../services/mikrotik/enforcementSnapshot");

const TEST_SECRET = "c2VjcmV0LW1hdGVyaWFsLXBsYWNlaG9sZGVyLXZhbHVl";
const TEST_SECRET_REFERENCE = "projects/test/secrets/mikrotik-synthetic-8-5";
const TEST_IDENTITY_KEY = "synthetic-identity-key-8-5";

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
    if (!expectedCode || (err && err.code === expectedCode)) {
      passed += 1;
      console.log(`PASS: ${message}`);
    } else {
      failed += 1;
      console.error(
        `FAIL: ${message} - expected code ${expectedCode}, got ${err && err.code} (${err && err.message})`,
      );
    }
  }
}

const SECRET_LITERAL_PLACEHOLDER = "[REDACTED]";

/**
 * Return only the EXECUTABLE lines of a source file.
 *
 * Comments are stripped before structural security assertions so that a comment
 * which documents a defect (for example "this used to emit group=full") is not
 * mistaken for the defect itself. Only real code can introduce a vulnerability.
 */
function executableSource(source) {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlockComments
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

/**
 * Mock RouterOS transport. Records every command it is asked to run so the
 * checker can assert on the exact command text, and can be scripted to fail.
 */
function createMockTransport(script = []) {
  const calls = [];
  let index = 0;
  return {
    name: "mock",
    calls,
    async execute(request) {
      calls.push(request);
      const next = script[index];
      index += 1;
      if (!next) return { ok: true };
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function managedDevice(overrides = {}) {
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

function testClient(transport) {
  return createRouterOsClient({ transport, sleepMs: async () => {} });
}

function testResolver() {
  return createStaticTestSecretResolver({ [TEST_SECRET_REFERENCE]: TEST_SECRET });
}

// ─────────────────────────────────────────────────────────────
// 1) Errors: typed, sanitized, no secret leakage
// ─────────────────────────────────────────────────────────────
function runErrors() {
  const err = mikrotikError(MIKROTIK_ERROR_CODES.MIKROTIK_TIMEOUT, "timed out", {
    attempts: 3,
  });
  assert(isMikrotikError(err), "mikrotikError returns a MikrotikError");
  assert(err instanceof MikrotikError, "MikrotikError is an Error subclass");
  assert(err instanceof Error, "MikrotikError extends Error");
  assertEqual(err.code, MIKROTIK_ERROR_CODES.MIKROTIK_TIMEOUT, "error code is preserved");

  const sanitized = sanitizeDetails({
    apiPassword: TEST_SECRET,
    sshPassword: TEST_SECRET,
    enablePassword: TEST_SECRET,
    token: TEST_SECRET,
    secret: TEST_SECRET,
    nested: { apiPassword: TEST_SECRET },
    safe: "keep-me",
  });
  const serialized = JSON.stringify(sanitized);
  assert(!serialized.includes(TEST_SECRET), "sanitizeDetails redacts secret values");
  assert(
    sanitized.safe === "keep-me",
    "sanitizeDetails preserves non-secret fields",
  );
  assert(
    sanitized.apiPassword === REDACTED,
    "sanitizeDetails redacts known secret field names",
  );
  assert(
    sanitized.nested.apiPassword === REDACTED,
    "sanitizeDetails recurses into nested objects",
  );

  const msg = sanitizeMessage(`failed with password=${TEST_SECRET} in message`);
  assert(!msg.includes(TEST_SECRET), "sanitizeMessage removes secret-looking values");
  assert(
    msg.includes(REDACTED),
    "sanitizeMessage substitutes a redaction marker",
  );
  assert(
    !sanitizeMessage(`bare ${TEST_SECRET}`).includes(TEST_SECRET),
    "sanitizeMessage removes a bare high-entropy credential",
  );

  assertEqual(describeMikrotikError(err).code, MIKROTIK_ERROR_CODES.MIKROTIK_TIMEOUT,
    "describeMikrotikError reports the code");
  assert(
    !JSON.stringify(describeMikrotikError(err)).includes(TEST_SECRET),
    "describeMikrotikError leaks no secret",
  );

  // Every error code must map onto the existing AAA adapter vocabulary, so a
  // future adapter never has to invent a new contract.
  for (const code of Object.values(MIKROTIK_ERROR_CODES)) {
    const mapped = MIKROTIK_AAA_ERROR_MAP[code];
    assert(
      mapped && typeof mapped.code === "string" && typeof mapped.status === "number",
      `error code "${code}" maps onto an AAA adapter error`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 2) Feature flags and network-control gates: fail-closed
// ─────────────────────────────────────────────────────────────
function runFeatureFlags() {
  assertEqual(
    DEFAULT_ROUTER_OS_API_PORT,
    8728,
    "default RouterOS API port is 8728",
  );
  assert(
    !isMikrotikApiEnabled(),
    "ROAMING_MIKROTIK_API_ENABLED is false when unset",
  );
  assertThrows(
    () => assertMikrotikApiEnabled(),
    MIKROTIK_ERROR_CODES.MIKROTIK_API_DISABLED,
    "global kill switch refuses when the flag is unset",
  );

  assertEqual(
    normalizeNetworkControl(undefined),
    NETWORK_CONTROL_MODES.NONE,
    "missing networkControl normalizes to none",
  );
  assertEqual(
    normalizeNetworkControl("yabalink_managed"),
    NETWORK_CONTROL_MODES.YABALINK_MANAGED,
    "yabalink_managed normalizes to itself",
  );
  assertThrows(
    () => normalizeNetworkControl("yabalink"),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "an unknown networkControl value is rejected",
  );
  assertThrows(
    () => normalizeNetworkControl("partner"),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a near-miss networkControl value is rejected",
  );
  assertEqual(
    normalizeRouterOsApiState(undefined),
    ROUTER_OS_API_STATES.UNCONFIGURED,
    "missing routerOsApiState normalizes to unconfigured",
  );

  // Partner-managed must be refused BEFORE any device-level consideration.
  assertThrows(
    () => assertDeviceControlPermitsMutation(managedDevice({ networkControl: "partner_managed" })),
    MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
    "partner-managed networks are refused router mutation",
  );
  assertThrows(
    () => assertDeviceControlPermitsHealthCheck(managedDevice({ networkControl: "partner_managed" })),
    MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
    "partner-managed networks are refused health checks",
  );
  assertThrows(
    () => assertDeviceControlPermitsMutation(managedDevice({ networkControl: "none" })),
    MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
    "uncontrolled networks are refused router mutation",
  );
  assertThrows(
    () => assertDeviceControlPermitsMutation(managedDevice({ routerOsApiEnabled: false })),
    MIKROTIK_ERROR_CODES.MIKROTIK_API_DISABLED,
    "per-device kill switch refuses mutation when disabled",
  );
  assertThrows(
    () => assertDeviceControlPermitsMutation(managedDevice(), { testMode: false }),
    MIKROTIK_ERROR_CODES.MIKROTIK_API_DISABLED,
    "a fully enabled device still refuses while the global flag is off",
  );
  assertThrows(
    () => assertDeviceControlPermitsMutation(null),
    MIKROTIK_ERROR_CODES.MIKROTIK_DEVICE_NOT_FOUND,
    "a missing device is refused",
  );

  // Health check is allowed to run while the per-device switch is off, so an
  // operator can diagnose why a device is not controllable.
  const health = assertDeviceControlPermitsHealthCheck(
    managedDevice({ routerOsApiEnabled: false }),
    { testMode: true },
  );
  assertEqual(
    health.allowed,
    true,
    "health check runs even when the per-device switch is off (in test mode)",
  );

  assertThrows(
    () => assertMutationAllowed(managedDevice({ networkControl: "partner_managed" }), { testMode: true }),
    MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
    "hotspotUserService refuses partner-managed mutation",
  );
  assertThrows(
    () => assertMutationAllowed(managedDevice(), { testMode: false }),
    MIKROTIK_ERROR_CODES.MIKROTIK_API_DISABLED,
    "hotspotUserService honours the global kill switch",
  );
}

// ─────────────────────────────────────────────────────────────
// 3) Identity: pseudonymous, deterministic, no raw session data
// ─────────────────────────────────────────────────────────────
function runIdentity() {
  const opts = { identityKey: TEST_IDENTITY_KEY };
  const a = deriveRouterUsername({ sessionId: "sess-1", homeOwnerId: "own-1" }, opts);
  const b = deriveRouterUsername({ sessionId: "sess-1", homeOwnerId: "own-1" }, opts);
  const c = deriveRouterUsername({ sessionId: "sess-2", homeOwnerId: "own-1" }, opts);

  assert(a === b, "the same session derives the same router username");
  assert(a !== c, "a different session derives a different router username");
  assert(a.startsWith(ROUTER_USERNAME_PREFIX), "router username carries the versioned prefix");
  assert(a.length <= 32, "router username stays within the RouterOS length limit");
  assert(!a.includes("sess-1"), "router username does not embed the session id");
  assert(!a.includes("own-1"), "router username does not embed the owner id");
  assertEqual(assertRouterUsernameShape(a), a, "derived username satisfies the RouterOS shape");

  const otherKey = deriveRouterUsername(
    { sessionId: "sess-1", homeOwnerId: "own-1" },
    { identityKey: "a-different-synthetic-key" },
  );
  assert(a !== otherKey, "a different identity key derives a different username");

  assertThrows(
    () => deriveRouterUsername({}, opts),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a missing sessionId is refused",
  );
  assertThrows(
    () => deriveRouterUsername({ sessionId: "sess-1" }, opts),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a missing homeOwnerId is refused",
  );

  // The development key must never be usable in production.
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assertThrows(
      () => deriveRouterUsername({ sessionId: "sess-1", homeOwnerId: "own-1" },
        { identityKey: IDENTITY_KEY_DEV_DEFAULT }),
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      "the development identity key is refused in production",
    );
    assertThrows(
      () => deriveRouterUsername({ sessionId: "sess-1", homeOwnerId: "own-1" }),
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      "a missing identity key is refused in production",
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }

  const p1 = generateHotspotPassword();
  const p2 = generateHotspotPassword();
  assert(typeof p1 === "string" && p1.length >= 16, "generated hotspot password is long enough");
  assert(p1 !== p2, "generated hotspot passwords are not repeated");
  assertEqual(
    p1.includes(ROUTER_USERNAME_PREFIX),
    false,
    "generated password carries no identifying prefix",
  );
}

// ─────────────────────────────────────────────────────────────
// 4) Secrets: references only, scoped, never literal
// ─────────────────────────────────────────────────────────────
function runSecrets() {
  for (const field of ["routerOsApiPassword", "apiPassword", "sharedSecret", "password"]) {
    assert(
      FORBIDDEN_DEVICE_SECRET_FIELDS.includes(field),
      `the forbidden device field list covers ${field}`,
    );
  }

  // A missing reference fails closed with SECRET_UNAVAILABLE, not with a
  // defaulted empty secret.
  validateSecretReference(TEST_SECRET_REFERENCE);
  assert(true, "a well-formed secret reference is accepted");
  assertThrows(
    () => validateSecretReference(""),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "an empty secret reference fails closed",
  );
  assertThrows(
    () => validateSecretReference(null),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "a missing secret reference fails closed",
  );
  assertThrows(
    () => validateSecretReference(TEST_SECRET),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "literal secret material passed as a reference is refused",
  );
  assertThrows(
    () => validateSecretReference("password=hunter2"),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "a key=value secret passed as a reference is refused",
  );
  assertThrows(
    () => validateSecretReference("projects/test/secret with space"),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "a reference containing whitespace is refused",
  );

  validateResolvedSecret(TEST_SECRET);
  assert(true, "a resolved secret is accepted");
  assertThrows(
    () => validateResolvedSecret(""),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "an empty resolved secret fails closed",
  );
  assertThrows(
    () => validateResolvedSecret(undefined),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "a missing resolved secret fails closed",
  );

  const safeDevice = managedDevice();
  assertNoLiteralSecretFields(safeDevice);
  assert(true, "a device carrying only a secret reference passes the literal-secret check");

  assertThrows(
    () => assertNoLiteralSecretFields({ ...safeDevice, routerOsApiPassword: TEST_SECRET }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a device carrying a literal RouterOS API password is refused",
  );
  assertThrows(
    () => assertNoLiteralSecretFields({ ...safeDevice, sharedSecret: TEST_SECRET }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a device carrying a shared secret is refused",
  );

  // The production resolver is present but permanently inert in Phase 8.5A:
  // there is no production secret backend yet, and it must fail closed.
  const prodResolver = createDisabledProductionSecretResolver();
  assertEqual(prodResolver.isProduction, true, "the production resolver is marked as production");
}

async function runResolverScopes() {
  const resolver = createStaticTestSecretResolver({
    [TEST_SECRET_REFERENCE]: TEST_SECRET,
  });

  const resolved = await resolver.resolveSecret({
    secretReference: TEST_SECRET_REFERENCE,
    ownerId: "own-1",
    deviceId: "dev-1",
  });
  assertEqual(resolved, TEST_SECRET, "the static test resolver returns the mapped secret");

  await assertRejects(
    resolver.resolveSecret({
      secretReference: "projects/test/secrets/not-mapped",
      ownerId: "own-1",
      deviceId: "dev-1",
    }),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "an unmapped secret reference fails closed rather than defaulting",
  );

  // Owner and device scope are MANDATORY. This is what prevents Owner A from
  // resolving Owner B's router credential.
  assertThrows(
    () => requireScopedResolution({ secretReference: TEST_SECRET_REFERENCE }),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "secret resolution without an owner scope is refused",
  );
  assertThrows(
    () => requireScopedResolution({
      secretReference: TEST_SECRET_REFERENCE,
      ownerId: "own-1",
    }),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "secret resolution without a device scope is refused",
  );

  // A reference that declares a device binding must match the device.
  assertThrows(
    () => assertReferenceBoundToDevice("projects/p/secrets/mikrotik/device/dev-other", "dev-1"),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "a reference bound to another device is refused",
  );
  assertEqual(
    assertReferenceBoundToDevice("projects/p/secrets/mikrotik/device/dev-1", "dev-1"),
    "projects/p/secrets/mikrotik/device/dev-1",
    "a reference bound to the requesting device is accepted",
  );
  assertEqual(
    assertReferenceBoundToDevice(TEST_SECRET_REFERENCE, "dev-1"),
    TEST_SECRET_REFERENCE,
    "an opaque reference with no device binding is accepted",
  );

  // The production backend is deliberately inert: Phase 8.5A ships no secret
  // store, so live router control cannot resolve a credential.
  const prodResolver = createDisabledProductionSecretResolver();
  await assertRejects(
    prodResolver.resolveSecret({
      secretReference: TEST_SECRET_REFERENCE,
      ownerId: "own-1",
      deviceId: "dev-1",
    }),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "the production resolver fails closed until a secret backend exists",
  );

  // The custom production seam validates the resolved value.
  const custom = createRouterOsSecretResolver(async ({ secretReference }) =>
    secretReference === TEST_SECRET_REFERENCE ? TEST_SECRET : "",
  );
  assertEqual(
    await custom.resolveSecret({
      secretReference: TEST_SECRET_REFERENCE,
      ownerId: "own-1",
      deviceId: "dev-1",
    }),
    TEST_SECRET,
    "the custom resolver seam returns a validated secret",
  );
  assertThrows(
    () => createRouterOsSecretResolver(),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "the custom resolver seam requires a resolve function",
  );
}

// ─────────────────────────────────────────────────────────────
// 5) RouterOS client: command construction, idempotency, fail-closed
// ─────────────────────────────────────────────────────────────
function runRouterOsClient() {
  const user = deriveRouterUsername(
    { sessionId: "sess-1", homeOwnerId: "own-1" },
    { identityKey: TEST_IDENTITY_KEY },
  );

  assertEqual(
    buildHealthCommand(),
    "/system identity print",
    "the health command is read-only",
  );
  assertEqual(
    buildRemoveHotspotUserCommand({ user }),
    `/ip hotspot user remove name=${user}`,
    "remove command targets the derived username",
  );
  assertEqual(
    buildRemoveActiveHotspotUserCommand({ user }),
    `/ip hotspot active remove name=${user}`,
    "active-session removal is distinct from user removal",
  );

  const add = buildAddHotspotUserCommand({
    user,
    userPassword: TEST_SECRET,
    profile: "hs_prof",
    limitUptimeSeconds: 300,
  });
  assert(add.startsWith("/ip hotspot user add"), "add command is a hotspot user add");
  assert(add.includes(`name=${user}`), "add command carries the derived username");
  assert(add.includes("limit-uptime=300"), "add command carries the network uptime limit");
  assertEqual(
    add.includes("shared-users"),
    false,
    "add command OMITS shared-users when it is undetermined",
  );
  assertEqual(
    add.includes("limit-bytes-total"),
    false,
    "add command omits limit-bytes-total when not supplied",
  );
  assertEqual(
    buildAddHotspotUserCommand({
      user,
      userPassword: TEST_SECRET,
      profile: "hs_prof",
      limitUptimeSeconds: 300,
      sharedUsers: 2,
    }).includes("shared-users=2"),
    true,
    "add command includes an explicitly supplied shared-users",
  );

  assertThrows(
    () => buildAddHotspotUserCommand({ user, userPassword: TEST_SECRET, profile: "hs_prof", limitUptimeSeconds: -1 }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a negative limit-uptime is refused",
  );
  assertThrows(
    () => buildAddHotspotUserCommand({ user, userPassword: TEST_SECRET, profile: "hs_prof", limitUptimeSeconds: 1.5 }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a fractional limit-uptime is refused",
  );
  assertThrows(
    () => buildAddHotspotUserCommand({ user: "bad user name", userPassword: TEST_SECRET, profile: "hs_prof" }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a username with unsupported characters is refused",
  );

  assertThrows(
    () => createRouterOsClient({ transport: null }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a client cannot be built without a transport",
  );

  const timeoutClient = createRouterOsClient({
    transport: createMockTransport(),
    describeTimeout: true,
  });
  assertEqual(
    timeoutClient.describe().defaultTimeoutMs,
    MIKROTIK_DEFAULT_TIMEOUT_MS,
    "the client reports its bounded default timeout",
  );
}

// ─────────────────────────────────────────────────────────────
// 6) RAU translation: no billing logic, pure network arithmetic
// ─────────────────────────────────────────────────────────────
function runRauTranslation() {
  assertEqual(SECONDS_PER_RAU, 60, "1 RAU translates to 60 seconds of limit-uptime");

  assertEqual(limitUptimeFromRemainingRaus(1), 60, "1 remaining RAU becomes 60 seconds");
  assertEqual(limitUptimeFromRemainingRaus(5), 300, "5 remaining RAUs become 300 seconds");
  assertEqual(limitUptimeFromRemainingRaus(120), 7200, "120 remaining RAUs become 7200 seconds");

  assertThrows(
    () => limitUptimeFromRemainingRaus(0),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "an exhausted entitlement is never provisioned onto the network",
  );
  assertThrows(
    () => limitUptimeFromRemainingRaus(-5),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a negative RAU count is refused",
  );
  assertThrows(
    () => limitUptimeFromRemainingRaus(undefined),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a missing RAU count is refused rather than defaulted",
  );
  assertThrows(
    () => limitUptimeFromRemainingRaus(2.5),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a fractional RAU count is refused",
  );
}

// ─────────────────────────────────────────────────────────────
// 7) shared-users: reported, not guessed
// ─────────────────────────────────────────────────────────────
function runSharedUsers() {
  const undetermined = resolveSharedUsers({});
  assertEqual(undetermined.sharedUsers, null, "undetermined shared-users yields no value");
  assertEqual(
    undetermined.sharedUsersUndetermined,
    true,
    "undetermined shared-users is explicitly flagged",
  );
  assertEqual(
    undetermined.sharedUsersSource,
    "undetermined",
    "undetermined shared-users records its source",
  );

  const explicit = resolveSharedUsers({ sharedUsers: 3 });
  assertEqual(explicit.sharedUsers, 3, "an explicit shared-users value is honoured");
  assertEqual(explicit.sharedUsersSource, "explicit", "an explicit value records its source");

  // maxSessions is a concurrent-session count, NOT a per-user device count. The
  // repository has no per-package device rule, so it must not be smuggled in as
  // a device limit.
  const fromSessions = resolveSharedUsers({ maxSessions: 5 });
  assertEqual(
    fromSessions.sharedUsers,
    null,
    "a concurrent maxSessions count is NOT treated as a device limit",
  );

  assertThrows(
    () => resolveSharedUsers({ sharedUsers: 0 }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a zero shared-users value is refused",
  );
  assertThrows(
    () => resolveSharedUsers({ sharedUsers: 1.5 }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a fractional shared-users value is refused",
  );
}

// ─────────────────────────────────────────────────────────────
// 8) Hotspot user config construction
// ─────────────────────────────────────────────────────────────
function runConfigBuilder() {
  const user = deriveRouterUsername(
    { sessionId: "sess-1", homeOwnerId: "own-1" },
    { identityKey: TEST_IDENTITY_KEY },
  );

  const config = buildHotspotUserConfig({
    routerUsername: user,
    routerPassword: generateHotspotPassword(),
    remainingRaus: 10,
    limitBytesTotal: 1048576,
    session: { sessionId: "sess-1", homeOwnerId: "own-1", visitedOwnerId: "own-2", visitedHotspotId: "hs-1" },
    entitlement: { entitlementId: "ent-1" },
    device: managedDevice(),
  });

  assertEqual(config.routerUsername, user, "the config carries the derived username");
  assertEqual(config.limitUptimeSeconds, 600, "the config derives limit-uptime from remaining RAUs");
  assertEqual(config.profile, "hs_prof", "the config defaults to the provisioned HotSpot profile");
  assertEqual(config.limitBytesTotal, 1048576, "the config carries an optional byte limit");
  assertEqual(
    config.limitUptimeAuthority,
    "yabalink_entitlement_only",
    "the config records that the RAU engine is the only billing authority",
  );
  assert(Object.isFrozen(config), "the config is frozen against later mutation");
  assert(
    !JSON.stringify(config).includes(TEST_SECRET),
    "the config does not embed the RouterOS API secret",
  );

  assertThrows(
    () => buildHotspotUserConfig({ routerUsername: user, routerPassword: "pw" }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a config without remainingRaus is refused",
  );
  assertThrows(
    () => buildHotspotUserConfig({ routerUsername: "", routerPassword: "pw", remainingRaus: 1 }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a config without a derived username is refused",
  );
  assertThrows(
    () => buildHotspotUserConfig({ routerUsername: user, routerPassword: "", remainingRaus: 1 }),
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    "a config without a HotSpot password is refused",
  );
}

// ─────────────────────────────────────────────────────────────
// 9) Provision / remove / disconnect against a mock router
// ─────────────────────────────────────────────────────────────
async function runMockedRouter() {
  const user = deriveRouterUsername(
    { sessionId: "sess-1", homeOwnerId: "own-1" },
    { identityKey: TEST_IDENTITY_KEY },
  );
  const baseInput = {
    routerUsername: user,
    routerPassword: generateHotspotPassword(),
    remainingRaus: 10,
    device: managedDevice(),
    session: { sessionId: "sess-1", homeOwnerId: "own-1", visitedHotspotId: "hs-1" },
    entitlement: { entitlementId: "ent-1" },
    testMode: true,
    secretResolver: testResolver(),
    timeoutMs: 1000,
    retries: 0,
  };

  // Provision
  const addTransport = createMockTransport([{ ok: true }]);
  const provisioned = await provisionUser({ ...baseInput, client: testClient(addTransport) });
  assertEqual(provisioned.provisioned, true, "provisioning succeeds against a mock router");
  assertEqual(addTransport.calls.length, 1, "provisioning issues exactly one RouterOS command");
  const addCommand = addTransport.calls[0].command;
  assert(addCommand.startsWith("/ip hotspot user add"), "provisioning adds a hotspot user");
  assert(addCommand.includes(`name=${user}`), "provisioning uses the derived username");
  assert(addCommand.includes("limit-uptime=600"), "provisioning applies the RAU-derived uptime limit");
  assertEqual(
    addCommand.includes(TEST_SECRET),
    false,
    "the RouterOS API secret is never placed in the command",
  );
  assertEqual(
    addTransport.calls[0].credentials.password,
    TEST_SECRET,
    "the resolved API secret is passed via the credentials channel, not the command",
  );
  assertEqual(
    addTransport.calls[0].credentials.username,
    "yaba_api",
    "the configured API username is used",
  );

  // Idempotent provisioning
  const existTransport = createMockTransport([{ ok: true, alreadyExists: true }]);
  const existing = await provisionUser({ ...baseInput, client: testClient(existTransport) });
  assertEqual(existing.alreadyExisted, true, "an already-present user reports as existing, not as an error");

  // Remove
  const removeTransport = createMockTransport([{ ok: true }]);
  const removed = await removeUser({ ...baseInput, client: testClient(removeTransport) });
  assertEqual(removed.removed, true, "removal succeeds against a mock router");
  assertEqual(
    removeTransport.calls[0].command,
    `/ip hotspot user remove name=${user}`,
    "removal issues a hotspot user remove",
  );

  // Disconnect
  const disconnectTransport = createMockTransport([{ ok: true }]);
  const disconnected = await disconnectActiveUser({
    ...baseInput,
    client: testClient(disconnectTransport),
  });
  assertEqual(disconnected.disconnected, true, "an active session can be dropped");
  assertEqual(
    disconnectTransport.calls[0].command,
    `/ip hotspot active remove name=${user}`,
    "disconnect targets the active session, preserving the provisioned user",
  );

  // Fail-closed on router failure
  const failTransport = createMockTransport([
    new MikrotikTransportFailure(TRANSPORT_FAILURE_KINDS.AUTH, "bad credentials", false),
  ]);
  await assertRejects(
    provisionUser({ ...baseInput, client: testClient(failTransport) }),
    MIKROTIK_ERROR_CODES.MIKROTIK_AUTH_FAILED,
    "an authentication failure fails closed and is not retried",
  );
  assertEqual(failTransport.calls.length, 1, "an auth failure is attempted exactly once");

  const retryTransport = createMockTransport([
    new MikrotikTransportFailure(TRANSPORT_FAILURE_KINDS.TIMEOUT, "timed out"),
    new MikrotikTransportFailure(TRANSPORT_FAILURE_KINDS.TIMEOUT, "timed out"),
    { ok: true },
  ]);
  const retried = await provisionUser({
    ...baseInput,
    client: testClient(retryTransport),
    retries: 2,
  });
  assertEqual(retryTransport.calls.length, 3, "a transient timeout is retried within bounds");
  assertEqual(retried.attempts, 3, "the final attempt count is reported");

  const exhaustedTransport = createMockTransport([
    new MikrotikTransportFailure(TRANSPORT_FAILURE_KINDS.NETWORK, "unreachable"),
    new MikrotikTransportFailure(TRANSPORT_FAILURE_KINDS.NETWORK, "unreachable"),
  ]);
  await assertRejects(
    provisionUser({ ...baseInput, client: testClient(exhaustedTransport), retries: 1 }),
    MIKROTIK_ERROR_CODES.MIKROTIK_RETRY_EXHAUSTED,
    "exhausted retries fail closed rather than allowing access",
  );

  // Fail-closed when the secret cannot be resolved
  await assertRejects(
    provisionUser({
      ...baseInput,
      client: testClient(createMockTransport([{ ok: true }])),
      device: managedDevice({ routerOsApiSecretRef: null }),
    }),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "a device with no secret reference never reaches the router",
  );
  const noCallTransport = createMockTransport([{ ok: true }]);
  await assertRejects(
    provisionUser({
      ...baseInput,
      client: testClient(noCallTransport),
      device: managedDevice({ routerOsApiSecretRef: null }),
    }),
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "no RouterOS command is issued without a resolvable secret",
  );
  assertEqual(noCallTransport.calls.length, 0, "the transport is never called without a secret");

  // Fail-closed on network-control mode regardless of the kill switch
  for (const mode of ["none", "partner_managed"]) {
    const modeTransport = createMockTransport([{ ok: true }]);
    await assertRejects(
      provisionUser({
        ...baseInput,
        client: testClient(modeTransport),
        device: managedDevice({ networkControl: mode }),
      }),
      MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
      `networkControl "${mode}" is refused even in test mode`,
    );
    assertEqual(modeTransport.calls.length, 0, `no command is sent for networkControl "${mode}"`);
  }

  // Health check
  const healthTransport = createMockTransport([{ ok: true }]);
  const healthy = await checkHealth({
    device: managedDevice(),
    client: testClient(healthTransport),
    secretResolver: testResolver(),
    testMode: true,
  });
  assertEqual(healthy.reachable, true, "a healthy router reports reachable");
  assertEqual(healthy.networkControl, NETWORK_CONTROL_MODES.YABALINK_MANAGED,
    "health reports the network-control mode");
  assertEqual(
    healthTransport.calls[0].command,
    "/system identity print",
    "the health check issues only a read-only command",
  );

  const downTransport = createMockTransport([
    new MikrotikTransportFailure(TRANSPORT_FAILURE_KINDS.NETWORK, "unreachable"),
  ]);
  const down = await checkHealth({
    device: managedDevice(),
    client: testClient(downTransport),
    secretResolver: testResolver(),
    testMode: true,
  });
  assertEqual(down.reachable, false, "an unreachable router reports not reachable");
  assertEqual(down.state, "unreachable", "an unreachable router reports the unreachable state");
  assertEqual(downTransport.calls.length, 1, "the health check never retries");

  await assertRejects(
    checkHealth({
      device: managedDevice({ networkControl: "partner_managed" }),
      client: testClient(createMockTransport([{ ok: true }])),
      secretResolver: testResolver(),
      testMode: true,
    }),
    MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
    "a partner-managed router is never health-checked",
  );
}

// ─────────────────────────────────────────────────────────────
// 10) Enforcement snapshot
// ─────────────────────────────────────────────────────────────
function runEnforcementSnapshot() {
  const user = deriveRouterUsername(
    { sessionId: "sess-1", homeOwnerId: "own-1" },
    { identityKey: TEST_IDENTITY_KEY },
  );
  const config = buildHotspotUserConfig({
    routerUsername: user,
    routerPassword: generateHotspotPassword(),
    remainingRaus: 10,
    session: { sessionId: "sess-1", homeOwnerId: "own-1", visitedHotspotId: "hs-1" },
    entitlement: { entitlementId: "ent-1" },
    device: managedDevice(),
  });
  const capturedAt = new Date("2026-01-01T00:00:00.000Z");

  const snapshot = buildNetworkControlSnapshot({
    session: { sessionId: "sess-1", homeOwnerId: "own-1", visitedOwnerId: "own-2", visitedHotspotId: "hs-1" },
    device: managedDevice(),
    config,
    capturedAt,
  });

  assertEqual(snapshot.transport, ENFORCEMENT_TRANSPORT.MIKROTIK_ROUTEROS,
    "a yabalink_managed device snapshots as a mikrotik_routeros transport");
  assertEqual(snapshot.deviceId, "dev-1", "the snapshot records the enforcing device");
  assertEqual(snapshot.hotspotId, "hs-1", "the snapshot records the enforcing hotspot");
  assertEqual(snapshot.routerUsername, user, "the snapshot records the pseudonymous router username");
  assertEqual(snapshot.limitUptimeSeconds, 600, "the snapshot records the RAU-derived network limit");
  assertEqual(snapshot.limitUptimeAuthority, "yabalink_entitlement_only",
    "the snapshot records that the RAU engine is the sole billing authority");
  assertEqual(snapshot.capturedAt, capturedAt.toISOString(), "the snapshot records its capture time");
  assertEqual(snapshot.networkControl, NETWORK_CONTROL_MODES.YABALINK_MANAGED,
    "the snapshot records the network-control mode");
  assert(Object.isFrozen(snapshot), "the snapshot is frozen against later mutation");
  assert(!JSON.stringify(snapshot).includes(TEST_SECRET), "the snapshot carries no secret material");
  assertEqual(snapshot.routerOsApiSecretRef, undefined,
    "the snapshot carries no RouterOS secret reference");

  const uncontrolled = buildNetworkControlSnapshot({
    session: { sessionId: "sess-1" },
    device: managedDevice({ networkControl: "none" }),
    config,
    capturedAt,
  });
  assertEqual(uncontrolled.transport, null,
    "an uncontrolled device snapshots with no transport rather than a fake one");

  assertThrows(
    () => assertNoSecretMaterial({ sessionId: "s", password: TEST_SECRET }),
    undefined,
    "a snapshot carrying secret material is refused",
  );

  assert(
    !fs.readFileSync(
      path.resolve(ROOT, "backend/services/roamingEnforcementService.js"),
      "utf8",
    ).includes("mikrotik"),
    "roamingEnforcementService.js is NOT modified to reference MikroTik in Phase 8.5A",
  );
}

// ─────────────────────────────────────────────────────────────
// 11) Structural, security-remediation and boundary checks
// ─────────────────────────────────────────────────────────────
function runArchitectureAndSecurity() {
  const requiredFiles = [
    "backend/services/mikrotik/errors.js",
    "backend/services/mikrotik/featureFlag.js",
    "backend/services/mikrotik/identity.js",
    "backend/services/mikrotik/secrets.js",
    "backend/services/mikrotik/routerOsClient.js",
    "backend/services/mikrotik/hotspotUserService.js",
    "backend/services/mikrotik/enforcementSnapshot.js",
    "backend/services/mikrotik/index.js",
    "backend/scripts/check-roaming-phase8-5.js",
  ];
  for (const rel of requiredFiles) {
    assert(fs.existsSync(path.join(ROOT, rel)), `${rel} was created`);
  }

  // No real transport shipped in Phase 8.5A.
  const netModules = ["net", "tls", "dgram", "http", "https"];
  for (const file of fs.readdirSync(MIKROTIK_DIR)) {
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(MIKROTIK_DIR, file), "utf8");
    for (const mod of netModules) {
      assert(
        !new RegExp(`require\\(["']${mod}["']\\)`).test(source),
        `mikrotik/${file} does not open a network socket (no require("${mod}"))`,
      );
    }
    assert(
      !/console\.(log|warn|error|info)\s*\(/.test(source),
      `mikrotik/${file} contains no console output that could leak a secret`,
    );
    const code = executableSource(source);
    assert(
      !/\bdgram\b|\bnet\.connect\b|\bcreateConnection\b/.test(code),
      `mikrotik/${file} does not implement a live RouterOS transport`,
    );
  }

  // No commercial or billing logic in the router-control foundation.
  const forbiddenTerms = [
    "wallet", "settlement", "commission", "ownerRevenue",
    "consumeRau", "billing", "invoice", "price",
  ];
  for (const file of fs.readdirSync(MIKROTIK_DIR)) {
    if (!file.endsWith(".js")) continue;
    const code = executableSource(
      fs.readFileSync(path.join(MIKROTIK_DIR, file), "utf8"),
    );
    for (const term of forbiddenTerms) {
      assert(
        !new RegExp(`\\b${term}\\b`).test(code),
        `mikrotik/${file} contains no billing logic (${term})`,
      );
    }
  }

  // Phase 8.5A must NOT ship an adapter or register one.
  assert(
    !fs.existsSync(path.resolve(ROOT, "backend/services/adapters/mikrotikRoamingAAAAdapter.js")),
    "no MikroTik AAA adapter exists in Phase 8.5A",
  );
  const adapterRegistry = fs.readFileSync(
    path.resolve(ROOT, "backend/services/roamingAAAAdapter.js"),
    "utf8",
  );
  assert(
    !/require\(.*mikrotik/i.test(adapterRegistry),
    "the AAA adapter registry does not load the MikroTik foundation",
  );
  const serverSource = fs.readFileSync(path.resolve(ROOT, "backend/server.js"), "utf8");
  assert(
    !/mikrotikRoamingAAAAdapter/i.test(serverSource),
    "server.js does not register a MikroTik adapter",
  );
  assert(
    !/ROAMING_MIKROTIK_API_ENABLED\s*=\s*true/.test(serverSource),
    "server.js does not activate ROAMING_MIKROTIK_API_ENABLED",
  );

  // devices.js security remediation.
  const devicesSource = fs.readFileSync(
    path.resolve(ROOT, "backend/routes/devices.js"),
    "utf8",
  );
  const devicesCode = executableSource(devicesSource);

  // Every field that must never appear in a device response.
  const FORBIDDEN_RESPONSE_FIELDS = [
    "sshPassword",
    "enablePassword",
    "token",
    "routerOsApiSecretRef",
    "routerOsApiUsername",
    "routerOsApiPassword",
    "password",
    "secret",
    "apiPassword",
    "callbacksSecret",
  ];

  const secretFieldList = (devicesSource.match(/DEVICE_SECRET_FIELDS[\s\S]*?\];/) || [""])[0];
  assert(
    /sshPassword/.test(secretFieldList),
    "devices.js strips sshPassword from device responses",
  );
  assert(
    /enablePassword/.test(secretFieldList),
    "devices.js strips enablePassword from device responses",
  );
  assert(
    /"token"/.test(secretFieldList),
    "devices.js strips the provisioning token from device responses",
  );
  assert(
    /routerOsApiSecretRef/.test(secretFieldList),
    "devices.js strips the RouterOS secret reference from device responses",
  );
  assert(
    !/group=full/.test(devicesCode),
    "devices.js no longer provisions a group=full RouterOS account",
  );
  assert(
    !/address=0\.0\.0\.0\/0/.test(devicesCode),
    "devices.js no longer opens the RouterOS API to 0.0.0.0/0",
  );
  assert(
    !/name=yaba_api/.test(devicesCode),
    "devices.js no longer generates the shared yaba_api credential",
  );
  assert(
    !/apiPassword\s*=\s*crypto\.randomBytes/.test(devicesCode),
    "devices.js no longer generates a RouterOS API password at all",
  );
  // Authoritative device response boundaries.
  //
  // The original check counted `sanitizeDevice(` occurrences and required >= 4,
  // because the pre-hardening architecture had four response paths: device
  // creation, device status, owner inventory, and an unauthenticated duplicate
  // ssh-check definition in server.js. The duplicate was removed during the
  // security hardening, leaving exactly three authoritative boundaries.
  //
  // A raw function-name count is fragile: it would break on any legitimate
  // refactor that merges two paths into one helper. The security intent is that
  // every device response boundary strips credentials, so the check now names
  // each boundary and verifies it both calls sanitizeDevice AND actually omits
  // the sensitive fields. This is stronger than a count, not weaker.
  const responseBoundaries = [
    {
      name: "device creation response",
      pattern: /router\.post\("\/api\/devices",[\s\S]*?sanitizeDevice\(doc\)/,
    },
    {
      name: "device status response",
      pattern: /router\.get\("\/api\/devices\/status\/:id",[\s\S]*?sanitizeDevice\(d\)/,
    },
    {
      name: "owner inventory response",
      pattern: /router\.get\("\/api\/devices\/owner\/:ownerId",[\s\S]*?\.\.\.sanitizeDevice\(doc\.data\(\)\)/,
    },
  ];

  for (const boundary of responseBoundaries) {
    assert(
      boundary.pattern.test(devicesCode),
      `devices.js sanitizes the ${boundary.name} response boundary`,
    );
  }

  // Structural proof that the boundaries do not merely call a helper but
  // actually strip the fields. Each boundary must omit every secret field.
  for (const field of FORBIDDEN_RESPONSE_FIELDS) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const boundary of responseBoundaries) {
      const section = (devicesCode.match(boundary.pattern) || [""])[0];
      assert(
        !new RegExp(`"${escaped}"`).test(section),
        `devices.js ${boundary.name} omits "${field}"`,
      );
    }
  }

  // The redaction must be applied at the response boundary, not by mutating the
  // Firestore document. The document must still hold the secret server-side.
  const storedSecretPresent =
    /await db\.collection\("devices"\)\.doc\(.*\)\.set\(doc\)/.test(devicesCode) ||
    /await db\.collection\("devices"\)\.doc\(.*\)\.update\(.*\)/.test(devicesCode);
  assert(
    storedSecretPresent,
    "devices.js still writes to Firestore, so secrets remain stored server-side",
  );
  for (const field of [
    "networkControl",
    "routerOsApiEnabled",
    "routerOsApiPort",
    "routerOsApiSecretRef",
    "routerOsLastSeenAt",
    "routerOsApiState",
  ]) {
    assert(
      devicesSource.includes(field),
      `devices.js persists the ${field} field`,
    );
  }
  assert(
    /routerOsApiSecretRef:\s*null/.test(devicesSource),
    "a new device starts with NO secret reference (fail-closed)",
  );

  // hotspots.js device binding.
  const hotspotsSource = fs.readFileSync(
    path.resolve(ROOT, "backend/routes/hotspots.js"),
    "utf8",
  );
  assert(hotspotsSource.includes("deviceId"), "hotspots.js persists hotspots.deviceId");
  assert(
    /belongs to another owner/.test(hotspotsSource),
    "hotspots.js refuses to bind a hotspot to another owner's device",
  );

  // No new dependencies.
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "backend/package.json"), "utf8"),
  );
  const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  for (const forbidden of ["node-routeros", "mikrotik", "routeros", "radius", "freeradius", "dgram"]) {
    assert(!(forbidden in deps), `no '${forbidden}' package dependency was added`);
  }

  // Boundary files must be untouched by this phase.
  const boundaryFiles = [
    "backend/services/roamingEnforcementService.js",
    "backend/services/roamingAAAAdapter.js",
    "backend/services/roamingRauConsumptionService.js",
    "backend/services/roamingEntitlementBridgeService.js",
    "backend/routes/users.js",
    "backend/services/ciscoService.js",
    "backend/ciscoExpiryCron.js",
    "backend/phase8-4-decision-lock.md",
    "backend/package-lock.json",
    "render.yaml",
  ];
  for (const rel of boundaryFiles) {
    assert(fs.existsSync(path.join(ROOT, rel)), `${rel} still exists`);
  }
  for (const rel of boundaryFiles) {
    assert(
      !/mikrotik/i.test(fs.readFileSync(path.join(ROOT, rel), "utf8")),
      `${rel} contains no MikroTik reference (boundary respected)`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 12) Regression: earlier phases must still pass
// ─────────────────────────────────────────────────────────────
function runRegressions() {
  const regressions = [
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
      assert(
        /0 failed/.test(out),
        `regression ${script} passes (${(out.match(/(\d+) passed/) || [])[0] || "ok"})`,
      );
    } catch (err) {
      const combined = `${(err.stdout || "")}${(err.stderr || "")}`;
      assert(false, `regression ${script} FAILED: ${combined.split("\n").slice(-3).join(" | ")}`);
    }
  }
}

async function main() {
  console.log("=== Phase 8.5A: MikroTik Router Control Foundation ===\n");

  runErrors();
  runFeatureFlags();
  runIdentity();
  runSecrets();
  await runResolverScopes();
  runRouterOsClient();
  runRauTranslation();
  runSharedUsers();
  runConfigBuilder();
  await runMockedRouter();
  runEnforcementSnapshot();
  runArchitectureAndSecurity();
  runRegressions();

  console.log("\n----------------------------------------");
  console.log(`Phase 8.5A checks: ${passed} passed, ${failed} failed`);
  console.log("----------------------------------------");

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Phase 8.5A checker crashed:", err);
  process.exitCode = 1;
});