import React, { useEffect, useState } from "react";
import axios from "axios";

const ROLES = ["Owner", "Manager", "Support"];

export default function OwnerAdmins() {
  const ownerId = localStorage.getItem("ownerId");
  const [admins, setAdmins] = useState([]);
  const [form, setForm] = useState({ userId: "", role: ROLES[1] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (ownerId) fetchAdmins();
    // eslint-disable-next-line
  }, [ownerId]);

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/owner/admins/list?ownerId=${ownerId}`);
      setAdmins(res.data.admins || []);
    } catch (err) {
      setAdmins([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await axios.post("/api/owner/admins/add", { ...form, ownerId });
      setForm({ userId: "", role: ROLES[1] });
      setMessage("Admin added.");
      fetchAdmins();
    } catch (err) {
      setMessage("Failed to add admin.");
    }
  };

  const handleRemove = async (userId) => {
    if (!window.confirm("Remove this admin?")) return;
    try {
      await axios.post("/api/owner/admins/remove", { ownerId, userId });
      setMessage("Admin removed.");
      fetchAdmins();
    } catch (err) {
      setMessage("Failed to remove admin.");
    }
  };

  const handleRole = async (userId, role) => {
    try {
      await axios.post("/api/owner/admins/set-role", { ownerId, userId, role });
      setMessage("Role updated.");
      fetchAdmins();
    } catch (err) {
      setMessage("Failed to update role.");
    }
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Admin Management</h2>
      <form onSubmit={handleAdd} style={styles.form}>
        <input
          placeholder="User ID (email or phone)"
          value={form.userId}
          onChange={e => setForm({ ...form, userId: e.target.value })}
          required
          style={styles.input}
        />
        <select
          value={form.role}
          onChange={e => setForm({ ...form, role: e.target.value })}
          style={styles.input}
        >
          {ROLES.map(r => <option key={r}>{r}</option>)}
        </select>
        <button type="submit" style={styles.addBtn}>Add Admin</button>
      </form>
      {message && <p style={styles.message}>{message}</p>}
      <div style={styles.adminsList}>
        {loading ? <div>Loading...</div> : admins.length === 0 ? <div>No admins yet.</div> : (
          admins.map(a => (
            <div key={a.userId} style={styles.adminCard}>
              <div><b>{a.userId}</b> <span style={styles.role}>{a.role}</span></div>
              <div style={styles.actions}>
                <select
                  value={a.role}
                  onChange={e => handleRole(a.userId, e.target.value)}
                  style={styles.input}
                >
                  {ROLES.map(r => <option key={r}>{r}</option>)}
                </select>
                <button style={styles.removeBtn} onClick={() => handleRemove(a.userId)}>Remove</button>
              </div>
            </div>
          ))
        )}
      </div>
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
    gap: 10,
    marginBottom: 18,
  },
  input: {
    padding: 8,
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    fontSize: 15,
  },
  addBtn: {
    background: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 15,
    padding: "8px 18px",
    cursor: "pointer",
  },
  message: {
    color: "#2563eb",
    fontWeight: 500,
    marginBottom: 12,
    textAlign: "center",
  },
  adminsList: {
    marginTop: 18,
  },
  adminCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    background: "#f9fafb",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  role: {
    background: "#f1f5f9",
    borderRadius: 4,
    padding: "2px 8px",
    marginLeft: 8,
    fontSize: 13,
    color: "#2563eb",
  },
  actions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  removeBtn: {
    background: "#dc2626",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "6px 14px",
    cursor: "pointer",
  },
};
