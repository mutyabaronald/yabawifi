/**
 * Phase 8.3 - trusted RADIUS profile abstraction.
 *
 * A thin, dependency-injected facade over the Phase 8.2C profile layer.
 * It adds no validation rules of its own: normalization, port/timeout/retry
 * bounds and secret-reference checks all come from
 * `backend/services/radiusTransport/profile.js`.
 *
 * There is deliberately no Firestore, `.env` or filesystem implementation
 * here. The production profile store and the production secret backend are
 * Phase 8.4 work. With nothing injected this service is inert and every
 * lookup returns null.
 */

const {
  normalizeRadiusProfile,
} = require("../radiusTransport/profile");

const {
  RADIUS_ERROR_CODES,
  radiusError,
} = require("../radiusTransport/errors");

const RADIUS_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

const ALLOWED_PROFILE_FIELDS = Object.freeze([
  "profileId",
  "nasIdentifier",
  "nasIpAddress",
  "authServer",
  "serverHost",
  "authenticationPort",
  "authPort",
  "accountingHost",
  "accountingServer",
  "accountingPort",
  "coaPort",
  "secretReference",
  "timeoutMs",
  "retries",
  "enabled",
]);

const FORBIDDEN_PROFILE_FIELDS = Object.freeze([
  "sharedSecret",
  "secret",
  "secretValue",
  "secretMaterial",
  "radiusSharedSecret",
  "password",
  "passphrase",
]);

const PROFILE_FIELDS_ARE_STRINGS = Object.freeze([
  "profileId",
  "nasIdentifier",
  "nasIpAddress",
  "authServer",
  "serverHost",
  "accountingHost",
  "accountingServer",
  "secretReference",
]);

const PROFILE_FIELDS_ARE_INTEGERS = Object.freeze([
  "authenticationPort",
  "authPort",
  "accountingPort",
  "coaPort",
  "timeoutMs",
  "retries",
]);

function invalidProfileConfig(message, details) {
  return radiusError(
    RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
    message,
    details
  );
}

/**
 * The store used when nothing is injected. It performs no external lookup at
 * all - not Firestore, not the environment, not the filesystem.
 */
function createInertProfileStore() {
  return Object.freeze({
    inert: true,
    async getProfile() {
      return null;
    },
    async listProfiles() {
      return [];
    },
  });
}

function isProfileNotFound(err) {
  return Boolean(
    err &&
      typeof err === "object" &&
      err.code === RADIUS_ERROR_CODES.RADIUS_PROFILE_NOT_FOUND
  );
}

function assertNoLiteralSecret(record) {
  const present = FORBIDDEN_PROFILE_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(record, field)
  );
  if (present.length > 0) {
    throw invalidProfileConfig(
      "RADIUS profiles must carry a secretReference, never literal secret material",
      { rejectedFields: present }
    );
  }
}

function assertKnownFieldTypes(record) {
  const wrongTypes = [];

  for (const field of PROFILE_FIELDS_ARE_STRINGS) {
    const value = record[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      wrongTypes.push(field);
    }
  }

  for (const field of PROFILE_FIELDS_ARE_INTEGERS) {
    const value = record[field];
    if (value !== undefined && value !== null && !Number.isInteger(value)) {
      wrongTypes.push(field);
    }
  }

  if (record.enabled !== undefined && record.enabled !== null &&
      typeof record.enabled !== "boolean") {
    wrongTypes.push("enabled");
  }

  if (wrongTypes.length > 0) {
    throw invalidProfileConfig(
      "RADIUS profile has fields with unexpected types",
      { rejectedFields: wrongTypes }
    );
  }
}

function assertOnlyAllowedFields(record) {
  const unknown = Object.keys(record).filter(
    (field) => !ALLOWED_PROFILE_FIELDS.includes(field)
  );
  if (unknown.length > 0) {
    throw invalidProfileConfig(
      "RADIUS profile contains fields outside the allowed set",
      { rejectedFields: unknown }
    );
  }
}

function pickAllowedFields(record) {
  const picked = {};
  for (const field of ALLOWED_PROFILE_FIELDS) {
    if (record[field] !== undefined) picked[field] = record[field];
  }
  return picked;
}

/**
 * Build the profile service.
 *
 * `options.store` must expose `getProfile(profileId)`. Any other shape - or no
 * store at all - yields an inert service.
 */
function createRadiusProfileService(options = {}) {
  const store =
    options.store && typeof options.store.getProfile === "function"
      ? options.store
      : createInertProfileStore();

  const inert = store.inert === true || options.store === undefined;

  async function getProfile(profileId) {
    if (typeof profileId !== "string") return null;
    if (!RADIUS_PROFILE_ID_PATTERN.test(profileId)) return null;

    let record;
    try {
      record = await store.getProfile(profileId);
    } catch (err) {
      // The Phase 8.2C in-memory store signals an unknown id by throwing.
      // An unknown profile is not an error here - it resolves to null.
      if (isProfileNotFound(err)) return null;
      throw err;
    }

    if (!record || typeof record !== "object") return null;

    assertNoLiteralSecret(record);
    assertOnlyAllowedFields(record);
    assertKnownFieldTypes(record);

    return normalizeRadiusProfile(pickAllowedFields(record));
  }

  async function listProfiles() {
    if (typeof store.listProfiles !== "function") return [];
    const listed = await store.listProfiles();
    if (!Array.isArray(listed)) return [];
    const normalized = [];
    for (const record of listed) {
      if (!record || typeof record !== "object") continue;
      assertNoLiteralSecret(record);
      assertOnlyAllowedFields(record);
      assertKnownFieldTypes(record);
      normalized.push(normalizeRadiusProfile(pickAllowedFields(record)));
    }
    return normalized;
  }

  return Object.freeze({
    inert,
    getProfile,
    listProfiles,
  });
}

module.exports = {
  RADIUS_PROFILE_ID_PATTERN,
  ALLOWED_PROFILE_FIELDS,
  FORBIDDEN_PROFILE_FIELDS,
  createInertProfileStore,
  createRadiusProfileService,
};
