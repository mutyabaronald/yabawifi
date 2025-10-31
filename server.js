const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

// Initialize Firebase Admin
// Recommended: set GOOGLE_APPLICATION_CREDENTIALS env var to your service account JSON path
// Windows (PowerShell): $env:GOOGLE_APPLICATION_CREDENTIALS="C:\\path\\to\\serviceAccount.json"
// macOS/Linux: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

function isStrongPassword(pw) {
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/.test(pw);
}

// POST /api/reset-password { uid, newPassword }
app.post("/api/reset-password", async (req, res) => {
  try {
    const { uid, newPassword } = req.body;
    if (!uid || !newPassword) {
      return res.status(400).json({ error: "uid and newPassword are required" });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error:
          "Weak password. Minimum 8 characters with letters and numbers required.",
      });
    }

    await admin.auth().updateUser(uid, { password: newPassword });
    // Optionally revoke refresh tokens
    // await admin.auth().revokeRefreshTokens(uid);
    return res.json({ success: true, message: "Password updated." });
  } catch (err) {
    console.error("Reset password error:", err?.message);
    return res.status(500).json({ error: "Server error updating password." });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log("Server running on port", PORT));


