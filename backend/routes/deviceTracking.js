// routes/deviceTracking.js
const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();

// POST /api/devices/connect
// body: { userId, macAddress, userAgent, deviceName, ipAddress, routerId }
router.post('/connect', async (req, res) => {
  try {
    const { userId, macAddress, userAgent, deviceName, ipAddress, routerId } = req.body;
    if (!userId || !macAddress) return res.status(400).json({ error: 'missing userId or macAddress' });

    const deviceId = macAddress.toUpperCase();
    const deviceRef = admin.firestore().doc(`users/${userId}/devices/${deviceId}`);

    await deviceRef.set({
      macAddress: deviceId,
      deviceName: deviceName || null,
      userAgent: userAgent || null,
      ipAddress: ipAddress || null,
      routerId: routerId || null,
      firstSeen: admin.firestore.FieldValue.serverTimestamp(),
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      connectionCount: admin.firestore.FieldValue.increment(1),
      status: 'online'
    }, { merge: true });

    return res.json({ ok: true });
  } catch (e) {
    console.error('connect error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/devices/disconnect
// body: { userId, macAddress }
router.post('/disconnect', async (req, res) => {
  try {
    const { userId, macAddress } = req.body;
    if (!userId || !macAddress) return res.status(400).json({ error: 'missing params' });

    const deviceId = macAddress.toUpperCase();
    const deviceRef = admin.firestore().doc(`users/${userId}/devices/${deviceId}`);
    await deviceRef.update({
      status: 'offline',
      lastSeen: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('disconnect error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// GET /api/devices/owner/:ownerId
// returns all devices for users that belong to owner
router.get('/owner/:ownerId', async (req, res) => {
  try {
    const ownerId = req.params.ownerId;
    const usersSnap = await admin.firestore().collection('users').where('ownerId', '==', ownerId).get();
    const out = [];
    for (const u of usersSnap.docs) {
      const devicesSnap = await admin.firestore().collection(`users/${u.id}/devices`).get();
      devicesSnap.forEach(d => out.push({ userId: u.id, id: d.id, ...d.data() }));
    }
    res.json(out);
  } catch (e) {
    console.error('owner devices error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// GET /api/devices/owner/:ownerId/stats
// returns device statistics for owner
router.get('/owner/:ownerId/stats', async (req, res) => {
  try {
    const ownerId = req.params.ownerId;
    const usersSnap = await admin.firestore().collection('users').where('ownerId', '==', ownerId).get();
    
    let totalDevices = 0;
    let onlineDevices = 0;
    const deviceTypes = {};
    const hotspotDevices = {};
    
    for (const u of usersSnap.docs) {
      const devicesSnap = await admin.firestore().collection(`users/${u.id}/devices`).get();
      devicesSnap.forEach(d => {
        const device = d.data();
        totalDevices++;
        if (device.status === 'online') onlineDevices++;
        
        // Categorize device type
        const userAgent = device.userAgent || '';
        let type = 'Unknown';
        if (userAgent.includes('Mobile') || userAgent.includes('Android') || userAgent.includes('iPhone')) {
          type = 'Mobile';
        } else if (userAgent.includes('Windows') || userAgent.includes('Macintosh') || userAgent.includes('Linux')) {
          type = 'Laptop';
        } else if (userAgent.includes('iPad') || userAgent.includes('Tablet')) {
          type = 'Tablet';
        } else if (userAgent.includes('Desktop')) {
          type = 'Desktop';
        }
        deviceTypes[type] = (deviceTypes[type] || 0) + 1;
        
        // Group by hotspot
        const hotspotId = device.routerId || 'unknown';
        hotspotDevices[hotspotId] = (hotspotDevices[hotspotId] || 0) + 1;
      });
    }
    
    res.json({
      totalDevices,
      onlineDevices,
      deviceTypes,
      hotspotDevices
    });
  } catch (e) {
    console.error('owner device stats error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;

