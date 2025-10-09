const express = require("express");
const router = express.Router();

const { db } = require("./firebase");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.SUPERADMIN_JWT_SECRET || "dev-super-secret";

function verifySuperAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Missing token" });
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || payload.role !== "superadmin") {
      return res.status(403).json({ message: "Unauthorized access" });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// KPIs for Super Admin master dashboard
router.get("/api/super/kpis", verifySuperAdmin, async (req, res) => {
  try {
    // Revenue from receipts
    const receiptsSnap = await db.collection("receipts").get();
    let revenueToday = 0, revenueWeek = 0, revenueMonth = 0, revenueYear = 0;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
    const monthAgo = new Date(now); monthAgo.setMonth(now.getMonth() - 1);
    const yearAgo = new Date(now); yearAgo.setFullYear(now.getFullYear() - 1);

    receiptsSnap.forEach((doc) => {
      const r = doc.data();
      const amt = Number(r.amount) || 0;
      const t = r.time ? new Date(r.time) : null;
      if (!t || Number.isNaN(t.getTime())) return;
      if (t >= startOfToday) revenueToday += amt;
      if (t >= weekAgo) revenueWeek += amt;
      if (t >= monthAgo) revenueMonth += amt;
      if (t >= yearAgo) revenueYear += amt;
    });

    // Active hotspots (basic count; adjust if you track status)
    let activeHotspots = 0;
    try {
      const routersSnap = await db.collection("routers").get();
      activeHotspots = routersSnap.size;
    } catch {}

    // Sessions and usage
    let activeUsers = 0; let usageMb = 0; let sessionCount = 0;
    try {
      const sessionsSnap = await db.collection("sessions").get();
      sessionCount = sessionsSnap.size;
      sessionsSnap.forEach((d) => { usageMb += Number(d.data().mbUsed) || 0; });
      // If you track active flags, replace with a query; for now equal to sessions today
      sessionsSnap.forEach((d) => {
        const t = d.data().startTime ? new Date(d.data().startTime) : null;
        if (t && t >= startOfToday) activeUsers += 1;
      });
    } catch {}

    // Owner signups (last 30 days)
    let ownerSignups = 0;
    try {
      const ownersSnap = await db.collection("owners").get();
      const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);
      ownersSnap.forEach((d) => {
        const createdAt = d.data().createdAt ? new Date(d.data().createdAt) : null;
        if (createdAt && createdAt >= thirtyDaysAgo) ownerSignups += 1;
      });
    } catch {}

    res.json({
      revenueToday, revenueWeek, revenueMonth, revenueYear,
      activeHotspots, activeUsers, ownerSignups, usageMb, sessionCount,
    });
  } catch (err) {
    console.error("KPIs error:", err);
    res.status(500).json({ error: "Failed to load KPIs" });
  }
});

// Commission and revenue summary derived from receipts collection
router.get("/api/super/commission", verifySuperAdmin, async (req, res) => {
  try {
    // Use dynamic commission rate if present on receipts; otherwise default 25
    const DEFAULT_RATE = 25;
    const snap = await db.collection("receipts").get();
    let totalCommission = 0;
    const summary = {};

    snap.forEach((doc) => {
      const r = doc.data();
      const ownerId = r.ownerId || "unknown";
      const amount = Number(r.amount) || 0;
      const commission = Number(r.commission) || Math.round((amount * (Number(r.commissionRate) || DEFAULT_RATE)) / 100);
      totalCommission += commission;

      if (!summary[ownerId]) {
        summary[ownerId] = { total: 0, commission: 0 };
      }
      summary[ownerId].total += amount;
      summary[ownerId].commission += commission;
    });

    // Platform wallet balance
    let platformBalance = 0;
    try {
      const platformDoc = await db.collection("wallets").doc("platform").get();
      if (platformDoc.exists) platformBalance = Number(platformDoc.data().balance) || 0;
    } catch {}

    res.json({ summary, totalCommission, commissionRate: DEFAULT_RATE, platformBalance });
  } catch (err) {
    console.error("Commission summary error:", err);
    res.status(500).json({ error: "Failed to compute commission" });
  }
});

// Super Admin payout account settings
router.get("/api/super/payout-account", verifySuperAdmin, async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("super_payout_account").get();
    return res.json({ account: doc.exists ? doc.data() : null });
  } catch (e) {
    return res.status(500).json({ message: "Failed to fetch payout account" });
  }
});

router.post("/api/super/payout-account", verifySuperAdmin, async (req, res) => {
  try {
    const { accountType, provider, accountNumber, accountName } = req.body || {};
    if (!accountType || !provider) {
      return res.status(400).json({ message: "accountType and provider are required" });
    }
    // Persist optional accountNumber/accountName if provided, but not required by UI
    await db.collection("settings").doc("super_payout_account").set({
      accountType,
      provider,
      ...(accountNumber ? { accountNumber } : {}),
      ...(accountName ? { accountName } : {}),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ message: "Failed to save payout account" });
  }
});

// Platform settings: commission, default packages, business rules
router.get("/api/super/settings", verifySuperAdmin, async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("platform_settings").get();
    const data = doc.exists ? doc.data() : {};
    return res.json({
      commissionRate: typeof data.commissionRate === 'number' ? data.commissionRate : 25,
      defaultPackages: Array.isArray(data.defaultPackages) ? data.defaultPackages : [],
      businessRules: data.businessRules || { minPrice: 500, taxPercent: 0, paymentProvider: 'MTN MOMO' },
    });
  } catch (e) {
    return res.status(500).json({ message: "Failed to fetch settings" });
  }
});

router.post("/api/super/settings", verifySuperAdmin, async (req, res) => {
  try {
    const { commissionRate, defaultPackages, businessRules } = req.body || {};
    const payload = {};
    if (typeof commissionRate === 'number') payload.commissionRate = commissionRate;
    if (Array.isArray(defaultPackages)) payload.defaultPackages = defaultPackages;
    if (businessRules && typeof businessRules === 'object') payload.businessRules = businessRules;
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ message: "No valid settings provided" });
    }
    payload.updatedAt = new Date().toISOString();
    await db.collection("settings").doc("platform_settings").set(payload, { merge: true });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ message: "Failed to save settings" });
  }
});

// Platform wallet view
router.get("/api/super/wallet", verifySuperAdmin, async (req, res) => {
  try {
    const doc = await db.collection("wallets").doc("platform").get();
    if (!doc.exists) return res.json({ balance: 0, transactions: [] });
    const data = doc.data();
    return res.json({ balance: Number(data.balance) || 0, transactions: data.transactions || [] });
  } catch (e) {
    return res.status(500).json({ message: "Failed to load wallet" });
  }
});

// Owners registry from owners collection
router.get("/api/super/owners", verifySuperAdmin, async (req, res) => {
  try {
    const snap = await db.collection("owners").get();
    const owners = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.ownerName || "",
        phone: data.ownerPhone || "",
        logoUrl: data.logoUrl || "",
        email: data.ownerEmail || "",
        suspended: !!data.suspended,
        createdAt: data.createdAt || null,
      };
    });
    res.json({ owners });
  } catch (err) {
    console.error("Owners list error:", err);
    res.status(500).json({ error: "Failed to fetch owners" });
  }
});

// Create owner (minimal fields)
router.post("/api/super/owners", verifySuperAdmin, async (req, res) => {
  try {
    const { ownerName, ownerEmail, ownerPhone, businessName } = req.body || {};
    if (!ownerName || !ownerPhone) {
      return res.status(400).json({ message: "ownerName and ownerPhone are required" });
    }
    const doc = await db.collection("owners").add({
      ownerName,
      ownerEmail: ownerEmail || null,
      ownerPhone,
      businessName: businessName || null,
      suspended: false,
      createdAt: new Date().toISOString(),
    });
    // Audit log
    await db.collection("audit_logs").add({
      actor: req.user?.uid || 'superadmin',
      action: 'owner.create',
      ownerId: doc.id,
      at: new Date().toISOString(),
      payload: { ownerName, ownerPhone },
    });
    res.json({ success: true, id: doc.id });
  } catch (e) {
    res.status(500).json({ message: "Failed to create owner" });
  }
});

// Suspend/unsuspend owner
router.post("/api/super/owners/:ownerId/suspend", verifySuperAdmin, async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { suspended, reason } = req.body || {};
    if (typeof suspended !== 'boolean') return res.status(400).json({ message: "suspended boolean required" });
    await db.collection("owners").doc(ownerId).set({ suspended, suspendedReason: reason || null, suspendedAt: new Date().toISOString() }, { merge: true });
    await db.collection("audit_logs").add({
      actor: req.user?.uid || 'superadmin',
      action: suspended ? 'owner.suspend' : 'owner.unsuspend',
      ownerId,
      at: new Date().toISOString(),
      payload: { reason: reason || null },
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: "Failed to update owner status" });
  }
});

// Soft delete owner
router.delete("/api/super/owners/:ownerId", verifySuperAdmin, async (req, res) => {
  try {
    const { ownerId } = req.params;
    await db.collection("owners").doc(ownerId).set({ deleted: true, deletedAt: new Date().toISOString() }, { merge: true });
    await db.collection("audit_logs").add({
      actor: req.user?.uid || 'superadmin',
      action: 'owner.delete',
      ownerId,
      at: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: "Failed to delete owner" });
  }
});

// Devices overview (routers + hotspots)
router.get("/api/super/devices", verifySuperAdmin, async (req, res) => {
  try {
    const routersSnap = await db.collection("routers").get();
    const hotspotsSnap = await db.collection("hotspots").get();
    const ownersMap = new Map();
    try {
      const ownersSnap = await db.collection("owners").get();
      ownersSnap.forEach((d)=> ownersMap.set(d.id, d.data().ownerName || ''));
    } catch {}
    const devices = [];
    routersSnap.forEach((d) => {
      const r = d.data();
      devices.push({
        id: d.id,
        type: 'router',
        ownerId: r.ownerId || null,
        ownerName: ownersMap.get(r.ownerId) || '',
        alias: r.alias || '',
        location: r.location || '',
        ssid: r.ssid || '',
        macAddress: r.macAddress || '',
        status: r.status || 'online',
        updatedAt: r.updatedAt || null,
      });
    });
    hotspotsSnap.forEach((d) => {
      const h = d.data();
      devices.push({
        id: d.id,
        type: 'hotspot',
        ownerId: h.ownerId || null,
        ownerName: ownersMap.get(h.ownerId) || '',
        alias: h.hotspotName || '',
        location: h.address || '',
        ssid: h.ssid || '',
        status: h.status || 'online',
        updatedAt: h.createdAt || null,
      });
    });
    res.json({ devices });
  } catch (e) {
    res.status(500).json({ message: "Failed to load devices" });
  }
});

// Audit logs
router.get("/api/super/audit-logs", verifySuperAdmin, async (req, res) => {
  try {
    const snap = await db.collection("audit_logs").orderBy("at", "desc").limit(200).get();
    const logs = snap.docs.map((d)=> ({ id: d.id, ...d.data() }));
    res.json({ logs });
  } catch (e) {
    res.status(500).json({ message: "Failed to load audit logs" });
  }
});

// Alerts settings (basic)
router.get("/api/super/alerts-settings", verifySuperAdmin, async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("alerts_settings").get();
    const data = doc.exists ? doc.data() : {};
    res.json({
      emails: Array.isArray(data.emails) ? data.emails : [],
      slackWebhookUrl: data.slackWebhookUrl || '',
      thresholds: data.thresholds || { downHotspotMinutes: 30 },
    });
  } catch (e) {
    res.status(500).json({ message: "Failed to load alerts settings" });
  }
});

router.post("/api/super/alerts-settings", verifySuperAdmin, async (req, res) => {
  try {
    const { emails, slackWebhookUrl, thresholds } = req.body || {};
    const payload = {};
    if (Array.isArray(emails)) payload.emails = emails;
    if (typeof slackWebhookUrl === 'string') payload.slackWebhookUrl = slackWebhookUrl;
    if (thresholds && typeof thresholds === 'object') payload.thresholds = thresholds;
    if (Object.keys(payload).length === 0) return res.status(400).json({ message: "No valid fields" });
    payload.updatedAt = new Date().toISOString();
    await db.collection("settings").doc("alerts_settings").set(payload, { merge: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: "Failed to save alerts settings" });
  }
});

// Sites management for owners
router.get("/api/super/sites/:ownerId", verifySuperAdmin, async (req, res) => {
  try {
    const { ownerId } = req.params;
    const snap = await db.collection("hotspots").where("ownerId", "==", ownerId).get();
    const sites = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ sites });
  } catch (e) {
    res.status(500).json({ message: "Failed to load sites" });
  }
});

router.post("/api/super/sites/:ownerId", verifySuperAdmin, async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { hotspotName, address, ssid, routerType, latitude, longitude } = req.body || {};
    if (!hotspotName || !address) return res.status(400).json({ message: "hotspotName and address required" });
    const doc = await db.collection("hotspots").add({
      ownerId,
      hotspotName,
      address,
      ssid: ssid || null,
      routerType: routerType || 'unknown',
      latitude: typeof latitude === 'number' ? latitude : null,
      longitude: typeof longitude === 'number' ? longitude : null,
      status: 'online',
      createdAt: new Date().toISOString(),
    });
    await db.collection("audit_logs").add({
      actor: req.user?.uid || 'superadmin',
      action: 'site.create',
      ownerId,
      siteId: doc.id,
      at: new Date().toISOString(),
      payload: { hotspotName, address },
    });
    res.json({ success: true, id: doc.id });
  } catch (e) {
    res.status(500).json({ message: "Failed to create site" });
  }
});

// Global search across owners, devices, sites
router.get("/api/super/search", verifySuperAdmin, async (req, res) => {
  try {
    const { q, type } = req.query;
    if (!q || q.length < 2) return res.json({ results: [] });
    
    const searchTerm = q.toLowerCase();
    const results = [];
    
    // Search owners
    if (!type || type === 'owners') {
      const ownersSnap = await db.collection("owners").get();
      ownersSnap.forEach((d) => {
        const data = d.data();
        const name = (data.ownerName || '').toLowerCase();
        const email = (data.ownerEmail || '').toLowerCase();
        const phone = (data.ownerPhone || '').toLowerCase();
        if (name.includes(searchTerm) || email.includes(searchTerm) || phone.includes(searchTerm)) {
          results.push({
            type: 'owner',
            id: d.id,
            title: data.ownerName || 'Unnamed Owner',
            subtitle: data.ownerEmail || data.ownerPhone || '',
            data: { ...data, suspended: !!data.suspended }
          });
        }
      });
    }
    
    // Search hotspots/sites
    if (!type || type === 'sites') {
      const hotspotsSnap = await db.collection("hotspots").get();
      hotspotsSnap.forEach((d) => {
        const data = d.data();
        const name = (data.hotspotName || '').toLowerCase();
        const address = (data.address || '').toLowerCase();
        const ssid = (data.ssid || '').toLowerCase();
        if (name.includes(searchTerm) || address.includes(searchTerm) || ssid.includes(searchTerm)) {
          results.push({
            type: 'site',
            id: d.id,
            title: data.hotspotName || 'Unnamed Site',
            subtitle: data.address || '',
            data: { ...data, ownerId: data.ownerId }
          });
        }
      });
    }
    
    // Search routers/devices
    if (!type || type === 'devices') {
      const routersSnap = await db.collection("routers").get();
      routersSnap.forEach((d) => {
        const data = d.data();
        const alias = (data.alias || '').toLowerCase();
        const location = (data.location || '').toLowerCase();
        const ssid = (data.ssid || '').toLowerCase();
        const mac = (data.macAddress || '').toLowerCase();
        if (alias.includes(searchTerm) || location.includes(searchTerm) || ssid.includes(searchTerm) || mac.includes(searchTerm)) {
          results.push({
            type: 'device',
            id: d.id,
            title: data.alias || 'Unnamed Router',
            subtitle: data.location || data.ssid || '',
            data: { ...data, ownerId: data.ownerId }
          });
        }
      });
    }
    
    res.json({ results: results.slice(0, 50) }); // Limit to 50 results
  } catch (e) {
    res.status(500).json({ message: "Search failed" });
  }
});

// Owner detail view with comprehensive stats
router.get("/api/super/owners/:ownerId/details", verifySuperAdmin, async (req, res) => {
  try {
    const { ownerId } = req.params;
    
    // Get owner data
    const ownerDoc = await db.collection("owners").doc(ownerId).get();
    if (!ownerDoc.exists) return res.status(404).json({ message: "Owner not found" });
    const owner = { id: ownerDoc.id, ...ownerDoc.data() };
    
    // Get sites
    const sitesSnap = await db.collection("hotspots").where("ownerId", "==", ownerId).get();
    const sites = sitesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Get routers
    const routersSnap = await db.collection("routers").where("ownerId", "==", ownerId).get();
    const routers = routersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Get revenue stats
    const receiptsSnap = await db.collection("receipts").where("ownerId", "==", ownerId).get();
    const receipts = receiptsSnap.docs.map(d => d.data());
    const totalRevenue = receipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const totalCommission = receipts.reduce((sum, r) => sum + (Number(r.commission) || 0), 0);
    
    // Get packages
    const packagesSnap = await db.collection("packages").where("ownerId", "==", ownerId).get();
    const packages = packagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Get recent sessions (if available)
    const sessionsSnap = await db.collection("sessions").where("ownerId", "==", ownerId).limit(100).get();
    const sessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    res.json({
      owner,
      stats: {
        sitesCount: sites.length,
        routersCount: routers.length,
        packagesCount: packages.length,
        totalRevenue,
        totalCommission,
        sessionsCount: sessions.length,
        lastActivity: sessions.length > 0 ? sessions[sessions.length - 1]?.startTime : null
      },
      sites,
      routers,
      packages: packages.slice(0, 10), // Recent packages
      recentSessions: sessions.slice(0, 20) // Recent sessions
    });
  } catch (e) {
    res.status(500).json({ message: "Failed to load owner details" });
  }
});

// Health monitoring dashboard
router.get("/api/super/health", verifySuperAdmin, async (req, res) => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // System health metrics
    const health = {
      timestamp: now.toISOString(),
      services: {
        database: 'healthy', // Assume healthy if we can query
        payments: 'healthy', // MTN integration status
        notifications: 'healthy'
      },
      metrics: {
        totalOwners: 0,
        totalSites: 0,
        totalDevices: 0,
        activeSessions: 0,
        revenueLast24h: 0,
        alertsCount: 0
      },
      alerts: []
    };
    
    // Count totals
    const ownersSnap = await db.collection("owners").get();
    health.metrics.totalOwners = ownersSnap.size;
    
    const sitesSnap = await db.collection("hotspots").get();
    health.metrics.totalSites = sitesSnap.size;
    
    const routersSnap = await db.collection("routers").get();
    health.metrics.totalDevices = routersSnap.size;
    
    // Revenue last 24h
    const receiptsSnap = await db.collection("receipts").get();
    receiptsSnap.forEach((d) => {
      const r = d.data();
      const time = r.time ? new Date(r.time) : null;
      if (time && time >= oneDayAgo) {
        health.metrics.revenueLast24h += Number(r.amount) || 0;
      }
    });
    
    // Check for offline sites (basic check)
    sitesSnap.forEach((d) => {
      const site = d.data();
      if (site.status === 'offline') {
        health.alerts.push({
          type: 'site_offline',
          severity: 'warning',
          message: `Site ${site.hotspotName} is offline`,
          siteId: d.id,
          ownerId: site.ownerId
        });
      }
    });
    
    health.metrics.alertsCount = health.alerts.length;
    
    res.json(health);
  } catch (e) {
    res.status(500).json({ message: "Failed to load health data" });
  }
});

// Users registry from users collection
router.get("/api/super/users", verifySuperAdmin, async (req, res) => {
  try {
    const snap = await db.collection("users").limit(1000).get();
    const users = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        phone: data.phone || "",
        email: data.email || "",
        createdAt: data.createdAt || "",
      };
    });
    res.json({ users });
  } catch (err) {
    console.error("Users list error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Reports: payouts, commissions, statuses (basic)
router.get("/api/super/reports", verifySuperAdmin, async (req, res) => {
  try {
    const splitsSnap = await db.collection("payout_splits").orderBy("createdAt", "desc").limit(200).get();
    const transfersSnap = await db.collection("payout_transfers").orderBy("settledAt", "desc").limit(200).get();
    const splits = splitsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const transfers = transfersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const totals = splits.reduce((acc, s) => {
      acc.gross += Number(s.grossAmount) || 0;
      acc.commission += Number(s.commissionAmount) || 0;
      acc.net += Number(s.netAmount) || 0;
      return acc;
    }, { gross: 0, commission: 0, net: 0 });
    res.json({ totals, splits, transfers });
  } catch (e) {
    res.status(500).json({ message: "Failed to load reports" });
  }
});

// CSV export for super admin reports
router.get("/api/super/reports/export/csv", verifySuperAdmin, async (req, res) => {
  try {
    const splitDocs = await db.collection("payout_splits").orderBy("createdAt", "desc").limit(1000).get();
    const rows = ["ownerId,gross,commission,net,packageName,createdAt"]; 
    splitDocs.forEach((d) => {
      const s = d.data();
      rows.push(`${s.ownerId || ''},${s.grossAmount || 0},${s.commissionAmount || 0},${s.netAmount || 0},${(s.packageName||'').replace(/,/g,';')},${s.createdAt}`);
    });
    const csv = rows.join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=super_reports.csv");
    res.send(csv);
  } catch (e) {
    res.status(500).send("Failed to export CSV");
  }
});

// Super Admin contact information for support (public endpoint - no auth required)
router.get("/api/super/contact-info", async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("super_contact_info").get();
    if (!doc.exists) {
      // Return default contact info if none is set
      return res.json({
        phone: "07xxxxxxxxxx",
        whatsapp: "07xxxxxxxxxx",
        email: "ronaldmutyaba256@gmail.com"
      });
    }
    return res.json(doc.data());
  } catch (e) {
    console.error("Contact info fetch error:", e);
    return res.status(500).json({ 
      message: "Failed to fetch contact information",
      phone: "07xxxxxxxxxx",
      whatsapp: "07xxxxxxxxxx", 
      email: "ronaldmutyaba256@gmail.com"
    });
  }
});

// Super Admin contact information management (requires superadmin auth)
router.get("/api/super/contact-info/manage", verifySuperAdmin, async (req, res) => {
  try {
    const doc = await db.collection("settings").doc("super_contact_info").get();
    return res.json({ contactInfo: doc.exists ? doc.data() : null });
  } catch (e) {
    return res.status(500).json({ message: "Failed to fetch contact information" });
  }
});

router.post("/api/super/contact-info/manage", verifySuperAdmin, async (req, res) => {
  try {
    const { phone, whatsapp, email } = req.body || {};
    if (!phone || !whatsapp || !email) {
      return res.status(400).json({ message: "All contact fields are required" });
    }
    
    await db.collection("settings").doc("super_contact_info").set({
      phone,
      whatsapp,
      email,
      updatedAt: new Date().toISOString(),
    });
    
    return res.json({ success: true, message: "Contact information updated successfully" });
  } catch (e) {
    return res.status(500).json({ message: "Failed to save contact information" });
  }
});

// ✅ Export router so it can be mounted in server.js
module.exports = router;
