import React, { useState } from "react";
import axios from "axios";

export default function CiscoOnboardForm({ locations = [], onSuccess }) {
  const [ip, setIp] = useState("");
  const [sshPort, setSshPort] = useState(22);
  const [sshUser, setSshUser] = useState("");
  const [sshPassword, setSshPassword] = useState("");
  const [enablePassword, setEnablePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resultInfo, setResultInfo] = useState(null);

  const hasLocations = Array.isArray(locations) && locations.length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResultInfo(null);

    const ownerId = localStorage.getItem("ownerId");
    if (!ownerId) {
      setError("Owner not authenticated. Please log in as admin.");
      setLoading(false);
      return;
    }

    try {
      const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";
      const res = await axios.post(`${apiBase}/api/devices/cisco/onboard`, {
        ip,
        sshPort: Number(sshPort) || 22,
        sshUser,
        sshPassword,
        enablePassword,
        locationId: locationId || null,
        ownerId,
      });

      const data = res.data || {};
      setResultInfo({
        deviceId: data.deviceId,
        model: data.model,
        version: data.version,
      });

      if (onSuccess) {
        onSuccess(data);
      }
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "Failed to onboard Cisco router.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="yaba-card"
      style={{
        marginTop: 16,
        padding: 20,
        borderRadius: 16,
        border: "1px solid var(--stroke)",
        background: "var(--surface-gradient)",
        color: "var(--text-primary)",
      }}
    >
      <h3
        style={{
          marginTop: 0,
          marginBottom: 8,
          fontSize: 18,
          fontWeight: 600,
        }}
      >
        Cisco Router Onboarding
      </h3>
      <p
        style={{
          marginTop: 0,
          marginBottom: 16,
          fontSize: 13,
          color: "var(--text-secondary)",
        }}
      >
        Connect to a Cisco IOS / IOS-XE router over SSH and apply the YABALink
        AAA + QoS bootstrap configuration.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <label style={styles.label}>
          Router IP Address *
          <input
            type="text"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            required
            style={styles.input}
            placeholder="e.g. 192.168.1.1"
          />
        </label>

        <label style={styles.label}>
          SSH Port
          <input
            type="number"
            value={sshPort}
            onChange={(e) => setSshPort(e.target.value)}
            style={styles.input}
            min={1}
            max={65535}
          />
        </label>

        <label style={styles.label}>
          SSH Username *
          <input
            type="text"
            value={sshUser}
            onChange={(e) => setSshUser(e.target.value)}
            required
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          SSH Password *
          <div style={{ position: "relative" }}>
            <input
              type={showPassword ? "text" : "password"}
              value={sshPassword}
              onChange={(e) => setSshPassword(e.target.value)}
              required
              style={{ ...styles.input, paddingRight: 80 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              style={styles.toggleBtn}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </label>

        <label style={styles.label}>
          Privileged exec password (enable) – optional
          <input
            type="password"
            value={enablePassword}
            onChange={(e) => setEnablePassword(e.target.value)}
            style={styles.input}
            placeholder="Only if your router requires 'enable' password"
          />
        </label>

        {hasLocations && (
          <label style={styles.label}>
            Location (optional)
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              style={styles.input}
            >
              <option value="">Select location</option>
              {locations.map((loc) => (
                <option key={loc.id || loc.value} value={loc.id || loc.value}>
                  {loc.name || loc.label || loc.id || loc.value}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="submit"
          className="yaba-btn yaba-btn--accent"
          disabled={loading}
          style={{ marginTop: 8 }}
        >
          {loading ? "Connecting to Cisco…" : "Onboard Cisco Router"}
        </button>
      </form>

      {error && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 8,
            background: "rgba(239,68,68,0.1)",
            color: "#b91c1c",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {resultInfo && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 8,
            background: "rgba(16,185,129,0.08)",
            color: "#166534",
            fontSize: 13,
          }}
        >
          <div>
            ✅ Cisco router onboarded.
            {resultInfo.model && (
              <>
                {" "}
                Model: <b>{resultInfo.model}</b>
              </>
            )}
            {resultInfo.version && (
              <>
                {" "}
                IOS: <b>{resultInfo.version}</b>
              </>
            )}
          </div>
          {resultInfo.deviceId && (
            <div>
              Device ID: <code>{resultInfo.deviceId}</code>
            </div>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          padding: 12,
          borderRadius: 10,
          background: "rgba(15,23,42,0.04)",
          fontSize: 12,
          color: "var(--text-secondary)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          Cisco pre‑requisites:
        </div>
        <ol style={{ paddingLeft: 18, margin: 0 }}>
          <li>ip ssh version 2</li>
          <li>username admin privilege 15 secret yourpass</li>
          <li>transport input ssh</li>
          <li>router reachable on port 22</li>
        </ol>
      </div>
    </div>
  );
}

const styles = {
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  input: {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    border: "1px solid var(--stroke)",
    background: "var(--control)",
    color: "var(--text-primary)",
    fontSize: 14,
    boxSizing: "border-box",
  },
  toggleBtn: {
    position: "absolute",
    right: 6,
    top: "50%",
    transform: "translateY(-50%)",
    padding: "4px 8px",
    fontSize: 11,
    borderRadius: 6,
    border: "1px solid var(--stroke)",
    background: "var(--surface-2)",
    cursor: "pointer",
  },
};
