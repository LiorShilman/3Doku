import { useEffect, useState } from 'react';
import { fetchProfile, fetchFriendCollection, type PokemonCollectionRow, type UserStats } from '../api';
import { loadPokedex, pokemonImageUrl, type PokedexEntry, type Rarity } from '../pokemon/pokedex';

interface ProfileScreenProps {
  userId: number;
  onExit: () => void;
}

const RARITY_ORDER: Rarity[] = ['legendary', 'rare', 'uncommon', 'common'];
const RARITY_LABEL: Record<Rarity, string> = {
  legendary: '🌟 אגדיים',
  rare: '💎 נדירים',
  uncommon: '🔷 לא שכיחים',
  common: '⚪ שכיחים',
};

function formatMs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('he-IL');
}

// Viewing your own profile or a friend's is the exact same screen - the
// server enforces the actual access rule (self or accepted friend only, see
// routes/friends.ts's /profile and /collection), this component doesn't
// need its own branching for it.
export function ProfileScreen({ userId, onExit }: ProfileScreenProps) {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [pokedex, setPokedex] = useState<PokedexEntry[] | null>(null);
  const [collection, setCollection] = useState<PokemonCollectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(null);
    setStats(null);
    setCollection(null);
    setError(null);
    loadPokedex().then(setPokedex);
    Promise.all([fetchProfile(userId), fetchFriendCollection(userId)])
      .then(([profile, coll]) => {
        setDisplayName(profile.displayName);
        setStats(profile.stats);
        setCollection(coll);
      })
      .catch((err) => setError(err.message));
  }, [userId]);

  if (error) {
    return (
      <div className="home-shell">
        <div className="home-card">
          <p className="auth-error">{error}</p>
          <div className="home-actions">
            <button onClick={onExit} className="primary">
              חזרה לתפריט
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!displayName || !stats || !pokedex || !collection) {
    return <div className="app-shell auth-loading" />;
  }

  const caughtByNumber = new Map(collection.map((c) => [c.pokedex_number, c]));
  const totalCaught = caughtByNumber.size;
  const totalCount = pokedex.length;
  const pct = totalCount > 0 ? Math.round((totalCaught / totalCount) * 100) : 0;
  const byRarity: Record<Rarity, PokedexEntry[]> = { common: [], uncommon: [], rare: [], legendary: [] };
  for (const p of pokedex) byRarity[p.rarity].push(p);

  return (
    <div className="collection-shell profile-shell">
      <div className="collection-header">
        <h1>👤 {displayName}</h1>
        <button onClick={onExit}>חזרה לתפריט</button>
      </div>

      <div className="profile-stats">
        <div className="profile-stat">
          <span className="profile-stat-value">{stats.totalSolves}</span>
          <span className="profile-stat-label">שלבים שנפתרו</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{stats.avgTimeMs !== null ? formatMs(stats.avgTimeMs) : '—'}</span>
          <span className="profile-stat-label">זמן ממוצע לשלב</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{stats.avgSolvesPerDay !== null ? stats.avgSolvesPerDay.toFixed(1) : '—'}</span>
          <span className="profile-stat-label">שלבים ליום (ממוצע)</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{formatDate(stats.memberSince)}</span>
          <span className="profile-stat-label">חבר/ה מאז</span>
        </div>
      </div>

      <div className="collection-summary">
        <div className="collection-summary-ring" style={{ ['--pct' as string]: `${pct}%` }}>
          <span>{pct}%</span>
        </div>
        <div className="collection-summary-text">
          <p className="collection-summary-count">
            {totalCaught} / {totalCount} נאספו
          </p>
          <div className="collection-summary-breakdown">
            {RARITY_ORDER.map((r) => {
              const list = byRarity[r];
              const caught = list.filter((p) => caughtByNumber.has(p.pokedex_number)).length;
              return (
                <span key={r} className={`collection-badge collection-badge-${r}`}>
                  {RARITY_LABEL[r]}: {caught}/{list.length}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {RARITY_ORDER.map((rarity) => (
        <section className="collection-section" key={rarity}>
          <h2 className={`collection-section-title collection-section-title-${rarity}`}>{RARITY_LABEL[rarity]}</h2>
          <div className="collection-grid">
            {byRarity[rarity].map((p) => {
              const caught = caughtByNumber.get(p.pokedex_number);
              return (
                <div key={p.pokedex_number} className={`collection-card ${caught ? 'caught' : 'locked'}`}>
                  <div className="collection-card-image-wrap">
                    <img
                      src={pokemonImageUrl(p)}
                      alt={caught ? p.name : '?'}
                      className="collection-card-image"
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <span className="collection-card-name">{caught ? p.name : '???'}</span>
                  {caught && caught.times_caught > 1 && (
                    <span className="collection-card-count">×{caught.times_caught}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
