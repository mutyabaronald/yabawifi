"use strict";

// Dependency injection tests for backend/routes/devices.js createDevicesRouter factory.
//
// Verifies:
//   - createDevicesRouter() works with injected dependencies
//   - Default production initialization remains compatible
//   - Mock dependencies can be supplied without production Firebase
//   - Existing exports and route mounting remain compatible

const assert = require("assert");
const express = require("express");
const request = require("supertest");

const {
  MockFirestore,
} = require("./helpers/mock-firestore");
const { mockModule, installInterceptor, uninstallInterceptor, clearMocks } = require("./helpers/mock-modules");
const { test, describe, report, ta } = require("./helpers/test-runner");

let db;

function resetTestState() {
  db = new MockFirestore();
}

function buildRouterWithDI(overrides = {}) {
  const {
    db: injectedDb = db,
    admin = { firestore: () => db, FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } },
    registry = {
      authenticateOwnerOrSuper: async () => ({ kind: "owner", ownerId: "owner-1" }),
      RegistryError: class extends Error {
        constructor(status, code, message) { super(message); this.status = status; this.code = code; }
      },
      requireOwnerSelf: () => {},
    },
    credentialLifecycle = {
      rotateRouterSecret: async () => ({ success: true, hasSecret: true }),
      revokeRouterSecret: async () => ({ success: true, hasSecret: false }),
      deleteDeviceWithRevocation: async () => ({ success: true }),
    },
    checkCiscoConnection = async () => ({ success: true }),
    featureFlag = {
      NETWORK_CONTROL_MODES: { NONE: "none", FULL: "full", LIMITED: "limited" },
      NETWORK_CONTROL_VALUES: ["none", "full", "limited"],
      DEFAULT_ROUTER_OS_API_PORT: 8728,
      normalizeNetworkControl: (v) => v,
    },
  } = overrides;

  mockModule("../firebase", {
    db: injectedDb,
    admin,
  }, require.resolve("../routes/devices.js"));

  mockModule("../services/roamingRegistryService", registry, require.resolve("../routes/devices.js"));

  mockModule("../services/ciscoService", { checkCiscoConnection }, require.resolve("../routes/devices.js"));

  mockModule("../services/mikrotik/featureFlag", featureFlag, require.resolve("../routes/devices.js"));

  mockModule("../services/mikrotik/credentialLifecycle", credentialLifecycle, require.resolve("../routes/devices.js"));

  installInterceptor();
  try {
    const { createDevicesRouter } = require("../routes/devices.js");
    const router = createDevicesRouter({
      db: injectedDb,
      admin,
      registry,
      credentialLifecycle,
      checkCiscoConnection,
      featureFlag,
    });
    return { router, createDevicesRouter };
  } finally {
    uninstallInterceptor();
    clearMocks();
  }
}

function mountApp(router) {
  const app = express();
  app.use(express.json());
  app.use("/", router);
  return app;
}

async function main() {
  // ===========================================================================
  await describe("Dependency Injection — createDevicesRouter with injected dependencies", async () => {
    await resetTestState();

    await test("creates router with all dependencies injected", async () => {
      const { router } = buildRouterWithDI();
      ta.ok(router);
      ta.ok(typeof router.handle === "function", "Should be an Express Router");
    });

    await test("all routes are registered with DI", async () => {
      const { router } = buildRouterWithDI();
      const paths = router.stack
        .filter((layer) => layer.route)
        .map((layer) => layer.route.path);
      ta.ok(paths.includes("/api/devices"), "POST /api/devices should be registered");
      ta.ok(paths.includes("/api/devices/:id"), "GET/PUT/DELETE /api/devices/:id should be registered");
      ta.ok(paths.includes("/api/devices/owner/:ownerId"), "GET /api/devices/owner/:ownerId should be registered");
      ta.ok(paths.includes("/api/devices/:deviceId/router-secret"), "router-secret routes should be registered");
      ta.ok(paths.includes("/api/devices/status/:id"), "GET /api/devices/status/:id should be registered");
      ta.ok(paths.includes("/api/devices/:id/logs"), "GET /api/devices/:id/logs should be registered");
      ta.ok(paths.includes("/api/devices/:id/ping"), "GET /api/devices/:id/ping should be registered");
      ta.ok(paths.includes("/api/provisioning/script"), "GET /api/provisioning/script should be registered");
    });

await test("router handles requests with injected mock db", async () => {
    const { router } = buildRouterWithDI();
    const app = mountApp(router);

    await db.collection("devices").doc("device-di-1").set({
      deviceId: "device-di-1",
      ownerId: "owner-1",
      deviceName: "DI Device",
      status: "online",
    });

    const res = await request(app)
      .get("/api/devices/status/device-di-1")
      .set("Authorization", "Bearer token-1");
    ta.strictEqual(res.status, 200);
    ta.strictEqual(res.body.device.deviceId, "device-di-1");
  });

    await test("DI router rejects missing db/admin mismatch", async () => {
      try {
        buildRouterWithDI({ db: db, admin: null });
        ta.fail("Should have thrown when only db provided without admin");
      } catch (err) {
        ta.ok(err.message.includes("both db and admin must be provided together"));
      }
    });

    await test("DI router rejects missing admin/db mismatch", async () => {
      try {
        buildRouterWithDI({ db: null, admin: { firestore: () => db } });
        ta.fail("Should have thrown when only admin provided without db");
      } catch (err) {
        ta.ok(err.message.includes("both db and admin must be provided together"));
      }
    });
  });

  // ===========================================================================
  await describe("Dependency Injection — Default production initialization", async () => {
    await resetTestState();

    await test("default export calls createDevicesRouter() with no args", async () => {
      mockModule("../firebase", {
        db,
        admin: { firestore: () => db, FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } },
      }, require.resolve("../routes/devices.js"));

      mockModule("../services/roamingRegistryService", {
        authenticateOwnerOrSuper: async () => ({ kind: "owner", ownerId: "owner-1" }),
        RegistryError: class extends Error {
          constructor(status, code, message) { super(message); this.status = status; this.code = code; }
        },
        requireOwnerSelf: () => {},
      }, require.resolve("../routes/devices.js"));

      mockModule("../services/ciscoService", { checkCiscoConnection: async () => ({ success: true }) }, require.resolve("../routes/devices.js"));

      mockModule("../services/mikrotik/featureFlag", {
        NETWORK_CONTROL_MODES: { NONE: "none" },
        NETWORK_CONTROL_VALUES: ["none"],
        DEFAULT_ROUTER_OS_API_PORT: 8728,
        normalizeNetworkControl: (v) => "none",
      }, require.resolve("../routes/devices.js"));

      mockModule("../services/mikrotik/credentialLifecycle", {
        rotateRouterSecret: async () => ({ success: true }),
        revokeRouterSecret: async () => ({ success: true }),
        deleteDeviceWithRevocation: async () => ({ success: true }),
      }, require.resolve("../routes/devices.js"));

      installInterceptor();
      try {
        const mod = require("../routes/devices.js");
        ta.ok(mod, "Default export should load");
        ta.ok(typeof mod.handle === "function", "Default export should be an Express Router");
        ta.ok(typeof mod.createDevicesRouter === "function", "Named export createDevicesRouter should exist");
      } finally {
        uninstallInterceptor();
        clearMocks();
      }
    });

    await test("named export createDevicesRouter is available", async () => {
      const { createDevicesRouter } = buildRouterWithDI();
      ta.ok(typeof createDevicesRouter === "function", "createDevicesRouter should be a function");
    });
  });

  // ===========================================================================
  await describe("Dependency Injection — Mock dependencies without production Firebase", async () => {
    await resetTestState();

    await test("works entirely with mocks — no serviceAccountKey.json needed", async () => {
      const { router } = buildRouterWithDI({
        db: new MockFirestore(),
        admin: { firestore: () => new MockFirestore() },
      });
      ta.ok(router, "Router should be built entirely with mocks");
    });

    await test("mock credentialLifecycle is used instead of real module", async () => {
      let clCalled = false;
      const { router } = buildRouterWithDI({
        credentialLifecycle: {
          rotateRouterSecret: async () => { clCalled = true; return { success: true, hasSecret: true }; },
          revokeRouterSecret: async () => { clCalled = true; return { success: true, hasSecret: false }; },
          deleteDeviceWithRevocation: async () => { clCalled = true; return { success: true }; },
        },
      });

      await db.collection("devices").doc("device-cl-1").set({
        deviceId: "device-cl-1",
        ownerId: "owner-1",
        routerOsApiSecretRef: "rsec-existing",
      });

      const app = mountApp(router);
      const res = await request(app)
        .post("/api/devices/device-cl-1/router-secret")
        .set("Authorization", "Bearer token-1")
        .send({ secret: "test-secret" });

      ta.strictEqual(res.status, 200);
      ta.ok(clCalled, "Injected credentialLifecycle should be called");
    });

await test("mock registry authentication controls route access", async () => {
    let authCalls = 0;
    const { router } = buildRouterWithDI({
      registry: {
        authenticateOwnerOrSuper: async () => {
          authCalls++;
          return { kind: "owner", ownerId: "owner-1" };
        },
        RegistryError: class extends Error {
          constructor(status, code, message) { super(message); this.status = status; this.code = code; }
        },
        requireOwnerSelf: () => {},
      },
    });

    await db.collection("devices").doc("device-reg-1").set({
      deviceId: "device-reg-1",
      ownerId: "owner-1",
      deviceName: "Registry Test",
    });

    const app = mountApp(router);
    await request(app)
      .get("/api/devices/status/device-reg-1")
      .set("Authorization", "Bearer token-1");

    ta.ok(authCalls > 0, "Registry authenticateOwnerOrSuper should be called");
  });
  });

  // ===========================================================================
  await describe("Dependency Injection — Existing exports and route mounting compatibility", async () => {
    await resetTestState();

await test("router is mountable in Express like server.js does", async () => {
    const { router } = buildRouterWithDI();
    const app = express();
    app.use(express.json());
    app.use("/", router);

    await db.collection("devices").doc("device-mount-1").set({
      deviceId: "device-mount-1",
      ownerId: "owner-1",
      deviceName: "Mount Test",
    });

    const res = await request(app)
      .get("/api/devices/status/device-mount-1")
      .set("Authorization", "Bearer token-1");
    ta.strictEqual(res.status, 200);
    ta.strictEqual(res.body.device.deviceId, "device-mount-1");
  });

    await test("router has PUT and DELETE on /api/devices/:id", async () => {
      const { router } = buildRouterWithDI();
      const idRoutes = router.stack.filter((layer) =>
        layer.route && layer.route.path === "/api/devices/:id"
      );
      ta.ok(idRoutes.length > 0, "Route /api/devices/:id should exist");
      const allMethods = idRoutes.flatMap((r) => Object.keys(r.route.methods || {}));
      ta.ok(allMethods.includes("put"), "PUT method on /api/devices/:id");
      ta.ok(allMethods.includes("delete"), "DELETE method on /api/devices/:id");
    });

    await test("router-secret route supports both POST and DELETE", async () => {
      const { router } = buildRouterWithDI();
      const postRoute = router.stack.find((layer) =>
        layer.route && layer.route.path === "/api/devices/:deviceId/router-secret" &&
        layer.route.methods && layer.route.methods.post
      );
      const deleteRoute = router.stack.find((layer) =>
        layer.route && layer.route.path === "/api/devices/:deviceId/router-secret" &&
        layer.route.methods && layer.route.methods.delete
      );
      ta.ok(postRoute, "POST /api/devices/:deviceId/router-secret should exist");
      ta.ok(deleteRoute, "DELETE /api/devices/:deviceId/router-secret should exist");
    });
  });

  const allPassed = report();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
