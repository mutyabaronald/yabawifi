const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { db } = require("../firebase");
const {
  checkEntitlementEligibility,
} = require("./roamingEntitlementService");
const { getProductionSecret } = require("./passwordService");

// Dedicated roaming authentication JWT secret
const ROAMING_AUTH_JWT_SECRET = getProductionSecret(
  "ROAMING_AUTH_JWT_SECRET",
  "dev-roaming-auth-secret",
  "Roaming authentication JWT secret"
);

// JWT configuration
const ROAMING_AUTH_JWT_ISSUER =
  process.env.ROAMING_AUTH_JWT_ISSUER || "yabalink-roaming-auth";
const ROAMING_AUTH_JWT_AUDIENCE =
  process.env.ROAMING_AUTH_JWT_AUDIENCE || "yabalink-roaming-network";

// Token TTL in seconds (default: 3 minutes)
const ROAMING_AUTH_TOKEN_TTL_SECONDS = parseInt(
  process.env.ROAMING_AUTH_TOKEN_TTL_SECONDS || "180",
  10
);

// Strictly enforce algorithm
const JWT_ALGORITHM = "HS256";

// Token state statuses
const TOKEN_STATUSES = Object.freeze([
  "issued",
  "consumed",
  "revoked",
  "expired",
]);

// Authentication paths
const AUTH_PATHS = Object.freeze(["legacy_captive"]);

// Error codes
const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: "validation_error",
  UNAUTHORIZED: "unauthorized",
  INELIGIBLE: "ineligible",
  INVALID_TOKEN: "invalid_token",
  EXPIRED_TOKEN: "expired_token",
  REVOKED_TOKEN: "revoked_token",
  CONSUMED_TOKEN: "consumed_token",
  CONTEXT_MISMATCH: "context_mismatch",
  REPLAY_DETECTED: "replay_detected",
  SERVER_ERROR: "server_error",
});

class RoamingAuthError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function generateJti() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Load roaming partner (reuse from registry service or implement locally)
 */
async function loadRoamingPartner(ownerId) {
  try {
    const snap = await db.collection("roaming_partners").doc(ownerId).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  } catch (err) {
    console.error("Failed to load roaming partner:", err);
    return null;
  }
}

/**
 * Load roaming agreement between home and visited owner
 */
async function loadRoamingAgreement(homeOwnerId, visitedOwnerId) {
  try {
    // Query for active agreement between home and visited owner
    const snap = await db
      .collection("roaming_agreements")
      .where("homeOwnerId", "==", homeOwnerId)
      .where("visitedOwnerId", "==", visitedOwnerId)
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (snap.empty) return null;

    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (err) {
    console.error("Failed to load roaming agreement:", err);
    return null;
  }
}

/**
 * Validate roaming agreement is active and within date range
 */
function validateAgreement(agreement) {
  if (!agreement) {
    return {
      valid: false,
      reason: "no_agreement",
      message: "No roaming agreement found between home and visited owner",
    };
  }

  if (agreement.status !== "active") {
    return {
      valid: false,
      reason: "agreement_inactive",
      message: "Roaming agreement is not active",
    };
  }

  const now = new Date();

  if (agreement.effectiveFrom) {
    const effectiveFrom = new Date(agreement.effectiveFrom);
    if (now < effectiveFrom) {
      return {
        valid: false,
        reason: "agreement_not_started",
        message: "Roaming agreement has not yet started",
      };
    }
  }

  if (agreement.effectiveUntil) {
    const effectiveUntil = new Date(agreement.effectiveUntil);
    if (now > effectiveUntil) {
      return {
        valid: false,
        reason: "agreement_expired",
        message: "Roaming agreement has expired",
      };
    }
  }

  return { valid: true };
}

/**
 * Authenticate user for roaming access
 * 
 * This is the primary authentication/authorization function for Phase 4.
 * It validates federation relationships, checks entitlement eligibility,
 * and issues a short-lived roaming authorization token.
 */
async function authenticateForRoaming({
  userId,
  visitedOwnerId,
  visitedHotspotId,
  authPath = "legacy_captive",
  metadata = {},
}) {
  // Validate required inputs
  if (!userId || typeof userId !== "string") {
    throw new RoamingAuthError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "userId is required"
    );
  }

  if (!visitedOwnerId || typeof visitedOwnerId !== "string") {
    throw new RoamingAuthError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "visitedOwnerId is required"
    );
  }

  if (!visitedHotspotId || typeof visitedHotspotId !== "string") {
    throw new RoamingAuthError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "visitedHotspotId is required"
    );
  }

  // Validate authPath
  if (!AUTH_PATHS.includes(authPath)) {
    throw new RoamingAuthError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `Invalid authPath. Allowed: ${AUTH_PATHS.join(", ")}`
    );
  }

  // Check entitlement eligibility using Phase 3
  const eligibility = await checkEntitlementEligibility({
    userId,
    visitedOwnerId,
    visitedHotspotId,
  });

  if (!eligibility.eligible) {
    return {
      success: false,
      authorized: false,
      reason: eligibility.reason,
      message: eligibility.message,
    };
  }

  // Extract entitlement details
  const {
    entitlementId,
    homeOwnerId,
    visitedOwnerId: validatedVisitedOwnerId,
    visitedHotspotId: validatedVisitedHotspotId,
  } = eligibility;

  // Validate visited owner is an active roaming partner
  const visitedPartner = await loadRoamingPartner(visitedOwnerId);
  if (!visitedPartner || visitedPartner.federationStatus !== "active") {
    return {
      success: false,
      authorized: false,
      reason: "visited_partner_inactive",
      message: "Visited owner is not an active roaming partner",
    };
  }

  // Validate home owner is an active roaming partner
  const homePartner = await loadRoamingPartner(homeOwnerId);
  if (!homePartner || homePartner.federationStatus !== "active") {
    return {
      success: false,
      authorized: false,
      reason: "home_partner_inactive",
      message: "Home owner is not an active roaming partner",
    };
  }

  // Load and validate roaming agreement
  const agreement = await loadRoamingAgreement(homeOwnerId, visitedOwnerId);
  const agreementValidation = validateAgreement(agreement);

  if (!agreementValidation.valid) {
    return {
      success: false,
      authorized: false,
      reason: agreementValidation.reason,
      message: agreementValidation.message,
    };
  }

  // Issue roaming authorization token
  const tokenResult = await issueRoamingAuthorizationToken({
    userId,
    entitlementId,
    homeOwnerId,
    visitedOwnerId: validatedVisitedOwnerId,
    visitedHotspotId: validatedVisitedHotspotId,
    agreementId: agreement.id,
    authPath,
    metadata,
  });

  return {
    success: true,
    authorized: true,
    token: tokenResult.token,
    tokenType: "Bearer",
    expiresAt: tokenResult.expiresAt,
    authPath,
    entitlementId,
    homeOwnerId,
    visitedOwnerId: validatedVisitedOwnerId,
    visitedHotspotId: validatedVisitedHotspotId,
    agreementId: agreement.id,
  };
}

/**
 * Issue a short-lived roaming authorization token
 */
async function issueRoamingAuthorizationToken({
  userId,
  entitlementId,
  homeOwnerId,
  visitedOwnerId,
  visitedHotspotId,
  agreementId,
  authPath,
  metadata = {},
}) {
  const jti = generateJti();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ROAMING_AUTH_TOKEN_TTL_SECONDS;

  // Create JWT payload with minimal required claims
  const payload = {
    sub: userId,
    entitlementId,
    homeOwnerId,
    visitedOwnerId,
    visitedHotspotId,
    agreementId,
    authPath,
    jti,
    iat: now,
    exp,
    iss: ROAMING_AUTH_JWT_ISSUER,
    aud: ROAMING_AUTH_JWT_AUDIENCE,
  };

  // Sign token with dedicated secret and explicit algorithm
  const token = jwt.sign(payload, ROAMING_AUTH_JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
  });

  // Store token state for replay protection
  const tokenRecord = {
    jti,
    userId,
    entitlementId,
    homeOwnerId,
    visitedOwnerId,
    visitedHotspotId,
    agreementId,
    authPath,
    status: "issued",
    issuedAt: nowIso(),
    expiresAt: new Date(exp * 1000).toISOString(),
    consumedAt: null,
    revokedAt: null,
    metadata: metadata || {},
    createdAt: nowIso(),
  };

  await db.collection("roaming_auth_tokens").doc(jti).set(tokenRecord);

  // Log authentication event
  await logAuthEvent({
    eventType: "token_issued",
    userId,
    entitlementId,
    homeOwnerId,
    visitedOwnerId,
    visitedHotspotId,
    jti,
    success: true,
  });

  return {
    token,
    jti,
    expiresAt: tokenRecord.expiresAt,
  };
}

/**
 * Validate roaming authorization token
 * 
 * Performs comprehensive validation including:
 * - Signature verification
 * - Algorithm enforcement
 * - Issuer/audience validation
 * - Expiration check
 * - Token status check (revoked/consumed)
 * - Context binding validation
 */
async function validateRoamingAuthorizationToken(token, context = {}) {
  if (!token || typeof token !== "string") {
    throw new RoamingAuthError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Token is required"
    );
  }

  let decoded;

  // Verify token signature and claims
  try {
    decoded = jwt.verify(token, ROAMING_AUTH_JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
      issuer: ROAMING_AUTH_JWT_ISSUER,
      audience: ROAMING_AUTH_JWT_AUDIENCE,
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new RoamingAuthError(
        401,
        ERROR_CODES.EXPIRED_TOKEN,
        "Token has expired"
      );
    }
    throw new RoamingAuthError(
      401,
      ERROR_CODES.INVALID_TOKEN,
      "Invalid token signature or claims"
    );
  }

  // Validate required claims exist
  const requiredClaims = [
    "sub",
    "entitlementId",
    "homeOwnerId",
    "visitedOwnerId",
    "visitedHotspotId",
    "agreementId",
    "authPath",
    "jti",
  ];

  for (const claim of requiredClaims) {
    if (!decoded[claim]) {
      throw new RoamingAuthError(
        401,
        ERROR_CODES.INVALID_TOKEN,
        `Missing required claim: ${claim}`
      );
    }
  }

  // Check token status in database
  const tokenSnap = await db
    .collection("roaming_auth_tokens")
    .doc(decoded.jti)
    .get();

  if (!tokenSnap.exists) {
    throw new RoamingAuthError(
      401,
      ERROR_CODES.INVALID_TOKEN,
      "Token not found in registry"
    );
  }

  const tokenRecord = tokenSnap.data();

  // Check token status
  if (tokenRecord.status === "revoked") {
    throw new RoamingAuthError(
      401,
      ERROR_CODES.REVOKED_TOKEN,
      "Token has been revoked"
    );
  }

  if (tokenRecord.status === "consumed") {
    throw new RoamingAuthError(
      401,
      ERROR_CODES.CONSUMED_TOKEN,
      "Token has already been consumed"
    );
  }

  // Validate context binding if provided
  if (context.visitedOwnerId && decoded.visitedOwnerId !== context.visitedOwnerId) {
    throw new RoamingAuthError(
      403,
      ERROR_CODES.CONTEXT_MISMATCH,
      "Token visitedOwnerId does not match context"
    );
  }

  if (context.visitedHotspotId && decoded.visitedHotspotId !== context.visitedHotspotId) {
    throw new RoamingAuthError(
      403,
      ERROR_CODES.CONTEXT_MISMATCH,
      "Token visitedHotspotId does not match context"
    );
  }

  if (context.userId && decoded.sub !== context.userId) {
    throw new RoamingAuthError(
      403,
      ERROR_CODES.CONTEXT_MISMATCH,
      "Token userId does not match context"
    );
  }

  // Log validation event
  await logAuthEvent({
    eventType: "token_validated",
    userId: decoded.sub,
    entitlementId: decoded.entitlementId,
    homeOwnerId: decoded.homeOwnerId,
    visitedOwnerId: decoded.visitedOwnerId,
    visitedHotspotId: decoded.visitedHotspotId,
    jti: decoded.jti,
    success: true,
  });

  return {
    valid: true,
    claims: decoded,
    tokenRecord,
  };
}

/**
 * Consume a roaming authorization token
 *
 * Marks a token as consumed to prevent reuse.
 * Uses a Firestore transaction for atomicity to prevent race conditions
 * where two simultaneous requests both succeed.
 *
 * This should be called when a roaming session is created (Phase 5).
 */
async function consumeRoamingAuthorizationToken(jti) {
  if (!jti || typeof jti !== "string") {
    throw new RoamingAuthError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "jti is required"
    );
  }

  let tokenRecord;
  try {
    tokenRecord = await db.runTransaction(async (transaction) => {
      const tokenRef = db.collection("roaming_auth_tokens").doc(jti);
      const tokenDoc = await transaction.get(tokenRef);

      if (!tokenDoc.exists) {
        throw new RoamingAuthError(
          404,
          ERROR_CODES.INVALID_TOKEN,
          "Token not found"
        );
      }

      const record = tokenDoc.data();

      if (record.status === "consumed") {
        throw new RoamingAuthError(
          409,
          ERROR_CODES.CONSUMED_TOKEN,
          "Token has already been consumed"
        );
      }

      if (record.status === "revoked") {
        throw new RoamingAuthError(
          401,
          ERROR_CODES.REVOKED_TOKEN,
          "Token has been revoked"
        );
      }

      const now = new Date();
      const expiresAt = new Date(record.expiresAt);
      if (now > expiresAt) {
        throw new RoamingAuthError(
          401,
          ERROR_CODES.EXPIRED_TOKEN,
          "Token has expired"
        );
      }

      transaction.set(
        tokenRef,
        {
          status: "consumed",
          consumedAt: nowIso(),
        },
        { merge: true }
      );

      return record;
    });
  } catch (err) {
    if (err instanceof RoamingAuthError) throw err;
    console.error("Token consumption transaction failed:", err);
    throw new RoamingAuthError(
      500,
      ERROR_CODES.SERVER_ERROR,
      "Failed to consume token"
    );
  }

  await logAuthEvent({
    eventType: "token_consumed",
    userId: tokenRecord.userId,
    entitlementId: tokenRecord.entitlementId,
    homeOwnerId: tokenRecord.homeOwnerId,
    visitedOwnerId: tokenRecord.visitedOwnerId,
    visitedHotspotId: tokenRecord.visitedHotspotId,
    jti,
    success: true,
  });

  return { consumed: true, jti };
}

/**
 * Revoke a roaming authorization token
 *
 * Uses a Firestore transaction for atomicity to prevent race conditions.
 */
async function revokeRoamingAuthorizationToken(jti, reason = "admin_revoked") {
  if (!jti || typeof jti !== "string") {
    throw new RoamingAuthError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "jti is required"
    );
  }

  let tokenRecord;
  try {
    tokenRecord = await db.runTransaction(async (transaction) => {
      const tokenRef = db.collection("roaming_auth_tokens").doc(jti);
      const tokenDoc = await transaction.get(tokenRef);

      if (!tokenDoc.exists) {
        throw new RoamingAuthError(
          404,
          ERROR_CODES.INVALID_TOKEN,
          "Token not found"
        );
      }

      const record = tokenDoc.data();

      if (record.status === "consumed") {
        throw new RoamingAuthError(
          409,
          ERROR_CODES.CONSUMED_TOKEN,
          "Token has already been consumed and cannot be revoked"
        );
      }

      if (record.status === "revoked") {
        throw new RoamingAuthError(
          409,
          ERROR_CODES.REVOKED_TOKEN,
          "Token has already been revoked"
        );
      }

      const now = new Date();
      const expiresAt = new Date(record.expiresAt);
      if (now > expiresAt) {
        throw new RoamingAuthError(
          401,
          ERROR_CODES.EXPIRED_TOKEN,
          "Token has expired"
        );
      }

      transaction.set(
        tokenRef,
        {
          status: "revoked",
          revokedAt: nowIso(),
          revocationReason: reason,
        },
        { merge: true }
      );

      return record;
    });
  } catch (err) {
    if (err instanceof RoamingAuthError) throw err;
    console.error("Token revocation transaction failed:", err);
    throw new RoamingAuthError(
      500,
      ERROR_CODES.SERVER_ERROR,
      "Failed to revoke token"
    );
  }

  await logAuthEvent({
    eventType: "token_revoked",
    userId: tokenRecord.userId,
    entitlementId: tokenRecord.entitlementId,
    homeOwnerId: tokenRecord.homeOwnerId,
    visitedOwnerId: tokenRecord.visitedOwnerId,
    visitedHotspotId: tokenRecord.visitedHotspotId,
    jti,
    reason,
    success: true,
  });

  return { revoked: true, jti };
}

/**
 * Get roaming authorization context from token
 */
async function getRoamingAuthContext(token, context = {}) {
  const validation = await validateRoamingAuthorizationToken(token, context);
  return {
    userId: validation.claims.sub,
    entitlementId: validation.claims.entitlementId,
    homeOwnerId: validation.claims.homeOwnerId,
    visitedOwnerId: validation.claims.visitedOwnerId,
    visitedHotspotId: validation.claims.visitedHotspotId,
    agreementId: validation.claims.agreementId,
    authPath: validation.claims.authPath,
    jti: validation.claims.jti,
    issuedAt: new Date(validation.claims.iat * 1000).toISOString(),
    expiresAt: new Date(validation.claims.exp * 1000).toISOString(),
  };
}

/**
 * Log authentication event for audit trail
 */
async function logAuthEvent(event) {
  try {
    const logEntry = {
      ...event,
      timestamp: nowIso(),
    };

    await db.collection("roaming_auth_logs").add(logEntry);

    await db.collection("audit_logs").add({
      actor: event.userId ? `user:${event.userId}` : "roaming-auth-service",
      action: `roaming.auth.${event.eventType}`,
      ownerId: event.homeOwnerId || event.visitedOwnerId || null,
      at: nowIso(),
      payload: {
        entitlementId: event.entitlementId || null,
        visitedOwnerId: event.visitedOwnerId || null,
        visitedHotspotId: event.visitedHotspotId || null,
        jti: event.jti || null,
        success: event.success,
        reason: event.reason || null,
      },
    });
  } catch (err) {
    console.error("Failed to log auth event:", err);
  }
}

/**
 * Error handler for roaming authentication routes
 */
function handleError(res, err) {
  if (err instanceof RoamingAuthError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
      details: err.details,
    });
  }
  console.error("Roaming authentication error:", err);
  return res.status(500).json({
    success: false,
    error: ERROR_CODES.SERVER_ERROR,
    message: "Authentication request failed",
  });
}

module.exports = {
  RoamingAuthError,
  ERROR_CODES,
  TOKEN_STATUSES,
  AUTH_PATHS,
  ROAMING_AUTH_TOKEN_TTL_SECONDS,
  JWT_ALGORITHM,
  authenticateForRoaming,
  issueRoamingAuthorizationToken,
  validateRoamingAuthorizationToken,
  consumeRoamingAuthorizationToken,
  revokeRoamingAuthorizationToken,
  getRoamingAuthContext,
  logAuthEvent,
  handleError,
};
