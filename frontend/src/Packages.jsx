import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { db } from "./firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import ReviewPopup from './components/ReviewPopup';
import { formatUGX } from "./components/currency";
import { useTheme } from "./contexts/ThemeContext";

export default function Packages() {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const [packages, setPackages] = useState([]);
  const [logo, setLogo] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerWhatsapp, setOwnerWhatsapp] = useState("");
  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherMessage, setVoucherMessage] = useState("");
  const [voucherPhone, setVoucherPhone] = useState("");
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [voucherInPurchase, setVoucherInPurchase] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState(null);
  const [discountedPrice, setDiscountedPrice] = useState(null);
  const [voucherQuote, setVoucherQuote] = useState(null);
  const [voucherApplyMsg, setVoucherApplyMsg] = useState("");
  const [voucherApplying, setVoucherApplying] = useState(false);
  const [bestSellingPackage, setBestSellingPackage] = useState(null);
  const [showReviewPopup, setShowReviewPopup] = useState(false);
  const [reviewData, setReviewData] = useState(null);

  const location = useLocation();
  const [routerId, setRouterId] = useState("");

  // Pull ownerId from URL if present
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlOwnerId = params.get("ownerId") || "";
    const urlRouterId = params.get("routerId") || "";
    if (urlOwnerId && urlOwnerId !== ownerId) {
      setOwnerId(urlOwnerId);
    }
    if (urlRouterId && urlRouterId !== routerId) {
      setRouterId(urlRouterId);
    }
  }, [location.search]);

  // Auto-detect owner when page loads
  useEffect(() => {
    const detectOwner = async () => {
      if (ownerId) return; // Already resolved

      setLoading(true);
      setError("");

      try {
        // Try to detect owner automatically
        const hostname = window.location.hostname;
        const params = new URLSearchParams();
        if (routerId) params.append("routerId", routerId);
        if (hostname && hostname !== "localhost") params.append("hostname", hostname);
        
        const detectRes = await fetch(`/api/routers/detect-owner?${params.toString()}`);
        
        if (detectRes.ok) {
          const detectData = await detectRes.json();
          if (detectData.success) {
            setOwnerId(detectData.ownerId);
            setOwnerName(detectData.ownerName);
            setLogo(detectData.logoUrl);
            setOwnerPhone(detectData.ownerPhone || "");
            setOwnerWhatsapp(detectData.ownerWhatsapp || "");
            return;
          }
        }

        // Fallback: if routerId present, resolve via backend
        if (routerId) {
          try {
            const res = await fetch(`/api/routers/${encodeURIComponent(routerId)}/packages`);
            if (res.ok) {
              const json = await res.json();
              setOwnerId(json.ownerId);
              setPackages(json.packages || []);
            }
            const brandRes = await fetch(`/api/routers/${encodeURIComponent(routerId)}/portal-branding`);
            if (brandRes.ok) {
              const brand = await brandRes.json();
              setLogo(brand.logoUrl || "");
              setOwnerName(brand.ownerName || "");
            }
            return;
          } catch (e) {
            console.error("Router context resolution failed:", e);
          }
        }

        // Final fallback: resolve by logged-in phone
        const phone = localStorage.getItem("phone");
        if (phone) {
          try {
            const q = query(collection(db, "owners"), where("ownerPhone", "==", phone));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
              setOwnerId(snapshot.docs[0].id);
            }
          } catch (e) {
            console.error("Owner resolution failed:", e);
          }
        }

        setError("Could not detect WiFi owner. Please check your connection or contact support.");
      } catch (e) {
        console.error("Owner detection failed:", e);
        setError("Failed to detect WiFi owner. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    detectOwner();
  }, [ownerId, routerId]);

  // Fetch packages when owner is resolved
  useEffect(() => {
    const fetchPackages = async () => {
      if (!ownerId) return;

      try {
        setLoading(true);
        const res = await fetch(`/api/packages?ownerId=${encodeURIComponent(ownerId)}&status=launched`);
        if (res.ok) {
          const packagesData = await res.json();
          // Filter only WiFi packages (not loyalty rewards)
          const wifiPackages = packagesData.filter(pkg => pkg.type === "wifi_package");
          // Try to fetch hotspot-scoped discounts if routerId is available
          if (routerId) {
            const enriched = await Promise.all(wifiPackages.map(async (pkg) => {
              try {
                const priceRes = await fetch(`/api/packages/${encodeURIComponent(ownerId)}/${encodeURIComponent(routerId)}/${encodeURIComponent(pkg.id)}/price`);
                if (priceRes.ok) {
                  const p = await priceRes.json();
                  return { ...pkg, basePrice: p.basePrice, finalPrice: p.finalPrice, discount: p.discount };
                }
              } catch {}
              return { ...pkg, basePrice: pkg.price, finalPrice: pkg.price };
            }));
            setPackages(enriched);
          } else {
            // No router context; show regular prices
            setPackages(wifiPackages.map(p => ({ ...p, basePrice: p.price, finalPrice: p.price })));
          }
        }
      } catch (e) {
        console.error("Failed to fetch packages:", e);
        setError("Failed to load packages. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchPackages();
  }, [ownerId, routerId]);

  // Fetch best-selling package statistics
  useEffect(() => {
    const fetchBestSellingPackage = async () => {
      if (!ownerId) return;

      try {
        const res = await fetch(`/api/statistics/best-selling-packages/${encodeURIComponent(ownerId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.bestSellingPackage) {
            // Find the package object that matches the best-selling package name
            const bestPackage = packages.find(pkg => 
              (pkg.packageName || pkg.name) === data.bestSellingPackage.name
            );
            if (bestPackage) {
              setBestSellingPackage(bestPackage);
            }
          }
        }
      } catch (e) {
        console.error("Failed to fetch best-selling package:", e);
        // Fallback: if no statistics available, use the first package as most popular
        if (packages.length > 0 && !bestSellingPackage) {
          setBestSellingPackage(packages[0]);
        }
      }
    };

    fetchBestSellingPackage();
  }, [ownerId, packages]);

  // Fetch owner info when owner is resolved
  useEffect(() => {
    const fetchOwnerInfo = async () => {
      if (!ownerId) return;

      try {
        const res = await fetch(`/api/owners/logo/${encodeURIComponent(ownerId)}`);
        if (res.ok) {
          const owner = await res.json();
          setLogo(owner.logoUrl || "");
          setOwnerName(owner.ownerName || "");
          setOwnerPhone(owner.ownerPhone || "");
          setOwnerWhatsapp(owner.ownerWhatsapp || "");
        }
      } catch (e) {
        console.error("Failed to fetch owner info:", e);
      }
    };

    fetchOwnerInfo();
  }, [ownerId]);

  const handleVoucherRedeem = async (e) => {
    e.preventDefault();
    if (!voucherCode || !voucherPhone) {
      setVoucherMessage("Please enter both voucher code and phone number");
      return;
    }

    try {
      setVoucherMessage("Processing...");
      const res = await fetch("/api/vouchers/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voucherCode: voucherCode.toUpperCase(),
          phone: voucherPhone,
          ownerId: ownerId
        })
      });

      const data = await res.json();
      if (data.success) {
        setVoucherMessage("✅ Voucher redeemed successfully! You now have WiFi access.");
        setVoucherCode("");
        setVoucherPhone("");
        setTimeout(() => setShowVoucherModal(false), 3000);
      } else {
        setVoucherMessage(`❌ ${data.error || "Failed to redeem voucher"}`);
      }
    } catch (e) {
      console.error("Voucher redemption failed:", e);
      setVoucherMessage("❌ Network error. Please try again.");
    }
  };

  const handlePurchasePackage = (pkg) => {
    setSelectedPackage(pkg);
    setShowPurchaseModal(true);
    setVoucherInPurchase("");
    setAppliedVoucher(null);
    setDiscountedPrice(null);
    setVoucherApplyMsg("");
  };

  const handlePayment = async () => {
    if (!selectedPackage) return;
    
    try {
      const userPhone = localStorage.getItem("phone") || "";
      const amountToCharge = (appliedVoucher && discountedPrice !== null) ? discountedPrice : selectedPackage.price;

      // If discount makes it free (0 UGX) or voucher type is free_access, redeem instead of charging
      if (appliedVoucher && (amountToCharge <= 0)) {
        const res = await fetch('/api/vouchers/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voucherCode: appliedVoucher.code, phone: userPhone, ownerId })
        });
        const data = await res.json();
        if (data.success) {
          alert('Voucher applied. Free access granted.');
          setShowPurchaseModal(false);
          setSelectedPackage(null);
          setReviewData({
            hotspotId: ownerId,
            userPhone,
            packageName: selectedPackage.packageName || selectedPackage.name,
            packagePrice: 0,
          });
          setTimeout(() => setShowReviewPopup(true), 2000);
          return;
        } else {
          alert(data.message || 'Failed to redeem voucher');
          return;
        }
      }

      // Initiate mobile money payment with discounted amount
      const response = await axios.post("/api/pay/mtn", {
        phone: userPhone,
        amount: amountToCharge,
        packageName: selectedPackage.packageName || selectedPackage.name,
        ownerId: ownerId,
        voucherQuote: voucherQuote || undefined,
      });

      if (response.data.success) {
        // Show success message and close modal
        alert(`Payment initiated for ${formatUGX(amountToCharge)}. Ref: ${response.data.referenceId}. Check your phone for the PIN prompt.`);
        setShowPurchaseModal(false);
        setSelectedPackage(null);
        
        // Set review data for later popup
        setReviewData({
          hotspotId: ownerId,
          userPhone: localStorage.getItem("phone") || "",
          packageName: selectedPackage.packageName || selectedPackage.name,
          packagePrice: selectedPackage.price
        });
        
        // Show review popup after a short delay
        setTimeout(() => {
          setShowReviewPopup(true);
        }, 2000);
      } else {
        alert("Payment failed. Please try again.");
      }
    } catch (err) {
      console.error("Payment error:", err);
      alert("Payment failed. Please try again.");
    }
  };

  const applyVoucherInPurchase = async () => {
    if (!selectedPackage || !voucherInPurchase) return;
    const code = voucherInPurchase.trim().toUpperCase();
    setVoucherApplying(true);
    setVoucherApplyMsg("Validating voucher...");
    try {
      const body = {
        voucherCode: code,
        ownerId,
        packageName: selectedPackage.packageName || selectedPackage.name,
        packagePrice: selectedPackage.price,
        phone: localStorage.getItem('phone') || ''
      };
      const res = await fetch(`/api/vouchers/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.success) {
        setVoucherApplyMsg("Invalid voucher code");
        setAppliedVoucher(null);
        setDiscountedPrice(null);
        setVoucherQuote(null);
        setVoucherApplying(false);
        return;
      }
      setAppliedVoucher({ code });
      setDiscountedPrice(Number(data.discountedAmount));
      setVoucherQuote(data.quote);
      setVoucherApplyMsg(Number(data.discountedAmount) === 0 ? 'Voucher applied: FREE' : `Voucher applied. New total: ${formatUGX(Number(data.discountedAmount))}`);
    } catch (e) {
      setVoucherApplyMsg('Failed to validate voucher');
      setAppliedVoucher(null);
      setDiscountedPrice(null);
      setVoucherQuote(null);
    } finally {
      setVoucherApplying(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <p>Loading packages...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>{error}</p>
        <button 
          onClick={() => window.location.reload()} 
          style={styles.retryButton}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header Section */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>WiFi Packages</h1>
          <p style={styles.subtitle}>Choose a package that fits your needs</p>
        </div>
        <button 
          onClick={() => setShowVoucherModal(true)}
          style={styles.redeemVoucherBtn}
        >
          <span style={styles.voucherIcon}>🎫</span>
          Redeem Voucher
        </button>
      </div>

      {/* Voucher Redemption Section */}
      <div style={styles.voucherSection}>
        <h3 style={styles.voucherSectionTitle}>Redeem Voucher Code</h3>
        <div style={styles.voucherInputGroup}>
          <input
            type="text"
            placeholder="Enter voucher code"
            value={voucherCode}
            onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
            style={styles.voucherInput}
            maxLength={10}
          />
          <button onClick={() => setShowVoucherModal(true)} style={styles.redeemBtnSecondary}>Redeem</button>
        </div>
        <p style={styles.voucherHelp}>
          Enter the voucher code provided by the hotspot owner
        </p>
      </div>

      {/* Packages Grid */}
      <div style={styles.packagesGrid}>
        {packages.map((pkg, index) => (
          <div
            key={pkg.id}
            style={{
              ...styles.packageCard,
              ...(bestSellingPackage && bestSellingPackage.id === pkg.id ? styles.popularCard : {})
            }}
          >
            {bestSellingPackage && bestSellingPackage.id === pkg.id && (
              <div style={styles.popularLabel}>MOST POPULAR</div>
            )}
            
            <h3 style={styles.packageName}>{pkg.packageName || pkg.name}</h3>
            {pkg.discount?.active && pkg.finalPrice < (pkg.basePrice || pkg.price) ? (
              <div style={styles.packagePrice}>
                <span style={{ textDecoration: 'line-through', color: '#6b7280', marginRight: 8 }}>
                  {(pkg.basePrice || pkg.price).toLocaleString()} UGX
                </span>
                <span style={{ color: '#059669', fontWeight: 'bold' }}>
                  {pkg.finalPrice.toLocaleString()} UGX
                </span>
              </div>
            ) : (
              <div style={styles.packagePrice}>{(pkg.basePrice || pkg.price).toLocaleString()} UGX</div>
            )}
            <div style={styles.packageDuration}>
              {pkg.timeLimitMinutes >= 1440 ? `${Math.floor(pkg.timeLimitMinutes / 1440)} Days` : 
               pkg.timeLimitMinutes >= 60 ? `${Math.floor(pkg.timeLimitMinutes / 60)} Hours` : 
               `${pkg.timeLimitMinutes} Minutes`}
            </div>
            
            <div style={styles.featuresList}>
              <div style={styles.feature}>
                <span style={styles.featureIcon}>✅</span>
                <span>Duration: {pkg.timeLimitMinutes >= 1440 ? `${Math.floor(pkg.timeLimitMinutes / 1440)} Days` : 
                  pkg.timeLimitMinutes >= 60 ? `${Math.floor(pkg.timeLimitMinutes / 60)} Hours` : 
                  `${pkg.timeLimitMinutes} Minutes`}</span>
              </div>
              <div style={styles.feature}>
                <span style={styles.featureIcon}>✅</span>
                <span>Data: {pkg.dataLimitMB ? `${pkg.dataLimitMB} MB` : 'Unlimited'}</span>
              </div>
              <div style={styles.feature}>
                <span style={styles.featureIcon}>⭐</span>
                <span>Earn {pkg.loyaltyPointsPerPackage || Math.floor(pkg.price / 100)} points</span>
              </div>
              <div style={styles.feature}>
                <span style={styles.featureIcon}>📊</span>
                <span>High-speed access</span>
              </div>
            </div>
            
            <button 
              onClick={() => handlePurchasePackage(pkg)}
              style={{
                ...styles.purchaseBtn,
                ...(bestSellingPackage && bestSellingPackage.id === pkg.id ? styles.popularPurchaseBtn : {})
              }}
            >
              Purchase Package
            </button>
          </div>
        ))}
      </div>

      {/* Support Contact Section */}
      {(ownerPhone || ownerWhatsapp) && (
        <div style={styles.supportSection}>
          <p style={styles.supportTitle}>Need Help?</p>
          <div style={styles.supportButtons}>
            {ownerPhone && (
              <button 
                onClick={() => window.open(`tel:${ownerPhone}`)}
                style={styles.supportBtn}
              >
                📞 Call: {ownerPhone}
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

      {/* Voucher Modal */}
      {showVoucherModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3>Redeem Voucher Code</h3>
              <button 
                onClick={() => {
                  setShowVoucherModal(false);
                  setVoucherCode("");
                  setVoucherMessage("");
                }}
                style={styles.closeBtn}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleVoucherRedeem} style={styles.voucherForm}>
              <input
                type="text"
                placeholder="Enter voucher code (e.g. ABC123XY)"
                value={voucherCode}
                onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                style={styles.voucherInput}
                maxLength={10}
              />
              <input
                type="text"
                placeholder="Enter your phone number (e.g. 0712345678)"
                value={voucherPhone}
                onChange={(e) => setVoucherPhone(e.target.value)}
                style={styles.voucherInput}
                maxLength={10}
              />
              <button type="submit" style={styles.redeemBtn}>
                Redeem Code
              </button>
            </form>
            {voucherMessage && (
              <p style={styles.voucherMessage}>{voucherMessage}</p>
            )}
            <p style={styles.voucherHelp}>
              Enter the voucher code provided by the WiFi owner to get free access.
            </p>
          </div>
        </div>
      )}

      {/* Purchase Modal */}
      {showPurchaseModal && selectedPackage && (
        <div style={styles.modalOverlay}>
          <div style={styles.purchaseModal}>
            <div style={styles.modalHeader}>
              <h3>Purchase {selectedPackage.packageName || selectedPackage.name}</h3>
              <button 
                onClick={() => {
                  setShowPurchaseModal(false);
                  setSelectedPackage(null);
                }}
                style={styles.closeBtn}
              >
                ×
              </button>
            </div>
            
            <div style={styles.packageDetails}>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Package:</span>
                <span style={styles.detailValue}>{selectedPackage.packageName || selectedPackage.name}</span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Duration:</span>
                <span style={styles.detailValue}>
                  {selectedPackage.timeLimitMinutes >= 1440 ? `${Math.floor(selectedPackage.timeLimitMinutes / 1440)} Days` : 
                   selectedPackage.timeLimitMinutes >= 60 ? `${Math.floor(selectedPackage.timeLimitMinutes / 60)} Hours` : 
                   `${selectedPackage.timeLimitMinutes} Minutes`}
                </span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Data Limit:</span>
                <span style={styles.detailValue}>
                  {selectedPackage.dataLimitMB ? `${selectedPackage.dataLimitMB} MB` : 'Unlimited'}
                </span>
              </div>
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Loyalty Points:</span>
                <span style={styles.detailValue}>
                  +{selectedPackage.loyaltyPointsPerPackage || Math.floor(selectedPackage.price / 100)}
                </span>
              </div>
              <div style={styles.totalRow}>
                <span style={styles.totalLabel}>Total:</span>
                <span style={styles.totalValue}>
                  {discountedPrice !== null ? `${discountedPrice.toLocaleString()} UGX` : `${selectedPackage.price.toLocaleString()} UGX`}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: 14, color: '#374151', marginBottom: 6 }}>Voucher Code</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={voucherInPurchase}
                  onChange={(e) => setVoucherInPurchase(e.target.value.toUpperCase())}
                  placeholder="Enter voucher code"
                  style={{ flex: 1, padding: 12, border: '1px solid #e5e7eb', borderRadius: 8 }}
                />
                <button onClick={applyVoucherInPurchase} disabled={voucherApplying} style={{ padding: '12px 16px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                  {voucherApplying ? 'Applying…' : 'Apply'}
                </button>
              </div>
              {voucherApplyMsg && (
                <div style={{ marginTop: 8, fontSize: 13, color: '#065f46' }}>{voucherApplyMsg}</div>
              )}
            </div>

            <div style={styles.paymentMethodSection}>
              <h4 style={styles.paymentMethodTitle}>Payment Method</h4>
              <div style={styles.paymentOptions}>
                <div style={styles.paymentOption}>
                  <input
                    type="radio"
                    id="mobileMoney"
                    name="paymentMethod"
                    value="mobileMoney"
                    defaultChecked
                    style={styles.radioInput}
                  />
                  <label htmlFor="mobileMoney" style={styles.paymentOptionLabel}>
                    <span style={styles.paymentIcon}>📱</span>
                    Mobile Money (MTN/Airtel)
                  </label>
                </div>
              </div>
            </div>

            <div style={styles.modalActions}>
              <button 
                onClick={() => {
                  setShowPurchaseModal(false);
                  setSelectedPackage(null);
                }}
                style={styles.cancelBtn}
              >
                Cancel
              </button>
              <button 
                onClick={handlePayment}
                style={styles.payNowBtn}
              >
                Pay Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '30px',
    flexWrap: 'wrap',
    gap: '20px',
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
    margin: 0,
  },
  redeemVoucherBtn: {
    padding: '12px 24px',
    backgroundColor: '#10b981',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '500',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  voucherIcon: {
    fontSize: '18px',
  },
  voucherSection: {
    backgroundColor: 'var(--surface)',
    padding: '24px',
    borderRadius: '12px',
    marginBottom: '30px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  voucherSectionTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 16px 0',
  },
  voucherInputGroup: {
    display: 'flex',
    gap: '12px',
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  voucherInput: {
    flex: 1,
    padding: '12px 16px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '16px',
    minWidth: '200px',
  },
  redeemBtn: {
    padding: '12px 24px',
    backgroundColor: '#10b981',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '500',
    whiteSpace: 'nowrap',
  },
  voucherHelp: {
    fontSize: '14px',
    color: '#6b7280',
    margin: 0,
  },
  redeemBtnSecondary: {
    padding: "12px",
    backgroundColor: "#10b981",
    color: "#ffffff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: "500",
  },
  packagesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '24px',
    marginBottom: '30px',
  },
  packageCard: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    padding: '24px',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    position: 'relative',
    transition: 'all 0.2s',
    color: 'var(--text-primary)'
  },
  popularCard: {
    border: '2px solid #2563eb',
    transform: 'scale(1.02)',
  },
  popularLabel: {
    position: 'absolute',
    top: '-12px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    padding: '6px 16px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  packageName: {
    fontSize: '20px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    margin: '0 0 12px 0',
    textAlign: 'center',
  },
  packagePrice: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#2563eb',
    margin: '0 0 8px 0',
    textAlign: 'center',
  },
  packageDuration: {
    fontSize: '16px',
    color: 'var(--text-muted)',
    margin: '0 0 20px 0',
    textAlign: 'center',
  },
  featuresList: {
    marginBottom: '24px',
  },
  feature: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
    fontSize: '14px',
    color: '#374151',
  },
  featureIcon: {
    fontSize: '16px',
  },
  purchaseBtn: {
    width: '100%',
    padding: '12px 24px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '500',
    transition: 'all 0.2s',
  },
  popularPurchaseBtn: {
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: '1px solid #2563eb',
  },
  supportSection: {
    marginTop: "20px",
    marginBottom: "20px",
    padding: "15px",
    backgroundColor: "#f8fafc",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    maxWidth: "400px",
    margin: "30px auto 0",
  },
  supportTitle: {
    fontSize: "16px",
    fontWeight: "600",
    color: "#64748b",
    margin: "0 0 15px 0",
    textAlign: "center",
  },
  supportButtons: {
    display: "flex",
    gap: "10px",
    justifyContent: "center",
    flexWrap: "wrap",
  },
  supportBtn: {
    padding: "10px 16px",
    fontSize: "14px",
    fontWeight: "500",
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    backgroundColor: "var(--surface)",
    color: "#374151",
    cursor: "pointer",
    transition: "all 0.2s",
    minWidth: "120px",
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: '20px',
  },
  modal: {
    backgroundColor: "var(--surface)",
    borderRadius: "12px",
    padding: "24px",
    maxWidth: "400px",
    width: "90%",
    boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
  },
  purchaseModal: {
    backgroundColor: "var(--surface)",
    borderRadius: "12px",
    padding: "24px",
    maxWidth: "500px",
    width: "90%",
    boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: "24px",
    cursor: "pointer",
    color: "#6b7280",
  },
  voucherForm: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  voucherInput: {
    padding: "12px",
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    fontSize: "16px",
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: "2px",
  },
  redeemBtn: {
    padding: "12px",
    backgroundColor: "#10b981",
    color: "#ffffff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: "500",
  },
  voucherMessage: {
    marginTop: "12px",
    padding: "8px",
    borderRadius: "4px",
    textAlign: "center",
    fontSize: "14px",
  },
  voucherHelp: {
    fontSize: "12px",
    color: "#6b7280",
    textAlign: "center",
    marginTop: "12px",
    margin: "12px 0 0 0",
  },
  packageDetails: {
    marginBottom: '24px',
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  detailLabel: {
    fontSize: '14px',
    color: '#6b7280',
    fontWeight: '500',
  },
  detailValue: {
    fontSize: '14px',
    color: '#1f2937',
    fontWeight: '600',
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderTop: '2px solid #e5e7eb',
    marginTop: '8px',
  },
  totalLabel: {
    fontSize: '16px',
    color: '#1f2937',
    fontWeight: '600',
  },
  totalValue: {
    fontSize: '20px',
    color: '#2563eb',
    fontWeight: 'bold',
  },
  paymentMethodSection: {
    marginBottom: '24px',
  },
  paymentMethodTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 16px 0',
  },
  paymentOptions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  paymentOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  radioInput: {
    margin: 0,
  },
  paymentOptionLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#374151',
    cursor: 'pointer',
    margin: 0,
  },
  paymentIcon: {
    fontSize: '18px',
  },
  modalActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    padding: '12px 24px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  payNowBtn: {
    padding: '12px 24px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    gap: '16px',
  },
  loadingSpinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f4f6',
    borderTop: '4px solid #2563eb',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    gap: '16px',
  },
  errorText: {
    color: '#dc2626',
    fontSize: '16px',
    textAlign: 'center',
  },
  retryButton: {
    padding: '12px 24px',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
};
