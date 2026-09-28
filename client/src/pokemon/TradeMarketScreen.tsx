import { useEffect, useState } from 'react';
import {
  acceptTradeDeal,
  cancelTradeDeal,
  fetchPokemonCollection,
  fetchTradeDeals,
  type AuthUser,
  type PokemonCollectionRow,
  type TradeDeal,
  type TradeItem,
} from '../api';
import { getPokedexEntry, pokemonImageUrl } from './pokedex';
import { useGameStore } from '../store/gameStore';
import { playSound } from '../sound/soundManager';

interface TradeMarketScreenProps {
  user: AuthUser;
  onExit: () => void;
}

function ItemRow({ items }: { items: TradeItem[] }) {
  return (
    <div className="trade-deal-items">
      {items.map((item) => {
        const entry = getPokedexEntry(item.pokedexNumber);
        if (!entry) return null;
        return (
          <div key={item.pokedexNumber} className={`trade-deal-item rarity-${entry.rarity}`}>
            <div className="trade-deal-item-glow" />
            <img src={pokemonImageUrl(entry)} alt={entry.name} />
            {item.qty > 1 && <span className="trade-deal-item-qty">×{item.qty}</span>}
            <span className="trade-deal-item-name">{entry.name}</span>
          </div>
        );
      })}
    </div>
  );
}

// A deal involving anything rare/legendary is worth flagging visually before
// scrolling through every item inside it.
function hasRareItem(items: TradeItem[]): boolean {
  return items.some((item) => {
    const rarity = getPokedexEntry(item.pokedexNumber)?.rarity;
    return rarity === 'rare' || rarity === 'legendary';
  });
}

// Can the current player actually afford this deal's request side right now?
// Purely a UI hint (grays out the button with an explanation) - the server
// re-checks authoritatively at accept time regardless, since the answer can
// change between rendering this list and clicking accept.
function canAfford(request: TradeItem[], myCollection: PokemonCollectionRow[]): boolean {
  const owned = new Map(myCollection.map((c) => [c.pokedex_number, c.times_caught]));
  return request.every((item) => (owned.get(item.pokedexNumber) ?? 0) >= item.qty);
}

export function TradeMarketScreen({ user, onExit }: TradeMarketScreenProps) {
  const [deals, setDeals] = useState<TradeDeal[] | null>(null);
  const [myCollection, setMyCollection] = useState<PokemonCollectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<{ id: number; message: string } | null>(null);

  const load = () => {
    setError(null);
    Promise.all([fetchTradeDeals(), fetchPokemonCollection()])
      .then(([d, c]) => {
        setDeals(d);
        setMyCollection(c);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const handleAccept = async (deal: TradeDeal) => {
    setActingId(deal.id);
    setActionError(null);
    try {
      await acceptTradeDeal(deal.id);
      playSound('trade');
      await useGameStore.getState().loadOwnedPokedex();
      load();
    } catch (err) {
      setActionError({ id: deal.id, message: (err as Error).message });
    } finally {
      setActingId(null);
    }
  };

  const handleCancel = async (deal: TradeDeal) => {
    setActingId(deal.id);
    setActionError(null);
    try {
      await cancelTradeDeal(deal.id);
      load();
    } catch (err) {
      setActionError({ id: deal.id, message: (err as Error).message });
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="trade-market-shell">
      <div className="trade-market-header">
        <div className="trade-market-header-text">
          <h1>🔄 שוק החלפות</h1>
          <p className="trade-market-subtitle">
            {deals ? `${deals.length} עסקאות פתוחות כרגע` : 'שוק ההחלפות של השחקנים'}
          </p>
        </div>
        <button onClick={onExit} className="trade-market-back">
          חזרה לתפריט
        </button>
      </div>

      <div className="trade-market-toolbar">
        <button onClick={load}>🔄 רענן</button>
      </div>

      {error && <p className="online-users-error">לא ניתן לטעון את שוק ההחלפות כרגע</p>}

      {!error && (!deals || !myCollection) && <p className="trade-side-empty">טוען...</p>}

      {deals && deals.length === 0 && (
        <p className="trade-market-empty">אין כרגע עסקאות פתוחות - היה הראשון לפרסם אחת!</p>
      )}

      {deals && myCollection && deals.length > 0 && (
        <div className="trade-deal-list">
          {deals.map((deal) => {
            const mine = deal.seller_user_id === user.id;
            const affordable = mine || canAfford(deal.request, myCollection);
            const standout = hasRareItem(deal.offer) || hasRareItem(deal.request);
            return (
              <div key={deal.id} className={`trade-deal-card${mine ? ' mine' : ''}${standout ? ' standout' : ''}`}>
                <p className="trade-deal-seller">
                  {mine ? (
                    '⭐ ההצעה שלך'
                  ) : (
                    <>
                      מאת <strong>{deal.seller_name}</strong>
                    </>
                  )}
                </p>

                <div className="trade-deal-columns">
                  <div>
                    <span className="trade-deal-label">מציע</span>
                    <ItemRow items={deal.offer} />
                  </div>
                  <span className="trade-deal-arrow">⇄</span>
                  <div>
                    <span className="trade-deal-label">מבקש</span>
                    <ItemRow items={deal.request} />
                  </div>
                </div>

                {actionError?.id === deal.id && <p className="online-users-error">{actionError.message}</p>}
                {!mine && !affordable && <p className="trade-deal-cant-afford">אין לך מספיק ממה שהעסקה מבקשת</p>}

                <div className="trade-deal-actions">
                  {mine ? (
                    <button onClick={() => handleCancel(deal)} disabled={actingId === deal.id}>
                      {actingId === deal.id ? 'מבטל...' : 'בטל עסקה'}
                    </button>
                  ) : (
                    <button
                      className="primary"
                      onClick={() => handleAccept(deal)}
                      disabled={actingId === deal.id || !affordable}
                    >
                      {actingId === deal.id ? 'מבצע...' : 'קח עסקה'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
