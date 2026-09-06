import { useCallback, useEffect, useState } from "react";

const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";
const roamingUiEnabled =
  String(import.meta.env.VITE_ROAMING_REGISTRY_ENABLED || "false").toLowerCase() ===
  "true";

function SuperRoamingPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [partners, setPartners] = useState([]);
  const [discoverHotspots, setDiscoverHotspots] = useState([]);

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem("superToken");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const load = useCallback(async () => {
    if (!roamingUiEnabled) {
      setDisabled(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [partnersRes, discoverRes] = await Promise.all([
        fetch(`${apiBase}/api/roaming/partners`, { headers: authHeaders() }),
        fetch(`${apiBase}/api/roaming/hotspots/discover`),
      ]);

      const partnersData = await partnersRes.json().catch(() => ({}));
      const discoverData = await discoverRes.json().catch(() => ({}));

      if (partnersRes.status === 503 || discoverRes.status === 503) {
        setDisabled(true);
        setError(
          partnersData.message ||
            discoverData.message ||
            "Roaming registry is disabled"
        );
        return;
      }
      if (!partnersRes.ok) {
        throw new Error(partnersData.message || "Failed to load partners");
      }
      if (!discoverRes.ok) {
        throw new Error(discoverData.message || "Failed to discover hotspots");
      }

      setDisabled(false);
      setPartners(partnersData.partners || []);
      setDiscoverHotspots(discoverData.hotspots || []);
    } catch (err) {
      setError(err.message || "Failed to load roaming registry");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const adminAction = async (ownerId, action) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(
        `${apiBase}/api/roaming/partners/${encodeURIComponent(ownerId)}/admin-action`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            action,
            reason: `super_admin_${action}`,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Failed to ${action}`);
      setMessage(`Partner ${ownerId}: ${action} succeeded.`);
      await load();
    } catch (err) {
      setError(err.message || `Failed to ${action}`);
    } finally {
      setBusy(false);
    }
  };

  if (!roamingUiEnabled || disabled) {
    return (
      <div style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Roaming Federation</h2>
        <p style={{ color: "var(--text-muted)" }}>
          Roaming registry is disabled. Enable{" "}
          <code>ROAMING_REGISTRY_ENABLED=true</code> on the backend and{" "}
          <code>VITE_ROAMING_REGISTRY_ENABLED=true</code> on the frontend.
        </p>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ padding: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0 }}>Roaming Federation</h2>
        <button
          onClick={load}
          disabled={busy || loading}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--stroke)",
            background: "var(--surface-2)",
            cursor: busy || loading ? "not-allowed" : "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {message && (
        <p style={{ color: "var(--success, #059669)" }}>{message}</p>
      )}

      <div
        style={{
          padding: 16,
          border: "1px solid var(--stroke)",
          borderRadius: 12,
          background: "var(--surface-2)",
          marginBottom: 16,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Participating owners</h3>
        {loading ? (
          <p>Loading…</p>
        ) : partners.length === 0 ? (
          <p style={{ color: "var(--text-muted)", margin: 0 }}>
            No roaming partners yet.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {partners.map((p) => (
              <div
                key={p.ownerId || p.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  padding: 12,
                  border: "1px solid var(--stroke)",
                  borderRadius: 8,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {p.displayName || p.ownerId}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    ownerId: {p.ownerId} · status: {p.federationStatus} · home=
                    {String(!!p.homeRoleEnabled)} · visited=
                    {String(!!p.visitedRoleEnabled)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    disabled={busy || p.federationStatus === "active"}
                    onClick={() => adminAction(p.ownerId, "approve")}
                    style={{ padding: "6px 10px", borderRadius: 6 }}
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy || p.federationStatus === "suspended"}
                    onClick={() => adminAction(p.ownerId, "suspend")}
                    style={{ padding: "6px 10px", borderRadius: 6 }}
                  >
                    Suspend
                  </button>
                  <button
                    disabled={busy || p.federationStatus === "terminated"}
                    onClick={() => adminAction(p.ownerId, "terminate")}
                    style={{ padding: "6px 10px", borderRadius: 6 }}
                  >
                    Terminate
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          padding: 16,
          border: "1px solid var(--stroke)",
          borderRadius: 12,
          background: "var(--surface-2)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Active discoverable roaming hotspots</h3>
        {discoverHotspots.length === 0 ? (
          <p style={{ color: "var(--text-muted)", margin: 0 }}>
            No active roaming hotspots in discovery.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {discoverHotspots.map((h) => (
              <div
                key={h.hotspotId || h.id}
                style={{
                  padding: 10,
                  border: "1px solid var(--stroke)",
                  borderRadius: 8,
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {h.networkIdentity?.venueName || h.hotspotId}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  hotspotId: {h.hotspotId} · ownerId: {h.ownerId} · adapter:{" "}
                  {h.aaaAdapterKey} · mode: {h.enforcementMode}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SuperRoamingPanel;
