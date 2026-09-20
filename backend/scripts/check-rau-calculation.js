/**
 * RAU (Roaming Access Accounting Unit) Calculation — unit tests.
 *
 * Pure, deterministic, offline test harness (no Firestore, no network).
 * Follows the project's existing check-* script convention
 * (backend/scripts/check-roaming-phaseN.js).
 *
 * Run: node backend/scripts/check-rau-calculation.js
 */
const {
  MS_PER_MINUTE,
  RAU_ERROR_CODES,
  RauCalculationError,
  calculateRAUs,
  calculateRAUsFromEntitlementValidity,
} = require("../services/rauCalculationService");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  const ok = Number.isInteger(actual) && actual === expected;
  if (ok) {
    console.log(`✅ PASS: ${message} (${actual === expected && actual})`);
  } else {
    console.error(`❌ FAIL: ${message} — expected ${expected}, got ${actual}`);
    failed++;
  }
  if (ok) passed++;
}

function assertThrows(fn, expectedCode, message) {
  let caught = null;
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    caught = e;
  }
  const ok = threw && caught instanceof RauCalculationError && (!expectedCode || caught.code === expectedCode);
  if (ok) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(
      `❌ FAIL: ${message} — expected RauCalculationError${expectedCode ? `(${expectedCode})` : ""} but got: ` +
        (caught ? `${caught.name}: ${caught.message}` : "no throw")
    );
    failed++;
  }
}

// Helpers for building absolute ISO8601 UTC timestamps.
const EPOCH = new Date("2025-01-01T00:00:00.000Z").getTime();
function isoFromMs(sinceMs) {
  return new Date(EPOCH + sinceMs).toISOString();
}

console.log("=== RAU Calculation Tests ===\n");

// --- Test 1: 1 hour -> 60 RAUs ---
console.log("--- Test 1: 1 hour -> 60 RAUs ---");
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(60 * MS_PER_MINUTE)),
  60,
  "1 hour = 60 RAUs"
);

// --- Test 2: 3 hours -> 180 RAUs ---
console.log("\n--- Test 2: 3 hours -> 180 RAUs ---");
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(3 * 60 * MS_PER_MINUTE)),
  180,
  "3 hours = 180 RAUs"
);

// --- Test 3: 24 hours -> 1,440 RAUs ---
console.log("\n--- Test 3: 24 hours -> 1,440 RAUs ---");
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(24 * 60 * MS_PER_MINUTE)),
  1440,
  "24 hours = 1,440 RAUs"
);

// --- Test 4: 7 days -> 10,080 RAUs ---
console.log("\n--- Test 4: 7 days -> 10,080 RAUs ---");
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(7 * 24 * 60 * MS_PER_MINUTE)),
  10080,
  "7 days = 10,080 RAUs"
);

// --- Test 5: 30 days -> 43,200 RAUs ---
console.log("\n--- Test 5: 30 days -> 43,200 RAUs ---");
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(30 * 24 * 60 * MS_PER_MINUTE)),
  43200,
  "30 days = 43,200 RAUs (derived from actual timestamps, NOT hard-coded)"
);

// --- Test 6: 31 days -> 44,640 RAUs ---
console.log("\n--- Test 6: 31 days -> 44,640 RAUs ---");
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(31 * 24 * 60 * MS_PER_MINUTE)),
  44640,
  "31 days = 44,640 RAUs"
);

// --- Test 7: extra seconds do NOT round upward ---
console.log("\n--- Test 7: extra seconds do not round upward ---");
// 60 minutes + 30 seconds -> must stay 60, not become 61.
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(60 * MS_PER_MINUTE + 30 * 1000)),
  60,
  "60m + 30s = 60 RAUs (seconds truncated)"
);
// Boundary: just under one extra minute must not push to the next whole minute.
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(2 * MS_PER_MINUTE - 1)),
  1,
  "2m - 1ms = 1 RAU (fractional minute discarded)"
);

// --- Test 8: less than one full minute -> 0 RAUs ---
console.log("\n--- Test 8: less than one full minute -> 0 RAUs ---");
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(59 * 1000)),
  0,
  "59 seconds = 0 RAUs (no phantom RAU)"
);
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(1)),
  0,
  "1 ms = 0 RAUs"
);
// Exactly one minute boundary is 1, but 59,999 ms is 0.
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(MS_PER_MINUTE - 1)),
  0,
  "60s - 1ms = 0 RAUs"
);

// --- Test 9: invalid / reversed validity is rejected ---
console.log("\n--- Test 9: invalid / reversed validity is rejected ---");
assertThrows(
  () => calculateRAUs("not-a-valid-date", isoFromMs(MS_PER_MINUTE)),
  RAU_ERROR_CODES.INVALID_START,
  "invalid start time rejected"
);
assertThrows(
  () => calculateRAUs(isoFromMs(0), "definitely-not-a-date"),
  RAU_ERROR_CODES.INVALID_EXPIRATION,
  "invalid expiration time rejected"
);
assertThrows(
  () => calculateRAUs(isoFromMs(60 * MS_PER_MINUTE), isoFromMs(0)),
  RAU_ERROR_CODES.INVALID_ORDER,
  "expiration before start rejected"
);
assertThrows(
  () => calculateRAUs(isoFromMs(0), isoFromMs(0)),
  RAU_ERROR_CODES.INVALID_ORDER,
  "equal start and expiration rejected (zero duration)"
);
assertThrows(
  () => calculateRAUs(undefined, isoFromMs(MS_PER_MINUTE)),
  RAU_ERROR_CODES.INVALID_START,
  "missing validFrom rejected"
);
assertThrows(
  () => calculateRAUs(isoFromMs(0), undefined),
  RAU_ERROR_CODES.INVALID_EXPIRATION,
  "missing expiresAt rejected"
);
assertThrows(
  () => calculateRAUs(null, null),
  RAU_ERROR_CODES.INVALID_START,
  "null inputs rejected"
);

// --- Test 10: determinism ---
console.log("\n--- Test 10: calculation is deterministic ---");
const v1 = isoFromMs(0);
const e1 = isoFromMs(31 * 24 * 60 * MS_PER_MINUTE);
const r1 = calculateRAUs(v1, e1);
const r2 = calculateRAUs(v1, e1);
const r3 = calculateRAUs(new Date(v1), new Date(e1)); // Date instance inputs
const r4 = calculateRAUs(v1, e1);
assert(r1 === r2 && r2 === r3 && r3 === r4, "same inputs always yield identical integer result");
assertEqual(r1, 44640, "deterministic result = 44,640");
assert(Number.isInteger(r1), "result is a true integer");

// --- Entitlement validity adapter reuses authoritative fields ---
console.log("\n--- Adapter: calculateRAUsFromEntitlementValidity ---");
assertEqual(
  calculateRAUsFromEntitlementValidity({
    startsAt: isoFromMs(0),
    expiresAt: isoFromMs(7 * 24 * 60 * MS_PER_MINUTE),
  }),
  10080,
  "validity object (7 days) = 10,080 RAUs"
);
assertThrows(
  () => calculateRAUsFromEntitlementValidity({ startsAt: isoFromMs(0) }),
  RAU_ERROR_CODES.INVALID_EXPIRATION,
  "missing expiresAt in validity object rejected"
);
assertThrows(
  () => calculateRAUsFromEntitlementValidity({ startsAt: "bad", expiresAt: isoFromMs(MS_PER_MINUTE) }),
  RAU_ERROR_CODES.INVALID_START,
  "invalid startsAt in validity object rejected"
);
assertThrows(
  () => calculateRAUsFromEntitlementValidity(null),
  RAU_ERROR_CODES.MISSING_VALIDITY,
  "null validity object rejected"
);

// --- RAU is floor-truncated (never rounded up via Math.round) ---
console.log("\n--- Rounding guard ---");
assertEqual(
  calculateRAUs(isoFromMs(0), isoFromMs(MS_PER_MINUTE + 59999)),
  1,
  "1m 59.999s = 1 RAU (floor, not round)"
);

// --- Summary ---
console.log(`\n========================================`);
console.log(`RAU Results: ${passed} passed, ${failed} failed`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
