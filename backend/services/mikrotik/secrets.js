// Phase 8.5A — MikroTik router control foundation.
//
// Owner-scoped RouterOS API secret resolution.
//
// Mirrors the Phase 8.2C pattern in backend/services/radiusTransport/secrets.js
// (createRadiusSecretResolver) with one addition that matters for multi-owner
// federation: resolution is OWNER-SCOPED and DEVICE-SCOPED. Owner A must never
// be able to resolve Owner B's RouterOS credential.
//
// Invariants (Phase 8.4 Decision Lock §7.2, §23.3):
//   S2  the device record holds a REFERENCE only, never material
//   S3  secrets never appear in responses, sessions, JWTs or logs
//   S6  owner isolation
//   S7  fail closed on missing, disabled, malformed or unavailable secrets
//
// No secret is cached. Every call re-resolves, so a rotation takes effect
// immediately and a failed lookup is never remembered.

const { mikrotikError, MIKROTIK_ERROR_CODES } = require("./errors");

const ROUTER_OS_SECRET_RESOLVER_MODES = Object.freeze({
  STATIC_TEST: "static_test",
  DISABLED_PRODUCTION: "disabled_production",
});

const ROUTER_OS_MAX_SECRET_REFERENCE_LENGTH = 512;
const ROUTER_OS_MAX_SECRET_LENGTH = 512;

// Literal-secret fields that must never be accepted on a device record.
// Mirrors radiusProfiles/radiusProfileService.js:44-52 FORBIDDEN_PROFILE_FIELDS.
const FORBIDDEN_DEVICE_SECRET_FIELDS = Object.freeze([
  "routerOsApiPassword",
  "routerOsPassword",
  "routerosApiPassword",
  "apiPassword",
  "sharedSecret",
  "sharedsecret",
  "secret",
  "secretValue",
  "secretMaterial",
  "radiusSharedSecret",
  "password",
  "passphrase",
]);

function secretUnavailable(secretReference, reason, extra = {}) {
  return mikrotikError(
    MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
    "RouterOS API secret is unavailable",
    { secretReference, reason, ...extra },
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

// Mirrors radiusTransport/profile.js:80-86. A reference that resembles encoded
// secret material is rejected, so material can never be stored in the
// secretReference field.
function looksLikeSecretMaterial(value) {
  if (typeof value !== "string") return false;
  if (/^\s*(secret|password|passphrase|shared[_-]?secret)\s*=/i.test(value)) return true;
  if (/^[A-Za-z0-9+/]{24,}={0,2}$/.test(value)) return true;
  if (/^[0-9a-f]{32,}$/i.test(value)) return true;
  return false;
}

function validateSecretReference(reference) {
  if (typeof reference !== "string" || reference.trim().length === 0) {
    throw secretUnavailable(String(reference), "missing_reference");
  }
  if (reference.length > ROUTER_OS_MAX_SECRET_REFERENCE_LENGTH) {
    throw secretUnavailable("[REDACTED]", "reference_too_long");
  }
  if (hasControlOrSpace(reference)) {
    throw secretUnavailable("[REDACTED]", "reference_has_control_characters");
  }
  if (looksLikeSecretMaterial(reference)) {
    throw secretUnavailable(
      "[REDACTED]",
      "reference_looks_like_secret_material",
    );
  }
  return reference;
}

function validateResolvedSecret(secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw secretUnavailable("[REDACTED]", "resolver_returned_empty");
  }
  if (secret.length > ROUTER_OS_MAX_SECRET_LENGTH) {
    throw secretUnavailable("[REDACTED]", "resolved_secret_too_long");
  }
  return secret;
}

/**
 * Require the resolution context to be owner- and device-scoped.
 *
 * A resolver call without an ownerId is refused outright rather than resolving
 * globally. This is what prevents a cross-owner credential read.
 */
function requireScopedResolution(args = {}) {
  const { secretReference, ownerId, deviceId } = args;
  const reference = validateSecretReference(secretReference);

  if (typeof ownerId !== "string" || ownerId.length === 0) {
    throw secretUnavailable(reference, "owner_scope_required");
  }
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    throw secretUnavailable(reference, "device_scope_required");
  }
  return { secretReference: reference, ownerId, deviceId };
}

/**
 * Assert that a stored reference is bound to the device it is being resolved
 * for, when the reference carries a device binding. This makes a foreign
 * reference detectable rather than silently resolvable.
 */
function assertReferenceBoundToDevice(secretReference, deviceId) {
  const marker = "device/";
  const idx = secretReference.indexOf(marker);
  if (idx === -1) return secretReference; // opaque reference, no binding declared
  const rest = secretReference.slice(idx + marker.length);
  const bound = rest.split("/")[0];
  if (bound && bound !== deviceId) {
    throw secretUnavailable("[REDACTED]", "reference_not_bound_to_device", {
      expectedDeviceId: deviceId,
    });
  }
  return secretReference;
}

function createStaticTestSecretResolver(entries = {}) {
  const table = new Map(Object.entries(entries));
  return {
    mode: ROUTER_OS_SECRET_RESOLVER_MODES.STATIC_TEST,
    isProduction: false,
    async resolveSecret(args = {}) {
      const { secretReference } = requireScopedResolution(args);
      if (!table.has(secretReference)) {
        throw secretUnavailable(
          secretReference,
          "not_registered_in_test_resolver",
        );
      }
      return validateResolvedSecret(table.get(secretReference));
    },
    register(secretReference, secret) {
      table.set(secretReference, secret);
      return this;
    },
    listReferences() {
      return Array.from(table.keys());
    },
  };
}

function createDisabledProductionSecretResolver(options = {}) {
  const reason =
    options.reason || "production_secret_backend_not_configured";
  return {
    mode: ROUTER_OS_SECRET_RESOLVER_MODES.DISABLED_PRODUCTION,
    isProduction: true,
    async resolveSecret(args = {}) {
      const { secretReference } = requireScopedResolution(args);
      throw secretUnavailable(secretReference, reason);
    },
    listReferences() {
      return [];
    },
  };
}

/**
 * The intended production seam. Wraps an arbitrary async resolveFn, mirroring
 * createRadiusSecretResolver. resolveFn receives { secretReference, ownerId,
 * deviceId } so the backend can scope its own lookup.
 */
function createRouterOsSecretResolver(resolveFn, options = {}) {
  if (typeof resolveFn !== "function") {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      "RouterOS secret resolver requires a resolve function",
      { field: "resolve" },
    );
  }
  return {
    mode: options.mode || "custom",
    isProduction: options.isProduction === true,
    async resolveSecret(args = {}) {
      const scope = requireScopedResolution(args);
      assertReferenceBoundToDevice(scope.secretReference, scope.deviceId);
      const resolved = await resolveFn(scope);
      return validateResolvedSecret(resolved);
    },
    listReferences() {
      return [];
    },
  };
}

function assertSecretResolverUsable(resolver) {
  if (!resolver || typeof resolver.resolveSecret !== "function") {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
      "A RouterOS secret resolver is required",
      { reason: "resolver_missing" },
    );
  }
}

/**
 * Reject any device payload that tries to carry literal RouterOS secret
 * material. Called from the device write path.
 */
function assertNoLiteralSecretFields(input) {
  if (!input || typeof input !== "object") return input;
  const present = FORBIDDEN_DEVICE_SECRET_FIELDS.filter(
    (field) => input[field] !== undefined && input[field] !== null,
  );
  if (present.length > 0) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      "Device records must not contain literal RouterOS secret material",
      { forbiddenFields: present },
    );
  }
  return input;
}

module.exports = {
  ROUTER_OS_SECRET_RESOLVER_MODES,
  ROUTER_OS_MAX_SECRET_REFERENCE_LENGTH,
  ROUTER_OS_MAX_SECRET_LENGTH,
  FORBIDDEN_DEVICE_SECRET_FIELDS,
  createStaticTestSecretResolver,
  createDisabledProductionSecretResolver,
  createRouterOsSecretResolver,
  assertSecretResolverUsable,
  assertNoLiteralSecretFields,
  validateResolvedSecret,
  validateSecretReference,
  requireScopedResolution,
  assertReferenceBoundToDevice,
  secretUnavailable,
};