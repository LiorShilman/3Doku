import { useState } from 'react';
import { usePresenceStore } from './presenceStore';

interface OnlineUsersModalProps {
  onClose: () => void;
}

export function OnlineUsersModal({ onClose }: OnlineUsersModalProps) {
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);
  const sendNotification = usePresenceStore((s) => s.sendNotification);

  const [selected, setSelected] = useState<{ userId: number; displayName: string } | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const handleSend = async () => {
    if (!selected || !message.trim()) return;
    setSending(true);
    setError(null);
    const res = await sendNotification(selected.userId, message.trim());
    setSending(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setSentTo(selected.displayName);
    setMessage('');
    setSelected(null);
    setTimeout(() => setSentTo(null), 2500);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card online-users-modal" onClick={(e) => e.stopPropagation()}>
        <h2>🟢 מחוברים כעת</h2>

        {sentTo && <p className="online-users-sent">ההודעה נשלחה ל-{sentTo} ✓</p>}

        {onlineUsers.length === 0 && <p className="online-users-empty">אף אחד אחר לא מחובר כרגע</p>}

        {!selected && onlineUsers.length > 0 && (
          <ul className="online-users-list">
            {onlineUsers.map((u) => (
              <li key={u.userId}>
                <span className="online-users-dot" />
                <span className="online-users-name">{u.displayName}</span>
                <button
                  className="online-users-notify-btn"
                  onClick={() => {
                    setSelected(u);
                    setError(null);
                  }}
                >
                  💬 שלח הודעה
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div className="online-users-compose">
            <p className="online-users-compose-to">
              הודעה ל-<strong>{selected.displayName}</strong>
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="כתוב הודעה..."
              maxLength={500}
              rows={3}
              autoFocus
            />
            {error && <p className="online-users-error">{error}</p>}
            <div className="online-users-compose-actions">
              <button
                onClick={() => {
                  setSelected(null);
                  setMessage('');
                  setError(null);
                }}
              >
                ביטול
              </button>
              <button onClick={handleSend} disabled={sending || !message.trim()} className="primary">
                {sending ? 'שולח...' : 'שלח'}
              </button>
            </div>
          </div>
        )}

        <button onClick={onClose} className="primary online-users-close">
          סגור
        </button>
      </div>
    </div>
  );
}
