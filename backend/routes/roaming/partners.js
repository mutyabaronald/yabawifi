const express = require("express");
const router = express.Router();
const registry = require("../../services/roamingRegistryService");

function idempotencyKey(req) {
  return req.get("Idempotency-Key") || req.body?.idempotencyKey || null;
}

router.post("/opt-in", async (req, res) => {
  try {
    const auth = await registry.authenticateOwner(req);
    const bodyOwnerId = req.body?.ownerId;
    if (bodyOwnerId && bodyOwnerId !== auth.ownerId) {
      return res.status(403).json({
        success: false,
        error: "unauthorized_scope",
        message: "ownerId in body does not match authenticated owner",
      });
    }
    const result = await registry.optInPartner({
      ownerId: auth.ownerId,
      actor: auth.actor,
      payload: req.body || {},
      idempotencyKey: idempotencyKey(req),
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return registry.handleError(res, err);
  }
});

router.get("/", async (req, res) => {
  try {
    registry.authenticateSuperAdmin(req);
    const partners = await registry.listPartners();
    return res.json({ success: true, partners });
  } catch (err) {
    return registry.handleError(res, err);
  }
});

router.get("/:ownerId/status", async (req, res) => {
  try {
    const auth = await registry.authenticateOwnerOrSuper(req);
    const { ownerId } = req.params;
    if (auth.kind === "owner") {
      registry.requireOwnerSelf(auth, ownerId);
    }
    const result = await registry.getPartnerStatus(ownerId);
    return res.json({ success: true, ...result });
  } catch (err) {
    return registry.handleError(res, err);
  }
});

router.post("/:ownerId/admin-action", async (req, res) => {
  try {
    const admin = registry.authenticateSuperAdmin(req);
    const { ownerId } = req.params;
    const action = req.body?.action;
    const reason = req.body?.reason;
    const result = await registry.adminAction({
      ownerId,
      action,
      reason,
      actor: admin.actor,
      idempotencyKey: idempotencyKey(req),
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return registry.handleError(res, err);
  }
});

module.exports = router;
