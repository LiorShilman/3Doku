/**
 * Region fill colors - 9 hues spaced ~40° apart around the color wheel (the
 * max board size is 9x9, so up to 9 regions can be on screen at once). The
 * previous 8-color set had violet/blue and pink/red sitting close enough in
 * hue to read as "the same color, different shade" at a glance - this set
 * trades a couple of those for hues nothing else is near, so every region is
 * clearly its own color rather than a shade of a neighbor.
 */
// Two rounds of "these look too similar" feedback turned out to both be the
// same root cause: picking a plausible-looking hex by eye instead of the hue
// the design comment claimed. Actually measuring each color's HSL hue found
// "gold" (#e6c400) sitting at ~51° - only 16° from orange's ~35°, nowhere
// near its intended ~80° slot - which is exactly why it read as "basically
// orange". Replaced with a real lime/yellow-green at ~83°, roughly centered
// between orange (~35°) and green (~135°). Sky-blue vs. teal was the same
// story before this comment existed (see git history) - fixed the same way,
// by checking the actual resulting hue/lightness, not just eyeballing a hex.
export const REGION_COLORS = [
  '#ff3b30', // red      (~3°)
  '#ff9500', // orange   (~35°)
  '#a3e635', // lime     (~83°)
  '#34c759', // green    (~135°)
  '#00c7b1', // teal     (~173°)
  '#0a84ff', // blue     (~210°)
  // Was "indigo" (#5e5ce6, ~241°) - only 31° from blue in hue, and a strong
  // blue-violet like this one reads as "purple" to most people at a glance,
  // not as a distinct third color from blue - this was the actual pair
  // getting confused, not blue vs. #bf5af2 (a much more magenta-leaning
  // color further away in hue, restored below). A genuinely neutral,
  // low-saturation warm gray can't be confused with ANY hue-based region,
  // including its neighbors here - being a different *kind* of color (muted
  // vs. vivid) is a stronger distinction than shifting hue angle again would
  // be, and the saturation filter barely affects it either way (there's
  // little saturation to boost).
  '#9c8f7c', // warm gray (neutral)
  '#bf5af2', // purple   (~280°)
  '#ff2d82', // pink     (~336°)
];

export function colorForRegion(region: number): string {
  return REGION_COLORS[region % REGION_COLORS.length];
}
