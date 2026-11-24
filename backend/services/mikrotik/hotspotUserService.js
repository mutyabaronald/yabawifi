// Phase 8.5A — MikroTik router control foundation.
//
// Translates an ALREADY-AUTHORIZED YabaLink roaming session into RouterOS
// HotSpot user configuration.
//
// CONTAINS NO AUTHORIZATION DECISION. This service never answers "is this
// customer entitled?". That decision belongs to checkEntitlementEligibility in
// backend/services/roamingEntitlementService.js:575 and to nothing else. The
// caller passes in data that has already been authorized; this service only
// translates it into network primitives.
//
// CONTAINS NO BILLING LOGIC. `limit-uptime` is a NETWORK limit derived from the
// authoritative remaining-RAU value the caller supplies. The router never
// calculates RAUs, settlement, package price, owner revenue or wallet balance.
// The RAU engine (backend/services/roamingRauConsumptionService.js) remains the
// sole authority, and the reconciliation invariant
// `sum(consumedRaus) <= session.billedMinutes`
// (roamingSettlementReconciliationService.js:276) remains untouched.
//
// `1 eligible connected roaming minute = 1 RAU`, therefore:
//
//   limitUptimeSeconds = remainingRaus * 60

const { mikrotikError, MIKROTIK_ERROR_CODES } = require("./errors");
const {
  NETWORK_CONTROL_MODES,
  normalizeNetworkControl,
  DEFAULT_ROUTER_OS_API_PORT,
} = require("./featureFlag");

const MS_PER_MINUTE = 60000;

// Mirrors rauCalculationService.js:25 (MS_PER_MINUTE = 60000). Asserted equal
// by the checker so the two definitions cannot silently diverge.
const SECONDS_PER_RAU = MS_PER_MINUTE / 1000;

const DEFAULT_HOTSPOT_PROFILE = "hs_prof";

function invalid(message, details) {
  return mikrotikError(
    MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
    message,
    details,
  );
}

/**
 * Convert remaining RAUs into a RouterOS limit-uptime value.
 *
 * The RAU count is supplied by the caller from authoritative entitlement state.
 * This function performs no lookup, no pricing and no accounting: it is pure
 * arithmetic on a value that has already been decided elsewhere.
 */
function limitUptimeFromRemainingRaus(remainingRaus) {
  if (remainingRaus === undefined || remainingRaus === null) {
    throw invalid(
      "remainingRaus is required to derive a RouterOS limit-uptime",
      { field: "remainingRaus" },
    );
  }
  if (!Number.isInteger(remainingRaus)) {
    throw invalid("remainingRaus must be an integer", { field: "remainingRaus" });
  }
  if (remainingRaus <= 0) {
    // An exhausted entitlement must never be provisioned onto the network.
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      "remainingRaus must be greater than zero to provision network access",
      { field: "remainingRaus", reason: "no_remaining_rau" },
    );
  }
  return remainingRaus * SECONDS_PER_RAU;
}

/**
 * Determine the RouterOS `shared-users` value for a provisioned user.
 *
 * FINDING — THE REPOSITORY CANNOT CURRENTLY DETERMINE THIS. Reported, not guessed.
 *
 *   * Packages (backend/routes/packages.js:79-90) carry timeLimitMinutes,
 *     dataLimitMB and speedLimitMbps only. There is NO per-package device count.
 *   * roaming_entitlements quota.maxSessions
 *     (roamingEntitlementService.js:326-330) is a count of concurrent SESSIONS,
 *     not devices per session, and the purchase bridge always writes it as null
 *     (roamingEntitlementBridgeService.js:260), so the session service falls back
 *     to 1 (roamingSessionService.js:193). It is already enforced upstream by the
 *     concurrent-session check at roamingSessionService.js:270 and is NOT a
 *     per-user simultaneous-device limit.
 *   * The only existing simultaneous-device semantic is devices.antiSharing,
 *     a device-level boolean, which today maps to the HotSpot PROFILE setting
 *     shared-users=1 (backend/routes/devices.js:322-327), not to a per-user value.
 *
 * Therefore no existing commercial rule yields a per-user shared-users value. Per
 * the Phase 8.5A instruction, this is reported rather than invented. The value is
 * OMITTED from the RouterOS command, so the router's own profile default applies.
 */
const SHARED_USERS_SOURCES = Object.freeze({
  EXPLICIT: "explicit",
  DEVICE_ANTI_SHARING: "device_anti_sharing",
  UNDETERMINED: "undetermined",
});

function resolveSharedUsers(input = {}) {
  if (
    input.sharedUsers !== undefined &&
    input.sharedUsers !== null
  ) {
    if (!Number.isInteger(input.sharedUsers) || input.sharedUsers <= 0) {
      throw invalid("sharedUsers must be a positive integer", {
        field: "sharedUsers",
      });
    }
    return {
      sharedUsers: input.sharedUsers,
      sharedUsersSource: SHARED_USERS_SOURCES.EXPLICIT,
      sharedUsersUndetermined: false,
    };
  }

  return {
    sharedUsers: null,
    sharedUsersSource: SHARED_USERS_SOURCES.UNDETERMINED,
    sharedUsersUndetermined: true,
    sharedUsersReason: "no_per_package_device_count_in_repository",
  };
}

/**
 * Refuse RouterOS mutation unless the device is a YabaLink-managed network that
 * is explicitly enabled at both the device and global level.
 */
function assertMutationAllowed(device, options = {}) {
  if (!device || typeof device !== "object") {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_DEVICE_NOT_FOUND,
      "A device record is required before any RouterOS mutation",
      { reason: "device_missing" },
    );
  }

  const networkControl = normalizeNetworkControl(device.networkControl);

  if (networkControl === NETWORK_CONTROL_MODES.PARTNER_MANAGED) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
      "RouterOS mutation refused: this network is partner-managed",
      { networkControl, reason: "partner_managed" },
    );
  }

  if (networkControl !== NETWORK_CONTROL_MODES.YABALINK_MANAGED) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
      "RouterOS mutation refused: networkControl must be yabalink_managed",
      { networkControl, reason: "not_yabalink_managed" },
    );
  }

  if (device.routerOsApiEnabled !== true) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_API_DISABLED,
      "RouterOS mutation refused: routerOsApiEnabled is not true for this device",
      { reason: "device_kill_switch" },
    );
  }

  const isEnabled =
    String(
      process.env.ROAMING_MIKROTIK_API_ENABLED || "false",
    ).toLowerCase() === "true";
  const testModeAllowed =
    options.testMode === true && process.env.NODE_ENV !== "production";

  if (!isEnabled && !testModeAllowed) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_API_DISABLED,
      "RouterOS mutation refused: ROAMING_MIKROTIK_API_ENABLED is not true",
      { reason: "global_kill_switch" },
    );
  }

  return { allowed: true, networkControl };
}

/**
 * Build the RouterOS HotSpot user configuration for an authorized session.
 *
 * Pure function. Performs no I/O, makes no authorization decision and touches no
 * commercial state.
 */
function buildHotspotUserConfig(input = {}) {
  const { session = {}, entitlement = {}, device = {}, identityOptions = {} } = input;

  const routerUsername = requireUsername(input.routerUsername);
  const userPassword = requireUserPassword(input.routerPassword);
  const limitUptimeSeconds = limitUptimeFromRemainingRaus(input.remainingRaus);
  const shared = resolveSharedUsers(input);

  const profile =
    typeof input.hotspotProfile === "string" && input.hotspotProfile.length > 0
      ? input.hotspotProfile
      : DEFAULT_HOTSPOT_PROFILE;

  const limitBytesTotal =
    input.limitBytesTotal === undefined || input.limitBytesTotal === null
      ? null
      : input.limitBytesTotal;

  return Object.freeze({
    routerUsername,
    userPassword,
    profile,
    limitUptimeSeconds,
    sharedUsers: shared.sharedUsers,
    sharedUsersSource: shared.sharedUsersSource,
    sharedUsersUndetermined: shared.sharedUsersUndetermined,
    sharedUsersReason: shared.sharedUsersReason || null,
    limitBytesTotal,
    sessionId: session.sessionId || null,
    entitlementId: entitlement.entitlementId || input.entitlementId || null,
    homeOwnerId: session.homeOwnerId || entitlement.homeOwnerId || null,
    visitedOwnerId: session.visitedOwnerId || null,
    visitedHotspotId: session.visitedHotspotId || null,
    networkControl: normalizeNetworkControl(device.networkControl),
    routerOsApiPort:
      typeof device.routerOsApiPort === "number"
        ? device.routerOsApiPort
        : DEFAULT_ROUTER_OS_API_PORT,
    // Reminder carried on every config object so a future adapter cannot
    // accidentally treat limit-uptime as a billing input.
    limitUptimeAuthority: "yabalink_entitlement_only",
  });
}

function requireUsername(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(
      "routerUsername is required and must be derived by mikrotik/identity",
      { field: "routerUsername" },
    );
  }
  return value;
}

function requireUserPassword(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid("routerPassword is required to provision a HotSpot user", {
      field: "routerPassword",
    });
  }
  return value;
}

/**
 * Provision a HotSpot user on the device's router.
 *
 * Refuses every network-control mode other than yabalink_managed, and refuses
 * when either kill switch is off. Idempotent at the router boundary: an
 * already-present user is reported as success rather than treated as failure.
 */
async function provisionUser(input = {}) {
  assertMutationAllowed(input.device, { testMode: input.testMode });
  const config = input.config || buildHotspotUserConfig(input);
  const client = requireClient(input.client, "addHotspotUser");

  const apiPassword =
    input.apiPassword != null
      ? input.apiPassword
      : await requireApiPassword(input);

  const result = await client.addHotspotUser({
    host: requireHost(input.device),
    port: config.routerOsApiPort,
    apiUsername: requireApiUsername(input.device),
    apiPassword,
    tls: input.device.routerOsTls === true,
    timeoutMs: input.timeoutMs,
    retries: input.retries,
    user: config.routerUsername,
    userPassword: config.userPassword,
    profile: config.profile,
    limitUptimeSeconds: config.limitUptimeSeconds,
    sharedUsers: config.sharedUsers,
    limitBytesTotal: config.limitBytesTotal,
  });

  return Object.freeze({
    provisioned: true,
    alreadyExisted: result.alreadyExists === true,
    routerUsername: config.routerUsername,
    networkControl: config.networkControl,
    limitUptimeSeconds: config.limitUptimeSeconds,
    sharedUsers: config.sharedUsers,
    sharedUsersSource: config.sharedUsersSource,
    sharedUsersUndetermined: config.sharedUsersUndetermined,
    attempts: result.attempts,
    sessionId: config.sessionId,
    entitlementId: config.entitlementId,
  });
}

/**
 * Remove the HotSpot user entirely. Idempotent: an absent user is success.
 */
async function removeUser(input = {}) {
  assertMutationAllowed(input.device, { testMode: input.testMode });
  const config = input.config || buildHotspotUserConfig(input);
  const client = requireClient(input.client, "removeHotspotUser");

  const apiPassword =
    input.apiPassword != null
      ? input.apiPassword
      : await requireApiPassword(input);

  const result = await client.removeHotspotUser({
    host: requireHost(input.device),
    port: config.routerOsApiPort,
    apiUsername: requireApiUsername(input.device),
    apiPassword,
    tls: input.device.routerOsTls === true,
    timeoutMs: input.timeoutMs,
    retries: input.retries,
    user: config.routerUsername,
  });

  return Object.freeze({
    removed: true,
    alreadyAbsent: result.notFound === true,
    routerUsername: config.routerUsername,
    networkControl: config.networkControl,
    sessionId: config.sessionId,
  });
}

/**
 * Drop the active network session without removing the HotSpot user, so that a
 * later reconnect can reuse the same provisioned identity. Idempotent.
 */
async function disconnectActiveUser(input = {}) {
  assertMutationAllowed(input.device, { testMode: input.testMode });
  const config = input.config || buildHotspotUserConfig(input);
  const client = requireClient(input.client, "removeActiveHotspotUser");

  const apiPassword =
    input.apiPassword != null
      ? input.apiPassword
      : await requireApiPassword(input);

  const result = await client.removeActiveHotspotUser({
    host: requireHost(input.device),
    port: config.routerOsApiPort,
    apiUsername: requireApiUsername(input.device),
    apiPassword,
    tls: input.device.routerOsTls === true,
    timeoutMs: input.timeoutMs,
    retries: input.retries,
    user: config.routerUsername,
  });

  return Object.freeze({
    disconnected: true,
    alreadyAbsent: result.notFound === true,
    routerUsername: config.routerUsername,
    networkControl: config.networkControl,
    sessionId: config.sessionId,
  });
}

/**
 * Read-only reachability probe. Never mutates network state, never touches
 * customer access, and never retries.
 */
async function checkHealth(input = {}) {
  const device = input.device;
  if (!device || typeof device !== "object") {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_DEVICE_NOT_FOUND,
      "A device record is required for a router health check",
      { reason: "device_missing" },
    );
  }
  const networkControl = normalizeNetworkControl(device.networkControl);
  if (networkControl !== NETWORK_CONTROL_MODES.YABALINK_MANAGED) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
      "Router health check refused: networkControl must be yabalink_managed",
      { networkControl, reason: "not_yabalink_managed" },
    );
  }

  const isEnabled =
    String(process.env.ROAMING_MIKROTIK_API_ENABLED || "false").toLowerCase() ===
    "true";
  const testModeAllowed =
    input.testMode === true && process.env.NODE_ENV !== "production";
  if (!isEnabled && !testModeAllowed) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_API_DISABLED,
      "Router health check refused: ROAMING_MIKROTIK_API_ENABLED is not true",
      { reason: "global_kill_switch" },
    );
  }

  const client = requireClient(input.client, "health");

  const apiPassword =
    input.apiPassword != null
      ? input.apiPassword
      : await requireApiPassword(input);

  const result = await client.health({
    host: requireHost(device),
    port:
      typeof device.routerOsApiPort === "number"
        ? device.routerOsApiPort
        : DEFAULT_ROUTER_OS_API_PORT,
    apiUsername: requireApiUsername(device),
    apiPassword,
    tls: device.routerOsTls === true,
    timeoutMs: input.timeoutMs,
  });

  return Object.freeze({
    reachable: result.reachable,
    state: result.state,
    reason: result.reason || null,
    attempts: result.attempts,
    networkControl,
    deviceId: device.deviceId || null,
    checkedAt: result.checkedAt,
  });
}

function requireClient(client, method) {
  if (!client || typeof client[method] !== "function") {
    throw invalid(`A RouterOS client exposing ${method}() is required`, {
      field: "client",
      method,
    });
  }
  return client;
}

function requireHost(device) {
  const host =
    device.routerOsHost || device.wanIp || device.ip || null;
  if (typeof host !== "string" || host.length === 0) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_DEVICE_NOT_FOUND,
      "The device has no resolvable RouterOS host",
      { reason: "host_unavailable", field: "routerOsHost" },
    );
  }
  return host;
}

function requireApiUsername(device) {
  const username = device.routerOsApiUsername;
  if (typeof username !== "string" || username.length === 0) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      "The device has no RouterOS API username",
      { reason: "api_username_missing", field: "routerOsApiUsername" },
    );
  }
  return username;
}

/**
 * Resolve the RouterOS API password through the injected, owner-scoped secret
 * resolver. The secret is never read from the device record, because the device
 * record must never contain secret material.
 */
async function requireApiPassword(input = {}) {
  const device = input.device || {};
  const resolver = input.secretResolver;
  if (!resolver || typeof resolver.resolveSecret !== "function") {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_SECRET_UNAVAILABLE,
      "A RouterOS secret resolver is required",
      { reason: "resolver_missing" },
    );
  }
  const secretReference = device.routerOsApiSecretRef;
  return resolver.resolveSecret({
    secretReference,
    ownerId: device.ownerId,
    deviceId: device.deviceId,
  });
}

module.exports = {
  MS_PER_MINUTE,
  SECONDS_PER_RAU,
  DEFAULT_HOTSPOT_PROFILE,
  SHARED_USERS_SOURCES,
  limitUptimeFromRemainingRaus,
  resolveSharedUsers,
  assertMutationAllowed,
  buildHotspotUserConfig,
  provisionUser,
  removeUser,
  disconnectActiveUser,
  checkHealth,
};