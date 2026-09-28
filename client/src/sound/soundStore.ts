import { create } from 'zustand';
import { isSoundMuted, setSoundMuted } from './soundManager';

interface SoundState {
  muted: boolean;
  toggleMuted: () => void;
}

// A thin reactive mirror of soundManager's own module-level flag (the actual
// source of truth, read directly by playSound() so every call site doesn't
// need a store subscription) - this exists purely so the mute button in the
// HUD re-renders when toggled.
export const useSoundStore = create<SoundState>((set, get) => ({
  muted: isSoundMuted(),
  toggleMuted: () => {
    const next = !get().muted;
    setSoundMuted(next);
    set({ muted: next });
  },
}));
