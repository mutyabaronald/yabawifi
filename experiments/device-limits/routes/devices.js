const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();

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

router.post('/disconnect', async (req, res) => {
  try {
    const { userId, macAddress } = req.body;
    if (!userId || !macAddress) return res.status(400).json({ error: 'missing params' });
    const deviceId = macAddress.toUpperCase();
    const deviceRef = admin.firestore().doc(`users/${userId}/devices/${deviceId}`);
    await deviceRef.update({ status: 'offline', lastSeen: admin.firestore.FieldValue.serverTimestamp() });
    return res.json({ ok: true });
  } catch (e) {
    console.error('disconnect error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

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

module.exports = router;


