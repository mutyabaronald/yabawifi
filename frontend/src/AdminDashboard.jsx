import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
// Removed direct Firestore imports - now using backend APIs
import {
  FaPlus,
  FaChartBar,
  FaLock,
  FaSignOutAlt,
  FaWifi,
  FaBars,
  FaTimes,
  FaDollarSign,
  FaUsers,
  FaDatabase,
  FaChartLine,
  FaBox,
  FaCreditCard,
  FaBell,
  FaCog,
  FaDownload,
  FaEye,
  FaMapPin,
  FaPalette,
  FaUpload,
  FaSave,
  FaPaperPlane,
  FaCheck,
  FaImage,
  FaFont,
  FaComment,
  FaChevronDown,
} from "react-icons/fa";
import UploadLogo from "./pages/UploadLogo";
import OwnerStats from "./pages/OwnerStats";
import VoucherManager from "./components/VoucherManager";
import OwnerProfile from "../owner/OwnerProfile";

import OwnerPackages from "../owner/OwnerPackages";
import HotspotSetup from "../owner/HotspotSetup";

import OwnerNotifications from "../owner/OwnerNotifications";
import OwnerAdmins from "../owner/OwnerAdmins";
import OwnerSupportSettings from "../owner/OwnerSupportSettings";
import CommunicationCenter from "./components/CommunicationCenter";
import axios from "axios";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });
import AdminChangePassword from "./AdminChangePassword";
import LoyaltyManagement from "./components/LoyaltyManagement";
import AdminReviewsDashboard from "./components/AdminReviewsDashboard";
import OwnerReferrals from "./owner/OwnerReferrals";
import { useTheme } from "./contexts/ThemeContext";
import ThemeToggle from "./components/ThemeToggle";
import { formatUGX } from "./components/currency";

function OwnerHotspotsMap({ ownerId }) {
  const [map, setMap] = useState(null);
  const [hotspots, setHotspots] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      const m = L.map("owner-hotspots-map").setView([0.3476, 32.5825], 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(m);
      setMap(m);
      return () => {
        if (m) m.remove();
      };
    } catch (err) {
      console.error("Map initialization error:", err);
      setError("Failed to initialize map");
    }
  }, []);

  useEffect(() => {
    if (!map || !ownerId) return;

    (async () => {
      try {
        const res = await axios.get(
          `http://localhost:5000/api/hotspots/owner/${ownerId}`
        );
        const hs = res.data.hotspots || [];
        setHotspots(hs);

        // Clear existing markers
        map.eachLayer((layer) => {
          if (layer instanceof L.Marker) {
            map.removeLayer(layer);
          }
        });

        // Add new markers
        hs.forEach((h) => {
          if (
            h.location &&
            typeof h.location.lat === "number" &&
            typeof h.location.lng === "number"
          ) {
            L.marker([h.location.lat, h.location.lng], {
              title: h.name || h.hotspotName,
            })
              .addTo(map)
              .bindPopup(`<b>${h.name || h.hotspotName}</b>`);
          }
        });

        // Fit map to markers if there are any
        if (hs.length > 0 && hs.some((h) => h.location)) {
          const markers = hs
            .filter((h) => h.location)
            .map((h) => [h.location.lat, h.location.lng]);
          map.fitBounds(markers);
        }
      } catch (err) {
        console.error("Error loading hotspots:", err);
        setError("Failed to load hotspots");
      }
    })();
  }, [map, ownerId]);

  if (error) {
    return (
      <div
        style={{
          height: 420,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f9fafb",
          border: "1px solid #e5e7eb",
          color: "var(--text-muted)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "24px", marginBottom: "8px" }}>🗺️</div>
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div id="owner-hotspots-map" style={{ height: 420, borderRadius: 12 }} />
  );
}

function AdminDashboard() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSection, setActiveSection] = useState("dashboard");
  const { theme, toggleTheme, isDark } = useTheme();
  const [showModal, setShowModal] = useState(false);
  const [packages, setPackages] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [ownerId, setOwnerId] = useState("");

  // Hotspot selection state
  const [selectedHotspotId, setSelectedHotspotId] = useState("all");
  const [selectedHotspot, setSelectedHotspot] = useState(null);

  // Enhanced dashboard stats
  const [dashboardStats, setDashboardStats] = useState({
    totalRevenue: 0.0,
    totalCustomers: 0,
    activeUsers: 0,
    dataUsed: 0.0,
    currentBalance: 0.0,
  });

  // Payments state
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletTx, setWalletTx] = useState([]);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [mobileMoneyNumber, setMobileMoneyNumber] = useState("");
  const [walletMsg, setWalletMsg] = useState("");

  // Devices state
  const [devices, setDevices] = useState([]);
  const [deviceStats, setDeviceStats] = useState({
    totalDevices: 0,
    onlineDevices: 0,
    deviceTypes: {},
    hotspotDevices: {},
  });
  const [deviceChartData, setDeviceChartData] = useState({
    labels: [],
    datasets: [{ label: "Online Devices", data: [] }],
  });
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);

  // Branding state
  const [brandingTab, setBrandingTab] = useState("logo");
  const [selectedBrandingHotspot, setSelectedBrandingHotspot] = useState("all");
  const [showBrandingPreview, setShowBrandingPreview] = useState(false);
  const [brandingData, setBrandingData] = useState({
    logo: null,
    favicon: null,
    primaryColor: "#3b82f6",
    secondaryColor: "#f3f4f6",
    textColor: "#1f2937",
    fontFamily: "Inter",
    welcomeText: "Welcome to our WiFi",
    footerText: "Powered by YABA WiFi",
    backgroundType: "solid",
    backgroundColor: "#ffffff",
    backgroundImage: null,
  });
  const [uploadedFiles, setUploadedFiles] = useState({
    logo: null,
    favicon: null,
  });

  // Voucher statistics state for real-time updates
  const [voucherStats, setVoucherStats] = useState({
    activeVouchers: 0,
    totalRedemptions: 0,
    expired: 0,
    usageRate: 0,
  });
  const [voucherUnsubscribe, setVoucherUnsubscribe] = useState(null);

  const monthlyAgg = (tx) => {
    const map = {};
    tx.forEach((t) => {
      const d = new Date(t.date || t.createdAt || Date.now());
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        "0"
      )}`;
      if (!map[key]) map[key] = { credit: 0, withdrawal: 0 };
      const amt = Number(t.amount || 0);
      if (t.type === "withdrawal") map[key].withdrawal += amt;
      else map[key].credit += amt;
    });
    return map;
  };

  // Hotspots & Devices consolidated management (moved up to be available for search index)
  const [devicesView, setDevicesView] = useState({
    hotspots: [],
    selectedHotspotId: "",
    devices: [],
    loading: false,
    error: "",
  });

  // Notifications state
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [notifFilter, setNotifFilter] = useState("all"); // all | email | sms | push | maintenance | payment | review

  const deriveCategory = (n) => {
    const t = (n.type || n.category || "").toLowerCase();
    if (t.includes("payment") || t.includes("wallet") || t.includes("receipt"))
      return "payment";
    if (t.includes("review")) return "review";
    if (t.includes("maint") || t.includes("device") || t.includes("router"))
      return "maintenance";
    return "general";
  };
  const deriveChannel = (n) => {
    const c = (n.channel || "").toLowerCase();
    if (c === "email") return "email";
    if (c === "sms") return "sms";
    if (c === "push") return "push";
    // infer by hints
    const m = String(n.message || "").toLowerCase();
    if (m.includes("sms")) return "sms";
    if (m.includes("email")) return "email";
    if (m.includes("push")) return "push";
    return "inapp";
  };

  useEffect(() => {
    if (!ownerId) return;
    axios
      .get(`http://localhost:5000/api/notifications/admin/${ownerId}?limit=50`)
      .then((res) => {
        const list = (res.data && res.data.notifications) || [];
        setNotifications(list);
      })
      .catch((error) => {
        console.error("Error fetching notifications:", error);
        setNotifications([]);
      });
    axios
      .get(
        `http://localhost:5000/api/notifications/counts/${ownerId}?type=admin`
      )
      .then((res) => {
        setUnreadCount((res.data && res.data.unreadCount) || 0);
      })
      .catch((error) => {
        console.error("Error fetching notification counts:", error);
        setUnreadCount(0);
      });
  }, [ownerId]);

  const filteredNotifications = notifications.filter((n) => {
    if (notifFilter === "all") return true;
    if (["email", "sms", "push"].includes(notifFilter))
      return deriveChannel(n) === notifFilter;
    if (["maintenance", "payment", "review"].includes(notifFilter))
      return deriveCategory(n) === notifFilter;
    return true;
  });

  // Quick search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const buildSearchIndex = () => {
    const items = [];
    // hotspots
    (devicesView.hotspots || []).forEach((h) =>
      items.push({
        kind: "Hotspot",
        label: h.name || h.id,
        id: h.id,
        section: "hotspots",
      })
    );
    // devices
    (devicesView.devices || []).forEach((d) =>
      items.push({
        kind: "Device",
        label: d.deviceName || d.deviceId,
        id: d.deviceId,
        section: "devices",
      })
    );
    // packages
    (packages || []).forEach((p) =>
      items.push({
        kind: "Package",
        label: p.packageName || p.name,
        id: p.id,
        section: "packages",
      })
    );
    // transactions (recent)
    (walletTx || [])
      .slice(0, 50)
      .forEach((t, i) =>
        items.push({
          kind: "Transaction",
          label: `${t.type || "payment"} ${formatUGX(t.amount)}`,
          id: String(i),
          section: "payments",
        })
      );
    return items;
  };
  const searchIndex = buildSearchIndex();
  const searchResults = searchIndex
    .filter((it) =>
      (it.label || "").toLowerCase().includes(searchQuery.toLowerCase())
    )
    .slice(0, 8);
  const goToSearchItem = (it) => {
    setActiveSection(it.section);
    setSearchOpen(false);
    setSearchQuery("");
  };

  // Hotspots & Devices consolidated management
  // (already declared above for search index)
  // Add Hotspot modal state
  const [showAddHotspotModal, setShowAddHotspotModal] = useState(false);
  const [addHsStep, setAddHsStep] = useState(1);
  const [hsName, setHsName] = useState("");
  const [hsRouterType, setHsRouterType] = useState("Mikrotik");
  const [hsHotspotType, setHsHotspotType] = useState("Supported Router");
  const [hsLat, setHsLat] = useState(0);
  const [hsLng, setHsLng] = useState(0);
  const [hsMac, setHsMac] = useState("");
  const [hsRouterId, setHsRouterId] = useState("");
  const [hsCreating, setHsCreating] = useState(false);
  const [hsError, setHsError] = useState("");
  const [createdHotspotId, setCreatedHotspotId] = useState("");
  const [hsApiKey, setHsApiKey] = useState("");
  const [hsIntegrationLink, setHsIntegrationLink] = useState("");
  // Link Device modal state
  const [showLinkDeviceModal, setShowLinkDeviceModal] = useState(false);
  const [linkStep, setLinkStep] = useState(1);
  const [linkType, setLinkType] = useState("Mikrotik");
  const [linkMac, setLinkMac] = useState("");
  const [linkRouterId, setLinkRouterId] = useState("");
  const [linkNickname, setLinkNickname] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");
  // Leaflet map refs for Add Hotspot modal
  const addHsMapRef = useRef(null);
  const addHsMapInstanceRef = useRef(null);
  const addHsMarkerRef = useRef(null);

  // Device Onboarding Module State
  const [showDeviceWizard, setShowDeviceWizard] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [deviceMessage, setDeviceMessage] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [currentStep, setCurrentStep] = useState(1);
  const [showDeviceLogsModal, setShowDeviceLogsModal] = useState(false);
  const [logsDevice, setLogsDevice] = useState(null);
  const [routerLogs, setRouterLogs] = useState([]);
  const [routerLogsLoading, setRouterLogsLoading] = useState(false);
  const [routerLogsError, setRouterLogsError] = useState("");

  // Review Management State
  const [reviews, setReviews] = useState([]);
  const [reviewStats, setReviewStats] = useState({
    averageRating: 0,
    totalReviews: 0,
    published: 0,
    responded: 0,
    pending: 0,
    totalHelpful: 0,
    ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  });
  const [reviewFilter, setReviewFilter] = useState("all");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewFilters, setReviewFilters] = useState({
    rating: "all",
    status: "all",
    search: "",
  });
  const [reviewPagination, setReviewPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    hasMore: false,
  });
  const [replyingToReview, setReplyingToReview] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [formData, setFormData] = useState({
    deviceName: "",
    routerIdentity: "", // Router identity/name (like "WeaveCo" in video)
    deviceType: "mikrotik",
    serviceType: ["hotspot"], // Support multiple services (hotspot and/or pppoe)
    antiSharing: false, // Anti-sharing protection for hotspot
    interfaces: [],
    location: null,
  });
  const [provisioningScript, setProvisioningScript] = useState("");
  const [deviceId, setDeviceId] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("pending");
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [packageForm, setPackageForm] = useState({
    name: "",
    price: "",
    durationType: "daily",
    customHours: "",
  });

  // Enhanced tabs for modern interface
  const [activeTab, setActiveTab] = useState("overview");
  const tabs = [
    { id: "overview", label: "Overview", icon: FaChartLine },
    { id: "devices", label: "Devices", icon: FaWifi },
    { id: "packages", label: "Packages", icon: FaBox },
    { id: "financials", label: "Financials", icon: FaDollarSign },
    { id: "loyalty", label: "Loyalty Program", icon: FaChartBar },
  ];

  const renderSidebarButton = (id, label, icon) => (
    <button
      key={id}
      onClick={() => setActiveSection(id)}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        background: activeSection === id ? "#eef2ff" : "#fff",
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );

  useEffect(() => {
    const init = async () => {
      // Check for new owner authentication system
      const ownerId = localStorage.getItem("ownerId");
      const ownerToken = localStorage.getItem("ownerToken");
      const ownerName = localStorage.getItem("ownerName");

      console.log("AdminDashboard init - checking auth:");
      console.log("ownerId:", ownerId);
      console.log("ownerToken:", ownerToken);
      console.log("ownerName:", ownerName);

      if (!ownerId || !ownerToken || !ownerName) {
        console.log("Missing auth data, redirecting to login");
        navigate("/adminlogin");
        return;
      }

      try {
        console.log("Auth data found, setting ownerId:", ownerId);
        // Set ownerId directly from localStorage
        setOwnerId(ownerId);
        fetchPackages(ownerId);
        fetchHotspots(ownerId);
        fetchDevicesForOwner();
        fetchHotspotsForOwner();
        const unsubscribe = setupVoucherRealTimeListener(ownerId);
        setVoucherUnsubscribe(() => unsubscribe);
      } catch (err) {
        console.error("Owner initialization failed:", err);
        navigate("/adminlogin");
      }
    };
    init();
  }, [navigate]);

  // Cleanup effect for voucher listener
  useEffect(() => {
    return () => {
      if (voucherUnsubscribe) {
        voucherUnsubscribe();
      }
    };
  }, [voucherUnsubscribe]);
  const fetchHotspots = async (oid) => {
    try {
      const res = await axios.get(
        `http://localhost:5000/api/hotspots/owner/${oid}`
      );
      const hotspots = res.data.hotspots || [];
      setDevicesView((s) => ({
        ...s,
        hotspots,
        selectedHotspotId: hotspots[0]?.id || "",
      }));
      setSelectedHotspot(hotspots[0] || null);
      if (hotspots[0]?.id) await fetchDevices(hotspots[0].id);
    } catch (e) {
      setDevicesView((s) => ({
        ...s,
        hotspots: [],
        error: "Failed to load hotspots",
      }));
      setSelectedHotspot(null);
    }
  };

  const fetchHotspotsForOwner = async () => {
    try {
      const response = await axios.get(
        `http://localhost:5000/api/hotspots/owner/${ownerId}`
      );
      setHotspots(response.data?.hotspots || response.data || []);
    } catch (error) {
      console.error("Error fetching hotspots:", error);
      setHotspots([]);
    }
  };

  // Real-time voucher statistics listener using API polling
  const setupVoucherRealTimeListener = (ownerId) => {
    if (!ownerId) {
      console.log("No ownerId provided for voucher listener");
      return;
    }

    console.log(
      "Setting up API-based voucher statistics polling for ownerId:",
      ownerId
    );

    // Use API polling instead of Firebase due to permission issues
    const pollInterval = setInterval(async () => {
      try {
        console.log("Polling for voucher statistics...");
        const response = await fetch(
          `http://localhost:5000/api/vouchers/owner/${ownerId}`
        );
        const data = await response.json();

        if (data.success && data.vouchers) {
          const vouchers = data.vouchers;
          const stats = {
            activeVouchers: vouchers.filter((v) => v.status === "active")
              .length,
            totalRedemptions: vouchers.reduce(
              (sum, v) => sum + (v.usageCount || 0),
              0
            ),
            expired: vouchers.filter((v) => v.status === "expired").length,
            usageRate:
              vouchers.length > 0
                ? Math.round(
                    (vouchers.filter((v) => v.status === "redeemed").length /
                      vouchers.length) *
                      100
                  )
                : 0,
          };

          console.log("Voucher statistics updated via API polling:", stats);
          setVoucherStats(stats);
        }
      } catch (error) {
        console.error("Error polling voucher statistics:", error);
      }
    }, 5000); // Poll every 5 seconds

    console.log("API-based voucher statistics polling set up successfully");
    return () => {
      clearInterval(pollInterval);
      console.log("Voucher statistics polling stopped");
    };
  };

  // Fallback function to fetch voucher stats via API
  const fetchVoucherStatsViaAPI = async (ownerId) => {
    try {
      console.log("Fetching voucher stats via API for ownerId:", ownerId);
      const response = await fetch(
        `http://localhost:5000/api/vouchers/owner/${ownerId}`
      );
      const data = await response.json();

      if (data.success && data.vouchers) {
        const vouchers = data.vouchers;
        const stats = {
          activeVouchers: vouchers.filter((v) => v.status === "active").length,
          totalRedemptions: vouchers.reduce(
            (sum, v) => sum + (v.usageCount || 0),
            0
          ),
          expired: vouchers.filter((v) => v.status === "expired").length,
          usageRate:
            vouchers.length > 0
              ? Math.round(
                  (vouchers.filter((v) => v.status === "redeemed").length /
                    vouchers.length) *
                    100
                )
              : 0,
        };

        console.log("API voucher stats:", stats);
        setVoucherStats(stats);
      }
    } catch (error) {
      console.error("Error fetching voucher stats via API:", error);
      // Set default stats if both Firebase and API fail
      setVoucherStats({
        activeVouchers: 0,
        totalRedemptions: 0,
        expired: 0,
        usageRate: 0,
      });
    }
  };

  const fetchDevices = async (hotspotId) => {
    setDevicesView((s) => ({ ...s, loading: true, error: "" }));
    try {
      const res = await axios.get(
        `http://localhost:5000/api/hotspots/${hotspotId}/devices`
      );
      setDevicesView((s) => ({
        ...s,
        selectedHotspotId: hotspotId,
        devices: res.data.devices || [],
        loading: false,
      }));
      const found = ((s) => (s.hotspots || []).find((h) => h.id === hotspotId))(
        devicesView
      );
      setSelectedHotspot(found || null);
    } catch (e) {
      setDevicesView((s) => ({
        ...s,
        devices: [],
        loading: false,
        error: "Failed to load devices",
      }));
    }
  };

  const removeDevice = async (deviceId) => {
    if (!window.confirm("Remove this device?")) return;
    try {
      await axios.delete(
        `/api/hotspots/${devicesView.selectedHotspotId}/devices/${deviceId}`
      );
      fetchDevices(devicesView.selectedHotspotId);
    } catch (e) {
      alert("Failed to remove device");
    }
  };

  const canNextFromHsStep1 = () =>
    Boolean(
      hsName &&
        hsRouterType &&
        hsHotspotType &&
        !Number.isNaN(Number(hsLat)) &&
        !Number.isNaN(Number(hsLng))
    );
  const createHotspot = async () => {
    if (hsCreating) return;
    setHsError("");
    setHsCreating(true);
    try {
      const res = await axios.post("/api/hotspots/add", {
        ownerId,
        hotspotName: hsName,
        routerType: hsRouterType,
        hotspotType: hsHotspotType,
        location: { latitude: Number(hsLat), longitude: Number(hsLng) },
        macAddress: hsMac,
        routerId: hsRouterId,
      });
      if (!res.data?.success)
        throw new Error(res.data?.message || "Create failed");
      setCreatedHotspotId(res.data.hotspotId);
      setHsApiKey(res.data.apiKey);
      setHsIntegrationLink(res.data.integrationLink);
      setAddHsStep(3);
      await fetchHotspots(ownerId);
      await fetchDevices(res.data.hotspotId);
    } catch (e) {
      setHsError(e?.message || "Failed to create hotspot");
    } finally {
      setHsCreating(false);
    }
  };

  const submitLinkDevice = async () => {
    if (linking) return;
    setLinking(true);
    setLinkError("");
    try {
      await axios.post(
        `/api/hotspots/${devicesView.selectedHotspotId}/devices`,
        {
          type: linkType,
          macAddress: linkMac,
          routerId: linkRouterId,
          nickname: linkNickname,
        }
      );
      setShowLinkDeviceModal(false);
      fetchDevices(devicesView.selectedHotspotId);
      setLinkMac("");
      setLinkRouterId("");
      setLinkNickname("");
    } catch (e) {
      setLinkError(e.response?.data?.error || "Failed to link device");
    } finally {
      setLinking(false);
    }
  };

  // Device Onboarding Module Functions
  const fetchDevicesForOwner = async () => {
    try {
      const response = await axios.get(
        `http://localhost:5000/api/devices/owner/${ownerId}`
      );
      if (response.data.success) {
        setDevices(response.data.devices);
      }
    } catch (err) {
      console.error("Error fetching devices:", err);
      setDeviceError("Failed to load devices");
    }
  };

  const handleDeleteDevice = async (deviceId) => {
    if (!confirm("Are you sure you want to unlink this device?")) {
      return;
    }

    try {
      await axios.delete(`http://localhost:5000/api/devices/${deviceId}`);
      setDeviceMessage("Device unlinked successfully");
      fetchDevicesForOwner();
    } catch (err) {
      console.error("Error unlinking device:", err);
      setDeviceError("Failed to unlink device");
    }
  };

  const fetchRouterLogs = async (device, opts = {}) => {
    if (!device?.deviceId) return;
    const silent = !!opts.silent;
    try {
      if (!silent) {
        setRouterLogsLoading(true);
        setRouterLogsError("");
      }
      const res = await axios.get(
        `http://localhost:5000/api/devices/${device.deviceId}/logs?limit=200`
      );
      if (res.data?.success) {
        setRouterLogs(res.data.logs || []);
      } else {
        setRouterLogs([]);
        setRouterLogsError(res.data?.message || "Failed to load router logs");
      }
    } catch (err) {
      setRouterLogs([]);
      setRouterLogsError(
        err?.response?.data?.message ||
          err?.message ||
          "Failed to load router logs"
      );
    } finally {
      if (!silent) setRouterLogsLoading(false);
    }
  };

  const openRouterLogs = async (device) => {
    setLogsDevice(device || null);
    setRouterLogs([]);
    setRouterLogsError("");
    setShowDeviceLogsModal(true);
    await fetchRouterLogs(device);
  };

  const closeRouterLogs = () => {
    setShowDeviceLogsModal(false);
    setLogsDevice(null);
    setRouterLogs([]);
    setRouterLogsError("");
    setRouterLogsLoading(false);
  };

  const handleEditDevice = (device) => {
    setSelectedDevice(device);
    setFormData({
      deviceName: device.deviceName || "",
      routerIdentity: device.routerIdentity || "",
      deviceType: device.deviceType || "mikrotik",
      serviceType: Array.isArray(device.serviceType)
        ? device.serviceType
        : device.serviceType
        ? [device.serviceType]
        : ["hotspot"],
      antiSharing: device.antiSharing || false,
      interfaces: device.interfaces || [],
      location: device.location || null,
    });
    setDeviceId(device.deviceId);
    setShowDeviceWizard(true);
  };

  const handleWizardClose = () => {
    setShowDeviceWizard(false);
    setSelectedDevice(null);
    setFormData({
      deviceName: "",
      routerIdentity: "",
      deviceType: "mikrotik",
      serviceType: ["hotspot"],
      antiSharing: false,
      interfaces: [],
      location: null,
    });
    setCurrentStep(1);
    setProvisioningScript("");
    setDeviceId(null);
    setConnectionStatus("pending");
    fetchDevicesForOwner();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "online":
        return "var(--success)";
      case "offline":
        return "var(--danger)";
      case "pending":
        return "var(--warning)";
      default:
        return "var(--text-muted)";
    }
  };

  // Review Management Functions
  const fetchReviews = async (resetPagination = false) => {
    if (!ownerId) return;

    setReviewLoading(true);
    try {
      const params = new URLSearchParams({
        limit: reviewPagination.limit.toString(),
        offset: resetPagination
          ? "0"
          : ((reviewPagination.page - 1) * reviewPagination.limit).toString(),
      });

      // Add filters
      if (reviewFilters.rating !== "all") {
        params.append("rating", reviewFilters.rating);
      }
      if (reviewFilters.status !== "all") {
        params.append("status", reviewFilters.status);
      }

      // Fetch both reviews and statistics
      const [reviewsResponse, statsResponse] = await Promise.all([
        axios.get(
          `http://localhost:5000/api/reviews/owner/${ownerId}?${params}`
        ),
        axios.get(`http://localhost:5000/api/reviews/owner/${ownerId}/stats`),
      ]);

      if (reviewsResponse.data.success) {
        const reviewsData = reviewsResponse.data.reviews || [];
        if (resetPagination) {
          setReviews(reviewsData);
          setReviewPagination((prev) => ({
            ...prev,
            page: 1,
            total: reviewsResponse.data.totalCount || 0,
            hasMore: reviewsResponse.data.hasMore || false,
          }));
        } else {
          setReviews((prev) => [...prev, ...reviewsData]);
          setReviewPagination((prev) => ({
            ...prev,
            total: reviewsResponse.data.totalCount || 0,
            hasMore: reviewsResponse.data.hasMore || false,
          }));
        }
      }

      if (statsResponse.data.success) {
        const stats = statsResponse.data.stats;
        setReviewStats({
          averageRating: stats.averageRating || 0,
          totalReviews: stats.totalReviews || 0,
          published: stats.published || 0,
          responded: stats.responded || 0,
          pending: stats.pending || 0,
          totalHelpful: stats.totalHelpful || 0,
          ratingDistribution: stats.ratingDistribution || {
            5: 0,
            4: 0,
            3: 0,
            2: 0,
            1: 0,
          },
        });
      }
    } catch (error) {
      console.error("Error fetching reviews:", error);
    } finally {
      setReviewLoading(false);
    }
  };

  const calculateReviewStats = (reviewsData) => {
    const totalReviews = reviewsData.length;
    // Handle both 'published' and 'approved' status values
    const published = reviewsData.filter(
      (r) => r.status === "published" || r.status === "approved"
    ).length;
    const responded = reviewsData.filter((r) => r.ownerResponse).length;
    const pending = reviewsData.filter((r) => r.status === "pending").length;

    const totalHelpful = reviewsData.reduce(
      (sum, r) => sum + (r.helpfulCount || 0),
      0
    );

    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let totalRating = 0;

    reviewsData.forEach((review) => {
      const rating = review.rating || 0;
      if (rating >= 1 && rating <= 5) {
        ratingDistribution[rating]++;
        totalRating += rating;
      }
    });

    const averageRating =
      totalReviews > 0 ? (totalRating / totalReviews).toFixed(1) : 0;

    setReviewStats({
      averageRating: parseFloat(averageRating),
      totalReviews,
      published,
      responded,
      pending,
      totalHelpful,
      ratingDistribution,
    });
  };

  const handleReviewAction = async (reviewId, action, data = {}) => {
    try {
      const response = await axios.post(
        `http://localhost:5000/api/reviews/${reviewId}/${action}`,
        data
      );
      if (response.data.success) {
        fetchReviews(true); // Refresh reviews with reset pagination
      }
    } catch (error) {
      console.error(`Error ${action} review:`, error);
    }
  };

  const handleReplyToReview = async (reviewId) => {
    if (!replyText.trim()) return;

    try {
      const response = await axios.post(
        `http://localhost:5000/api/reviews/reviews/${reviewId}/reply`,
        {
          ownerId,
          reply: replyText.trim(),
        }
      );

      if (response.data.success) {
        setReplyingToReview(null);
        setReplyText("");
        fetchReviews(true); // Refresh reviews
      }
    } catch (error) {
      console.error("Error replying to review:", error);
    }
  };

  const handleFilterChange = (filterType, value) => {
    setReviewFilters((prev) => ({
      ...prev,
      [filterType]: value,
    }));
    setReviewPagination((prev) => ({
      ...prev,
      page: 1,
    }));
  };

  const loadMoreReviews = () => {
    if (reviewPagination.hasMore && !reviewLoading) {
      setReviewPagination((prev) => ({
        ...prev,
        page: prev.page + 1,
      }));
      fetchReviews(false);
    }
  };

  // Fetch reviews when ownerId changes
  useEffect(() => {
    if (ownerId) {
      fetchReviews(true);
    }
  }, [ownerId]);

  // Fetch reviews when filters change
  useEffect(() => {
    if (ownerId) {
      fetchReviews(true);
    }
  }, [reviewFilters]);

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  };

  const formatPrice = (amount) => {
    return new Intl.NumberFormat("en-UG", {
      style: "currency",
      currency: "UGX",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusText = (status) => {
    switch (status) {
      case "online":
        return "Online";
      case "offline":
        return "Offline";
      case "pending":
        return "Pending";
      default:
        return "Unknown";
    }
  };

  const getServiceTypeIcon = (serviceType) => {
    switch (serviceType) {
      case "hotspot":
        return "📶";
      case "pppoe":
        return "🔌";
      default:
        return "📶";
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleInterfaceChange = (e) => {
    const { value, checked } = e.target;
    if (checked) {
      setFormData((prev) => ({
        ...prev,
        interfaces: [...prev.interfaces, value],
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        interfaces: prev.interfaces.filter((iface) => iface !== value),
      }));
    }
  };

  const handleNext = async () => {
    if (currentStep === 1) {
      if (
        !formData.deviceName ||
        formData.interfaces.length === 0 ||
        formData.serviceType.length === 0
      ) {
        setDeviceError(
          "Please fill in all required fields and select at least one service type"
        );
        return;
      }

      // Warn if port 1 (ether1) is selected (WAN port)
      if (formData.interfaces.includes("ether1")) {
        if (
          !confirm(
            "⚠️ Warning: Port 1 (ether1) is typically the WAN port receiving internet. Are you sure you want to include it? The video tutorial recommends excluding port 1."
          )
        ) {
          return;
        }
      }

      try {
        setDeviceLoading(true);
        setDeviceError("");

        if (selectedDevice) {
          await axios.put(
            `http://localhost:5000/api/devices/${deviceId}`,
            formData
          );
        } else {
          const response = await axios.post(
            "http://localhost:5000/api/devices",
            {
              ...formData,
              ownerId,
            }
          );

          if (response.data.success) {
            setDeviceId(response.data.device.deviceId);
          }
        }

        const scriptResponse = await axios.get(
          `http://localhost:5000/api/provisioning/script?deviceId=${
            deviceId || response.data.device.deviceId
          }`
        );
        setProvisioningScript(scriptResponse.data);

        setCurrentStep(2);
      } catch (err) {
        console.error("Error creating/updating device:", err);
        setDeviceError("Failed to create device. Please try again.");
      } finally {
        setDeviceLoading(false);
      }
    } else if (currentStep === 2) {
      setCurrentStep(3);
      startStatusPolling();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const startStatusPolling = () => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await axios.get(
          `http://localhost:5000/api/devices/status/${deviceId}`
        );
        if (response.data.success) {
          const status = response.data.status;
          setConnectionStatus(status);

          if (status === "online") {
            clearInterval(pollInterval);
          }
        }
      } catch (err) {
        console.error("Error polling device status:", err);
      }
    }, 5000);

    setTimeout(() => {
      clearInterval(pollInterval);
    }, 120000);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(provisioningScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Initialize Leaflet map inside Add Hotspot modal (Step 1)
  useEffect(() => {
    if (
      showAddHotspotModal &&
      addHsStep === 1 &&
      !addHsMapInstanceRef.current
    ) {
      const initialLat = Number(hsLat) || 0.3476;
      const initialLng = Number(hsLng) || 32.5825;
      const map = L.map(addHsMapRef.current).setView(
        [initialLat, initialLng],
        12
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);
      const marker = L.marker([initialLat, initialLng], {
        draggable: true,
      }).addTo(map);
      marker.on("moveend", (e) => {
        const pos = e.target.getLatLng();
        setHsLat(pos.lat);
        setHsLng(pos.lng);
      });
      map.on("click", (e) => {
        const { lat, lng } = e.latlng;
        setHsLat(lat);
        setHsLng(lng);
        marker.setLatLng(e.latlng);
      });
      // Try browser geolocation
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          setHsLat(lat);
          setHsLng(lng);
          map.setView([lat, lng], 14);
          marker.setLatLng([lat, lng]);
        });
      }
      addHsMapInstanceRef.current = map;
      addHsMarkerRef.current = marker;
    }
  }, [showAddHotspotModal, addHsStep]);

  // Keep marker in sync if user edits lat/lng manually
  useEffect(() => {
    if (addHsMarkerRef.current && addHsMapInstanceRef.current) {
      const lat = Number(hsLat);
      const lng = Number(hsLng);
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
        addHsMarkerRef.current.setLatLng([lat, lng]);
      }
    }
  }, [hsLat, hsLng]);

  // Cleanup map when modal closes
  useEffect(() => {
    if (!showAddHotspotModal && addHsMapInstanceRef.current) {
      addHsMapInstanceRef.current.remove();
      addHsMapInstanceRef.current = null;
      addHsMarkerRef.current = null;
    }
  }, [showAddHotspotModal]);

  useEffect(() => {
    if (ownerId && activeSection === "payments") {
      // Fetch wallet info when wallet tab is open
      axios
        .get(`http://localhost:5000/api/owners/${ownerId}/wallet/balance`)
        .then((res) => setWalletBalance(res.data.balance || 0))
        .catch(() => setWalletBalance(0));
      axios
        .get(`http://localhost:5000/api/owners/${ownerId}/wallet/transactions`)
        .then((res) => setWalletTx(res.data.transactions || []))
        .catch(() => setWalletTx([]));
    }
  }, [ownerId, activeSection]);

  // Fetch device data when devices section is active
  useEffect(() => {
    if (ownerId && activeSection === "devices") {
      // Fetch devices
      axios
        .get(`http://localhost:5000/api/devices/owner/${ownerId}`)
        .then((res) => {
          setDevices(res.data?.devices || res.data || []);
        })
        .catch((error) => {
          console.error("Error fetching devices:", error);
          setDevices([]);
        });

      // Fetch device stats
      axios
        .get(`http://localhost:5000/api/devices/owner/${ownerId}/stats`)
        .then((res) => {
          setDeviceStats(
            res.data || {
              totalDevices: 0,
              onlineDevices: 0,
              deviceTypes: {},
              hotspotDevices: {},
            }
          );
        })
        .catch((error) => {
          console.error("Error fetching device stats:", error);
          setDeviceStats({
            totalDevices: 0,
            onlineDevices: 0,
            deviceTypes: {},
            hotspotDevices: {},
          });
        });
    }
  }, [ownerId, activeSection]);

  // Fetch reviews data when reviews section is active
  useEffect(() => {
    if (ownerId && activeSection === "reviews") {
      fetchReviews();
    }
  }, [ownerId, activeSection]);

  // Debug activeSection changes
  useEffect(() => {
    console.log("🎯 ACTIVE SECTION CHANGED TO:", activeSection);
  }, [activeSection]);

  // Update device chart data
  useEffect(() => {
    if (devices.length > 0) {
      const now = new Date().toLocaleTimeString();
      const onlineCount = devices.filter((d) => d.status === "online").length;

      setDeviceChartData((prev) => {
        const newData = [...prev.datasets[0].data, onlineCount].slice(-12);
        const newLabels = [...prev.labels, now].slice(-12);
        return {
          labels: newLabels,
          datasets: [{ ...prev.datasets[0], data: newData }],
        };
      });
    }
  }, [devices]);

  // Enhanced dashboard stats calculation
  useEffect(() => {
    if (ownerId && activeSection === "dashboard") {
      // Filter data based on selected hotspot
      let filteredPackages = packages;
      let filteredDevices = devices;

      if (selectedHotspotId !== "all") {
        // Filter packages by hotspot
        filteredPackages = packages.filter(
          (pkg) => pkg.hotspotId === selectedHotspotId
        );
        // Filter devices by hotspot
        filteredDevices = devices.filter(
          (device) => device.hotspotId === selectedHotspotId
        );
      }

      // Calculate dashboard stats from filtered data
      const totalRevenue = filteredPackages.reduce(
        (sum, pkg) => sum + (pkg.price || 0),
        0
      );
      const totalCustomers = filteredDevices.length;
      const activeUsers = filteredDevices.filter(
        (device) => device.status === "online"
      ).length;
      const dataUsed = filteredDevices.reduce(
        (sum, device) => sum + (device.dataUsed || 0),
        0
      );

      setDashboardStats({
        totalRevenue,
        totalCustomers,
        activeUsers,
        dataUsed,
        currentBalance: walletBalance,
      });
    }
  }, [
    ownerId,
    activeSection,
    packages,
    devices,
    walletBalance,
    selectedHotspotId,
  ]);

  const handleWithdraw = async () => {
    setWalletMsg("");
    try {
      await axios.post(`/api/owners/${ownerId}/wallet/withdraw`, {
        amount: Number(withdrawAmount),
        mobileMoneyNumber,
        provider: "mtn",
      });
      setWalletMsg("Withdrawal requested!");
      setWithdrawAmount("");
      setMobileMoneyNumber("");
      const balRes = await axios.get(
        `http://localhost:5000/api/owners/${ownerId}/wallet/balance`
      );
      setWalletBalance(balRes.data.balance || 0);
      const txRes = await axios.get(
        `http://localhost:5000/api/owners/${ownerId}/wallet/transactions`
      );
      setWalletTx(txRes.data.transactions || []);
    } catch (err) {
      setWalletMsg(err.response?.data?.error || "Withdrawal failed");
    }
  };

  // Branding functions with real-time data
  const handleFileUpload = async (file, type) => {
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);
      formData.append("ownerId", ownerId);
      formData.append("hotspotId", selectedBrandingHotspot);

      const response = await axios.post("/api/branding/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      if (response.data.success) {
        setUploadedFiles((prev) => ({
          ...prev,
          [type]: {
            name: file.name,
            url: response.data.url,
            size: file.size,
          },
        }));

        // Update branding data in real-time
        setBrandingData((prev) => ({
          ...prev,
          [type]: response.data.url,
        }));

        // Show success message
        alert(`${type === "logo" ? "Logo" : "Favicon"} uploaded successfully!`);
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert(`Failed to upload ${type}. Please try again.`);
    }
  };

  const handleSaveBranding = async () => {
    try {
      const brandingPayload = {
        ...brandingData,
        ownerId,
        hotspotId: selectedBrandingHotspot,
        timestamp: new Date().toISOString(),
      };

      await axios.post("/api/branding/save", brandingPayload);
      alert("Branding saved as draft successfully!");
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save branding. Please try again.");
    }
  };

  const handlePublishBranding = async () => {
    try {
      const brandingPayload = {
        ...brandingData,
        ownerId,
        hotspotId: selectedBrandingHotspot,
        published: true,
        timestamp: new Date().toISOString(),
      };

      await axios.post("/api/branding/publish", brandingPayload);
      alert("Branding published successfully! Changes are now live.");
    } catch (error) {
      console.error("Publish error:", error);
      alert("Failed to publish branding. Please try again.");
    }
  };

  // Real-time branding data fetch
  useEffect(() => {
    if (ownerId && activeSection === "branding") {
      const fetchBrandingData = async () => {
        try {
          const response = await axios.get(
            `/api/branding/${ownerId}/${selectedBrandingHotspot}`
          );
          if (response.data.success) {
            setBrandingData(response.data.branding);
            setUploadedFiles({
              logo: response.data.branding.logo
                ? { name: "Current Logo", url: response.data.branding.logo }
                : null,
              favicon: response.data.branding.favicon
                ? {
                    name: "Current Favicon",
                    url: response.data.branding.favicon,
                  }
                : null,
            });
          }
        } catch (error) {
          console.error("Failed to fetch branding data:", error);
        }
      };

      fetchBrandingData();
    }
  }, [ownerId, activeSection, selectedBrandingHotspot]);

  const fetchPackages = async (resolvedOwnerId) => {
    try {
      const response = await fetch(`/api/packages/${resolvedOwnerId}`);
      if (response.ok) {
        const data = await response.json();
        setPackages(data);
      } else {
        console.error("Failed to fetch packages:", response.statusText);
        setPackages([]);
      }
    } catch (err) {
      console.error("Fetch error:", err);
      setPackages([]);
    }
  };

  const handleCreatePackage = async (e) => {
    e.preventDefault();
    if (
      !packageForm.name ||
      !packageForm.price ||
      (!packageForm.durationType && !packageForm.customHours)
    ) {
      alert("Fill in all fields.");
      return;
    }

    const duration =
      packageForm.durationType === "custom"
        ? `${packageForm.customHours} hours`
        : packageForm.durationType;

    const newPkg = {
      packageName: packageForm.name,
      price: Number(packageForm.price),
      duration,
      status: "paused",
      ownerId,
    };

    try {
      const response = await fetch(`/api/packages/${ownerId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newPkg),
      });

      if (response.ok) {
        setShowModal(false);
        setPackageForm({
          name: "",
          price: "",
          durationType: "daily",
          customHours: "",
        });
        fetchPackages(ownerId);
      } else {
        console.error("Failed to create package:", response.statusText);
      }
    } catch (err) {
      console.error("Add error:", err);
    }
  };

  const toggleStatus = async (pkg) => {
    try {
      const response = await fetch(
        `/api/packages/${ownerId}/${pkg.id}/toggle`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        fetchPackages(ownerId);
      } else {
        console.error("Failed to toggle package status:", response.statusText);
      }
    } catch (err) {
      console.error("Toggle error:", err);
    }
  };

  const deletePackage = async (pkgId) => {
    try {
      const response = await fetch(`/api/packages/${ownerId}/${pkgId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        fetchPackages(ownerId);
      } else {
        console.error("Failed to delete package:", response.statusText);
      }
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate("/adminlogin");
  };

  const styles = {
    container: {
      display: "flex",
      minHeight: "100vh",
      position: "relative",
    },
    sidebar: {
      width: sidebarOpen ? "220px" : "60px",
      background: "var(--sidebar-bg)",
      color: "var(--sidebar-text)",
      padding: "20px 10px",
      transition: "width 0.3s ease, transform 0.3s ease",
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      position: "fixed",
      left: 0,
      top: 0,
      zIndex: 1000,
      overflowY: "auto",
      overflowX: "hidden",
    },
    main: {
      flex: 1,
      padding: "30px",
      background: "var(--surface-2)",
      color: "var(--text-primary)",
      marginLeft: sidebarOpen ? "220px" : "60px",
      transition: "margin-left 0.3s ease",
      minHeight: "100vh",
    },
    mobileMenuButton: {
      display: "none",
      position: "fixed",
      top: "20px",
      left: "20px",
      zIndex: 1001,
      background: "var(--accent)",
      color: "#ffffff",
      border: "none",
      borderRadius: "8px",
      padding: "12px",
      cursor: "pointer",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      transition: "all 0.3s ease",
      fontSize: "16px",
      width: "44px",
      height: "44px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    overlay: {
      display: "none",
      position: "fixed",
      top: 0,
      left: 0,
      width: "100vw",
      height: "100vh",
      background: "rgba(0,0,0,0.5)",
      zIndex: 999,
    },
    button: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      background: "transparent",
      border: "none",
      color: "var(--sidebar-text)",
      fontSize: "16px",
      marginBottom: "12px",
      cursor: "pointer",
      textAlign: "left",
      width: "100%",
      padding: "12px 8px",
      borderRadius: "8px",
      transition: "all 0.2s ease",
      fontWeight: "500",
      // Hover effect
      ":hover": {
        backgroundColor: "var(--surface-2)",
        transform: "translateX(2px)",
      },
    },
    modalOverlay: {
      position: "fixed",
      top: 0,
      left: 0,
      width: "100vw",
      height: "100vh",
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 1000,
    },
    modalContent: {
      backgroundColor: "var(--surface)",
      padding: "30px",
      borderRadius: "12px",
      width: "100%",
      maxWidth: "400px",
      border: "1px solid var(--stroke)",
      boxShadow: "0 8px 24px rgba(0,0,0,0.24)",
    },
    input: {
      marginBottom: "10px",
      padding: "10px",
      width: "100%",
      border: "1px solid #ccc",
      borderRadius: "4px",
    },
    btn: {
      padding: "10px 15px",
      borderRadius: "4px",
      border: "none",
      cursor: "pointer",
    },
    card: {
      background: "var(--surface)",
      padding: "16px",
      borderRadius: "12px",
      border: "1px solid var(--stroke)",
      boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
      marginBottom: "12px",
      color: "var(--text-primary)",
    },
    ownerHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "20px",
      paddingBottom: "15px",
      borderBottom: "1px solid var(--stroke)",
    },
    ownerInfo: {
      flex: 1,
    },
    welcomeTitle: {
      fontSize: "24px",
      marginBottom: "5px",
      color: "var(--text-primary)",
    },
    businessInfo: {
      fontSize: "16px",
      color: "var(--text-muted)",
    },
    logoContainer: {
      width: "80px",
      height: "80px",
      borderRadius: "50%",
      overflow: "hidden",
      border: "2px solid var(--stroke)",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
    },
    ownerLogo: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
    },
    sidebarLogo: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      marginBottom: "16px",
      paddingBottom: "16px",
      borderBottom: "1px solid var(--stroke)",
    },
    sidebarLogoImage: {
      width: "40px",
      height: "40px",
      borderRadius: "50%",
      objectFit: "cover",
    },
    sidebarOwnerName: {
      fontSize: "16px",
      color: "var(--sidebar-text)",
      margin: "0",
    },
  };

  // Hotspot management functions
  const handleEditHotspot = (hotspot) => {
    setSelectedHotspot(hotspot);
    setHsName(hotspot.name || "");
    setHsLat(hotspot.location?.lat || 0);
    setHsLng(hotspot.location?.lng || 0);
    setHsRouterType(hotspot.routerType || "Mikrotik");
    setHsHotspotType(hotspot.hotspotType || "Supported Router");
    setHsMac(hotspot.mac || "");
    setHsRouterId(hotspot.routerId || "");
    setShowAddHotspotModal(true);
    setAddHsStep(1);
  };

  const handleDeleteHotspot = async (hotspotId) => {
    if (window.confirm("Are you sure you want to delete this hotspot?")) {
      try {
        await axios.delete(`/api/hotspots/${hotspotId}`);
        setHotspots((prev) => prev.filter((h) => h.id !== hotspotId));
      } catch (error) {
        console.error("Error deleting hotspot:", error);
      }
    }
  };

  return (
    <>
      <style>
        {`
          @media (max-width: 768px) {
            .admin-sidebar {
              transform: ${sidebarOpen ? "translateX(0)" : "translateX(-100%)"};
              width: 280px;
              box-shadow: 2px 0 10px rgba(0,0,0,0.1);
            }
            .admin-main {
              margin-left: 0;
              padding: 20px 15px;
            }
            .admin-mobile-menu {
              display: flex !important;
            }
            .admin-overlay {
              display: ${sidebarOpen ? "block" : "none"};
            }
            .admin-button {
              font-size: 14px;
              padding: 10px 8px;
              margin-bottom: 8px;
            }
            .admin-grid {
              grid-template-columns: 1fr !important;
              gap: 12px !important;
            }
            .admin-grid-large {
              grid-template-columns: 1fr !important;
              gap: 16px !important;
            }
            .admin-mobile-close {
              display: none !important;
            }
          }
          
          /* Review filter dropdowns styling */
          .review-filter-select {
            border: none !important;
            background: transparent !important;
            color: var(--text-primary) !important;
            font-size: 14px !important;
            outline: none !important;
            cursor: pointer !important;
            min-width: 120px !important;
            appearance: none !important;
            -webkit-appearance: none !important;
            -moz-appearance: none !important;
          }
          
          .review-filter-select option {
            color: var(--text-primary) !important;
            background: var(--surface) !important;
            padding: 8px !important;
          }
          
          .review-filter-select:focus {
            outline: none !important;
            box-shadow: none !important;
          }
          
          /* Global z-index fix for all dropdowns and selects */
          select, .yaba-select {
            position: relative !important;
            z-index: 1000 !important;
            color: #1f2937 !important;
            background-color: #ffffff !important;
          }
          
          select:focus, .yaba-select:focus {
            z-index: 1001 !important;
            color: #1f2937 !important;
            background-color: #ffffff !important;
          }
          
          /* Ensure option text is visible */
          select option {
            color: #1f2937 !important;
            background-color: #ffffff !important;
          }
          
          select option:hover {
            background-color: #f3f4f6 !important;
            color: #1f2937 !important;
          }
          
          /* Ensure all UI elements are above maps and charts */
          .admin-main > div > div {
            position: relative;
            z-index: 10;
          }
          
          /* Ensure map text is visible */
          .yaba-card h3, .yaba-card p, .yaba-card label {
            color: var(--text-primary) !important;
            z-index: 1000 !important;
            position: relative !important;
          }
          
          .yaba-card .yaba-muted {
            color: var(--text-muted) !important;
          }
        `}
      </style>
      <div style={styles.container}>
        {/* Mobile Menu Button - shows when sidebar is closed */}
        {!sidebarOpen && (
          <button
            className="admin-mobile-menu"
            style={styles.mobileMenuButton}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <FaBars />
          </button>
        )}

        {/* Overlay for mobile */}
        {sidebarOpen && (
          <div
            className="admin-overlay"
            style={styles.overlay}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div className="admin-sidebar" style={styles.sidebar}>
          {/* Logo and Owner Info */}
          <div style={styles.sidebarLogo}>
            <img
              src="/YABA.svg"
              alt="YABA Logo"
              style={styles.sidebarLogoImage}
            />
            {sidebarOpen && (
              <div>
                <p
                  style={{
                    ...styles.sidebarOwnerName,
                    fontWeight: 700,
                    marginBottom: 2,
                  }}
                >
                  YABAnect
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "var(--sidebar-text-muted)",
                  }}
                >
                  Anywhere, Everywhere
                </p>
              </div>
            )}
          </div>

          {/* Main Dashboard Section with Close Button */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <button
              onClick={() => setActiveSection("dashboard")}
              className="admin-button"
              style={{
                ...styles.button,
                marginBottom: 0,
                flex: 1,
                marginRight: 8,
              }}
            >
              📊 {sidebarOpen && "Dashboard"}
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-primary)",
                fontSize: "16px",
                cursor: "pointer",
                padding: "8px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: "32px",
                height: "32px",
              }}
              aria-label="Close menu"
            >
              <FaTimes />
            </button>
          </div>

          {/* Core Sections */}
          <button
            onClick={() => setActiveSection("devices")}
            className="admin-button"
            style={styles.button}
          >
            📱 {sidebarOpen && "Devices"}
          </button>
          <button
            onClick={() => setActiveSection("packages")}
            className="admin-button"
            style={styles.button}
          >
            📦 {sidebarOpen && "Packages"}
          </button>
          <button
            onClick={() => setActiveSection("referrals")}
            className="admin-button"
            style={styles.button}
          >
            🚀 {sidebarOpen && "Referrals"}
          </button>
          <button
            onClick={() => setActiveSection("vouchers")}
            className="admin-button"
            style={styles.button}
          >
            🎫 {sidebarOpen && "Vouchers"}
            {voucherStats.activeVouchers > 0 && (
              <span
                style={{
                  backgroundColor: "var(--success)",
                  color: "#ffffff",
                  borderRadius: "50%",
                  padding: "2px 6px",
                  fontSize: "10px",
                  marginLeft: "8px",
                  minWidth: "16px",
                  textAlign: "center",
                }}
              >
                {voucherStats.activeVouchers}
              </span>
            )}
            {voucherStats.expired > 0 && (
              <span
                style={{
                  backgroundColor: "var(--danger)",
                  color: "#ffffff",
                  borderRadius: "50%",
                  padding: "2px 6px",
                  fontSize: "10px",
                  marginLeft: voucherStats.activeVouchers > 0 ? "4px" : "8px",
                  minWidth: "16px",
                  textAlign: "center",
                }}
              >
                {voucherStats.expired}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSection("payments")}
            className="admin-button"
            style={styles.button}
          >
            💰 {sidebarOpen && "Payments"}
          </button>
          <button
            onClick={() => setActiveSection("analytics")}
            className="admin-button"
            style={styles.button}
          >
            📈 {sidebarOpen && "Analytics"}
          </button>
          <button
            onClick={() => setActiveSection("branding")}
            className="admin-button"
            style={styles.button}
          >
            🎨 {sidebarOpen && "Branding"}
          </button>
          <button
            onClick={() => setActiveSection("communication")}
            className="admin-button"
            style={styles.button}
          >
            ✉️ {sidebarOpen && "Communication"}
          </button>
          <button
            onClick={() => setActiveSection("hotspots")}
            className="admin-button"
            style={styles.button}
          >
            📍 {sidebarOpen && "Your Hotspot"}
          </button>
          <button
            onClick={() => setActiveSection("reviews")}
            className="admin-button"
            style={styles.button}
          >
            ⭐ {sidebarOpen && "Reviews & Ratings"}
          </button>
          <button
            onClick={() => setActiveSection("support")}
            className="admin-button"
            style={styles.button}
          >
            🛟 {sidebarOpen && "Support Settings"}
          </button>

          {/* Logout at bottom */}
          <div style={{ marginTop: "auto", paddingTop: 16 }}>
            <button
              onClick={handleLogout}
              className="admin-button"
              style={styles.button}
            >
              <FaSignOutAlt /> {sidebarOpen && "Logout"}
            </button>
          </div>
        </div>

        <div className="admin-main" style={styles.main}>
          {/* Top header: search + quick metrics + notifications + profile */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, position: "relative" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid var(--control-stroke)",
                  background: "var(--control)",
                  borderRadius: 999,
                  padding: "8px 12px",
                  maxWidth: 360,
                }}
              >
                <span style={{ color: "var(--text-tertiary)" }}>🔍</span>
                <input
                  placeholder="Search hotspots, devices..."
                  style={{
                    flex: 1,
                    outline: "none",
                    border: "none",
                    background: "transparent",
                    fontSize: 14,
                  }}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                />
              </div>
              {searchOpen && searchResults.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: 44,
                    left: 0,
                    width: 360,
                    background: "var(--surface)",
                    border: "1px solid var(--stroke)",
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                    zIndex: 10,
                  }}
                >
                  {searchResults.map((it, idx) => (
                    <div
                      key={idx}
                      onClick={() => goToSearchItem(it)}
                      style={{
                        padding: "10px 12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--text-muted)",
                          minWidth: 88,
                        }}
                      >
                        {it.kind}
                      </span>
                      <span style={{ color: "var(--text-primary)" }}>
                        {it.label}
                      </span>
                    </div>
                  ))}
                  <div
                    style={{
                      padding: "8px 12px",
                      borderTop: "1px solid var(--stroke)",
                      fontSize: 12,
                      color: "var(--text-muted)",
                    }}
                  >
                    Link to relevant resources
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Total Revenue
                </div>
                <div style={{ color: "var(--success)", fontWeight: 700 }}>
                  {formatUGX(
                    dashboardStats.totalRevenue ||
                      walletTx
                        .filter((t) => t.type !== "withdrawal")
                        .reduce((s, t) => s + Number(t.amount || 0), 0)
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Active Hotspots
                </div>
                <div style={{ color: "var(--accent)", fontWeight: 700 }}>
                  {Array.isArray(devicesView.hotspots)
                    ? devicesView.hotspots.filter((h) => h.status === "online")
                        .length
                    : 0}
                  /
                  {Array.isArray(devicesView.hotspots)
                    ? devicesView.hotspots.length
                    : 0}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <ThemeToggle />
                <div style={{ position: "relative" }}>
                  <button
                    style={{
                      cursor: "pointer",
                      background: "transparent",
                      border: "none",
                    }}
                    onClick={() => setShowNotifMenu((v) => !v)}
                  >
                    <span style={{ fontSize: 18 }}>🔔</span>
                    {unreadCount > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -6,
                          background: "var(--danger)",
                          color: "#fff",
                          borderRadius: 999,
                          fontSize: 10,
                          padding: "2px 6px",
                        }}
                      >
                        {unreadCount}
                      </span>
                    )}
                  </button>
                  {showNotifMenu && (
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 36,
                        width: 360,
                        background: "var(--surface)",
                        border: "1px solid var(--stroke)",
                        borderRadius: 12,
                        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                        zIndex: 20,
                      }}
                    >
                      <div
                        style={{
                          padding: "8px 12px",
                          borderBottom: "1px solid #e5e7eb",
                          display: "flex",
                          gap: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        {[
                          "all",
                          "email",
                          "sms",
                          "push",
                          "maintenance",
                          "payment",
                          "review",
                        ].map((f) => (
                          <button
                            key={f}
                            onClick={() => setNotifFilter(f)}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 999,
                              border: "1px solid var(--stroke)",
                              background:
                                notifFilter === f
                                  ? "#e0f2fe"
                                  : "var(--surface)",
                              color: "#0ea5e9",
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                      <div style={{ maxHeight: 320, overflowY: "auto" }}>
                        {filteredNotifications.length === 0 && (
                          <div
                            style={{ padding: 12, color: "var(--text-muted)" }}
                          >
                            No notifications
                          </div>
                        )}
                        {filteredNotifications.map((n, i) => (
                          <div
                            key={i}
                            style={{
                              padding: "10px 12px",
                              borderBottom: "1px solid #f1f5f9",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "var(--text-muted)",
                                }}
                              >
                                {deriveCategory(n)} · {deriveChannel(n)}
                              </span>
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "var(--text-tertiary)",
                                }}
                              >
                                {n.createdAt
                                  ? new Date(n.createdAt).toLocaleString()
                                  : n.date
                                  ? new Date(n.date).toLocaleString()
                                  : ""}
                              </span>
                            </div>
                            <div style={{ color: "var(--text-primary)" }}>
                              {n.message || n.title || "Notification"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    overflow: "hidden",
                    background: "var(--accent)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                  }}
                >
                  {localStorage.getItem("ownerLogoUrl") ? (
                    <img
                      src={localStorage.getItem("ownerLogoUrl")}
                      alt="Owner Logo"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    (localStorage.getItem("ownerName") || "Y").slice(0, 1)
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    lineHeight: 1.1,
                  }}
                >
                  <span style={{ fontSize: 14, color: "var(--text-primary)" }}>
                    {localStorage.getItem("ownerName") || "Owner"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    WiFi Owner
                  </span>
                </div>
              </div>
            </div>
          </div>
          {/* Modern Header */}
          {activeSection === "dashboard" && (
            <div
              style={{
                background: "var(--surface-gradient)",
                padding: "20px 24px",
                borderRadius: 20,
                boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
                border: "1px solid var(--stroke)",
                marginBottom: 24,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                <FaWifi
                  style={{
                    width: 32,
                    height: 32,
                    color: "var(--accent)",
                    marginRight: 12,
                  }}
                />
                <div>
                  <h1
                    style={{
                      margin: "0 0 4px 0",
                      fontSize: 24,
                      fontWeight: 700,
                      color: "var(--text-primary)",
                    }}
                  >
                    WiFi Business Hub
                  </h1>
                  <p
                    style={{
                      margin: 0,
                      color: "var(--text-muted)",
                      fontSize: 14,
                    }}
                  >
                    Manage your WiFi hotspots, packages, and business
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Modern Tabbed Interface */}
          {activeSection === "dashboard" && (
            <div style={{ marginBottom: 24 }}>
              <nav
                style={{
                  display: "flex",
                  background: "var(--surface-gradient)",
                  borderRadius: 20,
                  padding: 4,
                  boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
                  border: "1px solid var(--stroke)",
                  marginBottom: 24,
                }}
              >
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "12px 16px",
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: 500,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color:
                          activeTab === tab.id
                            ? "var(--accent)"
                            : "var(--text-muted)",
                        backgroundColor:
                          activeTab === tab.id
                            ? "var(--surface-3)"
                            : "transparent",
                        transition: "all 0.2s",
                      }}
                    >
                      <Icon style={{ width: 16, height: 16, marginRight: 8 }} />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          )}

          {/* Overview content - only shown when overview tab is active */}
          {activeSection === "dashboard" && activeTab === "overview" && (
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 24,
                  flexWrap: "wrap",
                  gap: "16px",
                }}
              >
                <h2 style={{ margin: 0 }}>Dashboard Overview</h2>

                {/* Hotspot Selection Dropdown */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    position: "relative",
                    zIndex: 1000,
                  }}
                >
                  <label
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    Filter by Hotspot:
                  </label>
                  <select
                    value={selectedHotspotId}
                    onChange={(e) => {
                      setSelectedHotspotId(e.target.value);
                      const hotspot = hotspots.find(
                        (h) => h.id === e.target.value
                      );
                      setSelectedHotspot(hotspot || null);
                    }}
                    style={{
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                      backgroundColor: "#fff",
                      minWidth: "200px",
                      cursor: "pointer",
                      position: "relative",
                      zIndex: 1001,
                    }}
                  >
                    <option value="all">All Hotspots</option>
                    {hotspots.map((hotspot) => (
                      <option key={hotspot.id} value={hotspot.id}>
                        {hotspot.name || hotspot.hotspotName}{" "}
                        {hotspot.status === "online" ? "🟢" : "🔴"}
                      </option>
                    ))}
                  </select>

                  {selectedHotspot && (
                    <div
                      style={{
                        padding: "6px 12px",
                        backgroundColor: "#f3f4f6",
                        borderRadius: "6px",
                        fontSize: "12px",
                        color: "var(--text-muted)",
                      }}
                    >
                      {selectedHotspot.status === "online"
                        ? "🟢 Online"
                        : "🔴 Offline"}
                    </div>
                  )}
                </div>
              </div>

              {/* Enhanced Stats Cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                  gap: 16,
                  marginBottom: 24,
                }}
              >
                <div
                  style={{
                    background: "var(--surface)",
                    padding: 24,
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                    border: "1px solid var(--stroke)",
                    color: "var(--text-primary)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <p
                        style={{
                          margin: "0 0 8px 0",
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--text-muted)",
                        }}
                      >
                        Total Revenue
                      </p>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 28,
                          fontWeight: 700,
                          color: "var(--text-primary)",
                        }}
                      >
                        UGX {dashboardStats.totalRevenue.toLocaleString()}
                      </p>
                    </div>
                    <div
                      style={{
                        padding: 12,
                        background: "var(--surface-3)",
                        borderRadius: 8,
                      }}
                    >
                      <FaDollarSign
                        style={{
                          width: 24,
                          height: 24,
                          color: "var(--accent)",
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    background: "var(--surface)",
                    padding: 24,
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                    border: "1px solid var(--stroke)",
                    color: "var(--text-primary)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <p
                        style={{
                          margin: "0 0 8px 0",
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--text-muted)",
                        }}
                      >
                        Total Customers
                      </p>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 28,
                          fontWeight: 700,
                          color: "var(--text-primary)",
                        }}
                      >
                        {dashboardStats.totalCustomers}
                      </p>
                    </div>
                    <div
                      style={{
                        padding: 12,
                        background: "var(--surface-3)",
                        borderRadius: 8,
                      }}
                    >
                      <FaUsers
                        style={{
                          width: 24,
                          height: 24,
                          color: "var(--success)",
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    background: "var(--surface)",
                    padding: 24,
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                    border: "1px solid var(--stroke)",
                    color: "var(--text-primary)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <p
                        style={{
                          margin: "0 0 8px 0",
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--text-muted)",
                        }}
                      >
                        Active Users
                      </p>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 28,
                          fontWeight: 700,
                          color: "var(--text-primary)",
                        }}
                      >
                        {dashboardStats.activeUsers}
                      </p>
                    </div>
                    <div
                      style={{
                        padding: 12,
                        background: "#f3e8ff",
                        borderRadius: 8,
                      }}
                    >
                      <FaWifi
                        style={{ width: 24, height: 24, color: "#8b5cf6" }}
                      />
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    background: "var(--surface)",
                    padding: 24,
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                    border: "1px solid var(--stroke)",
                    color: "var(--text-primary)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <p
                        style={{
                          margin: "0 0 8px 0",
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--text-muted)",
                        }}
                      >
                        Data Used
                      </p>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 28,
                          fontWeight: 700,
                          color: "var(--text-primary)",
                        }}
                      >
                        {dashboardStats.dataUsed.toFixed(1)} GB
                      </p>
                    </div>
                    <div
                      style={{
                        padding: 12,
                        background: "var(--surface-3)",
                        borderRadius: 8,
                      }}
                    >
                      <FaDatabase
                        style={{
                          width: 24,
                          height: 24,
                          color: "var(--warning)",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Enhanced Charts Section */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
                  gap: 20,
                  marginBottom: 24,
                }}
              >
                <div className="yaba-card">
                  <h3 className="yaba-card-title">Revenue Trends</h3>
                  <div
                    className="yaba-elev-2"
                    style={{
                      height: 200,
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px solid var(--stroke)",
                    }}
                  >
                    <p className="yaba-muted">Chart will be displayed here</p>
                  </div>
                </div>

                <div className="yaba-card">
                  <h3 className="yaba-card-title">Package Performance</h3>
                  <div
                    className="yaba-elev-2"
                    style={{
                      height: 200,
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px solid var(--stroke)",
                    }}
                  >
                    <p className="yaba-muted">Chart will be displayed here</p>
                  </div>
                </div>
              </div>

              {/* Recent Activity */}
              <div className="yaba-card" style={{ padding: 24 }}>
                <h3
                  style={{
                    margin: "0 0 16px 0",
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  Recent Packages
                </h3>
                {packages.length === 0 ? (
                  <p style={{ color: "var(--text-muted)" }}>
                    No packages created yet.
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {packages.slice(0, 5).map((pkg) => (
                      <div
                        key={pkg.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: 16,
                          background: "#f9fafb",
                          borderRadius: 8,
                          border: "1px solid #e5e7eb",
                        }}
                      >
                        <div>
                          <strong
                            style={{
                              fontSize: 16,
                              color: "var(--text-primary)",
                            }}
                          >
                            {pkg.packageName || pkg.name}
                          </strong>
                          <div
                            style={{
                              color: "var(--text-muted)",
                              fontSize: 14,
                              marginTop: 4,
                            }}
                          >
                            UGX {pkg.price} • {pkg.duration}
                          </div>
                        </div>
                        <span
                          style={{
                            padding: "6px 12px",
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 500,
                            background:
                              pkg.status === "active" ? "#dcfce7" : "#fef3c7",
                            color:
                              pkg.status === "active" ? "#166534" : "#92400e",
                          }}
                        >
                          {pkg.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab Content for Dashboard */}

          {activeSection === "dashboard" && activeTab === "devices" && (
            <div>
              <h2 style={{ marginBottom: 16 }}>Device Management</h2>
              <div className="yaba-card" style={{ padding: 24 }}>
                <h3
                  style={{
                    margin: "0 0 16px 0",
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  Hotspot Management
                </h3>
                <div
                  className="admin-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: 16,
                  }}
                >
                  {devicesView.hotspots.length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "40px 20px",
                        color: "var(--text-muted)",
                      }}
                    >
                      <div style={{ fontSize: 48, marginBottom: 16 }}>📍</div>
                      <h4
                        style={{
                          margin: "0 0 8px 0",
                          color: "var(--text-primary)",
                        }}
                      >
                        No hotspots yet
                      </h4>
                      <p style={{ margin: 0 }}>
                        Create your first hotspot to get started
                      </p>
                    </div>
                  ) : (
                    devicesView.hotspots.map((hotspot) => (
                      <div
                        key={hotspot.id}
                        className="yaba-card"
                        style={{ padding: 20 }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            marginBottom: 12,
                          }}
                        >
                          <h4
                            style={{
                              margin: "0 0 8px 0",
                              fontSize: 16,
                              fontWeight: 600,
                              color: "var(--text-primary)",
                            }}
                          >
                            {hotspot.name || hotspot.hotspotName}
                          </h4>
                          <div
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              backgroundColor:
                                hotspot.status === "online"
                                  ? "var(--success)"
                                  : "var(--danger)",
                            }}
                          ></div>
                        </div>
                        <p
                          style={{
                            margin: "0 0 8px 0",
                            fontSize: 14,
                            color: "var(--text-muted)",
                          }}
                        >
                          📍{" "}
                          {hotspot.location
                            ? `${hotspot.location.lat?.toFixed(
                                4
                              )}, ${hotspot.location.lng?.toFixed(4)}`
                            : "Location not set"}
                        </p>
                        <p
                          style={{
                            margin: "0 0 12px 0",
                            fontSize: 12,
                            color: "var(--text-tertiary)",
                          }}
                        >
                          Device ID: {hotspot.id}
                        </p>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: 14,
                          }}
                        >
                          <span style={{ color: "var(--text-muted)" }}>
                            Revenue: UGX 0
                          </span>
                          <span style={{ color: "var(--text-muted)" }}>
                            Users: 0
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSection === "dashboard" && activeTab === "packages" && (
            <div>
              <h2 style={{ marginBottom: 16 }}>Package Management</h2>
              <div className="yaba-card" style={{ padding: 24 }}>
                <h3
                  style={{
                    margin: "0 0 16px 0",
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  Your WiFi Packages
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                    gap: 16,
                  }}
                >
                  {packages.length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "40px 20px",
                        color: "var(--text-muted)",
                      }}
                    >
                      <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
                      <h4
                        style={{
                          margin: "0 0 8px 0",
                          color: "var(--text-primary)",
                        }}
                      >
                        No packages yet
                      </h4>
                      <p style={{ margin: 0 }}>
                        Create your first WiFi package to start earning
                      </p>
                    </div>
                  ) : (
                    packages.map((pkg) => (
                      <div
                        key={pkg.id}
                        className="yaba-card"
                        style={{ padding: 20 }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            marginBottom: 12,
                          }}
                        >
                          <h4
                            style={{
                              margin: "0 0 8px 0",
                              fontSize: 16,
                              fontWeight: 600,
                              color: "var(--text-primary)",
                            }}
                          >
                            {pkg.packageName || pkg.name}
                          </h4>
                          <span
                            style={{
                              fontSize: 20,
                              fontWeight: 700,
                              color: "var(--accent)",
                            }}
                          >
                            UGX {pkg.price?.toLocaleString() || 0}
                          </span>
                        </div>
                        <p
                          style={{
                            margin: "0 0 16px 0",
                            fontSize: 14,
                            color: "var(--text-muted)",
                          }}
                        >
                          {pkg.duration}
                        </p>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              padding: "4px 12px",
                              borderRadius: 20,
                              fontSize: 12,
                              fontWeight: 500,
                              backgroundColor:
                                pkg.status === "launched"
                                  ? "#dcfce7"
                                  : "var(--surface-3)",
                              color:
                                pkg.status === "launched"
                                  ? "#166534"
                                  : "var(--text-muted)",
                            }}
                          >
                            {pkg.status === "launched" ? "Active" : "Inactive"}
                          </span>
                          <button
                            style={{
                              padding: "6px 12px",
                              background: "var(--surface-3)",
                              color: "var(--text-primary)",
                              border: "1px solid var(--stroke)",
                              borderRadius: 6,
                              cursor: "pointer",
                              fontSize: 12,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <FaEye style={{ width: 12, height: 12 }} />
                            Edit
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSection === "dashboard" && activeTab === "financials" && (
            <div>
              <h2 style={{ marginBottom: 16 }}>Financial Overview</h2>
              <div
                className="admin-grid-large"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
                  gap: 20,
                }}
              >
                <div className="yaba-card" style={{ padding: 24 }}>
                  <h3
                    style={{
                      margin: "0 0 16px 0",
                      fontSize: 18,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                    }}
                  >
                    Current Balance
                  </h3>
                  <div
                    style={{
                      fontSize: 32,
                      fontWeight: 700,
                      color: "#2563eb",
                      marginBottom: 20,
                    }}
                  >
                    UGX {dashboardStats.currentBalance.toLocaleString()}
                  </div>
                  <button
                    style={{
                      width: "100%",
                      background: "#2563eb",
                      color: "#ffffff",
                      padding: "12px 24px",
                      borderRadius: 8,
                      border: "none",
                      fontSize: 16,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Request Payout
                  </button>
                </div>

                <div className="yaba-card" style={{ padding: 24 }}>
                  <h3
                    style={{
                      margin: "0 0 16px 0",
                      fontSize: 18,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                    }}
                  >
                    Recent Transactions
                  </h3>
                  <div
                    style={{
                      padding: 16,
                      background: "#f9fafb",
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    {walletTx.length === 0 ? (
                      <p
                        style={{
                          margin: 0,
                          color: "var(--text-muted)",
                          textAlign: "center",
                        }}
                      >
                        No transactions yet
                      </p>
                    ) : (
                      <div style={{ display: "grid", gap: 12 }}>
                        {walletTx.slice(0, 5).map((tx, i) => (
                          <div
                            key={i}
                            style={{
                              padding: 12,
                              background: "var(--surface)",
                              borderRadius: 6,
                              border: "1px solid #e5e7eb",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontWeight: 500,
                                  color: "var(--text-primary)",
                                }}
                              >
                                {tx.type}
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "var(--text-muted)",
                                }}
                              >
                                {tx.date}
                              </div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div
                                style={{
                                  fontWeight: 600,
                                  color: "var(--text-primary)",
                                }}
                              >
                                UGX {tx.amount}
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "var(--text-muted)",
                                }}
                              >
                                {tx.description}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === "dashboard" && activeTab === "loyalty" && (
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 24,
                }}
              >
                <h2 style={{ margin: 0 }}>Loyalty Program Management</h2>

                {/* Hotspot Selection Dropdown for Loyalty */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    position: "relative",
                    zIndex: 1000,
                  }}
                >
                  <label
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    Filter by Hotspot:
                  </label>
                  <select
                    value={selectedHotspotId}
                    onChange={(e) => {
                      setSelectedHotspotId(e.target.value);
                      const hotspot = hotspots.find(
                        (h) => h.id === e.target.value
                      );
                      setSelectedHotspot(hotspot || null);
                    }}
                    style={{
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                      backgroundColor: "#fff",
                      minWidth: "200px",
                      cursor: "pointer",
                      position: "relative",
                      zIndex: 1001,
                    }}
                  >
                    <option value="all">All Hotspots</option>
                    {hotspots.map((hotspot) => (
                      <option key={hotspot.id} value={hotspot.id}>
                        {hotspot.name || hotspot.hotspotName}{" "}
                        {hotspot.status === "online" ? "🟢" : "🔴"}
                      </option>
                    ))}
                  </select>

                  {selectedHotspot && (
                    <div
                      style={{
                        padding: "6px 12px",
                        backgroundColor: "#f3f4f6",
                        borderRadius: "6px",
                        fontSize: "12px",
                        color: "var(--text-muted)",
                      }}
                    >
                      {selectedHotspot.status === "online"
                        ? "🟢 Online"
                        : "🔴 Offline"}
                    </div>
                  )}
                </div>
              </div>
              <LoyaltyManagement
                ownerId={ownerId}
                selectedHotspotId={selectedHotspotId}
              />
            </div>
          )}

          {activeSection === "devices" && (
            <div>
              <h2 style={{ marginBottom: 16 }}>Device Management</h2>

              {/* Header with Add Device Button */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 20,
                }}
              >
                <div>
                  <h3
                    style={{
                      margin: "0 0 8px 0",
                      color: "var(--text-primary)",
                    }}
                  >
                    Your WiFi Devices
                  </h3>
                  <p style={{ margin: 0, color: "var(--text-muted)" }}>
                    Manage your connected routers and devices
                  </p>
                </div>
                <button
                  onClick={() => setShowDeviceWizard(true)}
                  style={{
                    padding: "12px 24px",
                    background: "var(--accent)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  📱 Add New Device
                </button>
              </div>

              {/* Link Any Device Type Section */}
              <div
                className="yaba-card"
                style={{
                  padding: "24px",
                  marginBottom: "24px",
                  color: "var(--text-primary)",
                }}
              >
                <h3 style={{ margin: "0 0 16px 0", fontSize: "20px" }}>
                  🔗 Link Any Device Type
                </h3>
                <p style={{ margin: "0 0 20px 0", color: "var(--text-muted)" }}>
                  Quickly link your existing routers and devices to start
                  managing them
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: "16px",
                  }}
                >
                  {/* MikroTik Device */}
                  <div
                    className="yaba-card"
                    style={{
                      padding: "20px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "12px",
                      }}
                    >
                      <div style={{ fontSize: "24px" }}>🖥️</div>
                      <div>
                        <h4
                          style={{
                            margin: "0 0 4px 0",
                            fontSize: "16px",
                            color: "var(--text-primary)",
                          }}
                        >
                          MikroTik Router
                        </h4>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "12px",
                            color: "var(--text-muted)",
                          }}
                        >
                          RouterOS compatible
                        </p>
                      </div>
                    </div>
                    <p
                      style={{
                        margin: "0 0 16px 0",
                        fontSize: "14px",
                        color: "var(--text-muted)",
                      }}
                    >
                      Link your MikroTik router with automatic script generation
                      and configuration
                    </p>
                    <button
                      onClick={() => {
                        setFormData({
                          deviceName: "",
                          routerIdentity: "",
                          deviceType: "mikrotik",
                          serviceType: ["hotspot"],
                          antiSharing: false,
                          interfaces: [],
                          location: null,
                        });
                        setShowDeviceWizard(true);
                      }}
                      style={{
                        width: "100%",
                        padding: "10px 16px",
                        background: "var(--accent)",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                        transition: "all 0.2s",
                      }}
                    >
                      Link MikroTik Device
                    </button>
                  </div>

                  {/* TP-Link Device */}
                  <div
                    className="yaba-card"
                    style={{
                      padding: "20px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "12px",
                      }}
                    >
                      <div style={{ fontSize: "24px" }}>📡</div>
                      <div>
                        <h4
                          style={{
                            margin: "0 0 4px 0",
                            fontSize: "16px",
                            color: "var(--text-primary)",
                          }}
                        >
                          TP-Link Router
                        </h4>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "12px",
                            color: "var(--text-muted)",
                          }}
                        >
                          Web interface setup
                        </p>
                      </div>
                    </div>
                    <p
                      style={{
                        margin: "0 0 16px 0",
                        fontSize: "14px",
                        color: "var(--text-muted)",
                      }}
                    >
                      Connect TP-Link routers with manual configuration
                      instructions
                    </p>
                    <button
                      onClick={() => {
                        setFormData({
                          deviceName: "",
                          deviceType: "tp-link",
                          serviceType: "hotspot",
                          interfaces: [],
                        });
                        setShowDeviceWizard(true);
                      }}
                      style={{
                        width: "100%",
                        padding: "10px 16px",
                        background: "var(--accent)",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                        transition: "all 0.2s",
                      }}
                    >
                      Link TP-Link Device
                    </button>
                  </div>

                  {/* Ubiquiti Device */}
                  <div
                    className="yaba-card"
                    style={{
                      padding: "20px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "12px",
                      }}
                    >
                      <div style={{ fontSize: "24px" }}>🌐</div>
                      <div>
                        <h4
                          style={{
                            margin: "0 0 4px 0",
                            fontSize: "16px",
                            color: "var(--text-primary)",
                          }}
                        >
                          Ubiquiti Device
                        </h4>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "12px",
                            color: "var(--text-muted)",
                          }}
                        >
                          UniFi compatible
                        </p>
                      </div>
                    </div>
                    <p
                      style={{
                        margin: "0 0 16px 0",
                        fontSize: "14px",
                        color: "var(--text-muted)",
                      }}
                    >
                      Link Ubiquiti devices with UniFi controller integration
                    </p>
                    <button
                      onClick={() => {
                        setFormData({
                          deviceName: "",
                          deviceType: "ubiquiti",
                          serviceType: "hotspot",
                          interfaces: [],
                        });
                        setShowDeviceWizard(true);
                      }}
                      style={{
                        width: "100%",
                        padding: "10px 16px",
                        background: "var(--accent)",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                        transition: "all 0.2s",
                      }}
                    >
                      Link Ubiquiti Device
                    </button>
                  </div>
                </div>
              </div>

              {/* My Map Preview Section */}
              <div
                className="yaba-card"
                style={{
                  padding: "24px",
                  marginBottom: "24px",
                  color: "var(--text-primary)",
                }}
              >
                <h3 style={{ margin: "0 0 16px 0", fontSize: "20px" }}>
                  🗺️ My Map Preview
                </h3>
                <p style={{ margin: "0 0 20px 0", color: "var(--text-muted)" }}>
                  See your hotspot locations and enable WiFi users to find your
                  hotspots around the area
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                    gap: "20px",
                  }}
                >
                  {/* Map Preview */}
                  <div
                    className="yaba-card"
                    style={{
                      padding: "20px",
                      minHeight: "200px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "16px",
                      }}
                    >
                      <div style={{ fontSize: "24px" }}>📍</div>
                      <div>
                        <h4
                          style={{
                            margin: "0 0 4px 0",
                            fontSize: "16px",
                            color: "var(--text-primary)",
                          }}
                        >
                          Hotspot Locations
                        </h4>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "12px",
                            color: "var(--text-muted)",
                          }}
                        >
                          Current hotspots: {devicesView.hotspots.length}
                        </p>
                      </div>
                    </div>

                    {devicesView.hotspots.length > 0 ? (
                      <div style={{ marginBottom: "16px" }}>
                        {devicesView.hotspots
                          .slice(0, 3)
                          .map((hotspot, index) => (
                            <div
                              key={hotspot.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                marginBottom: "8px",
                                padding: "8px",
                                background: "rgba(255, 255, 255, 0.1)",
                                borderRadius: "6px",
                              }}
                            >
                              <span style={{ fontSize: "12px" }}>📍</span>
                              <span style={{ fontSize: "14px", flex: 1 }}>
                                {hotspot.name}
                              </span>
                              <span
                                style={{
                                  fontSize: "10px",
                                  padding: "2px 6px",
                                  borderRadius: "10px",
                                  backgroundColor:
                                    hotspot.status === "online"
                                      ? "rgba(34, 197, 94, 0.3)"
                                      : "rgba(239, 68, 68, 0.3)",
                                  color:
                                    hotspot.status === "online"
                                      ? "#22c55e"
                                      : "#ef4444",
                                }}
                              >
                                {hotspot.status}
                              </span>
                            </div>
                          ))}
                        {devicesView.hotspots.length > 3 && (
                          <p
                            style={{
                              fontSize: "12px",
                              opacity: 0.8,
                              textAlign: "center",
                              margin: "8px 0 0 0",
                            }}
                          >
                            +{devicesView.hotspots.length - 3} more hotspots
                          </p>
                        )}
                      </div>
                    ) : (
                      <div style={{ textAlign: "center", padding: "20px 0" }}>
                        <div style={{ fontSize: "32px", marginBottom: "8px" }}>
                          🗺️
                        </div>
                        <p
                          style={{ margin: 0, fontSize: "14px", opacity: 0.8 }}
                        >
                          No hotspots yet
                        </p>
                      </div>
                    )}

                    <button
                      onClick={() => setActiveSection("hotspots")}
                      style={{
                        width: "100%",
                        padding: "10px 16px",
                        background: "rgba(255, 255, 255, 0.2)",
                        color: "#ffffff",
                        border: "1px solid rgba(255, 255, 255, 0.3)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={(e) =>
                        (e.target.style.background = "rgba(255, 255, 255, 0.3)")
                      }
                      onMouseLeave={(e) =>
                        (e.target.style.background = "rgba(255, 255, 255, 0.2)")
                      }
                    >
                      View Full Map
                    </button>
                  </div>

                  {/* Location Capture */}
                  <div
                    className="yaba-card"
                    style={{
                      padding: "20px",
                      minHeight: "200px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "16px",
                      }}
                    >
                      <div style={{ fontSize: "24px" }}>📱</div>
                      <div>
                        <h4
                          style={{
                            margin: "0 0 4px 0",
                            fontSize: "16px",
                            color: "var(--text-primary)",
                          }}
                        >
                          Auto Location Capture
                        </h4>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "12px",
                            color: "var(--text-muted)",
                          }}
                        >
                          When adding devices
                        </p>
                      </div>
                    </div>

                    <div style={{ marginBottom: "16px" }}>
                      <p
                        style={{
                          margin: "0 0 12px 0",
                          fontSize: "14px",
                          color: "var(--text-muted)",
                        }}
                      >
                        When onboarding devices, we automatically capture:
                      </p>
                      <ul
                        style={{
                          margin: "0 0 16px 0",
                          paddingLeft: "20px",
                          fontSize: "14px",
                          color: "var(--text-muted)",
                        }}
                      >
                        <li>GPS coordinates (latitude/longitude)</li>
                        <li>Device location for hotspot mapping</li>
                        <li>Area coverage for WiFi users</li>
                      </ul>
                    </div>

                    <button
                      onClick={() => setShowDeviceWizard(true)}
                      style={{
                        width: "100%",
                        padding: "10px 16px",
                        background: "rgba(255, 255, 255, 0.2)",
                        color: "#ffffff",
                        border: "1px solid rgba(255, 255, 255, 0.3)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={(e) =>
                        (e.target.style.background = "rgba(255, 255, 255, 0.3)")
                      }
                      onMouseLeave={(e) =>
                        (e.target.style.background = "rgba(255, 255, 255, 0.2)")
                      }
                    >
                      Add Device with Location
                    </button>
                  </div>

                  {/* WiFi User Discovery */}
                  <div
                    className="yaba-card"
                    style={{
                      padding: "20px",
                      minHeight: "200px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "16px",
                      }}
                    >
                      <div style={{ fontSize: "24px" }}>🔍</div>
                      <div>
                        <h4
                          style={{
                            margin: "0 0 4px 0",
                            fontSize: "16px",
                            color: "var(--text-primary)",
                          }}
                        >
                          WiFi User Discovery
                        </h4>
                        <p
                          style={{
                            margin: 0,
                            fontSize: "12px",
                            color: "var(--text-muted)",
                          }}
                        >
                          Find nearby hotspots
                        </p>
                      </div>
                    </div>

                    <div style={{ marginBottom: "16px" }}>
                      <p
                        style={{
                          margin: "0 0 12px 0",
                          fontSize: "14px",
                          color: "var(--text-muted)",
                        }}
                      >
                        Enable WiFi users to discover your hotspots:
                      </p>
                      <ul
                        style={{
                          margin: "0 0 16px 0",
                          paddingLeft: "20px",
                          fontSize: "14px",
                          color: "var(--text-muted)",
                        }}
                      >
                        <li>Public hotspot directory</li>
                        <li>Location-based search</li>
                        <li>Real-time availability</li>
                      </ul>
                    </div>

                    <button
                      onClick={() => setActiveSection("hotspots")}
                      style={{
                        width: "100%",
                        padding: "10px 16px",
                        background: "rgba(255, 255, 255, 0.2)",
                        color: "#ffffff",
                        border: "1px solid rgba(255, 255, 255, 0.3)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={(e) =>
                        (e.target.style.background = "rgba(255, 255, 255, 0.3)")
                      }
                      onMouseLeave={(e) =>
                        (e.target.style.background = "rgba(255, 255, 255, 0.2)")
                      }
                    >
                      Manage Public Listing
                    </button>
                  </div>
                </div>
              </div>

              {/* Messages */}
              {deviceMessage && (
                <div
                  style={{
                    padding: "12px 16px",
                    backgroundColor: "#dcfce7",
                    border: "1px solid #bbf7d0",
                    borderRadius: 8,
                    color: "#166534",
                    marginBottom: 16,
                  }}
                >
                  {deviceMessage}
                </div>
              )}
              {deviceError && (
                <div
                  className="yaba-card"
                  style={{
                    padding: "12px 16px",
                    backgroundColor: "var(--danger)",
                    color: "#ffffff",
                    marginBottom: 16,
                    textAlign: "center",
                  }}
                >
                  {deviceError}
                </div>
              )}

              {/* Device List */}
              {devices.length === 0 ? (
                <div
                  className="yaba-card"
                  style={{
                    textAlign: "center",
                    padding: "60px 20px",
                    color: "var(--text-muted)",
                  }}
                >
                  <div style={{ fontSize: 48, marginBottom: 16 }}>📱</div>
                  <h4
                    style={{
                      margin: "0 0 8px 0",
                      color: "var(--text-primary)",
                    }}
                  >
                    No devices connected yet
                  </h4>
                  <p style={{ margin: 0, color: "var(--text-muted)" }}>
                    Get started by adding your first WiFi device
                  </p>
                  <button
                    onClick={() => setShowDeviceWizard(true)}
                    style={{
                      marginTop: 16,
                      padding: "12px 24px",
                      background: "var(--accent)",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: 500,
                      transition: "all 0.2s",
                    }}
                  >
                    Add Your First Device
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(350px, 1fr))",
                    gap: 20,
                  }}
                >
                  {devices.map((device) => (
                    <div
                      key={device.deviceId}
                      className="yaba-card"
                      style={{
                        padding: 24,
                        transition: "all 0.2s",
                      }}
                    >
                      {/* Device Header */}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: 16,
                        }}
                      >
                        <div>
                          <h4
                            style={{
                              margin: "0 0 8px 0",
                              fontSize: 18,
                              color: "var(--text-primary)",
                            }}
                          >
                            {device.deviceName}
                          </h4>
                          {device.routerIdentity && (
                            <p
                              style={{
                                margin: "0 0 8px 0",
                                fontSize: 13,
                                color: "var(--text-muted)",
                                fontStyle: "italic",
                              }}
                            >
                              Identity: {device.routerIdentity}
                            </p>
                          )}
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              marginBottom: 8,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                color: "var(--text-muted)",
                                background: "#f3f4f6",
                                padding: "4px 8px",
                                borderRadius: 6,
                                fontWeight: 500,
                              }}
                            >
                              {device.deviceType === "mikrotik"
                                ? "MikroTik"
                                : device.deviceType}
                            </span>
                            {Array.isArray(device.serviceType) ? (
                              device.serviceType.map((st) => (
                                <span
                                  key={st}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 12,
                                    color: "var(--text-muted)",
                                    background: "#f3f4f6",
                                    padding: "4px 8px",
                                    borderRadius: 6,
                                    fontWeight: 500,
                                  }}
                                >
                                  {getServiceTypeIcon(st)}
                                  {st.toUpperCase()}
                                </span>
                              ))
                            ) : (
                              <span
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  fontSize: 12,
                                  color: "var(--text-muted)",
                                  background: "#f3f4f6",
                                  padding: "4px 8px",
                                  borderRadius: 6,
                                  fontWeight: 500,
                                }}
                              >
                                {getServiceTypeIcon(device.serviceType)}
                                {device.serviceType.toUpperCase()}
                              </span>
                            )}
                            {device.antiSharing && (
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "#166534",
                                  background: "#dcfce7",
                                  padding: "4px 8px",
                                  borderRadius: 6,
                                  fontWeight: 500,
                                }}
                              >
                                🔒 Anti-Sharing
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              backgroundColor: getStatusColor(device.status),
                            }}
                          />
                          <span
                            style={{
                              fontSize: 12,
                              color: "var(--text-muted)",
                              fontWeight: 500,
                            }}
                          >
                            {getStatusText(device.status)}
                          </span>
                        </div>
                      </div>

                      {/* Device Details */}
                      <div style={{ marginBottom: 20 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginBottom: 8,
                            fontSize: 14,
                          }}
                        >
                          <span style={{ color: "var(--text-muted)" }}>
                            Interfaces:
                          </span>
                          <span
                            style={{
                              fontFamily: "monospace",
                              color: "var(--text-primary)",
                              fontWeight: 500,
                            }}
                          >
                            {device.interfaces?.join(", ") || "None"}
                          </span>
                        </div>
                        {device.wanIp && (
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 8,
                              fontSize: 14,
                            }}
                          >
                            <span style={{ color: "var(--text-muted)" }}>
                              WAN IP:
                            </span>
                            <span
                              style={{
                                fontFamily: "monospace",
                                color: "var(--text-primary)",
                                fontWeight: 500,
                              }}
                            >
                              {device.wanIp}
                            </span>
                          </div>
                        )}
                        {device.location && (
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 8,
                              fontSize: 14,
                            }}
                          >
                            <span style={{ color: "var(--text-muted)" }}>
                              📍 Location:
                            </span>
                            <span
                              style={{
                                fontFamily: "monospace",
                                color: "var(--text-primary)",
                                fontWeight: 500,
                              }}
                            >
                              {device.location.lat?.toFixed(4)},{" "}
                              {device.location.lng?.toFixed(4)}
                            </span>
                          </div>
                        )}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 14,
                          }}
                        >
                          <span style={{ color: "var(--text-muted)" }}>
                            Created:
                          </span>
                          <span style={{ color: "var(--text-primary)" }}>
                            {device.createdAt
                              ? new Date(device.createdAt).toLocaleDateString()
                              : "Unknown"}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          onClick={async () => {
                            try {
                              const response = await axios.get(
                                `http://localhost:5000/api/devices/${device.deviceId}/ping`
                              );
                              if (response.data.success) {
                                alert(
                                  `✅ Router is reachable!\n\nResponse time: ${
                                    response.data.pingTime || "N/A"
                                  }ms\nStatus: ${response.data.status}`
                                );
                              } else {
                                alert(
                                  `❌ Router is not reachable.\n\n${
                                    response.data.message ||
                                    "Please check the router connection and configuration."
                                  }`
                                );
                              }
                            } catch (err) {
                              alert(
                                `❌ Ping test failed: ${
                                  err.response?.data?.message || err.message
                                }`
                              );
                            }
                          }}
                          style={{
                            padding: "8px 16px",
                            background: "#10b981",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 14,
                            fontWeight: 500,
                            flex: 1,
                          }}
                        >
                          📡 Ping Test
                        </button>
                        <button
                          onClick={() => openRouterLogs(device)}
                          style={{
                            padding: "8px 16px",
                            background: "#111827",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 14,
                            fontWeight: 500,
                            flex: 1,
                          }}
                        >
                          📜 Logs
                        </button>
                        <button
                          onClick={() => handleEditDevice(device)}
                          style={{
                            padding: "8px 16px",
                            background: "#3b82f6",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 14,
                            fontWeight: 500,
                            flex: 1,
                          }}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => handleDeleteDevice(device.deviceId)}
                          style={{
                            padding: "8px 16px",
                            background: "#ef4444",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 14,
                            fontWeight: 500,
                            flex: 1,
                          }}
                        >
                          🗑️ Unlink
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeSection === "campaigns" && (
            <div>
              <h2 style={{ marginBottom: 16 }}>Campaigns</h2>
              {/* Combine packages, vouchers, royalty points, payment toggles */}
              <div style={{ display: "grid", gap: 20 }}>
                <div>
                  <h3 style={{ margin: "0 0 10px 0" }}>Packages</h3>
                  <OwnerPackages />
                </div>
                <div style={{ width: "100%", minHeight: "400px" }}>
                  <h3 style={{ margin: "0 0 10px 0" }}>Vouchers</h3>
                  <div style={{ width: "100%", height: "100%" }}>
                    <VoucherManager
                      ownerId={ownerId}
                      onClose={() => setActiveSection("dashboard")}
                    />
                  </div>
                </div>
                {/* Payment method toggles could live here if available */}
              </div>
            </div>
          )}

          {activeSection === "payments" && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <h2 style={{ margin: 0 }}>Payment Dashboard</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    style={{
                      padding: "8px 12px",
                      background: "var(--surface-3)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--stroke)",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Filter
                  </button>
                  <a
                    href={`/api/owners/${ownerId}/reports/export/csv`}
                    style={{
                      padding: "8px 12px",
                      background: "var(--accent)",
                      color: "#fff",
                      borderRadius: 8,
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    Export
                  </a>
                </div>
              </div>
              <div style={{ color: "var(--text-muted)", marginBottom: 16 }}>
                Track your revenue and manage withdrawals
              </div>

              {/* Metrics cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                {/* Available Balance - Green Card */}
                <div
                  className="yaba-card"
                  style={{
                    background: "var(--success)",
                    border: "1px solid var(--success)",
                    color: "#fff",
                  }}
                >
                  <div
                    className="yaba-muted"
                    style={{ opacity: 0.9, fontSize: 12, marginBottom: 8 }}
                  >
                    Available Balance
                  </div>
                  <div
                    className="yaba-card-title"
                    style={{
                      fontSize: 28,
                      fontWeight: 800,
                      marginBottom: 12,
                      color: "#fff",
                    }}
                  >
                    {formatUGX(walletBalance)}
                  </div>
                  <button
                    onClick={() => setShowWithdrawModal(true)}
                    className="yaba-btn yaba-btn--secondary"
                    style={{
                      background: "#fff",
                      color: "#166534",
                      border: "none",
                      borderRadius: 10,
                      padding: "12px 16px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Withdraw Funds
                  </button>
                </div>

                {/* This Month */}
                <div className="yaba-card">
                  <div
                    className="yaba-muted"
                    style={{ fontSize: 12, marginBottom: 6 }}
                  >
                    This Month
                  </div>
                  <div
                    className="yaba-card-title"
                    style={{ fontSize: 22, fontWeight: 700 }}
                  >
                    {formatUGX(
                      walletTx
                        .filter(
                          (t) =>
                            t.type !== "withdrawal" &&
                            new Date(t.date || t.createdAt || 0).getMonth() ===
                              new Date().getMonth()
                        )
                        .reduce((s, t) => s + Number(t.amount || 0), 0)
                    )}
                  </div>
                  <div
                    className="yaba-muted"
                    style={{
                      color: "var(--success)",
                      fontSize: 12,
                      marginTop: 6,
                    }}
                  >
                    ↗ +12.5% from last month
                  </div>
                </div>

                {/* Total Withdrawn */}
                <div className="yaba-card">
                  <div
                    className="yaba-muted"
                    style={{ fontSize: 12, marginBottom: 6 }}
                  >
                    Total Withdrawn
                  </div>
                  <div
                    className="yaba-card-title"
                    style={{ fontSize: 22, fontWeight: 700 }}
                  >
                    {formatUGX(
                      walletTx
                        .filter((t) => t.type === "withdrawal")
                        .reduce((s, t) => s + Number(t.amount || 0), 0)
                    )}
                  </div>
                  <div
                    className="yaba-muted"
                    style={{ color: "#7c3aed", fontSize: 12, marginTop: 6 }}
                  >
                    ↘ Via Mobile Money
                  </div>
                </div>

                {/* Avg Transaction */}
                <div className="yaba-card">
                  <div
                    className="yaba-muted"
                    style={{ fontSize: 12, marginBottom: 6 }}
                  >
                    Avg. Transaction
                  </div>
                  <div
                    className="yaba-card-title"
                    style={{ fontSize: 22, fontWeight: 700 }}
                  >
                    {formatUGX(
                      walletTx.length
                        ? walletTx.reduce(
                            (s, t) => s + Number(t.amount || 0),
                            0
                          ) / walletTx.length
                        : 0
                    )}
                  </div>
                </div>
              </div>

              {/* Simple bar chart replacement using CSS (no extra deps) */}
              <div className="yaba-card" style={{ marginBottom: 16 }}>
                <div className="yaba-card-title" style={{ marginBottom: 8 }}>
                  Revenue vs Withdrawals
                </div>
                {(() => {
                  const agg = monthlyAgg(walletTx);
                  const keys = Object.keys(agg).sort();
                  const max = Math.max(
                    1,
                    ...keys.map((k) =>
                      Math.max(agg[k].credit, agg[k].withdrawal)
                    )
                  );
                  return (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${Math.max(
                          keys.length,
                          1
                        )}, 1fr)`,
                        gap: 8,
                        alignItems: "end",
                        height: 220,
                      }}
                    >
                      {keys.map((k) => (
                        <div
                          key={k}
                          style={{
                            display: "grid",
                            gridTemplateRows: "1fr auto",
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "flex-end",
                              gap: 6,
                            }}
                          >
                            <div
                              title={`Revenue ${formatUGX(agg[k].credit)}`}
                              style={{
                                width: "50%",
                                height: `${(agg[k].credit / max) * 100}%`,
                                background: "#3b82f6",
                                borderRadius: 6,
                              }}
                            />
                            <div
                              title={`Withdrawals ${formatUGX(
                                agg[k].withdrawal
                              )}`}
                              style={{
                                width: "50%",
                                height: `${(agg[k].withdrawal / max) * 100}%`,
                                background: "#10b981",
                                borderRadius: 6,
                              }}
                            />
                          </div>
                          <div
                            style={{
                              textAlign: "center",
                              fontSize: 12,
                              color: "var(--text-muted)",
                            }}
                          >
                            {k}
                          </div>
                        </div>
                      ))}
                      {keys.length === 0 && (
                        <div style={{ color: "var(--text-muted)" }}>
                          No data yet
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Recent Transactions */}
              <div className="yaba-card" style={{ padding: 16 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>Recent Transactions</div>
                  <a
                    href={`/api/owners/${ownerId}/reports/export/csv`}
                    style={{
                      color: "#2563eb",
                      textDecoration: "none",
                      fontSize: 14,
                    }}
                  >
                    Export CSV
                  </a>
                </div>
                <div style={{ width: "100%", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr
                        style={{
                          textAlign: "left",
                          color: "var(--text-muted)",
                          fontSize: 12,
                        }}
                      >
                        <th
                          style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          Transaction
                        </th>
                        <th
                          style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          Amount
                        </th>
                        <th
                          style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          User/Description
                        </th>
                        <th
                          style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          Hotspot
                        </th>
                        <th
                          style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          Date
                        </th>
                        <th
                          style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid #e5e7eb",
                          }}
                        >
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {walletTx.length === 0 && (
                        <tr>
                          <td
                            colSpan="6"
                            style={{ padding: 12, color: "var(--text-muted)" }}
                          >
                            No transactions yet.
                          </td>
                        </tr>
                      )}
                      {walletTx.map((tx, idx) => (
                        <tr key={idx}>
                          <td
                            style={{
                              padding: "10px 8px",
                              borderBottom: "1px solid #f1f5f9",
                            }}
                          >
                            {tx.type === "withdrawal"
                              ? "Withdrawal"
                              : "Payment"}
                          </td>
                          <td
                            style={{
                              padding: "10px 8px",
                              borderBottom: "1px solid #f1f5f9",
                              color:
                                tx.type === "withdrawal"
                                  ? "#b91c1c"
                                  : "#059669",
                              fontWeight: 700,
                            }}
                          >
                            {tx.type === "withdrawal"
                              ? `- ${formatUGX(tx.amount)}`
                              : `+ ${formatUGX(tx.amount)}`}
                          </td>
                          <td
                            style={{
                              padding: "10px 8px",
                              borderBottom: "1px solid #f1f5f9",
                            }}
                          >
                            {tx.description || "-"}
                          </td>
                          <td
                            style={{
                              padding: "10px 8px",
                              borderBottom: "1px solid #f1f5f9",
                            }}
                          >
                            {tx.hotspot || "-"}
                          </td>
                          <td
                            style={{
                              padding: "10px 8px",
                              borderBottom: "1px solid #f1f5f9",
                            }}
                          >
                            {tx.date
                              ? new Date(tx.date).toLocaleDateString()
                              : "-"}
                          </td>
                          <td
                            style={{
                              padding: "10px 8px",
                              borderBottom: "1px solid #f1f5f9",
                            }}
                          >
                            <span
                              style={{
                                padding: "4px 10px",
                                borderRadius: 999,
                                background: "#dcfce7",
                                color: "#166534",
                                fontSize: 12,
                              }}
                            >
                              {tx.type === "withdrawal"
                                ? "Completed"
                                : "Completed"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Withdraw Modal */}
          {showWithdrawModal && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 50,
              }}
              onClick={() => setShowWithdrawModal(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="yaba-card"
                style={{ padding: 20, width: 420 }}
              >
                <h3 style={{ marginTop: 0, marginBottom: 10 }}>
                  Withdraw Funds
                </h3>
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 12,
                    marginBottom: 12,
                  }}
                >
                  Available: {formatUGX(walletBalance)}
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  <input
                    type="number"
                    placeholder="Amount"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    style={{
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Mobile Money Number"
                    value={mobileMoneyNumber}
                    onChange={(e) => setMobileMoneyNumber(e.target.value)}
                    style={{
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                    }}
                  />
                </div>
                {walletMsg && <div style={{ marginTop: 8 }}>{walletMsg}</div>}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                    marginTop: 14,
                  }}
                >
                  <button
                    onClick={() => setShowWithdrawModal(false)}
                    style={{
                      padding: "8px 12px",
                      border: "1px solid var(--stroke)",
                      borderRadius: 8,
                      background: "var(--surface)",
                      color: "var(--text-primary)",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      await handleWithdraw();
                      setShowWithdrawModal(false);
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "var(--success)",
                      color: "#fff",
                      fontWeight: 700,
                    }}
                  >
                    Confirm Withdraw
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === "devices" && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <div>
                  <h2 style={{ margin: 0 }}>Device Management</h2>
                  <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
                    Monitor connected devices and usage patterns
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    style={{
                      padding: "8px 12px",
                      background: "var(--surface-3)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--stroke)",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Refresh
                  </button>
                  <button
                    style={{
                      padding: "8px 12px",
                      background: "var(--accent)",
                      color: "#fff",
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Export
                  </button>
                </div>
              </div>

              {/* Device Stats Cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 16,
                  marginBottom: 24,
                }}
              >
                <div className="yaba-card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      Total Devices
                    </div>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        background: "var(--surface-3)",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      📱
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: "var(--accent)",
                      marginBottom: 4,
                    }}
                  >
                    {deviceStats.totalDevices}
                  </div>
                  <div style={{ color: "var(--accent)", fontSize: 12 }}>
                    All time devices
                  </div>
                </div>

                <div className="yaba-card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      Online Now
                    </div>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        background: "var(--surface-3)",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      🟢
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: "var(--success)",
                      marginBottom: 4,
                    }}
                  >
                    {deviceStats.onlineDevices}
                  </div>
                  <div style={{ color: "var(--success)", fontSize: 12 }}>
                    Currently connected
                  </div>
                </div>

                <div className="yaba-card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      Hotspots
                    </div>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        background: "#f3e8ff",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      📶
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: "#7c3aed",
                      marginBottom: 4,
                    }}
                  >
                    {Object.keys(deviceStats.hotspotDevices).length}
                  </div>
                  <div style={{ color: "#7c3aed", fontSize: 12 }}>
                    Active hotspots
                  </div>
                </div>
              </div>

              {/* Device Chart and List */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr",
                  gap: 24,
                  marginBottom: 24,
                }}
              >
                {/* Device Activity Chart */}
                <div className="yaba-card" style={{ padding: 20 }}>
                  <h3 style={{ margin: "0 0 16px 0" }}>Device Activity</h3>
                  <div
                    style={{
                      height: 200,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-muted)",
                    }}
                  >
                    {deviceChartData.labels.length > 0 ? (
                      <div style={{ textAlign: "center" }}>
                        <div
                          style={{
                            fontSize: 24,
                            fontWeight: 700,
                            color: "#2563eb",
                            marginBottom: 8,
                          }}
                        >
                          {deviceStats.onlineDevices}
                        </div>
                        <div>Devices currently online</div>
                      </div>
                    ) : (
                      <div style={{ textAlign: "center" }}>
                        <div
                          style={{
                            fontSize: 24,
                            fontWeight: 700,
                            color: "var(--text-muted)",
                            marginBottom: 8,
                          }}
                        >
                          0
                        </div>
                        <div>No device activity yet</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Device Types Breakdown */}
                <div className="yaba-card" style={{ padding: 20 }}>
                  <h3 style={{ margin: "0 0 16px 0" }}>Device Types</h3>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    {Object.keys(deviceStats.deviceTypes).length === 0 ? (
                      <div
                        style={{
                          textAlign: "center",
                          color: "var(--text-muted)",
                          fontSize: 12,
                          padding: 20,
                        }}
                      >
                        No devices connected yet
                      </div>
                    ) : (
                      Object.entries(deviceStats.deviceTypes).map(
                        ([type, count]) => {
                          const colors = {
                            Mobile: "var(--accent)",
                            Laptop: "var(--accent)",
                            Tablet: "var(--accent)",
                            Desktop: "var(--accent)",
                            Unknown: "var(--text-muted)",
                          };
                          const percentage =
                            deviceStats.totalDevices > 0
                              ? Math.round(
                                  (count / deviceStats.totalDevices) * 100
                                )
                              : 0;
                          return (
                            <div
                              key={type}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <div
                                style={{
                                  width: 12,
                                  height: 12,
                                  background: colors[type] || "#6b7280",
                                  borderRadius: "50%",
                                }}
                              ></div>
                              <div style={{ flex: 1, fontSize: 12 }}>
                                {type}
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>
                                {count} ({percentage}%)
                              </div>
                            </div>
                          );
                        }
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === "analytics" && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <div>
                  <h2 style={{ margin: 0 }}>Analytics</h2>
                  <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
                    Comprehensive insights and performance metrics
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select
                    style={{
                      padding: "8px 12px",
                      border: "1px solid var(--control-stroke)",
                      borderRadius: 8,
                      background: "var(--control)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <option>Last 7 days</option>
                    <option>Last 30 days</option>
                    <option>Last 3 months</option>
                  </select>
                  <button
                    style={{
                      padding: "8px 12px",
                      background: "var(--accent)",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                  >
                    Export
                  </button>
                </div>
              </div>

              {/* Key Metrics Cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 16,
                  marginBottom: 24,
                }}
              >
                <div className="yaba-card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      Total Revenue
                    </div>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        background: "var(--surface-3)",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      💰
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: "var(--success)",
                      marginBottom: 4,
                    }}
                  >
                    {formatUGX(dashboardStats.totalRevenue)}
                  </div>
                  <div style={{ color: "var(--success)", fontSize: 12 }}>
                    ↗ +0% vs last period
                  </div>
                </div>

                <div className="yaba-card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      Active Users
                    </div>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        background: "#dbeafe",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      👥
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: "#2563eb",
                      marginBottom: 4,
                    }}
                  >
                    {dashboardStats.activeUsers.toLocaleString()}
                  </div>
                  <div style={{ color: "#2563eb", fontSize: 12 }}>
                    ↗ +0% vs last period
                  </div>
                </div>

                <div className="yaba-card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      Total Sessions
                    </div>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        background: "#f3e8ff",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      📶
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: "#7c3aed",
                      marginBottom: 4,
                    }}
                  >
                    {dashboardStats.totalCustomers.toLocaleString()}
                  </div>
                  <div style={{ color: "#7c3aed", fontSize: 12 }}>
                    ↗ +0% vs last period
                  </div>
                </div>

                <div className="yaba-card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      Avg Utilization
                    </div>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        background: "#fef3c7",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      📊
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: "#d97706",
                      marginBottom: 4,
                    }}
                  >
                    0%
                  </div>
                  <div style={{ color: "#d97706", fontSize: 12 }}>
                    ↗ +0% vs last period
                  </div>
                </div>
              </div>

              {/* Charts Row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr",
                  gap: 24,
                  marginBottom: 24,
                }}
              >
                {/* Performance Trends Chart */}
                <div className="yaba-card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 16,
                    }}
                  >
                    <h3 style={{ margin: 0 }}>Performance Trends</h3>
                    <select
                      style={{
                        padding: "6px 10px",
                        border: "1px solid var(--stroke)",
                        borderRadius: 6,
                        background: "var(--surface)",
                        fontSize: 12,
                        color: "var(--text-primary)",
                      }}
                    >
                      <option>Revenue</option>
                      <option>Users</option>
                      <option>Sessions</option>
                    </select>
                  </div>
                  <div
                    style={{
                      height: 200,
                      display: "flex",
                      alignItems: "end",
                      justifyContent: "space-between",
                      padding: "0 20px",
                    }}
                  >
                    {(() => {
                      // Generate last 7 days data based on real transactions
                      const last7Days = [];
                      for (let i = 6; i >= 0; i--) {
                        const date = new Date();
                        date.setDate(date.getDate() - i);
                        const dayRevenue = walletTx
                          .filter((tx) => {
                            const txDate = new Date(
                              tx.date || tx.createdAt || Date.now()
                            );
                            return (
                              txDate.toDateString() === date.toDateString() &&
                              tx.type !== "withdrawal"
                            );
                          })
                          .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
                        last7Days.push({
                          value: dayRevenue,
                          date: date.toISOString().slice(5, 10),
                        });
                      }
                      const maxValue = Math.max(
                        1,
                        ...last7Days.map((d) => d.value)
                      );
                      return last7Days.map((day, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              width: 20,
                              height: `${(day.value / maxValue) * 100}%`,
                              background: "#2563eb",
                              borderRadius: 4,
                            }}
                          ></div>
                          <div
                            style={{ fontSize: 10, color: "var(--text-muted)" }}
                          >
                            {day.date}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                {/* Hotspot Performance Chart */}
                <div className="yaba-card" style={{ padding: 20 }}>
                  <h3 style={{ margin: "0 0 16px 0" }}>Hotspot Performance</h3>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    {devicesView.hotspots.length === 0 ? (
                      <div
                        style={{
                          textAlign: "center",
                          color: "var(--text-muted)",
                          fontSize: 12,
                          padding: 20,
                        }}
                      >
                        No hotspots created yet
                      </div>
                    ) : (
                      devicesView.hotspots.slice(0, 3).map((hotspot, i) => {
                        // Calculate performance based on real data
                        const hotspotRevenue = walletTx
                          .filter(
                            (tx) =>
                              tx.hotspotId === hotspot.id &&
                              tx.type !== "withdrawal"
                          )
                          .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
                        const performance =
                          hotspotRevenue > 0
                            ? Math.min(100, (hotspotRevenue / 1000) * 10)
                            : 0; // Scale based on revenue
                        return (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                width: 8,
                                height: 8,
                                background: "#2563eb",
                                borderRadius: "50%",
                              }}
                            ></div>
                            <div
                              style={{
                                flex: 1,
                                fontSize: 12,
                                color: "var(--text-muted)",
                              }}
                            >
                              {hotspot.name || `Hotspot ${i + 1}`}
                            </div>
                            <div
                              style={{
                                width: 60,
                                height: 6,
                                background: "#f1f5f9",
                                borderRadius: 3,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${performance}%`,
                                  height: "100%",
                                  background: "#2563eb",
                                }}
                              ></div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Charts Row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 24,
                  marginBottom: 24,
                }}
              >
                {/* Trending Packages */}
                <div className="yaba-card" style={{ padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 16,
                    }}
                  >
                    <h3 style={{ margin: 0 }}>Trending Packages</h3>
                    <select
                      style={{
                        padding: "6px 10px",
                        border: "1px solid var(--stroke)",
                        borderRadius: 6,
                        background: "var(--surface)",
                        fontSize: 12,
                        color: "var(--text-primary)",
                      }}
                    >
                      {devicesView.hotspots.map((h, i) => (
                        <option key={i} value={h.id}>
                          {h.name || `Hotspot ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {packages.length === 0 ? (
                      <div
                        style={{
                          textAlign: "center",
                          color: "var(--text-muted)",
                          fontSize: 12,
                          padding: 20,
                        }}
                      >
                        No packages created yet
                      </div>
                    ) : (
                      packages.slice(0, 4).map((pkg, i) => {
                        // Calculate package performance based on real sales
                        const packageSales = walletTx.filter(
                          (tx) =>
                            tx.description &&
                            tx.description.includes(pkg.packageName || pkg.name)
                        ).length;
                        const growthRate =
                          packageSales > 0
                            ? Math.min(100, packageSales * 5)
                            : 0; // Scale based on actual sales
                        return (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "8px 0",
                              borderBottom:
                                i < 3 ? "1px solid #f1f5f9" : "none",
                            }}
                          >
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>
                                {pkg.packageName || pkg.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "var(--text-muted)",
                                }}
                              >
                                {pkg.duration}
                              </div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>
                                {formatUGX(pkg.price)}
                              </div>
                              <div style={{ fontSize: 10, color: "#16a34a" }}>
                                +{growthRate}%
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Peak Usage Hours */}
                <div className="yaba-card" style={{ padding: 20 }}>
                  <h3 style={{ margin: "0 0 16px 0" }}>Peak Usage Hours</h3>
                  <div
                    style={{
                      height: 120,
                      display: "flex",
                      alignItems: "end",
                      justifyContent: "space-between",
                    }}
                  >
                    {(() => {
                      // Generate usage data based on real transaction times
                      const hours = [
                        "06",
                        "08",
                        "10",
                        "12",
                        "14",
                        "16",
                        "18",
                        "20",
                        "22",
                        "24",
                      ];
                      const usageData = hours.map((hour) => {
                        const hourNum = parseInt(hour);
                        const usage = walletTx.filter((tx) => {
                          const txDate = new Date(
                            tx.date || tx.createdAt || Date.now()
                          );
                          return (
                            txDate.getHours() >= hourNum &&
                            txDate.getHours() < hourNum + 2
                          );
                        }).length;
                        return { hour, usage: Math.min(100, usage * 10) }; // Scale usage
                      });
                      const maxUsage = Math.max(
                        1,
                        ...usageData.map((d) => d.usage)
                      );
                      return usageData.map((data, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <div
                            style={{
                              width: 12,
                              height: `${(data.usage / maxUsage) * 100}%`,
                              background: "#16a34a",
                              borderRadius: 2,
                            }}
                          ></div>
                          <div
                            style={{ fontSize: 8, color: "var(--text-muted)" }}
                          >
                            {data.hour}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </div>

              {/* Detailed Hotspot Analytics Table */}
              <div
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--stroke)",
                  borderRadius: 12,
                  padding: 20,
                }}
              >
                <h3 style={{ margin: "0 0 16px 0" }}>
                  Detailed Hotspot Analytics
                </h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                        <th
                          style={{
                            padding: "12px 8px",
                            textAlign: "left",
                            fontSize: 12,
                            color: "var(--text-muted)",
                            fontWeight: 600,
                          }}
                        >
                          HOTSPOT
                        </th>
                        <th
                          style={{
                            padding: "12px 8px",
                            textAlign: "left",
                            fontSize: 12,
                            color: "var(--text-muted)",
                            fontWeight: 600,
                          }}
                        >
                          REVENUE
                        </th>
                        <th
                          style={{
                            padding: "12px 8px",
                            textAlign: "left",
                            fontSize: 12,
                            color: "var(--text-muted)",
                            fontWeight: 600,
                          }}
                        >
                          USERS
                        </th>
                        <th
                          style={{
                            padding: "12px 8px",
                            textAlign: "left",
                            fontSize: 12,
                            color: "var(--text-muted)",
                            fontWeight: 600,
                          }}
                        >
                          UTILIZATION
                        </th>
                        <th
                          style={{
                            padding: "12px 8px",
                            textAlign: "left",
                            fontSize: 12,
                            color: "var(--text-muted)",
                            fontWeight: 600,
                          }}
                        >
                          PERFORMANCE
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {devicesView.hotspots.length === 0 ? (
                        <tr>
                          <td
                            colSpan="5"
                            style={{
                              padding: "20px",
                              textAlign: "center",
                              color: "var(--text-muted)",
                            }}
                          >
                            No hotspots created yet
                          </td>
                        </tr>
                      ) : (
                        devicesView.hotspots.map((hotspot, i) => {
                          // Calculate real metrics
                          const revenue = walletTx
                            .filter(
                              (tx) =>
                                tx.hotspotId === hotspot.id &&
                                tx.type !== "withdrawal"
                            )
                            .reduce(
                              (sum, tx) => sum + Number(tx.amount || 0),
                              0
                            );
                          const users = walletTx.filter(
                            (tx) =>
                              tx.hotspotId === hotspot.id &&
                              tx.type !== "withdrawal"
                          ).length;
                          const utilization =
                            users > 0 ? Math.min(100, (users / 10) * 10) : 0; // Scale based on actual usage
                          const performance =
                            utilization > 80
                              ? "Excellent"
                              : utilization > 60
                              ? "Good"
                              : utilization > 0
                              ? "Fair"
                              : "No Activity";
                          const perfColor =
                            utilization > 80
                              ? "#16a34a"
                              : utilization > 60
                              ? "#d97706"
                              : utilization > 0
                              ? "#f59e0b"
                              : "#6b7280";
                          return (
                            <tr
                              key={i}
                              style={{ borderBottom: "1px solid #f1f5f9" }}
                            >
                              <td
                                style={{
                                  padding: "12px 8px",
                                  fontSize: 12,
                                  fontWeight: 600,
                                }}
                              >
                                {hotspot.name || `Hotspot ${i + 1}`}
                              </td>
                              <td style={{ padding: "12px 8px", fontSize: 12 }}>
                                {formatUGX(revenue)}
                              </td>
                              <td style={{ padding: "12px 8px", fontSize: 12 }}>
                                {users}
                              </td>
                              <td style={{ padding: "12px 8px", fontSize: 12 }}>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                >
                                  <div
                                    style={{
                                      width: 60,
                                      height: 6,
                                      background: "#f1f5f9",
                                      borderRadius: 3,
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: `${utilization}%`,
                                        height: "100%",
                                        background: "#2563eb",
                                      }}
                                    ></div>
                                  </div>
                                  <span>{utilization}%</span>
                                </div>
                              </td>
                              <td style={{ padding: "12px 8px", fontSize: 12 }}>
                                <span
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: 12,
                                    background: perfColor,
                                    color: "#fff",
                                    fontSize: 10,
                                    fontWeight: 600,
                                  }}
                                >
                                  {performance}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeSection === "referrals" && (
            <div>
              <OwnerReferrals ownerId={ownerId} hotspotId={selectedHotspotId} />
            </div>
          )}

          {activeSection === "branding" && (
            <div className="yaba-card" style={{ marginBottom: "24px" }}>
              {/* Header */}
              <div style={{ padding: "24px 24px 0 24px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 24,
                    flexWrap: "wrap",
                    gap: "16px",
                  }}
                >
                  <div>
                    <h2
                      className="yaba-card-title"
                      style={{ fontSize: 24, fontWeight: 600 }}
                    >
                      Branding & Customization
                    </h2>
                    <p
                      className="yaba-muted"
                      style={{ margin: 0, fontSize: 14 }}
                    >
                      Customize how your WiFi portal looks and feels for users.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <button
                      onClick={() =>
                        setShowBrandingPreview(!showBrandingPreview)
                      }
                      className="yaba-btn yaba-btn--secondary"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 16px",
                        fontSize: 14,
                        fontWeight: 500,
                      }}
                    >
                      <FaEye />
                      Show Preview
                    </button>
                    <button
                      onClick={handleSaveBranding}
                      className="yaba-btn yaba-btn--secondary"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 16px",
                        fontSize: 14,
                        fontWeight: 500,
                      }}
                    >
                      <FaSave />
                      Save Draft
                    </button>
                    <button
                      onClick={handlePublishBranding}
                      className="yaba-btn yaba-btn--accent"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 16px",
                        fontSize: 14,
                        fontWeight: 500,
                      }}
                    >
                      <FaPaperPlane />
                      Publish Changes
                    </button>
                  </div>
                </div>

                {/* Hotspot Selection */}
                <div
                  className="yaba-card yaba-elev-2"
                  style={{ marginBottom: 24, padding: "20px" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 12,
                    }}
                  >
                    <FaWifi
                      style={{ color: "var(--text-muted)", fontSize: 16 }}
                    />
                    <h3
                      className="yaba-card-title"
                      style={{ fontSize: 16, fontWeight: 600 }}
                    >
                      Select Hotspot
                    </h3>
                  </div>
                  <p
                    className="yaba-muted"
                    style={{ margin: "0 0 12px 0", fontSize: 14 }}
                  >
                    Choose which hotspot to apply this branding to.
                  </p>

                  <div style={{ position: "relative", zIndex: 1000 }}>
                    <select
                      value={selectedBrandingHotspot}
                      onChange={(e) =>
                        setSelectedBrandingHotspot(e.target.value)
                      }
                      className="yaba-select"
                      style={{
                        width: "100%",
                        padding: "12px 16px",
                        fontSize: 14,
                        cursor: "pointer",
                        appearance: "none",
                        position: "relative",
                        zIndex: 1001,
                        backgroundImage:
                          "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e\")",
                        backgroundPosition: "right 12px center",
                        backgroundRepeat: "no-repeat",
                        backgroundSize: "16px",
                      }}
                    >
                      <option value="all">
                        All Hotspots - Apply to all hotspots
                      </option>
                      <option value="downtown">Downtown Cafe WiFi</option>
                      <option value="hotel">Hotel Lobby Guest</option>
                      <option value="restaurant">Restaurant Free WiFi</option>
                      <option value="airport">Airport Lounge</option>
                      <option value="mall">Shopping Mall Public</option>
                    </select>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginTop: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        color: "var(--text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      {selectedBrandingHotspot === "all"
                        ? "All Hotspots"
                        : "Selected Hotspot"}
                    </span>
                    <span className="yaba-muted" style={{ fontSize: 14 }}>
                      {selectedBrandingHotspot === "all"
                        ? "Apply to all hotspots"
                        : "Apply to this hotspot"}
                    </span>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginLeft: "auto",
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          backgroundColor: "#10b981",
                        }}
                      ></div>
                      <span
                        style={{
                          fontSize: 12,
                          color: "#10b981",
                          fontWeight: 500,
                        }}
                      >
                        Active
                      </span>
                    </div>
                  </div>

                  {selectedBrandingHotspot === "all" && (
                    <div
                      className="yaba-elev-1"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 12,
                        padding: "12px 16px",
                        backgroundColor: "var(--surface-2)",
                        borderRadius: 10,
                        border: "1px solid var(--stroke)",
                      }}
                    >
                      <FaCheck style={{ color: "#10b981", fontSize: 14 }} />
                      <span
                        style={{
                          fontSize: 14,
                          color: "#10b981",
                          fontWeight: 500,
                        }}
                      >
                        This branding will be applied to all 5 hotspots.
                      </span>
                    </div>
                  )}
                </div>

                {/* Branding Tabs */}
                <div
                  className="yaba-elev-1"
                  style={{
                    borderBottom: "1px solid var(--stroke)",
                    borderRadius: "10px 10px 0 0",
                    overflow: "hidden",
                  }}
                >
                  <nav style={{ display: "flex", gap: 0, overflowX: "auto" }}>
                    {[
                      { id: "logo", label: "Logo & Icon", icon: FaUpload },
                      {
                        id: "colors",
                        label: "Colors & Theme",
                        icon: FaPalette,
                      },
                      { id: "fonts", label: "Fonts & Styles", icon: FaFont },
                      {
                        id: "messages",
                        label: "Custom Messages",
                        icon: FaComment,
                      },
                      { id: "background", label: "Background", icon: FaImage },
                    ].map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setBrandingTab(tab.id)}
                          className={
                            brandingTab === tab.id
                              ? "yaba-btn yaba-btn--accent"
                              : "yaba-btn yaba-btn--secondary"
                          }
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "12px 16px",
                            border: "none",
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: "pointer",
                            borderRadius: 0,
                            whiteSpace: "nowrap",
                            minWidth: "fit-content",
                          }}
                        >
                          <Icon style={{ fontSize: 16 }} />
                          {tab.label}
                        </button>
                      );
                    })}
                  </nav>
                </div>
              </div>

              {/* Tab Content */}
              <div
                className="yaba-elev-1"
                style={{ padding: "24px", borderRadius: "0 0 10px 10px" }}
              >
                {brandingTab === "logo" && (
                  <div>
                    <div
                      className="yaba-card yaba-elev-2"
                      style={{ marginBottom: 24, padding: "20px" }}
                    >
                      <h4
                        className="yaba-card-title"
                        style={{ fontSize: 16, fontWeight: 600 }}
                      >
                        Upload Logo (PNG, JPG, SVG)
                      </h4>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <input
                          type="file"
                          id="logo-upload"
                          accept=".png,.jpg,.jpeg,.svg"
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (file) handleFileUpload(file, "logo");
                          }}
                          style={{ display: "none" }}
                        />
                        <label
                          htmlFor="logo-upload"
                          className="yaba-btn yaba-btn--accent"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "10px 16px",
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: "pointer",
                          }}
                        >
                          <FaUpload />
                          Choose File
                        </label>
                        <span className="yaba-muted" style={{ fontSize: 14 }}>
                          {uploadedFiles.logo
                            ? uploadedFiles.logo.name
                            : "No file chosen"}
                        </span>
                      </div>
                    </div>

                    <div>
                      <h4
                        style={{
                          margin: "0 0 8px 0",
                          fontSize: 16,
                          fontWeight: 600,
                          color: "var(--text-primary)",
                        }}
                      >
                        Upload Favicon (16x16 or 32x32 PNG)
                      </h4>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <input
                          type="file"
                          id="favicon-upload"
                          accept=".png"
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (file) handleFileUpload(file, "favicon");
                          }}
                          style={{ display: "none" }}
                        />
                        <label
                          htmlFor="favicon-upload"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "10px 16px",
                            border: "1px solid #3b82f6",
                            borderRadius: 8,
                            background: "#fff",
                            color: "#3b82f6",
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: "pointer",
                          }}
                        >
                          <FaUpload />
                          Choose File
                        </label>
                        <span
                          style={{ fontSize: 14, color: "var(--text-muted)" }}
                        >
                          {uploadedFiles.favicon
                            ? uploadedFiles.favicon.name
                            : "No file chosen"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {brandingTab === "colors" && (
                  <div>
                    <h4
                      style={{
                        margin: "0 0 16px 0",
                        fontSize: 16,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      Color Customization
                    </h4>
                    <p
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 14,
                        marginBottom: 24,
                      }}
                    >
                      Choose colors that match your brand identity.
                    </p>
                    {/* Color picker components would go here */}
                  </div>
                )}

                {brandingTab === "fonts" && (
                  <div>
                    <h4
                      style={{
                        margin: "0 0 16px 0",
                        fontSize: 16,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      Font & Typography
                    </h4>
                    <p
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 14,
                        marginBottom: 24,
                      }}
                    >
                      Customize fonts and text styles for your portal.
                    </p>
                    {/* Font selection components would go here */}
                  </div>
                )}

                {brandingTab === "messages" && (
                  <div>
                    <h4
                      style={{
                        margin: "0 0 16px 0",
                        fontSize: 16,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      Custom Messages
                    </h4>
                    <p
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 14,
                        marginBottom: 24,
                      }}
                    >
                      Set custom welcome messages and footer text.
                    </p>
                    {/* Message customization components would go here */}
                  </div>
                )}

                {brandingTab === "background" && (
                  <div>
                    <h4
                      style={{
                        margin: "0 0 16px 0",
                        fontSize: 16,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      Background Settings
                    </h4>
                    <p
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 14,
                        marginBottom: 24,
                      }}
                    >
                      Choose background colors, gradients, or images.
                    </p>
                    {/* Background customization components would go here */}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSection === "communication" && (
            <div>
              <h2 style={{ marginBottom: 16 }}>Communication</h2>
              <CommunicationCenter ownerId={ownerId} />
            </div>
          )}

          {activeSection === "reviews" && (
            <div>
              {/* Review Management Header */}
              <div
                className="yaba-card"
                style={{ padding: "24px", marginBottom: "24px" }}
              >
                <h1
                  style={{
                    margin: "0 0 8px 0",
                    fontSize: "28px",
                    fontWeight: "700",
                    color: "var(--text-primary)",
                  }}
                >
                  Review Management
                </h1>
                <p
                  style={{
                    margin: "0",
                    fontSize: "16px",
                    color: "var(--text-muted)",
                  }}
                >
                  Monitor and respond to customer feedback
                </p>
              </div>

              {/* Review Statistics */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: "20px",
                  marginBottom: "32px",
                }}
              >
                {/* Average Rating Card */}
                <div
                  className="yaba-card"
                  style={{ padding: "24px", textAlign: "center" }}
                >
                  <div
                    style={{
                      fontSize: "48px",
                      fontWeight: "700",
                      color: "var(--text-primary)",
                      marginBottom: "8px",
                    }}
                  >
                    {reviewStats.averageRating || 0}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: "4px",
                      marginBottom: "8px",
                    }}
                  >
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span
                        key={star}
                        style={{
                          fontSize: "20px",
                          color:
                            star <= Math.floor(reviewStats.averageRating)
                              ? "#fbbf24"
                              : "#d1d5db",
                        }}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: "600",
                      color: "var(--text-primary)",
                      marginBottom: "4px",
                    }}
                  >
                    Average Rating
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    Based on {reviewStats.totalReviews} reviews
                  </div>
                </div>

                {/* Rating Distribution Card */}
                <div className="yaba-card" style={{ padding: "24px" }}>
                  <h3
                    style={{
                      margin: "0 0 16px 0",
                      fontSize: "16px",
                      fontWeight: "600",
                      color: "var(--text-primary)",
                    }}
                  >
                    Rating Distribution
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    {[5, 4, 3, 2, 1].map((rating) => {
                      const count = reviewStats.ratingDistribution[rating] || 0;
                      const isActive = count > 0;
                      const maxCount = Math.max(
                        ...Object.values(reviewStats.ratingDistribution)
                      );
                      const percentage =
                        maxCount > 0 ? (count / maxCount) * 100 : 0;
                      return (
                        <div
                          key={rating}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "12px",
                              fontWeight: "600",
                              color: "var(--text-primary)",
                              minWidth: "20px",
                            }}
                          >
                            {rating}
                          </div>
                          <div
                            style={{
                              flex: 1,
                              height: "8px",
                              background: "var(--surface-3)",
                              borderRadius: "4px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${percentage}%`,
                                height: "100%",
                                background: isActive ? "#fbbf24" : "#d1d5db",
                                transition: "width 0.3s ease",
                              }}
                            ></div>
                          </div>
                          <div
                            style={{
                              fontSize: "12px",
                              fontWeight: "600",
                              color: "var(--text-primary)",
                              minWidth: "20px",
                            }}
                          >
                            {count}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Review Summary Card */}
                <div className="yaba-card" style={{ padding: "24px" }}>
                  <h3
                    style={{
                      margin: "0 0 16px 0",
                      fontSize: "16px",
                      fontWeight: "600",
                      color: "var(--text-primary)",
                    }}
                  >
                    Review Summary
                  </h3>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "16px",
                    }}
                  >
                    <div style={{ textAlign: "center" }}>
                      <div
                        style={{
                          fontSize: "32px",
                          fontWeight: "700",
                          color: "var(--success)",
                          marginBottom: "4px",
                        }}
                      >
                        {reviewStats.published || 0}
                      </div>
                      <div
                        style={{ fontSize: "12px", color: "var(--text-muted)" }}
                      >
                        Published
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div
                        style={{
                          fontSize: "32px",
                          fontWeight: "700",
                          color: "var(--accent)",
                          marginBottom: "4px",
                        }}
                      >
                        {reviewStats.responded || 0}
                      </div>
                      <div
                        style={{ fontSize: "12px", color: "var(--text-muted)" }}
                      >
                        Responded
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div
                        style={{
                          fontSize: "32px",
                          fontWeight: "700",
                          color: "var(--warning)",
                          marginBottom: "4px",
                        }}
                      >
                        {reviewStats.pending || 0}
                      </div>
                      <div
                        style={{ fontSize: "12px", color: "var(--text-muted)" }}
                      >
                        Pending
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div
                        style={{
                          fontSize: "32px",
                          fontWeight: "700",
                          color: "var(--text-primary)",
                          marginBottom: "4px",
                        }}
                      >
                        {reviewStats.totalHelpful || 0}
                      </div>
                      <div
                        style={{ fontSize: "12px", color: "var(--text-muted)" }}
                      >
                        Total Helpful
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Filter and Controls */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "24px",
                }}
              >
                <h2
                  style={{
                    margin: "0",
                    fontSize: "20px",
                    fontWeight: "600",
                    color: "var(--text-primary)",
                  }}
                >
                  Customer Reviews
                </h2>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "12px" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 12px",
                      background: "var(--surface)",
                      border: "1px solid var(--stroke)",
                      borderRadius: "8px",
                    }}
                  >
                    <span style={{ fontSize: "16px" }}>⭐</span>
                    <select
                      value={reviewFilters.rating}
                      onChange={(e) =>
                        handleFilterChange("rating", e.target.value)
                      }
                      className="review-filter-select"
                    >
                      <option
                        value="all"
                        style={{
                          color: "var(--text-primary)",
                          background: "var(--surface)",
                        }}
                      >
                        All Ratings
                      </option>
                      <option
                        value="5"
                        style={{
                          color: "var(--text-primary)",
                          background: "var(--surface)",
                        }}
                      >
                        5 Stars
                      </option>
                      <option
                        value="4"
                        style={{
                          color: "var(--text-primary)",
                          background: "var(--surface)",
                        }}
                      >
                        4 Stars
                      </option>
                      <option
                        value="3"
                        style={{
                          color: "var(--text-primary)",
                          background: "var(--surface)",
                        }}
                      >
                        3 Stars
                      </option>
                      <option
                        value="2"
                        style={{
                          color: "var(--text-primary)",
                          background: "var(--surface)",
                        }}
                      >
                        2 Stars
                      </option>
                      <option
                        value="1"
                        style={{
                          color: "var(--text-primary)",
                          background: "var(--surface)",
                        }}
                      >
                        1 Star
                      </option>
                    </select>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 12px",
                      background: "var(--surface)",
                      border: "1px solid var(--stroke)",
                      borderRadius: "8px",
                    }}
                  >
                    <span style={{ fontSize: "16px" }}>📊</span>
                    <select
                      value={reviewFilters.status}
                      onChange={(e) =>
                        handleFilterChange("status", e.target.value)
                      }
                      className="review-filter-select"
                    >
                      <option
                        value="all"
                        style={{
                          color: "var(--text-primary)",
                          background: "var(--surface)",
                        }}
                      >
                        All Status
                      </option>
                      <option
                        value="approved"
                        style={{
                          color: "var(--text-primary)",
                          background: "var(--surface)",
                        }}
                      >
                        Published
                      </option>
                      <option
                        value="pending"
                        style={{
                          color: "var(--text-primary)",
                          background: "var(--surface)",
                        }}
                      >
                        Pending
                      </option>
                      <option
                        value="rejected"
                        style={{
                          color: "var(--text-primary)",
                          background: "var(--surface)",
                        }}
                      >
                        Rejected
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Individual Review Cards */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                {reviewLoading ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "40px",
                      color: "var(--text-muted)",
                    }}
                  >
                    Loading reviews...
                  </div>
                ) : reviews.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "40px",
                      color: "var(--text-muted)",
                    }}
                  >
                    <div style={{ fontSize: "48px", marginBottom: "16px" }}>
                      📝
                    </div>
                    <div
                      style={{
                        fontSize: "18px",
                        fontWeight: "600",
                        marginBottom: "8px",
                      }}
                    >
                      No reviews yet
                    </div>
                    <div>
                      Reviews will appear here once customers start rating your
                      hotspots.
                    </div>
                  </div>
                ) : (
                  reviews.map((review) => (
                    <div
                      key={review.id}
                      className="yaba-card"
                      style={{ padding: "20px" }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          marginBottom: "12px",
                        }}
                      >
                        <div
                          style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "50%",
                            background: review.userProfilePic
                              ? "transparent"
                              : "#dbeafe",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "16px",
                            fontWeight: "600",
                            color: "var(--accent)",
                            overflow: "hidden",
                          }}
                        >
                          {review.userProfilePic ? (
                            <img
                              src={review.userProfilePic}
                              alt="Profile"
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          ) : (
                            (review.userName || "U").charAt(0).toUpperCase()
                          )}
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: "16px",
                              fontWeight: "600",
                              color: "var(--text-primary)",
                              marginBottom: "2px",
                            }}
                          >
                            {review.userName || "Anonymous User"}
                          </div>
                          <div
                            style={{
                              fontSize: "12px",
                              color: "var(--text-muted)",
                            }}
                          >
                            {review.hotspotName || "Hotspot"} •{" "}
                            {formatDate(review.createdAt)}
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          marginBottom: "8px",
                        }}
                      >
                        <div style={{ display: "flex", gap: "2px" }}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <span
                              key={star}
                              style={{
                                fontSize: "16px",
                                color:
                                  star <= (review.rating || 0)
                                    ? "#fbbf24"
                                    : "#d1d5db",
                              }}
                            >
                              {star <= (review.rating || 0) ? "★" : "☆"}
                            </span>
                          ))}
                        </div>
                        <span
                          style={{
                            fontSize: "12px",
                            color: "var(--text-muted)",
                          }}
                        >
                          ({review.rating || 0}/5)
                        </span>
                      </div>
                      {review.comment && (
                        <p
                          style={{
                            margin: "0 0 12px 0",
                            fontSize: "14px",
                            color: "var(--text-primary)",
                            lineHeight: "1.5",
                          }}
                        >
                          {review.comment}
                        </p>
                      )}

                      {/* Package Info */}
                      {review.packageName && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginBottom: "12px",
                            padding: "8px 12px",
                            background: "var(--surface-2)",
                            borderRadius: "6px",
                            fontSize: "12px",
                          }}
                        >
                          <span style={{ color: "var(--text-muted)" }}>
                            Package:
                          </span>
                          <span style={{ fontWeight: "500" }}>
                            {review.packageName}
                          </span>
                          {review.packagePrice && (
                            <span
                              style={{
                                color: "var(--success)",
                                fontWeight: "600",
                              }}
                            >
                              {formatPrice(review.packagePrice)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Admin Reply */}
                      {review.ownerResponse && (
                        <div
                          style={{
                            background: "var(--accent-10)",
                            border: "1px solid var(--accent-20)",
                            borderRadius: "8px",
                            padding: "12px",
                            marginBottom: "12px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "12px",
                              fontWeight: "600",
                              color: "var(--accent)",
                              marginBottom: "4px",
                              textTransform: "uppercase",
                            }}
                          >
                            Your Reply
                          </div>
                          <p
                            style={{
                              margin: "0",
                              fontSize: "14px",
                              color: "var(--text-primary)",
                            }}
                          >
                            {review.ownerResponse.reply}
                          </p>
                          <div
                            style={{
                              fontSize: "11px",
                              color: "var(--text-muted)",
                              marginTop: "4px",
                            }}
                          >
                            {formatDate(review.ownerResponse.createdAt)}
                          </div>
                        </div>
                      )}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <span style={{ fontSize: "14px" }}>👍</span>
                          <span
                            style={{
                              fontSize: "12px",
                              color: "var(--text-muted)",
                            }}
                          >
                            {review.helpfulCount || 0} helpful
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                          }}
                        >
                          <span
                            style={{
                              padding: "4px 8px",
                              background:
                                review.status === "approved"
                                  ? "var(--success)"
                                  : review.status === "pending"
                                  ? "var(--warning)"
                                  : "var(--danger)",
                              color: "#ffffff",
                              borderRadius: "12px",
                              fontSize: "10px",
                              fontWeight: "600",
                            }}
                          >
                            {review.status === "approved"
                              ? "Published"
                              : review.status === "pending"
                              ? "Pending"
                              : "Rejected"}
                          </span>
                          {!review.ownerResponse && (
                            <button
                              onClick={() => setReplyingToReview(review.id)}
                              style={{
                                padding: "6px 12px",
                                background: "var(--accent)",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "500",
                                cursor: "pointer",
                              }}
                            >
                              Reply
                            </button>
                          )}
                          <div style={{ display: "flex", gap: "4px" }}>
                            <button
                              onClick={() =>
                                handleReviewAction(review.id, "approve")
                              }
                              style={{
                                padding: "4px 8px",
                                background: "var(--success)",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: "4px",
                                fontSize: "10px",
                                cursor: "pointer",
                              }}
                            >
                              Approve
                            </button>
                            <button
                              onClick={() =>
                                handleReviewAction(review.id, "reject")
                              }
                              style={{
                                padding: "4px 8px",
                                background: "var(--danger)",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: "4px",
                                fontSize: "10px",
                                cursor: "pointer",
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Reply Form */}
                      {replyingToReview === review.id && (
                        <div
                          style={{
                            marginTop: "16px",
                            padding: "16px",
                            background: "var(--surface-2)",
                            borderRadius: "8px",
                            border: "1px solid var(--stroke)",
                          }}
                        >
                          <textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Write your reply to this review..."
                            style={{
                              width: "100%",
                              padding: "12px",
                              border: "1px solid var(--stroke)",
                              borderRadius: "6px",
                              fontSize: "14px",
                              fontFamily: "inherit",
                              resize: "vertical",
                              minHeight: "80px",
                              marginBottom: "12px",
                            }}
                          />
                          <div
                            style={{
                              display: "flex",
                              gap: "8px",
                              justifyContent: "flex-end",
                            }}
                          >
                            <button
                              onClick={() => {
                                setReplyingToReview(null);
                                setReplyText("");
                              }}
                              style={{
                                padding: "8px 16px",
                                background: "var(--surface-3)",
                                color: "var(--text-primary)",
                                border: "1px solid var(--stroke)",
                                borderRadius: "6px",
                                fontSize: "12px",
                                cursor: "pointer",
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleReplyToReview(review.id)}
                              disabled={!replyText.trim()}
                              style={{
                                padding: "8px 16px",
                                background: replyText.trim()
                                  ? "var(--accent)"
                                  : "var(--surface-3)",
                                color: replyText.trim()
                                  ? "#ffffff"
                                  : "var(--text-muted)",
                                border: "none",
                                borderRadius: "6px",
                                fontSize: "12px",
                                cursor: replyText.trim()
                                  ? "pointer"
                                  : "not-allowed",
                              }}
                            >
                              Send Reply
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}

                {/* Load More Button */}
                {reviewPagination.hasMore && (
                  <div style={{ textAlign: "center", marginTop: "20px" }}>
                    <button
                      onClick={loadMoreReviews}
                      disabled={reviewLoading}
                      style={{
                        padding: "12px 24px",
                        background: "var(--accent)",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "8px",
                        fontSize: "14px",
                        fontWeight: "500",
                        cursor: reviewLoading ? "not-allowed" : "pointer",
                        opacity: reviewLoading ? 0.6 : 1,
                      }}
                    >
                      {reviewLoading ? "Loading..." : "Load More Reviews"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSection === "support" && (
            <div>
              <OwnerSupportSettings ownerId={ownerId} />
            </div>
          )}

          {/* Hotspots Section */}
          {activeSection === "hotspots" && (
            <div>
              {/* Hotspot Filter Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 24,
                  position: "relative",
                  zIndex: 1000,
                }}
              >
                <h2 style={{ margin: 0 }}>Your Hotspots</h2>

                {/* Hotspot Selection Dropdown */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    position: "relative",
                    zIndex: 1001,
                  }}
                >
                  <label
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                    }}
                  >
                    Filter by Hotspot:
                  </label>
                  <select
                    value={selectedHotspotId}
                    onChange={(e) => {
                      setSelectedHotspotId(e.target.value);
                      const hotspot = hotspots.find(
                        (h) => h.id === e.target.value
                      );
                      setSelectedHotspot(hotspot || null);
                    }}
                    style={{
                      padding: "8px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      fontSize: "14px",
                      backgroundColor: "#fff",
                      color: "#1f2937",
                      minWidth: "200px",
                      cursor: "pointer",
                      position: "relative",
                      zIndex: 1002,
                      outline: "none",
                    }}
                  >
                    <option
                      value="all"
                      style={{ color: "#1f2937", backgroundColor: "#fff" }}
                    >
                      All Hotspots
                    </option>
                    {hotspots.map((hotspot) => (
                      <option
                        key={hotspot.id}
                        value={hotspot.id}
                        style={{ color: "#1f2937", backgroundColor: "#fff" }}
                      >
                        {hotspot.name || hotspot.hotspotName}{" "}
                        {hotspot.status === "online" ? "🟢" : "🔴"}
                      </option>
                    ))}
                  </select>

                  {selectedHotspot && (
                    <div
                      style={{
                        padding: "6px 12px",
                        backgroundColor: "#f3f4f6",
                        borderRadius: "6px",
                        fontSize: "12px",
                        color: "var(--text-muted)",
                      }}
                    >
                      {selectedHotspot.status === "online"
                        ? "🟢 Online"
                        : "🔴 Offline"}
                    </div>
                  )}
                </div>
              </div>

              {/* Stat cards like Hotspot Management */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                <div
                  className="yaba-card"
                  style={{
                    padding: 16,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: "#eef2ff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    📶
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "var(--text-primary)",
                      }}
                    >
                      {selectedHotspotId === "all"
                        ? devicesView.hotspots.filter(
                            (h) => (h.status || "online") === "online"
                          ).length
                        : selectedHotspot?.status === "online"
                        ? 1
                        : 0}
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                      Online Hotspots
                    </div>
                  </div>
                </div>
                <div
                  className="yaba-card"
                  style={{
                    padding: 16,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: "#dcfce7",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    👥
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "var(--text-primary)",
                      }}
                    >
                      {selectedHotspotId === "all"
                        ? deviceStats?.onlineDevices || 0
                        : devices.filter(
                            (d) =>
                              d.hotspotId === selectedHotspotId &&
                              d.status === "online"
                          ).length}
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                      Total Active Users
                    </div>
                  </div>
                </div>
                <div
                  className="yaba-card"
                  style={{
                    padding: 16,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: "#d1fae5",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    💰
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "var(--text-primary)",
                      }}
                    >
                      {selectedHotspotId === "all"
                        ? formatUGX(
                            (walletTx || []).reduce(
                              (sum, tx) =>
                                sum +
                                (tx.type === "credit" ? tx.amount || 0 : 0),
                              0
                            )
                          )
                        : formatUGX(
                            packages
                              .filter(
                                (pkg) => pkg.hotspotId === selectedHotspotId
                              )
                              .reduce((sum, pkg) => sum + (pkg.price || 0), 0)
                          )}
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                      Total Revenue
                    </div>
                  </div>
                </div>
              </div>
              {/* Header with Add Hotspot Button */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 20,
                  position: "relative",
                  zIndex: 1000,
                }}
              >
                <div>
                  <h3
                    style={{
                      margin: "0 0 8px 0",
                      color: "var(--text-primary)",
                    }}
                  >
                    Your Hotspot Locations
                  </h3>
                  <p style={{ margin: 0, color: "var(--text-muted)" }}>
                    View and manage your WiFi hotspots on the map
                  </p>
                </div>
                <button
                  onClick={() => setShowAddHotspotModal(true)}
                  style={{
                    padding: "12px 24px",
                    background: "#10b981",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  📍 Add New Hotspot
                </button>
              </div>

              {/* Map Container - Google Maps with YABA-CARD styling */}
              <div
                className="yaba-card"
                style={{
                  padding: "0",
                  marginBottom: "24px",
                  overflow: "hidden",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <div
                  style={{
                    padding: "20px 24px",
                    borderBottom: "1px solid var(--stroke)",
                    backgroundColor: "var(--surface)",
                    position: "relative",
                    zIndex: 1000,
                  }}
                >
                  <h3
                    style={{
                      margin: "0 0 8px 0",
                      color: "var(--text-primary)",
                      fontSize: "18px",
                      fontWeight: "600",
                    }}
                  >
                    Interactive Hotspot Map
                  </h3>
                  <p
                    style={{
                      margin: 0,
                      color: "var(--text-muted)",
                      fontSize: "14px",
                    }}
                  >
                    {devicesView.hotspots.length} hotspot
                    {devicesView.hotspots.length === 1 ? "" : "s"} • Interactive
                    Map View
                  </p>
                </div>
                <div
                  id="owner-hotspots-map"
                  style={{ height: 420, borderRadius: "0 0 20px 20px" }}
                ></div>
                <OwnerHotspotsMap ownerId={ownerId} />
              </div>

              {/* Hotspot List */}
              {(() => {
                const filteredHotspots =
                  selectedHotspotId === "all"
                    ? devicesView.hotspots
                    : devicesView.hotspots.filter(
                        (h) => h.id === selectedHotspotId
                      );

                return filteredHotspots.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 20px" }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>📍</div>
                    <h3
                      style={{
                        margin: "0 0 8px 0",
                        color: "var(--text-primary)",
                      }}
                    >
                      {selectedHotspotId === "all"
                        ? "No hotspots created yet"
                        : "No hotspot selected"}
                    </h3>
                    <p style={{ margin: 0, color: "var(--text-muted)" }}>
                      {selectedHotspotId === "all"
                        ? "Create your first hotspot to start serving WiFi users"
                        : "Select a hotspot from the dropdown above to view details"}
                    </p>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(300px, 1fr))",
                      gap: 20,
                    }}
                  >
                    {filteredHotspots.map((hotspot) => (
                      <div
                        key={hotspot.id}
                        style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: 12,
                          padding: 20,
                          backgroundColor: "var(--surface)",
                          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            marginBottom: 16,
                          }}
                        >
                          <div>
                            <h4
                              style={{
                                margin: "0 0 4px 0",
                                color: "var(--text-primary)",
                                fontSize: 18,
                              }}
                            >
                              {hotspot.name}
                            </h4>
                            <p
                              style={{
                                margin: 0,
                                color: "var(--text-muted)",
                                fontSize: 14,
                              }}
                            >
                              📍{" "}
                              {hotspot.location
                                ? `${hotspot.location.lat.toFixed(
                                    4
                                  )}, ${hotspot.location.lng.toFixed(4)}`
                                : "Location not set"}
                            </p>
                          </div>
                          <span
                            style={{
                              padding: "4px 12px",
                              borderRadius: 20,
                              fontSize: 12,
                              fontWeight: 500,
                              backgroundColor:
                                hotspot.status === "online"
                                  ? "#d1fae5"
                                  : "#fee2e2",
                              color:
                                hotspot.status === "online"
                                  ? "#065f46"
                                  : "#dc2626",
                            }}
                          >
                            {hotspot.status === "online"
                              ? "🟢 Online"
                              : "🔴 Offline"}
                          </span>
                        </div>

                        <div style={{ marginBottom: 16 }}>
                          <p
                            style={{
                              margin: "0 0 8px 0",
                              color: "var(--text-primary)",
                              fontSize: 14,
                            }}
                          >
                            <strong>Device:</strong>{" "}
                            {hotspot.deviceName || "Not linked"}
                          </p>
                          <p
                            style={{
                              margin: "0 0 8px 0",
                              color: "var(--text-primary)",
                              fontSize: 14,
                            }}
                          >
                            <strong>Service Type:</strong>{" "}
                            {hotspot.serviceType || "Hotspot"}
                          </p>
                          <p
                            style={{
                              margin: 0,
                              color: "var(--text-muted)",
                              fontSize: 12,
                            }}
                          >
                            Created:{" "}
                            {new Date(hotspot.createdAt).toLocaleDateString()}
                          </p>
                        </div>

                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => handleEditHotspot(hotspot)}
                            style={{
                              flex: 1,
                              padding: "8px 16px",
                              backgroundColor: "#f3f4f6",
                              color: "var(--text-primary)",
                              border: "1px solid #d1d5db",
                              borderRadius: 6,
                              cursor: "pointer",
                              fontSize: 14,
                            }}
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => handleDeleteHotspot(hotspot.id)}
                            style={{
                              flex: 1,
                              padding: "8px 16px",
                              backgroundColor: "#fee2e2",
                              color: "#dc2626",
                              border: "1px solid #fecaca",
                              borderRadius: 6,
                              cursor: "pointer",
                              fontSize: 14,
                            }}
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {activeSection === "packages" && <OwnerPackages />}
          {activeSection === "vouchers" && (
            <VoucherManager
              ownerId={ownerId}
              onClose={() => setActiveSection("dashboard")}
            />
          )}
          {/* Consolidated: Hotspot setup content now in Hotspots & Devices */}

          {activeSection === "profile" && (
            <div>
              <OwnerProfile />
              <div style={{ marginTop: 20 }}>
                <h3 style={{ margin: "0 0 12px 0" }}>Upload Logo</h3>
                <UploadLogo ownerId={ownerId} />
              </div>
            </div>
          )}
          {activeSection === "admins" && <OwnerAdmins />}
          {activeSection === "password" && <AdminChangePassword />}
          {activeSection === "wallet" && (
            <div>
              <h2 style={{ marginBottom: 16 }}>Wallet</h2>
              <div
                className="yaba-card"
                style={{ padding: 16, marginBottom: 16 }}
              >
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  Balance: {formatUGX(walletBalance)}
                </div>
              </div>
              <div
                className="yaba-card"
                style={{ padding: 16, marginBottom: 16 }}
              >
                <h3 style={{ marginTop: 0 }}>Withdraw Funds</h3>
                <input
                  type="number"
                  placeholder="Amount"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  style={styles.input}
                />
                <input
                  type="text"
                  placeholder="Mobile Money Number"
                  value={mobileMoneyNumber}
                  onChange={(e) => setMobileMoneyNumber(e.target.value)}
                  style={styles.input}
                />
                <button
                  onClick={handleWithdraw}
                  style={{
                    ...styles.btn,
                    background: "#2563eb",
                    color: "#fff",
                  }}
                >
                  Withdraw
                </button>
                {walletMsg && <p style={{ marginTop: 8 }}>{walletMsg}</p>}
              </div>
              <div className="yaba-card" style={{ padding: 16 }}>
                <h3 style={{ marginTop: 0 }}>Transactions</h3>
                {walletTx.length === 0 ? (
                  <div>No transactions yet.</div>
                ) : (
                  <ul>
                    {walletTx.map((tx, i) => (
                      <li key={i}>
                        {tx.date}: {tx.type} {tx.amount} ({tx.description})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          {activeSection !== "dashboard" &&
            activeSection !== "packages" &&
            activeSection !== "vouchers" &&
            activeSection !== "hotspot" &&
            activeSection !== "hotspots" &&
            activeSection !== "profile" &&
            activeSection !== "admins" &&
            activeSection !== "wallet" &&
            activeSection !== "payments" &&
            activeSection !== "analytics" &&
            activeSection !== "yourHotspots" &&
            activeSection !== "devices" &&
            activeSection !== "password" &&
            activeSection !== "support" && (
              <>
                {packages.map((pkg) => (
                  <div key={pkg.id} style={styles.card}>
                    <strong>{pkg.packageName || pkg.name}</strong> - UGX{" "}
                    {pkg.price} ({pkg.duration})
                    <br />
                    Status: <b>{pkg.status}</b>
                    <br />
                    <button
                      onClick={() => toggleStatus(pkg)}
                      style={{
                        ...styles.btn,
                        background: "green",
                        color: "#ffffff",
                        marginRight: "10px",
                      }}
                    >
                      {pkg.status === "paused" ? "Launch" : "Pause"}
                    </button>
                    <button
                      onClick={() => deletePackage(pkg.id)}
                      style={{
                        ...styles.btn,
                        background: "red",
                        color: "#ffffff",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </>
            )}
        </div>

        {/* Removed create-package modal since Packages section covers this */}
        {/* Add Hotspot Modal */}
        {showAddHotspotModal && (
          <div style={styles.modalOverlay}>
            <div style={{ ...styles.modalContent, maxWidth: 560 }}>
              <h3 style={{ marginTop: 0 }}>Add Hotspot</h3>
              {hsError && (
                <div
                  style={{
                    color: "#991b1b",
                    background: "#fee2e2",
                    border: "1px solid #fecaca",
                    padding: 8,
                    borderRadius: 8,
                  }}
                >
                  {hsError}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px solid var(--stroke)",
                      background:
                        addHsStep === n ? "#2563eb" : "var(--surface)",
                      color: addHsStep === n ? "#fff" : "var(--text-muted)",
                    }}
                  >
                    {n}
                  </div>
                ))}
              </div>
              {addHsStep === 1 && (
                <>
                  <input
                    style={styles.input}
                    placeholder="Hotspot Name (SSID)"
                    value={hsName}
                    onChange={(e) => setHsName(e.target.value)}
                  />
                  <select
                    style={styles.input}
                    value={hsRouterType}
                    onChange={(e) => setHsRouterType(e.target.value)}
                  >
                    <option>Mikrotik</option>
                    <option>TP-Link</option>
                    <option>Huawei</option>
                    <option>Other</option>
                  </select>
                  <select
                    style={styles.input}
                    value={hsHotspotType}
                    onChange={(e) => setHsHotspotType(e.target.value)}
                  >
                    <option>Supported Router</option>
                    <option>Unsupported Router – Use YABA Device</option>
                  </select>
                  <div style={{ margin: "8px 0" }}>
                    <div
                      ref={addHsMapRef}
                      style={{
                        height: 260,
                        borderRadius: 10,
                        border: "1px solid #e5e7eb",
                      }}
                    />
                    <div
                      style={{ marginTop: 6, color: "var(--text-secondary)" }}
                    >
                      Lat: {Number(hsLat).toFixed(6)} | Lng:{" "}
                      {Number(hsLng).toFixed(6)}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <button
                      style={styles.btn}
                      onClick={() => setShowAddHotspotModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      disabled={!canNextFromHsStep1()}
                      style={{
                        ...styles.btn,
                        background: "#2563eb",
                        color: "#fff",
                      }}
                      onClick={() => setAddHsStep(2)}
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
              {addHsStep === 2 && (
                <>
                  <input
                    style={styles.input}
                    placeholder="Router MAC Address (optional)"
                    value={hsMac}
                    onChange={(e) => setHsMac(e.target.value)}
                  />
                  <input
                    style={styles.input}
                    placeholder="Router ID (optional)"
                    value={hsRouterId}
                    onChange={(e) => setHsRouterId(e.target.value)}
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <button style={styles.btn} onClick={() => setAddHsStep(1)}>
                      Back
                    </button>
                    <button
                      style={{
                        ...styles.btn,
                        background: "#2563eb",
                        color: "#fff",
                      }}
                      onClick={createHotspot}
                      disabled={hsCreating}
                    >
                      {hsCreating ? "Creating…" : "Create Hotspot"}
                    </button>
                  </div>
                </>
              )}
              {addHsStep === 3 && (
                <>
                  <div
                    style={{
                      background: "#f1f5f9",
                      padding: 12,
                      borderRadius: 10,
                    }}
                  >
                    <div>
                      <b>API Key:</b> {hsApiKey || "—"}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <b>Integration Link:</b> {hsIntegrationLink || "—"}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <button
                        style={styles.btn}
                        disabled={!hsIntegrationLink}
                        onClick={() =>
                          navigator.clipboard.writeText(hsIntegrationLink)
                        }
                      >
                        Copy Integration Link
                      </button>
                    </div>
                  </div>
                  <div
                    style={{
                      background: "#f9fafb",
                      padding: 12,
                      borderRadius: 10,
                      marginTop: 12,
                    }}
                  >
                    <b>Setup Instructions:</b>
                    <div style={{ color: "var(--text-primary)", marginTop: 6 }}>
                      {hsRouterType === "Mikrotik"
                        ? "Paste the Mikrotik script in Winbox terminal and set the HTTP login redirect to your Integration Link."
                        : hsHotspotType.startsWith("Unsupported")
                        ? "Use the YABA Device provided by the system admin and configure captive portal to your Integration Link."
                        : "Set router captive portal redirect to your Integration Link."}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 8,
                      marginTop: 12,
                    }}
                  >
                    <button
                      style={styles.btn}
                      onClick={() => setShowAddHotspotModal(false)}
                    >
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Link Device Modal */}
        {showLinkDeviceModal && (
          <div style={styles.modalOverlay}>
            <div style={{ ...styles.modalContent, maxWidth: 460 }}>
              <h3 style={{ marginTop: 0 }}>Link Device</h3>
              {linkError && (
                <div
                  style={{
                    color: "#991b1b",
                    background: "#fee2e2",
                    border: "1px solid #fecaca",
                    padding: 8,
                    borderRadius: 8,
                  }}
                >
                  {linkError}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {[1, 2].map((n) => (
                  <div
                    key={n}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px solid #e5e7eb",
                      background: linkStep === n ? "#2563eb" : "#fff",
                      color: linkStep === n ? "#fff" : "#64748b",
                    }}
                  >
                    {n}
                  </div>
                ))}
              </div>
              {linkStep === 1 && (
                <>
                  <select
                    style={styles.input}
                    value={linkType}
                    onChange={(e) => setLinkType(e.target.value)}
                  >
                    <option>Mikrotik</option>
                    <option>TP-Link</option>
                    <option>YABA</option>
                  </select>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <button
                      style={styles.btn}
                      onClick={() => setShowLinkDeviceModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      style={{
                        ...styles.btn,
                        background: "#2563eb",
                        color: "#fff",
                      }}
                      onClick={() => setLinkStep(2)}
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
              {linkStep === 2 && (
                <>
                  <input
                    style={styles.input}
                    placeholder="MAC Address (optional)"
                    value={linkMac}
                    onChange={(e) => setLinkMac(e.target.value)}
                  />
                  <input
                    style={styles.input}
                    placeholder="Router ID (optional)"
                    value={linkRouterId}
                    onChange={(e) => setLinkRouterId(e.target.value)}
                  />
                  <input
                    style={styles.input}
                    placeholder="Nickname (optional)"
                    value={linkNickname}
                    onChange={(e) => setLinkNickname(e.target.value)}
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <button style={styles.btn} onClick={() => setLinkStep(1)}>
                      Back
                    </button>
                    <button
                      disabled={linking}
                      style={{
                        ...styles.btn,
                        background: "#2563eb",
                        color: "#fff",
                      }}
                      onClick={submitLinkDevice}
                    >
                      {linking ? "Linking…" : "Link Device"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Device Wizard Modal */}
        {showDeviceWizard && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                backgroundColor: "var(--surface)",
                borderRadius: 12,
                padding: 0,
                maxWidth: 600,
                width: "90%",
                maxHeight: "90vh",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  padding: "24px 24px 0 24px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: 24,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  {selectedDevice ? "Edit Device" : "Add New Device"}
                </h2>
                <button
                  onClick={handleWizardClose}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: 20,
                    cursor: "pointer",
                    color: "var(--text-secondary)",
                    padding: 8,
                    borderRadius: 6,
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Step Indicator */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: "20px 24px 0 24px",
                  gap: 8,
                }}
              >
                {[1, 2, 3].map((step) => (
                  <div
                    key={step}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 600,
                      backgroundColor:
                        currentStep >= step ? "#2563eb" : "#e2e8f0",
                      color: currentStep >= step ? "#ffffff" : "#64748b",
                    }}
                  >
                    {step}
                  </div>
                ))}
              </div>

              {/* Step Content */}
              <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>
                {currentStep === 1 && (
                  <div>
                    <h3
                      style={{
                        fontSize: 20,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        marginBottom: 8,
                      }}
                    >
                      Device Information
                    </h3>
                    <p
                      style={{
                        color: "var(--text-secondary)",
                        marginBottom: 24,
                      }}
                    >
                      Enter the details of your WiFi device
                    </p>

                    <div style={{ marginBottom: 20 }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: 8,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                        }}
                      >
                        Device Name *
                        <input
                          type="text"
                          name="deviceName"
                          value={formData.deviceName}
                          onChange={handleInputChange}
                          placeholder="e.g., Main Router, Shop WiFi"
                          style={{
                            width: "100%",
                            padding: 12,
                            border: "1px solid #d1d5db",
                            borderRadius: 6,
                            fontSize: 16,
                            marginTop: 4,
                          }}
                          required
                        />
                      </label>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: 8,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                        }}
                      >
                        Router Identity (Optional)
                        <input
                          type="text"
                          name="routerIdentity"
                          value={formData.routerIdentity}
                          onChange={handleInputChange}
                          placeholder="e.g., WeaveCo, MyBusiness"
                          style={{
                            width: "100%",
                            padding: 12,
                            border: "1px solid #d1d5db",
                            borderRadius: 6,
                            fontSize: 16,
                            marginTop: 4,
                          }}
                        />
                        <small
                          style={{
                            display: "block",
                            color: "var(--text-muted)",
                            fontSize: 12,
                            marginTop: 4,
                          }}
                        >
                          This will be set as the router identity/name on your
                          MikroTik
                        </small>
                      </label>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: 8,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                        }}
                      >
                        Device Type
                        <select
                          name="deviceType"
                          value={formData.deviceType}
                          onChange={handleInputChange}
                          style={{
                            width: "100%",
                            padding: 12,
                            border: "1px solid #d1d5db",
                            borderRadius: 6,
                            fontSize: 16,
                            marginTop: 4,
                          }}
                        >
                          <option value="mikrotik">🖥️ MikroTik Router</option>
                          <option value="tp-link">📡 TP-Link Router</option>
                          <option value="ubiquiti">🌐 Ubiquiti Device</option>
                          <option value="other">🔧 Other</option>
                        </select>
                      </label>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: 8,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                        }}
                      >
                        Service Type * (Select one or both)
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                            marginTop: 8,
                          }}
                        >
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              cursor: "pointer",
                              padding: 12,
                              border: "1px solid #d1d5db",
                              borderRadius: 6,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={formData.serviceType.includes("hotspot")}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setFormData((prev) => ({
                                    ...prev,
                                    serviceType: [
                                      ...prev.serviceType.filter(
                                        (s) => s !== "hotspot"
                                      ),
                                      "hotspot",
                                    ],
                                  }));
                                } else {
                                  setFormData((prev) => ({
                                    ...prev,
                                    serviceType: prev.serviceType.filter(
                                      (s) => s !== "hotspot"
                                    ),
                                  }));
                                }
                              }}
                              style={{ width: 18, height: 18 }}
                            />
                            <span style={{ fontSize: 16 }}>
                              📶 WiFi Hotspot
                            </span>
                          </label>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              cursor: "pointer",
                              padding: 12,
                              border: "1px solid #d1d5db",
                              borderRadius: 6,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={formData.serviceType.includes("pppoe")}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setFormData((prev) => ({
                                    ...prev,
                                    serviceType: [
                                      ...prev.serviceType.filter(
                                        (s) => s !== "pppoe"
                                      ),
                                      "pppoe",
                                    ],
                                  }));
                                } else {
                                  setFormData((prev) => ({
                                    ...prev,
                                    serviceType: prev.serviceType.filter(
                                      (s) => s !== "pppoe"
                                    ),
                                  }));
                                }
                              }}
                              style={{ width: 18, height: 18 }}
                            />
                            <span style={{ fontSize: 16 }}>🔌 PPPoE</span>
                          </label>
                        </div>
                        <small
                          style={{
                            display: "block",
                            color: "var(--text-muted)",
                            fontSize: 12,
                            marginTop: 4,
                          }}
                        >
                          You can enable both Hotspot and PPPoE services on the
                          same router
                        </small>
                      </label>
                    </div>

                    {formData.serviceType.includes("hotspot") && (
                      <div style={{ marginBottom: 20 }}>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                            padding: 12,
                            border: "1px solid #d1d5db",
                            borderRadius: 6,
                            backgroundColor: formData.antiSharing
                              ? "#f0f9ff"
                              : "transparent",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={formData.antiSharing}
                            onChange={(e) => {
                              setFormData((prev) => ({
                                ...prev,
                                antiSharing: e.target.checked,
                              }));
                            }}
                            style={{ width: 18, height: 18 }}
                          />
                          <div>
                            <span
                              style={{
                                fontSize: 16,
                                fontWeight: 500,
                                color: "var(--text-primary)",
                              }}
                            >
                              🔒 Enable Anti-Sharing Protection
                            </span>
                            <small
                              style={{
                                display: "block",
                                color: "var(--text-muted)",
                                fontSize: 12,
                                marginTop: 4,
                              }}
                            >
                              Prevents clients from sharing their hotspot
                              package with other devices
                            </small>
                          </div>
                        </label>
                      </div>
                    )}

                    {/* Device-specific interface selection */}
                    {formData.deviceType === "mikrotik" && (
                      <div style={{ marginBottom: 20 }}>
                        <label
                          style={{
                            display: "block",
                            marginBottom: 8,
                            fontWeight: 500,
                            color: "var(--text-primary)",
                          }}
                        >
                          Network Interfaces *
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "repeat(auto-fit, minmax(80px, 1fr))",
                              gap: 12,
                              marginTop: 8,
                            }}
                          >
                            {[
                              "ether1",
                              "ether2",
                              "ether3",
                              "ether4",
                              "ether5",
                              "ether6",
                              "ether7",
                              "ether8",
                              "wlan1",
                              "wlan2",
                            ].map((iface) => (
                              <label
                                key={iface}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  cursor: "pointer",
                                  padding: 8,
                                  border:
                                    iface === "ether1"
                                      ? "2px solid #f59e0b"
                                      : "1px solid #d1d5db",
                                  borderRadius: 6,
                                  backgroundColor:
                                    iface === "ether1" &&
                                    formData.interfaces.includes(iface)
                                      ? "#fef3c7"
                                      : "transparent",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  value={iface}
                                  checked={formData.interfaces.includes(iface)}
                                  onChange={handleInterfaceChange}
                                  style={{ width: 16, height: 16 }}
                                />
                                <span
                                  style={{
                                    fontSize: 14,
                                    color:
                                      iface === "ether1"
                                        ? "#f59e0b"
                                        : "var(--text-primary)",
                                    fontWeight: iface === "ether1" ? 600 : 400,
                                  }}
                                >
                                  {iface}
                                  {iface === "ether1" && " ⚠️"}
                                </span>
                              </label>
                            ))}
                          </div>
                          {formData.interfaces.includes("ether1") && (
                            <div
                              style={{
                                backgroundColor: "#fef3c7",
                                border: "1px solid #fbbf24",
                                borderRadius: 6,
                                padding: 12,
                                marginTop: 8,
                              }}
                            >
                              <strong style={{ color: "#92400e" }}>
                                ⚠️ Warning:
                              </strong>
                              <p
                                style={{
                                  margin: "4px 0 0 0",
                                  color: "#92400e",
                                  fontSize: 13,
                                }}
                              >
                                Port 1 (ether1) is typically the WAN port
                                receiving internet. According to the setup
                                guide, you should connect to port 2 first for
                                initial setup, then move to port 1 after
                                resetting. Only select port 1 if you're sure
                                it's not your WAN port.
                              </p>
                            </div>
                          )}
                          <small
                            style={{
                              color: "var(--text-muted)",
                              fontSize: 14,
                              marginTop: 8,
                              display: "block",
                            }}
                          >
                            Select the interfaces where you want to enable{" "}
                            {formData.serviceType.join(" and ")}. Do NOT select
                            the port receiving internet (usually port 1).
                          </small>
                        </label>
                      </div>
                    )}

                    {formData.deviceType === "tp-link" && (
                      <div style={{ marginBottom: 20 }}>
                        <label
                          style={{
                            display: "block",
                            marginBottom: 8,
                            fontWeight: 500,
                            color: "var(--text-primary)",
                          }}
                        >
                          Network Interfaces *
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "repeat(auto-fit, minmax(80px, 1fr))",
                              gap: 12,
                              marginTop: 8,
                            }}
                          >
                            {[
                              "LAN1",
                              "LAN2",
                              "LAN3",
                              "LAN4",
                              "WAN",
                              "WiFi 2.4G",
                              "WiFi 5G",
                            ].map((iface) => (
                              <label
                                key={iface}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  value={iface}
                                  checked={formData.interfaces.includes(iface)}
                                  onChange={handleInterfaceChange}
                                  style={{ width: 16, height: 16 }}
                                />
                                <span
                                  style={{
                                    fontSize: 14,
                                    color: "var(--text-primary)",
                                  }}
                                >
                                  {iface}
                                </span>
                              </label>
                            ))}
                          </div>
                          <small
                            style={{
                              color: "var(--text-muted)",
                              fontSize: 14,
                              marginTop: 8,
                              display: "block",
                            }}
                          >
                            Select the interfaces where you want to enable{" "}
                            {Array.isArray(formData.serviceType) ? formData.serviceType.join(" and ") : formData.serviceType}
                          </small>
                        </label>
                      </div>
                    )}

                    {formData.deviceType === "ubiquiti" && (
                      <div style={{ marginBottom: 20 }}>
                        <label
                          style={{
                            display: "block",
                            marginBottom: 8,
                            fontWeight: 500,
                            color: "var(--text-primary)",
                          }}
                        >
                          Network Interfaces *
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "repeat(auto-fit, minmax(80px, 1fr))",
                              gap: 12,
                              marginTop: 8,
                            }}
                          >
                            {[
                              "eth0",
                              "eth1",
                              "eth2",
                              "eth3",
                              "wlan0",
                              "wlan1",
                            ].map((iface) => (
                              <label
                                key={iface}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  value={iface}
                                  checked={formData.interfaces.includes(iface)}
                                  onChange={handleInterfaceChange}
                                  style={{ width: 16, height: 16 }}
                                />
                                <span
                                  style={{
                                    fontSize: 14,
                                    color: "var(--text-primary)",
                                  }}
                                >
                                  {iface}
                                </span>
                              </label>
                            ))}
                          </div>
                          <small
                            style={{
                              color: "var(--text-muted)",
                              fontSize: 14,
                              marginTop: 8,
                              display: "block",
                            }}
                          >
                            Select the interfaces where you want to enable{" "}
                            {Array.isArray(formData.serviceType) ? formData.serviceType.join(" and ") : formData.serviceType}
                          </small>
                        </label>
                      </div>
                    )}

                    {/* Device-specific setup info */}
                    {formData.deviceType === "mikrotik" && (
                      <div
                        style={{
                          backgroundColor: "#f0f9ff",
                          border: "1px solid #bae6fd",
                          borderRadius: 8,
                          padding: 16,
                          marginTop: 16,
                        }}
                      >
                        <h4 style={{ margin: "0 0 8px 0", color: "#0c4a6e" }}>
                          🖥️ MikroTik Setup
                        </h4>
                        <p
                          style={{ margin: 0, color: "#0c4a6e", fontSize: 14 }}
                        >
                          We'll generate a RouterOS script that you can paste
                          directly into Winbox terminal for automatic
                          configuration.
                        </p>
                      </div>
                    )}

                    {formData.deviceType === "tp-link" && (
                      <div
                        style={{
                          backgroundColor: "#fef3c7",
                          border: "1px solid #fbbf24",
                          borderRadius: 8,
                          padding: 16,
                          marginTop: 16,
                        }}
                      >
                        <h4 style={{ margin: "0 0 8px 0", color: "#92400e" }}>
                          📡 TP-Link Setup
                        </h4>
                        <p
                          style={{ margin: 0, color: "#92400e", fontSize: 14 }}
                        >
                          We'll provide step-by-step instructions to configure
                          your TP-Link router through the web interface.
                        </p>
                      </div>
                    )}

                    {formData.deviceType === "ubiquiti" && (
                      <div
                        style={{
                          backgroundColor: "#ecfdf5",
                          border: "1px solid #a7f3d0",
                          borderRadius: 8,
                          padding: 16,
                          marginTop: 16,
                        }}
                      >
                        <h4 style={{ margin: "0 0 8px 0", color: "#065f46" }}>
                          🌐 Ubiquiti Setup
                        </h4>
                        <p
                          style={{ margin: 0, color: "#065f46", fontSize: 14 }}
                        >
                          We'll guide you through UniFi controller configuration
                          and device integration.
                        </p>
                      </div>
                    )}

                    {/* Location Capture Section */}
                    <div style={{ marginTop: 20 }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: 8,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                        }}
                      >
                        📍 Device Location (Optional)
                        <small
                          style={{
                            display: "block",
                            color: "var(--text-muted)",
                            fontSize: 12,
                            marginTop: 4,
                          }}
                        >
                          Capture location to show on hotspot map and help WiFi
                          users find your device
                        </small>
                      </label>

                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          alignItems: "center",
                          marginBottom: 12,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (navigator.geolocation) {
                              navigator.geolocation.getCurrentPosition(
                                (position) => {
                                  setFormData((prev) => ({
                                    ...prev,
                                    location: {
                                      lat: position.coords.latitude,
                                      lng: position.coords.longitude,
                                    },
                                  }));
                                },
                                (error) => {
                                  console.error(
                                    "Location capture failed:",
                                    error
                                  );
                                  alert(
                                    "Could not capture location. Please enter manually or try again."
                                  );
                                }
                              );
                            } else {
                              alert(
                                "Geolocation is not supported by this browser."
                              );
                            }
                          }}
                          style={{
                            padding: "10px 16px",
                            background: "#10b981",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 14,
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          📱 Capture Current Location
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              location: null,
                            }));
                          }}
                          style={{
                            padding: "10px 16px",
                            background: "#6b7280",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 14,
                            fontWeight: 500,
                          }}
                        >
                          Clear
                        </button>
                      </div>

                      {formData.location && (
                        <div
                          style={{
                            backgroundColor: "#f0f9ff",
                            border: "1px solid #bae6fd",
                            borderRadius: 6,
                            padding: 12,
                            marginTop: 8,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 8,
                            }}
                          >
                            <span style={{ fontSize: 16 }}>📍</span>
                            <span style={{ fontWeight: 500, color: "#0c4a6e" }}>
                              Location Captured!
                            </span>
                          </div>
                          <div style={{ fontSize: 14, color: "#0c4a6e" }}>
                            <strong>Latitude:</strong>{" "}
                            {formData.location.lat.toFixed(6)}
                            <br />
                            <strong>Longitude:</strong>{" "}
                            {formData.location.lng.toFixed(6)}
                          </div>
                          <small style={{ color: "#0c4a6e", opacity: 0.8 }}>
                            This location will be used for hotspot mapping and
                            WiFi user discovery
                          </small>
                        </div>
                      )}

                      <div style={{ marginTop: 12 }}>
                        <small
                          style={{ color: "var(--text-muted)", fontSize: 12 }}
                        >
                          💡 <strong>Tip:</strong> Location capture helps WiFi
                          users find your hotspots nearby and improves your
                          business visibility
                        </small>
                      </div>
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div>
                    <h3
                      style={{
                        fontSize: 20,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        marginBottom: 8,
                      }}
                    >
                      Provisioning & Setup
                    </h3>
                    <p
                      style={{
                        color: "var(--text-secondary)",
                        marginBottom: 24,
                      }}
                    >
                      {formData.deviceType === "mikrotik"
                        ? "Copy and paste this script into your MikroTik Winbox terminal for automatic configuration"
                        : formData.deviceType === "tp-link"
                        ? "Follow these steps to configure your TP-Link router through the web interface"
                        : formData.deviceType === "ubiquiti"
                        ? "Configure your Ubiquiti device through the UniFi controller"
                        : "Manual configuration instructions for your device"}
                    </p>

                    <div
                      style={{
                        backgroundColor: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        marginBottom: 24,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: 16,
                          borderBottom: "1px solid #e2e8f0",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 500,
                            color: "var(--text-primary)",
                          }}
                        >
                          Copy this script:
                        </span>
                        <button
                          onClick={copyToClipboard}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "8px 16px",
                            backgroundColor: "#2563eb",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 14,
                            fontWeight: 500,
                          }}
                        >
                          {copied ? "✓ Copied!" : "📋 Copy"}
                        </button>
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          padding: 16,
                          backgroundColor: "#1e293b",
                          color: "#e2e8f0",
                          borderRadius: "0 0 8px 8px",
                          fontSize: 14,
                          fontFamily: "monospace",
                          whiteSpace: "pre-wrap",
                          overflowX: "auto",
                        }}
                      >
                        {provisioningScript}
                      </pre>
                    </div>

                    <div
                      style={{
                        backgroundColor: "#f0f9ff",
                        border: "1px solid #bae6fd",
                        borderRadius: 8,
                        padding: 16,
                      }}
                    >
                      <h4>Instructions:</h4>
                      <ol style={{ margin: "8px 0 0 20px", color: "#0c4a6e" }}>
                        <li>
                          Open your{" "}
                          {formData.deviceType === "mikrotik"
                            ? "MikroTik terminal"
                            : "device terminal"}
                        </li>
                        <li>Copy the script above</li>
                        <li>Paste and press Enter</li>
                        <li>Wait for the configuration to complete</li>
                        <li>Click Next to check connection status</li>
                      </ol>
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
                  <div>
                    <h3
                      style={{
                        fontSize: 20,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        marginBottom: 8,
                      }}
                    >
                      Connection Status
                    </h3>
                    <p
                      style={{
                        color: "var(--text-secondary)",
                        marginBottom: 24,
                      }}
                    >
                      Checking if your device is connected successfully
                    </p>

                    <div style={{ textAlign: "center" }}>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          marginBottom: 24,
                        }}
                      >
                        <div
                          style={{
                            width: 80,
                            height: 80,
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 32,
                            color: "#ffffff",
                            marginBottom: 16,
                            backgroundColor:
                              connectionStatus === "online"
                                ? "#10b981"
                                : connectionStatus === "pending"
                                ? "#f59e0b"
                                : "#ef4444",
                          }}
                        >
                          {connectionStatus === "online"
                            ? "✓"
                            : connectionStatus === "pending"
                            ? "..."
                            : "✕"}
                        </div>
                        <div>
                          <h4
                            style={{
                              margin: "0 0 8px 0",
                              color: "var(--text-primary)",
                            }}
                          >
                            {connectionStatus === "online"
                              ? "Device Connected Successfully!"
                              : connectionStatus === "pending"
                              ? "Waiting for connection..."
                              : "Connection failed"}
                          </h4>
                          <p
                            style={{
                              color: "var(--text-secondary)",
                              margin: 0,
                            }}
                          >
                            {connectionStatus === "online"
                              ? `Your ${formData.deviceName} is now online and configured`
                              : connectionStatus === "pending"
                              ? "Please wait while we check the connection..."
                              : "The device did not connect. Please check the script and try again."}
                          </p>
                        </div>
                      </div>

                      {connectionStatus === "online" && (
                        <div
                          style={{
                            backgroundColor: "#f0fdf4",
                            border: "1px solid #bbf7d0",
                            borderRadius: 8,
                            padding: 20,
                            textAlign: "left",
                          }}
                        >
                          <h5>Device Details:</h5>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 12,
                              fontSize: 14,
                            }}
                          >
                            <span>Device Name:</span>
                            <span>{formData.deviceName}</span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 12,
                              fontSize: 14,
                            }}
                          >
                            <span>Service Type:</span>
                            <span>
                              {Array.isArray(formData.serviceType)
                                ? formData.serviceType
                                    .map((s) => s.toUpperCase())
                                    .join(", ")
                                : formData.serviceType.toUpperCase()}
                            </span>
                          </div>
                          {formData.antiSharing && (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 12,
                                fontSize: 14,
                              }}
                            >
                              <span>Anti-Sharing:</span>
                              <span
                                style={{ color: "#10b981", fontWeight: "600" }}
                              >
                                Enabled
                              </span>
                            </div>
                          )}
                          {formData.routerIdentity && (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 12,
                                fontSize: 14,
                              }}
                            >
                              <span>Router Identity:</span>
                              <span>{formData.routerIdentity}</span>
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 12,
                              fontSize: 14,
                            }}
                          >
                            <span>Interfaces:</span>
                            <span>{formData.interfaces.join(", ")}</span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 12,
                              fontSize: 14,
                            }}
                          >
                            <span>Status:</span>
                            <span
                              style={{ color: "#10b981", fontWeight: "600" }}
                            >
                              Online
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {deviceError && (
                  <p
                    style={{
                      padding: "12px 24px",
                      backgroundColor: "#fef2f2",
                      color: "#dc2626",
                      borderRadius: 6,
                      margin: "0 24px",
                      fontSize: 14,
                    }}
                  >
                    {deviceError}
                  </p>
                )}
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  padding: 24,
                  display: "flex",
                  justifyContent: "space-between",
                  borderTop: "1px solid #e2e8f0",
                  backgroundColor: "#f8fafc",
                }}
              >
                {currentStep > 1 && (
                  <button
                    onClick={handleBack}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "12px 24px",
                      backgroundColor: "#6b7280",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 16,
                      fontWeight: 500,
                    }}
                  >
                    ← Back
                  </button>
                )}

                {currentStep < 3 ? (
                  <button
                    onClick={handleNext}
                    disabled={deviceLoading}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "12px 24px",
                      backgroundColor: "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 16,
                      fontWeight: 500,
                    }}
                  >
                    {deviceLoading ? "Processing..." : "Next"}→
                  </button>
                ) : (
                  <button
                    onClick={handleWizardClose}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "12px 24px",
                      backgroundColor: "#10b981",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 16,
                      fontWeight: 500,
                    }}
                  >
                    ✓ Finish
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Router Logs Modal */}
        {showDeviceLogsModal && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                backgroundColor: "var(--surface)",
                borderRadius: 12,
                padding: 0,
                maxWidth: 760,
                width: "92%",
                maxHeight: "90vh",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  padding: 18,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: "1px solid #e2e8f0",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: "var(--text-primary)",
                    }}
                  >
                    Router Logs
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    {logsDevice?.deviceName || logsDevice?.deviceId || ""}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={() => logsDevice && fetchRouterLogs(logsDevice)}
                    disabled={routerLogsLoading || !logsDevice}
                    style={{
                      padding: "8px 12px",
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {routerLogsLoading ? "Loading…" : "Refresh"}
                  </button>
                  <button
                    onClick={closeRouterLogs}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: 20,
                      cursor: "pointer",
                      color: "var(--text-secondary)",
                      padding: 6,
                      borderRadius: 6,
                    }}
                    aria-label="Close router logs"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div style={{ padding: 18, overflowY: "auto" }}>
                {routerLogsError && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      background: "#fef2f2",
                      color: "#b91c1c",
                      marginBottom: 12,
                      fontSize: 14,
                    }}
                  >
                    {routerLogsError}
                  </div>
                )}

                {!routerLogsError && routerLogs.length === 0 && !routerLogsLoading && (
                  <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                    No logs yet. Run provisioning / connection check, then refresh.
                  </div>
                )}

                {routerLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      border: "1px solid var(--stroke)",
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 10,
                      background: "var(--surface-gradient)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        marginBottom: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--text-primary)",
                        }}
                      >
                        {log.type || "event"}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-muted)",
                          fontFamily: "monospace",
                        }}
                      >
                        {log.createdAtISO
                          ? new Date(log.createdAtISO).toLocaleString()
                          : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 14, color: "var(--text-primary)" }}>
                      {log.message || ""}
                    </div>
                    {log.meta && (
                      <pre
                        style={{
                          marginTop: 8,
                          marginBottom: 0,
                          fontSize: 12,
                          color: "var(--text-secondary)",
                          background: "rgba(15, 23, 42, 0.06)",
                          padding: 10,
                          borderRadius: 10,
                          overflowX: "auto",
                        }}
                      >
                        {JSON.stringify(log.meta, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default AdminDashboard;
