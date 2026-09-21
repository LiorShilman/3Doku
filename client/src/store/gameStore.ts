import { create } from 'zustand';
import {
  getBoardEliminatedCells,
  isSolved,
  validatePlacement,
  findForcedHint,
  findFullyEliminatedRegion,
  isDeadlocked,
  solveFrom,
  type Hint,
  type Position,
  type PuzzleDefinition,
} from '@3doku/shared';
import { fetchLevel, fetchPokemonCollection, reportPokemonCatch, reportPokemonUncatch } from '../api';
import { pickPokemonForCell, type PokedexEntry } from '../pokemon/pokedex';

function key(p: Position) {
  return `${p.row},${p.col}`;
}

export type ViewMode = '3d' | '2d';
const VIEW_MODE_KEY = '3doku:viewMode';

function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
}

function saveViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // best-effort only
  }
}

interface PersistedBoardState {
  placements: Position[];
  manualMarks: string[];
  mistakes: number;
  hintsUsed: number;
  startedAt: number;
  /** Wall-clock time of the last actual interaction (see the subscribe call below) - lets a restore tell "closed the app" apart from "still here", see initialBoardState. */
  lastActiveAt: number;
  /** cellKey -> pokedex_number, the Pokemon randomly assigned to each placed piece (see attemptPlace) - restored as-is, never re-rolled. */
  placementSprites: Record<string, number>;
}

function localBoardKey(puzzleId: string): string {
  return `3doku:board:${puzzleId}`;
}

// Wrapped in try/catch throughout - localStorage can throw (private browsing,
// blocked site data, storage full), and losing the in-progress board on
// refresh is a much smaller problem than crashing the app over it.
function saveLocalBoardState(puzzleId: string, state: PersistedBoardState) {
  try {
    localStorage.setItem(localBoardKey(puzzleId), JSON.stringify(state));
  } catch {
    // best-effort only
  }
}

function loadLocalBoardState(puzzleId: string): PersistedBoardState | null {
  try {
    const raw = localStorage.getItem(localBoardKey(puzzleId));
    return raw ? (JSON.parse(raw) as PersistedBoardState) : null;
  } catch {
    return null;
  }
}

function clearLocalBoardState(puzzleId: string) {
  try {
    localStorage.removeItem(localBoardKey(puzzleId));
  } catch {
    // best-effort only
  }
}

/**
 * Every level's saved board is keyed independently (localBoardKey), so
 * revisiting any specific level - not just the current one - already
 * resumes its own placements/marks/clock correctly. "New Game" needs to
 * clear ALL of them, not just level 1's: without this, a fresh playthrough
 * that later reaches a level number the player had touched in some earlier
 * playthrough would resurface that old, unrelated saved board and clock
 * instead of actually starting it fresh.
 */
function clearAllLocalBoardStates() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('3doku:board:')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // best-effort only
  }
}

interface GameState {
  levelIndex: number;
  puzzle: PuzzleDefinition | null;
  loading: boolean;
  /** Set when loadLevel's fetch fails (network/server issue) - otherwise the app was showing an infinite "loading level" spinner with no way out. */
  loadError: string | null;
  placements: Position[];
  eliminated: Set<string>;
  manualMarks: Set<string>;
  conflictFlash: Set<string>;
  /** cellKey -> pokedex_number for each placed piece - see attemptPlace and the Pokemon collection feature. */
  placementSprites: Record<string, number>;
  /** Every pokedex_number the player has ever caught (loaded once at app start) - lets attemptPlace tell a genuinely new species apart from a duplicate. */
  ownedPokedex: Set<number>;
  /** Set for a few seconds right after catching a species for the first time ever - see the celebration banner in App.tsx. */
  newPokemonCaught: PokedexEntry | null;
  assistMode: boolean;
  viewMode: ViewMode;
  solved: boolean;
  startedAt: number;
  solvedAtMs: number | null;
  mistakes: number;
  hint: Hint | null;
  hintsUsed: number;
  isMarkDragging: boolean;
  deadlockedRegion: number | null;
  isDeadlocked: boolean;
  paused: boolean;
  pausedAt: number | null;
  /** Pixel Y (from the viewport top) where the 3D board's front edge currently
   * projects to on screen - the 3D scene is a full-screen canvas with no DOM
   * layout box of its own, so anything in the surrounding HUD that needs to
   * visually anchor to the board (the new-Pokemon banner) has to get this
   * from the scene's camera projection rather than CSS. Null in 2D view. */
  boardBottomScreenY: number | null;
  setMarkDragging: (dragging: boolean) => void;
  setBoardBottomScreenY: (y: number | null) => void;
  toggleAssistMode: () => void;
  toggleViewMode: () => void;
  setMark: (pos: Position, marked: boolean) => void;
  attemptPlace: (pos: Position) => void;
  removePiece: (pos: Position) => void;
  undoLastPlacement: () => void;
  resolveDeadlock: () => void;
  requestHint: () => void;
  clearHint: () => void;
  resetPuzzle: () => void;
  nextLevel: () => Promise<void>;
  loadLevel: (levelIndex: number) => Promise<void>;
  startNewGame: () => Promise<void>;
  pauseGame: () => void;
  resumeGame: () => void;
  loadOwnedPokedex: () => Promise<void>;
  clearNewPokemonBanner: () => void;
}

const MISTAKE_PENALTY = 100;
const HINT_PENALTY = 50;
const TIME_PENALTY_PER_SEC = 2;
const BASE_SCORE = 1000;

/** Score drops with every wrong placement, every hint used, and with time spent, floored at 0. */
export function computeScore(mistakes: number, hintsUsed: number, elapsedMs: number): number {
  const timePenalty = Math.floor(elapsedMs / 1000) * TIME_PENALTY_PER_SEC;
  return Math.max(0, BASE_SCORE - mistakes * MISTAKE_PENALTY - hintsUsed * HINT_PENALTY - timePenalty);
}

let flashTimeout: ReturnType<typeof setTimeout> | undefined;
let newPokemonBannerTimeout: ReturnType<typeof setTimeout> | undefined;

/** Computed after every placement/removal - see isDeadlocked's own doc for why this needs a real solver, not just "is any region fully eliminated". */
function deadlockStatus(puzzle: PuzzleDefinition, placements: Position[]) {
  if (!isDeadlocked(puzzle, placements)) return { isDeadlocked: false, deadlockedRegion: null };
  return { isDeadlocked: true, deadlockedRegion: findFullyEliminatedRegion(puzzle, placements) };
}

function freshBoardState(puzzle: PuzzleDefinition) {
  return {
    puzzle,
    loading: false,
    placements: [],
    // Not just an empty set - locked-candidate propagation (see
    // getBoardEliminatedCells) can eliminate cells from the board's layout
    // alone, before a single piece is placed. Skipping this on a fresh level
    // meant Auto-X showed nothing at all until the first placement, even on
    // boards where the very first move was already logically deducible.
    eliminated: new Set(getBoardEliminatedCells(puzzle, []).map(key)),
    manualMarks: new Set<string>(),
    conflictFlash: new Set<string>(),
    placementSprites: {} as Record<string, number>,
    solved: false,
    startedAt: Date.now(),
    solvedAtMs: null,
    mistakes: 0,
    hint: null,
    hintsUsed: 0,
    isDeadlocked: false,
    deadlockedRegion: null,
    paused: false,
    pausedAt: null,
  };
}

/**
 * A page refresh used to always drop back to an empty board for the current
 * level - the server only remembers *which* level you're on (progress.level_index),
 * never the placements within it. Restores from localStorage when a
 * still-unsolved board for this exact puzzle was saved (see the subscribe
 * call below, which keeps that save up to date on every relevant change).
 */
function initialBoardState(puzzle: PuzzleDefinition) {
  const saved = loadLocalBoardState(puzzle.id);
  if (!saved) return freshBoardState(puzzle);

  // A solved board's saved entry is cleared the moment it's solved (see the
  // subscribe call below) - this recomputes it anyway rather than trusting
  // that always won the race against the page closing.
  const nowSolved = isSolved(puzzle, saved.placements);

  // Real time between the last recorded interaction and right now (loading
  // this level again, possibly after closing the app entirely) isn't time
  // the player spent solving - closing the tab for a week and coming back
  // shouldn't add a week to the clock any more than it should while the tab
  // stays open (see pauseGame/resumeGame, the same idea for backgrounding
  // without a reload). Shifting startedAt forward by that gap excludes it
  // the same way resumeGame does.
  const inactiveGap = saved.lastActiveAt ? Math.max(0, Date.now() - saved.lastActiveAt) : 0;
  const startedAt = saved.startedAt + inactiveGap;

  const fresh = freshBoardState(puzzle);
  return {
    ...fresh,
    placements: saved.placements,
    eliminated: new Set(getBoardEliminatedCells(puzzle, saved.placements).map(key)),
    manualMarks: new Set(saved.manualMarks),
    placementSprites: saved.placementSprites ?? {},
    mistakes: saved.mistakes,
    hintsUsed: saved.hintsUsed,
    startedAt,
    solved: nowSolved,
    solvedAtMs: nowSolved ? Date.now() - startedAt : null,
    ...(nowSolved ? { isDeadlocked: false, deadlockedRegion: null } : deadlockStatus(puzzle, saved.placements)),
  };
}

export const useGameStore = create<GameState>((set, get) => ({
  levelIndex: 0,
  puzzle: null,
  loading: true,
  loadError: null,
  placements: [],
  eliminated: new Set<string>(),
  manualMarks: new Set<string>(),
  conflictFlash: new Set<string>(),
  placementSprites: {},
  ownedPokedex: new Set<number>(),
  newPokemonCaught: null,
  solved: false,
  startedAt: Date.now(),
  solvedAtMs: null,
  mistakes: 0,
  hint: null,
  hintsUsed: 0,
  isDeadlocked: false,
  deadlockedRegion: null,
  paused: false,
  pausedAt: null,
  assistMode: true,
  viewMode: loadViewMode(),
  isMarkDragging: false,
  boardBottomScreenY: null,

  setMarkDragging: (dragging) => set({ isMarkDragging: dragging }),
  setBoardBottomScreenY: (y) => set({ boardBottomScreenY: y }),

  toggleAssistMode: () => set((s) => ({ assistMode: !s.assistMode })),

  toggleViewMode: () =>
    set((s) => {
      const next: ViewMode = s.viewMode === '3d' ? '2d' : '3d';
      saveViewMode(next);
      return { viewMode: next };
    }),

  // A tap is a drag of length one: pointer-down decides mark/unmark from the cell's
  // current state, then dragging across further cells (original game's gesture)
  // applies that same mode to each - idempotent per cell so re-entering one twice
  // in a drag doesn't flicker it back and forth. Never places a piece.
  setMark: (pos, marked) => {
    const { placements, solved, assistMode, eliminated, manualMarks } = get();
    if (solved) return;
    const k = key(pos);

    if (placements.some((p) => p.row === pos.row && p.col === pos.col)) return; // has a piece, ignore
    if (assistMode && eliminated.has(k)) return; // pre-eliminated cell, ignore
    if (manualMarks.has(k) === marked) return; // already in that state

    const next = new Set(manualMarks);
    if (marked) next.add(k);
    else next.delete(k);
    set({ manualMarks: next });
  },

  // double click: the only gesture that places (or fails to place) a piece
  attemptPlace: (pos) => {
    const { puzzle, placements, solved, assistMode, eliminated, manualMarks } = get();
    if (solved || !puzzle) return;
    const k = key(pos);

    if (placements.some((p) => p.row === pos.row && p.col === pos.col)) return; // already occupied
    if (assistMode && eliminated.has(k)) return; // pre-eliminated cell, ignore

    const { valid, conflicts } = validatePlacement(puzzle, placements, pos);
    if (!valid) {
      const flashed = new Set([k, ...conflicts.map((c) => key(c.with))]);
      set((s) => ({
        conflictFlash: flashed,
        manualMarks: new Set([...manualMarks].filter((m) => m !== k)),
        mistakes: s.mistakes + 1,
      }));
      clearTimeout(flashTimeout);
      flashTimeout = setTimeout(() => set({ conflictFlash: new Set() }), 450);
      return;
    }

    const next = [...placements, pos];
    const nowSolved = isSolved(puzzle, next);
    const remainingMarks = new Set([...manualMarks].filter((m) => m !== k));

    // Which Pokemon shows up is purely cosmetic (a collectible, not a game
    // mechanic) - deterministic per (puzzle, cell), not re-rolled per
    // placement, so undoing and re-placing at the same cell always shows the
    // same creature instead of fishing for a new random one each time.
    const caught = pickPokemonForCell(puzzle.id, pos.row, pos.col);
    const nextSprites = { ...get().placementSprites, [k]: caught.pokedex_number };
    reportPokemonCatch(caught.pokedex_number).catch(() => {});

    const ownedPokedex = get().ownedPokedex;
    const isNewSpecies = !ownedPokedex.has(caught.pokedex_number);
    if (isNewSpecies) {
      const nextOwned = new Set(ownedPokedex);
      nextOwned.add(caught.pokedex_number);
      clearTimeout(newPokemonBannerTimeout);
      newPokemonBannerTimeout = setTimeout(() => set({ newPokemonCaught: null }), 4000);
      set({ ownedPokedex: nextOwned, newPokemonCaught: caught });
    }

    set({
      placements: next,
      manualMarks: remainingMarks,
      placementSprites: nextSprites,
      eliminated: new Set(getBoardEliminatedCells(puzzle, next).map(key)),
      solved: nowSolved,
      solvedAtMs: nowSolved ? Date.now() - get().startedAt : null,
      hint: null,
      ...(nowSolved ? { isDeadlocked: false, deadlockedRegion: null } : deadlockStatus(puzzle, next)),
    });
  },

  // clicking a placed piece removes it
  removePiece: (pos: Position) => {
    const { puzzle, placements, placementSprites } = get();
    if (!puzzle) return;
    const next = placements.filter((p) => !(p.row === pos.row && p.col === pos.col));
    if (next.length === placements.length) return;
    const nextSprites = { ...placementSprites };
    delete nextSprites[key(pos)];
    set({
      placements: next,
      placementSprites: nextSprites,
      eliminated: new Set(getBoardEliminatedCells(puzzle, next).map(key)),
      hint: null,
      ...deadlockStatus(puzzle, next),
    });
  },

  // A dedicated Undo button, distinct from resolveDeadlock below - this is a
  // free, no-penalty step back (same result as clicking the last-placed piece
  // to remove it, just without needing to find and click that exact cell),
  // not a "that placement was a mistake" correction.
  undoLastPlacement: () => {
    const { placements } = get();
    if (placements.length === 0) return;
    get().removePiece(placements[placements.length - 1]);
  },

  // the quickest way out of a deadlock: the blocking piece was a real mistake, even
  // though it didn't conflict with anything directly - treat it like one (counts against
  // the score same as an invalid placement) and leave an X behind instead of an empty cell,
  // so the player doesn't try the same wrong spot again.
  resolveDeadlock: () => {
    const { puzzle, placements, manualMarks, placementSprites } = get();
    if (!puzzle || placements.length === 0) return;
    const last = placements[placements.length - 1];
    const k = key(last);
    const next = placements.slice(0, -1);
    const nextMarks = new Set(manualMarks);
    nextMarks.add(k);
    const nextSprites = { ...placementSprites };
    delete nextSprites[k];

    // This placement is a genuine mistake (see the comment above), not a
    // free undo - it should never have counted as a real catch. Revoke it
    // server-side and resync ownedPokedex so a real future catch of this
    // species can still trigger the "new!" banner if this was its only one.
    const revokedPokedexNumber = placementSprites[k];
    if (revokedPokedexNumber !== undefined) {
      reportPokemonUncatch(revokedPokedexNumber)
        .then(() => get().loadOwnedPokedex())
        .catch(() => {});
    }

    set((s) => ({
      placements: next,
      manualMarks: nextMarks,
      placementSprites: nextSprites,
      eliminated: new Set(getBoardEliminatedCells(puzzle, next).map(key)),
      mistakes: s.mistakes + 1,
      hint: null,
      ...deadlockStatus(puzzle, next),
    }));
  },

  requestHint: () => {
    const { puzzle, placements, solved, manualMarks } = get();
    if (!puzzle || solved) return;

    const forced = findForcedHint(puzzle, placements, manualMarks);
    if (forced) {
      set((s) => ({ hint: forced, hintsUsed: s.hintsUsed + 1 }));
      return;
    }

    const solution = solveFrom(puzzle, placements);
    if (!solution) return; // current placements can't be completed - no hint to give
    const placedKeys = new Set(placements.map(key));
    const nextCell = solution.find((p) => !placedKeys.has(key(p)));
    if (!nextCell) return;
    set((s) => ({
      hint: { kind: 'place', pos: nextCell, reason: 'solution', groupIndex: -1, groupCells: [nextCell] },
      hintsUsed: s.hintsUsed + 1,
    }));
  },

  clearHint: () => set({ hint: null }),

  resetPuzzle: () =>
    set((s) => {
      if (!s.puzzle) return s;
      return freshBoardState(s.puzzle);
    }),

  nextLevel: async () => {
    await get().loadLevel(get().levelIndex + 1);
  },

  // Puzzles are generated once server-side and persisted (see server/src/puzzles.ts) -
  // the client always fetches, never generates locally, so every player is guaranteed
  // the exact same board for a given level and it can never drift from an algorithm change.
  loadLevel: async (levelIndex) => {
    set({ loading: true, loadError: null, puzzle: null });
    try {
      const puzzle = await fetchLevel(levelIndex + 1);
      set({ levelIndex, loadError: null, ...initialBoardState(puzzle) });
    } catch (err) {
      // Otherwise a failed fetch (network blip, server hiccup, an expired
      // session the server rejects) left the player staring at "loading
      // level..." forever, with no error and no way to retry.
      set({ loading: false, loadError: err instanceof Error ? err.message : 'שגיאה בטעינת השלב' });
    }
  },

  // "New Game" from the home screen: unlike loadLevel(0), which would resume
  // whatever was last saved for level 1 if the player happens to have visited
  // it before, this explicitly wipes that saved board first so it's a genuinely
  // fresh start - the whole point of the button.
  startNewGame: async () => {
    clearAllLocalBoardStates();
    await get().loadLevel(0);
  },

  // Leaving to the home screen mid-game shouldn't burn the player's score on
  // time they spent away - stops the clock (see resumeGame for how it picks
  // back up without just counting the paused interval as elapsed time).
  pauseGame: () => {
    const { puzzle, solved, paused } = get();
    if (!puzzle || solved || paused) return;
    set({ paused: true, pausedAt: Date.now() });
  },

  resumeGame: () => {
    const { paused, pausedAt, startedAt } = get();
    if (!paused || pausedAt === null) return;
    const pausedDuration = Date.now() - pausedAt;
    set({ paused: false, pausedAt: null, startedAt: startedAt + pausedDuration });
  },

  // Called once at app start (see App.tsx) so attemptPlace can tell a brand
  // new species apart from a duplicate the moment it's placed, without a
  // round trip to the server on every single placement.
  loadOwnedPokedex: async () => {
    const collection = await fetchPokemonCollection().catch(() => []);
    set({ ownedPokedex: new Set(collection.map((c) => c.pokedex_number)) });
  },

  clearNewPokemonBanner: () => set({ newPokemonCaught: null }),
}));

// Keeps the current level's board saved to localStorage so a refresh (or
// closing and reopening the tab) resumes exactly where it left off, instead
// of dropping back to an empty board - see initialBoardState for the restore
// side. Fires on every store change; cheap enough for a small per-level JSON
// blob and simpler than threading a save call through every action that
// touches placements/marks/mistakes/hints.
useGameStore.subscribe((state) => {
  if (!state.puzzle) return;
  if (state.solved) {
    clearLocalBoardState(state.puzzle.id);
    return;
  }
  saveLocalBoardState(state.puzzle.id, {
    placements: state.placements,
    manualMarks: Array.from(state.manualMarks),
    mistakes: state.mistakes,
    hintsUsed: state.hintsUsed,
    startedAt: state.startedAt,
    lastActiveAt: Date.now(),
    placementSprites: state.placementSprites,
  });
});
