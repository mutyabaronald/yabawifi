import { formatUGX } from "./components/currency";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "./contexts/ThemeContext";
import ThemeToggle from "./components/ThemeToggle";
import { db } from "./firebase";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";

function MyReceipts() {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const [allReceipts, setAllReceipts] = useState([]);
  const [filteredReceipts, setFilteredReceipts] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const phone = localStorage.getItem("phone");
  const printRef = useRef(); 
  
  const styles = createStyles(isDark);

  useEffect(() => {
    const fetchReceipts = async () => {
      try {
        const q = query(
          collection(db, "receipts"),
          where("phone", "==", phone),
          orderBy("time", "desc")
        );
        const snapshot = await getDocs(q);
        const list = snapshot.docs.map((doc) => doc.data());
        setAllReceipts(list);
        setFilteredReceipts(list);
      } catch (err) {
        console.error("❌ Error fetching receipts:", err);
      }
    };

    fetchReceipts();
  }, [phone]);

  useEffect(() => {
    const filtered = allReceipts.filter((r) => {
      const matchesSearch =
        r.packageName?.toLowerCase().includes(search.toLowerCase()) ||
        r.phone?.includes(search) ||
        r.time?.toLowerCase().includes(search.toLowerCase());

      const matchesStatus =
        !statusFilter || r.status.toLowerCase() === statusFilter.toLowerCase();

      return matchesSearch && matchesStatus;
    });

    setFilteredReceipts(filtered);
  }, [search, statusFilter, allReceipts]);

  const handlePrintOne = (receipt) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head><title>Receipt</title></head>
        <body>
          <h2>📄 WiFi Payment Receipt</h2>
          <p><strong>Package:</strong> ${receipt.packageName}</p>
          <p><strong>Amount:</strong> ${formatUGX(receipt.amount)}</p>
          <p><strong>Phone:</strong> ${receipt.phone}</p>
          <p><strong>Status:</strong> ${receipt.status}</p>
          <p><strong>Time:</strong> ${receipt.time}</p>
          <hr />
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handlePrintAll = () => {
    window.print();
  };

  return (
    <div style={styles.container}>
      <div style={styles.controls}>
        <ThemeToggle />
        <button style={styles.button} onClick={() => navigate("/packages")}>
          🔙 Back
        </button>
        <button style={styles.button} onClick={handlePrintAll}>
          🖨️ Print All
        </button>
        <input
          type="text"
          placeholder="Search by package, phone, or date..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.input}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={styles.input}
        >
          <option value="">All Status</option>
          <option value="Success">Success</option>
          <option value="Failed">Failed</option>
        </select>
      </div>

      <div style={styles.grid}>
        {filteredReceipts.map((r, i) => (
          <div key={i} style={styles.card}>
            <h3 style={styles.cardTitle}>{r.packageName}</h3>
            <p style={styles.textRow}>
              <span style={styles.muted}>Amount:</span> {formatUGX(r.amount)}
            </p>
            <p style={styles.textRow}>
              <span style={styles.muted}>Phone:</span> {r.phone}
            </p>
            <p style={styles.textRow}>
              <span style={styles.muted}>Status:</span> {r.status}
            </p>
            <p style={styles.textRow}>
              <span style={styles.muted}>Time:</span> {r.time}
            </p>
            <button onClick={() => handlePrintOne(r)} style={styles.printBtn}>
              🖨️ Print
            </button>
          </div>
        ))}
        {filteredReceipts.length === 0 && (
          <p style={styles.empty}>No receipts found.</p>
        )}
      </div>
    </div>
  );
}

function createStyles(isDark) {
  // Dark palette tuned to image: near-black background with layered charcoal cards
  const bgPage = isDark ? "#121315" : "#f8fafc"; // near-black
  const textPrimary = isDark ? "#f1f2f4" : "#0f172a"; // off-white
  const textMuted = isDark ? "#a0a6ad" : "#475569"; // medium grey
  const surface = isDark ? "#1a1c20" : "#ffffff"; // card charcoal
  const surfaceBorder = isDark ? "#2a2d34" : "#e5e7eb"; // subtle edge
  const inputBg = isDark ? "#15171b" : "#ffffff"; // darker field
  const inputBorder = isDark ? "#2f333a" : "#d1d5db";
  const buttonBg = "#8b5cf6"; // Cursor-like purple accent
  const printBg = "#10b981";

  return {
    container: {
      padding: "20px",
      textAlign: "center",
      backgroundColor: bgPage,
      color: textPrimary,
      minHeight: "100vh",
    },
    controls: {
      display: "flex",
      flexWrap: "wrap",
      gap: "10px",
      marginBottom: "20px",
      justifyContent: "center",
    },
    button: {
      padding: "8px 15px",
      backgroundColor: buttonBg,
      color: "#ffffff",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
    },
    input: {
      padding: "8px",
      borderRadius: "8px",
      border: `1px solid ${inputBorder}`,
      minWidth: "200px",
      backgroundColor: inputBg,
      color: textPrimary,
      outline: "none",
    },
    grid: {
      display: "flex",
      flexDirection: "column",
      gap: "15px",
      alignItems: "center",
    },
    card: {
      border: `1px solid ${surfaceBorder}`,
      borderRadius: "20px",
      padding: "16px",
      width: "100%",
      maxWidth: "380px",
      boxShadow: isDark ? "0 10px 20px rgba(0,0,0,0.35)" : "0 10px 20px rgba(0,0,0,0.12)",
      background: isDark ? "linear-gradient(135deg, #14161a, #1d2126)" : surface,
      textAlign: "left",
      position: 'relative',
      overflow: 'hidden',
    },
    cardTitle: {
      margin: "0 0 8px 0",
      fontSize: "18px",
      color: textPrimary,
    },
    textRow: {
      margin: "6px 0",
      color: textPrimary,
    },
    muted: {
      color: textMuted,
      fontWeight: 600,
      marginRight: "6px",
    },
    printBtn: {
      marginTop: "12px",
      padding: "8px 12px",
      backgroundColor: printBg,
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      filter: "brightness(1)",
    },
    empty: {
      marginTop: "20px",
      color: textMuted,
    },
  };
}

export default MyReceipts;
