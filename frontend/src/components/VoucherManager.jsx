import React, { useEffect, useMemo, useState } from 'react';
import { formatUGX } from './currency';

const apiBase = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api`;

const VoucherManager = ({ ownerId, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [vouchers, setVouchers] = useState([]);
  const [stats, setStats] = useState({
    totalVouchers: 0,
    activeVouchers: 0,
    redeemedVouchers: 0,
    expiredVouchers: 0,
    totalRedemptions: 0,
    usageRate: 0,
  });

  // Filters and UI state
  const [filters, setFilters] = useState({ status: 'all', search: '' });
  const [tab, setTab] = useState('voucher'); // 'voucher' | 'discount'

  // Context: hotspots and packages (shared across tabs)
  const [hotspots, setHotspots] = useState([]);
  const [selectedHotspot, setSelectedHotspot] = useState('');
  const [packagesForHotspot, setPackagesForHotspot] = useState([]);
  const [selectedPackageId, setSelectedPackageId] = useState('');

  // Voucher form (uses selected package)
  const [voucherForm, setVoucherForm] = useState({
    code: '',
    type: 'discount',
    value: '',
    usageLimit: '',
    expiresInDays: 30,
    expiresAt: '',
  });

  // Discount editor (uses selected package)
  const [discountEditor, setDiscountEditor] = useState({
    basePrice: '',
    name: '',
    validity: '',
    deviceLimit: 1,
    discount: { active: false, type: 'percentage', value: 0, validUntil: '' },
  });

  // Derived UI
  const selectedPackage = useMemo(
    () => packagesForHotspot.find(p => p.id === selectedPackageId),
    [packagesForHotspot, selectedPackageId]
  );

  const filteredVouchers = useMemo(() => {
    let list = [...vouchers];
    if (filters.status !== 'all') list = list.filter(v => (v.status || '').toLowerCase() === filters.status);
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      list = list.filter(v => (v.code || '').toLowerCase().includes(q) || (v.type || '').toLowerCase().includes(q));
    }
    return list;
  }, [vouchers, filters]);

  // Load hotspots
  useEffect(() => {
    if (!ownerId) return;
    fetch(`${apiBase}/hotspots?ownerId=${encodeURIComponent(ownerId)}`)
      .then(r => r.json())
      .then(d => {
        const list = d?.hotspots || d || [];
        setHotspots(list);
        if (list.length) setSelectedHotspot(list[0].id || list[0].hotspotId);
      }).catch(() => {});
  }, [ownerId]);

  // Load packages for selected hotspot
  useEffect(() => {
    if (!ownerId || !selectedHotspot) return;
    fetch(`${apiBase}/packages/${encodeURIComponent(ownerId)}/${encodeURIComponent(selectedHotspot)}`)
      .then(r => r.json())
      .then(d => {
        const pkgs = d?.packages || [];
        setPackagesForHotspot(pkgs);
        if (pkgs.length) {
          setSelectedPackageId(pkgs[0].id);
          const p = pkgs[0];
          setDiscountEditor({
            basePrice: p.basePrice ?? p.price ?? '',
            name: p.name || '',
            validity: p.validity || '',
            deviceLimit: p.deviceLimit || 1,
            discount: p.discount || { active: false, type: 'percentage', value: 0, validUntil: '' }
          });
        } else {
          setSelectedPackageId('');
        }
      })
      .catch(() => { setPackagesForHotspot([]); setSelectedPackageId(''); });
  }, [ownerId, selectedHotspot]);

  // Live updates via Server-Sent Events with API fallback
  useEffect(() => {
    if (!ownerId) return;
    setLoading(true);
    let es;
    let pollId;
    const startPolling = () => {
      const fetchViaApi = async () => {
        try {
          const [listRes, statsRes] = await Promise.all([
            fetch(`${apiBase}/vouchers/owner/${ownerId}`),
            fetch(`${apiBase}/vouchers/owner/${ownerId}/stats`),
          ]);
          const listJson = await listRes.json();
          const statsJson = await statsRes.json();
          if (listJson?.success) {
            const list = listJson.vouchers || [];
            list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            setVouchers(list);
          }
          if (statsJson?.success) setStats(statsJson.stats || stats);
        } catch {}
        setLoading(false);
      };
      fetchViaApi();
      pollId = setInterval(fetchViaApi, 5000);
    };

    try {
      es = new EventSource(`${apiBase}/vouchers/owner/${ownerId}/stream`);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data || '{}');
          if (data?.stats) setStats(data.stats);
          if (Array.isArray(data?.vouchers)) {
            const list = data.vouchers.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            setVouchers(list);
          }
          setLoading(false);
        } catch {
          // ignore malformed chunk
        }
      };
      es.onerror = () => {
        try { es.close(); } catch {}
        startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      try { es && es.close(); } catch {}
      if (pollId) clearInterval(pollId);
    };
  }, [ownerId]);

  const randomCode = () => `YABA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const handleCreateVoucher = async (e) => {
    e.preventDefault();
    if (!ownerId || !selectedHotspot) return;
    const code = (voucherForm.code || randomCode()).toUpperCase();
    const payload = {
      ownerId,
      hotspotId: selectedHotspot,
      code,
      type: voucherForm.type,
      value: Number(voucherForm.value || 0),
      usageLimit: voucherForm.usageLimit ? Number(voucherForm.usageLimit) : undefined,
      packageName: selectedPackage ? (selectedPackage.name || selectedPackage.packageName || undefined) : undefined,
    };
    if (voucherForm.expiresAt) payload.expiresAt = new Date(voucherForm.expiresAt).toISOString();
    else if (voucherForm.expiresInDays) payload.expiresInDays = Number(voucherForm.expiresInDays);

    try {
      setCreating(true);
      const res = await fetch(`${apiBase}/vouchers/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.success) setVoucherForm({ code: '', type: 'discount', value: '', usageLimit: '', expiresInDays: 30, expiresAt: '' });
    } catch {} finally { setCreating(false); }
  };

  const saveDiscount = async () => {
    if (!ownerId || !selectedHotspot || !selectedPackageId) return;
    await fetch(`${apiBase}/packages/${encodeURIComponent(ownerId)}/${encodeURIComponent(selectedHotspot)}/${encodeURIComponent(selectedPackageId)}/discount`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(discountEditor)
    });
  };

  const cancelVoucher = async (voucherId) => {
    if (!voucherId || !ownerId) return;
    try {
      await fetch(`${apiBase}/vouchers/${voucherId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId }) });
    } catch {}
  };

  const exportCSV = () => { if (ownerId) window.open(`${apiBase}/vouchers/owner/${ownerId}/export/csv`, '_blank'); };
  const exportPDF = () => { if (ownerId) window.open(`${apiBase}/vouchers/owner/${ownerId}/export/pdf`, '_blank'); };

  const getStatusBadge = (status) => {
    const s = (status || '').toLowerCase();
    const map = { 
      active: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400', 
      redeemed: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400', 
      expired: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400', 
      cancelled: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400' 
    };
    return map[s] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400';
  };

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-primary)' }}>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>Vouchers</h1>
            <p className="mt-1" style={{ color: 'var(--text-muted)' }}>Create vouchers and manage hotspot discounts</p>
          </div>
          <div className="flex gap-3">
            <button onClick={exportCSV} className="yaba-btn yaba-btn--secondary inline-flex items-center px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-105">
              📊 Export CSV
            </button>
            <button onClick={exportPDF} className="yaba-btn yaba-btn--secondary inline-flex items-center px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-105">
              📄 Export PDF
            </button>
            {onClose && (
              <button onClick={onClose} className="yaba-btn inline-flex items-center px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-105">
                ✕ Close
              </button>
            )}
          </div>
        </div>

        {/* Stats row only */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <div className="yaba-card yaba-elev-2"><StatCard label="Active Vouchers" value={stats.activeVouchers} icon="🎟️" /></div>
          <div className="yaba-card yaba-elev-2"><StatCard label="Total Redemptions" value={stats.totalRedemptions} icon="💵" /></div>
          <div className="yaba-card yaba-elev-2"><StatCard label="Expired" value={stats.expiredVouchers} icon="📅" /></div>
          <div className="yaba-card yaba-elev-2"><StatCard label="Usage Rate" value={`${stats.usageRate}%`} icon="🔶" /></div>
        </div>

        {/* Tabs and Controls */}
        <div className="yaba-card yaba-elev-2 p-6 mb-12">
          {/* Tab Navigation */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <div className="flex items-center gap-3">
              <button 
                type="button" 
                onClick={()=>setTab('voucher')} 
                className={`px-6 py-3 rounded-xl font-medium transition-all duration-200 ${
                  tab==='voucher' 
                    ? 'yaba-btn' 
                    : 'yaba-btn yaba-btn--secondary'
                }`}
              >
                🎟️ Create Voucher
              </button>
              <button 
                type="button" 
                onClick={()=>setTab('discount')} 
                className={`px-6 py-3 rounded-xl font-medium transition-all duration-200 ${
                  tab==='discount' 
                    ? 'yaba-btn' 
                    : 'yaba-btn yaba-btn--secondary'
                }`}
              >
                💰 Hotspot Discount
              </button>
            </div>
          </div>

          {/* Hotspot and Package Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 rounded-xl yaba-card" style={{ backgroundColor: 'var(--surface-2)' }}>
            <div className="space-y-3">
              <label className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>📍 Select Hotspot</label>
              <select 
                value={selectedHotspot} 
                onChange={(e) => setSelectedHotspot(e.target.value)} 
                className="yaba-select select-card w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500"
              >
                {hotspots.map(h => (
                  <option key={h.id || h.hotspotId} value={h.id || h.hotspotId}>{h.hotspotName || h.name || (h.id || h.hotspotId)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>📦 Select Package</label>
              <select 
                value={selectedPackageId} 
                onChange={(e) => {
                  const id = e.target.value; setSelectedPackageId(id);
                  const p = packagesForHotspot.find(x => x.id === id);
                  if (p) setDiscountEditor({ basePrice: p.basePrice ?? p.price ?? '', name: p.name || '', validity: p.validity || '', deviceLimit: p.deviceLimit || 1, discount: p.discount || { active: false, type: 'percentage', value: 0, validUntil: '' } });
                }} 
                className="yaba-select select-card w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500"
              >
                {packagesForHotspot.map(p => (<option key={p.id} value={p.id}>{p.name || p.packageName || p.id}</option>))}
              </select>
            </div>
          </div>
        </div>

        {tab === 'voucher' && (
          <div className="space-y-12">
            {/* Voucher Code Section */}
            <div className="yaba-card yaba-elev-2 p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>🎫 Voucher Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Voucher Code</label>
                  <div className="flex gap-3">
                    <input 
                      value={voucherForm.code} 
                      onChange={(e) => setVoucherForm({ ...voucherForm, code: e.target.value })} 
                      placeholder="e.g. YABA-AB12CD" 
                      className="yaba-input flex-1 px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500" 
                    />
                    <button 
                      type="button" 
                      onClick={() => setVoucherForm({ ...voucherForm, code: randomCode() })} 
                      className="yaba-btn yaba-btn--secondary px-4 py-3 rounded-xl text-sm font-medium whitespace-nowrap"
                    >
                      🎲 Random
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Package</label>
                  <input 
                    value={selectedPackage ? (selectedPackage.name || selectedPackage.packageName) : ''} 
                    readOnly 
                    placeholder="Select a package above" 
                    className="yaba-input w-full px-4 py-3 rounded-xl" 
                    style={{ backgroundColor: 'var(--surface-2)' }}
                  />
                </div>
              </div>
            </div>

            {/* Voucher Configuration Section */}
            <div className="yaba-card yaba-elev-2 p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>⚙️ Voucher Configuration</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Type</label>
                  <select 
                    value={voucherForm.type} 
                    onChange={(e) => setVoucherForm({ ...voucherForm, type: e.target.value })} 
                    className="yaba-select select-card w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="discount">Discount (%)</option>
                    <option value="free_access">Free Access (min)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Value</label>
                  <input 
                    type="number" 
                    value={voucherForm.value} 
                    onChange={(e) => setVoucherForm({ ...voucherForm, value: e.target.value })} 
                    placeholder={voucherForm.type === 'discount' ? 'e.g. 25 for 25%' : 'e.g. 60 for 60 min'} 
                    className="yaba-input w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Usage Limit (optional)</label>
                  <input 
                    type="number" 
                    value={voucherForm.usageLimit} 
                    onChange={(e) => setVoucherForm({ ...voucherForm, usageLimit: e.target.value })} 
                    placeholder="e.g. 100" 
                    className="yaba-input w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Expires In (days)</label>
                  <input 
                    type="number" 
                    value={voucherForm.expiresInDays} 
                    onChange={(e) => setVoucherForm({ ...voucherForm, expiresInDays: e.target.value, expiresAt: '' })} 
                    className="yaba-input w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500" 
                  />
                </div>
              </div>
            </div>

            {/* Expiration Date Section */}
            <div className="yaba-card yaba-elev-2 p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>📅 Expiration Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Or Expires At (specific date)</label>
                  <input 
                    type="datetime-local" 
                    value={voucherForm.expiresAt} 
                    onChange={(e) => setVoucherForm({ ...voucherForm, expiresAt: e.target.value })} 
                    className="yaba-input w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500" 
                  />
                </div>
                <div className="flex items-end">
                  <div className="text-sm p-4 rounded-xl w-full" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-2)' }}>
                    <span className="font-medium">👤 Owner:</span> {ownerId}
                  </div>
                </div>
              </div>
            </div>

            {/* Action Section */}
            <div className="yaba-card yaba-elev-2 p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  <p>Ready to create your voucher? All required fields must be filled.</p>
                </div>
                <button 
                  disabled={creating} 
                  type="submit" 
                  onClick={handleCreateVoucher}
                  className="yaba-btn px-8 py-3 rounded-xl font-medium transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? '⏳ Creating…' : '✨ Create Voucher'}
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'discount' && (
          <div className="space-y-12">
            {/* Package Details Section */}
            <div className="yaba-card yaba-elev-2 p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>📦 Package Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>💰 Base Price (UGX)</label>
                  <input 
                    type="number" 
                    className="yaba-input w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500" 
                    value={discountEditor.basePrice} 
                    onChange={(e)=>setDiscountEditor({ ...discountEditor, basePrice: e.target.value })} 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>📱 Device Limit</label>
                  <input 
                    type="number" 
                    className="yaba-input w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500" 
                    value={discountEditor.deviceLimit} 
                    onChange={(e)=>setDiscountEditor({ ...discountEditor, deviceLimit: Number(e.target.value) })} 
                  />
                </div>
              </div>
            </div>

            {/* Discount Configuration Section */}
            <div className="yaba-card yaba-elev-2 p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>🎯 Discount Configuration</h3>
              <div className="space-y-6">
                {/* Enable Discount Toggle */}
                <div className="flex items-center gap-3 p-4 rounded-xl" style={{ backgroundColor: 'var(--surface-2)' }}>
                  <input 
                    id="discActive" 
                    type="checkbox" 
                    checked={!!discountEditor.discount?.active} 
                    onChange={(e)=>setDiscountEditor({ ...discountEditor, discount: { ...discountEditor.discount, active: e.target.checked } })}
                    className="w-5 h-5 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 dark:focus:ring-purple-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <label htmlFor="discActive" className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Enable Discount for this Package</label>
                </div>

                {/* Discount Settings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>🏷️ Discount Type</label>
                    <select 
                      className="yaba-select select-card w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500" 
                      value={discountEditor.discount?.type || 'percentage'} 
                      onChange={(e)=>setDiscountEditor({ ...discountEditor, discount: { ...discountEditor.discount, type: e.target.value } })}
                    >
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed">Fixed Amount (UGX)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>💵 Discount Value</label>
                    <input 
                      type="number" 
                      className="yaba-input w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500" 
                      value={discountEditor.discount?.value || 0} 
                      onChange={(e)=>setDiscountEditor({ ...discountEditor, discount: { ...discountEditor.discount, value: Number(e.target.value) } })} 
                      placeholder={discountEditor.discount?.type === 'percentage' ? 'e.g. 25 for 25%' : 'e.g. 5000 for 5000 UGX'}
                    />
                  </div>
                </div>

                {/* Valid Until Date */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>⏰ Valid Until</label>
                  <input 
                    type="datetime-local" 
                    className="yaba-input w-full px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500" 
                    value={discountEditor.discount?.validUntil || ''} 
                    onChange={(e)=>setDiscountEditor({ ...discountEditor, discount: { ...discountEditor.discount, validUntil: e.target.value } })} 
                  />
                </div>
              </div>
            </div>

            {/* Action Section */}
            <div className="yaba-card yaba-elev-2 p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  <p>Configure discount settings and save to apply to the selected package.</p>
                </div>
                <button 
                  className="yaba-btn px-8 py-3 rounded-xl font-medium transition-all duration-200 hover:scale-105" 
                  onClick={saveDiscount}
                >
                  💾 Save Discount Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="yaba-card yaba-elev-2 p-6 mb-12 mt-16">
          <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <label className="text-sm font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>🔍 Filter by Status:</label>
              <select 
                value={filters.status} 
                onChange={(e) => setFilters({ ...filters, status: e.target.value })} 
                className="yaba-select select-card px-4 py-3 rounded-xl focus:ring-2 focus:ring-purple-500 min-w-[140px]"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="redeemed">Redeemed</option>
                <option value="expired">Expired</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <label className="text-sm font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>🔎 Search:</label>
              <input 
                value={filters.search} 
                onChange={(e) => setFilters({ ...filters, search: e.target.value })} 
                placeholder="Search code or type…" 
                className="yaba-input px-4 py-3 w-full sm:w-64 rounded-xl focus:ring-2 focus:ring-purple-500" 
              />
            </div>
            <button 
              onClick={() => {}} 
              className="yaba-btn yaba-btn--secondary px-6 py-3 rounded-xl font-medium transition-all duration-200 hover:scale-105"
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Voucher table */}
        <div className="yaba-card yaba-elev-2 p-0 overflow-hidden mb-12">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead style={{ backgroundColor: 'var(--surface-2)' }}>
                <tr>
                  <th className="text-left px-6 py-4 font-semibold" style={{ color: 'var(--text-primary)' }}>🎫 Code</th>
                  <th className="text-left px-6 py-4 font-semibold" style={{ color: 'var(--text-primary)' }}>🏷️ Type</th>
                  <th className="text-left px-6 py-4 font-semibold" style={{ color: 'var(--text-primary)' }}>💰 Value</th>
                  <th className="text-left px-6 py-4 font-semibold" style={{ color: 'var(--text-primary)' }}>📊 Usage</th>
                  <th className="text-left px-6 py-4 font-semibold" style={{ color: 'var(--text-primary)' }}>📈 Status</th>
                  <th className="text-left px-6 py-4 font-semibold" style={{ color: 'var(--text-primary)' }}>📅 Created</th>
                  <th className="text-left px-6 py-4 font-semibold" style={{ color: 'var(--text-primary)' }}>⏰ Expires</th>
                  <th className="text-right px-6 py-4 font-semibold" style={{ color: 'var(--text-primary)' }}>⚡ Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--stroke)' }}>
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                      <div className="flex items-center justify-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                        Loading vouchers...
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && filteredVouchers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-4xl">🎫</div>
                        <p>No vouchers found</p>
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && filteredVouchers.map((v) => (
                  <tr key={v.id} className="hover:opacity-80 transition-opacity duration-200" style={{ backgroundColor: 'var(--surface)' }}>
                    <td className="px-6 py-4 font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{v.code}</td>
                    <td className="px-6 py-4 capitalize" style={{ color: 'var(--text-primary)' }}>{v.type === 'free_access' ? 'Free access' : 'Discount'}</td>
                    <td className="px-6 py-4 font-medium" style={{ color: 'var(--text-primary)' }}>{v.type === 'free_access' ? `${v.packageValue} min` : `${v.packageValue}%`}</td>
                    <td className="px-6 py-4" style={{ color: 'var(--text-primary)' }}>{v.usageCount || 0}{v.usageLimit ? ` / ${v.usageLimit}` : ''}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${getStatusBadge(v.status)}`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="px-6 py-4" style={{ color: 'var(--text-muted)' }}>{new Date(v.createdAt).toLocaleString()}</td>
                    <td className="px-6 py-4" style={{ color: 'var(--text-muted)' }}>{v.expiresAt ? new Date(v.expiresAt).toLocaleDateString() : '—'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => navigator.clipboard.writeText(v.code)} 
                          className="px-3 py-1 text-xs rounded-lg transition-colors duration-200"
                          style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-primary)' }}
                        >
                          📋 Copy
                        </button>
                        {(v.status === 'active') && (
                          <button 
                            onClick={() => cancelVoucher(v.id)} 
                            className="px-3 py-1 text-xs rounded-lg transition-colors duration-200"
                            style={{ backgroundColor: 'var(--danger)', color: 'white' }}
                          >
                            ❌ Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-8 p-4 rounded-xl" style={{ backgroundColor: 'var(--surface-2)' }}>
          <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
            💰 Values shown in UGX where relevant: {formatUGX(0)} baseline
          </p>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, icon, className }) => (
  <div className={`yaba-card p-6 ${className || ''}`} style={{ backgroundColor: 'var(--surface)' }}>
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
        <p className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      </div>
      <div className="text-3xl opacity-80" aria-hidden="true">{icon}</div>
    </div>
  </div>
);

export default VoucherManager;