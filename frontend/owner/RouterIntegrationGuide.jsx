import React, { useState } from "react";

const INSTRUCTIONS = {
  MikroTik: [
    {
      title: "Set API IP",
      content: "Login to your MikroTik router, go to IP > Services, and enable the API service. Set the allowed IP to the platform's server IP.",
    },
    {
      title: "Enable Hotspot",
      content: "Go to IP > Hotspot, run the Hotspot Setup Wizard, and configure your SSID and address pool.",
    },
    {
      title: "Configure RADIUS",
      content: "Go to RADIUS, add a new server. Set Service to 'hotspot', enter the RADIUS server address and shared secret provided by the platform.",
    },
    {
      title: "Set IP Binding",
      content: "Go to IP > Hotspot > IP Bindings. Add the platform's server IP as 'bypassed' to ensure API access.",
    },
  ],
  RADIUS: [
    {
      title: "Add RADIUS Server",
      content: "In your router's RADIUS settings, add the platform's RADIUS server IP and the shared secret provided.",
    },
    {
      title: "Configure Authentication",
      content: "Set authentication type to PAP or CHAP as required. Save and apply settings.",
    },
  ],
  Generic: [
    {
      title: "Set Captive Portal URL",
      content: "Configure your router's captive portal/redirect URL to: https://yourplatform.com/captive-portal",
    },
    {
      title: "Login Credentials",
      content: "Use the admin credentials provided in your owner dashboard to log in and manage sessions.",
    },
  ],
};

export default function RouterIntegrationGuide({ routerType = "MikroTik" }) {
  const [open, setOpen] = useState([]);
  const steps = INSTRUCTIONS[routerType] || [];

  const toggle = (idx) => {
    setOpen((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Router Integration Guide ({routerType})</h2>
      {steps.map((step, idx) => (
        <div key={idx} style={styles.panel}>
          <div style={styles.panelHeader} onClick={() => toggle(idx)}>
            <span>{step.title}</span>
            <span>{open.includes(idx) ? "▲" : "▼"}</span>
          </div>
          {open.includes(idx) && (
            <div style={styles.panelContent}>{step.content}</div>
          )}
        </div>
      ))}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: 500,
    margin: "40px auto",
    padding: 24,
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 24,
    textAlign: "center",
  },
  panel: {
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    marginBottom: 12,
    overflow: "hidden",
  },
  panelHeader: {
    padding: 14,
    background: "#f1f5f9",
    cursor: "pointer",
    fontWeight: 500,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 16,
  },
  panelContent: {
    padding: 14,
    background: "#fff",
    fontSize: 15,
    color: "#374151",
  },
};
