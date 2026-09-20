import type { Position, PuzzleDefinition, ValidationResult, PlacementConflict } from './types.js';

export type HintReason = 'row' | 'col' | 'region' | 'solution';

export interface PlaceHint {
  kind: 'place';
  pos: Position;
  reason: HintReason;
  /** The row/column/region index the hint's group falls under - lets the UI highlight it. */
  groupIndex: number;
  /** Every other cell in that same group, for highlighting the "why" alongside the target cell. */
  groupCells: Position[];
  /**
   * When the group only collapsed to one open cell because some other
   * region's remaining cells were confined to this row/column (locked-
   * candidate propagation - see applyLockedCandidates), the cells of that
   * confining region - so the UI can show the *actual* reasoning chain
   * instead of just "this row/column happens to have one open cell", which
   * isn't visible or verifiable from Auto-X alone since Auto-X only shows
   * direct elimination.
   */
  becauseCells?: Position[];
}

export interface EliminateHint {
  kind: 'eliminate';
  /** Cells the player can safely mark X right now - not a placement yet, just the next deducible fact. */
  eliminateCells: Position[];
  /** Which line collapses because of the confining region below. */
  reason: 'row' | 'col';
  groupIndex: number;
  /** The other color region whose confinement is *why* - the cells to highlight as the actual evidence. */
  confiningCells: Position[];
}

/**
 * A teaching-style hint prefers `eliminate` (mark X here, because...) over
 * `place` (put the piece here) whenever there's a deduction step the player
 * hasn't already made themselves - see findForcedHint's doc for why this is
 * one step at a time rather than jumping straight to a forced placement.
 */
export type Hint = PlaceHint | EliminateHint;

function isAdjacent(a: Position, b: Position): boolean {
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1;
}

function samePosition(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function regionOf(puzzle: PuzzleDefinition, pos: Position): number {
  return puzzle.regions[pos.row][pos.col];
}

/** Conflicts a new placement has against pieces already on the board. Empty = legal move. */
export function findConflicts(
  puzzle: PuzzleDefinition,
  existing: Position[],
  next: Position
): PlacementConflict[] {
  const conflicts: PlacementConflict[] = [];
  for (const p of existing) {
    if (samePosition(p, next)) continue;
    if (p.row === next.row) conflicts.push({ with: p, reason: 'row' });
    else if (p.col === next.col) conflicts.push({ with: p, reason: 'col' });
    else if (regionOf(puzzle, p) === regionOf(puzzle, next)) conflicts.push({ with: p, reason: 'region' });
    else if (isAdjacent(p, next)) conflicts.push({ with: p, reason: 'adjacent' });
  }
  return conflicts;
}

/**
 * Locked-candidate propagation: if a still-unplaced region's only remaining
 * open cells all sit in one row (or one column), that row/column's single
 * piece has to be this region's - so every other cell in that row/column can
 * be eliminated too, even though none of them directly touch a placed piece.
 * This is the same "pointing pair" reasoning a human solver uses in row/
 * column/region logic puzzles, and it's what makes some boards' very first
 * move deducible at all - simple direct elimination alone can leave every
 * row, column and region with more than one open cell even when the puzzle
 * has exactly one solution. Mutates `eliminated` in place and returns whether
 * anything new was found, so the caller can iterate to a fixpoint (one
 * region collapsing can be what makes the next one collapse).
 */
function applyLockedCandidates(
  puzzle: PuzzleDefinition,
  occupiedRegions: Set<number>,
  eliminated: Set<string>,
  confinedBy: Map<string, Position[]>
): boolean {
  const size = puzzle.size;
  const openByRegion = new Map<number, Position[]>();

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const region = puzzle.regions[row][col];
      if (occupiedRegions.has(region)) continue;
      const key = `${row},${col}`;
      if (eliminated.has(key)) continue;
      if (!openByRegion.has(region)) openByRegion.set(region, []);
      openByRegion.get(region)!.push({ row, col });
    }
  }

  let changed = false;
  for (const cells of openByRegion.values()) {
    const region = puzzle.regions[cells[0].row][cells[0].col];
    const rows = new Set(cells.map((c) => c.row));
    const cols = new Set(cells.map((c) => c.col));
    // `cells` is a snapshot of this region's open cells *right now* - the
    // actual evidence for the deduction. Stored per newly-eliminated cell so
    // findForcedHint can show it later, even if this region gets further
    // constrained by a later iteration (its open cells would otherwise no
    // longer look like a confinement at all by the time the fixpoint is
    // reached, since a region can keep shrinking after triggering this).
    if (rows.size === 1) {
      const row = cells[0].row;
      for (let col = 0; col < size; col++) {
        if (puzzle.regions[row][col] === region) continue;
        const key = `${row},${col}`;
        if (!eliminated.has(key)) {
          eliminated.add(key);
          confinedBy.set(key, cells);
          changed = true;
        }
      }
    }
    if (cols.size === 1) {
      const col = cells[0].col;
      for (let row = 0; row < size; row++) {
        if (puzzle.regions[row][col] === region) continue;
        const key = `${row},${col}`;
        if (!eliminated.has(key)) {
          eliminated.add(key);
          confinedBy.set(key, cells);
          changed = true;
        }
      }
    }
  }
  return changed;
}

/**
 * Every unoccupied cell that directly conflicts with an already-placed piece
 * (same row, column, region, or adjacent) - the Auto-X mask shown on the
 * board. Deliberately only direct elimination, not the deeper locked-
 * candidate reasoning findForcedHint uses: once the generator guarantees
 * every level has a logically findable opening move (see generate.ts),
 * Auto-X spelling that reasoning out in full would just hand the player the
 * harder deductions instead of letting them find those themselves - same
 * basic-only assist the original game gives.
 */
export function getBoardEliminatedCells(puzzle: PuzzleDefinition, placements: Position[]): Position[] {
  const placed = new Set(placements.map((p) => `${p.row},${p.col}`));
  const eliminated: Position[] = [];

  for (let row = 0; row < puzzle.size; row++) {
    for (let col = 0; col < puzzle.size; col++) {
      const key = `${row},${col}`;
      if (placed.has(key)) continue;
      const cell = { row, col };
      const region = puzzle.regions[row][col];
      const conflicts = placements.some(
        (p) => p.row === row || p.col === col || regionOf(puzzle, p) === region || isAdjacent(p, cell)
      );
      if (conflicts) eliminated.push(cell);
    }
  }
  return eliminated;
}

interface LogicalElimination {
  eliminated: Set<string>;
  /** cell key -> snapshot of the confining region's open cells at the moment this cell got eliminated (only set for cells locked-candidate propagation added, not direct conflicts). */
  confinedBy: Map<string, Position[]>;
}

/**
 * Direct elimination (getBoardEliminatedCells) plus locked-candidate
 * propagation, iterated to a fixpoint - the full extent of what's logically
 * deducible, used by findForcedHint (the hint button) and by the generator's
 * "does this level have a findable opening move" check. Not used for the
 * visible Auto-X mask - see getBoardEliminatedCells for why.
 */
function getLogicallyEliminatedCells(puzzle: PuzzleDefinition, placements: Position[]): LogicalElimination {
  const eliminated = new Set(getBoardEliminatedCells(puzzle, placements).map((p) => `${p.row},${p.col}`));
  const confinedBy = new Map<string, Position[]>();
  const occupiedRegions = new Set(placements.map((p) => regionOf(puzzle, p)));
  let iterations = 0;
  while (
    applyLockedCandidates(puzzle, occupiedRegions, eliminated, confinedBy) &&
    iterations < puzzle.size * puzzle.size
  ) {
    iterations++;
  }
  return { eliminated, confinedBy };
}

export function validatePlacement(
  puzzle: PuzzleDefinition,
  existing: Position[],
  next: Position
): ValidationResult {
  const conflicts = findConflicts(puzzle, existing, next);
  return { valid: conflicts.length === 0, conflicts };
}

/** True once every row, column and region has exactly one piece and none touch. */
export function isSolved(puzzle: PuzzleDefinition, placements: Position[]): boolean {
  if (placements.length !== puzzle.size) return false;

  const rows = new Set<number>();
  const cols = new Set<number>();
  const regions = new Set<number>();

  for (const p of placements) {
    rows.add(p.row);
    cols.add(p.col);
    regions.add(regionOf(puzzle, p));
  }
  if (rows.size !== puzzle.size || cols.size !== puzzle.size || regions.size !== puzzle.size) {
    return false;
  }

  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      if (isAdjacent(placements[i], placements[j])) return false;
    }
  }
  return true;
}

/**
 * Scans for a naked single (a row, column or region with exactly one open
 * cell left) using the given `isOpen` predicate, row/col/region order. Used
 * twice by findForcedHint - once against direct-only elimination (needs no
 * explanation, matches what Auto-X already shows), then again against the
 * locked-candidate-enhanced elimination (needs `explain` to say why).
 */
function scanForNakedSingle(
  puzzle: PuzzleDefinition,
  placements: Position[],
  isOpen: (pos: Position) => boolean,
  explain: (groupCells: Position[], target: Position) => Position[] | undefined
): PlaceHint | null {
  const size = puzzle.size;

  const occupiedRows = new Set(placements.map((p) => p.row));
  for (let row = 0; row < size; row++) {
    if (occupiedRows.has(row)) continue;
    const all = Array.from({ length: size }, (_, col) => ({ row, col }));
    const open = all.filter(isOpen);
    if (open.length === 1) {
      return {
        kind: 'place',
        pos: open[0],
        reason: 'row',
        groupIndex: row,
        groupCells: all,
        becauseCells: explain(all, open[0]),
      };
    }
  }

  const occupiedCols = new Set(placements.map((p) => p.col));
  for (let col = 0; col < size; col++) {
    if (occupiedCols.has(col)) continue;
    const all = Array.from({ length: size }, (_, row) => ({ row, col }));
    const open = all.filter(isOpen);
    if (open.length === 1) {
      return {
        kind: 'place',
        pos: open[0],
        reason: 'col',
        groupIndex: col,
        groupCells: all,
        becauseCells: explain(all, open[0]),
      };
    }
  }

  const occupiedRegions = new Set(placements.map((p) => regionOf(puzzle, p)));
  const regionCells = new Map<number, Position[]>();
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const region = puzzle.regions[row][col];
      if (occupiedRegions.has(region)) continue;
      if (!regionCells.has(region)) regionCells.set(region, []);
      regionCells.get(region)!.push({ row, col });
    }
  }
  for (const [region, cells] of regionCells) {
    const open = cells.filter(isOpen);
    if (open.length === 1) {
      return {
        kind: 'place',
        pos: open[0],
        reason: 'region',
        groupIndex: region,
        groupCells: cells,
        becauseCells: explain(cells, open[0]),
      };
    }
  }

  return null;
}

/**
 * True if a forced placement is *eventually* reachable by repeated naked-
 * single/locked-candidate deduction from `placements` alone (full fixpoint,
 * not step-by-step) - used only by the generator to guarantee every level
 * has a logically findable opening move (see generate.ts). Deliberately
 * separate from findForcedHint: that one surfaces the deduction one step at
 * a time for teaching (see its doc), which is a strictly weaker per-call
 * signal that a single call finding nothing new wouldn't correctly answer
 * "is this puzzle solvable at all by this technique" the way this does.
 */
export function hasForcedDeduction(puzzle: PuzzleDefinition, placements: Position[]): boolean {
  const placed = new Set(placements.map((p) => `${p.row},${p.col}`));
  const { eliminated } = getLogicallyEliminatedCells(puzzle, placements);
  const isOpen = (pos: Position) => !eliminated.has(`${pos.row},${pos.col}`) && !placed.has(`${pos.row},${pos.col}`);
  return scanForNakedSingle(puzzle, placements, isOpen, () => undefined) !== null;
}

/**
 * A teaching-style hint: prefers showing the next *deducible fact* - "you can
 * mark these X, because that other region has to go here" - over jumping
 * straight to "place the piece here", the same way a human solver works
 * through row/column/region elimination one step at a time rather than being
 * handed the answer. Only falls back to naming the actual placement once a
 * row, column or region has been narrowed down to exactly one open cell using
 * everything already known - so pressing hint repeatedly (marking each
 * suggested elimination as it's given) walks the same reasoning chain
 * findForcedHint used to jump straight through, one link at a time.
 *
 * `manualMarks` are folded in as "already known" facts on top of direct
 * elimination (Auto-X) - the player's own scratch marks, including ones made
 * by following an earlier `eliminate` hint, are what lets each hint build on
 * the last instead of re-deriving (and re-suggesting) the exact same first
 * step forever. They're never trusted blindly, though: a mark is only a
 * player's guess, not a rule-checked fact the way a placement is, so an
 * incorrect one could otherwise walk this chain toward a wrong conclusion.
 * Each mark is checked against the puzzle's own (unique) solution first, and
 * only counted if it's actually outside that solution.
 */
export function findForcedHint(
  puzzle: PuzzleDefinition,
  placements: Position[],
  manualMarks: Set<string> = new Set()
): Hint | null {
  const placed = new Set(placements.map((p) => `${p.row},${p.col}`));
  const direct = new Set(getBoardEliminatedCells(puzzle, placements).map((p) => `${p.row},${p.col}`));

  const solution = solveFrom(puzzle, placements);
  const solutionKeys = solution ? new Set(solution.map((p) => `${p.row},${p.col}`)) : null;
  const trustedMarks = solutionKeys ? [...manualMarks].filter((k) => !solutionKeys.has(k)) : [];
  const known = new Set([...direct, ...trustedMarks]);

  const isKnownOpen = (pos: Position) => !known.has(`${pos.row},${pos.col}`) && !placed.has(`${pos.row},${pos.col}`);
  const placeHint = scanForNakedSingle(puzzle, placements, isKnownOpen, () => undefined);
  if (placeHint) return placeHint;

  // One sweep of locked-candidate propagation on top of everything already
  // known (not a fixpoint - see the doc above for why stopping at the first
  // new fact, rather than cascading all the way to a placement, is the point).
  const occupiedRegions = new Set(placements.map((p) => regionOf(puzzle, p)));
  const oneStep = new Set(known);
  const confinedByOneStep = new Map<string, Position[]>();
  applyLockedCandidates(puzzle, occupiedRegions, oneStep, confinedByOneStep);

  const newCells: Position[] = [];
  for (const k of oneStep) {
    if (known.has(k)) continue;
    const [row, col] = k.split(',').map(Number);
    newCells.push({ row, col });
  }
  if (newCells.length === 0) return null;

  // Several regions can each newly lock onto a line in the same sweep -
  // picked deterministically (row-major) rather than arbitrarily by Set
  // iteration order, then grouped down to just the cells that share that
  // same confining region, in case more than one group appeared this sweep.
  newCells.sort((a, b) => a.row - b.row || a.col - b.col);
  const first = newCells[0];
  const confiningCells = confinedByOneStep.get(`${first.row},${first.col}`)!;
  const eliminateCells = newCells.filter(
    (c) => confinedByOneStep.get(`${c.row},${c.col}`) === confiningCells
  );
  // Row-vs-column has to come from the *confining region's* own shape, not
  // eliminateCells' - a region confined to a single column can still only
  // eliminate one other cell (everywhere else in that column already being
  // taken), and that one cell trivially "spans one row" too, which read as a
  // row confinement rather than the column one that's actually happening.
  const confiningRows = new Set(confiningCells.map((c) => c.row));
  const reason: 'row' | 'col' = confiningRows.size === 1 ? 'row' : 'col';
  const groupIndex = reason === 'row' ? confiningCells[0].row : confiningCells[0].col;

  return { kind: 'eliminate', eliminateCells, reason, groupIndex, confiningCells };
}

/**
 * A region with zero open cells left and no piece of its own yet - the most
 * common and explainable reason the board becomes unsolvable from here (see
 * isDeadlocked). Returns the region id, or null if no region is in that state
 * (the board can still be deadlocked for a subtler combinatorial reason even
 * when this returns null - isDeadlocked is the definitive check).
 */
export function findFullyEliminatedRegion(puzzle: PuzzleDefinition, placements: Position[]): number | null {
  const eliminated = new Set(getBoardEliminatedCells(puzzle, placements).map((p) => `${p.row},${p.col}`));
  const occupiedRegions = new Set(placements.map((p) => regionOf(puzzle, p)));
  const regionOpen = new Map<number, boolean>();

  for (let row = 0; row < puzzle.size; row++) {
    for (let col = 0; col < puzzle.size; col++) {
      const region = puzzle.regions[row][col];
      if (occupiedRegions.has(region)) continue;
      const isOpen = !eliminated.has(`${row},${col}`);
      if (isOpen) regionOpen.set(region, true);
      else if (!regionOpen.has(region)) regionOpen.set(region, false);
    }
  }
  for (const [region, hasOpenCell] of regionOpen) {
    if (!hasOpenCell) return region;
  }
  return null;
}

/**
 * Extends the current placements into a full solution by backtracking, row by
 * row, skipping rows that already have a piece. Since the puzzle has exactly
 * one full solution, this either recovers it or - if an earlier, technically
 * non-conflicting placement doesn't happen to lie on that one solution - finds
 * no completion at all and returns null.
 */
export function solveFrom(puzzle: PuzzleDefinition, placements: Position[]): Position[] | null {
  const size = puzzle.size;
  const usedCols = new Set(placements.map((p) => p.col));
  const usedRegions = new Set(placements.map((p) => regionOf(puzzle, p)));
  const placedRows = new Set(placements.map((p) => p.row));
  const result = [...placements];

  function backtrack(row: number): boolean {
    if (row === size) return true;
    if (placedRows.has(row)) return backtrack(row + 1);
    for (let col = 0; col < size; col++) {
      if (usedCols.has(col)) continue;
      const region = puzzle.regions[row][col];
      if (usedRegions.has(region)) continue;
      const pos = { row, col };
      if (result.some((p) => isAdjacent(p, pos))) continue;
      result.push(pos);
      usedCols.add(col);
      usedRegions.add(region);
      if (backtrack(row + 1)) return true;
      result.pop();
      usedCols.delete(col);
      usedRegions.delete(region);
    }
    return false;
  }

  return backtrack(0) ? result : null;
}

/**
 * True once the current placements can no longer be extended into the
 * puzzle's one solution - every individual placement was locally legal (no
 * row/col/region/adjacency conflict at the time), but their combination still
 * doesn't lie on the unique solution, so nothing can finish the board from
 * here. This can happen well before any single region is visibly wiped out by
 * Auto-X - findFullyEliminatedRegion catches the common, explainable case of
 * that, but this is the definitive check.
 */
export function isDeadlocked(puzzle: PuzzleDefinition, placements: Position[]): boolean {
  if (placements.length === 0) return false;
  return solveFrom(puzzle, placements) === null;
}
