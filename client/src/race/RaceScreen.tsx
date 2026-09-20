import { useEffect, useRef, useState } from 'react';
import {
  getBoardEliminatedCells,
  isSolved,
  validatePlacement,
  type Position,
  type PuzzleDefinition,
} from '@3doku/shared';
import { colorForRegion } from '../scene/palette';
import { getRaceSocket } from './socket';
import { clearRaceSession, loadRaceSession, saveRaceSession } from './raceSession';
import { fetchRaceLeaderboard, type AuthUser, type RaceRankingRow } from '../api';

type Stage = 'lobby' | 'waiting' | 'countdown' | 'playing' | 'finished';

interface RacePlayerInfo {
  userId: number;
  displayName: string;
  finished: boolean;
  timeMs: number | null;
}

interface RaceScreenProps {
  user: AuthUser;
  onExit: () => void;
}

const DOUBLE_TAP_MS = 280;
const DRAG_COMMIT_PX = 14;
const MAX_RACE_PLAYERS = 4;

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}

export function RaceScreen({ user, onExit }: RaceScreenProps) {
  const [stage, setStage] = useState<Stage>('lobby');
  const [code, setCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [createSize, setCreateSize] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [puzzle, setPuzzle] = useState<PuzzleDefinition | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [countdownMs, setCountdownMs] = useState(0);
  const [players, setPlayers] = useState<RacePlayerInfo[]>([]);
  const [hostUserId, setHostUserId] = useState<number | null>(null);
  const [opponentProgress, setOpponentProgress] = useState<Record<string, number>>({});
  const [leftPlayerName, setLeftPlayerName] = useState<string | null>(null);
  const [raceRanking, setRaceRanking] = useState<RaceRankingRow[] | null>(null);
  const [raceRankingError, setRaceRankingError] = useState<string | null>(null);

  const [placements, setPlacements] = useState<Position[]>([]);
  const [eliminated, setEliminated] = useState<Set<string>>(new Set());
  const [manualMarks, setManualMarks] = useState<Set<string>>(new Set());
  const [conflictFlash, setConflictFlash] = useState<Set<string>>(new Set());
  const [myFinishTimeMs, setMyFinishTimeMs] = useState<number | null>(null);
  const [mistakes, setMistakes] = useState(0);

  const lastTapRef = useRef<{ key: string; time: number } | null>(null);
  const dragModeRef = useRef<boolean | null>(null);
  const dragStartScreenRef = useRef<{ x: number; y: number } | null>(null);
  const dragCommittedRef = useRef(false);
  const codeRef = useRef(code);
  codeRef.current = code;

  // Same drag-to-mark gesture as the single-player 2D board (Board2D.tsx) -
  // without this, the browser implicitly captures the pointer to whichever
  // cell received pointerdown, so a continuous drag across cells would only
  // ever affect the one cell the drag started on.
  useEffect(() => {
    const endDrag = () => {
      dragModeRef.current = null;
      dragStartScreenRef.current = null;
      dragCommittedRef.current = false;
    };
    window.addEventListener('pointerup', endDrag);
    return () => window.removeEventListener('pointerup', endDrag);
  }, []);

  useEffect(() => {
    fetchRaceLeaderboard()
      .then(setRaceRanking)
      .catch((err) => setRaceRankingError(err.message));
  }, []);

  // Coming back from the home menu (or a full page reload) mid-race - the
  // server kept the room alive (see race.ts's race:resync), so pick up where
  // this player's own board was left, then ask the server for the room's
  // current authoritative state in case something happened while away.
  useEffect(() => {
    const saved = loadRaceSession();
    if (!saved) return;
    const socket = getRaceSocket();
    socket.emit(
      'race:resync',
      { code: saved.code },
      (res:
        | {
            ok: true;
            puzzle: PuzzleDefinition;
            startedAt: number | null;
            status: 'waiting' | 'racing' | 'finished';
            players: RacePlayerInfo[];
            hostUserId: number;
          }
        | { error: string }) => {
        if ('error' in res) {
          clearRaceSession();
          return;
        }
        setCode(saved.code);
        setPuzzle(res.puzzle);
        setStartedAt(res.startedAt);
        setPlayers(res.players);
        setHostUserId(res.hostUserId);
        setPlacements(saved.placements);
        setManualMarks(new Set(saved.manualMarks));
        setMistakes(saved.mistakes);
        setMyFinishTimeMs(saved.myFinishTimeMs);
        setEliminated(new Set(getBoardEliminatedCells(res.puzzle, saved.placements).map((p) => `${p.row},${p.col}`)));
        if (res.status === 'finished') setStage('finished');
        else if (res.status === 'racing') setStage(res.startedAt !== null && res.startedAt > Date.now() ? 'countdown' : 'playing');
        else setStage('waiting');
      }
    );
  }, []);

  const setMark = (pos: Position, active: boolean) => {
    const k = `${pos.row},${pos.col}`;
    setManualMarks((prev) => {
      const next = new Set(prev);
      if (active) next.add(k);
      else next.delete(k);
      return next;
    });
  };

  useEffect(() => {
    const socket = getRaceSocket();

    const onRoster = (data: { players: RacePlayerInfo[]; hostUserId: number }) => {
      setPlayers(data.players);
      setHostUserId(data.hostUserId);
    };
    const onStart = (data: { puzzle: PuzzleDefinition; startedAt: number; players: RacePlayerInfo[] }) => {
      setPuzzle(data.puzzle);
      setStartedAt(data.startedAt);
      setPlayers(data.players);
      setPlacements([]);
      setEliminated(new Set());
      setManualMarks(new Set());
      setOpponentProgress({});
      setMyFinishTimeMs(null);
      setMistakes(0);
      setStage('countdown');
    };
    const onOpponentProgress = (data: { displayName: string; placedCount: number }) =>
      setOpponentProgress((prev) => ({ ...prev, [data.displayName]: data.placedCount }));
    const onPlayerFinished = (data: RacePlayerInfo & { place: number }) =>
      setPlayers((prev) => {
        const others = prev.filter((p) => p.displayName !== data.displayName);
        return [...others, { userId: data.userId, displayName: data.displayName, finished: true, timeMs: data.timeMs }];
      });
    const onComplete = (data: { players: RacePlayerInfo[] }) => {
      setPlayers(data.players);
      setStage('finished');
    };
    const onPlayerLeft = (data: { displayName?: string }) => {
      setLeftPlayerName(data.displayName ?? null);
      setStage('finished');
    };

    socket.on('race:roster', onRoster);
    socket.on('race:start', onStart);
    socket.on('race:opponentProgress', onOpponentProgress);
    socket.on('race:playerFinished', onPlayerFinished);
    socket.on('race:complete', onComplete);
    socket.on('race:playerLeft', onPlayerLeft);

    return () => {
      socket.off('race:roster', onRoster);
      socket.off('race:start', onStart);
      socket.off('race:opponentProgress', onOpponentProgress);
      socket.off('race:playerFinished', onPlayerFinished);
      socket.off('race:complete', onComplete);
      socket.off('race:playerLeft', onPlayerLeft);
    };
  }, []);

  // Countdown -> playing, once both clients agree startedAt has arrived.
  useEffect(() => {
    if (stage !== 'countdown' || startedAt === null) return;
    const tick = () => {
      const remaining = startedAt - Date.now();
      setCountdownMs(Math.max(0, remaining));
      if (remaining <= 0) setStage('playing');
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [stage, startedAt]);

  // Keep a resumable snapshot while a race is actually underway (or just
  // concluded) - see the resync effect above and raceSession.ts for why.
  useEffect(() => {
    if (!puzzle || startedAt === null) return;
    if (stage !== 'countdown' && stage !== 'playing' && stage !== 'finished') return;
    saveRaceSession({
      code,
      puzzle,
      startedAt,
      players,
      hostUserId: hostUserId ?? user.id,
      placements,
      manualMarks: Array.from(manualMarks),
      mistakes,
      myFinishTimeMs,
    });
  }, [stage, code, puzzle, startedAt, players, hostUserId, placements, manualMarks, mistakes, myFinishTimeMs, user.id]);

  const handleCreate = () => {
    setError(null);
    const socket = getRaceSocket();
    socket.emit('race:create', { size: createSize }, (res: { code: string } | { error: string }) => {
      if ('error' in res) return setError(res.error);
      setCode(res.code);
      setPlayers([{ userId: user.id, displayName: user.displayName, finished: false, timeMs: null }]);
      setHostUserId(user.id);
      setStage('waiting');
    });
  };

  const handleJoin = () => {
    setError(null);
    const trimmed = joinInput.trim().toUpperCase();
    if (!trimmed) return;
    const socket = getRaceSocket();
    socket.emit('race:join', { code: trimmed }, (res: { ok: true } | { error: string }) => {
      if ('error' in res) return setError(res.error);
      setCode(trimmed);
      setStage('waiting');
    });
  };

  const handleBegin = () => {
    setError(null);
    const socket = getRaceSocket();
    socket.emit('race:begin', { code }, (res: { ok: true } | { error: string }) => {
      if ('error' in res) setError(res.error);
    });
  };

  const handleExit = () => {
    const socket = getRaceSocket();
    if (code) socket.emit('race:leave', { code });
    clearRaceSession();
    onExit();
  };

  // Mid-race "menu" doesn't abandon the race - the room and socket stay
  // exactly as they are, and coming back to the race screen (or reloading)
  // resumes from the saved snapshot via the resync effect above. Only an
  // explicit leave (above) or starting a new/continued solo game gives up
  // the seat for real.
  const handleGoToMenu = () => onExit();

  const handleRematch = () => {
    setError(null);
    const socket = getRaceSocket();
    socket.emit('race:rematch', { code }, (res: { ok: true } | { error: string }) => {
      if ('error' in res) setError(res.error);
    });
  };

  const attemptPlace = (pos: Position) => {
    if (!puzzle || myFinishTimeMs !== null) return;
    const k = `${pos.row},${pos.col}`;
    if (placements.some((p) => p.row === pos.row && p.col === pos.col)) return;
    if (eliminated.has(k)) return;

    const { valid, conflicts } = validatePlacement(puzzle, placements, pos);
    if (!valid) {
      const flashed = new Set([k, ...conflicts.map((c) => `${c.with.row},${c.with.col}`)]);
      setConflictFlash(flashed);
      setMistakes((m) => m + 1);
      setManualMarks((prev) => {
        if (!prev.has(k)) return prev;
        const next = new Set(prev);
        next.delete(k);
        return next;
      });
      setTimeout(() => setConflictFlash(new Set()), 400);
      return;
    }

    const next = [...placements, pos];
    setPlacements(next);
    setEliminated(new Set(getBoardEliminatedCells(puzzle, next).map((p) => `${p.row},${p.col}`)));
    setManualMarks((prev) => {
      if (!prev.has(k)) return prev;
      const nextMarks = new Set(prev);
      nextMarks.delete(k);
      return nextMarks;
    });

    const socket = getRaceSocket();
    socket.emit('race:progress', { code, placedCount: next.length });

    if (isSolved(puzzle, next)) {
      socket.emit('race:finish', { code, positions: next }, (res: { ok: true } | { error: string }) => {
        if ('ok' in res && startedAt) setMyFinishTimeMs(Date.now() - startedAt);
      });
    }
  };

  if (stage === 'lobby') {
    return (
      <div className="home-shell">
        <div className="home-card">
          <h1>🏁 מרוץ</h1>
          <p className="home-welcome">שלום, {user.displayName}</p>
          {error && <p className="auth-error">{error}</p>}
          <p className="home-welcome">גודל לוח:</p>
          <div className="race-size-picker">
            {[5, 6, 7, 8, 9].map((n) => (
              <button
                key={n}
                className={createSize === n ? 'active' : ''}
                onClick={() => setCreateSize(n)}
              >
                {n}×{n}
              </button>
            ))}
          </div>
          <div className="home-actions">
            <button onClick={handleCreate} className="primary">
              צור מרוץ חדש
            </button>
          </div>
          <div className="home-actions">
            <input
              className="race-code-input"
              placeholder="קוד חדר"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              maxLength={5}
            />
            <button onClick={handleJoin}>הצטרף למרוץ</button>
          </div>
          <div className="home-actions">
            <button onClick={onExit}>חזרה לתפריט</button>
          </div>

          <div className="leaderboard home-ranking">
            <h2>🏆 דירוג מרוצים</h2>
            {raceRankingError && <p className="leaderboard-error">לא ניתן לטעון את הדירוג כרגע</p>}
            {!raceRankingError && !raceRanking && <p>טוען...</p>}
            {raceRanking && raceRanking.length === 0 && <p>עדיין אין מרוצים - היה הראשון לנצח!</p>}
            {raceRanking && raceRanking.length > 0 && (
              <ol className="global-ranking-list">
                {raceRanking.map((row, i) => (
                  <li key={row.user_id} className={row.user_id === user.id ? 'me' : ''}>
                    <span className="rank">{i + 1}</span>
                    <span className="name">{row.player_name}</span>
                    <span className="levels">{row.races_played} מרוצים</span>
                    <span className="score">{row.wins} ניצחונות</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'waiting') {
    const isHost = hostUserId === user.id;
    const canStart = players.length >= 2;
    return (
      <div className="home-shell">
        <div className="home-card">
          <h1>ממתין לשחקנים...</h1>
          <p className="home-welcome">שתף את הקוד הזה עם החברים שלך:</p>
          <p style={{ fontSize: 40, fontWeight: 700, letterSpacing: 6, textAlign: 'center', color: '#ffd479' }}>
            {code}
          </p>
          <ol className="global-ranking-list">
            {players.map((p) => (
              <li key={p.displayName} className={p.displayName === user.displayName ? 'me' : ''}>
                <span className="name">{p.displayName}</span>
                {p.userId === hostUserId && <span className="score">👑 יוזם</span>}
              </li>
            ))}
            {Array.from({ length: Math.max(0, MAX_RACE_PLAYERS - players.length) }).map((_, i) => (
              <li key={`empty-${i}`} style={{ opacity: 0.4 }}>
                <span className="name">ממתין לשחקן...</span>
              </li>
            ))}
          </ol>
          {error && <p className="auth-error">{error}</p>}
          <div className="home-actions">
            {isHost ? (
              <button onClick={handleBegin} className="primary" disabled={!canStart}>
                {canStart ? 'התחל מרוץ' : 'צריך לפחות 2 שחקנים'}
              </button>
            ) : (
              <p className="home-welcome">ממתין ליוזם שיתחיל את המרוץ...</p>
            )}
            <button onClick={handleExit}>ביטול</button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'countdown') {
    return (
      <div className="home-shell">
        <div className="home-card">
          <h1>המרוץ מתחיל...</h1>
          <p style={{ fontSize: 48, fontWeight: 700, textAlign: 'center', color: '#b9b6ff' }}>
            {Math.ceil(countdownMs / 1000)}
          </p>
          <div className="home-actions">
            <button onClick={handleGoToMenu}>🏠 לתפריט</button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'finished') {
    const sorted = [...players].sort((a, b) => (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity));
    return (
      <div className="home-shell">
        <div className="home-card">
          <h1>🏁 המרוץ הסתיים</h1>
          {leftPlayerName && <p className="auth-error">{leftPlayerName} עזב/ה את המרוץ</p>}
          <ol className="global-ranking-list">
            {sorted.map((p, i) => (
              <li key={p.displayName} className={p.displayName === user.displayName ? 'me' : ''}>
                <span className="rank">{i + 1}</span>
                <span className="name">{p.displayName}</span>
                <span className="score">{p.timeMs !== null ? formatMs(p.timeMs) : 'לא סיים'}</span>
              </li>
            ))}
          </ol>
          {error && <p className="auth-error">{error}</p>}
          <div className="home-actions">
            {hostUserId === user.id && (
              <button onClick={handleRematch} className="primary">
                🔁 משחק נוסף
              </button>
            )}
            <button
              onClick={() => {
                clearRaceSession();
                onExit();
              }}
            >
              חזרה לתפריט
            </button>
          </div>
        </div>
      </div>
    );
  }

  // stage === 'playing'
  if (!puzzle) return null;
  const size = puzzle.size;
  const placedKeys = new Set(placements.map((p) => `${p.row},${p.col}`));
  const elapsed = startedAt ? Date.now() - startedAt : 0;
  const opponents = players.filter((p) => p.displayName !== user.displayName);
  const finishedOpponents = opponents.filter((p) => p.finished);
  const allOthersFinished = opponents.length > 0 && finishedOpponents.length === opponents.length;

  return (
    <div className="app-shell">
      <div className="hud">
        <div className="hud-panel">
          <span>הוצבו {placements.length}/{size} · טעויות {mistakes}</span>
          <span>{myFinishTimeMs !== null ? formatMs(myFinishTimeMs) : formatMs(Math.max(0, elapsed))}</span>
        </div>
        {opponents.map((p) => (
          <div className="hud-panel" key={p.displayName}>
            <span>
              {p.displayName}: {p.finished ? `סיים/ה ב-${formatMs(p.timeMs ?? 0)}` : `${opponentProgress[p.displayName] ?? 0}/${size} הוצבו`}
            </span>
          </div>
        ))}
        {myFinishTimeMs !== null && !allOthersFinished && (
          <div className="hud-panel">
            <span>סיימת! ממתין לשאר...</span>
          </div>
        )}
        <button onClick={handleGoToMenu} className="race-menu-button">
          🏠
        </button>
      </div>

      <div className="board-2d-wrap">
        <div
          className="board-2d"
          style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, gridTemplateRows: `repeat(${size}, 1fr)` }}
        >
          {Array.from({ length: size }).map((_, row) =>
            Array.from({ length: size }).map((_, col) => {
              const cellKey = `${row},${col}`;
              const region = puzzle.regions[row][col];
              const hasPiece = placedKeys.has(cellKey);
              const isEliminated = eliminated.has(cellKey);
              const isMarked = manualMarks.has(cellKey);
              const isInvalidAttempt = conflictFlash.has(cellKey) && !hasPiece;
              const showX = isEliminated || isMarked || isInvalidAttempt;

              return (
                <div
                  key={cellKey}
                  className="board-2d-cell"
                  style={{ backgroundColor: colorForRegion(region) }}
                  onPointerDown={(e) => {
                    e.currentTarget.releasePointerCapture(e.pointerId);

                    // A validly-placed piece is locked in place - no undo in
                    // race mode, since removal-as-mistake-correction isn't a
                    // thing here (a race board has no deadlock recovery).
                    if (hasPiece) return;

                    const now = performance.now();
                    const last = lastTapRef.current;
                    if (last && last.key === cellKey && now - last.time < DOUBLE_TAP_MS) {
                      lastTapRef.current = null;
                      attemptPlace({ row, col });
                      return;
                    }
                    lastTapRef.current = { key: cellKey, time: now };

                    if (isEliminated) return;
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
                  {showX && (
                    <div className={`board-2d-x ${isInvalidAttempt ? 'invalid' : ''}`}>
                      <span />
                      <span />
                    </div>
                  )}
                  {hasPiece && (
                    <div className="board-2d-piece">
                      <div className="board-2d-piece-glow" style={{ background: colorForRegion(region) }} />
                      <img
                        src={`${import.meta.env.BASE_URL}piece.png`}
                        alt=""
                        className="board-2d-piece-img"
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
    </div>
  );
}
