const express = require("express");
const router = express.Router();
const { admin, db } = require("../../firebase");
const {
  verifyUserPassword,
  hashPassword,
  isBcryptHash,
} = require("../../services/passwordService");
const {
  authenticateForRoaming,
  validateRoamingAuthorizationToken,
  consumeRoamingAuthorizationToken,
  revokeRoamingAuthorizationToken,
  getRoamingAuthContext,
  handleError,
  RoamingAuthError,
  ERROR_CODES,
} = require("../../services/roamingAuthService");
const registry = require("../../services/roamingRegistryService");

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const rateLimitMap = new Map();
const userRateLimitMap = new Map();

function checkRateLimit(key) {
  const now = Date.now();
  const record = rateLimitMap.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  record.count += 1;
  rateLimitMap.set(key, record);
  return record.count <= RATE_LIMIT_MAX_REQUESTS;
}

function checkUserRateLimit(key) {
  const now = Date.now();
  const windowMs = RATE_LIMIT_WINDOW_MS;
  const max = RATE_LIMIT_MAX_REQUESTS;
  const record = userRateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  record.count += 1;
  userRateLimitMap.set(key, record);
  return record.count <= max;
}

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
      const hashed = await hashPassword(password);
      await db.collection("users").doc(userDoc.id).update({
        password: hashed,
        passwordSetAt: new Date().toISOString(),
      });
      return { userId: userDoc.id, method: "phone_password" };
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

  throw new Error("Invalid credentials");
}

function handleRegistryError(res, err) {
  if (err instanceof registry.RegistryError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }
  return handleError(res, err);
}

router.post("/authenticate", async (req, res) => {
  try {
    const clientIp = req.ip || req.connection.remoteAddress || "unknown";
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({
        success: false,
        authorized: false,
        reason: "rate_limited",
        message: "Too many authentication attempts. Please try again later.",
      });
    }

    let verifiedUserId;
    try {
      const identity = await verifyUserIdentity(req);
      verifiedUserId = identity.userId;

      if (identity.method === "phone_password" && req.body.phone) {
        if (!checkUserRateLimit(req.body.phone)) {
          userRateLimitMap.delete(req.body.phone);
          return res.status(429).json({
            success: false,
            authorized: false,
            reason: "rate_limited",
            message: "Too many attempts for this account. Please try again later.",
          });
        }
      }
    } catch (err) {
      userRateLimitMap.delete(req.body?.phone);
      return res.status(401).json({
        success: false,
        authorized: false,
        reason: "authentication_failed",
        message: "Invalid credentials",
      });
    }

    const { visitedOwnerId, visitedHotspotId, authPath, metadata } = req.body;

    const result = await authenticateForRoaming({
      userId: verifiedUserId,
      visitedOwnerId,
      visitedHotspotId,
      authPath: authPath || "legacy_captive",
      metadata: metadata || {},
    });

    if (!result.success) {
      return res.status(403).json(result);
    }

    userRateLimitMap.delete(req.body?.phone);
    return res.json(result);
  } catch (err) {
    return handleError(res, err);
  }
});

router.post("/validate", async (req, res) => {
  try {
    const { token, context } = req.body;

    const result = await validateRoamingAuthorizationToken(token, context || {});

    return res.json({
      success: true,
      valid: result.valid,
      claims: result.claims,
      tokenRecord: result.tokenRecord,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post("/consume", async (req, res) => {
  try {
    const { token, jti, context } = req.body;

    if (!token && !jti) {
      return res.status(400).json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: "Token or jti is required",
      });
    }

    let resolvedJti = jti;

    if (token) {
      let validated;
      try {
        validated = await validateRoamingAuthorizationToken(token, context || {});
      } catch (err) {
        return handleError(res, err);
      }
      resolvedJti = validated.claims.jti;
    }

    const result = await consumeRoamingAuthorizationToken(resolvedJti);

    return res.json({
      success: true,
      consumed: result.consumed,
      jti: result.jti,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post("/revoke", async (req, res) => {
  try {
    let auth;
    try {
      auth = await registry.authenticateOwnerOrSuper(req);
    } catch (err) {
      return handleRegistryError(res, err);
    }

    const { jti, reason } = req.body;

    if (!jti) {
      return res.status(400).json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: "jti is required",
      });
    }

    if (auth.kind === "owner") {
      const tokenSnap = await db
        .collection("roaming_auth_tokens")
        .doc(jti)
        .get();

      if (!tokenSnap.exists) {
        return res.status(404).json({
          success: false,
          error: ERROR_CODES.INVALID_TOKEN,
          message: "Token not found",
        });
      }

      const tokenData = tokenSnap.data();
      if (
        tokenData.homeOwnerId !== auth.ownerId &&
        tokenData.visitedOwnerId !== auth.ownerId
      ) {
        return res.status(403).json({
          success: false,
          error: "unauthorized_scope",
          message: "Cannot revoke token for another owner's network",
        });
      }
    }

    const result = await revokeRoamingAuthorizationToken(
      jti,
      reason || "admin_revoked"
    );

    return res.json({
      success: true,
      revoked: result.revoked,
      jti: result.jti,
    });
  } catch (err) {
    return handleRegistryError(res, err);
  }
});

router.post("/context", async (req, res) => {
  try {
    const { token, context } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: ERROR_CODES.VALIDATION_ERROR,
        message: "Token is required",
      });
    }

    const tokenContext = await getRoamingAuthContext(token, context || {});

    return res.json({
      success: true,
      context: tokenContext,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "roaming-auth",
    phase: 4,
    status: "operational",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
