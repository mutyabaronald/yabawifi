const { radiusError, RADIUS_ERROR_CODES } = require("./errors");

const RADIUS_SECRET_RESOLVER_MODES = Object.freeze({
  STATIC_TEST: "static_test",
  DISABLED_PRODUCTION: "disabled_production",
});

function secretUnavailable(secretReference, reason) {
  return radiusError(
    RADIUS_ERROR_CODES.RADIUS_SECRET_UNAVAILABLE,
    "RADIUS shared secret is unavailable",
    { secretReference, reason },
  );
}

function validateResolvedSecret(secret, secretReference) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw secretUnavailable(secretReference, "resolver_returned_empty");
  }
  if (secret.length > 512) {
    throw secretUnavailable(secretReference, "resolved_secret_too_long");
  }
  return secret;
}

function createStaticTestSecretResolver(entries = {}) {
  const table = new Map(Object.entries(entries));

  return {
    mode: RADIUS_SECRET_RESOLVER_MODES.STATIC_TEST,
    isProduction: false,
    async resolveSecret(secretReference) {
      if (typeof secretReference !== "string" || secretReference.length === 0) {
        throw secretUnavailable(String(secretReference), "missing_reference");
      }
      if (!table.has(secretReference)) {
        throw secretUnavailable(secretReference, "not_registered_in_test_resolver");
      }
      return validateResolvedSecret(table.get(secretReference), secretReference);
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
    options.reason ||
    "production_secret_backend_not_configured";

  return {
    mode: RADIUS_SECRET_RESOLVER_MODES.DISABLED_PRODUCTION,
    isProduction: true,
    async resolveSecret(secretReference) {
      throw secretUnavailable(
        typeof secretReference === "string" ? secretReference : null,
        reason,
      );
    },
    listReferences() {
      return [];
    },
  };
}

function createRadiusSecretResolver(resolveFn, options = {}) {
  if (typeof resolveFn !== "function") {
    throw radiusError(
      RADIUS_ERROR_CODES.RADIUS_CONFIG_INVALID,
      "Radius secret resolver requires a resolve function",
      { field: "resolve" },
    );
  }
  return {
    mode: options.mode || "custom",
    isProduction: options.isProduction === true,
    async resolveSecret(secretReference) {
      if (typeof secretReference !== "string" || secretReference.length === 0) {
        throw secretUnavailable(String(secretReference), "missing_reference");
      }
      const resolved = await resolveFn(secretReference);
      return validateResolvedSecret(resolved, secretReference);
    },
    listReferences() {
      return [];
    },
  };
}

function assertSecretResolverUsable(resolver) {
  if (!resolver || typeof resolver.resolveSecret !== "function") {
    throw radiusError(
      RADIUS_ERROR_CODES.RADIUS_SECRET_UNAVAILABLE,
      "A radiusSecretResolver is required",
      { reason: "resolver_missing" },
    );
  }
}

module.exports = {
  RADIUS_SECRET_RESOLVER_MODES,
  createStaticTestSecretResolver,
  createDisabledProductionSecretResolver,
  createRadiusSecretResolver,
  assertSecretResolverUsable,
  validateResolvedSecret,
};