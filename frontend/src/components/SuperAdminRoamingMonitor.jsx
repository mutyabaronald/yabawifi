import { useCallback, useEffect, useState } from "react";

const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";
const roamingUiEnabled =
  String(import.meta.env.VITE_ROAMING_REGISTRY_ENABLED || "false").toLowerCase() ===
  "true";

function SuperAdminRoamingMonitor() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [summary, setSummary] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [activeTab, setActiveTab] = useState("summary");
  const [statusFilter, setStatusFilter] = useState("");
  const [visitedOwnerFilter, setVisitedOwnerFilter] = useState("");
  const [homeOwnerFilter, setHomeOwnerFilter] = useState("");
  const [settlementStatusFilter, setSettlementStatusFilter] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem("superToken");
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
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/api/roaming/admin/summary`, {
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        setDisabled(true);
        setError(data.message || "Roaming registry is disabled");
        return;
      }
      if (!res.ok) throw new Error(data.message || "Failed to load roaming summary");
      setDisabled(false);
      setSummary(data.summary || { totalSessions: 0, byStatus: {}, byVisitedOwner: {}, byHomeOwner: {} });
    } catch (err) {
      setError(err.message || "Failed to load roaming summary");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const loadSessions = useCallback(async (reset = true) => {
    if (!roamingUiEnabled) return;
    if (reset) {
      setSessions([]);
      setNextCursor(null);
      setHasMore(false);
    }
    if (reset) setError("");

    setLoading(true);
    setBusy(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (statusFilter) params.append("status", statusFilter);
      if (visitedOwnerFilter) params.append("visitedOwnerId", visitedOwnerFilter);
      if (homeOwnerFilter) params.append("homeOwnerId", homeOwnerFilter);
      if (nextCursor && !reset) params.append("cursor", nextCursor);

      const res = await fetch(
        `${apiBase}/api/roaming/admin/sessions?${params}`,
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

      if (reset) {
        setSessions(data.sessions || []);
      } else {
        setSessions((prev) => [...prev, ...(data.sessions || [])]);
      }
      setHasMore(data.hasMore || false);
      setNextCursor(data.nextCursor || null);
    } catch (err) {
      if (reset) setError(err.message || "Failed to load roaming sessions");
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }, [authHeaders, statusFilter, visitedOwnerFilter, homeOwnerFilter, nextCursor]);

  const loadSettlements = useCallback(async () => {
    if (!roamingUiEnabled) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (homeOwnerFilter) params.append("homeOwnerId", homeOwnerFilter);
      if (statusFilter === "settlement_pending") params.append("status", "pending");
      else if (statusFilter === "settlement_settled") params.append("status", "settled");
      else if (statusFilter === "settlement_failed") params.append("status", "failed");

      const res = await fetch(
        `${apiBase}/api/roaming/admin/settlements?${params}`,
        { headers: authHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        setDisabled(true);
        setError(data.message || "Roaming registry is disabled");
        return;
      }
      if (!res.ok) throw new Error(data.message || "Failed to load settlements");
      setDisabled(false);
      setSettlements(data.settlements || []);
    } catch (err) {
      setError(err.message || "Failed to load settlements");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, homeOwnerFilter, statusFilter]);

  const loadHotspots = useCallback(async () => {
    if (!roamingUiEnabled) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${apiBase}/api/roaming/admin/hotspots?limit=200&includeHealth=true`,
        { headers: authHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        setDisabled(true);
        setError(data.message || "Roaming registry is disabled");
        return;
      }
      if (!res.ok) throw new Error(data.message || "Failed to load hotspots");
      setDisabled(false);
      setHotspots(data.hotspots || []);
    } catch (err) {
      setError(err.message || "Failed to load hotspots");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const loadTabData = useCallback(async () => {
    await loadSummary();
    if (activeTab === "sessions") {
      await loadSessions(true);
    } else if (activeTab === "settlements") {
      await loadSettlements();
    } else if (activeTab === "hotspots") {
      await loadHotspots();
    }
  }, [activeTab, loadSummary, loadSessions, loadSettlements, loadHotspots]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  const handleLoadMore = () => {
    if (hasMore && !loading && !busy) {
      loadSessions(false);
    }
  };

  const statusColor = (status) => {
    if (status === "active" || status === "authorized") return { bg: "#dcfce7", text: "#166534" };
    if (status === "terminated") return { bg: "#fef3c7", text: "#92400e" };
    if (status === "revoked") return { bg: "#fee2e2", text: "#dc2626" };
    if (status === "expired") return { bg: "#f3f4f6", text: "#374151" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  const settlementColor = (status) => {
    if (status === "settled") return { bg: "#dcfce7", text: "#166534" };
    if (status === "failed") return { bg: "#fee2e2", text: "#dc2626" };
    if (status === "pending") return { bg: "#fef3c7", text: "#92400e" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  const fmtDate = (d) =>
    d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  if (!roamingUiEnabled || disabled) {
    return (
      <div style={styles.container}>
        <div style={styles.disabledCard}>
          <h2 style={styles.title}>Super Admin Roaming Monitor</h2>
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
        <h2 style={styles.title}>Super Admin Roaming Monitor</h2>
        <p style={styles.subtitle}>Federation-wide roaming sessions, settlements, and hotspot health</p>
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
        <button
          onClick={() => setActiveTab("settlements")}
          style={{ ...styles.tab, ...(activeTab === "settlements" ? styles.tabActive : {}) }}
        >
          Settlements
        </button>
        <button
          onClick={() => setActiveTab("hotspots")}
          style={{ ...styles.tab, ...(activeTab === "hotspots" ? styles.tabActive : {}) }}
        >
          Hotspots
        </button>
      </div>

      {activeTab === "summary" && (
        <div style={styles.summaryGrid}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Total Sessions</div>
            <div style={styles.summaryValue}>{summary?.totalSessions ?? 0}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Active Sessions</div>
            <div style={styles.summaryValue}>{summary?.totalActive ?? 0}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Total Billed (min)</div>
            <div style={styles.summaryValue}>{summary?.totalBilledMinutes ?? 0}</div>
          </div>
          {summary?.byStatus && (
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>By Status</div>
              <div style={styles.statusList}>
                {Object.entries(summary.byStatus).map(([status, count]) => {
                  const sc = statusColor(status);
                  return (
                    <div key={status} style={{ ...styles.statusItem, backgroundColor: sc.bg, color: sc.text }}>
                      {status}: {count}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {summary?.byVisitedOwner && Object.keys(summary.byVisitedOwner).length > 0 && (
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Top Visited Owners</div>
              <div style={styles.statusList}>
                {Object.entries(summary.byVisitedOwner).slice(0, 5).map(([owner, count]) => (
                  <div key={owner} style={styles.statusItem}>
                    {owner.slice(0, 8)}...: {count}
                  </div>
                ))}
              </div>
            </div>
          )}
          {summary?.byHomeOwner && Object.keys(summary.byHomeOwner).length > 0 && (
            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Top Home Owners</div>
              <div style={styles.statusList}>
                {Object.entries(summary.byHomeOwner).slice(0, 5).map(([owner, count]) => (
                  <div key={owner} style={styles.statusItem}>
                    {owner.slice(0, 8)}...: {count}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "sessions" && (
        <div style={styles.sessionsSection}>
          <div style={styles.filterBar}>
            <label style={styles.filterLabel}>Status:</label>
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

            <label style={styles.filterLabel}>Visited Owner:</label>
            <input
              type="text"
              value={visitedOwnerFilter}
              onChange={(e) => setVisitedOwnerFilter(e.target.value)}
              placeholder="Filter..."
              style={styles.filterInput}
            />

            <label style={styles.filterLabel}>Home Owner:</label>
            <input
              type="text"
              value={homeOwnerFilter}
              onChange={(e) => setHomeOwnerFilter(e.target.value)}
              placeholder="Filter..."
              style={styles.filterInput}
            />

            <button onClick={() => loadSessions(true)} disabled={loading} style={styles.refreshBtn}>
              {loading ? "⟳ Loading..." : "⟳ Refresh"}
            </button>
          </div>

          {loading && sessions.length === 0 && <p style={styles.loading}>Loading sessions...</p>}

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
                    <th style={styles.th}>Visited Hotspot</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Started</th>
                    <th style={styles.th}>Ended</th>
                    <th style={styles.th}>Billed (min)</th>
                    <th style={styles.th}>Home Owner</th>
                    <th style={styles.th}>Visited Owner</th>
                    <th style={styles.th}>Entitlement</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const sc = statusColor(s.status);
                    return (
                      <tr key={s.id} style={styles.tr}>
                        <td style={styles.td}>
                          <code style={styles.code}>{s.id}</code>
                        </td>
                        <td style={styles.td}>
                           <div>{s.userRef?.userId || "—"}</div>
                         </td>
                        <td style={styles.td}>{s.visitedHotspotId || "—"}</td>
                        <td style={styles.td}>
                          <span style={{ ...styles.statusBadge, backgroundColor: sc.bg, color: sc.text }}>
                            {s.status}
                          </span>
                        </td>
                        <td style={styles.td}>{fmtDate(s.startedAt)}</td>
                        <td style={styles.td}>{fmtDate(s.endedAt)}</td>
                        <td style={styles.td}>{s.billedMinutes != null ? s.billedMinutes : "—"}</td>
                        <td style={styles.td}>{s.homeOwnerId || "—"}</td>
                        <td style={styles.td}>{s.visitedOwnerId || "—"}</td>
                        <td style={styles.td}>
                          <code style={styles.code}>{s.entitlementId || "—"}</code>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {hasMore && (
            <div style={styles.loadMore}>
              <button onClick={handleLoadMore} disabled={loading || busy} style={styles.loadMoreBtn}>
                {loading || busy ? "Loading more..." : "Load More"}
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "settlements" && (
        <div style={styles.sessionsSection}>
          <div style={styles.filterBar}>
            <label style={styles.filterLabel}>Home Owner:</label>
            <input
              type="text"
              value={homeOwnerFilter}
              onChange={(e) => setHomeOwnerFilter(e.target.value)}
              placeholder="Filter by owner..."
              style={styles.filterInput}
            />
            <button onClick={loadSettlements} disabled={loading} style={styles.refreshBtn}>
              {loading ? "⟳ Loading..." : "⟳ Refresh"}
            </button>
          </div>

          {loading && <p style={styles.loading}>Loading settlements...</p>}

          {!loading && settlements.length === 0 && (
            <p style={styles.empty}>No settlements found.</p>
          )}

          {!loading && settlements.length > 0 && (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.tableHeader}>
                    <th style={styles.th}>Settlement ID</th>
                    <th style={styles.th}>Home Owner</th>
                    <th style={styles.th}>Visited Owner</th>
                    <th style={styles.th}>Consumed RAUs</th>
                    <th style={styles.th}>Rate</th>
                    <th style={styles.th}>Amount</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => {
                    const sc = settlementColor(s.status);
                    const rate =
                      s.rateNumerator != null && s.rateDenominator != null
                        ? `${s.rateNumerator}/${s.rateDenominator}`
                        : "—";
                    return (
                      <tr key={s.id} style={styles.tr}>
                        <td style={styles.td}>
                          <code style={styles.code}>{s.id.slice(0, 12)}...</code>
                        </td>
                        <td style={styles.td}>{s.homeOwnerId || "—"}</td>
                        <td style={styles.td}>{s.visitedOwnerId || "—"}</td>
                        <td style={styles.td}>{s.consumedRaus != null ? s.consumedRaus : "—"}</td>
                        <td style={styles.td}>{rate}</td>
                        <td style={styles.td}>{s.settlementAmount != null ? s.settlementAmount : "—"}</td>
                        <td style={styles.td}>
                          <span style={{ ...styles.statusBadge, backgroundColor: sc.bg, color: sc.text }}>
                            {s.status}
                          </span>
                        </td>
                        <td style={styles.td}>{fmtDate(s.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "hotspots" && (
        <div style={styles.sessionsSection}>
          <div style={styles.filterBar}>
            <label style={styles.filterLabel}>Owner ID:</label>
            <input
              type="text"
              value={visitedOwnerFilter}
              onChange={(e) => setVisitedOwnerFilter(e.target.value)}
              placeholder="Filter by owner..."
              style={styles.filterInput}
            />
            <button onClick={loadHotspots} disabled={loading} style={styles.refreshBtn}>
              {loading ? "⟳ Loading..." : "⟳ Refresh"}
            </button>
          </div>

          {loading && <p style={styles.loading}>Loading hotspots...</p>}

          {!loading && hotspots.length === 0 && (
            <p style={styles.empty}>No roaming hotspots found.</p>
          )}

          {!loading && hotspots.length > 0 && (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.tableHeader}>
                    <th style={styles.th}>Hotspot ID</th>
                    <th style={styles.th}>Owner ID</th>
                    <th style={styles.th}>Adapter</th>
                    <th style={styles.th}>Enforcement Mode</th>
                    <th style={styles.th}>Partner Status</th>
                    <th style={styles.th}>Health</th>
                    <th style={styles.th}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {hotspots.map((h) => (
                    <tr key={h.id} style={styles.tr}>
                      <td style={styles.td}>
                        <code style={styles.code}>{h.hotspotId || h.id}</code>
                      </td>
                      <td style={styles.td}>{h.ownerId || "—"}</td>
                      <td style={styles.td}>{h.aaaAdapterKey || "—"}</td>
                      <td style={styles.td}>{h.enforcementMode || "—"}</td>
                      <td style={styles.td}>{h.partnerStatus || "—"}</td>
                      <td style={styles.td}>
                        {h.enforcementHealth?.checked === false ? (
                          <span style={styles.notChecked}>Not checked</span>
                        ) : h.enforcementHealth?.healthy === true ? (
                          <span style={{ ...styles.statusBadge, backgroundColor: "#dcfce7", color: "#166534" }}>
                            Healthy
                          </span>
                        ) : h.enforcementHealth?.healthy === false ? (
                          <span style={{ ...styles.statusBadge, backgroundColor: "#fee2e2", color: "#dc2626" }}>
                            Unhealthy
                          </span>
                        ) : (
                          <span style={styles.notChecked}>—</span>
                        )}
                      </td>
                      <td style={styles.td}>{fmtDate(h.createdAt)}</td>
                    </tr>
                  ))}
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
  container: {
    padding: "24px",
    backgroundColor: "var(--surface, #fff)",
    borderRadius: "16px",
    border: "1px solid var(--stroke, #e5e7eb)",
    minHeight: "400px",
  },
  disabledCard: {
    padding: "32px",
    textAlign: "center",
    backgroundColor: "var(--surface-2, #f9fafb)",
    border: "1px solid var(--stroke, #e5e7eb)",
    borderRadius: "12px",
  },
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
  statusList: { display: "flex", flexWrap: "wrap", gap: 4, fontSize: 12, marginTop: 4 },
  statusItem: { fontSize: 11, fontWeight: 500, padding: "2px 6px", borderRadius: "4px", whiteSpace: "nowrap" },
  sessionsSection: { marginTop: "8px" },
  filterBar: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" },
  filterLabel: { fontSize: "13px", fontWeight: 500, color: "var(--text-primary, #0f172a)" },
  filterSelect: { padding: "8px 12px", border: "1px solid var(--stroke, #e5e7eb)", borderRadius: "8px", backgroundColor: "var(--surface, #fff)", fontSize: "13px", minWidth: "140px" },
  filterInput: { padding: "8px 12px", border: "1px solid var(--stroke, #e5e7eb)", borderRadius: "8px", backgroundColor: "var(--surface, #fff)", fontSize: "13px", minWidth: "140px" },
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
  notChecked: { fontSize: "11px", color: "var(--text-muted, #6b7280)" },
  loadMore: { padding: "16px", textAlign: "center" },
  loadMoreBtn: { padding: "8px 20px", border: "1px solid var(--stroke, #e5e7eb)", borderRadius: "8px", backgroundColor: "var(--surface, #fff)", cursor: "pointer", fontSize: "13px", fontWeight: 500 },
};

export default SuperAdminRoamingMonitor;
