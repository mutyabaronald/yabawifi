import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import MovingReviews from "./components/MovingReviews";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFirstTimeSetup, setIsFirstTimeSetup] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotPhone, setForgotPhone] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");

  // 🔥 NEW: logo state
  const [logoUrl, setLogoUrl] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerWhatsapp, setOwnerWhatsapp] = useState("");

  // 🔥 NEW: voucher state
  const [voucherCode, setVoucherCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [activeTab, setActiveTab] = useState("voucher"); // 'voucher' | 'user'

  // 🔥 NEW: referral state
  const [referralCode, setReferralCode] = useState("");
  const [isReferralUser, setIsReferralUser] = useState(false);
  const [hotspotId, setHotspotId] = useState("");
  const [userLocation, setUserLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("checking"); // 'checking', 'in-range', 'out-of-range'
  const [canLogin, setCanLogin] = useState(false);
  const [checkingHotspot, setCheckingHotspot] = useState(true);
  const [hotspotMessage, setHotspotMessage] = useState(
    "Checking hotspot connection…",
  );

  const fetchWithTimeout = async (url, options = {}, timeoutMs = 8000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  };

  // 🔥 Fetch logo on load from URL context (routerId/ownerId). Fallback: look up by phone as user types.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const routerId = params.get("routerId");
    const ownerId = params.get("ownerId");
    const ref = params.get("ref"); // Check for referral code

    const fetchByContext = async () => {
      try {
        if (routerId) {
          const res = await fetch(
            `/api/routers/${encodeURIComponent(routerId)}/portal-branding`,
          );
          if (res.ok) {
            const json = await res.json();
            setLogoUrl(json.logoUrl || "");
            setOwnerName(json.ownerName || "");
            setOwnerPhone(json.ownerPhone || "");
            setOwnerWhatsapp(json.ownerWhatsapp || "");
            return;
          }
        }
        if (ownerId) {
          const res = await fetch(
            `/api/owners/logo/${encodeURIComponent(ownerId)}`,
          );
          if (res.ok) {
            const json = await res.json();
            setLogoUrl(json.logoUrl || "");
            setOwnerName(json.ownerName || "");
            setOwnerPhone(json.ownerPhone || "");
            setOwnerWhatsapp(json.ownerWhatsapp || "");
            return;
          }
        }
      } catch (e) {
        // ignore and fallback to phone lookup
      }
    };

    fetchByContext();

    // Handle referral code
    if (ref) {
      setReferralCode(ref);
      setIsReferralUser(true);
      setActiveTab("user"); // Switch to user login tab
    }
  }, [location.search]);

  useEffect(() => {
    const checkHotspotConnection = async () => {
      setCheckingHotspot(true);
      setCanLogin(false);
      setHotspotMessage("Checking hotspot connection…");
      const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";
      const customProbe = import.meta.env.VITE_HOTSPOT_PING_URL;
      const probes = [
        customProbe,
        "http://192.168.4.1/ping",
        "http://10.0.0.1/ping",
        `${apiBase}/api/ping`,
      ].filter(Boolean);

      for (const probe of probes) {
        try {
          const res = await fetchWithTimeout(
            probe,
            {
              method: "GET",
              mode:
                probe.startsWith("http://192.168.") ||
                probe.startsWith("http://10.")
                  ? "no-cors"
                  : "cors",
            },
            2000,
          );
          if (res || res === undefined) {
            setCanLogin(true);
            setHotspotMessage("");
            setCheckingHotspot(false);
            return;
          }
        } catch {
          // try next probe
        }
      }

      setHotspotMessage(
        "Please connect to the hotspot Wi-Fi before logging in.",
      );
      setCanLogin(false);
      setCheckingHotspot(false);
    };

    checkHotspotConnection();
  }, []);

  // Check user location and proximity to hotspot
  const checkUserLocation = async (hotspotId) => {
    try {
      if (!navigator.geolocation) {
        setLocationStatus("out-of-range");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const userLat = position.coords.latitude;
          const userLng = position.coords.longitude;
          setUserLocation({ lat: userLat, lng: userLng });

          // Get hotspot location
          const hotspotResponse = await fetch(`/api/hotspots/${hotspotId}`);
          const hotspotData = await hotspotResponse.json();

          if (hotspotData.hotspot && hotspotData.hotspot.location) {
            const distance = calculateDistance(
              userLat,
              userLng,
              hotspotData.hotspot.latitude,
              hotspotData.hotspot.longitude,
            );

            // Consider within range if within 100 meters
            setLocationStatus(distance <= 100 ? "in-range" : "out-of-range");
          } else {
            setLocationStatus("out-of-range");
          }
        },
        (error) => {
          console.error("Error getting location:", error);
          setLocationStatus("out-of-range");
        },
        { timeout: 10000, enableHighAccuracy: true },
      );
    } catch (error) {
      console.error("Error checking location:", error);
      setLocationStatus("out-of-range");
    }
  };

  // Calculate distance between two coordinates (in meters)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  };

  // Debounced phone lookup to avoid excessive API calls
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      if (!phone || phone.length < 4) return;
      try {
        // Use backend API instead of direct Firebase for better performance
        const response = await fetch(
          `${
            import.meta.env.VITE_API_URL || "http://localhost:5000"
          }/api/owners/by-phone/${encodeURIComponent(phone)}`,
        );
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setLogoUrl(data.owner.logoUrl || "");
            setOwnerName(data.owner.ownerName || "");
            setOwnerPhone(data.owner.ownerPhone || "");
            setOwnerWhatsapp(data.owner.ownerWhatsapp || "");
          }
        }
      } catch {}
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [phone]);

  const handleLogin = async () => {
    if (!phone || !password) {
      setError("Please enter phone number and password.");
      return;
    }

    if (!canLogin) {
      setError("Connect to the hotspot Wi-Fi to log in.");
      return;
    }

    try {
      setIsLoading(true);

      // Use backend API instead of direct Firebase access
      const response = await fetchWithTimeout(
        `${
          import.meta.env.VITE_API_URL || "http://localhost:5000"
        }/api/users/auth`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ phone, password }),
        },
        8000,
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Login failed. Please try again.");
        return;
      }

      if (data.success) {
        // Set first-time setup flag if this is a new user
        if (data.isNewUser) {
          setIsFirstTimeSetup(true);
        }

        // Persist phone and navigate to user dashboard
        localStorage.setItem("phone", phone);

        // Clear first-time setup flag after a delay
        if (data.isNewUser) {
          setTimeout(() => setIsFirstTimeSetup(false), 3000);
        }

        // If not a referral user, set Buy Packages as default tab
        if (!isReferralUser) {
          localStorage.setItem("activeTab", "packages");
        }

        navigate("/dashboard");
      } else {
        setError(data.error || "Login failed. Please try again.");
      }
    } catch (err) {
      console.error("Login error:", err);
      const timedOut = err?.name === "AbortError";
      setError(
        timedOut
          ? "Connection timed out. Connect to the hotspot Wi-Fi and try again."
          : "Network error. Please check your connection and try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRedeemVoucher = async () => {
    if (!voucherCode) {
      setError("Please enter a voucher code.");
      return;
    }

    try {
      setRedeeming(true);
      // In a real app, you'd send this voucherCode to your backend
      // to verify and potentially redeem it.
      // For now, we'll just simulate a successful connection.
      console.log(`Attempting to redeem voucher: ${voucherCode}`);
      // Simulate a successful connection
      localStorage.setItem("phone", "voucher_user"); // Example phone for voucher user
      navigate("/dashboard");
    } catch (err) {
      console.error("Voucher redemption error:", err);
      setError("Failed to redeem voucher. Invalid code or server error.");
    } finally {
      setRedeeming(false);
    }
  };

  const handleForgotPassword = () => {
    navigate("/forgot-password");
  };

  const submitForgotPassword = async () => {
    if (!forgotPhone) {
      setForgotMessage("Please enter your phone number.");
      return;
    }
    try {
      setForgotLoading(true);
      setForgotMessage("");
      const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";
      const res = await fetch(`${apiBase}/api/users/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: forgotPhone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setForgotMessage(data.error || "Failed to send reset code.");
        return;
      }
      setForgotMessage(
        data.message || "✅ Reset code sent. Check your phone/SMS.",
      );
    } catch (e) {
      setForgotMessage("Network error. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Remove all branding from above. Branding is now inside the login card. */}

      <div
        className="yaba-card"
        style={{
          ...styles.card,
          background: "var(--surface-gradient)",
          border: "1px solid var(--stroke)",
          borderRadius: 20,
          padding: 24,
          color: "var(--text-primary)",
        }}
      >
        {/* CARD HEADER: YABA fallback if no logo or hotspotId, else show logo & hotspot name */}
        {logoUrl || ownerName ? (
          <div style={{ marginBottom: 18 }}>
            {logoUrl ? (
              <img src={logoUrl} alt="Business Logo" style={styles.logoImage} />
            ) : (
              <div
                style={{ ...styles.logoPlaceholder, position: "relative" }}
                aria-label="Business Logo"
              >
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 18,
                    fontWeight: 700,
                    fontSize: 34,
                    color: "#fff",
                    textAlign: "center",
                    letterSpacing: "2px",
                  }}
                >
                  {(ownerName || "W").slice(0, 1).toUpperCase()}
                </span>
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 13,
                    fontSize: 13,
                    color: "#2563eb",
                    fontWeight: 800,
                    textAlign: "center",
                    letterSpacing: "1.8px",
                    textShadow: "0 2px 8px rgba(0,0,0,0.10)",
                  }}
                >
                  YABA CARD
                </span>
              </div>
            )}
            <div
              style={{
                fontWeight: 700,
                fontSize: 20,
                marginTop: 7,
                marginBottom: 0,
                color: "#2563eb",
                textAlign: "center",
                letterSpacing: ".5px",
              }}
            >
              {ownerName}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 18 }}>
            <img
              src="/yabalink logo mono.svg"
              alt="YABAlink Logo"
              style={{
                ...styles.logoImage,
                width: 80,
                height: 80,
                objectFit: "contain",
              }}
            />
            <h1
              style={{
                ...styles.yabaBrandName,
                color: "#2563eb",
                fontSize: 28,
                margin: 0,
              }}
            >
              YABA
              <span
                style={{
                  fontFamily: '"Adobe Song Std", "Songti SC", serif',
                  fontStyle: "italic",
                }}
              >
                link
              </span>
            </h1>
            <div
              style={{
                fontSize: 15,
                fontWeight: 500,
                color: "#64748b",
                margin: "4px 0 0 0",
              }}
            >
              Fast. Reliable. Secure.
            </div>
          </div>
        )}

        {/* Tabs */}
        {/* Removed the word 'Welcome' per request */}
        <div style={styles.tabsRow}>
          <button
            onClick={() => setActiveTab("voucher")}
            className={`yaba-btn ${
              activeTab === "voucher"
                ? "yaba-btn--accent"
                : "yaba-btn--secondary"
            }`}
            style={{ width: "50%" }}
          >
            Voucher Login
          </button>
          <button
            onClick={() => setActiveTab("user")}
            className={`yaba-btn ${
              activeTab === "user" ? "yaba-btn--accent" : "yaba-btn--secondary"
            }`}
            style={{ width: "50%" }}
          >
            User Login
          </button>
        </div>

        {/* Voucher Form */}
        {activeTab === "voucher" && (
          <div
            style={{
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <input
              type="text"
              placeholder="Enter Voucher Code"
              value={voucherCode}
              onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
              className="yaba-input"
            />
            <button
              onClick={handleRedeemVoucher}
              className="yaba-btn yaba-btn--accent"
              disabled={redeeming}
              style={{ width: "100%" }}
            >
              {redeeming ? "Connecting…" : "Connect"}
            </button>
          </div>
        )}

        {/* User Form (Phone Login) */}
        {activeTab === "user" && (
          <div
            style={{
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {/* Referral Code Input - Only show if user came via referral */}
            {isReferralUser && (
              <div style={{ marginBottom: 16 }}>
                <input
                  type="text"
                  placeholder="Referral Code"
                  value={referralCode}
                  readOnly
                  style={{
                    ...styles.input,
                    backgroundColor: "#f0f9ff",
                    borderColor: "#3b82f6",
                  }}
                />
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--success)",
                    marginTop: 4,
                    textAlign: "center",
                  }}
                >
                  🎉 You're joining with a referral code! You'll get bonus
                  rewards.
                </div>
              </div>
            )}

            {/* Location Status */}
            {isReferralUser && (
              <div style={{ marginBottom: 16, textAlign: "center" }}>
                {locationStatus === "checking" && (
                  <div style={{ fontSize: 14, color: "var(--text-muted)" }}>
                    📍 Checking your location...
                  </div>
                )}
                {locationStatus === "in-range" && (
                  <div style={{ fontSize: 14, color: "var(--success)" }}>
                    ✅ You're in range! You can connect to this hotspot.
                  </div>
                )}
                {locationStatus === "out-of-range" && (
                  <div style={{ fontSize: 14, color: "var(--danger)" }}>
                    ⚠️ You're not in range. Please move closer to the hotspot.
                  </div>
                )}
              </div>
            )}

            <input
              type="text"
              placeholder="Phone Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="yaba-input"
            />
            <div
              style={{
                position: "relative",
                width: "100%",
                minWidth: 0,
                display: "block",
                margin: 0,
                padding: 0,
              }}
            >
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="yaba-input"
                style={{
                  paddingRight: 64,
                  width: "100%",
                  boxSizing: "border-box",
                  margin: 0,
                }}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--stroke)",
                  background: "var(--surface-2)",
                  cursor: "pointer",
                }}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <button
              onClick={handleLogin}
              className="yaba-btn yaba-btn--accent"
              style={{ width: "100%" }}
              disabled={isLoading || !canLogin || checkingHotspot}
            >
              {isLoading
                ? "Connecting…"
                : checkingHotspot
                  ? "Checking hotspot…"
                  : "Connect"}
            </button>
            {hotspotMessage ? (
              <div
                style={{
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                {hotspotMessage}
              </div>
            ) : null}
            <button
              onClick={handleForgotPassword}
              className="yaba-btn yaba-btn--secondary"
              style={{ width: "100%" }}
            >
              Forgot Password?
            </button>
            {showForgot && (
              <div
                className="yaba-card"
                style={{
                  marginTop: 12,
                  padding: 12,
                  border: "1px solid var(--stroke)",
                  borderRadius: 12,
                  textAlign: "left",
                }}
              >
                <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Enter phone number to receive a reset code
                </label>
                <input
                  type="tel"
                  placeholder="Phone number"
                  value={forgotPhone}
                  onChange={(e) => setForgotPhone(e.target.value)}
                  className="yaba-input"
                  style={{ marginTop: 6 }}
                />
                <button
                  onClick={submitForgotPassword}
                  className="yaba-btn yaba-btn--accent"
                  style={{ width: "100%" }}
                  disabled={forgotLoading}
                >
                  {forgotLoading ? "Sending…" : "Send Reset Code"}
                </button>
                {forgotMessage && (
                  <div style={{ fontSize: 12, marginTop: 6 }}>
                    {forgotMessage}
                  </div>
                )}
              </div>
            )}
            <p style={styles.helpText}>
              💡 New users: Enter your phone number and create a password to get
              started.
            </p>
          </div>
        )}

        {error && <p style={styles.error}>{error}</p>}
        {isFirstTimeSetup && (
          <p style={styles.success}>
            ✅ Welcome! Your account has been created and password set. You're
            now logged in!
          </p>
        )}

        {/* Support Contact Section */}
        {(ownerPhone || ownerWhatsapp) && (
          <div style={styles.supportSection}>
            <p style={styles.supportTitle}>Need Help?</p>
            <div style={styles.supportButtons}>
              {ownerPhone && (
                <button
                  onClick={() => window.open(`tel:${ownerPhone}`)}
                  style={styles.supportBtn}
                >
                  📞 Call Owner
                </button>
              )}
              {ownerWhatsapp && (
                <button
                  onClick={() =>
                    window.open(
                      `https://wa.me/${ownerWhatsapp.replace(/[^0-9]/g, "")}`,
                    )
                  }
                  style={styles.supportBtn}
                >
                  💬 WhatsApp
                </button>
              )}
            </div>
          </div>
        )}

        {/* Moving Reviews Section - Only show for referral users */}
        {isReferralUser && hotspotId && <MovingReviews hotspotId={hotspotId} />}

        <div style={styles.poweredBy}>
          <p>Powered by</p>
          <div style={styles.logoRow}>
            <img
              src="/yabanect logo.svg"
              alt="YABAnect"
              style={styles.yabaLogo}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    background: "linear-gradient(to right, #2563eb, #1e3a8a)",
    padding: "20px",
  },
  yabaHeader: {
    marginBottom: "30px",
    textAlign: "center",
  },
  yabaBranding: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
  },
  yabaHeaderLogo: {
    height: "60px",
    width: "60px",
    objectFit: "contain",
    filter: "brightness(0) invert(1)", // Make logo white
  },
  yabaBrandText: {
    textAlign: "center",
  },
  yabaBrandName: {
    fontSize: "32px",
    fontWeight: "bold",
    color: "#ffffff",
    margin: "0 0 8px 0",
    textShadow: "0 2px 4px rgba(0,0,0,0.3)",
  },
  yabaTagline: {
    fontSize: "16px",
    color: "#e2e8f0",
    margin: "0",
    fontWeight: "500",
    textShadow: "0 1px 2px rgba(0,0,0,0.3)",
  },
  card: {
    background: "#fff",
    padding: "35px 25px",
    borderRadius: "12px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
    width: "100%",
    maxWidth: "400px",
    textAlign: "center",
  },
  tabsRow: {
    display: "flex",
    gap: 6,
    background: "#f1f5f9",
    padding: 6,
    borderRadius: 8,
  },
  tabBtn: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid transparent",
    background: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 600,
  },
  tabBtnActive: {
    background: "#0ea5e9",
    color: "#fff",
    borderColor: "#0284c7",
  },
  title: {
    fontSize: "24px",
    marginBottom: "20px",
    fontWeight: "bold",
    color: "#111",
  },
  input: {
    width: "100%",
    padding: "12px",
    margin: "10px 0",
    borderRadius: "5px",
    border: "1px solid #ccc",
    fontSize: "15px",
  },
  button: {
    width: "100%",
    padding: "12px",
    backgroundColor: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: "5px",
    fontWeight: "bold",
    fontSize: "16px",
    cursor: "pointer",
    marginTop: "10px",
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#2563eb",
    cursor: "pointer",
    marginTop: "10px",
    fontSize: "14px",
    textDecoration: "underline",
  },
  error: {
    marginTop: "15px",
    color: "tomato",
    fontWeight: "bold",
  },
  success: {
    marginTop: "15px",
    color: "#10b981",
    fontWeight: "bold",
  },
  helpText: {
    marginTop: "15px",
    fontSize: "12px",
    color: "#6b7280",
    lineHeight: "1.4",
    textAlign: "center",
  },
  poweredBy: {
    marginTop: "25px",
    textAlign: "center",
  },
  logoRow: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    marginTop: "10px",
  },
  yabaLogo: {
    height: "45px",
    objectFit: "contain",
  },

  // 🔥 NEW: Round logo display above title
  logoImage: {
    width: "96px",
    height: "96px",
    objectFit: "cover",
    borderRadius: "50%",
    border: "none",
    boxShadow: "none",
    margin: "0 auto 15px auto",
    display: "block",
  },
  logoPlaceholder: {
    width: "96px",
    height: "96px",
    borderRadius: "50%",
    margin: "0 auto 15px auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    color: "#fff",
    background: "linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
    fontSize: "28px",
    border: "none",
  },
  supportSection: {
    marginTop: "20px",
    padding: "15px",
    backgroundColor: "#f8fafc",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
  },
  supportTitle: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#64748b",
    margin: "0 0 10px 0",
    textAlign: "center",
  },
  supportButtons: {
    display: "flex",
    gap: "10px",
    justifyContent: "center",
  },
  supportBtn: {
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: "500",
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    backgroundColor: "var(--surface)",
    color: "#374151",
    cursor: "pointer",
    transition: "all 0.2s",
  },
};

export default Login;
