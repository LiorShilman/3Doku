import { useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { Board } from './Board';
import { useGameStore } from '../store/gameStore';
import { orbitControlsHandle } from './orbitControlsHandle';

const BASE_FOV = 42;
const BASE_POSITION = new THREE.Vector3(0, 7.5, 7);
const BASE_DISTANCE = BASE_POSITION.length();
const CAMERA_DIRECTION = BASE_POSITION.clone().normalize();

// The size this camera distance/FOV was actually tuned and tested against -
// boards up to 7x7 (the max size for most of this project). Sizes beyond
// that (8x8, 9x9, added later) are physically bigger boards that this same
// fixed distance crops the edges of; only used as a floor (via Math.max
// below) so 5x5/6x6/7x7 keep their already-fine framing unchanged.
const REFERENCE_SIZE = 7;

// A tall/narrow (portrait phone) viewport has a much smaller aspect ratio. At a
// fixed fov and distance, the board's world-space width no longer fits the
// horizontal frame (fov is always vertical in three.js, so horizontal coverage
// shrinks with aspect) - it reads zoomed-in and cropped on a phone. Dollying the
// camera back as aspect drops below 1 keeps the board's full width in frame on
// any screen shape; the extra vertical room that appears is normal letterboxing
// for a squarish board on a much taller viewport, same as any "fit" scaling.
// No cap on the scale itself - fullscreen on a phone (browser chrome hidden)
// can be an even taller ratio than the normal in-browser view, and capping it
// let the board crop past the edges right when the user asked for fullscreen.
// A small 1.08x margin keeps a visible frame instead of the board touching the
// screen edges exactly.
const FIT_MARGIN = 1.08;

function ResponsiveCamera() {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  const boardSize = useGameStore((s) => s.puzzle?.size ?? REFERENCE_SIZE);
  useEffect(() => {
    const aspect = size.width / size.height;
    const aspectScale = aspect < 1 ? FIT_MARGIN / aspect : 1;
    // Board.tsx's platform is boardSize*CELL_SPACING wide - dolly back
    // further than the aspect-only scale whenever that's bigger than what
    // this camera was tuned for, so an 8x8/9x9 board isn't cropped.
    const boardScale = Math.max(1, boardSize / REFERENCE_SIZE);
    camera.position.copy(CAMERA_DIRECTION).multiplyScalar(BASE_DISTANCE * aspectScale * boardScale);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [size, camera, boardSize]);
  return null;
}

export function Scene() {
  const isMarkDragging = useGameStore((s) => s.isMarkDragging);

  return (
    <Canvas
      shadows
      gl={{ antialias: true }}
      onCreated={({ scene }) => {
        scene.fog = null;
      }}
    >
      <PerspectiveCamera makeDefault position={BASE_POSITION} fov={BASE_FOV} />
      <ResponsiveCamera />
      <color attach="background" args={['#0a0a12']} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 8, 3]} intensity={1.1} color="#c9d4ff" castShadow />
      <pointLight position={[-4, 3, -3]} intensity={0.5} color="#7a5cff" />

      <Board />

      <OrbitControls
        ref={(controls) => {
          orbitControlsHandle.current = controls;
        }}
        enabled={!isMarkDragging}
        enablePan={false}
        minDistance={4.5}
        maxDistance={45}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.3}
      />

      <EffectComposer>
        {/* Bloom's exact look (especially at low luminanceThreshold, where it
            picks up on the cells' own base color, not just bright highlights
            like hint rings) turned out to render visibly washed-out on at
            least one real Android GPU (Mali) despite looking correct in
            every Chromium desktop/emulated test - post-processing shader
            precision is one of the few things that can genuinely differ
            across GPU vendors even on the same browser engine. Raising the
            threshold keeps bloom for genuinely bright things (pieces' glow,
            hint rings) without it also blooming - and thereby washing out -
            the cell colors themselves. */}
        <Bloom intensity={0.5} luminanceThreshold={0.55} luminanceSmoothing={0.3} mipmapBlur />
        <Vignette eskil={false} offset={0.15} darkness={0.6} />
      </EffectComposer>
    </Canvas>
  );
}
