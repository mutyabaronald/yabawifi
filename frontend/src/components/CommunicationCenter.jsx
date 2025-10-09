import React, { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  limit,
} from "firebase/firestore";
import { useTheme } from "../contexts/ThemeContext";

function MetricCard({ title, value, accent }) {
  return (
    <div className="yaba-card" style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent || "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

export default function CommunicationCenter({ ownerId }) {
  const { isDark } = useTheme();
  const [activeTab, setActiveTab] = useState("messages");

  // Realtime: notifications
  const [notifications, setNotifications] = useState([]);
  const unreadCount = useMemo(() => notifications.filter(n => !n.isRead).length, [notifications]);

  // Realtime: conversations and messages
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const bottomRef = useRef(null);

  // SMS Center state
  const [smsMessage, setSmsMessage] = useState("");

  // Broadcast state
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcastScope, setBroadcastScope] = useState("system"); // 'system' | 'location'

  // Settings state
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplyText, setAutoReplyText] = useState("Thanks for reaching out. We will reply shortly.");

  // Subscribe to notifications
  useEffect(() => {
    if (!ownerId) return;
    const q = query(
      collection(db, "admin_notifications"),
      where("ownerId", "==", ownerId),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setNotifications(list);
    });
    return () => unsub();
  }, [ownerId]);

  // Subscribe to conversations
  useEffect(() => {
    if (!ownerId) return;
    const q = query(
      collection(db, "conversations"),
      where("ownerId", "==", ownerId),
      orderBy("lastMessageAt", "desc"),
      limit(100)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setConversations(list);
      if (!selectedConversationId && list.length > 0) {
        setSelectedConversationId(list[0].id);
      }
    });
    return () => unsub();
  }, [ownerId]);

  // Subscribe to messages of selected conversation
  useEffect(() => {
    if (!selectedConversationId) return;
    const q = query(
      collection(db, "messages"),
      where("conversationId", "==", selectedConversationId),
      orderBy("createdAt", "asc"),
      limit(500)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMessages(list);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
    return () => unsub();
  }, [selectedConversationId]);

  const sendMessage = async () => {
    const trimmed = messageInput.trim();
    if (!trimmed || !selectedConversationId || !ownerId) return;
    const conv = conversations.find((c) => c.id === selectedConversationId);
    await addDoc(collection(db, "messages"), {
      conversationId: selectedConversationId,
      ownerId,
      to: conv?.userPhone || null,
      from: "owner",
      body: trimmed,
      createdAt: serverTimestamp(),
      kind: "chat",
    });
    await updateDoc(doc(db, "conversations", selectedConversationId), {
      lastMessage: trimmed,
      lastMessageAt: serverTimestamp(),
      lastSender: "owner",
    });
    setMessageInput("");
  };

  const markNotificationRead = async (notif) => {
    try {
      if (!notif?.id) return;
      await updateDoc(doc(db, "admin_notifications", notif.id), { isRead: true });
    } catch {}
  };

  const queueBulkSms = async () => {
    const text = smsMessage.trim();
    if (!text || !ownerId) return;
    await addDoc(collection(db, "sms_queue"), {
      ownerId,
      message: text,
      status: "queued",
      createdAt: serverTimestamp(),
    });
    setSmsMessage("");
  };

  const createBroadcast = async () => {
    if (!broadcastTitle.trim() || !broadcastBody.trim() || !ownerId) return;
    await addDoc(collection(db, "broadcasts"), {
      ownerId,
      title: broadcastTitle.trim(),
      body: broadcastBody.trim(),
      scope: broadcastScope,
      createdAt: serverTimestamp(),
    });
    setBroadcastTitle("");
    setBroadcastBody("");
  };

  const saveSettings = async () => {
    try {
      await updateDoc(doc(db, "owner_comm_settings", ownerId), {
        autoReplyEnabled,
        autoReplyText,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // If doc doesn't exist yet, create with addDoc via a temp collection ref
      await addDoc(collection(db, "owner_comm_settings_placeholder"), {
        ownerId,
        autoReplyEnabled,
        autoReplyText,
        createdAt: serverTimestamp(),
      });
    }
  };

  const styles = {
    tabs: {
      display: "flex",
      gap: 8,
      marginBottom: 16,
      flexWrap: "wrap",
    },
    tab: (isActive) => ({
      padding: "12px 16px",
      borderRadius: 12,
      border: "1px solid var(--stroke, #e5e7eb)",
      background: isActive ? "var(--accent, #2563eb)" : "var(--surface-2, #f8fafc)",
      cursor: "pointer",
      fontWeight: 600,
      color: isActive ? "#fff" : "var(--text-primary)",
      transition: "all 0.2s ease",
      boxShadow: isActive ? "0 2px 8px rgba(37, 99, 235, 0.2)" : "0 1px 3px rgba(0, 0, 0, 0.1)",
      transform: isActive ? "translateY(-1px)" : "translateY(0)",
    }),
    list: {
      display: "flex",
      gap: 16,
      height: 460,
    },
    column: {
      flex: 1,
      overflow: "hidden",
    },
    scroll: {
      overflowY: "auto",
      height: "100%",
      paddingRight: 8,
    },
    msgRow: (mine) => ({
      alignSelf: mine ? "flex-end" : "flex-start",
      background: mine ? (isDark ? "#1f2937" : "#eef2ff") : (isDark ? "#111827" : "#fff"),
      border: "1px solid #e5e7eb",
      borderRadius: 12,
      padding: 10,
      maxWidth: "72%",
      marginBottom: 8,
      whiteSpace: "pre-wrap",
    }),
  };

  return (
    <div>
      {/* Header metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
        <MetricCard title="Active Conversations" value={conversations.length} accent="#6366f1" />
        <MetricCard title="Unread Notifications" value={unreadCount} accent="#f59e0b" />
        <MetricCard title="Online Users" value={conversations.filter(c => c.isUserOnline).length} accent="#10b981" />
        <MetricCard title="Avg Response" value={"–"} />
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {[
          { id: "messages", label: "Messages" },
          { id: "notifications", label: "Notifications" },
          { id: "sms", label: "SMS Center" },
          { id: "broadcast", label: "Broadcast" },
          { id: "settings", label: "Settings" },
        ].map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} className="admin-button" style={styles.tab(activeTab === t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "messages" && (
        <div className="yaba-card" style={{ padding: 16 }}>
          <div style={styles.list}>
            <div style={styles.column}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Conversations</div>
              <div style={styles.scroll}>
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => setSelectedConversationId(c.id)}
                    className="yaba-card"
                    style={{ padding: 12, marginBottom: 8, border: selectedConversationId === c.id ? "2px solid #6366f1" : "1px solid #e5e7eb", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 700 }}>{c.userName || c.userPhone || "User"}</div>
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{c.lastMessage || "Start chatting"}</div>
                  </div>
                ))}
                {conversations.length === 0 && (
                  <div style={{ color: "var(--text-muted)" }}>No conversations yet.</div>
                )}
              </div>
            </div>

            <div style={{ ...styles.column, display: "flex", flexDirection: "column" }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Chat</div>
              <div style={{ ...styles.scroll, display: "flex", flexDirection: "column" }}>
                {messages.map((m) => (
                  <div key={m.id} style={styles.msgRow(m.from === "owner")}>{m.body}</div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="Type a message..."
                  style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <button onClick={sendMessage} className="yaba-btn yaba-btn--accent" style={{ padding: "10px 16px", borderRadius: 8 }}>Send</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="yaba-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Recent Notifications</div>
            <div style={{ color: "var(--text-muted)" }}>{notifications.length} total</div>
          </div>
          <div>
            {notifications.map((n) => (
              <div key={n.id} className="yaba-card" style={{ padding: 12, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{n.title || n.type || "Notification"}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{n.message}</div>
                </div>
                {!n.isRead && (
                  <button onClick={() => markNotificationRead(n)} className="yaba-btn yaba-btn--accent" style={{ padding: "6px 12px", borderRadius: 8, fontSize: "12px" }}>Mark read</button>
                )}
              </div>
            ))}
            {notifications.length === 0 && (
              <div style={{ color: "var(--text-muted)" }}>No notifications yet.</div>
            )}
          </div>
        </div>
      )}

      {activeTab === "sms" && (
        <div className="yaba-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Bulk SMS</div>
          <textarea
            value={smsMessage}
            onChange={(e) => setSmsMessage(e.target.value)}
            rows={4}
            placeholder="Write a message to send to your users"
            style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #e5e7eb", marginBottom: 12 }}
          />
          <button onClick={queueBulkSms} className="yaba-btn yaba-btn--accent" style={{ padding: "12px 20px", borderRadius: 8 }}>Send Bulk SMS</button>
        </div>
      )}

      {activeTab === "broadcast" && (
        <div className="yaba-card" style={{ padding: 16 }}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 700 }}>Create Announcement</div>
            <input
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder="Title"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}
            />
            <textarea
              value={broadcastBody}
              onChange={(e) => setBroadcastBody(e.target.value)}
              rows={4}
              placeholder="Write your announcement"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}
            />
            <div>
              <label style={{ marginRight: 12 }}>
                <input type="radio" name="scope" checked={broadcastScope === "system"} onChange={() => setBroadcastScope("system")} /> System-wide
              </label>
              <label>
                <input type="radio" name="scope" checked={broadcastScope === "location"} onChange={() => setBroadcastScope("location")} /> Location-specific
              </label>
            </div>
            <button onClick={createBroadcast} className="yaba-btn yaba-btn--accent" style={{ padding: "12px 20px", borderRadius: 8 }}>Create Announcement</button>
          </div>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="yaba-card" style={{ padding: 16 }}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 700 }}>Communication Settings</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={autoReplyEnabled} onChange={(e) => setAutoReplyEnabled(e.target.checked)} />
              Enable Auto-Reply
            </label>
            <textarea
              value={autoReplyText}
              onChange={(e) => setAutoReplyText(e.target.value)}
              rows={3}
              style={{ padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}
            />
            <button onClick={saveSettings} className="yaba-btn yaba-btn--accent" style={{ padding: "12px 20px", borderRadius: 8 }}>Save Settings</button>
          </div>
        </div>
      )}
    </div>
  );
}


