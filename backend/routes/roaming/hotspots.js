const express = require("express");
const router = express.Router();
const registry = require("../../services/roamingRegistryService");

function idempotencyKey(req) {
  return req.get("Idempotency-Key") || req.body?.idempotencyKey || null;
}

router.get("/discover", async (req, res) => {
  try {
    const result = await registry.discoverHotspots();
    return res.json({ success: true, ...result });
  } catch (err) {
    return registry.handleError(res, err);
  }
});

router.post("/register", async (req, res) => {
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
    const result = await registry.registerHotspot({
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

router.post("/:hotspotId/disable", async (req, res) => {
  try {
    const auth = await registry.authenticateOwner(req);
    const result = await registry.disableHotspot({
      ownerId: auth.ownerId,
      hotspotId: req.params.hotspotId,
      actor: auth.actor,
      idempotencyKey: idempotencyKey(req),
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return registry.handleError(res, err);
  }
});

module.exports = router;
