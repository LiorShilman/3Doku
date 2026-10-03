import { Router } from 'express';
import { getLevel } from '../puzzles.js';

export const levelsRouter = Router();

levelsRouter.get('/:levelIndex', (req, res) => {
  const levelIndex = Number(req.params.levelIndex);
  if (!Number.isInteger(levelIndex) || levelIndex < 1) {
    return res.status(400).json({ error: 'levelIndex must be a positive integer' });
  }
  const result = getLevel(levelIndex);
  if (result.status === 'generating') {
    return res.status(202).json({ status: 'generating' });
  }
  res.json({ puzzle: result.puzzle });
});
