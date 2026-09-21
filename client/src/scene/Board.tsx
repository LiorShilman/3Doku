import { Suspense, useEffect, useRef } from 'react';
import { RoundedBox } from '@react-three/drei';
import { useGameStore } from '../store/gameStore';
import { Cell } from './Cell';
import {
  Piece,
  EliminatedMark,
  HintTarget,
  HintGroupGlow,
  HintBecauseGlow,
  HintEliminateGlow,
  DeadlockGlow,
} from './Piece';
import { orbitControlsHandle } from './orbitControlsHandle';
import { getPokedexEntry, pokemonImageUrl } from '../pokemon/pokedex';

// Cell footprint (Cell.tsx's RoundedBox) is 0.94 wide - at the old 1.08
// spacing the gap between adjacent cells was only 0.14 units, thin enough
// that the dark grid lines separating cells nearly disappeared depending on
// viewing angle/distance, reading as one solid slab instead of a grid of
// separate tiles. Widened for a clearly visible gap; Scene.tsx's camera
// distance is compensated for this via SPACING_SCALE so framing doesn't
// shift because of it.
export const CELL_SPACING = 1.2;
// A real, deliberate double-click/tap - not the browser's own dblclick timing,
// which runs ~500ms on desktop and is inconsistent (and often more lenient) on
// touch devices, so two separate deliberate taps kept reading as one and
// placing a piece nobody asked for.
const DOUBLE_TAP_MS = 280;
// A tap's natural finger/mouse wobble shouldn't spill a mark onto a neighboring
// cell - only commit to painting further cells once the pointer has actually
// moved this many screen pixels from where the drag started. Touch jitter is
// bigger than mouse jitter, which is why this read as "too sensitive" on phone.
const DRAG_COMMIT_PX = 14;

function cellCenter(row: number, col: number, size: number): [number, number, number] {
  const offset = (size - 1) / 2;
  return [(col - offset) * CELL_SPACING, 0, (row - offset) * CELL_SPACING];
}

export function Board() {
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

  // Drag-to-mark (the original game's gesture): pointer-down on a cell decides
  // mark or unmark from that cell's current state, then dragging across more
  // cells while the pointer stays down paints the same mode over each one.
  // isMarkDragging (in the store) tells Scene to disable OrbitControls for the
  // duration, so dragging across cells doesn't also spin the camera.
  const dragModeRef = useRef<boolean | null>(null);
  const lastTapRef = useRef<{ key: string; time: number } | null>(null);
  const dragStartScreenRef = useRef<{ x: number; y: number } | null>(null);
  const dragCommittedRef = useRef(false);

  useEffect(() => {
    const endDrag = () => {
      dragModeRef.current = null;
      dragStartScreenRef.current = null;
      dragCommittedRef.current = false;
      // Imperative + synchronous - see orbitControlsHandle.ts for why the React
      // state update (setMarkDragging) alone isn't fast enough on its own.
      if (orbitControlsHandle.current) orbitControlsHandle.current.enabled = true;
      setMarkDragging(false);
    };
    window.addEventListener('pointerup', endDrag);
    return () => window.removeEventListener('pointerup', endDrag);
  }, [setMarkDragging]);

  if (!puzzle) return null;

  const size = puzzle.size;
  const platformSize = size * CELL_SPACING + 0.6;
  const placedKeys = new Set(placements.map((p) => `${p.row},${p.col}`));

  return (
    <group>
      {/* diorama base */}
      <RoundedBox args={[platformSize, 0.3, platformSize]} radius={0.08} position={[0, -0.28, 0]} receiveShadow>
        <meshStandardMaterial color="#15151f" roughness={0.85} metalness={0.05} />
      </RoundedBox>

      {Array.from({ length: size }).map((_, row) =>
        Array.from({ length: size }).map((_, col) => {
          const pos = cellCenter(row, col, size);
          const cellKey = `${row},${col}`;
          const isEliminated = assistMode && eliminated.has(cellKey);
          const isMarked = manualMarks.has(cellKey);
          const isInvalidAttempt = conflictFlash.has(cellKey) && !placedKeys.has(cellKey);
          const hasPiece = placedKeys.has(cellKey);
          return (
            <group key={cellKey}>
              <Cell
                position={pos}
                region={puzzle.regions[row][col]}
                onPointerDownCell={(e) => {
                  // Disable OrbitControls for the entire duration of any cell interaction
                  // (not just the marking branch below) - otherwise the tiny, unavoidable
                  // mouse/finger movement inside a click or a double-tap-to-place can still
                  // register as a camera drag on the same pointerdown->pointerup span.
                  // Imperative + synchronous (see orbitControlsHandle.ts) - going through
                  // setMarkDragging's React state alone lands too late: the browser can
                  // dispatch the pointermove that performs the rotation before React
                  // re-renders to actually flip OrbitControls' `enabled` prop.
                  if (orbitControlsHandle.current) orbitControlsHandle.current.enabled = false;
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
                onPointerEnterCell={(e) => {
                  if (dragModeRef.current === null || hasPiece) return;

                  if (!dragCommittedRef.current) {
                    const start = dragStartScreenRef.current;
                    const moved = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : Infinity;
                    if (moved < DRAG_COMMIT_PX) return; // still just tap jitter - ignore
                    dragCommittedRef.current = true;
                  }
                  setMark({ row, col }, dragModeRef.current);
                }}
              />
              {(isEliminated || isMarked || isInvalidAttempt) && (
                <EliminatedMark position={[pos[0], 0.13, pos[2]]} invalid={isInvalidAttempt} />
              )}
            </group>
          );
        })
      )}

      {deadlockedRegion !== null &&
        Array.from({ length: size }).map((_, row) =>
          Array.from({ length: size }).map((_, col) => {
            if (puzzle.regions[row][col] !== deadlockedRegion) return null;
            const pos = cellCenter(row, col, size);
            return <DeadlockGlow key={`deadlock-${row},${col}`} position={[pos[0], 0.12, pos[2]]} />;
          })
        )}

      {hint &&
        hint.kind === 'place' &&
        (() => {
          const targetPos = cellCenter(hint.pos.row, hint.pos.col, size);
          return (
            <>
              {hint.groupCells
                .filter((c) => !(c.row === hint.pos.row && c.col === hint.pos.col))
                .map((c) => {
                  const pos = cellCenter(c.row, c.col, size);
                  return <HintGroupGlow key={`hint-group-${c.row},${c.col}`} position={[pos[0], 0.12, pos[2]]} />;
                })}
              {hint.becauseCells?.map((c) => {
                const pos = cellCenter(c.row, c.col, size);
                return <HintBecauseGlow key={`hint-because-${c.row},${c.col}`} position={[pos[0], 0.13, pos[2]]} />;
              })}
              <HintTarget position={[targetPos[0], 0.14, targetPos[2]]} />
            </>
          );
        })()}

      {hint &&
        hint.kind === 'eliminate' &&
        (() => (
          <>
            {hint.eliminateCells.map((c) => {
              const pos = cellCenter(c.row, c.col, size);
              return <HintEliminateGlow key={`hint-eliminate-${c.row},${c.col}`} position={[pos[0], 0.13, pos[2]]} />;
            })}
            {hint.confiningCells.map((c) => {
              const pos = cellCenter(c.row, c.col, size);
              return <HintBecauseGlow key={`hint-because-${c.row},${c.col}`} position={[pos[0], 0.12, pos[2]]} />;
            })}
          </>
        ))()}

      {placements.map((p) => {
        const pos = cellCenter(p.row, p.col, size);
        const pokedexNumber = placementSprites[`${p.row},${p.col}`];
        const entry = pokedexNumber !== undefined ? getPokedexEntry(pokedexNumber) : undefined;
        return (
          // Suspense per-piece, not once around the whole board: useTexture
          // suspends while a sprite it hasn't loaded yet is fetching. With no
          // Suspense boundary anywhere, that bubbled all the way up and took
          // the ENTIRE Canvas down to a blank frame and back on every single
          // newly-seen Pokemon sprite - exactly the "black screen, board
          // redraws" symptom. Scoped here, only this one piece's mesh blips
          // out momentarily while its own image loads; the rest of the board
          // (and the piece's own glow-disc-free plane once loaded) is
          // unaffected.
          <Suspense key={`${p.row},${p.col}`} fallback={null}>
            <Piece
              position={[pos[0], 0.635, pos[2]]}
              conflict={conflictFlash.has(`${p.row},${p.col}`)}
              spriteUrl={entry ? pokemonImageUrl(entry) : undefined}
            />
          </Suspense>
        );
      })}
    </group>
  );
}
