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

// The SERVER decides which Pokemon a (level, region) combo yields, not the
// client - see server/src/routes/pokemon.ts's /catch. This is why the
// caller (gameStore.ts's attemptPlace) can't just decide a sprite locally
// and fire this off unread: it has to wait for the actual assigned
// pokedexNumber to come back before it knows what to display.
export async function reportPokemonCatch(levelIndex: number, region: number): Promise<{ pokedexNumber: number }> {
  const res = await fetch(`${API_BASE}/api/pokemon/catch`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ levelIndex, region }),
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  return res.json();
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

export interface TradeItem {
  pokedexNumber: number;
  qty: number;
}

export interface TradeDeal {
  id: number;
  seller_user_id: number;
  seller_name: string;
  offer: TradeItem[];
  request: TradeItem[];
  status: 'open' | 'completed' | 'cancelled';
  created_at: string;
}

// The open marketplace - every player's open listing, not filtered to
// online users or a specific counterpart. See TradeMarketScreen.tsx.
export async function fetchTradeDeals(): Promise<TradeDeal[]> {
  const res = await fetch(`${API_BASE}/api/trades`, { credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const data = await res.json();
  return data.deals;
}

export async function createTradeDeal(offer: TradeItem[], request: TradeItem[]): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/trades`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer, request }),
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  return res.json();
}

export async function acceptTradeDeal(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/trades/${id}/accept`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
}

export async function cancelTradeDeal(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/trades/${id}/cancel`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
}

// Temporary diagnostic trail for the "level resets instead of showing the
// win menu" report - see gameStore.ts's call sites and db.ts's
// client_events table doc. Deliberately silent/best-effort: this must never
// throw or block the action it's describing, and there's no reason to
// retry a lost diagnostic breadcrumb.
export function logEvent(event: string, data: unknown): void {
  fetch(`${API_BASE}/api/debug/event`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, data }),
    keepalive: true,
  }).catch(() => {});
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
    // Same reasoning as saveProgress's keepalive - this also fires right on
    // solve, and a refresh in that same window shouldn't be able to drop it.
    keepalive: true,
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

// Large (10x10+) levels can take up to ~60s to generate server-side the first
// time anyone reaches them (see server/src/pregeneration.ts) - the server
// never holds a request open that long for it, since a real production
// incident showed mobile networks/NAT kill an idle connection well under
// that. Instead it responds 202 right away and this polls short requests
// until the level is ready. 2.5s x 40 = 100s, comfortably above the
// measured 62s worst case.
const LEVEL_POLL_INTERVAL_MS = 2500;
const LEVEL_POLL_MAX_ATTEMPTS = 40;

export async function fetchLevel(levelNumber: number): Promise<PuzzleDefinition> {
  for (let attempt = 0; attempt < LEVEL_POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${API_BASE}/api/levels/${levelNumber}`);
    if (res.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, LEVEL_POLL_INTERVAL_MS));
      continue;
    }
    if (!res.ok) throw new Error(await parseErrorBody(res));
    const data = await res.json();
    return data.puzzle;
  }
  throw new Error('השלב לוקח יותר זמן מהצפוי להיבנות - נסה שוב בעוד רגע');
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
    // This fires right when a level is solved, fire-and-forget (the caller
    // doesn't await it) - a refresh in the brief window before it reaches
    // the server (e.g. right after solving, exactly when a player is most
    // likely to refresh/navigate) left the server still pointing at the
    // just-solved level. Reloading that level then found no saved board
    // (its local save is cleared the instant it's solved, by design) and
    // started it fresh and empty - which read as "the level reset itself"
    // even though the puzzle really had been solved correctly. `keepalive`
    // tells the browser to let this specific request finish even if the
    // page that sent it is being unloaded, instead of dropping it.
    keepalive: true,
  });
}

// Resets level progress AND the global-ranking standing that comes from past
// submissions (see server's progressRouter's /reset) - the "full reset" from
// the settings screen's danger zone.
export async function resetProgress(): Promise<void> {
  await fetch(`${API_BASE}/api/progress/reset`, { method: 'POST', credentials: 'include' });
}

export interface Friend {
  user_id: number;
  display_name: string;
}

export interface FriendRequest {
  user_id: number;
  display_name: string;
  created_at: string;
}

export interface FriendCandidate {
  userId: number;
  displayName: string;
  status: 'none' | 'friends' | 'pending-outgoing' | 'pending-incoming';
}

export async function fetchFriends(): Promise<Friend[]> {
  const res = await fetch(`${API_BASE}/api/friends`, { credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  return (await res.json()).friends;
}

export async function fetchFriendRequests(): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
  const res = await fetch(`${API_BASE}/api/friends/requests`, { credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  return res.json();
}

export async function fetchFriendCandidates(): Promise<FriendCandidate[]> {
  const res = await fetch(`${API_BASE}/api/friends/candidates`, { credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  return (await res.json()).candidates;
}

export async function sendFriendRequest(toUserId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/friends/request`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toUserId }),
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
}

export async function acceptFriendRequest(userId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/friends/${userId}/accept`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
}

// Also used to cancel a request you sent, or unfriend someone - see
// server/src/routes/friends.ts's /decline for why it's the same operation.
export async function removeFriendship(userId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/friends/${userId}/decline`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
}

export interface UserStats {
  totalSolves: number;
  avgTimeMs: number | null;
  avgSolvesPerDay: number | null;
  memberSince: string;
}

export async function fetchProfile(userId: number): Promise<{ displayName: string; stats: UserStats }> {
  const res = await fetch(`${API_BASE}/api/friends/${userId}/profile`, { credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  return res.json();
}

export async function fetchFriendCollection(userId: number): Promise<PokemonCollectionRow[]> {
  const res = await fetch(`${API_BASE}/api/friends/${userId}/collection`, { credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  return (await res.json()).collection;
}

export interface ChatMessage {
  id: number;
  from_user_id: number;
  to_user_id: number;
  message: string;
  created_at: string;
}

// Sending itself goes through the existing socket (see presenceStore.ts's
// sendNotification / presence.ts's notify:send, which persists every
// message it relays) - this is only for loading a conversation's history
// when the chat page opens.
export async function fetchConversation(userId: number): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/api/chat/${userId}`, { credentials: 'include' });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  return (await res.json()).messages;
}
