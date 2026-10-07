// Phase 8.5A — MikroTik router control foundation.
//
// Deterministic, versioned, pseudonymous RouterOS HotSpot username derivation.
//
// PURPOSE
//   Maps one already-authorized YabaLink roaming session onto exactly one
//   RouterOS HotSpot user, so that Phase 8.5B can provision and later remove
//   precisely that user, on precisely that router.
//
// RELATIONSHIP TO THE Phase 8.4 IDENTITY DECISION (REC-8 / OD-1)
//   This is NOT the REC-8 subscriber pseudonym. REC-8 produces a DURABLE
//   subscriber identity that must be stable across every visited network.
//   This produces a SESSION-SCOPED network handle on ONE router. They are
//   deliberately different derivations with different inputs, lifetimes and
//   rotation obligations. This module does not implement, depend on, or
//   pre-empt OD-1.
//
// SECURITY (Phase 8.4 Decision Lock §10.2, §16.1, invariant S1)
//   * HMAC-SHA256 over a versioned canonical input, keyed by a server-side key.
//   * One-way: knowing a router username does not reveal the session or user.
//   * Never derived from, and never able to leak, a phone number, userId,
//     Firebase uid, JWT or any other PII-bearing identifier.
//   * homeOwnerId participates so a username is not globally correlatable
//     across federations, and so two federations cannot collide.
//   * Contains no raw internal identifier in cleartext.
//
// Uses only the Node built-in crypto module. Precedent: backend/routes/vouchers.js:17.

const crypto = require("crypto");
const { mikrotikError, MIKROTIK_ERROR_CODES } = require("./errors");

// Bump when the derivation input or truncation length changes, so that a future
// rotation is unambiguous and needs no flag-day cutover.
const ROUTER_USERNAME_VERSION = "yb1";

const ROUTER_USERNAME_PREFIX = `${ROUTER_USERNAME_VERSION}_`;
const ROUTER_USERNAME_HEX_LENGTH = 20; // 80 bits of the HMAC output
const ROUTER_USERNAME_MAX_LENGTH = 64;

// Mirrors the production hard-fail semantics of getProductionSecret
// (backend/services/passwordService.js): a development default is acceptable
// outside production and must never be accepted inside production.
const IDENTITY_KEY_ENV_VAR = "MIKROTIK_IDENTITY_KEY";
const IDENTITY_KEY_DEV_DEFAULT = "dev_mikrotik_identity_key_not_for_production";

function invalid(message, details) {
  return mikrotikError(
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    message,
    details,
  );
}

function hasControlOrSpace(value) {
  if (typeof value !== "string") return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function requireIdentifier(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`${field} is required to derive a router username`, { field });
  }
  if (hasControlOrSpace(value)) {
    throw invalid(`${field} must not contain whitespace or control characters`, {
      field,
    });
  }
  if (value.length > 256) {
    throw invalid(`${field} exceeds maximum length`, { field });
  }
  return value;
}

/**
 * Resolve the HMAC key. Injected keys win (dependency injection, used by the
 * checker). Otherwise the environment variable is consulted. Production refuses
 * both a missing value and the development default.
 */
function resolveIdentityKey(injectedKey) {
  if (typeof injectedKey === "string" && injectedKey.length > 0) {
    if (injectedKey === IDENTITY_KEY_DEV_DEFAULT && process.env.NODE_ENV === "production") {
      throw invalid(
        "The development MikroTik identity key is not permitted in production",
        { field: "identityKey" },
      );
    }
    return injectedKey;
  }

  const fromEnv = process.env[IDENTITY_KEY_ENV_VAR];
  if (typeof fromEnv === "string" && fromEnv.length > 0 && fromEnv !== IDENTITY_KEY_DEV_DEFAULT) {
    return fromEnv;
  }

  if (process.env.NODE_ENV === "production") {
    throw invalid(
      `A MikroTik identity key is required in production. Set ${IDENTITY_KEY_ENV_VAR}.`,
      { field: "identityKey" },
    );
  }

  return IDENTITY_KEY_DEV_DEFAULT;
}

function buildCanonicalInput({ sessionId, homeOwnerId }) {
  // Field order and separator are fixed. Length-prefixing each component makes
  // the encoding unambiguous, so no combination of field values can collide
  // with a different combination.
  const canonical = [sessionId, homeOwnerId]
    .map((part) => `${part.length}:${part}`)
    .join("|");
  return `${ROUTER_USERNAME_VERSION}|${canonical}`;
}

/**
 * Derive the RouterOS HotSpot username for an authorized session.
 *
 * Deterministic: the same session and home owner always yield the same
 * username, on every router, so that provisioning is idempotent and removal is
 * precise. Throws (fail closed) rather than returning a guess.
 */
function deriveRouterUsername(input = {}, options = {}) {
  const sessionId = requireIdentifier(input.sessionId, "sessionId");
  const homeOwnerId = requireIdentifier(input.homeOwnerId, "homeOwnerId");

  const key = resolveIdentityKey(options.identityKey);
  const canonical = buildCanonicalInput({ sessionId, homeOwnerId });

  const digest = crypto
    .createHmac("sha256", key)
    .update(canonical, "utf8")
    .digest("hex")
    .slice(0, ROUTER_USERNAME_HEX_LENGTH);

  const username = `${ROUTER_USERNAME_PREFIX}${digest}`;
  if (username.length > ROUTER_USERNAME_MAX_LENGTH) {
    throw invalid("Derived router username exceeds maximum length", {
      field: "routerUsername",
    });
  }
  return username;
}

/**
 * Generate the ephemeral RouterOS HotSpot password for one provisioned user.
 *
 * This is NOT a customer credential and NOT a reusable subscriber secret. It
 * exists only so that the RouterOS HotSpot login step can be satisfied for a
 * single provisioned user, and it is never persisted to Firestore, never
 * returned through an API and never logged.
 */
function generateHotspotPassword(bytes = 16) {
  if (!Number.isInteger(bytes) || bytes < 8 || bytes > 64) {
    throw invalid("hotspot password byte length is out of range", {
      field: "bytes",
    });
  }
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Shape guard: a username produced by this module must never contain a
 * character that RouterOS would interpret, and must never look like it carries
 * a raw internal identifier.
 */
function assertRouterUsernameShape(username) {
  if (typeof username !== "string" || username.length === 0) {
    throw invalid("router username must be a non-empty string", {
      field: "routerUsername",
    });
  }
  if (!new RegExp(`^${ROUTER_USERNAME_PREFIX}[0-9a-f]{${ROUTER_USERNAME_HEX_LENGTH}}$`).test(username)) {
    throw invalid("router username is not a well-formed derived identity", {
      field: "routerUsername",
    });
  }
  return username;
}

module.exports = {
  ROUTER_USERNAME_VERSION,
  ROUTER_USERNAME_PREFIX,
  ROUTER_USERNAME_HEX_LENGTH,
  ROUTER_USERNAME_MAX_LENGTH,
  IDENTITY_KEY_ENV_VAR,
  IDENTITY_KEY_DEV_DEFAULT,
  deriveRouterUsername,
  generateHotspotPassword,
  assertRouterUsernameShape,
};