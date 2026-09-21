import { useState } from 'react';
import { RoundedBox } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { colorForRegion } from './palette';

interface CellProps {
  position: [number, number, number];
  region: number;
  onPointerDownCell: (e: ThreeEvent<PointerEvent>) => void;
  onPointerEnterCell: (e: ThreeEvent<PointerEvent>) => void;
}

export function Cell({ position, region, onPointerDownCell, onPointerEnterCell }: CellProps) {
  const [hovered, setHovered] = useState(false);
  const color = colorForRegion(region);

  return (
    <RoundedBox
      args={[0.94, 0.22, 0.94]}
      radius={0.06}
      position={position}
      receiveShadow
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDownCell(e);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        onPointerEnterCell(e);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <meshStandardMaterial
        color={color}
        emissive={color}
        // Emissive light is flat by nature - it isn't affected by the
        // surface normal or the light's angle, so it adds the same
        // brightness to every pixel of the cell's top face regardless of
        // shading. At 0.3 (bumped up from 0.22 in an earlier round to fight
        // muted colors) it was strong enough to wash out the real diffuse
        // shading from the directional light - which is exactly what read
        // as both "too bright" AND "flat" at once: the actual shading that
        // would show depth was being drowned out by this flat glow. Pulled
        // back down so the board's real per-face lighting (which does vary
        // with angle, and now actually matters since shadows/exposure were
        // fixed elsewhere) carries the depth instead of a uniform glow.
        emissiveIntensity={hovered ? 0.38 : 0.2}
        roughness={0.4}
        metalness={0.08}
      />
    </RoundedBox>
  );
}
