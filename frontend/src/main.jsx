import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";
import Login from "./Login";
import Packages from "./Packages";
import Receipt from "./Receipt";
import AdminLogin from "./AdminLogin";
import AdminDashboard from "./AdminDashboard";
import SuperDashboard from "./SuperDashboard";
import SuperAdminLogin from "./SuperAdminLogin";
import MyReceipts from "./MyReceipts";
import RegisterOwner from "./RegisterOwner";
import UploadLogo from "./pages/UploadLogo";
import Purchase from "./Purchase";
import UserDashboard from "./UserDashboard";
import HotspotsMap from "./pages/HotspotsMap";

import OwnerProfile from "../owner/OwnerProfile";
import OwnerPackages from "../owner/OwnerPackages";
import OwnerNotifications from "../owner/OwnerNotifications";
import OwnerAdmins from "../owner/OwnerAdmins";
import ErrorBoundary from "./components/ErrorBoundary";
import { setupGlobalExtensionErrorHandlers } from "./utils/extensionErrorHandler";

// Setup global error handlers for browser extension errors
setupGlobalExtensionErrorHandlers();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <ErrorBoundary fallback={<div style={{ padding: 24 }}>Something went wrong. Please reload the page.</div>}>
          <Routes>
            {/* Default: WiFi User login */}
            <Route path="/" element={<Login />} />
            
            {/* Explicit user route */}
            <Route path="/user/login" element={<Login />} />
            
            <Route path="/receipt" element={<Receipt />} />
            
            {/* WiFi owner (admin) routes */}
            <Route path="/adminlogin" element={<AdminLogin />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admindashboard" element={<AdminDashboard />} />
            
            {/* Super admin (app owner) */}
            <Route path="/superdashboard" element={<SuperDashboard />} />
            <Route path="/superadmin/login" element={<SuperAdminLogin />} />
            <Route path="/superadmin/dashboard" element={<SuperDashboard />} />
            
            <Route path="/packages" element={<Packages />} />
            <Route path="/purchase" element={<Purchase />} />
            <Route path="/myreceipts" element={<MyReceipts />} />
            <Route path="/dashboard" element={<UserDashboard />} />
            <Route path="/register-owner" element={<RegisterOwner />} />
            <Route path="/uploadlogo" element={<UploadLogo />} />
            <Route path="/hotspots" element={<HotspotsMap />} />

            <Route path="/owner/profile" element={<OwnerProfile />} />
            <Route path="/owner/packages" element={<OwnerPackages />} />
            <Route path="/owner/notifications" element={<OwnerNotifications />} />
            <Route path="/owner/admins" element={<OwnerAdmins />} />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
