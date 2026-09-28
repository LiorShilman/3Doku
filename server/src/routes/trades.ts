import { Router } from 'express';
import { requireAuth } from './auth.js';
import {
  createTradeDeal,
  listOpenTradeDeals,
  getTradeDeal,
  completeTradeDeal,
  cancelTradeDeal,
  getPokemonQty,
  transferPokemon,
  type TradeItem,
} from '../db.js';

export const tradesRouter = Router();

function parseItems(raw: unknown): TradeItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: TradeItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const pokedexNumber = (entry as Record<string, unknown>).pokedexNumber;
    const qty = (entry as Record<string, unknown>).qty;
    if (typeof pokedexNumber !== 'number' || !Number.isInteger(pokedexNumber) || pokedexNumber < 1 || pokedexNumber > 1025) {
      return null;
    }
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 99) return null;
    items.push({ pokedexNumber, qty });
  }
  return items;
}

// The open marketplace - every player's open listings, not just the
// caller's own (see CollectionScreen.tsx's "בקש החלפה" for creating one and
// TradeMarketScreen.tsx for browsing/accepting them).
tradesRouter.get('/', requireAuth, (_req, res) => {
  res.json({ deals: listOpenTradeDeals() });
});

// Only a soft check against what the seller owns right now - re-checked
// again, authoritatively, at accept time (see below), since what they own
// can change before anyone takes the deal.
tradesRouter.post('/', requireAuth, (req, res) => {
  const offer = parseItems((req.body as { offer?: unknown }).offer);
  const request = parseItems((req.body as { request?: unknown }).request);
  if (!offer || !request) return res.status(400).json({ error: 'הצעה לא תקינה' });

  for (const item of offer) {
    if (getPokemonQty(req.user!.id, item.pokedexNumber) < item.qty) {
      return res.status(400).json({ error: 'אין לך מספיק מהפוקימון שרצית להציע' });
    }
  }

  const id = createTradeDeal(req.user!.id, offer, request);
  res.status(201).json({ id });
});

// First come, first served - whoever's accept request lands here first
// while the deal is still 'open' gets it; getTradeDeal's status check and
// completeTradeDeal's update happen in the same synchronous request, so a
// second request for the same deal (even one that started just before this
// one finished) always sees status !== 'open' by the time it checks.
tradesRouter.post('/:id/accept', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'מזהה עסקה לא תקין' });

  const deal = getTradeDeal(id);
  if (!deal || deal.status !== 'open') return res.status(404).json({ error: 'העסקה כבר לא זמינה' });
  if (deal.seller_user_id === req.user!.id) return res.status(400).json({ error: 'אי אפשר לקבל את העסקה של עצמך' });

  for (const item of deal.offer) {
    if (getPokemonQty(deal.seller_user_id, item.pokedexNumber) < item.qty) {
      return res.status(400).json({ error: `${deal.seller_name} כבר לא מחזיק/ה את מה שהוצע בעסקה` });
    }
  }
  for (const item of deal.request) {
    if (getPokemonQty(req.user!.id, item.pokedexNumber) < item.qty) {
      return res.status(400).json({ error: 'אין לך את מה שהעסקה מבקשת' });
    }
  }

  transferPokemon(deal.seller_user_id, req.user!.id, deal.offer, deal.request);
  completeTradeDeal(id, req.user!.id);
  res.json({ ok: true });
});

tradesRouter.post('/:id/cancel', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'מזהה עסקה לא תקין' });

  const deal = getTradeDeal(id);
  if (!deal || deal.status !== 'open') return res.status(404).json({ error: 'העסקה כבר לא זמינה' });
  if (deal.seller_user_id !== req.user!.id) return res.status(403).json({ error: 'אפשר לבטל רק עסקה שלך' });

  cancelTradeDeal(id);
  res.status(204).end();
});
