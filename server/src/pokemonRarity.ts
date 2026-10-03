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

// How often the roll prefers a species the player doesn't own yet, once the
// tier it landed on still has any left - not 100%, so duplicates (the raw
// material for the trade market) keep showing up even for a player who
// hasn't finished that tier, rather than only once they've completed it.
const NEW_SPECIES_BIAS = 0.8;

// A deep collection makes a uniform-within-tier roll mostly land on
// duplicates by sheer pigeonhole - a veteran player near level 500 has
// likely already caught most commons, so most of their catches stopped
// being new a long time ago. Once the tier is picked (rarity still matters -
// a legendary catch should stay special), this biases the pick WITHIN that
// tier toward whatever the player hasn't caught yet, so a big collection
// keeps growing instead of just piling up more of what it already has.
export function rollRandomPokedexNumber(ownedPokedexNumbers: ReadonlySet<number>): number {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const rarity of Object.keys(RARITY_WEIGHTS) as Rarity[]) {
    const weight = RARITY_WEIGHTS[rarity];
    if (roll < weight) {
      const pool = pools[rarity];
      const notOwned = pool.filter((n) => !ownedPokedexNumbers.has(n));
      const preferNew = notOwned.length > 0 && Math.random() < NEW_SPECIES_BIAS;
      const effectivePool = preferNew ? notOwned : pool;
      return effectivePool[Math.floor(Math.random() * effectivePool.length)];
    }
    roll -= weight;
  }
  return 25; // Pikachu - unreachable in practice, weights sum to TOTAL_WEIGHT exactly
}
