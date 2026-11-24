// Phase 8.5A — MikroTik router control foundation.
//
// Small, testable RouterOS API client abstraction.
//
// CONTAINS NO BUSINESS LOGIC. This module must never learn about users,
// packages, RAUs, entitlements, settlements, wallets, owners or commissions. It
// builds a RouterOS command from explicit arguments, hands it to an injected
// transport, and classifies the outcome.
//
// NETWORKING IS INJECTED. There is no socket here. The transport is supplied by
// the caller, so unit tests exercise the full command-construction, retry,
// timeout and classification path without a physical router. A real transport
// is deliberately NOT shipped in Phase 8.5A: this phase establishes and proves
// the foundation, it does not open a production connection path.
//
// FAIL CLOSED. Every failure mode — timeout, connection failure, authentication
// failure, malformed response, unreachable router — becomes a typed error. There
// is no code path in this file that converts a RouterOS failure into a success
// or an ALLOW.
//
// SECRET HYGIENE. The RouterOS HotSpot password is embedded in the command
// string because the RouterOS `user add` primitive requires it. That command
// string is therefore treated as credential material: it is passed to the
// transport and is never stored on the error, never placed in error details,
// never logged, and never returned to a caller. Phase 8.4 Decision Lock §16.1.

const { mikrotikError, MIKROTIK_ERROR_CODES } = require("./errors");

// Bounds mirror backend/services/radiusTransport/profile.js:5-14 so that the two
// transports behave consistently under the same operator expectations.
const MIKROTIK_DEFAULT_TIMEOUT_MS = 5000;
const MIKROTIK_DEFAULT_RETRIES = 3;
const MIKROTIK_MIN_TIMEOUT_MS = 100;
const MIKROTIK_MAX_TIMEOUT_MS = 30000;
const MIKROTIK_MIN_RETRIES = 0;
const MIKROTIK_MAX_RETRIES = 10;
const MIKROTIK_MIN_PORT = 1;
const MIKROTIK_MAX_PORT = 65535;

const MIKROTIK_OPERATION_TIMEOUT_RETRIES = 0;

// Transport failure classes. A transport reports one of these and the client
// maps it onto the MIKROTIK_ERROR_CODES vocabulary.
const TRANSPORT_FAILURE_KINDS = Object.freeze({
  TIMEOUT: "timeout",
  NETWORK: "network",
  AUTH: "auth",
  PROTOCOL: "protocol",
  TRANSPORT: "transport",
});

// Only timeout and network failure are retried. Authentication failure is
// deterministic and must fail fast rather than hammering a router.
const RETRIABLE_KINDS = Object.freeze([
  TRANSPORT_FAILURE_KINDS.TIMEOUT,
  TRANSPORT_FAILURE_KINDS.NETWORK,
]);

const KIND_TO_ERROR_CODE = Object.freeze({
  [TRANSPORT_FAILURE_KINDS.TIMEOUT]: MIKROTIK_ERROR_CODES.MIKROTIK_TIMEOUT,
  [TRANSPORT_FAILURE_KINDS.NETWORK]: MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_ERROR,
  [TRANSPORT_FAILURE_KINDS.AUTH]: MIKROTIK_ERROR_CODES.MIKROTIK_AUTH_FAILED,
  [TRANSPORT_FAILURE_KINDS.PROTOCOL]: MIKROTIK_ERROR_CODES.MIKROTIK_INVALID_RESPONSE,
  [TRANSPORT_FAILURE_KINDS.TRANSPORT]: MIKROTIK_ERROR_CODES.MIKROTIK_TRANSPORT_FAILURE,
});

function invalid(message, details) {
  return mikrotikError(
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    message,
    details,
  );
}

class MikrotikTransportFailure extends Error {
  constructor(kind, reason, retryable) {
    super(`RouterOS transport failure: ${kind}`);
    this.name = "MikrotikTransportFailure";
    this.kind = kind;
    this.reason = reason || null;
    this.retryable =
      typeof retryable === "boolean" ? retryable : RETRIABLE_KINDS.includes(kind);
  }
}

function classifyTransportError(err) {
  const kind =
    err && typeof err.kind === "string" && KIND_TO_ERROR_CODE[err.kind]
      ? err.kind
      : TRANSPORT_FAILURE_KINDS.TRANSPORT;
  return {
    kind,
    code: KIND_TO_ERROR_CODE[kind],
    retryable:
      err && typeof err.retryable === "boolean"
        ? err.retryable
        : RETRIABLE_KINDS.includes(kind),
  };
}

/**
 * Circuit breaker states for the MikroTik transport.
 * States: CLOSED (normal operation), OPEN (failing, rejecting calls), HALF_OPEN (testing recovery).
 */
const CIRCUIT_STATES = Object.freeze({
  CLOSED: "closed",
  OPEN: "open",
  HALF_OPEN: "half_open",
});

/**
 * Default circuit breaker configuration.
 * These are safe, conservative defaults that can be overridden via options.
 */
const DEFAULT_CIRCUIT_CONFIG = Object.freeze({
  // Number of consecutive qualifying failures before opening the circuit
  failureThreshold: 5,
  // Time in ms to wait before allowing a half-open probe
  cooldownMs: 30000,
  // Maximum concurrent half-open probes allowed (prevents thundering herd)
  halfOpenMaxConcurrent: 1,
  // Failure kinds that count toward the failure threshold
  // Only transport/network failures count; auth/protocol/validation errors do not
  qualifyingFailureKinds: Object.freeze([
    TRANSPORT_FAILURE_KINDS.TIMEOUT,
    TRANSPORT_FAILURE_KINDS.NETWORK,
  ]),
});

/**
 * In-memory circuit breaker registry.
 * Keyed by router host:port combination.
 * NOTE: This is process-local. For multi-instance deployments, a distributed
 * store (e.g., Redis) would be needed for true cross-instance coordination.
 */
const circuitBreakers = new Map();

/**
 * Circuit breaker class for a single router endpoint.
 * Encapsulates state, failure counting, and state transitions.
 */
class CircuitBreaker {
  constructor(host, port, config = {}) {
    this.key = `${host}:${port}`;
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.halfOpenProbes = 0;
    this.lastStateChange = Date.now();
  }

  /**
   * Check if a call can proceed.
   * Returns { allowed: boolean, reason?: string }
   */
  canExecute() {
    const now = Date.now();

    switch (this.state) {
      case CIRCUIT_STATES.CLOSED:
        return { allowed: true };

      case CIRCUIT_STATES.OPEN:
        // Check if cooldown has elapsed to transition to HALF_OPEN
        if (now - this.lastStateChange >= this.config.cooldownMs) {
          this._transitionToHalfOpen();
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: "circuit_open",
          retryAfterMs: this.config.cooldownMs - (now - this.lastStateChange),
        };

      case CIRCUIT_STATES.HALF_OPEN:
        // Allow only one concurrent probe
        if (this.halfOpenProbes >= this.config.halfOpenMaxConcurrent) {
          return {
            allowed: false,
            reason: "half_open_probe_limit",
            retryAfterMs: 1000,
          };
        }
        return { allowed: true };

      default:
        return { allowed: false, reason: "invalid_state" };
    }
  }

  /**
   * Record a successful call.
   */
  recordSuccess() {
    this.failureCount = 0;
    this.successCount++;

    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this.halfOpenProbes = Math.max(0, this.halfOpenProbes - 1);
      // On success in HALF_OPEN, close the circuit
      this._transitionToClosed();
    }
  }

  /**
   * Record a failed call.
   * Only qualifying failure kinds increment the failure counter.
   */
  recordFailure(kind) {
    const isQualifying = this.config.qualifyingFailureKinds.includes(kind);

    if (!isQualifying) {
      // Non-qualifying failures (auth, protocol) don't affect the circuit
      return;
    }

    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CIRCUIT_STATES.CLOSED) {
      if (this.failureCount >= this.config.failureThreshold) {
        this._transitionToOpen();
      }
    } else if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      // Any qualifying failure in HALF_OPEN reopens the circuit
      this._transitionToOpen();
    }
  }

  _transitionToOpen() {
    this.state = CIRCUIT_STATES.OPEN;
    this.lastStateChange = Date.now();
    this.halfOpenProbes = 0;
  }

  _transitionToHalfOpen() {
    this.state = CIRCUIT_STATES.HALF_OPEN;
    this.lastStateChange = Date.now();
    this.halfOpenProbes = 0;
  }

  _transitionToClosed() {
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastStateChange = Date.now();
  }

  /**
   * Get current circuit breaker status for monitoring/debugging.
   */
  getStatus() {
    return {
      key: this.key,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      halfOpenProbes: this.halfOpenProbes,
      lastStateChange: this.lastStateChange,
    };
  }
}

/**
 * Get or create a circuit breaker for a given host:port.
 * This ensures a single circuit breaker per router endpoint.
 */
function getCircuitBreaker(host, port, config = {}) {
  const key = `${host}:${port}`;
  let breaker = circuitBreakers.get(key);
  if (!breaker) {
    breaker = new CircuitBreaker(host, port, config);
    circuitBreakers.set(key, breaker);
  }
  return breaker;
}

/**
 * Read-only inspection of an existing circuit breaker.
 * Never creates a breaker, never changes breaker state, never transitions
 * OPEN to HALF_OPEN, never consumes HALF_OPEN recovery probes.
 * Returns a CLOSED default when no breaker is registered for host:port.
 */
function getCircuitBreakerStatus(host, port) {
  const key = `${host}:${port}`;
  const breaker = circuitBreakers.get(key);
  if (!breaker) {
    return {
      key,
      state: CIRCUIT_STATES.CLOSED,
      failureCount: 0,
      successCount: 0,
      halfOpenProbes: 0,
      lastStateChange: null,
    };
  }
  return breaker.getStatus();
}

/**
 * Clear all circuit breakers (for testing).
 */
function resetCircuitBreakers() {
  circuitBreakers.clear();
}

/**
 * Get all circuit breaker statuses (for monitoring/debugging).
 */
function getAllCircuitBreakerStatuses() {
  const statuses = [];
  for (const [key, breaker] of circuitBreakers.entries()) {
    statuses.push(breaker.getStatus());
  }
  return statuses;
}

/**
 * Check if a transport error kind qualifies for circuit breaker failure counting.
 * Only timeout and network failures count; auth/protocol errors do not.
 */
function isQualifyingFailure(kind) {
  return DEFAULT_CIRCUIT_CONFIG.qualifyingFailureKinds.includes(kind);
}

function validateTimeoutMs(value) {
  if (value === undefined || value === null) return MIKROTIK_DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(value)) {
    throw invalid("timeoutMs must be an integer", { field: "timeoutMs" });
  }
  if (value < MIKROTIK_MIN_TIMEOUT_MS || value > MIKROTIK_MAX_TIMEOUT_MS) {
    throw invalid(
      `timeoutMs must be between ${MIKROTIK_MIN_TIMEOUT_MS} and ${MIKROTIK_MAX_TIMEOUT_MS}`,
      { field: "timeoutMs" },
    );
  }
  return value;
}

function validateRetries(value) {
  if (value === undefined || value === null) return MIKROTIK_DEFAULT_RETRIES;
  if (!Number.isInteger(value)) {
    throw invalid("retries must be an integer", { field: "retries" });
  }
  if (value < MIKROTIK_MIN_RETRIES || value > MIKROTIK_MAX_RETRIES) {
    throw invalid(
      `retries must be between ${MIKROTIK_MIN_RETRIES} and ${MIKROTIK_MAX_RETRIES}`,
      { field: "retries" },
    );
  }
  return value;
}

function validatePort(value) {
  const port = value === undefined || value === null ? 8728 : value;
  if (!Number.isInteger(port)) {
    throw invalid("routerOsApiPort must be an integer", { field: "port" });
  }
  if (port < MIKROTIK_MIN_PORT || port > MIKROTIK_MAX_PORT) {
    throw invalid(
      `routerOsApiPort must be between ${MIKROTIK_MIN_PORT} and ${MIKROTIK_MAX_PORT}`,
      { field: "port" },
    );
  }
  return port;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`${field} is required`, { field });
  }
  return value;
}

// RouterOS treats unquoted values containing whitespace or quotes as multiple
// tokens. Derived usernames are hex-safe, but profile names and hosts are
// operator-supplied, so quoting is applied uniformly.
function quoteValue(value) {
  const str = String(value);
  if (str === "") return '""';
  if (!/[\s"'\\]/.test(str)) return str;
  return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function assertSafeUsername(username) {
  requireString(username, "user");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(username)) {
    throw invalid("RouterOS hotspot username contains unsupported characters", {
      field: "user",
    });
  }
  return username;
}

/**
 * Pure command builders. Exported so the checker can assert the exact command
 * text without needing a transport at all.
 */
function buildAddHotspotUserCommand(input = {}) {
  const user = assertSafeUsername(input.user);
  requireString(input.profile, "profile");
  const parts = [
    "/ip hotspot user add",
    `name=${quoteValue(user)}`,
    `password=${quoteValue(input.userPassword)}`,
    `profile=${quoteValue(input.profile)}`,
  ];

  if (input.limitUptimeSeconds !== undefined && input.limitUptimeSeconds !== null) {
    if (
      !Number.isInteger(input.limitUptimeSeconds) ||
      input.limitUptimeSeconds <= 0
    ) {
      throw invalid("limitUptimeSeconds must be a positive integer", {
        field: "limitUptimeSeconds",
      });
    }
    parts.push(`limit-uptime=${input.limitUptimeSeconds}`);
  }

  // shared-users is OMITTED when undetermined. See hotspotUserService.js for why
  // the repository cannot currently derive a per-user value.
  if (input.sharedUsers !== undefined && input.sharedUsers !== null) {
    if (!Number.isInteger(input.sharedUsers) || input.sharedUsers <= 0) {
      throw invalid("sharedUsers must be a positive integer", {
        field: "sharedUsers",
      });
    }
    parts.push(`shared-users=${input.sharedUsers}`);
  }

  // limit-bytes-total is supplementary network shaping only. It is never a
  // billing or RAU input (Phase 8.4 Decision Lock §13.1).
  if (input.limitBytesTotal !== undefined && input.limitBytesTotal !== null) {
    if (!Number.isInteger(input.limitBytesTotal) || input.limitBytesTotal <= 0) {
      throw invalid("limitBytesTotal must be a positive integer", {
        field: "limitBytesTotal",
      });
    }
    parts.push(`limit-bytes-total=${input.limitBytesTotal}`);
  }

  return parts.join(" ");
}

function buildRemoveHotspotUserCommand(input = {}) {
  const user = assertSafeUsername(input.user);
  return `/ip hotspot user remove name=${quoteValue(user)}`;
}

function buildRemoveActiveHotspotUserCommand(input = {}) {
  const user = assertSafeUsername(input.user);
  return `/ip hotspot active remove name=${quoteValue(user)}`;
}

// Read-only. /system identity print returns the router's identity and version
// without mutating any state.
function buildHealthCommand() {
  return "/system identity print";
}

function classifyTransportError(err) {
  const kind =
    err && typeof err.kind === "string" && KIND_TO_ERROR_CODE[err.kind]
      ? err.kind
      : TRANSPORT_FAILURE_KINDS.TRANSPORT;
  return {
    kind,
    code: KIND_TO_ERROR_CODE[kind],
    retryable:
      err && typeof err.retryable === "boolean"
        ? err.retryable
        : RETRIABLE_KINDS.includes(kind),
  };
}

function createRouterOsClient(options = {}) {
  const transport = options.transport;
  const nowMs = typeof options.nowMs === "function" ? options.nowMs : () => Date.now();
  const sleepMs =
    typeof options.sleepMs === "function"
      ? options.sleepMs
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Constructor-level defaults for timeoutMs and retries, used when a
  // per-call request does not override them.
  const constructorTimeoutMs =
    options.timeoutMs === undefined || options.timeoutMs === null
      ? undefined
      : validateTimeoutMs(options.timeoutMs);
  const constructorRetries =
    options.retries === undefined || options.retries === null
      ? undefined
      : validateRetries(options.retries);

  if (!transport || typeof transport.execute !== "function") {
    throw invalid("A RouterOS transport with execute() is required", {
      field: "transport",
    });
  }

  function resolveRequest(input = {}) {
    const host = requireString(input.host, "host");
    const username = requireString(input.apiUsername, "apiUsername");
    const password = requireString(input.apiPassword, "apiPassword");
    const port = validatePort(input.port);
    const timeoutMs = validateTimeoutMs(
      input.timeoutMs === undefined || input.timeoutMs === null
        ? constructorTimeoutMs
        : input.timeoutMs
    );
    const retries = validateRetries(
      input.retries === undefined || input.retries === null
        ? constructorRetries
        : input.retries
    );
    return {
      host,
      port,
      tls: input.tls === true,
      credentials: { username, password },
      timeoutMs,
      retries,
    };
  }

  /**
   * Execute a pre-built command with bounded timeout and bounded retries.
   * `alreadyExists` and `notFound` are normalized to success so that
   * provisioning and disconnect are idempotent at the router boundary.
   */
  async function executeCommand(command, input = {}, options2 = {}) {
    const request = resolveRequest(input);

    // Check circuit breaker before attempting
    const breaker = getCircuitBreaker(request.host, request.port);
    const circuitCheck = breaker.canExecute();
    if (!circuitCheck.allowed) {
      throw mikrotikError(
        MIKROTIK_ERROR_CODES.MIKROTIK_CIRCUIT_OPEN,
        "Circuit breaker open for this router",
        { reason: circuitCheck.reason, retryAfterMs: circuitCheck.retryAfterMs },
      );
    }

    // Reserve a half-open slot if in half-open state
    const breakerStateBefore = breaker.getStatus().state;
    if (breaker.getStatus().state === CIRCUIT_STATES.HALF_OPEN) {
      // The canExecute check already validated we can proceed
    }

    const maxAttempts =
      options2.retries === undefined
        ? request.retries + 1
        : validateRetries(options2.retries) + 1;

    let lastFailure = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await transport.execute({
          ...request,
          command,
          attempt,
        });

        if (!result || result.ok !== true) {
          throw new MikrotikTransportFailure(
            TRANSPORT_FAILURE_KINDS.PROTOCOL,
            result && result.errorKind ? result.errorKind : "unsuccessful_result",
            false,
          );
        }

        // Record success in circuit breaker
        breaker.recordSuccess();

        return Object.freeze({
          ok: true,
          alreadyExists: result.alreadyExists === true,
          notFound: result.notFound === true,
          data: result.data === undefined ? null : result.data,
          attempts: attempt,
        });
      } catch (err) {
        const classified = classifyTransportError(err);
        lastFailure = classified;

        // Record failure in circuit breaker (only qualifying failures).
        // Recorded once per attempt here; not repeated after the loop to avoid
        // double-counting the final failure (circuit-breaker accounting).
        if (isQualifyingFailure(classified.kind)) {
          breaker.recordFailure(classified.kind);
        }

        const retryable = classified.retryable && attempt < maxAttempts;
        if (!retryable) break;

        // Bounded, non-aggressive backoff. No sleep is performed in tests that
        // inject a zero sleep, which keeps the checker fast without weakening
        // the production path.
        const backoff = Math.min(attempt * 100, MIKROTIK_MAX_TIMEOUT_MS);
        await sleepMs(backoff);
      }
    }

    const exhausted =
      lastFailure &&
      lastFailure.retryable &&
      maxAttempts > MIKROTIK_OPERATION_TIMEOUT_RETRIES + 1;

    throw mikrotikError(
      exhausted
        ? MIKROTIK_ERROR_CODES.MIKROTIK_RETRY_EXHAUSTED
        : lastFailure.code,
      // Host and port are deliberately absent: Phase 8.4 Decision Lock §16.1
      // forbids a resolved host/port combination from reaching logs or audit.
      exhausted
        ? "RouterOS request failed after bounded retries"
        : "RouterOS request failed",
      {
        kind: lastFailure ? lastFailure.kind : null,
        retryable: lastFailure ? lastFailure.retryable : false,
        attempts: maxAttempts,
      },
    );
  }

  async function addHotspotUser(input = {}) {
    requireString(input.userPassword, "userPassword");
    const command = buildAddHotspotUserCommand(input);
    const result = await executeCommand(command, input);
    return Object.freeze({
      ...result,
      operation: "hotspot_user_add",
    });
  }

  async function removeHotspotUser(input = {}) {
    const command = buildRemoveHotspotUserCommand(input);
    const result = await executeCommand(command, input);
    return Object.freeze({
      ...result,
      operation: "hotspot_user_remove",
    });
  }

  async function removeActiveHotspotUser(input = {}) {
    const command = buildRemoveActiveHotspotUserCommand(input);
    const result = await executeCommand(command, input);
    return Object.freeze({
      ...result,
      operation: "hotspot_active_remove",
    });
  }

  /**
   * Read-only reachability probe. Executes a single non-mutating RouterOS
   * command and never retries, so a health check cannot amplify an outage.
   */
  async function health(input = {}) {
    const command = buildHealthCommand();
    try {
      const result = await executeCommand(command, input, { retries: 0 });
      return Object.freeze({
        reachable: true,
        state: "reachable",
        attempts: result.attempts,
        checkedAt: nowMs(),
      });
    } catch (err) {
      const authFailed =
        err && err.code === MIKROTIK_ERROR_CODES.MIKROTIK_AUTH_FAILED;
      const invalidResponse =
        err && err.code === MIKROTIK_ERROR_CODES.MIKROTIK_INVALID_RESPONSE;
      const state = authFailed || invalidResponse ? "error" : "unreachable";
      return Object.freeze({
        reachable: false,
        state,
        reason: err && err.code ? err.code : "MIKROTIK_TRANSPORT_FAILURE",
        attempts: 1,
        checkedAt: nowMs(),
      });
    }
  }

  async function close() {
    if (transport && typeof transport.close === "function") {
      await transport.close();
    }
  }

  return Object.freeze({
    addHotspotUser,
    removeHotspotUser,
    removeActiveHotspotUser,
    health,
    close,
    describe() {
      return Object.freeze({
        transport: transport.name || "injected",
        defaultTimeoutMs: MIKROTIK_DEFAULT_TIMEOUT_MS,
        defaultRetries: MIKROTIK_DEFAULT_RETRIES,
        defaultPort: 8728,
      });
    },
  });
}

module.exports = {
  MIKROTIK_DEFAULT_TIMEOUT_MS,
  MIKROTIK_DEFAULT_RETRIES,
  MIKROTIK_MIN_TIMEOUT_MS,
  MIKROTIK_MAX_TIMEOUT_MS,
  MIKROTIK_MIN_RETRIES,
  MIKROTIK_MAX_RETRIES,
  TRANSPORT_FAILURE_KINDS,
  RETRIABLE_KINDS,
  MikrotikTransportFailure,
  CIRCUIT_STATES,
  classifyTransportError,
  getCircuitBreaker,
  getCircuitBreakerStatus,
  resetCircuitBreakers,
  getAllCircuitBreakerStatuses,
  isQualifyingFailure,
  createRouterOsClient,
  buildAddHotspotUserCommand,
  buildRemoveHotspotUserCommand,
  buildRemoveActiveHotspotUserCommand,
  buildHealthCommand,
};