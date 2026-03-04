const cron = require("node-cron");
const { db } = require("./firebase");
const { disconnectExpiredUsers } = require("./services/ciscoService");

async function processExpiredCiscoSessions() {
  const nowIso = new Date().toISOString();
  console.log(
    `[CiscoExpiryCron] Checking for expired Cisco voucher sessions at ${nowIso}`,
  );

  try {
    const snap = await db
      .collection("voucherSessions")
      .where("routerType", "==", "cisco")
      .where("status", "==", "active")
      .where("expiresAt", "<=", nowIso)
      .get();

    if (snap.empty) {
      return;
    }

    const byDevice = new Map();
    snap.forEach((doc) => {
      const data = doc.data();
      const devId = data.deviceId;
      if (!devId) return;
      if (!byDevice.has(devId)) byDevice.set(devId, []);
      byDevice.get(devId).push({ id: doc.id, ...data });
    });

    for (const [deviceId, sessions] of byDevice.entries()) {
      try {
        const devSnap = await db.collection("devices").doc(deviceId).get();
        if (!devSnap.exists) {
          console.warn(
            `[CiscoExpiryCron] Device ${deviceId} not found for expired sessions`,
          );
          continue;
        }

        const device = devSnap.data();
        const deviceConn = {
          ip: device.ip,
          sshPort: device.sshPort || 22,
          sshUser: device.sshUser,
          sshPassword: device.sshPassword,
          enablePassword: device.enablePassword,
        };

        const usernames = sessions.map((s) => s.username).filter(Boolean);
        if (usernames.length === 0) continue;

        console.log(
          `[CiscoExpiryCron] Disconnecting ${usernames.length} users on device ${deviceId} (${device.ip})`,
        );

        const result = await disconnectExpiredUsers(deviceConn, usernames);
        const perUser =
          (result && result.results) ||
          usernames.map((u) => ({ username: u, success: result.success }));

        const updatePromises = [];
        const disconnectedAt = new Date().toISOString();

        for (const session of sessions) {
          const match = perUser.find((r) => r.username === session.username);
          if (match && match.success) {
            console.log(
              `[CiscoExpiryCron] ✅ Disconnected ${session.username} on device ${deviceId}`,
            );
            updatePromises.push(
              db.collection("voucherSessions").doc(session.id).update({
                status: "expired",
                disconnectedAt,
              }),
            );
          } else {
            console.warn(
              `[CiscoExpiryCron] ❌ Failed to disconnect ${session.username} on device ${deviceId}`,
            );
          }
        }

        await Promise.all(updatePromises);
      } catch (err) {
        console.error(
          `[CiscoExpiryCron] Error processing device ${deviceId}:`,
          err,
        );
      }
    }
  } catch (err) {
    console.error("[CiscoExpiryCron] Top-level error:", err);
  }
}

// Run every 60 seconds
cron.schedule("* * * * *", processExpiredCiscoSessions);

module.exports = { processExpiredCiscoSessions };
