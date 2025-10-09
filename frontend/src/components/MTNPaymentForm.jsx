import { formatUGX } from "./currency";
import React, { useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const MTNPaymentForm = ({ ownerId, packages = [], ownerPhone = "", ownerWhatsapp = "" }) => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [packageName, setPackageName] = useState("");
  const [message, setMessage] = useState("");
  const [referralCode, setReferralCode] = useState("");

  const packageOptions = useMemo(
    () =>
      packages.map((p) => ({
        label: `${p.packageName} - ${formatUGX(p.price)}`,
        value: p.packageName,
        price: p.price,
      })),
    [packages]
  );

  const onSelectPackage = (name) => {
    setPackageName(name);
    const pkg = packageOptions.find((p) => p.value === name);
    if (pkg) setAmount(String(pkg.price));
  };


  const handlePayment = async (e) => {
    e.preventDefault();
    setMessage("Processing...");

    try {
      const response = await axios.post("http://localhost:5000/api/pay/mtn", {
        phone,
        amount,
        packageName,
        ownerId, // Add ownerId to the payment request
        referralCode, // Include referral code if provided
        hotspotId: ownerId, // Use ownerId as hotspotId for now - you can update this based on your hotspot structure
      });

      if (response.data.success) {
        setMessage(`✅ Payment initiated! Ref: ${response.data.referenceId}. Redirecting to dashboard...`);
        
        // Save receipt
        try {
          await axios.post("http://localhost:5000/api/receipts/save", {
            phone,
            amount: Number(amount),
            packageName,
            ownerId,
            referralCode, // Include referral code in receipt
          });
        } catch (err) {
          console.warn("Receipt save failed (non-blocking)", err.message);
        }

        // Automatically log in the user after successful payment
        localStorage.setItem("phone", phone);
        
        // Show success message briefly then redirect to dashboard
        setTimeout(() => {
          navigate("/dashboard");
        }, 2000);
      } else {
        setMessage("⚠️ Payment failed.");
      }
    } catch (err) {
      console.error("❌ Payment Error:\n", err.response?.data || err.message);
      setMessage("❌ Payment failed. Check console.");
    }
  };

  return (
    <div style={styles.container}>
      <h2>Pay for WiFi (Mobile Money)</h2>
      <form onSubmit={handlePayment} style={styles.form}>
        {packageOptions.length > 0 && (
          <select
            value={packageName}
            onChange={(e) => onSelectPackage(e.target.value)}
            style={styles.input}
            required
          >
            <option value="">Select Package</option>
            {packageOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder="Enter mobile number (e.g. 25677...)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          style={styles.input}
        />
        <input
          type="number"
          placeholder="Amount (UGX)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          style={styles.input}
        />
        
        {/* Referral Code Input */}
        <input
          type="text"
          placeholder="Referral Code (Optional)"
          value={referralCode}
          onChange={(e) => setReferralCode(e.target.value)}
          style={styles.input}
        />
        
        <button type="submit" style={styles.button}>
          Pay Now
        </button>
      </form>
      {message && <p style={styles.message}>{message}</p>}
      
      {/* Support Contact Section */}
      {(ownerPhone || ownerWhatsapp) && (
        <div style={styles.supportSection}>
          <p style={styles.supportTitle}>Having payment issues? Contact Owner:</p>
          <div style={styles.supportButtons}>
            {ownerPhone && (
              <button 
                onClick={() => window.open(`tel:${ownerPhone}`)}
                style={styles.supportBtn}
              >
                📞 Call
              </button>
            )}
            {ownerWhatsapp && (
              <button 
                onClick={() => window.open(`https://wa.me/${ownerWhatsapp.replace(/[^0-9]/g, '')}`)}
                style={styles.supportBtn}
              >
                💬 WhatsApp
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    padding: 20,
    maxWidth: 400,
    margin: "auto",
    textAlign: "center",
  },
  form: { display: "flex", flexDirection: "column", gap: 10 },
  input: { padding: 10, fontSize: 16 },
  button: {
    padding: 12,
    fontSize: 18,
    background: "#0066cc",
    color: "#fff",
    border: "none",
  },
  message: { marginTop: 10, fontWeight: "bold" },
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

export default MTNPaymentForm;
