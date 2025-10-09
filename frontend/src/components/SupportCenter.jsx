import React, { useEffect, useState } from 'react';
import axios from 'axios';

const defaultCategories = [
  { key: 'connection', label: 'Connection Issues', icon: '🔌' },
  { key: 'payment', label: 'Payment Problems', icon: '💳' },
  { key: 'account', label: 'Account Management', icon: '👤' },
  { key: 'loyalty', label: 'Loyalty Points', icon: '⭐' },
  { key: 'technical', label: 'Technical Support', icon: '🛠️' },
  { key: 'other', label: 'Other', icon: '❓' },
];

// No default FAQs - each hotspot should have its own specific FAQs

const SupportCenter = ({ ownerId, ownerInfo, userPhone }) => {
  const [settings, setSettings] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('connection');
  const [issue, setIssue] = useState('');
  const [faqs, setFaqs] = useState([]);
  const [categories, setCategories] = useState(defaultCategories);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [faqOpen, setFaqOpen] = useState({});
  const [myRequests, setMyRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);

  useEffect(() => {
    if (!ownerId) return;
    const fetchSettings = async () => {
      try {
        const res = await axios.get(`/api/owners/${ownerId}/support-settings`);
        if (res.data?.settings) {
          setSettings(res.data.settings);
          // Only set FAQs if the owner has actually created them
          setFaqs(res.data.settings.faqs || []);
          if (res.data.settings.categories) setCategories(res.data.settings.categories);
        } else {
          // No settings found - clear FAQs to show empty state
          setFaqs([]);
        }
      } catch (error) {
        console.error('Failed to fetch support settings:', error);
        // On error, show empty state instead of defaults
        setFaqs([]);
      }
    };
    fetchSettings();
  }, [ownerId]);

  const loadMyRequests = async () => {
    if (!userPhone) return;
    try {
      setLoadingRequests(true);
      const res = await axios.get(`/api/support/my`, { params: { userPhone } });
      setMyRequests(res.data?.requests || []);
    } catch {
      setMyRequests([]);
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => { loadMyRequests(); }, [userPhone]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitMsg('');
    try {
      await axios.post(`/api/support/submit`, {
        ownerId,
        category: selectedCategory,
        issue,
        userPhone: userPhone || undefined,
      });
      setSubmitMsg('✅ Your support request has been submitted!');
      setIssue('');
      loadMyRequests();
    } catch {
      setSubmitMsg('❌ Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const ownerBrand = settings?.brandName || ownerInfo?.ownerName || 'Hotspot Owner';
  const logoUrl = ownerInfo?.logoUrl || settings?.logoUrl;
  const supportChannels = settings?.channels || { chat: true, call: true, email: true, help: true };
  const contact = settings?.contact || ownerInfo || {};

  return (
    <div className="support-center" style={{ maxWidth: 700, margin: '0 auto', padding: 24 }}>
      <h2 style={{ fontWeight: 700, fontSize: 28, marginBottom: 4 }}>Support Center</h2>
      <div style={{ color: '#6b7280', marginBottom: 24 }}>
        Get help with <b>{ownerBrand}</b> WiFi services
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {supportChannels.chat && (
          <div className="support-card" style={{ flex: 1, background: 'var(--surface)', borderRadius: 12, padding: 20, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.08)', border: '1px solid var(--stroke)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
            <div style={{ fontWeight: 600 }}>Live Chat</div>
            <div style={{ color: '#6b7280', fontSize: 14, marginBottom: 12 }}>Chat with our support team</div>
            <button 
              style={{ 
                background: '#2563eb', 
                color: '#ffffff', 
                border: 'none', 
                borderRadius: 6, 
                padding: '8px 18px', 
                fontWeight: 500, 
                cursor: contact.chatUrl ? 'pointer' : 'not-allowed',
                opacity: contact.chatUrl ? 1 : 0.5
              }} 
              onClick={() => {
                if (contact.chatUrl) {
                  window.open(contact.chatUrl, '_blank');
                }
              }}
              disabled={!contact.chatUrl}
            >
              {contact.chatUrl ? 'Start Chat' : 'Chat Not Set'}
            </button>
          </div>
        )}
        {supportChannels.call && (
          <div className="support-card" style={{ flex: 1, background: 'var(--surface)', borderRadius: 12, padding: 20, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.08)', border: '1px solid var(--stroke)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📞</div>
            <div style={{ fontWeight: 600 }}>Call Support</div>
            <div style={{ color: '#6b7280', fontSize: 14, marginBottom: 12 }}>Speak directly with an agent</div>
            <button 
              style={{ 
                background: '#10b981', 
                color: '#ffffff', 
                border: 'none', 
                borderRadius: 6, 
                padding: '8px 18px', 
                fontWeight: 500, 
                cursor: (contact.ownerPhone || contact.phone) ? 'pointer' : 'not-allowed',
                opacity: (contact.ownerPhone || contact.phone) ? 1 : 0.5
              }} 
              onClick={() => {
                const phone = contact.ownerPhone || contact.phone;
                if (phone) {
                  window.open(`tel:${phone}`);
                }
              }}
              disabled={!(contact.ownerPhone || contact.phone)}
            >
              {(contact.ownerPhone || contact.phone) ? 'Call Now' : 'Phone Not Set'}
            </button>
          </div>
        )}
        {supportChannels.email && (
          <div className="support-card" style={{ flex: 1, background: 'var(--surface)', borderRadius: 12, padding: 20, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.08)', border: '1px solid var(--stroke)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📧</div>
            <div style={{ fontWeight: 600 }}>Email Support</div>
            <div style={{ color: '#6b7280', fontSize: 14, marginBottom: 12 }}>Send us a detailed message</div>
            <button 
              style={{ 
                background: '#a21caf', 
                color: '#ffffff', 
                border: 'none', 
                borderRadius: 6, 
                padding: '8px 18px', 
                fontWeight: 500, 
                cursor: (contact.ownerEmail || contact.email) ? 'pointer' : 'not-allowed',
                opacity: (contact.ownerEmail || contact.email) ? 1 : 0.5
              }} 
              onClick={() => {
                const email = contact.ownerEmail || contact.email;
                if (email) {
                  window.open(`mailto:${email}`);
                }
              }}
              disabled={!(contact.ownerEmail || contact.email)}
            >
              {(contact.ownerEmail || contact.email) ? 'Send Email' : 'Email Not Set'}
            </button>
          </div>
        )}
      </div>
      {/* Support Request Form */}
      <form onSubmit={handleSubmit} style={{ background: 'var(--surface)', borderRadius: 12, padding: 20, marginBottom: 24, boxShadow: '0 8px 24px rgba(0,0,0,0.08)', border: '1px solid var(--stroke)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Submit a Support Request</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {categories.map(cat => (
            <button type="button" key={cat.key} onClick={() => setSelectedCategory(cat.key)} style={{
              background: selectedCategory === cat.key ? '#2563eb' : '#f3f4f6',
              color: selectedCategory === cat.key ? '#ffffff' : '#374151',
              border: 'none',
              borderRadius: 6,
              padding: '8px 14px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <span>{cat.icon}</span> {cat.label}
            </button>
          ))}
        </div>
        <textarea
          value={issue}
          onChange={e => setIssue(e.target.value)}
          placeholder="Please provide as much detail as possible about your issue..."
          style={{ width: '100%', minHeight: 60, borderRadius: 6, border: '1px solid #e5e7eb', padding: 10, marginBottom: 12 }}
          required
        />
        <button type="submit" disabled={submitting || !issue} style={{ width: '100%', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: 6, padding: '10px 0', fontWeight: 600, fontSize: 16, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
          {submitting ? 'Submitting...' : 'Submit Support Request'}
        </button>
        {submitMsg && <div style={{ marginTop: 10, color: submitMsg.startsWith('✅') ? '#059669' : '#dc2626' }}>{submitMsg}</div>}
      </form>
      {/* My Requests */}
      <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 20, marginBottom: 24, boxShadow: '0 8px 24px rgba(0,0,0,0.08)', border: '1px solid var(--stroke)' }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Your Requests</div>
        {loadingRequests && <div>Loading...</div>}
        {!loadingRequests && myRequests.length === 0 && (
          <div style={{ color: '#6b7280' }}>No requests yet.</div>
        )}
        {!loadingRequests && myRequests.map((r) => (
          <div key={r.id} style={{ border: '1px solid #f3f4f6', borderRadius: 8, padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, color: '#111827' }}>{r.category}</div>
              <div style={{ fontSize: 12, color: r.status === 'answered' ? '#059669' : '#6b7280' }}>{r.status}</div>
            </div>
            <div style={{ color: '#374151', marginTop: 6 }}>{r.issue}</div>
            {Array.isArray(r.replies) && r.replies.length > 0 && (
              <div style={{ marginTop: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Replies</div>
                {r.replies.map((rep, idx) => (
                  <div key={idx} style={{ padding: '6px 0', borderTop: idx>0 ? '1px solid #e5e7eb' : 'none' }}>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{rep.responder} • {new Date(rep.createdAt).toLocaleString()}</div>
                    <div style={{ color: '#111827' }}>{rep.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* FAQ Section */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, marginBottom: 24, boxShadow: '0 1px 4px #0001' }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Frequently Asked Questions</div>
        {faqs.length === 0 ? (
          <div style={{ 
            padding: 20, 
            textAlign: 'center', 
            color: '#6b7280',
            background: '#f9fafb',
            borderRadius: 8,
            border: '1px solid #e5e7eb'
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>❓</div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>No FAQs set up for this hotspot yet</div>
            <div style={{ fontSize: 14, marginTop: 4 }}>
              The owner of <strong>{ownerBrand}</strong> hasn't created any FAQ questions yet.
            </div>
            <div style={{ fontSize: 14, marginTop: 8, color: '#374151' }}>
              💡 <strong>Need help?</strong> Use the support request form below or contact them directly.
            </div>
          </div>
        ) : (
          <>
            <div style={{ 
              fontSize: 14, 
              color: '#059669', 
              marginBottom: 12, 
              padding: 8, 
              background: '#f0fdf4', 
              borderRadius: 6,
              border: '1px solid #bbf7d0',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              <span>✅</span>
              <span>Showing {faqs.length} custom FAQ{faqs.length !== 1 ? 's' : ''} from <strong>{ownerBrand}</strong></span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>• Real-time</span>
            </div>
            {faqs.map((faq, i) => (
              <div key={i} style={{ borderBottom: i < faqs.length - 1 ? '1px solid #f3f4f6' : 'none', padding: '10px 0' }}>
                <button type="button" onClick={() => setFaqOpen(f => ({ ...f, [i]: !f[i] }))} style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', fontWeight: 500, fontSize: 16, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {faq.q}
                  <span style={{ fontSize: 18 }}>{faqOpen[i] ? '▲' : '▼'}</span>
                </button>
                {faqOpen[i] && <div style={{ color: '#6b7280', fontSize: 15, marginTop: 6 }}>{faq.a}</div>}
              </div>
            ))}
          </>
        )}
      </div>
      {/* Contact Info Section */}
      <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 20, boxShadow: '0 8px 24px rgba(0,0,0,0.08)', border: '1px solid var(--stroke)' }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Contact Information</div>
        <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
          Real-time contact information from <strong>{ownerBrand}</strong>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 2 }}>Phone Support</div>
            <div style={{ color: '#374151', fontSize: 15 }}>
              {contact.phone || contact.ownerPhone ? (
                <a href={`tel:${contact.phone || contact.ownerPhone}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                  {contact.phone || contact.ownerPhone}
                </a>
              ) : (
                <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not provided</span>
              )}
            </div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>Available 24/7</div>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 2 }}>Email Support</div>
            <div style={{ color: '#374151', fontSize: 15 }}>
              {contact.email || contact.ownerEmail ? (
                <a href={`mailto:${contact.email || contact.ownerEmail}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                  {contact.email || contact.ownerEmail}
                </a>
              ) : (
                <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not provided</span>
              )}
            </div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>Response within 24 hours</div>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 2 }}>Live Chat</div>
            <div style={{ color: '#374151', fontSize: 15 }}>
              {contact.chatUrl ? (
                <a href={contact.chatUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }}>
                  Available in the app
                </a>
              ) : (
                <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not available</span>
              )}
            </div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>Mon-Fri 8AM-6PM</div>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 2 }}>Help Center</div>
            <div style={{ color: '#374151', fontSize: 15 }}>
              {contact.helpUrl ? (
                <a href={contact.helpUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }}>
                  {contact.helpUrl}
                </a>
              ) : (
                <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not provided</span>
              )}
            </div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>Self-service resources</div>
          </div>
        </div>
        {(!contact.phone && !contact.ownerPhone && !contact.email && !contact.ownerEmail && !contact.chatUrl && !contact.helpUrl) && (
          <div style={{ 
            marginTop: 16, 
            padding: 12, 
            background: '#fef3c7', 
            border: '1px solid #f59e0b', 
            borderRadius: 6,
            color: '#92400e',
            fontSize: 14
          }}>
            ⚠️ <strong>No contact information provided</strong> - The owner of {ownerBrand} hasn't set up their contact details yet. 
            Use the support request form above to get help.
          </div>
        )}
      </div>
    </div>
  );
};

export default SupportCenter;


