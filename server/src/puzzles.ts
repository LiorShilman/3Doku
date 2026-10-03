import { generatePuzzleForLevel, levelNumberFromId, sizeForLevel, type PuzzleDefinition } from '@3doku/shared';
import { getStoredLevel, storeLevel, getRecentStoredRegionsJson } from './db.js';
import { generateInWorker, schedulePregeneration } from './pregeneration.js';

// How many of the most recent same-size levels a new one must differ from -
// see getRecentStoredRegionsJson for why this is a window, not full history.
const DEDUP_WINDOW = 40;

// Below this size, generation is fast (well under a second even on a worst
// case) - not worth a worker thread's spin-up overhead. At and above it
// (levels 500+, see sizeForLevel), generation can take up to a minute, so it
// always goes through a worker instead of blocking the whole server - see
// generationWorker.ts and pregeneration.ts.
const SLOW_GENERATION_SIZE = 10;

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
export async function getLevel(levelIndex: number): Promise<PuzzleDefinition> {
  const stored = getStoredLevel(levelIndex);
  if (stored) {
    const puzzle: PuzzleDefinition = { id: `level-${levelIndex}`, size: stored.size, regions: JSON.parse(stored.regions_json) };
    // Keep the lookahead buffer topped up every time a 500+ level is
    // actually reached, not just the first time it's generated - so even if
    // an earlier background pass stalled or only partially completed, later
    // requests keep nudging it forward.
    schedulePregeneration(levelIndex);
    return puzzle;
  }

  const size = sizeForLevel(levelIndex);
  const existingRegions = getRecentStoredRegionsJson(size, DEDUP_WINDOW);
  const puzzle =
    size >= SLOW_GENERATION_SIZE
      ? { id: `level-${levelIndex}`, ...(await generateInWorker(levelIndex, [...existingRegions])) }
      : generatePuzzleForLevel(levelIndex, (regions) => existingRegions.has(JSON.stringify(regions)));
  storeLevel(levelIndex, puzzle.size, JSON.stringify(puzzle.regions));
  schedulePregeneration(levelIndex);
  return puzzle;
}

export async function getPuzzle(id: string): Promise<PuzzleDefinition | undefined> {
  const level = levelNumberFromId(id);
  if (level === null) return undefined;
  return getLevel(level);
}
