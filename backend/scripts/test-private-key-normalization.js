/**
 * Test suite for private key normalization (firebase.js)
 * Run: node backend/scripts/test-private-key-normalization.js
 */

const crypto = require("crypto");

// Copy of the normalizePrivateKey function for testing
function normalizePrivateKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") {
    throw new Error("FIREBASE_PRIVATE_KEY is missing or not a string");
  }

  // Remove surrounding quotes if present
  let key = rawKey.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }

  // Replace escaped newline sequences (\n) with actual newlines
  key = key.replace(/\\n/g, "\n");

  // Normalize Windows line endings
  key = key.replace(/\r\n/g, "\n");

  // Trim whitespace again after replacements
  key = key.trim();

  // Validate PEM structure
  const beginMarker = "-----BEGIN PRIVATE KEY-----";
  const endMarker = "-----END PRIVATE KEY-----";

  if (!key.includes(beginMarker) || !key.includes(endMarker)) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY does not appear to be a valid PEM private key. " +
      "Expected '-----BEGIN PRIVATE KEY-----' and '-----END PRIVATE KEY-----' boundaries."
    );
  }

  // Ensure proper line breaks around markers for OpenSSL compatibility
  key = key
    .replace(new RegExp(beginMarker.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&") + "\\s*"), beginMarker + "\n")
    .replace(new RegExp("\\s*" + endMarker.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")), "\n" + endMarker);

  // Ensure the key body has line breaks (OpenSSL expects max 64 chars per line)
  const beginIndex = key.indexOf(beginMarker);
  const endIndex = key.indexOf(endMarker);
  const header = key.substring(0, beginIndex + beginMarker.length);
  const footer = key.substring(endIndex);
  let body = key.substring(beginIndex + beginMarker.length, endIndex).trim();

  // If body doesn't have newlines, it might be a single-line base64 string
  // Re-wrap to 64 chars per line for OpenSSL compatibility
  if (!body.includes("\n") && body.length > 0) {
    const wrapped = body.match(/.{1,64}/g);
    if (wrapped) {
      body = "\n" + wrapped.join("\n") + "\n";
    }
  } else if (body.includes("\n")) {
    // Ensure body starts and ends with newline
    body = "\n" + body.trim() + "\n";
  }

  return header + body + footer;
}

// Generate a valid test private key (PKCS#8 format)
function generateTestPrivateKey() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  return privateKey;
}

function runTests() {
  console.log("=== Private Key Normalization Tests ===\n")
  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  function assertThrows(fn, testName) {
    try {
      fn();
      console.log(`❌ FAIL: ${testName} (expected throw)`);
      failed++;
    } catch (e) {
      console.log(`✅ PASS: ${testName} - ${e.message}`);
      passed++;
    }
  }

  const validKey = generateTestPrivateKey();

  // Test 1: Valid PEM with actual newlines (already correct)
  try {
    const result = normalizePrivateKey(validKey);
    assert(result.includes("-----BEGIN PRIVATE KEY-----"), "Valid key: has begin marker");
    assert(result.includes("-----END PRIVATE KEY-----"), "Valid key: has end marker");
    assert(result.split("\n").length > 2, "Valid key: has multiple lines");
    console.log("✅ PASS: Valid PEM with actual newlines");
    passed++;
  } catch (e) {
    console.log("❌ FAIL: Valid PEM with actual newlines -", e.message);
    failed++;
  }

  // Test 2: Valid PEM with escaped \n sequences
  const escapedKey = validKey.replace(/\n/g, "\\n");
  try {
    const result = normalizePrivateKey(escapedKey);
    assert(result.includes("-----BEGIN PRIVATE KEY-----"), "Escaped key: has begin marker");
    assert(result.includes("-----END PRIVATE KEY-----"), "Escaped key: has end marker");
    assert(result.split("\n").length > 2, "Escaped key: has multiple lines");
    console.log("✅ PASS: Valid PEM with escaped \\n sequences");
    passed++;
  } catch (e) {
    console.log("❌ FAIL: Valid PEM with escaped \\n sequences -", e.message);
    failed++;
  }

  // Test 3: Valid PEM with surrounding double quotes
  const quotedKey = '"' + validKey + '"';
  try {
    const result = normalizePrivateKey(quotedKey);
    assert(result.includes("-----BEGIN PRIVATE KEY-----"), "Quoted key: has begin marker");
    assert(result.includes("-----END PRIVATE KEY-----"), "Quoted key: has end marker");
    console.log("✅ PASS: Valid PEM with surrounding double quotes");
    passed++;
  } catch (e) {
    console.log("❌ FAIL: Valid PEM with surrounding double quotes -", e.message);
    failed++;
  }

  // Test 4: Valid PEM with surrounding single quotes
  const singleQuotedKey = "'" + validKey + "'";
  try {
    const result = normalizePrivateKey(singleQuotedKey);
    assert(result.includes("-----BEGIN PRIVATE KEY-----"), "Single-quoted key: has begin marker");
    assert(result.includes("-----END PRIVATE KEY-----"), "Single-quoted key: has end marker");
    console.log("✅ PASS: Valid PEM with surrounding single quotes");
    passed++;
  } catch (e) {
    console.log("❌ FAIL: Valid PEM with surrounding single quotes -", e.message);
    failed++;
  }

  // Test 5: Valid PEM with Windows \r\n line endings
  const windowsKey = validKey.replace(/\n/g, "\r\n");
  try {
    const result = normalizePrivateKey(windowsKey);
    assert(result.includes("-----BEGIN PRIVATE KEY-----"), "Windows key: has begin marker");
    assert(result.includes("-----END PRIVATE KEY-----"), "Windows key: has end marker");
    console.log("✅ PASS: Valid PEM with Windows \\r\\n line endings");
    passed++;
  } catch (e) {
    console.log("❌ FAIL: Valid PEM with Windows \\r\\n line endings -", e.message);
    failed++;
  }

  // Test 6: Valid PEM with no body line breaks (single-line base64)
  const header = "-----BEGIN PRIVATE KEY-----";
  const footer = "-----END PRIVATE KEY-----";
  const body = validKey.substring(header.length, validKey.indexOf(footer)).replace(/\n/g, "").trim();
  const singleLineKey = header + body + footer;
  try {
    const result = normalizePrivateKey(singleLineKey);
    assert(result.includes("-----BEGIN PRIVATE KEY-----"), "Single-line key: has begin marker");
    assert(result.includes("-----END PRIVATE KEY-----"), "Single-line key: has end marker");
    assert(result.split("\n").length > 2, "Single-line key: body re-wrapped to multiple lines");
    console.log("✅ PASS: Valid PEM with single-line body (re-wrapped)");
    passed++;
  } catch (e) {
    console.log("❌ FAIL: Valid PEM with single-line body -", e.message);
    failed++;
  }

  // Test 7: Missing private key
  assertThrows(
    () => normalizePrivateKey(""),
    "Missing private key throws error"
  );

  // Test 8: Missing private key (null)
  assertThrows(
    () => normalizePrivateKey(null),
    "Null private key throws error"
  );

  // Test 9: Missing private key (undefined)
  assertThrows(
    () => normalizePrivateKey(undefined),
    "Undefined private key throws error"
  );

  // Test 10: Malformed PEM - missing begin marker
  assertThrows(
    () => normalizePrivateKey("-----END PRIVATE KEY-----\ninvalid"),
    "Missing begin marker throws error"
  );

  // Test 11: Malformed PEM - missing end marker
  assertThrows(
    () => normalizePrivateKey("-----BEGIN PRIVATE KEY-----\ninvalid"),
    "Missing end marker throws error"
  );

  // Test 12: Malformed PEM - completely invalid
  assertThrows(
    () => normalizePrivateKey("not a private key at all"),
    "Completely invalid key throws error"
  );

  // Test 13: Key with extra whitespace
  const whitespaceKey = "  \n  " + validKey + "  \n  ";
  try {
    const result = normalizePrivateKey(whitespaceKey);
    assert(result.includes("-----BEGIN PRIVATE KEY-----"), "Whitespace key: has begin marker");
    assert(result.includes("-----END PRIVATE KEY-----"), "Whitespace key: has end marker");
    console.log("✅ PASS: Valid PEM with extra whitespace");
    passed++;
  } catch (e) {
    console.log("❌ FAIL: Valid PEM with extra whitespace -", e.message);
    failed++;
  }

  // Test 14: Key with escaped newlines AND quotes
  const escapedQuotedKey = '"' + escapedKey + '"';
  try {
    const result = normalizePrivateKey(escapedQuotedKey);
    assert(result.includes("-----BEGIN PRIVATE KEY-----"), "Escaped+quoted key: has begin marker");
    assert(result.includes("-----END PRIVATE KEY-----"), "Escaped+quoted key: has end marker");
    console.log("✅ PASS: Valid PEM with escaped \\n and quotes");
    passed++;
  } catch (e) {
    console.log("❌ FAIL: Valid PEM with escaped \\n and quotes -", e.message);
    failed++;
  }

  // Test 15: Verify normalized key can be used by crypto (basic validation)
  try {
    const result = normalizePrivateKey(validKey);
    // Try to create a sign object with the normalized key
    const sign = crypto.createSign("RSA-SHA256");
    sign.update("test data");
    sign.sign(result); // This will throw if key is invalid
    console.log("✅ PASS: Normalized key works with crypto.sign()");
    passed++;
  } catch (e) {
    console.log("❌ FAIL: Normalized key works with crypto.sign() -", e.message);
    failed++;
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();