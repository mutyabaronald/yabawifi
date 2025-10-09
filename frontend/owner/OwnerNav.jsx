import React from "react";
import { Link, useLocation } from "react-router-dom";
import { FaHome, FaWifi, FaBox, FaUser, FaCog, FaBell, FaShareAlt } from "react-icons/fa";

export default function OwnerNav() {
  const location = useLocation();
  
  const navItems = [
    { path: "/owner/dashboard", label: "Dashboard", icon: <FaHome /> },
    { path: "/owner/devices", label: "Devices", icon: <FaWifi /> },
    { path: "/owner/packages", label: "Packages", icon: <FaBox /> },
    { path: "/owner/referrals", label: "Referrals", icon: <FaShareAlt /> },
    { path: "/owner/profile", label: "Profile", icon: <FaUser /> },
    { path: "/owner/notifications", label: "Notifications", icon: <FaBell /> },
    { path: "/owner/admins", label: "Admins", icon: <FaCog /> },
  ];

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <nav style={styles.nav}>
      <div style={styles.navContainer}>
        <div style={styles.logo}>
          <FaWifi style={styles.logoIcon} />
          <span style={styles.logoText}>YABA WiFi</span>
        </div>
        
        <ul style={styles.navList}>
          {navItems.map((item) => (
            <li key={item.path} style={styles.navItem}>
              <Link
                to={item.path}
                style={{
                  ...styles.navLink,
                  ...(isActive(item.path) ? styles.navLinkActive : {})
                }}
              >
                <span style={styles.navIcon}>{item.icon}</span>
                <span style={styles.navLabel}>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div style={styles.navFooter}>
          <button
            onClick={() => {
              localStorage.clear();
              window.location.href = "/";
            }}
            style={styles.logoutButton}
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}

const styles = {
  nav: {
    backgroundColor: "#1e293b",
    color: "white",
    width: "250px",
    height: "100vh",
    position: "fixed",
    left: 0,
    top: 0,
    overflowY: "auto",
  },
  navContainer: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    padding: "20px 0",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "0 20px 20px 20px",
    borderBottom: "1px solid #334155",
  },
  logoIcon: {
    fontSize: "24px",
    color: "#3b82f6",
  },
  logoText: {
    fontSize: "20px",
    fontWeight: "600",
    color: "white",
  },
  navList: {
    listStyle: "none",
    padding: 0,
    margin: "20px 0",
    flex: 1,
  },
  navItem: {
    margin: "4px 0",
  },
  navLink: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 20px",
    color: "#cbd5e1",
    textDecoration: "none",
    transition: "all 0.2s",
    borderRadius: "0 8px 8px 0",
  },
  navLinkActive: {
    backgroundColor: "#3b82f6",
    color: "white",
  },
  navIcon: {
    fontSize: "16px",
    width: "20px",
    textAlign: "center",
  },
  navLabel: {
    fontSize: "14px",
    fontWeight: "500",
  },
  navFooter: {
    padding: "20px",
    borderTop: "1px solid #334155",
  },
  logoutButton: {
    width: "100%",
    padding: "10px",
    backgroundColor: "#ef4444",
    color: "white",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "500",
    transition: "background-color 0.2s",
  },
};
