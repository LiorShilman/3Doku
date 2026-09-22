import type { Position, PuzzleDefinition } from '@3doku/shared';
import { getSocket } from './socket';

interface StoredPlayer {
  userId: number;
  displayName: string;
  finished: boolean;
  timeMs: number | null;
}

export interface StoredRaceSession {
  code: string;
  puzzle: PuzzleDefinition;
  startedAt: number;
  players: StoredPlayer[];
  hostUserId: number;
  placements: Position[];
  manualMarks: string[];
  mistakes: number;
  myFinishTimeMs: number | null;
}

const KEY = '3doku:activeRace';

// A race in progress isn't tied to being on the race screen - navigating to
// the home menu (unlike starting a new/continued single-player game, which
// explicitly abandons it) should let you come straight back into the same
// room. The server already keeps the room and socket membership alive; this
// is just the player's own local board state, which the server never sees
// except at race:progress/race:finish checkpoints.
export function saveRaceSession(session: StoredRaceSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // best-effort - a lost snapshot just means falling back to a fresh resync
  }
}

export function loadRaceSession(): StoredRaceSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredRaceSession) : null;
  } catch {
    return null;
  }
}

export function clearRaceSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

// Starting or continuing a single-player game is the one thing that
// explicitly gives up a race in progress (see raceSession's own doc above) -
// releases the seat server-side and drops the local snapshot for good.
export function abandonActiveRace(): void {
  const saved = loadRaceSession();
  if (!saved) return;
  getSocket().emit('race:leave', { code: saved.code });
  clearRaceSession();
}
