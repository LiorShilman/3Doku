export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface PokedexEntry {
  pokedex_number: number;
  name: string;
  rarity: Rarity;
  image_path: string;
}

let cache: PokedexEntry[] | null = null;
let byNumber: Map<number, PokedexEntry> | null = null;
let byRarityCache: Record<Rarity, PokedexEntry[]> | null = null;
let loading: Promise<PokedexEntry[]> | null = null;

// Fetched once and kept in memory - it's a static 1025-entry list (see
// client/public/pokemon/pokemon.json), not something that changes per user
// or per session, so there's no reason to re-fetch it more than once. The
// Map/rarity-bucket indexes are built here too, once, rather than scanning
// the full array on every board render or every placement - see
// getPokedexEntry and pickPokemonForCell below, both on hot paths.
export function loadPokedex(): Promise<PokedexEntry[]> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}pokemon/pokemon.json`)
      .then((r) => r.json())
      .then((data: PokedexEntry[]) => {
        cache = data;
        byNumber = new Map(data.map((p) => [p.pokedex_number, p]));
        const buckets: Record<Rarity, PokedexEntry[]> = { common: [], uncommon: [], rare: [], legendary: [] };
        for (const p of data) buckets[p.rarity].push(p);
        byRarityCache = buckets;
        return data;
      });
  }
  return loading;
}

export function getPokedexSync(): PokedexEntry[] | null {
  return cache;
}

// O(1) - used on every board render for every placed piece, so this must
// not be a linear scan (see the fix that replaced getPokedexSync().find(...)
// in Board.tsx/Board2D.tsx, which noticeably slowed the board down once the
// pokedex grew from 151 to 1025 entries).
export function getPokedexEntry(pokedexNumber: number): PokedexEntry | undefined {
  return byNumber?.get(pokedexNumber);
}

export function pokemonImageUrl(entry: PokedexEntry): string {
  return `${import.meta.env.BASE_URL}${entry.image_path}`;
}

// Rarer tiers show up much less often - a legendary staying special depends
// on it actually being rare to place, not just rare to exist in the list.
const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 12,
  legendary: 3,
};

// Deterministic per-(puzzle, cell) PRNG (mulberry32, seeded by an FNV-1a hash
// of the key) - not Math.random(). A cell's Pokemon has to be decided once,
// at the board's own creation, not re-rolled on every placement: otherwise
// placing, undoing, and placing again at the very same cell rolls a brand
// new random creature each time, which both feels wrong (why would the same
// square hold a different creature a second later?) and is a farming exploit
// (repeatedly undo/replacing one cell to fish for a legendary).
function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FALLBACK_ENTRY: PokedexEntry = {
  pokedex_number: 25,
  name: 'Pikachu',
  rarity: 'common',
  image_path: 'pokemon/common/Pikachu.png',
};

/**
 * One weighted roll for which rarity tier, then a uniform pick within that
 * tier - both driven by a PRNG seeded from the puzzle id and cell position,
 * so the same cell in the same puzzle always resolves to the same Pokemon no
 * matter how many times it's placed and undone. Requires the pokedex to
 * already be loaded (see loadPokedex) - falls back to Pikachu if called too
 * early, which should never actually happen since the app loads the pokedex
 * on startup well before any placement.
 */
export function pickPokemonForCell(puzzleId: string, row: number, col: number): PokedexEntry {
  const byRarity = byRarityCache;
  if (!byRarity) return FALLBACK_ENTRY;

  const rand = mulberry32(hashSeed(`${puzzleId}:${row}:${col}`));
  const totalWeight = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rand() * totalWeight;
  for (const rarity of Object.keys(RARITY_WEIGHTS) as Rarity[]) {
    const weight = RARITY_WEIGHTS[rarity];
    if (roll < weight) {
      const pool = byRarity[rarity];
      return pool[Math.floor(rand() * pool.length)];
    }
    roll -= weight;
  }
  return FALLBACK_ENTRY;
}
