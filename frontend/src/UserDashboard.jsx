import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
import Packages from './Packages';
import HotspotsMap from './pages/HotspotsMap';
// Removed static YABA logo; will use owner branding logo dynamically
import TransactionsSection from './components/TransactionsSection';
import LoyaltyProgram from './components/LoyaltyProgram';
import UserReviewsHistory from './components/UserReviewsHistory';
import SupportCenter from './components/SupportCenter';
import { useTheme } from './contexts/ThemeContext';
import ThemeToggle from './components/ThemeToggle';

L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

function UserDashboard() {
  const navigate = useNavigate();
  const [userPhone, setUserPhone] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [activePackages, setActivePackages] = useState([]);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [redeemPackage, setRedeemPackage] = useState('');
  const [redeemMessage, setRedeemMessage] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [ownerId, setOwnerId] = useState('');
  const [ownerInfo, setOwnerInfo] = useState({
    ownerName: '',
    ownerPhone: '',
    ownerWhatsapp: '',
    logoUrl: ''
  });
  
  // New state variables for the new design
  const { isDark } = useTheme();
  const isDarkMode = isDark;
  const [currentSession, setCurrentSession] = useState({
    isConnected: false,
    hotspotName: '',
    hotspotId: '',
    timeRemaining: 0,
    dataUsed: 0,
    dataLimit: 0,
    sessionProgress: 0
  });
  const [notificationCount, setNotificationCount] = useState(0);
  const [profileNotifications, setProfileNotifications] = useState(0);

  // Update loyalty state to include available rewards
  const [loyaltyBalances, setLoyaltyBalances] = useState([]);
  const [currentHotspotLoyalty, setCurrentHotspotLoyalty] = useState(0);
  const [availableLoyaltyRewards, setAvailableLoyaltyRewards] = useState([]);
  const [redeemLoading, setRedeemLoading] = useState(false);

  // Add session monitoring state
  const [sessionCheckInterval, setSessionCheckInterval] = useState(null);

  useEffect(() => {
    const phone = localStorage.getItem('phone');
    if (!phone) {
      navigate('/');
      return;
    }
    setUserPhone(phone);
    fetchUserData(phone);
    // Check for activeTab override (e.g. after login)
    const tab = localStorage.getItem('activeTab');
    if (tab) {
      setActiveTab(tab);
      localStorage.removeItem('activeTab');
    }
  }, [navigate]);

  // Responsive sidebar behavior
  useEffect(() => {
    const apply = () => {
      const desktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
      setIsDesktop(desktop);
      // On desktop we show a docked sidebar (collapsed by default); on mobile it's a drawer closed by default
      if (desktop) {
        setSidebarOpen(false);
      }
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  // Mini map preview
  useEffect(() => {
    let map;
    let cleaned = false;
    const init = async () => {
      const container = document.getElementById('mini-map');
      if (!container || typeof window === 'undefined') return;
      map = L.map('mini-map', { zoomControl: false, attributionControl: false }).setView([0.3476, 32.5825], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
          const { latitude, longitude } = pos.coords;
          if (cleaned) return;
          map.setView([latitude, longitude], 14);
          L.marker([latitude, longitude], { title: 'You are here' }).addTo(map);
          try {
            const res = await axios.get(`/api/hotspots/nearby?lat=${latitude}&lng=${longitude}&radiusKm=3`);
            const hs = (res.data?.hotspots || []).slice(0, 5);
            hs.forEach(h => {
              L.marker([h.latitude, h.longitude], { title: h.hotspotName }).addTo(map);
            });
          } catch {}
        });
      }
    };
    init();
    return () => {
      cleaned = true;
      if (map) map.remove();
    };
  }, [navigate]);

  // Add session monitoring effect
  useEffect(() => {
    if (!userPhone) return;

    // Check session status every 30 seconds
    const interval = setInterval(async () => {
      await checkAndUpdateSessionStatus();
    }, 30000);

    setSessionCheckInterval(interval);

    // Initial check
    checkAndUpdateSessionStatus();

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [userPhone]);

  // Update loyalty fetching to get hotspot-specific balances
  useEffect(() => {
    if (!userPhone) return;
    
    const fetchLoyaltyBalances = async () => {
      try {
        const response = await axios.get(`/api/users/${userPhone}/loyalty`);
        setLoyaltyBalances(response.data || []);
        
        // Find loyalty for current hotspot if connected
        if (currentSession.isConnected && currentSession.hotspotId) {
          const currentHotspotLoyalty = response.data.find(
            balance => balance.hotspotId === currentSession.hotspotId
          );
          setCurrentHotspotLoyalty(currentHotspotLoyalty?.points || 0);
        } else {
          setCurrentHotspotLoyalty(0);
        }
      } catch (error) {
        console.error('Error fetching loyalty balances:', error);
      }
    };
    
    fetchLoyaltyBalances();
  }, [userPhone, currentSession.isConnected, currentSession.hotspotId]);

  // Fetch available loyalty rewards for current hotspot
  useEffect(() => {
    if (!userPhone || !currentSession.isConnected || !currentSession.hotspotId) {
      setAvailableLoyaltyRewards([]);
      return;
    }
    
    const fetchLoyaltyRewards = async () => {
      try {
        const response = await axios.get(`/api/packages/loyalty-rewards/${currentSession.hotspotId}`);
        setAvailableLoyaltyRewards(response.data || []);
      } catch (error) {
        console.error('Error fetching loyalty rewards:', error);
        setAvailableLoyaltyRewards([]);
      }
    };
    
    fetchLoyaltyRewards();
  }, [userPhone, currentSession.isConnected, currentSession.hotspotId]);

  // Function to check and update session status
  const checkAndUpdateSessionStatus = async () => {
    try {
      // Get current active packages/sessions
      const response = await axios.get(`/api/users/${userPhone}/active-packages`);
      const activePackages = response.data || [];

      if (activePackages.length > 0) {
        // User has active sessions
        const activePackage = activePackages[0];
        setCurrentSession({
          isConnected: true,
          hotspotName: activePackage.hotspotName || 'WiFi Hotspot',
          hotspotId: activePackage.hotspotId || activePackage.ownerId || '',
          timeRemaining: activePackage.remaining || 0,
          dataUsed: activePackage.dataUsed || 0,
          dataLimit: activePackage.dataLimit || 0,
          sessionProgress: activePackage.dataUsed && activePackage.dataLimit ? 
            (activePackage.dataUsed / activePackage.dataLimit) * 100 : 0
        });
        setActivePackages(activePackages);
      } else {
        // No active sessions
        setCurrentSession({
          isConnected: false,
          hotspotName: '',
          hotspotId: '',
          timeRemaining: 0,
          dataUsed: 0,
          dataLimit: 0,
          sessionProgress: 0
        });
        setActivePackages([]);
      }
    } catch (error) {
      console.error('Error checking session status:', error);
    }
  };

  // Function to manually refresh session status
  const refreshSessionStatus = async () => {
    await checkAndUpdateSessionStatus();
  };

  const fetchUserData = async (phone) => {
    try {
      setLoading(true);
      
      // Fetch user transactions and active packages
      const [transactionsRes, packagesRes, loyaltyRes] = await Promise.all([
        axios.get(`/api/users/${phone}/transactions`).catch(() => ({ data: [] })),
        axios.get(`/api/users/${phone}/active-packages`).catch(() => ({ data: [] })),
        axios.get(`/api/users/${phone}/loyalty`).catch(() => ({ data: { points: 0 } }))
      ]);

      setTransactions(transactionsRes.data || []);
      setActivePackages(packagesRes.data || []);
      setLoyaltyPoints(loyaltyRes.data?.points || 0);

      // Check if user has active session
      if (packagesRes.data && packagesRes.data.length > 0) {
        const activePackage = packagesRes.data[0];
        setCurrentSession({
          isConnected: true,
          hotspotName: activePackage.hotspotName || 'WiFi Hotspot',
          hotspotId: activePackage.hotspotId || activePackage.ownerId || '',
          timeRemaining: activePackage.remaining || 0,
          dataUsed: activePackage.dataUsed || 0,
          dataLimit: activePackage.dataLimit || 0,
          sessionProgress: activePackage.dataUsed && activePackage.dataLimit ? 
            (activePackage.dataUsed / activePackage.dataLimit) * 100 : 0
        });
      }

      // Try to get owner info from the most recent transaction
      if (transactionsRes.data && transactionsRes.data.length > 0) {
        const lastTransaction = transactionsRes.data[0];
        if (lastTransaction.ownerId) {
          try {
            const ownerRes = await axios.get(`/api/owners/logo/${lastTransaction.ownerId}`);
            setOwnerInfo({
              ownerName: ownerRes.data.ownerName || '',
              ownerPhone: ownerRes.data.ownerPhone || '',
              ownerWhatsapp: ownerRes.data.ownerWhatsapp || '',
              logoUrl: ownerRes.data.logoUrl || '',
              motto: ownerRes.data.motto || ownerRes.data.slogan || ownerRes.data.tagline || ''
            });
            setOwnerId(lastTransaction.ownerId);
            try {
              const notifRes = await axios.get(`/api/owner/notifications`, { params: { ownerId: lastTransaction.ownerId } });
              const notifications = Array.isArray(notifRes.data?.notifications) ? notifRes.data.notifications : [];
              setNotifications(notifications);
              setNotificationCount(notifications.length);
              setProfileNotifications(Math.min(notifications.length, 3)); // Cap at 3 for profile badge
            } catch {}
          } catch (err) {
            console.error('Failed to fetch owner info:', err);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    } finally {
      setLoading(false);
    }
  };


  const handleLogout = () => {
    localStorage.clear();
    navigate('/');
  };

  const formatCurrency = (amount) => {
    return `UGX ${amount?.toLocaleString() || '0'}`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDataUsage = (bytes) => {
    if (bytes === 0) return '0 MB';
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  const formatTimeRemaining = (minutes) => {
    if (minutes === 0) return '0min';
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours}h ${mins}m`;
    }
    return `${minutes}min`;
  };

  const handleRedeemPoints = async (e) => {
    e.preventDefault();
    
    if (!redeemPackage) {
      setRedeemMessage('Please select a package to redeem');
      return;
    }

    // For demo purposes, using fixed point values
    const pointsRequired = redeemPackage === '1hour' ? 100 : 
                          redeemPackage === '1day' ? 500 : 1000;
    
    if (loyaltyPoints < pointsRequired) {
      setRedeemMessage(`You need ${pointsRequired} points to redeem this package. You have ${loyaltyPoints} points.`);
      return;
    }

    try {
      const response = await axios.post(`/api/users/${userPhone}/loyalty/redeem`, {
        points: pointsRequired,
        packageName: redeemPackage === '1hour' ? '1 Hour Access' :
                    redeemPackage === '1day' ? '1 Day Access' : '1 Week Access',
        packageValue: redeemPackage === '1hour' ? 1000 :
                     redeemPackage === '1day' ? 5000 : 10000
      });

      if (response.data.success) {
        setRedeemMessage('✅ Points redeemed successfully! Your free access has been activated.');
        setLoyaltyPoints(response.data.newBalance);
        setShowRedeemModal(false);
        setTimeout(() => setRedeemMessage(''), 3000);
      }
    } catch (error) {
      console.error('Error redeeming points:', error);
      const message = error.response?.data?.error || 'Failed to redeem points';
      setRedeemMessage(`❌ ${message}`);
    }
  };

  // Update loyalty redemption to work with reward packages
  const handleLoyaltyRedemption = async (rewardPackageId) => {
    if (!userPhone || !currentSession.isConnected || !currentSession.hotspotId) {
      setRedeemMessage("❌ You must be connected to a WiFi hotspot to redeem loyalty points");
      return;
    }
    
    setRedeemLoading(true);
    setRedeemMessage("");
    
    try {
      const response = await axios.post(`/api/users/${userPhone}/loyalty/${currentSession.hotspotId}/redeem`, {
        rewardPackageId: rewardPackageId
      });
      
      if (response.data.success) {
        const { reward, newBalance, message } = response.data;
        
        // Show success message with reward details
        let successMessage = `✅ ${message}\n\n`;
        successMessage += `🎁 Reward: ${reward.name}\n`;
        
        if (reward.type === 'time_access') {
          successMessage += `⏰ Access: ${reward.value} minutes\n`;
        } else if (reward.type === 'data_access') {
          successMessage += `📊 Data: ${reward.value} MB\n`;
        } else if (reward.type === 'unlimited') {
          successMessage += `♾️ Access: Unlimited\n`;
        }
        
        successMessage += `💎 Points used: ${reward.pointsUsed}\n`;
        successMessage += `💎 Remaining points: ${newBalance}`;
        
        setRedeemMessage(successMessage);
        
        // Refresh loyalty balances
        const loyaltyResponse = await axios.get(`/api/users/${userPhone}/loyalty`);
        setLoyaltyBalances(loyaltyResponse.data || []);
        
        // Update current hotspot loyalty
        const updatedHotspotLoyalty = loyaltyResponse.data.find(
          balance => balance.hotspotId === currentSession.hotspotId
        );
        setCurrentHotspotLoyalty(updatedHotspotLoyalty?.points || 0);
        
        // Close modal after delay
        setTimeout(() => {
          setShowRedeemModal(false);
          setRedeemMessage("");
        }, 5000);
      }
    } catch (error) {
      console.error("Loyalty redemption error:", error);
      const message = error.response?.data?.error || "Failed to redeem loyalty points";
      setRedeemMessage(`❌ ${message}`);
    } finally {
      setRedeemLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <p>Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  const desktopSidebarWidth = sidebarExpanded ? 260 : 72;
  const sidebarStyle = isDesktop
    ? { ...styles.sidebar, width: desktopSidebarWidth, transform: 'translateX(0)' }
    : { ...styles.sidebar, width: 260, ...(sidebarOpen ? styles.sidebarOpen : styles.sidebarClosed) };

  
  return (
    <div style={{ ...styles.dashboardWrapper, backgroundColor: isDarkMode ? 'var(--n13)' : 'var(--n3)' }}>
      {!isDesktop && !sidebarOpen && (
        <button style={styles.openFab} onClick={() => setSidebarOpen(true)}>☰</button>
      )}
      <aside
        style={{
          ...sidebarStyle,
          backgroundColor: isDarkMode ? 'var(--n12)' : 'var(--n1)',
          color: isDarkMode ? 'var(--n2)' : 'var(--n11)'
        }}
        onMouseEnter={() => isDesktop && setSidebarExpanded(true)}
        onMouseLeave={() => isDesktop && setSidebarExpanded(false)}
      >
        <div style={styles.sidebarInner}>
          <div style={{...styles.sidebarHeader, borderBottom: isDarkMode ? '1px solid var(--n13)' : '1px solid var(--n5)'}}>
            <div style={styles.branding}>
              {ownerInfo?.logoUrl ? (
                <img src={ownerInfo.logoUrl} alt={ownerInfo.ownerName || 'Hotspot'} style={styles.yabaLogo} />
              ) : (
                <div style={{...styles.yabaLogo, display:'flex', alignItems:'center', justifyContent:'center', background: isDarkMode ? 'var(--n13)' : 'var(--n5)', color: isDarkMode ? 'var(--n8)' : 'var(--n11)', fontWeight:700}}>
                  {currentSession.hotspotName ? currentSession.hotspotName.charAt(0) : 'W'}
                </div>
              )}
              {(!isDesktop || sidebarExpanded) && (
                <div style={styles.brandText}>
                  <div style={{...styles.brandName, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>{currentSession.hotspotName || ownerInfo?.ownerName || 'WiFi Hotspot'}</div>
                  <div style={{...styles.brandSubtitle, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>{ownerInfo?.motto || ownerInfo?.slogan || ownerInfo?.tagline || currentSession.hotspotName || ''}</div>
                </div>
              )}
            </div>
            
            {!isDesktop && (
              <button style={styles.sidebarClose} onClick={() => setSidebarOpen(false)}>×</button>
            )}
          </div>

          <div style={{...styles.userProfile, borderBottom: isDarkMode ? '1px solid #111827' : '1px solid #e2e8f0'}}>
            <div style={styles.profilePictureSidebar}>
              <span style={styles.profileInitialSidebar}>{userPhone.charAt(0)}</span>
              {profileNotifications > 0 && (
                <span style={styles.profileNotificationBadgeSidebar}>{profileNotifications}</span>
              )}
            </div>
            {(!isDesktop || sidebarExpanded) && (
              <div style={styles.userInfo}>
                <div style={{...styles.userName, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>{userPhone}</div>
                <div style={{...styles.userEmail, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>{userPhone}@wifi.com</div>
              </div>
            )}
          </div>

          <nav style={styles.sidebarNav} className="sidebar-nav">
            <button
              style={{ 
                ...styles.sidebarItem, 
                ...(activeTab === 'dashboard' ? styles.sidebarItemActive : {}),
                color: isDarkMode ? '#e5e7eb' : '#374151',
                backgroundColor: isDarkMode ? 'transparent' : '#ffffff',
                border: isDarkMode ? '1px solid #0f172a' : '1px solid #e2e8f0'
              }}
              onClick={() => { setActiveTab('dashboard'); setSidebarOpen(false); }}
            >
              <span style={styles.itemIcon}>🏠</span>
              {(!isDesktop || sidebarExpanded) && (
                <div style={styles.itemContent}>
                  <span style={{...styles.itemLabel, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>Dashboard</span>
                  <span style={{...styles.itemDescription, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Overview & current session</span>
                </div>
              )}
            </button>

            <button
              style={{ 
                ...styles.sidebarItem, 
                ...(activeTab === 'hotspots' ? styles.sidebarItemActive : {}),
                color: isDarkMode ? '#e5e7eb' : '#374151',
                backgroundColor: isDarkMode ? 'transparent' : '#ffffff',
                border: isDarkMode ? '1px solid #0f172a' : '1px solid #e2e8f0'
              }}
              onClick={() => { setActiveTab('hotspots'); setSidebarOpen(false); }}
            >
              <span style={styles.itemIcon}>📍</span>
              {(!isDesktop || sidebarExpanded) && (
                <div style={styles.itemContent}>
                  <span style={{...styles.itemLabel, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>Nearby Hotspots</span>
                  <span style={{...styles.itemDescription, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Find WiFi hotspots</span>
                </div>
              )}
            </button>

            <button
              style={{ 
                ...styles.sidebarItem, 
                ...(activeTab === 'packages' ? styles.sidebarItemActive : {}),
                color: isDarkMode ? '#e5e7eb' : '#374151',
                backgroundColor: isDarkMode ? 'transparent' : '#ffffff',
                border: isDarkMode ? '1px solid #0f172a' : '1px solid #e2e8f0'
              }}
              onClick={() => { setActiveTab('packages'); setSidebarOpen(false); }}
            >
              <span style={styles.itemIcon}>📦</span>
              {(!isDesktop || sidebarExpanded) && (
                <div style={styles.itemContent}>
                  <span style={{...styles.itemLabel, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>Buy Packages</span>
                  <span style={{...styles.itemDescription, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Purchase WiFi access</span>
                </div>
              )}
            </button>

            <button
              style={{ 
                ...styles.sidebarItem, 
                ...(activeTab === 'transactions' ? styles.sidebarItemActive : {}),
                color: isDarkMode ? '#e5e7eb' : '#374151',
                backgroundColor: isDarkMode ? 'transparent' : '#ffffff',
                border: isDarkMode ? '1px solid #0f172a' : '1px solid #e2e8f0'
              }}
              onClick={() => { setActiveTab('transactions'); setSidebarOpen(false); }}
            >
              <span style={styles.itemIcon}>📄</span>
              {(!isDesktop || sidebarExpanded) && (
                <div style={styles.itemContent}>
                  <span style={{...styles.itemLabel, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>Transactions</span>
                  <span style={{...styles.itemDescription, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Payment history</span>
                </div>
              )}
            </button>

            <button
              style={{ 
                ...styles.sidebarItem, 
                ...(activeTab === 'loyalty' ? styles.sidebarItemActive : {}),
                color: isDarkMode ? '#e5e7eb' : '#374151',
                backgroundColor: isDarkMode ? 'transparent' : '#ffffff',
                border: isDarkMode ? '1px solid #0f172a' : '1px solid #e2e8f0'
              }}
              onClick={() => { setActiveTab('loyalty'); setSidebarOpen(false); }}
            >
              <span style={styles.itemIcon}>⭐</span>
              {(!isDesktop || sidebarExpanded) && (
                <div style={styles.itemContent}>
                  <span style={{...styles.itemLabel, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>Loyalty Points</span>
                  <span style={{...styles.itemDescription, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Rewards & points</span>
                </div>
              )}
            </button>

            <button
              style={{ 
                ...styles.sidebarItem, 
                ...(activeTab === 'reviews' ? styles.sidebarItemActive : {}),
                color: isDarkMode ? '#e5e7eb' : '#374151',
                backgroundColor: isDarkMode ? 'transparent' : '#ffffff',
                border: isDarkMode ? '1px solid #0f172a' : '1px solid #e2e8f0'
              }}
              onClick={() => { setActiveTab('reviews'); setSidebarOpen(false); }}
            >
              <span style={styles.itemIcon}>📝</span>
              {(!isDesktop || sidebarExpanded) && (
                <div style={styles.itemContent}>
                  <span style={{...styles.itemLabel, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>My Reviews</span>
                  <span style={{...styles.itemDescription, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Rate & review hotspots</span>
                </div>
              )}
            </button>


            <button
              style={{ 
                ...styles.sidebarItem, 
                ...(activeTab === 'support' ? styles.sidebarItemActive : {}),
                color: isDarkMode ? '#e5e7eb' : '#374151',
                backgroundColor: isDarkMode ? 'transparent' : '#ffffff',
                border: isDarkMode ? '1px solid #0f172a' : '1px solid #e2e8f0'
              }}
              onClick={() => { setActiveTab('support'); setSidebarOpen(false); }}
            >
              <span style={styles.itemIcon}>💬</span>
              {(!isDesktop || sidebarExpanded) && (
                <div style={styles.itemContent}>
                  <span style={{...styles.itemLabel, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>Support Center</span>
                  <span style={{...styles.itemDescription, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>Get help</span>
                </div>
              )}
            </button>
          </nav>

          {/* Current Connection Status */}
          {(!isDesktop || sidebarExpanded) && (
            <div style={{...styles.connectionStatusSidebar, borderTop: isDarkMode ? '1px solid #111827' : '1px solid #e2e8f0'}}>
              <div style={styles.statusDotSidebar} className={currentSession.isConnected ? 'connected' : 'disconnected'}></div>
              <div style={styles.connectionInfo}>
                <div style={{...styles.connectionStatusText, color: isDarkMode ? 'var(--n2)' : 'var(--n11)'}}>
                  {currentSession.isConnected ? 'Connected' : 'Not Connected'}
                </div>
                {currentSession.isConnected && (
                  <div style={{...styles.connectionDetails, color: isDarkMode ? 'var(--n8)' : 'var(--n9)'}}>
                    {currentSession.hotspotName}
                    {currentSession.timeRemaining > 0 && (
                      <span style={{...styles.connectionTime, color: isDarkMode ? '#10b981' : '#059669'}}>
                        {formatTimeRemaining(currentSession.timeRemaining)} remaining
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{...styles.sidebarFooter, borderTop: isDarkMode ? '1px solid #111827' : '1px solid #e2e8f0'}}>
            <button
              onClick={handleLogout}
              style={styles.logoutSidebarBtn}
            >
              <span style={styles.itemIcon}>🚪</span>
              {(!isDesktop || sidebarExpanded) && <span style={{...styles.itemLabel, color: isDarkMode ? '#fecaca' : '#dc2626'}}>Logout</span>}
            </button>
          </div>
        </div>
      </aside>

      <div style={{ ...styles.content, marginLeft: isDesktop ? desktopSidebarWidth : 0 }}>
        {/* Top Header Bar */}
        <div style={styles.topHeader}>
          <div style={styles.connectionStatus}>
            <div style={styles.statusDot} className={currentSession.isConnected ? 'connected' : 'disconnected'}></div>
            <span style={styles.statusText}>
              {currentSession.isConnected ? `Connected to ${currentSession.hotspotName}` : 'Not Connected'}
            </span>
            {currentSession.isConnected && currentSession.timeRemaining > 0 && (
              <span style={styles.timeRemaining}>
                {formatTimeRemaining(currentSession.timeRemaining)} remaining
              </span>
            )}
            {/* Add refresh button for session status */}
            <button 
              onClick={refreshSessionStatus}
              style={styles.refreshSessionButton}
              title="Refresh session status"
            >
              🔄
            </button>
          </div>
          
          <div style={styles.headerRight}>
            {/* Show current hotspot loyalty points if connected */}
            {currentSession.isConnected && currentHotspotLoyalty > 0 && (
              <div style={{
                backgroundColor: isDarkMode ? '#1f2937' : '#f3f4f6',
                border: isDarkMode ? '1px solid #374151' : '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '4px',
                width: '40px',
                height: '40px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                boxSizing: 'border-box',
                margin: '0',
                overflow: 'hidden'
              }}>
                <span style={{
                  fontSize: '12px', 
                  color: isDarkMode ? 'var(--n2)' : 'var(--n11)',
                  fontWeight: '600',
                  lineHeight: '1',
                  margin: '0',
                  padding: '0'
                }}>{currentHotspotLoyalty}</span>
                <span style={{
                  fontSize: '8px', 
                  color: isDarkMode ? 'var(--n8)' : 'var(--n9)',
                  lineHeight: '1',
                  margin: '0',
                  padding: '0'
                }}>pts</span>
              </div>
            )}
            
            <div style={{
              backgroundColor: isDarkMode ? '#1f2937' : '#f3f4f6',
              border: isDarkMode ? '1px solid #374151' : '1px solid #d1d5db',
              borderRadius: '8px',
              padding: '4px',
              width: '40px',
              height: '40px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
              boxSizing: 'border-box',
              margin: '0',
              overflow: 'hidden'
            }}>
              <span style={{
                fontSize: '12px', 
                color: isDarkMode ? 'var(--n2)' : 'var(--n11)',
                fontWeight: '600',
                lineHeight: '1',
                margin: '0',
                padding: '0'
              }}>{formatDataUsage(currentSession.dataUsed)}</span>
              <span style={{
                fontSize: '8px', 
                color: isDarkMode ? 'var(--n8)' : 'var(--n9)',
                lineHeight: '1',
                margin: '0',
                padding: '0'
              }}>used</span>
            </div>
            
            
            <div 
              style={{
                backgroundColor: isDarkMode ? '#1f2937' : '#f3f4f6',
                border: isDarkMode ? '1px solid #374151' : '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '8px',
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxSizing: 'border-box',
                margin: '0',
                position: 'relative'
              }} 
              onClick={() => setActiveTab('notifications')}
            >
              <span style={{...styles.bellIcon, fontSize: '16px'}}>🔔</span>
              {notificationCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-2px',
                  right: '-2px',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  borderRadius: '50%',
                  width: '16px',
                  height: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  border: '1px solid white'
                }}>{notificationCount}</span>
              )}
            </div>
            
            {/* Theme Toggle - positioned right next to notification bell */}
            <ThemeToggle />
            
            <div style={styles.profileSection}>
              <div style={styles.profilePicture}>
                <span style={styles.profileInitial}>{userPhone.charAt(0)}</span>
                {profileNotifications > 0 && (
                  <span style={styles.profileNotificationBadge}>{profileNotifications}</span>
                )}
              </div>
              <span style={styles.profileName}>{userPhone}</span>
              <span style={styles.profileDropdown}>▼</span>
            </div>
          </div>
        </div>

        {activeTab === 'packages' && (
          <div style={styles.section}>
            <Packages />
          </div>
        )}

        {activeTab === 'transactions' && (
          <div style={styles.section}>
            {console.log('Rendering TransactionsSection with transactions:', transactions)}
            <TransactionsSection transactions={transactions || []} />
          </div>
        )}

        {activeTab === 'loyalty' && (
          <div style={styles.section}>
            {console.log('Rendering LoyaltyProgram with props:', { userPhone, currentSession, ownerId })}
            <LoyaltyProgram 
              userPhone={userPhone} 
              currentHotspotId={currentSession.hotspotId || ownerId} 
            />
          </div>
        )}

        {activeTab === 'reviews' && (
          <div style={styles.section}>
            <UserReviewsHistory 
              userPhone={userPhone} 
              currentHotspotId={currentSession.hotspotId || ownerId} 
            />
          </div>
        )}


        {activeTab === 'dashboard' && (
          <>
            {/* Welcome Banner */}
            <div className="yaba-card" style={styles.welcomeBanner}>
              <div style={styles.welcomeText}>
                <h2 className="yaba-card-title">Welcome back, {userPhone}! 👋</h2>
                <p className="yaba-muted">
                  {currentSession.isConnected ? `You're connected to ${currentSession.hotspotName}` : 'Connect to a WiFi hotspot to get started'}
                </p>
              </div>
              {/* Update loyalty points banner to show current hotspot points */}
              {currentSession.isConnected && currentHotspotLoyalty > 0 && (
                <div className="yaba-btn yaba-btn--success" style={styles.loyaltyPointsBanner}>
                  ⭐ {currentHotspotLoyalty} Loyalty Points at {currentSession.hotspotName}
                </div>
              )}
            </div>

            {/* Key Metrics Cards */}
            <div style={styles.metricsGrid}>
              <div className="yaba-card">
                <div style={styles.metricHeader}>
                  <span className="yaba-muted">Active Session</span>
                  <span style={styles.metricTrend}>↓</span>
                </div>
                <div className="yaba-card-title" style={{fontSize: '24px', margin: '8px 0'}}>
                  {currentSession.isConnected ? 'Connected' : 'Not Connected'}
                </div>
                <div className="yaba-muted" style={{fontSize: '12px'}}>vs last month</div>
              </div>

              <div className="yaba-card">
                <div style={styles.metricHeader}>
                  <span className="yaba-muted">Time Remaining</span>
                  <span style={styles.metricTrend}>↓</span>
                </div>
                <div className="yaba-card-title" style={{fontSize: '24px', margin: '8px 0'}}>
                  {currentSession.isConnected ? formatTimeRemaining(currentSession.timeRemaining) : '0min'}
                </div>
                <div className="yaba-muted" style={{fontSize: '12px'}}>vs last month</div>
              </div>

              <div className="yaba-card">
                <div style={styles.metricHeader}>
                  <span className="yaba-muted">Loyalty Points</span>
                  <span style={styles.metricTrend}>↓</span>
                </div>
                <div className="yaba-card-title" style={{fontSize: '24px', margin: '8px 0'}}>{loyaltyPoints}</div>
                <div className="yaba-muted" style={{fontSize: '12px'}}>vs last month</div>
              </div>

              <div className="yaba-card">
                <div style={styles.metricHeader}>
                  <span className="yaba-muted">Data Used</span>
                  <span style={styles.metricTrend}>↓</span>
                </div>
                <div className="yaba-card-title" style={{fontSize: '24px', margin: '8px 0'}}>
                  {formatDataUsage(currentSession.dataUsed)}
                </div>
                <div className="yaba-muted" style={{fontSize: '12px'}}>vs last month</div>
              </div>
            </div>

            {/* Current Session Section */}
            <div className="yaba-card">
              <h3 className="yaba-card-title">Current Session</h3>
              
              <div style={styles.sessionBoxes}>
                <div className="yaba-card yaba-elev-2">
                  <div style={styles.sessionBoxIcon}>📶</div>
                  <div style={styles.sessionBoxContent}>
                    <div className="yaba-muted">
                      {currentSession.isConnected ? 'Connected to WiFi' : 'Not Connected'}
                    </div>
                    <div className="yaba-card-title" style={{fontSize: '18px', margin: '4px 0'}}>
                      {currentSession.isConnected ? currentSession.hotspotName : 'Connect to get started'}
                    </div>
                  </div>
                </div>

                <div className="yaba-card yaba-elev-2">
                  <div style={styles.sessionBoxIcon}>⏰</div>
                  <div style={styles.sessionBoxContent}>
                    <div className="yaba-muted">Time Remaining</div>
                    <div className="yaba-card-title" style={{fontSize: '18px', margin: '4px 0'}}>
                      {currentSession.isConnected ? formatTimeRemaining(currentSession.timeRemaining) : '0h 0m'}
                    </div>
                  </div>
                </div>

                <div className="yaba-card yaba-elev-2">
                  <div style={styles.sessionBoxIcon}>📊</div>
                  <div style={styles.sessionBoxContent}>
                    <div className="yaba-muted">Data Usage</div>
                    <div className="yaba-card-title" style={{fontSize: '18px', margin: '4px 0'}}>
                      {currentSession.isConnected ? 
                        `${formatDataUsage(currentSession.dataUsed)} / ${formatDataUsage(currentSession.dataLimit)} (${currentSession.sessionProgress.toFixed(1)}%)` :
                        '0 MB / 0 MB (0%)'
                      }
                    </div>
                  </div>
                </div>
              </div>

              {currentSession.isConnected && (
                <div style={styles.sessionProgressContainer}>
                  <div style={styles.sessionProgressBar}>
                    <div 
                      style={{
                        ...styles.sessionProgressFill,
                        width: `${currentSession.sessionProgress}%`
                      }}
                    ></div>
                  </div>
                  <span style={styles.sessionProgressText}>20% used</span>
                </div>
              )}
            </div>

            {/* Quick Action Cards */}
            <div style={styles.quickActionsGrid}>
              <div className="yaba-card">
                <div style={styles.quickActionIcon}>📦</div>
                <div style={styles.quickActionContent}>
                  <h4 className="yaba-card-title">Buy Packages</h4>
                  <p className="yaba-muted">Purchase WiFi access time</p>
                  <button 
                    onClick={() => setActiveTab('packages')}
                    className="yaba-btn yaba-btn--accent"
                    style={{width: '100%', marginTop: '12px'}}
                  >
                    View Packages
                  </button>
                </div>
              </div>

              <div className="yaba-card">
                <div style={styles.quickActionIcon}>⭐</div>
                <div style={styles.quickActionContent}>
                  <h4 className="yaba-card-title">Loyalty Points</h4>
                  <p className="yaba-muted">Redeem points for free WiFi</p>
                  <button 
                    onClick={() => setShowRedeemModal(true)}
                    className="yaba-btn yaba-btn--success"
                    style={{width: '100%', marginTop: '12px'}}
                  >
                    Use Points
                  </button>
                </div>
              </div>

              <div className="yaba-card">
                <div style={styles.quickActionIcon}>👥</div>
                <div style={styles.quickActionContent}>
                  <h4 className="yaba-card-title">Refer Friends</h4>
                  <p className="yaba-muted">Earn points by referring</p>
                  <button 
                    onClick={() => {/* TODO: Implement referral system */}}
                    className="yaba-btn yaba-btn--secondary"
                    style={{width: '100%', marginTop: '12px'}}
                  >
                    Share Link
                  </button>
                </div>
              </div>
            </div>

      {activePackages.length > 0 && (
        <div className="yaba-card">
          <h3 className="yaba-card-title">Active Packages</h3>
          {activePackages.map((pkg, index) => (
            <div key={index} className="yaba-card yaba-elev-2" style={{marginBottom: '12px'}}>
              <div style={styles.packageHeader}>
                <h4 className="yaba-card-title" style={{fontSize: '16px', margin: '0 0 8px 0'}}>{pkg.packageName}</h4>
                <span className="yaba-btn yaba-btn--success" style={{padding: '4px 8px', fontSize: '12px'}}>Active</span>
              </div>
              <div style={styles.packageDetails}>
                <p className="yaba-muted">Data/Time Remaining: {pkg.remaining || 'Unlimited'}</p>
                <p className="yaba-muted">Expires: {formatDate(pkg.expiresAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Transactions Section */}
      <div className="yaba-card">
        <div style={styles.sectionHeader}>
          <h3 className="yaba-card-title">Recent Transactions</h3>
          <button 
            onClick={() => setActiveTab('transactions')}
            className="yaba-btn yaba-btn--accent"
          >
            View All
          </button>
        </div>
        
        {transactions.length === 0 ? (
          <div style={styles.emptyState}>
            <p className="yaba-muted">No transactions yet</p>
            <button 
              onClick={() => setActiveTab('packages')}
              className="yaba-btn yaba-btn--accent"
              style={{marginTop: '12px'}}
            >
              Buy Your First Package
            </button>
          </div>
        ) : (
          <div style={styles.transactionsList}>
            {transactions.slice(0, 3).map((transaction, index) => (
              <div key={index} className="yaba-card yaba-elev-2" style={{marginBottom: '12px'}}>
                <div style={styles.transactionIcon}>
                  {transaction.type === 'points' ? '⭐' : 
                   transaction.type === 'voucher' ? '📄' : '📦'}
                </div>
                <div style={styles.transactionContent}>
                  <div style={styles.transactionHeader}>
                    <h4 className="yaba-card-title" style={{fontSize: '16px', margin: '0 0 4px 0'}}>{transaction.packageName}</h4>
                    <span className="yaba-muted" style={{fontWeight: '600'}}>
                      {transaction.type === 'points' || transaction.type === 'voucher' ? 'Free' : formatCurrency(transaction.amount)}
                    </span>
                  </div>
                  <div style={styles.transactionDetails}>
                    <span className="yaba-muted" style={{fontSize: '12px'}}>
                      {transaction.type === 'points' ? 'Points Redeemed' :
                       transaction.type === 'voucher' ? 'Voucher Used' : 'Package Purchase'}
                    </span>
                    <span className="yaba-muted" style={{fontSize: '12px'}}>{formatDate(transaction.time)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>




          </>
        )}

        {activeTab === 'hotspots' && (
          <div className="yaba-card">
            <h3 className="yaba-card-title">Find Hotspots Near Me</h3>
            <HotspotsMap />
          </div>
        )}

        {activeTab === 'notifications' && (
          <div className="yaba-card">
            <h3 className="yaba-card-title">Notifications</h3>
            {notifications.length === 0 ? (
              <div style={styles.emptyState}>
                <p className="yaba-muted">No notifications at the moment.</p>
              </div>
            ) : (
              <div style={styles.transactionsList}>
                {notifications.map((n, idx) => (
                  <div key={idx} className="yaba-card yaba-elev-2" style={{marginBottom: '12px'}}>
                    <div style={styles.transactionHeader}>
                      <h4 className="yaba-card-title" style={{fontSize: '16px', margin: '0 0 4px 0'}}>{n.type?.replace(/_/g, ' ') || 'Notice'}</h4>
                      <span className="yaba-muted">{new Date(n.date || Date.now()).toLocaleString()}</span>
                    </div>
                    <div style={styles.transactionDetails}>
                      <p className="yaba-muted">{n.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'support' && (
          <SupportCenter ownerId={ownerId} ownerInfo={ownerInfo} />
        )}

        {/* Loyalty Points Redemption Modal */}
        {showRedeemModal && (
          <div style={styles.modalOverlay}>
            <div className="yaba-card" style={styles.modal}>
              <div style={styles.modalHeader}>
                <h3 className="yaba-card-title">Redeem Loyalty Points</h3>
                <button onClick={() => setShowRedeemModal(false)} className="yaba-btn yaba-btn--secondary" style={styles.closeButton}>×</button>
              </div>
              
              <div style={styles.modalContent}>
                {/* Show current points balance */}
                <div className="yaba-card yaba-elev-2" style={styles.currentPointsSection}>
                  <span className="yaba-muted">Your Points:</span>
                  <span className="yaba-card-title" style={{fontSize: '24px', color: 'var(--accent)'}}>{currentHotspotLoyalty}</span>
                </div>
                
                {/* Show available loyalty rewards */}
                {availableLoyaltyRewards.length > 0 ? (
                  <div style={styles.loyaltyRewardsSection}>
                    <h4 className="yaba-card-title">Available Rewards</h4>
                    <div style={styles.rewardsGrid}>
                      {availableLoyaltyRewards.map((reward) => {
                        const canAfford = currentHotspotLoyalty >= reward.pointsRequired;
                        
                        return (
                          <div 
                            key={reward.id} 
                            className="yaba-card yaba-elev-2"
                            style={{
                              opacity: canAfford ? 1 : 0.6,
                              border: `2px solid ${canAfford ? 'var(--success)' : 'var(--danger)'}`
                            }}
                          >
                            <div style={styles.rewardHeader}>
                              <h5 className="yaba-card-title" style={{fontSize: '16px', margin: '0 0 8px 0'}}>{reward.name}</h5>
                              <span className="yaba-btn yaba-btn--success" style={{padding: '4px 8px', fontSize: '12px'}}>{reward.pointsRequired} pts</span>
                            </div>
                            
                            <div style={styles.rewardDetails}>
                              {reward.rewardType === 'time_access' && (
                                <span className="yaba-muted">⏰ {reward.rewardValue} minutes</span>
                              )}
                              {reward.rewardType === 'data_access' && (
                                <span className="yaba-muted">📊 {reward.rewardValue} MB</span>
                              )}
                              {reward.rewardType === 'unlimited' && (
                                <span className="yaba-muted">♾️ Unlimited access</span>
                              )}
                            </div>
                            
                            {reward.rewardDescription && (
                              <p className="yaba-muted" style={{fontStyle: 'italic', margin: '8px 0'}}>{reward.rewardDescription}</p>
                            )}
                            
                            <button
                              onClick={() => handleLoyaltyRedemption(reward.id)}
                              disabled={!canAfford || redeemLoading}
                              className={canAfford ? "yaba-btn yaba-btn--success" : "yaba-btn yaba-btn--secondary"}
                              style={{width: '100%', marginTop: '12px'}}
                            >
                              {redeemLoading ? 'Processing...' : canAfford ? 'Redeem' : 'Not Enough Points'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={styles.noRewardsSection}>
                    <p className="yaba-muted">
                      No loyalty rewards available at this hotspot yet.
                    </p>
                  </div>
                )}
                
                {/* Show redemption message */}
                {redeemMessage && (
                  <div className="yaba-card yaba-elev-2" style={{
                    backgroundColor: redeemMessage.startsWith('✅') ? 'var(--success)' : 'var(--danger)',
                    color: 'white',
                    marginTop: '16px'
                  }}>
                    {redeemMessage.split('\n').map((line, index) => (
                      <div key={index} style={styles.messageLine}>
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div style={styles.modalFooter}>
                <button 
                  onClick={() => setShowRedeemModal(false)} 
                  className="yaba-btn yaba-btn--secondary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  dashboardWrapper: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: '#f3f4f6',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    width: '100%',
  },
  content: {
    flex: 1,
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
    width: '100%',
  },
  loading: {
    textAlign: 'center',
    padding: '50px',
  },
  sidebar: {
    position: 'fixed',
    top: 0,
    bottom: 0,
    width: 260,
    backgroundColor: '#0b1220',
    color: '#e5e7eb',
    padding: 0,
    boxShadow: '2px 0 8px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s ease',
    zIndex: 1100,
  },
  sidebarInner: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  sidebarOpen: {
    transform: 'translateX(0)',
  },
  sidebarClosed: {
    transform: 'translateX(-270px)',
  },
  sidebarHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 12px',
    borderBottom: '1px solid #111827',
  },
  branding: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  brandText: {
    marginLeft: 10,
  },
  brandName: {
    fontWeight: 600,
    color: '#cbd5e1',
    fontSize: 12,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  brandSubtitle: {
    color: '#f9fafb',
    fontWeight: 600,
    fontSize: 14,
  },
  yabaLogo: {
    width: '30px',
    height: '30px',
    borderRadius: '8px',
    objectFit: 'contain',
  },
  userProfile: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 12px 12px 12px',
    borderBottom: '1px solid #111827',
  },
  profilePictureSidebar: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#e0e7ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  profileInitialSidebar: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#4f46e5',
  },
  userInfo: {
    marginLeft: 10,
  },
  userName: {
    fontWeight: '600',
    color: '#f9fafb',
    fontSize: 14,
  },
  userEmail: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  topHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'var(--surface-gradient)',
    borderRadius: '20px',
    boxShadow: '0 10px 20px rgba(0,0,0,0.35)',
    padding: '15px 20px',
    marginBottom: '20px',
    border: '1px solid var(--stroke)',
    color: 'var(--text-primary)',
    position: 'relative',
    overflow: 'hidden',
  },
  connectionStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--text-primary)',
    fontSize: '14px',
  },
  statusDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#10b981', // Green for connected
  },
  statusText: {
    fontWeight: '500',
  },
  timeRemaining: {
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
  },
  headerStat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#1f2937',
  },
  statLabel: {
    fontSize: '12px',
    color: '#6b7280',
  },
  notificationIcon: {
    position: 'relative',
    cursor: 'pointer',
  },
  bellIcon: {
    fontSize: '20px',
  },
  notificationBadge: {
    position: 'absolute',
    top: '-5px',
    right: '-5px',
    backgroundColor: '#ef4444',
    color: '#ffffff',
    borderRadius: '50%',
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  profileSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    cursor: 'pointer',
  },
  profilePicture: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#e0e7ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  profileInitial: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#4f46e5',
  },
  profileNotificationBadge: {
    position: 'absolute',
    top: '-5px',
    right: '-5px',
    backgroundColor: '#ef4444',
    color: '#ffffff',
    borderRadius: '50%',
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  profileName: {
    fontWeight: '600',
    color: 'var(--text-primary)',
  },
  profileDropdown: {
    fontSize: '16px',
    color: 'var(--text-muted)',
  },
  sidebarNav: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '12px 12px 12px 12px',
    overflowY: 'auto',
    overflowX: 'hidden',
    scrollbarWidth: 'thin',
    scrollbarColor: '#4a5568 #2d3748',
  },
  sidebarItem: {
    textAlign: 'left',
    padding: '10px 12px',
    background: 'none',
    backgroundColor: 'transparent',
    border: '1px solid #0f172a',
    borderRadius: 10,
    color: '#e5e7eb',
    cursor: 'pointer',
    fontSize: 14,
    WebkitTapHighlightColor: 'transparent',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    boxShadow: 'none',
  },
  sidebarItemActive: {
    backgroundColor: '#0f1b33',
    border: '1px solid #1e293b',
    color: '#f9fafb',
    boxShadow: 'none',
  },
  itemIcon: { 
    width: 22, 
    textAlign: 'center' 
  },
  itemContent: {
    display: 'flex',
    flexDirection: 'column',
  },
  itemLabel: {
    fontWeight: '500',
    color: '#f9fafb',
    fontSize: 14,
  },
  itemDescription: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  connectionStatusSidebar: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 12px 12px 12px',
    borderTop: '1px solid #111827',
  },
  statusDotSidebar: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#10b981', // Green for connected
  },
  connectionInfo: {
    marginLeft: 10,
  },
  connectionStatusText: {
    fontWeight: '500',
    color: '#f9fafb',
    fontSize: 14,
  },
  connectionDetails: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  connectionTime: {
    fontWeight: '600',
    color: '#10b981',
  },
  themeToggle: {
    background: 'transparent',
    border: 'none',
    color: '#6b7280',
    fontSize: '20px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  // Status dot styles for connected/disconnected states
  '.connected': {
    backgroundColor: '#10b981', // Green for connected
  },
  '.disconnected': {
    backgroundColor: '#6b7280', // Gray for disconnected
  },
  sidebarFooter: {
    marginTop: 'auto',
    padding: 12,
    borderTop: '1px solid #111827',
  },
  logoutSidebarBtn: {
    width: '100%',
    padding: '10px 12px',
    background: '#7f1d1d',
    color: '#fecaca',
    border: '1px solid #991b1b',
    borderRadius: 10,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  openFab: {
    position: 'fixed',
    left: 12,
    top: 12,
    zIndex: 1200,
    width: 44,
    height: 44,
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    backgroundColor: '#111827',
    color: '#f9fafb',
    boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  section: {
    background: 'var(--surface)',
    color: 'var(--text-primary)',
    padding: '20px',
    borderRadius: '20px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    marginBottom: '20px',
    border: '1px solid var(--stroke)',
    position: 'relative',
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    margin: '0 0 15px 0',
    color: 'var(--text-primary)',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px 20px',
    color: 'var(--text-muted)',
  },
  primaryBtn: {
    padding: '12px 24px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    flex: 1,
    minWidth: '150px',
    width: '100%',
  },
  transactionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  transactionCard: {
    border: '1px solid var(--stroke)',
    borderRadius: '16px',
    padding: '15px',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    background: 'var(--surface)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    color: 'var(--text-primary)'
  },
  transactionIcon: {
    fontSize: '36px',
    color: '#4f46e5',
  },
  transactionContent: {
    flex: 1,
  },
  transactionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '5px',
  },
  transactionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    marginBottom: '5px',
  },
  transactionAmount: {
    fontWeight: '600',
    color: 'var(--text-primary)',
  },
  transactionDetails: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
  transactionType: {
    fontSize: '12px',
    fontWeight: '500',
    color: 'var(--text-primary)',
  },
  transactionDate: {
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '500px',
    width: '90%',
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: '#6b7280',
  },
  modalSubtext: {
    color: '#6b7280',
    marginBottom: '20px',
  },
  redeemForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  packageOptions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  packageOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  packageInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flex: 1,
  },
  packageName: {
    fontWeight: '500',
    color: '#374151',
  },
  packageCost: {
    color: '#f59e0b',
    fontWeight: '600',
  },
  redeemMessage: {
    marginTop: '16px',
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: '#f0f9ff',
    border: '1px solid #0ea5e9',
    textAlign: 'center',
    fontSize: '14px',
  },
  // Missing styles for the new design
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  metricCard: {
    padding: '20px',
    borderRadius: '20px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    textAlign: 'center',
    background: 'var(--surface)',
    color: 'var(--text-primary)',
    border: '1px solid var(--stroke)',
    position: 'relative',
    overflow: 'hidden',
  },
  metricHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
    fontSize: '14px',
    color: '#6b7280',
  },
  metricLabel: {
    fontWeight: '500',
    color: 'var(--text-primary)',
  },
  metricTrend: {
    fontSize: '12px',
    color: 'var(--danger)', // Red for down trend
  },
  metricValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: 'var(--text-primary)',
    marginBottom: '5px',
  },
  metricSubtext: {
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  supportSection: {
    backgroundColor: '#f8fafc',
    padding: '20px',
    borderRadius: '12px',
    marginBottom: '30px',
    border: '1px solid #e2e8f0',
  },
  supportButtons: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    width: '100%',
  },
  supportBtn: {
    padding: '12px 20px',
    backgroundColor: 'transparent',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    transition: 'all 0.2s',
    flex: 1,
    minWidth: '200px',
  },
  welcomeBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '20px',
    border: '1px solid #e2e8f0',
  },
  welcomeText: {
    flex: 1,
  },
  welcomeTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: 'var(--text-primary)',
    margin: '0 0 5px 0',
  },
  welcomeSubtitle: {
    fontSize: '16px',
    color: 'var(--text-muted)',
    margin: 0,
  },
  loyaltyPointsBanner: {
    padding: '8px 16px',
    backgroundColor: '#dcfce7',
    color: '#166534',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: '500',
  },
  currentSessionSection: {
    background: 'var(--surface)',
    padding: '20px',
    borderRadius: '20px',
    marginBottom: '30px',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    color: 'var(--text-primary)',
    position: 'relative',
    overflow: 'hidden',
  },
  sessionBoxes: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '15px',
    marginBottom: '15px',
  },
  sessionBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    padding: '15px',
    background: 'var(--surface)',
    borderRadius: '16px',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
  },
  sessionBoxIcon: {
    fontSize: '28px',
    color: '#4f46e5',
  },
  sessionBoxContent: {
    display: 'flex',
    flexDirection: 'column',
  },
  sessionBoxTitle: {
    fontSize: '14px',
    fontWeight: '500',
    color: 'var(--text-primary)',
    marginBottom: '5px',
  },
  sessionBoxValue: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: 'var(--text-primary)',
  },
  sessionProgressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '15px',
  },
  sessionProgressBar: {
    width: '100%',
    height: '8px',
    backgroundColor: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  sessionProgressFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: '4px',
    transition: 'width 0.3s ease-in-out',
  },
  sessionProgressText: {
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  quickActionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  quickActionCard: {
    background: 'var(--surface)',
    borderRadius: '20px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    color: 'var(--text-primary)',
    position: 'relative',
    overflow: 'hidden',
  },
  quickActionIcon: {
    fontSize: '40px',
    color: '#4f46e5',
    marginBottom: '15px',
  },
  quickActionContent: {
    marginBottom: '15px',
  },
  quickActionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    marginBottom: '8px',
  },
  quickActionDescription: {
    fontSize: '14px',
    color: 'var(--text-muted)',
    marginBottom: '15px',
  },
  quickActionButton: {
    padding: '10px 20px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    width: '100%',
  },
  recentTransactionsSection: {
    background: 'var(--surface)',
    padding: '20px',
    borderRadius: '20px',
    marginBottom: '30px',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    color: 'var(--text-primary)',
    position: 'relative',
    overflow: 'hidden',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
  },
  viewAllButton: {
    padding: '8px 16px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  refreshSessionButton: {
    background: 'none',
    border: 'none',
    fontSize: '16px',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    marginLeft: '8px',
    transition: 'transform 0.2s',
    ':hover': {
      transform: 'rotate(180deg)',
    },
  },
  // Add new styles for hotspot-specific loyalty
  hotspotLabel: {
    fontSize: '10px',
    color: '#6b7280',
    marginTop: '2px',
    display: 'block',
  },
  // New styles for loyalty rewards
  currentPointsSection: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px',
    backgroundColor: '#f0f9ff',
    border: '1px solid #0ea5e9',
    borderRadius: '8px',
    marginBottom: '20px',
  },
  currentPointsLabel: {
    fontSize: '16px',
    fontWeight: '500',
    color: '#0ea5e9',
  },
  currentPointsValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#0ea5e9',
  },
  loyaltyRewardsSection: {
    marginBottom: '20px',
  },
  rewardsTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#374151',
    margin: '0 0 16px 0',
  },
  rewardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '16px',
  },
  rewardCard: {
    padding: '16px',
    border: '2px solid #10b981',
    borderRadius: '8px',
    backgroundColor: 'var(--surface)',
    transition: 'all 0.2s',
  },
  rewardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  rewardName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#374151',
    margin: 0,
  },
  rewardPoints: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#10b981',
    backgroundColor: '#ecfdf5',
    padding: '4px 8px',
    borderRadius: '12px',
  },
  rewardDetails: {
    marginBottom: '12px',
  },
  rewardInfo: {
    fontSize: '14px',
    color: '#6b7280',
    display: 'block',
    marginBottom: '4px',
  },
  rewardDescription: {
    fontSize: '12px',
    color: '#6b7280',
    margin: '0 0 16px 0',
    fontStyle: 'italic',
  },
  redeemButton: {
    width: '100%',
    padding: '10px 16px',
    border: 'none',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  noRewardsSection: {
    textAlign: 'center',
    padding: '40px 20px',
    color: '#6b7280',
  },
  noRewardsText: {
    fontSize: '16px',
    margin: 0,
  },
  redeemMessage: {
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid',
    marginTop: '16px',
    whiteSpace: 'pre-line',
    fontSize: '14px',
  },
  messageLine: {
    marginBottom: '4px',
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '20px',
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: '#6b7280',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  modalContent: {
    marginBottom: '20px',
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: 'var(--text-primary)',
    margin: 0,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: 'var(--text-muted)',
  },
};

// Add custom scrollbar styles for webkit browsers
const scrollbarStyles = `
  .sidebar-nav::-webkit-scrollbar {
    width: 6px;
  }
  
  .sidebar-nav::-webkit-scrollbar-track {
    background: #2d3748;
    border-radius: 3px;
  }
  
  .sidebar-nav::-webkit-scrollbar-thumb {
    background: #4a5568;
    border-radius: 3px;
  }
  
  .sidebar-nav::-webkit-scrollbar-thumb:hover {
    background: #718096;
  }
`;

// Inject the styles into the document
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = scrollbarStyles;
  document.head.appendChild(styleSheet);
}

export default UserDashboard;
