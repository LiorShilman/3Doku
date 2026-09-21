// The score formula used to be flat (1000 points minus penalties) regardless
// of board size or level - since board size ramps from 5x5 up to 9x9 (see
// sizeForLevel) and a bigger board takes proportionally longer to solve even
// played perfectly, a flat per-second time penalty crushed harder levels'
// scores toward 0, making level 1 and level 80 land on effectively the same
// (near-zero) score. This multiplier scales the achievable score with both
// the board's actual size (more cells = more difficulty) and the level
// number itself (so progression keeps being rewarded even after size caps
// out at 9x9 around level 53), while the per-second time penalty is
// deliberately left unscaled - a bigger board naturally taking longer to
// solve should cost the same absolute time penalty, which then represents a
// much smaller share of its now-larger point pool.
const REFERENCE_SIZE = 5; // smallest board size - the multiplier's baseline (1x)
const LEVEL_COEFFICIENT = 0.005; // kept small per explicit feedback - size should dominate, not level number

export function scoreMultiplier(size: number, level: number): number {
  const sizeMultiplier = (size * size) / (REFERENCE_SIZE * REFERENCE_SIZE);
  const levelMultiplier = 1 + (level - 1) * LEVEL_COEFFICIENT;
  return sizeMultiplier * levelMultiplier;
}

const BASE_SCORE = 1000;
const TIME_PENALTY_PER_SEC = 2;
const ASSIST_PENALTY = 200;

/** The server-authoritative score for a single level completion - only ever computed from time/assist, which the server itself verifies, never trusted from the client. */
export function computeLevelScore(size: number, level: number, timeMs: number, usedAssist: boolean): number {
  const multiplier = scoreMultiplier(size, level);
  const timePenalty = Math.floor(timeMs / 1000) * TIME_PENALTY_PER_SEC;
  const assistPenalty = usedAssist ? ASSIST_PENALTY * multiplier : 0;
  return Math.max(0, Math.round(BASE_SCORE * multiplier - timePenalty - assistPenalty));
}
