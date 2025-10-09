import { formatUGX } from "./components/currency";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function Receipt() {
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem("receipt");
    if (stored) {
      setReceipt(JSON.parse(stored));
    } else {
      navigate("/packages");
    }
  }, [navigate]);

  if (!receipt) return <p>Loading receipt...</p>;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2>🧾 Payment Receipt</h2>
        <p>
          <strong>Phone:</strong> {receipt.phone}
        </p>
        <p>
          <strong>Package:</strong> {receipt.packageName}
        </p>
        <p>
          <strong>Amount Paid:</strong> {formatUGX(receipt.amount)}
        </p>
        <p>
          <strong>Status:</strong> ✅ {receipt.status}
        </p>
        <p>
          <strong>Time:</strong> {receipt.time}
        </p>

        <button onClick={() => navigate("/packages")} style={styles.button}>
          Back to Packages
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    padding: "20px",
  },
  card: {
    backgroundColor: "var(--surface)",
    padding: "30px",
    borderRadius: "10px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    maxWidth: "400px",
    width: "100%",
    textAlign: "left",
  },
  button: {
    marginTop: "20px",
    padding: "10px 15px",
    backgroundColor: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: "5px",
    cursor: "pointer",
  },
};

export default Receipt;
