const express = require("express");
const router = express.Router();
const entitlementService = require("../../services/roamingEntitlementService");
const registryService = require("../../services/roamingRegistryService");

function idempotencyKey(req) {
  return req.get("Idempotency-Key") || req.body?.idempotencyKey || null;
}

// POST /api/roaming/entitlements - Create new entitlement
router.post("/", async (req, res) => {
  try {
    const auth = await registryService.authenticateOwner(req);
    
    // Verify homeOwnerId in body matches authenticated owner
    const bodyHomeOwnerId = req.body?.homeOwnerId;
    if (bodyHomeOwnerId && bodyHomeOwnerId !== auth.ownerId) {
      return res.status(403).json({
        success: false,
        error: "unauthorized_scope",
        message: "homeOwnerId in body does not match authenticated owner",
      });
    }

    const result = await entitlementService.createEntitlement({
      authenticatedOwnerId: auth.ownerId,
      payload: req.body || {},
      actor: auth.actor,
      idempotencyKey: idempotencyKey(req),
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    return entitlementService.handleError(res, err);
  }
});

// GET /api/roaming/entitlements - List entitlements
router.get("/", async (req, res) => {
  try {
    const auth = await registryService.authenticateOwnerOrSuper(req);

    const filters = {
      limit: parseInt(req.query.limit) || 100,
    };

    // Owners can only list their own entitlements
    if (auth.kind === "owner") {
      filters.homeOwnerId = auth.ownerId;
    } else if (req.query.homeOwnerId) {
      // Super-admin can filter by any homeOwnerId
      filters.homeOwnerId = req.query.homeOwnerId;
    }

    if (req.query.userId) {
      filters.userId = req.query.userId;
    }
    if (req.query.status) {
      filters.status = req.query.status;
    }

    const entitlements = await entitlementService.listEntitlements(filters);
    return res.json({ success: true, entitlements });
  } catch (err) {
    return entitlementService.handleError(res, err);
  }
});

// GET /api/roaming/entitlements/:entitlementId - Get specific entitlement
router.get("/:entitlementId", async (req, res) => {
  try {
    const auth = await registryService.authenticateOwnerOrSuper(req);
    const { entitlementId } = req.params;

    const entitlement = await entitlementService.getEntitlement(entitlementId);

    // Owners can only view their own entitlements
    if (auth.kind === "owner" && entitlement.homeOwnerId !== auth.ownerId) {
      return res.status(403).json({
        success: false,
        error: "unauthorized_scope",
        message: "Cannot view another owner's entitlement",
      });
    }

    return res.json({ success: true, entitlement });
  } catch (err) {
    return entitlementService.handleError(res, err);
  }
});

// PATCH /api/roaming/entitlements/:entitlementId - Update entitlement
router.patch("/:entitlementId", async (req, res) => {
  try {
    const auth = await registryService.authenticateOwner(req);
    const { entitlementId } = req.params;

    const result = await entitlementService.updateEntitlement({
      entitlementId,
      authenticatedOwnerId: auth.ownerId,
      payload: req.body || {},
      actor: auth.actor,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    return entitlementService.handleError(res, err);
  }
});

// POST /api/roaming/entitlements/:entitlementId/suspend - Suspend entitlement
router.post("/:entitlementId/suspend", async (req, res) => {
  try {
    const auth = await registryService.authenticateOwner(req);
    const { entitlementId } = req.params;

    const result = await entitlementService.suspendEntitlement({
      entitlementId,
      authenticatedOwnerId: auth.ownerId,
      reason: req.body?.reason,
      actor: auth.actor,
      idempotencyKey: idempotencyKey(req),
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    return entitlementService.handleError(res, err);
  }
});

// POST /api/roaming/entitlements/:entitlementId/revoke - Revoke entitlement
router.post("/:entitlementId/revoke", async (req, res) => {
  try {
    const auth = await registryService.authenticateOwner(req);
    const { entitlementId } = req.params;

    const result = await entitlementService.revokeEntitlement({
      entitlementId,
      authenticatedOwnerId: auth.ownerId,
      reason: req.body?.reason,
      actor: auth.actor,
      idempotencyKey: idempotencyKey(req),
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    return entitlementService.handleError(res, err);
  }
});

// POST /api/roaming/entitlements/:entitlementId/restore - Restore entitlement
router.post("/:entitlementId/restore", async (req, res) => {
  try {
    const auth = await registryService.authenticateOwner(req);
    const { entitlementId } = req.params;

    const result = await entitlementService.restoreEntitlement({
      entitlementId,
      authenticatedOwnerId: auth.ownerId,
      actor: auth.actor,
      idempotencyKey: idempotencyKey(req),
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    return entitlementService.handleError(res, err);
  }
});

// NOTE: Public eligibility endpoint removed for Phase 3 security.
// The checkEntitlementEligibility() function remains available in the service
// for internal use and will be exposed via proper federation authentication in Phase 4.
// Phase 4 will introduce trusted roaming credentials for cross-network eligibility checks.

module.exports = router;
