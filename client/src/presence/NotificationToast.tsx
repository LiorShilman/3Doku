import { useEffect, useState } from 'react';
import { usePresenceStore } from './presenceStore';
import { useGameStore } from '../store/gameStore';

const AUTO_DISMISS_MS = 6000;
const REPLY_SENT_DISMISS_MS = 1500;

export function NotificationToast() {
  const incomingNotification = usePresenceStore((s) => s.incomingNotification);
  const dismissNotification = usePresenceStore((s) => s.dismissNotification);
  const sendNotification = usePresenceStore((s) => s.sendNotification);
  const pauseGame = useGameStore((s) => s.pauseGame);
  const resumeGame = useGameStore((s) => s.resumeGame);

  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // A genuinely new notification (not just a re-render) resets any leftover
  // reply UI from a previous one - pauseGame/resumeGame's own no-op guards
  // (see gameStore.ts) make it safe even if the previous reply never
  // properly resumed the clock for some reason.
  useEffect(() => {
    setReplying(false);
    setReplyText('');
    setSending(false);
    setError(null);
    setSent(false);
  }, [incomingNotification?.sentAt]);

  // Auto-dismiss is suspended while actively composing a reply - otherwise
  // the toast (and the paused clock along with it) could vanish out from
  // under someone mid-sentence.
  useEffect(() => {
    if (!incomingNotification || replying) return;
    const timeout = setTimeout(dismissNotification, AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [incomingNotification, replying, dismissNotification]);

  if (!incomingNotification) return null;

  const startReplying = () => {
    // Stops the game clock for as long as replying takes - answering a
    // friend mid-puzzle shouldn't cost solve time, the same reasoning
    // pauseGame already uses for stepping away to the home screen.
    pauseGame();
    setReplying(true);
  };

  const cancelReply = () => {
    resumeGame();
    setReplying(false);
    setReplyText('');
    setError(null);
  };

  const handleSend = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    setError(null);
    const res = await sendNotification(incomingNotification.fromUserId, replyText.trim());
    setSending(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    resumeGame();
    setSent(true);
    setTimeout(dismissNotification, REPLY_SENT_DISMISS_MS);
  };

  if (!replying) {
    return (
      <div className="notify-toast" onClick={startReplying}>
        <span className="notify-toast-icon">💬</span>
        <div className="notify-toast-text">
          <span className="notify-toast-from">{incomingNotification.fromDisplayName}</span>
          <span className="notify-toast-message">{incomingNotification.message}</span>
        </div>
        <button
          className="notify-toast-dismiss"
          onClick={(e) => {
            e.stopPropagation();
            dismissNotification();
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="notify-toast notify-toast-reply" onClick={(e) => e.stopPropagation()}>
      {sent ? (
        <p className="notify-toast-sent">התשובה נשלחה ✓</p>
      ) : (
        <>
          <p className="notify-toast-reply-to">
            תשובה ל<strong>{incomingNotification.fromDisplayName}</strong> · ⏸️ השעון מושהה
          </p>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="כתוב תשובה..."
            rows={2}
            maxLength={500}
            autoFocus
          />
          {error && <p className="online-users-error">{error}</p>}
          <div className="notify-toast-reply-actions">
            <button onClick={cancelReply}>ביטול</button>
            <button className="primary" onClick={handleSend} disabled={sending || !replyText.trim()}>
              {sending ? 'שולח...' : 'שלח'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
