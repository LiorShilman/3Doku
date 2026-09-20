import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, RoundedBox, useTexture } from '@react-three/drei';
import type { Mesh } from 'three';

interface PieceProps {
  position: [number, number, number];
  color: string;
  conflict: boolean;
  /** Which image to render for this placed piece - a specific Pokemon in single-player levels (see the collection feature), or omitted for the plain default in race mode. */
  spriteUrl?: string;
}

const ASPECT = 492 / 700; // piece.png width / height

export function Piece({ position, color, conflict, spriteUrl }: PieceProps) {
  // BASE_URL (not a hardcoded leading slash) so this still resolves once IIS
  // serves the production build under /3Doku/ instead of the domain root.
  const texture = useTexture(spriteUrl ?? `${import.meta.env.BASE_URL}piece.png`);
  const height = 1.05;
  const width = height * ASPECT;

  return (
    <Billboard position={position}>
      {/* soft color-coded glow disc under the character, ties it to its region */}
      <mesh position={[0, -height / 2 + 0.06, -0.01]}>
        <circleGeometry args={[width * 0.55, 32]} />
        <meshBasicMaterial color={conflict ? '#ff3b5c' : color} transparent opacity={0.35} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          map={texture}
          transparent
          alphaTest={0.15}
          emissive={conflict ? '#ff3b5c' : '#000000'}
          emissiveIntensity={conflict ? 0.8 : 0}
        />
      </mesh>
    </Billboard>
  );
}

interface EliminatedMarkProps {
  position: [number, number, number];
  invalid?: boolean;
}

export function EliminatedMark({ position, invalid }: EliminatedMarkProps) {
  const color = invalid ? '#ff3b5c' : '#5a5a72';
  const size = invalid ? 0.62 : 0.5;
  const opacity = invalid ? 0.95 : 0.55;
  return (
    <group position={position}>
      <RoundedBox args={[size, 0.06, 0.09]} rotation={[-Math.PI / 2, 0, Math.PI / 4]} radius={0.02}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={invalid ? 0.9 : 0}
          transparent
          opacity={opacity}
        />
      </RoundedBox>
      <RoundedBox args={[size, 0.06, 0.09]} rotation={[-Math.PI / 2, 0, -Math.PI / 4]} radius={0.02}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={invalid ? 0.9 : 0}
          transparent
          opacity={opacity}
        />
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
