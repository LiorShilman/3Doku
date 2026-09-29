import { useEffect, useState } from 'react';
import { useFriendsStore } from './friendsStore';

interface FriendsPanelProps {
  onViewProfile: (userId: number, displayName: string) => void;
  onChat: (userId: number, displayName: string) => void;
}

// The content of what used to be a standalone "friends" page - now embedded
// as a tab on the profile screen instead, since a whole separate page for
// managing friends/requests/search was more navigation than the feature
// actually needed.
export function FriendsPanel({ onViewProfile, onChat }: FriendsPanelProps) {
  const { friends, incoming, outgoing, candidates, loading, error, loadAll, sendRequest, accept, decline } =
    useFriendsStore();
  const [actingId, setActingId] = useState<number | null>(null);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const withActing = async (userId: number, action: () => Promise<void>) => {
    setActingId(userId);
    try {
      await action();
    } finally {
      setActingId(null);
    }
  };

  // "Friends" are excluded here - they already have their own section above
  // with richer actions (profile/chat/unfriend), so this list is purely
  // "someone new to add", one row per remaining candidate.
  const addable = candidates.filter((c) => c.status !== 'friends');

  return (
    <div className="friends-panel">
      {error && <p className="online-users-error">לא ניתן לטעון את רשימת החברים כרגע</p>}
      {loading && friends.length === 0 && !error && <p className="trade-side-empty">טוען...</p>}

      {incoming.length > 0 && (
        <section className="friends-section">
          <h2>בקשות חברות נכנסות</h2>
          <ul className="friends-list">
            {incoming.map((r) => (
              <li key={r.user_id}>
                <span className="friends-name">{r.display_name}</span>
                <div className="friends-row-actions">
                  <button
                    className="primary"
                    disabled={actingId === r.user_id}
                    onClick={() => withActing(r.user_id, () => accept(r.user_id))}
                  >
                    ✔️ אשר
                  </button>
                  <button disabled={actingId === r.user_id} onClick={() => withActing(r.user_id, () => decline(r.user_id))}>
                    ✖️ דחה
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="friends-section">
          <h2>בקשות שנשלחו וממתינות</h2>
          <ul className="friends-list">
            {outgoing.map((r) => (
              <li key={r.user_id}>
                <span className="friends-name">{r.display_name}</span>
                <div className="friends-row-actions">
                  <button disabled={actingId === r.user_id} onClick={() => withActing(r.user_id, () => decline(r.user_id))}>
                    בטל בקשה
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="friends-section">
        <h2>החברים שלי {friends.length > 0 ? `(${friends.length})` : ''}</h2>
        {friends.length === 0 && <p className="trade-side-empty">עדיין אין לך חברים - הוסף/י מהרשימה למטה</p>}
        <ul className="friends-list">
          {friends.map((f) => (
            <li key={f.user_id}>
              <span className="friends-name">{f.display_name}</span>
              <div className="friends-row-actions">
                <button onClick={() => onViewProfile(f.user_id, f.display_name)}>👤 פרופיל</button>
                <button onClick={() => onChat(f.user_id, f.display_name)}>💬 צ׳אט</button>
                <button disabled={actingId === f.user_id} onClick={() => withActing(f.user_id, () => decline(f.user_id))}>
                  הסר חבר
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="friends-section">
        <h2>חיפוש שחקנים והוספת חברים</h2>
        {addable.length === 0 && <p className="trade-side-empty">אין עוד שחקנים להוסיף כרגע</p>}
        <ul className="friends-list">
          {addable.map((c) => (
            <li key={c.userId}>
              <span className="friends-name">{c.displayName}</span>
              <div className="friends-row-actions">
                {c.status === 'none' && (
                  <button
                    className="primary"
                    disabled={actingId === c.userId}
                    onClick={() => withActing(c.userId, () => sendRequest(c.userId))}
                  >
                    🤝 שלח בקשת חברות
                  </button>
                )}
                {c.status === 'pending-outgoing' && <span className="friends-pending-label">בקשה נשלחה, ממתין/ה...</span>}
                {c.status === 'pending-incoming' && <span className="friends-pending-label">שלח/ה לך בקשה - ראה/י למעלה</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
