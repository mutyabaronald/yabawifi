// syncDevices.js - Simple device sync worker for testing
// This simulates device connections for testing the device tracking system
require('dotenv').config();
const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(require('./serviceAccountKey.json')),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const POLL_SECONDS = 30; // Poll every 30 seconds for testing

// Simulate device connections for testing
async function simulateDeviceConnections() {
  try {
    console.log('Simulating device connections...');
    
    // Get all owners
    const ownersSnap = await admin.firestore().collection('owners').get();
    
    for (const ownerDoc of ownersSnap.docs) {
      const ownerId = ownerDoc.id;
      
      // Get users for this owner
      const usersSnap = await admin.firestore().collection('users').where('ownerId', '==', ownerId).get();
      
      if (usersSnap.empty) continue;
      
      // Simulate 1-3 random device connections per owner
      const numDevices = Math.floor(Math.random() * 3) + 1;
      
      for (let i = 0; i < numDevices; i++) {
        const userDoc = usersSnap.docs[Math.floor(Math.random() * usersSnap.docs.length)];
        const userId = userDoc.id;
        
        // Generate random device data
        const deviceTypes = ['Mobile', 'Laptop', 'Tablet', 'Desktop'];
        const userAgents = [
          'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15'
        ];
        
        const macAddress = generateMacAddress();
        const deviceName = `Device ${Math.floor(Math.random() * 1000)}`;
        const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
        const ipAddress = generateIpAddress();
        const status = Math.random() > 0.3 ? 'online' : 'offline'; // 70% chance online
        
        const deviceRef = admin.firestore().doc(`users/${userId}/devices/${macAddress}`);
        
        await deviceRef.set({
          macAddress,
          deviceName,
          userAgent,
          ipAddress,
          routerId: `hotspot-${Math.floor(Math.random() * 3) + 1}`,
          firstSeen: admin.firestore.FieldValue.serverTimestamp(),
          lastSeen: admin.firestore.FieldValue.serverTimestamp(),
          connectionCount: admin.firestore.FieldValue.increment(1),
          status
        }, { merge: true });
        
        console.log(`Simulated device ${macAddress} for user ${userId} (${status})`);
      }
    }
    
    console.log('Device simulation complete');
  } catch (error) {
    console.error('Error simulating devices:', error);
  }
}

function generateMacAddress() {
  const chars = '0123456789ABCDEF';
  let mac = '';
  for (let i = 0; i < 6; i++) {
    if (i > 0) mac += ':';
    mac += chars[Math.floor(Math.random() * 16)];
    mac += chars[Math.floor(Math.random() * 16)];
  }
  return mac;
}

function generateIpAddress() {
  return `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

// Run simulation
console.log('Starting device sync worker...');
simulateDeviceConnections();

// Run every POLL_SECONDS
setInterval(simulateDeviceConnections, POLL_SECONDS * 1000);

