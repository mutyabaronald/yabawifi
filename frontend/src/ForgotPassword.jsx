import React, { useEffect, useRef, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  sendPasswordResetEmail,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";

// TODO: Replace with your Firebase Web config from Firebase Console
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "XXXXXXX",
  appId: "1:XXXXXXX:web:XXXXXXX",
};

// Initialize Firebase once
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/; // min 8, letters+numbers

export default function ForgotPassword() {
  const [activeTab, setActiveTab] = useState("email"); // 'email' | 'phone'

  // Email flow
  const [email, setEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");

  // Phone flow
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpMessage, setOtpMessage] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [verifiedUid, setVerifiedUid] = useState(null);

  // New password (phone flow)
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordMessage, setNewPasswordMessage] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // reCAPTCHA
  const recaptchaRef = useRef(null);
  const recaptchaVerifierRef = useRef(null);

  const otpExpirySeconds = 180; // UI countdown only (3 minutes)
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (activeTab === "phone") {
      if (!recaptchaVerifierRef.current && recaptchaRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(
          recaptchaRef.current,
          {
            size: "normal",
            callback: () => {},
            "expired-callback": () => {},
          },
          auth
        );
      }
    }
  }, [activeTab]);

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

  // Send phone OTP
  const handleSendOtp = async () => {
    setOtpMessage("");
    setVerifiedUid(null);
    if (!phone || !phone.startsWith("+")) {
      setOtpMessage("Enter phone in E.164 format, e.g., +2567XXXXXXXX");
      return;
    }
    if (!recaptchaVerifierRef.current) {
      setOtpMessage("reCAPTCHA not ready. Reload and try again.");
      return;
    }
    try {
      setOtpSending(true);
      const confirmationResult = await signInWithPhoneNumber(
        auth,
        phone,
        recaptchaVerifierRef.current
      );
      window.confirmationResult = confirmationResult;
      setOtpSent(true);
      setCountdown(otpExpirySeconds);
      setOtpMessage("✅ OTP sent. Check your SMS.");
    } catch (err) {
      setOtpMessage(err?.message || "Failed to send OTP.");
    } finally {
      setOtpSending(false);
    }
  };

  // Verify OTP
  const handleVerifyOtp = async () => {
    setOtpMessage("");
    if (!otp || otp.length < 4) {
      setOtpMessage("Enter the 6-digit OTP.");
      return;
    }
    try {
      setOtpVerifying(true);
      const confirmationResult = window.confirmationResult;
      const result = await confirmationResult.confirm(otp);
      const uid = result?.user?.uid;
      if (!uid) throw new Error("Verification successful, but UID missing.");
      setVerifiedUid(uid);
      setOtpMessage("✅ Phone verified. Set your new password below.");
    } catch (err) {
      setOtpMessage(err?.message || "Invalid OTP. Try again.");
    } finally {
      setOtpVerifying(false);
    }
  };

  // Update password via backend
  const handleResetPasswordWithPhone = async () => {
    setNewPasswordMessage("");
    if (!verifiedUid) {
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
      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: verifiedUid, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNewPasswordMessage(data?.error || "Failed to reset password.");
        return;
      }
      setNewPasswordMessage("✅ Password updated. Please login again.");
    } catch (err) {
      setNewPasswordMessage("Network error. Please try again.");
    } finally {
      setUpdatingPassword(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-r from-blue-600 to-indigo-900 p-4">
      <div className="w-full max-w-md bg-white/95 shadow-xl rounded-2xl border border-slate-200 p-6">
        <h1 className="text-xl font-bold text-slate-800 mb-4 text-center">
          Forgot Password
        </h1>

        <div className="flex gap-2 bg-slate-100 p-1 rounded-lg mb-4">
          <button
            onClick={() => setActiveTab("email")}
            className={`flex-1 py-2 rounded-md text-sm font-semibold ${
              activeTab === "email"
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-700 border border-slate-200"
            }`}
          >
            Email
          </button>
          <button
            onClick={() => setActiveTab("phone")}
            className={`flex-1 py-2 rounded-md text-sm font-semibold ${
              activeTab === "phone"
                ? "bg-blue-600 text-white"
                : "bg-white text-slate-700 border border-slate-200"
            }`}
          >
            Phone
          </button>
        </div>

        {activeTab === "email" && (
          <div className="space-y-3">
            <label className="text-xs text-slate-500">Enter your email</label>
            <input
              type="email"
              placeholder="you@example.com"
              className="w-full border border-slate-300 rounded-md px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <button
              onClick={handleSendEmailLink}
              disabled={emailSending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md py-2 transition"
            >
              {emailSending ? "Sending..." : "Send Reset Link"}
            </button>
            {emailMessage && (
              <div className="text-xs text-slate-700">{emailMessage}</div>
            )}
          </div>
        )}

        {activeTab === "phone" && (
          <div className="space-y-3">
            <div id="recaptcha-container" ref={recaptchaRef} className="flex justify-center" />

            {!otpSent && (
              <>
                <label className="text-xs text-slate-500">
                  Enter your phone (E.164 format, e.g., +2567XXXXXXXX)
                </label>
                <input
                  type="tel"
                  placeholder="+2567XXXXXXXX"
                  className="w-full border border-slate-300 rounded-md px-3 py-2"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
                <button
                  onClick={handleSendOtp}
                  disabled={otpSending}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md py-2 transition"
                >
                  {otpSending ? "Sending OTP..." : "Send OTP"}
                </button>
                {otpMessage && (
                  <div className="text-xs text-slate-700">{otpMessage}</div>
                )}
              </>
            )}

            {otpSent && !verifiedUid && (
              <>
                <div className="text-xs text-slate-500">
                  Enter the 6-digit OTP sent to your phone.
                  {countdown > 0 && (
                    <span className="ml-1 text-slate-400">(expires in {countdown}s)</span>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="123456"
                  className="w-full border border-slate-300 rounded-md px-3 py-2"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  maxLength={6}
                />
                <button
                  onClick={handleVerifyOtp}
                  disabled={otpVerifying}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md py-2 transition"
                >
                  {otpVerifying ? "Verifying..." : "Verify OTP"}
                </button>
                {otpMessage && (
                  <div className="text-xs text-slate-700">{otpMessage}</div>
                )}
              </>
            )}

            {verifiedUid && (
              <>
                <label className="text-xs text-slate-500">Enter new password</label>
                <input
                  type="password"
                  placeholder="New password (min 8, letters & numbers)"
                  className="w-full border border-slate-300 rounded-md px-3 py-2"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  onClick={handleResetPasswordWithPhone}
                  disabled={updatingPassword}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md py-2 transition"
                >
                  {updatingPassword ? "Updating..." : "Update Password"}
                </button>
                {newPasswordMessage && (
                  <div className="text-xs text-slate-700">{newPasswordMessage}</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


