import { useEffect, useRef, useState } from 'react';
import { fetchConversation, type ChatMessage, type AuthUser } from '../api';
import { usePresenceStore, type IncomingNotification } from '../presence/presenceStore';
import { getSocket } from '../race/socket';
import { useFriendsStore } from './friendsStore';

interface ChatScreenProps {
  user: AuthUser;
  initialFriendId: number;
  initialFriendName: string;
  onExit: () => void;
}

// Messages loaded from the server come back as SQLite's "YYYY-MM-DD
// HH:MM:SS" (UTC, no timezone marker) and need that conversion - but the
// optimistic messages appended locally the moment you send or receive one
// live (see below) are already built with toISOString(), which is already
// valid and already ends in 'Z'. Blindly appending another 'Z' onto an
// already-ISO string produced "...000ZZ", an invalid date - only normalize
// the SQLite shape, and pass an already-ISO string through untouched.
function formatTime(raw: string): string {
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

export function ChatScreen({ user, initialFriendId, initialFriendName, onExit }: ChatScreenProps) {
  const friends = useFriendsStore((s) => s.friends);
  const loadFriends = useFriendsStore((s) => s.loadAll);
  const sendNotification = usePresenceStore((s) => s.sendNotification);
  const setActiveChatPartner = usePresenceStore((s) => s.setActiveChatPartner);

  const [selected, setSelected] = useState({ userId: initialFriendId, displayName: initialFriendName });
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  useEffect(() => {
    setMessages(null);
    setError(null);
    fetchConversation(selected.userId)
      .then(setMessages)
      .catch((err) => setError(err.message));
  }, [selected.userId]);

  // Marks this specific conversation as "on screen" (see presenceStore.ts)
  // so an incoming message from this exact friend shows up live below
  // instead of ALSO popping the toast for a thread that's already open -
  // cleared on unmount/switch so it doesn't linger once the page is left.
  useEffect(() => {
    setActiveChatPartner(selected.userId);
    return () => setActiveChatPartner(null);
  }, [selected.userId, setActiveChatPartner]);

  useEffect(() => {
    const socket = getSocket();
    const onReceive = (data: IncomingNotification) => {
      if (data.fromUserId !== selected.userId) return;
      setMessages((prev) => [
        ...(prev ?? []),
        {
          id: -Date.now(), // synthetic - a real id arrives next time this conversation is refetched
          from_user_id: data.fromUserId,
          to_user_id: user.id,
          message: data.message,
          created_at: new Date(data.sentAt).toISOString(),
        },
      ]);
    };
    socket.on('notify:receive', onReceive);
    return () => {
      socket.off('notify:receive', onReceive);
    };
  }, [selected.userId, user.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    const res = await sendNotification(selected.userId, text);
    setSending(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setError(null);
    setDraft('');
    setMessages((prev) => [
      ...(prev ?? []),
      {
        id: -Date.now(),
        from_user_id: user.id,
        to_user_id: selected.userId,
        message: text,
        created_at: new Date().toISOString(),
      },
    ]);
  };

  return (
    <div className="chat-shell">
      <div className="chat-sidebar">
        <div className="chat-sidebar-header">
          <h1>💬 צ׳אטים</h1>
          <button onClick={onExit}>חזרה</button>
        </div>
        {friends.length === 0 && <p className="trade-side-empty">אין עדיין חברים - הוסף/י מעמוד החברים</p>}
        <ul className="chat-friend-list">
          {friends.map((f) => (
            <li key={f.user_id}>
              <button
                className={`chat-friend-btn${f.user_id === selected.userId ? ' active' : ''}`}
                onClick={() => setSelected({ userId: f.user_id, displayName: f.display_name })}
              >
                {f.display_name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="chat-thread">
        <div className="chat-thread-header">
          <strong>{selected.displayName}</strong>
        </div>

        <div className="chat-messages">
          {!messages && !error && <p className="trade-side-empty">טוען...</p>}
          {error && <p className="online-users-error">{error}</p>}
          {messages &&
            messages.map((m) => (
              <div key={m.id} className={`chat-bubble${m.from_user_id === user.id ? ' mine' : ''}`}>
                <p className="chat-bubble-text">{m.message}</p>
                <span className="chat-bubble-time">{formatTime(m.created_at)}</span>
              </div>
            ))}
          <div ref={bottomRef} />
        </div>

        <div className="chat-compose">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="כתוב הודעה..."
            maxLength={500}
            rows={2}
          />
          <button className="primary" onClick={handleSend} disabled={sending || !draft.trim()}>
            שלח
          </button>
        </div>
      </div>
    </div>
  );
}
