const admin = require('firebase-admin');
const { Client: SSHClient } = require('ssh2');
const { RouterOSClient } = require('node-routeros');
let Unifi;
try { Unifi = require('unifi-client'); } catch (_) { Unifi = null; }

async function createRouterUserForPurchase({ ownerId, userId, pkg, routerType, routerId }) {
  const deviceLimit = pkg.deviceLimit || 1;
  if (routerType === 'mikrotik') return await createMikrotikUser({ ownerId, userId, deviceLimit });
  if (routerType === 'unifi') return await createUnifiUser({ ownerId, userId, deviceLimit, routerId });
  if (routerType === 'openwrt') return await createOpenWrtUser({ ownerId, userId, deviceLimit, routerId });
  throw new Error('unknown routerType');
}

async function createMikrotikUser({ ownerId, userId, deviceLimit }) {
  const conn = new RouterOSClient({
    host: process.env.MIKROTIK_HOST,
    user: process.env.MIKROTIK_USER,
    password: process.env.MIKROTIK_PASS,
    timeout: 5000
  });
  await conn.connect();
  const username = `u-${userId}`;
  const password = Math.random().toString(36).slice(2,10);
  await conn.menu('/ip/hotspot/user').call('add', { name: username, password, 'shared-users': deviceLimit });
  await conn.close();
  await admin.firestore().collection('routerUsers').add({
    username, password, platform: 'mikrotik', deviceLimit, appUserId: userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { platform: 'mikrotik', username };
}

async function createUnifiUser({ ownerId, userId, deviceLimit, routerId }) {
  const username = `u-${userId}`;
  const password = Math.random().toString(36).slice(2,10);
  if (Unifi) {
    try {
      const controller = new Unifi.Controller({
        host: process.env.UNIFI_CONTROLLER,
        username: process.env.UNIFI_USER,
        password: process.env.UNIFI_PASS,
        strictSSL: false
      });
      await controller.login();
      // TODO: find/create user group with maxStations=deviceLimit and create guest user
      await controller.logout();
    } catch (e) {
      console.warn('UniFi integration placeholder - adjust to your controller and library', e.message);
    }
  }
  await admin.firestore().collection('routerUsers').add({
    username, password, platform: 'unifi', deviceLimit, group: `devicecap-${deviceLimit}`, appUserId: userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { platform: 'unifi', username };
}

async function createOpenWrtUser({ ownerId, userId, deviceLimit, routerId }) {
  const username = `u-${userId}`;
  const password = Math.random().toString(36).slice(2,10);
  const conn = new SSHClient();
  return new Promise((resolve, reject) => {
    conn.on('ready', () => {
      const cmd = `echo '${username} Cleartext-Password := "${password}", Simultaneous-Use := "${deviceLimit}"' >> /etc/freeradius/users && /etc/init.d/freeradius restart`;
      conn.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        stream.on('close', () => {
          conn.end();
          admin.firestore().collection('routerUsers').add({
            username, password, platform: 'openwrt', deviceLimit, appUserId: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          }).then(() => resolve({ platform: 'openwrt', username }));
        });
      });
    }).connect({
      host: process.env.OPENWRT_SSH_HOST,
      port: 22,
      username: process.env.OPENWRT_SSH_USER,
      password: process.env.OPENWRT_SSH_PASS
    });
  });
}

module.exports = { createRouterUserForPurchase };


