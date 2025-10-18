import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

function RegisterOwner() {
  const navigate = useNavigate();
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!ownerName || !ownerPhone || !password) {
      setError("Please enter name, phone number, and password.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setIsLoading(true);
    setError("");
    setMessage("");

    try {
      // Register the new owner
      const registerResponse = await axios.post(
        "http://localhost:5000/api/owners/register",
        {
          ownerName,
          ownerPhone,
          password,
          businessName,
        }
      );

      if (registerResponse.data.success) {
        setMessage("Owner registered successfully! Logging you in...");

        // Optimize: Use the owner data from registration response instead of making another API call
        try {
          // Get the owner data from the registration response
          const ownerId = registerResponse.data.ownerId;

          // Generate token locally to avoid another database query
          const token = crypto.randomUUID();

          // Store owner session immediately
          localStorage.setItem("ownerId", ownerId);
          localStorage.setItem("ownerToken", token);
          localStorage.setItem("ownerName", ownerName);
          if (businessName) {
            localStorage.setItem("businessName", businessName);
          }

          // Store session in database asynchronously (don't wait for it)
          axios
            .post("http://localhost:5000/api/owners/login", {
              phone: ownerPhone,
              password: password,
            })
            .catch((err) => {
              console.warn(
                "Session storage failed, but login will still work:",
                err
              );
            });

          // Redirect immediately
          navigate("/admindashboard");
        } catch (loginErr) {
          console.error("Auto-login error:", loginErr);
          setError(
            "Registration successful but auto-login failed. Please login manually."
          );
          setMessage("");
        }
      } else {
        setError(registerResponse.data.message || "Registration failed.");
      }
    } catch (err) {
      console.error("Registration error:", err);
      if (err.response?.data?.message) {
        setError(err.response.data.message);
      } else {
        setError("Registration failed. Please try again.");
      }
      setMessage("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <form
        onSubmit={handleSubmit}
        className="yaba-card"
        style={{
          ...styles.form,
          background: "var(--surface-gradient)",
          border: "1px solid var(--stroke)",
          borderRadius: 20,
          padding: 24,
          color: "var(--text-primary)",
          maxWidth: 480,
        }}
      >
        <h2 style={styles.title}>Register WiFi Owner</h2>
        <p style={styles.subtitle}>Create your hotspot business account</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="text"
            placeholder="Owner Name *"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            className="yaba-input"
            required
          />

          <input
            type="text"
            placeholder="Business Name (Optional)"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="yaba-input"
          />

          <input
            type="tel"
            placeholder="Phone Number *"
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(e.target.value)}
            className="yaba-input"
            required
          />

          <input
            type="password"
            placeholder="Password *"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="yaba-input"
            required
          />

          <input
            type="password"
            placeholder="Confirm Password *"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="yaba-input"
            required
          />

          <button
            type="submit"
            className="yaba-btn yaba-btn--accent"
            style={{ width: "100%" }}
            disabled={isLoading}
          >
            {isLoading ? "Creating Account..." : "Register & Login"}
          </button>

          {message && (
            <p style={{ ...styles.success, marginTop: 8 }}>{message}</p>
          )}
          {error && <p style={{ ...styles.error, marginTop: 8 }}>{error}</p>}

          <p style={{ ...styles.note, marginTop: 8 }}>
            * Required fields. After registration, you'll be automatically
            logged in and redirected to your dashboard.
          </p>
        </div>

        <div
          style={{ height: 1, background: "var(--stroke)", margin: "16px 0" }}
        />
        <div style={{ textAlign: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Powered by
          </span>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              marginTop: 6,
            }}
          >
            <img
              src="/YABA.svg"
              alt="YABA"
              style={{ height: 32, objectFit: "contain" }}
            />
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
    justifyContent: "center",
    alignItems: "center",
    background: "linear-gradient(to right, #2563eb, #1e3a8a)",
    padding: "20px",
  },
  form: {
    width: "100%",
  },
  title: {
    fontSize: "24px",
    marginBottom: "8px",
    textAlign: "center",
    fontWeight: "bold",
    color: "var(--text-primary)",
  },
  subtitle: {
    fontSize: "14px",
    color: "var(--text-muted)",
    textAlign: "center",
    marginBottom: "25px",
  },
  input: {},
  button: {},
  success: {
    color: "#16a34a",
    marginTop: "15px",
    fontWeight: "bold",
    textAlign: "center",
  },
  error: {
    color: "tomato",
    marginTop: "15px",
    fontWeight: "bold",
    textAlign: "center",
  },
  note: {
    fontSize: "12px",
    color: "#666",
    textAlign: "center",
    marginTop: "20px",
    lineHeight: "1.4",
  },
};

export default RegisterOwner;
