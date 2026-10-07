/**
 * Device authentication, owner isolation and Cisco credential-state checks.
 *
 * Run from the repository root:  node backend/scripts/check-devices-auth.js
 *
 * Fully offline and deterministic.
 *
 *   * Firestore is replaced by an in-memory double, so no real document is
 *     created, read or modified.
 *   * Authentication is replaced by a faithful test double of the EXISTING
 *     roamingRegistryService guards, so this checker verifies that devices.js
 *     actually CALLS the established guards with the right semantics, rather
 *     than re-implementing them.
 *   * The server is bound to 127.0.0.1 on an ephemeral port and is torn down.
 *   * No secret is written to any file.
 *
 * Scope: GET /api/devices/status/:id, GET /api/devices/owner/:ownerId, and the
 * PUT credential-state rules. This phase does NOT add RouterOS live control, an
 * adapter, a secret backend, or any RADIUS/Phase 7 change.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");

const ROOT = path.resolve(__dirname, "../..");
const ROUTES_DIR = path.resolve(ROOT, "backend/routes");

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
      `FAIL: ${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
// In-memory Firestore double
// ─────────────────────────────────────────────────────────────
const SERVER_TIMESTAMP = "__SERVER_TIMESTAMP__";

function createFakeDb(seed = {}) {
  // documents: Map<collectionName, Map<docId, data>>
  const documents = new Map();
  // subcollections: Map<"devices/dev-1/logs", Array<{id, data}>>
  const subcollections = new Map();

  for (const [name, entries] of Object.entries(seed)) {
    documents.set(name, new Map(Object.entries(entries)));
  }

  function docsOf(collectionName) {
    if (!documents.has(collectionName)) documents.set(collectionName, new Map());
    return documents.get(collectionName);
  }

  function entriesFor(collectionName) {
    const list = subcollections.get(collectionName);
    if (Array.isArray(list)) return list.map((item) => ({ ...item }));
    return Array.from(docsOf(collectionName).entries()).map(([id, data]) => ({
      id,
      data: () => ({ ...data }),
      _raw: data,
    }));
  }

  function matchesWhere(entry, field, op, value) {
    const data = entry._raw || entry.data();
    if (op === "==") return data[field] === value;
    throw new Error(`fake db: unsupported operator ${op}`);
  }

  function makeQuery(collectionName, filters) {
    const api = {
      where(field, op, value) {
        filters.push({ field, op, value });
        return api;
      },
      orderBy(field, direction = "asc") {
        api._order = { field, direction };
        return api;
      },
      limit() {
        return api;
      },
      async get() {
        let entries = entriesFor(collectionName).filter((entry) =>
          filters.every((f) => matchesWhere(entry, f.field, f.op, f.value)),
        );
        if (api._order) {
          const { field, direction } = api._order;
          entries = entries.slice().sort((a, b) => {
            const raw = (e) => (e._raw || e.data())[field];
            const av = raw(a);
            const bv = raw(b);
            const at = av ? Date.parse(av) : 0;
            const bt = bv ? Date.parse(bv) : 0;
            return direction === "desc" ? bt - at : at - bt;
          });
        }
        const docs = entries.map((entry) => ({
          id: entry.id,
          data: entry.data,
        }));
        return {
          docs,
          empty: docs.length === 0,
          size: docs.length,
          forEach: (fn) => docs.forEach(fn),
        };
      },
    };
    return api;
  }

  function makeDocRef(collectionName, docId) {
    return {
      async get() {
        const exists = docsOf(collectionName).has(docId);
        return {
          exists,
          id: docId,
          data: () => (exists ? { ...docsOf(collectionName).get(docId) } : undefined),
        };
      },
      async set(value) {
        docsOf(collectionName).set(docId, { ...value });
      },
      async update(patch) {
        if (!docsOf(collectionName).has(docId)) {
          const err = new Error("fake db: document does not exist");
          err.code = 5;
          throw err;
        }
        docsOf(collectionName).set(docId, {
          ...docsOf(collectionName).get(docId),
          ...patch,
        });
      },
      async delete() {
        docsOf(collectionName).delete(docId);
      },
      collection(subName) {
        const key = `${collectionName}/${docId}/${subName}`;
        const api = {
          async add(value) {
            if (!subcollections.has(key)) subcollections.set(key, []);
            const list = subcollections.get(key);
            const id = `log-${list.length + 1}`;
            list.push({ id, data: { ...value } });
            return { id };
          },
          orderBy() {
            return api;
          },
          limit() {
            return api;
          },
          async get() {
            const list = subcollections.get(key) || [];
            const docs = list.map((item) => ({ id: item.id, data: () => ({ ...item.data }) }));
            // Support the same orderBy/limit chain the real logs endpoint uses.
            const ordered = docs
              .slice()
              .sort((a, b) => {
                const av = a.data().createdAtISO || a.data().createdAt || "";
                const bv = b.data().createdAtISO || b.data().createdAt || "";
                const at = av ? Date.parse(av) : 0;
                const bt = bv ? Date.parse(bv) : 0;
                return bt - at;
              });
            return {
              docs: ordered,
              empty: docs.length === 0,
              size: docs.length,
              forEach: (fn) => ordered.forEach(fn),
            };
          },
        };
        return api;
      },
    };
  }

  return {
    _documents: documents,
    collection(name) {
      return {
        doc: (id) => makeDocRef(name, String(id)),
        async add(value) {
          const key = name;
          if (!subcollections.has(key)) subcollections.set(key, []);
          const list = subcollections.get(key);
          const id = `${name}-${list.length + 1}`;
          list.push({ id, data: { ...value } });
          return { id };
        },
        where: (field, op, value) => makeQuery(name, [{ field, op, value }]),
        orderBy: (field, direction) => makeQuery(name, []).orderBy(field, direction),
        limit: () => makeQuery(name, []),
        get: () => makeQuery(name, []).get(),
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Auth double: a faithful stand-in for roamingRegistryService
// ─────────────────────────────────────────────────────────────
class FakeRegistryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "RegistryError";
    this.status = status;
    this.code = code;
  }
}

const AUTH_SUBJECTS = {
  "owner-token-own-1": { kind: "owner", ownerId: "own-1" },
  "owner-token-own-2": { kind: "owner", ownerId: "own-2" },
  "super-token": { kind: "superadmin", email: "owner@yaba" },
};

const authCalls = [];

const registryDouble = {
  RegistryError: FakeRegistryError,
  async authenticateOwner(req) {
    authCalls.push("authenticateOwner");
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/, "");
    const subject = AUTH_SUBJECTS[token];
    if (!subject || subject.kind !== "owner") {
      throw new FakeRegistryError(401, "unauthenticated", "Authentication token required");
    }
    return { ownerId: subject.ownerId, actor: `owner:${subject.ownerId}` };
  },
  async authenticateOwnerOrSuper(req) {
    authCalls.push("authenticateOwnerOrSuper");
    const raw = String(req.headers.authorization || "");
    if (!raw.startsWith("Bearer ")) {
      throw new FakeRegistryError(401, "unauthenticated", "Authentication token required");
    }
    const token = raw.slice(7);
    const subject = AUTH_SUBJECTS[token];
    if (!subject) {
      throw new FakeRegistryError(401, "unauthenticated", "Invalid or expired session");
    }
    if (subject.kind === "superadmin") {
      return { kind: "superadmin", email: subject.email, actor: "superadmin" };
    }
    return { ownerId: subject.ownerId, actor: `owner:${subject.ownerId}` };
  },
  requireOwnerSelf(auth, requestedOwnerId) {
    authCalls.push("requireOwnerSelf");
    if (!requestedOwnerId) {
      throw new FakeRegistryError(400, "validation_error", "ownerId is required");
    }
    if (auth.ownerId !== requestedOwnerId) {
      throw new FakeRegistryError(
        403,
        "unauthorized_scope",
        "Owner can only act on their own roaming records",
      );
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Load devices.js against the doubles
// ─────────────────────────────────────────────────────────────
function stubModule(requestPath, exports) {
  const resolved = require.resolve(requestPath, { paths: [ROUTES_DIR] });
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
  return resolved;
}

const SECRET_SSH_PASSWORD = "ssh-secret-value-8-5a";
const SECRET_ENABLE_PASSWORD = "enable-secret-value-8-5a";
const SECRET_DEVICE_TOKEN = "provision-token-value-8-5a";
const SECRET_ROUTEROS_REF = "projects/test/secrets/routeros-ref-8-5a";
const SECRET_ROUTEROS_USERNAME = "routeros-admin-8-5a";

const SEED_DEVICES = {
  "dev-own-1-cisco": {
    deviceId: "dev-own-1-cisco",
    ownerId: "own-1",
    deviceName: "Owner1 Branch Router",
    deviceType: "cisco",
    status: "online",
    ip: "10.1.1.1",
    sshPort: 22,
    sshUser: "cisco-admin",
    sshPassword: SECRET_SSH_PASSWORD,
    enablePassword: SECRET_ENABLE_PASSWORD,
    token: SECRET_DEVICE_TOKEN,
    routerOsApiSecretRef: SECRET_ROUTEROS_REF,
    routerOsApiUsername: SECRET_ROUTEROS_USERNAME,
    createdAtISO: "2026-01-01T00:00:00.000Z",
  },
  "dev-own-1-hs": {
    deviceId: "dev-own-1-hs",
    ownerId: "own-1",
    deviceName: "Owner1 Hotspot",
    deviceType: "mikrotik",
    status: "online",
    antiSharing: true,
    createdAtISO: "2026-02-01T00:00:00.000Z",
  },
  "dev-own-2-hs": {
    deviceId: "dev-own-2-hs",
    ownerId: "own-2",
    deviceName: "Owner2 Hotspot",
    deviceType: "mikrotik",
    status: "online",
    createdAtISO: "2026-03-01T00:00:00.000Z",
  },
};

let fakeDb;

function loadRouter() {
  fakeDb = createFakeDb({ devices: SEED_DEVICES });

  stubModule("../firebase", {
    admin: {
      firestore: {
        FieldValue: { serverTimestamp: () => SERVER_TIMESTAMP },
      },
    },
    db: fakeDb,
  });
  stubModule("../services/roamingRegistryService", registryDouble);
  stubModule("../services/ciscoService", {
    checkCiscoConnection: async () => ({
      success: true,
      model: "fake",
      version: "fake",
      message: "ok",
    }),
  });

  const resolved = require.resolve("../routes/devices", { paths: [ROUTES_DIR] });
  delete require.cache[resolved];
  return require(resolved);
}

let server;
let baseUrl;

async function startServer() {
  const router = loadRouter();
  const app = express();
  app.use(express.json());
  app.use(router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

async function api(pathname, options = {}) {
  const headers = {};
  if (options.token !== undefined && options.token !== null) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let data = null;
  let rawText = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
  } else {
    // Non-JSON responses (e.g. the provisioning script, which is text/plain)
    // are captured as raw text so credential assertions can still inspect them.
    try {
      rawText = await res.text();
    } catch (_2) {
      rawText = null;
    }
    data = null;
  }
  return {
    status: res.status,
    data,
    serialized: rawText !== null ? rawText : JSON.stringify(data || {}),
  };
}

function readStoredDevice(deviceId) {
  const stored = fakeDb._documents.get("devices");
  return stored && stored.has(deviceId) ? { ...stored.get(deviceId) } : null;
}

// Every field name that must never appear anywhere in a device response.
const FORBIDDEN_RESPONSE_FIELDS = [
  "sshPassword",
  "enablePassword",
  "token",
  "routerOsApiSecretRef",
  "routerOsApiUsername",
];

// Every secret VALUE seeded into the fixture.
const SECRET_VALUES = [
  SECRET_SSH_PASSWORD,
  SECRET_ENABLE_PASSWORD,
  SECRET_DEVICE_TOKEN,
  SECRET_ROUTEROS_REF,
  SECRET_ROUTEROS_USERNAME,
];

function assertNoCredentialExposure(result, label) {
  for (const field of FORBIDDEN_RESPONSE_FIELDS) {
    assert(
      !result.serialized.includes(`"${field}"`),
      `${label}: response contains no "${field}" field`,
    );
  }
  for (const secret of SECRET_VALUES) {
    assert(
      !result.serialized.includes(secret),
      `${label}: response contains no credential value (${secret.slice(0, 6)}...)`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 1) GET /api/devices/status/:id — endpoint authentication
// ─────────────────────────────────────────────────────────────
async function runStatusEndpointAuth() {
  const anon = await api("/api/devices/status/dev-own-1-cisco");
  assertEqual(anon.status, 401, "status: unauthenticated request returns 401");
  assertEqual(
    anon.data && anon.data.error,
    "unauthenticated",
    "status: 401 uses the existing 'unauthenticated' error code",
  );
  assertNoCredentialExposure(anon, "status unauthenticated");

  const badToken = await api("/api/devices/status/dev-own-1-cisco", {
    token: "not-a-real-token",
  });
  assertEqual(badToken.status, 401, "status: an invalid token returns 401");

  const crossOwner = await api("/api/devices/status/dev-own-2-hs", {
    token: "owner-token-own-1",
  });
  assertEqual(crossOwner.status, 403, "status: an owner cannot read another owner's device");
  assertEqual(
    crossOwner.data && crossOwner.data.error,
    "unauthorized_scope",
    "status: cross-owner denial uses 'unauthorized_scope'",
  );
  assertNoCredentialExposure(crossOwner, "status cross-owner");

  const owner = await api("/api/devices/status/dev-own-1-cisco", {
    token: "owner-token-own-1",
  });
  assertEqual(owner.status, 200, "status: the owning owner receives 200");
  assertEqual(owner.data.success, true, "status: owner response keeps success: true");
  assertEqual(owner.data.status, "online", "status: owner response keeps the status field");
  assert(
    owner.data.device && owner.data.device.deviceId === "dev-own-1-cisco",
    "status: owner response includes the device",
  );
  assertNoCredentialExposure(owner, "status owner");

  const superadmin = await api("/api/devices/status/dev-own-2-hs", {
    token: "super-token",
  });
  assertEqual(superadmin.status, 200, "status: superadmin retains access to any device");
  assertNoCredentialExposure(superadmin, "status superadmin");

  const missing = await api("/api/devices/status/does-not-exist", {
    token: "owner-token-own-1",
  });
  assertEqual(missing.status, 404, "status: a missing device returns 404 for an authorized caller");
  assertNoCredentialExposure(missing, "status missing");

  assert(
    authCalls.includes("authenticateOwnerOrSuper"),
    "status: the endpoint calls the existing authenticateOwnerOrSuper guard",
  );
}

// ─────────────────────────────────────────────────────────────
// 2) GET /api/devices/owner/:ownerId — endpoint authentication
// ─────────────────────────────────────────────────────────────
async function runOwnerEndpointAuth() {
  const anon = await api("/api/devices/owner/own-1");
  assertEqual(anon.status, 401, "owner: unauthenticated request returns 401");
  assertEqual(
    anon.data && anon.data.error,
    "unauthenticated",
    "owner: 401 uses the existing 'unauthenticated' error code",
  );

  const badToken = await api("/api/devices/owner/own-1", { token: "nope" });
  assertEqual(badToken.status, 401, "owner: an invalid token returns 401");

  const crossOwner = await api("/api/devices/owner/own-2", {
    token: "owner-token-own-1",
  });
  assertEqual(crossOwner.status, 403, "owner: Owner A cannot retrieve Owner B's inventory");
  assertEqual(
    crossOwner.data && crossOwner.data.error,
    "unauthorized_scope",
    "owner: cross-owner denial uses 'unauthorized_scope'",
  );
  assertNoCredentialExposure(crossOwner, "owner cross-owner");

  const owner = await api("/api/devices/owner/own-1", { token: "owner-token-own-1" });
  assertEqual(owner.status, 200, "owner: an owner receives their own inventory");
  assertEqual(owner.data.success, true, "owner: own-inventory response keeps success: true");
  assertEqual(
    owner.data.devices.map((d) => d.ownerId).sort(),
    ["own-1", "own-1"],
    "owner: own-inventory contains only this owner's devices",
  );
  assert(
    owner.data.devices.every((d) => d.id !== undefined),
    "owner: each device carries its document id",
  );
  assertNoCredentialExposure(owner, "owner own-inventory");

  const superadmin = await api("/api/devices/owner/own-2", { token: "super-token" });
  assertEqual(superadmin.status, 200, "owner: superadmin retains access to any owner's inventory");
  assertEqual(
    superadmin.data.devices.map((d) => d.deviceId),
    ["dev-own-2-hs"],
    "owner: superadmin sees the requested owner's devices",
  );
  assertNoCredentialExposure(superadmin, "owner superadmin");

  assert(
    authCalls.includes("requireOwnerSelf"),
    "owner: the endpoint calls the existing requireOwnerSelf guard",
  );
}

// ─────────────────────────────────────────────────────────────
// 3) Credential redaction, including nested/serialized payloads
// ─────────────────────────────────────────────────────────────
async function runCredentialRedaction() {
  const status = await api("/api/devices/status/dev-own-1-cisco", {
    token: "owner-token-own-1",
  });
  const device = status.data.device || {};

  assertEqual(device.hasPassword, true, "redaction: hasPassword reports a stored SSH password");
  assertEqual(
    device.hasEnablePassword,
    true,
    "redaction: hasEnablePassword reports a stored enable password",
  );

  const hs = await api("/api/devices/status/dev-own-1-hs", { token: "owner-token-own-1" });
  assertEqual(
    hs.data.device.hasPassword,
    false,
    "redaction: hasPassword is false when no password is stored",
  );
  assertEqual(
    hs.data.device.hasEnablePassword,
    false,
    "redaction: hasEnablePassword is false when none is stored",
  );
  assertEqual(
    typeof hs.data.device.hasPassword,
    "boolean",
    "redaction: hasPassword is a boolean, never the credential",
  );

  // The full serialized response, including any nested objects.
  assertNoCredentialExposure(status, "redaction status");
  const deep = JSON.stringify(status.data);
  assert(!deep.includes(SECRET_SSH_PASSWORD), "redaction: no nested sshPassword value");
  assert(!deep.includes(SECRET_ENABLE_PASSWORD), "redaction: no nested enablePassword value");
  assert(!deep.includes(SECRET_DEVICE_TOKEN), "redaction: no nested token value");
  assert(
    !deep.includes(SECRET_ROUTEROS_REF),
    "redaction: no nested routerOsApiSecretRef value",
  );

  // Sanity: the seeded secrets really are present in the stored document, so the
  // checks above are not passing because the fixture is empty.
  const stored = readStoredDevice("dev-own-1-cisco");
  assertEqual(
    stored.sshPassword,
    SECRET_SSH_PASSWORD,
    "redaction: the fixture still stores the secret server-side",
  );
}

// ─────────────────────────────────────────────────────────────
// 4) Cisco credential-state rules
// ─────────────────────────────────────────────────────────────
async function runCiscoCredentialState() {
  const OWNER_1_TOKEN = "owner-token-own-1";
  const OWNER_2_TOKEN = "owner-token-own-2";

  // (a) stored password + blank edit -> stored credential preserved
  const preserved = await api("/api/devices/dev-own-1-cisco", {
    method: "PUT",
    body: { deviceName: "Renamed Branch Router", sshPassword: "", enablePassword: "" },
    token: OWNER_1_TOKEN,
  });
  assertEqual(preserved.status, 200, "cisco: blank password on a device that has one is accepted");
  const afterPreserve = readStoredDevice("dev-own-1-cisco");
  assertEqual(
    afterPreserve.sshPassword,
    SECRET_SSH_PASSWORD,
    "cisco: a blank edit preserves the stored SSH password",
  );
  assertEqual(
    afterPreserve.enablePassword,
    SECRET_ENABLE_PASSWORD,
    "cisco: a blank edit preserves the stored enable password",
  );
  assertEqual(
    afterPreserve.deviceName,
    "Renamed Branch Router",
    "cisco: non-credential fields are still updated",
  );
  assert(
    !JSON.stringify(preserved.data).includes(SECRET_SSH_PASSWORD),
    "cisco: the update response never returns the password",
  );

  // (b) stored password + new password -> credential updated
  const NEW_SSH = "brand-new-ssh-password-8-5a";
  const updated = await api("/api/devices/dev-own-1-cisco", {
    method: "PUT",
    body: { sshPassword: NEW_SSH },
    token: OWNER_1_TOKEN,
  });
  assertEqual(updated.status, 200, "cisco: a new password is accepted");
  assertEqual(
    readStoredDevice("dev-own-1-cisco").sshPassword,
    NEW_SSH,
    "cisco: a new password replaces the stored one",
  );
  assert(
    !JSON.stringify(updated.data).includes(NEW_SSH),
    "cisco: the update response never echoes the new password",
  );

  // hasPassword must reflect the change, so the form asks for a password again.
  const afterUpdate = await api("/api/devices/status/dev-own-1-cisco", {
    token: "owner-token-own-1",
  });
  assertEqual(
    afterUpdate.data.device.hasPassword,
    true,
    "cisco: hasPassword stays true after a password update",
  );

  // (c) no stored password + blank -> validation error
  const noPassword = { ...SEED_DEVICES["dev-own-2-hs"], deviceType: "cisco", ownerId: "own-2" };
  fakeDb._documents.get("devices").set("dev-own-2-cisco", noPassword);

  const rejected = await api("/api/devices/dev-own-2-cisco", {
    method: "PUT",
    body: { sshPassword: "", deviceName: "No Password Router" },
    token: OWNER_2_TOKEN,
  });
  assertEqual(
    rejected.status,
    400,
    "cisco: a blank password with nothing stored is rejected",
  );
  assertEqual(
    rejected.data && rejected.data.error,
    "validation_error",
    "cisco: the rejection uses the existing 'validation_error' code",
  );
  assertEqual(
    readStoredDevice("dev-own-2-cisco").sshPassword,
    undefined,
    "cisco: a rejected update stores no empty credential",
  );

  // (d) a partial update that omits the credential field entirely is allowed
  const partial = await api("/api/devices/dev-own-2-cisco", {
    method: "PUT",
    body: { deviceName: "Renamed Without Password" },
    token: OWNER_2_TOKEN,
  });
  assertEqual(
    partial.status,
    200,
    "cisco: omitting the password field is a normal partial update, not a credential request",
  );
  assertEqual(
    readStoredDevice("dev-own-2-cisco").deviceName,
    "Renamed Without Password",
    "cisco: the partial update applied",
  );

  // (e) non-Cisco devices are never forced to carry a password.
  // A real field is always submitted alongside, because a PUT whose only content
  // is a blank credential is a genuine no-op and is rejected as such.
  const mikrotikBlank = await api("/api/devices/dev-own-1-hs", {
    method: "PUT",
    body: { sshPassword: "", deviceName: "Owner1 Hotspot Renamed" },
    token: OWNER_1_TOKEN,
  });
  assertEqual(
    mikrotikBlank.status,
    200,
    "non-cisco: a blank password is simply ignored, never required",
  );
  assertEqual(
    readStoredDevice("dev-own-1-hs").sshPassword,
    undefined,
    "non-cisco: no credential is written by a blank field",
  );
  assertEqual(
    readStoredDevice("dev-own-1-hs").deviceName,
    "Owner1 Hotspot Renamed",
    "non-cisco: the accompanying field update is applied",
  );

  // (f) enablePassword stays optional even for Cisco
  const optionalEnable = await api("/api/devices/dev-own-2-cisco", {
    method: "PUT",
    body: { sshPassword: "ssh-now-set", enablePassword: "" },
    token: OWNER_2_TOKEN,
  });
  assertEqual(
    optionalEnable.status,
    200,
    "cisco: a blank enable password remains optional",
  );
  assertEqual(
    readStoredDevice("dev-own-2-cisco").enablePassword,
    undefined,
    "cisco: no empty enable credential is stored",
  );

  // (g) the edit wizard can complete a save using only credential STATE
  const wizardSave = await api("/api/devices/dev-own-2-cisco", {
    method: "PUT",
    body: { deviceName: "Saved Without Seeing Password", interfaces: ["ether2"] },
    token: OWNER_2_TOKEN,
  });
  assertEqual(
    wizardSave.status,
    200,
    "cisco: an owner can save a stored-password device without ever receiving the password",
  );
}

// ─────────────────────────────────────────────────────────────
// 5) Owner isolation across the affected paths
// ─────────────────────────────────────────────────────────────
async function runOwnerIsolation() {
  const readOthersStatus = await api("/api/devices/status/dev-own-2-hs", {
    token: "owner-token-own-1",
  });
  assertEqual(readOthersStatus.status, 403, "isolation: Owner A cannot read Owner B's device status");

  const readOthersInventory = await api("/api/devices/owner/own-2", {
    token: "owner-token-own-1",
  });
  assertEqual(
    readOthersInventory.status,
    403,
    "isolation: Owner A cannot retrieve Owner B's device inventory",
  );

  const ownInventory = await api("/api/devices/owner/own-1", { token: "owner-token-own-1" });
  const leaked = (ownInventory.data.devices || []).filter((d) => d.ownerId !== "own-1");
  assertEqual(leaked.length, 0, "isolation: own inventory leaks no other owner's device");

  const crossTokens = [
    ["owner-token-own-1", "own-2"],
    ["owner-token-own-2", "own-1"],
  ];
  for (const [token, targetOwner] of crossTokens) {
    const res = await api(`/api/devices/owner/${targetOwner}`, { token });
    assertEqual(res.status, 403, `isolation: ${token} is denied ${targetOwner}'s inventory`);
  }
}

// ─────────────────────────────────────────────────────────────
// 5b) Endpoints secured in the finalization pass
// ─────────────────────────────────────────────────────────────
// These three endpoints were still unauthenticated at the time of the Phase
// 8.5A finalization review and were closed afterwards. They are covered here so
// a later regression cannot silently reopen them.
async function runFinalizationEndpoints() {
  // GET /api/devices/:id/ping
  const pingAnon = await api("/api/devices/dev-own-1-cisco/ping");
  assertEqual(pingAnon.status, 401, "ping: unauthenticated returns 401");
  assertNoCredentialExposure(pingAnon, "ping unauthenticated");

  const pingCross = await api("/api/devices/dev-own-2-hs/ping", {
    token: "owner-token-own-1",
  });
  assertEqual(pingCross.status, 403, "ping: Owner A cannot ping Owner B's device");
  assertNoCredentialExposure(pingCross, "ping cross-owner");

  const pingOwner = await api("/api/devices/dev-own-1-cisco/ping", {
    token: "owner-token-own-1",
  });
  assertEqual(pingOwner.status, 200, "ping: the owning owner receives 200");
  assertEqual(pingOwner.data.success, true, "ping: owner response keeps success: true");
  assertNoCredentialExposure(pingOwner, "ping owner");

  // GET /api/devices/:id/logs
  const logsAnon = await api("/api/devices/dev-own-1-cisco/logs?limit=5");
  assertEqual(logsAnon.status, 401, "logs: unauthenticated returns 401");
  assertNoCredentialExposure(logsAnon, "logs unauthenticated");

  const logsCross = await api("/api/devices/dev-own-2-hs/logs?limit=5", {
    token: "owner-token-own-1",
  });
  assertEqual(logsCross.status, 403, "logs: Owner A cannot read Owner B's device logs");
  assertNoCredentialExposure(logsCross, "logs cross-owner");

  const logsOwner = await api("/api/devices/dev-own-1-cisco/logs?limit=5", {
    token: "owner-token-own-1",
  });
  assertEqual(logsOwner.status, 200, "logs: the owning owner receives 200");
  assertEqual(logsOwner.data.success, true, "logs: owner response keeps success: true");
  assert(Array.isArray(logsOwner.data.logs), "logs: owner response carries a logs array");
  assertNoCredentialExposure(logsOwner, "logs owner");

  // GET /api/provisioning/script — the token-bearing endpoint
  const scriptAnon = await api("/api/provisioning/script?deviceId=dev-own-1-cisco");
  assertEqual(scriptAnon.status, 401, "script: unauthenticated returns 401");
  assert(
    !scriptAnon.serialized.includes(SECRET_DEVICE_TOKEN),
    "script: an unauthenticated response never contains the provisioning token",
  );

  const scriptCross = await api("/api/provisioning/script?deviceId=dev-own-2-hs", {
    token: "owner-token-own-1",
  });
  assertEqual(scriptCross.status, 403, "script: Owner A cannot retrieve Owner B's provisioning script");
  assert(
    !scriptCross.serialized.includes(SECRET_DEVICE_TOKEN),
    "script: a cross-owner response never contains the provisioning token",
  );

  const scriptOwner = await api("/api/provisioning/script?deviceId=dev-own-1-cisco", {
    token: "owner-token-own-1",
  });
  assertEqual(scriptOwner.status, 200, "script: the owning owner receives the provisioning script");
  assert(
    scriptOwner.serialized.includes(SECRET_DEVICE_TOKEN),
    "script: the owning owner's response DOES carry the provisioning token (authorized only)",
  );
  assert(
    !scriptOwner.serialized.includes(SECRET_SSH_PASSWORD),
    "script: the provisioning script never leaks the SSH password",
  );

  const scriptSuper = await api("/api/provisioning/script?deviceId=dev-own-2-hs", {
    token: "super-token",
  });
  assertEqual(scriptSuper.status, 200, "script: superadmin retains access to the provisioning script");
}

// ─────────────────────────────────────────────────────────────
// 6) Frontend: sends existing credentials, never reads the password back
// ─────────────────────────────────────────────────────────────
function runFrontendChecks() {
  const dashboardPath = path.resolve(ROOT, "frontend/src/AdminDashboard.jsx");
  const dashboard = fs.readFileSync(dashboardPath, "utf8");

  assert(
    dashboard.includes('const deviceAuthHeaders = () => {'),
    "frontend: an auth-headers helper exists",
  );
  assert(
    dashboard.includes('localStorage.getItem("ownerToken")'),
    "frontend: the helper reads the existing owner session token",
  );
  assert(
    dashboard.includes("Bearer ${token}"),
    "frontend: the token is sent as a Bearer Authorization header",
  );
  assert(
    !/deviceAuthHeaders[\s\S]{0,200}useState/.test(dashboard),
    "frontend: no credential is stored in React state",
  );
  assert(
    !/ownerToken\s*=\s*localStorage\.getItem\("ownerToken"\)[\s\S]{0,40}useState/.test(dashboard),
    "frontend: the owner token is never copied into component state",
  );
  assert(
    !/token=.*ownerToken|ownerToken=.*query/i.test(dashboard),
    "frontend: no credential is placed in a query parameter",
  );

  const headerUsages = (dashboard.match(/headers:\s*deviceAuthHeaders\(\)/g) || []).length;
  assertEqual(
    headerUsages,
    10,
    "frontend: all device-related calls now send the Authorization header",
  );

  assert(
    dashboard.includes("api/devices/owner/${ownerId}") &&
      /api\/devices\/owner\/\$\{ownerId\}[\s\S]{0,120}headers: deviceAuthHeaders\(\)/.test(dashboard),
    "frontend: fetchDevicesForOwner sends the Authorization header",
  );
  assert(
    /api\/devices\/owner\/\$\{ownerId\}`,\s*\{\s*timeout: 20000,\s*headers: deviceAuthHeaders\(\)/.test(
      dashboard,
    ),
    "frontend: the devices-section owner fetch sends the Authorization header",
  );
  assert(
    /axios\.get\(endpoint,\s*\{[\s\S]{0,80}headers: deviceAuthHeaders\(\)/.test(dashboard),
    "frontend: the device status polling request sends the Authorization header",
  );

  // The wizard must never read a credential back from the API.
  assert(
    !/sshPassword:\s*device\.sshPassword/.test(dashboard),
    "frontend: the edit form does not prefill sshPassword from the API",
  );
  assert(
    !/sshPassword:\s*existingDevice\.sshPassword/.test(dashboard),
    "frontend: the duplicate-Cisco path does not prefill sshPassword",
  );
  assert(
    !/existingDevice\.enablePassword/.test(dashboard),
    "frontend: the duplicate-Cisco path does not prefill enablePassword",
  );
  assert(
    !/sshPassword:\s*device\.enablePassword/.test(dashboard),
    "frontend: the edit form does not prefill enablePassword from the API",
  );

  assert(
    dashboard.includes("setDeviceHasStoredPassword(device.hasPassword === true)"),
    "frontend: credential STATE is read from the hasPassword indicator",
  );
  assert(
    dashboard.includes("!normalized.sshPassword && !deviceHasStoredPassword"),
    "frontend: a password is required only when none is stored",
  );
  assert(
    dashboard.includes("setDeviceHasStoredPassword(false)"),
    "frontend: the credential-state indicator is reset when the wizard closes",
  );
}

// ─────────────────────────────────────────────────────────────
// 7) Structural safety: nothing from Phase 8.5A scope was widened
// ─────────────────────────────────────────────────────────────
function runStructuralSafety() {
  const devicesSource = fs.readFileSync(
    path.resolve(ROOT, "backend/routes/devices.js"),
    "utf8",
  );
  const code = devicesSource
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");

  assert(
    !/registerAAAAdapter|mikrotikRoamingAAAAdapter/.test(code),
    "safety: no MikroTik adapter is registered",
  );
  assert(
    !/ROAMING_MIKROTIK_API_ENABLED\s*=\s*true/.test(code),
    "safety: ROAMING_MIKROTIK_API_ENABLED is not enabled",
  );
  assert(
    !/group=full|address=0\.0\.0\.0\/0/.test(code),
    "safety: the RouterOS provisioning defect stays remediated",
  );

  const registrySource = fs.readFileSync(
    path.resolve(ROOT, "backend/services/roamingRegistryService.js"),
    "utf8",
  );
  // NOTE: this file legitimately contains the string "mikrotik" in its own local
  // AAA_ADAPTER_KEYS list, which predates this work. What must NOT appear is any
  // coupling from the shared auth service into router-control code.
  assert(
    !/require\(.*services\/mikrotik|registerAAAAdapter|buildAddHotspotUserCommand/.test(
      registrySource,
    ),
    "safety: the shared auth service does not couple to router-control code",
  );

  for (const rel of [
    "backend/services/roamingEnforcementService.js",
    "backend/services/roamingAAAAdapter.js",
    "backend/services/roamingRauConsumptionService.js",
    "backend/services/roamingSettlementReconciliationService.js",
    "backend/routes/users.js",
    "backend/services/ciscoService.js",
    "backend/package-lock.json",
  ]) {
    assert(fs.existsSync(path.join(ROOT, rel)), `safety: ${rel} still exists`);
  }

  const enforcement = fs.readFileSync(
    path.resolve(ROOT, "backend/services/roamingEnforcementService.js"),
    "utf8",
  );
  assert(!/mikrotik/i.test(enforcement), "safety: roamingEnforcementService.js has no MikroTik reference");

  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "backend/package.json"), "utf8"),
  );
  const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  // `axios` and `express` are PRE-EXISTING backend dependencies and are used by
// the server; this checker adds nothing. Only genuinely new packages are forbidden.
  for (const forbidden of ["node-routeros", "routeros", "mikrotik", "supertest", "jest", "vitest", "dgram"]) {
    assert(!(forbidden in deps), `safety: no '${forbidden}' dependency was added`);
  }
  assert("express" in deps, "safety: express remains a normal dependency (no new framework)");
}

async function main() {
  console.log("=== Device Auth, Owner Isolation and Credential-State Checks ===\n");

  await startServer();
  try {
    await runStatusEndpointAuth();
    await runOwnerEndpointAuth();
    await runCredentialRedaction();
    await runCiscoCredentialState();
    await runOwnerIsolation();
    await runFinalizationEndpoints();
  } finally {
    await stopServer();
  }

  runFrontendChecks();
  runStructuralSafety();

  console.log("\n----------------------------------------");
  console.log(`Device auth checks: ${passed} passed, ${failed} failed`);
  console.log("----------------------------------------");

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Device auth checker crashed:", err);
  process.exitCode = 1;
  process.exitCode = 1;
});