/**
 * RAU (Roaming Access Accounting Unit) Calculation Service
 *
 * YabaLink definition: 1 RAU = 1 eligible connected roaming minute.
 * RAUs are an ACCESS ACCOUNTING UNIT. They are NOT cryptocurrency, NOT money,
 * and NOT the YabaLink service fee. The separate 5% service fee must NEVER
 * reduce RAUs. The customer always receives 100% of the eligible roaming
 * minutes represented by the package.
 *
 * The authoritative validity model comes from roamingEntitlementService.js,
 * where each roaming entitlement stores a `validity` object:
 *   validity.startsAt   (ISO8601 string — the "validFrom")
 *   validity.expiresAt  (ISO8601 string — the expiration boundary)
 *
 * RAU allowance is derived from the actual elapsed WHOLE minutes between
 * these two authoritative timestamps. We do NOT hard-code month lengths
 * (e.g. "monthly = 30 days"); we use the real validity window.
 *
 * Pure & deterministic: no Firestore, no network, no date library.
 * Follows the project's existing native Date / ISO8601-string conventions.
 */

// One minute in milliseconds. Integer-only unit for RAU derivation.
// Mirrors the existing receiptRoutes convention: minutes * 60 * 1000.
const MS_PER_MINUTE = 60000;

/**
 * Error codes for RAU calculation failures.
 * Mirrors the project convention of named code strings (e.g.
 * roamingEntitlementService uses "validation_error", "not_found").
 */
const RAU_ERROR_CODES = Object.freeze({
  INVALID_START: "invalid_start",
  INVALID_EXPIRATION: "invalid_expiration",
  INVALID_ORDER: "invalid_order", // expiresAt is not later than validFrom
  MISSING_VALIDITY: "missing_validity",
});

class RauCalculationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "RauCalculationError";
    this.code = code;
    this.status = status;
  }
}

function coerceValidDate(value, code, fieldName) {
  if (value === null || value === undefined || value === "") {
    throw new RauCalculationError(code, `${fieldName} is required`);
  }
  // new Date() accepts ISO8601 strings (the entitlement convention) and
  // Date instances. Invalid input yields an Invalid Date whose getTime() is NaN.
  const d = new Date(value);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new RauCalculationError(code, `${fieldName} must be a valid ISO8601 timestamp`);
  }
  return d;
}

/**
 * Calculate RAUs (eligible whole roaming minutes) from a validity window.
 *
 * Formula: floor((expiresAt - validFrom) / 60000)
 *
 * Boundary behavior (deterministic, no extra RAU from sub-minute parts):
 *   - exactly 60 minutes          -> 60
 *   - exactly 24 hours            -> 1,440
 *   - exactly 7 days              -> 10,080
 *   - exactly 30 days             -> 43,200
 *   - exactly 31 days             -> 44,640
 *   - 59 seconds (< 1 minute)     -> 0   (no RAU granted)
 *   - 60 min + 30 sec (extra sec) -> 60  (seconds discarded, NOT rounded up)
 *   - equal start & expiration    -> rejected (zero duration)
 *   - expiresAt before validFrom  -> rejected (negative duration)
 *   - invalid/unparseable input   -> rejected
 *
 * Fractional minutes are always truncated via Math.floor. Seconds and
 * milliseconds NEVER produce an additional RAU. The result is always an
 * integer; for the magnitudes involved (max ~44,640), integer arithmetic is
 * exactly representable and no floating-point rounding occurs.
 *
 * @param {string|Date} validFrom  ISO8601 start timestamp (== validity.startsAt)
 * @param {string|Date} expiresAt  ISO8601 expiration timestamp (must be > validFrom)
 * @returns {number} integer RAU count (>= 1)
 * @throws {RauCalculationError} on invalid or non-positive validity
 */
function calculateRAUs(validFrom, expiresAt) {
  const start = coerceValidDate(validFrom, RAU_ERROR_CODES.INVALID_START, "validFrom");
  const end = coerceValidDate(expiresAt, RAU_ERROR_CODES.INVALID_EXPIRATION, "expiresAt");

  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) {
    throw new RauCalculationError(
      RAU_ERROR_CODES.INVALID_ORDER,
      "expiresAt must be later than validFrom (zero/negative duration rejected)"
    );
  }

  // Math.floor truncates partial minutes. With positive diffMs this equals
  // truncation toward zero and guarantees an integer result.
  return Math.floor(diffMs / MS_PER_MINUTE);
}

/**
 * Convenience adapter that reads the authoritative roaming entitlement
 * validity object shape ({ startsAt, expiresAt }) from
 * roamingEntitlementService.js, without inventing any new duration fields.
 *
 * @param {{startsAt: string, expiresAt: string}} validity
 * @returns {number} integer RAU count
 * @throws {RauCalculationError} on invalid or non-positive validity
 */
function calculateRAUsFromEntitlementValidity(validity) {
  if (!validity || typeof validity !== "object") {
    throw new RauCalculationError(
      RAU_ERROR_CODES.MISSING_VALIDITY,
      "validity object is required"
    );
  }
  if (!validity.startsAt || typeof validity.startsAt !== "string") {
    throw new RauCalculationError(
      RAU_ERROR_CODES.INVALID_START,
      "validity.startsAt must be an ISO8601 string"
    );
  }
  if (!validity.expiresAt || typeof validity.expiresAt !== "string") {
    throw new RauCalculationError(
      RAU_ERROR_CODES.INVALID_EXPIRATION,
      "validity.expiresAt must be an ISO8601 string"
    );
  }
  return calculateRAUs(validity.startsAt, validity.expiresAt);
}

module.exports = {
  MS_PER_MINUTE,
  RAU_ERROR_CODES,
  RauCalculationError,
  calculateRAUs,
  calculateRAUsFromEntitlementValidity,
};
