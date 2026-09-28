import { useEffect, useState } from 'react';
import { createTradeDeal, fetchPokemonCollection, type PokemonCollectionRow, type TradeItem } from '../api';
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

  // Trade creation lives right on this screen, not a separate picker page -
  // double-clicking a card here (see toggleCard below) adds it to whichever
  // side makes sense given whether it's already owned, instead of hunting
  // for the same Pokemon again in a second, disconnected list.
  const [tradeMode, setTradeMode] = useState(false);
  const [offerSet, setOfferSet] = useState<Set<number>>(new Set());
  const [requestSet, setRequestSet] = useState<Set<number>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

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

  const exitTradeMode = () => {
    setTradeMode(false);
    setOfferSet(new Set());
    setRequestSet(new Set());
    setPublishError(null);
    setPublished(false);
  };

  // Which side a double-click adds a card to is decided by ownership, not by
  // a mode toggle - a card you own becomes something you're offering, one
  // you don't own becomes something you're requesting. A second double-click
  // on the same card removes it again, the same undo-by-repeating pattern
  // the board itself uses for double-tap placement.
  const toggleCard = (pokedexNumber: number) => {
    const owned = caughtByNumber.has(pokedexNumber);
    const setter = owned ? setOfferSet : setRequestSet;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(pokedexNumber)) next.delete(pokedexNumber);
      else next.add(pokedexNumber);
      return next;
    });
  };

  const clearSelection = () => {
    setOfferSet(new Set());
    setRequestSet(new Set());
  };

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError(null);
    const offer: TradeItem[] = [...offerSet].map((pokedexNumber) => ({ pokedexNumber, qty: 1 }));
    const request: TradeItem[] = [...requestSet].map((pokedexNumber) => ({ pokedexNumber, qty: 1 }));
    try {
      await createTradeDeal(offer, request);
      setPublished(true);
      setOfferSet(new Set());
      setRequestSet(new Set());
      setTimeout(exitTradeMode, 1500);
    } catch (err) {
      setPublishError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="collection-shell">
      <div className="collection-header">
        <h1>🎒 אוסף הפוקימונים שלי</h1>
        {tradeMode ? (
          <button onClick={exitTradeMode}>❌ יציאה ממצב עסקה</button>
        ) : (
          <button onClick={() => setTradeMode(true)}>🔄 מצב יצירת עסקה</button>
        )}
        <button onClick={onExit}>חזרה לתפריט</button>
      </div>

      {tradeMode && (
        <div className="trade-build-bar">
          {published ? (
            <p className="online-users-sent">העסקה פורסמה בשוק ההחלפות ✓</p>
          ) : (
            <>
              <p className="trade-build-hint">
                לחיצה כפולה על פוקימון שיש לך = הוספה כהצעה · לחיצה כפולה על פוקימון שאין לך = הוספה כבקשה · לחיצה כפולה
                נוספת מסירה
              </p>
              <div className="trade-deal-columns trade-build-columns">
                <div>
                  <span className="trade-deal-label">מציע ({offerSet.size}):</span>
                  <div className="trade-deal-items">
                    {[...offerSet].map((n) => {
                      const entry = pokedex.find((p) => p.pokedex_number === n);
                      if (!entry) return null;
                      return (
                        <button key={n} className="trade-deal-item trade-build-chip" onClick={() => toggleCard(n)} title="הסר">
                          <img src={pokemonImageUrl(entry)} alt={entry.name} />
                        </button>
                      );
                    })}
                    {offerSet.size === 0 && <span className="trade-side-empty">בחר/י פוקימון שיש לך למטה</span>}
                  </div>
                </div>
                <span className="trade-deal-arrow">⇄</span>
                <div>
                  <span className="trade-deal-label">מבקש ({requestSet.size}):</span>
                  <div className="trade-deal-items">
                    {[...requestSet].map((n) => {
                      const entry = pokedex.find((p) => p.pokedex_number === n);
                      if (!entry) return null;
                      return (
                        <button key={n} className="trade-deal-item trade-build-chip" onClick={() => toggleCard(n)} title="הסר">
                          <img src={pokemonImageUrl(entry)} alt={entry.name} />
                        </button>
                      );
                    })}
                    {requestSet.size === 0 && <span className="trade-side-empty">בחר/י פוקימון שאין לך למטה</span>}
                  </div>
                </div>
              </div>

              {publishError && <p className="online-users-error">{publishError}</p>}

              <div className="online-users-compose-actions">
                <button onClick={clearSelection} disabled={offerSet.size === 0 && requestSet.size === 0}>
                  נקה בחירה
                </button>
                <button
                  className="primary"
                  onClick={handlePublish}
                  disabled={publishing || offerSet.size === 0 || requestSet.size === 0}
                >
                  {publishing ? 'מפרסם...' : 'פרסם עסקה'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

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
              const owned = !!caught;
              // Trade mode needs to know what it's picking, so it lifts the
              // usual "???" mystery silhouette for the duration of building
              // a deal - back to normal the moment trade mode is exited.
              const reveal = owned || tradeMode;
              const isOffer = offerSet.has(p.pokedex_number);
              const isRequest = requestSet.has(p.pokedex_number);
              const classes = [
                'collection-card',
                owned ? 'caught' : 'locked',
                tradeMode ? 'trade-reveal trade-selectable' : '',
                isOffer ? 'trade-offer-selected' : '',
                isRequest ? 'trade-request-selected' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div key={p.pokedex_number} className={classes} onDoubleClick={() => tradeMode && toggleCard(p.pokedex_number)}>
                  <div className="collection-card-image-wrap">
                    <img
                      src={pokemonImageUrl(p)}
                      alt={reveal ? p.name : '?'}
                      className="collection-card-image"
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <span className="collection-card-name">{reveal ? p.name : '???'}</span>
                  {owned && caught!.times_caught > 1 && <span className="collection-card-count">×{caught!.times_caught}</span>}
                  {isOffer && <span className="trade-select-badge offer">הצעה</span>}
                  {isRequest && <span className="trade-select-badge request">בקשה</span>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
