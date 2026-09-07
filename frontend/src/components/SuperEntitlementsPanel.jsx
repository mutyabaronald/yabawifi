import { useCallback, useEffect, useState } from "react";

const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";

function SuperEntitlementsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [entitlements, setEntitlements] = useState([]);
  const [filterOwnerId, setFilterOwnerId] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem("superToken");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const loadEntitlements = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filterOwnerId) params.append("homeOwnerId", filterOwnerId);
      if (filterUserId) params.append("userId", filterUserId);
      if (filterStatus) params.append("status", filterStatus);

      const res = await fetch(
        `${apiBase}/api/roaming/entitlements?${params.toString()}`,
        { headers: authHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Failed to load entitlements");
      }
      setEntitlements(data.entitlements || []);
    } catch (err) {
      setError(err.message || "Failed to load entitlements");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, filterOwnerId, filterUserId, filterStatus]);

  useEffect(() => {
    loadEntitlements();
  }, [loadEntitlements]);

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
        <h2 style={{ margin: 0 }}>Roaming Entitlements</h2>
        <button
          onClick={loadEntitlements}
          disabled={loading}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--stroke)",
            background: "var(--surface-2)",
            cursor: loading ? "not-allowed" : "pointer",
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
        <p style={{ margin: "0 0 8px 0", color: "var(--text-muted)", fontSize: 14 }}>
          <strong>Note:</strong> Entitlements are permission records only. 
          Network access and roaming authentication are not yet implemented.
        </p>
      </div>

      <div
        style={{
          padding: 16,
          border: "1px solid var(--stroke)",
          borderRadius: 12,
          background: "var(--surface-2)",
          marginBottom: 16,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Filters</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
              Home Owner ID
            </label>
            <input
              type="text"
              value={filterOwnerId}
              onChange={(e) => setFilterOwnerId(e.target.value)}
              placeholder="Filter by owner..."
              style={{ width: "100%", padding: 8 }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
              User ID
            </label>
            <input
              type="text"
              value={filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)}
              placeholder="Filter by user..."
              style={{ width: "100%", padding: 8 }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
              Status
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ width: "100%", padding: 8 }}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>
        </div>
        <button
          onClick={loadEntitlements}
          style={{
            marginTop: 12,
            padding: "8px 12px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Apply Filters
        </button>
      </div>

      <div
        style={{
          padding: 16,
          border: "1px solid var(--stroke)",
          borderRadius: 12,
          background: "var(--surface-2)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>All Entitlements</h3>
        {loading ? (
          <p>Loading...</p>
        ) : entitlements.length === 0 ? (
          <p style={{ color: "var(--text-muted)", margin: 0 }}>
            No entitlements found.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {entitlements.map((ent) => (
              <div
                key={ent.id}
                style={{
                  padding: 12,
                  border: "1px solid var(--stroke)",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 600 }}>
                    User: {ent.userRef?.userId || "Unknown"}
                    {ent.userRef?.phone && ` (${ent.userRef.phone})`}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    Home Owner: {ent.homeOwnerId} · Status: {ent.status} · Scope: {ent.scope}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Entitlement ID: {ent.id}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Source: {ent.source || "unknown"} · Created: {new Date(ent.createdAt).toLocaleString()}
                  </div>
                  {ent.validity?.startsAt && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Starts: {new Date(ent.validity.startsAt).toLocaleString()}
                    </div>
                  )}
                  {ent.validity?.expiresAt && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Expires: {new Date(ent.validity.expiresAt).toLocaleString()}
                    </div>
                  )}
                  {ent.quota && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Quota: Sessions={ent.quota.maxSessions || "∞"}, 
                      Minutes={ent.quota.maxMinutes || "∞"}, 
                      MB={ent.quota.maxMegabytes || "∞"}
                    </div>
                  )}
                  {ent.scope === "owner" && ent.scopeRefs?.ownerIds && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Allowed Owners: {ent.scopeRefs.ownerIds.join(", ")}
                    </div>
                  )}
                  {ent.scope === "hotspot" && ent.scopeRefs?.hotspotIds && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Allowed Hotspots: {ent.scopeRefs.hotspotIds.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SuperEntitlementsPanel;
