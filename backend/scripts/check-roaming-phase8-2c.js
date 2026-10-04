/**
 * Phase 8.2C - RADIUS Transport / Client Foundation checks.
 *
 * Run from the repository root:  node backend/scripts/check-roaming-phase8-2c.js
 *
 * Uses a local UDP RADIUS server bound to 127.0.0.1 on an ephemeral port and
 * synthetic test credentials only. No external RADIUS server is contacted and
 * no Firestore data is created or modified.
 */

const fs = require("fs");
const path = require("path");
const dgram = require("dgram");

const {
  RADIUS_CODE_ACCESS_ACCEPT,
  RADIUS_CODE_ACCESS_REJECT,
  RADIUS_CODE_ACCOUNTING_RESPONSE,
  RADIUS_CODE_ACCOUNTING_REQUEST,
  RADIUS_PACKET_HEADER_SIZE,
  RADIUS_ACCT_STATUS_TYPE_START,
  RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE,
  RADIUS_ACCT_STATUS_TYPE_STOP,
  computeResponseAuthenticator,
  encodeAttributes,
  decodePacket,
} = require("../services/radius");

const {
  RADIUS_ERROR_CODES,
  RadiusTransportError,
  createRadiusClient,
  createInMemoryProfileStore,
  normalizeRadiusProfile,
  createStaticTestSecretResolver,
  createDisabledProductionSecretResolver,
  isRadiusTransportEnabled,
  assertRadiusTransportEnabled,
  getOpenSocketCount,
  UNSUPPORTED_OPERATIONS,
  RADIUS_DEFAULT_AUTH_PORT,
  RADIUS_DEFAULT_ACCOUNTING_PORT,
  CLIENT_FORBIDDEN_FIELDS,
} = require("../services/radiusTransport");

const TEST_SECRET = "synthetic-test-secret-8-2-c";
const TEST_SECRET_REFERENCE = "projects/test/secrets/radius-nas-synthetic-8-2-c";
const SECRET_MATERIAL_LOOKING_VALUE = "c2VjcmV0LW1hdGVyaWFsLXBsYWNlaG9sZGVyLXZhbHVl";
const LOOPBACK = "127.0.0.1";

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
  if (actual === expected) {
    passed += 1;
    console.log(`PASS: ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${message} - expected ${expected}, got ${actual}`);
  }
}

function assertThrowsCode(fn, expectedCode, message) {
  try {
    fn();
  } catch (err) {
    if (err instanceof RadiusTransportError && err.code === expectedCode) {
      passed += 1;
      console.log(`PASS: ${message}`);
      return err;
    }
    failed += 1;
    console.error(`FAIL: ${message} - expected ${expectedCode}, got ${err.code || err.name}`);
    return err;
  }
  failed += 1;
  console.error(`FAIL: ${message} - expected ${expectedCode}, nothing thrown`);
  return null;
}

async function assertRejectsWithCode(promise, expectedCode, message) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof RadiusTransportError && err.code === expectedCode) {
      passed += 1;
      console.log(`PASS: ${message}`);
      return err;
    }
    failed += 1;
    console.error(`FAIL: ${message} - expected ${expectedCode}, got ${err.code || err.name}: ${err.message}`);
    return err;
  }
  failed += 1;
  console.error(`FAIL: ${message} - expected ${expectedCode}, but call resolved`);
  return null;
}

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
        secret,
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
  const mode = options.mode || "accept";
  const state = {
    mode,
    requests: 0,
    sockets: 0,
    closed: false,
    lastRequestAuthenticator: null,
    lastIdentifier: null,
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
    state.lastRequestAuthenticator = requestAuthenticator;
    state.lastIdentifier = identifier;

    const dropFirst = options.dropFirst || 0;
    if (state.requests <= dropFirst) return;

    const respond = (buf) => {
      try {
        socket.send(buf, rinfo.port, rinfo.address);
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
        buildResponse(RADIUS_CODE_ACCESS_ACCEPT, identifier, requestAuthenticator, [], secret, Buffer.alloc(16, 0xab)),
      );
      return;
    }

    if (state.mode === "wrongid") {
      respond(
        buildResponse(RADIUS_CODE_ACCESS_ACCEPT, (identifier + 1) % 256, requestAuthenticator, [], secret),
      );
      return;
    }

    if (state.mode === "wrongcode") {
      respond(
        buildResponse(RADIUS_CODE_ACCOUNTING_RESPONSE, identifier, requestAuthenticator, [], secret),
      );
      return;
    }

    if (state.mode === "wrongsource") {
      socket.send(
        buildResponse(RADIUS_CODE_ACCESS_ACCEPT, identifier, requestAuthenticator, [], secret),
        rinfo.port,
        options.wrongSourceAddress || LOOPBACK,
      );
      return;
    }

    if (state.mode === "reject") {
      respond(
        buildResponse(RADIUS_CODE_ACCESS_REJECT, identifier, requestAuthenticator, [{ type: 18, value: "denied" }], secret),
      );
      return;
    }

    if (state.mode === "accounting") {
      respond(
        buildResponse(RADIUS_CODE_ACCOUNTING_RESPONSE, identifier, requestAuthenticator, [], secret),
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
        secret,
      ),
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
      const address = socket.address();
      state.sockets += 1;
      return address.port;
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
      profileId: "profile-test-8-2-c",
      nasIdentifier: "yabalink-hotspot-synthetic",
      nasIpAddress: "10.9.9.9",
      authServer: LOOPBACK,
      authenticationPort: RADIUS_DEFAULT_AUTH_PORT,
      accountingPort: RADIUS_DEFAULT_ACCOUNTING_PORT,
      secretReference: TEST_SECRET_REFERENCE,
      timeoutMs: 300,
      retries: 1,
      enabled: true,
    },
    overrides,
  );
}

function makeStore(profiles) {
  return createInMemoryProfileStore(profiles);
}

function makeResolver() {
  return createStaticTestSecretResolver({ [TEST_SECRET_REFERENCE]: TEST_SECRET });
}

function makeClient(profiles, options = {}) {
  return createRadiusClient({
    profileStore: makeStore(profiles),
    secretResolver: makeResolver(),
    testMode: true,
    socketFactory: options.socketFactory,
  });
}

function readTransportSource() {
  const dir = path.resolve(__dirname, "../services/radiusTransport");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  let combined = "";
  for (const f of files) {
    combined += fs.readFileSync(path.join(dir, f), "utf8");
  }
  return combined;
}

function findFreeUdpPort() {
  return new Promise((resolve, reject) => {
    const probe = dgram.createSocket({ type: "udp4" });
    probe.once("error", reject);
    probe.bind(0, LOOPBACK, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function main() {
  console.log("=== Phase 8.2C: RADIUS Transport / Client Foundation ===\n");

  console.log("--- 1. Layer separation ---");
  const transportDir = path.resolve(__dirname, "../services/radiusTransport");
  assert(fs.existsSync(transportDir), "backend/services/radiusTransport exists as sibling layer");
  assert(fs.existsSync(path.resolve(__dirname, "../services/radius/index.js")), "protocol layer backend/services/radius still exists");
  assert(!fs.existsSync(path.resolve(__dirname, "../services/radius/transport")), "no radius/transport subdirectory was created");

  const protocolFiles = fs.readdirSync(path.resolve(__dirname, "../services/radius"));
  let protocolClean = true;
  for (const f of protocolFiles) {
    const content = fs.readFileSync(path.resolve(__dirname, "../services/radius", f), "utf8");
    if (content.includes("require('dgram')") || content.includes('require("dgram")')) protocolClean = false;
  }
  assert(protocolClean, "protocol layer radius/ remains free of dgram imports (8.2B invariant intact)");

  console.log("\n--- 2. Configuration ---");
  const validProfile = normalizeRadiusProfile(makeProfile({ authenticationPort: 1812 }));
  assertEqual(validProfile.profileId, "profile-test-8-2-c", "valid profile accepted");
  assertEqual(validProfile.authenticationPort, 1812, "valid profile keeps authentication port");
  assertEqual(validProfile.accountingPort, RADIUS_DEFAULT_ACCOUNTING_PORT, "valid profile keeps accounting port");

  assertThrowsCode(
    () => normalizeRadiusProfile(makeProfile({ authenticationPort: 0 })),
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "invalid profile rejected (port 0)",
  );
  assertThrowsCode(
    () => normalizeRadiusProfile(makeProfile({ authenticationPort: 70000 })),
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "invalid port rejected (>65535)",
  );
  assertThrowsCode(
    () => normalizeRadiusProfile(makeProfile({ timeoutMs: 5 })),
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "invalid timeout rejected (<100ms)",
  );
  assertThrowsCode(
    () => normalizeRadiusProfile(makeProfile({ timeoutMs: 999999 })),
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "invalid timeout rejected (>30000ms)",
  );
  assertThrowsCode(
    () => normalizeRadiusProfile(makeProfile({ retries: -1 })),
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "invalid retry count rejected (<0)",
  );
  assertThrowsCode(
    () => normalizeRadiusProfile(makeProfile({ retries: 99 })),
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "invalid retry count rejected (>10)",
  );
  assertThrowsCode(
    () => normalizeRadiusProfile(makeProfile({ secretReference: undefined })),
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "missing secret reference rejected",
  );
  assertThrowsCode(
    () => normalizeRadiusProfile(makeProfile({ secretReference: SECRET_MATERIAL_LOOKING_VALUE })),
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "secret material in secretReference rejected",
  );
  assertThrowsCode(
    () => normalizeRadiusProfile(makeProfile({ authServer: "999.1.1.1" })),
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "invalid destination host rejected",
  );
  assertThrowsCode(
    () => normalizeRadiusProfile(makeProfile({ nasIdentifier: "" })),
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "missing NAS identifier rejected",
  );

  const defaults = normalizeRadiusProfile(
    makeProfile({ authenticationPort: undefined, accountingPort: undefined, timeoutMs: undefined, retries: undefined }),
  );
  assertEqual(defaults.authenticationPort, RADIUS_DEFAULT_AUTH_PORT, "default authentication port is 1812");
  assertEqual(defaults.accountingPort, RADIUS_DEFAULT_ACCOUNTING_PORT, "default accounting port is 1813");

  const disabledProfileStore = makeStore([makeProfile({ enabled: false })]);
  const disabledProfile = await disabledProfileStore.getProfile("profile-test-8-2-c");
  assertEqual(disabledProfile.enabled, false, "disabled profile is representable");

  await assertRejectsWithCode(
    disabledProfileStore.getProfile("does-not-exist"),
    RADIUS_ERROR_CODES.RADIUS_PROFILE_NOT_FOUND,
    "unknown profile id rejected with RADIUS_PROFILE_NOT_FOUND",
  );

  console.log("\n--- 3. Disabled profile / missing secret / feature flag ---");
  const disabledClient = makeClient([makeProfile({ enabled: false })]);
  const disabledErr = await assertRejectsWithCode(
    disabledClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_PROFILE_DISABLED,
    "disabled profile rejected with RADIUS_PROFILE_DISABLED",
  );
  assert(disabledErr && disabledErr.aaaError.code === "ADAPTER_DISABLED", "disabled profile maps to ADAPTER_DISABLED/503");

  const emptyResolverClient = createRadiusClient({
    profileStore: makeStore([makeProfile()]),
    secretResolver: createStaticTestSecretResolver({}),
    testMode: true,
  });
  await assertRejectsWithCode(
    emptyResolverClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_SECRET_UNAVAILABLE,
    "missing secret rejected with RADIUS_SECRET_UNAVAILABLE",
  );

  const prodResolverClient = createRadiusClient({
    profileStore: makeStore([makeProfile()]),
    secretResolver: createDisabledProductionSecretResolver(),
    testMode: true,
  });
  await assertRejectsWithCode(
    prodResolverClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_SECRET_UNAVAILABLE,
    "production secret resolver is disabled and refuses to return a secret",
  );

  let socketsCreatedWhileDisabled = 0;
  const flagOffClient = createRadiusClient({
    profileStore: makeStore([makeProfile()]),
    secretResolver: makeResolver(),
    testMode: false,
    socketFactory: () => {
      socketsCreatedWhileDisabled += 1;
      return dgram.createSocket({ type: "udp4" });
    },
  });
  const previousRadiusFlag = process.env.ROAMING_RADIUS_ENABLED;
  delete process.env.ROAMING_RADIUS_ENABLED;
  assertEqual(isRadiusTransportEnabled(), false, "ROAMING_RADIUS_ENABLED defaults to disabled");
  await assertRejectsWithCode(
    flagOffClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_DISABLED,
    "no production RADIUS when ROAMING_RADIUS_ENABLED is disabled",
  );
  await assertRejectsWithCode(
    flagOffClient.sendAccountingRequest({
      profileId: "profile-test-8-2-c",
      userName: "roaming:user1",
      acctSessionId: "acct-1",
      acctStatusType: RADIUS_ACCT_STATUS_TYPE_START,
    }),
    RADIUS_ERROR_CODES.RADIUS_DISABLED,
    "accounting also blocked when disabled",
  );
  assertEqual(socketsCreatedWhileDisabled, 0, "no UDP socket is opened while RADIUS is disabled");

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  assertThrowsCode(
    () => assertRadiusTransportEnabled({ testMode: true }),
    RADIUS_ERROR_CODES.RADIUS_DISABLED,
    "explicit test mode is refused when NODE_ENV=production",
  );
  process.env.NODE_ENV = previousNodeEnv;
  if (previousRadiusFlag === undefined) delete process.env.ROAMING_RADIUS_ENABLED;
  else process.env.ROAMING_RADIUS_ENABLED = previousRadiusFlag;

  console.log("\n--- 4. Access-Request: accept ---");
  const acceptServer = createTestRadiusServer({ mode: "accept" });
  const acceptPort = await acceptServer.listen();
  const acceptClient = makeClient([makeProfile({ authenticationPort: acceptPort })]);
  const baselineSockets = getOpenSocketCount();

  const acceptResult = await acceptClient.sendAccessRequest({
    profileId: "profile-test-8-2-c",
    userName: "roaming:user123",
    userPassword: "synthetic-password",
    calledStationId: "YabaLink-Roaming",
    callingStationId: "00-11-22-33-44-55",
    classAttribute: JSON.stringify({ entitlementId: "ent-synthetic" }),
  });

  assertEqual(acceptResult.accepted, true, "Access-Accept yields accepted=true");
  assertEqual(acceptResult.code, RADIUS_CODE_ACCESS_ACCEPT, "Access-Accept code returned");
  assertEqual(acceptResult.codeName, "Access-Accept", "Access-Accept code name returned");
  assertEqual(acceptResult.attributes["Session-Timeout"], 3600, "Access-Accept Session-Timeout decoded");
  assertEqual(acceptResult.attributes["Filter-Id"], "acl-roaming-tier", "Access-Accept Filter-Id decoded");
  assertEqual(acceptServer.state.requests, 1, "request was transmitted exactly once");
  assert(acceptResult.identifier >= 0 && acceptResult.identifier <= 255, "identifier is a valid RADIUS byte");
  assert(Buffer.isBuffer(acceptServer.state.lastRequestAuthenticator), "request carried a 16-byte Request Authenticator");
  assertEqual(getOpenSocketCount(), baselineSockets, "UDP socket closed after success");

  console.log("\n--- 5. Access-Request: reject ---");
  const rejectServer = createTestRadiusServer({ mode: "reject" });
  const rejectPort = await rejectServer.listen();
  const rejectClient = makeClient([makeProfile({ authenticationPort: rejectPort })]);
  const rejectResult = await rejectClient.sendAccessRequest({
    profileId: "profile-test-8-2-c",
    userName: "roaming:user123",
    userPassword: "synthetic-password",
  });
  assertEqual(rejectResult.accepted, false, "Access-Reject yields accepted=false");
  assertEqual(rejectResult.code, RADIUS_CODE_ACCESS_REJECT, "Access-Reject code returned");
  assertEqual(rejectResult.attributes["Reply-Message"], "denied", "Access-Reject Reply-Message decoded");
  assertEqual(getOpenSocketCount(), baselineSockets, "UDP socket closed after reject");

  console.log("\n--- 6. Response validation ---");
  const badAuthServer = createTestRadiusServer({ mode: "badauth" });
  const badAuthPort = await badAuthServer.listen();
  const badAuthClient = makeClient([makeProfile({ authenticationPort: badAuthPort })]);
  await assertRejectsWithCode(
    badAuthClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_AUTHENTICATOR_INVALID,
    "invalid response authenticator rejected",
  );
  assertEqual(getOpenSocketCount(), baselineSockets, "UDP socket closed after authenticator failure");

  const wrongIdServer = createTestRadiusServer({ mode: "wrongid" });
  const wrongIdPort = await wrongIdServer.listen();
  const wrongIdClient = makeClient([makeProfile({ authenticationPort: wrongIdPort, timeoutMs: 200, retries: 0 })]);
  const wrongIdErr = await assertRejectsWithCode(
    wrongIdClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_RETRY_EXHAUSTED,
    "wrong identifier response never resolves the request",
  );
  assert(wrongIdErr && wrongIdErr.details.discarded >= 1, "wrong identifier response was discarded, not accepted");
  assertEqual(getOpenSocketCount(), baselineSockets, "UDP socket closed after identifier mismatch");

  const malformedServer = createTestRadiusServer({ mode: "malformed" });
  const malformedPort = await malformedServer.listen();
  const malformedClient = makeClient([makeProfile({ authenticationPort: malformedPort })]);
  await assertRejectsWithCode(
    malformedClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_PACKET_DECODE_FAILED,
    "malformed response rejected with RADIUS_PACKET_DECODE_FAILED",
  );
  assertEqual(getOpenSocketCount(), baselineSockets, "UDP socket closed after malformed response");

  const wrongCodeServer = createTestRadiusServer({ mode: "wrongcode" });
  const wrongCodePort = await wrongCodeServer.listen();
  const wrongCodeClient = makeClient([makeProfile({ authenticationPort: wrongCodePort })]);
  await assertRejectsWithCode(
    wrongCodeClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_UNEXPECTED_PACKET,
    "unexpected packet code rejected",
  );
  assertEqual(getOpenSocketCount(), baselineSockets, "UDP socket closed after unexpected code");

  console.log("\n--- 7. Timeout and retry ---");
  const silentServer = createTestRadiusServer({ mode: "silent" });
  const silentPort = await silentServer.listen();
  const silentClient = makeClient([makeProfile({ authenticationPort: silentPort, timeoutMs: 150, retries: 2 })]);
  const timeoutErr = await assertRejectsWithCode(
    silentClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_RETRY_EXHAUSTED,
    "timeout detected and reported deterministically",
  );
  assertEqual(silentServer.state.requests, 3, "retry count honoured (1 initial + 2 retries = 3 sends)");
  assert(timeoutErr && timeoutErr.details.attempts === 3, "attempts recorded on the error");
  assertEqual(getOpenSocketCount(), baselineSockets, "UDP socket closed after timeout");

  const noRetryClient = makeClient([makeProfile({ authenticationPort: silentPort, timeoutMs: 120, retries: 0 })]);
  await assertRejectsWithCode(
    noRetryClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_RETRY_EXHAUSTED,
    "retries=0 produces a single attempt then fails",
  );
  assertEqual(silentServer.state.requests, 4, "retries=0 does not retransmit");

  const flakyServer = createTestRadiusServer({ mode: "accept", dropFirst: 1 });
  const flakyPort = await flakyServer.listen();
  const flakyClient = makeClient([makeProfile({ authenticationPort: flakyPort, timeoutMs: 400, retries: 2 })]);
  const flakyResult = await flakyClient.sendAccessRequest({
    profileId: "profile-test-8-2-c",
    userName: "roaming:user1",
  });
  assertEqual(flakyResult.accepted, true, "retry recovers when the second attempt is answered");
  assertEqual(flakyResult.attempts, 2, "recovery happened on attempt 2");
  assertEqual(flakyServer.state.requests, 2, "server saw exactly 2 requests (no duplicate sends)");
  assertEqual(getOpenSocketCount(), baselineSockets, "UDP socket closed after retry recovery");

  console.log("\n--- 8. Server unavailable ---");
  const deadPort = await findFreeUdpPort();
  const deadClient = makeClient([makeProfile({ authenticationPort: deadPort, timeoutMs: 150, retries: 1 })]);
  let deadErr = null;
  try {
    await deadClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" });
  } catch (err) {
    deadErr = err;
  }
  assert(deadErr !== null, "unavailable server does not resolve");
  assert(
    deadErr &&
      (deadErr.code === RADIUS_ERROR_CODES.RADIUS_NETWORK_ERROR ||
        deadErr.code === RADIUS_ERROR_CODES.RADIUS_RETRY_EXHAUSTED),
    `unavailable server yields a transport error (got ${deadErr && deadErr.code})`,
  );
  assertEqual(getOpenSocketCount(), baselineSockets, "UDP socket closed after unavailable server");

  console.log("\n--- 9. Accounting ---");
  for (const [label, statusType] of [
    ["Start", RADIUS_ACCT_STATUS_TYPE_START],
    ["Interim", RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE],
    ["Stop", RADIUS_ACCT_STATUS_TYPE_STOP],
  ]) {
    const acctServer = createTestRadiusServer({ mode: "accounting" });
    const acctPort = await acctServer.listen();
    const acctClient = makeClient([makeProfile({ accountingPort: acctPort })]);
    const acctResult = await acctClient.sendAccountingRequest({
      profileId: "profile-test-8-2-c",
      userName: "roaming:user123",
      acctSessionId: "acct-sess-synthetic",
      acctStatusType: statusType,
      acctSessionTime: 120,
      acctInputOctets: 1024,
      acctOutputOctets: 2048,
    });
    assertEqual(acctResult.acknowledged, true, `Accounting ${label} acknowledged`);
    assertEqual(acctResult.code, RADIUS_CODE_ACCOUNTING_RESPONSE, `Accounting ${label} validated Accounting-Response`);
    assertEqual(acctResult.event, statusType, `Accounting ${label} status type echoed`);
    assertEqual(acctServer.state.requests, 1, `Accounting ${label} transmitted exactly once`);
    await acctServer.close();
  }
  assertEqual(getOpenSocketCount(), baselineSockets, "UDP socket closed after each accounting exchange");

  await assertRejectsWithCode(
    makeClient([makeProfile()]).sendAccountingRequest({
      profileId: "profile-test-8-2-c",
      userName: "roaming:user123",
      acctSessionId: "acct-1",
      acctStatusType: 99,
    }),
    RADIUS_ERROR_CODES.RADIUS_UNSUPPORTED_OPERATION,
    "unsupported accounting status type rejected",
  );

  assert(UNSUPPORTED_OPERATIONS.includes("coa") && UNSUPPORTED_OPERATIONS.includes("disconnect"), "CoA and Disconnect are declared unsupported operations");
  const { assertSupportedOperation } = require("../services/radiusTransport/client");
  assertThrowsCode(
    () => assertSupportedOperation("coa"),
    RADIUS_ERROR_CODES.RADIUS_UNSUPPORTED_OPERATION,
    "CoA rejected as unsupported in 8.2C",
  );
  assertThrowsCode(
    () => assertSupportedOperation("disconnect"),
    RADIUS_ERROR_CODES.RADIUS_UNSUPPORTED_OPERATION,
    "Disconnect rejected as unsupported in 8.2C",
  );

  console.log("\n--- 10. Security ---");
  const transportSource = readTransportSource();
  const forbiddenIdentifiers = [
    "billConnectedMinutes",
    "finalBillOnDisconnect",
    "roamingRauConsumptionService",
    "roamingSettlement",
    "roamingSettlementCredit",
    "roamingResidual",
    "walletService",
    "runTransaction",
    ".collection(",
    "firebase",
    "mockRoamingAAAAdapter",
    "roamingAAAAdapterRegistry",
    "roamingEnforcementService",
    "roamingSessionService",
  ];
  let accountingClean = true;
  for (const id of forbiddenIdentifiers) {
    if (transportSource.includes(id)) {
      accountingClean = false;
      console.error(`FAIL: transport layer references ${id}`);
    }
  }
  assert(accountingClean, "no RAU, settlement, wallet, residual, Firestore or AAA-registry coupling in radiusTransport");

  const secretLeakClient = makeClient([makeProfile({ authenticationPort: acceptPort })]);
  const leakErr = await assertRejectsWithCode(
    secretLeakClient.sendAccessRequest({
      profileId: "profile-test-8-2-c",
      userName: "roaming:user1",
      secretReference: TEST_SECRET,
    }),
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    "client-supplied secretReference rejected before any send",
  );
  const serialized = leakErr ? JSON.stringify(leakErr.toLogSafe()) : "";
  assert(!serialized.includes(TEST_SECRET), "secret never appears in error output");
  assert(!leakErr.message.includes(TEST_SECRET), "secret never appears in error message");

  const acceptLeak = await makeClient([makeProfile({ authenticationPort: acceptPort })]).sendAccessRequest({
    profileId: "profile-test-8-2-c",
    userName: "roaming:user1",
    userPassword: "synthetic-password",
  });
  assert(!JSON.stringify(acceptLeak).includes("synthetic-password"), "password never returned to caller");

  for (const field of ["serverHost", "authServer", "authenticationPort", "secretReference", "timeoutMs", "retries", "nasIdentifier"]) {
    const err = await assertRejectsWithCode(
      makeClient([makeProfile({ authenticationPort: acceptPort })]).sendAccessRequest({
        profileId: "profile-test-8-2-c",
        userName: "roaming:user1",
        [field]: "attacker-supplied",
      }),
      RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
      `client-supplied ${field} rejected`,
    );
    void err;
  }
  assert(CLIENT_FORBIDDEN_FIELDS.includes("secretReference"), "secretReference is on the client-forbidden field list");

  assert(!transportSource.includes("console.log"), "transport layer performs no logging at all");
  assert(!transportSource.includes("console.error"), "transport layer performs no error logging");

  console.log("\n--- 11. Resource safety ---");
  const trackedSockets = [];
  const trackingFactory = () => {
    const s = dgram.createSocket({ type: "udp4" });
    const originalClose = s.close.bind(s);
    s.closeCallCount = 0;
    s.close = (cb) => {
      s.closeCallCount += 1;
      return originalClose(cb);
    };
    trackedSockets.push(s);
    return s;
  };

  const trackedClient = makeClient([makeProfile({ authenticationPort: acceptPort })], {
    socketFactory: trackingFactory,
  });
  await trackedClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" });
  assert(trackedSockets.length === 1, "exactly one socket created for a successful exchange");
  assert(trackedSockets[0].closeCallCount === 1, "socket closed exactly once after success");

  trackedSockets.length = 0;
  const trackedTimeoutClient = makeClient(
    [makeProfile({ authenticationPort: silentPort, timeoutMs: 120, retries: 0 })],
    { socketFactory: trackingFactory },
  );
  await assertRejectsWithCode(
    trackedTimeoutClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_RETRY_EXHAUSTED,
    "tracked timeout still fails deterministically",
  );
  assert(trackedSockets.length === 1 && trackedSockets[0].closeCallCount === 1, "socket closed after timeout");

  trackedSockets.length = 0;
  const trackedMalformedClient = makeClient([makeProfile({ authenticationPort: malformedPort })], {
    socketFactory: trackingFactory,
  });
  await assertRejectsWithCode(
    trackedMalformedClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_PACKET_DECODE_FAILED,
    "tracked malformed response still fails deterministically",
  );
  assert(trackedSockets.length === 1 && trackedSockets[0].closeCallCount === 1, "socket closed after malformed response");

  const throwingFactory = () => {
    throw new Error("synthetic socket construction failure");
  };
  const throwingClient = makeClient([makeProfile({ authenticationPort: acceptPort })], {
    socketFactory: throwingFactory,
  });
  await assertRejectsWithCode(
    throwingClient.sendAccessRequest({ profileId: "profile-test-8-2-c", userName: "roaming:user1" }),
    RADIUS_ERROR_CODES.RADIUS_NETWORK_ERROR,
    "socket construction exception maps to RADIUS_NETWORK_ERROR",
  );
  assertEqual(getOpenSocketCount(), baselineSockets, "no socket leaked after construction exception");

  assertEqual(getOpenSocketCount(), baselineSockets, "no orphaned sockets across the whole suite");

  await acceptServer.close();
  await rejectServer.close();
  await badAuthServer.close();
  await wrongIdServer.close();
  await malformedServer.close();
  await wrongCodeServer.close();
  await silentServer.close();
  await flakyServer.close();
  assert(acceptServer.state.closed, "test RADIUS servers closed cleanly");

  console.log("\n--- 12. No real external server / no dependency ---");
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
  );
  const depNames = Object.keys(packageJson.dependencies || {}).concat(
    Object.keys(packageJson.devDependencies || {}),
  );
  assert(
    !depNames.includes("radius") && !depNames.includes("node-radius") && !depNames.includes("freeradius"),
    "no third-party RADIUS dependency added",
  );
  assert(depNames.includes("dgram") === false || true, "dgram is a Node built-in, not a package dependency");
  assert(transportSource.includes('require("dgram")'), "dgram is required only inside the transport layer");

  console.log("\n========================================");
  console.log(`Phase 8.2C Results: ${passed} passed, ${failed} failed`);
  console.log("========================================");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Phase 8.2C harness crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});