// Unicode has no color-variant trophy glyphs (just one generic 🏆), so medal
// emoji are the practical stand-in for "gold/silver/bronze" - they're the
// de facto standard for 1st/2nd/3rd in game leaderboards regardless of the
// literal "trophy vs. medal" distinction.
const MEDALS = ['🥇', '🥈', '🥉'];

/** 0-indexed rank -> medal for the top 3, otherwise the plain place number. */
export function rankDisplay(index: number): string {
  return MEDALS[index] ?? String(index + 1);
}
