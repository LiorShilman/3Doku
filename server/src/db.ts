import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLevelScore, levelNumberFromId, sizeForLevel } from '@3doku/shared';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// Separate file in dev so iterating locally (schema resets, test accounts) never
// touches the real deployed database - both would otherwise sit at the same path
// since dev and the PM2 production process run from this same checkout.
const dbFileName = process.env.NODE_ENV === 'production' ? '3doku.sqlite' : '3doku.dev.sqlite';
export const db = new Database(path.join(dirname, '..', dbFileName));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    level_index INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS levels (
    level_index INTEGER PRIMARY KEY,
    size INTEGER NOT NULL,
    regions_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    puzzle_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    player_name TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    used_assist INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_scores_puzzle ON scores (puzzle_id, time_ms);

  CREATE TABLE IF NOT EXISTS race_stats (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    wins INTEGER NOT NULL DEFAULT 0,
    races_played INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pokemon_collection (
    user_id INTEGER NOT NULL REFERENCES users(id),
    pokedex_number INTEGER NOT NULL,
    times_caught INTEGER NOT NULL DEFAULT 0,
    first_caught_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, pokedex_number)
  );

  -- Temporary diagnostic trail for the "level resets instead of showing the
  -- win menu" report (see gameStore.ts's logClientEvent calls) - lets the
  -- actual sequence of store transitions be inspected after the fact
  -- instead of guessing at the mechanism. Not meant to be permanent -
  -- worth removing once that bug is understood and fixed.
  CREATE TABLE IF NOT EXISTS client_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    event TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_client_events_user ON client_events (user_id, created_at);

  -- An open marketplace listing, not a targeted offer to one specific
  -- player - anyone can browse open deals and be the first to fulfil one.
  -- Kept as permanent history (status flips to 'completed'/'cancelled'
  -- rather than the row being deleted) so a completed deal doesn't just
  -- vanish without a trace.
  CREATE TABLE IF NOT EXISTS trade_deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_user_id INTEGER NOT NULL REFERENCES users(id),
    offer_json TEXT NOT NULL,
    request_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    buyer_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_trade_deals_status ON trade_deals (status);

  -- Which Pokemon a (user, level, region) combination yields - rolled once,
  -- server-side (see pokemonRarity.ts and routes/pokemon.ts's /catch), the
  -- first time that region gets a placement in that level. Persisted here
  -- rather than in client localStorage so it can't be edited by the player,
  -- and stays stable across resetting the SAME level (only rolling fresh
  -- for a level_index this user has never rolled before) - resetting no
  -- longer offers a way to keep re-rolling for a better species.
  CREATE TABLE IF NOT EXISTS pokemon_rolls (
    user_id INTEGER NOT NULL REFERENCES users(id),
    level_index INTEGER NOT NULL,
    region INTEGER NOT NULL,
    pokedex_number INTEGER NOT NULL,
    PRIMARY KEY (user_id, level_index, region)
  );

  -- One row per pair, always stored with user_a < user_b so there's never a
  -- duplicate row for the same two people regardless of who asked first;
  -- requested_by records who actually sent the request, so the recipient
  -- (not the sender) is the only one who can accept it. A declined request
  -- or a broken-off friendship simply deletes the row - there's no
  -- 'declined' status to remember, so a fresh request can always be sent
  -- again later.
  CREATE TABLE IF NOT EXISTS friendships (
    user_a INTEGER NOT NULL REFERENCES users(id),
    user_b INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_a, user_b)
  );

  -- Direct messages between two players - both the free-text notifications
  -- sent via the existing online-users panel (see presence.ts's notify:send)
  -- and messages sent from the dedicated chat page land here, so either
  -- entry point builds the same persistent conversation history.
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id INTEGER NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_from_to ON chat_messages (from_user_id, to_user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_to_from ON chat_messages (to_user_id, from_user_id, created_at);
`);

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: string;
}

export interface ScoreRow {
  id: number;
  puzzle_id: string;
  user_id: number;
  player_name: string;
  time_ms: number;
  used_assist: number;
  created_at: string;
}

export function createUser(email: string, passwordHash: string, displayName: string): UserRow {
  const info = db
    .prepare(`INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)`)
    .run(email, passwordHash, displayName);
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid) as UserRow;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as UserRow | undefined;
}

export function findUserById(id: number): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

// Every other registered user - for the "add a friend" candidate list (see
// routes/friends.ts's /candidates). A family-scale app's whole user table is
// small enough that this needs no pagination or search.
export function listOtherUsers(userId: number): { id: number; display_name: string }[] {
  return db.prepare(`SELECT id, display_name FROM users WHERE id != ? ORDER BY display_name`).all(userId) as {
    id: number;
    display_name: string;
  }[];
}

// Only the display name is editable from the settings screen - email/password
// changes aren't in scope here. Past scores/race results keep the name they
// were recorded under (player_name is a snapshot, not a live join to users),
// matching how most games handle a rename: it applies going forward only.
export function updateDisplayName(userId: number, displayName: string): UserRow {
  db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(displayName, userId);
  return findUserById(userId)!;
}

export function createSession(token: string, userId: number, expiresAt: string): void {
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
}

export function findValidSessionUser(token: string): UserRow | undefined {
  return db
    .prepare(
      `SELECT users.* FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ? AND sessions.expires_at > datetime('now')`
    )
    .get(token) as UserRow | undefined;
}

export function deleteSession(token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function getProgress(userId: number): number {
  const row = db.prepare(`SELECT level_index FROM progress WHERE user_id = ?`).get(userId) as
    | { level_index: number }
    | undefined;
  return row?.level_index ?? 0;
}

// Never allowed to move a player's progress BACKWARD - only the explicit
// "New Game" reset (see resetProgressToZero below) is allowed to lower it.
// A real incident: a player who'd legitimately reached level 50 had their
// saved progress overwritten back down to level 0 by some client-side race
// (a stale retry, a second device, a failed request landing after a newer
// one - the exact trigger was never conclusively pinned down). Whatever the
// mechanism, this makes that whole class of bug a no-op instead of silent
// data loss: a write with a lower value than what's already stored simply
// doesn't move the stored value down.
export function saveProgress(userId: number, levelIndex: number): void {
  db.prepare(
    `INSERT INTO progress (user_id, level_index, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       level_index = MAX(excluded.level_index, progress.level_index),
       updated_at = CASE WHEN excluded.level_index > progress.level_index THEN excluded.updated_at ELSE progress.updated_at END`
  ).run(userId, levelIndex);
}

// Only the explicit "New Game" reset (see routes/progress.ts's /reset) goes
// through here - deliberately bypasses saveProgress's monotonic guard above,
// since going back to 0 is the one legitimate case where progress is
// actually meant to move backward.
export function resetProgressToZero(userId: number): void {
  db.prepare(
    `INSERT INTO progress (user_id, level_index, updated_at) VALUES (?, 0, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET level_index = 0, updated_at = excluded.updated_at`
  ).run(userId);
}

export interface StoredLevel {
  level_index: number;
  size: number;
  regions_json: string;
}

export function getStoredLevel(levelIndex: number): StoredLevel | undefined {
  return db.prepare(`SELECT * FROM levels WHERE level_index = ?`).get(levelIndex) as StoredLevel | undefined;
}

export function storeLevel(levelIndex: number, size: number, regionsJson: string): void {
  db.prepare(
    `INSERT INTO levels (level_index, size, regions_json) VALUES (?, ?, ?)
     ON CONFLICT(level_index) DO NOTHING`
  ).run(levelIndex, size, regionsJson);
}

/**
 * The most recent already-issued levels of a given board size, so a new one
 * can be checked against them and never repeat a layout a player would still
 * recognize. Windowed (not "every level ever") on purpose: the set of
 * distinct, uniquely-solvable boards a fixed size can produce is finite, and
 * requiring a new level to differ from the *entire* history gets slower and
 * slower as that space fills up (observed multi-second generation times by
 * level ~50-100 in testing). Nobody notices or cares if level 500 happens to
 * repeat a shape from level 5; what actually mattered was level 9 and 10
 * (adjacent) coming out identical.
 */
export function getRecentStoredRegionsJson(size: number, windowSize: number): Set<string> {
  const rows = db
    .prepare(`SELECT regions_json FROM levels WHERE size = ? ORDER BY level_index DESC LIMIT ?`)
    .all(size, windowSize) as { regions_json: string }[];
  return new Set(rows.map((r) => r.regions_json));
}

// Part of a full reset (see routes/progress.ts's /reset) - the player's own
// global-ranking standing is entirely derived from their rows in this table,
// so wiping it here is what makes "start over" also mean "back to zero on
// the leaderboard" rather than just resetting which level they're on.
export function deleteUserScores(userId: number): void {
  db.prepare(`DELETE FROM scores WHERE user_id = ?`).run(userId);
}

export function insertScore(puzzleId: string, userId: number, playerName: string, timeMs: number, usedAssist: boolean): ScoreRow {
  const stmt = db.prepare(
    `INSERT INTO scores (puzzle_id, user_id, player_name, time_ms, used_assist) VALUES (?, ?, ?, ?, ?)`
  );
  const info = stmt.run(puzzleId, userId, playerName, timeMs, usedAssist ? 1 : 0);
  return db.prepare(`SELECT * FROM scores WHERE id = ?`).get(info.lastInsertRowid) as ScoreRow;
}

export function topScores(puzzleId: string, limit = 20): ScoreRow[] {
  return db
    .prepare(`SELECT * FROM scores WHERE puzzle_id = ? ORDER BY used_assist ASC, time_ms ASC LIMIT ?`)
    .all(puzzleId, limit) as ScoreRow[];
}

export interface GlobalRankingRow {
  user_id: number;
  player_name: string;
  total_score: number;
  levels_completed: number;
  pokemon_count: number;
}

interface BestScoreRow {
  user_id: number;
  puzzle_id: string;
  time_ms: number;
  used_assist: number;
}

/**
 * Each user's best submission per level (no assist beats any assisted run,
 * then fastest time), scored via @3doku/shared's computeLevelScore - which
 * needs the puzzle's board size and level number, so this is done in JS
 * rather than as a SQL expression (SQL has no access to sizeForLevel's
 * ramp, and duplicating that formula in raw SQL would drift from the real
 * one over time). Scored purely from time_ms/used_assist - never a
 * client-supplied number - so it can't be gamed by a client claiming zero
 * mistakes, the same trust boundary the solution-validity check already
 * draws. Best-per-level (not every submission) so replaying a level for
 * more points doesn't inflate the total. Shared by globalRanking and
 * myGlobalRank so both use the exact same per-user totals.
 */
function bestScoreTotalsByUser(): Map<number, { total: number; levels: number }> {
  const rows = db
    .prepare(
      `SELECT user_id, puzzle_id, time_ms, used_assist,
              ROW_NUMBER() OVER (PARTITION BY user_id, puzzle_id ORDER BY used_assist ASC, time_ms ASC) AS rn
       FROM scores`
    )
    .all() as (BestScoreRow & { rn: number })[];

  const totals = new Map<number, { total: number; levels: number }>();
  for (const row of rows) {
    if (row.rn !== 1) continue;
    const level = levelNumberFromId(row.puzzle_id);
    if (level === null) continue;
    const score = computeLevelScore(sizeForLevel(level), level, row.time_ms, Boolean(row.used_assist));
    const entry = totals.get(row.user_id) ?? { total: 0, levels: 0 };
    entry.total += score;
    entry.levels += 1;
    totals.set(row.user_id, entry);
  }
  return totals;
}

export function globalRanking(limit = 50): GlobalRankingRow[] {
  const totals = bestScoreTotalsByUser();
  const users = db.prepare(`SELECT id, display_name FROM users`).all() as { id: number; display_name: string }[];
  const pokemonCounts = new Map<number, number>(
    (db.prepare(`SELECT user_id, COUNT(*) AS c FROM pokemon_collection GROUP BY user_id`).all() as { user_id: number; c: number }[]).map(
      (r) => [r.user_id, r.c]
    )
  );

  const rows: GlobalRankingRow[] = [];
  for (const user of users) {
    const entry = totals.get(user.id);
    if (!entry) continue;
    rows.push({
      user_id: user.id,
      player_name: user.display_name,
      total_score: entry.total,
      levels_completed: entry.levels,
      pokemon_count: pokemonCounts.get(user.id) ?? 0,
    });
  }
  rows.sort((a, b) => b.total_score - a.total_score);
  return rows.slice(0, limit);
}

export interface MyGlobalRankRow {
  rank: number;
  total_score: number;
  levels_completed: number;
}

/**
 * The player's own standing on the global ranking, computed over every
 * scored user (not just the top `limit` globalRanking returns) - so the live
 * in-game HUD can show "your rank" even when that's well outside the top 50
 * the home screen's leaderboard actually displays. Same scoring as
 * globalRanking; ties share a rank, matching SQL RANK() semantics.
 */
export function myGlobalRank(userId: number): MyGlobalRankRow | undefined {
  const totals = bestScoreTotalsByUser();
  const entry = totals.get(userId);
  if (!entry) return undefined;
  const rank = 1 + [...totals.values()].filter((t) => t.total > entry.total).length;
  return { rank, total_score: entry.total, levels_completed: entry.levels };
}

/**
 * Called once per completed race room (see race.ts's race:complete). Every
 * participant gets a races_played tick; the winner (lowest finish time among
 * those who actually finished - null if nobody did, e.g. everyone left) also
 * gets a win. Races aren't stored individually (they're in-memory/throwaway -
 * see race.ts), only this running tally, so a race's outcome has to be
 * recorded at the moment it's known or it's lost forever.
 */
export function recordRaceResult(participantUserIds: number[], winnerUserId: number | null): void {
  const bump = db.prepare(
    `INSERT INTO race_stats (user_id, wins, races_played) VALUES (?, ?, 1)
     ON CONFLICT(user_id) DO UPDATE SET
       wins = race_stats.wins + excluded.wins,
       races_played = race_stats.races_played + 1`
  );
  const run = db.transaction((ids: number[], winner: number | null) => {
    for (const id of ids) {
      bump.run(id, id === winner ? 1 : 0);
    }
  });
  run(participantUserIds, winnerUserId);
}

export interface RaceRankingRow {
  user_id: number;
  player_name: string;
  wins: number;
  races_played: number;
}

export function raceLeaderboard(limit = 50): RaceRankingRow[] {
  return db
    .prepare(
      `SELECT users.id AS user_id, users.display_name AS player_name, race_stats.wins AS wins, race_stats.races_played AS races_played
       FROM race_stats
       JOIN users ON users.id = race_stats.user_id
       ORDER BY race_stats.wins DESC, race_stats.races_played ASC
       LIMIT ?`
    )
    .all(limit) as RaceRankingRow[];
}

// A catch is permanent once reported - undoing the placement on the board
// (mistake correction, deadlock recovery, plain undo) removes the piece from
// the board but never revokes a catch, the same way a real Pokedex only ever
// gains entries. See client's gameStore.ts: this is called once, exactly at
// the moment of a new valid placement, never on restoring a saved board from
// localStorage (which would otherwise inflate times_caught on every reload).
// The one exception is deadlock resolution (see uncatchPokemon below) - a
// placement that turns out to deadlock the puzzle is a genuine mistake, not
// a free undo, so it shouldn't have counted as a real catch in the first place.
export function recordPokemonCatch(userId: number, pokedexNumber: number): void {
  db.prepare(
    `INSERT INTO pokemon_collection (user_id, pokedex_number, times_caught) VALUES (?, ?, 1)
     ON CONFLICT(user_id, pokedex_number) DO UPDATE SET times_caught = pokemon_collection.times_caught + 1`
  ).run(userId, pokedexNumber);
}

// Reverts one recordPokemonCatch call - only used when a placement is struck
// down as a deadlock mistake (resolveDeadlock), never for an ordinary undo.
// Deletes the row entirely once its count reaches zero, so a species caught
// only via a since-reverted mistake goes back to "never caught".
export function uncatchPokemon(userId: number, pokedexNumber: number): void {
  db.prepare(
    `UPDATE pokemon_collection SET times_caught = times_caught - 1 WHERE user_id = ? AND pokedex_number = ?`
  ).run(userId, pokedexNumber);
  db.prepare(`DELETE FROM pokemon_collection WHERE user_id = ? AND pokedex_number = ? AND times_caught <= 0`).run(
    userId,
    pokedexNumber
  );
}

export interface PokemonCollectionRow {
  pokedex_number: number;
  times_caught: number;
  first_caught_at: string;
}

export function getPokemonCollection(userId: number): PokemonCollectionRow[] {
  return db
    .prepare(`SELECT pokedex_number, times_caught, first_caught_at FROM pokemon_collection WHERE user_id = ?`)
    .all(userId) as PokemonCollectionRow[];
}

// Part of a full reset (see routes/progress.ts's /reset) - unlike the earlier
// design, the player explicitly asked for the collection to be wiped too.
export function deletePokemonCollection(userId: number): void {
  db.prepare(`DELETE FROM pokemon_collection WHERE user_id = ?`).run(userId);
}

export function getPokemonRoll(userId: number, levelIndex: number, region: number): number | undefined {
  const row = db
    .prepare(`SELECT pokedex_number FROM pokemon_rolls WHERE user_id = ? AND level_index = ? AND region = ?`)
    .get(userId, levelIndex, region) as { pokedex_number: number } | undefined;
  return row?.pokedex_number;
}

// ON CONFLICT DO NOTHING, not an upsert - two near-simultaneous requests for
// the same never-before-rolled region (a genuine race, not just a repeat
// visit) must both end up agreeing on ONE winner, not each keep whatever
// they individually rolled. See routes/pokemon.ts's /catch, which always
// re-reads via getPokemonRoll right after this to find out which one won.
export function savePokemonRoll(userId: number, levelIndex: number, region: number, pokedexNumber: number): void {
  db.prepare(
    `INSERT INTO pokemon_rolls (user_id, level_index, region, pokedex_number) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, level_index, region) DO NOTHING`
  ).run(userId, levelIndex, region, pokedexNumber);
}

// Part of a full reset (see routes/progress.ts's /reset) - without this, a
// "new game" would still silently hand back the exact same rolls the player
// got the first time through, once they reach the same level again.
export function deletePokemonRolls(userId: number): void {
  db.prepare(`DELETE FROM pokemon_rolls WHERE user_id = ?`).run(userId);
}

export function getPokemonQty(userId: number, pokedexNumber: number): number {
  const row = db
    .prepare(`SELECT times_caught FROM pokemon_collection WHERE user_id = ? AND pokedex_number = ?`)
    .get(userId, pokedexNumber) as { times_caught: number } | undefined;
  return row?.times_caught ?? 0;
}

export interface TradeItem {
  pokedexNumber: number;
  qty: number;
}

function movePokemon(fromUserId: number, toUserId: number, pokedexNumber: number, qty: number): void {
  db.prepare(
    `UPDATE pokemon_collection SET times_caught = times_caught - ? WHERE user_id = ? AND pokedex_number = ?`
  ).run(qty, fromUserId, pokedexNumber);
  db.prepare(`DELETE FROM pokemon_collection WHERE user_id = ? AND pokedex_number = ? AND times_caught <= 0`).run(
    fromUserId,
    pokedexNumber
  );
  db.prepare(
    `INSERT INTO pokemon_collection (user_id, pokedex_number, times_caught) VALUES (?, ?, ?)
     ON CONFLICT(user_id, pokedex_number) DO UPDATE SET times_caught = pokemon_collection.times_caught + ?`
  ).run(toUserId, pokedexNumber, qty, qty);
}

// Moves both sides of an accepted trade in one atomic transaction (see
// routes/trades.ts's /:id/accept handler) - better-sqlite3 runs this
// synchronously, so nothing else can interleave between the caller's own
// getPokemonQty affordability check and this call in the same request.
export const transferPokemon = db.transaction(
  (fromUserId: number, toUserId: number, offer: TradeItem[], request: TradeItem[]): void => {
    for (const { pokedexNumber, qty } of offer) movePokemon(fromUserId, toUserId, pokedexNumber, qty);
    for (const { pokedexNumber, qty } of request) movePokemon(toUserId, fromUserId, pokedexNumber, qty);
  }
);

export type TradeDealStatus = 'open' | 'completed' | 'cancelled';

export interface TradeDealRow {
  id: number;
  seller_user_id: number;
  seller_name: string;
  offer: TradeItem[];
  request: TradeItem[];
  status: TradeDealStatus;
  buyer_user_id: number | null;
  created_at: string;
  completed_at: string | null;
}

interface RawTradeDealRow {
  id: number;
  seller_user_id: number;
  seller_name: string;
  offer_json: string;
  request_json: string;
  status: TradeDealStatus;
  buyer_user_id: number | null;
  created_at: string;
  completed_at: string | null;
}

function parseTradeDealRow(row: RawTradeDealRow): TradeDealRow {
  return {
    id: row.id,
    seller_user_id: row.seller_user_id,
    seller_name: row.seller_name,
    offer: JSON.parse(row.offer_json),
    request: JSON.parse(row.request_json),
    status: row.status,
    buyer_user_id: row.buyer_user_id,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

export function createTradeDeal(sellerUserId: number, offer: TradeItem[], request: TradeItem[]): number {
  const info = db
    .prepare(`INSERT INTO trade_deals (seller_user_id, offer_json, request_json) VALUES (?, ?, ?)`)
    .run(sellerUserId, JSON.stringify(offer), JSON.stringify(request));
  return info.lastInsertRowid as number;
}

// Every open listing from every player, not just the caller's own - this is
// a public marketplace, not a private inbox.
export function listOpenTradeDeals(): TradeDealRow[] {
  const rows = db
    .prepare(
      `SELECT trade_deals.*, users.display_name AS seller_name
       FROM trade_deals JOIN users ON users.id = trade_deals.seller_user_id
       WHERE trade_deals.status = 'open'
       ORDER BY trade_deals.created_at DESC`
    )
    .all() as RawTradeDealRow[];
  return rows.map(parseTradeDealRow);
}

export function getTradeDeal(id: number): TradeDealRow | undefined {
  const row = db
    .prepare(
      `SELECT trade_deals.*, users.display_name AS seller_name
       FROM trade_deals JOIN users ON users.id = trade_deals.seller_user_id
       WHERE trade_deals.id = ?`
    )
    .get(id) as RawTradeDealRow | undefined;
  return row ? parseTradeDealRow(row) : undefined;
}

// Whoever calls this first wins the deal - see routes/trades.ts's
// /:id/accept, which re-checks status === 'open' (via getTradeDeal) in the
// same synchronous request as this update, so nothing else can slip in
// between the check and the claim.
export function completeTradeDeal(id: number, buyerUserId: number): void {
  db.prepare(`UPDATE trade_deals SET status = 'completed', buyer_user_id = ?, completed_at = datetime('now') WHERE id = ?`).run(
    buyerUserId,
    id
  );
}

export function cancelTradeDeal(id: number): void {
  db.prepare(`UPDATE trade_deals SET status = 'cancelled' WHERE id = ?`).run(id);
}

export function logClientEvent(userId: number, event: string, data: unknown): void {
  db.prepare(`INSERT INTO client_events (user_id, event, data_json) VALUES (?, ?, ?)`).run(
    userId,
    event,
    JSON.stringify(data)
  );
}

export interface ClientEventRow {
  id: number;
  user_id: number;
  event: string;
  data_json: string;
  created_at: string;
}

export function recentClientEvents(userId: number, limit = 200): ClientEventRow[] {
  return db
    .prepare(`SELECT * FROM client_events WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
    .all(userId, limit) as ClientEventRow[];
}

// friendships is keyed (user_a, user_b) with user_a < user_b always, so
// every read/write goes through this to get a consistent, order-independent
// pair regardless of which of the two users is "me" in a given call.
function pairKey(userId: number, otherUserId: number): [number, number] {
  return userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
}

export type FriendshipStatus = 'pending' | 'accepted';

export interface FriendshipRow {
  user_a: number;
  user_b: number;
  status: FriendshipStatus;
  requested_by: number;
  created_at: string;
}

export function getFriendship(userId: number, otherUserId: number): FriendshipRow | undefined {
  const [a, b] = pairKey(userId, otherUserId);
  return db.prepare(`SELECT * FROM friendships WHERE user_a = ? AND user_b = ?`).get(a, b) as FriendshipRow | undefined;
}

export function areFriends(userId: number, otherUserId: number): boolean {
  return getFriendship(userId, otherUserId)?.status === 'accepted';
}

// Returns null on success, or a reason it couldn't be sent (already
// friends, or a request already pending in either direction) - the caller
// turns that into the HTTP error.
export function sendFriendRequest(fromUserId: number, toUserId: number): 'already-friends' | 'already-pending' | null {
  const existing = getFriendship(fromUserId, toUserId);
  if (existing?.status === 'accepted') return 'already-friends';
  if (existing?.status === 'pending') return 'already-pending';
  const [a, b] = pairKey(fromUserId, toUserId);
  db.prepare(`INSERT INTO friendships (user_a, user_b, status, requested_by) VALUES (?, ?, 'pending', ?)`).run(
    a,
    b,
    fromUserId
  );
  return null;
}

// Only the recipient (not the original sender) can accept - returns false if
// there's no matching pending request from that specific person to accept.
export function acceptFriendRequest(userId: number, fromUserId: number): boolean {
  const existing = getFriendship(userId, fromUserId);
  if (!existing || existing.status !== 'pending' || existing.requested_by !== fromUserId) return false;
  const [a, b] = pairKey(userId, fromUserId);
  db.prepare(`UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?`).run(a, b);
  return true;
}

// Same operation whether it's declining an incoming request, cancelling an
// outgoing one, or ending an existing friendship - all three are just "this
// pair no longer has a row", after which a fresh request can start clean.
export function removeFriendship(userId: number, otherUserId: number): void {
  const [a, b] = pairKey(userId, otherUserId);
  db.prepare(`DELETE FROM friendships WHERE user_a = ? AND user_b = ?`).run(a, b);
}

export interface FriendRow {
  user_id: number;
  display_name: string;
}

export function listFriends(userId: number): FriendRow[] {
  return db
    .prepare(
      `SELECT users.id AS user_id, users.display_name AS display_name
       FROM friendships
       JOIN users ON users.id = CASE WHEN friendships.user_a = ? THEN friendships.user_b ELSE friendships.user_a END
       WHERE (friendships.user_a = ? OR friendships.user_b = ?) AND friendships.status = 'accepted'
       ORDER BY users.display_name`
    )
    .all(userId, userId, userId) as FriendRow[];
}

export interface FriendRequestRow {
  user_id: number;
  display_name: string;
  created_at: string;
}

// Requests sent TO this user, still awaiting their decision.
export function listIncomingFriendRequests(userId: number): FriendRequestRow[] {
  return db
    .prepare(
      `SELECT users.id AS user_id, users.display_name AS display_name, friendships.created_at AS created_at
       FROM friendships
       JOIN users ON users.id = CASE WHEN friendships.user_a = ? THEN friendships.user_b ELSE friendships.user_a END
       WHERE (friendships.user_a = ? OR friendships.user_b = ?)
         AND friendships.status = 'pending'
         AND friendships.requested_by != ?
       ORDER BY friendships.created_at DESC`
    )
    .all(userId, userId, userId, userId) as FriendRequestRow[];
}

// Requests this user sent, still awaiting the other side.
export function listOutgoingFriendRequests(userId: number): FriendRequestRow[] {
  return db
    .prepare(
      `SELECT users.id AS user_id, users.display_name AS display_name, friendships.created_at AS created_at
       FROM friendships
       JOIN users ON users.id = CASE WHEN friendships.user_a = ? THEN friendships.user_b ELSE friendships.user_a END
       WHERE (friendships.user_a = ? OR friendships.user_b = ?)
         AND friendships.status = 'pending'
         AND friendships.requested_by = ?
       ORDER BY friendships.created_at DESC`
    )
    .all(userId, userId, userId, userId) as FriendRequestRow[];
}

export interface UserStats {
  totalSolves: number;
  avgTimeMs: number | null;
  avgSolvesPerDay: number | null;
  memberSince: string;
}

/**
 * Derived entirely from the durable `scores` table (never the temporary
 * client_events diagnostic trail) - total puzzles solved, their average
 * time, and a rough "solves per active day" rate (total solves divided by
 * the number of distinct calendar days that have at least one score,
 * counting from when the account was created). A day with zero solves
 * doesn't extend the average down further, only days actually played do.
 */
export function getUserStats(userId: number): UserStats {
  const user = findUserById(userId)!;
  const summary = db
    .prepare(`SELECT COUNT(*) AS total, AVG(time_ms) AS avg_time FROM scores WHERE user_id = ?`)
    .get(userId) as { total: number; avg_time: number | null };
  const activeDays = db
    .prepare(`SELECT COUNT(DISTINCT DATE(created_at)) AS days FROM scores WHERE user_id = ?`)
    .get(userId) as { days: number };
  return {
    totalSolves: summary.total,
    avgTimeMs: summary.avg_time,
    avgSolvesPerDay: activeDays.days > 0 ? summary.total / activeDays.days : null,
    memberSince: user.created_at,
  };
}

export function sendChatMessage(fromUserId: number, toUserId: number, message: string): void {
  db.prepare(`INSERT INTO chat_messages (from_user_id, to_user_id, message) VALUES (?, ?, ?)`).run(
    fromUserId,
    toUserId,
    message
  );
}

export interface ChatMessageRow {
  id: number;
  from_user_id: number;
  to_user_id: number;
  message: string;
  created_at: string;
}

export function getConversation(userId: number, otherUserId: number, limit = 200): ChatMessageRow[] {
  return db
    .prepare(
      `SELECT * FROM chat_messages
       WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
       ORDER BY id DESC LIMIT ?`
    )
    .all(userId, otherUserId, otherUserId, userId, limit)
    .reverse() as ChatMessageRow[];
}
