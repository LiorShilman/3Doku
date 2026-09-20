/**
 * A plain (non-React) mutable handle to the single OrbitControls instance.
 *
 * Disabling it via React props (zustand state -> re-render -> drei syncs the
 * prop to the instance) is too slow for this: the browser can dispatch the
 * pointermove events that actually perform a rotation before React has even
 * re-rendered, so the instance's `.enabled` is still stale `true` when they
 * arrive. Mutating `.enabled` directly here takes effect immediately, with no
 * render round-trip - OrbitControls checks `this.enabled` on every pointermove.
 */
export const orbitControlsHandle: { current: { enabled: boolean } | null } = { current: null };
