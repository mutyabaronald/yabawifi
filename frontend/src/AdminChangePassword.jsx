import { useState } from "react";
import axios from "axios";

function AdminChangePassword() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    if (!newPassword || newPassword.length < 8) {
      return "New password must be at least 8 characters.";
    }
    if (!/[0-9\W]/.test(newPassword)) {
      return "New password must include a number or symbol.";
    }
    if (newPassword !== confirmPassword) {
      return "Confirm password does not match.";
    }
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    try {
      const ownerToken = localStorage.getItem('ownerToken');
      const res = await axios.post("/api/owners/change-password", {
        currentPassword,
          newPassword,
      }, { headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken || ''}` } });
      if (!res.data?.success) {
        throw new Error(res.data?.message || "Password change failed");
      }
      setSuccess("Password changed successfully. You will be logged out.");
      setTimeout(() => {
        localStorage.clear();
        window.location.href = "/adminlogin";
      }, 1200);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={{ marginTop: 0 }}>Change Password</h2>
        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={styles.success}>{success}</div>}
        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Current Password
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={styles.input} required />
          </label>
          <label style={styles.label}>New Password
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={styles.input} required />
          </label>
          <label style={styles.label}>Confirm New Password
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={styles.input} required />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" style={styles.btn} onClick={() => window.history.back()}>Cancel</button>
            <button type="submit" style={{ ...styles.btn, background: '#2563eb', color: '#fff' }} disabled={submitting}>{submitting ? 'Saving…' : 'Save Changes'}</button>
          </div>
      </form>
      </div>
    </div>
  );
}

const styles = {
  container: { padding: 24 },
  card: { maxWidth: 520, background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.08)', padding: 20 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 },
  input: { padding: 10, border: '1px solid #e5e7eb', borderRadius: 8 },
  btn: { padding: '10px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' },
  error: { color: '#991b1b', background: '#fee2e2', border: '1px solid #fecaca', padding: 10, borderRadius: 8, marginBottom: 10 },
  success: { color: '#065f46', background: '#d1fae5', border: '1px solid #a7f3d0', padding: 10, borderRadius: 8, marginBottom: 10 },
};

export default AdminChangePassword;
