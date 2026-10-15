const express = require("express");
const router = express.Router();
const { db } = require("../../firebase");
const registry = require("../../services/roamingRegistryService");
const { listOwnerSessions, RoamingSessionError } = require("../../services/roamingSessionService");
const {
  SETTLEMENT_COLLECTION,
  SETTLEMENT_STATUS,
  RoamingSettlementError,
} = require("../../services/roamingSettlementService");
const { checkEnforcementHealth, RoamingEnforcementError } = require("../../services/roamingEnforcementService");

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const DEFAULT_HOTSPOT_LIMIT = 500;

function parseLimit(value, def = DEFAULT_LIMIT) {
  let n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    n = def;
  }
  return Math.min(n, MAX_LIMIT);
}

function parseCursor(value) {
  return value && typeof value === "string" ? value : null;
}

function parseDate(value) {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function handleError(res, err) {
  if (err instanceof RoamingSessionError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }
  if (err instanceof RoamingSettlementError) {
    return res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }
  if (err instanceof RoamingEnforcementError) {
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
  console.error("[roaming-admin] unexpected error:", err);
  return res.status(500).json({
    success: false,
    error: "internal_error",
    message: err && err.message ? err.message : "Internal server error",
  });
}

async function authenticateSuperAdmin(req) {
  return registry.authenticateSuperAdmin(req);
}

function projectSessionForAdmin(session) {
  return {
    id: session.id,
    sessionId: session.sessionId || session.id,
    userRef: session.userRef ? { userId: session.userRef.userId } : null,
    homeOwnerId: session.homeOwnerId,
    visitedOwnerId: session.visitedOwnerId,
    visitedHotspotId: session.visitedHotspotId,
    entitlementId: session.entitlementId,
    agreementId: session.agreementId,
    authPath: session.authPath,
    aaaAdapterKey: session.aaaAdapterKey,
    radiusProfileId: session.radiusProfileId,
    status: session.status,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    expiresAt: session.expiresAt,
    usedMinutes: session.usedMinutes,
    usedMegabytes: session.usedMegabytes,
    endedAt: session.endedAt,
    endReason: session.endReason,
    billedMinutes: session.billedMinutes,
    lastBilledAt: session.lastBilledAt,
    tokenJti: session.tokenJti,
    idempotencyKey: session.idempotencyKey,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function projectSettlementForAdmin(settlement) {
  return {
    id: settlement.id,
    idempotencyKey: settlement.idempotencyKey,
    entitlementId: settlement.entitlementId,
    sessionId: settlement.sessionId,
    homeOwnerId: settlement.homeOwnerId,
    visitedOwnerId: settlement.visitedOwnerId,
    visitedHotspotId: settlement.visitedHotspotId,
    consumedRaus: settlement.consumedRaus,
    rateNumerator: settlement.rateNumerator,
    rateDenominator: settlement.rateDenominator,
    settlementAmount: settlement.settlementAmount,
    billingCursor: settlement.billingCursor,
    status: settlement.status,
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
  };
}

function projectHotspotForAdmin(hotspot) {
  return {
    id: hotspot.id,
    hotspotId: hotspot.hotspotId,
    ownerId: hotspot.ownerId,
    partnerStatus: hotspot.partnerStatus,
    enforcementMode: hotspot.enforcementMode,
    aaaAdapterKey: hotspot.aaaAdapterKey,
    capabilities: hotspot.capabilities,
    networkIdentity: hotspot.networkIdentity,
    deviceLink: hotspot.deviceLink,
    radiusProfileId: hotspot.radiusProfileId,
    passpointProfileId: hotspot.passpointProfileId,
    roamingConsortiumOis: hotspot.roamingConsortiumOis,
    naiRealms: hotspot.naiRealms,
    anqpVenueInfo: hotspot.anqpVenueInfo,
    createdAt: hotspot.createdAt,
    updatedAt: hotspot.updatedAt,
  };
}

router.get("/sessions", async (req, res) => {
  try {
    await authenticateSuperAdmin(req);

    const {
      status,
      visitedOwnerId,
      homeOwnerId,
      entitlementId,
      startAfter,
      endBefore,
      cursor,
      limit,
    } = req.query;

    const lim = parseLimit(limit);
    const cursorDoc = cursor ? await db.collection("roaming_sessions").doc(cursor).get() : null;

    let query = db.collection("roaming_sessions").orderBy("createdAt", "desc").limit(lim + 1);

    if (status) {
      const validStatuses = ["authorized", "active", "terminated", "expired", "revoked"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: "validation_error",
          message: `Invalid status. Allowed: ${validStatuses.join(", ")}`,
        });
      }
      query = query.where("status", "==", status);
    }

    if (visitedOwnerId) {
      query = query.where("visitedOwnerId", "==", visitedOwnerId);
    }

    if (homeOwnerId) {
      query = query.where("homeOwnerId", "==", homeOwnerId);
    }

    if (entitlementId) {
      query = query.where("entitlementId", "==", entitlementId);
    }

    const startAfterDate = parseDate(startAfter);
    const endBeforeDate = parseDate(endBefore);

    if (startAfterDate) {
      query = query.where("createdAt", ">=", startAfterDate);
    }
    if (endBeforeDate) {
      query = query.where("createdAt", "<=", endBeforeDate);
    }

    const snap = await query.get();
    let sessions = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    if (cursorDoc && cursorDoc.exists) {
      const cursorCreatedAt = cursorDoc.data().createdAt;
      sessions = sessions.filter((s) => s.createdAt < cursorCreatedAt);
    }

    const hasMore = sessions.length > lim;
    if (hasMore) sessions = sessions.slice(0, lim);

    const projected = sessions.map(projectSessionForAdmin);
    const nextCursor = hasMore && sessions.length > 0 ? sessions[sessions.length - 1].id : null;

    return res.json({
      success: true,
      count: projected.length,
      hasMore,
      nextCursor,
      sessions: projected,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get("/summary", async (req, res) => {
  try {
    await authenticateSuperAdmin(req);

    const { startAfter, endBefore } = req.query;
    const startAfterDate = parseDate(startAfter);
    const endBeforeDate = parseDate(endBefore);

    let query = db.collection("roaming_sessions").limit(DEFAULT_LIMIT);

    if (startAfterDate) {
      query = query.where("createdAt", ">=", startAfterDate);
    }
    if (endBeforeDate) {
      query = query.where("createdAt", "<=", endBeforeDate);
    }

    const snap = await query.get();
    const sessions = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const byStatus = {};
    const byVisitedOwner = {};
    const byHomeOwner = {};
    let totalBilledMinutes = 0;
    let totalActive = 0;
    let totalSessions = sessions.length;

    for (const s of sessions) {
      const status = s.status || "unknown";
      byStatus[status] = (byStatus[status] || 0) + 1;

      if (s.visitedOwnerId) {
        byVisitedOwner[s.visitedOwnerId] = (byVisitedOwner[s.visitedOwnerId] || 0) + 1;
      }
      if (s.homeOwnerId) {
        byHomeOwner[s.homeOwnerId] = (byHomeOwner[s.homeOwnerId] || 0) + 1;
      }

      const billed = Number(s.billedMinutes);
      if (Number.isFinite(billed) && billed > 0) {
        totalBilledMinutes += billed;
      }

      if (s.status === "active" || s.status === "authorized") {
        totalActive++;
      }
    }

    return res.json({
      success: true,
      summary: {
        totalSessions,
        totalActive,
        totalBilledMinutes,
        byStatus,
        byVisitedOwner: Object.entries(byVisitedOwner)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
        byHomeOwner: Object.entries(byHomeOwner)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
        window: {
          startAfter: startAfterDate || null,
          endBefore: endBeforeDate || null,
        },
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get("/settlements", async (req, res) => {
  try {
    await authenticateSuperAdmin(req);

    const {
      homeOwnerId,
      visitedOwnerId,
      entitlementId,
      status,
      cursor,
      limit,
    } = req.query;

    const lim = parseLimit(limit);
    const cursorDoc = cursor ? await db.collection(SETTLEMENT_COLLECTION).doc(cursor).get() : null;

    let query = db.collection(SETTLEMENT_COLLECTION).orderBy("createdAt", "desc").limit(lim + 1);

    if (status) {
      if (!SETTLEMENT_STATUS.includes(status)) {
        return res.status(400).json({
          success: false,
          error: "validation_error",
          message: `Invalid status. Allowed: ${SETTLEMENT_STATUS.join(", ")}`,
        });
      }
      query = query.where("status", "==", status);
    }

    if (homeOwnerId) {
      query = query.where("homeOwnerId", "==", homeOwnerId);
    }

    if (visitedOwnerId) {
      query = query.where("visitedOwnerId", "==", visitedOwnerId);
    }

    if (entitlementId) {
      query = query.where("entitlementId", "==", entitlementId);
    }

    const snap = await query.get();
    let settlements = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    if (cursorDoc && cursorDoc.exists) {
      const cursorCreatedAt = cursorDoc.data().createdAt;
      settlements = settlements.filter((s) => s.createdAt < cursorCreatedAt);
    }

    const hasMore = settlements.length > lim;
    if (hasMore) settlements = settlements.slice(0, lim);

    const projected = settlements.map(projectSettlementForAdmin);
    const nextCursor = hasMore && settlements.length > 0 ? settlements[settlements.length - 1].id : null;

    return res.json({
      success: true,
      count: projected.length,
      hasMore,
      nextCursor,
      settlements: projected,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get("/hotspots", async (req, res) => {
  try {
    await authenticateSuperAdmin(req);

    const {
      ownerId,
      partnerStatus,
      adapterKey,
      limit,
      includeHealth,
    } = req.query;

    const lim = parseLimit(limit, DEFAULT_HOTSPOT_LIMIT);

    let query = db.collection("roaming_hotspots").orderBy("createdAt", "desc").limit(lim);

    if (ownerId) {
      query = query.where("ownerId", "==", ownerId);
    }

    if (partnerStatus) {
      const validStatuses = ["active", "disabled", "suspended"];
      if (!validStatuses.includes(partnerStatus)) {
        return res.status(400).json({
          success: false,
          error: "validation_error",
          message: `Invalid partnerStatus. Allowed: ${validStatuses.join(", ")}`,
        });
      }
      query = query.where("partnerStatus", "==", partnerStatus);
    }

    const snap = await query.get();
    let hotspots = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    if (adapterKey) {
      const validAdapters = ["mikrotik", "cisco", "unifi", "tplink", "radius", "unknown"];
      if (!validAdapters.includes(adapterKey)) {
        return res.status(400).json({
          success: false,
          error: "validation_error",
          message: `Invalid adapterKey. Allowed: ${validAdapters.join(", ")}`,
        });
      }
      hotspots = hotspots.filter((h) => h.aaaAdapterKey === adapterKey);
    }

    const healthCache = new Map();
    const includeHealthFlag = includeHealth === "true";

    const projected = await Promise.all(
      hotspots.slice(0, lim).map(async (h) => {
        const base = projectHotspotForAdmin(h);
        if (includeHealthFlag && h.aaaAdapterKey && h.aaaAdapterKey !== "unknown") {
          const cached = healthCache.get(h.aaaAdapterKey);
          if (cached !== undefined) {
            base.enforcementHealth = cached;
          } else {
            try {
              const health = await checkEnforcementHealth(h.aaaAdapterKey);
              healthCache.set(h.aaaAdapterKey, health);
              base.enforcementHealth = health;
            } catch (e) {
              healthCache.set(h.aaaAdapterKey, { healthy: false, error: e.message });
              base.enforcementHealth = { healthy: false, error: e.message };
            }
          }
        } else {
          base.enforcementHealth = { checked: false };
        }
        return base;
      })
    );

    return res.json({
      success: true,
      count: projected.length,
      hotspots: projected,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

module.exports = router;