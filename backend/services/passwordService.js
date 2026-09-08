const bcrypt = require("bcryptjs");

const BCRYPT_COST = 10;
const BCRYPT_PREFIX = "$2";

function isBcryptHash(value) {
  return (
    typeof value === "string" &&
    value.startsWith(BCRYPT_PREFIX) &&
    value.length >= 50
  );
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

async function verifyUserPassword(storedPassword, suppliedPassword) {
  if (!storedPassword) return false;
  if (isBcryptHash(storedPassword)) {
    return await bcrypt.compare(suppliedPassword, storedPassword);
  }
  return storedPassword === suppliedPassword;
}

function getProductionSecret(envVar, devDefault, name) {
  const value = process.env[envVar];
  if (process.env.NODE_ENV === "production") {
    if (!value || value === devDefault) {
      throw new Error(
        `${name} must be configured in production. Set ${envVar} environment variable with a strong secret.`
      );
    }
  }
  return value || devDefault;
}

module.exports = {
  BCRYPT_COST,
  BCRYPT_PREFIX,
  isBcryptHash,
  hashPassword,
  verifyUserPassword,
  getProductionSecret,
};
