const crypto = require("crypto");

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://wifi-automation-frontend.onrender.com"
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateCSRFToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function getCsrfTokenFromCookie(req) {
  return req.cookies?.csrfToken || null;
}

function setCsrfCookie(res, csrfToken) {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("csrfToken", csrfToken, {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: 24 * 60 * 60 * 1000,
    signed: false
  });
}

function clearCsrfCookie(res) {
  const isProduction = process.env.NODE_ENV === "production";
  res.clearCookie("csrfToken", {
    httpOnly: false,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/"
  });
}

async function createSessionCsrfToken(db, sessionId) {
  const csrfToken = generateCSRFToken();
  const csrfHash = hashToken(csrfToken);
  await db.collection("user_sessions").doc(sessionId).update({
    csrfHash,
    csrfCreatedAt: new Date().toISOString()
  });
  return csrfToken;
}

async function verifySessionCsrfToken(db, sessionId, suppliedCsrfToken) {
  if (!suppliedCsrfToken) return false;
  const sessionDoc = await db.collection("user_sessions").doc(sessionId).get();
  if (!sessionDoc.exists) return false;
  const session = sessionDoc.data();
  const storedHash = session.csrfHash;
  if (!storedHash) return false;
  const suppliedHash = hashToken(suppliedCsrfToken);
  return constantTimeEqual(suppliedHash, storedHash);
}

function csrfProtection(db) {
  const authEndpoints = [
    "/auth",
    "/auth-email",
    "/register-email",
    "/forgot-password",
    "/verify-reset-code",
    "/reset-password"
  ];

  return async function (req, res, next) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    // Allow authentication endpoints to proceed without session/CSRF
    // These endpoints CREATE sessions, so they can't require an existing one
    if (authEndpoints.some(ep => req.path === ep || req.path.startsWith(ep + "/"))) {
      // Still validate origin for auth endpoints
      const origin = req.headers.origin;
      if (!isAllowedOrigin(origin)) {
        return res.status(403).json({
          success: false,
          error: "invalid_origin",
          message: "Request origin not allowed"
        });
      }
      return next();
    }

    const origin = req.headers.origin;
    const rawToken = req.signedCookies?.userSession;

    if (!rawToken) {
      return res.status(401).json({
        success: false,
        error: "unauthenticated",
        message: "Authentication required for state-changing request"
      });
    }

    if (!isAllowedOrigin(origin)) {
      return res.status(403).json({
        success: false,
        error: "invalid_origin",
        message: "Request origin not allowed"
      });
    }

    const { hashToken: hashTokenUtil } = require("../utils/authUtils");
    const sessionId = hashTokenUtil(rawToken);

    const csrfToken = getCsrfTokenFromCookie(req);
    const csrfHeader = req.headers["x-csrf-token"];

    if (!csrfToken || !csrfHeader) {
      return res.status(403).json({
        success: false,
        error: "csrf_failed",
        message: "CSRF token missing from cookie or header"
      });
    }

    if (csrfToken !== csrfHeader) {
      return res.status(403).json({
        success: false,
        error: "csrf_failed",
        message: "CSRF token mismatch between cookie and header"
      });
    }

    const isValid = await verifySessionCsrfToken(db, sessionId, csrfToken);
    if (!isValid) {
      return res.status(403).json({
        success: false,
        error: "csrf_failed",
        message: "Invalid or session-unbound CSRF token"
      });
    }

    next();
  };
}

module.exports = {
  csrfProtection,
  setCsrfCookie,
  clearCsrfCookie,
  allowedOrigins,
  isAllowedOrigin,
  generateCSRFToken,
  createSessionCsrfToken,
  verifySessionCsrfToken,
  hashToken,
  constantTimeEqual
};