"use strict";

// Module mocking utilities for testing without production Firebase.
// Uses Node's require.cache to pre-register mock modules before the
// module under test is loaded.

const Module = require("module");
const path = require("path");

const ORIGINAL_REQUIRE = Module.prototype.require;
const MOCK_REGISTRY = new Map(); // resolvedPath -> mockModuleExports

// Resolve a module id relative to a base file (like require.resolve)
function resolveModule(id, baseFile) {
  try {
    return require.resolve(id, { paths: [path.dirname(baseFile)] });
  } catch (err) {
    // Fallback: resolve from backend root
    try {
      return require.resolve(id);
    } catch (err2) {
      return id;
    }
  }
}

// Register a mock for a module. Call before requiring the module under test.
function mockModule(moduleIdOrPath, mockExports, baseFile) {
  const resolved = baseFile ? resolveModule(moduleIdOrPath, baseFile) : require.resolve(moduleIdOrPath);
  MOCK_REGISTRY.set(resolved, mockExports);
  // Also clear any existing cache entry so the mock is used
  delete require.cache[resolved];
}

// Install the interceptor
function installInterceptor() {
  Module.prototype.require = function (id) {
    const resolved = Module._resolveFilename(id, this);
    if (MOCK_REGISTRY.has(resolved)) {
      return MOCK_REGISTRY.get(resolved);
    }
    return ORIGINAL_REQUIRE.call(this, id);
  };
}

// Uninstall the interceptor
function uninstallInterceptor() {
  Module.prototype.require = ORIGINAL_REQUIRE;
  MOCK_REGISTRY.clear();
}

// Clear all mocks
function clearMocks() {
  MOCK_REGISTRY.clear();
}

// Get the mock exports for a module (useful for asserting calls)
function getMock(moduleIdOrPath, baseFile) {
  const resolved = baseFile ? resolveModule(moduleIdOrPath, baseFile) : require.resolve(moduleIdOrPath);
  return MOCK_REGISTRY.get(resolved);
}

module.exports = {
  mockModule,
  installInterceptor,
  uninstallInterceptor,
  clearMocks,
  getMock,
  ORIGINAL_REQUIRE,
};
