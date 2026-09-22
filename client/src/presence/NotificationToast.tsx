import { useEffect } from 'react';
import { usePresenceStore } from './presenceStore';

const AUTO_DISMISS_MS = 6000;

export function NotificationToast() {
  const incomingNotification = usePresenceStore((s) => s.incomingNotification);
  const dismissNotification = usePresenceStore((s) => s.dismissNotification);

  useEffect(() => {
    if (!incomingNotification) return;
    const timeout = setTimeout(dismissNotification, AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [incomingNotification, dismissNotification]);

  if (!incomingNotification) return null;

  return (
    <div className="notify-toast" onClick={dismissNotification}>
      <span className="notify-toast-icon">💬</span>
      <div className="notify-toast-text">
        <span className="notify-toast-from">{incomingNotification.fromDisplayName}</span>
        <span className="notify-toast-message">{incomingNotification.message}</span>
      </div>
    </div>
  );
}
