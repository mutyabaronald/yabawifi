/**
 * Phase 8.5C Step 3a - MikroTik RouterOS Transport Implementation
 *
 * Live transport using the mikrotik-api package (mikrotik-api@0.3.0).
 * Implements the transport interface expected by createRouterOsClient.
 *
 * This module provides a real RouterOS transport using the mikrotik-api package.
 * It is only used in production (NODE_ENV=production) when the global feature flag
 * ROAMING_MIKROTIK_API_ENABLED is enabled.
 */

const { MikrotikTransportFailure, TRANSPORT_FAILURE_KINDS, RETRIABLE_KINDS } = require("./routerOsClient");
const { mikrotikError, MIKROTIK_ERROR_CODES } = require("./errors");

const REDACTED = "[REDACTED]";

let createApiClient = null;

/**
 * Lazily load the mikrotik-api package (ES module) via dynamic import.
 */
async function loadMikrotikApi() {
  if (!createApiClient) {
    const { createApiClient: imported } = await import('mikrotik-api');
    createApiClient = imported;
  }
  return createApiClient;
}

/**
 * Classify connection errors into transport failure kinds.
 * @param {Error} err - The error to classify
 * @returns {MikrotikTransportFailure}
 */
function classifyConnectionError(err) {
  const message = err?.message || String(err);
  const kind = err?.kind || "connection";

  if (kind === "timeout" || message.includes("timeout")) {
    return new MikrotikTransportFailure(message, "timeout", true);
  }
  if (kind === "authentication" || message.includes("auth") || message.includes("login")) {
    return new MikrotikTransportFailure(message, "auth", false);
  }
  if (kind === "permission" || message.includes("permission")) {
    return new MikrotikTransportFailure(message, "permission", false);
  }
  if (kind === "closed" || message.includes("closed")) {
    return new MikrotikTransportFailure(message, "closed", false);
  }
  if (kind === "limit" || message.includes("limit")) {
    return new MikrotikTransportFailure(message, "limit", false);
  }
  if (kind === "router" || message.includes("router")) {
    return new MikrotikTransportFailure(message, "router", true);
  }

  return new MikrotikTransportFailure(message, "connection", true);
}

/**
 * Execute a command with timeout wrapper.
 * @param {Object} client - The MikroTikClient instance
 * @param {string} command - RouterOS command to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} Result object with { ok, data, alreadyExists, notFound }
 */
async function executeWithTimeout(client, command, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await client.exec(command, { signal: controller.signal });
    
    // Check for alreadyExists/notFound patterns in the result
    // RouterOS add commands may return { ret: "*N" } on success
    // RouterOS remove commands return empty on success
    const alreadyExists = Array.isArray(result) && result.length > 0 && 
      result.some(r => r && (r.ret === "alreadyExists" || r["!trap"] === "alreadyExists"));
    const notFound = Array.isArray(result) && result.length > 0 && 
      result.some(r => r && (r.category === "5" || r.category === 5)); // not found trap
    
    return { ok: true, data: result, alreadyExists, notFound };
  } catch (err) {
    if (err.name === "AbortError" || err.name === "TimeoutError" || (err.kind === "timeout")) {
      throw new MikrotikTransportFailure(`Command timeout after ${timeoutMs}ms`, "timeout", true);
    }
    // Check if it's an "already exists" trap
    if (err.message && (err.message.includes("already exists") || err.message.includes("already present"))) {
      return { ok: true, alreadyExists: true, data: null, notFound: false };
    }
    // Check if it's a "not found" trap
    if (err.message && err.message.includes("no such item") || err.category === "5") {
      return { ok: true, notFound: true, data: null, alreadyExists: false };
    }
    throw classifyConnectionError(err);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Create a real MikroTik RouterOS transport using the mikrotik-api package.
 *
 * @param {Object} options
 * @param {string} options.host - Router hostname or IP address
 * @param {number} options.port - Router API port (default 8728, or 8729 for TLS)
 * @param {boolean} options.tls - Whether to use TLS (port 8729)
 * @param {Object} options.credentials - { username, password }
 * @param {number} options.timeoutMs - Command timeout in ms
 * @param {number} options.retries - Number of retries (for compatibility)
 * @param {number} options.connectTimeoutMs - Connection timeout in ms
 * @returns {Object} Transport object with execute method
 */
async function createMikroTikTransport(options = {}) {
  const config = options || {};
  const host = config.host;
  const port = config.port;
  const tls = config.tls === true;
  const tlsOptions = config.tlsOptions || {};
  const credentials = config.credentials;
  const timeoutMs = config.timeoutMs || 5000;
  const retries = config.retries || 0;
  const connectTimeoutMs = config.connectTimeoutMs || 10000;

  if (!host || typeof host !== "string") {
    throw new Error("Transport requires a host");
  }
  if (typeof port !== "number" || port < 1 || port > 65535) {
    throw new Error("Transport requires a valid port number");
  }
  if (!credentials || !credentials.username || !credentials.password) {
    throw new Error("Transport requires credentials (username and password)");
  }
  if (typeof tlsOptions !== "object" || tlsOptions === null) {
    throw new Error("tlsOptions must be an object");
  }

  let client = null;

  /**
   * Execute a RouterOS command via the mikrotik-api client.
   * @param {Object} request
   * @param {string} request.command - RouterOS command to execute
   * @param {number} request.attempt - Attempt number (for retries)
   * @param {number} request.timeoutMs - Timeout for this specific call
   * @returns {Promise<Object>} Result object
   */
  async function execute(request) {
    const req = request && typeof request === "object" ? request : {};
    const command = req.command;
    const attempt = req.attempt || 1;
    const cmdTimeoutMs = req.timeoutMs || timeoutMs;

    if (!command || typeof command !== "string") {
      throw new Error("Execute requires a command string");
    }

    if (!client) {
      await loadMikrotikApi();
      client = createApiClient({
        host,
        port,
        tls: tls || false,
        username: credentials.username,
        password: credentials.password,
        ...(tls ? { tls: tlsOptions } : {}),
        commandTimeoutMs: cmdTimeoutMs,
        connectTimeoutMs,
      });
    }

    const result = await executeWithTimeout(client, command, cmdTimeoutMs);
    return result;
  }

  /**
   * Close the connection and clean up.
   */
  async function close() {
    if (client) {
      try {
        await client.close();
      } catch (err) {
        // Ignore close errors
      }
      client = null;
    }
  }

  const transport = {
    name: `mikrotik-routeros-${host}:${port}`,

    execute,
    close,

    get name() {
      return `mikrotik-routeros-${host}:${port}`;
    }
  };

  return Object.freeze(transport);
}

module.exports = { createMikroTikTransport };