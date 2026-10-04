const crypto = require("crypto");

const {
  buildAccessRequestPacket,
  buildAccountingRequestPacket,
  RADIUS_CODE_ACCESS_ACCEPT,
  RADIUS_CODE_ACCESS_REJECT,
  RADIUS_CODE_ACCOUNTING_RESPONSE,
  RADIUS_ACCT_STATUS_TYPE_START,
  RADIUS_ACCT_STATUS_TYPE_STOP,
  RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE,
} = require("../radius");

const { radiusError, RADIUS_ERROR_CODES, describeError } = require("./errors");
const { assertRadiusTransportEnabled } = require("./featureFlag");
const { assertProfileUsable, assertNoClientSuppliedConfig, NAS_IP_AUTO } = require("./profile");
const { assertSecretResolverUsable } = require("./secrets");
const { exchangeRADIUSPacket, defaultSocketFactory } = require("./transport");

const ACCESS_EXPECTED_CODES = Object.freeze([
  RADIUS_CODE_ACCESS_ACCEPT,
  RADIUS_CODE_ACCESS_REJECT,
]);
const ACCOUNTING_EXPECTED_CODES = Object.freeze([RADIUS_CODE_ACCOUNTING_RESPONSE]);

const SUPPORTED_ACCOUNTING_EVENTS = Object.freeze([
  RADIUS_ACCT_STATUS_TYPE_START,
  RADIUS_ACCT_STATUS_TYPE_INTERIM_UPDATE,
  RADIUS_ACCT_STATUS_TYPE_STOP,
]);

const UNSUPPORTED_OPERATIONS = Object.freeze([
  "coa",
  "coaRequest",
  "disconnect",
  "disconnectRequest",
]);

const inFlightIdentifiers = new Set();

function allocateIdentifier(profileId) {
  for (let attempt = 0; attempt < 256; attempt++) {
    const identifier = crypto.randomInt(0, 256);
    const key = `${profileId}:${identifier}`;
    if (!inFlightIdentifiers.has(key)) {
      inFlightIdentifiers.add(key);
      return { identifier, key };
    }
  }
  throw radiusError(
    RADIUS_ERROR_CODES.RADIUS_DUPLICATE_IN_FLIGHT,
    "No free RADIUS packet identifier is available for this profile",
    { profileId },
  );
}

function releaseIdentifier(key) {
  inFlightIdentifiers.delete(key);
}

function assertSupportedOperation(operation) {
  if (UNSUPPORTED_OPERATIONS.includes(operation)) {
    throw radiusError(
      RADIUS_ERROR_CODES.RADIUS_UNSUPPORTED_OPERATION,
      `RADIUS operation '${operation}' is not implemented in Phase 8.2C`,
      { operation, phase: "8.2C" },
    );
  }
}

function assertAccountingEventSupported(acctStatusType) {
  if (!SUPPORTED_ACCOUNTING_EVENTS.includes(acctStatusType)) {
    throw radiusError(
      RADIUS_ERROR_CODES.RADIUS_UNSUPPORTED_OPERATION,
      "Unsupported RADIUS accounting status type",
      { acctStatusType, supported: SUPPORTED_ACCOUNTING_EVENTS },
    );
  }
}

function createRadiusClient(options = {}) {
  const profileStore = options.profileStore;
  const secretResolver = options.secretResolver;
  const socketFactory = options.socketFactory || defaultSocketFactory;
  const testMode = options.testMode === true;

  assertSecretResolverUsable(secretResolver);

  if (!profileStore || typeof profileStore.getProfile !== "function") {
    throw radiusError(
      RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
      "A profileStore with getProfile() is required",
      { field: "profileStore" },
    );
  }

  async function resolveTrustedContext(args) {
    assertRadiusTransportEnabled({ testMode });
    assertNoClientSuppliedConfig(args);

    const profile = await profileStore.getProfile(args && args.profileId);
    assertProfileUsable(profile);

    const secret = await secretResolver.resolveSecret(profile.secretReference);

    return { profile, secret };
  }

  async function sendAccessRequest(args = {}) {
    assertSupportedOperation("accessRequest");

    const { profile, secret } = await resolveTrustedContext(args);

    const allocation = allocateIdentifier(profile.profileId);
    try {
      const built = buildAccessRequestPacket({
        userName: args.userName,
        userPassword: args.userPassword,
        secret,
        nasIdentifier: profile.nasIdentifier,
        nasIpAddress: profile.nasIpAddress === NAS_IP_AUTO ? undefined : profile.nasIpAddress,
        calledStationId: args.calledStationId,
        callingStationId: args.callingStationId,
        classAttribute: args.classAttribute,
        state: args.state,
        vendorSpecific: args.vendorSpecific,
        identifier: allocation.identifier,
      });

      const result = await exchangeRADIUSPacket({
        packet: built.packet,
        identifier: built.identifier,
        requestAuthenticator: built.requestAuthenticator,
        destinationHost: profile.serverHost,
        destinationPort: profile.authenticationPort,
        expectedCodes: ACCESS_EXPECTED_CODES,
        timeoutMs: profile.timeoutMs,
        retries: profile.retries,
        secret,
        socketFactory,
      });

      return Object.freeze({
        accepted: result.code === RADIUS_CODE_ACCESS_ACCEPT,
        code: result.code,
        codeName: result.codeName,
        identifier: result.identifier,
        profileId: profile.profileId,
        attributes: result.attributes,
        vendorSpecific: result.vendorSpecific,
        attempts: result.attempts,
        rttMs: result.rttMs,
        stats: result.stats,
      });
    } finally {
      releaseIdentifier(allocation.key);
    }
  }

  async function sendAccountingRequest(args = {}) {
    assertSupportedOperation("accountingRequest");
    assertAccountingEventSupported(args.acctStatusType);

    const { profile, secret } = await resolveTrustedContext(args);

    const allocation = allocateIdentifier(profile.profileId);
    try {
      const built = buildAccountingRequestPacket({
        userName: args.userName,
        secret,
        nasIdentifier: profile.nasIdentifier,
        nasIpAddress: profile.nasIpAddress === NAS_IP_AUTO ? undefined : profile.nasIpAddress,
        acctSessionId: args.acctSessionId,
        acctStatusType: args.acctStatusType,
        acctSessionTime: args.acctSessionTime,
        acctInputOctets: args.acctInputOctets,
        acctOutputOctets: args.acctOutputOctets,
        acctInputPackets: args.acctInputPackets,
        acctOutputPackets: args.acctOutputPackets,
        acctTerminateCause: args.acctTerminateCause,
        calledStationId: args.calledStationId,
        callingStationId: args.callingStationId,
        classAttribute: args.classAttribute,
        state: args.state,
        framedIpAddress: args.framedIpAddress,
        identifier: allocation.identifier,
      });

      const result = await exchangeRADIUSPacket({
        packet: built.packet,
        identifier: built.identifier,
        requestAuthenticator: built.requestAuthenticator,
        destinationHost: profile.accountingHost,
        destinationPort: profile.accountingPort,
        expectedCodes: ACCOUNTING_EXPECTED_CODES,
        timeoutMs: profile.timeoutMs,
        retries: profile.retries,
        secret,
        socketFactory,
      });

      return Object.freeze({
        acknowledged: true,
        event: args.acctStatusType,
        code: result.code,
        codeName: result.codeName,
        identifier: result.identifier,
        profileId: profile.profileId,
        attributes: result.attributes,
        attempts: result.attempts,
        rttMs: result.rttMs,
        stats: result.stats,
      });
    } finally {
      releaseIdentifier(allocation.key);
    }
  }

  return Object.freeze({
    sendAccessRequest,
    sendAccountingRequest,
    describeLastFailure(err) {
      return describeError(err);
    },
  });
}

module.exports = {
  createRadiusClient,
  allocateIdentifier,
  releaseIdentifier,
  assertSupportedOperation,
  assertAccountingEventSupported,
  ACCESS_EXPECTED_CODES,
  ACCOUNTING_EXPECTED_CODES,
  SUPPORTED_ACCOUNTING_EVENTS,
  UNSUPPORTED_OPERATIONS,
};