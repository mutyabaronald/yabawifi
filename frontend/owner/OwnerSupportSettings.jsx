import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function OwnerSupportSettings({ ownerId }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({
    brandName: '',
    logoUrl: '',
    contact: { phone: '', ownerPhone: '', email: '', ownerEmail: '', chatUrl: '', helpUrl: '' },
    channels: { chat: true, call: true, email: true, help: true },
    categories: [
      { key: 'connection', label: 'Connection Issues', icon: '🔌' },
      { key: 'payment', label: 'Payment Problems', icon: '💳' },
      { key: 'loyalty', label: 'Loyalty Points', icon: '⭐' },
      { key: 'other', label: 'Other', icon: '❓' },
    ],
    faqs: [
      { q: 'How do I connect?', a: 'Select the hotspot and follow login steps.' },
      { q: 'How do I pay?', a: 'Use Mobile Money or available methods.' },
    ],
  });
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [replyMap, setReplyMap] = useState({});

  useEffect(() => {
    if (!ownerId) return;
    (async () => {
      try {
        setLoading(true);
        const res = await axios.get(`/api/owners/${ownerId}/support-settings`);
        if (res.data?.settings) {
          setForm(prev => ({ ...prev, ...res.data.settings }));
        }
        // Also fetch current owner logo; auto-fill if support logoUrl is empty
        try {
          const logoRes = await axios.get(`/api/owners/logo/${ownerId}`);
          const currentLogo = logoRes.data?.logoUrl || '';
          if (currentLogo && !((res.data?.settings || {}).logoUrl)) {
            setForm(prev => ({ ...prev, logoUrl: currentLogo }));
          }
        } catch {}
      } catch (e) {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [ownerId]);

  const loadRequests = async () => {
    if (!ownerId) return;
    try {
      setLoadingRequests(true);
      const res = await axios.get(`/api/support/requests`, { params: { ownerId } });
      setRequests(res.data?.requests || []);
    } catch (e) {
      setRequests([]);
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => { loadRequests(); }, [ownerId]);

  const update = (path, value) => {
    setForm(prev => {
      const clone = { ...prev };
      const parts = path.split('.');
      let cur = clone;
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] = cur[parts[i]] ?? {};
      cur[parts[parts.length - 1]] = value;
      return clone;
    });
  };

  const addFaq = () => setForm(f => ({ ...f, faqs: [...(f.faqs||[]), { q: '', a: '' }] }));
  const removeFaq = (idx) => setForm(f => ({ ...f, faqs: (f.faqs||[]).filter((_,i)=>i!==idx) }));

  const save = async () => {
    try {
      setSaving(true);
      setMsg('');
      const payload = { ...form };
      await axios.post(`/api/owners/${ownerId}/support-settings`, payload);
      setMsg('✅ Saved');
    } catch (e) {
      setMsg('❌ Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const sendReply = async (reqId) => {
    if (!replyMap[reqId]) return;
    try {
      await axios.post(`/api/support/reply`, { ownerId, requestId: reqId, message: replyMap[reqId] });
      setReplyMap(m => ({ ...m, [reqId]: '' }));
      loadRequests();
    } catch (e) {
      alert('Failed to send reply');
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: '8px 0', color: 'var(--text-primary)' }}>Support Settings</h2>
      {loading ? <div>Loading...</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="yaba-card" style={{ border: '1px solid var(--stroke)', borderRadius: 20, padding: 16, color: 'var(--text-primary)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Branding</div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>Brand/Hotspot Name</label>
            <input value={form.brandName||''} onChange={e=>update('brandName', e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--control-stroke)', background: 'var(--control)', color: 'var(--text-primary)', marginBottom: 8 }} />
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>Logo URL</label>
            <input value={form.logoUrl||''} onChange={e=>update('logoUrl', e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--control-stroke)', background: 'var(--control)', color: 'var(--text-primary)' }} />
          </div>
          <div className="yaba-card" style={{ border: '1px solid var(--stroke)', borderRadius: 20, padding: 16, color: 'var(--text-primary)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Channels</div>
            {['chat','call','email','help'].map(k => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={!!form.channels?.[k]} onChange={e=>update(`channels.${k}`, e.target.checked)} />
                <span style={{ textTransform: 'capitalize' }}>{k}</span>
              </label>
            ))}
          </div>
          <div className="yaba-card" style={{ border: '1px solid var(--stroke)', borderRadius: 20, padding: 16, color: 'var(--text-primary)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Contact Information</div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
              These contact details will be shown to your users in real-time in the support center.
            </div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Phone Number</label>
            <input 
              value={form.contact?.phone||form.contact?.ownerPhone||''} 
              onChange={e=>update('contact.phone', e.target.value)} 
              placeholder="e.g., +256 700 123 456"
              style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--control-stroke)', background: 'var(--control)', color: 'var(--text-primary)', marginBottom: 12 }} 
            />
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Email Address</label>
            <input 
              value={form.contact?.email||form.contact?.ownerEmail||''} 
              onChange={e=>update('contact.email', e.target.value)} 
              placeholder="e.g., support@yourhotspot.com"
              style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--control-stroke)', background: 'var(--control)', color: 'var(--text-primary)', marginBottom: 12 }} 
            />
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>WhatsApp/Chat URL</label>
            <input 
              value={form.contact?.chatUrl||''} 
              onChange={e=>update('contact.chatUrl', e.target.value)} 
              placeholder="https://wa.me/256700123456 or https://chat.link"
              style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--control-stroke)', background: 'var(--control)', color: 'var(--text-primary)', marginBottom: 12 }} 
            />
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Help Center URL</label>
            <input 
              value={form.contact?.helpUrl||''} 
              onChange={e=>update('contact.helpUrl', e.target.value)} 
              placeholder="https://help.yourhotspot.com"
              style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--control-stroke)', background: 'var(--control)', color: 'var(--text-primary)' }} 
            />
            <div style={{ 
              marginTop: 12, 
              padding: 8, 
              background: '#f0f9ff', 
              border: '1px solid #0ea5e9', 
              borderRadius: 6,
              color: '#0c4a6e',
              fontSize: 12
            }}>
              💡 <strong>Real-time updates:</strong> Changes here will immediately appear in your users' support center.
            </div>
          </div>
          <div className="yaba-card" style={{ border: '1px solid var(--stroke)', borderRadius: 20, padding: 16, color: 'var(--text-primary)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Categories</div>
            {(form.categories||[]).map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input value={c.icon||''} onChange={e=>{
                  const arr=[...(form.categories||[])]; arr[i]={...arr[i], icon:e.target.value}; setForm(f=>({...f,categories:arr}));
                }} style={{ width: 60, padding: 8, borderRadius: 8, border: '1px solid var(--control-stroke)', background: 'var(--control)', color: 'var(--text-primary)' }} />
                <input value={c.label||''} onChange={e=>{
                  const arr=[...(form.categories||[])]; arr[i]={...arr[i], label:e.target.value}; setForm(f=>({...f,categories:arr}));
                }} placeholder="Label" style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid var(--control-stroke)', background: 'var(--control)', color: 'var(--text-primary)' }} />
                <button type="button" onClick={()=>setForm(f=>({...f,categories:(f.categories||[]).filter((_,x)=>x!==i)}))} style={{ padding: '8px 12px' }}>✖</button>
              </div>
            ))}
            <button type="button" onClick={()=>setForm(f=>({...f,categories:[...(f.categories||[]),{key:`custom_${Date.now()}`,label:'New Category',icon:'🆕'}]}))}>
              + Add Category
            </button>
          </div>
          <div className="yaba-card" style={{ gridColumn: '1 / span 2', border: '1px solid var(--stroke)', borderRadius: 20, padding: 16, color: 'var(--text-primary)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Frequently Asked Questions</div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
              Create <strong>hotspot-specific</strong> FAQs that your users will see in the support center. 
              These are unique to your hotspot and will be shown in real-time to users.
            </div>
            {(form.faqs||[]).map((f, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8 }}>
                <input 
                  className="yaba-input"
                  value={f.q} 
                  onChange={e=>{ const arr=[...(form.faqs||[])]; arr[i]={...arr[i], q:e.target.value}; setForm(p=>({...p, faqs:arr})); }} 
                  placeholder="Enter your question..." 
                  style={{ 
                    padding: 8, 
                    borderRadius: 8, 
                    border: !f.q ? '1px solid #ef4444' : '1px solid var(--control-stroke)',
                    backgroundColor: !f.q ? 'rgba(239,68,68,0.08)' : 'var(--control)',
                    color: 'var(--text-primary)'
                  }} 
                />
                <input 
                  className="yaba-input"
                  value={f.a} 
                  onChange={e=>{ const arr=[...(form.faqs||[])]; arr[i]={...arr[i], a:e.target.value}; setForm(p=>({...p, faqs:arr})); }} 
                  placeholder="Enter the answer..." 
                  style={{ 
                    padding: 8, 
                    borderRadius: 8, 
                    border: !f.a ? '1px solid #ef4444' : '1px solid var(--control-stroke)',
                    backgroundColor: !f.a ? 'rgba(239,68,68,0.08)' : 'var(--control)',
                    color: 'var(--text-primary)'
                  }} 
                />
                <button 
                  type="button" 
                  onClick={()=>removeFaq(i)} 
                  style={{ 
                    padding: '8px 12px', 
                    background: 'var(--surface-3)', 
                    color: 'var(--text-primary)', 
                    border: '1px solid var(--stroke)', 
                    borderRadius: 8,
                    cursor: 'pointer'
                  }}
                  title="Remove this FAQ"
                >
                  ✖
                </button>
              </div>
            ))}
            <button 
              type="button" 
              onClick={addFaq}
              style={{
                background: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              + Add New FAQ
            </button>
            {(form.faqs||[]).length === 0 && (
              <div style={{ 
                marginTop: 12, 
                padding: 16, 
                background: '#f0f9ff', 
                border: '1px solid #0ea5e9', 
                borderRadius: 6,
                color: '#0c4a6e'
              }}>
                💡 <strong>Tip:</strong> Add at least one FAQ to provide helpful information to your users. 
                If you don't add any FAQs, users will see an empty state instead of generic questions.
              </div>
            )}
          </div>
        </div>
      )}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button disabled={saving} onClick={save} style={{ background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, padding: '8px 14px', fontWeight: 600 }}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        {msg && <span>{msg}</span>}
      </div>

      <div style={{ marginTop: 24 }}>
        <h3 style={{ margin: '0 0 12px 0' }}>Open Support Requests</h3>
        {loadingRequests && <div>Loading...</div>}
        {!loadingRequests && requests.length === 0 && <div style={{ color: '#6b7280' }}>No requests yet.</div>}
        {!loadingRequests && requests.map(r => (
          <div key={r.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 600 }}>{r.category}</div>
              <div style={{ fontSize: 12, color: r.status === 'answered' ? '#059669' : '#6b7280' }}>{r.status}</div>
            </div>
            <div style={{ color: '#374151', marginTop: 6 }}>{r.issue}</div>
            {r.userPhone && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>User: {r.userPhone}</div>}
            {Array.isArray(r.replies) && r.replies.length > 0 && (
              <div style={{ marginTop: 8, background: 'var(--surface-2)', border: '1px solid var(--stroke)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Previous Replies</div>
                {r.replies.map((rep, idx) => (
                  <div key={idx} style={{ padding: '6px 0', borderTop: idx>0 ? '1px solid #e5e7eb' : 'none' }}>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{rep.responder} • {new Date(rep.createdAt).toLocaleString()}</div>
                    <div style={{ color: '#111827' }}>{rep.message}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input value={replyMap[r.id] || ''} onChange={e=>setReplyMap(m=>({...m,[r.id]:e.target.value}))} placeholder="Type a reply..." className="yaba-input" style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid var(--control-stroke)', background: 'var(--control)', color: 'var(--text-primary)' }} />
              <button onClick={() => sendReply(r.id)} style={{ padding: '8px 12px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 6 }}>Reply</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


