const {
  RADIUS_CODE_ACCESS_REQUEST,
  RADIUS_CODE_ACCOUNTING_REQUEST,
  RADIUS_PACKET_HEADER_SIZE,
  RADIUS_AUTHENTICATOR_SIZE,
  RADIUS_PACKET_MAX_SIZE,
  getCodeName,
} = require("./constants");

const { decodeAttributes, encodeAttributes } = require("./attributes");

class RadiusPacketError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RadiusPacketError";
    this.code = code;
    this.details = details;
  }
}

class RadiusPacket {
  constructor({ code, identifier, authenticator, attributes }) {
    this.code = code;
    this.identifier = identifier;
    this.authenticator = authenticator;
    this.attributes = attributes || [];
  }

  get codeName() {
    return getCodeName(this.code);
  }

  toJSON() {
    return {
      code: this.code,
      codeName: this.codeName,
      identifier: this.identifier,
      authenticator: this.authenticator ? this.authenticator.toString("hex") : null,
      attributes: this.attributes.map((a) => ({
        type: a.type,
        name: a.name,
        value: a.decoded !== undefined ? a.decoded : a.value,
      })),
    };
  }
}

function encodePacket({
  code,
  identifier,
  authenticator,
  attributes = [],
  secret,
}) {
  if (code < 1 || code > 255) {
    throw new RadiusPacketError(
      "INVALID_CODE",
      `Invalid RADIUS code: ${code}`,
    );
  }

  if (
    identifier < 0 ||
    identifier > 255 ||
    !Number.isInteger(identifier)
  ) {
    throw new RadiusPacketError(
      "INVALID_IDENTIFIER",
      `Invalid RADIUS identifier: ${identifier}`,
    );
  }

  if (!Buffer.isBuffer(authenticator)) {
    throw new RadiusPacketError(
      "INVALID_AUTHENTICATOR",
      "Authenticator must be a Buffer",
    );
  }

  if (authenticator.length !== RADIUS_AUTHENTICATOR_SIZE) {
    throw new RadiusPacketError(
      "INVALID_AUTHENTICATOR",
      `Authenticator must be exactly ${RADIUS_AUTHENTICATOR_SIZE} bytes, got ${authenticator.length}`,
    );
  }

  const attrBuf = encodeAttributes(attributes);

  const totalLength = RADIUS_PACKET_HEADER_SIZE + attrBuf.length;
  if (totalLength > RADIUS_PACKET_MAX_SIZE) {
    throw new RadiusPacketError(
      "PACKET_TOO_LARGE",
      `Encoded RADIUS packet size ${totalLength} exceeds maximum ${RADIUS_PACKET_MAX_SIZE}`,
    );
  }

  const header = Buffer.alloc(RADIUS_PACKET_HEADER_SIZE);
  header.writeUInt8(code, 0);
  header.writeUInt8(identifier, 1);
  header.writeUInt16BE(totalLength, 2);
  authenticator.copy(header, 4);

  return Buffer.concat([header, attrBuf]);
}

function decodePacket(buf) {
  if (!Buffer.isBuffer(buf)) {
    throw new RadiusPacketError(
      "INVALID_BUFFER",
      "Input must be a Buffer",
    );
  }

  if (buf.length < RADIUS_PACKET_HEADER_SIZE) {
    throw new RadiusPacketError(
      "PACKET_TOO_SHORT",
      `RADIUS packet too short: ${buf.length} bytes (minimum ${RADIUS_PACKET_HEADER_SIZE})`,
    );
  }

  if (buf.length > RADIUS_PACKET_MAX_SIZE) {
    throw new RadiusPacketError(
      "PACKET_TOO_LARGE",
      `RADIUS packet too large: ${buf.length} bytes (maximum ${RADIUS_PACKET_MAX_SIZE})`,
    );
  }

  const code = buf.readUInt8(0);
  const identifier = buf.readUInt8(1);
  const length = buf.readUInt16BE(2);

  if (length < RADIUS_PACKET_HEADER_SIZE) {
    throw new RadiusPacketError(
      "INVALID_LENGTH",
      `Packet length field (${length}) is less than minimum header size (${RADIUS_PACKET_HEADER_SIZE})`,
    );
  }

  if (length > buf.length) {
    throw new RadiusPacketError(
      "INCOMPLETE_PACKET",
      `Packet length field (${length}) exceeds available data (${buf.length})`,
    );
  }

  const authenticator = buf.slice(4, 4 + RADIUS_AUTHENTICATOR_SIZE);

  const attrBuf = buf.slice(RADIUS_PACKET_HEADER_SIZE, length);
  const attributes = decodeAttributes(attrBuf);

  return new RadiusPacket({
    code,
    identifier,
    authenticator,
    attributes,
  });
}

function createAccessRequest({
  identifier,
  requestAuthenticator,
  userName,
  userPassword,
  nasIdentifier,
  nasIpAddress,
  calledStationId,
  callingStationId,
  classAttribute,
  framedIpAddress,
  state,
  vendorSpecific,
}) {
  const attributes = [];

  if (userName) {
    attributes.push({ type: 1, name: "User-Name", value: userName });
  }

  if (userPassword && typeof userPassword === "string") {
    attributes.push({ type: 2, name: "User-Password", value: userPassword });
  }

  if (nasIpAddress) {
    attributes.push({
      type: 3,
      name: "NAS-IP-Address",
      value: nasIpAddress,
    });
  }

  if (calledStationId) {
    attributes.push({
      type: 30,
      name: "Called-Station-Id",
      value: calledStationId,
    });
  }

  if (callingStationId) {
    attributes.push({
      type: 31,
      name: "Calling-Station-Id",
      value: callingStationId,
    });
  }

  if (nasIdentifier) {
    attributes.push({
      type: 32,
      name: "NAS-Identifier",
      value: nasIdentifier,
    });
  }

  if (classAttribute) {
    attributes.push({
      type: 25,
      name: "Class",
      value: classAttribute,
    });
  }

  if (state) {
    attributes.push({
      type: 24,
      name: "State",
      value: state,
    });
  }

  if (vendorSpecific) {
    for (const vsa of vendorSpecific) {
      attributes.push({
        type: 26,
        name: "Vendor-Specific",
        vendorId: vsa.vendorId,
        vendorType: vsa.vendorType,
        value: vsa.value,
      });
    }
  }

  return encodePacket({
    code: RADIUS_CODE_ACCESS_REQUEST,
    identifier,
    authenticator: requestAuthenticator,
    attributes,
  });
}

function createAccountingRequest({
  identifier,
  requestAuthenticator,
  userName,
  nasIpAddress,
  nasIdentifier,
  acctSessionId,
  acctStatusType,
  acctInputOctets,
  acctOutputOctets,
  acctSessionTime,
  acctInputPackets,
  acctOutputPackets,
  acctTerminateCause,
  calledStationId,
  callingStationId,
  classAttribute,
  state,
  framedIpAddress,
}) {
  const attributes = [];

  if (userName) {
    attributes.push({ type: 1, name: "User-Name", value: userName });
  }

  if (nasIpAddress) {
    attributes.push({
      type: 3,
      name: "NAS-IP-Address",
      value: nasIpAddress,
    });
  }

  if (framedIpAddress) {
    attributes.push({
      type: 8,
      name: "Framed-IP-Address",
      value: framedIpAddress,
    });
  }

  if (calledStationId) {
    attributes.push({
      type: 30,
      name: "Called-Station-Id",
      value: calledStationId,
    });
  }

  if (callingStationId) {
    attributes.push({
      type: 31,
      name: "Calling-Station-Id",
      value: callingStationId,
    });
  }

  if (nasIdentifier) {
    attributes.push({
      type: 32,
      name: "NAS-Identifier",
      value: nasIdentifier,
    });
  }

  if (classAttribute) {
    attributes.push({
      type: 25,
      name: "Class",
      value: classAttribute,
    });
  }

  if (state) {
    attributes.push({
      type: 24,
      name: "State",
      value: state,
    });
  }

  if (acctSessionId) {
    attributes.push({
      type: 44,
      name: "Acct-Session-Id",
      value: acctSessionId,
    });
  }

  if (acctStatusType !== undefined && acctStatusType !== null) {
    attributes.push({
      type: 40,
      name: "Acct-Status-Type",
      value: acctStatusType,
    });
  }

  if (acctInputOctets !== undefined && acctInputOctets !== null) {
    attributes.push({
      type: 42,
      name: "Acct-Input-Octets",
      value: acctInputOctets,
    });
  }

  if (acctOutputOctets !== undefined && acctOutputOctets !== null) {
    attributes.push({
      type: 43,
      name: "Acct-Output-Octets",
      value: acctOutputOctets,
    });
  }

  if (acctSessionTime !== undefined && acctSessionTime !== null) {
    attributes.push({
      type: 46,
      name: "Acct-Session-Time",
      value: acctSessionTime,
    });
  }

  if (acctInputPackets !== undefined && acctInputPackets !== null) {
    attributes.push({
      type: 47,
      name: "Acct-Input-Packets",
      value: acctInputPackets,
    });
  }

  if (acctOutputPackets !== undefined && acctOutputPackets !== null) {
    attributes.push({
      type: 48,
      name: "Acct-Output-Packets",
      value: acctOutputPackets,
    });
  }

  if (acctTerminateCause !== undefined && acctTerminateCause !== null) {
    attributes.push({
      type: 49,
      name: "Acct-Terminate-Cause",
      value: acctTerminateCause,
    });
  }

  return encodePacket({
    code: RADIUS_CODE_ACCOUNTING_REQUEST,
    identifier,
    authenticator: requestAuthenticator,
    attributes,
  });
}

function decodeAccessAccept(packet) {
  const result = {
    code: packet.code,
    codeName: packet.codeName,
    identifier: packet.identifier,
    authenticator: packet.authenticator,
    attributes: {},
    vendorSpecific: [],
  };

  for (const attr of packet.attributes) {
    if (attr.type === 26) {
      result.vendorSpecific.push(attr.decoded);
    } else if (result.attributes[attr.name] === undefined) {
      result.attributes[attr.name] = attr.decoded;
    }
  }

  return result;
}

function decodeAccountingRequest(packet) {
  const result = {
    code: packet.code,
    codeName: packet.codeName,
    identifier: packet.identifier,
    authenticator: packet.authenticator,
    attributes: {},
    vendorSpecific: [],
  };

  for (const attr of packet.attributes) {
    if (attr.type === 26) {
      result.vendorSpecific.push(attr.decoded);
    } else if (result.attributes[attr.name] === undefined) {
      result.attributes[attr.name] = attr.decoded;
    }
  }

  return result;
}

module.exports = {
  RadiusPacketError,
  RadiusPacket,
  encodePacket,
  decodePacket,
  createAccessRequest,
  createAccountingRequest,
  decodeAccessAccept,
  decodeAccountingRequest,
};
