"use strict";

// Phase 8.5C — Router adapter registry isolation tests.
//
// Verifies that:
//   - MikroTik resolves to its adapter key
//   - UniFi, Omada, Cisco and generic vendors fail closed
//   - Unsupported vendors cannot accidentally receive MikroTik capabilities
//   - Registry resolution has no network side effects

const { test, describe, report, ta } = require("./helpers/test-runner");
const {
  resolveAdapterKey,
  hasAdapter,
  supportedVendors,
  acceptedVendors,
  MIKROTIK_ADAPTER_KEY,
} = require("../services/routerAdapters");

async function main() {
  // ===========================================================================
  await describe("Registry — MikroTik Resolution", async () => {
    await test("resolves mikrotik vendor to adapter key", async () => {
      const key = resolveAdapterKey({ vendor: "mikrotik" });
      ta.strictEqual(key, "mikrotik");
    });

    await test("resolves MikroTik with mixed case", async () => {
      const key = resolveAdapterKey({ vendor: "MikroTik" });
      ta.strictEqual(key, "mikrotik");
    });

    await test("resolves MikroTik with whitespace", async () => {
      const key = resolveAdapterKey({ vendor: "  mikrotik  " });
      ta.strictEqual(key, "mikrotik");
    });

    await test("hasAdapter returns true for mikrotik", async () => {
      ta.strictEqual(hasAdapter("mikrotik"), true);
    });

    await test("supportedVendors includes mikrotik", async () => {
      const vendors = supportedVendors();
      ta.ok(vendors.includes("mikrotik"));
      ta.strictEqual(vendors.length, 1);
    });
  });

  // ===========================================================================
  await describe("Registry — Unsupported Vendors Fail Closed", async () => {
    await test("unifi vendor returns null (no adapter)", async () => {
      const key = resolveAdapterKey({ vendor: "unifi" });
      ta.strictEqual(key, null);
    });

    await test("omada vendor returns null (no adapter)", async () => {
      const key = resolveAdapterKey({ vendor: "omada" });
      ta.strictEqual(key, null);
    });

    await test("cisco vendor returns null (no adapter)", async () => {
      const key = resolveAdapterKey({ vendor: "cisco" });
      ta.strictEqual(key, null);
    });

    await test("generic vendor returns null (no adapter)", async () => {
      const key = resolveAdapterKey({ vendor: "generic" });
      ta.strictEqual(key, null);
    });

    await test("unknown vendor returns null", async () => {
      const key = resolveAdapterKey({ vendor: "unknown-vendor" });
      ta.strictEqual(key, null);
    });

    await test("hasAdapter returns false for unsupported vendors", async () => {
      ta.strictEqual(hasAdapter("unifi"), false);
      ta.strictEqual(hasAdapter("omada"), false);
      ta.strictEqual(hasAdapter("cisco"), false);
      ta.strictEqual(hasAdapter("generic"), false);
      ta.strictEqual(hasAdapter("unknown"), false);
    });

    await test("supportedVendors does not include unsupported vendors", async () => {
      const vendors = supportedVendors();
      ta.ok(!vendors.includes("unifi"));
      ta.ok(!vendors.includes("omada"));
      ta.ok(!vendors.includes("cisco"));
      ta.ok(!vendors.includes("generic"));
    });
  });

  // ===========================================================================
  await describe("Registry — Accepted Vendors (Metadata Only)", async () => {
    await test("acceptedVendors lists all known vendors", async () => {
      const vendors = acceptedVendors();
      ta.ok(vendors.includes("mikrotik"));
      ta.ok(vendors.includes("unifi"));
      ta.ok(vendors.includes("omada"));
      ta.ok(vendors.includes("cisco"));
      ta.ok(vendors.includes("generic"));
    });
  });

  // ===========================================================================
  await describe("Registry — Edge Cases", async () => {
    await test("null device returns null", async () => {
      const key = resolveAdapterKey(null);
      ta.strictEqual(key, null);
    });

    await test("undefined device returns null", async () => {
      const key = resolveAdapterKey(undefined);
      ta.strictEqual(key, null);
    });

    await test("device without vendor field returns null", async () => {
      const key = resolveAdapterKey({ deviceId: "test" });
      ta.strictEqual(key, null);
    });

    await test("device with empty vendor returns null", async () => {
      const key = resolveAdapterKey({ vendor: "" });
      ta.strictEqual(key, null);
    });

    await test("device with non-string vendor returns null", async () => {
      const key = resolveAdapterKey({ vendor: 123 });
      ta.strictEqual(key, null);
    });

    await test("device with null vendor returns null", async () => {
      const key = resolveAdapterKey({ vendor: null });
      ta.strictEqual(key, null);
    });
  });

  // ===========================================================================
  await describe("Registry — No Network Side Effects", async () => {
    await test("resolveAdapterKey is synchronous and pure", async () => {
      // Should not throw, not make network calls
      const result = resolveAdapterKey({ vendor: "mikrotik" });
      ta.strictEqual(result, "mikrotik");
    });

    await test("hasAdapter is synchronous and pure", async () => {
      ta.strictEqual(hasAdapter("mikrotik"), true);
      ta.strictEqual(hasAdapter("unifi"), false);
    });

    await test("supportedVendors returns stable array", async () => {
      const v1 = supportedVendors();
      const v2 = supportedVendors();
      ta.deepStrictEqual(v1, v2);
    });
  });

  const allPassed = report();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
