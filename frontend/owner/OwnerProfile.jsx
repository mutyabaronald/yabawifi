import React, { useEffect, useState } from "react";
import axios from "axios";

export default function OwnerProfile() {
  const ownerId = localStorage.getItem("ownerId");
  const [form, setForm] = useState({ ownerPhone: "", ownerWhatsapp: "", tagline: "" });
  const [payout, setPayout] = useState({ accountType: "Mobile Money", provider: "MTN" });
  const [reviewsEnabled, setReviewsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (ownerId) fetchProfile();
    // eslint-disable-next-line
  }, [ownerId]);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/owners/${ownerId}`);
      setForm({
        ownerPhone: res.data.owner?.ownerPhone || "",
        ownerWhatsapp: res.data.owner?.ownerWhatsapp || "",
        tagline: res.data.owner?.tagline || res.data.owner?.motto || res.data.owner?.slogan || "",
      });
      // load payout account
      const payoutRes = await axios.get(`/api/owners/${ownerId}/payout-account`);
      if (payoutRes.data?.account) setPayout({
        accountType: payoutRes.data.account.accountType || "Mobile Money",
        provider: payoutRes.data.account.provider || "MTN",
      });
      
      // load reviews setting
      setReviewsEnabled(res.data.owner?.reviewsEnabled || false);
    } catch (err) {
      setMessage("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await axios.put(`/api/owners/${ownerId}`, { ...form, reviewsEnabled });
      await axios.post(`/api/owners/${ownerId}/payout-account`, payout);
      setMessage("Profile updated successfully.");
    } catch (err) {
      setMessage("Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={styles.loading}>Loading profile...</div>;

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Owner Profile & Support Info</h2>
      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          Phone Number
          <input
            name="ownerPhone"
            value={form.ownerPhone}
            onChange={handleChange}
            style={styles.input}
            placeholder="e.g. +256700000000"
            required
          />
        </label>
        <label style={styles.label}>
          Tagline
          <input
            name="tagline"
            value={form.tagline}
            onChange={handleChange}
            style={styles.input}
            placeholder="e.g. Any where Every where"
          />
        </label>
        <label style={styles.label}>
          WhatsApp Number
          <input
            name="ownerWhatsapp"
            value={form.ownerWhatsapp}
            onChange={handleChange}
            style={styles.input}
            placeholder="e.g. 256700000000"
            required
          />
        </label>
        
        {/* Reviews Toggle */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={reviewsEnabled}
              onChange={(e) => setReviewsEnabled(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <span style={{ fontSize: 14, fontWeight: 500 }}>
              Enable customer reviews for referral users
            </span>
          </label>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0 26px' }}>
            When enabled, new users coming through referral links will see moving review messages on the login page.
          </p>
        </div>
        
        <div style={{height: 1, background: '#e5e7eb'}} />
        <h3 style={{ margin: 0 }}>Payout Account</h3>
        <label style={styles.label}>
          Account Type
          <select value={payout.accountType} onChange={(e) => setPayout({ ...payout, accountType: e.target.value })} style={styles.input}>
            <option>Mobile Money</option>
          </select>
        </label>
        <label style={styles.label}>
          Network
          <select value={payout.provider} onChange={(e) => setPayout({ ...payout, provider: e.target.value })} style={styles.input}>
            <option>MTN</option>
          </select>
        </label>
        {/* Payout info: add Account Name */}
        <label style={styles.label}>
          Account Name
          <input value={payout.accountName || ''} onChange={(e) => setPayout({ ...payout, accountName: e.target.value })} style={styles.input} />
        </label>
        <button type="submit" style={styles.button} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </form>
      {message && <p style={styles.message}>{message}</p>}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: 400,
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
  message: {
    marginTop: 16,
    color: "#2563eb",
    fontWeight: 500,
    textAlign: "center",
  },
  loading: {
    textAlign: "center",
    padding: 60,
    fontSize: 18,
  },
};
