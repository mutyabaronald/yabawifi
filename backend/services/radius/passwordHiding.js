const crypto = require("crypto");

const RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE = 16;

class RadiusPasswordHidingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RadiusPasswordHidingError";
    this.code = code;
    this.details = details;
  }
}

function encodeUserPassword(plaintext, secret, requestAuthenticator) {
  if (!plaintext) {
    throw new RadiusPasswordHidingError(
      "INVALID_INPUT",
      "Plaintext password is required",
    );
  }
  if (!secret || typeof secret !== "string") {
    throw new RadiusPasswordHidingError(
      "INVALID_SECRET",
      "Shared secret is required",
    );
  }
  if (!Buffer.isBuffer(requestAuthenticator)) {
    throw new RadiusPasswordHidingError(
      "INVALID_AUTHENTICATOR",
      "Request authenticator must be a Buffer",
    );
  }

  const secretBuf = Buffer.from(secret, "utf8");
  const passwordBuf = Buffer.from(plaintext, "utf8");

  let padded = passwordBuf;
  const remainder = passwordBuf.length % RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE;
  if (remainder !== 0) {
    const paddingLength =
      RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE - remainder;
    padded = Buffer.concat([
      passwordBuf,
      Buffer.alloc(paddingLength, 0),
    ]);
  }

  if (padded.length % RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE !== 0) {
    padded = Buffer.concat([padded, Buffer.alloc(RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE)]);
  }

  const result = Buffer.alloc(padded.length);
  let prevBlock = requestAuthenticator;

  for (let i = 0; i < padded.length; i += RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE) {
    const block = padded.slice(i, i + RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE);

    const hashInput = Buffer.concat([secretBuf, prevBlock]);
    const cipher = crypto.createHash("md5").update(hashInput).digest();

    for (let j = 0; j < RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE; j++) {
      result[i + j] = block[j] ^ cipher[j];
    }

    prevBlock = result.slice(i, i + RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE);
  }

  return result;
}

function decodeUserPassword(encrypted, secret, requestAuthenticator) {
  if (!encrypted || !Buffer.isBuffer(encrypted)) {
    throw new RadiusPasswordHidingError(
      "INVALID_INPUT",
      "Encrypted password must be a Buffer",
    );
  }
  if (encrypted.length === 0) {
    return "";
  }
  if (encrypted.length % RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE !== 0) {
    throw new RadiusPasswordHidingError(
      "INVALID_LENGTH",
      `Encrypted password length must be a multiple of ${RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE}, got ${encrypted.length}`,
    );
  }
  if (!secret || typeof secret !== "string") {
    throw new RadiusPasswordHidingError(
      "INVALID_SECRET",
      "Shared secret is required",
    );
  }
  if (!Buffer.isBuffer(requestAuthenticator)) {
    throw new RadiusPasswordHidingError(
      "INVALID_AUTHENTICATOR",
      "Request authenticator must be a Buffer",
    );
  }

  const secretBuf = Buffer.from(secret, "utf8");
  const result = Buffer.alloc(encrypted.length);
  let prevBlock = requestAuthenticator;

  for (let i = 0; i < encrypted.length; i += RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE) {
    const block = encrypted.slice(i, i + RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE);

    const hashInput = Buffer.concat([secretBuf, prevBlock]);
    const plain = crypto.createHash("md5").update(hashInput).digest();

    for (let j = 0; j < RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE; j++) {
      result[i + j] = block[j] ^ plain[j];
    }

    prevBlock = block;
  }

  let trimIndex = result.length;
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i] !== 0) {
      trimIndex = i + 1;
      break;
    }
  }

  return result.slice(0, trimIndex).toString("utf8");
}

function encodeTunnelPassword(plaintext, secret, requestAuthenticator) {
  return encodeUserPassword(plaintext, secret, requestAuthenticator);
}

function decodeTunnelPassword(encrypted, secret, requestAuthenticator) {
  return decodeUserPassword(encrypted, secret, requestAuthenticator);
}

module.exports = {
  RadiusPasswordHidingError,
  RADIUS_ENCRYPTED_PASSWORD_BLOCK_SIZE,
  encodeUserPassword,
  decodeUserPassword,
  encodeTunnelPassword,
  decodeTunnelPassword,
};
