import React, { useState } from "react";
import axios from "axios";

export default function CiscoOnboardForm({ locations = [], onSuccess }) {
  const [ip, setIp] = useState("");
  const [sshPort, setSshPort] = useState(22);
  const [connectionType, setConnectionType] = useState("local"); // local | public | ngrok | vpn
  const [ngrokUrl, setNgrokUrl] = useState("");
  const [showHowToIp, setShowHowToIp] = useState(false);
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
    setShowHowToIp(false);

    const ownerId = localStorage.getItem("ownerId");
    if (!ownerId) {
      setError("Owner not authenticated. Please log in as admin.");
      setLoading(false);
      return;
    }

    try {
      const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";
      let submitIp = ip;
      let submitPort = Number(sshPort) || 22;

      if (connectionType === "ngrok") {
        const raw = String(ngrokUrl || "").trim();
        const cleaned = raw
          .replace(/^tcp:\/\//i, "")
          .replace(/^https?:\/\//i, "");
        const [host, portStr] = cleaned.split(":");
        const port = Number(portStr);
        if (!host || !portStr || Number.isNaN(port)) {
          throw new Error(
            "Please enter a valid Ngrok URL like host:port (e.g. 0.tcp.ngrok.io:15673).",
          );
        }
        submitIp = host.trim();
        submitPort = port;
      }

      const res = await axios.post(`${apiBase}/api/devices/cisco/onboard`, {
        ip: submitIp,
        sshPort: submitPort,
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
          Connection Type
          <select
            value={connectionType}
            onChange={(e) => {
              const next = e.target.value;
              setConnectionType(next);
              setShowHowToIp(false);
              if (next !== "ngrok" && (sshPort === "" || sshPort == null))
                setSshPort(22);
            }}
            style={styles.input}
          >
            <option value="local">Local Network</option>
            <option value="public">Public IP / Port Forwarding</option>
            <option value="ngrok">Ngrok Tunnel</option>
            <option value="vpn">VPN / Static IP</option>
          </select>
        </label>

        {connectionType !== "ngrok" ? (
          <label style={styles.label}>
            {connectionType === "public"
              ? "Public IP Address *"
              : connectionType === "vpn"
                ? "VPN / Static IP Address *"
                : "Router IP Address *"}
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              required
              style={styles.input}
              placeholder={
                connectionType === "public"
                  ? "e.g. 41.210.xx.xx"
                  : connectionType === "vpn"
                    ? "e.g. 10.8.0.x or static public IP"
                    : "192.168.1.1"
              }
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => setShowHowToIp((v) => !v)}
                style={styles.linkBtn}
              >
                How to find my router IP
              </button>
              {connectionType === "local" && (
                <span style={styles.warnText}>
                  This only works if your server is running locally on the same
                  network as your router. Not recommended for cloud hosted
                  software.
                </span>
              )}
            </div>

            {connectionType === "public" && (
              <div style={styles.helperText}>
                This is your public internet IP address, not your router&apos;s
                local IP. Find it by visiting whatismyip.com from the
                router&apos;s network location.
              </div>
            )}
            {connectionType === "vpn" && (
              <div style={styles.helperText}>
                Enter the IP address your router is reachable on through your
                VPN or dedicated static IP connection.
              </div>
            )}

            {showHowToIp && (
              <div style={styles.howtoPopup}>
                {connectionType === "local" && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      Local Network
                    </div>
                    <div>
                      Check your router admin page (often printed on the router
                      label or your ISP docs). Common gateways are 192.168.1.1
                      or 192.168.0.1.
                    </div>
                  </div>
                )}
                {connectionType === "public" && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      Public IP / Port Forwarding
                    </div>
                    <div>
                      Visit whatismyip.com from the router&apos;s network
                      location, then use that public IP here.
                    </div>
                  </div>
                )}
                {connectionType === "vpn" && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      VPN / Static IP
                    </div>
                    <div>
                      Check your VPN dashboard / VPN server configuration for
                      the router&apos;s reachable IP (or use the dedicated
                      static IP provided by your ISP).
                    </div>
                  </div>
                )}
              </div>
            )}
          </label>
        ) : (
          <label style={styles.label}>
            Ngrok URL *
            <input
              type="text"
              value={ngrokUrl}
              onChange={(e) => setNgrokUrl(e.target.value)}
              required
              style={styles.input}
              placeholder="0.tcp.ngrok.io:15673"
            />
            <div style={styles.helperText}>
              Run this command on a laptop connected to the same network as your
              router:
              <br />
              <code style={styles.inlineCode}>ngrok tcp 22</code>
              <br />
              Then paste the URL it gives you here.
            </div>
          </label>
        )}

        {connectionType !== "ngrok" && (
          <label style={styles.label}>
            SSH Port
            <input
              type="number"
              value={sshPort}
              onChange={(e) => setSshPort(e.target.value)}
              style={styles.input}
              min={1}
              max={65535}
              placeholder={connectionType === "public" ? "22" : undefined}
            />
          </label>
        )}

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
  helperText: {
    marginTop: 6,
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.35,
  },
  warnText: {
    marginTop: 6,
    fontSize: 12,
    color: "#b91c1c",
    lineHeight: 1.35,
  },
  linkBtn: {
    marginTop: 6,
    padding: 0,
    border: "none",
    background: "transparent",
    color: "var(--accent)",
    cursor: "pointer",
    fontSize: 12,
    textDecoration: "underline",
    textUnderlineOffset: 3,
  },
  howtoPopup: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    border: "1px solid var(--stroke)",
    background: "var(--surface)",
    color: "var(--text-primary)",
    fontSize: 12,
    lineHeight: 1.35,
    boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
  },
  inlineCode: {
    padding: "2px 6px",
    borderRadius: 6,
    background: "var(--surface-2)",
    border: "1px solid var(--stroke)",
    fontSize: 12,
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
