import React, { useEffect, useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "./firebase";
import YABALogo from "../public/YABA.svg";

const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/; // min 8, letters+numbers

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("phone"); // 'email' | 'phone' - default to phone for users

  // Email flow
  const [email, setEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");

  // Phone flow (using backend API)
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpMessage, setOtpMessage] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState(null);

  // New password (phone flow)
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordMessage, setNewPasswordMessage] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const otpExpirySeconds = 180; // UI countdown only (3 minutes)
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!otpSent || countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [otpSent, countdown]);

  // Email reset link
  const handleSendEmailLink = async () => {
    setEmailMessage("");
    if (!email || !email.includes("@")) {
      setEmailMessage("Please enter a valid email.");
      return;
    }
    try {
      setEmailSending(true);
      await sendPasswordResetEmail(auth, email);
      setEmailMessage("✅ Reset link sent. Please check your email.");
    } catch (err) {
      setEmailMessage(err?.message || "Failed to send reset link.");
    } finally {
      setEmailSending(false);
    }
  };

  // Send phone OTP via backend API
  const handleSendOtp = async () => {
    setOtpMessage("");
    setVerifiedPhone(null);
    if (!phone) {
      setOtpMessage("Please enter your phone number.");
      return;
    }
    try {
      setOtpSending(true);
      const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";
      const res = await fetch(`${apiBase}/api/users/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpMessage(data.error || "Failed to send reset code.");
        return;
      }
      setOtpSent(true);
      setCountdown(otpExpirySeconds);
      setOtpMessage("✅ Reset code sent. Check your phone/SMS.");
    } catch (err) {
      setOtpMessage("Network error. Please try again.");
    } finally {
      setOtpSending(false);
    }
  };

  // Verify OTP via backend API
  const handleVerifyOtp = async () => {
    setOtpMessage("");
    if (!otp || otp.length < 4) {
      setOtpMessage("Enter the reset code sent to your phone.");
      return;
    }
    try {
      setOtpVerifying(true);
      const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";
      const res = await fetch(`${apiBase}/api/users/verify-reset-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpMessage(data.error || "Invalid reset code. Try again.");
        return;
      }
      setVerifiedPhone(phone);
      setOtpMessage("✅ Phone verified. Set your new password below.");
    } catch (err) {
      setOtpMessage("Network error. Please try again.");
    } finally {
      setOtpVerifying(false);
    }
  };

  // Update password via backend API
  const handleResetPasswordWithPhone = async () => {
    setNewPasswordMessage("");
    if (!verifiedPhone) {
      setNewPasswordMessage("Phone verification incomplete.");
      return;
    }
    if (!PASSWORD_REGEX.test(newPassword)) {
      setNewPasswordMessage(
        "Password must be at least 8 chars and include letters & numbers."
      );
      return;
    }
    try {
      setUpdatingPassword(true);
      const apiBase = import.meta.env.VITE_API_URL || "http://localhost:5000";
      const res = await fetch(`${apiBase}/api/users/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: verifiedPhone, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNewPasswordMessage(data.error || "Failed to reset password.");
        return;
      }
      setNewPasswordMessage("✅ Password updated. Please login again.");
    } catch (err) {
      setNewPasswordMessage("Network error. Please try again.");
    } finally {
      setUpdatingPassword(false);
    }
  };

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
    card: {
      width: "100%",
      maxWidth: "400px",
      textAlign: "center",
    },
    yabaHeader: {
      marginBottom: "18px",
    },
    logo: {
      width: "96px",
      height: "96px",
      objectFit: "cover",
      borderRadius: "50%",
      border: "none",
      boxShadow: "none",
      margin: "0 auto 15px",
      display: "block",
    },
    yabaTitle: {
      fontSize: "28px",
      fontWeight: "bold",
      color: "#2563eb",
      margin: "0",
      textShadow: "rgba(0, 0, 0, 0.3) 0px 2px 4px",
    },
    tagline: {
      fontSize: "15px",
      fontWeight: "500",
      color: "#64748b",
      margin: "4px 0 0",
    },
    tabsRow: {
      display: "flex",
      gap: 6,
      background: "var(--surface-2)",
      padding: 6,
      borderRadius: 8,
      marginTop: 16,
    },
    tabBtn: {
      flex: 1,
      padding: "10px 12px",
      borderRadius: 6,
      border: "1px solid transparent",
      background: "transparent",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: "14px",
      color: "var(--text-secondary)",
      transition: "all 0.2s",
    },
    tabBtnActive: {
      background: "#2563eb",
      color: "#fff",
    },
    input: {
      width: "100%",
      padding: "12px",
      margin: "10px 0",
      borderRadius: "8px",
      border: "1px solid var(--stroke)",
      fontSize: "15px",
      background: "var(--control)",
      color: "var(--text-primary)",
      outline: "none",
      transition: "all 0.2s",
    },
    button: {
      width: "100%",
      padding: "12px",
      margin: "10px 0",
      borderRadius: "8px",
      border: "none",
      fontSize: "15px",
      fontWeight: 600,
      cursor: "pointer",
      background: "#2563eb",
      color: "#fff",
      transition: "all 0.2s",
    },
    buttonDisabled: {
      opacity: 0.6,
      cursor: "not-allowed",
    },
    backButton: {
      marginTop: "16px",
      padding: "8px 16px",
      borderRadius: "8px",
      border: "1px solid var(--stroke)",
      background: "var(--surface-2)",
      color: "var(--text-primary)",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: 500,
      transition: "all 0.2s",
    },
    message: {
      fontSize: "13px",
      marginTop: "8px",
      padding: "8px",
      borderRadius: "6px",
      color: "var(--text-primary)",
    },
    messageSuccess: {
      background: "rgba(16, 185, 129, 0.1)",
      color: "#10b981",
    },
    messageError: {
      background: "rgba(239, 68, 68, 0.1)",
      color: "#ef4444",
    },
  };

  return (
    <div style={styles.container}>
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
        {/* YABA Header */}
        <div style={styles.yabaHeader}>
          <img
            alt="YABA Logo"
            src={YABALogo}
            style={styles.logo}
          />
          <h1 style={styles.yabaTitle}>YABAnect</h1>
          <div style={styles.tagline}>Connect. Experience. Belong.</div>
        </div>

        <h2 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "20px", color: "var(--text-primary)" }}>
          Forgot Password
        </h2>

        <div style={styles.tabsRow}>
          <button
            onClick={() => setActiveTab("email")}
            style={{
              ...styles.tabBtn,
              ...(activeTab === "email" ? styles.tabBtnActive : {}),
            }}
          >
            Email
          </button>
          <button
            onClick={() => setActiveTab("phone")}
            style={{
              ...styles.tabBtn,
              ...(activeTab === "phone" ? styles.tabBtnActive : {}),
            }}
          >
            Phone
          </button>
        </div>

        {activeTab === "email" && (
          <div style={{ marginTop: "16px" }}>
            <label style={{ fontSize: "13px", color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>
              Enter your email
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              style={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <button
              onClick={handleSendEmailLink}
              disabled={emailSending}
              style={{
                ...styles.button,
                ...(emailSending ? styles.buttonDisabled : {}),
              }}
            >
              {emailSending ? "Sending..." : "Send Reset Link"}
            </button>
            {emailMessage && (
              <div
                style={{
                  ...styles.message,
                  ...(emailMessage.includes("✅")
                    ? styles.messageSuccess
                    : styles.messageError),
                }}
              >
                {emailMessage}
              </div>
            )}
          </div>
        )}

        {activeTab === "phone" && (
          <div style={{ marginTop: "16px" }}>
            {!otpSent && (
              <>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>
                  Enter your phone number
                </label>
                <input
                  type="tel"
                  placeholder="Phone Number"
                  style={styles.input}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
                <button
                  onClick={handleSendOtp}
                  disabled={otpSending}
                  style={{
                    ...styles.button,
                    ...(otpSending ? styles.buttonDisabled : {}),
                  }}
                >
                  {otpSending ? "Sending..." : "Send Reset Code"}
                </button>
                {otpMessage && (
                  <div
                    style={{
                      ...styles.message,
                      ...(otpMessage.includes("✅")
                        ? styles.messageSuccess
                        : styles.messageError),
                    }}
                  >
                    {otpMessage}
                  </div>
                )}
              </>
            )}

            {otpSent && !verifiedPhone && (
              <>
                <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                  Enter the reset code sent to your phone.
                  {countdown > 0 && (
                    <span style={{ marginLeft: "4px", color: "var(--text-tertiary)" }}>
                      (expires in {countdown}s)
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Reset Code"
                  style={styles.input}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  maxLength={10}
                />
                <button
                  onClick={handleVerifyOtp}
                  disabled={otpVerifying}
                  style={{
                    ...styles.button,
                    ...(otpVerifying ? styles.buttonDisabled : {}),
                  }}
                >
                  {otpVerifying ? "Verifying..." : "Verify Code"}
                </button>
                {otpMessage && (
                  <div
                    style={{
                      ...styles.message,
                      ...(otpMessage.includes("✅")
                        ? styles.messageSuccess
                        : styles.messageError),
                    }}
                  >
                    {otpMessage}
                  </div>
                )}
              </>
            )}

            {verifiedPhone && (
              <>
                <label style={{ fontSize: "13px", color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>
                  Enter new password
                </label>
                <input
                  type="password"
                  placeholder="New password (min 8, letters & numbers)"
                  style={styles.input}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  onClick={handleResetPasswordWithPhone}
                  disabled={updatingPassword}
                  style={{
                    ...styles.button,
                    ...(updatingPassword ? styles.buttonDisabled : {}),
                  }}
                >
                  {updatingPassword ? "Updating..." : "Update Password"}
                </button>
                {newPasswordMessage && (
                  <div
                    style={{
                      ...styles.message,
                      ...(newPasswordMessage.includes("✅")
                        ? styles.messageSuccess
                        : styles.messageError),
                    }}
                  >
                    {newPasswordMessage}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Back Button */}
        <button
          onClick={() => navigate("/")}
          style={styles.backButton}
        >
          ← Back to Login
        </button>
      </div>
    </div>
  );
}
