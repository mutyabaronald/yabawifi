const { radiusError, RADIUS_ERROR_CODES } = require("./errors");

const RADIUS_DEFAULT_AUTH_PORT = 1812;
const RADIUS_DEFAULT_ACCOUNTING_PORT = 1813;
const RADIUS_DEFAULT_COA_PORT = 3799;
const RADIUS_DEFAULT_TIMEOUT_MS = 5000;
const RADIUS_DEFAULT_RETRIES = 3;

const RADIUS_MIN_PORT = 1;
const RADIUS_MAX_PORT = 65535;
const RADIUS_MIN_TIMEOUT_MS = 100;
const RADIUS_MAX_TIMEOUT_MS = 30000;
const RADIUS_MIN_RETRIES = 0;
const RADIUS_MAX_RETRIES = 10;
const RADIUS_MAX_SECRET_REFERENCE_LENGTH = 512;
const RADIUS_MAX_HOSTNAME_LENGTH = 253;

const NAS_IP_AUTO = "auto";

function hasControlOrSpace(value) {
  if (typeof value !== "string") return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

const CLIENT_FORBIDDEN_FIELDS = Object.freeze([
  "serverHost",
  "authServer",
  "accountingServer",
  "serverAddress",
  "authenticationPort",
  "authPort",
  "accountingPort",
  "coaPort",
  "disconnectPort",
  "secretReference",
  "secret",
  "sharedSecret",
  "timeoutMs",
  "retries",
  "nasIdentifier",
  "nasIpAddress",
  "profile",
  "enabled",
]);

function invalidConfig(message, details) {
  return radiusError(RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID, message, details);
}

function isValidIpv4(value) {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function isValidHostname(value) {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > RADIUS_MAX_HOSTNAME_LENGTH) return false;
  if (isValidIpv4(value)) return true;
  const labels = value.split(".");
  const looksNumeric = labels.every((label) => /^\d+$/.test(label));
  if (looksNumeric) return false;
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
  );
}

function looksLikeSecretMaterial(value) {
  if (typeof value !== "string") return false;
  if (/^\s*(secret|password|passphrase|shared[_-]?secret)\s*=/i.test(value)) return true;
  if (/^[A-Za-z0-9+/]{24,}={0,2}$/.test(value)) return true;
  if (/^[0-9a-f]{32,}$/i.test(value)) return true;
  return false;
}

function validateSecretReference(reference, field) {
  if (typeof reference !== "string" || reference.trim().length === 0) {
    throw invalidConfig(`${field} is required and must be a non-empty string`, { field });
  }
  if (reference.length > RADIUS_MAX_SECRET_REFERENCE_LENGTH) {
    throw invalidConfig(`${field} exceeds maximum length`, { field });
  }
  if (hasControlOrSpace(reference)) {
    throw invalidConfig(`${field} must not contain whitespace or control characters`, {
      field,
    });
  }
  if (looksLikeSecretMaterial(reference)) {
    throw invalidConfig(
      `${field} must be a secret reference/path, not secret material`,
      { field },
    );
  }
  return reference;
}

function validatePort(value, field, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value)) {
    throw invalidConfig(`${field} must be an integer`, { field });
  }
  if (value < RADIUS_MIN_PORT || value > RADIUS_MAX_PORT) {
    throw invalidConfig(
      `${field} must be between ${RADIUS_MIN_PORT} and ${RADIUS_MAX_PORT}`,
      { field },
    );
  }
  return value;
}

function validateTimeout(value) {
  if (value === undefined || value === null) return RADIUS_DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(value)) {
    throw invalidConfig("timeoutMs must be an integer", { field: "timeoutMs" });
  }
  if (value < RADIUS_MIN_TIMEOUT_MS || value > RADIUS_MAX_TIMEOUT_MS) {
    throw invalidConfig(
      `timeoutMs must be between ${RADIUS_MIN_TIMEOUT_MS} and ${RADIUS_MAX_TIMEOUT_MS}`,
      { field: "timeoutMs" },
    );
  }
  return value;
}

function validateRetries(value) {
  if (value === undefined || value === null) return RADIUS_DEFAULT_RETRIES;
  if (!Number.isInteger(value)) {
    throw invalidConfig("retries must be an integer", { field: "retries" });
  }
  if (value < RADIUS_MIN_RETRIES || value > RADIUS_MAX_RETRIES) {
    throw invalidConfig(
      `retries must be between ${RADIUS_MIN_RETRIES} and ${RADIUS_MAX_RETRIES}`,
      { field: "retries" },
    );
  }
  return value;
}

function validateNasIpAddress(value) {
  if (value === undefined || value === null) return NAS_IP_AUTO;
  if (typeof value !== "string") {
    throw invalidConfig("nasIpAddress must be a string", { field: "nasIpAddress" });
  }
  if (value === NAS_IP_AUTO) return NAS_IP_AUTO;
  if (!isValidIpv4(value)) {
    throw invalidConfig("nasIpAddress must be a valid IPv4 address or 'auto'", {
      field: "nasIpAddress",
    });
  }
  return value;
}

function validateNasIdentifier(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidConfig("nasIdentifier is required and must be a non-empty string", {
      field: "nasIdentifier",
    });
  }
  if (value.length > 253) {
    throw invalidConfig("nasIdentifier exceeds maximum length", {
      field: "nasIdentifier",
    });
  }
  return value;
}

function validateProfileId(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidConfig("profileId is required and must be a non-empty string", {
      field: "profileId",
    });
  }
  return value;
}

function validateHost(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidConfig(`${field} is required and must be a non-empty string`, { field });
  }
  if (!isValidHostname(value)) {
    throw invalidConfig(`${field} must be a valid IPv4 address or hostname`, { field });
  }
  return value;
}

function validateEnabled(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "boolean") {
    throw invalidConfig("enabled must be a boolean", { field: "enabled" });
  }
  return value;
}

function normalizeRadiusProfile(input) {
  if (!input || typeof input !== "object") {
    throw invalidConfig("RADIUS profile must be an object");
  }

  const profileId = validateProfileId(input.profileId);
  const nasIdentifier = validateNasIdentifier(input.nasIdentifier);
  const nasIpAddress = validateNasIpAddress(input.nasIpAddress);

  const serverHost = validateHost(
    input.serverHost !== undefined ? input.serverHost : input.authServer,
    "serverHost",
  );
  const accountingHost =
    input.accountingServer !== undefined && input.accountingServer !== null
      ? validateHost(input.accountingServer, "accountingServer")
      : serverHost;

  const authenticationPort = validatePort(
    input.authenticationPort !== undefined
      ? input.authenticationPort
      : input.authPort,
    "authenticationPort",
    RADIUS_DEFAULT_AUTH_PORT,
  );
  const accountingPort = validatePort(
    input.accountingPort,
    "accountingPort",
    RADIUS_DEFAULT_ACCOUNTING_PORT,
  );
  const coaPort = validatePort(input.coaPort, "coaPort", RADIUS_DEFAULT_COA_PORT);

  const secretReference = validateSecretReference(
    input.secretReference,
    "secretReference",
  );

  const timeoutMs = validateTimeout(input.timeoutMs);
  const retries = validateRetries(input.retries);
  const enabled = validateEnabled(input.enabled);

  return Object.freeze({
    profileId,
    nasIdentifier,
    nasIpAddress,
    serverHost,
    accountingHost,
    authenticationPort,
    accountingPort,
    coaPort,
    secretReference,
    timeoutMs,
    retries,
    enabled,
  });
}

function assertProfileUsable(profile) {
  if (profile.enabled !== true) {
    throw radiusError(
      RADIUS_ERROR_CODES.RADIUS_PROFILE_DISABLED,
      `RADIUS profile '${profile.profileId}' is disabled`,
      { profileId: profile.profileId },
    );
  }
}

function assertNoClientSuppliedConfig(args) {
  if (!args || typeof args !== "object") return;
  const offending = CLIENT_FORBIDDEN_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(args, field),
  );
  if (offending.length > 0) {
    throw invalidConfig(
      "RADIUS infrastructure configuration must come from trusted server-side profiles",
      { rejectedFields: offending },
    );
  }
}

function createInMemoryProfileStore(profiles = []) {
  const table = new Map();
  for (const profile of profiles) {
    const normalized = normalizeRadiusProfile(profile);
    table.set(normalized.profileId, normalized);
  }

  return {
    async getProfile(profileId) {
      if (typeof profileId !== "string" || profileId.length === 0) {
        throw invalidConfig("profileId is required", { field: "profileId" });
      }
      const profile = table.get(profileId);
      if (!profile) {
        throw radiusError(
          RADIUS_ERROR_CODES.RADIUS_PROFILE_NOT_FOUND,
          `No RADIUS profile configured for id '${profileId}'`,
          { profileId },
        );
      }
      return profile;
    },
    listProfiles() {
      return Array.from(table.values());
    },
  };
}

module.exports = {
  RADIUS_DEFAULT_AUTH_PORT,
  RADIUS_DEFAULT_ACCOUNTING_PORT,
  RADIUS_DEFAULT_COA_PORT,
  RADIUS_DEFAULT_TIMEOUT_MS,
  RADIUS_DEFAULT_RETRIES,
  RADIUS_MIN_TIMEOUT_MS,
  RADIUS_MAX_TIMEOUT_MS,
  RADIUS_MIN_RETRIES,
  RADIUS_MAX_RETRIES,
  NAS_IP_AUTO,
  CLIENT_FORBIDDEN_FIELDS,
  isValidIpv4,
  isValidHostname,
  looksLikeSecretMaterial,
  normalizeRadiusProfile,
  assertProfileUsable,
  assertNoClientSuppliedConfig,
  createInMemoryProfileStore,
};
