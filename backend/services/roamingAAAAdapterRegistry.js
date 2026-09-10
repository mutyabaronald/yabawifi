const { RoamingAAAAdapter, RoamingAAAAdapterError } = require("./roamingAAAAdapter");

const ADAPTER_STATES = Object.freeze(["registered", "enabled", "disabled", "error"]);

class RoamingAAAAdapterRegistryError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "RoamingAAAAdapterRegistryError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class RoamingAAAAdapterEntry {
  constructor(adapter, options = {}) {
    if (!adapter || typeof adapter !== "object") {
      throw new RoamingAAAAdapterRegistryError(
        400,
        "REGISTRATION_ERROR",
        "Adapter instance is required"
      );
    }
    if (!adapter.aaaAdapterKey || typeof adapter.aaaAdapterKey !== "string") {
      throw new RoamingAAAAdapterRegistryError(
        400,
        "REGISTRATION_ERROR",
        "Adapter must have a string aaaAdapterKey"
      );
    }
    this.adapter = adapter;
    this.enabled = options.enabled !== false;
    this.state = this.enabled ? "enabled" : "disabled";
    this.registeredAt = new Date().toISOString();
    this.lastError = null;
    this.lastCheckedAt = null;
  }

  disable() {
    this.enabled = false;
    this.state = "disabled";
  }

  enable() {
    this.enabled = true;
    this.state = "enabled";
  }

  markError(err) {
    this.lastError = err ? err.message : null;
    this.lastCheckedAt = new Date().toISOString();
    if (this.enabled) {
      this.state = "error";
    }
  }

  clearError() {
    this.lastError = null;
    this.lastCheckedAt = new Date().toISOString();
    if (this.enabled) {
      this.state = "enabled";
    }
  }

  isAvailable() {
    return this.enabled && this.state !== "error";
  }

  getCapabilities() {
    if (typeof this.adapter.getCapabilities === "function") {
      return this.adapter.getCapabilities();
    }
    return {};
  }

  canPerform(operation) {
    const caps = this.getCapabilities();
    return Boolean(caps[operation]);
  }
}

const ADAPTERS = new Map();

function registerAAAAdapter(adapter, options = {}) {
  if (!adapter || typeof adapter !== "object") {
    throw new RoamingAAAAdapterRegistryError(
      400,
      "REGISTRATION_ERROR",
      "Adapter instance is required"
    );
  }
  if (!adapter.aaaAdapterKey || typeof adapter.aaaAdapterKey !== "string") {
    throw new RoamingAAAAdapterRegistryError(
      400,
      "REGISTRATION_ERROR",
      "Adapter must have a string aaaAdapterKey"
    );
  }
  const key = adapter.aaaAdapterKey;
  if (ADAPTERS.has(key)) {
    throw new RoamingAAAAdapterRegistryError(
      409,
      "DUPLICATE_REGISTRATION",
      `Adapter with key "${key}" is already registered`
    );
  }
  ADAPTERS.set(key, new RoamingAAAAdapterEntry(adapter, options));
  return key;
}

function unregisterAAAAdapter(key) {
  if (!ADAPTERS.has(key)) {
    throw new RoamingAAAAdapterRegistryError(
      404,
      "ADAPTER_NOT_FOUND",
      `Adapter with key "${key}" not found`
    );
  }
  ADAPTERS.delete(key);
  return true;
}

function resolveAAAAdapter(key) {
  if (!key || typeof key !== "string") {
    throw new RoamingAAAAdapterRegistryError(
      400,
      "RESOLUTION_ERROR",
      "Adapter key is required"
    );
  }
  const entry = ADAPTERS.get(key);
  if (!entry) {
    throw new RoamingAAAAdapterRegistryError(
      404,
      "ADAPTER_NOT_FOUND",
      `No adapter registered for key "${key}"`
    );
  }
  if (!entry.isAvailable()) {
    throw new RoamingAAAAdapterRegistryError(
      503,
      "ADAPTER_UNAVAILABLE",
      `Adapter "${key}" is not available (state: ${entry.state})`
    );
  }
  return entry.adapter;
}

function getAAAAdapterEntry(key) {
  return ADAPTERS.get(key);
}

function listAAAAdapters() {
  const result = [];
  for (const [key, entry] of ADAPTERS) {
    result.push({
      key,
      state: entry.state,
      enabled: entry.enabled,
      capabilities: entry.getCapabilities(),
      registeredAt: entry.registeredAt,
      lastCheckedAt: entry.lastCheckedAt,
    });
  }
  return result;
}

function listEnabledAAAAdapters() {
  return listAAAAdapters().filter((a) => a.enabled && a.state !== "error");
}

function isAAAAdapterAvailable(key) {
  const entry = ADAPTERS.get(key);
  return Boolean(entry && entry.isAvailable());
}

function disableAAAAdapter(key) {
  const entry = ADAPTERS.get(key);
  if (!entry) {
    throw new RoamingAAAAdapterRegistryError(
      404,
      "ADAPTER_NOT_FOUND",
      `No adapter registered for key "${key}"`
    );
  }
  entry.disable();
  return true;
}

function enableAAAAdapter(key) {
  const entry = ADAPTERS.get(key);
  if (!entry) {
    throw new RoamingAAAAdapterRegistryError(
      404,
      "ADAPTER_NOT_FOUND",
      `No adapter registered for key "${key}"`
    );
  }
  entry.enable();
  return true;
}

function checkAAAAdapterHealth(key) {
  const entry = ADAPTERS.get(key);
  if (!entry) {
    throw new RoamingAAAAdapterRegistryError(
      404,
      "ADAPTER_NOT_FOUND",
      `No adapter registered for key "${key}"`
    );
  }
  const result = { key, healthy: false, state: entry.state };
  try {
    if (typeof entry.adapter.checkHealth === "function") {
      const health = entry.adapter.checkHealth();
      result.healthy = health && health.healthy === true;
      result.details = health;
    }
    entry.clearError();
    result.state = entry.state;
  } catch (err) {
    entry.markError(err);
    result.state = entry.state;
    result.error = err.message;
  }
  return result;
}

module.exports = {
  RoamingAAAAdapterRegistryError,
  RoamingAAAAdapterEntry,
  ADAPTER_STATES,
  registerAAAAdapter,
  unregisterAAAAdapter,
  resolveAAAAdapter,
  getAAAAdapterEntry,
  listAAAAdapters,
  listEnabledAAAAdapters,
  isAAAAdapterAvailable,
  disableAAAAdapter,
  enableAAAAdapter,
  checkAAAAdapterHealth,
};
