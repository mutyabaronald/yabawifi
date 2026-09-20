import React from "react";

// Phase 7.4 — customer read-only roaming usage & history.
// Displays authoritative data served by GET /api/users/:phone/roaming-usage.
// This component never writes accounting data.
const RoamingUsage = ({ usage }) => {
  const safe = usage || { active: null, history: [], summary: {} };
  const active = safe.active;
  const history = Array.isArray(safe.history) ? safe.history : [];
  const summary = safe.summary || {};

  const fmtDate = (d) =>
    d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "N/A";

  const statusColor = (status) => {
    if (status === "active" || status === "authorized") return { bg: "#dcfce7", text: "#166534" };
    if (status === "terminated") return { bg: "#fee2e2", text: "#dc2626" };
    if (status === "revoked") return { bg: "#fecaca", text: "#991118" };
    if (status === "expired") return { bg: "#fef3c7", text: "#92400e" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Roaming Usage</h2>
        <p style={styles.subtitle}>Your roaming sessions and RAU consumption (read-only)</p>
      </div>

      {active && (
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={{ ...styles.statusTag, ...statusColor(active.status) }}>● {active.status}</span>
            <span style={styles.badge}>Active</span>
          </div>
          <h3 style={styles.cardTitle}>{active.packageName || "Roaming Access"}</h3>
          <div style={styles.grid}>
            <Field label="Hotspot" value={active.hotspotId || "—"} />
            <Field label="Started" value={fmtDate(active.startedAt)} />
            <Field label="Connected (min)" value={active.connectedMinutes ?? "—"} />
            <Field label="RAUs granted" value={active.rausGranted ?? "—"} />
            <Field label="RAUs consumed" value={active.rausConsumed ?? "—"} />
            <Field label="RAUs remaining" value={active.rausRemaining ?? "—"} />
            <Field label="Session" value={active.sessionId} mono />
          </div>
        </div>
      )}

      {!active && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>No active roaming session</h3>
          <p style={styles.subtitle}>You are not currently connected to a roaming hotspot.</p>
        </div>
      )}

      <h3 style={styles.sectionTitle}>History ({history.length})</h3>
      {history.length === 0 ? (
        <div style={styles.empty}>No roaming history yet.</div>
      ) : (
        <div style={styles.list}>
          {history.map((h) => (
            <div key={h.sessionId} style={styles.historyItem}>
              <div style={styles.historyLeft}>
                <span style={{ ...styles.statusTag, ...statusColor(h.status) }}>{h.status}</span>
                <div style={styles.historyContent}>
                  <div style={styles.historyTitle}>{h.packageName || "Roaming Access"}</div>
                  <div style={styles.historyMeta}>{h.hotspotId || "—"} · {fmtDate(h.startedAt)} → {fmtDate(h.endedAt)}</div>
                </div>
              </div>
              <div style={styles.historyRight}>
                <div style={styles.historyMeta}>connected {h.connectedMinutes ?? 0} min</div>
                <div style={styles.historyMeta}>RAUs consumed {h.rausConsumed ?? "—"}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {summary && (
        <div style={styles.summary}>
          <Field label="Total roaming sessions" value={summary.totalSessions ?? 0} />
          <Field label="Total RAUs consumed" value={summary.totalRaUsConsumed ?? 0} />
        </div>
      )}
    </div>
  );
};

const Field = ({ label, value, mono }) => (
  <div style={styles.field}>
    <span style={styles.fieldLabel}>{label}</span>
    <span style={{ ...styles.fieldValue, fontFamily: mono ? "monospace" : undefined }}>{value}</span>
  </div>
);

const styles = {
  container: { padding: "24px", backgroundColor: "var(--surface, #fff)", borderRadius: "16px", border: "1px solid var(--stroke, #e5e7eb)", minHeight: "400px" },
  header: { marginBottom: "16px" },
  title: { fontSize: "24px", fontWeight: 700, margin: 0, color: "var(--text-primary, #0f172a)" },
  subtitle: { fontSize: "13px", color: "var(--text-muted, #6b7280)", marginTop: "4px" },
  card: { border: "1px solid var(--stroke, #e5e7eb)", borderRadius: "12px", padding: "16px", marginBottom: "16px", backgroundColor: "var(--surface, #fff)" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" },
  cardTitle: { fontSize: "16px", fontWeight: 600, margin: "0 0 8px 0", color: "var(--text-primary, #0f172a)" },
  badge: { fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "999px", backgroundColor: "#dbeafe", color: "#1e40af" },
  statusTag: { fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "999px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px 12px" },
  field: { display: "flex", flexDirection: "column", gap: "2px" },
  fieldLabel: { fontSize: "11px", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.04em" },
  fieldValue: { fontSize: "13px", fontWeight: 600, color: "var(--text-primary, #0f172a)" },
  sectionTitle: { fontSize: "18px", fontWeight: 600, margin: "0 0 12px 0", color: "var(--text-primary, #0f172a)" },
  list: { display: "flex", flexDirection: "column", gap: "10px" },
  historyItem: { display: "flex", justifyContent: "space-between", gap: "12px", padding: "12px", border: "1px solid var(--stroke, #e5e7eb)", borderRadius: "10px", backgroundColor: "var(--surface, #fff)" },
  historyLeft: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 },
  historyContent: { minWidth: 0 },
  historyTitle: { fontSize: "14px", fontWeight: 600, color: "var(--text-primary, #0f172a)", margin: 0 },
  historyMeta: { fontSize: "12px", color: "var(--text-muted, #6b7280)", marginTop: "2px" },
  historyRight: { textAlign: "right", fontSize: "12px", color: "var(--text-muted, #6b7280)" },
  empty: { padding: "20px", textAlign: "center", color: "var(--text-muted, #6b7280)" },
  summary: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginTop: "12px" },
};

export default RoamingUsage;
