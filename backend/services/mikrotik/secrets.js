const crypto = require("crypto");
const { db } = require("../../firebase");
const { mikrotikError, MIKROTIK_ERROR_CODES } = require("./errors");

const ROUTER_OS_SECRET_RESOLVER_MODES = Object.freeze({
  STATIC_TEST: "static_test",
  DISABLED_PRODUCTION: "disabled_production",
  PRODUCTION_ENCRYPTED: "production_encrypted",
});

const ROUTER_OS_MAX_SECRET_REFERENCE_LENGTH = 512;
const ROUTER_OS_MAX_SECRET_LENGTH = 512;

// Encryption constants
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const ENCRYPTION_KEY_ENV_VAR = "MIKROTIK_SECRET_ENCRYPTION_KEY";
const ENCRYPTION_KEY_DEV_DEFAULT = "dev_mikrotik_encryption_key_not_for_production_32bytes!!";
const SECRETS_COLLECTION = "mikrotik_secrets";

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

function resolveEncryptionKey(injectedKey) {
  if (typeof injectedKey === "string" && injectedKey.length > 0) {
    if (injectedKey === ENCRYPTION_KEY_DEV_DEFAULT && process.env.NODE_ENV === "production") {
      throw mikrotikError(
        MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
        "The development encryption key is not permitted in production",
        { field: "encryptionKey" },
      );
    }
    return injectedKey;
  }

  const fromEnv = process.env[ENCRYPTION_KEY_ENV_VAR];
  if (typeof fromEnv === "string" && fromEnv.length > 0 && fromEnv !== ENCRYPTION_KEY_DEV_DEFAULT) {
    return fromEnv;
  }

  if (process.env.NODE_ENV === "production") {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      `A MikroTik secret encryption key is required in production. Set ${ENCRYPTION_KEY_ENV_VAR}.`,
      { field: "encryptionKey" },
    );
  }

  return ENCRYPTION_KEY_DEV_DEFAULT;
}

function deriveEncryptionKey(rawKey) {
  // Use HKDF-SHA256 to derive a 32-byte key from the raw key
  // Using Node.js built-in HKDF via crypto.hkdfSync
  return crypto.hkdfSync("sha256", rawKey, "", "mikrotik-secret-encryption", KEY_LENGTH);
}

function encryptSecret(plaintext, key) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      "Secret must be a non-empty string",
      { field: "secret" },
    );
  }
  if (plaintext.length > ROUTER_OS_MAX_SECRET_LENGTH) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      "Secret exceeds maximum length",
      { field: "secret", maxLength: ROUTER_OS_MAX_SECRET_LENGTH },
    );
  }

  const derivedKey = deriveEncryptionKey(key);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, derivedKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: iv + ciphertext + authTag (all base64 encoded)
  return Buffer.concat([iv, ciphertext, authTag]).toString("base64");
}

function decryptSecret(ciphertext, key) {
  if (typeof ciphertext !== "string" || ciphertext.length === 0) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
      "Ciphertext is required for decryption",
      { field: "ciphertext" },
    );
  }

  try {
    const data = Buffer.from(ciphertext, "base64");
    if (data.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
      throw mikrotikError(
        MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
        "Invalid ciphertext format",
        { field: "ciphertext" },
      );
    }

    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH);

    const derivedKey = deriveEncryptionKey(key);
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (err) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
      "Failed to decrypt secret",
      { reason: "decryption_failed", originalError: err.message },
    );
  }
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
 * Production secret resolver using encrypted Firestore storage.
 * Secrets are stored encrypted with AES-256-GCM, keyed by a master encryption key.
 * Each secret is scoped to an owner and device.
 */
function createProductionSecretResolver(options = {}) {
  const injectedKey = options.encryptionKey || null;

  const encryptionKey = resolveEncryptionKey(injectedKey);

  return {
    mode: ROUTER_OS_SECRET_RESOLVER_MODES.PRODUCTION_ENCRYPTED,
    isProduction: true,
    async resolveSecret(args = {}) {
      const { secretReference, ownerId, deviceId } = requireScopedResolution(args);
      assertReferenceBoundToDevice(secretReference, deviceId);

      // Fetch encrypted secret from Firestore
      const secretDoc = await db.collection(SECRETS_COLLECTION).doc(secretReference).get();
      if (!secretDoc.exists) {
        throw secretUnavailable(secretReference, "not_found");
      }

      const data = secretDoc.data() || {};

      // Verify owner and device binding
      if (data.ownerId !== ownerId) {
        throw secretUnavailable(secretReference, "owner_mismatch");
      }
      if (data.deviceId !== deviceId) {
        throw secretUnavailable(secretReference, "device_mismatch");
      }

      if (data.revokedAt) {
        throw secretUnavailable(secretReference, "revoked");
      }

      // Decrypt the secret
      const plaintext = decryptSecret(data.encryptedSecret, data.encryptionKeyId || "default");

      // Validate the resolved secret
      return validateResolvedSecret(plaintext);
    },
    listReferences() {
      return [];
    },
  };
}

/**
 * Store a new secret for a device. For administrative use only.
 */
async function storeSecret(secretReference, plaintext, ownerId, deviceId, encryptionKeyId = "default") {
  const reference = validateSecretReference(secretReference);
  assertReferenceBoundToDevice(reference, deviceId);

  if (typeof ownerId !== "string" || ownerId.length === 0) {
    throw mikrotikError(MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID, "ownerId is required", { field: "ownerId" });
  }
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    throw mikrotikError(MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID, "deviceId is required", { field: "deviceId" });
  }

  const encryptedSecret = encryptSecret(plaintext, resolveEncryptionKey());

  await db.collection(SECRETS_COLLECTION).doc(secretReference).set({
    encryptedSecret,
    ownerId,
    deviceId,
    encryptionKeyId,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  });

  return { secretReference, stored: true };
}

/**
 * Revoke a secret (mark as revoked without deleting).
 */
async function revokeSecret(secretReference, ownerId, deviceId) {
  const reference = validateSecretReference(secretReference);
  assertReferenceBoundToDevice(reference, deviceId);

  const secretDoc = await db.collection(SECRETS_COLLECTION).doc(reference).get();
  if (!secretDoc.exists) {
    throw mikrotikError(MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE, "Secret not found", { secretReference: reference });
  }

  const data = secretDoc.data() || {};
  if (data.ownerId !== ownerId) {
    throw mikrotikError(MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID, "Owner mismatch", { field: "ownerId" });
  }
  if (data.deviceId !== deviceId) {
    throw mikrotikError(MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID, "Device mismatch", { field: "deviceId" });
  }

  await db.collection(SECRETS_COLLECTION).doc(reference).update({
    revokedAt: new Date().toISOString(),
  });

  return { secretReference, revoked: true };
}

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
  createProductionSecretResolver,
  storeSecret,
  revokeSecret,
  assertSecretResolverUsable,
  assertNoLiteralSecretFields,
  validateResolvedSecret,
  validateSecretReference,
  requireScopedResolution,
  assertReferenceBoundToDevice,
  secretUnavailable,
  mikrotikError,
  MIKROTIK_ERROR_CODES,
  encryptSecret,
  decryptSecret,
  resolveEncryptionKey,
  deriveEncryptionKey,
  storeSecret,
  revokeSecret,
};