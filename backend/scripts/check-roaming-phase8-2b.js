const crypto = require("crypto");
const {
  RADIUS_CODE_ACCESS_REQUEST,
  RADIUS_CODE_ACCESS_ACCEPT,
  RADIUS_CODE_ACCESS_REJECT,
  RADIUS_CODE_ACCOUNTING_REQUEST,
  RADIUS_CODE_ACCOUNTING_RESPONSE,
  RADIUS_CODE_DISCONNECT_REQUEST,
  RADIUS_CODE_COA_REQUEST,
  RADIUS_PACKET_HEADER_SIZE,
  RADIUS_AUTHENTICATOR_SIZE,
  RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE,
  RADIUS_ACCT_STATUS_TYPE_START,
  RADIUS_ACCT_STATUS_TYPE_STOP,
  RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE,

  RADIUS_PACKET_MAX_SIZE,
  generateRequestAuthenticator,
  computeRequestAuthenticator,
  computeResponseAuthenticator,
  validateRequestAuthenticator,
  validateResponseAuthenticator,
  encodeUserPassword,
  decodeUserPassword,
  encodePacket,
  decodePacket,
  createAccessRequest,
  createAccountingRequest,
  decodeAccessAccept,
  decodeAccountingRequest,
  buildAccessRequestPacket,
  buildAccountingRequestPacket,
  decodeRadiusPacket,
  buildClassAttribute,
  parseClassAttribute,
  normalizeAccountingData,
  normalizeAccountingPacket,
  normalizeUsageForSession,
  mapAccountingToSessionUpdate,
  isAccountingStart,
  isAccountingStop,
  isAccountingInterim,
  shouldTriggerRauBilling,
  extractEntitlementId,
  extractSessionSequence,
  extractHomeOwnerId,
  extractVisitedOwnerId,
  extractQuotaInfo,
  encodeAttribute,
  decodeAttribute,
  decodeAttributes,
  findAttributeValue,
  findAttribute,

  RadiusPacketError,
  RadiusAuthenticatorError,
  RadiusAttributeError,
  RadiusPasswordHidingError,
  RadiusPacketLayerError,
  RADIUS_PROTOCOL_VERSION,
  RADIUS_PROTOCOL_RFC,
} = require("../services/radius/index");

const SECRET = "testing123";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    failed++;
    console.error(`FAIL: ${message}`);
    console.error(`  expected: ${expectedStr}`);
    console.error(`  actual:   ${actualStr}`);
  } else {
    passed++;
  }
}

function assertThrows(fn, errorType, message) {
  try {
    fn();
    failed++;
    console.error(`FAIL: ${message} — expected to throw ${errorType}`);
  } catch (err) {
    if (err.name === errorType || err.constructor.name === errorType) {
      passed++;
    } else {
      failed++;
      console.error(`FAIL: ${message} — expected ${errorType}, got ${err.constructor.name}: ${err.message}`);
    }
  }
}

console.log("=== Phase 8.2B: RADIUS Packet Layer Tests ===\n");

// ====================================================================
// 1. Constants
// ====================================================================
console.log("--- 1. Constants ---");

assert(RADIUS_PROTOCOL_VERSION === "2.0", "RADIUS_PROTOCOL_VERSION is '2.0'");

assert(
  RADIUS_PACKET_HEADER_SIZE === 20,
  "RADIUS_PACKET_HEADER_SIZE is 20",
);

assert(
  RADIUS_AUTHENTICATOR_SIZE === 16,
  "RADIUS_AUTHENTICATOR_SIZE is 16",
);

assert(
  RADIUS_PACKET_MAX_SIZE === 4096,
  "RADIUS_PACKET_MAX_SIZE is 4096",
);

assert(
  RADIUS_CODE_ACCESS_REQUEST === 1,
  "RADIUS_CODE_ACCESS_REQUEST is 1",
);

assert(
  RADIUS_CODE_ACCESS_ACCEPT === 2,
  "RADIUS_CODE_ACCESS_ACCEPT is 2",
);

assert(
  RADIUS_CODE_ACCOUNTING_REQUEST === 4,
  "RADIUS_CODE_ACCOUNTING_REQUEST is 4",
);

assert(
  RADIUS_ACCT_STATUS_TYPE_START === 1,
  "RADIUS_ACCT_STATUS_TYPE_START is 1",
);

assert(
  RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE === 16,
  "RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE is 16",
);

// ====================================================================
// 2. Authenticator
// ====================================================================
console.log("\n--- 2. Authenticator ---");

const generatedAuth = generateRequestAuthenticator();
assert(
  generatedAuth.length === RADIUS_AUTHENTICATOR_SIZE,
  "generateRequestAuthenticator returns 16-byte Buffer",
);

const twoAuths = [generateRequestAuthenticator(), generateRequestAuthenticator()];
assert(
  twoAuths[0].toString("hex") !== twoAuths[1].toString("hex"),
  "generateRequestAuthenticator produces unique values",
);

const requestAuth = generateRequestAuthenticator();
const testPassword = "hello123";
const encodedPassword = encodeUserPassword(testPassword, SECRET, requestAuth);
assert(
  Buffer.isBuffer(encodedPassword) && encodedPassword.length > 0,
  "encodeUserPassword returns a Buffer",
);

const decodedPassword = decodeUserPassword(encodedPassword, SECRET, requestAuth);
assert(
  decodedPassword === testPassword,
  "decodeUserPassword reverses encodeUserPassword",
);

const shortPassword = "ab";
const encodedShort = encodeUserPassword(shortPassword, SECRET, requestAuth);
const decodedShort = decodeUserPassword(encodedShort, SECRET, requestAuth);
assert(
  decodedShort === shortPassword,
  "encode/decode handles short password with padding",
);

const longPassword = "a".repeat(100);
const encodedLong = encodeUserPassword(longPassword, SECRET, requestAuth);
const decodedLong = decodeUserPassword(encodedLong, SECRET, requestAuth);
assert(
  decodedLong === longPassword,
  "encode/decode handles long password (>16 bytes) with multiple blocks",
);

assertThrows(
  () => encodeUserPassword(null, SECRET, requestAuth),
  "RadiusPasswordHidingError",
  "encodeUserPassword rejects null password",
);

assertThrows(
  () => encodeUserPassword("test", null, requestAuth),
  "RadiusPasswordHidingError",
  "encodeUserPassword rejects null secret",
);

assertThrows(
  () => decodeUserPassword(Buffer.alloc(3), SECRET, requestAuth),
  "RadiusPasswordHidingError",
  "decodeUserPassword rejects invalid length",
);

const wrongSecretAuth = generateRequestAuthenticator();
const encodedForWrongTest = encodeUserPassword("secret123", SECRET, wrongSecretAuth);
const decodedWrong = decodeUserPassword(encodedForWrongTest, "wrongSecret", wrongSecretAuth);
assert(
  decodedWrong !== "secret123",
  "decodeUserPassword with wrong secret produces different result",
);

const reqAuth = generateRequestAuthenticator();
const packetBuf = encodePacket({
  code: RADIUS_CODE_ACCESS_REQUEST,
  identifier: 42,
  authenticator: reqAuth,
  attributes: [
    { type: 1, value: "testuser" },
  ],
});

assert(Buffer.isBuffer(packetBuf), "encodePacket returns Buffer");
assert(packetBuf.length === RADIUS_PACKET_HEADER_SIZE + 10, "encodePacket header + attribute is correct size");

const packetBuf2 = encodePacket({
  code: RADIUS_CODE_ACCESS_REQUEST,
  identifier: 42,
  authenticator: reqAuth,
  attributes: [],
});
assert(
  packetBuf2.length === RADIUS_PACKET_HEADER_SIZE,
  "encodePacket with no attributes is just header",
);

assertThrows(
  () => encodePacket({ code: 0, identifier: 1, authenticator: reqAuth, attributes: [] }),
  "RadiusPacketError",
  "encodePacket rejects code 0",
);

assertThrows(
  () => encodePacket({ code: RADIUS_CODE_ACCESS_REQUEST, identifier: -1, authenticator: reqAuth, attributes: [] }),
  "RadiusPacketError",
  "encodePacket rejects negative identifier",
);

assertThrows(
  () => encodePacket({ code: RADIUS_CODE_ACCESS_REQUEST, identifier: 1, authenticator: Buffer.alloc(10), attributes: [] }),
  "RadiusPacketError",
  "encodePacket rejects wrong authenticator size",
);

const largeValue = "x".repeat(300);
try {
  encodePacket({
    code: RADIUS_CODE_ACCESS_REQUEST,
    identifier: 1,
    authenticator: reqAuth,
    attributes: [{ type: 1, value: largeValue }],
  });
  failed++;
  console.error("FAIL: encodePacket should reject oversized attribute value");
} catch (err) {
  passed++;
}

const decodedPacket = decodePacket(packetBuf);
assert(decodedPacket.code === RADIUS_CODE_ACCESS_REQUEST, "decodePacket returns correct code");
assert(decodedPacket.identifier === 42, "decodePacket returns correct identifier");
assert(decodedPacket.authenticator.equals(reqAuth), "decodePacket returns correct authenticator");
assert(decodedPacket.attributes.length === 1, "decodePacket returns correct attribute count");
assert(decodedPacket.attributes[0].decoded === "testuser", "decodePacket decodes User-Name attribute");

const roundTripBuf = encodePacket({
  code: RADIUS_CODE_ACCESS_ACCEPT,
  identifier: 7,
  authenticator: generateRequestAuthenticator(),
  attributes: [
    { type: 1, value: "user1" },
    { type:27, value: 3600 },
    { type: 11, value: "acl-roaming-tier" },
  ],
});

const roundTrip = decodePacket(roundTripBuf);
assert(roundTrip.code === RADIUS_CODE_ACCESS_ACCEPT, "Round-trip: code preserved");
assert(roundTrip.identifier === 7, "Round-trip: identifier preserved");
assert(roundTrip.attributes.length === 3, "Round-trip: 3 attributes preserved");
assert(roundTrip.attributes[0].decoded === "user1", "Round-trip: User-Name decoded");
assert(roundTrip.attributes[1].decoded === 3600, "Round-trip: Session-Timeout decoded as integer");
assert(roundTrip.attributes[2].decoded === "acl-roaming-tier", "Round-trip: Filter-Id decoded as string");

assertThrows(
  () => decodePacket(Buffer.alloc(10)),
  "RadiusPacketError",
  "decodePacket rejects packet shorter than header",
);

assertThrows(
  () => decodePacket(Buffer.alloc(20)),
  "RadiusPacketError",
  "decodePacket rejects packet with length field < header size",
);

// ====================================================================
// 3. Attribute encoding/decoding
// ====================================================================
console.log("\n--- 3. Attributes ---");

const ipBuf = encodeAttribute(3, "10.0.0.1");
assert(Buffer.isBuffer(ipBuf), "encodeAttribute for IP returns Buffer");
assert(ipBuf.length === 6, "encodeAttribute IP is 6 bytes (type+len+4)");
const ipDecoded = decodeAttribute(ipBuf);
assert(ipDecoded.decoded === "10.0.0.1", "decodeAttribute IP returns correct string");

const intBuf = encodeAttribute(27, 7200);
assert(Buffer.isBuffer(intBuf), "encodeAttribute for integer returns Buffer");
assert(intBuf.length === 6, "encodeAttribute integer is 6 bytes (type+len+4)");
const intDecoded = decodeAttribute(intBuf);
assert(intDecoded.decoded === 7200, "decodeAttribute integer returns correct value");

const strBuf = encodeAttribute(32, "yabalink-hotspot-abc123");
assert(Buffer.isBuffer(strBuf), "encodeAttribute for string returns Buffer");
const strDecoded = decodeAttribute(strBuf);
assert(strDecoded.decoded === "yabalink-hotspot-abc123", "decodeAttribute string returns correct value");

assertThrows(
  () => encodeAttribute(0, "test"),
  "RadiusAttributeError",
  "encodeAttribute rejects type 0",
);

assertThrows(
  () => encodeAttribute(256, "test"),
  "RadiusAttributeError",
  "encodeAttribute rejects type > 255",
);

// ====================================================================
// 4. Access Request packet builder
// ====================================================================
console.log("\n--- 4. Access Request Builder ---");

const accessReq = buildAccessRequestPacket({
  userName: "roaming:user123",
  userPassword: "mypassword",
  secret: SECRET,
  nasIdentifier: "yabalink-hotspot-abc123",
  nasIpAddress: "192.168.1.1",
  calledStationId: "YabaLink-Roaming",
  callingStationId: "00-11-22-33-44-55",
  classAttribute: JSON.stringify({
    entitlementId: "ent-abc",
    sessionId: "sess-001",
    remainingMinutes: 250,
  }),
});

assert(Buffer.isBuffer(accessReq.packet), "buildAccessRequestPacket returns Buffer packet");
assert(accessReq.identifier >= 0 && accessReq.identifier <= 255, "Access request identifier is valid");
assert(accessReq.requestAuthenticator.length === RADIUS_AUTHENTICATOR_SIZE, "Access request authenticator is 16 bytes");

const decodedAccessReq = decodeRadiusPacket(accessReq.packet);
assert(decodedAccessReq.code === RADIUS_CODE_ACCESS_REQUEST, "Access request code is correct");
assert(decodedAccessReq.attributes.find((a) => a.name === "User-Name").value === "roaming:user123", "Access request User-Name correct");
assert(decodedAccessReq.attributes.find((a) => a.name === "NAS-Identifier").value === "yabalink-hotspot-abc123", "Access request NAS-Identifier correct");
assert(decodedAccessReq.attributes.find((a) => a.name === "Called-Station-Id").value === "YabaLink-Roaming", "Access request Called-Station-Id correct");

const userPasswordAttr = decodedAccessReq.attributes.find((a) => a.name === "User-Password");
assert(Buffer.isBuffer(userPasswordAttr.raw), "User-Password is encoded as Buffer");
assert(userPasswordAttr.raw.length % 16 === 0, "User-Password encoded length is multiple of 16");

const accessReqNoPassword = buildAccessRequestPacket({
  userName: "jti-only",
  secret: SECRET,
  nasIdentifier: "yabalink-hotspot-xyz",
  classAttribute: JSON.stringify({ entitlementId: "ent-456" }),
});

assert(Buffer.isBuffer(accessReqNoPassword.packet), "Access request without password builds successfully");
assert(
  !accessReqNoPassword.attributes || accessReqNoPassword.packet.length > 0,
  "Access request without password has valid packet",
);

const decodedNoPwd = decodeRadiusPacket(accessReqNoPassword.packet);
assert(!decodedNoPwd.attributes.find((a) => a.name === "User-Password"), "Access request without password has no User-Password attribute");

assertThrows(
  () => buildAccessRequestPacket({ userName: null, secret: SECRET }),
  "RadiusPacketLayerError",
  "buildAccessRequestPacket rejects null userName",
);

assertThrows(
  () => buildAccessRequestPacket({ userName: "test", secret: null }),
  "RadiusPacketLayerError",
  "buildAccessRequestPacket rejects null secret",
);

// ====================================================================
// 5. Accounting packet builder
// ====================================================================
console.log("\n--- 5. Accounting Request Builder ---");

const acctStart = buildAccountingRequestPacket({
  userName: "roaming:user123",
  secret: SECRET,
  nasIdentifier: "yabalink-hotspot-abc123",
  nasIpAddress: "192.168.1.1",
  acctSessionId: "acct-sess-001",
  acctStatusType: RADIUS_ACCT_STATUS_TYPE_START,
  calledStationId: "YabaLink-Roaming",
  callingStationId: "00-11-22-33-44-55",
  classAttribute: JSON.stringify({
    entitlementId: "ent-abc",
    remainingMinutes: 250,
  }),
});

assert(Buffer.isBuffer(acctStart.packet), "buildAccountingRequestPacket returns Buffer");
const decodedAcctStart = decodeRadiusPacket(acctStart.packet);
assert(decodedAcctStart.code === RADIUS_CODE_ACCOUNTING_REQUEST, "Accounting Start code correct");

const acctStop = buildAccountingRequestPacket({
  userName: "roaming:user123",
  secret: SECRET,
  nasIdentifier: "yabalink-hotspot-abc123",
  acctSessionId: "acct-sess-001",
  acctStatusType: RADIUS_ACCT_STATUS_TYPE_STOP,
  acctSessionTime: 3600,
  acctInputOctets: 1048576,
  acctOutputOctets: 2097152,
  acctInputPackets: 1500,
  acctOutputPackets: 2000,
  acctTerminateCause: 6,
});

const decodedAcctStop = decodeRadiusPacket(acctStop.packet);
assert(decodedAcctStop.code === RADIUS_CODE_ACCOUNTING_REQUEST, "Accounting Stop code correct");
const statusType = decodedAcctStop.attributes.find((a) => a.name === "Acct-Status-Type");
assert(statusType && statusType.value === RADIUS_ACCT_STATUS_TYPE_STOP, "Accounting Stop has correct status type");

assertThrows(
  () => buildAccountingRequestPacket({ userName: null, secret: SECRET }),
  "RadiusPacketLayerError",
  "buildAccountingRequestPacket rejects missing userName and acctSessionId",
);

// ====================================================================
// 6. Accounting normalization
// ====================================================================
console.log("\n--- 6. Accounting Normalization ---");

const classPayload = JSON.stringify({
  sessionId: "sess-001",
  entitlementId: "ent-abc123",
  homeOwnerId: "owner-home-1",
  visitedOwnerId: "owner-visited-1",
  remainingMinutes: 120,
  maxMinutes: 250,
  sessionSeq: 42,
});

const acctStartNormalized = normalizeAccountingPacket({
  code: RADIUS_CODE_ACCOUNTING_REQUEST,
  attributes: [
    { type: 40, name: "Acct-Status-Type", decoded: RADIUS_ACCT_STATUS_TYPE_START },
    { type: 44, name: "Acct-Session-Id", decoded: "acct-sess-001" },
    { type: 1, name: "User-Name", decoded: "roaming:user123" },
    { type: 32, name: "NAS-Identifier", decoded: "yabalink-hotspot-abc123" },
    { type: 3, name: "NAS-IP-Address", decoded: "10.0.0.1" },
    { type: 25, name: "Class", decoded: classPayload },
  ],
});

assert(acctStartNormalized.valid === true, "Start accounting normalized as valid");
assert(acctStartNormalized.event === "start", "Start accounting has 'start' event");
assert(acctStartNormalized.sessionId === "acct-sess-001", "Start accounting sessionId from Acct-Session-Id");
assert(acctStartNormalized.userName === "roaming:user123", "Start accounting userName correct");

const acctInterimNormalized = normalizeAccountingPacket({
  code: RADIUS_CODE_ACCOUNTING_REQUEST,
  attributes: [
    { type: 40, name: "Acct-Status-Type", decoded: RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE },
    { type: 44, name: "Acct-Session-Id", decoded: "acct-sess-001" },
    { type: 1, name: "User-Name", decoded: "roaming:user123" },
    { type: 46, name: "Acct-Session-Time", decoded: 3600 },
    { type: 42, name: "Acct-Input-Octets", decoded: 5242880 },
    { type: 43, name: "Acct-Output-Octets", decoded: 10485760 },
    { type: 47, name: "Acct-Input-Packets", decoded: 5000 },
    { type: 48, name: "Acct-Output-Packets", decoded: 8000 },
    { type: 25, name: "Class", decoded: classPayload },
  ],
});

assert(acctInterimNormalized.valid === true, "Interim accounting normalized as valid");
assert(acctInterimNormalized.event === "interim", "Interim accounting has 'interim' event");
assert(acctInterimNormalized.usage.inputOctets === 5242880, "Interim accounting inputOctets correct");
assert(acctInterimNormalized.usage.outputOctets === 10485760, "Interim accounting outputOctets correct");
assert(
  acctInterimNormalized.usage.totalBytes === 15728640,
  "Interim accounting totalBytes = input + output",
);
assert(
  Math.round(acctInterimNormalized.usage.totalMegabytes * 100) / 100 ===
    Math.round((15728640 / (1024 * 1024)) * 100) / 100,
  "Interim accounting totalMegabytes correct",
);
assert(acctInterimNormalized.session.sessionTimeSeconds === 3600, "Interim accounting sessionTime correct");
assert(
  acctInterimNormalized.session.sessionMinutes === 60,
  "Interim accounting sessionMinutes = 3600/60 = 60",
);

const acctStopNormalized = normalizeAccountingPacket({
  code: RADIUS_CODE_ACCOUNTING_REQUEST,
  attributes: [
    { type: 40, name: "Acct-Status-Type", decoded: RADIUS_ACCT_STATUS_TYPE_STOP },
    { type: 44, name: "Acct-Session-Id", decoded: "acct-sess-001" },
    { type: 1, name: "User-Name", decoded: "roaming:user123" },
    { type: 46, name: "Acct-Session-Time", decoded: 5400 },
    { type: 42, name: "Acct-Input-Octets", decoded: 1048576 },
    { type: 43, name: "Acct-Output-Octets", decoded: 2097152 },
    { type: 49, name: "Acct-Terminate-Cause", decoded: 6 },
    { type: 25, name: "Class", decoded: classPayload },
  ],
});

assert(acctStopNormalized.valid === true, "Stop accounting normalized as valid");
assert(acctStopNormalized.event === "stop", "Stop accounting has 'stop' event");
assert(acctStopNormalized.terminateCause.code === 6, "Stop accounting terminateCause code correct");
assert(acctStopNormalized.terminateCause.text === "Session-Timeout", "Stop accounting terminateCause text correct");

const usageFromStop = normalizeUsageForSession(acctStopNormalized);
assert(usageFromStop.usedMinutes === 90, "normalizeUsageForSession: usedMinutes = 5400/60 = 90");
assert(usageFromStop.usedMegabytes > 0, "normalizeUsageForSession: usedMegabytes > 0");

const sessionUpdate = mapAccountingToSessionUpdate(acctStopNormalized, {
  usedMinutes: 30,
  usedMegabytes: 50,
});
assert(typeof sessionUpdate.lastActivityAt === "string", "Session update has lastActivityAt");
assert(sessionUpdate.usedMinutes === 120, "Session update accumulates usedMinutes: 30 + 90 = 120");
assert(sessionUpdate.usedMegabytes > 50, "Session update accumulates usedMegabytes: 50 + new data");

const classMetadata = extractEntitlementId(normalizeAccountingPacket({
  code: RADIUS_CODE_ACCOUNTING_REQUEST,
  attributes: [
    { type: 40, name: "Acct-Status-Type", decoded: RADIUS_ACCT_STATUS_TYPE_START },
    { type: 44, name: "Acct-Session-Id", decoded: "acct-sess-001" },
    { type: 1, name: "User-Name", decoded: "user" },
    { type: 25, name: "Class", decoded: classPayload },
  ],
}).classMetadata);
assert(classMetadata === "ent-abc123", "extractEntitlementId from Class attribute");

// ====================================================================
// 7. Accounting event helpers
// ====================================================================
console.log("\n--- 7. Accounting Event Helpers ---");

assert(isAccountingStart(acctStartNormalized) === true, "isAccountingStart returns true for start");
assert(isAccountingStop(acctStopNormalized) === true, "isAccountingStop returns true for stop");
assert(isAccountingInterim(acctInterimNormalized) === true, "isAccountingInterim returns true for interim");
assert(isAccountingStart(acctStopNormalized) === false, "isAccountingStart returns false for stop");

assert(shouldTriggerRauBilling(acctInterimNormalized) === true, "shouldTriggerRauBilling returns true for interim");
assert(shouldTriggerRauBilling(acctStopNormalized) === true, "shouldTriggerRauBilling returns true for stop");
assert(shouldTriggerRauBilling(acctStartNormalized) === false, "shouldTriggerRauBilling returns false for start");

const seq = extractSessionSequence(classPayload ? normalizeAccountingPacket({
  code: RADIUS_CODE_ACCOUNTING_REQUEST,
  attributes: [
    { type: 40, name: "Acct-Status-Type", decoded: RADIUS_ACCT_STATUS_TYPE_START },
    { type: 44, name: "Acct-Session-Id", decoded: "acct-sess-001" },
    { type: 1, name: "User-Name", decoded: "user" },
    { type: 25, name: "Class", decoded: classPayload },
  ],
}).classMetadata : null);
assert(seq === 42, "extractSessionSequence from Class metadata");

const extractedHome = extractHomeOwnerId(normalizeAccountingPacket({
  code: RADIUS_CODE_ACCOUNTING_REQUEST,
  attributes: [
    { type: 40, name: "Acct-Status-Type", decoded: RADIUS_ACCT_STATUS_TYPE_START },
    { type: 44, name: "Acct-Session-Id", decoded: "sess-1" },
    { type: 1, name: "User-Name", decoded: "u" },
    { type: 25, name: "Class", decoded: classPayload },
  ],
}).classMetadata);
assert(extractedHome === "owner-home-1", "extractHomeOwnerId from Class metadata");

const extractedVisited = extractVisitedOwnerId(normalizeAccountingPacket({
  code: RADIUS_CODE_ACCOUNTING_REQUEST,
  attributes: [
    { type: 40, name: "Acct-Status-Type", decoded: RADIUS_ACCT_STATUS_TYPE_START },
    { type: 44, name: "Acct-Session-Id", decoded: "sess-1" },
    { type: 1, name: "User-Name", decoded: "u" },
    { type: 25, name: "Class", decoded: classPayload },
  ],
}).classMetadata);
assert(extractedVisited === "owner-visited-1", "extractVisitedOwnerId from Class metadata");

const extractedQuota = extractQuotaInfo(normalizeAccountingPacket({
  code: RADIUS_CODE_ACCOUNTING_REQUEST,
  attributes: [
    { type: 40, name: "Acct-Status-Type", decoded: RADIUS_ACCT_STATUS_TYPE_START },
    { type: 44, name: "Acct-Session-Id", decoded: "sess-1" },
    { type: 1, name: "User-Name", decoded: "u" },
    { type: 25, name: "Class", decoded: classPayload },
  ],
}).classMetadata);
assert(extractedQuota.remainingMinutes === 120, "extractQuotaInfo: remainingMinutes correct");
assert(extractedQuota.maxMinutes === 250, "extractQuotaInfo: maxMinutes correct");

// ====================================================================
// 8. Class attribute helpers
// ====================================================================
console.log("\n--- 8. Class Attribute Helpers ---");

const classData = {
  entitlementId: "ent-xyz",
  sessionId: "sess-yyy",
  sessionSeq: 1,
};
const encodedClass = buildClassAttribute(classData);
assert(encodedClass === JSON.stringify(classData), "buildClassAttribute produces JSON string");

const parsedClass = parseClassAttribute(encodedClass);
assert(parsedClass.entitlementId === "ent-xyz", "parseClassAttribute decodes JSON correctly");

const kvClass = parseClassAttribute("entitlementId:ent-123,sessionId:sess-456");
assert(kvClass && kvClass.entitlementId === "ent-123", "parseClassAttribute handles key:value format");

const parsedNull = parseClassAttribute(null);
assert(parsedNull === null, "parseClassAttribute returns null for null input");

// ====================================================================
// 9. No live networking
// ====================================================================
console.log("\n--- 9. No Live Networking ---");

const fs = require("fs");
const path = require("path");
const radiusDir = path.resolve(__dirname, "../services/radius");
const files = fs.readdirSync(radiusDir);
let noNetworkImports = true;
for (const f of files) {
  const content = fs.readFileSync(path.join(radiusDir, f), "utf8");
  if (content.includes("require('dgram')") || content.includes('require("dgram")')) {
    noNetworkImports = false;
    console.error(`FAIL: dgram import found in ${f}`);
    failed++;
  }
  if (content.includes("require('net')") || content.includes('require("net")')) {
    noNetworkImports = false;
    console.error(`FAIL: net import found in ${f}`);
    failed++;
  }
  if (content.includes("require('radius')") || content.includes('require("radius")')) {
    noNetworkImports = false;
    console.error(`FAIL: radius library import found in ${f}`);
    failed++;
  }
}
if (noNetworkImports) {
  console.log("PASS: No dgram, net, or radius library imports in radius module");
  passed++;
}

// ====================================================================
// 10. Integration: password encode/decode in packet round-trip
// ====================================================================
console.log("\n--- 10. Integration: Password in Packet ---");

const sessionPassword = "superSecret123";
const accessPacket = buildAccessRequestPacket({
  userName: "roaming:user456",
  userPassword: sessionPassword,
  secret: SECRET,
  nasIdentifier: "nas-test-456",
});

const decodedPwdPacket = decodeRadiusPacket(accessPacket.packet);
const pwdAttr = decodedPwdPacket.attributes.find((a) => a.name === "User-Password");
assert(Buffer.isBuffer(pwdAttr.raw), "User-Password attribute is a Buffer");
assert(pwdAttr.raw.length % 16 === 0, "Encrypted User-Password is padded to 16-byte boundary");

const recovered = decodeUserPassword(pwdAttr.raw, SECRET, accessPacket.requestAuthenticator);
assert(recovered === sessionPassword, "Password recovered from packet via request authenticator");

// ====================================================================
// 11. Large attribute handling
// ====================================================================
console.log("\n--- 11. Large Packet Handling ---");

const attrs = [];
for (let i = 0; i < 100; i++) {
  attrs.push({ type: 1, value: `user${i}:session${i}:entitlement${i}` });
}
try {
  buildAccessRequestPacket({
    userName: "bulk:test",
    secret: SECRET,
    nasIdentifier: "nas-bulk",
  });
  const bulkPacket = encodePacket({
    code: RADIUS_CODE_ACCOUNTING_REQUEST,
    identifier: 1,
    authenticator: generateRequestAuthenticator(),
    attributes: attrs,
  });
  assert(Buffer.isBuffer(bulkPacket), "Large packet encodes successfully");
  const decodedBulk = decodePacket(bulkPacket);
  assert(decodedBulk.attributes.length === 100, "Large packet decodes all 100 attributes");
  passed++;
} catch (e) {
  console.error(`FAIL: Large packet handling: ${e.message}`);
  failed++;
}

// ====================================================================
// Summary
// ====================================================================
console.log("\n========================================");
console.log(`Phase 8.2B Results: ${passed} passed, ${failed} failed`);
console.log("========================================");

if (failed > 0) {
  process.exit(1);
}
