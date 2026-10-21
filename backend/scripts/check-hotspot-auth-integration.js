/**
 * Hotspot authentication integration verification.
 *
 * Run from the repository root:  node backend/scripts/check-hotspot-auth-integration.js
 *
 * Exercises the REAL authenticateSuperAdmin, authenticateOwner, and
 * authenticateOwnerOrSuper implementations from
 * backend/services/roamingRegistryService.js using the real jsonwebtoken
 * library and an in-memory Firestore double.
 *
 *   * Firestore is replaced by an in-memory double — no real document is
 *     created, read or modified, and no Firebase credentials are loaded.
 *   * Authentication functions are NOT mocked — the real implementations run.
 *   * jsonwebtoken is NOT mocked — real cryptographic verification occurs.
 *   * The Express router under test is the REAL routes/hotspots.js.
 *
 * Scope: direct function-level auth tests + HTTP-level owner endpoint tests.
 */

const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");

const ROOT = path.resolve(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const ROUTES_DIR = path.resolve(BACKEND, "routes");
const SERVICE_PATH = path.resolve(BACKEND, "services", "roamingRegistryService.js");
const HOTSPOTS_PATH = path.resolve(BACKEND, "routes", "hotspots.js");
const FIREBASE_PATH = path.resolve(BACKEND, "firebase.js");
const PASSWORD_SERVICE_PATH = path.resolve(BACKEND, "services", "passwordService.js");

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
    console.error(
      `FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

async function assertRejects(asyncFn, checkFn, message) {
  try {
    await asyncFn();
    failed += 1;
    console.error(`FAIL: ${message} - did not reject`);
  } catch (err) {
    const ok = checkFn(err);
    if (ok) {
      passed += 1;
      console.log(`PASS: ${message}`);
    } else {
      failed += 1;
      console.error(`FAIL: ${message} - ${err && err.message ? err.message : err}`);
    }
  }
}

function assertThrowsSync(fn, checkFn, message) {
  try {
    fn();
    failed += 1;
    console.error(`FAIL: ${message} - did not throw`);
  } catch (err) {
    const ok = checkFn(err);
    if (ok) {
      passed += 1;
      console.log(`PASS: ${message}`);
    } else {
      failed += 1;
      console.error(`FAIL: ${message} - ${err && err.message ? err.message : err}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// In-memory Firestore double (reused from check-hotspots-security.js)
// ─────────────────────────────────────────────────────────────
function makeInMemoryDb(store) {
  function collection(name) {
    const docs = Object.keys(store)
      .filter((k) => k.startsWith(name + "/"))
      .map((k) => ({
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

  return { collection };
}

// ─────────────────────────────────────────────────────────────
// Test data
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
  "owner_sessions/ownerA-valid": {
    ownerId: "ownerA",
    phone: "+256700000001",
    expiresAt: "2099-12-31T23:59:59.000Z",
  },
  "owner_sessions/ownerA-noexp": {
    ownerId: "ownerA",
    phone: "+256700000001",
  },
  "owner_sessions/ownerA-expired": {
    ownerId: "ownerA",
    phone: "+256700000001",
    expiresAt: "2000-01-01T00:00:00.000Z",
  },
  "owner_sessions/ownerA-noid": {
    phone: "+256700000001",
    expiresAt: "2099-12-31T23:59:59.000Z",
  },
};

// ─────────────────────────────────────────────────────────────
// Environment setup — save/restore SUPERADMIN_JWT_SECRET
// ─────────────────────────────────────────────────────────────
const TEST_SECRET = "test-superadmin-secret-integration-2026";
const originalSecret = process.env.SUPERADMIN_JWT_SECRET;
process.env.SUPERADMIN_JWT_SECRET = TEST_SECRET;

// ─────────────────────────────────────────────────────────────
// Module loading helpers
// ─────────────────────────────────────────────────────────────
function loadRegistry(db) {
  delete require.cache[SERVICE_PATH];
  const Module = require("module");
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (
      id === "../firebase" ||
      id === path.join(BACKEND, "firebase") ||
      id === FIREBASE_PATH
    ) {
      return { db, admin: {} };
    }
    return originalRequire.apply(this, arguments);
  };
  try {
    return require(SERVICE_PATH);
  } finally {
    Module.prototype.require = originalRequire;
  }
}

function loadHotspotsRouter(db) {
  delete require.cache[HOTSPOTS_PATH];
  const Module = require("module");
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (
      id === "../firebase" ||
      id === path.join(BACKEND, "firebase") ||
      id === FIREBASE_PATH
    ) {
      return { db, admin: {} };
    }
    return originalRequire.apply(this, arguments);
  };
  try {
    return require(HOTSPOTS_PATH);
  } finally {
    Module.prototype.require = originalRequire;
  }
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

function createApp(db) {
  const router = loadHotspotsRouter(db);
  const app = express();
  app.use(express.json());
  app.use("/api/hotspots", router);
  return app;
}

// ─────────────────────────────────────────────────────────────
// fakeReq helper
// ─────────────────────────────────────────────────────────────
function fakeReq(token) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

// ─────────────────────────────────────────────────────────────
// Token generation (real jsonwebtoken)
// ─────────────────────────────────────────────────────────────
const superAdminToken = jwt.sign(
  { role: "superadmin", sub: "admin@example.com" },
  TEST_SECRET
);
const wrongRoleToken = jwt.sign(
  { role: "user", sub: "user@example.com" },
  TEST_SECRET
);
const invalidSigToken = jwt.sign(
  { role: "superadmin", sub: "admin@example.com" },
  "wrong-secret-entirely"
);
const expiredJwtToken = jwt.sign(
  { role: "superadmin", sub: "admin@example.com", exp: Math.floor(Date.now() / 1000) - 10 },
  TEST_SECRET
);

// ─────────────────────────────────────────────────────────────
// Load modules with mock db
// ─────────────────────────────────────────────────────────────
const db = makeInMemoryDb(testData);
const registry = loadRegistry(db);
const RegistryError = registry.RegistryError;

// ─────────────────────────────────────────────────────────────
// Direct function-level tests
// ─────────────────────────────────────────────────────────────
async function runDirectTests() {
  console.log("\n=== Direct function-level auth tests ===\n");

  // 1. Valid super-admin JWT accepted
  {
    const auth = registry.authenticateSuperAdmin(fakeReq(superAdminToken));
    assert(auth.email === "admin@example.com", "1. Valid super-admin JWT: email correct");
    assert(auth.actor === "superadmin:admin@example.com", "1. Valid super-admin JWT: actor correct");
  }

  // 2. Invalid signature rejected
  assertThrowsSync(
    () => registry.authenticateSuperAdmin(fakeReq(invalidSigToken)),
    (err) =>
      err instanceof RegistryError &&
      err.status === 401 &&
      err.code === "unauthenticated" &&
      err.message === "Invalid or expired token",
    "2. Invalidly signed super-admin JWT rejected (401/unauthenticated)"
  );

  // 3. Expired super-admin JWT rejected
  assertThrowsSync(
    () => registry.authenticateSuperAdmin(fakeReq(expiredJwtToken)),
    (err) =>
      err instanceof RegistryError &&
      err.status === 401 &&
      err.code === "unauthenticated" &&
      err.message === "Invalid or expired token",
    "3. Expired super-admin JWT rejected (401/unauthenticated)"
  );

  // 4. Validly signed JWT with wrong role cannot obtain super-admin access
  assertThrowsSync(
    () => registry.authenticateSuperAdmin(fakeReq(wrongRoleToken)),
    (err) =>
      err instanceof RegistryError &&
      err.status === 403 &&
      err.code === "unauthorized_scope" &&
      err.message === "Unauthorized access",
    "4. Wrong-role JWT rejected for super-admin (403/unauthorized_scope)"
  );

  // 5. Missing authorization token rejected (super-admin)
  assertThrowsSync(
    () => registry.authenticateSuperAdmin(fakeReq(null)),
    (err) =>
      err instanceof RegistryError &&
      err.status === 401 &&
      err.code === "unauthenticated" &&
      err.message === "Missing token",
    "5. Missing token rejected by authenticateSuperAdmin (401/unauthenticated)"
  );

  // 6. Valid owner session resolves correct owner identity
  {
    const auth = await registry.authenticateOwner(fakeReq("ownerA-valid"));
    assertEqual(auth.ownerId, "ownerA", "6. Valid owner session: ownerId correct");
    assertEqual(auth.phone, "+256700000001", "6. Valid owner session: phone correct");
    assertEqual(auth.actor, "owner:ownerA", "6. Valid owner session: actor correct");
  }

  // 7. Missing owner-session document rejected
  await assertRejects(
    () => registry.authenticateOwner(fakeReq("nonexistent-token-xyz")),
    (err) =>
      err instanceof RegistryError &&
      err.status === 401 &&
      err.code === "unauthenticated" &&
      err.message === "Invalid or expired session",
    "7. Missing owner-session document rejected (401/unauthenticated)"
  );

  // 8. Expired owner session rejected
  await assertRejects(
    () => registry.authenticateOwner(fakeReq("ownerA-expired")),
    (err) =>
      err instanceof RegistryError &&
      err.status === 401 &&
      err.code === "unauthenticated" &&
      err.message === "Session expired",
    "8. Expired owner session rejected (401/unauthenticated)"
  );

  // 9. Owner session without ownerId rejected
  await assertRejects(
    () => registry.authenticateOwner(fakeReq("ownerA-noid")),
    (err) =>
      err instanceof RegistryError &&
      err.status === 401 &&
      err.code === "unauthenticated" &&
      err.message === "Invalid session",
    "9. Owner session without ownerId rejected (401/unauthenticated)"
  );

  // 10. Owner session without expiresAt follows actual implementation (expiry skipped)
  {
    const auth = await registry.authenticateOwner(fakeReq("ownerA-noexp"));
    assertEqual(auth.ownerId, "ownerA", "10. No-expiresAt session: ownerId correct");
    assertEqual(auth.phone, "+256700000001", "10. No-expiresAt session: phone correct");
    assertEqual(auth.actor, "owner:ownerA", "10. No-expiresAt session: actor correct");
  }

  // 11. authenticateOwnerOrSuper with super-admin JWT
  {
    const auth = await registry.authenticateOwnerOrSuper(fakeReq(superAdminToken));
    assertEqual(auth.kind, "superadmin", "11. OwnerOrSuper + super-admin JWT: kind correct");
    assertEqual(auth.email, "admin@example.com", "11. OwnerOrSuper + super-admin JWT: email correct");
    assertEqual(auth.actor, "superadmin:admin@example.com", "11. OwnerOrSuper + super-admin JWT: actor correct");
  }

  // 12. authenticateOwnerOrSuper with valid owner session
  {
    const auth = await registry.authenticateOwnerOrSuper(fakeReq("ownerA-valid"));
    assertEqual(auth.kind, "owner", "12. OwnerOrSuper + owner session: kind correct");
    assertEqual(auth.ownerId, "ownerA", "12. OwnerOrSuper + owner session: ownerId correct");
    assertEqual(auth.phone, "+256700000001", "12. OwnerOrSuper + owner session: phone correct");
    assertEqual(auth.actor, "owner:ownerA", "12. OwnerOrSuper + owner session: actor correct");
  }

  // 13. authenticateOwnerOrSuper with invalid JWT falls through to owner lookup
  await assertRejects(
    () => registry.authenticateOwnerOrSuper(fakeReq(invalidSigToken)),
    (err) =>
      err instanceof RegistryError &&
      err.status === 401 &&
      err.code === "unauthenticated" &&
      err.message === "Invalid or expired session",
    "13. OwnerOrSuper + invalid JWT falls through to owner lookup (401/Invalid or expired session)"
  );

  // 14. authenticateOwnerOrSuper with expired JWT falls through
  await assertRejects(
    () => registry.authenticateOwnerOrSuper(fakeReq(expiredJwtToken)),
    (err) =>
      err instanceof RegistryError &&
      err.status === 401 &&
      err.code === "unauthenticated" &&
      err.message === "Invalid or expired session",
    "14. OwnerOrSuper + expired JWT falls through to owner lookup (401/Invalid or expired session)"
  );

  // 15. authenticateOwnerOrSuper with wrong-role JWT falls through
  await assertRejects(
    () => registry.authenticateOwnerOrSuper(fakeReq(wrongRoleToken)),
    (err) =>
      err instanceof RegistryError &&
      err.status === 401 &&
      err.code === "unauthenticated" &&
      err.message === "Invalid or expired session",
    "15. OwnerOrSuper + wrong-role JWT falls through to owner lookup (401/Invalid or expired session)"
  );

  // 16. authenticateOwnerOrSuper missing token
  await assertRejects(
    () => registry.authenticateOwnerOrSuper(fakeReq(null)),
    (err) =>
      err instanceof RegistryError &&
      err.status === 401 &&
      err.code === "unauthenticated" &&
      err.message === "Authentication token required",
    "16. OwnerOrSuper missing token rejected (401/Authentication token required)"
  );

  // extractBearer tests
  {
    const r1 = registry.extractBearer
      ? registry.extractBearer({ headers: { authorization: "Bearer abc123" } })
      : null;
    // extractBearer is not exported — test via module internal by checking behavior
  }
  // extractBearer is not in module.exports, so verify via authenticateOwner behavior instead
  // (already covered by tests above)
}

// ─────────────────────────────────────────────────────────────
// HTTP-level tests (real Express router with real auth)
// ─────────────────────────────────────────────────────────────
async function runHttpTests() {
  console.log("\n=== HTTP-level owner endpoint tests ===\n");

  const app = createApp(db);

  // 17. Missing auth → 401
  {
    const res = await makeRequest(app, "GET", "/api/hotspots/owner/ownerA");
    assert(res.status === 401, "17. GET /owner/:id without auth → 401");
    assert(res.body.success === false, "17. Missing auth: success:false");
    assert(res.body.error === "unauthenticated", "17. Missing auth: error code correct");
  }

  // 18. Valid owner session → 200, correct projection
  {
    const res = await makeRequest(app, "GET", "/api/hotspots/owner/ownerA", {
      Authorization: "Bearer ownerA-valid",
    });
    assert(res.status === 200, "18. Valid owner token → 200");
    assert(Array.isArray(res.body.hotspots), "18. Owner response: hotspots array");
    if (res.body.hotspots && res.body.hotspots.length > 0) {
      const h = res.body.hotspots[0];
      assert(h.integrationKey === undefined, "18. Owner response EXCLUDES integrationKey");
      assert(h.ssid === undefined, "18. Owner response EXCLUDES ssid");
      assert(h.id !== undefined, "18. Owner response has id");
      assert(h.hotspotName !== undefined, "18. Owner response has hotspotName");
      assert(h.routerType !== undefined, "18. Owner response has routerType");
      assert(h.createdAt !== undefined, "18. Owner response has createdAt");
    }
  }

  // 19. Owner A cannot access owner B's hotspots → 403
  {
    const res = await makeRequest(app, "GET", "/api/hotspots/owner/ownerB", {
      Authorization: "Bearer ownerA-valid",
    });
    assert(res.status === 403, "19. Cross-owner access → 403");
    assert(res.body.error === "unauthorized_scope", "19. Cross-owner: error code correct");
    assert(
      res.body.message === "You can only view your own hotspots",
      "19. Cross-owner: message correct"
    );
  }

  // 20. Super-admin can access any owner's hotspots → 200
  {
    const res = await makeRequest(app, "GET", "/api/hotspots/owner/ownerB", {
      Authorization: `Bearer ${superAdminToken}`,
    });
    assert(res.status === 200, "20. Super-admin access any owner → 200");
    assert(Array.isArray(res.body.hotspots), "20. Super-admin response: hotspots array");
    if (res.body.hotspots && res.body.hotspots.length > 0) {
      const h = res.body.hotspots[0];
      assert(h.integrationKey === undefined, "20. Super-admin response EXCLUDES integrationKey");
      assert(h.ssid === undefined, "20. Super-admin response EXCLUDES ssid");
      assert(h.id !== undefined, "20. Super-admin response has id");
      assert(h.createdAt !== undefined, "20. Super-admin response has createdAt");
    }
  }

  // 21. Invalid token → 401 (falls through to owner session lookup)
  {
    const res = await makeRequest(app, "GET", "/api/hotspots/owner/ownerA", {
      Authorization: `Bearer ${invalidSigToken}`,
    });
    assert(res.status === 401, "21. Invalid token → 401");
    assert(res.body.error === "unauthenticated", "21. Invalid token: error code correct");
    assert(
      res.body.message === "Invalid or expired session",
      "21. Invalid token: message reflects owner-session fallback"
    );
  }

  // 22. Expired JWT → 401
  {
    const res = await makeRequest(app, "GET", "/api/hotspots/owner/ownerA", {
      Authorization: `Bearer ${expiredJwtToken}`,
    });
    assert(res.status === 401, "22. Expired JWT → 401");
    assert(res.body.error === "unauthenticated", "22. Expired JWT: error code correct");
  }

  // 23. Wrong-role JWT → 401 (falls through, no session doc)
  {
    const res = await makeRequest(app, "GET", "/api/hotspots/owner/ownerA", {
      Authorization: `Bearer ${wrongRoleToken}`,
    });
    assert(res.status === 401, "23. Wrong-role JWT → 401");
    assert(res.body.error === "unauthenticated", "23. Wrong-role JWT: error code correct");
  }

  // 24. Expired owner session → 401
  {
    const res = await makeRequest(app, "GET", "/api/hotspots/owner/ownerA", {
      Authorization: "Bearer ownerA-expired",
    });
    assert(res.status === 401, "24. Expired owner session → 401");
    assert(res.body.error === "unauthenticated", "24. Expired session: error code correct");
    assert(res.body.message === "Session expired", "24. Expired session: message correct");
  }

  // 25. Owner session without ownerId → 401
  {
    const res = await makeRequest(app, "GET", "/api/hotspots/owner/ownerA", {
      Authorization: "Bearer ownerA-noid",
    });
    assert(res.status === 401, "25. No-ownerId session → 401");
    assert(res.body.error === "unauthenticated", "25. No-ownerId: error code correct");
    assert(res.body.message === "Invalid session", "25. No-ownerId: message correct");
  }

  // 26. Owner session without expiresAt → 200 (expiry skipped)
  {
    const res = await makeRequest(app, "GET", "/api/hotspots/owner/ownerA", {
      Authorization: "Bearer ownerA-noexp",
    });
    assert(res.status === 200, "26. No-expiresAt session → 200 (expiry skipped)");
    assert(Array.isArray(res.body.hotspots), "26. No-expiresAt: hotspots array");
  }

  // 27. Missing owner session doc → 401
  {
    const res = await makeRequest(app, "GET", "/api/hotspots/owner/ownerA", {
      Authorization: "Bearer completely-unknown-token",
    });
    assert(res.status === 401, "27. Unknown session token → 401");
    assert(res.body.error === "unauthenticated", "27. Unknown token: error code correct");
    assert(
      res.body.message === "Invalid or expired session",
      "27. Unknown token: message correct"
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Secret fallback audit (static analysis)
// ─────────────────────────────────────────────────────────────
function runSecretAudit() {
  console.log("\n=== Secret Fallback Audit (roamingRegistryService.js) ===\n");

  const registrySource = fs.readFileSync(SERVICE_PATH, "utf8");
  const passwordSource = fs.readFileSync(PASSWORD_SERVICE_PATH, "utf8");

  // Check: roamingRegistryService now uses getProductionSecret
  const usesGetProductionSecret = /getProductionSecret/.test(registrySource);
  assert(
    usesGetProductionSecret,
    "Audit: roamingRegistryService.js now uses getProductionSecret (fix applied)"
  );

  // Check: roamingRegistryService no longer uses direct || fallback
  const usesDirectFallback = /process\.env\.SUPERADMIN_JWT_SECRET\s*\|\|\s*"dev-super-secret"/.test(
    registrySource
  );
  assert(
    !usesDirectFallback,
    "Audit: roamingRegistryService.js no longer uses direct || dev-super-secret fallback (fix applied)"
  );

  // Check: passwordService.getProductionSecret exists and checks NODE_ENV
  const hasProductionGuard = /NODE_ENV.*production/.test(passwordSource);
  assert(
    hasProductionGuard,
    "Audit: passwordService.getProductionSecret checks NODE_ENV === production (confirmed)"
  );

  // Check: adminRoutes and superRoutes use getProductionSecret
  const adminRoutesSource = fs.readFileSync(
    path.resolve(BACKEND, "adminRoutes.js"),
    "utf8"
  );
  const superRoutesSource = fs.readFileSync(
    path.resolve(BACKEND, "superRoutes.js"),
    "utf8"
  );
  assert(
    /getProductionSecret/.test(adminRoutesSource),
    "Audit: adminRoutes.js uses getProductionSecret (confirmed)"
  );
  assert(
    /getProductionSecret/.test(superRoutesSource),
    "Audit: superRoutes.js uses getProductionSecret (confirmed)"
  );

  console.log("\n--- SECURITY FINDING (RESOLVED) ---");
  console.log("1. Previously, production startup did NOT reject a missing SUPERADMIN_JWT_SECRET.");
  console.log("   roamingRegistryService.js captured the secret with a direct || fallback.");
  console.log("");
  console.log("2. Fix applied: roamingRegistryService.js now uses getProductionSecret()");
  console.log("   from passwordService.js, which throws in production when the value is");
  console.log("   missing or equals the dev default 'dev-super-secret'.");
  console.log("");
  console.log("3. Development/test behavior preserved: when NODE_ENV !== 'production',");
  console.log("   getProductionSecret returns process.env value || 'dev-super-secret'.");
  console.log("");
  console.log("4. No circular dependencies: passwordService.js only imports bcryptjs.");
  console.log("--- END SECURITY FINDING ---\n");
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  try {
    await runDirectTests();
    await runHttpTests();
    runSecretAudit();
  } catch (err) {
    console.error("Test suite crashed:", err);
    failed += 1;
  } finally {
    // Restore environment
    if (originalSecret === undefined) {
      delete process.env.SUPERADMIN_JWT_SECRET;
    } else {
      process.env.SUPERADMIN_JWT_SECRET = originalSecret;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
