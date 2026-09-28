import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
interface PokedexEntry {
  pokedex_number: number;
  name: string;
  rarity: Rarity;
  image_path: string;
}

// Same static file the client reads (client/public/pokemon/pokemon.json) -
// read here too so the SERVER can decide which Pokemon a region yields,
// rather than trusting whatever number the client reports. Both halves of
// this monorepo live on the same machine/checkout, so this relative path is
// safe; it's read once at server startup, not per-request.
const pokedexPath = path.join(dirname, '..', '..', 'client', 'public', 'pokemon', 'pokemon.json');
const pokedex: PokedexEntry[] = JSON.parse(fs.readFileSync(pokedexPath, 'utf8'));

const pools: Record<Rarity, number[]> = { common: [], uncommon: [], rare: [], legendary: [] };
for (const p of pokedex) pools[p.rarity].push(p.pokedex_number);

// Same weights as the client used to roll with (see the old
// client/src/pokemon/pokedex.ts) - kept here now that the roll itself is
// server-authoritative (see routes/pokemon.ts's /catch), so a player editing
// their own localStorage/zustand state can no longer influence which
// Pokemon a placement actually yields.
const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 12,
  legendary: 3,
};
const TOTAL_WEIGHT = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);

export function rollRandomPokedexNumber(): number {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const rarity of Object.keys(RARITY_WEIGHTS) as Rarity[]) {
    const weight = RARITY_WEIGHTS[rarity];
    if (roll < weight) {
      const pool = pools[rarity];
      return pool[Math.floor(Math.random() * pool.length)];
    }
    roll -= weight;
  }
  return 25; // Pikachu - unreachable in practice, weights sum to TOTAL_WEIGHT exactly
}
