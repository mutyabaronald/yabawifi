// Sample metrics client for posting router telemetry
// Run this on your router or a local machine to simulate real metrics

const API_BASE = "http://localhost:5000/api/routers";
const ROUTER_ID = "ROUTER_123"; // Change this to your actual router ID

// Simulate getting real metrics from your router
function getActiveUsersEstimate() {
  // Replace with your router's actual active user count
  // This could come from SNMP, router API, or other monitoring tools
  return Math.floor(Math.random() * 10) + 1;
}

function measureAvgSpeedMbps() {
  // Replace with real speed measurement from your router
  // This could be average throughput, connection quality, etc.
  return 15 + Math.floor(Math.random() * 15);
}

function getDeviceType() {
  // Replace with actual device detection from your router
  // Many routers can detect device types via DHCP or connection logs
  const options = ["Android", "iOS", "Windows", "Mac", "Linux", "Other"];
  return options[Math.floor(Math.random() * options.length)];
}

function getRouterInfo() {
  // Replace with actual router information
  return {
    ssid: "YabaHotspot",
    macAddress: "AA:BB:CC:DD:EE:FF", // Your router's MAC address
    location: "Kampala, Uganda",
  };
}

async function postMetric() {
  const routerInfo = getRouterInfo();
  
  const payload = {
    activeUsers: getActiveUsersEstimate(),
    avgSpeedMbps: measureAvgSpeedMbps(),
    downtimeMin: 0, // Set to actual downtime if tracked
    device: getDeviceType(),
    ssid: routerInfo.ssid,
    macAddress: routerInfo.macAddress,
  };

  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(ROUTER_ID)}/ingest-metric`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log(`✅ Metric posted at ${new Date().toISOString()}:`, payload);
    } else {
      const error = await response.text();
      console.error(`❌ Failed to post metric:`, error);
    }
  } catch (error) {
    console.error("❌ Network error posting metric:", error.message);
  }
}

// Post initial metric
postMetric();

// Post metric every minute
setInterval(postMetric, 60 * 1000);

console.log(`🚀 Metrics client started for router ${ROUTER_ID}`);
console.log(`📊 Posting metrics every 60 seconds to ${API_BASE}`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Metrics client stopped');
  process.exit(0);
});

// Example of how to integrate with real router data:
/*
// If you have SNMP access to your router:
const snmp = require('net-snmp');

function getRealRouterMetrics() {
  const session = snmp.createSession("192.168.1.1", "public");
  
  // Example OIDs for common router metrics
  const oids = [
    "1.3.6.1.2.1.2.2.1.10.1", // Interface InOctets
    "1.3.6.1.2.1.2.2.1.16.1", // Interface OutOctets
    "1.3.6.1.2.1.25.3.3.1.2.1", // CPU usage
  ];
  
  session.get(oids, (error, varbinds) => {
    if (error) {
      console.error("SNMP error:", error);
      return;
    }
    
    // Process varbinds and calculate real metrics
    const realPayload = {
      activeUsers: calculateActiveUsers(varbinds),
      avgSpeedMbps: calculateSpeed(varbinds),
      downtimeMin: 0,
      device: "Mixed", // or detect from DHCP leases
      ssid: "YourSSID",
      macAddress: "YourRouterMAC",
    };
    
    // Post real metrics instead of simulated ones
    postRealMetric(realPayload);
  });
}

// If you have access to router logs:
function parseRouterLogs() {
  // Read router log files or syslog
  // Parse for connection events, device types, etc.
  // Extract real metrics and post them
}

// If you have router API access:
async function getRouterAPIMetrics() {
  try {
    const response = await fetch('http://192.168.1.1/api/status');
    const data = await response.json();
    
    const realPayload = {
      activeUsers: data.wireless.clients || 0,
      avgSpeedMbps: data.wireless.signal || 20,
      downtimeMin: data.system.uptime || 0,
      device: "Mixed",
      ssid: data.wireless.ssid || "Unknown",
      macAddress: data.system.mac || "Unknown",
    };
    
    postRealMetric(realPayload);
  } catch (error) {
    console.error("Router API error:", error);
  }
}
*/
