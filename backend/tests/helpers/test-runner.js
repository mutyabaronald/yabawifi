"use strict";

// Test result tracking and assertion helpers for device tests.
// No external test framework required.

const assert = require("assert");

const RESULTS = {
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: [],
};

function test(name, fn) {
  const result = fn();
  if (result && typeof result.then === "function") {
    return result.then(() => {
      RESULTS.passed++;
      process.stdout.write(`  ✓ ${name}\n`);
    }).catch((err) => {
      RESULTS.failed++;
      RESULTS.errors.push({ name, error: err });
      process.stdout.write(`  ✗ ${name}: ${err.message}\n`);
    });
  }
  try {
    RESULTS.passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    RESULTS.failed++;
    RESULTS.errors.push({ name, error: err });
    process.stdout.write(`  ✗ ${name}: ${err.message}\n`);
  }
  return null;
}

function skip(name) {
  RESULTS.skipped++;
  process.stdout.write(`  - ${name} (skipped)\n`);
}

async function describe(name, fn) {
  process.stdout.write(`\n${name}\n`);
  await fn();
}

function report() {
  process.stdout.write(`\n========================================\n`);
  process.stdout.write(`Results: ${RESULTS.passed} passed, ${RESULTS.failed} failed, ${RESULTS.skipped} skipped\n`);
  if (RESULTS.errors.length > 0) {
    process.stdout.write(`\nFailures:\n`);
    for (const e of RESULTS.errors) {
      process.stdout.write(`  - ${e.name}: ${e.error.message}\n`);
      if (e.error.stack) {
        process.stdout.write(`    ${e.error.stack.split("\n").slice(0, 3).join("\n    ")}\n`);
      }
    }
  }
  process.stdout.write(`========================================\n`);
  return RESULTS.failed === 0;
}

module.exports = { test, skip, describe, report, assert, ta: assert };
