// Phase 8.5A — MikroTik router control foundation.
//
// Dedicated feature-flag module. Intentionally separate from
// backend/services/radiusTransport/featureFlag.js: RADIUS and RouterOS control
// are independent capabilities and must be independently disableable during an
// incident (Phase 8.4 Decision Lock §17 recommends a second, independent kill
// switch). ROAMING_RADIUS_ENABLED is never read here.
//
// Phase 8.5A does NOT register an adapter and does NOT enable customer traffic.
// Every mutation therefore requires BOTH:
//   1. ROAMING_MIKROTIK_API_ENABLED = true   (global, default false)
//   2. device.routerOsApiEnabled === true    (per-device, default false)
//   3. device.networkControl === "yabalink_managed"
//
// All three default to refusing.

const { mikrotikError, MIKROTIK_ERROR_CODES } = require("./errors");

const MIKROTIK_API_ENABLED_ENV_VAR = "ROAMING_MIKROTIK_API_ENABLED";
const MIKROTIK_API_ENABLED_DEFAULT = false;

const NETWORK_CONTROL_MODES = Object.freeze({
  NONE: "none",
  YABALINK_MANAGED: "yabalink_managed",
  PARTNER_MANAGED: "partner_managed",
});

const NETWORK_CONTROL_VALUES = Object.freeze([
  NETWORK_CONTROL_MODES.NONE,
  NETWORK_CONTROL_MODES.YABALINK_MANAGED,
  NETWORK_CONTROL_MODES.PARTNER_MANAGED,
]);

const ROUTER_OS_API_STATES = Object.freeze({
  UNCONFIGURED: "unconfigured",
  REACHABLE: "reachable",
  UNREACHABLE: "unreachable",
  ERROR: "error",
});

const ROUTER_OS_API_STATE_VALUES = Object.freeze([
  ROUTER_OS_API_STATES.UNCONFIGURED,
  ROUTER_OS_API_STATES.REACHABLE,
  ROUTER_OS_API_STATES.UNREACHABLE,
  ROUTER_OS_API_STATES.ERROR,
]);

const DEFAULT_ROUTER_OS_API_PORT = 8728;

function isMikrotikApiEnabled() {
  return (
    String(process.env[MIKROTIK_API_ENABLED_ENV_VAR] || "false").toLowerCase() ===
    "true"
  );
}

function isTestModeAllowed() {
  return process.env.NODE_ENV !== "production";
}

function assertMikrotikApiEnabled(options = {}) {
  if (isMikrotikApiEnabled()) {
    return { enabled: true, mode: "production_flag" };
  }
  if (options.testMode === true && isTestModeAllowed()) {
    return { enabled: true, mode: "explicit_test_mode" };
  }
  throw mikrotikError(
    MIKROTIK_ERROR_CODES.MIKROTIK_API_DISABLED,
    `MikroTik router control is disabled. Set ${MIKROTIK_API_ENABLED_ENV_VAR}=true to enable.`,
    {
      envVar: MIKROTIK_API_ENABLED_ENV_VAR,
      defaultEnabled: MIKROTIK_API_ENABLED_DEFAULT,
    },
  );
}

function normalizeNetworkControl(value) {
  if (value === null || value === undefined || value === "") {
    return NETWORK_CONTROL_MODES.NONE;
  }
  if (typeof value !== "string" || !NETWORK_CONTROL_VALUES.includes(value)) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      "networkControl must be one of: none, yabalink_managed, partner_managed",
      { field: "networkControl" },
    );
  }
  return value;
}

function normalizeRouterOsApiState(value) {
  if (value === null || value === undefined || value === "") {
    return ROUTER_OS_API_STATES.UNCONFIGURED;
  }
  if (
    typeof value !== "string" ||
    !ROUTER_OS_API_STATE_VALUES.includes(value)
  ) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_CONFIG_INVALID,
      "routerOsApiState must be one of: unconfigured, reachable, unreachable, error",
      { field: "routerOsApiState" },
    );
  }
  return value;
}

/**
 * Decide whether a device MAY be mutated at the network layer.
 *
 * Order matters and is fail-closed at every step. This function is the single
 * authority for the Phase 8.5A partner-managed safety rule: YabaLink must never
 * connect to, or attempt to change, a router controlled by a third-party owner.
 */
function assertDeviceControlPermitsMutation(device, options = {}) {
  if (!device || typeof device !== "object") {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_DEVICE_NOT_FOUND,
      "A device record is required for MikroTik router control",
      { reason: "device_missing" },
    );
  }

  const networkControl = normalizeNetworkControl(device.networkControl);

  if (networkControl === NETWORK_CONTROL_MODES.PARTNER_MANAGED) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
      "Router control is refused: this network is partner-managed",
      { networkControl, reason: "partner_managed" },
    );
  }

  if (networkControl !== NETWORK_CONTROL_MODES.YABALINK_MANAGED) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
      "Router control is refused: networkControl must be yabalink_managed",
      { networkControl, reason: "not_yabalink_managed" },
    );
  }

  if (device.routerOsApiEnabled !== true) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_API_DISABLED,
      "Router control is refused: routerOsApiEnabled is not true for this device",
      { reason: "device_kill_switch" },
    );
  }

  // Global flag is checked last so that the device-level reason is reported
  // first; both are required and both default to refusing.
  assertMikrotikApiEnabled(options);

  return {
    allowed: true,
    networkControl,
    routerOsApiPort:
      typeof device.routerOsApiPort === "number"
        ? device.routerOsApiPort
        : DEFAULT_ROUTER_OS_API_PORT,
  };
}

/**
 * Read-only reachability check gate. Deliberately NOT gated on
 * routerOsApiEnabled, because an operator must be able to diagnose why a
 * device cannot be controlled. It IS still gated on the global flag and on
 * yabalink_managed, and it performs no mutation.
 */
function assertDeviceControlPermitsHealthCheck(device, options = {}) {
  if (!device || typeof device !== "object") {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_DEVICE_NOT_FOUND,
      "A device record is required for MikroTik router control",
      { reason: "device_missing" },
    );
  }
  const networkControl = normalizeNetworkControl(device.networkControl);
  if (networkControl === NETWORK_CONTROL_MODES.PARTNER_MANAGED) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
      "Router health check is refused: this network is partner-managed",
      { networkControl, reason: "partner_managed" },
    );
  }
  if (networkControl !== NETWORK_CONTROL_MODES.YABALINK_MANAGED) {
    throw mikrotikError(
      MIKROTIK_ERROR_CODES.MIKROTIK_NETWORK_CONTROL_FORBIDDEN,
      "Router health check requires networkControl=yabalink_managed",
      { networkControl, reason: "not_yabalink_managed" },
    );
  }
  assertMikrotikApiEnabled(options);
  return {
    allowed: true,
    networkControl,
    routerOsApiPort:
      typeof device.routerOsApiPort === "number"
        ? device.routerOsApiPort
        : DEFAULT_ROUTER_OS_API_PORT,
  };
}

module.exports = {
  MIKROTIK_API_ENABLED_ENV_VAR,
  MIKROTIK_API_ENABLED_DEFAULT,
  NETWORK_CONTROL_MODES,
  NETWORK_CONTROL_VALUES,
  ROUTER_OS_API_STATES,
  ROUTER_OS_API_STATE_VALUES,
  DEFAULT_ROUTER_OS_API_PORT,
  isMikrotikApiEnabled,
  isTestModeAllowed,
  assertMikrotikApiEnabled,
  normalizeNetworkControl,
  normalizeRouterOsApiState,
  assertDeviceControlPermitsMutation,
  assertDeviceControlPermitsHealthCheck,
};