import type { Position, PuzzleDefinition } from './types.js';
import { hasForcedDeduction } from './rules.js';

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A well-mixed 32-bit hash of the level number - the seed for that level's PRNG. */
function hashSeed(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

function isAdjacent(a: Position, b: Position): boolean {
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1;
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const MIN_SIZE = 5;
const MAX_SIZE = 9;
const LEVELS_PER_SIZE_STEP = 13;

/** Board size ramps 5->9 over the first ~53 levels (one step every 13 levels), then holds at 9 forever - matches the pacing of the reference game (9x9 by level 55) instead of maxing out by level 19. No 4x4 tutorial size - too trivial to be worth a level. */
export function sizeForLevel(level: number): number {
  const idx = Math.max(0, level - 1);
  return Math.min(MIN_SIZE + Math.floor(idx / LEVELS_PER_SIZE_STEP), MAX_SIZE);
}

function randomSolution(size: number, rand: () => number): Position[] | null {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const cols = [...Array(size).keys()];
    for (let i = cols.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    const placed = cols.map((col, row) => ({ row, col }));
    let ok = true;
    for (let i = 0; i < placed.length && ok; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (isAdjacent(placed[i], placed[j])) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return placed;
  }
  return null;
}

/**
 * Randomized flood fill, weighted so a candidate's chance of being picked is
 * 1/currentRegionSize^2 - smaller regions pull harder, without a hard cap.
 * Just the starting shape now - see repairToUniqueSolution for what actually
 * gets the board down to one solution. Benchmarked against round-robin
 * (perfectly even, but a poor starting point for the repair step - too
 * "regular" a shape) and a hard cap (still hit ~size*4 on occasion); this
 * keeps the largest region under roughly size*2 cells in practice.
 */
function growRegions(solution: Position[], size: number, rand: () => number): number[][] | null {
  const regions: number[][] = Array.from({ length: size }, () => Array(size).fill(-1));
  const candidates: Position[] = [];
  const regionOfCandidate: number[] = [];
  const regionSize = new Array(solution.length).fill(1);

  const pushNeighbors = (id: number, row: number, col: number) => {
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      if (regions[r][c] !== -1) continue;
      candidates.push({ row: r, col: c });
      regionOfCandidate.push(id);
    }
  };

  solution.forEach((seed, id) => {
    regions[seed.row][seed.col] = id;
  });
  solution.forEach((seed, id) => pushNeighbors(id, seed.row, seed.col));

  let claimed = size;
  while (claimed < size * size) {
    // drop stale candidates (claimed by another region since being queued)
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (regions[candidates[i].row][candidates[i].col] !== -1) {
        candidates.splice(i, 1);
        regionOfCandidate.splice(i, 1);
      }
    }
    if (candidates.length === 0) return null; // unreachable on a connected grid, but bail safely

    const weights = regionOfCandidate.map((id) => 1 / (regionSize[id] * regionSize[id]));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rand() * total;
    let chosenIdx = candidates.length - 1;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        chosenIdx = i;
        break;
      }
    }

    const { row, col } = candidates[chosenIdx];
    const id = regionOfCandidate[chosenIdx];
    candidates.splice(chosenIdx, 1);
    regionOfCandidate.splice(chosenIdx, 1);

    regions[row][col] = id;
    regionSize[id]++;
    claimed++;
    pushNeighbors(id, row, col);
  }
  return regions;
}

/** Every valid solution up to `limit`, via the same backtracking shape as solveFrom/isDeadlocked in rules.ts. */
function findSolutions(regions: number[][], size: number, limit: number): Position[][] {
  const solutions: Position[][] = [];
  function backtrack(row: number, placed: Position[], usedCols: Set<number>, usedRegions: Set<number>) {
    if (solutions.length >= limit) return;
    if (row === size) {
      solutions.push([...placed]);
      return;
    }
    for (let col = 0; col < size; col++) {
      if (usedCols.has(col)) continue;
      const region = regions[row][col];
      if (usedRegions.has(region)) continue;
      const pos = { row, col };
      if (placed.some((p) => isAdjacent(p, pos))) continue;
      placed.push(pos);
      usedCols.add(col);
      usedRegions.add(region);
      backtrack(row + 1, placed, usedCols, usedRegions);
      placed.pop();
      usedCols.delete(col);
      usedRegions.delete(region);
      if (solutions.length >= limit) return;
    }
  }
  backtrack(0, [], new Set(), new Set());
  return solutions;
}

function sameSolution(a: Position[], b: Position[]): boolean {
  const key = (p: Position) => `${p.row},${p.col}`;
  const bKeys = new Set(b.map(key));
  return a.length === b.length && a.every((p) => bKeys.has(key(p)));
}

/** True if removing `exclude` from region `regionId` leaves the rest of that region's cells still one connected piece (4-directional). */
function staysConnectedWithout(regions: number[][], size: number, regionId: number, exclude: Position): boolean {
  const cells: Position[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (regions[r][c] === regionId && !(r === exclude.row && c === exclude.col)) cells.push({ row: r, col: c });
    }
  }
  if (cells.length === 0) return false; // would delete the region entirely
  const seen = new Set([`${cells[0].row},${cells[0].col}`]);
  const queue = [cells[0]];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const r = cur.row + dr;
      const c = cur.col + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      if (regions[r][c] !== regionId) continue;
      if (r === exclude.row && c === exclude.col) continue;
      const key = `${r},${c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ row: r, col: c });
    }
  }
  return seen.size === cells.length;
}

const MAX_REPAIR_STEPS = 2000;

/**
 * The actual technique real puzzles of this family (LinkedIn Queens and
 * similar) use to reach a unique solution - not "grow randomly and hope",
 * but a targeted repair loop: ask the solver for a second, different
 * ("rival") solution; if one exists, it necessarily uses some cell that
 * isn't part of the planted solution, and moving that one cell into a
 * neighboring region breaks that specific rival (the region it moves into
 * is already claimed elsewhere in the rival's placements, so the rival now
 * double-books a region) while never touching the planted solution's own
 * cells, so the planted solution stays valid throughout. Repeat until the
 * solver finds no rival left. Mutates and returns `regions` in place; `null`
 * if a repair step gets stuck (a rival cell with no safe neighboring region
 * to move into without disconnecting its current one) - the caller retries
 * with a fresh random starting shape rather than fighting a bad one.
 *
 * This is what makes larger boards (8x8, 9x9) tractable at all: growing a
 * random partition and rejecting it outright on failure needs the arrangement
 * to be uniquely solvable *by luck*, which gets exponentially rarer as the
 * board grows (8x8 never once succeeded in testing, even given a full minute
 * per attempt). Repairing a candidate directly toward uniqueness sidesteps
 * that - the loop below converges in a handful of steps in practice, not
 * because 8x8 boards are secretly easy, but because "fix what's wrong" scales
 * completely differently than "regenerate randomly and hope".
 */
function repairToUniqueSolution(
  regions: number[][],
  size: number,
  planted: Position[],
  rand: () => number
): boolean {
  const plantedKeys = new Set(planted.map((p) => `${p.row},${p.col}`));

  for (let step = 0; step < MAX_REPAIR_STEPS; step++) {
    const solutions = findSolutions(regions, size, 2);
    if (solutions.length <= 1) return true; // unique (the planted one is always at least one valid solution)

    const rival = solutions.find((sol) => !sameSolution(sol, planted)) ?? solutions[1];
    const rivalOnlyCells = shuffle(
      rival.filter((p) => !plantedKeys.has(`${p.row},${p.col}`)),
      rand
    );

    let repaired = false;
    for (const cell of rivalOnlyCells) {
      const myRegion = regions[cell.row][cell.col];
      if (!staysConnectedWithout(regions, size, myRegion, cell)) continue;

      const neighborRegions = shuffle(
        Array.from(
          new Set(
            ([
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
            ] as const)
              .map(([dr, dc]) => ({ row: cell.row + dr, col: cell.col + dc }))
              .filter((p) => p.row >= 0 && p.row < size && p.col >= 0 && p.col < size)
              .map((p) => regions[p.row][p.col])
              .filter((r) => r !== myRegion)
          )
        ),
        rand
      );
      if (neighborRegions.length === 0) continue;

      regions[cell.row][cell.col] = neighborRegions[0];
      repaired = true;
      break;
    }
    if (!repaired) return false; // stuck - let the caller try a fresh starting shape
  }
  return false; // exhausted the repair budget - vanishingly unlikely, but bail cleanly
}

/**
 * A uniquely-solvable board isn't automatically one a player can actually
 * start solving - it can leave every row, column and region with more than
 * one open cell, meaning the very first move can only be found by guessing
 * (or the hint button), even though the puzzle rules guarantee that solution
 * is the only one that works. Checked with hasForcedDeduction (naked singles
 * plus locked-candidate propagation, run to a fixpoint - see rules.ts), so a
 * board that passes this is one a player can genuinely reason into from an
 * empty board.
 */
function hasLogicalOpeningMove(puzzle: PuzzleDefinition): boolean {
  return hasForcedDeduction(puzzle, []);
}

// The repair loop converges in a handful of steps per candidate almost
// always, so this outer count is really "how many different random starting
// shapes to try before giving up", not a per-level cost multiplier the way
// it was under the old reject-and-retry approach.
const MAX_GENERATION_ATTEMPTS = 20000;

const MAX_SEED_RESTARTS = 5;

/**
 * Deterministic per level: the same level number always produces the same
 * puzzle, so client and server independently generate identical boards
 * without transmitting puzzle data.
 *
 * One PRNG per level, seeded via a hash of the level number, drawn from
 * continuously across every attempt (never re-seeded per attempt). An earlier
 * version instead did `mulberry32(level * STRIDE + attempt)` - fresh per
 * attempt - and `mulberry32` truncates its seed to 32 bits internally
 * (`seed |= 0`), so once `level * STRIDE + attempt` exceeded 2^32 for larger
 * level numbers, it silently wrapped and let two different (level, attempt)
 * pairs land on the exact same effective seed. Levels 9 and 10 came out
 * byte-for-byte identical in production from exactly this.
 *
 * Uniqueness itself is reached via repairToUniqueSolution (see its doc for
 * why that replaced plain reject-and-retry), not by getting lucky on a
 * random region shape - `isDuplicate`, when given, is still checked against
 * every already-issued level (the caller - see server/src/puzzles.ts - passes
 * one backed by everything already in its DB) since independent runs can
 * still converge on the same board by chance (levels 13 and 43 once did).
 *
 * Also requires a *logically deducible* opening move (hasLogicalOpeningMove,
 * above) on top of "unique solution exists" - a level should never leave a
 * player with no deducible first placement (see rules.ts's findForcedHint).
 */
export function generatePuzzleForLevel(level: number, isDuplicate?: (regions: number[][]) => boolean): PuzzleDefinition {
  const size = sizeForLevel(level);

  for (let restart = 0; restart < MAX_SEED_RESTARTS; restart++) {
    const rand = mulberry32(hashSeed(restart === 0 ? level : hashSeed(level) ^ hashSeed(restart)));
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      const solution = randomSolution(size, rand);
      if (!solution) continue;
      const regions = growRegions(solution, size, rand);
      if (!regions) continue;
      if (!repairToUniqueSolution(regions, size, solution, rand)) continue;
      const puzzle = { id: `level-${level}`, size, regions };
      if (!hasLogicalOpeningMove(puzzle)) continue;
      if (isDuplicate && isDuplicate(regions)) continue;
      return puzzle;
    }
  }
  throw new Error(`Could not generate a unique puzzle for level ${level}`);
}

export function levelNumberFromId(id: string): number | null {
  const match = /^level-(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}
