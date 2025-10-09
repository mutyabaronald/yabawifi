import { useState } from "react";
import axios from "axios";

function CreatePackage({ ownerId }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const [status, setStatus] = useState("paused");
  const [ownerName, setOwnerName] = useState("");
  const [message, setMessage] = useState("");

  const handleCreate = async () => {
    if (!ownerId) return setMessage("❌ Missing ownerId");
    if (!name || !price) return setMessage("❌ Name and price are required");

    try {
      const res = await axios.post("http://localhost:5000/api/packages/create", {
        packageName: name,
        price: Number(price),
        status,
        ownerId,
        ownerName,
      });
      if (res.status === 201) {
        setMessage("✅ Package created!");
        setName("");
        setPrice("");
        setDuration("");
        setStatus("paused");
      } else {
        setMessage("❌ Failed to create package");
      }
    } catch (err) {
      console.error("Create package error:", err);
      setMessage("❌ Failed to create package");
    }
  };

  return (
    <div style={styles.card}>
      <h3>Create a Package</h3>

      <input
        style={styles.input}
        placeholder="Package Name (e.g. Daily Pass)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        style={styles.input}
        type="number"
        placeholder="Price (UGX)"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <input
        style={styles.input}
        placeholder="Duration (e.g. 1 Day)"
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
      />
      <input
        style={styles.input}
        placeholder="Owner Name (optional)"
        value={ownerName}
        onChange={(e) => setOwnerName(e.target.value)}
      />
      <select
        style={styles.input}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="launched">Launched</option>
        <option value="paused">Paused</option>
      </select>

      <button style={styles.button} onClick={handleCreate}>
        Create Package
      </button>

      {message && <p>{message}</p>}
    </div>
  );
}

const styles = {
  card: {
    background: "white",
    padding: "30px",
    borderRadius: "8px",
    maxWidth: "400px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
  },
  input: {
    width: "100%",
    padding: "10px",
    margin: "10px 0",
    borderRadius: "4px",
    border: "1px solid #ccc",
  },
  button: {
    background: "#2563eb",
    color: "#ffffff",
    padding: "10px 15px",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
  },
};

export default CreatePackage;
