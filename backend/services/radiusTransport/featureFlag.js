const { radiusError, RADIUS_ERROR_CODES } = require("./errors");

const RADIUS_ENABLED_ENV_VAR = "ROAMING_RADIUS_ENABLED";
const RADIUS_ENABLED_DEFAULT = false;

function isRadiusTransportEnabled() {
  return (
    String(process.env[RADIUS_ENABLED_ENV_VAR] || "false").toLowerCase() === "true"
  );
}

function isTestModeAllowed() {
  return process.env.NODE_ENV !== "production";
}

function assertRadiusTransportEnabled(options = {}) {
  if (isRadiusTransportEnabled()) {
    return { enabled: true, mode: "production_flag" };
  }
  if (options.testMode === true && isTestModeAllowed()) {
    return { enabled: true, mode: "explicit_test_mode" };
  }
  throw radiusError(
    RADIUS_ERROR_CODES.RADIUS_DISABLED,
    `RADIUS transport is disabled. Set ${RADIUS_ENABLED_ENV_VAR}=true to enable.`,
    { envVar: RADIUS_ENABLED_ENV_VAR, defaultEnabled: RADIUS_ENABLED_DEFAULT },
  );
}

module.exports = {
  RADIUS_ENABLED_ENV_VAR,
  RADIUS_ENABLED_DEFAULT,
  isRadiusTransportEnabled,
  isTestModeAllowed,
  assertRadiusTransportEnabled,
};