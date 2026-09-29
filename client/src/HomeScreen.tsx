import { useEffect, useState } from 'react';
import { fetchGlobalRanking, type AuthUser, type GlobalRankingRow } from './api';
import { usePresenceStore } from './presence/presenceStore';
import { useSoundStore } from './sound/soundStore';
import { useFriendsStore } from './social/friendsStore';
import { rankDisplay } from './rankIcons';

interface HomeScreenProps {
  user: AuthUser;
  levelIndex: number;
  onContinue: () => void;
  onRace: () => void;
  onCollection: () => void;
  onTradeMarket: () => void;
  onFriends: () => void;
  onMyProfile: () => void;
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
  onTradeMarket,
  onFriends,
  onMyProfile,
  onSettings,
  onOnlineUsers,
  onLogout,
}: HomeScreenProps) {
  const onlineCount = usePresenceStore((s) => s.onlineUsers.length);
  const soundMuted = useSoundStore((s) => s.muted);
  const toggleSoundMuted = useSoundStore((s) => s.toggleMuted);
  const incomingFriendRequests = useFriendsStore((s) => s.incoming.length);
  const loadFriendsStore = useFriendsStore((s) => s.loadAll);
  const [ranking, setRanking] = useState<GlobalRankingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGlobalRanking()
      .then(setRanking)
      .catch((err) => setError(err.message));
    loadFriendsStore();
  }, [loadFriendsStore]);

  return (
    <div className="home-shell">
      <div className="home-card">
        <h1>3Doku</h1>
        <p className="home-welcome">שלום, {user.displayName}</p>

        <div className="home-actions">
          <button onClick={onContinue} className="primary">
            המשך משחק - שלב {levelIndex + 1}
          </button>
        </div>

        {/* Everything past the main "continue" action is secondary
            navigation, not a fresh decision every visit - a compact icon
            grid keeps the home screen scannable at a glance instead of a
            tall stack of full-width text buttons that kept growing every
            time a new feature (trade market, friends, profile, sound...)
            got its own home-screen entry. */}
        <div className="home-icon-grid">
          <button className="home-icon-btn" onClick={onRace}>
            <span className="home-icon-emoji">🏁</span>
            <span className="home-icon-label">מרוץ</span>
          </button>
          <button className="home-icon-btn" onClick={onCollection}>
            <span className="home-icon-emoji">🎒</span>
            <span className="home-icon-label">אוסף</span>
          </button>
          <button className="home-icon-btn" onClick={onTradeMarket}>
            <span className="home-icon-emoji">🔄</span>
            <span className="home-icon-label">חנות</span>
          </button>
          <button className="home-icon-btn" onClick={onMyProfile}>
            <span className="home-icon-emoji">👤</span>
            <span className="home-icon-label">פרופיל</span>
          </button>
          <button className="home-icon-btn" onClick={onFriends}>
            <span className="home-icon-emoji">👥</span>
            <span className="home-icon-label">חברים</span>
            {incomingFriendRequests > 0 && <span className="home-icon-badge">{incomingFriendRequests}</span>}
          </button>
          <button className="home-icon-btn" onClick={onOnlineUsers}>
            <span className="home-icon-emoji">🟢</span>
            <span className="home-icon-label">מחוברים</span>
            {onlineCount > 0 && <span className="home-icon-badge">{onlineCount}</span>}
          </button>
          <button className="home-icon-btn" onClick={toggleSoundMuted}>
            <span className="home-icon-emoji">{soundMuted ? '🔇' : '🔊'}</span>
            <span className="home-icon-label">קול</span>
          </button>
          <button className="home-icon-btn" onClick={onSettings}>
            <span className="home-icon-emoji">⚙️</span>
            <span className="home-icon-label">הגדרות</span>
          </button>
          <button className="home-icon-btn" onClick={onLogout}>
            <span className="home-icon-emoji">🚪</span>
            <span className="home-icon-label">התנתק</span>
          </button>
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
