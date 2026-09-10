const express = require("express");
const router = express.Router();
const { admin, db } = require("../../firebase");
const {
  provisionSessionEnforcement,
  revokeSessionEnforcement,
  disconnectSessionEnforcement,
  getSessionUsage,
  checkEnforcementHealth,
  RoamingEnforcementError,
} = require("../../services/roamingEnforcementService");
const { verifyUserPassword, isBcryptHash } = require("../../services/passwordService");
const registry = require("../../services/roamingRegistryService");

async function verifyUserIdentity(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const idToken = authHeader.slice(7);
    try {
      const decoded = await db.admin.auth().verifyIdToken(idToken);
      return { userId: decoded.uid, method: "firebase_id_token" };
    } catch (err) {
      // Fall through to body credentials
    }
  }

  const { idToken } = req.body || {};
  if (idToken) {
    try {
      const decoded = await db.admin.auth().verifyIdToken(idToken);
      return { userId: decoded.uid, method: "firebase_id_token" };
    } catch (err) {
      throw new Error("Invalid Firebase ID token");
    }
  }

  const { phone, password } = req.body || {};
  if (phone && password) {
    let userDoc = await db.collection("users").doc(phone).get();
    if (!userDoc.exists) {
      const snapshot = await db
        .collection("users")
        .where("phone", "==", phone)
        .limit(1)
        .get();
      if (snapshot.empty) {
        throw new Error("Invalid credentials");
      }
      userDoc = snapshot.docs[0];
    }
    const userData = userDoc.data();

    if (!userData.password || userData.password === "") {
      throw new Error("Invalid credentials");
    }

    const passwordValid = await verifyUserPassword(userData.password, password);
    if (!passwordValid) {
      throw new Error("Invalid credentials");
    }

    if (!isBcryptHash(userData.password)) {
      const { hashPassword } = require("../../services/passwordService");
      const hashed = await hashPassword(password);
      await db.collection("users").doc(userDoc.id).update({
        password: hashed,
        updatedAt: new Date().toISOString(),
      });
    }

    return { userId: userDoc.id, method: "phone_password" };
  }

  throw new Error(
    "Authentication required: provide Firebase ID token or phone+password"
  );
}

async function verifyOwnerIdentity(req) {
  const auth = await registry.authenticateOwnerOrSuper(req);
  return { ownerId: auth.ownerId, kind: auth.kind };
}

function handleEnforcementError(res, err) {
  if (err instanceof RoamingEnforcementError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }
  console.error("Roaming enforcement error:", err);
  return res.status(500).json({
    success: false,
    error: "SERVER_ERROR",
    message: "Enforcement operation failed",
  });
}

function handleRegistryError(res, err) {
  if (err instanceof registry.RegistryError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }
  return handleEnforcementError(res, err);
}

router.post("/:sessionId/provision", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { idempotencyKey, metadata } = req.body || {};

    let context = {};

    try {
      const auth = await verifyUserIdentity(req);
      context.userId = auth.userId;
    } catch (err) {
      try {
        const ownerAuth = await verifyOwnerIdentity(req);
        context.ownerId = ownerAuth.ownerId;
        context.userId = null;
      } catch (ownerErr) {
        return handleRegistryError(res, ownerErr);
      }
    }

    const result = await provisionSessionEnforcement(
      sessionId,
      context,
      idempotencyKey,
      metadata || {}
    );

    return res.status(result.alreadyEnforced ? 200 : 201).json({
      success: true,
      sessionId,
      alreadyEnforced: result.alreadyEnforced,
      enforcement: result.enforcement,
    });
  } catch (err) {
    return handleEnforcementError(res, err);
  }
});

router.post("/:sessionId/revoke", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { reason } = req.body || {};

    let ownerId = null;
    try {
      const auth = await verifyUserIdentity(req);
      ownerId = null;
    } catch (err) {
      try {
        const ownerAuth = await verifyOwnerIdentity(req);
        ownerId = ownerAuth.ownerId;
      } catch (ownerErr) {
        return handleRegistryError(res, ownerErr);
      }
    }

    if (!ownerId) {
      return res.status(403).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "Owner authentication required to revoke enforcement",
      });
    }

    const result = await revokeSessionEnforcement(
      sessionId,
      { ownerId },
      reason || "admin_revoked"
    );

    return res.json({
      success: true,
      sessionId,
      alreadyRevoked: result.alreadyRevoked,
      enforcement: result.enforcement,
    });
  } catch (err) {
    return handleEnforcementError(res, err);
  }
});

router.post("/:sessionId/disconnect", async (req, res) => {
  try {
    const { sessionId } = req.params;

    let context = {};

    try {
      const auth = await verifyUserIdentity(req);
      context.userId = auth.userId;
    } catch (err) {
      try {
        const ownerAuth = await verifyOwnerIdentity(req);
        context.ownerId = ownerAuth.ownerId;
      } catch (ownerErr) {
        return handleRegistryError(res, ownerErr);
      }
    }

    const result = await disconnectSessionEnforcement(sessionId, context);

    return res.json({
      success: true,
      sessionId,
      alreadyDisconnected: result.alreadyDisconnected,
      enforcement: result.enforcement,
    });
  } catch (err) {
    return handleEnforcementError(res, err);
  }
});

router.get("/:sessionId/usage", async (req, res) => {
  try {
    const { sessionId } = req.params;

    let context = {};

    try {
      const auth = await verifyUserIdentity(req);
      context.userId = auth.userId;
    } catch (err) {
      try {
        const ownerAuth = await verifyOwnerIdentity(req);
        context.ownerId = ownerAuth.ownerId;
      } catch (ownerErr) {
        return handleRegistryError(res, ownerErr);
      }
    }

    const result = await getSessionUsage(sessionId, context);

    return res.json({
      success: true,
      sessionId,
      usage: result.usage,
      lastSampledAt: result.lastSampledAt,
    });
  } catch (err) {
    return handleEnforcementError(res, err);
  }
});

router.get("/health", async (req, res) => {
  try {
    let adapterKey = null;

    try {
      const ownerAuth = await verifyOwnerIdentity(req);
      const { adapterKey: requestedKey } = req.query || {};

      if (!requestedKey) {
        return res.status(400).json({
          success: false,
          error: "VALIDATION_ERROR",
          message: "adapterKey query parameter is required",
        });
      }

      adapterKey = requestedKey;
    } catch (ownerErr) {
      return handleRegistryError(res, ownerErr);
    }

    const result = await checkEnforcementHealth(adapterKey);

    return res.json({
      success: true,
      adapterKey: result.adapterKey,
      healthy: result.healthy,
      details: result.details,
    });
  } catch (err) {
    return handleEnforcementError(res, err);
  }
});

module.exports = router;
