import { useEffect, useState } from 'react';
import { fetchGlobalRanking, type AuthUser, type GlobalRankingRow } from './api';
import { usePresenceStore } from './presence/presenceStore';
import { rankDisplay } from './rankIcons';

interface HomeScreenProps {
  user: AuthUser;
  levelIndex: number;
  onContinue: () => void;
  onRace: () => void;
  onCollection: () => void;
  onSettings: () => void;
  onOnlineUsers: () => void;
  onLogout: () => void;
}

export function HomeScreen({
  user,
  levelIndex,
  onContinue,
  onRace,
  onCollection,
  onSettings,
  onOnlineUsers,
  onLogout,
}: HomeScreenProps) {
  const onlineCount = usePresenceStore((s) => s.onlineUsers.length);
  const [ranking, setRanking] = useState<GlobalRankingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGlobalRanking()
      .then(setRanking)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="home-shell">
      <div className="home-card">
        <h1>3Doku</h1>
        <p className="home-welcome">שלום, {user.displayName}</p>

        <div className="home-actions">
          <button onClick={onContinue} className="primary">
            המשך משחק - שלב {levelIndex + 1}
          </button>
          <button onClick={onRace}>🏁 מרוץ נגד חבר</button>
          <button onClick={onCollection}>🎒 אוסף הפוקימונים שלי</button>
          <button onClick={onOnlineUsers} className="online-users-button">
            🟢 מחוברים כעת{onlineCount > 0 ? ` (${onlineCount})` : ''}
          </button>
          <button onClick={onSettings}>⚙️ הגדרות</button>
          <button onClick={onLogout}>התנתק</button>
        </div>

        <div className="leaderboard home-ranking">
          <h2>🏆 דירוג כללי</h2>
          {error && <p className="leaderboard-error">לא ניתן לטעון את הדירוג כרגע</p>}
          {!error && !ranking && <p>טוען...</p>}
          {ranking && ranking.length === 0 && <p>עדיין אין נתונים - היה הראשון לפתור שלב!</p>}
          {ranking && ranking.length > 0 && (
            // Just the podium here - the full list (with scroll) lives in the
            // dedicated ranking modal, opened via the button below.
            <ol className="global-ranking-list podium-list">
              {ranking.slice(0, 3).map((row, i) => (
                <li key={row.user_id} className={row.user_id === user.id ? 'me' : ''}>
                  <span className="rank medal">{rankDisplay(i)}</span>
                  <span className="name">{row.player_name}</span>
                  <span className="levels">🏁 {row.levels_completed}</span>
                  <span className="levels">🎒 {row.pokemon_count}</span>
                  <span className="score">{row.total_score} נק'</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
