const crypto = require("crypto");
const {
  RADIUS_AUTHENTICATOR_SIZE,
  RADIUS_PACKET_HEADER_SIZE,
} = require("./constants");

class RadiusAuthenticatorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RadiusAuthenticatorError";
    this.code = code;
    this.details = details;
  }
}

function computeRequestAuthenticator(
  code,
  identifier,
  length,
  authenticator,
  attributes,
  secret,
) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new RadiusAuthenticatorError(
      "INVALID_SECRET",
      "Shared secret is required for authenticator calculation",
    );
  }

  const secretBuf = Buffer.from(secret, "utf8");

  const attrBuf =
    typeof attributes === "string"
      ? Buffer.from(attributes, "binary")
      : Buffer.isBuffer(attributes)
        ? attributes
        : Buffer.alloc(0);

  const headerBuf = Buffer.alloc(RADIUS_PACKET_HEADER_SIZE);
  headerBuf.writeUInt8(code, 0);
  headerBuf.writeUInt8(identifier, 1);
  headerBuf.writeUInt16BE(length, 2);
  authenticator.copy(headerBuf, 4);

  const md5 = crypto.createHash("md5");
  md5.update(Buffer.concat([headerBuf, attrBuf, secretBuf]));
  return md5.digest();
}

function computeResponseAuthenticator(
  code,
  identifier,
  length,
  requestAuthenticator,
  attributes,
  secret,
) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new RadiusAuthenticatorError(
      "INVALID_SECRET",
      "Shared secret is required for response authenticator calculation",
    );
  }

  const secretBuf = Buffer.from(secret, "utf8");

  const attrBuf =
    typeof attributes === "string"
      ? Buffer.from(attributes, "binary")
      : Buffer.isBuffer(attributes)
        ? attributes
        : Buffer.alloc(0);

  const headerBuf = Buffer.alloc(RADIUS_PACKET_HEADER_SIZE);
  headerBuf.writeUInt8(code, 0);
  headerBuf.writeUInt8(identifier, 1);
  headerBuf.writeUInt16BE(length, 2);
  requestAuthenticator.copy(headerBuf, 4);

  const md5 = crypto.createHash("md5");
  md5.update(
    Buffer.concat([headerBuf, attrBuf, secretBuf]),
  );
  return md5.digest();
}

function generateRequestAuthenticator() {
  return crypto.randomBytes(RADIUS_AUTHENTICATOR_SIZE);
}

function validateRequestAuthenticator(
  code,
  identifier,
  length,
  providedAuthenticator,
  attributes,
  secret,
) {
  if (!Buffer.isBuffer(providedAuthenticator)) {
    throw new RadiusAuthenticatorError(
      "INVALID_AUTHENTICATOR",
      "Authenticator must be a Buffer",
    );
  }

  if (providedAuthenticator.length !== RADIUS_AUTHENTICATOR_SIZE) {
    throw new RadiusAuthenticatorError(
      "INVALID_AUTHENTICATOR",
      `Authenticator must be ${RADIUS_AUTHENTICATOR_SIZE} bytes, got ${providedAuthenticator.length}`,
    );
  }

  const computed = computeRequestAuthenticator(
    code,
    identifier,
    length,
    providedAuthenticator,
    attributes,
    secret,
  );

  const valid = crypto.timingSafeEqual(computed, providedAuthenticator);
  return {
    valid,
    computed,
    provided: providedAuthenticator,
  };
}

function validateResponseAuthenticator(
  code,
  identifier,
  length,
  requestAuthenticator,
  providedAuthenticator,
  attributes,
  secret,
) {
  if (!Buffer.isBuffer(requestAuthenticator)) {
    throw new RadiusAuthenticatorError(
      "INVALID_REQUEST_AUTHENTICATOR",
      "Request authenticator must be a Buffer",
    );
  }

  const computed = computeResponseAuthenticator(
    code,
    identifier,
    length,
    requestAuthenticator,
    attributes,
    secret,
  );

  const valid = crypto.timingSafeEqual(computed, providedAuthenticator);
  return {
    valid,
    computed,
    provided: providedAuthenticator,
  };
}

function computeMessageAuthenticator(attributes, secret) {
  const secretBuf = Buffer.from(secret, "utf8");
  const attrBuf =
    typeof attributes === "string"
      ? Buffer.from(attributes, "binary")
      : Buffer.isBuffer(attributes)
        ? attributes
        : Buffer.alloc(0);

  const md5 = crypto.createHash("md5");
  md5.update(Buffer.concat([attrBuf, secretBuf]));
  return md5.digest();
}

function validateMessageAuthenticator(attributes, secret, provided) {
  const computed = computeMessageAuthenticator(attributes, secret);
  if (!provided || provided.length !== RADIUS_AUTHENTICATOR_SIZE) {
    return { valid: false, computed, provided: provided || Buffer.alloc(0) };
  }
  const valid = crypto.timingSafeEqual(computed, provided);
  return { valid, computed, provided };
}

const RADIUS_MESSAGE_AUTHENTICATOR_ATTRIBUTE = 80;
const EAP_MESSAGE_ATTRIBUTE = 71;
const ACCOUNTS_SESSION_ID_ATTRIBUTE = 44;

module.exports = {
  RadiusAuthenticatorError,
  RADIUS_MESSAGE_AUTHENTICATOR_ATTRIBUTE,
  EAP_MESSAGE_ATTRIBUTE,
  ACCOUNTS_SESSION_ID_ATTRIBUTE,
  computeRequestAuthenticator,
  computeResponseAuthenticator,
  generateRequestAuthenticator,
  validateRequestAuthenticator,
  validateResponseAuthenticator,
  computeMessageAuthenticator,
  validateMessageAuthenticator,
};
