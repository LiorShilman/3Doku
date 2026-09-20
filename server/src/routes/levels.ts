import { Router } from 'express';
import { getLevel } from '../puzzles.js';

export const levelsRouter = Router();

levelsRouter.get('/:levelIndex', (req, res) => {
  const levelIndex = Number(req.params.levelIndex);
  if (!Number.isInteger(levelIndex) || levelIndex < 1) {
    return res.status(400).json({ error: 'levelIndex must be a positive integer' });
  }
  res.json({ puzzle: getLevel(levelIndex) });
});
