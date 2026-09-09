const express = require("express");
const router = express.Router();
const { admin, db } = require("../../firebase");
const {
  verifyUserPassword,
  hashPassword,
  isBcryptHash,
} = require("../../services/passwordService");
const {
  createRoamingSession,
  getRoamingSession,
  terminateRoamingSession,
  updateSessionActivity,
  revokeRoamingSession,
  listUserSessions,
  listOwnerSessions,
  RoamingSessionError,
} = require("../../services/roamingSessionService");
const registry = require("../../services/roamingRegistryService");

async function verifyUserIdentity(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const idToken = authHeader.slice(7);
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      return { userId: decoded.uid, method: "firebase_id_token" };
    } catch (err) {
      // Fall through to body credentials
    }
  }

  const { idToken } = req.body || {};
  if (idToken) {
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
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

function handleSessionError(res, err) {
  if (err instanceof RoamingSessionError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }
  console.error("Roaming session error:", err);
  return res.status(500).json({
    success: false,
    error: "SERVER_ERROR",
    message: "Session operation failed",
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
  return handleSessionError(res, err);
}

router.post("/", async (req, res) => {
  try {
    const { token, idempotencyKey, metadata } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Authorization token is required",
      });
    }

    const result = await createRoamingSession({
      token,
      idempotencyKey,
      metadata: metadata || {},
    });

    if (!result.success) {
      return res.status(403).json(result);
    }

    return res.status(201).json({
      success: true,
      sessionId: result.sessionId,
      session: result.session,
      existing: result.existing || false,
    });
  } catch (err) {
    return handleSessionError(res, err);
  }
});

router.get("/:sessionId", async (req, res) => {
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

    const session = await getRoamingSession(sessionId, context);

    return res.json({
      success: true,
      session,
    });
  } catch (err) {
    return handleSessionError(res, err);
  }
});

router.post("/:sessionId/terminate", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { reason } = req.body || {};

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

    context.reason = reason;

    const result = await terminateRoamingSession(sessionId, context);

    return res.json({
      success: true,
      session: result.session,
      alreadyTerminated: result.alreadyTerminated || false,
    });
  } catch (err) {
    return handleSessionError(res, err);
  }
});

router.post("/:sessionId/activity", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { usedMinutes, usedMegabytes } = req.body || {};

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

    const session = await updateSessionActivity(
      sessionId,
      context,
      { usedMinutes, usedMegabytes }
    );

    return res.json({
      success: true,
      session,
    });
  } catch (err) {
    return handleSessionError(res, err);
  }
});

router.post("/:sessionId/revoke", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { reason } = req.body || {};

    let ownerId;
    try {
      const auth = await verifyOwnerIdentity(req);
      ownerId = auth.ownerId;
    } catch (err) {
      return handleRegistryError(res, err);
    }

    const result = await revokeRoamingSession(
      sessionId,
      { ownerId },
      reason || "admin_revoked"
    );

    return res.json({
      success: true,
      session: result.session,
      alreadyRevoked: result.alreadyRevoked || false,
    });
  } catch (err) {
    return handleSessionError(res, err);
  }
});

router.get("/", async (req, res) => {
  try {
    let sessions;

    try {
      const auth = await verifyUserIdentity(req);
      sessions = await listUserSessions(auth.userId);
    } catch (err) {
      try {
        const ownerAuth = await verifyOwnerIdentity(req);
        const { status } = req.query;
        sessions = await listOwnerSessions(ownerAuth.ownerId, { status });
      } catch (ownerErr) {
        return handleRegistryError(res, ownerErr);
      }
    }

    return res.json({
      success: true,
      sessions,
    });
  } catch (err) {
    return handleSessionError(res, err);
  }
});

module.exports = router;
