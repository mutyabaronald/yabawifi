require('dotenv').config();
const admin = require('firebase-admin');
const { RouterOSClient } = require('node-routeros');
const { Client: SSHClient } = require('ssh2');
let Unifi; try { Unifi = require('unifi-client'); } catch (_) { Unifi = null; }

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

async function pollMikrotik() {
  try {
    const conn = new RouterOSClient({ host: process.env.MIKROTIK_HOST, user: process.env.MIKROTIK_USER, password: process.env.MIKROTIK_PASS, timeout: 5000 });
    await conn.connect();
    const clients = await conn.menu('/ip/hotspot/active').call('print');
    await conn.close();
    return clients.map(c => ({
      mac: (c['mac-address'] || '').toUpperCase(),
      ip: c.address,
      user: c.user,
      hostname: c['host-name'] || null,
      routerId: process.env.MIKROTIK_HOST
    }));
  } catch (e) {
    console.error('mikrotik poll error', e.message);
    return [];
  }
}

async function pollUnifi() { return []; }

async function pollOpenWrt() {
  try {
    const conn = new SSHClient();
    return await new Promise((resolve, reject) => {
      conn.on('ready', () => {
        conn.exec('cat /tmp/dhcp.leases', (err, stream) => {
          if (err) return reject(err);
          let data = '';
          stream.on('data', d => data += d.toString());
          stream.on('close', () => {
            conn.end();
            const lines = data.trim().split('\n').filter(Boolean);
            resolve(lines.map(l => {
              const parts = l.split(/\s+/);
              return { mac: (parts[1] || '').toUpperCase(), ip: parts[2] || '', hostname: parts[3] || null, routerId: process.env.OPENWRT_SSH_HOST };
            }));
          });
        });
      }).connect({ host: process.env.OPENWRT_SSH_HOST, port: 22, username: process.env.OPENWRT_SSH_USER, password: process.env.OPENWRT_SSH_PASS });
    });
  } catch (e) {
    console.error('openwrt poll error', e.message);
    return [];
  }
}

async function writeClientsToFirestore(clients) {
  for (const c of clients) {
    try {
      let userId = null;
      if (c.user) {
        const mappingSnap = await admin.firestore().collection('routerUsers').where('username','==',c.user).limit(1).get();
        if (!mappingSnap.empty) userId = mappingSnap.docs[0].data().appUserId || null;
      }
      if (!userId) {
        const usersWithIp = await admin.firestore().collectionGroup('devices').where('ipAddress','==',c.ip).get().catch(()=>({ empty: true }));
        if (usersWithIp && !usersWithIp.empty) userId = usersWithIp.docs[0].ref.parent.path.split('/')[1];
      }
      if (!userId) continue;

      const mac = c.mac.toUpperCase();
      const ref = admin.firestore().doc(`users/${userId}/devices/${mac}`);
      await ref.set({ macAddress: mac, deviceName: c.hostname || null, ipAddress: c.ip || null, routerId: c.routerId, userAgent: null, firstSeen: admin.firestore.FieldValue.serverTimestamp(), lastSeen: admin.firestore.FieldValue.serverTimestamp(), connectionCount: admin.firestore.FieldValue.increment(1), status: 'online' }, { merge: true });
    } catch (e) { console.error('write client error', e.message); }
  }
}

async function main() {
  const mik = await pollMikrotik(); await writeClientsToFirestore(mik);
  const uni = await pollUnifi(); if (uni.length) await writeClientsToFirestore(uni);
  const ow = await pollOpenWrt(); await writeClientsToFirestore(ow);
}

main();
setInterval(main, (parseInt(process.env.POLL_INTERVAL_SECONDS || '15', 10)) * 1000);


