import { useEffect, useState } from 'react';
import { fetchPokemonCollection, type PokemonCollectionRow } from '../api';
import { loadPokedex, pokemonImageUrl, type PokedexEntry, type Rarity } from './pokedex';

interface CollectionScreenProps {
  onExit: () => void;
}

const RARITY_ORDER: Rarity[] = ['legendary', 'rare', 'uncommon', 'common'];
const RARITY_LABEL: Record<Rarity, string> = {
  legendary: '🌟 אגדיים',
  rare: '💎 נדירים',
  uncommon: '🔷 לא שכיחים',
  common: '⚪ שכיחים',
};

export function CollectionScreen({ onExit }: CollectionScreenProps) {
  const [pokedex, setPokedex] = useState<PokedexEntry[] | null>(null);
  const [collection, setCollection] = useState<PokemonCollectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPokedex().then(setPokedex);
    fetchPokemonCollection()
      .then(setCollection)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="home-shell">
        <div className="home-card">
          <p className="auth-error">לא ניתן לטעון את האוסף כרגע</p>
          <div className="home-actions">
            <button onClick={onExit} className="primary">
              חזרה לתפריט
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!pokedex || !collection) {
    return <div className="app-shell auth-loading" />;
  }

  const caughtByNumber = new Map(collection.map((c) => [c.pokedex_number, c]));
  const totalCaught = caughtByNumber.size;
  const totalCount = pokedex.length;
  const pct = totalCount > 0 ? Math.round((totalCaught / totalCount) * 100) : 0;

  const byRarity: Record<Rarity, PokedexEntry[]> = { common: [], uncommon: [], rare: [], legendary: [] };
  for (const p of pokedex) byRarity[p.rarity].push(p);

  return (
    <div className="collection-shell">
      <div className="collection-header">
        <h1>🎒 אוסף הפוקימונים שלי</h1>
        <button onClick={onExit}>חזרה לתפריט</button>
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
