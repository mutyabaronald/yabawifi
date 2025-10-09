// server.js (experiments/device-limits)
require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const app = express();
app.use(bodyParser.json());

app.use('/api/devices', require('./routes/devices'));
app.use('/api/packages', require('./routes/packages'));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('Device-limits server listening on', PORT));


