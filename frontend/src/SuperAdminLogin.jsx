import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

function SuperAdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("superToken");
    if (token) navigate("/superdashboard");
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Email and password required");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || data.role !== "superadmin") {
        setError(data.message || "Login failed");
        return;
      }
      localStorage.setItem("superToken", data.token);
      localStorage.setItem("adminEmail", data.email);
      navigate("/superdashboard");
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <form onSubmit={handleLogin} className="yaba-card" style={{ ...styles.form, background: 'var(--surface-gradient)', border: '1px solid var(--stroke)', borderRadius: 20, padding: 24, color: 'var(--text-primary)', maxWidth: 480, width: '100%' }}>
        <h2 style={{ ...styles.title, color: 'var(--text-primary)' }}>Super Admin Login</h2>
        <p style={{ ...styles.subtitle, color: 'var(--text-muted)' }}>App Owner access only</p>
        {error && <div style={styles.error}>{error}</div>}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="yaba-input"
          autoComplete="username"
        />
        <div style={{ position: 'relative', width: '100%', minWidth: 0, display: 'block', margin: 0, padding: 0 }}>
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="yaba-input"
            style={{ paddingRight: 64, width: '100%', boxSizing: 'border-box', margin: 0 }}
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword(p => !p)}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--stroke)', background: 'var(--surface-2)', cursor: 'pointer' }}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <button type="submit" className="yaba-btn yaba-btn--accent" style={{ width: '100%' }} disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <div style={{ ...styles.hint, color: 'var(--text-muted)' }}>Protected area. Unauthorized access is prohibited.</div>

        <div style={{ height: 1, background: 'var(--stroke)', margin: '16px 0' }} />
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Powered by</span>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: 6 }}>
            <img src="/YABA.svg" alt="YABA" style={{ height: 32, objectFit: 'contain' }} />
          </div>
        </div>
      </form>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0b1220",
    padding: 16,
  },
  form: {
    width: "100%",
    maxWidth: 420,
    background: "#fff",
    padding: 24,
    borderRadius: 12,
    boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  title: { margin: 0 },
  subtitle: { margin: 0, color: "#6b7280", marginBottom: 8 },
  error: { color: "#991b1b", background: "#fee2e2", border: "1px solid #fecaca", padding: 10, borderRadius: 8 },
  input: { padding: 12, borderRadius: 8, border: "1px solid #e5e7eb" },
  button: { padding: 12, borderRadius: 8, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer" },
  hint: { color: "#6b7280", fontSize: 12, marginTop: 8, textAlign: "center" },
};

export default SuperAdminLogin;


