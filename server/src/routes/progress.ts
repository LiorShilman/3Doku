import { Router } from 'express';
import { getProgress, saveProgress, deleteUserScores, deletePokemonCollection } from '../db.js';
import { requireAuth } from './auth.js';

export const progressRouter = Router();

progressRouter.get('/', requireAuth, (req, res) => {
  res.json({ levelIndex: getProgress(req.user!.id) });
});

progressRouter.post('/', requireAuth, (req, res) => {
  const { levelIndex } = req.body as { levelIndex?: unknown };
  if (typeof levelIndex !== 'number' || !Number.isInteger(levelIndex) || levelIndex < 0) {
    return res.status(400).json({ error: 'invalid levelIndex' });
  }
  saveProgress(req.user!.id, levelIndex);
  res.status(204).end();
});

// The settings screen's "full reset" (see SettingsScreen.tsx) - level
// progress, the global-ranking standing from past submissions, and the
// Pokemon collection. Doesn't touch race stats, which aren't part of level
// progression and were never asked to reset.
progressRouter.post('/reset', requireAuth, (req, res) => {
  saveProgress(req.user!.id, 0);
  deleteUserScores(req.user!.id);
  deletePokemonCollection(req.user!.id);
  res.status(204).end();
});
