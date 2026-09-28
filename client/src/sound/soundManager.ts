// Every effect here is synthesized with the Web Audio API (oscillators +
// gain envelopes), not loaded from sound files - no assets to fetch, bundle,
// or license, and every tone is generated fresh so there's nothing to
// preload before the first sound can play. AudioContext is created lazily,
// on first playSound() call - see unlockAudioOnFirstInteraction below for
// the extra step mobile browsers need beyond that.

export type SoundName =
  | 'mark'
  | 'place'
  | 'invalid'
  | 'catch-common'
  | 'catch-uncommon'
  | 'catch-rare'
  | 'catch-legendary'
  | 'solve'
  | 'trade';

const MUTED_KEY = '3doku:soundMuted';

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function persistMuted(next: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, next ? '1' : '0');
  } catch {
    // best-effort only
  }
}

let muted = loadMuted();

export function isSoundMuted(): boolean {
  return muted;
}

// The only writer of `muted` - soundStore.ts's zustand wrapper calls this so
// every playSound() call (which reads the same module-level flag) and every
// UI toggle agree on one source of truth.
export function setSoundMuted(next: boolean): void {
  muted = next;
  persistMuted(next);
}

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

// A short, algorithmically-generated impulse response (exponentially-decaying
// filtered noise) rather than a recorded one - same "no asset files" approach
// as everything else here. Built once per AudioContext and shared by every
// note, so a whole run of an arpeggio blends into one coherent room instead
// of each note getting its own separate, more expensive convolution.
function createReverbImpulse(ctx: AudioContext): AudioBuffer {
  const duration = 1.1;
  const decay = 2.8;
  const length = Math.floor(ctx.sampleRate * duration);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

let reverbSend: ConvolverNode | null = null;

// The shared "wet" bus every note feeds into alongside its own direct (dry)
// output - a little reverb is what turns a bare oscillator blip into
// something that sounds like it's actually in a space, instead of pasted
// flat on top of the game. Lazy + cached per context, same reasoning as
// getCtx() itself.
function ensureReverbSend(ctx: AudioContext): ConvolverNode {
  if (!reverbSend) {
    reverbSend = ctx.createConvolver();
    reverbSend.buffer = createReverbImpulse(ctx);
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.16; // subtle - adds air, not a cave echo
    reverbSend.connect(wetGain).connect(ctx.destination);
  }
  return reverbSend;
}

// One note: frequency in Hz, when it starts (seconds from now), how long it
// rings, its peak volume, and its waveform. The quick linear attack avoids a
// click at the very start; the exponential decay is what makes it sound like
// a plucked/percussive blip instead of a dull organ tone cutting off.
//
// `bendTo`, when given, glides the pitch from `freq` to that frequency over
// the note's duration - a rising or falling sweep reads clearly as
// "positive"/"negative" even through a single tiny mono phone speaker, which
// is not true of the detune/filter/reverb polish below (a few cents of
// chorus and a touch of stereo-ish reverb space are real improvements on
// real speakers or headphones, but they're subtle enough to disappear
// entirely on cheap hardware - a pitch bend is a blunt, unmissable cue by
// comparison, which is why the sounds most likely to be judged "did
// anything change?" on a phone (mark/place/invalid) lean on it hardest).
//
// Two oscillators a few cents apart (not one) still drive each note for
// some fullness, through a gentle lowpass and a shared reverb send.
function note(
  ctx: AudioContext,
  freq: number,
  startOffset: number,
  duration: number,
  peak: number,
  type: OscillatorType,
  bendTo?: number
): void {
  const t0 = ctx.currentTime + startOffset;
  const stopAt = t0 + duration + 0.02;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = Math.min(9000, freq * 5 + 900);
  filter.Q.value = 0.6;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  filter.connect(gain);
  gain.connect(ctx.destination);
  gain.connect(ensureReverbSend(ctx));

  for (const cents of [-7, 7]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (bendTo) osc.frequency.exponentialRampToValueAtTime(bendTo, t0 + duration);
    osc.detune.value = cents;
    osc.connect(filter);
    osc.start(t0);
    osc.stop(stopAt);
  }
}

// A very short burst of filtered noise, mixed alongside a tonal note (or on
// its own) - a broadband transient like this cuts through even a bad
// speaker the way a pure tone's attack sometimes doesn't, which is what
// makes it read as a distinct "click"/percussive punch rather than just a
// softer version of the same tone.
function click(ctx: AudioContext, startOffset: number, peak: number, toneHz = 2500): void {
  const t0 = ctx.currentTime + startOffset;
  const duration = 0.03;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = toneHz;
  filter.Q.value = 1.2;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t0);
}

// C5, E5, G5, C6, E6 - handy note names for the arpeggios below.
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const E6 = 1318.51;
const G6 = 1567.98;

const players: Record<SoundName, (ctx: AudioContext) => void> = {
  // The single-tap "mark X" gesture (see gameStore.ts's setMark) - it's the
  // most frequent action on the board, always a direct synchronous tap with
  // no network round-trip involved, which makes it the simplest possible
  // way to tell "is sound working on this device at all" apart from the
  // catch chime (async, after a server response) or the solve fanfare (only
  // once per level). A rising pitch bend plus a percussive click - both cut
  // through a small phone speaker far more reliably than a flat single tone.
  mark: (ctx) => {
    click(ctx, 0, 0.2, 3200);
    note(ctx, 500, 0, 0.05, 0.16, 'square', 950);
  },

  // A punchier "clack" than a bare tone - click for the attack, a quick
  // upward bend for the satisfying "it snapped into place" feel.
  place: (ctx) => {
    click(ctx, 0, 0.18, 1800);
    note(ctx, 380, 0, 0.11, 0.22, 'triangle', 640);
  },

  // An unmistakable downward "wah-wah" - each note bends DOWN in pitch, not
  // just two fixed low tones, which reads as "wrong" clearly even on a
  // speaker too small to reproduce their actual bass frequencies well.
  invalid: (ctx) => {
    note(ctx, 320, 0, 0.16, 0.24, 'sawtooth', 150);
    note(ctx, 260, 0.1, 0.18, 0.22, 'sawtooth', 110);
  },

  // Catch chimes escalate with rarity - more notes, brighter tone, longer
  // tail - so a legendary catch is unmistakably a bigger deal by ear alone,
  // matching the visual "new species" banner (see gameStore.ts's
  // attemptPlace) which only plays these for a genuinely new species, never
  // a duplicate.
  'catch-common': (ctx) => {
    note(ctx, C5, 0, 0.12, 0.2, 'sine');
    note(ctx, E5, 0.09, 0.16, 0.2, 'sine');
  },
  'catch-uncommon': (ctx) => {
    note(ctx, C5, 0, 0.1, 0.2, 'sine');
    note(ctx, E5, 0.08, 0.1, 0.2, 'sine');
    note(ctx, G5, 0.16, 0.18, 0.22, 'sine');
  },
  'catch-rare': (ctx) => {
    note(ctx, C5, 0, 0.09, 0.19, 'triangle');
    note(ctx, E5, 0.07, 0.09, 0.19, 'triangle');
    note(ctx, G5, 0.14, 0.09, 0.2, 'triangle');
    note(ctx, C6, 0.21, 0.22, 0.24, 'triangle');
  },
  'catch-legendary': (ctx) => {
    click(ctx, 0, 0.15, 4000);
    [C5, E5, G5, C6, E6].forEach((f, i) => note(ctx, f, i * 0.08, 0.14, 0.22, 'triangle'));
    note(ctx, C6, 0.48, 0.55, 0.24, 'sine');
    note(ctx, E6, 0.48, 0.55, 0.2, 'sine');
    note(ctx, G6, 0.48, 0.6, 0.18, 'sine');
  },

  // Timed to land alongside the fireworks overlay (see FireworksOverlay.tsx
  // and App.tsx's WIN_MENU_DELAY_MS window) - a short rising run into a held
  // chord.
  solve: (ctx) => {
    [C5, E5, G5, C6].forEach((f, i) => note(ctx, f, i * 0.1, 0.16, 0.24, 'triangle'));
    note(ctx, C6, 0.42, 0.5, 0.26, 'sine');
    note(ctx, E6, 0.42, 0.5, 0.21, 'sine');
    note(ctx, G6, 0.42, 0.55, 0.18, 'sine');
  },

  trade: (ctx) => {
    click(ctx, 0, 0.15, 2600);
    note(ctx, 880, 0, 0.08, 0.2, 'sine');
    note(ctx, 1108.73, 0.06, 0.16, 0.2, 'sine');
  },
};

export function playSound(name: SoundName): void {
  if (muted) return;
  const ctx = getCtx();
  if (!ctx) return;
  try {
    players[name](ctx);
  } catch {
    // A synthesis glitch is cosmetic - never let it interrupt the game.
  }
}

let unlocked = false;

// Mobile Safari (and to a lesser extent mobile Chrome) is stricter than
// desktop about when Web Audio is allowed to actually make sound - a
// context created/resumed synchronously inside a real tap generally works,
// but several call sites here (e.g. gameStore.ts's attemptPlace catch chime,
// which only fires once the server responds to an async request) run AFTER
// the tap that triggered them, not during it, which mobile Safari doesn't
// reliably count as "still part of the gesture". The standard fix is to
// play one truly-silent, zero-length buffer synchronously on the very
// FIRST tap anywhere on the page - that one-time unlock keeps the context
// usable for every sound this session triggers afterward, gesture or not.
// Call this once, as early as possible (see App.tsx).
export function unlockAudioOnFirstInteraction(): void {
  if (unlocked || typeof document === 'undefined') return;

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    const ctx = getCtx();
    if (ctx) {
      try {
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        // Best-effort unlock only - a failure here just means sounds might
        // stay silent on this particular device, not a crash.
      }
    }
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('touchend', unlock);
    document.removeEventListener('click', unlock);
  };

  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('touchend', unlock, { once: true });
  document.addEventListener('click', unlock, { once: true });
}
