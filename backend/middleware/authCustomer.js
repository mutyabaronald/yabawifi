const { db } = require("../firebase");
const { Timestamp } = require("firebase-admin/firestore");
const { extractBearer, extractSessionCookie, hashToken } = require("../utils/authUtils");

async function authenticateCustomer(req, res, next) {
  try {
    const rawToken = extractSessionCookie(req) || extractBearer(req);
    if (!rawToken) {
      return res.status(401).json({
        success: false,
        error: "unauthenticated",
        message: "Authentication required"
      });
    }

    const tokenHash = hashToken(rawToken);
    const sessionDoc = await db.collection("user_sessions").doc(tokenHash).get();

    if (!sessionDoc.exists) {
      return res.status(401).json({
        success: false,
        error: "invalid_session",
        message: "Invalid or expired session"
      });
    }

    const session = sessionDoc.data();
    const now = Timestamp.now();

    if (session.revokedAt && session.revokedAt.toMillis() <= now.toMillis()) {
      return res.status(401).json({
        success: false,
        error: "revoked",
        message: "Session revoked: " + (session.revokedReason || "unknown")
      });
    }

    if (session.expiresAt && session.expiresAt.toMillis() < now.toMillis()) {
      await sessionDoc.ref.delete().catch(() => {});
      return res.status(401).json({
        success: false,
        error: "expired",
        message: "Session expired"
      });
    }

    req.customer = {
      userPhone: session.userPhone || null,
      firebaseUid: session.firebaseUid || null,
      authMethod: session.authMethod || "phone",
      sessionId: tokenHash
    };

    sessionDoc.ref.update({
      lastActivityAt: Timestamp.now()
    }).catch(() => {});

    next();
  } catch (err) {
    console.error("Customer auth error:", err);
    return res.status(500).json({
      success: false,
      error: "internal_error",
      message: "Authentication failed"
    });
  }
}

function requirePhone(req, res, next) {
  if (!req.customer?.userPhone) {
    return res.status(403).json({
      success: false,
      error: "phone_required",
      message: "Phone number required. Please add a phone number to your account."
    });
  }
  next();
}

module.exports = {
  authenticateCustomer,
  requirePhone
};