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
        // 0.55/0.85 (tried first) pushed bright channels toward white -
        // Bloom picks up on that overexposure and glows the whole board pale
        // instead of making the color read as more saturated. This is a
        // smaller bump from the original 0.22/0.5 - enough to stop ambient/
        // directional lighting from muting the color without blowing it out.
        emissiveIntensity={hovered ? 0.55 : 0.3}
        roughness={0.4}
        metalness={0.08}
        // Skips the renderer's tone-mapping curve for this material specifically,
        // so its displayed color is a direct, deterministic function of `color` -
        // not run through a tone-mapping implementation whose exact numerical
        // behavior isn't guaranteed identical across every GPU/driver.
        toneMapped={false}
      />
    </RoundedBox>
  );
}
