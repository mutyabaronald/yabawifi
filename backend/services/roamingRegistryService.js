const jwt = require("jsonwebtoken");
const { db } = require("../firebase");

const SUPERADMIN_JWT_SECRET =
  process.env.SUPERADMIN_JWT_SECRET || "dev-super-secret";

const FEDERATION_STATUSES = Object.freeze([
  "draft",
  "active",
  "suspended",
  "terminated",
]);

const PARTNER_STATUSES = Object.freeze(["active", "disabled", "suspended"]);

const ENFORCEMENT_MODES = Object.freeze(["local_adapter", "radius"]);

const AAA_ADAPTER_KEYS = Object.freeze([
  "mikrotik",
  "cisco",
  "unifi",
  "tplink",
  "radius",
  "unknown",
]);

const ADMIN_ACTIONS = Object.freeze(["approve", "suspend", "terminate"]);

const CAPABILITY_BOOL_KEYS = Object.freeze([
  "captivePortal",
  "localProvisioning",
  "radiusAuth",
  "radiusAccounting",
  "disconnect",
  "usageAccounting",
  "passpoint",
]);

class RegistryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isRegistryEnabled() {
  return String(process.env.ROAMING_REGISTRY_ENABLED || "false").toLowerCase() ===
    "true";
}

function nowIso() {
  return new Date().toISOString();
}

function assertRegistryEnabled() {
  if (!isRegistryEnabled()) {
    throw new RegistryError(
      503,
      "roaming_registry_disabled",
      "Roaming registry is disabled"
    );
  }
}

function extractBearer(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  return null;
}

async function authenticateOwner(req) {
  const token = extractBearer(req);
  if (!token) {
    throw new RegistryError(401, "unauthenticated", "Authentication token required");
  }
  const sessionDoc = await db.collection("owner_sessions").doc(token).get();
  if (!sessionDoc.exists) {
    throw new RegistryError(401, "unauthenticated", "Invalid or expired session");
  }
  const sessionData = sessionDoc.data() || {};
  if (sessionData.expiresAt && new Date(sessionData.expiresAt) < new Date()) {
    throw new RegistryError(401, "unauthenticated", "Session expired");
  }
  if (!sessionData.ownerId) {
    throw new RegistryError(401, "unauthenticated", "Invalid session");
  }
  return {
    ownerId: sessionData.ownerId,
    phone: sessionData.phone || null,
    actor: `owner:${sessionData.ownerId}`,
  };
}

function authenticateSuperAdmin(req) {
  const token = extractBearer(req);
  if (!token) {
    throw new RegistryError(401, "unauthenticated", "Missing token");
  }
  let payload;
  try {
    payload = jwt.verify(token, SUPERADMIN_JWT_SECRET);
  } catch (err) {
    throw new RegistryError(401, "unauthenticated", "Invalid or expired token");
  }
  if (!payload || payload.role !== "superadmin") {
    throw new RegistryError(403, "unauthorized_scope", "Unauthorized access");
  }
  return {
    email: payload.sub || payload.email || "superadmin",
    actor: `superadmin:${payload.sub || "unknown"}`,
  };
}

async function authenticateOwnerOrSuper(req) {
  const token = extractBearer(req);
  if (!token) {
    throw new RegistryError(401, "unauthenticated", "Authentication token required");
  }
  try {
    const payload = jwt.verify(token, SUPERADMIN_JWT_SECRET);
    if (payload && payload.role === "superadmin") {
      return {
        kind: "superadmin",
        email: payload.sub || payload.email || "superadmin",
        actor: `superadmin:${payload.sub || "unknown"}`,
      };
    }
  } catch (err) {
    // Not a super-admin JWT; try owner session.
  }
  const owner = await authenticateOwner(req);
  return { kind: "owner", ...owner };
}

function requireOwnerSelf(auth, requestedOwnerId) {
  if (!requestedOwnerId) {
    throw new RegistryError(400, "validation_error", "ownerId is required");
  }
  if (auth.ownerId !== requestedOwnerId) {
    throw new RegistryError(
      403,
      "unauthorized_scope",
      "Owner can only act on their own roaming records"
    );
  }
}

function defaultCapabilities() {
  return {
    captivePortal: true,
    localProvisioning: false,
    radiusAuth: false,
    radiusAccounting: false,
    disconnect: false,
    usageAccounting: false,
    passpoint: false,
    eapMethods: [],
  };
}

function sanitizeCapabilities(input) {
  const base = defaultCapabilities();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return base;
  }
  for (const key of CAPABILITY_BOOL_KEYS) {
    if (typeof input[key] === "boolean") {
      base[key] = input[key];
    }
  }
  if (Array.isArray(input.eapMethods)) {
    base.eapMethods = input.eapMethods
      .filter((m) => typeof m === "string")
      .map((m) => m.trim())
      .filter(Boolean)
      .slice(0, 32);
  }
  return base;
}

function sanitizeNetworkIdentity(input, hotspotData) {
  const fromHotspot = {
    ssid: hotspotData?.ssid || null,
    venueName: hotspotData?.hotspotName || hotspotData?.name || null,
    countryCode: hotspotData?.countryCode || "UG",
  };
  if (!input || typeof input !== "object") {
    return fromHotspot;
  }
  return {
    ssid:
      typeof input.ssid === "string" || input.ssid === null
        ? input.ssid
        : fromHotspot.ssid,
    venueName:
      typeof input.venueName === "string"
        ? input.venueName
        : fromHotspot.venueName,
    countryCode:
      typeof input.countryCode === "string"
        ? input.countryCode
        : fromHotspot.countryCode,
  };
}

function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new RegistryError(
      400,
      "validation_error",
      `Invalid ${field}. Allowed: ${allowed.join(", ")}`
    );
  }
}

function canTransitionFederation(from, to) {
  if (from === to) return true;
  const allowed = {
    draft: ["active", "suspended", "terminated"],
    active: ["suspended", "terminated"],
    suspended: ["active", "terminated"],
    terminated: ["draft"],
  };
  return (allowed[from] || []).includes(to);
}

async function loadPartner(ownerId) {
  const snap = await db.collection("roaming_partners").doc(ownerId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function loadOwner(ownerId) {
  const snap = await db.collection("owners").doc(ownerId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function loadHotspot(hotspotId) {
  const snap = await db.collection("hotspots").doc(hotspotId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function assertDeviceOwnedBy(ownerId, deviceId) {
  if (!deviceId) return;
  const snap = await db.collection("devices").doc(String(deviceId)).get();
  if (!snap.exists) {
    throw new RegistryError(400, "validation_error", "deviceId not found");
  }
  const data = snap.data() || {};
  if (data.ownerId && data.ownerId !== ownerId) {
    throw new RegistryError(
      403,
      "unauthorized_scope",
      "deviceId does not belong to this owner"
    );
  }
}

async function assertRouterOwnedBy(ownerId, routerId) {
  if (!routerId) return;
  const snap = await db.collection("routers").doc(String(routerId)).get();
  if (!snap.exists) {
    throw new RegistryError(400, "validation_error", "routerId not found");
  }
  const data = snap.data() || {};
  if (data.ownerId && data.ownerId !== ownerId) {
    throw new RegistryError(
      403,
      "unauthorized_scope",
      "routerId does not belong to this owner"
    );
  }
}

function matchesIdempotency(doc, key) {
  return Boolean(key && doc && doc.lastIdempotencyKey === key);
}

async function optInPartner({ ownerId, actor, payload, idempotencyKey }) {
  assertRegistryEnabled();
  const owner = await loadOwner(ownerId);
  if (!owner) {
    throw new RegistryError(404, "not_found", "Owner not found");
  }

  const existing = await loadPartner(ownerId);
  if (matchesIdempotency(existing, idempotencyKey)) {
    return { partner: existing, idempotent: true };
  }

  const homeRoleEnabled = payload.homeRoleEnabled !== false;
  const visitedRoleEnabled = payload.visitedRoleEnabled !== false;
  const timestamp = nowIso();

  if (existing) {
    if (existing.federationStatus === "terminated") {
      const next = {
        ...existing,
        ownerId,
        federationStatus: "draft",
        homeRoleEnabled,
        visitedRoleEnabled,
        updatedAt: timestamp,
        updatedBy: actor,
        lastIdempotencyKey: idempotencyKey || existing.lastIdempotencyKey || null,
      };
      if (typeof payload.displayName === "string") next.displayName = payload.displayName;
      await db.collection("roaming_partners").doc(ownerId).set(next, { merge: true });
      const saved = await loadPartner(ownerId);
      return { partner: saved, created: false, reapplied: true };
    }
    const merge = {
      homeRoleEnabled,
      visitedRoleEnabled,
      updatedAt: timestamp,
      updatedBy: actor,
    };
    if (typeof payload.displayName === "string") merge.displayName = payload.displayName;
    if (payload.supportContact && typeof payload.supportContact === "object") {
      merge.supportContact = payload.supportContact;
    }
    if (typeof payload.capabilityProfileId === "string") {
      merge.capabilityProfileId = payload.capabilityProfileId;
    }
    if (typeof payload.passpointDomain === "string") {
      merge.passpointDomain = payload.passpointDomain;
    }
    if (Array.isArray(payload.naiRealmHints)) {
      merge.naiRealmHints = payload.naiRealmHints.filter((x) => typeof x === "string");
    }
    merge.lastIdempotencyKey = idempotencyKey || null;
    await db.collection("roaming_partners").doc(ownerId).set(merge, { merge: true });
    const saved = await loadPartner(ownerId);
    return { partner: saved, created: false, idempotent: true };
  }

  const doc = {
    ownerId,
    federationStatus: "draft",
    homeRoleEnabled,
    visitedRoleEnabled,
    defaultAgreementId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedBy: actor,
    displayName:
      typeof payload.displayName === "string"
        ? payload.displayName
        : owner.businessName || owner.ownerName || null,
    supportContact:
      payload.supportContact && typeof payload.supportContact === "object"
        ? payload.supportContact
        : undefined,
    capabilityProfileId: payload.capabilityProfileId || undefined,
    passpointDomain: payload.passpointDomain || undefined,
    naiRealmHints: Array.isArray(payload.naiRealmHints)
      ? payload.naiRealmHints.filter((x) => typeof x === "string")
      : undefined,
    lastIdempotencyKey: idempotencyKey || null,
  };

  Object.keys(doc).forEach((k) => doc[k] === undefined && delete doc[k]);
  await db.collection("roaming_partners").doc(ownerId).set(doc);
  return { partner: doc, created: true };
}

async function getPartnerStatus(ownerId) {
  assertRegistryEnabled();
  const partner = await loadPartner(ownerId);
  const hotspotsSnap = await db
    .collection("roaming_hotspots")
    .where("ownerId", "==", ownerId)
    .get();
  const hotspots = hotspotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return {
    exists: !!partner,
    partner: partner || null,
    hotspots,
  };
}

async function listPartners() {
  assertRegistryEnabled();
  const snap = await db.collection("roaming_partners").limit(500).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function setHotspotsStatusForOwner(ownerId, partnerStatus, actor) {
  const snap = await db
    .collection("roaming_hotspots")
    .where("ownerId", "==", ownerId)
    .get();
  const batch = db.batch();
  const timestamp = nowIso();
  snap.docs.forEach((doc) => {
    batch.set(
      doc.ref,
      {
        partnerStatus,
        updatedAt: timestamp,
        updatedBy: actor,
      },
      { merge: true }
    );
  });
  if (!snap.empty) {
    await batch.commit();
  }
}

async function adminAction({ ownerId, action, reason, actor, idempotencyKey }) {
  assertRegistryEnabled();
  assertEnum(action, ADMIN_ACTIONS, "action");
  const partner = await loadPartner(ownerId);
  if (!partner) {
    throw new RegistryError(404, "not_found", "Roaming partner not found");
  }
  if (matchesIdempotency(partner, idempotencyKey)) {
    return { partner, idempotent: true };
  }

  const nextStatus =
    action === "approve"
      ? "active"
      : action === "suspend"
        ? "suspended"
        : "terminated";

  if (!canTransitionFederation(partner.federationStatus, nextStatus)) {
    throw new RegistryError(
      409,
      "state_conflict",
      `Cannot ${action} partner from status ${partner.federationStatus}`
    );
  }

  const timestamp = nowIso();
  const update = {
    federationStatus: nextStatus,
    updatedAt: timestamp,
    updatedBy: actor,
    lastIdempotencyKey: idempotencyKey || null,
  };
  if (nextStatus === "suspended" || nextStatus === "terminated") {
    update.suspensionReason = reason || action;
  } else {
    update.suspensionReason = null;
  }

  await db.collection("roaming_partners").doc(ownerId).set(update, { merge: true });

  if (nextStatus === "suspended") {
    await setHotspotsStatusForOwner(ownerId, "suspended", actor);
  }
  if (nextStatus === "terminated") {
    await setHotspotsStatusForOwner(ownerId, "disabled", actor);
  }

  const saved = await loadPartner(ownerId);
  return { partner: saved };
}

async function registerHotspot({
  ownerId,
  actor,
  payload,
  idempotencyKey,
}) {
  assertRegistryEnabled();
  const hotspotId = payload.hotspotId;
  if (!hotspotId || typeof hotspotId !== "string") {
    throw new RegistryError(400, "validation_error", "hotspotId is required");
  }

  const partner = await loadPartner(ownerId);
  if (!partner || partner.federationStatus !== "active") {
    throw new RegistryError(
      422,
      "ineligible",
      "Owner must be an active roaming partner before registering hotspots"
    );
  }

  const hotspot = await loadHotspot(hotspotId);
  if (!hotspot) {
    throw new RegistryError(404, "not_found", "Hotspot not found");
  }
  if (hotspot.ownerId !== ownerId) {
    throw new RegistryError(
      403,
      "unauthorized_scope",
      "Hotspot does not belong to the authenticated owner"
    );
  }

  const existingSnap = await db.collection("roaming_hotspots").doc(hotspotId).get();
  const existing = existingSnap.exists ? { id: existingSnap.id, ...existingSnap.data() } : null;
  if (existing && existing.ownerId && existing.ownerId !== ownerId) {
    throw new RegistryError(
      403,
      "unauthorized_scope",
      "Hotspot is already registered to another owner"
    );
  }
  if (matchesIdempotency(existing, idempotencyKey)) {
    return { hotspot: existing, idempotent: true };
  }

  const enforcementMode = payload.enforcementMode || "local_adapter";
  assertEnum(enforcementMode, ENFORCEMENT_MODES, "enforcementMode");
  const aaaAdapterKey = payload.aaaAdapterKey || "unknown";
  assertEnum(aaaAdapterKey, AAA_ADAPTER_KEYS, "aaaAdapterKey");

  const deviceLink =
    payload.deviceLink && typeof payload.deviceLink === "object"
      ? {
          deviceId: payload.deviceLink.deviceId || undefined,
          routerId: payload.deviceLink.routerId || undefined,
        }
      : undefined;
  if (deviceLink?.deviceId) {
    await assertDeviceOwnedBy(ownerId, deviceLink.deviceId);
  }
  if (deviceLink?.routerId) {
    await assertRouterOwnedBy(ownerId, deviceLink.routerId);
  }

  const timestamp = nowIso();
  const doc = {
    hotspotId,
    ownerId,
    partnerStatus: "active",
    enforcementMode,
    aaaAdapterKey,
    capabilities: sanitizeCapabilities(payload.capabilities),
    networkIdentity: sanitizeNetworkIdentity(payload.networkIdentity, hotspot),
    updatedAt: timestamp,
    updatedBy: actor,
    lastIdempotencyKey: idempotencyKey || null,
  };
  if (!existing) {
    doc.createdAt = timestamp;
  } else {
    doc.createdAt = existing.createdAt || timestamp;
    doc.ownerId = existing.ownerId;
    doc.hotspotId = existing.hotspotId;
  }
  if (deviceLink && (deviceLink.deviceId || deviceLink.routerId)) {
    doc.deviceLink = deviceLink;
  }
  if (typeof payload.radiusProfileId === "string") {
    doc.radiusProfileId = payload.radiusProfileId;
  }
  if (typeof payload.passpointProfileId === "string") {
    doc.passpointProfileId = payload.passpointProfileId;
  }
  if (Array.isArray(payload.roamingConsortiumOis)) {
    doc.roamingConsortiumOis = payload.roamingConsortiumOis.filter(
      (x) => typeof x === "string"
    );
  }
  if (Array.isArray(payload.naiRealms)) {
    doc.naiRealms = payload.naiRealms.filter((x) => typeof x === "string");
  }
  if (payload.anqpVenueInfo && typeof payload.anqpVenueInfo === "object") {
    doc.anqpVenueInfo = payload.anqpVenueInfo;
  }

  await db.collection("roaming_hotspots").doc(hotspotId).set(doc, { merge: true });
  const saved = await db.collection("roaming_hotspots").doc(hotspotId).get();
  return { hotspot: { id: saved.id, ...saved.data() }, created: !existing };
}

async function disableHotspot({ ownerId, hotspotId, actor, idempotencyKey }) {
  assertRegistryEnabled();
  if (!hotspotId) {
    throw new RegistryError(400, "validation_error", "hotspotId is required");
  }
  const snap = await db.collection("roaming_hotspots").doc(hotspotId).get();
  if (!snap.exists) {
    throw new RegistryError(404, "not_found", "Roaming hotspot not found");
  }
  const data = snap.data() || {};
  if (data.ownerId !== ownerId) {
    throw new RegistryError(
      403,
      "unauthorized_scope",
      "Hotspot does not belong to the authenticated owner"
    );
  }
  if (data.partnerStatus === "disabled") {
    return { hotspot: { id: snap.id, ...data }, idempotent: true };
  }
  if (matchesIdempotency(data, idempotencyKey)) {
    return { hotspot: { id: snap.id, ...data }, idempotent: true };
  }

  const timestamp = nowIso();
  await snap.ref.set(
    {
      partnerStatus: "disabled",
      disabledReason: "owner_disabled",
      updatedAt: timestamp,
      updatedBy: actor,
      lastIdempotencyKey: idempotencyKey || null,
    },
    { merge: true }
  );
  const saved = await snap.ref.get();
  return { hotspot: { id: saved.id, ...saved.data() } };
}

async function discoverHotspots() {
  assertRegistryEnabled();
  const partnersSnap = await db
    .collection("roaming_partners")
    .where("federationStatus", "==", "active")
    .get();
  const activeOwnerIds = new Set(partnersSnap.docs.map((d) => d.id));

  const hotspotsSnap = await db
    .collection("roaming_hotspots")
    .where("partnerStatus", "==", "active")
    .get();

  const hotspots = [];
  hotspotsSnap.forEach((doc) => {
    const data = doc.data() || {};
    if (!activeOwnerIds.has(data.ownerId)) return;
    hotspots.push({ id: doc.id, ...data });
  });
  return { hotspots, count: hotspots.length };
}

function handleError(res, err) {
  if (err instanceof RegistryError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }
  console.error("Roaming registry error:", err);
  return res.status(500).json({
    success: false,
    error: "server_error",
    message: "Roaming registry request failed",
  });
}

module.exports = {
  RegistryError,
  isRegistryEnabled,
  assertRegistryEnabled,
  authenticateOwner,
  authenticateSuperAdmin,
  authenticateOwnerOrSuper,
  requireOwnerSelf,
  sanitizeCapabilities,
  defaultCapabilities,
  canTransitionFederation,
  FEDERATION_STATUSES,
  PARTNER_STATUSES,
  ENFORCEMENT_MODES,
  AAA_ADAPTER_KEYS,
  CAPABILITY_BOOL_KEYS,
  optInPartner,
  getPartnerStatus,
  listPartners,
  adminAction,
  registerHotspot,
  disableHotspot,
  discoverHotspots,
  handleError,
};
