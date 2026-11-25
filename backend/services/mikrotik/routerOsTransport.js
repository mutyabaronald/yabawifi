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
 * Lazily load the mikrotik-api package (ES module) via dynamic internet import.
 * Private to the module; not exported.
 */
async function loadMikrotikApi() {
  if (!createApiClient) {
    const { createApiClient: imported } = await import('mikrotik-api/api');
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
    return new MikrotikTransportFailure("timeout", message, true);
  }
  if (kind === "authentication" || message.includes("auth") || message.includes("login")) {
    return new MikrotikTransportFailure("auth", message, false);
  }
  if (kind === "permission" || message.includes("permission")) {
    return new MikrotikTransportFailure("permission", message, false);
  }
  if (kind === "closed" || message.includes("closed")) {
    return new MikrotikTransportFailure("closed", message, false);
  }
  if (kind === "limit" || message.includes("limit")) {
    return new MikrotikTransportFailure("limit", message, false);
  }
  if (kind === "router" || message.includes("router")) {
    return new MikrotikTransportFailure("router", message, true);
  }

  return new MikrotikTransportFailure("connection", message, true);
}

/**
 * Parse a RouterOS command string into a path and params object.
 *
 * Command format: "/ip hotspot user add name=x password=y profile=z"
 * Returns: { path: "ip/hotspot/user/add", params: { name: "x", password: "y", profile: "z" } }
 *
 * Handles:
 *   - Leading slash (stripped)
 *   - Space-separated path segments (joined with /)
 *   - key=value parameters (unquoted)
 *   - Quoted values (single or double quotes stripped)
 *   - Commands with no parameters (e.g., "/system identity print")
 *
 * @param {string} command - The full command string
 * @returns {{ path: string, params: Object }}
 * @throws {Error} if command is not a non-empty string
 */
function parseCommand(command) {
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("parseCommand requires a non-empty string");
  }

  // Tokenize respecting quoted strings (single and double quotes).
  const tokens = [];
  let current = "";
  let inQuote = null;
  let i = 0;
  const str = command.trim();

  while (i < str.length) {
    const ch = str[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      }
      current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
    } else if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
    i++;
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  // Separate path segments from key=value parameters.
  // Path segments come first (until we hit a key=value token).
  const pathParts = [];
  const params = {};
  let inParams = false;

  for (const token of tokens) {
    const eqIndex = token.indexOf("=");
    if (eqIndex > 0 && !inParams) {
      // Check if this looks like a key=value (key has no spaces, no slash)
      const key = token.slice(0, eqIndex);
      if (!key.includes(" ") && !key.includes("/")) {
        inParams = true;
      }
    }

    if (inParams) {
      // Find the = in the token (handle quoted values)
      const eqIdx = token.indexOf("=");
      if (eqIdx > 0) {
        const key = token.slice(0, eqIdx);
        let value = token.slice(eqIdx + 1);
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        params[key] = value;
      }
    } else {
      pathParts.push(token);
    }
  }

  const path = pathParts.join(" ").replace(/^\/+/, "").replace(/\s+/g, "/");

  return { path, params };
}


/**
 * Execute a command with timeout wrapper.
 * @param {Object} client - The MikroTikClient instance
 * @param {string} command - RouterOS command to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} Result object with { ok, data, alreadyExists, notFound }
 */
async function executeWithTimeout(client, path, params, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await client.exec(path, { params, signal: controller.signal });

    // mikrotik-api v0.3.0 returns success results as arrays of records
    // (e.g., [{ ret: "*1" }] for add, [] for remove). "already exists" and
    // "not found" conditions are reported as thrown MikroTikError objects,
    // not as result-array entries, so they are handled in the catch block below.
    return { ok: true, data: result, alreadyExists: false, notFound: false };
  } catch (err) {
    if (err.name === "AbortError" || err.name === "TimeoutError" || (err.kind === "timeout")) {
      throw new MikrotikTransportFailure(`Command timeout after ${timeoutMs}ms`, "timeout", true);
    }
    // Check if it's an "already exists" trap
    if (err.message && (err.message.includes("already exists") || err.message.includes("already present"))) {
      return { ok: true, alreadyExists: true, data: null, notFound: false };
    }
    // Check if it's a "not found" trap. mikrotik-api throws MikroTikError
    // with kind "router" and category 5 (not found) for missing items.
    if ((err.message && err.message.includes("no such item")) || err.category === 5) {
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
function createMikroTikTransport(options = {}, loadApi = loadMikrotikApi) {
  const config = options || {};
  const host = config.host;
  const port = config.port;
  const tls = config.tls === true;
  const tlsOptions = config.tlsOptions || {};
  let credentials = config.credentials;
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
  let closed = false;

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

    if (closed) {
      throw new Error("Transport is closed");
    }

    const { path: cmdPath, params } = parseCommand(command);

    if (!client) {
      const apiClientFactory = await loadApi();
      if (closed) {
        throw new Error("Transport is closed");
      }
      client = apiClientFactory({
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

    const result = await executeWithTimeout(client, cmdPath, params, cmdTimeoutMs);
    return result;
  }

  /**
   * Close the connection and clean up.
   */
  async function close() {
    closed = true;
    if (client) {
      const clientToClose = client;
      client = null;
      try {
        await clientToClose.close();
      } catch (err) {
        // Ignore close errors
      }
    }
    credentials = null;
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

module.exports = { createMikroTikTransport, parseCommand, classifyConnectionError, executeWithTimeout };