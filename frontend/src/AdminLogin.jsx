import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./AdminLogin.css";
import { isExtensionError } from "./utils/extensionErrorHandler";

function AdminLogin() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState({
    reviews: { total: 0, rating: 0, stars: "☆☆☆☆☆" },
    dailyUsers: 0
  });
  const [contactInfo, setContactInfo] = useState({
    phone: "07xxxxxxxxxx",
    whatsapp: "07xxxxxxxxxx",
    email: "ronaldmutyaba256@gmail.com"
  });

  // Build a WhatsApp deeplink using international format
  const buildWhatsAppLink = (rawNumber) => {
    if (!rawNumber) return "#";
    const defaultCountry = (import.meta?.env?.VITE_DEFAULT_COUNTRY_CODE || "256").replace(/\D/g, "");
    let digits = String(rawNumber).replace(/\D/g, "");
    if (digits.startsWith("0")) {
      digits = `${defaultCountry}${digits.slice(1)}`;
    }
    // Prefilled message
    const message = encodeURIComponent("Hello, I need help with my Wifi owner account.");
    return `https://wa.me/${digits}?text=${message}`;
  };

  // Fetch statistics and contact information on component mount
  useEffect(() => {
    let isMounted = true;
    
    const fetchData = async () => {
      try {
        console.log("Fetching data from API...");
        const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000';
        const [reviewsRes, usersRes, contactRes] = await Promise.all([
          fetch(`${apiBase}/api/statistics/reviews`, {
            headers: {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            }
          }),
          fetch(`${apiBase}/api/statistics/daily-users`, {
            headers: {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            }
          }),
          fetch(`${apiBase}/api/super/contact-info`, {
            headers: {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            }
          })
        ]);
        
        if (!isMounted) return;
        
        if (reviewsRes.ok) {
          const reviewsData = await reviewsRes.json();
          console.log("Reviews data received:", reviewsData);
          if (isMounted) {
            setStats(prev => ({ ...prev, reviews: reviewsData }));
          }
        }
        
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          console.log("Daily users data received:", usersData);
          if (usersData && typeof usersData.dailyUsers === 'number' && isMounted) {
            setStats(prev => ({ ...prev, dailyUsers: usersData.dailyUsers }));
          } else {
            console.log("Invalid daily users data structure:", usersData);
          }
        }

        if (contactRes.ok) {
          const contactData = await contactRes.json();
          console.log("Contact info received:", contactData);
          if (isMounted) {
            setContactInfo(contactData);
          }
        }
      } catch (err) {
        // Filter out browser extension errors that don't affect our app
        if (isExtensionError(err)) {
          console.warn("Browser extension communication error (ignored):", err.message);
          return; // Don't treat extension errors as app errors
        }
        
        console.error("Failed to fetch data:", err);
        console.log("Using default data (0 values and default contact info)");
      }
    };
    
    fetchData();
    
    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogin = async () => {
    if (!phone || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      console.log("Attempting login with phone:", phone);
      
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const res = await fetch(`${apiBase}/api/owners/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone, password }),
      });

      const data = await res.json();
      console.log("Login response:", data);
      console.log("Response status:", res.status);

      if (!res.ok) {
        setError(data.message || "Login failed.");
        return;
      }

      if (data.success) {
        console.log("Login successful, storing session data...");
        console.log("Owner ID:", data.owner.id);
        console.log("Token:", data.token);
        console.log("Owner Name:", data.owner.ownerName);
        
        // Store owner session
        localStorage.setItem("ownerId", data.owner.id);
        localStorage.setItem("ownerToken", data.token);
        localStorage.setItem("ownerName", data.owner.ownerName);
        if (data.owner.logoUrl) {
          localStorage.setItem("ownerLogoUrl", data.owner.logoUrl);
        }
        if (data.owner.ownerPhone) {
          localStorage.setItem("ownerPhone", data.owner.ownerPhone);
        }
        
        console.log("Session stored, navigating to dashboard...");
        navigate("/admindashboard");
      } else {
        setError("Invalid credentials. Please check your phone and password.");
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("Server error. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = () => {
    navigate("/register-owner");
  };

  return (
    <div style={styles.container} className="admin-login-container">
      {/* Main Login Section */}
      <div style={styles.loginContainer}>
        <div className="yaba-card" style={{ ...styles.singleCard, background: 'var(--surface-gradient)', border: '1px solid var(--stroke)', borderRadius: 20, padding: 24, color: 'var(--text-primary)' }}>
          <h1 style={styles.title}>Wifi Owner Login</h1>
          <p style={styles.subtitle}>Manage your Wifi business</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="text"
              placeholder="Email, phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="yaba-input"
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

            <div style={styles.forgotPassword}>
              <a href="#" style={styles.forgotLink}>Forgot Password?</a>
            </div>

            <button 
              onClick={handleLogin} 
              className="yaba-btn yaba-btn--accent"
              style={{ width: '100%' }}
              disabled={isLoading}
            >
              {isLoading ? "Logging in..." : "Login"}
            </button>

            <button onClick={handleRegister} className="yaba-btn yaba-btn--secondary" style={{ width: '100%' }}>
              New Owner? Registered Here
            </button>

            {error && <p style={styles.error}>{error}</p>}
          </div>

          <div style={{ height: 1, background: 'var(--stroke)', margin: '20px 0' }} />

          {/* Support Section inside card */}
          <div style={{ ...styles.supportSection, marginBottom: 0 }}>
            <h3 style={styles.supportTitle}>Need Help?</h3>
            <div style={styles.contactInfo}>
              <a
                href={`tel:${contactInfo.phone}`}
                style={{ ...styles.contactItem, textDecoration: 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={styles.contactLeft}>
                  <span aria-hidden style={styles.contactIcon}>📞</span>
                  <span style={styles.contactLabel}>Call</span>
                </div>
                <span style={styles.contactValue}>{contactInfo.phone}</span>
              </a>

              <a
                href={buildWhatsAppLink(contactInfo.whatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...styles.contactItem, textDecoration: 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={styles.contactLeft}>
                  <span aria-hidden style={styles.contactIcon}>💬</span>
                  <span style={styles.contactLabel}>WhatsApp</span>
                </div>
                <span style={styles.contactValue}>{contactInfo.whatsapp}</span>
              </a>

              <a
                href={`mailto:${contactInfo.email}`}
                style={{ ...styles.contactItem, textDecoration: 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={styles.contactLeft}>
                  <span aria-hidden style={styles.contactIcon}>✉️</span>
                  <span style={styles.contactLabel}>Email</span>
                </div>
                <span style={styles.contactValue}>{contactInfo.email}</span>
              </a>
            </div>
          </div>

          {/* Privacy Policy inside card */}
          <div style={{ ...styles.privacySection, marginBottom: 0, marginTop: 10 }}>
            <p style={styles.privacyText}>
              We take your privacy seriously.{" "}
              <a href="#" style={styles.privacyLink}>Privacy Policy</a>
            </p>
          </div>

          <div style={{ height: 1, background: 'var(--stroke)', margin: '16px 0' }} />
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Powered by</span>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: 6 }}>
              <img src="/YABA.svg" alt="YABA" style={{ height: 32, objectFit: 'contain' }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              © 2025 YABAnect. All rights reserved.
            </div>
          </div>
        </div>
      </div>

      
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    background: "var(--n13)",
    color: "var(--n2)",
    display: "flex",
    flexDirection: "column",
    fontFamily: "Arial, sans-serif",
    position: "relative",
  },
  header: {
    padding: "20px 40px",
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "center",
  },
  logoContainer: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  logo: {
    width: "40px",
    height: "40px",
    objectFit: "contain",
  },
  logoText: {
    fontSize: "24px",
    fontWeight: "bold",
    color: "var(--n2)",
  },
  statsContainer: {
    display: "flex",
    justifyContent: "center",
    gap: "20px",
    marginBottom: "40px",
    padding: "0 20px",
  },
  statCard: {
    background: "var(--n12)",
    padding: "20px",
    borderRadius: "8px",
    textAlign: "center",
    minWidth: "200px",
    border: "1px solid var(--n13)",
  },
  statNumber: {
    fontSize: "24px",
    fontWeight: "bold",
    marginBottom: "5px",
  },
  statLabel: {
    fontSize: "14px",
    marginBottom: "5px",
    opacity: 0.9,
  },
  statRating: { fontSize: "14px", color: "var(--accent)" },
  statSubtext: {
    fontSize: "12px",
    opacity: 0.7,
  },
  loginContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flex: 1,
    padding: "0 20px",
  },
  singleCard: {
    width: "100%",
    maxWidth: 480,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  title: {
    fontSize: "32px",
    fontWeight: "bold",
    marginBottom: "10px",
    textAlign: "center",
  },
  subtitle: {
    fontSize: "16px",
    opacity: 0.8,
    marginBottom: "40px",
    textAlign: "center",
  },
  formContainer: {
    width: "100%",
    maxWidth: "400px",
    marginBottom: "40px",
  },
  input: {
    width: "100%",
    padding: "15px",
    marginBottom: "15px",
    borderRadius: "8px",
    border: "1px solid var(--n11)",
    background: "var(--n12)",
    color: "var(--n2)",
    fontSize: "16px",
    boxSizing: "border-box",
    outline: "none",
  },
  forgotPassword: {
    textAlign: "right",
    marginBottom: "20px",
  },
  forgotLink: {
    color: "var(--accent)",
    textDecoration: "none",
    fontSize: "14px",
  },
  loginButton: {
    width: "100%",
    padding: "15px",
    background: "var(--accent)",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    fontSize: "16px",
    fontWeight: "bold",
    cursor: "pointer",
    marginBottom: "15px",
    transition: "background-color 0.3s",
  },
  registerButton: {
    width: "100%",
    padding: "15px",
    background: "#ffffff",
    color: "#000000",
    border: "none",
    borderRadius: "8px",
    fontSize: "16px",
    fontWeight: "bold",
    cursor: "pointer",
    transition: "background-color 0.3s",
  },
  error: {
    color: "#ef4444",
    textAlign: "center",
    marginTop: "15px",
    fontSize: "14px",
  },
  supportSection: {
    textAlign: "left",
    marginBottom: "30px",
  },
  supportTitle: {
    fontSize: "16px",
    marginBottom: "12px",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  contactInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  contactItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    fontSize: "14px",
    background: "var(--surface-2)",
    border: "1px solid var(--stroke)",
    borderRadius: 12,
    padding: "10px 12px",
  },
  contactLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  contactIcon: { fontSize: 16 },
  contactLabel: {
    color: "var(--text-muted)",
    fontWeight: 600,
  },
  contactValue: {
    color: "var(--text-primary)",
    textDecoration: "none",
    cursor: "pointer",
    transition: "opacity 0.2s",
  },
  emailLink: {
    color: "var(--text-primary)",
    textDecoration: "none",
  },
  privacySection: {
    textAlign: "center",
    marginBottom: "30px",
  },
  privacyText: {
    fontSize: "14px",
    opacity: 0.8,
  },
  privacyLink: {
    color: "#3b82f6",
    textDecoration: "none",
  },
  footer: {
    textAlign: "center",
    padding: "20px",
    borderTop: "1px solid rgba(255, 255, 255, 0.1)",
  },
  poweredBy: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "10px",
    marginBottom: "10px",
  },
  poweredText: {
    fontSize: "14px",
    opacity: 0.8,
  },
  footerLogoContainer: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
  },
  footerLogo: {
    width: "20px",
    height: "20px",
    objectFit: "contain",
  },
  footerLogoText: {
    fontSize: "16px",
    fontWeight: "bold",
    color: "#ef4444",
  },
  copyright: {
    fontSize: "12px",
    opacity: 0.6,
  },
};

export default AdminLogin;
