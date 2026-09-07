import { useCallback, useEffect, useState } from "react";

const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";

function OwnerEntitlementsPanel({ ownerId }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [entitlements, setEntitlements] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    userId: "",
    phone: "",
    scope: "federation",
    ownerIds: "",
    hotspotIds: "",
    expiresAt: "",
    maxSessions: "",
    maxMinutes: "",
    maxMegabytes: "",
  });

  const authHeaders = useCallback(() => {
    const token = localStorage.getItem("ownerToken");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const loadEntitlements = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${apiBase}/api/roaming/entitlements?homeOwnerId=${encodeURIComponent(ownerId)}`,
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
  }, [authHeaders, ownerId]);

  useEffect(() => {
    loadEntitlements();
  }, [loadEntitlements]);

  const createEntitlement = async () => {
    if (!formData.userId) {
      setError("User ID is required");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const scopeRefs = {};
      if (formData.scope === "owner") {
        scopeRefs.ownerIds = formData.ownerIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (scopeRefs.ownerIds.length === 0) {
          throw new Error("At least one owner ID required for owner scope");
        }
      } else if (formData.scope === "hotspot") {
        scopeRefs.hotspotIds = formData.hotspotIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (scopeRefs.hotspotIds.length === 0) {
          throw new Error("At least one hotspot ID required for hotspot scope");
        }
      }

      const payload = {
        homeOwnerId: ownerId,
        userRef: {
          userId: formData.userId,
          phone: formData.phone || null,
          authType: "yabalink",
        },
        scope: formData.scope,
        scopeRefs,
        status: "active",
        validity: {
          startsAt: new Date().toISOString(),
          expiresAt: formData.expiresAt || null,
        },
        quota: {
          maxSessions: formData.maxSessions ? parseInt(formData.maxSessions) : null,
          maxMinutes: formData.maxMinutes ? parseInt(formData.maxMinutes) : null,
          maxMegabytes: formData.maxMegabytes ? parseInt(formData.maxMegabytes) : null,
        },
        source: "manual",
      };

      const res = await fetch(`${apiBase}/api/roaming/entitlements`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to create entitlement");
      
      setMessage("Entitlement created successfully. Note: This is a permission record only. Network access is not yet implemented.");
      setShowCreateForm(false);
      setFormData({
        userId: "",
        phone: "",
        scope: "federation",
        ownerIds: "",
        hotspotIds: "",
        expiresAt: "",
        maxSessions: "",
        maxMinutes: "",
        maxMegabytes: "",
      });
      await loadEntitlements();
    } catch (err) {
      setError(err.message || "Failed to create entitlement");
    } finally {
      setBusy(false);
    }
  };

  const suspendEntitlement = async (entitlementId) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(
        `${apiBase}/api/roaming/entitlements/${encodeURIComponent(entitlementId)}/suspend`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ reason: "owner_suspended" }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to suspend entitlement");
      setMessage("Entitlement suspended");
      await loadEntitlements();
    } catch (err) {
      setError(err.message || "Failed to suspend entitlement");
    } finally {
      setBusy(false);
    }
  };

  const revokeEntitlement = async (entitlementId) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(
        `${apiBase}/api/roaming/entitlements/${encodeURIComponent(entitlementId)}/revoke`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ reason: "owner_revoked" }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to revoke entitlement");
      setMessage("Entitlement revoked");
      await loadEntitlements();
    } catch (err) {
      setError(err.message || "Failed to revoke entitlement");
    } finally {
      setBusy(false);
    }
  };

  const restoreEntitlement = async (entitlementId) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(
        `${apiBase}/api/roaming/entitlements/${encodeURIComponent(entitlementId)}/restore`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({}),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to restore entitlement");
      setMessage("Entitlement restored");
      await loadEntitlements();
    } catch (err) {
      setError(err.message || "Failed to restore entitlement");
    } finally {
      setBusy(false);
    }
  };

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
        <h2 style={{ margin: 0 }}>Roaming Entitlements</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
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
          {showCreateForm ? "Cancel" : "Create Entitlement"}
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
        <p style={{ margin: "0 0 8px 0", color: "var(--text-muted)", fontSize: 14 }}>
          <strong>Important:</strong> Entitlements are permission records only. 
          Network access and roaming authentication are not yet implemented. 
          Creating an entitlement does not grant actual network access.
        </p>
      </div>

      {showCreateForm && (
        <div
          style={{
            padding: 16,
            border: "1px solid var(--stroke)",
            borderRadius: 12,
            background: "var(--surface-2)",
            marginBottom: 16,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Create New Entitlement</h3>
          
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={{ display: "block", marginBottom: 4 }}>
                User ID (required)
              </label>
              <input
                type="text"
                value={formData.userId}
                onChange={(e) =>
                  setFormData({ ...formData, userId: e.target.value })
                }
                placeholder="user_12345"
                style={{ width: "100%", padding: 8 }}
                disabled={busy}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: 4 }}>
                Phone (optional)
              </label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
                placeholder="+256..."
                style={{ width: "100%", padding: 8 }}
                disabled={busy}
              />
            </div>

            <div>
              <label style={{ display: "block", marginBottom: 4 }}>Scope</label>
              <select
                value={formData.scope}
                onChange={(e) =>
                  setFormData({ ...formData, scope: e.target.value })
                }
                style={{ width: "100%", padding: 8 }}
                disabled={busy}
              >
                <option value="federation">Federation (all partners)</option>
                <option value="owner">Specific owners</option>
                <option value="hotspot">Specific hotspots</option>
              </select>
            </div>

            {formData.scope === "owner" && (
              <div>
                <label style={{ display: "block", marginBottom: 4 }}>
                  Owner IDs (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.ownerIds}
                  onChange={(e) =>
                    setFormData({ ...formData, ownerIds: e.target.value })
                  }
                  placeholder="owner1, owner2, owner3"
                  style={{ width: "100%", padding: 8 }}
                  disabled={busy}
                />
              </div>
            )}

            {formData.scope === "hotspot" && (
              <div>
                <label style={{ display: "block", marginBottom: 4 }}>
                  Hotspot IDs (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.hotspotIds}
                  onChange={(e) =>
                    setFormData({ ...formData, hotspotIds: e.target.value })
                  }
                  placeholder="hotspot1, hotspot2"
                  style={{ width: "100%", padding: 8 }}
                  disabled={busy}
                />
              </div>
            )}

            <div>
              <label style={{ display: "block", marginBottom: 4 }}>
                Expires At (optional)
              </label>
              <input
                type="datetime-local"
                value={formData.expiresAt}
                onChange={(e) =>
                  setFormData({ ...formData, expiresAt: e.target.value ? new Date(e.target.value).toISOString() : "" })
                }
                style={{ width: "100%", padding: 8 }}
                disabled={busy}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
                  Max Sessions
                </label>
                <input
                  type="number"
                  value={formData.maxSessions}
                  onChange={(e) =>
                    setFormData({ ...formData, maxSessions: e.target.value })
                  }
                  placeholder="Unlimited"
                  style={{ width: "100%", padding: 8 }}
                  disabled={busy}
                  min="0"
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
                  Max Minutes
                </label>
                <input
                  type="number"
                  value={formData.maxMinutes}
                  onChange={(e) =>
                    setFormData({ ...formData, maxMinutes: e.target.value })
                  }
                  placeholder="Unlimited"
                  style={{ width: "100%", padding: 8 }}
                  disabled={busy}
                  min="0"
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
                  Max MB
                </label>
                <input
                  type="number"
                  value={formData.maxMegabytes}
                  onChange={(e) =>
                    setFormData({ ...formData, maxMegabytes: e.target.value })
                  }
                  placeholder="Unlimited"
                  style={{ width: "100%", padding: 8 }}
                  disabled={busy}
                  min="0"
                />
              </div>
            </div>

            <button
              onClick={createEntitlement}
              disabled={busy || !formData.userId}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                cursor: busy || !formData.userId ? "not-allowed" : "pointer",
              }}
            >
              Create Entitlement
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          padding: 16,
          border: "1px solid var(--stroke)",
          borderRadius: 12,
          background: "var(--surface-2)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Entitlements List</h3>
        {loading ? (
          <p style={{ color: "var(--text-muted)" }}>Loading...</p>
        ) : entitlements.length === 0 ? (
          <p style={{ color: "var(--text-muted)", margin: 0 }}>
            No entitlements created yet.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {entitlements.map((ent) => (
              <div
                key={ent.id}
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
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    User: {ent.userRef?.userId || "Unknown"}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    Status: {ent.status} · Scope: {ent.scope}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    ID: {ent.id}
                  </div>
                  {ent.validity?.expiresAt && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Expires: {new Date(ent.validity.expiresAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ent.status === "active" && (
                    <>
                      <button
                        onClick={() => suspendEntitlement(ent.id)}
                        disabled={busy}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: "1px solid var(--stroke)",
                          background: "var(--surface-3)",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontSize: 13,
                        }}
                      >
                        Suspend
                      </button>
                      <button
                        onClick={() => revokeEntitlement(ent.id)}
                        disabled={busy}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: "1px solid var(--danger)",
                          background: "transparent",
                          color: "var(--danger)",
                          cursor: busy ? "not-allowed" : "pointer",
                          fontSize: 13,
                        }}
                      >
                        Revoke
                      </button>
                    </>
                  )}
                  {(ent.status === "suspended" || ent.status === "revoked") && (
                    <button
                      onClick={() => restoreEntitlement(ent.id)}
                      disabled={busy}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--accent)",
                        background: "var(--accent)",
                        color: "#fff",
                        cursor: busy ? "not-allowed" : "pointer",
                        fontSize: 13,
                      }}
                    >
                      Restore
                    </button>
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

export default OwnerEntitlementsPanel;
