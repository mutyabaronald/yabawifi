const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();
const { createRouterUserForPurchase } = require('../services/routerIntegrations');
const { nanoid } = require('nanoid');

router.post('/:ownerId', async (req, res) => {
  try {
    const ownerId = req.params.ownerId;
    const { name, price, durationMinutes, deviceLimit } = req.body;
    const doc = await admin.firestore().collection(`owners/${ownerId}/packages`).add({
      name, price, durationMinutes, deviceLimit: deviceLimit || 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ id: doc.id });
  } catch (e) {
    console.error('create package error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/:ownerId/purchase', async (req, res) => {
  try {
    const ownerId = req.params.ownerId;
    const { userId, packageId, routerType, routerId } = req.body;
    const pkgSnap = await admin.firestore().doc(`owners/${ownerId}/packages/${packageId}`).get();
    if (!pkgSnap.exists) return res.status(404).json({ error: 'package not found' });
    const pkg = pkgSnap.data();

    const paymentId = nanoid();
    await admin.firestore().doc(`payments/${paymentId}`).set({
      ownerId, userId, packageId, amount: pkg.price || 0, status: 'success', createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const routerResult = await createRouterUserForPurchase({ ownerId, userId, pkg, routerType, routerId });
    res.json({ ok: true, routerResult, paymentId });
  } catch (e) {
    console.error('purchase error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;


