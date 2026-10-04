const RADIUS_ERROR_CODES = Object.freeze({
  RADIUS_DISABLED: "RADIUS_DISABLED",
  RADIUS_PROFILE_NOT_FOUND: "RADIUS_PROFILE_NOT_FOUND",
  RADIUS_PROFILE_DISABLED: "RADIUS_PROFILE_DISABLED",
  RADIUS_SECRET_UNAVAILABLE: "RADIUS_SECRET_UNAVAILABLE",
  RADIUS_CONFIG_INVALID: "RADIUS_CONFIG_INVALID",
  RADIUS_TIMEOUT: "RADIUS_TIMEOUT",
  RADIUS_RETRY_EXHAUSTED: "RADIUS_RETRY_EXHAUSTED",
  RADIUS_NETWORK_ERROR: "RADIUS_NETWORK_ERROR",
  RADIUS_INVALID_RESPONSE: "RADIUS_INVALID_RESPONSE",
  RADIUS_AUTHENTICATOR_INVALID: "RADIUS_AUTHENTICATOR_INVALID",
  RADIUS_UNEXPECTED_PACKET: "RADIUS_UNEXPECTED_PACKET",
  RADIUS_PACKET_DECODE_FAILED: "RADIUS_PACKET_DECODE_FAILED",
  RADIUS_UNSUPPORTED_OPERATION: "RADIUS_UNSUPPORTED_OPERATION",
  RADIUS_DUPLICATE_IN_FLIGHT: "RADIUS_DUPLICATE_IN_FLIGHT",
});

const AAA_ERROR_MAP = Object.freeze({
  RADIUS_DISABLED: { code: "ADAPTER_DISABLED", status: 503 },
  RADIUS_PROFILE_NOT_FOUND: { code: "ADAPTER_NOT_CONFIGURED", status: 404 },
  RADIUS_PROFILE_DISABLED: { code: "ADAPTER_DISABLED", status: 503 },
  RADIUS_SECRET_UNAVAILABLE: { code: "ADAPTER_FAILURE", status: 502 },
  RADIUS_CONFIG_INVALID: { code: "ADAPTER_FAILURE", status: 502 },
  RADIUS_TIMEOUT: { code: "ADAPTER_FAILURE", status: 502 },
  RADIUS_RETRY_EXHAUSTED: { code: "ADAPTER_FAILURE", status: 502 },
  RADIUS_NETWORK_ERROR: { code: "ADAPTER_UNAVAILABLE", status: 503 },
  RADIUS_INVALID_RESPONSE: { code: "ADAPTER_FAILURE", status: 502 },
  RADIUS_AUTHENTICATOR_INVALID: { code: "ADAPTER_FAILURE", status: 502 },
  RADIUS_UNEXPECTED_PACKET: { code: "ADAPTER_FAILURE", status: 502 },
  RADIUS_PACKET_DECODE_FAILED: { code: "ADAPTER_FAILURE", status: 502 },
  RADIUS_UNSUPPORTED_OPERATION: { code: "ADAPTER_NOT_IMPLEMENTED", status: 501 },
  RADIUS_DUPLICATE_IN_FLIGHT: { code: "ADAPTER_FAILURE", status: 502 },
});

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /(secret|password|passphrase|credential|token|authenticator|key)/i;

function redactValue(value) {
  return REDACTED;
}

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

function sanitizeMessage(message) {
  if (typeof message !== "string") return "";
  return message.replace(/secret|password|passphrase/gi, (m) => m);
}

class RadiusTransportError extends Error {
  constructor(code, message, details = {}) {
    super(sanitizeMessage(message));
    this.name = "RadiusTransportError";
    this.code = RADIUS_ERROR_CODES[code] ? code : RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID;
    this.details = sanitizeDetails(details);
    this.aaaError = AAA_ERROR_MAP[this.code] || {
      code: "ADAPTER_FAILURE",
      status: 502,
    };
  }

  toLogSafe() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      aaaError: { code: this.aaaError.code, status: this.aaaError.status },
    };
  }

  toAAAError() {
    const err = new Error(this.message);
    err.name = "RoamingAAAAdapterError";
    err.status = this.aaaError.status;
    err.code = this.aaaError.code;
    err.radiusCode = this.code;
    err.details = this.details;
    return err;
  }
}

function radiusError(code, message, details) {
  return new RadiusTransportError(code, message, details);
}

function isRadiusTransportError(err) {
  return err instanceof RadiusTransportError;
}

function describeError(err) {
  if (isRadiusTransportError(err)) {
    return { code: err.code, message: err.message, details: err.details };
  }
  return {
    code: "RADIUS_NETWORK_ERROR",
    message: sanitizeMessage(err && err.message ? err.message : "unknown transport failure"),
    details: {},
  };
}

module.exports = {
  RADIUS_ERROR_CODES,
  AAA_ERROR_MAP,
  REDACTED,
  RadiusTransportError,
  radiusError,
  isRadiusTransportError,
  describeError,
  sanitizeDetails,
  sanitizeMessage,
  redactValue,
};