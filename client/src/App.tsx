import { useEffect, useRef, useState } from 'react';
import { Scene } from './scene/Scene';
import { Board2D } from './scene2d/Board2D';
import { useGameStore, computeScore } from './store/gameStore';
import {
  fetchGlobalRanking,
  fetchLeaderboard,
  fetchMe,
  fetchMyGlobalRank,
  fetchProgress,
  logout,
  resetProgress,
  saveProgress,
  submitScore,
  type AuthUser,
  type GlobalRankingRow,
  type MyGlobalRank,
  type ScoreRow,
} from './api';
import { AuthPanel } from './auth/AuthPanel';
import { HomeScreen } from './HomeScreen';
import { SettingsScreen } from './SettingsScreen';
import { RaceScreen } from './race/RaceScreen';
import { abandonActiveRace } from './race/raceSession';
import { CollectionScreen } from './pokemon/CollectionScreen';
import { loadPokedex, pokemonImageUrl } from './pokemon/pokedex';

interface GlobalRankingModalProps {
  currentUserId: number;
  onClose: () => void;
}

function GlobalRankingModal({ currentUserId, onClose }: GlobalRankingModalProps) {
  const [ranking, setRanking] = useState<GlobalRankingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGlobalRanking()
      .then(setRanking)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>🏆 דירוג כללי</h2>
        {error && <p className="leaderboard-error">לא ניתן לטעון את הדירוג כרגע</p>}
        {!error && !ranking && <p>טוען...</p>}
        {ranking && ranking.length === 0 && <p>עדיין אין נתונים - היה הראשון לפתור שלב!</p>}
        {ranking && ranking.length > 0 && (
          <ol className="global-ranking-list">
            {ranking.map((row, i) => (
              <li key={row.user_id} className={row.user_id === currentUserId ? 'me' : ''}>
                <span className="rank">{i + 1}</span>
                <span className="name">{row.player_name}</span>
                <span className="levels">🏁 {row.levels_completed}</span>
                <span className="levels">🎒 {row.pokemon_count}</span>
                <span className="score">{row.total_score} נק'</span>
              </li>
            ))}
          </ol>
        )}
        <button onClick={onClose} className="primary">
          סגור
        </button>
      </div>
    </div>
  );
}

function useElapsedMs(active: boolean, startedAt: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [active]);
  return now - startedAt;
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface GameProps {
  user: AuthUser;
  onLogout: () => void;
  onGoHome: () => void;
}

function Game({ user, onLogout, onGoHome }: GameProps) {
  const newPokemonCaught = useGameStore((s) => s.newPokemonCaught);
  const clearNewPokemonBanner = useGameStore((s) => s.clearNewPokemonBanner);
  const boardBottomScreenY = useGameStore((s) => s.boardBottomScreenY);
  const loadError = useGameStore((s) => s.loadError);
  const loadLevel = useGameStore((s) => s.loadLevel);
  const assistMode = useGameStore((s) => s.assistMode);
  const toggleAssistMode = useGameStore((s) => s.toggleAssistMode);
  const resetPuzzle = useGameStore((s) => s.resetPuzzle);
  const undoLastPlacement = useGameStore((s) => s.undoLastPlacement);
  const nextLevel = useGameStore((s) => s.nextLevel);
  const levelIndex = useGameStore((s) => s.levelIndex);
  const solved = useGameStore((s) => s.solved);
  const solvedAtMs = useGameStore((s) => s.solvedAtMs);
  const startedAt = useGameStore((s) => s.startedAt);
  const paused = useGameStore((s) => s.paused);
  const pauseGame = useGameStore((s) => s.pauseGame);
  const viewMode = useGameStore((s) => s.viewMode);
  const toggleViewMode = useGameStore((s) => s.toggleViewMode);
  const elapsed = useElapsedMs(!solved && !paused, startedAt);

  const handleGoHome = () => {
    pauseGame();
    onGoHome();
  };

  const puzzle = useGameStore((s) => s.puzzle);
  const placements = useGameStore((s) => s.placements);
  const placedCount = placements.length;

  const savedLevel = useRef(levelIndex);
  useEffect(() => {
    if (savedLevel.current === levelIndex) return;
    savedLevel.current = levelIndex;
    saveProgress(levelIndex).catch(() => {});
  }, [levelIndex]);

  const rawEliminatedCount = useGameStore((s) => s.eliminated.size);
  const eliminatedCount = assistMode ? rawEliminatedCount : 0;
  const mistakes = useGameStore((s) => s.mistakes);
  const hint = useGameStore((s) => s.hint);
  const hintsUsed = useGameStore((s) => s.hintsUsed);
  const requestHint = useGameStore((s) => s.requestHint);
  const isDeadlocked = useGameStore((s) => s.isDeadlocked);
  const deadlockedRegion = useGameStore((s) => s.deadlockedRegion);
  const resolveDeadlock = useGameStore((s) => s.resolveDeadlock);
  const score = computeScore(mistakes, hintsUsed, solved ? solvedAtMs ?? 0 : elapsed);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  };

  const [leaderboard, setLeaderboard] = useState<ScoreRow[] | null>(null);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const submittedForLevel = useRef<string | null>(null);
  const [showGlobalRanking, setShowGlobalRanking] = useState(false);
  const [myRank, setMyRank] = useState<MyGlobalRank | null>(null);

  // Shown continuously in the HUD (not just when the player happens to be
  // near the top of the visible leaderboard) - fetched once on entering the
  // game and refreshed after every new submission, since that's the only
  // thing that can actually move it.
  useEffect(() => {
    fetchMyGlobalRank()
      .then(setMyRank)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!solved || solvedAtMs === null || !puzzle) return;
    if (submittedForLevel.current === puzzle.id) return;
    submittedForLevel.current = puzzle.id;

    // Advances the *saved* progress the moment the level is won, not only
    // when the player clicks "next level" - otherwise closing the tab (or
    // just sitting on the win banner) right after solving left the server
    // still thinking they were on this level, and coming back later handed
    // them the same puzzle to "solve" again instead of the next one.
    saveProgress(levelIndex + 1).catch(() => {});

    submitScore(puzzle.id, { timeMs: solvedAtMs, usedAssist: assistMode, positions: placements })
      .then(() => Promise.all([fetchLeaderboard(puzzle.id), fetchMyGlobalRank().catch(() => null)]))
      .then(([board, rank]) => {
        setLeaderboard(board);
        setMyRank(rank);
      })
      .catch((err) => setLeaderboardError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solved, puzzle?.id]);

  useEffect(() => {
    submittedForLevel.current = null;
    setLeaderboard(null);
    setLeaderboardError(null);
  }, [puzzle?.id]);

  if (!puzzle) {
    return (
      <div className="app-shell">
        {loadError ? (
          <div className="level-loading level-load-error">
            <p>⚠️ לא ניתן לטעון את השלב</p>
            <p className="level-load-error-detail">{loadError}</p>
            <div className="home-actions">
              <button onClick={() => loadLevel(levelIndex)} className="primary">
                נסה שוב
              </button>
              <button onClick={onGoHome}>🏠 תפריט</button>
            </div>
          </div>
        ) : (
          <div className="level-loading">טוען שלב...</div>
        )}
      </div>
    );
  }

  const totalCells = puzzle.size * puzzle.size;
  const remainingCells = totalCells - placedCount;
  const openCells = remainingCells - eliminatedCount;

  // A teaching-style hint (see findForcedHint in rules.ts): prefers pointing
  // at the next *eliminable* cells - "mark these X, because that region has
  // to go there" - over jumping straight to "place the piece here", so it
  // only ever gives away one deducible fact at a time. Falls back to naming
  // an actual placement once a row/col/region is already down to one open
  // cell using everything the player has marked so far.
  const hintText = (() => {
    if (!hint) return null;
    if (hint.kind === 'eliminate') {
      const lineLabel = hint.reason === 'row' ? `בשורה ${hint.groupIndex + 1}` : `בעמודה ${hint.groupIndex + 1}`;
      const lineWord = hint.reason === 'row' ? 'בשורה זו' : 'בעמודה זו';
      return `אזור הצבע המסומן בלבן חייב להיות ${lineLabel} - לכן אפשר לסמן X על התאים המסומנים בכתום ${lineWord}.`;
    }
    if (hint.reason === 'solution') {
      return 'אין הסבר פשוט לצעד הזה (נדרש ניסוי) - אבל זה בהחלט המיקום הנכון - לחץ פעמיים על התא עם הטבעת הזוהרת כדי להציב שם את הדמות';
    }
    const hasDeeperReason = !!hint.becauseCells?.length;
    const reasonText = hasDeeperReason
      ? {
          row: `אזור הצבע המסומן בלבן חייב להיות בשורה ${hint.groupIndex + 1} - לכן שאר השורה נפסלת, למרות שה-X לא מוצג עליה`,
          col: `אזור הצבע המסומן בלבן חייב להיות בעמודה ${hint.groupIndex + 1} - לכן שאר העמודה נפסלת, למרות שה-X לא מוצג עליה`,
          region: `אזור הצבע המסומן בלבן חייב להיות כאן - לכן שאר תאי האזור הזה נפסלים, למרות שה-X לא מוצג עליהם`,
          solution: '',
        }[hint.reason]
      : {
          row: `בשורה ${hint.groupIndex + 1} נשארה רק תא פתוח אחד (שאר התאים בשורה מסומנים ב-X)`,
          col: `בעמודה ${hint.groupIndex + 1} נשארה רק תא פתוח אחד (שאר התאים בעמודה מסומנים ב-X)`,
          region: `באזור הצבע הזה נשאר רק תא פתוח אחד (שאר תאי הצבע מסומנים ב-X)`,
          solution: '',
        }[hint.reason];
    return `${reasonText} - לחץ פעמיים על התא עם הטבעת הזוהרת כדי להציב שם את הדמות`;
  })();

  return (
    <div className="app-shell">
      {viewMode === '3d' ? <Scene /> : <Board2D />}

      <div className="hud">
        <div className="hud-panel">
          <span>שלב {levelIndex + 1}</span>
          <span>{formatMs(solved ? solvedAtMs ?? elapsed : elapsed)}</span>
          <label className="assist-toggle">
            <input type="checkbox" checked={assistMode} onChange={toggleAssistMode} />
            Auto-X
          </label>
        </div>
        <div className="hud-panel">
          <span>הוצבו {placedCount}/{puzzle.size}</span>
          <span>נפסלו {eliminatedCount}/{remainingCells}</span>
          <span>פתוחים {openCells}</span>
          <span>טעויות {mistakes}</span>
          <span>ניקוד {score}</span>
          <span>{myRank ? `דירוג כללי: מקום #${myRank.rank} (${myRank.total_score} נק')` : 'דירוג כללי: עדיין אין לך ניקוד'}</span>
        </div>
        <div className="hud-panel">
          <span className="me-name">{user.displayName}</span>
          <button onClick={requestHint} className="hint-button">
            💡 רמז {hintsUsed > 0 ? `(${hintsUsed})` : ''}
          </button>
          <button onClick={() => setShowGlobalRanking(true)}>🏆 דירוג כללי</button>
          <button onClick={undoLastPlacement} disabled={placedCount === 0 || isDeadlocked}>
            ↩️ בטל
          </button>
          <button onClick={resetPuzzle}>איפוס</button>
          <button onClick={toggleFullscreen}>מסך מלא</button>
          <button onClick={toggleViewMode}>{viewMode === '3d' ? '🔲 תצוגת 2D' : '🧊 תצוגת 3D'}</button>
          <button onClick={handleGoHome}>🏠 תפריט</button>
          <button onClick={onLogout}>התנתק</button>
        </div>
      </div>

      {showGlobalRanking && (
        <GlobalRankingModal currentUserId={user.id} onClose={() => setShowGlobalRanking(false)} />
      )}

      {hintText && <div className="hint-banner">💡 {hintText}</div>}

      {newPokemonCaught && (
        <div
          className="new-pokemon-banner"
          // In 3D, anchor just below the board's actual current screen
          // position (from Scene.tsx's camera projection) instead of the
          // CSS default of a fixed distance from the screen's bottom edge -
          // that read as floating disconnected from the board whenever the
          // gap between the board and the screen edge wasn't small (which
          // varies by board size, screen aspect ratio, and camera angle).
          // In 2D (null) the plain CSS `bottom: 30px` position is used.
          style={
            boardBottomScreenY !== null
              ? // Clamped so a steep manual camera tilt (OrbitControls lets the
                // player rotate freely) can't push the board's projected edge -
                // and so this banner - below the visible viewport.
                { bottom: 'auto', top: Math.min(boardBottomScreenY + 16, window.innerHeight - 100) }
              : undefined
          }
          onClick={clearNewPokemonBanner}
        >
          <img src={pokemonImageUrl(newPokemonCaught)} alt={newPokemonCaught.name} className="new-pokemon-banner-img" />
          <div className="new-pokemon-banner-text">
            <span className="new-pokemon-banner-title">✨ פוקימון חדש באוסף! ✨</span>
            <span className="new-pokemon-banner-name">{newPokemonCaught.name}</span>
          </div>
        </div>
      )}

      {isDeadlocked && !solved && (
        <div className="deadlock-banner">
          <span>
            ⚠️ אין יותר מהלכים אפשריים ממצב הלוח הנוכחי -{' '}
            {deadlockedRegion !== null
              ? 'אזור הצבע המסומן באדום כבר לא יכול לקבל דמות.'
              : 'אחת ההצבות האחרונות חוסמת את הפתרון.'}{' '}
            ההצבה האחרונה שגויה - יש לסמן אותה כ-X.
          </span>
          <button onClick={resolveDeadlock} className="danger">
            סמן X ונחשב כטעות
          </button>
        </div>
      )}

      {solved && (
        <div className="win-banner">
          <div className="win-card">
            <h1>פתרת שלב {levelIndex + 1}! 🎉</h1>
            <p>זמן: {formatMs(solvedAtMs ?? 0)} · טעויות: {mistakes} · רמזים: {hintsUsed}</p>
            <p className="win-score">ניקוד: {score}</p>
            <div className="win-actions">
              <button onClick={resetPuzzle}>שחק שוב</button>
              <button onClick={nextLevel} className="primary">
                ← שלב הבא
              </button>
            </div>

            <div className="leaderboard">
              <h2>טבלת מקומות - שלב {levelIndex + 1}</h2>
              {leaderboardError && <p className="leaderboard-error">לא ניתן לטעון טבלת מקומות כרגע</p>}
              {!leaderboardError && !leaderboard && <p>שולח ניקוד...</p>}
              {leaderboard && (
                <ol>
                  {leaderboard.slice(0, 10).map((row, i) => (
                    <li key={row.id} className={row.user_id === user.id ? 'me' : ''}>
                      <span className="rank">{i + 1}</span>
                      <span className="name">{row.player_name}</span>
                      <span className="time">
                        {formatMs(row.time_ms)}
                        {row.used_assist ? ' (עזרה)' : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined); // undefined = still checking
  const [progressReady, setProgressReady] = useState(false);
  const [view, setView] = useState<'home' | 'game' | 'race' | 'collection' | 'settings'>('home');
  const loadLevel = useGameStore((s) => s.loadLevel);
  const startNewGame = useGameStore((s) => s.startNewGame);
  const resumeGame = useGameStore((s) => s.resumeGame);
  const levelIndex = useGameStore((s) => s.levelIndex);
  const loadOwnedPokedex = useGameStore((s) => s.loadOwnedPokedex);

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null));
    loadPokedex();
  }, []);

  useEffect(() => {
    if (user) loadOwnedPokedex();
  }, [user?.id, loadOwnedPokedex]);

  useEffect(() => {
    if (!user) return;
    setProgressReady(false);
    setView('home');
    fetchProgress()
      .then((levelIndex) => loadLevel(levelIndex))
      .catch(() => {})
      .finally(() => setProgressReady(true));
    // Keyed on the account itself, not the whole user object - editing the
    // display name (see SettingsScreen) replaces `user` in place without
    // actually switching accounts, and shouldn't bounce back to the home
    // screen or re-fetch progress the way a real login does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, loadLevel]);

  const handleLogout = () => {
    logout().then(() => setUser(null));
  };

  const handleAuthenticated = (authedUser: AuthUser) => setUser(authedUser);

  const handleContinue = () => {
    abandonActiveRace();
    resumeGame();
    setView('game');
  };

  const handleNewGame = async () => {
    abandonActiveRace();
    await resetProgress();
    await startNewGame();
    await loadOwnedPokedex(); // the reset wiped the collection server-side - reflect that locally too
    setView('game');
  };

  if (user === undefined) return <div className="app-shell auth-loading" />;
  if (user === null) return <AuthPanel onAuthenticated={handleAuthenticated} />;
  if (!progressReady) return <div className="app-shell auth-loading" />;
  if (view === 'home') {
    return (
      <HomeScreen
        user={user}
        levelIndex={levelIndex}
        onContinue={handleContinue}
        onRace={() => setView('race')}
        onCollection={() => setView('collection')}
        onSettings={() => setView('settings')}
        onLogout={handleLogout}
      />
    );
  }
  if (view === 'race') {
    return <RaceScreen user={user} onExit={() => setView('home')} />;
  }
  if (view === 'collection') {
    return <CollectionScreen onExit={() => setView('home')} />;
  }
  if (view === 'settings') {
    return (
      <SettingsScreen user={user} onUserUpdated={setUser} onNewGame={handleNewGame} onExit={() => setView('home')} />
    );
  }
  return <Game user={user} onLogout={handleLogout} onGoHome={() => setView('home')} />;
}
