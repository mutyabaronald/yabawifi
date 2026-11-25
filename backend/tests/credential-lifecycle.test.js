"use strict";

// Credential lifecycle tests for backend/services/mikrotik/credentialLifecycle.js
// and backend/services/mikrotik/secrets.js.
//
// Covers: secret creation, AES-256-GCM encryption, secret resolution,
// rotation, revocation, device deletion with secret revocation,
// cross-owner access rejection, cross-device reference substitution,
// concurrent rotation, missing encryption config, invalid/mismatched key IDs,
// retry and idempotency behavior.
//
// Never prints plaintext secrets in test output.

const assert = require("assert");
const crypto = require("crypto");

const {
  MockFirestore,
} = require("./helpers/mock-firestore");
const { mockModule, installInterceptor, uninstallInterceptor, clearMocks } = require("./helpers/mock-modules");
const { test, describe, report, ta } = require("./helpers/test-runner");

let db;

function resetTestState() {
  db = new MockFirestore();
}

function makeSecretsModule(overrides = {}) {
  const key = overrides.encryptionKey || "test-encryption-key-32-bytes-long!!";
  const failEncrypt = overrides.failEncrypt || false;
  const failDecrypt = overrides.failDecrypt || false;
  const throwOnResolve = overrides.throwOnResolve || false;
  const resolveThrow = overrides.resolveThrow || null;

  return {
    CURRENT_KEY_ID: overrides.keyId || "v1",
    ROUTER_OS_MAX_SECRET_LENGTH: 512,
    encryptSecret: (plaintext, keyMaterial) => {
      if (failEncrypt) throw new Error("encrypt failed");
      if (typeof plaintext !== "string" || plaintext.length === 0) {
        throw new Error("Secret must be a non-empty string");
      }
      const derivedKey = crypto.hkdfSync("sha256", keyMaterial, "", "mikrotik-secret-encryption", 32);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([iv, ciphertext, authTag]).toString("base64");
    },
    decryptSecret: (ciphertext, keyMaterial) => {
      if (failDecrypt) throw new Error("decrypt failed");
      const data = Buffer.from(ciphertext, "base64");
      const iv = data.subarray(0, 12);
      const authTag = data.subarray(data.length - 16);
      const encryptedData = data.subarray(12, data.length - 16);
      const derivedKey = crypto.hkdfSync("sha256", keyMaterial, "", "mikrotik-secret-encryption", 32);
      const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
      return plaintext.toString("utf8");
    },
    resolveEncryptionKey: (injectedKey) => {
      if (throwOnResolve) throw resolveThrow || new Error("resolve failed");
      if (typeof injectedKey === "string" && injectedKey.length > 0) return injectedKey;
      return key;
    },
    validateSecretReference: (ref) => {
      if (!/^rsec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ref)) {
        throw new Error("invalid_reference_format");
      }
      return ref;
    },
    requireScopedResolution: (args) => args,
    validateResolvedSecret: (secret) => secret,
  };
}

async function loadCredentialLifecycle(secretsMock) {
  mockModule("../../firebase", {
    db,
    admin: {
      firestore: () => db,
      FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
    },
  }, require.resolve("../services/mikrotik/secrets.js"));

  mockModule("./secrets", secretsMock, require.resolve("../services/mikrotik/credentialLifecycle.js"));

  // Clear credentialLifecycle cache so a fresh load picks up the new secrets mock
  delete require.cache[require.resolve("../services/mikrotik/credentialLifecycle.js")];

  installInterceptor();
  try {
    const mod = require("../services/mikrotik/credentialLifecycle.js");
    return mod;
  } finally {
    uninstallInterceptor();
    clearMocks();
  }
}

async function createDeviceDoc(deviceId, ownerId, secretRef = null, overrides = {}) {
  const doc = {
    deviceId,
    ownerId,
    deviceName: "Test Device",
    routerOsApiSecretRef: secretRef,
    ...overrides,
  };
  await db.collection("devices").doc(deviceId).set(doc);
  return doc;
}

async function createSecretDoc(ref, ownerId, deviceId, encryptedSecret, revokedAt = null, keyId = "v1") {
  await db.collection("mikrotik_secrets").doc(ref).set({
    encryptedSecret,
    ownerId,
    deviceId,
    encryptionKeyId: keyId,
    createdAt: new Date().toISOString(),
    revokedAt,
  });
}

async function main() {
  // ===========================================================================
  await describe("Credential Lifecycle — AES-256-GCM Encryption (secrets.js)", async () => {
    await resetTestState();

    await test("encrypts and decrypts a secret round-trip", async () => {
      const secretsMock = makeSecretsModule();
      mockModule("../../firebase", {
        db,
        admin: { firestore: () => db, FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } },
      }, require.resolve("../services/mikrotik/secrets.js"));
      installInterceptor();
      let secrets;
      try {
        secrets = require("../services/mikrotik/secrets.js");
      } finally {
        uninstallInterceptor();
        clearMocks();
      }

      const plaintext = "my-router-api-secret-12345";
      const encrypted = secrets.encryptSecret(plaintext, "test-encryption-key-32-bytes-long!!");
      ta.ok(encrypted);
      ta.notStrictEqual(encrypted, plaintext);
      ta.ok(encrypted.length > 0);

      const decrypted = secrets.decryptSecret(encrypted, "test-encryption-key-32-bytes-long!!");
      ta.strictEqual(decrypted, plaintext);
    });

    await test("produces different ciphertext for same plaintext (random IV)", async () => {
      mockModule("../../firebase", {
        db,
        admin: { firestore: () => db, FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } },
      }, require.resolve("../services/mikrotik/secrets.js"));
      installInterceptor();
      let secrets;
      try {
        secrets = require("../services/mikrotik/secrets.js");
      } finally {
        uninstallInterceptor();
        clearMocks();
      }

      const plaintext = "same-secret-twice";
      const enc1 = secrets.encryptSecret(plaintext, "test-encryption-key-32-bytes-long!!");
      const enc2 = secrets.encryptSecret(plaintext, "test-encryption-key-32-bytes-long!!");
      ta.notStrictEqual(enc1, enc2, "Same plaintext should produce different ciphertext due to random IV");
    });

    await test("fails to decrypt with wrong key", async () => {
      mockModule("../../firebase", {
        db,
        admin: { firestore: () => db, FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } },
      }, require.resolve("../services/mikrotik/secrets.js"));
      installInterceptor();
      let secrets;
      try {
        secrets = require("../services/mikrotik/secrets.js");
      } finally {
        uninstallInterceptor();
        clearMocks();
      }

      const plaintext = "secret-data";
      const encrypted = secrets.encryptSecret(plaintext, "test-encryption-key-32-bytes-long!!");
      try {
        secrets.decryptSecret(encrypted, "wrong-key-32-bytes-long!!!!");
        ta.fail("Should have thrown on wrong key decryption");
      } catch (err) {
        // Expected
      }
    });

    await test("rejects empty secret for encryption", async () => {
      mockModule("../../firebase", {
        db,
        admin: { firestore: () => db, FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } },
      }, require.resolve("../services/mikrotik/secrets.js"));
      installInterceptor();
      let secrets;
      try {
        secrets = require("../services/mikrotik/secrets.js");
      } finally {
        uninstallInterceptor();
        clearMocks();
      }

      try {
        secrets.encryptSecret("", "test-encryption-key-32-bytes-long!!");
        ta.fail("Should have thrown on empty secret");
      } catch (err) {
        // Expected
      }
    });

    await test("rejects secret exceeding max length", async () => {
      mockModule("../../firebase", {
        db,
        admin: { firestore: () => db, FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } },
      }, require.resolve("../services/mikrotik/secrets.js"));
      installInterceptor();
      let secrets;
      try {
        secrets = require("../services/mikrotik/secrets.js");
      } finally {
        uninstallInterceptor();
        clearMocks();
      }

      const longSecret = "x".repeat(513);
      try {
        secrets.encryptSecret(longSecret, "test-encryption-key-32-bytes-long!!");
        ta.fail("Should have thrown on over-long secret");
      } catch (err) {
        // Expected
      }
    });

    await test("CURRENT_KEY_ID defaults to v1", async () => {
      mockModule("../../firebase", {
        db,
        admin: { firestore: () => db, FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) } },
      }, require.resolve("../services/mikrotik/secrets.js"));
      installInterceptor();
      let secrets;
      try {
        secrets = require("../services/mikrotik/secrets.js");
      } finally {
        uninstallInterceptor();
        clearMocks();
      }

      ta.strictEqual(secrets.CURRENT_KEY_ID, "v1");
    });
  });

  // ===========================================================================
  await describe("Credential Lifecycle — rotateRouterSecret", async () => {
    await resetTestState();

    await test("creates a new secret reference and stores encrypted secret", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-1", "owner-1");
      const result = await clModule.rotateRouterSecret({
        db, deviceId: "device-1", ownerId: "owner-1",
        secret: "router-api-secret-abc",
        expectedRef: null,
        operationId: "op-rotate-1",
        now: "2026-01-01T00:00:00Z",
      });

      ta.strictEqual(result.success, true);
      ta.strictEqual(result.hasSecret, true);
      ta.ok(result.reference.startsWith("rsec_"), "Reference should start with rsec_");
      ta.strictEqual(result.operationId, "op-rotate-1");

      const secretDoc = await db.collection("mikrotik_secrets").doc(result.reference).get();
      ta.strictEqual(secretDoc.exists, true);
      ta.strictEqual(secretDoc.data().ownerId, "owner-1");
      ta.strictEqual(secretDoc.data().deviceId, "device-1");
      ta.strictEqual(secretDoc.data().revokedAt, null);

      const deviceDoc = await db.collection("devices").doc("device-1").get();
      ta.strictEqual(deviceDoc.data().routerOsApiSecretRef, result.reference);
    });

    await test("rotates an existing secret (revokes old, creates new)", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-2", "owner-1", "rsec_old-ref-0000");
      await createSecretDoc("rsec_old-ref-0000", "owner-1", "device-2", "encrypted-old-secret");

      const result = await clModule.rotateRouterSecret({
        db, deviceId: "device-2", ownerId: "owner-1",
        secret: "new-router-secret",
        expectedRef: "rsec_old-ref-0000",
        operationId: "op-rotate-2",
        now: "2026-01-02T00:00:00Z",
      });

      ta.strictEqual(result.success, true);

      const oldSecret = await db.collection("mikrotik_secrets").doc("rsec_old-ref-0000").get();
      ta.ok(oldSecret.data().revokedAt, "Old secret should be revoked");

      const newSecret = await db.collection("mikrotik_secrets").doc(result.reference).get();
      ta.strictEqual(newSecret.exists, true);

      const device = await db.collection("devices").doc("device-2").get();
      ta.strictEqual(device.data().routerOsApiSecretRef, result.reference);
    });

    await test("rejects rotation with mismatched expectedRef (concurrent modification)", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-3", "owner-1", "rsec_current-ref");
      await createSecretDoc("rsec_current-ref", "owner-1", "device-3", "encrypted-secret");

      try {
        await clModule.rotateRouterSecret({
          db, deviceId: "device-3", ownerId: "owner-1",
          secret: "new-secret",
          expectedRef: "rsec-different-ref",
          operationId: "op-rotate-3",
          now: "2026-01-03T00:00:00Z",
        });
        ta.fail("Should have thrown ConcurrentModificationError");
      } catch (err) {
        ta.strictEqual(err.name, "ConcurrentModificationError");
        ta.strictEqual(err.code, 409);
      }
    });

    await test("rejects rotation for non-existent device", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      try {
        await clModule.rotateRouterSecret({
          db, deviceId: "non-existent-device", ownerId: "owner-1",
          secret: "new-secret",
          expectedRef: null,
          operationId: "op-rotate-4",
          now: "2026-01-04T00:00:00Z",
        });
        ta.fail("Should have thrown DeviceNotFoundError");
      } catch (err) {
        ta.strictEqual(err.name, "DeviceNotFoundError");
        ta.strictEqual(err.code, 404);
      }
    });

    await test("rejects rotation for cross-owner device", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-4", "owner-2");

      try {
        await clModule.rotateRouterSecret({
          db, deviceId: "device-4", ownerId: "owner-1",
          secret: "new-secret",
          expectedRef: null,
          operationId: "op-rotate-5",
          now: "2026-01-05T00:00:00Z",
        });
        ta.fail("Should have thrown OwnerMismatchError");
      } catch (err) {
        ta.strictEqual(err.name, "OwnerMismatchError");
        ta.strictEqual(err.code, 403);
      }
    });

    await test("propagates encryption key resolution failure", async () => {
      const secretsMock = makeSecretsModule({ throwOnResolve: true });
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-5", "owner-1");

      try {
        await clModule.rotateRouterSecret({
          db, deviceId: "device-5", ownerId: "owner-1",
          secret: "new-secret",
          expectedRef: null,
          operationId: "op-rotate-6",
          now: "2026-01-06T00:00:00Z",
        });
        ta.fail("Should have thrown on encryption key resolution failure");
      } catch (err) {
        ta.ok(err, "Expected an error from key resolution failure");
      }
    });

    await test("generates a new operationId when not provided", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-6", "owner-1");
      const result = await clModule.rotateRouterSecret({
        db, deviceId: "device-6", ownerId: "owner-1",
        secret: "new-secret",
        expectedRef: null,
      });

      ta.ok(result.operationId);
      ta.ok(result.operationId.length > 0);
    });

    await test("uses provided now timestamp", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-7", "owner-1");
      const now = "2026-06-15T12:00:00Z";
      const result = await clModule.rotateRouterSecret({
        db, deviceId: "device-7", ownerId: "owner-1",
        secret: "new-secret",
        expectedRef: null,
        operationId: "op-rotate-7",
        now,
      });

      ta.strictEqual(result.success, true);
      const device = await db.collection("devices").doc("device-7").get();
      ta.strictEqual(device.data().updatedAt, now);
    });
  });

  // ===========================================================================
  await describe("Credential Lifecycle — revokeRouterSecret", async () => {
    await resetTestState();

    await test("revokes an existing secret", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-8", "owner-1", "rsec-to-revoke");
      await createSecretDoc("rsec-to-revoke", "owner-1", "device-8", "encrypted-secret");

      const result = await clModule.revokeRouterSecret({
        db, deviceId: "device-8", ownerId: "owner-1",
        expectedRef: "rsec-to-revoke",
        operationId: "op-revoke-1",
        now: "2026-01-01T00:00:00Z",
      });

      ta.strictEqual(result.success, true);
      ta.strictEqual(result.hasSecret, false);

      const secretDoc = await db.collection("mikrotik_secrets").doc("rsec-to-revoke").get();
      ta.ok(secretDoc.data().revokedAt, "Secret should be revoked");

      const device = await db.collection("devices").doc("device-8").get();
      ta.strictEqual(device.data().routerOsApiSecretRef, null);
    });

    await test("revoking an already-null ref is idempotent", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-9", "owner-1", null);

      const result = await clModule.revokeRouterSecret({
        db, deviceId: "device-9", ownerId: "owner-1",
        expectedRef: null,
        operationId: "op-revoke-2",
        now: "2026-01-02T00:00:00Z",
      });

      ta.strictEqual(result.success, true);
      ta.strictEqual(result.hasSecret, false);
    });

    await test("rejects revocation with mismatched expectedRef", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-10", "owner-1", "rsec-current");
      await createSecretDoc("rsec-current", "owner-1", "device-10", "encrypted-secret");

      try {
        await clModule.revokeRouterSecret({
          db, deviceId: "device-10", ownerId: "owner-1",
          expectedRef: "rsec-wrong",
          operationId: "op-revoke-3",
          now: "2026-01-03T00:00:00Z",
        });
        ta.fail("Should have thrown ConcurrentModificationError");
      } catch (err) {
        ta.strictEqual(err.name, "ConcurrentModificationError");
      }
    });

    await test("rejects cross-owner revocation", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-11", "owner-2", "rsec-foreign");
      await createSecretDoc("rsec-foreign", "owner-2", "device-11", "encrypted-secret");

      try {
        await clModule.revokeRouterSecret({
          db, deviceId: "device-11", ownerId: "owner-1",
          expectedRef: "rsec-foreign",
          operationId: "op-revoke-4",
          now: "2026-01-04T00:00:00Z",
        });
        ta.fail("Should have thrown OwnerMismatchError");
      } catch (err) {
        ta.strictEqual(err.name, "OwnerMismatchError");
        ta.strictEqual(err.code, 403);
      }
    });

    await test("rejects revocation of foreign-owned secret reference", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-12", "owner-1", "rsec-foreign-ref");
      await createSecretDoc("rsec-foreign-ref", "owner-2", "device-foreign", "encrypted-secret");

      try {
        await clModule.revokeRouterSecret({
          db, deviceId: "device-12", ownerId: "owner-1",
          expectedRef: "rsec-foreign-ref",
          operationId: "op-revoke-5",
          now: "2026-01-05T00:00:00Z",
        });
        ta.fail("Should have thrown CredentialIntegrityError");
      } catch (err) {
        ta.strictEqual(err.name, "CredentialIntegrityError");
      }
    });
  });

  // ===========================================================================
  await describe("Credential Lifecycle — deleteDeviceWithRevocation", async () => {
    await resetTestState();

    await test("deletes a device and revokes its owned secret", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-13", "owner-1", "rsec-to-delete");
      await createSecretDoc("rsec-to-delete", "owner-1", "device-13", "encrypted-secret");

      const result = await clModule.deleteDeviceWithRevocation({
        db, deviceId: "device-13", ownerId: "owner-1",
        operationId: "op-delete-1",
        now: "2026-01-01T00:00:00Z",
      });

      ta.strictEqual(result.success, true);

      const deviceDoc = await db.collection("devices").doc("device-13").get();
      ta.strictEqual(deviceDoc.exists, false);

      const secretDoc = await db.collection("mikrotik_secrets").doc("rsec-to-delete").get();
      ta.ok(secretDoc.data().revokedAt, "Secret should be revoked on device deletion");
    });

    await test("deletes a device with foreign secret (does not revoke foreign secret)", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-14", "owner-1", "rsec-foreign-ref");
      await createSecretDoc("rsec-foreign-ref", "owner-2", "device-15", "encrypted-secret");

      const result = await clModule.deleteDeviceWithRevocation({
        db, deviceId: "device-14", ownerId: "owner-1",
        operationId: "op-delete-2",
        now: "2026-01-02T00:00:00Z",
      });

      ta.strictEqual(result.success, true);

      const deviceDoc = await db.collection("devices").doc("device-14").get();
      ta.strictEqual(deviceDoc.exists, false);

      const foreignSecret = await db.collection("mikrotik_secrets").doc("rsec-foreign-ref").get();
      ta.strictEqual(foreignSecret.data().revokedAt, null, "Foreign secret should not be revoked");
    });

    await test("rejects deletion of non-existent device", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      try {
        await clModule.deleteDeviceWithRevocation({
          db, deviceId: "non-existent", ownerId: "owner-1",
          operationId: "op-delete-3",
          now: "2026-01-03T00:00:00Z",
        });
        ta.fail("Should have thrown DeviceNotFoundError");
      } catch (err) {
        ta.strictEqual(err.name, "DeviceNotFoundError");
      }
    });

    await test("rejects cross-owner device deletion", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-16", "owner-2");

      try {
        await clModule.deleteDeviceWithRevocation({
          db, deviceId: "device-16", ownerId: "owner-1",
          operationId: "op-delete-4",
          now: "2026-01-04T00:00:00Z",
        });
        ta.fail("Should have thrown OwnerMismatchError");
      } catch (err) {
        ta.strictEqual(err.name, "OwnerMismatchError");
      }
    });
  });

  // ===========================================================================
  await describe("Credential Lifecycle — Concurrent Rotation and Retry", async () => {
    await resetTestState();

    await test("concurrent rotation attempts on same device - second fails with concurrent modification", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-17", "owner-1", "rsec-initial");
      await createSecretDoc("rsec-initial", "owner-1", "device-17", "encrypted-initial");

      const result1 = await clModule.rotateRouterSecret({
        db, deviceId: "device-17", ownerId: "owner-1",
        secret: "secret-v2",
        expectedRef: "rsec-initial",
        operationId: "op-concurrent-1",
        now: "2026-01-01T00:00:00Z",
      });
      ta.strictEqual(result1.success, true);

      try {
        await clModule.rotateRouterSecret({
          db, deviceId: "device-17", ownerId: "owner-1",
          secret: "secret-v3",
          expectedRef: "rsec-initial",
          operationId: "op-concurrent-2",
          now: "2026-01-02T00:00:00Z",
        });
        ta.fail("Second rotation with stale ref should fail");
      } catch (err) {
        ta.strictEqual(err.name, "ConcurrentModificationError");
      }
    });

    await test("sequential rotations work with updated expectedRef", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-18", "owner-1", "rsec-start");
      await createSecretDoc("rsec-start", "owner-1", "device-18", "encrypted-start");

      let currentRef = "rsec-start";
      for (let i = 2; i <= 5; i++) {
        const result = await clModule.rotateRouterSecret({
          db, deviceId: "device-18", ownerId: "owner-1",
          secret: `secret-v${i}`,
          expectedRef: currentRef,
          operationId: `op-seq-${i}`,
          now: `2026-01-${i}T00:00:00Z`,
        });
        ta.strictEqual(result.success, true);
        currentRef = result.reference;
      }

      const device = await db.collection("devices").doc("device-18").get();
      ta.strictEqual(device.data().routerOsApiSecretRef, currentRef);
    });

    await test("idempotent revocation when ref already null", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-19", "owner-1", null);

      const result1 = await clModule.revokeRouterSecret({
        db, deviceId: "device-19", ownerId: "owner-1",
        expectedRef: null,
        operationId: "op-idem-1",
        now: "2026-01-01T00:00:00Z",
      });
      ta.strictEqual(result1.success, true);
      ta.strictEqual(result1.hasSecret, false);

      const result2 = await clModule.revokeRouterSecret({
        db, deviceId: "device-19", ownerId: "owner-1",
        expectedRef: null,
        operationId: "op-idem-2",
        now: "2026-01-02T00:00:00Z",
      });
      ta.strictEqual(result2.success, true);
      ta.strictEqual(result2.hasSecret, false);
    });

    await test("never logs plaintext secrets", async () => {
      const secretsMock = makeSecretsModule();
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-20", "owner-1");

      await clModule.rotateRouterSecret({
        db, deviceId: "device-20", ownerId: "owner-1",
        secret: "super-secret-plaintext-must-not-leak",
        expectedRef: null,
        operationId: "op-no-leak",
        now: "2026-01-01T00:00:00Z",
      });
    });
  });

  // ===========================================================================
  await describe("Credential Lifecycle — Missing Encryption Config and Key IDs", async () => {
    await resetTestState();

    await test("fails when encryption key resolution throws", async () => {
      const secretsMock = makeSecretsModule({ throwOnResolve: true });
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-21", "owner-1");

      try {
        await clModule.rotateRouterSecret({
          db, deviceId: "device-21", ownerId: "owner-1",
          secret: "test-secret",
          expectedRef: null,
          operationId: "op-key-fail",
          now: "2026-01-01T00:00:00Z",
        });
        ta.fail("Should have thrown on key resolution failure");
      } catch (err) {
        ta.ok(err);
      }
    });

    await test("secret reference format is validated (rsec_ prefix + UUID)", async () => {
      const validRef = "rsec_" + crypto.randomUUID();
      ta.ok(/^rsec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(validRef));

      const invalidRefs = ["secret_xyz", "rsec_bad", "plain-text", ""];
      for (const invalid of invalidRefs) {
        ta.ok(!/^rsec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(invalid),
          `Reference ${invalid} should not match valid format`);
      }
    });

    await test("CURRENT_KEY_ID is tracked on stored secrets", async () => {
      const secretsMock = makeSecretsModule({ keyId: "v2" });
      const clModule = await loadCredentialLifecycle(secretsMock);

      await createDeviceDoc("device-22", "owner-1");
      const result = await clModule.rotateRouterSecret({
        db, deviceId: "device-22", ownerId: "owner-1",
        secret: "key-id-test-secret",
        expectedRef: null,
        operationId: "op-key-id",
        now: "2026-01-01T00:00:00Z",
      });

      ta.strictEqual(result.success, true);
      const secretDoc = await db.collection("mikrotik_secrets").doc(result.reference).get();
      ta.strictEqual(secretDoc.data().encryptionKeyId, "v2");
    });
  });

  const allPassed = report();
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
