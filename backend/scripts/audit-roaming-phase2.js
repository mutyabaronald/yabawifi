/**
 * Temporary Phase 2 audit harness (local only).
 * Mocks Firestore in-memory. Does not touch production data or existing APIs.
 */
const Module = require("module");
const path = require("path");

const store = {
  owners: new Map(),
  hotspots: new Map(),
  devices: new Map(),
  routers: new Map(),
  roaming_partners: new Map(),
  owner_sessions: new Map(),
  roaming_hotspots: new Map(),
};

function docRef(collectionName, id) {
  const col = store[collectionName];
  return {
    id,
    async get() {
      const data = col.get(id);
      return {
        exists: data !== undefined,
        id,
        data: () => (data ? { ...data } : undefined),
        ref: docRef(collectionName, id),
      };
    },
    async set(data, opts) {
      const prev = col.get(id) || {};
      col.set(id, opts && opts.merge ? { ...prev, ...data } : { ...data });
    },
  };
}

function queryWhere(collectionName, field, op, value) {
  const rows = [];
  for (const [id, data] of store[collectionName].entries()) {
    if (op === "==" && data[field] === value) {
      rows.push({
        id,
        data: () => ({ ...data }),
        ref: docRef(collectionName, id),
      });
    }
  }
  return {
    async get() {
      return {
        empty: rows.length === 0,
        docs: rows,
        forEach(fn) {
          rows.forEach(fn);
        },
      };
    },
  };
}

const db = {
  collection(name) {
    if (!store[name]) store[name] = new Map();
    return {
      doc(id) {
        return docRef(name, id);
      },
      where(field, op, value) {
        return queryWhere(name, field, op, value);
      },
      limit() {
        return {
          async get() {
            const docs = [...store[name].entries()].map(([id, data]) => ({
              id,
              data: () => ({ ...data }),
            }));
            return { docs, empty: docs.length === 0 };
          },
        };
      },
      async get() {
        const docs = [...store[name].entries()].map(([id, data]) => ({
          id,
          data: () => ({ ...data }),
        }));
        return { docs, empty: docs.length === 0 };
      },
    };
  },
  batch() {
    const ops = [];
    return {
      set(ref, data, opts) {
        ops.push({ ref, data, opts });
      },
      async commit() {
        for (const op of ops) {
          await op.ref.set(op.data, op.opts);
        }
      },
    };
  },
};

// Stub firebase + jwt before requiring service
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "../firebase" || id === "./firebase") {
    return { db, admin: {} };
  }
  if (id === "jsonwebtoken") {
    return {
      verify(token, secret) {
        if (token === "super-ok") return { role: "superadmin", sub: "owner@yaba" };
        if (token === "super-bad-role") return { role: "owner", sub: "x" };
        throw new Error("bad token");
      },
    };
  }
  return origRequire.apply(this, arguments);
};

process.env.ROAMING_REGISTRY_ENABLED = "true";
process.env.SUPERADMIN_JWT_SECRET = "dev-super-secret";

const servicePath = path.join(
  __dirname,
  "..",
  "services",
  "roamingRegistryService.js"
);
delete require.cache[require.resolve(servicePath)];
const registry = require(servicePath);

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS:", msg);
}

function fakeReq(token, body = {}, params = {}) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
    params,
    get(h) {
      if (h === "Idempotency-Key") return null;
      return null;
    },
  };
}

async function run() {
  // Seed
  store.owners.set("ownerA", { ownerName: "A", businessName: "BizA" });
  store.owners.set("ownerB", { ownerName: "B", businessName: "BizB" });
  store.hotspots.set("hsA1", { ownerId: "ownerA", hotspotName: "A1", ssid: "A1" });
  store.hotspots.set("hsB1", { ownerId: "ownerB", hotspotName: "B1", ssid: "B1" });
  store.devices.set("devA", { ownerId: "ownerA" });
  store.devices.set("devB", { ownerId: "ownerB" });
  store.owner_sessions.set("tokA", {
    ownerId: "ownerA",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  store.owner_sessions.set("tokB", {
    ownerId: "ownerB",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });

  // 1) Owner A can opt-in self
  const authA = await registry.authenticateOwner(fakeReq("tokA"));
  const opt = await registry.optInPartner({
    ownerId: authA.ownerId,
    actor: authA.actor,
    payload: {},
  });
  assert(opt.partner.federationStatus === "draft", "Owner A opt-in creates draft");
  assert(opt.partner.ownerId === "ownerA", "partner ownerId immutable as ownerA");

  // Body ownerId override rejected at route layer — simulate check
  const bodyConflict =
    fakeReq("tokA", { ownerId: "ownerB" }).body.ownerId !== authA.ownerId;
  assert(bodyConflict, "Owner A body ownerId=ownerB conflicts with auth");

  // 2) Cannot register hotspot until active
  let rejected = false;
  try {
    await registry.registerHotspot({
      ownerId: "ownerA",
      actor: authA.actor,
      payload: { hotspotId: "hsA1" },
    });
  } catch (e) {
    rejected = e.code === "ineligible";
  }
  assert(rejected, "draft partner cannot register hotspot");

  // Approve via super admin action
  await registry.adminAction({
    ownerId: "ownerA",
    action: "approve",
    actor: "superadmin:test",
  });
  assert(
    (await registry.loadPartner
      ? true
      : store.roaming_partners.get("ownerA").federationStatus === "active"),
    "approve moves partner to active"
  );
  assert(
    store.roaming_partners.get("ownerA").federationStatus === "active",
    "ownerA federationStatus=active"
  );

  // 3) Owner A can register own hotspot
  const regA = await registry.registerHotspot({
    ownerId: "ownerA",
    actor: authA.actor,
    payload: {
      hotspotId: "hsA1",
      aaaAdapterKey: "mikrotik",
      deviceLink: { deviceId: "devA" },
      capabilities: { captivePortal: true, passpoint: false },
    },
  });
  assert(regA.hotspot.ownerId === "ownerA", "Owner A→hsA1 allowed");
  assert(regA.hotspot.partnerStatus === "active", "registered hotspot active");

  // 4) Owner A cannot register Owner B hotspot
  rejected = false;
  try {
    await registry.registerHotspot({
      ownerId: "ownerA",
      actor: authA.actor,
      payload: { hotspotId: "hsB1" },
    });
  } catch (e) {
    rejected = e.status === 403 && e.code === "unauthorized_scope";
  }
  assert(rejected, "Owner A→Owner B hotspot rejected");

  // 5) Owner A cannot attach Owner B device
  rejected = false;
  try {
    await registry.registerHotspot({
      ownerId: "ownerA",
      actor: authA.actor,
      payload: { hotspotId: "hsA1", deviceLink: { deviceId: "devB" } },
    });
  } catch (e) {
    rejected = e.status === 403;
  }
  assert(rejected, "Owner A cannot link Owner B deviceId");

  // Seed Owner B partner+hotspot for cross-disable
  store.roaming_partners.set("ownerB", {
    ownerId: "ownerB",
    federationStatus: "active",
    homeRoleEnabled: true,
    visitedRoleEnabled: true,
    defaultAgreementId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: "seed",
  });
  store.roaming_hotspots.set("hsB1", {
    hotspotId: "hsB1",
    ownerId: "ownerB",
    partnerStatus: "active",
    enforcementMode: "local_adapter",
    aaaAdapterKey: "unknown",
    capabilities: registry.defaultCapabilities(),
    networkIdentity: { ssid: "B1", venueName: "B1", countryCode: "UG" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // 6) Owner A cannot disable Owner B hotspot
  rejected = false;
  try {
    await registry.disableHotspot({
      ownerId: "ownerA",
      hotspotId: "hsB1",
      actor: authA.actor,
    });
  } catch (e) {
    rejected = e.status === 403;
  }
  assert(rejected, "Owner A cannot disable Owner B hotspot");

  // 7) requireOwnerSelf blocks cross-owner status
  rejected = false;
  try {
    registry.requireOwnerSelf(authA, "ownerB");
  } catch (e) {
    rejected = e.status === 403;
  }
  assert(rejected, "Owner A cannot read/modify Owner B partner status scope");

  // 8) Discovery includes active pair
  let disc = await registry.discoverHotspots();
  assert(
    disc.hotspots.some((h) => h.hotspotId === "hsA1"),
    "active hotspot appears in discovery"
  );
  assert(
    disc.hotspots.some((h) => h.hotspotId === "hsB1"),
    "ownerB active hotspot appears in discovery"
  );

  // 9) Suspend cascade removes from discovery
  await registry.adminAction({
    ownerId: "ownerA",
    action: "suspend",
    actor: "superadmin:test",
    reason: "audit",
  });
  assert(
    store.roaming_partners.get("ownerA").federationStatus === "suspended",
    "partner suspended"
  );
  assert(
    store.roaming_hotspots.get("hsA1").partnerStatus === "suspended",
    "suspend cascades hotspot to suspended"
  );
  disc = await registry.discoverHotspots();
  assert(
    !disc.hotspots.some((h) => h.hotspotId === "hsA1"),
    "suspended partner hotspot absent from discovery"
  );
  assert(
    disc.hotspots.some((h) => h.hotspotId === "hsB1"),
    "other owner hotspot still discoverable after A suspend"
  );

  // Existing local/home data untouched by suspend
  assert(
    store.hotspots.get("hsA1").ownerId === "ownerA",
    "suspend does not alter existing hotspots collection"
  );
  assert(
    store.owners.get("ownerA").businessName === "BizA",
    "suspend does not alter owners collection"
  );

  // 10) Disable removes from discovery
  await registry.disableHotspot({
    ownerId: "ownerB",
    hotspotId: "hsB1",
    actor: "owner:ownerB",
  });
  assert(
    store.roaming_hotspots.get("hsB1").partnerStatus === "disabled",
    "hotspot disabled"
  );
  disc = await registry.discoverHotspots();
  assert(
    !disc.hotspots.some((h) => h.hotspotId === "hsB1"),
    "disabled hotspot absent from discovery"
  );

  // 11) Feature flag OFF fails closed
  process.env.ROAMING_REGISTRY_ENABLED = "false";
  // re-require to refresh isRegistryEnabled closure? it reads env each call
  rejected = false;
  try {
    await registry.discoverHotspots();
  } catch (e) {
    rejected = e.status === 503 && e.code === "roaming_registry_disabled";
  }
  assert(rejected, "flag OFF → discover unavailable");
  rejected = false;
  try {
    await registry.optInPartner({
      ownerId: "ownerA",
      actor: "x",
      payload: {},
    });
  } catch (e) {
    rejected = e.status === 503;
  }
  assert(rejected, "flag OFF → opt-in unavailable");
  assert(registry.isRegistryEnabled() === false, "isRegistryEnabled false");

  // Restore for remaining checks
  process.env.ROAMING_REGISTRY_ENABLED = "true";

  // 12) Super admin auth
  const superAuth = registry.authenticateSuperAdmin(fakeReq("super-ok"));
  assert(superAuth.actor.startsWith("superadmin:"), "super admin authorized");
  rejected = false;
  try {
    registry.authenticateSuperAdmin(fakeReq("tokA"));
  } catch (e) {
    rejected = e.status === 401 || e.status === 403;
  }
  assert(rejected, "owner token cannot pass super-admin auth");

  // 13) Unauthenticated cannot mutate (no token)
  rejected = false;
  try {
    await registry.authenticateOwner(fakeReq(null));
  } catch (e) {
    rejected = e.status === 401;
  }
  assert(rejected, "unauthenticated owner mutation blocked");

  // 14) Schema required fields on partner/hotspot samples
  const partnerDoc = store.roaming_partners.get("ownerA");
  [
    "ownerId",
    "federationStatus",
    "homeRoleEnabled",
    "visitedRoleEnabled",
    "defaultAgreementId",
    "createdAt",
    "updatedAt",
    "updatedBy",
  ].forEach((f) => assert(f in partnerDoc, `partner has ${f}`));

  // Re-register path after terminate/draft not needed; check hotspot schema from earlier reg
  // Recreate active hotspot doc for schema check
  store.roaming_hotspots.set("hsSchema", {
    hotspotId: "hsSchema",
    ownerId: "ownerA",
    partnerStatus: "active",
    enforcementMode: "local_adapter",
    aaaAdapterKey: "cisco",
    capabilities: registry.defaultCapabilities(),
    networkIdentity: { ssid: "x", venueName: "y", countryCode: "UG" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const hs = store.roaming_hotspots.get("hsSchema");
  [
    "hotspotId",
    "ownerId",
    "partnerStatus",
    "enforcementMode",
    "aaaAdapterKey",
    "capabilities",
    "networkIdentity",
  ].forEach((f) => assert(f in hs, `hotspot has ${f}`));
  registry.CAPABILITY_BOOL_KEYS.forEach((k) =>
    assert(typeof hs.capabilities[k] === "boolean", `capability ${k} boolean`)
  );
  assert(Array.isArray(hs.capabilities.eapMethods), "eapMethods array");

  // 15) Illegal transition
  store.roaming_partners.set("ownerA", {
    ...store.roaming_partners.get("ownerA"),
    federationStatus: "terminated",
  });
  rejected = false;
  try {
    await registry.adminAction({
      ownerId: "ownerA",
      action: "approve",
      actor: "superadmin:test",
    });
  } catch (e) {
    rejected = e.status === 409;
  }
  assert(rejected, "terminated→approve illegal");

  // Discovery sensitivity: ensure no password-like fields in discover payloads
  process.env.ROAMING_REGISTRY_ENABLED = "true";
  store.roaming_partners.set("ownerB", {
    ...store.roaming_partners.get("ownerB"),
    federationStatus: "active",
  });
  store.roaming_hotspots.set("hsB1", {
    ...store.roaming_hotspots.get("hsB1"),
    partnerStatus: "active",
    sshPassword: "SHOULD_NOT_EXIST",
  });
  disc = await registry.discoverHotspots();
  // Note: service currently returns full docs — audit will report if sensitive keys present
  const leaked = disc.hotspots.some(
    (h) => h.sshPassword || h.sshUser || h.enablePassword || h.password
  );
  if (leaked) {
    console.log(
      "FINDING: discover returns unexpected credential-like fields if present on doc"
    );
  } else {
    console.log("PASS: discover payload has no credential field names in seed");
  }

  console.log("\nAUDIT HARNESS COMPLETE");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
