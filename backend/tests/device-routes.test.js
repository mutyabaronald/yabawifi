"use strict";

// Device route tests for backend/routes/devices.js
// Tests device registration, listing, updates, deletion, authentication,
// authorization, cross-owner rejection, network control, default ports,
// and vendor validation.
//
// Uses supertest for HTTP-level testing against an Express app with the
// devices router mounted, and injected mock dependencies.

const assert = require("assert");
const express = require("express");
const request = require("supertest");
const { v4: uuidv4 } = require("uuid");

const {
  MockFirestore,
} = require("./helpers/mock-firestore");
const { mockModule, installInterceptor, uninstallInterceptor, clearMocks } = require("./helpers/mock-modules");
const { test, describe, report, ta } = require("./helpers/test-runner");

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------
let db;
let app;
let mockRegistry;
let mockCisco;
let mockFeatureFlag;
let currentAuth;
let authShouldFail = false;

function makeRegistryError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

async function resetTestState() {
  db = new MockFirestore();
  currentAuth = null;
  authShouldFail = false;
  mockRegistry = {
    authenticateOwnerOrSuper: async (req) => {
      if (authShouldFail || !currentAuth) {
        throw makeRegistryError(401, "unauthenticated", "Authentication token required");
      }
      return { ...currentAuth };
    },
    RegistryError: class extends Error {
      constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
      }
    },
    requireOwnerSelf: (auth, requestedOwnerId) => {
      if (!requestedOwnerId) {
        throw new mockRegistry.RegistryError(400, "validation_error", "ownerId is required");
      }
      if (auth.ownerId !== requestedOwnerId) {
        throw new mockRegistry.RegistryError(403, "unauthorized_scope", "Owner can only act on their own roaming records");
      }
    },
  };
  mockCisco = {
    checkCiscoConnection: async (device) => ({ success: true, model: "Cisco", version: "1.0", message: "OK" }),
  };
  mockFeatureFlag = {
    NETWORK_CONTROL_MODES: Object.freeze({ NONE: "none", FULL: "full", LIMITED: "limited" }),
    NETWORK_CONTROL_VALUES: ["none", "full", "limited"],
    DEFAULT_ROUTER_OS_API_PORT: 8728,
    normalizeNetworkControl: (val) => {
      const v = String(val).toLowerCase();
      if (v === "full" || v === "limited") return v;
      return "none";
    },
  };
}

function buildApp() {
  const adminMock = {
    firestore: Object.assign(() => db, {
      FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
    }),
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
  };
  mockModule("../firebase", {
    db,
    admin: adminMock,
  }, require.resolve("../routes/devices.js"));

  mockModule("../services/roamingRegistryService", mockRegistry, require.resolve("../routes/devices.js"));

  mockModule("../services/ciscoService", {
    checkCiscoConnection: mockCisco.checkCiscoConnection,
  }, require.resolve("../routes/devices.js"));

  mockModule("../services/mikrotik/featureFlag", mockFeatureFlag, require.resolve("../routes/devices.js"));

  mockModule("../services/mikrotik/credentialLifecycle", {
    rotateRouterSecret: async () => ({ success: true, hasSecret: true, operationId: "op-1", reference: "rsec_00000000-0000-0000-0000-000000000001" }),
    revokeRouterSecret: async () => ({ success: true, hasSecret: false, operationId: "op-2" }),
    deleteDeviceWithRevocation: async () => ({ success: true, operationId: "op-3" }),
    ConcurrentModificationError: class extends Error { constructor() { super("concurrent"); this.name = "ConcurrentModificationError"; this.code = 409; } },
    CredentialIntegrityError: class extends Error { constructor() { super("integrity"); this.name = "CredentialIntegrityError"; this.code = 500; } },
    DeviceNotFoundError: class extends Error { constructor() { super("not found"); this.name = "DeviceNotFoundError"; this.code = 404; } },
    OwnerMismatchError: class extends Error { constructor() { super("mismatch"); this.name = "OwnerMismatchError"; this.code = 403; } },
    TransactionContentionError: class extends Error { constructor() { super("contention"); this.name = "TransactionContentionError"; this.code = 503; this.retryable = true; } },
  }, require.resolve("../routes/devices.js"));

  installInterceptor();

  try {
    const { createDevicesRouter } = require("../routes/devices.js");
    const router = createDevicesRouter({
      db,
      admin: adminMock,
      registry: mockRegistry,
      credentialLifecycle: {
        rotateRouterSecret: async () => ({ success: true, hasSecret: true }),
        revokeRouterSecret: async () => ({ success: true, hasSecret: false }),
        deleteDeviceWithRevocation: async () => ({ success: true }),
      },
      checkCiscoConnection: mockCisco.checkCiscoConnection,
      featureFlag: mockFeatureFlag,
    });

    const testApp = express();
    testApp.use(express.json());
    testApp.use("/", router);
    return testApp;
  } finally {
    uninstallInterceptor();
    clearMocks();
  }
}

function setAuth(auth) {
  currentAuth = auth;
}

function setAuthFail(shouldFail) {
  authShouldFail = shouldFail;
}

async function createDeviceViaDb(ownerId, overrides = {}) {
  const deviceId = uuidv4();
  const doc = {
    deviceId,
    ownerId,
    deviceName: overrides.deviceName || "Test Router",
    deviceType: overrides.deviceType || "mikrotik",
    vendor: overrides.vendor || "mikrotik",
    vendorModel: overrides.vendorModel || null,
    serviceType: overrides.serviceType || ["hotspot"],
    status: overrides.status || "online",
    token: overrides.token || "test-token-" + deviceId,
    ip: overrides.ip || null,
    sshPort: overrides.sshPort || null,
    sshUser: overrides.sshUser || null,
    sshPassword: overrides.sshPassword || null,
    enablePassword: overrides.enablePassword || null,
    networkControl: overrides.networkControl || "none",
    routerOsApiEnabled: overrides.routerOsApiEnabled || false,
    routerOsApiPort: overrides.routerOsApiPort || 8728,
    routerOsHost: overrides.routerOsHost || null,
    routerOsApiSecretRef: overrides.routerOsApiSecretRef || null,
    routerOsLastSeenAt: null,
    routerOsApiState: "unknown",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  await db.collection("devices").doc(deviceId).set(doc);
  return { deviceId, ...doc };
}

// ===========================================================================
async function main() {
  // ===========================================================================
  // TEST SUITE: Registration
  // ===========================================================================
  await describe("Device Routes — Registration (POST /api/devices)", async () => {
    await resetTestState();
    app = buildApp();

    await test("registers a device for the authenticated owner", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .post("/api/devices")
        .set("Authorization", "Bearer owner-token-1")
        .send({
          ownerId: "owner-1",
          deviceName: "My Router",
          serviceType: "hotspot",
          deviceType: "mikrotik",
        });
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
      ta.ok(res.body.device.deviceId);
      ta.strictEqual(res.body.device.ownerId, "owner-1");
      ta.strictEqual(res.body.device.deviceName, "My Router");
      ta.strictEqual(res.body.device.status, "pending");
      ta.strictEqual(res.body.device.sshPassword, undefined);
      ta.strictEqual(res.body.device.token, undefined);
      ta.strictEqual(res.body.device.routerOsApiSecretRef, undefined);
    });

    await test("rejects registration without authentication", async () => {
      setAuth(null);
      const res = await request(app)
        .post("/api/devices")
        .send({ ownerId: "owner-1", deviceName: "X", serviceType: "hotspot" });
      ta.strictEqual(res.status, 401);
      ta.strictEqual(res.body.success, false);
    });

    await test("rejects registration with missing required fields", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .post("/api/devices")
        .set("Authorization", "Bearer owner-token-1")
        .send({ ownerId: "owner-1" });
      ta.strictEqual(res.status, 400);
      ta.strictEqual(res.body.success, false);
    });

    await test("rejects unsupported vendor", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .post("/api/devices")
        .set("Authorization", "Bearer owner-token-1")
        .send({
          ownerId: "owner-1",
          deviceName: "Bad Vendor",
          serviceType: "hotspot",
          vendor: "alienware",
        });
      ta.strictEqual(res.status, 400);
      ta.strictEqual(res.body.success, false);
    });

    await test("accepts all valid vendors", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      for (const vendor of ["mikrotik", "unifi", "omada", "cisco", "generic"]) {
        const res = await request(app)
          .post("/api/devices")
          .set("Authorization", "Bearer owner-token-1")
          .send({
            ownerId: "owner-1",
            deviceName: vendor + " Router",
            serviceType: "hotspot",
            vendor,
          });
        ta.strictEqual(res.status, 200, `vendor ${vendor} should be accepted`);
        ta.strictEqual(res.body.device.vendor, vendor);
      }
    });

    await test("superadmin can create a device for another owner", async () => {
      setAuth({ kind: "superadmin", email: "admin@yabalink.com" });
      const res = await request(app)
        .post("/api/devices")
        .set("Authorization", "Bearer superadmin-token")
        .send({
          ownerId: "some-other-owner",
          deviceName: "Superadmin Device",
          serviceType: "pppoe",
          vendor: "mikrotik",
        });
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.device.ownerId, "some-other-owner");
    });

    await test("owner cannot create a device for another owner", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .post("/api/devices")
        .set("Authorization", "Bearer owner-token-1")
        .send({
          ownerId: "owner-2",
          deviceName: "Someone Else's Device",
          serviceType: "hotspot",
        });
      ta.strictEqual(res.status, 403);
      ta.strictEqual(res.body.success, false);
    });

    await test("defaults networkControl to NONE when not provided", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .post("/api/devices")
        .set("Authorization", "Bearer owner-token-1")
        .send({ ownerId: "owner-1", deviceName: "NC Test", serviceType: "hotspot" });
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.device.networkControl, "none");
    });

    await test("accepts valid networkControl values", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      for (const nc of ["none", "full", "limited"]) {
        const res = await request(app)
          .post("/api/devices")
          .set("Authorization", "Bearer owner-token-1")
          .send({
            ownerId: "owner-1",
            deviceName: "NC " + nc,
            serviceType: "hotspot",
            networkControl: nc,
          });
        ta.strictEqual(res.status, 200, `networkControl ${nc} should be accepted`);
      }
    });

    await test("defaults routerOsApiPort to 8728 when not provided", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .post("/api/devices")
        .set("Authorization", "Bearer owner-token-1")
        .send({ ownerId: "owner-1", deviceName: "Port Test", serviceType: "hotspot" });
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.device.routerOsApiPort, 8728);
    });

    await test("rejects routerOsHost with URL scheme", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .post("/api/devices")
        .set("Authorization", "Bearer owner-token-1")
        .send({
          ownerId: "owner-1",
          deviceName: "Bad Host",
          serviceType: "hotspot",
          routerOsHost: "http://192.168.1.1",
        });
      ta.strictEqual(res.status, 400);
    });

    await test("rejects routerOsHost that is loopback", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .post("/api/devices")
        .set("Authorization", "Bearer owner-token-1")
        .send({
          ownerId: "owner-1",
          deviceName: "Loopback Host",
          serviceType: "hotspot",
          routerOsHost: "127.0.0.1",
        });
      ta.strictEqual(res.status, 400);
    });

    await test("accepts RFC1918 private IP as routerOsHost", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .post("/api/devices")
        .set("Authorization", "Bearer owner-token-1")
        .send({
          ownerId: "owner-1",
          deviceName: "Private IP Host",
          serviceType: "hotspot",
          routerOsHost: "192.168.1.1",
        });
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.device.routerOsHost, "192.168.1.1");
    });
  });

  // ===========================================================================
  await describe("Device Routes — Listing (GET /api/devices/owner/:ownerId)", async () => {
    await resetTestState();
    app = buildApp();

    await test("lists devices owned by the authenticated owner", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      await createDeviceViaDb("owner-1", { deviceName: "Router A" });
      await createDeviceViaDb("owner-1", { deviceName: "Router B" });
      await createDeviceViaDb("owner-2", { deviceName: "Owner 2 Router" });

      const res = await request(app)
        .get("/api/devices/owner/owner-1")
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
      ta.strictEqual(res.body.devices.length, 2);
      ta.ok(res.body.devices.every((d) => d.ownerId === "owner-1"));
    });

    await test("rejects listing without authentication", async () => {
      setAuth(null);
      const res = await request(app)
        .get("/api/devices/owner/owner-1");
      ta.strictEqual(res.status, 401);
    });

    await test("owner cannot list another owner's devices", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      await createDeviceViaDb("owner-2", { deviceName: "Owner 2 Router" });

      const res = await request(app)
        .get("/api/devices/owner/owner-2")
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 403);
    });

    await test("superadmin can list any owner's devices", async () => {
      setAuth({ kind: "superadmin", email: "admin@yabalink.com" });
      await createDeviceViaDb("owner-super-1", { deviceName: "Owner 1 Router" });
      await createDeviceViaDb("owner-super-2", { deviceName: "Owner 2 Router" });

      const res = await request(app)
        .get("/api/devices/owner/owner-super-2")
        .set("Authorization", "Bearer superadmin-token");
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.devices.length, 1);
      ta.strictEqual(res.body.devices[0].ownerId, "owner-super-2");
    });

    await test("sanitized device listing excludes credential fields", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      await createDeviceViaDb("owner-1", {
        deviceName: "Sanitized Router",
        sshPassword: "secret-ssh",
        enablePassword: "secret-enable",
        token: "secret-token",
        routerOsApiSecretRef: "rsec_secret-ref",
      });

      const res = await request(app)
        .get("/api/devices/owner/owner-1")
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 200);
      const device = res.body.devices.find((d) => d.deviceName === "Sanitized Router");
      ta.strictEqual(device.sshPassword, undefined);
      ta.strictEqual(device.enablePassword, undefined);
      ta.strictEqual(device.token, undefined);
      ta.strictEqual(device.routerOsApiSecretRef, undefined);
      ta.strictEqual(device.hasPassword, true);
      ta.strictEqual(device.hasEnablePassword, true);
      ta.strictEqual(device.hasSecret, true);
    });
  });

  // ===========================================================================
  await describe("Device Routes — Get Single Device (GET /api/devices/:id)", async () => {
    await resetTestState();
    app = buildApp();

    await test("returns a device the owner owns", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "Single Device" });

      const res = await request(app)
        .get(`/api/devices/status/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
      ta.strictEqual(res.body.device.deviceId, deviceId);
    });

    await test("returns 404 for non-existent device", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .get("/api/devices/status/non-existent-id")
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 404);
    });

    await test("rejects cross-owner access to a device", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-2", { deviceName: "Owner 2's Device" });

      const res = await request(app)
        .get(`/api/devices/status/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 403);
    });

    await test("superadmin can access any device", async () => {
      setAuth({ kind: "superadmin", email: "admin@yabalink.com" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "Super Admin Device" });

      const res = await request(app)
        .get(`/api/devices/status/${deviceId}`)
        .set("Authorization", "Bearer superadmin-token");
      ta.strictEqual(res.status, 200);
    });

    await test("rejects missing authentication for device lookup", async () => {
      setAuth(null);
      const res = await request(app)
        .get("/api/devices/status/some-id");
      ta.strictEqual(res.status, 401);
    });
  });

  // ===========================================================================
  await describe("Device Routes — Update (PUT /api/devices/:id)", async () => {
    await resetTestState();
    app = buildApp();

    await test("updates device fields the owner owns", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "Old Name" });

      const res = await request(app)
        .put(`/api/devices/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1")
        .send({ deviceName: "New Name", routerOsHost: "10.0.0.1" });
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
    });

    await test("rejects updating immutable fields", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "Immutable Test" });

      const res = await request(app)
        .put(`/api/devices/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1")
        .send({ ownerId: "owner-2", deviceId: "hacked-id", token: "new-token", deviceName: "Renamed" });
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
      const getRes = await request(app)
        .get(`/api/devices/status/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(getRes.body.device.ownerId, "owner-1");
      ta.strictEqual(getRes.body.device.deviceId, deviceId);
      ta.strictEqual(getRes.body.device.deviceName, "Renamed");
    });

    await test("rejects update without authentication", async () => {
      setAuth(null);
      const res = await request(app)
        .put("/api/devices/some-id")
        .send({ deviceName: "X" });
      ta.strictEqual(res.status, 401);
    });

    await test("rejects cross-owner update", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-2", { deviceName: "Owner 2's Device" });

      const res = await request(app)
        .put(`/api/devices/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1")
        .send({ deviceName: "Hacked Name" });
      ta.strictEqual(res.status, 403);
    });

    await test("superadmin can update any device", async () => {
      setAuth({ kind: "superadmin", email: "admin@yabalink.com" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "Original" });

      const res = await request(app)
        .put(`/api/devices/${deviceId}`)
        .set("Authorization", "Bearer superadmin-token")
        .send({ deviceName: "Updated by Superadmin" });
      ta.strictEqual(res.status, 200);
    });

    await test("rejects update with no updatable fields", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "No Change" });

      const res = await request(app)
        .put(`/api/devices/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1")
        .send({});
      ta.strictEqual(res.status, 400);
    });

    await test("validates networkControl on update", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "NC Update" });

      const res = await request(app)
        .put(`/api/devices/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1")
        .send({ networkControl: "invalid-value" });
      ta.strictEqual(res.status, 400);
    });
  });

  // ===========================================================================
  await describe("Device Routes — Deletion (DELETE /api/devices/:id)", async () => {
    await resetTestState();
    app = buildApp();

    await test("deletes a device the owner owns", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "To Be Deleted" });

      const res = await request(app)
        .delete(`/api/devices/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);

      const getRes = await request(app)
        .get(`/api/devices/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(getRes.status, 404);
    });

    await test("rejects deletion without authentication", async () => {
      setAuth(null);
      const res = await request(app)
        .delete("/api/devices/some-id");
      ta.strictEqual(res.status, 401);
    });

    await test("rejects cross-owner deletion", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-2", { deviceName: "Owner 2's Device" });

      const res = await request(app)
        .delete(`/api/devices/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 403);
    });

    await test("superadmin can delete any device", async () => {
      setAuth({ kind: "superadmin", email: "admin@yabalink.com" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "Superadmin Delete" });

      const res = await request(app)
        .delete(`/api/devices/${deviceId}`)
        .set("Authorization", "Bearer superadmin-token");
      ta.strictEqual(res.status, 200);
    });

    await test("returns 404 for deleting non-existent device", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .delete("/api/devices/non-existent-id")
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 404);
    });
  });

  // ===========================================================================
  await describe("Device Routes — Router Credential Lifecycle (POST/DELETE /api/devices/:deviceId/router-secret)", async () => {
    await resetTestState();
    app = buildApp();

    await test("stores a router secret via POST", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "Secret Device" });

      const res = await request(app)
        .post(`/api/devices/${deviceId}/router-secret`)
        .set("Authorization", "Bearer owner-token-1")
        .send({ secret: "my-router-api-secret" });
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
      ta.strictEqual(res.body.hasSecret, true);
    });

    await test("rejects secret creation without authentication", async () => {
      setAuth(null);
      const res = await request(app)
        .post("/api/devices/some-id/router-secret")
        .send({ secret: "x" });
      ta.strictEqual(res.status, 401);
    });

    await test("rejects empty secret", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "Empty Secret" });

      const res = await request(app)
        .post(`/api/devices/${deviceId}/router-secret`)
        .set("Authorization", "Bearer owner-token-1")
        .send({ secret: "" });
      ta.strictEqual(res.status, 400);
    });

    await test("revokes a router secret via DELETE", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", {
        deviceName: "Revoke Device",
        routerOsApiSecretRef: "rsec_existing-ref",
      });

      const res = await request(app)
        .delete(`/api/devices/${deviceId}/router-secret`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
      ta.strictEqual(res.body.hasSecret, false);
    });

    await test("rejects cross-owner secret access", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-2", { deviceName: "Owner 2 Secret Device" });

      const res = await request(app)
        .post(`/api/devices/${deviceId}/router-secret`)
        .set("Authorization", "Bearer owner-token-1")
        .send({ secret: "stolen-secret" });
      ta.strictEqual(res.status, 403);
    });

    await test("superadmin can manage secrets on any device", async () => {
      setAuth({ kind: "superadmin", email: "admin@yabalink.com" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "Superadmin Secret Device" });

      const res = await request(app)
        .post(`/api/devices/${deviceId}/router-secret`)
        .set("Authorization", "Bearer superadmin-token")
        .send({ secret: "superadmin-secret" });
      ta.strictEqual(res.status, 200);
    });
  });

  // ===========================================================================
  await describe("Device Routes — Provisioning Script (GET /api/provisioning/script)", async () => {
    await resetTestState();
    app = buildApp();

    await test("returns provisioning script for owned device", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId, token } = await createDeviceViaDb("owner-1", { deviceName: "Provision Device" });

      const res = await request(app)
        .get(`/api/provisioning/script?deviceId=${deviceId}`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 200);
      ta.ok(res.text.includes("/tool fetch"));
      ta.ok(res.text.includes(deviceId));
      ta.ok(res.text.includes(token));
    });

    await test("rejects provisioning script without deviceId", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .get("/api/provisioning/script")
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 400);
    });

    await test("rejects provisioning script for non-existent device", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const res = await request(app)
        .get("/api/provisioning/script?deviceId=non-existent")
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 404);
    });

    await test("rejects cross-owner provisioning script access", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-2", { deviceName: "Owner 2 Provision" });

      const res = await request(app)
        .get(`/api/provisioning/script?deviceId=${deviceId}`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 403);
    });
  });

  // ===========================================================================
  await describe("Device Routes — SSH Check (GET /api/devices/:id/ssh-check)", async () => {
    await resetTestState();
    app = buildApp();

    await test("returns SSH check result for Cisco device owned by caller", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", {
        deviceName: "Cisco Router",
        deviceType: "cisco",
        sshPassword: "cisco-pass",
      });

      const res = await request(app)
        .get(`/api/devices/${deviceId}/ssh-check`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
    });

    await test("rejects SSH check for non-Cisco device", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", {
        deviceName: "MikroTik Router",
        deviceType: "mikrotik",
      });

      const res = await request(app)
        .get(`/api/devices/${deviceId}/ssh-check`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 400);
    });

    await test("rejects cross-owner SSH check", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-2", {
        deviceName: "Owner 2 Cisco",
        deviceType: "cisco",
      });

      const res = await request(app)
        .get(`/api/devices/${deviceId}/ssh-check`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 403);
    });
  });

  // ===========================================================================
  await describe("Device Routes — Device Status (GET /api/devices/status/:id)", async () => {
    await resetTestState();
    app = buildApp();

    await test("returns device status for owned device", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "Status Device", status: "online" });

      const res = await request(app)
        .get(`/api/devices/status/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
      ta.strictEqual(res.body.status, "online");
    });

    await test("rejects cross-owner status access", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-2", { deviceName: "Owner 2 Status" });

      const res = await request(app)
        .get(`/api/devices/status/${deviceId}`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 403);
    });
  });

  // ===========================================================================
  await describe("Device Routes — Device Logs (GET /api/devices/:id/logs)", async () => {
    await resetTestState();
    app = buildApp();

    await test("returns device logs for owned device", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-1", { deviceName: "Logs Device" });
      await db.collection("devices").doc(deviceId).collection("logs").doc("log-1").set({
        level: "info",
        type: "device_created",
        message: "Device created",
        meta: {},
        createdAtISO: new Date().toISOString(),
      });

      const res = await request(app)
        .get(`/api/devices/${deviceId}/logs`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 200);
      ta.strictEqual(res.body.success, true);
      ta.ok(Array.isArray(res.body.logs));
      ta.strictEqual(res.body.logs.length, 1);
    });

    await test("rejects cross-owner log access", async () => {
      setAuth({ kind: "owner", ownerId: "owner-1" });
      const { deviceId } = await createDeviceViaDb("owner-2", { deviceName: "Owner 2 Logs" });

      const res = await request(app)
        .get(`/api/devices/${deviceId}/logs`)
        .set("Authorization", "Bearer owner-token-1");
      ta.strictEqual(res.status, 403);
    });
  });

  const allPassed = report();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
