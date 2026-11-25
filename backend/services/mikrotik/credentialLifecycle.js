const crypto = require("crypto");

// We'll define classes here by requiring from self? Instead duplicate is bad. Reuse module.exports at end.
const secrets = require("./secrets");

class _ConcurrentModificationError extends Error { constructor(m="concurrent modification", d={}){super(m);this.name="ConcurrentModificationError";this.code=409;this.details=d;} }
class _CredentialIntegrityError extends Error { constructor(m="credential integrity error", d={}){super(m);this.name="CredentialIntegrityError";this.code=500;this.details=d;} }
class _DeviceNotFoundError extends Error { constructor(m="device not found", d={}){super(m);this.name="DeviceNotFoundError";this.code=404;this.details=d;} }
class _OwnerMismatchError extends Error { constructor(m="owner mismatch", d={}){super(m);this.name="OwnerMismatchError";this.code=403;this.details=d;} }
class _TransactionContentionError extends Error { constructor(m="transaction contention", d={}){super(m);this.name="TransactionContentionError";this.code=503;this.details=d;this.retryable=true;} }
class NotImplementedError extends Error { constructor(n){super(`${n} not implemented`);this.name="NotImplementedError";} }

function isAborted(err){ return err && (err.code === 10 || err.code === "ABORTED" || /aborted/i.test(String(err.message||""))); }

function makeRef(){ return "rsec_" + crypto.randomUUID(); }

function auditEntry({ operationId, ownerId, deviceId, type, meta, now }) {
  return { type, level: "info", message: type, meta: meta || {}, ownerId, deviceId, operationId, createdAt: now, createdAtISO: now };
}

async function runTx(db, fn, hooks) {
  hooks = hooks || {};
  let attempt = 0;
  const max = 3;
  while (true) {
    attempt++;
    if (hooks.onAttempt) hooks.onAttempt(attempt);
    try {
      const res = await db.runTransaction(async (tx) => {
        if (hooks.afterReads) hooks.afterReads(attempt);
        return fn(tx, attempt);
      });
      return res;
    } catch (err) {
      if (isAborted(err) && attempt < max) continue;
      if (isAborted(err)) throw new _TransactionContentionError();
      throw err;
    }
  }
}

async function rotateRouterSecret({ db, deviceId, ownerId, secret, expectedRef, operationId, now, hooks }) {
  if (!operationId) operationId = crypto.randomUUID();
  if (!now) now = new Date().toISOString();
  const newRef = makeRef();
  const key = secrets.resolveEncryptionKey();
  const encryptedSecret = secrets.encryptSecret(secret, key);
  const encryptionKeyId = secrets.CURRENT_KEY_ID;

  let result;
  await runTx(db, async (tx) => {
    const deviceRef = db.collection("devices").doc(deviceId);
    const deviceDoc = await tx.get(deviceRef);
    if (!deviceDoc.exists) throw new _DeviceNotFoundError();
    const device = deviceDoc.data() || {};
    if (device.ownerId && device.ownerId !== ownerId) throw new _OwnerMismatchError();

    const currentRef = (device.routerOsApiSecretRef ?? null);
    const expected = (expectedRef ?? null);
    if (currentRef !== expected) throw new _ConcurrentModificationError();

    // old secret integrity
    const oldRef = currentRef;
    let oldDocData = null;
    let oldExisted = false;
    if (oldRef) {
      const oldDoc = await tx.get(db.collection("mikrotik_secrets").doc(oldRef));
      oldExisted = oldDoc.exists;
      if (oldDoc.exists) {
        oldDocData = oldDoc.data() || {};
        if (oldDocData.ownerId && oldDocData.ownerId !== ownerId) throw new _CredentialIntegrityError();
        if (oldDocData.deviceId && oldDocData.deviceId !== deviceId) throw new _CredentialIntegrityError();
      }
    }

    // write new secret
    const newSecretRef = db.collection("mikrotik_secrets").doc(newRef);
    tx.create(newSecretRef, {
      encryptedSecret,
      ownerId,
      deviceId,
      encryptionKeyId,
      createdAt: now,
      revokedAt: null,
    });

    // update device ref
    tx.update(deviceRef, { routerOsApiSecretRef: newRef, updatedAt: now });

    // revoke old if present & owned (oldDoc already read above)
    if (oldRef && oldExisted && oldDocData) {
      if (oldDocData.ownerId === ownerId && oldDocData.deviceId === deviceId && !oldDocData.revokedAt) {
        tx.update(db.collection("mikrotik_secrets").doc(oldRef), { revokedAt: now });
      }
    }

    // audit
    const auditId = crypto.randomUUID();
    const auditRef = db.collection("devices").doc(deviceId).collection("logs").doc(auditId);
    const missingOld = !!oldRef && !oldExisted;
    tx.create(auditRef, auditEntry({ operationId, ownerId, deviceId, type: "router_secret_stored", meta: { hasSecret: true, rotated: Boolean(oldRef), oldSecretMissing: missingOld }, now }));
  }, hooks);

  result = { success: true, hasSecret: true, operationId, reference: newRef };
  return result;
}

async function revokeRouterSecret({ db, deviceId, ownerId, expectedRef, operationId, now, hooks }) {
  if (!operationId) operationId = crypto.randomUUID();
  if (!now) now = new Date().toISOString();

  await runTx(db, async (tx) => {
    const deviceRef = db.collection("devices").doc(deviceId);
    const deviceDoc = await tx.get(deviceRef);
    if (!deviceDoc.exists) throw new _DeviceNotFoundError();
    const device = deviceDoc.data() || {};
    if (device.ownerId && device.ownerId !== ownerId) throw new _OwnerMismatchError();

    const currentRef = (device.routerOsApiSecretRef ?? null);
    const expected = (expectedRef ?? null);
    if (currentRef !== expected) throw new _ConcurrentModificationError();

    if (currentRef === null) {
      // idempotent success, no writes
      return;
    }

    // revoke secret if owned
    const secretDoc = await tx.get(db.collection("mikrotik_secrets").doc(currentRef));
    if (secretDoc.exists) {
      const d = secretDoc.data() || {};
      if (d.ownerId && d.ownerId !== ownerId) throw new _CredentialIntegrityError();
      if (d.deviceId && d.deviceId !== deviceId) throw new _CredentialIntegrityError();
      if (!d.revokedAt) {
        tx.update(db.collection("mikrotik_secrets").doc(currentRef), { revokedAt: now });
      }
    }

    tx.update(deviceRef, { routerOsApiSecretRef: null, updatedAt: now });

    const auditId = crypto.randomUUID();
    const auditRef = db.collection("devices").doc(deviceId).collection("logs").doc(auditId);
    tx.create(auditRef, auditEntry({ operationId, ownerId, deviceId, type: "router_secret_revoked", meta: { hasSecret: false }, now }));
  }, hooks);

  return { success: true, hasSecret: false, operationId };
}

async function deleteDeviceWithRevocation({ db, deviceId, ownerId, operationId, now, hooks }) {
  if (!operationId) operationId = crypto.randomUUID();
  if (!now) now = new Date().toISOString();

  await runTx(db, async (tx) => {
    const deviceRef = db.collection("devices").doc(deviceId);
    const deviceDoc = await tx.get(deviceRef);
    if (!deviceDoc.exists) throw new _DeviceNotFoundError();
    const device = deviceDoc.data() || {};
    if (device.ownerId && device.ownerId !== ownerId) throw new _OwnerMismatchError();

    const ref = (device.routerOsApiSecretRef ?? null);
    let foreign = false;
    if (ref) {
      const secretDoc = await tx.get(db.collection("mikrotik_secrets").doc(ref));
      if (secretDoc.exists) {
        const d = secretDoc.data() || {};
        if (d.ownerId === ownerId && d.deviceId === deviceId) {
          if (!d.revokedAt) {
            tx.update(db.collection("mikrotik_secrets").doc(ref), { revokedAt: now });
          }
        } else {
          foreign = true;
        }
      }
    }

    tx.delete(deviceRef);

    const auditId = crypto.randomUUID();
    const auditRef = db.collection("devices").doc(deviceId).collection("logs").doc(auditId);
    tx.create(auditRef, auditEntry({ operationId, ownerId, deviceId, type: "device_deleted", meta: { foreignSecret: foreign }, now }));
  }, hooks);

  return { success: true, operationId };
}

module.exports = {
  ConcurrentModificationError: _ConcurrentModificationError,
  CredentialIntegrityError: _CredentialIntegrityError,
  DeviceNotFoundError: _DeviceNotFoundError,
  OwnerMismatchError: _OwnerMismatchError,
  TransactionContentionError: _TransactionContentionError,
  NotImplementedError,
  rotateRouterSecret,
  revokeRouterSecret,
  deleteDeviceWithRevocation,
};
