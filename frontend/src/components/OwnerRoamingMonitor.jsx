import { useCallback, useEffect, useState } from "react";

const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";
const roamingUiEnabled =
  String(import.meta.env.VITE_ROAMING_REGISTRY_ENABLED || "false").toLowerCase() ===
  "true";

function OwnerRoamingMonitor({ ownerId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [summary, setSummary] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [activeTab, setActiveTab] = useState("summary");

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem("ownerToken");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const loadSummary = useCallback(async () => {
    if (!roamingUiEnabled) {
      setDisabled(true);
      setLoading(false);
      return;
    }
    if (!ownerId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${apiBase}/api/roaming/dashboard/${encodeURIComponent(ownerId)}/summary`,
        { headers: authHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        setDisabled(true);
        setError(data.message || "Roaming registry is disabled");
        return;
      }
      if (!res.ok) throw new Error(data.message || "Failed to load roaming summary");
      setDisabled(false);
      setSummary(data.summary || { byStatus: {}, totals: { sessions: 0, rausConsumed: 0 } });
    } catch (err) {
      setError(err.message || "Failed to load roaming summary");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, ownerId]);

  const loadSessions = useCallback(async () => {
    if (!roamingUiEnabled || !ownerId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter) params.append("status", statusFilter);
      const res = await fetch(
        `${apiBase}/api/roaming/dashboard/${encodeURIComponent(ownerId)}/sessions?${params}`,
        { headers: authHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        setDisabled(true);
        setError(data.message || "Roaming registry is disabled");
        return;
      }
      if (!res.ok) throw new Error(data.message || "Failed to load roaming sessions");
      setDisabled(false);
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err.message || "Failed to load roaming sessions");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, ownerId, statusFilter]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const statusColor = (status) => {
    if (status === "active" || status === "authorized") return { bg: "#dcfce7", text: "#166534" };
    if (status === "terminated") return { bg: "#fef3c7", text: "#92400e" };
    if (status === "revoked") return { bg: "#fee2e2", text: "#dc2626" };
    if (status === "expired") return { bg: "#f3f4f6", text: "#374151" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  const fmtDate = (d) =>
    d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  if (!roamingUiEnabled || disabled) {
    return (
      <div style={styles.container}>
        <div style={styles.disabledCard}>
          <h2 style={styles.title}>Roaming Monitor</h2>
          <p style={styles.disabledText}>
            Roaming registry is currently disabled. Set{" "}
            <code>ROAMING_REGISTRY_ENABLED=true</code> on the backend and{" "}
            <code>VITE_ROAMING_REGISTRY_ENABLED=true</code> for the frontend to use
            this section.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Roaming Monitor</h2>
        <p style={styles.subtitle}>Active and historical roaming sessions at your hotspots (visited role)</p>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.tabBar}>
        <button
          onClick={() => setActiveTab("summary")}
          style={{ ...styles.tab, ...(activeTab === "summary" ? styles.tabActive : {}) }}
        >
          Summary
        </button>
        <button
          onClick={() => setActiveTab("sessions")}
          style={{ ...styles.tab, ...(activeTab === "sessions" ? styles.tabActive : {}) }}
        >
          Sessions
        </button>
      </div>

      {activeTab === "summary" && (
        <div style={styles.summaryGrid}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Total Sessions</div>
            <div style={styles.summaryValue}>{summary?.totals?.sessions ?? 0}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Total RAUs Consumed</div>
            <div style={styles.summaryValue}>{summary?.totals?.rausConsumed ?? 0}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Active Sessions</div>
            <div style={styles.summaryValue}>{summary?.byStatus?.active ?? 0}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Authorized Sessions</div>
            <div style={styles.summaryValue}>{summary?.byStatus?.authorized ?? 0}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Terminated Sessions</div>
            <div style={styles.summaryValue}>{summary?.byStatus?.terminated ?? 0}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Expired Sessions</div>
            <div style={styles.summaryValue}>{summary?.byStatus?.expired ?? 0}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Revoked Sessions</div>
            <div style={styles.summaryValue}>{summary?.byStatus?.revoked ?? 0}</div>
          </div>
        </div>
      )}

      {activeTab === "sessions" && (
        <div style={styles.sessionsSection}>
          <div style={styles.filterBar}>
            <label style={styles.filterLabel}>Filter by status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="authorized">Authorized</option>
              <option value="terminated">Terminated</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
            </select>
            <button onClick={loadSessions} disabled={loading} style={styles.refreshBtn}>
              {loading ? "⟳ Loading..." : "⟳ Refresh"}
            </button>
          </div>

          {loading && <p style={styles.loading}>Loading sessions...</p>}

          {!loading && sessions.length === 0 && (
            <p style={styles.empty}>No roaming sessions found.</p>
          )}

          {!loading && sessions.length > 0 && (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.tableHeader}>
                    <th style={styles.th}>Session ID</th>
                    <th style={styles.th}>User</th>
                    <th style={styles.th}>Hotspot</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Started</th>
                    <th style={styles.th}>Ended</th>
                    <th style={styles.th}>Billed (min)</th>
                    <th style={styles.th}>Home Owner</th>
                    <th style={styles.th}>Entitlement</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const sc = statusColor(s.status);
                    return (
                      <tr key={s.id} style={styles.tr}>
                        <td style={styles.td}><code style={styles.code}>{s.id}</code></td>
                        <td style={styles.td}>
                          <div>{s.userRef?.userId || "—"}</div>
                          {s.userRef?.phone && <div style={styles.meta}>{s.userRef.phone}</div>}
                        </td>
                        <td style={styles.td}>
                          <div>{s.visitedHotspotId || "—"}</div>
                        </td>
                        <td style={styles.td}>
                          <span style={{ ...styles.statusBadge, backgroundColor: sc.bg, color: sc.text }}>
                            {s.status}
                          </span>
                        </td>
                        <td style={styles.td}>{fmtDate(s.startedAt)}</td>
                        <td style={styles.td}>{fmtDate(s.endedAt)}</td>
                        <td style={styles.td}>{s.billedMinutes != null ? s.billedMinutes : "—"}</td>
                        <td style={styles.td}>{s.homeOwnerId || "—"}</td>
                        <td style={styles.td}><code style={styles.code}>{s.entitlementId || "—"}</code></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { padding: "24px", backgroundColor: "var(--surface, #fff)", borderRadius: "16px", border: "1px solid var(--stroke, #e5e7eb)", minHeight: "400px" },
  disabledCard: { padding: "32px", textAlign: "center", backgroundColor: "var(--surface-2, #f9fafb)", border: "1px solid var(--stroke, #e5e7eb)", borderRadius: "12px" },
  title: { fontSize: "24px", fontWeight: 700, margin: "0 0 8px 0", color: "var(--text-primary, #0f172a)" },
  subtitle: { fontSize: "13px", color: "var(--text-muted, #6b7280)", margin: 0 },
  disabledText: { color: "var(--text-muted, #6b7280)", fontSize: "14px", lineHeight: 1.6 },
  error: { color: "var(--danger, #dc2626)", marginBottom: "16px" },
  tabBar: { display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "1px solid var(--stroke, #e5e7eb)", paddingBottom: "4px" },
  tab: { padding: "10px 16px", border: "none", background: "transparent", cursor: "pointer", fontSize: "14px", fontWeight: 500, color: "var(--text-muted, #6b7280)", borderRadius: "8px 8px 0 0", transition: "all 0.2s" },
  tabActive: { color: "var(--accent, #3b82f6)", backgroundColor: "var(--surface-3, #f1f5f9)", borderBottom: "2px solid var(--accent, #3b82f6)" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" },
  summaryCard: { padding: "16px", border: "1px solid var(--stroke, #e5e7eb)", borderRadius: "12px", backgroundColor: "var(--surface, #fff)" },
  summaryLabel: { fontSize: "12px", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" },
  summaryValue: { fontSize: "28px", fontWeight: 700, color: "var(--text-primary, #0f172a)" },
  sessionsSection: { marginTop: "8px" },
  filterBar: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" },
  filterLabel: { fontSize: "13px", fontWeight: 500, color: "var(--text-primary, #0f172a)" },
  filterSelect: { padding: "8px 12px", border: "1px solid var(--stroke, #e5e7eb)", borderRadius: "8px", backgroundColor: "var(--surface, #fff)", fontSize: "13px", minWidth: "180px" },
  refreshBtn: { padding: "8px 16px", border: "1px solid var(--stroke, #e5e7eb)", borderRadius: "8px", backgroundColor: "var(--surface-3, #f1f5f9)", cursor: "pointer", fontSize: "13px", fontWeight: 500 },
  loading: { padding: "24px", textAlign: "center", color: "var(--text-muted, #6b7280)" },
  empty: { padding: "24px", textAlign: "center", color: "var(--text-muted, #6b7280)" },
  tableWrapper: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  tableHeader: { backgroundColor: "var(--surface-2, #f9fafb)" },
  th: { padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "var(--text-primary, #0f172a)", borderBottom: "1px solid var(--stroke, #e5e7eb)", whiteSpace: "nowrap" },
  td: { padding: "10px 12px", borderBottom: "1px solid var(--stroke, #e5e7eb)", color: "var(--text-primary, #0f172a)", verticalAlign: "top" },
  tr: { transition: "background-color 0.15s" },
  code: { fontSize: "11px", backgroundColor: "var(--surface-2, #f3f4f6)", padding: "2px 6px", borderRadius: "4px" },
  meta: { fontSize: "11px", color: "var(--text-muted, #6b7280)" },
  statusBadge: { fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "999px" },
};

export default OwnerRoamingMonitor;