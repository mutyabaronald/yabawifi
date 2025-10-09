const express = require("express");
const router = express.Router();
const { db } = require("../firebase");
const { v4: uuidv4 } = require("uuid");

// POST /api/hotspots/create
router.post("/create", async (req, res) => {
  try {
    const { ownerId, hotspotName, address, ssid, routerType, latitude, longitude } = req.body;
    if (!ownerId || !hotspotName || !address || !routerType) {
      return res.status(400).json({ success: false, message: "Missing required fields." });
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
      latitude: typeof latitude === 'number' ? latitude : null,
      longitude: typeof longitude === 'number' ? longitude : null,
      status: 'online',
      integrationKey,
      createdAt: new Date().toISOString(),
      loyalty_program_enabled: true,
      reviewsEnabled: ownerData.reviewsEnabled || false,
    });
    const captivePortalUrl = `${process.env.PORTAL_BASE_URL || 'http://localhost:5173'}/?hotspotId=${docRef.id}`;
    res.json({ success: true, id: docRef.id, captivePortalUrl });
  } catch (err) {
    console.error("Hotspot create error:", err);
    res.status(500).json({ success: false, message: "Failed to create hotspot." });
  }
});

// GET /api/hotspots/owner/:ownerId
router.get("/owner/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const snap = await db.collection("hotspots").where("ownerId", "==", ownerId).get();
    const hotspots = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ hotspots });
  } catch (err) {
    res.status(500).json({ hotspots: [] });
  }
});
// Get hotspot details by ID (for captive portal)
router.get("/:hotspotId", async (req, res) => {
  const { hotspotId } = req.params;
  try {
    const doc = await db.collection("hotspots").doc(hotspotId).get();
    if (!doc.exists) return res.status(404).json({ error: "Hotspot not found" });
    
    const hotspotData = doc.data();
    res.json({ 
      success: true, 
      hotspot: {
        id: doc.id,
        ...hotspotData,
        location: hotspotData.address, // Use address as location for display
        latitude: hotspotData.latitude,
        longitude: hotspotData.longitude,
        reviewsEnabled: hotspotData.reviewsEnabled || false
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch hotspot" });
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
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// GET /api/hotspots/nearby?lat=..&lng=..&radiusKm=5
router.get("/nearby", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radiusKm = parseFloat(req.query.radiusKm || '5');
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, message: "lat and lng are required" });
    }
    const snap = await db.collection("hotspots").get();
    const hotspots = [];
    for (const doc of snap.docs) {
      const h = doc.data();
      if (typeof h.latitude === 'number' && typeof h.longitude === 'number') {
        const distanceKm = haversineKm(lat, lng, h.latitude, h.longitude);
        if (distanceKm <= radiusKm) {
          // Fetch packages for this hotspot
          let packages = [];
          try {
            const pSnap = await db.collection("packages").where("hotspotId", "==", doc.id).get();
            packages = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          } catch {}
          hotspots.push({
            id: doc.id,
            ownerId: h.ownerId,
            hotspotName: h.hotspotName,
            latitude: h.latitude,
            longitude: h.longitude,
            status: h.status || 'online',
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
    res.status(500).json({ success: false, message: "Failed to load nearby hotspots" });
  }
});
module.exports = router;
