const crypto = require("crypto");

function extractBearer(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

function extractSessionCookie(req) {
  return req.signedCookies?.userSession || null;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || "default-salt-change-in-production";
  return crypto.createHash("sha256").update(String(ip) + salt).digest("hex");
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== "string") {
    throw new Error("Phone number is required");
  }

  // Remove all non-digit characters except leading +
  let cleaned = String(phone).replace(/[^\d+]/g, "");

  // Handle leading plus sign
  cleaned = cleaned.replace(/^\+/, "");

  // Handle leading zeros (national format with trunk prefix)
  while (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
  }

  // If starts with 00, remove it (international access code)
  if (cleaned.startsWith("00")) {
    cleaned = cleaned.substring(2);
  }

  // If doesn't start with 256 and length is 9, it's a national Ugandan number
  if (!cleaned.startsWith("256") && cleaned.length === 9) {
    cleaned = "256" + cleaned;
  }

  // Validate: must start with 256 and have exactly 12 digits (256 + 9-digit NSN)
  if (!cleaned.startsWith("256") || cleaned.length !== 12) {
    throw new Error("Invalid Ugandan phone number");
  }

  // Validate: all digits (256 is already digits, check remaining 9)
  const nsn = cleaned.substring(3);
  if (!/^\d{9}$/.test(nsn)) {
    throw new Error("Invalid Ugandan phone number");
  }

  return "+" + cleaned;
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  extractBearer,
  extractSessionCookie,
  hashToken,
  hashIp,
  normalizePhone,
  generateSessionToken,
  constantTimeEqual
};