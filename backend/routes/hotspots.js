const express = require("express");
const router = express.Router();
const { db } = require("../firebase");
const { v4: uuidv4 } = require("uuid");
const registry = require("../services/roamingRegistryService");

function publicHotspot(d) {
  const h = d.data() || {};
  return {
    id: d.id,
    hotspotName: h.hotspotName || null,
    ssid: h.ssid || null,
    latitude: h.latitude || null,
    longitude: h.longitude || null,
    status: h.status || "online",
  };
}

function ownerHotspotProjection(d) {
  const h = d.data() || {};
  return {
    id: d.id,
    hotspotName: h.hotspotName || null,
    address: h.address || null,
    location: h.address || h.location || null,
    latitude: h.latitude || null,
    longitude: h.longitude || null,
    status: h.status || "online",
    routerType: h.routerType || null,
    routerId: h.routerId || null,
    mac: h.mac || null,
    hotspotType: h.hotspotType || null,
    deviceId: h.deviceId || null,
    deviceName: h.deviceName || null,
    reviewsEnabled: h.reviewsEnabled || false,
    loyalty_program_enabled: h.loyalty_program_enabled !== undefined ? h.loyalty_program_enabled : true,
    createdAt: h.createdAt || null,
  };
}

// GET /api/hotspots
// Lightweight list endpoint (used by some dashboards/health checks)
router.get("/", async (req, res) => {
  try {
    const snap = await db.collection("hotspots").limit(100).get();
    const hotspots = snap.docs.map(publicHotspot);
    res.json({ success: true, hotspots });
  } catch (err) {
    console.error("Hotspots list error:", err?.message || err);
    res.status(500).json({ success: false, hotspots: [] });
  }
});

// POST /api/hotspots/create
router.post("/create", async (req, res) => {
  try {
    const {
      ownerId,
      hotspotName,
      address,
      ssid,
      routerType,
      latitude,
      longitude,
      // Phase 8.5A: binds this hotspot to the router that will enforce it.
      deviceId,
    } = req.body;
    if (!ownerId || !hotspotName || !address || !routerType) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields." });
    }

    // A hotspot may only be bound to a device owned by the SAME owner. Without
    // this check, any owner could point a hotspot at another owner's router and
    // have YabaLink write HotSpot users onto a device it does not control.
    let resolvedDeviceId = null;
    if (deviceId !== undefined && deviceId !== null && deviceId !== "") {
      const deviceSnap = await db
        .collection("devices")
        .doc(String(deviceId))
        .get();
      if (!deviceSnap.exists) {
        return res
          .status(404)
          .json({ success: false, message: "Device not found." });
      }
      const device = deviceSnap.data() || {};
      if (String(device.ownerId) !== String(ownerId)) {
        return res.status(403).json({
          success: false,
          message: "That device belongs to another owner.",
        });
      }
      resolvedDeviceId = deviceSnap.id;
    }

    const integrationKey = uuidv4();
    // Get owner's reviews setting
    const ownerDoc = await db.collection("owners").doc(ownerId).get();
    const ownerData = ownerDoc.exists ? ownerDoc.data() : {};

    const docRef = await db.collection("hotspots").add({
      ownerId,
      hotspotName,
      address,
      ssid: ssid || null,
      routerType,
      latitude: typeof latitude === "number" ? latitude : null,
      longitude: typeof longitude === "number" ? longitude : null,
      status: "online",
      integrationKey,
      // Phase 8.5A: which router enforces this hotspot. Null for hotspots that
      // are not yet bound to a router. A future router-control adapter resolves
      // enforcement through this field, so a hotspot can never be enforced on a
      // router other than the one its owner registered.
      deviceId: resolvedDeviceId,
      createdAt: new Date().toISOString(),
      loyalty_program_enabled: true,
      reviewsEnabled: ownerData.reviewsEnabled || false,
    });
    const captivePortalUrl = `${process.env.PORTAL_BASE_URL || "http://localhost:5173"}/?hotspotId=${docRef.id}`;
    res.json({ success: true, id: docRef.id, captivePortalUrl });
  } catch (err) {
    console.error("Hotspot create error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create hotspot." });
  }
});

// GET /api/hotspots/owner/:ownerId
router.get("/owner/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;

    // Authenticate owner or super-admin
    let auth;
    try {
      auth = await registry.authenticateOwnerOrSuper(req);
    } catch (err) {
      if (err instanceof registry.RegistryError) {
        return res.status(err.status).json({
          success: false,
          error: err.code,
          message: err.message,
        });
      }
      throw err;
    }

    // Owner isolation: owners can only view their own hotspots
    if (auth.kind === "owner") {
      if (auth.ownerId !== ownerId) {
        return res.status(403).json({
          success: false,
          error: "unauthorized_scope",
          message: "You can only view your own hotspots",
        });
      }
    }

    const snap = await db
      .collection("hotspots")
      .where("ownerId", "==", ownerId)
      .get();
    const hotspots = snap.docs.map(ownerHotspotProjection);
    res.json({ hotspots });
  } catch (err) {
    console.error("Hotspots owner list error:", err?.message || err);
    res.status(500).json({ hotspots: [] });
  }
});

// Utility: Haversine distance in km
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// GET /api/hotspots/nearby?lat=..&lng=..&radiusKm=5
router.get("/nearby", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radiusKm = parseFloat(req.query.radiusKm || "5");
    if (isNaN(lat) || isNaN(lng)) {
      return res
        .status(400)
        .json({ success: false, message: "lat and lng are required" });
    }
    const snap = await db.collection("hotspots").get();
    const hotspots = [];
    for (const doc of snap.docs) {
      const h = doc.data();
      if (typeof h.latitude === "number" && typeof h.longitude === "number") {
        const distanceKm = haversineKm(lat, lng, h.latitude, h.longitude);
        if (distanceKm <= radiusKm) {
          // Fetch packages for this hotspot
          let packages = [];
          try {
            const pSnap = await db
              .collection("packages")
              .where("hotspotId", "==", doc.id)
              .get();
            packages = pSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          } catch {}
          hotspots.push({
            id: doc.id,
            hotspotName: h.hotspotName,
            latitude: h.latitude,
            longitude: h.longitude,
            status: h.status || "online",
            distanceKm: Number(distanceKm.toFixed(2)),
            packages,
          });
        }
      }
    }
    // Sort by distance
    hotspots.sort((a, b) => a.distanceKm - b.distanceKm);
    res.json({ success: true, hotspots });
  } catch (err) {
    console.error("Nearby hotspots error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to load nearby hotspots" });
  }
});

// Get hotspot details by ID (for captive portal)
router.get("/:hotspotId", async (req, res) => {
  const { hotspotId } = req.params;
  try {
    const doc = await db.collection("hotspots").doc(hotspotId).get();
    if (!doc.exists)
      return res.status(404).json({ error: "Hotspot not found" });

    const h = doc.data() || {};
    res.json({
      success: true,
      hotspot: {
        id: doc.id,
        hotspotName: h.hotspotName || null,
        address: h.address || null,
        location: h.address || h.location || null,
        latitude: h.latitude || null,
        longitude: h.longitude || null,
        status: h.status || "online",
        reviewsEnabled: h.reviewsEnabled || false,
      },
    });
  } catch (err) {
    console.error("Hotspot fetch error:", err?.message || err);
    res.status(500).json({ error: "Failed to fetch hotspot" });
  }
});
module.exports = router;
