// One-off migration: before this, which Pokemon a region yielded was
// deterministic per (puzzleId, region) - see client/src/pokemon/pokedex.ts's
// old pickPokemonForRegion - so every player who ever played the same level
// ended up with the exact same species in their collection. That's since
// been changed to genuine per-attempt randomness for new catches, but
// existing collections built under the old scheme are still identical
// across players. This script reshuffles each player's EXISTING collection
// so the specific species differ from player to player, while preserving:
//   - how many distinct species they own
//   - each species' times_caught count
//   - the rarity-tier makeup (a legendary stays a legendary, just a
//     different one) - so nobody gets richer or poorer, only more varied.
//
// Usage: node server/scripts/reroll-pokemon-collections.mjs <path-to-sqlite-file> [--dry-run]
//
// IMPORTANT: back up the database file first (see homelab-deploy notes) and
// stop the server process before running this against the production file,
// so nothing writes to pokemon_collection while this runs.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!dbPath) {
  console.error('Usage: node reroll-pokemon-collections.mjs <path-to-sqlite-file> [--dry-run]');
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}

const pokedexPath = path.join(dirname, '..', '..', 'client', 'public', 'pokemon', 'pokemon.json');
const pokedex = JSON.parse(fs.readFileSync(pokedexPath, 'utf8'));
const rarityOf = new Map(pokedex.map((p) => [p.pokedex_number, p.rarity]));
const pools = { common: [], uncommon: [], rare: [], legendary: [] };
for (const p of pokedex) pools[p.rarity].push(p.pokedex_number);
console.log('Pokedex loaded:', Object.fromEntries(Object.entries(pools).map(([k, v]) => [k, v.length])));

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const db = new Database(dbPath);

const userIds = db.prepare('SELECT DISTINCT user_id FROM pokemon_collection').all().map((r) => r.user_id);
console.log(`Found ${userIds.length} user(s) with a Pokemon collection in ${dbPath}${dryRun ? ' (DRY RUN - no writes)' : ''}.`);

const getRows = db.prepare('SELECT pokedex_number, times_caught, first_caught_at FROM pokemon_collection WHERE user_id = ?');
const deleteRows = db.prepare('DELETE FROM pokemon_collection WHERE user_id = ?');
const insertRow = db.prepare(
  'INSERT INTO pokemon_collection (user_id, pokedex_number, times_caught, first_caught_at) VALUES (?, ?, ?, ?)'
);

function planReroll(userId) {
  const rows = getRows.all(userId);
  const byTier = { common: [], uncommon: [], rare: [], legendary: [] };
  let unknownTierCount = 0;
  for (const row of rows) {
    const tier = rarityOf.get(row.pokedex_number);
    if (!tier) {
      unknownTierCount++; // a stale/removed pokedex number - left untouched below
      continue;
    }
    byTier[tier].push(row);
  }

  const newRows = [];
  for (const tier of Object.keys(byTier)) {
    const tierRows = byTier[tier];
    if (tierRows.length === 0) continue;
    if (tierRows.length > pools[tier].length) {
      throw new Error(
        `user ${userId} owns ${tierRows.length} distinct ${tier} species, but the pool only has ${pools[tier].length} - cannot reroll without a collision`
      );
    }
    const shuffled = shuffle(pools[tier]);
    tierRows.forEach((row, i) => {
      newRows.push({ pokedex_number: shuffled[i], times_caught: row.times_caught, first_caught_at: row.first_caught_at });
    });
  }

  const totalCaughtBefore = rows.reduce((sum, r) => sum + r.times_caught, 0);
  const totalCaughtAfter = newRows.reduce((sum, r) => sum + r.times_caught, 0);
  const byTierCounts = Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, v.length]));

  return { rows, newRows, byTierCounts, unknownTierCount, totalCaughtBefore, totalCaughtAfter };
}

const applyReroll = db.transaction((userId, newRows) => {
  deleteRows.run(userId);
  for (const row of newRows) {
    insertRow.run(userId, row.pokedex_number, row.times_caught, row.first_caught_at);
  }
});

let totalUsers = 0;
let totalRows = 0;
for (const userId of userIds) {
  const plan = planReroll(userId);
  if (plan.totalCaughtBefore !== plan.totalCaughtAfter) {
    throw new Error(`user ${userId}: total times_caught mismatch (${plan.totalCaughtBefore} -> ${plan.totalCaughtAfter}) - aborting`);
  }
  if (!dryRun) applyReroll(userId, plan.newRows);
  totalUsers++;
  totalRows += plan.rows.length;
  console.log(
    `user ${userId}: ${plan.rows.length} row(s), tiers ${JSON.stringify(plan.byTierCounts)}, total catches preserved (${plan.totalCaughtBefore})` +
      (plan.unknownTierCount ? ` [${plan.unknownTierCount} unknown-tier row(s) left untouched]` : '')
  );
}

console.log(`\n${dryRun ? 'Would reroll' : 'Rerolled'} ${totalUsers} user(s), ${totalRows} row(s) total.`);
db.close();
