// Board generation at 10x10 (levels 500+, see @3doku/shared's sizeForLevel)
// is expensive and wildly variable - a real benchmark across levels 500-509
// ranged from 162ms to 62 SECONDS per level, because the repair-based
// uniqueness algorithm sometimes needs several random restarts at this size.
// A few things follow from that:
//   1. It has to run in a worker thread (generationWorker.ts), never on the
//      main thread, or the whole server freezes for everyone for up to a
//      minute at a time.
//   2. A player's own HTTP request can never be left open for that long
//      either - this hit production: the worker finished the level just
//      fine, but the player's phone had already dropped the long-idle
//      connection (mobile networks/NAT routinely kill one well under 60s)
//      and showed "can't load the level, try again". See puzzles.ts and
//      routes/levels.ts, which respond 202 immediately and let the client
//      poll in short requests instead of holding one open.
//   3. Waiting for it on-demand at all, even via polling, still means
//      whoever is first to reach a new 10x10 level sits through up to a
//      minute of polling - so this module also proactively generates the
//      next several 10x10 levels in the background, well before anyone
//      actually reaches them, so the normal on-demand path almost always
//      just finds the level already sitting in the DB.
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sizeForLevel } from '@3doku/shared';
import { getStoredLevel, storeLevel, getRecentStoredRegionsJson } from './db.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(dirname, 'generationWorker.js');

// Matches puzzles.ts's own DEDUP_WINDOW - how many of the most recent
// same-size levels a new one must differ from.
const DEDUP_WINDOW = 40;

const PREGENERATE_FROM_LEVEL = 500;
const PREGENERATE_LOOKAHEAD = 10;

interface GeneratedPuzzle {
  size: number;
  regions: number[][];
}

function generateInWorker(levelIndex: number, excludeRegionsJson: string[]): Promise<GeneratedPuzzle> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { levelIndex, excludeRegionsJson } });
    worker.once('message', (msg: GeneratedPuzzle) => {
      resolve(msg);
      worker.terminate();
    });
    worker.once('error', (err) => {
      reject(err);
      worker.terminate();
    });
  });
}

// Tracks levels a worker is currently generating, keyed by level index - a
// second caller for the same not-yet-stored level (a player's own on-demand
// poll racing the background lookahead pass, say) joins this same promise
// instead of spawning a redundant second worker for the identical level.
const inFlight = new Map<number, Promise<void>>();

function ensureGenerating(levelIndex: number): Promise<void> {
  const existing = inFlight.get(levelIndex);
  if (existing) return existing;
  const exclude = [...getRecentStoredRegionsJson(sizeForLevel(levelIndex), DEDUP_WINDOW)];
  const task = generateInWorker(levelIndex, exclude)
    .then((puzzle) => {
      storeLevel(levelIndex, puzzle.size, JSON.stringify(puzzle.regions));
    })
    .finally(() => inFlight.delete(levelIndex));
  inFlight.set(levelIndex, task);
  return task;
}

/**
 * Called from puzzles.ts the moment an on-demand request hits a
 * not-yet-stored slow (10x10+) level - fire-and-forget, since the caller
 * responds 202 right away and the client polls rather than waiting here.
 */
export function kickOffGeneration(levelIndex: number): void {
  ensureGenerating(levelIndex).catch((err) => console.error(`generation failed for level ${levelIndex}:`, err));
}

// Only one background lookahead pass runs at a time - if a second request
// for a level >= 500 comes in while one is already filling the buffer,
// there's nothing useful for a second concurrent pass to do.
let running = false;

/**
 * Fire-and-forget: call this after resolving any request for a level
 * number >= 500 (see puzzles.ts). Fills in whichever of the next
 * PREGENERATE_LOOKAHEAD levels after `afterLevelIndex` aren't already
 * stored, one at a time (each one still joins kickOffGeneration's dedup
 * above, so it never duplicates a worker already busy with the same level).
 */
export function schedulePregeneration(afterLevelIndex: number): void {
  if (afterLevelIndex < PREGENERATE_FROM_LEVEL || running) return;
  running = true;

  (async () => {
    try {
      for (let i = 1; i <= PREGENERATE_LOOKAHEAD; i++) {
        const target = afterLevelIndex + i;
        if (getStoredLevel(target)) continue;
        await ensureGenerating(target);
      }
    } catch (err) {
      // Best-effort only - a failed background pass just means the normal
      // on-demand path in puzzles.ts kicks off generation (via its own
      // worker) the moment that level is actually requested.
      console.error('background level pre-generation failed:', err);
    } finally {
      running = false;
    }
  })();
}
