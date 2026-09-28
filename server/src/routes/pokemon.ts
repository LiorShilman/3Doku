import { Router } from 'express';
import { requireAuth } from './auth.js';
import { recordPokemonCatch, uncatchPokemon, getPokemonCollection, getPokemonRoll, savePokemonRoll } from '../db.js';
import { rollRandomPokedexNumber } from '../pokemonRarity.js';

export const pokemonRouter = Router();

pokemonRouter.get('/collection', requireAuth, (req, res) => {
  res.json({ collection: getPokemonCollection(req.user!.id) });
});

interface CatchBody {
  levelIndex?: unknown;
  region?: unknown;
}

// Which Pokemon a (user, level, region) combo yields is decided and
// remembered HERE, not by the client - a player editing their own
// localStorage/store state can no longer influence which species they get,
// and resetting the same level and re-placing the same region always
// returns the same already-rolled result instead of a fresh chance at
// something better. Only a level_index this user has genuinely never
// rolled for gets a new random roll. See pokemonRarity.ts and
// db.ts's pokemon_rolls table.
pokemonRouter.post('/catch', requireAuth, (req, res) => {
  const body = req.body as CatchBody;
  const levelIndex = typeof body.levelIndex === 'number' ? body.levelIndex : NaN;
  const region = typeof body.region === 'number' ? body.region : NaN;
  if (!Number.isInteger(levelIndex) || levelIndex < 1) return res.status(400).json({ error: 'invalid levelIndex' });
  if (!Number.isInteger(region) || region < 0) return res.status(400).json({ error: 'invalid region' });

  let pokedexNumber = getPokemonRoll(req.user!.id, levelIndex, region);
  if (pokedexNumber === undefined) {
    savePokemonRoll(req.user!.id, levelIndex, region, rollRandomPokedexNumber());
    // Re-read rather than trusting the value just rolled - if a second,
    // near-simultaneous request for this same never-before-rolled region
    // beat this one to the INSERT (see savePokemonRoll's ON CONFLICT DO
    // NOTHING), this picks up whichever roll actually won instead of the
    // two requests disagreeing with each other.
    pokedexNumber = getPokemonRoll(req.user!.id, levelIndex, region)!;
  }

  recordPokemonCatch(req.user!.id, pokedexNumber);
  res.status(201).json({ pokedexNumber });
});

interface UncatchBody {
  pokedexNumber?: unknown;
}

// Only called when a placement is struck down as a deadlock mistake (see
// gameStore.ts's resolveDeadlock) - never for an ordinary undo. Trusts the
// client's reported pokedexNumber (unlike /catch above) - the worst a
// malicious client can do here is decrement the wrong species' own count,
// which only hurts themselves, not something worth a second server-side
// lookup to prevent.
pokemonRouter.post('/uncatch', requireAuth, (req, res) => {
  const body = req.body as UncatchBody;
  const pokedexNumber = typeof body.pokedexNumber === 'number' ? body.pokedexNumber : NaN;
  if (!Number.isInteger(pokedexNumber) || pokedexNumber < 1 || pokedexNumber > 1025) {
    return res.status(400).json({ error: 'invalid pokedexNumber' });
  }
  uncatchPokemon(req.user!.id, pokedexNumber);
  res.status(204).end();
});
