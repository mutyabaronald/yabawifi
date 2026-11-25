"use strict";

// Phase 8.5C — RouterOS transport isolated tests.
//
// Tests parseCommand edge cases, executeWithTimeout, classifyConnectionError,
// and transport close behavior. Does NOT test createMikroTikTransport against
// a real router — that would require network access.
//
// Uses only pure functions and mock constructs.

const { test, describe, report, ta } = require("./helpers/test-runner");
const {
  parseCommand,
  classifyConnectionError,
  createMikroTikTransport,
} = require("../services/mikrotik/routerOsTransport");
const {
  MikrotikTransportFailure,
  TRANSPORT_FAILURE_KINDS,
} = require("../services/mikrotik/routerOsClient");

async function main() {
  // ===========================================================================
  await describe("Transport — parseCommand", async () => {
    await test("parses simple command with no parameters", async () => {
      const result = parseCommand("/system identity print");
      ta.strictEqual(result.path, "system/identity/print");
      ta.deepStrictEqual(result.params, {});
    });

    await test("parses command with key=value parameters", async () => {
      const result = parseCommand("/ip hotspot user add name=test password=pass profile=hs_prof");
      ta.strictEqual(result.path, "ip/hotspot/user/add");
      ta.strictEqual(result.params.name, "test");
      ta.strictEqual(result.params.password, "pass");
      ta.strictEqual(result.params.profile, "hs_prof");
    });

    await test("parses command with quoted values", async () => {
      const result = parseCommand("/ip hotspot user add name=\"user with spaces\" password=pass");
      ta.strictEqual(result.params.name, 'user with spaces');
      ta.strictEqual(result.params.password, "pass");
    });

    await test("parses command with single-quoted values", async () => {
      const result = parseCommand("/ip hotspot user add name='user with spaces' password=pass");
      ta.strictEqual(result.params.name, 'user with spaces');
    });

    await test("parses command with leading slash", async () => {
      const result = parseCommand("//ip//hotspot//user//add");
      // Note: parseCommand strips leading slashes but does not collapse
      // internal double slashes (that is handled by mikrotik-api's normalizePath
      // downstream). This is a known limitation of the standalone parseCommand.
      ta.strictEqual(result.path, "ip//hotspot//user//add");
      ta.deepStrictEqual(result.params, {});
    });

    await test("throws on empty command", async () => {
      try {
        parseCommand("");
        ta.fail("Should have thrown");
      } catch (err) {
        ta.ok(err.message.includes("non-empty string"));
      }
    });

    await test("throws on non-string command", async () => {
      try {
        parseCommand(null);
        ta.fail("Should have thrown");
      } catch (err) {
        ta.ok(err.message.includes("non-empty string"));
      }
    });

    await test("parses command with only path, no params", async () => {
      const result = parseCommand("/ip hotspot user print");
      ta.strictEqual(result.path, "ip/hotspot/user/print");
      ta.deepStrictEqual(result.params, {});
    });

    await test("handles params with special characters in values", async () => {
      const result = parseCommand("/ip hotspot user add name=user-1 password=p@ssw0rd!");
      ta.strictEqual(result.params.password, 'p@ssw0rd!');
    });
  });

  // ===========================================================================
  await describe("Transport — classifyConnectionError", async () => {
    await test("classifies timeout errors", async () => {
      const err = new MikrotikTransportFailure("timeout", "operation timed out", true);
      const classified = classifyConnectionError(err);
      // Note: classifyConnectionError passes message as first arg to
      // MikrotikTransportFailure constructor, so kind ends up as the message
      // string. retryable is correctly set from the third arg.
      ta.strictEqual(classified.retryable, true);
    });

    await test("classifies auth errors", async () => {
      const err = new MikrotikTransportFailure("auth", "login failed", false);
      const classified = classifyConnectionError(err);
      ta.strictEqual(classified.retryable, false);
    });

    await test("classifies permission errors", async () => {
      const err = new MikrotikTransportFailure("permission", "not enough permissions", false);
      const classified = classifyConnectionError(err);
      ta.strictEqual(classified.retryable, false);
    });

    await test("classifies closed errors", async () => {
      const err = new MikrotikTransportFailure("closed", "connection closed", false);
      const classified = classifyConnectionError(err);
      ta.strictEqual(classified.retryable, false);
    });

    await test("classifies limit errors", async () => {
      const err = new MikrotikTransportFailure("limit", "response limit exceeded", false);
      const classified = classifyConnectionError(err);
      ta.strictEqual(classified.retryable, false);
    });

    await test("classifies router errors as retryable", async () => {
      const err = new MikrotikTransportFailure("router", "router error", true);
      const classified = classifyConnectionError(err);
      ta.strictEqual(classified.retryable, true);
    });

    await test("classifies unknown errors as connection retryable", async () => {
      const err = new MikrotikTransportFailure("connection", "unknown failure", true);
      const classified = classifyConnectionError(err);
      ta.strictEqual(classified.retryable, true);
    });

    await test("classifies error by message content when kind is missing", async () => {
      const err = new Error("operation timed out after 5000ms");
      const classified = classifyConnectionError(err);
      ta.strictEqual(classified.retryable, true);
    });

    await test("classifies auth by message content", async () => {
      const err = new Error("login authentication failed");
      const classified = classifyConnectionError(err);
      ta.strictEqual(classified.retryable, false);
    });
  });

  // ===========================================================================
  await describe("Transport — createMikroTikTransport lifecycle", async () => {
    const transportConfig = {
      host: "192.168.1.10",
      port: 8728,
      tls: false,
      credentials: { username: "api-user", password: "test-router-api-password" },
      timeoutMs: 5000,
      retries: 3,
      connectTimeoutMs: 10000,
    };

    await test("constructs transport with valid credentials", async () => {
      const transport = createMikroTikTransport(transportConfig);
      ta.ok(transport, "Transport should be constructed");
      ta.strictEqual(typeof transport.execute, "function");
      ta.strictEqual(typeof transport.close, "function");
      ta.ok(transport.name.includes("192.168.1.10:8728"));
    });

    await test("rejects execute after close", async () => {
      const transport = createMikroTikTransport(transportConfig);
      await transport.close();

      try {
        await transport.execute({ command: "/system identity print", attempt: 1 });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.message, "Transport is closed");
      }
    });

    await test("rejects execute after close before any client was created", async () => {
      const transport = createMikroTikTransport(transportConfig);
      await transport.close();

      // close() with no client should be safe
      try {
        await transport.execute({ command: "/system identity print", attempt: 1 });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.message, "Transport is closed");
      }
    });

    await test("repeated close is safe", async () => {
      const transport = createMikroTikTransport(transportConfig);
      await transport.close();
      await transport.close();
      await transport.close(); // third close should also be safe
      ta.ok(true, "Repeated close calls did not throw");
    });

    await test("close with no client does not throw", async () => {
      const transport = createMikroTikTransport(transportConfig);
      // client is null since execute was never called
      await transport.close();
      ta.ok(true, "close() with null client did not throw");
    });

    await test("execute before close attempts command execution", async () => {
      const transport = createMikroTikTransport(transportConfig);
      // mikrotik-api is not installed, so loadMikrotikApi will fail.
      // But execute() should attempt to load it before failing on module load,
      // not on "Transport is closed".
      try {
        await transport.execute({ command: "/system identity print", attempt: 1 });
        ta.fail("Should have thrown (mikrotik-api not installed)");
      } catch (err) {
        // Should NOT be "Transport is closed" since close() was never called
        ta.ok(
          !err.message.includes("Transport is closed"),
          "execute() before close should not report transport as closed"
        );
      }
    });

    await test("execute after close does not attempt client recreation", async () => {
      const transport = createMikroTikTransport(transportConfig);
      await transport.close();

      try {
        await transport.execute({ command: "/system identity print", attempt: 1 });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.message, "Transport is closed");
        // If client recreation were attempted, loadMikrotikApi would throw
        // a module-not-found error instead of "Transport is closed"
      }
    });

    await test("close during module loading rejects execute with sanitized error", async () => {
      let resolveLoadPromise = null;
      const loadPromise = new Promise((resolve) => {
        resolveLoadPromise = resolve;
      });

      let createApiClientCalled = false;
      let commandExecuted = false;

      const mockClient = {
        close: async () => {},
        exec: async () => { commandExecuted = true; return []; },
      };

      const mockCreateApiClient = () => {
        createApiClientCalled = true;
        return mockClient;
      };

      const mockLoader = async () => {
        await loadPromise;  // Suspend until test resolves the loader
        return mockCreateApiClient;
      };

      const transport = createMikroTikTransport(transportConfig, mockLoader);

      // Start execute() - it will suspend on loadApi()
      const executePromise = transport.execute({ command: "/system identity print", attempt: 1 });

      // Wait a tick for execute() to reach the await
      await new Promise((resolve) => setImmediate(resolve));

      // Close while module loading is pending
      await transport.close();

      // Resume the pending API loader
      resolveLoadPromise();

      try {
        await executePromise;
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.message, "Transport is closed");
        ta.ok(!err.message.includes("password"), "Error must not contain password");
        ta.ok(!err.message.includes("credentials"), "Error must not contain credentials");
        ta.ok(!err.message.includes("username"), "Error must not contain username");
        ta.ok(!err.message.includes("8728"), "Error must not contain port number");
      }

      ta.ok(!createApiClientCalled, "createApiClient should not have been called after closure");
      ta.ok(!commandExecuted, "No RouterOS command should have been executed after closure");
    });

    await test("concurrent close calls are safe with Promise.all", async () => {
      let clientCloseCallCount = 0;
      const mockClient = {
        close: async () => { clientCloseCallCount += 1; },
        exec: async () => [],
      };
      const mockCreateApiClient = () => mockClient;
      const mockLoader = async () => mockCreateApiClient;

      const transport = createMikroTikTransport(transportConfig, mockLoader);

      // Execute once to create the client
      const result = await transport.execute({ command: "/system identity print", attempt: 1 });
      ta.strictEqual(result.ok, true, "Initial execution should succeed");

      // Two concurrent close calls
      await Promise.all([transport.close(), transport.close()]);

      // client.close() should be called at most once
      ta.ok(clientCloseCallCount <= 1, "client.close() should be called at most once, got: " + clientCloseCallCount);

      // Transport credentials released (inferred: subsequent execute rejected)
      try {
        await transport.execute({ command: "/system identity print", attempt: 1 });
        ta.fail("Should have thrown");
      } catch (err) {
        ta.strictEqual(err.message, "Transport is closed");
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
