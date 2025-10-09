import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

const ROUTER_TYPES = ["MikroTik", "RADIUS", "Generic"];
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

export default function HotspotSetup() {
  const [form, setForm] = useState({
    hotspotName: "",
    address: "",
    routerType: ROUTER_TYPES[0],
  });
  const [coords, setCoords] = useState({ latitude: null, longitude: null });
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [portalUrl, setPortalUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const el = document.getElementById("owner-map");
    if (!el || mapRef.current) return; // already initialized
    const map = L.map("owner-map").setView([0.3476, 32.5825], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    mapRef.current = map;

    const setMarker = (lat, lng) => {
      setCoords({ latitude: lat, longitude: lng });
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(mapRef.current);
        markerRef.current.on('dragend', () => {
          const p = markerRef.current.getLatLng();
          setCoords({ latitude: p.lat, longitude: p.lng });
        });
      }
      mapRef.current.setView([lat, lng], 15);
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        setMarker(latitude, longitude);
      }, () => setMarker(0.3476, 32.5825));
    } else {
      setMarker(0.3476, 32.5825);
    }

    mapRef.current.on('click', (e) => setMarker(e.latlng.lat, e.latlng.lng));

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setSuccess("");
    setPortalUrl(""); // Clear previous portal URL
    setError("");
    const ownerId = localStorage.getItem("ownerId");
    if (!ownerId) {
      setError("Owner not authenticated. Please log in as admin.");
      setLoading(false);
      return;
    }
    try {
      const res = await axios.post("/api/hotspots/create", {
        ...form,
        ownerId,
        latitude: typeof coords.latitude === 'number' ? coords.latitude : null,
        longitude: typeof coords.longitude === 'number' ? coords.longitude : null,
      });
      setSuccess("Hotspot registered successfully.");
      setPortalUrl(res.data?.captivePortalUrl || "");
      setForm({ hotspotName: "", address: "", routerType: ROUTER_TYPES[0] });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to register hotspot.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Register a New Hotspot</h2>
      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          Hotspot name/SSID*
          <input
            type="text"
            name="hotspotName"
            value={form.hotspotName}
            onChange={handleChange}
            required
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Physical Address*
          <input
            type="text"
            name="address"
            value={form.address}
            onChange={handleChange}
            required
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Router Type*
          <select
            name="routerType"
            value={form.routerType}
            onChange={handleChange}
            style={styles.input}
            required
          >
            {ROUTER_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <div>
          <p style={{ margin: 0, fontWeight: 500 }}>Set Hotspot Location</p>
          <small>Click on the map or drag the marker to adjust. Defaults to your current location.</small>
          <div id="owner-map" style={{ height: 240, borderRadius: 8, marginTop: 8 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input readOnly value={coords.latitude ?? ''} placeholder="Latitude" style={styles.input} />
            <input readOnly value={coords.longitude ?? ''} placeholder="Longitude" style={styles.input} />
          </div>
        </div>
        <button type="submit" style={styles.button} disabled={loading}>
          {loading ? "Registering..." : "Register Hotspot"}
        </button>
      </form>
      {success && <p style={styles.success}>{success}</p>}
      {portalUrl && (
        <div style={{ marginTop: 12 }}>
          <div><b>Captive Portal Link:</b></div>
          <input readOnly value={portalUrl} style={styles.input} />
          <button onClick={() => navigator.clipboard.writeText(portalUrl)} style={styles.button}>Copy Link</button>
        </div>
      )}
      {error && <p style={styles.error}>{error}</p>}
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
    fontSize: 22,
    fontWeight: 600,
    marginBottom: 24,
    textAlign: "center",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  label: {
    fontWeight: 500,
    marginBottom: 6,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  input: {
    padding: 10,
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    fontSize: 15,
    marginTop: 4,
  },
  button: {
    marginTop: 18,
    padding: "12px 0",
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 16,
    cursor: "pointer",
  },
  success: {
    marginTop: 16,
    color: "#16a34a",
    fontWeight: 500,
    textAlign: "center",
  },
  error: {
    marginTop: 16,
    color: "#dc2626",
    fontWeight: 500,
    textAlign: "center",
  },
};
