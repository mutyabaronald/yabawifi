// Phase 8.5B — deterministic, in-memory Mocked RouterOS transport.
//
// This module is a TEST DOUBLE ONLY. It:
//
//   * never opens a socket (no net, tls, dgram, http, https)
//   * never makes an HTTP request
//   * never contacts a router
//   * never requires a real credential
//   * never resolves a production secret
//
// It records every command it is asked to run so assertions can inspect the
// exact command text, argument order and call count, and it can be scripted to
// return deterministic results or to simulate transport failures using the
// Phase 8.5A MikrotikTransportFailure vocabulary.
//
// SECRET HYGIENE
//   `calls` records the raw request, which DOES contain the resolved RouterOS
//   API password (credentials.password) and, for hotspot-user add, the generated
//   HotSpot password embedded in the command string. That is expected: the
//   RouterOS `user add` primitive requires the password inline. Callers that
//   inspect calls must use `safeSnapshot()` (which redacts both) for any output
//   that could reach logs or assertion text, and must never print a raw call.
//   The transport itself never logs and never writes to disk.

const { MikrotikTransportFailure, TRANSPORT_FAILURE_KINDS, RETRIABLE_KINDS } = require("./routerOsClient");

const REDACTED = "[REDACTED]";

function createMockRouterOsTransport(options = {}) {
  const config = options || {};
  const script = Array.isArray(config.script) ? config.script : [];
  const defaultResult =
    config.defaultResult && typeof config.defaultResult === "object"
      ? config.defaultResult
      : { ok: true };
  const name = typeof config.name === "string" && config.name.length > 0 ? config.name : "mock-routeros";

  const calls = [];
  let index = 0;

  function redactRequest(request) {
    if (!request || typeof request !== "object") return request;
    const safe = {};
    for (const key of Object.keys(request)) {
      const value = request[key];
      if (key === "credentials" && value && typeof value === "object") {
        safe[key] = { username: value.username || null, password: REDACTED };
      } else if (key === "command" && typeof value === "string") {
        // Keep the command structure inspectable but never echo a credential.
        safe[key] = value.replace(
          /\b(password|userPassword|apiPassword)\s*=\s*("[^"]*"|'[^']*'|[^\s,;)]+)/gi,
          `$1=${REDACTED}`,
        );
      } else {
        safe[key] = value;
      }
    }
    return safe;
  }

  const transport = {
    name,
    calls,
    get callCount() {
      return calls.length;
    },
    reset() {
      calls.length = 0;
      index = 0;
    },
    safeSnapshot() {
      return calls.map(redactRequest);
    },
    async execute(request) {
      const req = request && typeof request === "object" ? request : {};
      calls.push(req);

      const next = script[index];
      index += 1;

      if (next === undefined || next === null) {
        return defaultResult;
      }
      if (next instanceof Error) {
        throw next;
      }
      if (typeof next === "object" && !Array.isArray(next)) {
        return next;
      }
      // Anything else in the script is treated as a thrown failure.
      throw next;
    },
  };

  return Object.freeze(transport);
}

/**
 * Build a scripted transport whose results are consumed in order. When the
 * script is exhausted the default result is returned, which makes a transport
 * that always succeeds easy to construct.
 */
function createScriptedTransport(script, options = {}) {
  return createMockRouterOsTransport({
    script: Array.isArray(script) ? script : [script],
    ...options,
  });
}

function createFailingTransport(kind, reason, options = {}) {
  const retryable =
    options.retryable === true || (options.retryable === undefined && RETRIABLE_KINDS.includes(kind));
  const failure = new MikrotikTransportFailure(kind, reason, retryable);
  return createMockRouterOsTransport({
    script: [failure],
    ...options,
  });
}

module.exports = {
  createMockRouterOsTransport,
  createScriptedTransport,
  createFailingTransport,
  TRANSPORT_FAILURE_KINDS,
};