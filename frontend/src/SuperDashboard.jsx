import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ThemeToggle from "./components/ThemeToggle";

function SuperDashboard() {
  const navigate = useNavigate();

  // Navigation state
  const [activeTab, setActiveTab] = useState("dashboard");

  // Data state
  const [error, setError] = useState("");
  const [kpis, setKpis] = useState({});
  const [metrics, setMetrics] = useState({
    revenue: { today: 0, week: 0, month: 0, year: 0 },
    activeHotspots: 0,
    activeUsers: 0,
    ownerSignups: 0,
    usageMb: 0,
    sessionCount: 0,
  });
  const [accounts, setAccounts] = useState({ owners: [], users: [] });
  const [newOwner, setNewOwner] = useState({ ownerName: '', ownerPhone: '', ownerEmail: '', businessName: '' });
  const [devices, setDevices] = useState([]);
  const [commissionRate, setCommissionRate] = useState(10);
  const [defaultPackages, setDefaultPackages] = useState([
    { name: "1 Hour", price: 1000, type: "time" },
    { name: "1 GB", price: 2000, type: "data" },
    { name: "1 Day", price: 5000, type: "time" },
  ]);
  const [businessRules, setBusinessRules] = useState({ minPrice: 500, taxPercent: 0, paymentProvider: 'MTN MOMO' });
  const [wallet, setWallet] = useState({ balance: 0, transactions: [] });
  const [payoutAccount, setPayoutAccount] = useState({ accountType: "Mobile Money", provider: "MTN" });
  const [reports, setReports] = useState({ totals: { gross: 0, commission: 0, net: 0 }, splits: [], transfers: [] });
  const [contactInfo, setContactInfo] = useState({ phone: "07xxxxxxxxxx", whatsapp: "07xxxxxxxxxx", email: "support@example.com" });
  const [savingContact, setSavingContact] = useState(false);
  const [alertsSettings, setAlertsSettings] = useState({ emails: [], thresholds: { downHotspotMinutes: 30 } });
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [ownerSites, setOwnerSites] = useState([]);
  const [newSite, setNewSite] = useState({ hotspotName: '', address: '', ssid: '', routerType: 'unknown' });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [ownerDetails, setOwnerDetails] = useState(null);
  const [healthData, setHealthData] = useState(null);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [notifFilter, setNotifFilter] = useState('all');

  // Styles must be defined before usage
  const styles = {
    container: { 
      display: "flex", 
      minHeight: "100vh",
      position: "relative"
    },
    sidebar: {
      width: "220px",
      background: 'var(--sidebar-bg)',
      color: 'var(--sidebar-text)',
      padding: "20px 10px",
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      position: "fixed",
      left: 0,
      top: 0,
      zIndex: 1000,
      overflowY: "auto",
      overflowX: "hidden"
    },
    main: { 
      flex: 1,
      padding: "30px", 
      background: 'var(--surface-2)',
      color: 'var(--text-primary)',
      marginLeft: "220px",
      minHeight: "100vh"
    },
    button: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "12px 16px",
      background: "transparent",
      border: "none",
      color: "var(--sidebar-text)",
      cursor: "pointer",
      borderRadius: "8px",
      width: "100%",
      textAlign: "left",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s ease",
      marginBottom: "4px"
    },
    sidebarLogo: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      marginBottom: "16px",
      paddingBottom: "16px",
      borderBottom: "1px solid var(--stroke)",
    },
    sidebarLogoImage: {
      width: "32px",
      height: "32px",
      borderRadius: "8px",
      objectFit: "contain",
    },
    sidebarOwnerName: {
      fontSize: "16px",
      color: "var(--sidebar-text)",
      margin: "0",
    },
    // Enhanced Header Styles
    headerMetrics: {
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      '@media (max-width: 768px)': {
        gap: 12,
        flexWrap: 'wrap'
      }
    },
    metricCard: {
      textAlign: 'right',
      minWidth: '80px'
    },
    metricLabel: {
      fontSize: 12,
      color: 'var(--text-muted)',
      marginBottom: 2
    },
    metricValue: {
      fontWeight: 700,
      fontSize: 16
    },
    openFab: {
      position: 'fixed', left: 12, top: 12, zIndex: 1200, width: 44, height: 44, borderRadius: 10,
      border: '1px solid var(--stroke)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)', boxShadow: '0 4px 14px rgba(0,0,0,0.2)', cursor: 'pointer'
    },
    // Dashboard widgets
    statsGrid: {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20
    },
    statCard: {
      background: 'var(--surface-gradient)', padding: 16, borderRadius: 20, border: '1px solid var(--stroke)', boxShadow: '0 10px 20px rgba(0,0,0,0.35)', color: 'var(--text-primary)'
    },
    statLabel: { color: 'var(--text-muted)', fontSize: 12 },
    statValue: { fontSize: 26, fontWeight: 700, marginTop: 6, color: 'var(--text-primary)' },
    gridTwo: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
    widget: { background: 'var(--surface-gradient)', padding: 16, borderRadius: 20, border: '1px solid var(--stroke)', boxShadow: '0 10px 20px rgba(0,0,0,0.35)', color: 'var(--text-primary)' },
    widgetTitle: { margin: 0, marginBottom: 12, fontSize: 16, fontWeight: 600 },
    progressCard: { background: 'var(--surface)', padding: 12, borderRadius: 10, marginBottom: 10 },
    progressHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--text-primary)' },
    progressBarBg: { height: 10, background: 'var(--stroke)', borderRadius: 999 },
    progressBarFill: { height: 10, background: 'var(--accent)', borderRadius: 999 },

    // Tables & forms
    table: { display: 'grid', gap: 8 },
    trHeader: { display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1.5fr', gap: 8, padding: '10px 12px', background: 'var(--surface)', borderRadius: 8, fontWeight: 600 },
    tr: { display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1.5fr', gap: 8, padding: '10px 12px', background: 'var(--surface)', borderRadius: 8 },
    rowActions: { display: 'flex', gap: 8 },
    linkBtn: { background: 'transparent', border: '1px solid var(--stroke)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' },
    dangerLinkBtn: { background: 'var(--danger)', border: '1px solid var(--danger)', color: '#fff', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' },
    sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    searchInput: { padding: 10, border: '1px solid var(--stroke)', borderRadius: 8, width: 320 },
    input: { padding: 10, border: '1px solid var(--stroke)', borderRadius: 8 },
    formRow: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 },
    formRowInline: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
    tabsRow: { display: 'flex', gap: 8, marginBottom: 12 },
    tabBtn: { padding: '8px 12px', border: '1px solid var(--stroke)', borderRadius: 8, background: 'var(--surface)', cursor: 'pointer' },
    primaryBtnSmall: { padding: '10px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' },
    secondaryBtnSmall: { padding: '10px 14px', background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 8, cursor: 'pointer' },
    error: { color: 'tomato', marginBottom: 12 },
  };

  // Auth guard
  useEffect(() => {
    const token = localStorage.getItem("superToken");
    if (!token) {
      navigate("/superadmin/login");
    }
  }, [navigate]);

  // Suppress browser extension errors
  useEffect(() => {
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.error = (...args) => {
      const message = args[0]?.toString() || '';
      if (
        message.includes('runtime.lastError') ||
        message.includes('Could not establish connection') ||
        message.includes('message channel closed') ||
        message.includes('Receiving end does not exist') ||
        message.includes('Extension context invalidated')
      ) {
        return; // Suppress extension errors
      }
      originalError.apply(console, args);
    };

    console.warn = (...args) => {
      const message = args[0]?.toString() || '';
      if (
        message.includes('runtime.lastError') ||
        message.includes('Could not establish connection') ||
        message.includes('message channel closed') ||
        message.includes('Receiving end does not exist')
      ) {
        return; // Suppress extension warnings
      }
      originalWarn.apply(console, args);
    };

    // Also suppress unhandled promise rejections from extensions
    const handleUnhandledRejection = (event) => {
      const message = event.reason?.toString() || '';
      if (
        message.includes('runtime.lastError') ||
        message.includes('Could not establish connection') ||
        message.includes('message channel closed') ||
        message.includes('Receiving end does not exist')
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);


  // Fetch dashboard data (placeholders with graceful fallback)
  // Close notification menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showNotifMenu && !event.target.closest('[data-notification-menu]')) {
        setShowNotifMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifMenu]);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem("superToken");
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
        const [kpiRes, ownersRes, usersRes, walletRes, accountRes, reportsRes, contactManageRes, settingsRes, devicesRes, alertsRes, auditRes, healthRes] = await Promise.all([
          fetch("/api/super/kpis", { headers }).catch(() => null),
          fetch("/api/super/owners", { headers }).catch(() => null),
          fetch("/api/super/users", { headers }).catch(() => null),
          fetch("/api/super/wallet", { headers }).catch(() => null),
          fetch("/api/super/payout-account", { headers }).catch(() => null),
          fetch("/api/super/reports", { headers }).catch(() => null),
          fetch("/api/super/contact-info/manage", { headers: authHeaders }).catch(() => null),
          fetch("/api/super/settings", { headers }).catch(() => null),
          fetch("/api/super/devices", { headers }).catch(() => null),
          fetch("/api/super/alerts-settings", { headers }).catch(() => null),
          fetch("/api/super/audit-logs", { headers }).catch(() => null),
          fetch("/api/super/health", { headers }).catch(() => null),
        ]);

        if (kpiRes && kpiRes.status === 401) throw new Error("Unauthorized");
        const kpisData = (await kpiRes?.json()) || {};
        setKpis(kpisData);
        const ownersJson = await ownersRes?.json();
        const usersJson = await usersRes?.json();
        const walletJson = await walletRes?.json();
        const accountJson = await accountRes?.json();
        const reportsJson = await reportsRes?.json();
        const owners = ownersJson?.owners || [];
        const users = usersJson?.users || [];
        setWallet({ balance: walletJson?.balance || 0, transactions: walletJson?.transactions || [] });
        if (accountJson?.account) setPayoutAccount({
          accountType: accountJson.account.accountType || "Mobile Money",
          provider: accountJson.account.provider || "MTN",
        });
        if (reportsJson) setReports(reportsJson);
        try {
          const devicesJson = await devicesRes?.json();
          if (devicesJson?.devices) setDevices(devicesJson.devices);
        } catch {}
        try {
          const alertsJson = await alertsRes?.json();
          if (alertsJson) setAlertsSettings(alertsJson);
        } catch {}
        try {
          const auditJson = await auditRes?.json();
          if (auditJson?.logs) setAuditLogs(auditJson.logs);
        } catch {}
        try {
          const healthJson = await healthRes?.json();
          if (healthJson) setHealthData(healthJson);
        } catch {}

        // Load platform settings
        try {
          const settingsJson = await settingsRes?.json();
          if (settingsJson) {
            if (typeof settingsJson.commissionRate === 'number') setCommissionRate(settingsJson.commissionRate);
            if (Array.isArray(settingsJson.defaultPackages)) setDefaultPackages(settingsJson.defaultPackages);
            if (settingsJson.businessRules) setBusinessRules(settingsJson.businessRules);
          }
        } catch {}

        setMetrics({
          revenue: {
            today: kpisData.revenueToday || 0,
            week: kpisData.revenueWeek || 0,
            month: kpisData.revenueMonth || 0,
            year: kpisData.revenueYear || 0,
          },
          activeHotspots: kpisData.activeHotspots || 0,
          activeUsers: kpisData.activeUsers || 0,
          ownerSignups: kpisData.ownerSignups || 0,
          usageMb: kpisData.usageMb || 0,
          sessionCount: kpisData.sessionCount || 0,
        });
        setAccounts({ owners, users });

        // Load contact info for support section
        try {
          const contactJson = await contactManageRes?.json();
          if (contactJson?.contactInfo) {
            setContactInfo({
              phone: contactJson.contactInfo.phone || contactInfo.phone,
              whatsapp: contactJson.contactInfo.whatsapp || contactInfo.whatsapp,
              email: contactJson.contactInfo.email || contactInfo.email,
            });
          }
        } catch {}
      } catch (e) {
        if (String(e?.message || "").toLowerCase().includes("unauthorized")) {
          localStorage.removeItem("superToken");
          navigate("/superadmin/login");
          return;
        }
        setError("Failed to load dashboard data");
      }
    }
    load();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("superToken");
    localStorage.removeItem("adminEmail");
    navigate("/superadmin/login");
  };

  const performSearch = async (query) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const token = localStorage.getItem("superToken");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/super/search?q=${encodeURIComponent(query)}`, { headers });
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (e) {
      setSearchResults([]);
    }
  };

  const loadOwnerDetails = async (ownerId) => {
    try {
      const token = localStorage.getItem("superToken");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/super/owners/${ownerId}/details`, { headers });
      const data = await res.json();
      setOwnerDetails(data);
    } catch (e) {
      alert('Failed to load owner details');
    }
  };


  const Stat = ({ label, value }) => (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{Number(value).toLocaleString()}</div>
    </div>
  );

  const Progress = ({ label, percent }) => (
    <div style={styles.progressCard}>
      <div style={styles.progressHeader}>
        <span>{label}</span>
        <span>{Math.round(percent)}%</span>
      </div>
      <div style={styles.progressBarBg}>
        <div style={{ ...styles.progressBarFill, width: `${Math.max(0, Math.min(percent, 100))}%` }} />
      </div>
    </div>
  );

  function renderDashboard() {
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div className="yaba-card">
            <h3 className="yaba-card-title">Revenue (Today)</h3>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: 'var(--text-primary)' }}>
              UGX {Number(metrics.revenue.today).toLocaleString()}
            </div>
          </div>
          <div className="yaba-card">
            <h3 className="yaba-card-title">Revenue (Month)</h3>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: 'var(--text-primary)' }}>
              UGX {Number(metrics.revenue.month).toLocaleString()}
            </div>
          </div>
          <div className="yaba-card">
            <h3 className="yaba-card-title">Active Hotspots</h3>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: 'var(--text-primary)' }}>
              {Number(metrics.activeHotspots).toLocaleString()}
            </div>
          </div>
          <div className="yaba-card">
            <h3 className="yaba-card-title">Active Users</h3>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: 'var(--text-primary)' }}>
              {Number(metrics.activeUsers).toLocaleString()}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="yaba-card">
            <h3 className="yaba-card-title">Growth & Usage</h3>
            <div className="yaba-elev-2" style={{ padding: 12, borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--text-primary)' }}>
                <span>Owner Signups</span>
                <span>{Math.round(metrics.ownerSignups % 100)}%</span>
              </div>
              <div style={{ height: 10, background: 'var(--stroke)', borderRadius: 999 }}>
                <div style={{ height: 10, background: 'var(--accent)', borderRadius: 999, width: `${Math.max(0, Math.min(metrics.ownerSignups % 100, 100))}%` }} />
              </div>
            </div>
            <div className="yaba-elev-2" style={{ padding: 12, borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--text-primary)' }}>
                <span>Data Used (MB)</span>
                <span>{Math.round((metrics.usageMb % 1000) / 10)}%</span>
              </div>
              <div style={{ height: 10, background: 'var(--stroke)', borderRadius: 999 }}>
                <div style={{ height: 10, background: 'var(--accent)', borderRadius: 999, width: `${Math.max(0, Math.min((metrics.usageMb % 1000) / 10, 100))}%` }} />
              </div>
            </div>
            <div className="yaba-elev-2" style={{ padding: 12, borderRadius: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--text-primary)' }}>
                <span>Sessions</span>
                <span>{Math.round((metrics.sessionCount % 1000) / 10)}%</span>
              </div>
              <div style={{ height: 10, background: 'var(--stroke)', borderRadius: 999 }}>
                <div style={{ height: 10, background: 'var(--accent)', borderRadius: 999, width: `${Math.max(0, Math.min((metrics.sessionCount % 1000) / 10, 100))}%` }} />
              </div>
            </div>
          </div>

          <div className="yaba-card">
            <h3 className="yaba-card-title">Recent Owners</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="yaba-elev-2" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr', gap: 8, padding: '10px 12px', borderRadius: 8, fontWeight: 600 }}>
                <div>Name</div>
                <div>Email</div>
                <div>Phone</div>
                <div>Hotspots</div>
              </div>
              {(accounts.owners || []).slice(0, 6).map((o, i) => (
                <div key={i} className="yaba-card yaba-elev-2" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr', gap: 8, padding: '10px 12px', borderRadius: 8 }}> 
                  <div>{o.name || o.ownerName || "—"}</div>
                  <div>{o.email || o.ownerEmail || "—"}</div>
                  <div>{o.phone || o.ownerPhone || "—"}</div>
                  <div>{o.hotspotCount || 0}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  function renderAccounts() {
    const [qOwners, qUsers] = [accounts.owners || [], accounts.users || []];
    const token = localStorage.getItem("superToken");
    const headers = token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };

    const createOwner = async () => {
      try {
        const res = await fetch('/api/super/owners', { method: 'POST', headers, body: JSON.stringify(newOwner) });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
        const ownersRes = await fetch('/api/super/owners', { headers });
        const ownersJson = await ownersRes.json();
        setAccounts((prev)=> ({ ...prev, owners: ownersJson.owners || [] }));
        setNewOwner({ ownerName: '', ownerPhone: '', ownerEmail: '', businessName: '' });
      } catch (e) { alert('Failed to create owner'); }
    };

    const suspendOwner = async (ownerId, suspended) => {
      try {
        const res = await fetch(`/api/super/owners/${ownerId}/suspend`, { method: 'POST', headers, body: JSON.stringify({ suspended }) });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
        const ownersRes = await fetch('/api/super/owners', { headers });
        const ownersJson = await ownersRes.json();
        setAccounts((prev)=> ({ ...prev, owners: ownersJson.owners || [] }));
      } catch (e) { alert('Failed to update owner status'); }
    };

    const deleteOwner = async (ownerId) => {
      try {
        if (!window.confirm('Delete owner? This is a soft delete.')) return;
        const res = await fetch(`/api/super/owners/${ownerId}`, { method: 'DELETE', headers });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
        const ownersRes = await fetch('/api/super/owners', { headers });
        const ownersJson = await ownersRes.json();
        setAccounts((prev)=> ({ ...prev, owners: ownersJson.owners || [] }));
      } catch (e) { alert('Failed to delete owner'); }
    };

    return (
      <>
        <div className="yaba-card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 className="yaba-card-title" style={{ margin: 0 }}>Accounts</h3>
            <input placeholder="Search name, email, hotspot ID…" className="yaba-input" style={{ width: 300 }} />
        </div>
          <div>
            <h4 className="yaba-card-title" style={{ fontSize: 16, marginBottom: 12 }}>Create Owner</h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <input placeholder="Owner Name" className="yaba-input" value={newOwner.ownerName} onChange={(e)=> setNewOwner({ ...newOwner, ownerName: e.target.value })} />
              <input placeholder="Phone" className="yaba-input" value={newOwner.ownerPhone} onChange={(e)=> setNewOwner({ ...newOwner, ownerPhone: e.target.value })} />
              <input placeholder="Email (optional)" className="yaba-input" value={newOwner.ownerEmail} onChange={(e)=> setNewOwner({ ...newOwner, ownerEmail: e.target.value })} />
              <input placeholder="Business (optional)" className="yaba-input" value={newOwner.businessName} onChange={(e)=> setNewOwner({ ...newOwner, businessName: e.target.value })} />
              <button className="yaba-btn yaba-btn--accent" onClick={createOwner}>Create</button>
        </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="yaba-btn yaba-btn--secondary">Owners ({qOwners.length})</button>
            <button className="yaba-btn yaba-btn--secondary">Users ({qUsers.length})</button>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="yaba-elev-2" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr 1.5fr', gap: 8, padding: '10px 12px', borderRadius: 8, fontWeight: 600 }}>
              <div>Name</div><div>Email</div><div>Phone</div><div>Status</div><div>Actions</div>
          </div>
          {qOwners.slice(0, 10).map((o, i) => (
              <div key={`o-${i}`} className="yaba-card yaba-elev-2" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr 1.5fr', gap: 8, padding: '10px 12px', borderRadius: 8 }}>
              <div>{o.name || o.ownerName || "—"}</div>
              <div>{o.email || o.ownerEmail || "—"}</div>
                <div>{o.phone || o.ownerPhone || "—"}</div>
              <div>{o.suspended ? "Suspended" : "Active"}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="yaba-btn yaba-btn--secondary" style={{ padding: '6px 10px', fontSize: 12 }} onClick={async ()=> {
                    setSelectedOwner(o);
                    try {
                      const token = localStorage.getItem("superToken");
                      const headers = token ? { Authorization: `Bearer ${token}` } : {};
                      const sitesRes = await fetch(`/api/super/sites/${o.id}`, { headers });
                      const sitesJson = await sitesRes.json();
                      setOwnerSites(sitesJson.sites || []);
                    } catch (e) { setOwnerSites([]); }
                  }}>Sites</button>
                  <button className="yaba-btn yaba-btn--secondary" style={{ padding: '6px 10px', fontSize: 12 }} onClick={()=> suspendOwner(o.id, !o.suspended)}>{o.suspended ? 'Unsuspend' : 'Suspend'}</button>
                  <button className="yaba-btn" style={{ padding: '6px 10px', fontSize: 12, background: 'var(--danger)', color: '#fff' }} onClick={()=> deleteOwner(o.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
        </div>

        {selectedOwner && (
          <div className="yaba-card">
            <h3 className="yaba-card-title">Sites for {selectedOwner.name || selectedOwner.ownerName}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <input placeholder="Site Name" className="yaba-input" value={newSite.hotspotName} onChange={(e)=> setNewSite({ ...newSite, hotspotName: e.target.value })} />
              <input placeholder="Address" className="yaba-input" value={newSite.address} onChange={(e)=> setNewSite({ ...newSite, address: e.target.value })} />
              <input placeholder="SSID (optional)" className="yaba-input" value={newSite.ssid} onChange={(e)=> setNewSite({ ...newSite, ssid: e.target.value })} />
              <select className="yaba-select" value={newSite.routerType} onChange={(e)=> setNewSite({ ...newSite, routerType: e.target.value })}>
                <option value="unknown">Unknown</option>
                <option value="unifi">UniFi</option>
                <option value="openwrt">OpenWRT</option>
                <option value="mikrotik">MikroTik</option>
              </select>
              <button className="yaba-btn yaba-btn--accent" onClick={async ()=> {
                try {
                  const token = localStorage.getItem("superToken");
                  const headers = token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
                  const res = await fetch(`/api/super/sites/${selectedOwner.id}`, { method: 'POST', headers, body: JSON.stringify(newSite) });
                  const data = await res.json();
                  if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
                  setNewSite({ hotspotName: '', address: '', ssid: '', routerType: 'unknown' });
                  // reload sites
                  const sitesRes = await fetch(`/api/super/sites/${selectedOwner.id}`, { headers });
                  const sitesJson = await sitesRes.json();
                  setOwnerSites(sitesJson.sites || []);
                } catch (e) { alert('Failed to create site'); }
              }}>Create Site</button>
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <div className="yaba-elev-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, padding: '10px 12px', borderRadius: 8, fontWeight: 600 }}>
              <div>Site Name</div><div>Address</div><div>SSID</div><div>Status</div>
            </div>
            {ownerSites.map((site, i)=> (
              <div key={i} className="yaba-card yaba-elev-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, padding: '10px 12px', borderRadius: 8 }}>
                  <div>{site.hotspotName || '—'}</div>
                  <div>{site.address || '—'}</div>
                  <div>{site.ssid || '—'}</div>
                  <div>{site.status || '—'}</div>
                </div>
              ))}
            </div>
            <button className="yaba-btn yaba-btn--secondary" style={{ marginTop: 12 }} onClick={()=> setSelectedOwner(null)}>Close</button>
          </div>
        )}
      </>
    );
  }

  function renderDevices() {
    const list = devices || [];
    return (
      <div className="yaba-card">
        <h3 className="yaba-card-title">Devices</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="yaba-elev-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8, padding: '10px 12px', borderRadius: 8, fontWeight: 600 }}>
            <div>Type</div><div>Owner</div><div>Alias/Name</div><div>Location/SSID</div><div>Status</div>
          </div>
          {list.slice(0, 50).map((d, i)=> (
            <div key={i} className="yaba-card yaba-elev-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8, padding: '10px 12px', borderRadius: 8 }}>
              <div>{d.type}</div>
              <div>{d.ownerName || d.ownerId || '—'}</div>
              <div>{d.alias || '—'}</div>
              <div>{d.location || d.ssid || '—'}</div>
              <div>{d.status || '—'}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderPackages() {
    const token = localStorage.getItem("superToken");
    const headers = token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };

    const saveSettings = async () => {
      try {
        const body = { commissionRate, defaultPackages, businessRules };
        const res = await fetch('/api/super/settings', { method: 'POST', headers, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Failed to save settings');
        alert('Settings saved');
      } catch (e) {
        alert('Failed to save settings');
      }
    };
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div className="yaba-card">
            <h3 className="yaba-card-title">Commission</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              <label>Platform Commission Rate (%)</label>
              <input type="number" className="yaba-input" value={commissionRate} onChange={(e) => setCommissionRate(Number(e.target.value))} />
            </div>
          </div>
          <div className="yaba-card">
            <h3 className="yaba-card-title">Default Package Templates</h3>
            {defaultPackages.map((p, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <input value={p.name} onChange={(e) => {
                  const next = [...defaultPackages]; next[idx] = { ...p, name: e.target.value }; setDefaultPackages(next);
                }} className="yaba-input" style={{ flex: 2 }} />
                <input type="number" value={p.price} onChange={(e) => {
                  const next = [...defaultPackages]; next[idx] = { ...p, price: Number(e.target.value) }; setDefaultPackages(next);
                }} className="yaba-input" style={{ width: 120 }} />
                <select value={p.type} onChange={(e) => {
                  const next = [...defaultPackages]; next[idx] = { ...p, type: e.target.value }; setDefaultPackages(next);
                }} className="yaba-select" style={{ width: 140 }}>
                  <option value="time">Time-based</option>
                  <option value="data">Data-based</option>
                  <option value="subscription">Subscription</option>
                </select>
              </div>
            ))}
            <button className="yaba-btn yaba-btn--accent" onClick={() => setDefaultPackages([...defaultPackages, { name: "New", price: 0, type: "time" }])}>+ Add Template</button>
          </div>
        </div>

        <div className="yaba-card">
          <h3 className="yaba-card-title">Global Business Rules</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <label>Minimum Package Price (UGX)</label>
            <input type="number" className="yaba-input" style={{ width: 200 }} value={businessRules.minPrice} onChange={(e)=> setBusinessRules({ ...businessRules, minPrice: Number(e.target.value) })} />
            <label>Tax (%)</label>
            <input type="number" className="yaba-input" style={{ width: 120 }} value={businessRules.taxPercent} onChange={(e)=> setBusinessRules({ ...businessRules, taxPercent: Number(e.target.value) })} />
            <label>Payment Provider</label>
            <select className="yaba-select" style={{ width: 200 }} value={businessRules.paymentProvider} onChange={(e)=> setBusinessRules({ ...businessRules, paymentProvider: e.target.value })}>
              <option>MTN MOMO</option>
            </select>
          </div>
          <button className="yaba-btn yaba-btn--accent" style={{ marginTop: 10 }} onClick={saveSettings}>Save Settings</button>
        </div>
      </>
    );
  }

  function renderWallet() {
    const token = localStorage.getItem("superToken");
    const headers = token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };

    const savePayout = async () => {
      try {
        const res = await fetch("/api/super/payout-account", { method: "POST", headers, body: JSON.stringify(payoutAccount) });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed");
        alert("Payout account saved.");
      } catch (e) {
        alert("Failed to save payout account");
      }
    };

    return (
      <>
        <div style={styles.gridTwo}>
          <div style={styles.widget}>
            <h3 style={styles.widgetTitle}>Platform Wallet</h3>
            <div style={{ fontSize: 28, fontWeight: 700 }}>UGX {Number(wallet.balance).toLocaleString()}</div>
            <div style={{ marginTop: 12, maxHeight: 240, overflow: 'auto' }}>
              {(wallet.transactions || []).slice(0, 20).map((t, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span>{t.description || t.type}</span>
                  <strong>UGX {Number(t.amount).toLocaleString()}</strong>
                </div>
              ))}
            </div>
          </div>
          <div style={styles.widget}>
            <h3 style={styles.widgetTitle}>Payout Account Settings</h3>
            <div style={styles.formRowInline}>
              <label>Account Type</label>
              <select value={payoutAccount.accountType} onChange={(e) => setPayoutAccount({ ...payoutAccount, accountType: e.target.value })} style={{ ...styles.input, width: 200 }}>
                <option>Mobile Money</option>
                <option>Bank</option>
              </select>
            </div>
            <div style={styles.formRowInline}>
              <label>Network</label>
              <select value={payoutAccount.provider} onChange={(e) => setPayoutAccount({ ...payoutAccount, provider: e.target.value })} style={{ ...styles.input, width: 200 }}>
                <option>MTN</option>
            </select>
            </div>
            {/* Removed account number/name inputs per request */}
            <button style={styles.primaryBtnSmall} onClick={savePayout}>Save</button>
          </div>
        </div>
      </>
    );
  }

  function renderReports() {
    const totals = reports?.totals || { gross: 0, commission: 0, net: 0 };
    return (
      <>
        {/* Commission Summary - Full Width */}
        <div className="yaba-card" style={{ marginBottom: 24 }}>
          <h3 className="yaba-card-title">Commission Summary</h3>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
            gap: 16,
            marginTop: 16
          }}>
            <div className="yaba-elev-2" style={{ 
              padding: 16, 
              borderRadius: 12, 
              textAlign: 'center',
              background: 'var(--surface)',
              border: '1px solid var(--stroke)'
            }}>
              <div className="yaba-muted" style={{ fontSize: 12, marginBottom: 8 }}>Gross Revenue</div>
              <div className="yaba-card-title" style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
                UGX {Number(totals.gross).toLocaleString()}
            </div>
          </div>
            <div className="yaba-elev-2" style={{ 
              padding: 16, 
              borderRadius: 12, 
              textAlign: 'center',
              background: 'var(--surface)',
              border: '1px solid var(--stroke)'
            }}>
              <div className="yaba-muted" style={{ fontSize: 12, marginBottom: 8 }}>Commission (25%)</div>
              <div className="yaba-card-title" style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>
                UGX {Number(totals.commission).toLocaleString()}
            </div>
          </div>
            <div className="yaba-elev-2" style={{ 
              padding: 16, 
              borderRadius: 12, 
              textAlign: 'center',
              background: 'var(--surface)',
              border: '1px solid var(--stroke)'
            }}>
              <div className="yaba-muted" style={{ fontSize: 12, marginBottom: 8 }}>Net to Owners</div>
              <div className="yaba-card-title" style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>
                UGX {Number(totals.net).toLocaleString()}
          </div>
          </div>
          </div>
        </div>

        {/* Two Column Layout for Tables */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', 
          gap: 24,
          marginBottom: 24
        }}>
          {/* Recent Transfers */}
          <div className="yaba-card">
            <h3 className="yaba-card-title">Recent Transfers</h3>
            <div style={{ maxHeight: 300, overflow: 'auto', marginTop: 16 }}>
              {(reports.transfers || []).length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>
                  No transfers found
                </div>
              ) : (
                (reports.transfers || []).slice(0, 10).map((t, i) => (
                  <div key={i} className="yaba-elev-2" style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr 1fr 1fr', 
                    gap: 12, 
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    marginBottom: 8,
                    background: 'var(--surface)',
                    border: '1px solid var(--stroke)'
                  }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 14 }}>{t.referenceId}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t.ownerId || '—'}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{new Date(t.settledAt).toLocaleString()}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent Splits */}
          <div className="yaba-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 className="yaba-card-title" style={{ margin: 0 }}>Recent Splits</h3>
              <a href="/api/super/reports/export/csv" className="yaba-btn yaba-btn--secondary" style={{ 
                padding: '8px 16px', 
                fontSize: 12,
                textDecoration: 'none'
              }}>
                Export CSV
              </a>
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {(reports.splits || []).length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>
                  No splits found
                </div>
              ) : (
                (reports.splits || []).slice(0, 20).map((s, i) => (
                  <div key={i} className="yaba-elev-2" style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr 1fr 1fr 1fr', 
                    gap: 12, 
                    padding: '12px 16px', 
                    borderRadius: 8, 
                    marginBottom: 8,
                    background: 'var(--surface)',
                    border: '1px solid var(--stroke)'
                  }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 }}>{s.ownerId}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Gross: UGX {s.grossAmount}</div>
                    <div style={{ color: 'var(--accent)', fontSize: 12 }}>Comm: UGX {s.commissionAmount}</div>
                    <div style={{ color: 'var(--success)', fontSize: 12 }}>Net: UGX {s.netAmount}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  function renderSupport() {
    const token = localStorage.getItem("superToken");
    const headers = token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };

    const saveContact = async () => {
      try {
        setSavingContact(true);
        const res = await fetch("/api/super/contact-info/manage", {
          method: "POST",
          headers,
          body: JSON.stringify(contactInfo),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to save");
        alert("Support contact info saved. This will reflect on the Admin Login page.");
      } catch (e) {
        alert("Failed to save contact info");
      } finally {
        setSavingContact(false);
      }
    };

    return (
      <div style={styles.widget}>
        <h3 style={styles.widgetTitle}>Support Contact Info</h3>
        <div style={styles.formRow}><label>Public Support Phone</label><input style={styles.input} value={contactInfo.phone} onChange={(e) => setContactInfo({ ...contactInfo, phone: e.target.value })} /></div>
        <div style={styles.formRow}><label>Public WhatsApp Number</label><input style={styles.input} value={contactInfo.whatsapp} onChange={(e) => setContactInfo({ ...contactInfo, whatsapp: e.target.value })} /></div>
        <div style={styles.formRow}><label>Support Email</label><input style={styles.input} value={contactInfo.email} onChange={(e) => setContactInfo({ ...contactInfo, email: e.target.value })} /></div>
        <button style={styles.primaryBtnSmall} onClick={saveContact} disabled={savingContact}>{savingContact ? "Saving…" : "Save Contact Info"}</button>
      </div>
    );
  }

  function renderSettings() {
    const token = localStorage.getItem("superToken");
    const headers = token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };

    const saveAlerts = async () => {
      try {
        const res = await fetch('/api/super/alerts-settings', { method: 'POST', headers, body: JSON.stringify(alertsSettings) });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Failed');
        alert('Alerts settings saved');
      } catch (e) { alert('Failed to save alerts settings'); }
    };

    return (
      <>
      <div style={styles.widget}>
        <h3 style={styles.widgetTitle}>Platform Settings</h3>
        <div style={styles.formRow}><label>Platform Name</label><input style={styles.input} defaultValue="WiFi Platform" /></div>
        <div style={styles.formRow}><label>Support Email</label><input style={styles.input} defaultValue="support@example.com" /></div>
        <div style={styles.formRow}><label>Admin Contact Phone</label><input style={styles.input} defaultValue="+256700000000" /></div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button style={styles.primaryBtnSmall}>Save Changes</button>
          <button style={styles.secondaryBtnSmall}>Discard</button>
        </div>
      </div>

        <div style={styles.widget}>
          <h3 style={styles.widgetTitle}>Alert Settings</h3>
          <div style={styles.formRow}>
            <label>Email Notifications</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input placeholder="admin@example.com" style={styles.input} onKeyPress={(e)=> {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  setAlertsSettings(prev=> ({ ...prev, emails: [...prev.emails, e.target.value.trim()] }));
                  e.target.value = '';
                }
              }} />
              <button style={styles.primaryBtnSmall} onClick={()=> {
                const input = document.querySelector('input[placeholder="admin@example.com"]');
                if (input?.value.trim()) {
                  setAlertsSettings(prev=> ({ ...prev, emails: [...prev.emails, input.value.trim()] }));
                  input.value = '';
                }
              }}>Add</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              {alertsSettings.emails.map((email, i)=> (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>{email}</span>
                  <button style={{ ...styles.dangerLinkBtn, padding: '2px 6px', fontSize: 12 }} onClick={()=> {
                    setAlertsSettings(prev=> ({ ...prev, emails: prev.emails.filter((_, idx)=> idx !== i) }));
                  }}>×</button>
                </div>
              ))}
            </div>
          </div>
          <div style={styles.formRow}>
            <label>Down Hotspot Alert Threshold (minutes)</label>
            <input type="number" style={styles.input} value={alertsSettings.thresholds.downHotspotMinutes} onChange={(e)=> setAlertsSettings(prev=> ({ ...prev, thresholds: { ...prev.thresholds, downHotspotMinutes: Number(e.target.value) } }))} />
          </div>
          <button style={styles.primaryBtnSmall} onClick={saveAlerts}>Save Alerts</button>
        </div>
      </>
    );
  }

  function renderAuditLogs() {
    const logs = auditLogs || [];
    return (
      <div style={styles.widget}>
        <h3 style={styles.widgetTitle}>Audit Logs</h3>
        <div style={{ ...styles.table }}>
          <div style={{ ...styles.trHeader, gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
            <div>Actor</div><div>Action</div><div>Target</div><div>Time</div>
          </div>
          {logs.slice(0, 50).map((log, i)=> (
            <div key={i} style={{ ...styles.tr, gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
              <div>{log.actor || '—'}</div>
              <div>{log.action || '—'}</div>
              <div>{log.ownerId || '—'}</div>
              <div>{log.at ? new Date(log.at).toLocaleString() : '—'}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderOwnerDetails() {
    if (!ownerDetails) return null;
    const { owner, stats, sites, routers, packages, recentSessions } = ownerDetails;

  return (
      <>
        <div style={styles.widget}>
          <h3 style={styles.widgetTitle}>Owner Details: {owner.ownerName || 'Unnamed'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Sites</div>
              <div style={styles.statValue}>{stats.sitesCount}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Routers</div>
              <div style={styles.statValue}>{stats.routersCount}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Total Revenue</div>
              <div style={styles.statValue}>UGX {Number(stats.totalRevenue).toLocaleString()}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Commission</div>
              <div style={styles.statValue}>UGX {Number(stats.totalCommission).toLocaleString()}</div>
            </div>
          </div>
          <div style={styles.formRowInline}>
            <span><strong>Email:</strong> {owner.ownerEmail || '—'}</span>
            <span><strong>Phone:</strong> {owner.ownerPhone || '—'}</span>
            <span><strong>Status:</strong> {owner.suspended ? 'Suspended' : 'Active'}</span>
          </div>
        </div>

        <div style={styles.gridTwo}>
          <div style={styles.widget}>
            <h3 style={styles.widgetTitle}>Sites ({sites.length})</h3>
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {sites.map((site, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ fontWeight: 600 }}>{site.hotspotName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{site.address}</div>
                  <div style={{ fontSize: 12 }}>SSID: {site.ssid || '—'} | Status: {site.status}</div>
              </div>
              ))}
            </div>
          </div>

          <div style={styles.widget}>
            <h3 style={styles.widgetTitle}>Recent Packages ({packages.length})</h3>
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {packages.map((pkg, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ fontWeight: 600 }}>{pkg.packageName || pkg.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>UGX {Number(pkg.price || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 12 }}>Status: {pkg.status || '—'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <button style={{ ...styles.secondaryBtnSmall, marginTop: 16 }} onClick={() => setOwnerDetails(null)}>Close Details</button>
      </>
    );
  }

  function renderHealthMonitoring() {
    if (!healthData) return <div style={styles.widget}><h3 style={styles.widgetTitle}>Loading health data...</h3></div>;
    
    return (
      <>
        <div style={styles.statsGrid}>
          <Stat label="Total Owners" value={healthData.metrics.totalOwners} />
          <Stat label="Total Sites" value={healthData.metrics.totalSites} />
          <Stat label="Total Devices" value={healthData.metrics.totalDevices} />
          <Stat label="Revenue (24h)" value={healthData.metrics.revenueLast24h} />
        </div>

        <div style={styles.gridTwo}>
          <div style={styles.widget}>
            <h3 style={styles.widgetTitle}>System Health</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(healthData.services).map(([service, status]) => (
                <div key={service} className="yaba-elev-2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8 }}>
                  <span style={{ textTransform: 'capitalize', fontWeight: 600, color: 'var(--text-primary)' }}>{service}</span>
                  <span style={{ color: status === 'healthy' ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{status}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.widget}>
            <h3 style={styles.widgetTitle}>Active Alerts ({healthData.metrics.alertsCount})</h3>
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {healthData.alerts.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No active alerts</div>
              ) : (
                healthData.alerts.map((alert, i) => (
                  <div key={i} className="yaba-elev-2" style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, color: alert.severity === 'warning' ? 'var(--warning)' : 'var(--danger)' }}>{alert.type}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{alert.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>
          </div>

        <div style={styles.widget}>
          <h3 style={styles.widgetTitle}>Health Metrics</h3>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Last updated: {new Date(healthData.timestamp).toLocaleString()}
          </div>
        </div>
      </>
    );
  }


  return (
    <>
      <style>{`
        @media (max-width: 768px) {
          .admin-sidebar {
            width: 100% !important;
            position: relative !important;
            height: auto !important;
          }
          .admin-main {
            margin-left: 0 !important;
            padding: 16px !important;
          }
          .yaba-card {
            padding: 16px !important;
          }
          .yaba-card h3 {
            font-size: 16px !important;
          }
          .yaba-btn {
            padding: 8px 12px !important;
            font-size: 12px !important;
          }
          .yaba-input, .yaba-select {
            padding: 8px 10px !important;
            font-size: 14px !important;
          }
        }
      `}</style>
      <div style={styles.container}>

      <div className="admin-sidebar" style={styles.sidebar}>
        {/* Logo and Owner Info */}
        <div style={styles.sidebarLogo}>
          <img 
            src="/YABA.svg"
            alt="YABA Logo" 
            style={styles.sidebarLogoImage}
          />
          <div>
            <p style={{ ...styles.sidebarOwnerName, fontWeight: 700, marginBottom: 2 }}>YABAnect</p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--sidebar-text-muted)' }}>Anywhere, Everywhere</p>
          </div>
        </div>
        
        {/* Core Sections */}
        <button onClick={() => setActiveTab("dashboard")} className="admin-button" style={styles.button}>🏠 Dashboard</button>
        <button onClick={() => setActiveTab("wallet")} className="admin-button" style={styles.button}>💼 Wallet</button>
        <button onClick={() => setActiveTab("accounts")} className="admin-button" style={styles.button}>👤 Accounts</button>
        <button onClick={() => setActiveTab("devices")} className="admin-button" style={styles.button}>📶 Devices</button>
        <button onClick={() => setActiveTab("packages")} className="admin-button" style={styles.button}>📦 Packages</button>
        <button onClick={() => setActiveTab("reports")} className="admin-button" style={styles.button}>📈 Reports</button>
        <button onClick={() => setActiveTab("health")} className="admin-button" style={styles.button}>🏥 Health</button>
        <button onClick={() => setActiveTab("audit")} className="admin-button" style={styles.button}>📋 Audit Logs</button>
        <button onClick={() => setActiveTab("support")} className="admin-button" style={styles.button}>🛟 Support</button>
        <button onClick={() => setActiveTab("settings")} className="admin-button" style={styles.button}>⚙️ Settings</button>

        {/* Logout Button */}
        <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
          <button onClick={handleLogout} className="admin-button" style={{...styles.button, background: 'var(--danger)', color: '#fff', border: '1px solid var(--danger)'}}>
            🚪 Logout
              </button>
        </div>
      </div>

      <main className="admin-main" style={styles.main}>
        {/* Enhanced SuperAdmin Header */}
        <div className="yaba-card" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          gap: 12, 
          marginBottom: 24,
          flexWrap: 'wrap',
          padding: '20px'
        }}>
          <div style={{ flex: 1, position: 'relative', maxWidth: 400 }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              border: '1px solid var(--control-stroke)', 
              background: 'var(--control)', 
              borderRadius: 999, 
              padding: '8px 12px',
              width: '100%',
              transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
            }}>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 16 }}>🔍</span>
              <input
                placeholder="Search owners, sites, devices..."
                className="yaba-input"
                style={{ 
                  flex: 1, 
                  outline: 'none', 
                  border: 'none', 
                  background: 'transparent', 
                  fontSize: 14, 
                  color: 'var(--text-primary)'
                }}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  performSearch(e.target.value);
                }}
              />
            </div>
            {searchResults.length > 0 && (
              <div className="yaba-card" style={{ 
                position: 'absolute', 
                top: 44, 
                left: 0, 
                width: '100%', 
                zIndex: 10,
                maxHeight: 300,
                overflow: 'auto',
                padding: 0
              }}>
                {searchResults.map((result, i) => (
                  <div key={i} onClick={() => {
                    if (result.type === 'owner') {
                      loadOwnerDetails(result.id);
                      setSearchQuery('');
                      setSearchResults([]);
                    }
                  }} style={{ 
                    padding: '12px', 
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 12, 
                    borderBottom: '1px solid var(--stroke)',
                    transition: 'background-color 0.2s ease'
                  }} onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--surface-2)'} onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}>
                    <span style={{ 
                      fontSize: 12, 
                      color: 'var(--text-muted)', 
                      minWidth: 80,
                      textTransform: 'capitalize',
                      fontWeight: 500
                    }}>{result.type}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 14 }}>{result.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{result.subtitle}</div>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>→</span>
                  </div>
                ))}
                <div style={{ 
                  padding: '8px 12px', 
                  borderTop: '1px solid var(--stroke)', 
                  fontSize: 12, 
                  color: 'var(--text-muted)', 
                  background: 'var(--surface)',
                  textAlign: 'center'
                }}>
                  Click to view details
                </div>
              </div>
            )}
          </div>

          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 20,
            flexWrap: 'wrap'
          }}>
            {/* Platform Metrics */}
            <div style={{ textAlign: 'right', minWidth: '80px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Platform Revenue</div>
              <div style={{ color: 'var(--success)', fontWeight: 700, fontSize: 16 }}>
                UGX {Number(kpis?.totalRevenue || 0).toLocaleString()}
              </div>
            </div>
            <div style={{ textAlign: 'right', minWidth: '80px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Active Owners</div>
              <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 16 }}>
                {accounts.owners?.filter(o => !o.suspended).length || 0}/{accounts.owners?.length || 0}
              </div>
            </div>
            <div style={{ textAlign: 'right', minWidth: '80px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total Sites</div>
              <div style={{ color: 'var(--warning)', fontWeight: 700, fontSize: 16 }}>
                {kpis?.totalSites || 0}
              </div>
            </div>

            {/* System Health Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ 
                width: 8, 
                height: 8, 
                borderRadius: '50%', 
                backgroundColor: healthData?.services?.database === 'healthy' ? 'var(--success)' : 'var(--danger)' 
              }}></div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>System</span>
            </div>

            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Notifications */}
            <div style={{ position: 'relative' }} data-notification-menu>
              <button style={{ 
                cursor: 'pointer', 
                background: 'transparent', 
                border: 'none', 
                padding: '8px', 
                borderRadius: '50%', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                transition: 'background-color 0.2s ease'
              }} onClick={() => setShowNotifMenu(v => !v)}>
                <span style={{ fontSize: 18 }}>🔔</span>
                {healthData?.metrics?.alertsCount > 0 && (
                  <span style={{ 
                    position: 'absolute', 
                    top: 2, 
                    right: 2, 
                    background: 'var(--danger)', 
                    color: '#fff', 
                    borderRadius: 999, 
                    fontSize: 10, 
                    padding: '2px 6px',
                    minWidth: '16px',
                    textAlign: 'center',
                    fontWeight: 600
                  }}>
                    {healthData.metrics.alertsCount}
                  </span>
                )}
            </button>
              {showNotifMenu && (
                <div className="yaba-card" style={{ 
                  position: 'absolute', 
                  right: 0, 
                  top: 36, 
                  width: 360, 
                  zIndex: 20,
                  padding: 0
                }}>
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--stroke)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['all','system','alerts','owners','sites'].map(f => (
                      <button key={f} onClick={() => setNotifFilter(f)} className="yaba-btn" style={{ 
                        padding: '6px 10px', 
                        fontSize: 12 
                      }}>
                        {f}
                      </button>
                    ))}
          </div>
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {healthData?.alerts?.length === 0 ? (
                      <div style={{ padding: 12, color: 'var(--text-muted)' }}>No active alerts</div>
                    ) : (
                      healthData?.alerts?.map((alert, i) => (
                        <div key={i} className="yaba-elev-2" style={{ padding: '10px 12px', borderBottom: '1px solid var(--stroke)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{alert.type} · {alert.severity}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Now</span>
        </div>
                          <div style={{ color: 'var(--text-primary)' }}>{alert.message}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* SuperAdmin Profile */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ 
                width: 36, 
                height: 36, 
                borderRadius: '50%', 
                overflow: 'hidden', 
                background: 'linear-gradient(135deg, var(--accent), var(--success))', 
                color: '#fff', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                fontWeight: 700,
                fontSize: 16,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}>
                👑
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>Super Admin</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Platform Owner</span>
              </div>
            </div>
          </div>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {ownerDetails && renderOwnerDetails()}
        {!ownerDetails && activeTab === 'dashboard' && renderDashboard()}
        {!ownerDetails && activeTab === 'wallet' && renderWallet()}
        {!ownerDetails && activeTab === 'accounts' && renderAccounts()}
        {!ownerDetails && activeTab === 'devices' && renderDevices()}
        {!ownerDetails && activeTab === 'packages' && renderPackages()}
        {!ownerDetails && activeTab === 'reports' && renderReports()}
        {!ownerDetails && activeTab === 'health' && renderHealthMonitoring()}
        {!ownerDetails && activeTab === 'audit' && renderAuditLogs()}
        {!ownerDetails && activeTab === 'support' && renderSupport()}
        {!ownerDetails && activeTab === 'settings' && renderSettings()}      
      </main>
    </div>
    </>
  );
}

export default SuperDashboard;
