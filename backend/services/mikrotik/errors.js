// Phase 8.5A — MikroTik router control foundation.
//
// Error architecture for the RouterOS control foundation. Deliberately mirrors
// the Phase 8.2C pattern in backend/services/radiusTransport/errors.js so that a
// future adapter (Phase 8.5B) can map transport failures onto the existing
// RoamingAAAAdapterError contract without inventing a new error vocabulary.
//
// Invariants carried from the Phase 8.4 Decision Lock (§16.1, §23.3):
//   S1  no phone number, userId or sub ever reaches RouterOS
//   S2  the device record holds a secret REFERENCE only, never material
//   S3  secrets never appear in source, responses, sessions, JWTs or logs
//   S7  fail closed on missing, disabled, malformed or unavailable secrets
//
// This module performs no networking and holds no business logic.

const MIKROTIK_ERROR_CODES = Object.freeze({
  MIKROTIK_API_DISABLED: "MIKROTIK_API_DISABLED",
  MIKROTIK_CONFIG_INVALID: "MIKROTIK_CONFIG_INVALID",
  MIKROTIK_NETWORK_CONTROL_FORBIDDEN: "MIKROTIK_NETWORK_CONTROL_FORBIDDEN",
  MIKROTIK_DEVICE_NOT_FOUND: "MIKROTIK_DEVICE_NOT_FOUND",
  MIKROTIK_SECRET_UNAVAILABLE: "MIKROTIK_SECRET_UNAVAILABLE",
  MIKROTIK_SHARED_USERS_UNDETERMINED: "MIKROTIK_SHARED_USERS_UNDETERMINED",
  MIKROTIK_UNSUPPORTED_OPERATION: "MIKROTIK_UNSUPPORTED_OPERATION",
  MIKROTIK_TRANSPORT_FAILURE: "MIKROTIK_TRANSPORT_FAILURE",
  MIKROTIK_TIMEOUT: "MIKROTIK_TIMEOUT",
  MIKROTIK_RETRY_EXHAUSTED: "MIKROTIK_RETRY_EXHAUSTED",
  MIKROTIK_NETWORK_ERROR: "MIKROTIK_NETWORK_ERROR",
  MIKROTIK_AUTH_FAILED: "MIKROTIK_AUTH_FAILED",
  MIKROTIK_INVALID_RESPONSE: "MIKROTIK_INVALID_RESPONSE",
  MIKROTIK_TARGET_NOT_FOUND: "MIKROTIK_TARGET_NOT_FOUND",
});

// Deterministic mapping onto the existing RoamingAAAAdapterError vocabulary.
// Mirrors radiusTransport/errors.js AAA_ERROR_MAP so that ADAPTER_FAILURE /
// ADAPTER_DISABLED / ADAPTER_NOT_CONFIGURED / ADAPTER_UNAVAILABLE /
// ADAPTER_NOT_IMPLEMENTED keep their existing meanings for operators and tests.
const MIKROTIK_AAA_ERROR_MAP = Object.freeze({
  MIKROTIK_API_DISABLED: { code: "ADAPTER_DISABLED", status: 503 },
  MIKROTIK_CONFIG_INVALID: { code: "ADAPTER_FAILURE", status: 502 },
  MIKROTIK_NETWORK_CONTROL_FORBIDDEN: { code: "ADAPTER_DISABLED", status: 503 },
  MIKROTIK_DEVICE_NOT_FOUND: { code: "ADAPTER_NOT_CONFIGURED", status: 404 },
  MIKROTIK_SECRET_UNAVAILABLE: { code: "ADAPTER_FAILURE", status: 502 },
  MIKROTIK_SHARED_USERS_UNDETERMINED: { code: "ADAPTER_FAILURE", status: 502 },
  MIKROTIK_UNSUPPORTED_OPERATION: { code: "ADAPTER_NOT_IMPLEMENTED", status: 501 },
  MIKROTIK_TRANSPORT_FAILURE: { code: "ADAPTER_FAILURE", status: 502 },
  MIKROTIK_TIMEOUT: { code: "ADAPTER_FAILURE", status: 502 },
  MIKROTIK_RETRY_EXHAUSTED: { code: "ADAPTER_FAILURE", status: 502 },
  MIKROTIK_NETWORK_ERROR: { code: "ADAPTER_UNAVAILABLE", status: 503 },
  MIKROTIK_AUTH_FAILED: { code: "ADAPTER_FAILURE", status: 502 },
  MIKROTIK_INVALID_RESPONSE: { code: "ADAPTER_FAILURE", status: 502 },
  MIKROTIK_TARGET_NOT_FOUND: { code: "ADAPTER_FAILURE", status: 502 },
});

const REDACTED = "[REDACTED]";

// Any detail key that could carry credential material is redacted outright.
// This is intentionally broader than the RADIUS pattern: it additionally covers
// host/port, because the Phase 8.4 Decision Lock §16.1 forbids a resolved
// profile host/port combination from appearing in logs or audit records.
const SENSITIVE_KEY_PATTERN =
  /(secret|password|passphrase|credential|token|authenticator|key|host|hostname|address|port|url|user)/i;

function sanitizeDetails(details) {
  if (details === null || details === undefined) return {};
  if (typeof details !== "object") return { value: REDACTED };
  const safe = {};
  for (const key of Object.keys(details)) {
    const val = details[key];
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      safe[key] = REDACTED;
    } else if (val === null || typeof val !== "object") {
      safe[key] = val;
    } else if (Buffer.isBuffer(val)) {
      safe[key] = `[Buffer:${val.length}]`;
    } else {
      safe[key] = sanitizeDetails(val);
    }
  }
  return safe;
}

// Redaction of credential-shaped content inside a free-text message.
//
// This MUST actually remove the value. An earlier revision of this function
// replaced the keywords with themselves and was therefore a no-op, which would
// have let a credential embedded in an error message reach a log line.
//
// Two passes:
//   1. key=value forms  (password=..., secret=..., token=..., etc.)
//   2. bare high-entropy runs (long base64/hex blobs), which are how a secret
//      most often appears once it has been interpolated into prose.
function sanitizeMessage(message) {
  if (typeof message !== "string") return "";

  const withKeysRedacted = message.replace(
    /\b(secret|password|passphrase|token|credential|authenticator|apikey|api_key)\b(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;)]+)/gi,
    (match, key, separator) => `${key}${separator}${REDACTED}`,
  );

  // A quoted or bare run of >= 24 base64/hex characters is credential-shaped.
  return withKeysRedacted.replace(
    /[A-Za-z0-9+/=_-]{24,}/g,
    (match) => {
      // Only redact high-entropy runs: a long dictionary word is not a secret.
      const looksLikeWord = /^[a-z]+$/i.test(match);
      return looksLikeWord ? match : REDACTED;
    },
  );
}

class MikrotikError extends Error {
  constructor(code, message, details = {}) {
    super(sanitizeMessage(message));
    this.name = "MikrotikError";
    this.code = MIKROTIK_ERROR_CODES[code]
      ? code
      : MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID;
    this.details = sanitizeDetails(details);
    this.aaaError = MIKROTIK_AAA_ERROR_MAP[this.code] || {
      code: "ADAPTER_FAILURE",
      status: 502,
    };
  }

  // Safe to hand to the application logging/audit mechanism. Never uses console.
  toLogSafe() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      aaaError: { code: this.aaaError.code, status: this.aaaError.status },
    };
  }

  // Consumed by the future Phase 8.5B adapter, matching
  // RadiusTransportError.toAAAError() in radiusTransport/errors.js:88-97.
  toAAAError() {
    const err = new Error(this.message);
    err.name = "RoamingAAAAdapterError";
    err.status = this.aaaError.status;
    err.code = this.aaaError.code;
    err.mikrotikCode = this.code;
    err.details = this.details;
    return err;
  }
}

function mikrotikError(code, message, details) {
  return new MikrotikError(code, message, details);
}

function isMikrotikError(err) {
  return err instanceof MikrotikError;
}

function describeMikrotikError(err) {
  if (isMikrotikError(err)) {
    return { code: err.code, message: err.message, details: err.details };
  }
  return {
    code: "MIKROTIK_TRANSPORT_FAILURE",
    message: sanitizeMessage(
      err && err.message ? err.message : "unknown router control failure",
    ),
    details: {},
  };
}

module.exports = {
  MIKROTIK_ERROR_CODES,
  MIKROTIK_AAA_ERROR_MAP,
  REDACTED,
  MikrotikError,
  mikrotikError,
  isMikrotikError,
  describeMikrotikError,
  sanitizeDetails,
  sanitizeMessage,
};