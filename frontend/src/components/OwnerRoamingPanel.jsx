import { useCallback, useEffect, useState } from "react";

const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";
const roamingUiEnabled =
  String(import.meta.env.VITE_ROAMING_REGISTRY_ENABLED || "false").toLowerCase() ===
  "true";

function OwnerRoamingPanel({ ownerId, hotspots = [] }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [partner, setPartner] = useState(null);
  const [roamingHotspots, setRoamingHotspots] = useState([]);
  const [selectedHotspotId, setSelectedHotspotId] = useState("");
  const [adapterKey, setAdapterKey] = useState("unknown");

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem("ownerToken");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const loadStatus = useCallback(async () => {
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
        `${apiBase}/api/roaming/partners/${encodeURIComponent(ownerId)}/status`,
        { headers: authHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        setDisabled(true);
        setError(data.message || "Roaming registry is disabled");
        return;
      }
      if (!res.ok) {
        throw new Error(data.message || "Failed to load roaming status");
      }
      setDisabled(false);
      setPartner(data.partner || null);
      setRoamingHotspots(data.hotspots || []);
      setSelectedHotspotId((prev) => {
        if (prev) return prev;
        return hotspots[0]?.id || data.hotspots?.[0]?.hotspotId || "";
      });
    } catch (err) {
      setError(err.message || "Failed to load roaming status");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, hotspots, ownerId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const optIn = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${apiBase}/api/roaming/partners/opt-in`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          homeRoleEnabled: true,
          visitedRoleEnabled: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Opt-in failed");
      setMessage(
        data.partner?.federationStatus === "draft"
          ? "Federation opt-in submitted. Waiting for super-admin approval."
          : "Federation preferences updated."
      );
      await loadStatus();
    } catch (err) {
      setError(err.message || "Opt-in failed");
    } finally {
      setBusy(false);
    }
  };

  const registerHotspot = async () => {
    if (!selectedHotspotId) {
      setError("Select a hotspot to enable for roaming");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${apiBase}/api/roaming/hotspots/register`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          hotspotId: selectedHotspotId,
          aaaAdapterKey: adapterKey,
          enforcementMode: adapterKey === "radius" ? "radius" : "local_adapter",
          capabilities: {
            captivePortal: true,
            localProvisioning: adapterKey !== "radius",
            radiusAuth: adapterKey === "radius",
            radiusAccounting: adapterKey === "radius",
            disconnect: true,
            usageAccounting: false,
            passpoint: false,
            eapMethods: [],
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to enable hotspot");
      setMessage("Hotspot enabled for roaming.");
      await loadStatus();
    } catch (err) {
      setError(err.message || "Failed to enable hotspot");
    } finally {
      setBusy(false);
    }
  };

  const disableHotspot = async (hotspotId) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(
        `${apiBase}/api/roaming/hotspots/${encodeURIComponent(hotspotId)}/disable`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({}),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to disable hotspot");
      setMessage("Hotspot disabled for roaming.");
      await loadStatus();
    } catch (err) {
      setError(err.message || "Failed to disable hotspot");
    } finally {
      setBusy(false);
    }
  };

  if (!roamingUiEnabled || disabled) {
    return (
      <div
        style={{
          padding: 20,
          border: "1px solid var(--stroke)",
          borderRadius: 12,
          background: "var(--surface-2)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Roaming Federation</h2>
        <p style={{ color: "var(--text-muted)" }}>
          Roaming registry is currently disabled. Set{" "}
          <code>ROAMING_REGISTRY_ENABLED=true</code> on the backend and{" "}
          <code>VITE_ROAMING_REGISTRY_ENABLED=true</code> for the frontend to use
          this section.
        </p>
      </div>
    );
  }

  const status = partner?.federationStatus || "not_joined";
  const canRegister = status === "active";

  return (
    <div>
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
          onClick={optIn}
          disabled={busy || loading}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {partner ? "Update / Re-apply Opt-in" : "Opt into Federation"}
        </button>
      </div>

      {error && (
        <p style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</p>
      )}
      {message && (
        <p style={{ color: "var(--success, #059669)", marginBottom: 12 }}>
          {message}
        </p>
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
        <p style={{ margin: "0 0 8px 0" }}>
          <strong>Federation status:</strong> {loading ? "…" : status}
        </p>
        <p style={{ margin: "0 0 8px 0", color: "var(--text-muted)" }}>
          Home role: {String(partner?.homeRoleEnabled ?? false)} · Visited role:{" "}
          {String(partner?.visitedRoleEnabled ?? false)}
        </p>
        {partner?.suspensionReason && (
          <p style={{ margin: 0, color: "var(--danger)" }}>
            Reason: {partner.suspensionReason}
          </p>
        )}
        {!canRegister && partner && (
          <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
            Hotspot roaming enablement requires an <strong>active</strong> partner
            status (super-admin approval).
          </p>
        )}
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
        <h3 style={{ marginTop: 0 }}>Enable a hotspot for roaming</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={selectedHotspotId}
            onChange={(e) => setSelectedHotspotId(e.target.value)}
            style={{ padding: 8, minWidth: 220 }}
            disabled={!canRegister || busy}
          >
            <option value="">Select hotspot</option>
            {hotspots.map((h) => (
              <option key={h.id} value={h.id}>
                {h.hotspotName || h.name || h.id}
              </option>
            ))}
          </select>
          <select
            value={adapterKey}
            onChange={(e) => setAdapterKey(e.target.value)}
            style={{ padding: 8 }}
            disabled={!canRegister || busy}
          >
            <option value="unknown">Adapter: unknown</option>
            <option value="mikrotik">Adapter: mikrotik</option>
            <option value="cisco">Adapter: cisco</option>
            <option value="unifi">Adapter: unifi</option>
            <option value="tplink">Adapter: tplink</option>
            <option value="radius">Adapter: radius</option>
          </select>
          <button
            onClick={registerHotspot}
            disabled={!canRegister || busy || !selectedHotspotId}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--stroke)",
              background: "var(--surface-3)",
              cursor: !canRegister || busy ? "not-allowed" : "pointer",
            }}
          >
            Enable for roaming
          </button>
        </div>
      </div>

      <div
        style={{
          padding: 16,
          border: "1px solid var(--stroke)",
          borderRadius: 12,
          background: "var(--surface-2)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Registered roaming hotspots</h3>
        {roamingHotspots.length === 0 ? (
          <p style={{ color: "var(--text-muted)", margin: 0 }}>
            No roaming hotspots registered yet.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {roamingHotspots.map((h) => (
              <div
                key={h.hotspotId || h.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  padding: 12,
                  border: "1px solid var(--stroke)",
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {h.networkIdentity?.venueName || h.hotspotId}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    Status: {h.partnerStatus} · Mode: {h.enforcementMode} ·
                    Adapter: {h.aaaAdapterKey}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Caps: portal={String(!!h.capabilities?.captivePortal)}, local=
                    {String(!!h.capabilities?.localProvisioning)}, radius=
                    {String(!!h.capabilities?.radiusAuth)}, passpoint=
                    {String(!!h.capabilities?.passpoint)}
                  </div>
                </div>
                {h.partnerStatus !== "disabled" && (
                  <button
                    onClick={() => disableHotspot(h.hotspotId)}
                    disabled={busy}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--danger)",
                      background: "transparent",
                      color: "var(--danger)",
                      cursor: busy ? "not-allowed" : "pointer",
                    }}
                  >
                    Disable
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default OwnerRoamingPanel;
