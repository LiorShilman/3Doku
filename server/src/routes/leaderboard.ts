import { Router } from 'express';
import { isSolved, type Position } from '@3doku/shared';
import { getPuzzle } from '../puzzles.js';
import { insertScore, topScores, globalRanking, raceLeaderboard, myGlobalRank } from '../db.js';
import { requireAuth } from './auth.js';

export const leaderboardRouter = Router();

// Must be registered before '/:puzzleId' - otherwise Express would match this
// path as a puzzle id lookup and 404.
leaderboardRouter.get('/global/top', (_req, res) => {
  res.json({ ranking: globalRanking() });
});

leaderboardRouter.get('/race/top', (_req, res) => {
  res.json({ ranking: raceLeaderboard() });
});

// The live in-game HUD's "your global rank" indicator - unlike /global/top,
// this always resolves the calling player's own standing, even far outside
// the top 50 that route returns.
leaderboardRouter.get('/global/me', requireAuth, (req, res) => {
  res.json({ me: myGlobalRank(req.user!.id) ?? null });
});

leaderboardRouter.get('/:puzzleId', (req, res) => {
  const { puzzleId } = req.params;
  if (!getPuzzle(puzzleId)) return res.status(404).json({ error: 'unknown puzzle' });
  res.json({ scores: topScores(puzzleId) });
});

interface SubmitBody {
  timeMs?: unknown;
  usedAssist?: unknown;
  positions?: unknown;
}

function isPositionArray(value: unknown): value is Position[] {
  return (
    Array.isArray(value) &&
    value.every(
      (p) => p && typeof p === 'object' && typeof (p as Position).row === 'number' && typeof (p as Position).col === 'number'
    )
  );
}

// Identity comes from the authenticated session, never the request body - a client
// can no longer claim someone else's name on the leaderboard.
leaderboardRouter.post('/:puzzleId/submit', requireAuth, (req, res) => {
  const { puzzleId } = req.params;
  const puzzle = getPuzzle(puzzleId);
  if (!puzzle) return res.status(404).json({ error: 'unknown puzzle' });

  const body = req.body as SubmitBody;
  const timeMs = typeof body.timeMs === 'number' ? body.timeMs : NaN;
  const usedAssist = Boolean(body.usedAssist);

  if (!Number.isFinite(timeMs) || timeMs <= 0) return res.status(400).json({ error: 'invalid timeMs' });
  if (!isPositionArray(body.positions)) return res.status(400).json({ error: 'invalid positions' });

  // Server re-validates the solution itself - a client can never buy its way onto the leaderboard.
  if (!isSolved(puzzle, body.positions)) {
    return res.status(422).json({ error: 'solution does not satisfy puzzle rules' });
  }

  const row = insertScore(puzzleId, req.user!.id, req.user!.display_name, timeMs, usedAssist);
  res.status(201).json({ score: row });
});
