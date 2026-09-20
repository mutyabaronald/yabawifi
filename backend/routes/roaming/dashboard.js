const express = require("express");
const router = express.Router();
const {
  listOwnerSessions,
  RoamingSessionError,
} = require("../../services/roamingSessionService");
const registry = require("../../services/roamingRegistryService");

function parseLimit(value, def = 50) {
  let n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    n = def;
  }
  return Math.min(n, 200);
}

async function ownerIdentity(req) {
  const auth = await registry.authenticateOwnerOrSuper(req);
  if (auth.kind === "owner") {
    registry.requireOwnerSelf(auth, req.params.ownerId);
  }
  return { ownerId: auth.ownerId || req.params.ownerId, actor: auth.actor, kind: auth.kind };
}

function handleError(res, err) {
  if (err instanceof RoamingSessionError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }
  if (err instanceof registry.RegistryError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }
  console.error("[roaming-dashboard] unexpected error:", err);
  return res.status(500).json({
    success: false,
    error: "internal_error",
    message: err && err.message ? err.message : "Internal server error",
});
}

router.get("/:ownerId/sessions", async (req, res) => {
  try {
    const identity = await ownerIdentity(req);
    const { status } = req.query;
    const sessions = await listOwnerSessions(identity.ownerId, {
      limit: parseLimit(req.query.limit, 50),
      status: status || null,
    });

    const summary = sessions.reduce((acc, s) => {
      const key = s.status || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      success: true,
      ownerId: identity.ownerId,
      count: sessions.length,
      summary,
      sessions,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get("/:ownerId/summary", async (req, res) => {
  try {
    const identity = await ownerIdentity(req);
    const sessions = await listOwnerSessions(identity.ownerId, { limit: 500 });

    const summary = sessions.reduce(
      (acc, s) => {
        const key = s.status || "unknown";
        acc.byStatus[key] = (acc.byStatus[key] || 0) + 1;
        acc.totals.sessions += 1;
        const billed = Number(s.billedMinutes);
        if (Number.isFinite(billed) && billed > 0) {
          acc.totals.rausConsumed += billed;
        }
        return acc;
      },
      { byStatus: {}, totals: { sessions: 0, rausConsumed: 0 } }
    );

    return res.json({
      success: true,
      ownerId: identity.ownerId,
      summary,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

module.exports = router;
