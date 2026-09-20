import { Router } from 'express';
import { requireAuth } from './auth.js';
import { recordPokemonCatch, uncatchPokemon, getPokemonCollection } from '../db.js';

export const pokemonRouter = Router();

pokemonRouter.get('/collection', requireAuth, (req, res) => {
  res.json({ collection: getPokemonCollection(req.user!.id) });
});

interface CatchBody {
  pokedexNumber?: unknown;
}

function parsePokedexNumber(body: CatchBody): number | null {
  const pokedexNumber = typeof body.pokedexNumber === 'number' ? body.pokedexNumber : NaN;
  if (!Number.isInteger(pokedexNumber) || pokedexNumber < 1 || pokedexNumber > 1025) return null;
  return pokedexNumber;
}

// No solution/rules validation here (unlike leaderboard submits) - which
// Pokemon shows up on a placement is cosmetic, not a competitive outcome, so
// the client's own weighted roll (pokedex.ts) is trusted the same way manual
// marks are: there's nothing to cheat by reporting a catch that never happened.
pokemonRouter.post('/catch', requireAuth, (req, res) => {
  const pokedexNumber = parsePokedexNumber(req.body as CatchBody);
  if (pokedexNumber === null) return res.status(400).json({ error: 'invalid pokedexNumber' });
  recordPokemonCatch(req.user!.id, pokedexNumber);
  res.status(201).json({ ok: true });
});

// Only called when a placement is struck down as a deadlock mistake (see
// gameStore.ts's resolveDeadlock) - never for an ordinary undo.
pokemonRouter.post('/uncatch', requireAuth, (req, res) => {
  const pokedexNumber = parsePokedexNumber(req.body as CatchBody);
  if (pokedexNumber === null) return res.status(400).json({ error: 'invalid pokedexNumber' });
  uncatchPokemon(req.user!.id, pokedexNumber);
  res.status(204).end();
});
