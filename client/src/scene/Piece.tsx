import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, RoundedBox, useTexture } from '@react-three/drei';
import type { Mesh } from 'three';

interface PieceProps {
  position: [number, number, number];
  conflict: boolean;
  /** Which image to render for this placed piece - a specific Pokemon in single-player levels (see the collection feature), or omitted for the plain default in race mode. */
  spriteUrl?: string;
}

const ASPECT = 492 / 700; // piece.png width / height

export function Piece({ position, conflict, spriteUrl }: PieceProps) {
  // BASE_URL (not a hardcoded leading slash) so this still resolves once IIS
  // serves the production build under /3Doku/ instead of the domain root.
  const texture = useTexture(spriteUrl ?? `${import.meta.env.BASE_URL}piece.png`);
  const height = 1.05;
  const width = height * ASPECT;

  return (
    <Billboard position={position}>
      <mesh position={[0, 0, 0]} castShadow>
        <planeGeometry args={[width, height]} />
        {/* Unlit on purpose: this is a 2D sprite icon, not a lit 3D surface -
            a billboard always faces the camera, so its "normal" for lighting
            purposes is whatever direction the camera happens to be, and the
            scene's directional light (positioned to shade the board, not the
            billboard) desaturated/grayed out the Pokemon artwork depending on
            view angle. meshBasicMaterial shows the texture's true colors
            regardless of scene lighting or shadows, which is what a sprite
            should do. The conflict tint is now a color multiply instead of
            an emissive add, since meshBasicMaterial has no emissive channel. */}
        <meshBasicMaterial map={texture} transparent alphaTest={0.15} color={conflict ? '#ff8a99' : '#ffffff'} />
      </mesh>
    </Billboard>
  );
}

interface EliminatedMarkProps {
  position: [number, number, number];
  invalid?: boolean;
}

export function EliminatedMark({ position, invalid }: EliminatedMarkProps) {
  const size = invalid ? 0.62 : 0.5;
  // The regular X was a mid-gray (#5a5a72) at only 55% opacity, lit like any
  // other surface - the region's own (now more saturated, post the vivid-mode
  // boost) color underneath showed through both the transparency and the
  // scene's ambient/environment lighting, which is exactly why it read as
  // "disappearing into the color" instead of a clear mark. Unlit and nearly
  // opaque so it renders as a true dark mark regardless of the cell color or
  // scene lighting underneath it.
  return (
    <group position={position}>
      <RoundedBox args={[size, 0.06, 0.09]} rotation={[-Math.PI / 2, 0, Math.PI / 4]} radius={0.02}>
        {invalid ? (
          <meshStandardMaterial color="#ff3b5c" emissive="#ff3b5c" emissiveIntensity={0.9} transparent opacity={0.95} />
        ) : (
          <meshBasicMaterial color="#050508" transparent opacity={0.92} />
        )}
      </RoundedBox>
      <RoundedBox args={[size, 0.06, 0.09]} rotation={[-Math.PI / 2, 0, -Math.PI / 4]} radius={0.02}>
        {invalid ? (
          <meshStandardMaterial color="#ff3b5c" emissive="#ff3b5c" emissiveIntensity={0.9} transparent opacity={0.95} />
        ) : (
          <meshBasicMaterial color="#050508" transparent opacity={0.92} />
        )}
      </RoundedBox>
    </group>
  );
}

/** The hint's target cell - a pulsing golden ring so it reads as "place here", distinct from any X mark or piece. */
export function HintTarget({ position }: { position: [number, number, number] }) {
  const ringRef = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const pulse = 0.85 + Math.sin(clock.elapsedTime * 4) * 0.15;
    ringRef.current.scale.setScalar(pulse);
  });
  return (
    <group position={position}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.32, 0.42, 32]} />
        <meshBasicMaterial color="#ffd479" transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

/** A cell in the hint's row/column/region reasoning - a soft gold tint explaining "why" alongside the target. */
export function HintGroupGlow({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.94, 0.94]} />
      <meshBasicMaterial color="#ffd479" transparent opacity={0.22} />
    </mesh>
  );
}

/**
 * The other color region whose confinement is the real reason the hint's row/
 * column/region collapsed - a bright white tint, since Auto-X never shows
 * this on its own. White rather than a hue (the original had blue) because
 * the region palette now spans sky blue, indigo and gold - any single tint
 * color would sit right on top of at least one of those and nearly disappear;
 * white reads clearly against all of them.
 */
export function HintBecauseGlow({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.94, 0.94]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.55} />
    </mesh>
  );
}

/**
 * A cell an "eliminate" hint says can safely be marked X right now - a
 * pulsing amber tint, distinct from the steady gold used for a `place`
 * hint's group (this isn't a placement target) and from the white "why"
 * tint on the confining region.
 */
export function HintEliminateGlow({ position }: { position: [number, number, number] }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const mat = ref.current.material as { opacity: number };
    mat.opacity = 0.35 + Math.sin(clock.elapsedTime * 3) * 0.15;
  });
  return (
    <mesh ref={ref} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.94, 0.94]} />
      <meshBasicMaterial color="#ff9f43" transparent opacity={0.4} />
    </mesh>
  );
}

/** The color region that's fully blocked - a soft red tint marking why the board is stuck, distinct from the hint's gold. */
export function DeadlockGlow({ position }: { position: [number, number, number] }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const mat = ref.current.material as { opacity: number };
    mat.opacity = 0.45 + Math.sin(clock.elapsedTime * 3) * 0.15;
  });
  return (
    <mesh ref={ref} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.98, 0.98]} />
      <meshBasicMaterial color="#ff3b5c" transparent opacity={0.55} depthWrite={false} />
    </mesh>
  );
}
