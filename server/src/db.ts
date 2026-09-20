import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function saveProgress(userId: number, levelIndex: number): void {
  db.prepare(
    `INSERT INTO progress (user_id, level_index, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET level_index = excluded.level_index, updated_at = excluded.updated_at`
  ).run(userId, levelIndex);
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

/**
 * Cross-level ranking: each user's best submission per level (same ordering as
 * topScores - no assist beats any assisted run, then fastest time) is converted
 * to a server-computed score and summed. Scored server-side from time_ms/used_assist
 * only (never a client-supplied number) so it can't be gamed by a client claiming
 * zero mistakes - the same trust boundary the solution-validity check already draws.
 * Best-per-level (not every submission) so replaying a level for more points doesn't
 * inflate the total.
 */
export function globalRanking(limit = 50): GlobalRankingRow[] {
  return db
    .prepare(
      `WITH best AS (
         SELECT user_id, puzzle_id, time_ms, used_assist,
                ROW_NUMBER() OVER (PARTITION BY user_id, puzzle_id ORDER BY used_assist ASC, time_ms ASC) AS rn
         FROM scores
       ),
       scored AS (
         SELECT user_id,
                MAX(1000 - (time_ms / 1000) * 2 - used_assist * 200, 0) AS score
         FROM best
         WHERE rn = 1
       )
       SELECT users.id AS user_id,
              users.display_name AS player_name,
              SUM(scored.score) AS total_score,
              COUNT(*) AS levels_completed,
              COALESCE((SELECT COUNT(*) FROM pokemon_collection pc WHERE pc.user_id = users.id), 0) AS pokemon_count
       FROM scored
       JOIN users ON users.id = scored.user_id
       GROUP BY users.id
       ORDER BY total_score DESC
       LIMIT ?`
    )
    .all(limit) as GlobalRankingRow[];
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
 * globalRanking; RANK() (not ROW_NUMBER()) so tied totals share a place.
 */
export function myGlobalRank(userId: number): MyGlobalRankRow | undefined {
  return db
    .prepare(
      `WITH best AS (
         SELECT user_id, puzzle_id, time_ms, used_assist,
                ROW_NUMBER() OVER (PARTITION BY user_id, puzzle_id ORDER BY used_assist ASC, time_ms ASC) AS rn
         FROM scores
       ),
       scored AS (
         SELECT user_id,
                MAX(1000 - (time_ms / 1000) * 2 - used_assist * 200, 0) AS score
         FROM best
         WHERE rn = 1
       ),
       totals AS (
         SELECT user_id, SUM(score) AS total_score, COUNT(*) AS levels_completed
         FROM scored
         GROUP BY user_id
       ),
       ranked AS (
         SELECT user_id, total_score, levels_completed, RANK() OVER (ORDER BY total_score DESC) AS rank
         FROM totals
       )
       SELECT rank, total_score, levels_completed FROM ranked WHERE user_id = ?`
    )
    .get(userId) as MyGlobalRankRow | undefined;
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
