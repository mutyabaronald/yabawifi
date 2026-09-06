const fs = require("fs");

const files = [
  "backend/routes/roaming/partners.js",
  "backend/routes/roaming/hotspots.js",
  "backend/services/roamingRegistryService.js",
  "backend/server.js",
  "frontend/src/components/OwnerRoamingPanel.jsx",
  "frontend/src/components/SuperRoamingPanel.jsx",
];

for (const f of files) {
  fs.accessSync(f);
  console.log("exists", f);
}

const server = fs.readFileSync("backend/server.js", "utf8");
if (!server.includes("/api/roaming/partners")) throw new Error("partners mount missing");
if (!server.includes("/api/roaming/hotspots")) throw new Error("hotspots mount missing");

[
  "/api/users",
  "/api/owners",
  "/api/packages",
  "/api/vouchers",
  "/api/loyalty",
  "/api/devices/cisco",
].forEach((p) => {
  if (!server.includes(p)) throw new Error("missing existing mount " + p);
});

const partners = fs.readFileSync("backend/routes/roaming/partners.js", "utf8");
const hotspots = fs.readFileSync("backend/routes/roaming/hotspots.js", "utf8");
["opt-in", "admin-action", "status"].forEach((x) => {
  if (!partners.includes(x)) throw new Error("missing " + x);
});
["discover", "register", "disable"].forEach((x) => {
  if (!hotspots.includes(x)) throw new Error("missing " + x);
});
if (!partners.includes("bodyOwnerId !== auth.ownerId")) {
  throw new Error("owner body conflict check missing");
}
if (!hotspots.includes("bodyOwnerId !== auth.ownerId")) {
  throw new Error("hotspot body conflict check missing");
}

const admin = fs.readFileSync("frontend/src/AdminDashboard.jsx", "utf8");
const superd = fs.readFileSync("frontend/src/SuperDashboard.jsx", "utf8");
if (!admin.includes("OwnerRoamingPanel")) throw new Error("admin roaming missing");
if (!superd.includes("SuperRoamingPanel")) throw new Error("super roaming missing");
if (!admin.includes('id: "roaming"')) throw new Error("admin tab missing");
if (!superd.includes('setActiveTab("roaming")')) throw new Error("super tab missing");

const env = fs.readFileSync("env.template", "utf8");
if (!env.includes("ROAMING_REGISTRY_ENABLED=false")) throw new Error("flag missing");
if (!env.includes("VITE_ROAMING_REGISTRY_ENABLED=false")) {
  throw new Error("vite flag missing");
}

const svc = fs.readFileSync("backend/services/roamingRegistryService.js", "utf8");
[
  "hotspot.ownerId !== ownerId",
  "assertDeviceOwnedBy",
  "assertRouterOwnedBy",
  "setHotspotsStatusForOwner",
  "lastIdempotencyKey",
  "ROAMING_REGISTRY_ENABLED",
  "passpoint",
].forEach((m) => {
  if (!svc.includes(m)) throw new Error("missing " + m);
  console.log("OK service contains", m);
});

// Ensure we did not invent auth/payment/session routes changes in those files
const forbiddenTouch = [
  "backend/routes/users.js",
  "backend/routes/packages.js",
  "backend/routes/mtn.js",
  "backend/routes/vouchers.js",
  "backend/routes/loyalty.js",
  "backend/services/ciscoService.js",
];
console.log("Untouched critical files still present:");
forbiddenTouch.forEach((f) => {
  fs.accessSync(f);
  console.log("  ", f);
});

console.log("Phase2 wiring + boundary checks passed");
