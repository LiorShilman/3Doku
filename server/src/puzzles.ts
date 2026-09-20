import { generatePuzzleForLevel, levelNumberFromId, sizeForLevel, type PuzzleDefinition } from '@3doku/shared';
import { getStoredLevel, storeLevel, getRecentStoredRegionsJson } from './db.js';

// How many of the most recent same-size levels a new one must differ from -
// see getRecentStoredRegionsJson for why this is a window, not full history.
const DEDUP_WINDOW = 40;

/**
 * Levels are generated once and persisted to the DB, not regenerated per request:
 * every player gets the exact same board for a given level number (read from the
 * same row), and a future change to the generation algorithm can never silently
 * reshuffle a level someone already has progress or a leaderboard entry against.
 *
 * Independently-seeded levels can still land on the identical board by pure
 * chance (the solution space for a small board is finite) - levels 13 and 43
 * did exactly that in testing (30 apart). Checking against the recent window
 * before accepting a new one rules that out for the levels anyone would
 * plausibly notice back-to-back.
 */
export function getLevel(levelIndex: number): PuzzleDefinition {
  const stored = getStoredLevel(levelIndex);
  if (stored) {
    return { id: `level-${levelIndex}`, size: stored.size, regions: JSON.parse(stored.regions_json) };
  }
  const existing = getRecentStoredRegionsJson(sizeForLevel(levelIndex), DEDUP_WINDOW);
  const puzzle = generatePuzzleForLevel(levelIndex, (regions) => existing.has(JSON.stringify(regions)));
  storeLevel(levelIndex, puzzle.size, JSON.stringify(puzzle.regions));
  return puzzle;
}

export function getPuzzle(id: string): PuzzleDefinition | undefined {
  const level = levelNumberFromId(id);
  if (level === null) return undefined;
  return getLevel(level);
}
