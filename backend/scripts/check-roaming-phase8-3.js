/**
 * Phase 8.3 - RADIUS profile, session propagation, discovery allowlist and
 * AAA adapter checks.
 *
 * Run from the repository root:  node backend/scripts/check-roaming-phase8-3.js
 *
 * Offline and deterministic. Networking is limited to a local UDP RADIUS server
 * bound to 127.0.0.1 on an ephemeral port, using synthetic test credentials
 * only. No external RADIUS server is contacted, no Firestore data is created or
 * modified, and no secret is written to any file.
 */

const fs = require("fs");
const path = require("path");
const dgram = require("dgram");

const ROOT = path.resolve(__dirname, "../..");
const SERVICES = path.resolve(ROOT, "backend/services");

const {
  RADIUS_CODE_ACCESS_ACCEPT,
  RADIUS_CODE_ACCESS_REJECT,
  RADIUS_CODE_ACCOUNTING_RESPONSE,
  RADIUS_PACKET_HEADER_SIZE,
  computeResponseAuthenticator,
  encodeAttributes,
  decodePacket,
} = require("../services/radius");

const {
  createRadiusClient,
  createInMemoryProfileStore,
  createStaticTestSecretResolver,
  createDisabledProductionSecretResolver,
  RADIUS_ERROR_CODES,
  RadiusTransportError,
  isExpectedSource,
  isRadiusTransportEnabled,
} = require("../services/radiusTransport");

const {
  createRadiusProfileService,
  createInertProfileStore,
  RADIUS_PROFILE_ID_PATTERN,
} = require("../services/radiusProfiles");

const {
  RadiusRoamingAAAAdapter,
  RADIUS_ADAPTER_KEY,
  RADIUS_METHOD_NOT_SUPPORTED,
  RADIUS_ADAPTER_CAPABILITIES,
  SUPPORTED_METHODS,
  UNSUPPORTED_METHODS,
} = require("../services/adapters/radiusRoamingAAAAdapter");

const { AAA_ADAPTER_KEYS } = require("../services/roamingAAAAdapter");

const {
  registerAAAAdapter,
  unregisterAAAAdapter,
} = require("../services/roamingAAAAdapterRegistry");

const sessionService = require("../services/roamingSessionService");
const registryService = require("../services/roamingRegistryService");

const TEST_SECRET = "synthetic-test-secret-8-3";
const TEST_SECRET_REFERENCE = "projects/test/secrets/radius-nas-synthetic-8-3";
const SECRET_MATERIAL_LOOKING_VALUE =
  "c2VjcmV0LW1hdGVyaWFsLXBsYWNlaG9sZGVyLXZhbHVl";
const LOOPBACK = "127.0.0.1";
const TEST_USER_NAME = "roaming-subject-8-3";
const TEST_USER_PASSWORD = "synthetic-user-password-8-3";

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
      `FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function readService(relative) {
  return fs.readFileSync(path.join(SERVICES, relative), "utf8");
}

const assertDeepEqual = assertEqual;

async function assertRejects(promise, matcher, message) {
  try {
    await promise;
  } catch (err) {
    if (matcher(err)) {
      passed += 1;
      console.log(`PASS: ${message}`);
    } else {
      failed += 1;
      console.error(
        `FAIL: ${message} - unexpected error ${err && err.code}: ${err && err.message}`
      );
    }
    return err;
  }
  failed += 1;
  console.error(`FAIL: ${message} - expected a rejection, call resolved`);
  return null;
}

async function assertResolves(promise, message) {
  try {
    const value = await promise;
    passed += 1;
    console.log(`PASS: ${message}`);
    return value;
  } catch (err) {
    failed += 1;
    console.error(
      `FAIL: ${message} - rejected with ${err && err.code}: ${err && err.message}`
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Loopback RADIUS test server (synthetic, 127.0.0.1 only)
// ---------------------------------------------------------------------------

function buildResponse(code, identifier, requestAuthenticator, attributes, secret, overrideAuthenticator) {
  const attrBuf = encodeAttributes(attributes);
  const length = RADIUS_PACKET_HEADER_SIZE + attrBuf.length;
  const authenticator = overrideAuthenticator
    ? overrideAuthenticator
    : computeResponseAuthenticator(
        code,
        identifier,
        length,
        requestAuthenticator,
        attrBuf,
        secret
      );
  const header = Buffer.alloc(RADIUS_PACKET_HEADER_SIZE);
  header.writeUInt8(code, 0);
  header.writeUInt8(identifier, 1);
  header.writeUInt16BE(length, 2);
  authenticator.copy(header, 4);
  return Buffer.concat([header, attrBuf]);
}

function createTestRadiusServer(options = {}) {
  const secret = options.secret || TEST_SECRET;
  const state = {
    mode: options.mode || "accept",
    requests: 0,
    lastIdentifier: null,
    closed: false,
  };

  const socket = dgram.createSocket({ type: "udp4" });

  socket.on("message", (msg, rinfo) => {
    state.requests += 1;

    let requestAuthenticator = Buffer.alloc(16);
    let identifier = 0;
    try {
      const decoded = decodePacket(msg);
      requestAuthenticator = decoded.authenticator;
      identifier = decoded.identifier;
    } catch (err) {
      void err;
      return;
    }
    state.lastIdentifier = identifier;

    const respond = (buf, address) => {
      try {
        socket.send(buf, rinfo.port, address || rinfo.address);
      } catch (err) {
        void err;
      }
    };

    if (state.mode === "silent") return;
    if (state.mode === "malformed") {
      respond(Buffer.from([1, 2, 3, 4, 5]));
      return;
    }
    if (state.mode === "badauth") {
      respond(
        buildResponse(
          RADIUS_CODE_ACCESS_ACCEPT,
          identifier,
          requestAuthenticator,
          [],
          secret,
          Buffer.alloc(16, 0xab)
        )
      );
      return;
    }
    if (state.mode === "wrongid") {
      respond(
        buildResponse(
          RADIUS_CODE_ACCESS_ACCEPT,
          (identifier + 1) % 256,
          requestAuthenticator,
          [],
          secret
        )
      );
      return;
    }
    if (state.mode === "wrongcode") {
      respond(
        buildResponse(
          RADIUS_CODE_ACCOUNTING_RESPONSE,
          identifier,
          requestAuthenticator,
          [],
          secret
        )
      );
      return;
    }
    if (state.mode === "wrongsource") {
      respond(
        buildResponse(RADIUS_CODE_ACCESS_ACCEPT, identifier, requestAuthenticator, [], secret),
        options.wrongSourceAddress || "127.0.0.2"
      );
      return;
    }
    if (state.mode === "reject") {
      respond(
        buildResponse(
          RADIUS_CODE_ACCESS_REJECT,
          identifier,
          requestAuthenticator,
          [{ type: 18, value: "denied" }],
          secret
        )
      );
      return;
    }

    respond(
      buildResponse(
        RADIUS_CODE_ACCESS_ACCEPT,
        identifier,
        requestAuthenticator,
        [
          { type: 27, value: 3600 },
          { type: 11, value: "acl-roaming-tier" },
        ],
        secret
      )
    );
  });

  socket.on("error", () => {});

  return {
    state,
    async listen() {
      await new Promise((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(0, LOOPBACK, () => {
          socket.removeAllListeners("error");
          socket.on("error", () => {});
          resolve();
        });
      });
      return socket.address().port;
    },
    async close() {
      if (state.closed) return;
      state.closed = true;
      await new Promise((resolve) => {
        try {
          socket.close(() => resolve());
        } catch (err) {
          void err;
          resolve();
        }
      });
    },
  };
}

function makeProfile(overrides = {}) {
  return Object.assign(
    {
      profileId: "profile-test-8-3",
      nasIdentifier: "yabalink-hotspot-synthetic-8-3",
      nasIpAddress: "10.9.9.9",
      authServer: LOOPBACK,
      authenticationPort: 1812,
      secretReference: TEST_SECRET_REFERENCE,
      timeoutMs: 300,
      retries: 1,
      enabled: true,
    },
    overrides
  );
}

function makeProfileService(profiles) {
  return createRadiusProfileService({
    store: createInMemoryProfileStore(profiles),
  });
}

function makeSecretResolver() {
  return createStaticTestSecretResolver({ [TEST_SECRET_REFERENCE]: TEST_SECRET });
}

/**
 * Build an adapter wired to a real loopback transport, mirroring how Phase 8.4
 * will wire production. `mode` selects the synthetic server behaviour.
 */
function makeAdapter(port, options = {}) {
  const profile = options.profile || makeProfile({
    profileId: options.profileId || "profile-test-8-3",
    authenticationPort: port,
    timeoutMs: options.timeoutMs || 300,
    retries: options.retries === undefined ? 1 : options.retries,
  });
  const profileService = options.profileService || makeProfileService([profile]);
  const secretResolver = options.secretResolver || makeSecretResolver();
  const transportClient =
    options.transportClient ||
    createRadiusClient({
      profileStore: profileService,
      secretResolver,
      testMode: true,
    });
  const adapter = new RadiusRoamingAAAAdapter({
    profileService,
    secretResolver,
    transportClient,
    testMode: true,
  });
  return { adapter, profile, profileService, secretResolver };
}

function baseContext(profileId, overrides = {}) {
  return Object.assign(
    {
      sessionId: "ses-test-8-3",
      userName: TEST_USER_NAME,
      password: TEST_USER_PASSWORD,
      radiusProfileId: profileId,
    },
    overrides
  );
}

async function withServer(mode, fn) {
  const server = createTestRadiusServer({ mode });
  const port = await server.listen();
  try {
    return await fn(port, server);
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------------------
// 1. Discovery security (DEFECT-8.3-01)
// ---------------------------------------------------------------------------

const SENSITIVE_HOTSPOT_FIXTURE = {
  hotspotId: "hot-public-1",
  ownerId: "owner-public-1",
  aaaAdapterKey: "radius",
  enforcementMode: "radius",
  partnerStatus: "active",
  isDiscoverable: true,
  networkIdentity: {
    venueName: "Central Kampala Cafe",
    venueAddress: "12 privacy-sensitive street",
    contactPhone: "+256700000",
    ownerEmail: "owner@example.test",
    ssid: "YabaLink-Guest",
    someFutureSubField: "future-leak",
  },
  radiusProfileId: "profile-test-8-3",
  radiusNas: { host: "10.0.0.5", identifier: "nas-1" },
  nasIdentifier: "nas-1",
  authServer: "radius.internal.test",
  authPort: 1812,
  accountingServer: "radius.internal.test",
  accountingPort: 1813,
  coaPort: 3799,
  ssid: "YabaLink-Guest",
  bssid: "AA:BB:CC:DD:EE:FF",
  wifiConfig: { ssid: "YabaLink-Guest", psk: "wifi-secret-value" },
  password: "hotspot-password-value",
  phone: "+256700001",
  email: "subscriber@example.test",
  secretReference: TEST_SECRET_REFERENCE,
  sharedSecret: TEST_SECRET,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  lastIdempotencyKey: "idem-secret-value",
  disabledBy: "owner-x",
  disabledReason: "internal-note",
  someFutureTopLevelField: "future-top-level-leak",
};

const DISCOVERY_FORBIDDEN_FIELDS = [
  "radiusProfileId",
  "radiusNas",
  "nasIdentifier",
  "authServer",
  "authPort",
  "accountingServer",
  "accountingPort",
  "coaPort",
  "ssid",
  "bssid",
  "wifiConfig",
  "password",
  "phone",
  "email",
  "secretReference",
  "sharedSecret",
  "createdAt",
  "updatedAt",
  "lastIdempotencyKey",
  "disabledBy",
  "disabledReason",
  "someFutureTopLevelField",
];

function runDiscoverySecurity() {
  console.log("--- 1. Discovery security (DEFECT-8.3-01) ---");

  const entry = registryService.toPublicDiscoveryEntry(
    "hot-public-1",
    SENSITIVE_HOTSPOT_FIXTURE
  );

  assert(
    Object.prototype.hasOwnProperty.call(entry, "id") &&
      Object.prototype.hasOwnProperty.call(entry, "hotspotId") &&
      Object.prototype.hasOwnProperty.call(entry, "ownerId") &&
      Object.prototype.hasOwnProperty.call(entry, "aaaAdapterKey") &&
      Object.prototype.hasOwnProperty.call(entry, "enforcementMode") &&
      Object.prototype.hasOwnProperty.call(entry, "isDiscoverable") &&
      Object.prototype.hasOwnProperty.call(entry, "partnerStatus") &&
      Object.prototype.hasOwnProperty.call(entry, "networkIdentity"),
    "all allowed discovery fields survive projection"
  );

  assertEqual(entry.id, "hot-public-1", "projected entry keeps the document id");
  assertEqual(entry.hotspotId, "hot-public-1", "projected entry keeps hotspotId");
  assertEqual(entry.ownerId, "owner-public-1", "projected entry keeps ownerId");
  assertEqual(entry.aaaAdapterKey, "radius", "projected entry keeps aaaAdapterKey");
  assertEqual(entry.enforcementMode, "radius", "projected entry keeps enforcementMode");
  assertEqual(entry.partnerStatus, "active", "projected entry keeps partnerStatus");
  assertEqual(entry.isDiscoverable, true, "projected entry keeps isDiscoverable");

  const missing = DISCOVERY_FORBIDDEN_FIELDS.filter(
    (field) => Object.prototype.hasOwnProperty.call(entry, field)
  );
  assertEqual(missing, [], "no sensitive or internal field is present on the entry");

  assertDeepEqual(
    entry.networkIdentity,
    { venueName: "Central Kampala Cafe" },
    "nested networkIdentity is re-projected and contains only venueName"
  );

  const serialized = JSON.stringify(entry);
  const leakedValues = [
    "profile-test-8-3",
    "nas-1",
    "radius.internal.test",
    "YabaLink-Guest",
    "AA:BB:CC:DD:EE:FF",
    "wifi-secret-value",
    "hotspot-password-value",
    "+256700001",
    "subscriber@example.test",
    TEST_SECRET_REFERENCE,
    TEST_SECRET,
    "idem-secret-value",
    "internal-note",
    "privacy-sensitive",
    "owner@example.test",
    "future-leak",
    "future-top-level-leak",
  ].filter((needle) => serialized.includes(needle));

  assertEqual(leakedValues, [], "no dropped value appears anywhere in the serialized response");

  const emptyEntry = registryService.toPublicDiscoveryEntry("hot-empty", {});
  assertEqual(
    Object.keys(emptyEntry).sort(),
    [
      "aaaAdapterKey",
      "enforcementMode",
      "hotspotId",
      "id",
      "isDiscoverable",
      "networkIdentity",
      "ownerId",
      "partnerStatus",
    ],
    "projection of an empty document yields only allowlisted keys"
  );

  const registrySource = readService("roamingRegistryService.js");
  assert(
    registrySource.includes("toPublicDiscoveryEntry(doc.id, data)"),
    "discoverHotspots projects through the allowlist"
  );
  assert(
    !/hotspots\.push\(\{\s*id:\s*doc\.id,\s*\.\.\./.test(registrySource),
    "discoverHotspots no longer spreads the raw Firestore document"
  );
  assert(
    /function discoverHotspots[\s\S]{0,2000}toPublicDiscoveryEntry/.test(registrySource),
    "discoverHotspots uses the allowlist inside the response builder"
  );

  console.log("");
}

// ---------------------------------------------------------------------------
// 2. Profile service
// ---------------------------------------------------------------------------

async function runProfileService() {
  console.log("--- 2. Trusted RADIUS profile service ---");

  const service = makeProfileService([makeProfile()]);

  const valid = await service.getProfile("profile-test-8-3");
  assert(valid !== null, "valid profile resolves");
  assertEqual(valid.profileId, "profile-test-8-3", "profile keeps its id");
  assertEqual(valid.secretReference, TEST_SECRET_REFERENCE, "profile keeps only the secret reference");
  assertEqual(valid.enabled, true, "profile keeps the enabled flag");
  assert(
    Object.isFrozen(valid),
    "normalized profile is frozen"
  );
  assert(
    !Object.prototype.hasOwnProperty.call(valid, "sharedSecret") &&
      !Object.prototype.hasOwnProperty.call(valid, "secret"),
    "normalized profile carries no literal secret field"
  );
  assertEqual(
    Object.keys(valid).sort(),
    [
      "accountingHost",
      "accountingPort",
      "authenticationPort",
      "coaPort",
      "enabled",
      "nasIdentifier",
      "nasIpAddress",
      "profileId",
      "retries",
      "secretReference",
      "serverHost",
      "timeoutMs",
    ],
    "normalized profile exposes exactly the allowed field set"
  );

  assertEqual(await service.getProfile("profile-does-not-exist"), null, "unknown profile returns null");
  assertEqual(await service.getProfile(""), null, "empty profile id returns null");
  assertEqual(await service.getProfile(undefined), null, "missing profile id returns null");
  assertEqual(await service.getProfile(12345), null, "non-string profile id returns null");
  assertEqual(await service.getProfile("bad id with spaces"), null, "malformed profile id returns null");
  assertEqual(await service.getProfile("../../etc/passwd"), null, "traversal-shaped profile id returns null");
  assertEqual(await service.getProfile("a".repeat(65)), null, "over-long profile id returns null");
  assertEqual(await service.getProfile("A".repeat(64)), null, "id of 64 chars is still unknown to the store");

  const disabled = await makeProfileService([
    makeProfile({ profileId: "profile-disabled", enabled: false }),
  ]).getProfile("profile-disabled");
  assert(disabled !== null, "disabled profile still resolves structurally");
  assertEqual(disabled.enabled, false, "disabled profile is reported as disabled, not silently enabled");

  const invalidConfigs = [
    ["port 0", { authenticationPort: 0 }],
    ["port 70000", { authenticationPort: 70000 }],
    ["non-integer port", { authenticationPort: 1812.5 }],
    ["timeout below minimum", { timeoutMs: 10 }],
    ["timeout above maximum", { timeoutMs: 90000 }],
    ["non-integer timeout", { timeoutMs: "300" }],
    ["negative retries", { retries: -1 }],
    ["retries above maximum", { retries: 99 }],
    ["non-integer retries", { retries: 1.5 }],
    ["missing nasIdentifier", { nasIdentifier: "" }],
    ["invalid hostname", { authServer: "not a hostname" }],
    ["numeric-only hostname", { authServer: "12.34.56" }],
    ["missing secretReference", { secretReference: undefined }],
  ];

  for (const [label, override] of invalidConfigs) {
    const record = Object.assign({ profileId: "profile-bad" }, override);
    const bad = createRadiusProfileService({
      store: {
        async getProfile() {
          return record;
        },
      },
    });
    let threw = false;
    try {
      await bad.getProfile("profile-bad");
    } catch (err) {
      threw = err instanceof RadiusTransportError && err.code === RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID;
    }
    assert(threw, `invalid profile rejected: ${label}`);
  }

  const secretAsReference = createRadiusProfileService({
    store: {
      async getProfile() {
        return makeProfile({
          profileId: "profile-secret-ref",
          secretReference: SECRET_MATERIAL_LOOKING_VALUE,
        });
      },
    },
  });
  let secretRefThrew = false;
  try {
    await secretAsReference.getProfile("profile-secret-ref");
  } catch (err) {
    secretRefThrew = err instanceof RadiusTransportError;
  }
  assert(secretRefThrew, "secretReference carrying literal secret material is rejected");

  const literalSecret = createRadiusProfileService({
    store: {
      async getProfile() {
        return makeProfile({ sharedSecret: TEST_SECRET });
      },
    },
  });
  let literalThrew = false;
  try {
    await literalSecret.getProfile("profile-test-8-3");
  } catch (err) {
    literalThrew = err instanceof RadiusTransportError;
  }
  assert(literalThrew, "profile containing a literal sharedSecret field is rejected");

  for (const field of ["secret", "password", "radiusSharedSecret", "secretValue"]) {
    const leaky = createRadiusProfileService({
      store: {
        async getProfile() {
          return Object.assign(makeProfile(), { [field]: TEST_SECRET });
        },
      },
    });
    let threw = false;
    try {
      await leaky.getProfile("profile-test-8-3");
    } catch (err) {
      threw = err instanceof RadiusTransportError;
    }
    assert(threw, `profile containing literal '${field}' is rejected`);
  }

  const unknownField = createRadiusProfileService({
    store: {
      async getProfile() {
        return Object.assign(makeProfile(), { someVendorField: "value" });
      },
    },
  });
  let unknownThrew = false;
  try {
    await unknownField.getProfile("profile-test-8-3");
  } catch (err) {
    unknownThrew = err instanceof RadiusTransportError;
  }
  assert(unknownThrew, "profile with fields outside the allowed set is rejected");

  const inert = createRadiusProfileService();
  assertEqual(inert.inert, true, "default profile service reports itself inert");
  assertEqual(await inert.getProfile("profile-test-8-3"), null, "inert default resolves nothing");
  assertEqual(await inert.getProfile("anything-at-all"), null, "inert default performs no external lookup");
  assertEqual((await inert.listProfiles()).length, 0, "inert default lists no profiles");

  const inertStore = createInertProfileStore();
  assertEqual(await inertStore.getProfile("x"), null, "inert store returns null");
  assertEqual(inertStore.inert, true, "inert store is flagged inert");

  const badStore = createRadiusProfileService({ store: { nope: true } });
  assertEqual(badStore.inert, true, "a store without getProfile() degrades to inert");

  const profileSource = readService(path.join("radiusProfiles", "radiusProfileService.js"));
  assert(
    !/require\(["'][^"']*firebase[^"']*["']\)/.test(profileSource),
    "profile service imports no Firestore module"
  );
  assert(
    !/require\(["'](?:fs|node:fs)["']\)/.test(profileSource),
    "profile service imports no filesystem module"
  );
  assert(
    !/process\.env\.[A-Z_]*(?:SECRET|PASSWORD)[A-Z_]*/.test(profileSource),
    "profile service reads no secret from the environment"
  );
  assert(
    profileSource.includes('require("../radiusTransport/profile")'),
    "profile service reuses the Phase 8.2C profile normalization"
  );
  assert(
    profileSource.includes("normalizeRadiusProfile"),
    "profile service normalizes via the Phase 8.2C validator"
  );

  console.log("");
}

// ---------------------------------------------------------------------------
// 3. radiusProfileId propagation (D-1)
// ---------------------------------------------------------------------------

async function runRadiusProfileIdPropagation() {
  console.log("--- 3. radiusProfileId propagation (D-1) ---");

  assert(
    AAA_ADAPTER_KEYS.includes(RADIUS_ADAPTER_KEY),
    "'radius' is an existing AAA adapter key (no enum change)"
  );

  sessionService.resetRadiusProfileResolver();
  assertEqual(
    await sessionService.resolveRadiusProfileId({
      radiusProfileId: "profile-test-8-3",
      enforcementMode: "radius",
      aaaAdapterKey: "radius",
    }),
    null,
    "inert default resolver omits the profile id (production cannot activate)"
  );

  registerAAAAdapter(new RadiusRoamingAAAAdapter({}));
  sessionService.setRadiusProfileResolver(makeProfileService([makeProfile()]));

  const validHotspot = {
    hotspotId: "hot-1",
    ownerId: "owner-1",
    partnerStatus: "active",
    enforcementMode: "radius",
    aaaAdapterKey: "radius",
    radiusProfileId: "profile-test-8-3",
  };

  assertEqual(
    await sessionService.resolveRadiusProfileId(validHotspot),
    "profile-test-8-3",
    "all four conditions met -> trusted profile id returned"
  );

  const rejectionCases = [
    ["invalid id format", Object.assign({}, validHotspot, { radiusProfileId: "bad id!" })],
    ["id with path traversal", Object.assign({}, validHotspot, { radiusProfileId: "../../secrets" })],
    ["over-long id", Object.assign({}, validHotspot, { radiusProfileId: "a".repeat(65) })],
    ["non-string id", Object.assign({}, validHotspot, { radiusProfileId: 12345 })],
    ["missing id", Object.assign({}, validHotspot, { radiusProfileId: undefined })],
    ["wrong enforcementMode", Object.assign({}, validHotspot, { enforcementMode: "local_adapter" })],
    ["external_aaa enforcementMode", Object.assign({}, validHotspot, { enforcementMode: "external_aaa" })],
    ["wrong adapter key", Object.assign({}, validHotspot, { aaaAdapterKey: "mock" })],
    ["unknown adapter key", Object.assign({}, validHotspot, { aaaAdapterKey: "not_registered" })],
  ];

  for (const [label, hotspot] of rejectionCases) {
    assertEqual(
      await sessionService.resolveRadiusProfileId(hotspot),
      null,
      `omitted: ${label}`
    );
  }

  assertEqual(
    await sessionService.resolveRadiusProfileId(
      Object.assign({}, validHotspot, { radiusProfileId: "profile-unknown" })
    ),
    null,
    "omitted: id absent from the injected profile store"
  );

  const disabledStore = createRadiusProfileService({
    store: {
      async getProfile() {
        return makeProfile({ profileId: "profile-test-8-3", enabled: false });
      },
    },
  });
  sessionService.setRadiusProfileResolver(disabledStore);
  assertEqual(
    await sessionService.resolveRadiusProfileId(validHotspot),
    "profile-test-8-3",
    "a disabled profile still resolves by id (enablement is the adapter's call)"
  );

  const throwingStore = createRadiusProfileService({
    store: {
      async getProfile() {
        throw new Error("store exploded");
      },
    },
  });
  sessionService.setRadiusProfileResolver(throwingStore);
  assertEqual(
    await sessionService.resolveRadiusProfileId(validHotspot),
    null,
    "a failing profile store omits the id instead of failing the session"
  );

  const mismatchedStore = createRadiusProfileService({
    store: {
      async getProfile() {
        return makeProfile({ profileId: "some-other-profile" });
      },
    },
  });
  sessionService.setRadiusProfileResolver(mismatchedStore);
  assertEqual(
    await sessionService.resolveRadiusProfileId(validHotspot),
    null,
    "a store returning a different profile id is rejected"
  );

  sessionService.setRadiusProfileResolver(makeProfileService([makeProfile()]));
  assertEqual(
    await sessionService.resolveRadiusProfileId({}),
    null,
    "a hotspot document without any of the fields omits the id"
  );

  unregisterAAAAdapter(RADIUS_ADAPTER_KEY);
  assertEqual(
    await sessionService.resolveRadiusProfileId(validHotspot),
    null,
    "omitted: no RADIUS adapter registered (server.js does not register one)"
  );

  sessionService.resetRadiusProfileResolver();

  const sessionSource = readService("roamingSessionService.js");
  assert(
    sessionSource.includes("await resolveRadiusProfileId(hotspot)"),
    "session creation resolves the id from the trusted hotspot document"
  );
  assert(
    /if \(radiusProfileId\) \{\s*sessionData\.radiusProfileId = radiusProfileId;/.test(sessionSource),
    "session persists radiusProfileId only inside the resolution guard"
  );
  assert(
    !/sessionData\.radiusProfileId\s*=/.test(
      sessionSource.replace(/sessionData\.radiusProfileId = radiusProfileId;/, "")
    ),
    "radiusProfileId is assigned exactly once, from the resolved value"
  );
  assert(
    !/claims\.radiusProfileId|req\.body\.radiusProfileId|body\.radiusProfileId/.test(sessionSource),
    "the session service never reads radiusProfileId from a token claim or request body"
  );

  const routesDir = path.join(ROOT, "backend/routes/roaming");
  const sessionRoutes = fs.existsSync(path.join(routesDir, "sessions.js"))
    ? fs.readFileSync(path.join(routesDir, "sessions.js"), "utf8")
    : "";
  assert(
    !sessionRoutes.includes("radiusProfileId"),
    "the sessions route exposes no client-facing radiusProfileId handling"
  );

  console.log("");
}

// ---------------------------------------------------------------------------
// 4. Adapter capabilities
// ---------------------------------------------------------------------------

async function runAdapterCapabilities() {
  console.log("--- 4. Adapter capabilities ---");

  const adapter = new RadiusRoamingAAAAdapter({});

  assertEqual(adapter.aaaAdapterKey, "radius", "adapter key is 'radius'");
  assertEqual(adapter.enforcementMode, "radius", "adapter reports radius enforcement mode");
  assert(
    typeof adapter.getCapabilities === "function",
    "adapter implements the existing getCapabilities() interface"
  );

  assertDeepEqual(
    adapter.getCapabilities(),
    {
      authenticate: true,
      authorize: true,
      provisionAccess: false,
      revokeAccess: false,
      disconnect: false,
      getUsage: false,
      checkHealth: true,
    },
    "capability declaration matches the locked contract exactly"
  );
  assertDeepEqual(
    { ...RADIUS_ADAPTER_CAPABILITIES },
    { ...adapter.getCapabilities() },
    "exported capability constant agrees with the instance"
  );

  assertDeepEqual(
    adapter.getSupportedMethods().slice().sort(),
    ["authenticate", "authorize", "checkHealth"],
    "exactly three supported methods"
  );
  assertDeepEqual(
    adapter.getUnsupportedMethods().slice().sort(),
    ["disconnect", "getUsage", "provisionAccess", "revokeAccess"],
    "exactly four unsupported methods"
  );
  assertDeepEqual(
    SUPPORTED_METHODS.slice().sort(),
    ["authenticate", "authorize", "checkHealth"],
    "supported method list is the locked set"
  );
  assertDeepEqual(
    UNSUPPORTED_METHODS.slice().sort(),
    ["disconnect", "getUsage", "provisionAccess", "revokeAccess"],
    "unsupported method list is the locked set"
  );

  for (const method of ["authenticate", "authorize", "checkHealth"]) {
    assertEqual(
      typeof adapter[method],
      "function",
      `${method} is implemented by the adapter`
    );
  }

  const context = { sessionId: "ses-caps" };
  for (const method of ["provisionAccess", "revokeAccess", "disconnect", "getUsage"]) {
    let caught = null;
    try {
      await adapter[method](context);
    } catch (err) {
      caught = err;
    }
    assert(caught !== null, `${method} rejects instead of resolving`);
    assertEqual(
      caught && caught.code,
      RADIUS_METHOD_NOT_SUPPORTED,
      `${method} fails with ${RADIUS_METHOD_NOT_SUPPORTED}`
    );
    assertEqual(caught && caught.name, "RoamingAAAAdapterError", `${method} throws the AAA error type`);
    assertEqual(caught && caught.status, 501, `${method} reports 501 not-implemented status`);
    assertEqual(caught && caught.details.method, method, `${method} names itself in the error details`);
    assertEqual(
      caught && caught.details.adapterKey,
      "radius",
      `${method} error identifies the radius adapter`
    );
  }

  const serialized = JSON.stringify(adapter.getCapabilities());
  for (const method of ["provisionAccess", "revokeAccess", "disconnect", "getUsage"]) {
    assert(
      serialized.includes(`"${method}":false`),
      `${method} is advertised as unsupported (never falsely advertised)`
    );
  }

  const health = await adapter.checkHealth();
  assertEqual(health.healthy, false, "unwired adapter reports itself unhealthy");
  assertEqual(health.productionRegistered, false, "health never claims production registration");
  assert(
    health.missingDependencies.includes("profileService"),
    "health names the missing profile service"
  );
  assert(
    health.missingDependencies.includes("transportClient"),
    "health names the missing transport client"
  );
  assertEqual(
    health.capabilities.checkHealth,
    true,
    "health reports the locked capability set"
  );

  const wired = makeAdapter(1812);
  const wiredHealth = await wired.adapter.checkHealth();
  assertEqual(wiredHealth.healthy, true, "fully wired adapter reports healthy");
  assertEqual(wiredHealth.transportEnabled, isRadiusTransportEnabled(), "health reports the transport gate state");
  assertEqual(
    wiredHealth.productionRegistered,
    false,
    "wired adapter still never claims production registration"
  );

  console.log("");
}

// ---------------------------------------------------------------------------
// 5. Adapter networking behaviour (loopback only)
// ---------------------------------------------------------------------------

async function runAdapterNetworking() {
  console.log("--- 5. Adapter networking behaviour ---");

  await withServer("accept", async (port, server) => {
    const { adapter } = makeAdapter(port);
    const result = await adapter.authenticate(baseContext("profile-test-8-3"));
    assertEqual(result.authenticated, true, "Access-Accept maps to authenticated: true");
    assertEqual(result.method, "radius_access_request", "authenticate reports the RADIUS method");
    assertEqual(result.profileId, "profile-test-8-3", "authenticate reports the resolved profile");
    assertEqual(result.reason, null, "accepted exchange has no rejection reason");
    assertEqual(result.code, RADIUS_CODE_ACCESS_ACCEPT, "accepted exchange reports the Access-Accept code");
    assert(server.state.requests >= 1, "at least one Access-Request reached the RADIUS server");

    const authorized = await adapter.authorize(
      Object.assign(baseContext("profile-test-8-3"), { radiusResult: result.radiusResult })
    );
    assertEqual(authorized.authorized, true, "authorize accepts an Access-Accept result");
    assertEqual(authorized.reason, "radius_accepted", "authorize reports the accepted reason");
    assertEqual(
      authorized.authoritativeForQuota,
      false,
      "authorize never claims authority over entitlement quota"
    );
    assertEqual(
      authorized.observedAttributes.sessionTimeoutSeconds,
      3600,
      "Session-Timeout is surfaced as an observation only"
    );
    assertEqual(
      authorized.observedAttributes.filterId,
      "acl-roaming-tier",
      "Filter-Id is surfaced as an observation only"
    );
    assertEqual(
      authorized.observedAttributes.appliedToSession,
      false,
      "deferred Session-Timeout / Filter-Id semantics are not applied in 8.3"
    );
    assert(
      Object.isFrozen(result),
      "authenticate result is frozen"
    );
  });

  await withServer("reject", async (port) => {
    const { adapter } = makeAdapter(port);
    const result = await adapter.authenticate(baseContext("profile-test-8-3"));
    assertEqual(result.authenticated, false, "Access-Reject maps to authenticated: false");
    assertEqual(result.reason, "access_reject", "Access-Reject maps to the access_reject reason");
    assertEqual(result.code, RADIUS_CODE_ACCESS_REJECT, "rejected exchange reports the Access-Reject code");

    const authorized = await adapter.authorize(
      Object.assign(baseContext("profile-test-8-3"), { radiusResult: result.radiusResult })
    );
    assertEqual(authorized.authorized, false, "authorize denies an Access-Reject result");
    assertEqual(authorized.reason, "access_reject", "authorize reports the reject reason");
  });

  await withServer("silent", async (port, server) => {
    const { adapter } = makeAdapter(port, { retries: 2, timeoutMs: 150 });
    const err = await assertRejects(
      adapter.authenticate(baseContext("profile-test-8-3")),
      (e) => e.radiusCode === RADIUS_ERROR_CODES.RADIUS_RETRY_EXHAUSTED,
      "timeout with exhausted retries surfaces a mapped AAA error"
    );
    assertEqual(err && err.code, "ADAPTER_FAILURE", "timeout maps onto the Phase 8.1 ADAPTER_FAILURE code");
    assertEqual(err && err.status, 502, "timeout maps onto HTTP 502");
    assertEqual(
      server.state.requests,
      3,
      "retries are bounded at retries+1 attempts (no unbounded retry loop)"
    );
  });

  await withServer("wrongid", async (port) => {
    const { adapter } = makeAdapter(port, { timeoutMs: 150, retries: 0 });
    await assertRejects(
      adapter.authenticate(baseContext("profile-test-8-3")),
      (e) => e.radiusCode === RADIUS_ERROR_CODES.RADIUS_RETRY_EXHAUSTED,
      "response with the wrong identifier is not accepted"
    );
  });

  // Wrong-source rejection is asserted directly against the Phase 8.2C guard.
  // A single loopback socket cannot emit a packet whose source address differs
  // from the address it is bound to, so a socket-level spoof test would be
  // vacuous on this platform.
  assert(
    !isExpectedSource({ address: "127.0.0.2", port: 1812 }, "127.0.0.1", 1812),
    "response from a different source address is rejected"
  );
  assert(
    !isExpectedSource({ address: "127.0.0.1", port: 9999 }, "127.0.0.1", 1812),
    "response from a different source port is rejected"
  );
  assert(
    !isExpectedSource(null, "127.0.0.1", 1812),
    "a response without source information is rejected"
  );
  assert(
    isExpectedSource({ address: "127.0.0.1", port: 1812 }, "127.0.0.1", 1812),
    "a response from the expected source is accepted"
  );

  await withServer("badauth", async (port) => {
    const { adapter } = makeAdapter(port, { timeoutMs: 150, retries: 0 });
    await assertRejects(
      adapter.authenticate(baseContext("profile-test-8-3")),
      (e) => e.radiusCode === RADIUS_ERROR_CODES.RADIUS_AUTHENTICATOR_INVALID,
      "response with an invalid authenticator is rejected"
    );
  });

  await withServer("malformed", async (port) => {
    const { adapter } = makeAdapter(port, { timeoutMs: 150, retries: 0 });
    await assertRejects(
      adapter.authenticate(baseContext("profile-test-8-3")),
      (e) =>
        e.radiusCode === RADIUS_ERROR_CODES.RADIUS_PACKET_DECODE_FAILED ||
        e.radiusCode === RADIUS_ERROR_CODES.RADIUS_RETRY_EXHAUSTED,
      "malformed response is rejected, never treated as success"
    );
  });

  await withServer("wrongcode", async (port) => {
    const { adapter } = makeAdapter(port, { timeoutMs: 150, retries: 0 });
    await assertRejects(
      adapter.authenticate(baseContext("profile-test-8-3")),
      (e) =>
        e.radiusCode === RADIUS_ERROR_CODES.RADIUS_UNEXPECTED_PACKET ||
        e.radiusCode === RADIUS_ERROR_CODES.RADIUS_RETRY_EXHAUSTED,
      "unexpected packet code is rejected"
    );
  });

  const missingProfile = new RadiusRoamingAAAAdapter({
    profileService: makeProfileService([makeProfile()]),
    secretResolver: makeSecretResolver(),
    transportClient: {
      async sendAccessRequest() {
        throw new Error("transport must not be reached without a profile");
      },
    },
  });
  const missingErr = await assertRejects(
    missingProfile.authenticate(baseContext("profile-not-configured")),
    (e) => e.radiusCode === RADIUS_ERROR_CODES.RADIUS_PROFILE_NOT_FOUND,
    "missing profile is rejected deterministically"
  );
  assertEqual(missingErr && missingErr.code, "ADAPTER_NOT_CONFIGURED", "missing profile maps to ADAPTER_NOT_CONFIGURED");
  assertEqual(missingErr && missingErr.status, 404, "missing profile maps to HTTP 404");

  await assertRejects(
    missingProfile.authenticate(baseContext(undefined)),
    (e) => e.radiusCode === RADIUS_ERROR_CODES.RADIUS_PROFILE_NOT_FOUND,
    "absent radiusProfileId is rejected deterministically"
  );
  await assertRejects(
    missingProfile.authenticate(baseContext("bad id!")),
    (e) => e.radiusCode === RADIUS_ERROR_CODES.RADIUS_PROFILE_NOT_FOUND,
    "malformed radiusProfileId is rejected deterministically"
  );

  const disabledProfileService = makeProfileService([
    makeProfile({ profileId: "profile-disabled-8-3", enabled: false }),
  ]);
  const disabled = new RadiusRoamingAAAAdapter({
    profileService: disabledProfileService,
    secretResolver: makeSecretResolver(),
    transportClient: {
      async sendAccessRequest() {
        throw new Error("transport must not be reached for a disabled profile");
      },
    },
  });
  const disabledErr = await assertRejects(
    disabled.authenticate(baseContext("profile-disabled-8-3")),
    (e) => e.radiusCode === RADIUS_ERROR_CODES.RADIUS_PROFILE_DISABLED,
    "disabled profile is rejected deterministically"
  );
  assertEqual(disabledErr && disabledErr.code, "ADAPTER_DISABLED", "disabled profile maps to ADAPTER_DISABLED");
  assertEqual(disabledErr && disabledErr.status, 503, "disabled profile maps to HTTP 503");

  const brokenResolver = createRadiusProfileService({ store: createInertProfileStore() });
  const secretFailure = new RadiusRoamingAAAAdapter({
    profileService: brokenResolver,
    secretResolver: createDisabledProductionSecretResolver({ reason: "test_secret_backend_absent" }),
    transportClient: {
      async sendAccessRequest() {
        throw new Error("unreachable");
      },
    },
  });
  await assertRejects(
    secretFailure.authenticate(baseContext("profile-test-8-3")),
    (e) => e.code === "ADAPTER_NOT_CONFIGURED",
    "inert profile service rejects before any transport call"
  );

  await withServer("accept", async (port) => {
    const { adapter } = makeAdapter(port, {
      secretResolver: createDisabledProductionSecretResolver({ reason: "test_secret_backend_absent" }),
    });
    const err = await assertRejects(
      adapter.authenticate(baseContext("profile-test-8-3")),
      (e) => e.radiusCode === RADIUS_ERROR_CODES.RADIUS_SECRET_UNAVAILABLE,
      "secret resolver failure is surfaced deterministically"
    );
    assertEqual(err && err.code, "ADAPTER_FAILURE", "secret failure maps to ADAPTER_FAILURE");
    assert(!JSON.stringify(err).includes(TEST_SECRET), "secret failure leaks no secret material");
  });

  const transportFailure = new RadiusRoamingAAAAdapter({
    profileService: makeProfileService([makeProfile()]),
    secretResolver: makeSecretResolver(),
    transportClient: {
      async sendAccessRequest() {
        throw new RadiusTransportError(
          RADIUS_ERROR_CODES.RADIUS_NETWORK_ERROR,
          "RADIUS transport network error",
          {}
        ).toAAAError();
      },
    },
  });
  const networkErr = await assertRejects(
    transportFailure.authenticate(baseContext("profile-test-8-3")),
    (e) => e.code === "ADAPTER_UNAVAILABLE",
    "transport network error maps onto ADAPTER_UNAVAILABLE"
  );
  assertEqual(networkErr && networkErr.status, 503, "transport network error maps to HTTP 503");

  const clientConfig = new RadiusRoamingAAAAdapter({
    profileService: makeProfileService([makeProfile()]),
    secretResolver: makeSecretResolver(),
    transportClient: { async sendAccessRequest() { throw new Error("unreachable"); } },
  });
  await assertRejects(
    clientConfig.authenticate(
      baseContext("profile-test-8-3", { secretReference: "attacker-supplied" })
    ),
    (e) => e.radiusCode === RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "client-supplied RADIUS infrastructure config is rejected"
  );
  await assertRejects(
    clientConfig.authenticate(baseContext("profile-test-8-3", { authServer: "attacker.test" })),
    (e) => e.radiusCode === RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "client-supplied authServer is rejected"
  );

  const noUsername = new RadiusRoamingAAAAdapter({
    profileService: makeProfileService([makeProfile()]),
    secretResolver: makeSecretResolver(),
    transportClient: { async sendAccessRequest() { throw new Error("unreachable"); } },
  });
  const noUserErr = await assertRejects(
    noUsername.authenticate({ sessionId: "s", password: TEST_USER_PASSWORD, radiusProfileId: "profile-test-8-3" }),
    (e) => e.code === "VALIDATION_ERROR",
    "authenticate requires a caller-supplied username"
  );
  assert(
    !/phone/i.test(noUserErr && noUserErr.message),
    "missing-username error does not mention phone numbers"
  );

  await assertRejects(
    noUsername.authenticate(
      baseContext("profile-test-8-3", { userName: "", password: TEST_USER_PASSWORD })
    ),
    (e) => e.code === "VALIDATION_ERROR",
    "an empty username is rejected"
  );
  await assertRejects(
    noUsername.authenticate(baseContext("profile-test-8-3", { password: "" })),
    (e) => e.code === "VALIDATION_ERROR",
    "an empty password is rejected"
  );

  console.log("");
}

// ---------------------------------------------------------------------------
// 6. Secret security
// ---------------------------------------------------------------------------

async function runSecretSecurity() {
  console.log("--- 6. Secret security ---");

  const captured = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args) => captured.push(args.map(String).join(" "));
  console.error = (...args) => captured.push(args.map(String).join(" "));
  console.warn = (...args) => captured.push(args.map(String).join(" "));

  let thrownError = null;
  let adapter = null;
  let describeJson = null;
  let stateJson = null;

  try {
    await withServer("silent", async (port) => {
      const wired = makeAdapter(port, { timeoutMs: 120, retries: 0 });
      adapter = wired.adapter;
      describeJson = JSON.stringify(adapter.describe());
      stateJson = JSON.stringify(Object.keys(adapter).reduce((acc, key) => {
        const value = adapter[key];
        if (typeof value !== "function") acc[key] = value;
        return acc;
      }, {}));
      try {
        await adapter.authenticate(baseContext("profile-test-8-3"));
      } catch (err) {
        thrownError = err;
      }
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  assert(thrownError !== null, "secret test produced an error to inspect");
  assert(
    !JSON.stringify(thrownError).includes(TEST_SECRET),
    "no secret in the serialized thrown error"
  );
  assert(
    !String(thrownError.message).includes(TEST_SECRET),
    "no secret in the thrown error message"
  );
  assert(
    !JSON.stringify(thrownError.details || {}).includes(TEST_SECRET),
    "no secret in the thrown error details"
  );
  assert(
    !captured.join("\n").includes(TEST_SECRET),
    "no secret in captured console output"
  );
  assert(!describeJson.includes(TEST_SECRET), "no secret in the adapter description");
  assert(!stateJson.includes(TEST_SECRET), "no secret in serialized adapter state");

  const secretishKeys = Object.keys(adapter).filter(
    (key) => /secret/i.test(key) && !/secretresolver/i.test(key)
  );
  assertEqual(
    secretishKeys,
    [],
    "adapter holds no instance field named like a stored secret"
  );
  assert(
    !Object.values(adapter).some(
      (value) => typeof value === "string" && value.includes(TEST_SECRET)
    ),
    "no adapter field contains the shared secret value"
  );

  const adapterSource = readService(path.join("adapters", "radiusRoamingAAAAdapter.js"));
  const secretAssignments =
    adapterSource.match(/this\.(?!secretResolver\b)[A-Za-z_$][\w$]*[Ss]ecret[\w$]*\s*=/g) || [];
  assertEqual(
    secretAssignments,
    [],
    "adapter never assigns the shared secret to instance state"
  );
  assert(
    !/console\.(log|error|warn|info|debug)\(/.test(adapterSource),
    "adapter logs nothing at all"
  );
  assert(
    !/\.env/.test(adapterSource),
    "adapter contains no .env reference"
  );
  assert(
    !/firebase|firestore/i.test(adapterSource),
    "adapter contains no Firestore reference"
  );

  const profileServiceSource = readService(path.join("radiusProfiles", "radiusProfileService.js"));
  assert(
    !/console\.(log|error|warn|info|debug)\(/.test(profileServiceSource),
    "profile service logs nothing at all"
  );

  const disabledResolver = createDisabledProductionSecretResolver();
  await assertRejects(
    disabledResolver.resolveSecret(TEST_SECRET_REFERENCE),
    (e) => e.code === RADIUS_ERROR_CODES.RADIUS_SECRET_UNAVAILABLE,
    "production secret resolver stays fail-closed by default"
  );
  assertEqual(
    disabledResolver.listReferences().length,
    0,
    "disabled production resolver holds no secrets"
  );

  console.log("");
}

// ---------------------------------------------------------------------------
// 7. Architecture and layering
// ---------------------------------------------------------------------------

function runArchitecture() {
  console.log("--- 7. Architecture and layering ---");

  const adapterSource = readService(path.join("adapters", "radiusRoamingAAAAdapter.js"));

  for (const forbidden of ["dgram", "net", "http", "https", "dns", "tls", "netmask"]) {
    const pattern = new RegExp(
      `require\\(["'](?:node:)?${forbidden}["']\\)|from\\s+["'](?:node:)?${forbidden}["']`
    );
    assert(!pattern.test(adapterSource), `radius adapter imports no '${forbidden}'`);
  }

  const profileServiceSource = readService(path.join("radiusProfiles", "radiusProfileService.js"));
  for (const forbidden of ["dgram", "net", "http", "https", "dns"]) {
    const pattern = new RegExp(
      `require\\(["'](?:node:)?${forbidden}["']\\)|from\\s+["'](?:node:)?${forbidden}["']`
    );
    assert(!pattern.test(profileServiceSource), `profile service imports no '${forbidden}'`);
  }

  assert(
    !/require\(["'][^"']*radiusTransport\/transport["']\)/.test(adapterSource),
    "adapter does not reach into the transport internals directly"
  );
  assert(
    adapterSource.includes('require("../radiusTransport/client")'),
    "adapter reaches networking only through the Phase 8.2C client"
  );

  const radiusDir = path.join(SERVICES, "radius");
  let protocolClean = true;
  for (const file of fs.readdirSync(radiusDir)) {
    if (!file.endsWith(".js")) continue;
    const content = fs.readFileSync(path.join(radiusDir, file), "utf8");
    if (/require\(["'](?:node:)?(?:dgram|net|http|https|dns)["']\)/.test(content)) {
      protocolClean = false;
    }
  }
  assert(protocolClean, "protocol layer radius/ remains networking-free (Phase 8.2B invariant)");
  assert(
    !fs.existsSync(path.join(radiusDir, "transport")),
    "no radius/transport subdirectory was created"
  );
  assert(
    fs.existsSync(path.join(SERVICES, "radiusTransport")),
    "radiusTransport remains the only networking layer"
  );

  const serverSource = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  assert(
    !serverSource.includes("radiusRoamingAAAAdapter"),
    "server.js does not reference the RADIUS adapter"
  );
  assert(
    !/registerAAAAdapter\(\s*new\s+Radius/.test(serverSource),
    "server.js registers no RADIUS adapter"
  );
  assert(
    !/ROAMING_RADIUS_ENABLED\s*=\s*true/.test(serverSource),
    "server.js does not activate ROAMING_RADIUS_ENABLED"
  );
  assert(
    serverSource.includes("ROAMING_MOCK_AAA_ENABLED"),
    "server.js still gates only the mock adapter"
  );

  const lockDoc = path.join(ROOT, "backend/phase8-3-decision-lock.md");
  const archDoc = path.join(ROOT, "backend/phase8-3-radius-adapter-architecture.md");
  assert(fs.existsSync(archDoc), "Phase 8.3 architecture document exists");

  const checker82a = fs.readFileSync(
    path.join(ROOT, "backend/scripts/check-roaming-phase8-2a.js"),
    "utf8"
  );
  const checker82b = fs.readFileSync(
    path.join(ROOT, "backend/scripts/check-roaming-phase8-2b.js"),
    "utf8"
  );
  assert(
    checker82a.includes('"radiusProfileId"'),
    "Phase 8.2A client-field protection list is intact"
  );
  assert(
    checker82b.includes("No Live Networking") || checker82b.includes("dgram"),
    "Phase 8.2B networking guard is intact"
  );

  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "backend/package.json"), "utf8")
  );
  const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  for (const forbidden of ["radius", "freeradius", "node-radius", "dgram"]) {
    assert(!(forbidden in deps), `no '${forbidden}' package dependency was added`);
  }

  assert(!isRadiusTransportEnabled(), "ROAMING_RADIUS_ENABLED is not set in this environment");

  const trackedFiles = [
    "backend/services/radiusProfiles/radiusProfileService.js",
    "backend/services/radiusProfiles/index.js",
    "backend/services/adapters/radiusRoamingAAAAdapter.js",
    "backend/scripts/check-roaming-phase8-3.js",
  ];
  for (const rel of trackedFiles) {
    assert(fs.existsSync(path.join(ROOT, rel)), `${rel} was created`);
  }
  void lockDoc;

  console.log("");
}

async function main() {
  console.log("=== Phase 8.3: RADIUS Profile, Discovery Allowlist and AAA Adapter ===\n");

  runDiscoverySecurity();
  await runProfileService();
  await runRadiusProfileIdPropagation();
  await runAdapterCapabilities();
  await runAdapterNetworking();
  await runSecretSecurity();
  runArchitecture();

  console.log("----------------------------------------");
  console.log(`Phase 8.3 checks: ${passed} passed, ${failed} failed`);
  console.log("----------------------------------------");

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Phase 8.3 checker crashed:", err);
  process.exitCode = 1;
});
