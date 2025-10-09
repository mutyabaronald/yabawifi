import React, { useState, useEffect } from "react";
import axios from "axios";
import { FaUpload, FaImage, FaTrash, FaEdit } from "react-icons/fa";

function UploadLogo() {
  const [logo, setLogo] = useState(null);
  const [currentLogoUrl, setCurrentLogoUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const ownerId = localStorage.getItem("ownerId");
  const ownerName = localStorage.getItem("ownerName");

  // Fetch current logo on component mount
  useEffect(() => {
    if (ownerId) {
      fetchCurrentLogo();
    }
  }, [ownerId]);

  const fetchCurrentLogo = async () => {
    try {
      const response = await axios.get(`http://localhost:5000/api/owners/profile/${ownerId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("ownerToken")}`
        }
      });
      
      if (response.data.success && response.data.owner.logoUrl) {
        setCurrentLogoUrl(response.data.owner.logoUrl);
      }
    } catch (err) {
      console.error("Error fetching current logo:", err);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError("Please select an image file (JPEG, PNG, GIF, etc.)");
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError("File size must be less than 5MB");
        return;
      }
      
      setLogo(file);
      setError("");
      setMessage("");
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    
    if (!logo) {
      setError("Please select a logo file first");
      return;
    }

    if (!ownerId) {
      setError("Owner ID not found. Please log in again.");
      return;
    }

    setIsUploading(true);
    setError("");
    setMessage("");

    const formData = new FormData();
    formData.append("logo", logo);
    formData.append("ownerId", ownerId);

    try {
      const res = await axios.post(
        `http://localhost:5000/api/logo/uploadLogo/${ownerId}`, 
        formData, 
        {
          headers: { 
            "Content-Type": "multipart/form-data",
            Authorization: `Bearer ${localStorage.getItem("ownerToken")}`
          }
        }
      );
      
      if (res.data.logoUrl) {
        setCurrentLogoUrl(res.data.logoUrl);
        // Update localStorage for dashboard display
        localStorage.setItem("ownerLogoUrl", res.data.logoUrl);
        setMessage("Logo uploaded successfully! 🎉");
        setLogo(null);
        // Reset file input
        const fileInput = document.getElementById('logo-file');
        if (fileInput) fileInput.value = '';
      } else {
        setError("Upload failed. Please try again.");
      }
    } catch (err) {
      console.error("Upload error:", err);
      if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError("Error uploading logo. Please try again.");
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!confirm("Are you sure you want to remove your logo?")) {
      return;
    }

    try {
      await axios.delete(`http://localhost:5000/api/logo/remove/${ownerId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("ownerToken")}`
        }
      });
      
      setCurrentLogoUrl("");
      // Remove from localStorage for dashboard display
      localStorage.removeItem("ownerLogoUrl");
      setMessage("Logo removed successfully");
    } catch (err) {
      console.error("Error removing logo:", err);
      setError("Failed to remove logo. Please try again.");
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Logo Management</h1>
        <p style={styles.subtitle}>
          Customize your WiFi hotspot branding with a professional logo
        </p>
      </div>

      <div style={styles.content}>
        {/* Current Logo Display */}
        <div style={styles.currentLogoSection}>
          <h3 style={styles.sectionTitle}>Current Logo</h3>
          {currentLogoUrl ? (
            <div style={styles.logoDisplay}>
              <img 
                src={currentLogoUrl} 
                alt={`${ownerName}'s Logo`} 
                style={styles.logoImage}
              />
              <div style={styles.logoActions}>
                <button 
                  onClick={handleRemoveLogo}
                  style={styles.removeButton}
                  title="Remove Logo"
                >
                  <FaTrash /> Remove Logo
                </button>
              </div>
            </div>
          ) : (
            <div style={styles.noLogo}>
              <FaImage style={styles.noLogoIcon} />
              <p>No logo uploaded yet</p>
              <p style={styles.noLogoSubtext}>
                Upload a logo to brand your WiFi hotspot
              </p>
            </div>
          )}
        </div>

        {/* Upload Section */}
        <div style={styles.uploadSection}>
          <h3 style={styles.sectionTitle}>
            {currentLogoUrl ? "Change Logo" : "Upload Logo"}
          </h3>
          
          <form onSubmit={handleUpload} style={styles.uploadForm}>
            <div style={styles.fileInputContainer}>
              <input
                id="logo-file"
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                style={styles.fileInput}
                required
              />
              <label htmlFor="logo-file" style={styles.fileLabel}>
                <FaUpload style={styles.uploadIcon} />
                <span>Choose Logo File</span>
                <small>JPEG, PNG, GIF up to 5MB</small>
              </label>
            </div>

            {logo && (
              <div style={styles.selectedFile}>
                <FaImage style={styles.fileIcon} />
                <span>{logo.name}</span>
                <small>{(logo.size / 1024 / 1024).toFixed(2)} MB</small>
              </div>
            )}

            <button 
              type="submit" 
              style={styles.uploadButton}
              disabled={!logo || isUploading}
            >
              {isUploading ? (
                "Uploading..."
              ) : currentLogoUrl ? (
                <>
                  <FaEdit /> Change Logo
                </>
              ) : (
                <>
                  <FaUpload /> Upload Logo
                </>
              )}
            </button>
          </form>
        </div>

        {/* Messages */}
        {message && <p style={styles.success}>{message}</p>}
        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: "800px",
    margin: "0 auto",
    padding: "20px",
  },
  header: {
    textAlign: "center",
    marginBottom: "40px",
  },
  title: {
    fontSize: "32px",
    fontWeight: "bold",
    color: "#1e293b",
    marginBottom: "10px",
  },
  subtitle: {
    fontSize: "16px",
    color: "#64748b",
    margin: 0,
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "30px",
  },
  currentLogoSection: {
    backgroundColor: "#fff",
    padding: "30px",
    borderRadius: "12px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
  },
  sectionTitle: {
    fontSize: "20px",
    fontWeight: "600",
    color: "#1e293b",
    marginBottom: "20px",
    borderBottom: "2px solid #e2e8f0",
    paddingBottom: "10px",
  },
  logoDisplay: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "20px",
  },
  logoImage: {
    width: "200px",
    height: "200px",
    objectFit: "contain",
    borderRadius: "12px",
    border: "3px solid #e2e8f0",
    backgroundColor: "#f8fafc",
  },
  logoActions: {
    display: "flex",
    gap: "10px",
  },
  removeButton: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 20px",
    backgroundColor: "#ef4444",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "500",
    transition: "background-color 0.2s",
  },
  noLogo: {
    textAlign: "center",
    padding: "40px",
    color: "#64748b",
  },
  noLogoIcon: {
    fontSize: "48px",
    marginBottom: "15px",
    color: "#cbd5e1",
  },
  noLogoSubtext: {
    fontSize: "14px",
    marginTop: "5px",
    color: "#94a3b8",
  },
  uploadSection: {
    backgroundColor: "#fff",
    padding: "30px",
    borderRadius: "12px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
  },
  uploadForm: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  fileInputContainer: {
    position: "relative",
  },
  fileInput: {
    position: "absolute",
    opacity: 0,
    width: "100%",
    height: "100%",
    cursor: "pointer",
  },
  fileLabel: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
    padding: "40px 20px",
    border: "2px dashed #cbd5e1",
    borderRadius: "12px",
    cursor: "pointer",
    transition: "all 0.2s",
    backgroundColor: "#f8fafc",
  },
  uploadIcon: {
    fontSize: "32px",
    color: "#64748b",
  },
  selectedFile: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "15px",
    backgroundColor: "#f1f5f9",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
  },
  fileIcon: {
    color: "#64748b",
  },
  uploadButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    padding: "15px 30px",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: "600",
    transition: "background-color 0.2s",
    alignSelf: "center",
  },
  success: {
    padding: "15px",
    backgroundColor: "#dcfce7",
    color: "#166534",
    borderRadius: "8px",
    textAlign: "center",
    fontWeight: "500",
  },
  error: {
    padding: "15px",
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    borderRadius: "8px",
    textAlign: "center",
    fontWeight: "500",
  },
};

export default UploadLogo;
