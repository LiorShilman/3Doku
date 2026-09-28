export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface PokedexEntry {
  pokedex_number: number;
  name: string;
  rarity: Rarity;
  image_path: string;
}

let cache: PokedexEntry[] | null = null;
let byNumber: Map<number, PokedexEntry> | null = null;
let loading: Promise<PokedexEntry[]> | null = null;

// Fetched once and kept in memory - it's a static 1025-entry list (see
// client/public/pokemon/pokemon.json), not something that changes per user
// or per session, so there's no reason to re-fetch it more than once. The
// Map/rarity-bucket indexes are built here too, once, rather than scanning
// the full array on every board render or every placement - see
// getPokedexEntry below, on the hot per-placement-render path.
export function loadPokedex(): Promise<PokedexEntry[]> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}pokemon/pokemon.json`)
      .then((r) => r.json())
      .then((data: PokedexEntry[]) => {
        cache = data;
        byNumber = new Map(data.map((p) => [p.pokedex_number, p]));
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

