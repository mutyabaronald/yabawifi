/**
 * Hotspot API security and Firestore projection verification.
 *
 * Run from the repository root:  node backend/scripts/check-hotspots-security.js
 *
 * Fully offline and deterministic.
 *
 *   * Firestore is replaced by an in-memory double, so no real document is
 *     created, read or modified.
 *   * Authentication is replaced by a faithful test double of the EXISTING
 *     roamingRegistryService guards, so this checker verifies that hotspots.js
 *     actually CALLS the established guards with the right semantics.
 *   * The Express router under test is the REAL routes/hotspots.js with Firebase
 *     injected, not a re-implementation.
 *
 * Scope: GET /api/hotspots, GET /api/hotspots/:hotspotId,
 *        GET /api/hotspots/owner/:ownerId, GET /api/hotspots/nearby.
 *
 * Phase 8.5A security hardening: verifies that integrationKey, ownerId,
 * deviceId and other sensitive internal fields are never returned by public
 * endpoints.
 */

const path = require("path");
const express = require("express");
const http = require("http");

const ROOT = path.resolve(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");

// ─────────────────────────────────────────────────────────────
// Test harness
// ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`PASS: ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    failed += 1;
    console.error(`FAIL: ${message} - did not throw`);
  } catch (err) {
    passed += 1;
    console.log(`PASS: ${message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// In-memory Firestore double
// ─────────────────────────────────────────────────────────────

function makeInMemoryDb(store) {
  function collection(name) {
    const docs = Object.keys(store).filter((k) => k.startsWith(name + "/")).map((k) => ({
      id: k.split("/")[1],
      data: () => store[k],
    }));

    return {
      _name: name,
      _docs: docs,
      limit: function (n) {
        return {
          get: () => Promise.resolve({ docs: docs.slice(0, n) }),
        };
      },
      get: () => Promise.resolve({ docs }),
      where: function (field, op, value) {
        const filtered = docs.filter((d) => {
          if (op === "==") return d.data()[field] === value;
          return false;
        });
        const result = {
          get: () => Promise.resolve({ docs: filtered }),
          limit: function (n) {
            return {
              get: () => Promise.resolve({ docs: filtered.slice(0, n) }),
            };
          },
        };
        return result;
      },
      doc: function (id) {
        const key = `${name}/${id}`;
        return {
          get: () =>
            Promise.resolve({
              exists: !!store[key],
              id,
              data: () => store[key] || null,
            }),
          set: () => Promise.resolve(),
          update: () => Promise.resolve(),
          ref: { set: () => Promise.resolve(), update: () => Promise.resolve() },
        };
      },
      add: function (data) {
        const id = "test-id";
        const key = `${name}/${id}`;
        store[key] = data;
        return Promise.resolve({
          id,
          get: () =>
            Promise.resolve({
              exists: true,
              data: () => store[key],
            }),
        });
      },
    };
  }

  return {
    collection,
  };
}

// ─────────────────────────────────────────────────────────────
// In-memory auth double (faithful to roamingRegistryService)
// ─────────────────────────────────────────────────────────────

function makeMockRegistry({ ownerId, kind }) {
  const RegistryError = class RegistryError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  };

  return {
    RegistryError,
    authenticateOwnerOrSuper: async (req) => {
      const token = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (!token) {
        throw new RegistryError(401, "unauthenticated", "Authentication token required");
      }
      if (token === "INVALID") {
        throw new RegistryError(401, "unauthenticated", "Invalid or expired token");
      }
      if (kind === "superadmin") {
        return { kind: "superadmin", email: "admin@example.com", actor: "superadmin:test" };
      }
      if (token === `owner-session-${ownerId}`) {
        return { kind: "owner", ownerId, phone: "+256700000001", actor: `owner:${ownerId}` };
      }
      throw new RegistryError(401, "unauthenticated", "Invalid or expired session");
    },
    requireOwnerSelf: (auth, requestedOwnerId) => {
      if (!requestedOwnerId) {
        throw new RegistryError(400, "validation_error", "ownerId is required");
      }
      if (auth.ownerId !== requestedOwnerId) {
        throw new RegistryError(403, "unauthorized_scope", "Owner can only act on their own roaming records");
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Setup test data
// ─────────────────────────────────────────────────────────────

const testData = {
  "hotspots/hostA": {
    hotspotName: "Test Hotspot A",
    address: "123 Test St",
    ssid: "TestSSID-A",
    routerType: "mikrotik",
    latitude: 0.3476,
    longitude: 32.5825,
    status: "online",
    ownerId: "ownerA",
    integrationKey: "secret-key-A",
    deviceId: "dev-001",
    reviewsEnabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    loyalty_program_enabled: true,
  },
  "hotspots/hostB": {
    hotspotName: "Test Hotspot B",
    address: "456 Test Ave",
    ssid: "TestSSID-B",
    routerType: "cisco",
    latitude: 0.3576,
    longitude: 32.5925,
    status: "offline",
    ownerId: "ownerB",
    integrationKey: "secret-key-B",
    deviceId: "dev-002",
    reviewsEnabled: false,
    createdAt: "2026-01-02T00:00:00Z",
    loyalty_program_enabled: false,
  },
};

// ─────────────────────────────────────────────────────────────
// Module loading with injection
// ─────────────────────────────────────────────────────────────

// Clear cache so we can inject our in-memory db
function loadHotspotsRouter(db, mockRegistry) {
  delete require.cache[require.resolve(path.join(BACKEND, "routes/hotspots.js"))];
  // Override the requires before loading
  const Module = require("module");
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function(id) {
    if (id === "../firebase" || id === path.join(BACKEND, "firebase")) {
      return { db };
    }
    if (id === "../services/roamingRegistryService" || id === path.join(BACKEND, "services/roamingRegistryService")) {
      return mockRegistry;
    }
    return originalRequire.apply(this, arguments);
  };
  try {
    const router = require(path.join(BACKEND, "routes/hotspots.js"));
    return router;
  } finally {
    Module.prototype.require = originalRequire;
  }
}

// ─────────────────────────────────────────────────────────────
// Create Express app for testing
// ─────────────────────────────────────────────────────────────

function createApp(db, mockRegistry, ownerId) {
  const registry = makeMockRegistry({ ownerId: ownerId || "ownerA", kind: ownerId ? "owner" : "superadmin" });
  const router = loadHotspotsRouter(db, registry);
  const app = express();
  app.use(express.json());
  app.use("/api/hotspots", router);
  return app;
}

// ─────────────────────────────────────────────────────────────
// HTTP test helper
// ─────────────────────────────────────────────────────────────

async function makeRequest(app, method, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: "127.0.0.1",
        port,
        path: url,
        method,
        headers,
      };
      const req = http.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, body: body });
          }
        });
      });
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  const db = makeInMemoryDb(testData);

  // ─── Test 1: Public GET /api/hotspots excludes sensitive fields ───
  const app1 = createApp(db, null, "ownerA");
  const res1 = await makeRequest(app1, "GET", "/api/hotspots");
  assert(res1.status === 200, "GET /api/hotspots returns 200");
  assert(res1.body.success === true, "GET /api/hotspots returns success:true");
  assert(Array.isArray(res1.body.hotspots), "GET /api/hotspots returns hotspots array");
  if (res1.body.hotspots.length > 0) {
    const h = res1.body.hotspots[0];
    assert(h.id !== undefined, "Public hotspot has id field");
    assert(h.hotspotName !== undefined, "Public hotspot has hotspotName");
    assert(h.latitude !== undefined, "Public hotspot has latitude");
    assert(h.longitude !== undefined, "Public hotspot has longitude");
    assert(h.status !== undefined, "Public hotspot has status");
    assert(h.ssid !== undefined, "Public hotspot has ssid");
    assert(h.integrationKey === undefined, "Public hotspot EXCLUDES integrationKey");
    assert(h.ownerId === undefined, "Public hotspot EXCLUDES ownerId");
    assert(h.deviceId === undefined, "Public hotspot EXCLUDES deviceId");
    assert(h.address === undefined, "Public hotspot EXCLUDES address");
  }

  // ─── Test 2: GET /api/hotspots/:hotspotId excludes sensitive fields ───
  const res2 = await makeRequest(app1, "GET", "/api/hotspots/hostA");
  assert(res2.status === 200, "GET /api/hotspots/:id returns 200");
  assert(res2.body.success === true, "GET /api/hotspots/:id returns success:true");
  const singleH = res2.body.hotspot;
  assert(singleH !== undefined, "Single hotspot is returned");
  assert(singleH.id === "hostA", "Single hotspot has correct id");
  assert(singleH.hotspotName === "Test Hotspot A", "Single hotspot has hotspotName");
  assert(singleH.latitude === 0.3476, "Single hotspot has latitude");
  assert(singleH.longitude === 32.5825, "Single hotspot has longitude");
  assert(singleH.status === "online", "Single hotspot has status");
  assert(singleH.reviewsEnabled === true, "Single hotspot has reviewsEnabled");
  assert(singleH.integrationKey === undefined, "Single hotspot EXCLUDES integrationKey");
  assert(singleH.ownerId === undefined, "Single hotspot EXCLUDES ownerId");
  assert(singleH.deviceId === undefined, "Single hotspot EXCLUDES deviceId");
  assert(singleH.location !== undefined, "Single hotspot INCLUDES location field (for Login.jsx compatibility)");

  // ─── Test 3: GET /api/hotspots/owner/:ownerId without auth → 401 ───
  const res3 = await makeRequest(app1, "GET", "/api/hotspots/owner/ownerA");
  assert(res3.status === 401, "GET /api/hotspots/owner/:id without auth returns 401");
  assert(res3.body.success === false, "Unauthorized response returns success:false");
  assert(res3.body.error === "unauthenticated", "Unauthorized response has correct error code");

  // ─── Test 4: GET /api/hotspots/owner/:ownerId with valid owner token → 200 ───
  const res4 = await makeRequest(app1, "GET", "/api/hotspots/owner/ownerA", {
    Authorization: "Bearer owner-session-ownerA",
  });
  assert(res4.status === 200, "GET /api/hotspots/owner/:id with valid owner token returns 200");
  assert(Array.isArray(res4.body.hotspots), "Owner response returns hotspots array");
  if (res4.body.hotspots.length > 0) {
    const oh = res4.body.hotspots[0];
    assert(oh.id !== undefined, "Owner hotspot has id");
    assert(oh.hotspotName !== undefined, "Owner hotspot has hotspotName");
    assert(oh.latitude !== undefined, "Owner hotspot has latitude");
    assert(oh.longitude !== undefined, "Owner hotspot has longitude");
    assert(oh.status !== undefined, "Owner hotspot has status");
    assert(oh.integrationKey === undefined, "Owner hotspot EXCLUDES integrationKey");
    assert(oh.ssid === undefined, "Owner hotspot EXCLUDES ssid");
    assert(oh.routerType !== undefined, "Owner hotspot has routerType (needed by AdminDashboard)");
    assert(oh.createdAt !== undefined, "Owner hotspot has createdAt (needed by AdminDashboard.jsx:8687)");
  }

  // ─── Test 5: Owner cannot access another owner's hotspots → 403 ───
  const res5 = await makeRequest(app1, "GET", "/api/hotspots/owner/ownerB", {
    Authorization: "Bearer owner-session-ownerA",
  });
  assert(res5.status === 403, "Owner cannot access another owner's hotspots → 403");
  assert(res5.body.error === "unauthorized_scope", "Cross-owner access returns unauthorized_scope");

  // ─── Test 6: Super-admin can access any owner's hotspots → 200 ───
  const superRegistry = makeMockRegistry({ ownerId: "ownerA", kind: "superadmin" });
  const superRouter = loadHotspotsRouter(db, superRegistry);
  const superApp = express();
  superApp.use(express.json());
  superApp.use("/api/hotspots", superRouter);
  const res6 = await makeRequest(superApp, "GET", "/api/hotspots/owner/ownerB", {
    Authorization: "Bearer superadmin-token",
  });
  assert(res6.status === 200, "Super-admin can access any owner's hotspots");
  if (res6.body.hotspots.length > 0) {
    const soh = res6.body.hotspots[0];
    assert(soh.integrationKey === undefined, "Super-admin response also EXCLUDES integrationKey");
    assert(soh.ssid === undefined, "Super-admin response also EXCLUDES ssid");
    assert(soh.id !== undefined, "Super-admin response has hotspot id");
    assert(soh.createdAt !== undefined, "Super-admin response has createdAt");
  }

  // ─── Test 7: Invalid token → 401 ───
  const res7 = await makeRequest(app1, "GET", "/api/hotspots/owner/ownerA", {
    Authorization: "Bearer INVALID",
  });
  assert(res7.status === 401, "Invalid token returns 401");

  // ─── Test 8: Nearby endpoint excludes ownerId ───
  const res8 = await makeRequest(app1, "GET", "/api/hotspots/nearby?lat=0.3476&lng=32.5825&radiusKm=5");
  assert(res8.status === 200, "GET /nearby returns 200");
  assert(res8.body.success === true, "GET /nearby returns success:true");
  if (res8.body.hotspots.length > 0) {
    const nh = res8.body.hotspots[0];
    assert(nh.ownerId === undefined, "Nearby hotspots EXCLUDE ownerId");
    assert(nh.integrationKey === undefined, "Nearby hotspots EXCLUDE integrationKey");
    assert(nh.deviceId === undefined, "Nearby hotspots EXCLUDE deviceId");
    assert(nh.hotspotName !== undefined, "Nearby hotspots INCLUDE hotspotName");
    assert(nh.latitude !== undefined, "Nearby hotspots INCLUDE latitude");
    assert(nh.longitude !== undefined, "Nearby hotspots INCLUDE longitude");
  }

  // ─── Test 9: Firestore error handled safely ───
  const errorDb = {
    collection: () => {
      throw new Error("Firestore unavailable");
    },
  };
  const errorApp = createApp(errorDb, makeMockRegistry({ ownerId: "ownerA", kind: "superadmin" }), null);
  const res9 = await makeRequest(errorApp, "GET", "/api/hotspots");
  assert(res9.status === 500, "Firestore error returns 500");
  assert(res9.body.success === false, "Error response has success:false");
  assert(Array.isArray(res9.body.hotspots), "Error response returns empty hotspots array");

  // ─── Test 10: Non-existent hotspot → 404 ───
  const res10 = await makeRequest(app1, "GET", "/api/hotspots/nonexistent");
  assert(res10.status === 404, "Non-existent hotspot returns 404");
  assert(res10.body.error === "Hotspot not found", "404 returns correct error message");

  // ─── Summary ───
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
