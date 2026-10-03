const constants = require("./constants");
const {
  encodeUserPassword,
  decodeUserPassword,
  encodeTunnelPassword,
  decodeTunnelPassword,
} = require("./passwordHiding");
const {
  computeRequestAuthenticator,
  computeResponseAuthenticator,
  generateRequestAuthenticator,
  validateRequestAuthenticator,
  validateResponseAuthenticator,
} = require("./authenticator");
const {
  encodeAttribute,
  decodeAttribute,
  encodeAttributes,
  decodeAttributes,
  encodeVendorSpecific,
  decodeVendorSpecific,
  findAttribute,
  findAttributeValue,
  getAllAttributeValues,
} = require("./attributes");
const {
  encodePacket,
  decodePacket,
  createAccessRequest,
  createAccountingRequest,
  decodeAccessAccept,
  decodeAccountingRequest,
  RadiusPacket,
  RadiusPacketError,
} = require("./packet");
const accounting = require("./accounting");

const RADIUS_PROTOCOL_VERSION = "2.0";
const RADIUS_PROTOCOL_RFC = "RFC 2865, RFC 2866, RFC 2869, RFC 3576, RFC 5176";

class RadiusPacketLayerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RadiusPacketLayerError";
    this.code = code;
    this.details = details;
  }
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;

function buildAccessRequestPacket(opts) {
  const {
    userName,
    userPassword,
    secret,
    nasIdentifier,
    nasIpAddress,
    calledStationId,
    callingStationId,
    classAttribute,
    state,
    vendorSpecific,
    identifier,
  } = opts;

  if (!userName || typeof userName !== "string") {
    throw new RadiusPacketLayerError(
      "VALIDATION_ERROR",
      "userName is required for Access-Request",
    );
  }

  if (!secret || typeof secret !== "string") {
    throw new RadiusPacketLayerError(
      "VALIDATION_ERROR",
      "shared secret is required for Access-Request",
    );
  }

  const reqId = identifier !== undefined ? identifier : Math.floor(Math.random() * 256);

  if (userPassword && typeof userPassword === "string") {
    const requestAuth = generateRequestAuthenticator();
    const encodedPassword = encodeUserPassword(userPassword, secret, requestAuth);
    return {
      packet: createAccessRequest({
        identifier: reqId,
        requestAuthenticator: requestAuth,
        userName,
        userPassword: encodedPassword.toString("binary"),
        nasIdentifier,
        nasIpAddress,
        calledStationId,
        callingStationId,
        classAttribute,
        state,
        vendorSpecific,
      }),
      requestAuthenticator: requestAuth,
      identifier: reqId,
    };
  }

  const requestAuth = generateRequestAuthenticator();
  return {
    packet: createAccessRequest({
      identifier: reqId,
      requestAuthenticator: requestAuth,
      userName,
      nasIdentifier,
      nasIpAddress,
      calledStationId,
      callingStationId,
      classAttribute,
      state,
      vendorSpecific,
    }),
    requestAuthenticator: requestAuth,
    identifier: reqId,
  };
}

function buildAccountingRequestPacket(opts) {
  const {
    userName,
    secret,
    nasIdentifier,
    nasIpAddress,
    calledStationId,
    callingStationId,
    acctSessionId,
    acctStatusType,
    acctSessionTime,
    acctInputOctets,
    acctOutputOctets,
    acctInputPackets,
    acctOutputPackets,
    acctTerminateCause,
    classAttribute,
    state,
    framedIpAddress,
    identifier,
  } = opts;

  if (!userName && !acctSessionId) {
    throw new RadiusPacketLayerError(
      "VALIDATION_ERROR",
      "userName or acctSessionId is required for Accounting-Request",
    );
  }

  if (!secret || typeof secret !== "string") {
    throw new RadiusPacketLayerError(
      "VALIDATION_ERROR",
      "shared secret is required for Accounting-Request",
    );
  }

  const reqId = identifier !== undefined ? identifier : Math.floor(Math.random() * 256);
  const requestAuth = generateRequestAuthenticator();

  const packet = createAccountingRequest({
    identifier: reqId,
    requestAuthenticator: requestAuth,
    userName,
    nasIpAddress,
    nasIdentifier,
    acctSessionId,
    acctStatusType,
    acctSessionTime,
    acctInputOctets,
    acctOutputOctets,
    acctInputPackets,
    acctOutputPackets,
    acctTerminateCause,
    calledStationId,
    callingStationId,
    classAttribute,
    state,
    framedIpAddress,
  });

  return {
    packet,
    requestAuthenticator: requestAuth,
    identifier: reqId,
  };
}

function decodeRadiusPacket(buf, secret) {
  const packet = decodePacket(buf);

  return {
    raw: packet,
    code: packet.code,
    codeName: packet.codeName,
    identifier: packet.identifier,
    authenticator: packet.authenticator,
    attributes: packet.attributes.map((a) => ({
      type: a.type,
      name: a.name,
      value: typeof a.decoded !== "undefined" ? a.decoded : a.value,
      raw: a.raw,
    })),
  };
}

function validatePacketIntegrity(packet, secret) {
  if (!secret || typeof secret !== "string") {
    throw new RadiusPacketLayerError(
      "VALIDATION_ERROR",
      "Shared secret is required for integrity validation",
    );
  }

  if (packet.code === constants.RADIUS_CODE_ACCESS_ACCEPT) {
    const requestAuth = packet.authenticator;
    if (!requestAuth || requestAuth.length !== constants.RADIUS_AUTHENTICATOR_SIZE) {
      return { valid: false, reason: "MISSING_REQUEST_AUTHENTICATOR" };
    }

    return {
      valid: true,
      validated: true,
    };
  }

  return {
    valid: true,
    validated: false,
    reason: "No response authenticator validation needed",
  };
}

function buildClassAttribute(data) {
  if (!data || typeof data !== "object") {
    return null;
  }
  return JSON.stringify(data);
}

function parseClassAttribute(classValue) {
  if (!classValue || typeof classValue !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(classValue);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
  } catch (e) {
    const parts = classValue.split(",");
    const result = {};
    for (const part of parts) {
      const idx = part.indexOf(":");
      if (idx > 0) {
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        result[key] = val;
      }
    }
    if (Object.keys(result).length > 0) {
      return result;
    }
  }

  return { raw: classValue };
}

function normalizeAccountingData(packet) {
  const decoded = decodeRadiusPacket(packet);
  return accounting.normalizeAccountingPacket({
    code: decoded.code,
    codeName: decoded.codeName,
    identifier: decoded.identifier,
    authenticator: decoded.authenticator,
    attributes: decoded.raw.attributes,
  });
}

async function normalizeAccountingForSession(normalizedAccounting, existingSession) {
  return accounting.mapAccountingToSessionUpdate(normalizedAccounting, existingSession);
}

function convertUsageToSessionFields(normalizedAccounting) {
  return accounting.normalizeUsageForSession(normalizedAccounting);
}

module.exports = {
  RadiusPacketLayerError,
  RADIUS_PROTOCOL_VERSION,
  RADIUS_PROTOCOL_RFC,
  MS_PER_SECOND,
  SECONDS_PER_MINUTE,
  MS_PER_MINUTE,

  ...constants,
  ...require("./passwordHiding"),
  ...require("./authenticator"),
  ...require("./attributes"),

  encodePacket,
  decodePacket,
  createAccessRequest,
  createAccountingRequest,
  decodeAccessAccept,
  decodeAccountingRequest,
  RadiusPacket,
  RadiusPacketError,

  buildAccessRequestPacket,
  buildAccountingRequestPacket,
  decodeRadiusPacket,
  validatePacketIntegrity,
  buildClassAttribute,
  parseClassAttribute,
  normalizeAccountingData,
  normalizeAccountingForSession,
  convertUsageToSessionFields,

  normalizeAccountingPacket: accounting.normalizeAccountingPacket,
  normalizeUsageForSession: accounting.normalizeUsageForSession,
  mapAccountingToSessionUpdate: accounting.mapAccountingToSessionUpdate,
  isAccountingStart: accounting.isAccountingStart,
  isAccountingStop: accounting.isAccountingStop,
  isAccountingInterim: accounting.isAccountingInterim,
  isAccountingAbort: accounting.isAccountingAbort,
  shouldTriggerRauBilling: accounting.shouldTriggerRauBilling,
  extractEntitlementId: accounting.extractEntitlementId,
  extractSessionSequence: accounting.extractSessionSequence,
  extractHomeOwnerId: accounting.extractHomeOwnerId,
  extractVisitedOwnerId: accounting.extractVisitedOwnerId,
  extractQuotaInfo: accounting.extractQuotaInfo,
  RADIUS_ACCOUNTING_FIELDS: accounting.RADIUS_ACCOUNTING_FIELDS,
  ACCT_EVENT_START: accounting.ACCT_EVENT_START,
  ACCT_EVENT_INTERIM: accounting.ACCT_EVENT_INTERIM,
  ACCT_EVENT_STOP: accounting.ACCT_EVENT_STOP,
  ACCT_EVENT_ABORT: accounting.ACCT_EVENT_ABORT,
};
