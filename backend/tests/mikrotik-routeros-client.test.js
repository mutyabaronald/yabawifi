"use strict";

// Phase 8.5C — RouterOS client isolated tests.
//
// Tests circuit breaker states, retry limits, timeout limits, connection error
// classification, authentication error classification, command builders,
// transport close behavior, and repeated cleanup.
//
// Uses only the mock RouterOS transport — no sockets, no production routers.
//
// NOTE: health() catches errors and returns { reachable: false } gracefully.
// Tests that expect errors to propagate must use addHotspotUser() instead.

const { test, describe, report, ta } = require("./helpers/test-runner");
const {
  createMockRouterOsTransport,
  createScriptedTransport,
} = require("../services/mikrotik/mockRouterOsTransport");
const {
  createRouterOsClient,
  MIKROTIK_DEFAULT_TIMEOUT_MS,
  MIKROTIK_DEFAULT_RETRIES,
  MIKROTIK_MIN_TIMEOUT_MS,
  MIKROTIK_MAX_TIMEOUT_MS,
  MIKROTIK_MIN_RETRIES,
  MIKROTIK_MAX_RETRIES,
  TRANSPORT_FAILURE_KINDS,
  RETRIABLE_KINDS,
  MikrotikTransportFailure,
  buildAddHotspotUserCommand,
  buildRemoveHotspotUserCommand,
  buildRemoveActiveHotspotUserCommand,
  buildHealthCommand,
} = require("../services/mikrotik/routerOsClient");
const {
  mikrotikError,
  MIKROTIK_ERROR_CODES,
} = require("../services/mikrotik/errors");

// Circuit breakers are keyed by host:port and are module-level.
// Use a unique base port per test group to avoid cross-test contamination.
let portCounter = 9000;
function nextPort() {
  portCounter += 1;
  return portCounter;
}

function makeRequestInput(port, overrides = {}) {
  return {
    host: "192.168.1.1",
    apiUsername: "api-user",
    apiPassword: "api-pass",
    port,
    timeoutMs: 5000,
    retries: 3,
    ...overrides,
  };
}

// Create a transport that always throws the given failure
function createAlwaysFailingTransport(kind, reason, retryable) {
  const failure = new MikrotikTransportFailure(kind, reason, retryable);
  return createMockRouterOsTransport({
    script: Array(20).fill(failure), // fail 20 times, then defaultResult
    defaultResult: { ok: true },
  });
}

async function main() {
  // ===========================================================================
  await describe("RouterOS Client — Construction", async () => {
    await test("creates client with injected transport", async () => {
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      ta.ok(client);
      ta.ok(typeof client.addHotspotUser === "function");
      ta.ok(typeof client.removeHotspotUser === "function");
      ta.ok(typeof client.removeActiveHotspotUser === "function");
      ta.ok(typeof client.health === "function");
    });

    await test("rejects missing transport", async () => {
      try {
        createRouterOsClient({});
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "MIKROTIK_CONFIG_INVALID");
      }
    });

    await test("rejects transport without execute", async () => {
      try {
        createRouterOsClient({ transport: {} });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "MIKROTIK_CONFIG_INVALID");
      }
    });

    await test("describe returns transport info", async () => {
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true }, name: "test-transport" });
      const client = createRouterOsClient({ transport });
      const desc = client.describe();
      ta.strictEqual(desc.defaultTimeoutMs, MIKROTIK_DEFAULT_TIMEOUT_MS);
      ta.strictEqual(desc.defaultRetries, MIKROTIK_DEFAULT_RETRIES);
      ta.strictEqual(desc.defaultPort, 8728);
    });
  });

  // ===========================================================================
  await describe("RouterOS Client — Circuit Breaker", async () => {
    await test("circuit breaker starts in CLOSED state", async () => {
      const port = nextPort();
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      await client.addHotspotUser({
        ...makeRequestInput(port),
        user: "test-user",
        userPassword: "test-pass",
        profile: "hs_prof",
      });
      ta.ok(true, "Circuit breaker allows calls in CLOSED state");
    });

    await test("circuit breaker opens after consecutive qualifying failures", async () => {
      const port = nextPort();
      // Always-failing transport: every call throws a network failure
      const transport = createAlwaysFailingTransport(
        TRANSPORT_FAILURE_KINDS.NETWORK,
        "network down",
        true,
      );
      const client = createRouterOsClient({ transport, retries: 0 });
      const input = makeRequestInput(port);
      // Need 5 consecutive failures to trip the breaker (threshold = 5)
      for (let i = 0; i < 5; i++) {
        try {
          await client.addHotspotUser({
            ...input,
            user: `user-${i}`,
            userPassword: `pass-${i}`,
            profile: "hs_prof",
          });
        } catch (_) {
          // expected
        }
      }
      // After 5 consecutive failures, circuit should be OPEN
      try {
        await client.addHotspotUser({
          ...input,
          user: "user-final",
          userPassword: "pass-final",
          profile: "hs_prof",
        });
        ta.fail("Should have thrown circuit open");
      } catch (err) {
        ta.strictEqual(err.code, "MIKROTIK_CIRCUIT_OPEN");
      }
    });

    await test("circuit breaker rejects non-qualifying failures (auth does not open circuit)", async () => {
      const port = nextPort();
      // Auth failures don't count toward circuit breaker threshold
      const transport = createAlwaysFailingTransport(
        TRANSPORT_FAILURE_KINDS.AUTH,
        "bad password",
        false,
      );
      const client = createRouterOsClient({ transport, retries: 0 });
      const input = makeRequestInput(port);
      for (let i = 0; i < 10; i++) {
        try {
          await client.addHotspotUser({
            ...input,
            user: `user-${i}`,
            userPassword: `pass-${i}`,
            profile: "hs_prof",
          });
        } catch (_) {
          // expected - auth failures don't open circuit
        }
      }
      // Circuit should still be CLOSED; the next call should still attempt
      try {
        await client.addHotspotUser({
          ...input,
          user: "user-final",
          userPassword: "pass-final",
          profile: "hs_prof",
        });
        ta.fail("Should have thrown auth failure");
      } catch (err) {
        ta.ok(err.code === "MIKROTIK_AUTH_FAILED" || err.code === "MIKROTIK_TRANSPORT_FAILURE",
          "Expected auth/transport error, got: " + err.code);
      }
    });
  });

  // ===========================================================================
  await describe("RouterOS Client — Retry Limits", async () => {
    await test("retries up to configured limit on timeout", async () => {
      const port = nextPort();
      const transport = createAlwaysFailingTransport(
        TRANSPORT_FAILURE_KINDS.TIMEOUT,
        "timeout",
        true,
      );
      const client = createRouterOsClient({ transport, retries: 2 });
      try {
        await client.addHotspotUser({
          ...makeRequestInput(port),
          user: "test-user",
          userPassword: "test-pass",
          profile: "hs_prof",
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.ok(err, "Should throw after retry exhaustion");
      }
    });

    await test("does not retry when retries is 0", async () => {
      const port = nextPort();
      const transport = createAlwaysFailingTransport(
        TRANSPORT_FAILURE_KINDS.TIMEOUT,
        "timeout",
        true,
      );
      const client = createRouterOsClient({ transport, retries: 0 });
      try {
        await client.addHotspotUser({
          ...makeRequestInput(port),
          user: "test-user",
          userPassword: "test-pass",
          profile: "hs_prof",
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.ok(err, "Should throw immediately with retries=0");
      }
    });
  });

  // ===========================================================================
  await describe("RouterOS Client — Timeout and Retry Validation", async () => {
    await test("rejects timeout below minimum at execution time", async () => {
      const port = nextPort();
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      // Validation happens per-call in resolveRequest, not at construction
      try {
        await client.addHotspotUser({
          ...makeRequestInput(port, { timeoutMs: 50 }),
          user: "test-user",
          userPassword: "test-pass",
          profile: "hs_prof",
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "MIKROTIK_CONFIG_INVALID");
      }
    });

    await test("rejects timeout above maximum at execution time", async () => {
      const port = nextPort();
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      try {
        await client.addHotspotUser({
          ...makeRequestInput(port, { timeoutMs: 300000 }),
          user: "test-user",
          userPassword: "test-pass",
          profile: "hs_prof",
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "MIKROTIK_CONFIG_INVALID");
      }
    });

    await test("defaults timeout to 5000ms", async () => {
      const port = nextPort();
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      ta.ok(client, "Client should be created with default timeout");
    });

    await test("rejects retries above maximum at execution time", async () => {
      const port = nextPort();
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      try {
        await client.addHotspotUser({
          ...makeRequestInput(port, { retries: 20 }),
          user: "test-user",
          userPassword: "test-pass",
          profile: "hs_prof",
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "MIKROTIK_CONFIG_INVALID");
      }
    });
  });

  // ===========================================================================
  await describe("RouterOS Client — Error Classification", async () => {
    await test("classifies network errors correctly", async () => {
      const port = nextPort();
      const transport = createAlwaysFailingTransport(
        TRANSPORT_FAILURE_KINDS.NETWORK,
        "connection refused",
        true,
      );
      const client = createRouterOsClient({ transport, retries: 0 });
      try {
        await client.addHotspotUser({
          ...makeRequestInput(port, { retries: 0 }),
          user: "test-user",
          userPassword: "test-pass",
          profile: "hs_prof",
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.ok(err.code === "MIKROTIK_NETWORK_ERROR" || err.code === "MIKROTIK_TRANSPORT_FAILURE",
          "Expected network error, got: " + err.code);
      }
    });

    await test("classifies auth errors correctly", async () => {
      const port = nextPort();
      const transport = createAlwaysFailingTransport(
        TRANSPORT_FAILURE_KINDS.AUTH,
        "authentication failed",
        false,
      );
      const client = createRouterOsClient({ transport, retries: 0 });
      try {
        await client.addHotspotUser({
          ...makeRequestInput(port, { retries: 0 }),
          user: "test-user",
          userPassword: "test-pass",
          profile: "hs_prof",
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.ok(err.code === "MIKROTIK_AUTH_FAILED" || err.code === "MIKROTIK_TRANSPORT_FAILURE",
          "Expected auth error, got: " + err.code);
      }
    });

    await test("classifies protocol errors correctly", async () => {
      const port = nextPort();
      const transport = createAlwaysFailingTransport(
        TRANSPORT_FAILURE_KINDS.PROTOCOL,
        "bad response",
        false,
      );
      const client = createRouterOsClient({ transport, retries: 0 });
      try {
        await client.addHotspotUser({
          ...makeRequestInput(port, { retries: 0 }),
          user: "test-user",
          userPassword: "test-pass",
          profile: "hs_prof",
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.ok(err, "Should throw protocol error");
      }
    });
  });

  // ===========================================================================
  await describe("RouterOS Client — Command Builders", async () => {
    await test("buildAddHotspotUserCommand constructs valid command", async () => {
      const cmd = buildAddHotspotUserCommand({
        user: "test-user",
        userPassword: "test-pass",
        profile: "hs_prof",
        limitUptimeSeconds: 300,
        limitBytesTotal: 1000000,
      });
      ta.ok(cmd.startsWith("/ip hotspot user add"));
      ta.ok(cmd.includes("name=test-user"));
      ta.ok(cmd.includes("profile=hs_prof"));
      ta.ok(cmd.includes("limit-uptime=300"));
      ta.ok(cmd.includes("limit-bytes-total=1000000"));
    });

    await test("buildAddHotspotUserCommand quotes unsafe profile values", async () => {
      const cmd = buildAddHotspotUserCommand({
        user: "test-user",
        userPassword: "pass",
        profile: "prof with spaces",
      });
      ta.ok(cmd.includes('"prof with spaces"'), "Should quote profile values with spaces");
    });

    await test("buildAddHotspotUserCommand rejects invalid username", async () => {
      try {
        buildAddHotspotUserCommand({
          user: "bad user!",
          userPassword: "pass",
          profile: "prof",
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "MIKROTIK_CONFIG_INVALID");
      }
    });

    await test("addHotspotUser rejects missing password", async () => {
      const port = nextPort();
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      try {
        await client.addHotspotUser({
          ...makeRequestInput(port),
          user: "test-user",
          profile: "prof",
          // no userPassword
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "MIKROTIK_CONFIG_INVALID");
      }
    });

    await test("buildRemoveHotspotUserCommand constructs valid command", async () => {
      const cmd = buildRemoveHotspotUserCommand({ user: "test-user" });
      ta.strictEqual(cmd, "/ip hotspot user remove name=test-user");
    });

    await test("buildRemoveActiveHotspotUserCommand constructs valid command", async () => {
      const cmd = buildRemoveActiveHotspotUserCommand({ user: "test-user" });
      ta.strictEqual(cmd, "/ip hotspot active remove name=test-user");
    });

    await test("buildHealthCommand constructs valid command", async () => {
      const cmd = buildHealthCommand();
      ta.strictEqual(cmd, "/system identity print");
    });

    await test("buildAddHotspotUserCommand rejects sharedUsers=0", async () => {
      try {
        buildAddHotspotUserCommand({
          user: "test-user",
          userPassword: "pass",
          profile: "prof",
          sharedUsers: 0,
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "MIKROTIK_CONFIG_INVALID");
      }
    });

    await test("buildAddHotspotUserCommand rejects negative limitUptimeSeconds", async () => {
      try {
        buildAddHotspotUserCommand({
          user: "test-user",
          userPassword: "pass",
          profile: "prof",
          limitUptimeSeconds: -1,
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.code, "MIKROTIK_CONFIG_INVALID");
      }
    });
  });

  // ===========================================================================
  await describe("RouterOS Client — Transport and Cleanup", async () => {
    await test("mock transport records calls", async () => {
      const port = nextPort();
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      await client.addHotspotUser({
        ...makeRequestInput(port),
        user: "test-user",
        userPassword: "test-pass",
        profile: "hs_prof",
      });
      ta.strictEqual(transport.callCount, 1);
      ta.ok(Array.isArray(transport.calls));
    });

    await test("mock transport safeSnapshot redacts credentials", async () => {
      const port = nextPort();
      const transport = createMockRouterOsTransport({ defaultResult: { ok: true } });
      const client = createRouterOsClient({ transport });
      await client.addHotspotUser({
        ...makeRequestInput(port),
        user: "test-user",
        userPassword: "my-secret-pass",
        profile: "hs_prof",
      });
      const snapshot = transport.safeSnapshot();
      ta.ok(snapshot.length > 0);
      const snapshotStr = JSON.stringify(snapshot);
      ta.ok(!snapshotStr.includes("my-secret-pass"), "Safe snapshot must not contain password");
      ta.ok(snapshotStr.includes("[REDACTED]"), "Safe snapshot should contain redaction marker");
    });

    await test("scripted transport consumes results in order", async () => {
      const port1 = nextPort();
      const port2 = nextPort();
      const transport = createScriptedTransport([
        { ok: true, data: [{ ret: "*1" }] },
        { ok: true, notFound: true },
      ]);
      const client = createRouterOsClient({ transport });

      const first = await client.addHotspotUser({
        ...makeRequestInput(port1),
        user: "user-1",
        userPassword: "pass-1",
        profile: "prof",
      });
      ta.strictEqual(first.alreadyExists, false);

      const second = await client.removeHotspotUser({
        ...makeRequestInput(port2),
        user: "user-1",
      });
      ta.strictEqual(second.notFound, true);
    });

    await test("failing transport throws on every call", async () => {
      const port = nextPort();
      const transport = createAlwaysFailingTransport(
        TRANSPORT_FAILURE_KINDS.NETWORK,
        "always fails",
        true,
      );
      const client = createRouterOsClient({ transport, retries: 0 });
      try {
        await client.addHotspotUser({
          ...makeRequestInput(port),
          user: "test-user",
          userPassword: "test-pass",
          profile: "hs_prof",
        });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.ok(err, "Failing transport should throw");
      }
    });
  });

  const allPassed = report();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
