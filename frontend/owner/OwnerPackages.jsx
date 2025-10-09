import { formatUGX } from "../src/components/currency";
import React, { useEffect, useState } from "react";
import axios from "axios";

const defaultForm = {
  name: "",
  price: "",
  dataLimitMB: "",
  timeLimitMinutes: "",
  speedLimitMbps: "",
  status: "launched",
};

export default function OwnerPackages() {
  const [hotspots, setHotspots] = useState([]);
  const [selectedHotspot, setSelectedHotspot] = useState("");
  const [packages, setPackages] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(true);
  const [dataUnit, setDataUnit] = useState("MB");
  const [timeUnit, setTimeUnit] = useState("minutes");
  const [speedUnit, setSpeedUnit] = useState("Mbps");

  const ownerId = localStorage.getItem("ownerId");

  useEffect(() => {
    if (ownerId) fetchHotspots();
  }, [ownerId]);

  useEffect(() => {
    if (selectedHotspot) fetchPackages(selectedHotspot);
  }, [selectedHotspot]);

  const fetchHotspots = async () => {
    try {
      const res = await axios.get(`http://localhost:5000/api/hotspots/owner/${ownerId}`);
      setHotspots(res.data.hotspots || []);
      if (res.data.hotspots?.length) setSelectedHotspot(res.data.hotspots[0].id);
    } catch (err) {
      setMessage("Failed to load hotspots");
    }
  };

  const fetchPackages = async (hotspotId) => {
    try {
      const res = await axios.get(`http://localhost:5000/api/packages?hotspotId=${hotspotId}`);
      setPackages(res.data.packages || []);
    } catch (err) {
      setMessage("Failed to load packages");
    }
  };

  const openModal = (pkg = null) => {
    setShowModal(true);
    if (pkg) {
      setForm({
        name: pkg.name,
        price: pkg.price,
        dataLimitMB: pkg.dataLimitMB || "",
        timeLimitMinutes: pkg.timeLimitMinutes || "",
        speedLimitMbps: pkg.speedLimitMbps || "",
        status: pkg.status,
      });
      setEditingId(pkg.id);
      setLoyaltyEnabled(pkg.loyalty_program_enabled || true);
    } else {
      setForm(defaultForm);
      setEditingId(null);
      setLoyaltyEnabled(true);
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    // Convert values to base units for backend
    let dataLimitMB = form.dataLimitMB ? Number(form.dataLimitMB) : null;
    if (dataLimitMB && dataUnit === "GB") dataLimitMB = dataLimitMB * 1024;
    let timeLimitMinutes = form.timeLimitMinutes ? Number(form.timeLimitMinutes) : null;
    if (timeLimitMinutes) {
      if (timeUnit === "hours") timeLimitMinutes *= 60;
      if (timeUnit === "days") timeLimitMinutes *= 60 * 24;
      if (timeUnit === "weeks") timeLimitMinutes *= 60 * 24 * 7;
      if (timeUnit === "months") timeLimitMinutes *= 60 * 24 * 30;
    }
    let speedLimitMbps = form.speedLimitMbps ? Number(form.speedLimitMbps) : null;
    if (speedLimitMbps && speedUnit === "Kbps") speedLimitMbps = speedLimitMbps / 1000;
    // Required fields check
    if (!selectedHotspot || !form.name || !form.price) {
      setMessage("Please fill in all required fields: Hotspot, Name, and Price.");
      setLoading(false);
      return;
    }
    const reqBody = {
      ...form,
      price: Number(form.price),
      dataLimitMB,
      timeLimitMinutes,
      speedLimitMbps,
      hotspotId: selectedHotspot,
      id: editingId,
      loyalty_program_enabled: loyaltyEnabled,
    };
    console.log("Submitting package:", reqBody);
    try {
      await axios.post("http://localhost:5000/api/packages/save", reqBody);
      setShowModal(false);
      setForm(defaultForm);
      setEditingId(null);
      setMessage("Package saved successfully.");
      fetchPackages(selectedHotspot);
    } catch (err) {
      setMessage(err.response?.data?.message || "Failed to save package.");
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async (pkgId) => {
    try {
      await axios.post("http://localhost:5000/api/packages/save", { id: pkgId, status: "paused" });
      setMessage("Package paused.");
      fetchPackages(selectedHotspot);
    } catch (err) {
      setMessage("Failed to pause package.");
    }
  };

  const DATA_UNITS = [
    { label: "MB", value: "MB" },
    { label: "GB", value: "GB" },
  ];
  const TIME_UNITS = [
    { label: "Minutes", value: "minutes" },
    { label: "Hours", value: "hours" },
    { label: "Days", value: "days" },
    { label: "Weeks", value: "weeks" },
    { label: "Months", value: "months" },
  ];
  const SPEED_UNITS = [
    { label: "Kbps", value: "Kbps" },
    { label: "Mbps", value: "Mbps" },
  ];

  return (
    <div style={styles.container}>
      {/* Header Bar */}
      <div style={styles.headerBar}>
        <div style={styles.headerLeft}>
          <h2 style={styles.title}>Package Management</h2>
          <p style={styles.subtitle}>Create and manage WiFi access packages for your hotspots</p>
        </div>
        <div style={styles.headerRight}>
          {hotspots.length > 1 && (
            <select
              value={selectedHotspot}
              onChange={(e) => setSelectedHotspot(e.target.value)}
              style={styles.hotspotSelect}
            >
              {hotspots.map((h) => (
                <option key={h.id} value={h.id}>{h.hotspotName}</option>
              ))}
            </select>
          )}
          <button style={styles.createBtn} onClick={() => openModal()}>
            <span style={styles.btnIcon}>+</span>
            Create Package
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>📦</div>
          <div style={styles.statContent}>
            <div style={styles.statValue}>{packages.length}</div>
            <div style={styles.statLabel}>Total Packages</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>✅</div>
          <div style={styles.statContent}>
            <div style={styles.statValue}>{packages.filter(p => p.status === 'launched').length}</div>
            <div style={styles.statLabel}>Active Packages</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>⏸️</div>
          <div style={styles.statContent}>
            <div style={styles.statValue}>{packages.filter(p => p.status === 'paused').length}</div>
            <div style={styles.statLabel}>Paused Packages</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>💰</div>
          <div style={styles.statContent}>
            <div style={styles.statValue}>{formatUGX(packages.reduce((sum, p) => sum + (p.price || 0), 0))}</div>
            <div style={styles.statLabel}>Total Value</div>
          </div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div style={styles.messageContainer}>
          <div style={styles.message}>{message}</div>
        </div>
      )}

      {/* Packages Grid */}
      <div style={styles.packagesGrid}>
        {packages.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>📦</div>
            <h3 style={styles.emptyTitle}>No Packages Yet</h3>
            <p style={styles.emptySubtitle}>Create your first WiFi package to get started</p>
            <button style={styles.emptyBtn} onClick={() => openModal()}>
              Create Package
            </button>
          </div>
        ) : (
          packages.map((pkg) => (
            <div key={pkg.id} style={styles.packageCard}>
              <div style={styles.packageHeader}>
                <div style={styles.packageTitle}>
                  <h3 style={styles.packageName}>{pkg.name}</h3>
                  <div style={{
                    ...styles.statusBadge,
                    backgroundColor: pkg.status === 'launched' ? '#dcfce7' : '#fef2f2',
                    color: pkg.status === 'launched' ? '#166534' : '#dc2626'
                  }}>
                    {pkg.status === 'launched' ? 'Active' : 'Paused'}
                  </div>
                </div>
                <div style={styles.packagePrice}>{formatUGX(pkg.price)}</div>
              </div>
              
              <div style={styles.packageDetails}>
                <div style={styles.detailItem}>
                  <span style={styles.detailIcon}>📊</span>
                  <span style={styles.detailLabel}>Data:</span>
                  <span style={styles.detailValue}>
                    {pkg.dataLimitMB ? `${pkg.dataLimitMB} MB` : 'Unlimited'}
                  </span>
                </div>
                <div style={styles.detailItem}>
                  <span style={styles.detailIcon}>⏰</span>
                  <span style={styles.detailLabel}>Time:</span>
                  <span style={styles.detailValue}>
                    {pkg.timeLimitMinutes ? `${Math.floor(pkg.timeLimitMinutes / 60)}h ${pkg.timeLimitMinutes % 60}m` : 'Unlimited'}
                  </span>
                </div>
                <div style={styles.detailItem}>
                  <span style={styles.detailIcon}>🚀</span>
                  <span style={styles.detailLabel}>Speed:</span>
                  <span style={styles.detailValue}>
                    {pkg.speedLimitMbps ? `${pkg.speedLimitMbps} Mbps` : 'Unlimited'}
                  </span>
                </div>
                <div style={styles.detailItem}>
                  <span style={styles.detailIcon}>⭐</span>
                  <span style={styles.detailLabel}>Loyalty:</span>
                  <span style={styles.detailValue}>
                    {pkg.loyalty_program_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>

              <div style={styles.packageActions}>
                <button style={styles.editBtn} onClick={() => openModal(pkg)}>
                  <span style={styles.actionIcon}>✏️</span>
                  Edit
                </button>
                {pkg.status !== "paused" ? (
                  <button style={styles.pauseBtn} onClick={() => handlePause(pkg.id)}>
                    <span style={styles.actionIcon}>⏸️</span>
                    Pause
                  </button>
                ) : (
                  <button style={styles.resumeBtn} onClick={() => handlePause(pkg.id)}>
                    <span style={styles.actionIcon}>▶️</span>
                    Resume
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {showModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3>{editingId ? "Edit Package" : "Add Package"}</h3>
            <form onSubmit={handleSubmit} style={styles.form}>
              <label>Name*
                <input name="name" value={form.name} onChange={handleChange} required style={styles.input} />
              </label>
              <label>Price (UGX)*
                <input name="price" type="number" value={form.price} onChange={handleChange} required style={styles.input} />
              </label>
              <label>Data Limit
                <div style={{ display: 'flex', gap: 8 }}>
                  <input name="dataLimitMB" type="number" value={form.dataLimitMB} onChange={handleChange} style={styles.input} min={0} />
                  <select value={dataUnit} onChange={e => setDataUnit(e.target.value)} style={styles.input}>
                    {DATA_UNITS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </label>
              <label>Time Limit
                <div style={{ display: 'flex', gap: 8 }}>
                  <input name="timeLimitMinutes" type="number" value={form.timeLimitMinutes} onChange={handleChange} style={styles.input} min={0} />
                  <select value={timeUnit} onChange={e => setTimeUnit(e.target.value)} style={styles.input}>
                    {TIME_UNITS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </label>
              <label>Speed Limit
                <div style={{ display: 'flex', gap: 8 }}>
                  <input name="speedLimitMbps" type="number" value={form.speedLimitMbps} onChange={handleChange} style={styles.input} min={0} />
                  <select value={speedUnit} onChange={e => setSpeedUnit(e.target.value)} style={styles.input}>
                    {SPEED_UNITS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
              </label>
              <label>
                <input type="checkbox" checked={loyaltyEnabled} onChange={e => setLoyaltyEnabled(e.target.checked)} />
                Enable Loyalty Program
              </label>
              <button type="submit" style={styles.saveBtn} disabled={loading}>{loading ? "Saving..." : "Save"}</button>
              <button type="button" style={styles.cancelBtn} onClick={() => setShowModal(false)}>Cancel</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: 24,
    background: "var(--surface-2)",
    minHeight: "100vh",
    color: "var(--text-primary)",
  },
  headerBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
    padding: "20px 24px",
    background: "var(--surface-gradient)",
    borderRadius: 20,
    boxShadow: "0 10px 20px rgba(0,0,0,0.35)",
    border: "1px solid var(--stroke)",
    position: "relative",
    overflow: "hidden",
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    margin: "0 0 8px 0",
    color: "var(--text-primary)",
  },
  subtitle: {
    fontSize: 16,
    color: "var(--text-muted)",
    margin: 0,
  },
  hotspotSelect: {
    padding: "8px 12px",
    border: "1px solid var(--stroke)",
    borderRadius: 8,
    fontSize: 14,
    background: "var(--surface)",
    color: "var(--text-primary)",
    minWidth: 200,
  },
  createBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 20px",
    background: "var(--accent)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
  },
  btnIcon: {
    fontSize: 16,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 16,
    marginBottom: 24,
  },
  statCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "20px",
    background: "var(--surface-gradient)",
    borderRadius: 20,
    boxShadow: "0 10px 20px rgba(0,0,0,0.35)",
    border: "1px solid var(--stroke)",
    position: "relative",
    overflow: "hidden",
  },
  statIcon: {
    fontSize: 24,
    width: 40,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f3f4f6",
    borderRadius: 8,
  },
  statContent: {
    flex: 1,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 700,
    color: "var(--text-primary)",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontWeight: 500,
  },
  messageContainer: {
    marginBottom: 16,
  },
  message: {
    padding: "12px 16px",
    background: "#dbeafe",
    color: "#1e40af",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    textAlign: "center",
  },
  packagesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
    gap: 20,
  },
  emptyState: {
    gridColumn: "1 / -1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px 20px",
    background: "var(--surface-gradient)",
    borderRadius: 20,
    boxShadow: "0 10px 20px rgba(0,0,0,0.35)",
    border: "1px solid var(--stroke)",
    position: "relative",
    overflow: "hidden",
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: "0 0 8px 0",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "var(--text-muted)",
    margin: "0 0 20px 0",
  },
  emptyBtn: {
    padding: "12px 24px",
    background: "var(--accent)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  packageCard: {
    background: "var(--surface-gradient)",
    borderRadius: 20,
    padding: 20,
    boxShadow: "0 10px 20px rgba(0,0,0,0.35)",
    border: "1px solid var(--stroke)",
    position: "relative",
    overflow: "hidden",
    transition: "all 0.3s ease",
  },
  packageHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  packageTitle: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  packageName: {
    fontSize: 18,
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: 0,
  },
  statusBadge: {
    padding: "4px 8px",
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
  },
  packagePrice: {
    fontSize: 20,
    fontWeight: 700,
    color: "#059669",
  },
  packageDetails: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 16,
  },
  detailItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
  },
  detailIcon: {
    fontSize: 16,
    width: 20,
  },
  detailLabel: {
    color: "var(--text-muted)",
    fontWeight: 500,
    minWidth: 60,
  },
  detailValue: {
    color: "var(--text-primary)",
    fontWeight: 600,
  },
  packageActions: {
    display: "flex",
    gap: 8,
  },
  editBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    background: "#f59e0b",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    flex: 1,
  },
  pauseBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    background: "#dc2626",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    flex: 1,
  },
  resumeBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    background: "#059669",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    flex: 1,
  },
  actionIcon: {
    fontSize: 14,
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "var(--surface-gradient)",
    borderRadius: 20,
    padding: 28,
    minWidth: 320,
    maxWidth: 400,
    boxShadow: "0 10px 20px rgba(0,0,0,0.35)",
    border: "1px solid var(--stroke)",
    color: "var(--text-primary)",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  input: {
    padding: 8,
    border: "1px solid var(--stroke)",
    borderRadius: 5,
    fontSize: 15,
    marginTop: 4,
    background: "var(--surface)",
    color: "var(--text-primary)",
  },
  saveBtn: {
    background: "var(--accent)",
    color: "#fff",
    border: "none",
    borderRadius: 5,
    padding: "10px 0",
    fontWeight: 600,
    fontSize: 15,
    marginTop: 10,
    cursor: "pointer",
  },
  cancelBtn: {
    background: "var(--surface-3)",
    color: "var(--text-primary)",
    border: "1px solid var(--stroke)",
    borderRadius: 5,
    padding: "10px 0",
    fontWeight: 500,
    fontSize: 15,
    marginTop: 6,
    cursor: "pointer",
  },
};
