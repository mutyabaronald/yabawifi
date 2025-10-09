import React, { useEffect, useState } from "react";
import axios from "axios";

export default function OwnerNotifications() {
  const ownerId = localStorage.getItem("ownerId");
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (ownerId) fetchNotifications();
    // eslint-disable-next-line
  }, [ownerId]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/owner/notifications?ownerId=${ownerId}`);
      setNotifications(res.data.notifications || []);
    } catch (err) {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div style={styles.wrapper}>
      <button style={styles.bell} onClick={() => setOpen(o => !o)}>
        <span role="img" aria-label="bell">🔔</span>
        {unreadCount > 0 && <span style={styles.badge}>{unreadCount}</span>}
      </button>
      {open && (
        <div style={styles.dropdown}>
          <h4 style={styles.dropdownTitle}>Notifications</h4>
          {loading ? (
            <div style={styles.loading}>Loading...</div>
          ) : notifications.length === 0 ? (
            <div style={styles.empty}>No notifications</div>
          ) : (
            notifications.map((n, i) => (
              <div key={i} style={styles.notification}>
                <div style={styles.type}>{n.type === "low_balance" ? "⚠️" : "⏰"}</div>
                <div>
                  <div style={styles.message}>{n.message}</div>
                  <div style={styles.date}>{n.date.slice(0, 10)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  wrapper: {
    position: "relative",
    display: "inline-block",
    marginLeft: 16,
  },
  bell: {
    background: "none",
    border: "none",
    fontSize: 28,
    cursor: "pointer",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    background: "#dc2626",
    color: "#fff",
    borderRadius: "50%",
    fontSize: 12,
    padding: "2px 6px",
    fontWeight: 700,
  },
  dropdown: {
    position: "absolute",
    right: 0,
    top: 36,
    minWidth: 260,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
    zIndex: 100,
    padding: 12,
  },
  dropdownTitle: {
    fontWeight: 600,
    fontSize: 16,
    marginBottom: 10,
    textAlign: "center",
  },
  loading: {
    textAlign: "center",
    padding: 10,
  },
  empty: {
    textAlign: "center",
    color: "#64748b",
    padding: 10,
  },
  notification: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "8px 0",
    borderBottom: "1px solid #f1f5f9",
  },
  type: {
    fontSize: 18,
    marginTop: 2,
  },
  message: {
    fontSize: 15,
    fontWeight: 500,
  },
  date: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },
};
