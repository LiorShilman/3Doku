import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { colorForRegion } from '../scene/palette';
import { getPokedexEntry, pokemonImageUrl } from '../pokemon/pokedex';

// Same gesture rules as the 3D board (Board.tsx) - kept identical on purpose
// so switching view modes never changes how the game feels to play. See
// Board.tsx's DOUBLE_TAP_MS comment for why this was widened from 280.
const DOUBLE_TAP_MS = 400;
const DRAG_COMMIT_PX = 14;

export function Board2D() {
  const puzzle = useGameStore((s) => s.puzzle);
  const placements = useGameStore((s) => s.placements);
  const eliminated = useGameStore((s) => s.eliminated);
  const manualMarks = useGameStore((s) => s.manualMarks);
  const conflictFlash = useGameStore((s) => s.conflictFlash);
  const setMark = useGameStore((s) => s.setMark);
  const attemptPlace = useGameStore((s) => s.attemptPlace);
  const assistMode = useGameStore((s) => s.assistMode);
  const setMarkDragging = useGameStore((s) => s.setMarkDragging);
  const hint = useGameStore((s) => s.hint);
  const deadlockedRegion = useGameStore((s) => s.deadlockedRegion);
  const placementSprites = useGameStore((s) => s.placementSprites);

  const dragModeRef = useRef<boolean | null>(null);
  const lastTapRef = useRef<{ key: string; time: number } | null>(null);
  const dragStartScreenRef = useRef<{ x: number; y: number } | null>(null);
  const dragCommittedRef = useRef(false);
  const boardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const endDrag = () => {
      dragModeRef.current = null;
      dragStartScreenRef.current = null;
      dragCommittedRef.current = false;
      setMarkDragging(false);
    };
    window.addEventListener('pointerup', endDrag);
    return () => window.removeEventListener('pointerup', endDrag);
  }, [setMarkDragging]);

  // Same purpose as Scene.tsx's camera-projection version of this for 3D -
  // the "new Pokemon caught" banner needs the board's actual current bottom
  // edge to anchor below it, not a fixed distance from the screen edge. In
  // 2D the board is a real DOM element, so this is a direct measurement
  // instead of a 3D projection. Without it, a tall board (large size, or a
  // tall/narrow viewport) could have its own bottom rows sit right where the
  // fixed-position banner renders, silently swallowing clicks meant for
  // those cells - including, worst case, the winning placement itself,
  // which then read as the level "not advancing" for no visible reason.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => useGameStore.getState().setBoardBottomScreenY(el.getBoundingClientRect().bottom);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [puzzle?.id, puzzle?.size]);

  useEffect(() => () => useGameStore.getState().setBoardBottomScreenY(null), []);

  if (!puzzle) return null;

  const size = puzzle.size;
  const placedKeys = new Set(placements.map((p) => `${p.row},${p.col}`));
  const hintGroupKeys = new Set(
    hint?.kind === 'place'
      ? hint.groupCells.filter((c) => !(c.row === hint.pos.row && c.col === hint.pos.col)).map((c) => `${c.row},${c.col}`)
      : []
  );
  const hintBecauseKeys = new Set(
    hint?.kind === 'place'
      ? (hint.becauseCells ?? []).map((c) => `${c.row},${c.col}`)
      : hint?.kind === 'eliminate'
        ? hint.confiningCells.map((c) => `${c.row},${c.col}`)
        : []
  );
  const hintEliminateKeys = new Set(hint?.kind === 'eliminate' ? hint.eliminateCells.map((c) => `${c.row},${c.col}`) : []);

  return (
    <div className="board-2d-wrap">
      <div
        ref={boardRef}
        className="board-2d"
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, gridTemplateRows: `repeat(${size}, 1fr)` }}
      >
        {Array.from({ length: size }).map((_, row) =>
          Array.from({ length: size }).map((_, col) => {
            const cellKey = `${row},${col}`;
            const region = puzzle.regions[row][col];
            const hasPiece = placedKeys.has(cellKey);
            const pokedexNumber = placementSprites[cellKey];
            const spriteEntry = pokedexNumber !== undefined ? getPokedexEntry(pokedexNumber) : undefined;
            const isEliminated = assistMode && eliminated.has(cellKey);
            const isMarked = manualMarks.has(cellKey);
            const isInvalidAttempt = conflictFlash.has(cellKey) && !hasPiece;
            const isConflictPiece = conflictFlash.has(cellKey) && hasPiece;
            const isDeadlockRegion = deadlockedRegion !== null && region === deadlockedRegion;
            const isHintTarget = hint?.kind === 'place' && hint.pos.row === row && hint.pos.col === col;
            const isHintGroup = hintGroupKeys.has(cellKey);
            const isHintBecause = hintBecauseKeys.has(cellKey);
            const isHintEliminate = hintEliminateKeys.has(cellKey);
            const showX = isEliminated || isMarked || isInvalidAttempt;

            return (
              <div
                key={cellKey}
                className="board-2d-cell"
                style={{ backgroundColor: colorForRegion(region) }}
                onPointerDown={(e) => {
                  // Without this, the browser implicitly captures the pointer
                  // to whichever cell received pointerdown (especially on
                  // touch) - every pointerenter on other cells during the
                  // drag then silently never fires, so continuous drag-to-
                  // mark only ever affected the one cell the drag started on.
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  setMarkDragging(true);

                  // A validly-placed piece is locked in place - it can only be
                  // removed via the explicit Undo button or deadlock recovery,
                  // never by tapping it again.
                  if (hasPiece) return;

                  const now = performance.now();
                  const last = lastTapRef.current;
                  if (last && last.key === cellKey && now - last.time < DOUBLE_TAP_MS) {
                    lastTapRef.current = null;
                    attemptPlace({ row, col });
                    return;
                  }
                  lastTapRef.current = { key: cellKey, time: now };

                  const nextMode = !manualMarks.has(cellKey);
                  dragModeRef.current = nextMode;
                  dragStartScreenRef.current = { x: e.clientX, y: e.clientY };
                  dragCommittedRef.current = false;
                  setMark({ row, col }, nextMode);
                }}
                onPointerEnter={(e) => {
                  if (dragModeRef.current === null || hasPiece) return;

                  if (!dragCommittedRef.current) {
                    const start = dragStartScreenRef.current;
                    const moved = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : Infinity;
                    if (moved < DRAG_COMMIT_PX) return;
                    dragCommittedRef.current = true;
                  }
                  setMark({ row, col }, dragModeRef.current);
                }}
              >
                {isDeadlockRegion && <div className="board-2d-overlay board-2d-deadlock" />}
                {isHintGroup && <div className="board-2d-overlay board-2d-hint-group" />}
                {isHintBecause && <div className="board-2d-overlay board-2d-hint-because" />}
                {isHintEliminate && <div className="board-2d-overlay board-2d-hint-eliminate" />}
                {isHintTarget && <div className="board-2d-hint-ring" />}

                {showX && (
                  <div className={`board-2d-x ${isInvalidAttempt ? 'invalid' : ''}`}>
                    <span />
                    <span />
                  </div>
                )}

                {hasPiece && (
                  <div className="board-2d-piece">
                    <div
                      className="board-2d-piece-glow"
                      style={{ background: isConflictPiece ? '#ff3b5c' : colorForRegion(region) }}
                    />
                    <img
                      src={spriteEntry ? pokemonImageUrl(spriteEntry) : `${import.meta.env.BASE_URL}piece.png`}
                      alt=""
                      className={isConflictPiece ? 'board-2d-piece-img conflict' : 'board-2d-piece-img'}
                      draggable={false}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
