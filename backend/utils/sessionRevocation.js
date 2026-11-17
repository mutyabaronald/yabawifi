const { Timestamp } = require("firebase-admin/firestore");

async function revokeAllUserSessions(db, userPhone, firebaseUid, reason) {
  const MAX_BATCH = 500;
  let totalRevoked = 0;
  const errors = [];

  async function revokeByQuery(query) {
    let snap = await query.limit(MAX_BATCH).get();
    while (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach(doc => {
        batch.update(doc.ref, {
          revokedAt: Timestamp.now(),
          revokedReason: reason
        });
      });
      try {
        await batch.commit();
        totalRevoked += snap.docs.length;
      } catch (batchErr) {
        errors.push({
          batchSize: snap.docs.length,
          error: batchErr.message
        });
        // Continue to next batch instead of stopping
      }

      const lastDoc = snap.docs[snap.docs.length - 1];
      snap = await query.startAfter(lastDoc).limit(MAX_BATCH).get();
    }
  }

  if (userPhone) {
    await revokeByQuery(
      db.collection("user_sessions")
        .where("userPhone", "==", userPhone)
        .where("revokedAt", "==", null)
    );
  }

  if (firebaseUid) {
    await revokeByQuery(
      db.collection("user_sessions")
        .where("firebaseUid", "==", firebaseUid)
        .where("revokedAt", "==", null)
    );
  }

  return {
    revokedCount: totalRevoked,
    errors,
    success: errors.length === 0
  };
}

async function revokeSessionById(db, sessionId, reason) {
  const sessionRef = db.collection("user_sessions").doc(sessionId);
  const snap = await sessionRef.get();
  if (!snap.exists) {
    return false;
  }
  await sessionRef.update({
    revokedAt: Timestamp.now(),
    revokedReason: reason
  });
  return true;
}

module.exports = {
  revokeAllUserSessions,
  revokeSessionById
};