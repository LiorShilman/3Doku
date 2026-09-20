import type { Position, PuzzleDefinition } from '@3doku/shared';

// Empty in dev (relative paths go through Vite's proxy to localhost:4000). In
// production the client (IIS, one port) and server (PM2, a different port)
// are different origins, so this must point at the server's own URL.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export interface ScoreRow {
  id: number;
  puzzle_id: string;
  user_id: number;
  player_name: string;
  time_ms: number;
  used_assist: number;
  created_at: string;
}

export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
}

async function parseErrorBody(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error ?? `request failed: ${res.status}`;
}

export async function fetchLeaderboard(puzzleId: string): Promise<ScoreRow[]> {
  const res = await fetch(`${API_BASE}/api/leaderboard/${encodeURIComponent(puzzleId)}`);
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.scores;
}

export interface GlobalRankingRow {
  user_id: number;
  player_name: string;
  total_score: number;
  levels_completed: number;
  pokemon_count: number;
}

export async function fetchGlobalRanking(): Promise<GlobalRankingRow[]> {
  const res = await fetch(`${API_BASE}/api/leaderboard/global/top`);
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.ranking;
}

export interface MyGlobalRank {
  rank: number;
  total_score: number;
  levels_completed: number;
}

// Always resolves the calling player's own global-ranking standing, even far
// outside the top 50 fetchGlobalRanking returns - for the live in-game HUD.
export async function fetchMyGlobalRank(): Promise<MyGlobalRank | null> {
  const res = await fetch(`${API_BASE}/api/leaderboard/global/me`, { credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.me;
}

export interface RaceRankingRow {
  user_id: number;
  player_name: string;
  wins: number;
  races_played: number;
}

export async function fetchRaceLeaderboard(): Promise<RaceRankingRow[]> {
  const res = await fetch(`${API_BASE}/api/leaderboard/race/top`);
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.ranking;
}

export interface PokemonCollectionRow {
  pokedex_number: number;
  times_caught: number;
  first_caught_at: string;
}

export async function fetchPokemonCollection(): Promise<PokemonCollectionRow[]> {
  const res = await fetch(`${API_BASE}/api/pokemon/collection`, { credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.collection;
}

// Fire-and-forget from gameStore.ts at the moment of a new placement - a
// failed report just means that one catch doesn't make it into the
// collection screen's tally, not a broken game, so callers don't await this.
export async function reportPokemonCatch(pokedexNumber: number): Promise<void> {
  await fetch(`${API_BASE}/api/pokemon/catch`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pokedexNumber }),
  });
}

// Reverts one reportPokemonCatch call - only used when a placement is struck
// down as a deadlock mistake (see gameStore.ts's resolveDeadlock), never for
// an ordinary undo.
export async function reportPokemonUncatch(pokedexNumber: number): Promise<void> {
  await fetch(`${API_BASE}/api/pokemon/uncatch`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pokedexNumber }),
  });
}

export async function submitScore(
  puzzleId: string,
  payload: { timeMs: number; usedAssist: boolean; positions: Position[] }
): Promise<ScoreRow> {
  const res = await fetch(`${API_BASE}/api/leaderboard/${encodeURIComponent(puzzleId)}/submit`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.score;
}

export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.user;
}

export async function register(email: string, password: string, displayName: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName }),
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.user;
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
}

export async function updateDisplayName(displayName: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/profile`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.user;
}

export async function fetchLevel(levelNumber: number): Promise<PuzzleDefinition> {
  const res = await fetch(`${API_BASE}/api/levels/${levelNumber}`);
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.puzzle;
}

export async function fetchProgress(): Promise<number> {
  const res = await fetch(`${API_BASE}/api/progress`, { credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.levelIndex;
}

export async function saveProgress(levelIndex: number): Promise<void> {
  await fetch(`${API_BASE}/api/progress`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ levelIndex }),
  });
}

// Resets level progress AND the global-ranking standing that comes from past
// submissions (see server's progressRouter's /reset) - the "full reset" from
// the settings screen's danger zone.
export async function resetProgress(): Promise<void> {
  await fetch(`${API_BASE}/api/progress/reset`, { method: 'POST', credentials: 'include' });
}
