/**
 * Super-admin JWT secret production guard verification.
 *
 * Run from the repository root:  node backend/scripts/check-superadmin-secret-guard.js
 *
 * Verifies that roamingRegistryService.js fails closed in production when
 * SUPERADMIN_JWT_SECRET is missing or equals the dev default, and loads
 * successfully with a valid secret.
 *
 * Uses isolated child processes so the test runner's module state is not
 * contaminated by production-mode module initialization failures.
 */

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const SERVICE_REL = "services/roamingRegistryService.js";

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

// Helper: run a Node script in a child process with given env vars
function runChild(env, script) {
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: BACKEND,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 15000,
  });
  return result;
}

// Script that attempts to load roamingRegistryService and report success
const loadScript = `
  try {
    const reg = require("./${SERVICE_REL}");
    // Verify it exports the auth functions
    if (typeof reg.authenticateSuperAdmin === "function" &&
        typeof reg.authenticateOwner === "function" &&
        typeof reg.authenticateOwnerOrSuper === "function") {
      console.log("LOADED_OK");
      process.exit(0);
    } else {
      console.log("LOADED_BUT_MISSING_EXPORTS");
      process.exit(1);
    }
  } catch (err) {
    console.log("LOAD_FAILED:" + err.message);
    process.exit(1);
  }
`;

// Script that loads the service and verifies JWT verification works with a test secret
const jwtVerifyScript = (secret) => `
  const Module = require("module");
  const origRequire = Module.prototype.require;
  Module.prototype.require = function(id) {
    if (id === "../firebase" || id === "./firebase" || id.endsWith("firebase.js")) {
      return { db: {}, admin: {} };
    }
    return origRequire.apply(this, arguments);
  };
  process.env.SUPERADMIN_JWT_SECRET = "${secret}";
  const jwt = require("jsonwebtoken");
  const reg = require("./services/roamingRegistryService.js");
  const token = jwt.sign({ role: "superadmin", sub: "admin@test" }, "${secret}");
  try {
    const auth = reg.authenticateSuperAdmin({ headers: { authorization: "Bearer " + token } });
    if (auth.email === "admin@test" && auth.actor === "superadmin:admin@test") {
      console.log("JWT_VERIFY_OK");
      process.exit(0);
    } else {
      console.log("JWT_VERIFY_BAD_SHAPE:" + JSON.stringify(auth));
      process.exit(1);
    }
  } catch (err) {
    console.log("JWT_VERIFY_FAILED:" + err.message);
    process.exit(1);
  }
`;

console.log("=== Super-admin secret production guard tests ===\n");

// 1. Production, missing secret → fail closed
{
  const r = runChild(
    { NODE_ENV: "production" },
    // Remove SUPERADMIN_JWT_SECRET entirely
    `delete process.env.SUPERADMIN_JWT_SECRET; ${loadScript.replace("try {", "try {")}`
  );
  // Need to actually delete it — use a modified script
  const deleteScript = `
    delete process.env.SUPERADMIN_JWT_SECRET;
    try {
      const reg = require("./${SERVICE_REL}");
      console.log("LOADED_OK_UNEXPECTEDLY");
      process.exit(0);
    } catch (err) {
      console.log("LOAD_FAILED:" + err.message);
      process.exit(1);
    }
  `;
  const r2 = runChild({ NODE_ENV: "production" }, deleteScript);
  const failedClosed = r2.status !== 0 && /LOAD_FAILED/.test(r2.stdout);
  assert(failedClosed, "1. Production + missing secret → fail closed (module fails to load)");
  if (!failedClosed) {
    console.error("   stdout:", r2.stdout);
    console.error("   stderr:", r2.stderr);
    console.error("   status:", r2.status);
  }
}

// 2. Production, dev-super-secret → fail closed
{
  const devSecretScript = `
    process.env.SUPERADMIN_JWT_SECRET = "dev-super-secret";
    try {
      const reg = require("./${SERVICE_REL}");
      console.log("LOADED_OK_UNEXPECTEDLY");
      process.exit(0);
    } catch (err) {
      console.log("LOAD_FAILED:" + err.message);
      process.exit(1);
    }
  `;
  const r = runChild({ NODE_ENV: "production" }, devSecretScript);
  const failedClosed = r.status !== 0 && /LOAD_FAILED/.test(r.stdout);
  assert(failedClosed, "2. Production + dev-super-secret → fail closed (module fails to load)");
  if (!failedClosed) {
    console.error("   stdout:", r.stdout);
    console.error("   stderr:", r.stderr);
    console.error("   status:", r.status);
  }
}

// 3. Production, valid secret → loads and JWT verification works
{
  const validSecret = "production-test-secret-not-dev";
  const r = runChild(
    { NODE_ENV: "production", SUPERADMIN_JWT_SECRET: validSecret },
    jwtVerifyScript(validSecret)
  );
  const ok = r.status === 0 && /JWT_VERIFY_OK/.test(r.stdout);
  assert(ok, "3. Production + valid secret → module loads and JWT verification works");
  if (!ok) {
    console.error("   stdout:", r.stdout);
    console.error("   stderr:", r.stderr);
    console.error("   status:", r.status);
  }
}

// 4. Development (NODE_ENV unset), configured secret → works
{
  const devSecret = "dev-configured-secret";
  const r = runChild(
    { SUPERADMIN_JWT_SECRET: devSecret },
    jwtVerifyScript(devSecret)
  );
  const ok = r.status === 0 && /JWT_VERIFY_OK/.test(r.stdout);
  assert(ok, "4. Development + configured secret → JWT verification works");
  if (!ok) {
    console.error("   stdout:", r.stdout);
    console.error("   stderr:", r.stderr);
    console.error("   status:", r.status);
  }
}

// 5. Development (NODE_ENV unset), no secret → falls back to dev default (compatibility)
{
  const fallbackScript = `
    const Module = require("module");
    const origRequire = Module.prototype.require;
    Module.prototype.require = function(id) {
      if (id === "../firebase" || id === "./firebase" || id.endsWith("firebase.js")) {
        return { db: {}, admin: {} };
      }
      return origRequire.apply(this, arguments);
    };
    delete process.env.SUPERADMIN_JWT_SECRET;
    const jwt = require("jsonwebtoken");
    const reg = require("./services/roamingRegistryService.js");
    // Should load with dev-super-secret fallback
    const token = jwt.sign({ role: "superadmin", sub: "dev@test" }, "dev-super-secret");
    try {
      const auth = reg.authenticateSuperAdmin({ headers: { authorization: "Bearer " + token } });
      if (auth.email === "dev@test") {
        console.log("DEV_FALLBACK_OK");
        process.exit(0);
      } else {
        console.log("DEV_FALLBACK_BAD_SHAPE:" + JSON.stringify(auth));
        process.exit(1);
      }
    } catch (err) {
      console.log("DEV_FALLBACK_FAILED:" + err.message);
      process.exit(1);
    }
  `;
  const r = runChild({}, fallbackScript);
  const ok = r.status === 0 && /DEV_FALLBACK_OK/.test(r.stdout);
  assert(ok, "5. Development + no secret → falls back to dev default (compatibility)");
  if (!ok) {
    console.error("   stdout:", r.stdout);
    console.error("   stderr:", r.stderr);
    console.error("   status:", r.status);
  }
}

// 6. Production, missing secret → error message is clear (no secret value leaked)
{
  const deleteScript = `
    delete process.env.SUPERADMIN_JWT_SECRET;
    try {
      const reg = require("./${SERVICE_REL}");
      console.log("LOADED_OK_UNEXPECTEDLY");
      process.exit(0);
    } catch (err) {
      console.log("LOAD_FAILED:" + err.message);
      process.exit(1);
    }
  `;
  const r = runChild({ NODE_ENV: "production" }, deleteScript);
  const hasClearMessage = /must be configured in production/i.test(r.stdout);
  assert(hasClearMessage, "6. Production missing secret → clear error message (no secret leaked)");
  if (!hasClearMessage) {
    console.error("   stdout:", r.stdout);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
