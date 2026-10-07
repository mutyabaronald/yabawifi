// Phase 8.5A — network-control enforcement snapshot.
//
// WHY THIS EXISTS
// The Phase 8.5A decision forbids modifying
// backend/services/roamingEnforcementService.js. That service already writes the
// `roaming_enforcements` document for the RADIUS transport, so the network-control
// equivalents are defined here as a pure, independently testable builder. A future
// phase wires this builder into the enforcement write path; Phase 8.5A only defines
// and tests the shape.
//
// The snapshot exists so that the network-control decision made at AUTHORIZATION
// time is frozen and auditable. Later re-reading live device state would make an
// enforcement action non-reproducible, and would make it impossible to prove which
// inputs produced a given network change.
//
// The snapshot carries NO secret material: no password, no secret reference, no
// API credential of any kind. `routerUsername` is a pseudonymous HMAC-derived
// identifier (see ./identity.js), not a credential.

const {
  NETWORK_CONTROL_MODES,
  DEFAULT_ROUTER_OS_API_PORT,
  normalizeNetworkControl,
  normalizeRouterOsApiState,
} = require("./featureFlag");
const { SHARED_USERS_SOURCES } = require("./hotspotUserService");

const ENFORCEMENT_TRANSPORT = Object.freeze({
  RADIUS: "radius",
  MIKROTIK_ROUTEROS: "mikrotik_routeros",
});

const SNAPSHOT_VERSION = 1;

const SNAPSHOT_SECRET_FIELDS = Object.freeze([
  "password",
  "userPassword",
  "apiPassword",
  "secret",
  "apiSecret",
  "sharedSecret",
  "routerOsApiSecretRef",
  "token",
]);

/**
 * Build the network-control snapshot to persist alongside an enforcement record.
 *
 * Pure function: performs no I/O and changes no state. The caller supplies the
 * already-authorized session and the device it is being enforced on.
 *
 * @param {object} input
 * @param {object} input.session       authorized session (sessionId, homeOwnerId, visitedOwnerId)
 * @param {object} input.device        device document
 * @param {object} input.config        output of buildHotspotUserConfig()
 * @param {Date}   [input.capturedAt]  injected for deterministic tests
 */
function buildNetworkControlSnapshot(input = {}) {
  const { session = {}, device = {}, config = {} } = input;

  const networkControl = normalizeNetworkControl(device.networkControl);
  const transport =
    networkControl === NETWORK_CONTROL_MODES.YABALINK_MANAGED
      ? ENFORCEMENT_TRANSPORT.MIKROTIK_ROUTEROS
      : null;

  const snapshot = {
    snapshotVersion: SNAPSHOT_VERSION,
    transport,
    capturedAt: (input.capturedAt || new Date()).toISOString(),
    capturedAtISO: (input.capturedAt || new Date()).toISOString(),

    // Identity of what was authorized.
    sessionId: session.sessionId || null,
    entitlementId: config.entitlementId || null,
    homeOwnerId: session.homeOwnerId || null,
    visitedOwnerId: session.visitedOwnerId || null,

    // What would carry the enforcement.
    deviceId: device.deviceId || null,
    hotspotId: session.visitedHotspotId || null,
    networkControl,
    routerOsApiEnabled: device.routerOsApiEnabled === true,
    routerOsApiPort:
      typeof device.routerOsApiPort === "number"
        ? device.routerOsApiPort
        : DEFAULT_ROUTER_OS_API_PORT,
    routerOsApiState: normalizeRouterOsApiState(device.routerOsApiState),

    // What would be configured on the router.
    // Pseudonymous, HMAC-derived, and NOT a credential.
    routerUsername: config.routerUsername || null,
    hotspotProfile: config.profile || null,
    limitUptimeSeconds:
      typeof config.limitUptimeSeconds === "number"
        ? config.limitUptimeSeconds
        : null,
    limitBytesTotal:
      typeof config.limitBytesTotal === "number" ? config.limitBytesTotal : null,
    sharedUsers:
      typeof config.sharedUsers === "number" ? config.sharedUsers : null,
    sharedUsersSource:
      config.sharedUsersSource || SHARED_USERS_SOURCES.UNDETERMINED,

    // The RAU engine remains the sole billing authority. Recorded so that no
    // later reader mistakes limit-uptime for a billing input.
    limitUptimeAuthority: "yabalink_entitlement_only",
  };

  return Object.freeze(assertNoSecretMaterial(snapshot));
}

/**
 * Defensive invariant: an enforcement snapshot must never carry secret material.
 * Throws rather than silently persisting a snapshot that would leak a credential
 * into the enforcement audit trail.
 */
function assertNoSecretMaterial(snapshot) {
  for (const field of SNAPSHOT_SECRET_FIELDS) {
    if (snapshot[field] !== undefined && snapshot[field] !== null) {
      throw new Error(
        `enforcement snapshot must not contain secret field "${field}"`,
      );
    }
  }
  return snapshot;
}

module.exports = {
  ENFORCEMENT_TRANSPORT,
  SNAPSHOT_VERSION,
  SNAPSHOT_SECRET_FIELDS,
  buildNetworkControlSnapshot,
  assertNoSecretMaterial,
};