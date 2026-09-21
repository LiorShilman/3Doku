import { useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { Environment, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { EffectComposer, Bloom, BrightnessContrast, HueSaturation, Vignette } from '@react-three/postprocessing';
import { Board, CELL_SPACING } from './Board';
import { useGameStore } from '../store/gameStore';
import { orbitControlsHandle } from './orbitControlsHandle';

const BASE_FOV = 42;
const BASE_POSITION = new THREE.Vector3(0, 7.5, 7);
const BASE_DISTANCE = BASE_POSITION.length();
const CAMERA_DIRECTION = BASE_POSITION.clone().normalize();

// This camera distance was tuned against the board's old, tighter cell
// spacing. Board.tsx's CELL_SPACING has since grown (visible grid gaps) -
// the board is now physically wider for every board size, so the distance
// needs the same proportional bump or every board would read as more
// zoomed-in/cropped than before, for a reason that has nothing to do with
// aspect ratio or board size.
const REFERENCE_SPACING = 1.08;
const SPACING_SCALE = CELL_SPACING / REFERENCE_SPACING;

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

// A perspective camera's sense of "3D depth" comes from how much nearer
// geometry is magnified relative to farther geometry - and that effect
// shrinks the farther the camera sits from its subject, approaching a flat/
// orthographic look at extreme distances. The old fit logic handled every
// "need to see more of the board" case (narrow aspect, bigger board) purely
// by dollying the camera back, which fits the content but also flattens the
// perspective - on a big 9x9 board viewed on a narrow phone screen (both
// effects compounding), the camera ended up so far away the board read as a
// flat top-down grid with no visible depth, exactly the reported symptom.
// Prefer widening the FOV instead (up to a cap where wide-angle distortion
// itself would look bad) - it fits the same content while keeping the
// camera close enough to still look like a 3D scene. Only dolly back for
// whatever "fit" is still needed beyond that cap.
const MAX_FOV = 62;

// The canvas fills the entire screen behind the HUD overlay (the menu/stats
// panels aren't part of the 3D scene, just CSS on top of it) - so the
// board's on-screen position is set purely by where the camera aims, not by
// any layout box. Aiming a bit above the board's actual center (rather than
// dead center) pushes its rendered position down within the frame, giving
// it visual breathing room below the HUD instead of crowding right up
// against it.
const LOOK_AT_Y_OFFSET = 1.1;
const ORBIT_TARGET: [number, number, number] = [0, LOOK_AT_Y_OFFSET, 0];

// The board's actual front edge, in world space - Board.tsx's platform is
// boardSize*CELL_SPACING+0.6 wide/deep, centered on the origin, so its
// near/front corner (closest to the camera, which is what renders lowest on
// screen under this camera angle) sits at half that depth along +Z.
function boardFrontEdgeWorldPoint(boardSize: number): THREE.Vector3 {
  const platformDepth = boardSize * CELL_SPACING + 0.6;
  return new THREE.Vector3(0, 0, platformDepth / 2);
}

// The HUD (menu, stats, the new-Pokemon banner) is plain DOM markup drawn
// over a full-screen <canvas> - it has no layout relationship to the board
// at all, since the board is just pixels the canvas happened to paint there.
// Anything in that DOM layer that needs to visually anchor to the board (the
// banner, previously just `bottom: 30px` from the screen edge, which read as
// disconnected from the board on any screen where the board doesn't end up
// exactly there) needs the board's actual current screen position - found by
// projecting its front-edge world point through the live camera, the same
// way the GPU itself turns that point into a pixel.
function projectBoardBottomScreenY(camera: THREE.Camera, size: { height: number }, boardSize: number): number {
  const ndc = boardFrontEdgeWorldPoint(boardSize).project(camera);
  return ((1 - ndc.y) / 2) * size.height;
}

function ResponsiveCamera() {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const boardSize = useGameStore((s) => s.puzzle?.size ?? REFERENCE_SIZE);
  useEffect(() => {
    const aspect = size.width / size.height;
    const aspectScale = aspect < 1 ? FIT_MARGIN / aspect : 1;
    // Board.tsx's platform is boardSize*CELL_SPACING wide - fit further
    // than the aspect-only scale whenever that's bigger than what this
    // camera was tuned for, so an 8x8/9x9 board isn't cropped.
    const boardScale = Math.max(1, boardSize / REFERENCE_SIZE);
    const totalScale = aspectScale * boardScale;

    const baseHalfFovRad = (BASE_FOV * Math.PI) / 360;
    const desiredHalfFovRad = Math.atan(Math.tan(baseHalfFovRad) * totalScale);
    const desiredFov = (desiredHalfFovRad * 360) / Math.PI;
    const fov = Math.min(MAX_FOV, desiredFov);
    const fovHalfRad = (fov * Math.PI) / 360;
    // Whatever scale the capped FOV can't cover on its own is made up by
    // dollying back the remainder, same as before, just starting from a
    // closer baseline.
    const remainingScale = Math.tan(desiredHalfFovRad) / Math.tan(fovHalfRad);

    camera.fov = fov;
    camera.position.copy(CAMERA_DIRECTION).multiplyScalar(BASE_DISTANCE * remainingScale * SPACING_SCALE);
    camera.lookAt(0, LOOK_AT_Y_OFFSET, 0);
    camera.updateProjectionMatrix();

    useGameStore.getState().setBoardBottomScreenY(projectBoardBottomScreenY(camera, size, boardSize));
  }, [size, camera, boardSize]);

  // Also reset once the 3D view goes away (switched to 2D, or navigated off
  // the game screen) - otherwise the banner would keep anchoring to wherever
  // the board last was in 3D even after it's no longer on screen.
  useEffect(() => () => useGameStore.getState().setBoardBottomScreenY(null), []);
  return null;
}

// OrbitControls lets the player freely rotate/zoom the view by dragging -
// which moves the board's on-screen position just as much as a resize does,
// so the same projection needs to re-run on every such change too, not just
// on mount/resize. Wired as its own component (rather than inline in Scene)
// since it needs useThree/the store, which only work inside the Canvas tree.
function ControlledOrbit({ isMarkDragging }: { isMarkDragging: boolean }) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  const boardSize = useGameStore((s) => s.puzzle?.size ?? REFERENCE_SIZE);
  return (
    <OrbitControls
      ref={(controls) => {
        orbitControlsHandle.current = controls;
      }}
      target={ORBIT_TARGET}
      enabled={!isMarkDragging}
      enablePan={false}
      minDistance={4.5}
      maxDistance={45}
      minPolarAngle={Math.PI / 6}
      maxPolarAngle={Math.PI / 2.3}
      onChange={() => useGameStore.getState().setBoardBottomScreenY(projectBoardBottomScreenY(camera, size, boardSize))}
    />
  );
}

export function Scene() {
  const isMarkDragging = useGameStore((s) => s.isMarkDragging);

  return (
    <Canvas
      shadows
      // R3F's own default is [1, 2] - it caps render resolution at 2x device
      // pixel ratio no matter what the screen actually is. That's a no-op on
      // a ~2x-DPR Android phone, but an iPhone Pro-line display is natively
      // 3x ("Retina") - the same cap throws away a third of its real
      // resolution, which is exactly why the higher-res phone rendered
      // visibly softer/blurrier than a lower-res one.
      dpr={[1, 3]}
      gl={{ antialias: true, toneMappingExposure: 0.85 }}
      onCreated={({ scene }) => {
        scene.fog = null;
      }}
    >
      <PerspectiveCamera makeDefault position={BASE_POSITION} fov={BASE_FOV} />
      <ResponsiveCamera />
      <color attach="background" args={['#0a0a12']} />
      {/* Real HDR image-based lighting - unlike a flat ambientLight (uniform
          brightness from every direction, which is what "flat, no life"
          ultimately comes from at the lighting level), an HDR environment
          map lights each surface differently depending on which way it
          faces, and gives even a low-metalness material like the cells a
          believable, rich ambient response instead of a single flat fill
          tone. background={false} (the default) means it only lights the
          scene - it doesn't replace the dark backdrop behind the board.
          Self-hosted (not drei's `preset` shorthand) - that fetches its HDR
          file live from a third-party CDN (raw.githack.com) at runtime,
          which failed with a 401 during testing and blanked the entire
          board (an env map load failure isn't caught gracefully - it took
          the whole scene down). Serving our own copy removes that
          production-availability risk entirely, same as every other asset
          (Pokemon sprites, piece.png) this game already self-hosts. */}
      <Environment files={`${import.meta.env.BASE_URL}env/city_1k.hdr`} environmentIntensity={0.6} />
      <ambientLight intensity={0.2} />
      <directionalLight
        position={[4, 8, 3]}
        intensity={1.1}
        // Was a cool blue-white (#c9d4ff) - any colored light tints every
        // material's true color toward it, which cools/dulls warm hues
        // (red, orange, pink in the region palette) toward violet and
        // mutes how vivid they read, regardless of how saturated the
        // underlying color actually is. Neutral white lets each region's
        // real palette color come through as authored.
        color="#ffffff"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0015}
        shadow-normalBias={0.02}
      >
        {/* Three.js's default shadow-camera frustum is only ±5 units - too
            small for an 8x8/9x9 board (up to ~10.8 units across at the
            current CELL_SPACING), so shadows for the outer cells were
            silently clipped and never rendered at all. The ±8 frustum below
            still comfortably covers that. mapSize is bumped from the
            default 512 for less blocky penumbra edges at this larger frustum.
            bias/normalBias avoid shadow acne on the RoundedBox geometry
            (rounded/curved surfaces are especially prone to a mesh
            self-shadowing its own surface without this, which reads as a
            dark blotchy overlay rather than a clean contact shadow). */}
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.5, 30]} />
      </directionalLight>
      <pointLight position={[-4, 3, -3]} intensity={0.5} color="#7a5cff" />

      <Board />

      {/* OrbitControls owns the camera's aim point once mounted - it
          recomputes the camera's orientation from its own `target` every
          frame, which was silently overwriting ResponsiveCamera's one-time
          camera.lookAt() call right back to the default (0,0,0) on the very
          next frame. The board's on-screen vertical position has to be set
          via `target` here, not via lookAt. */}
      <ControlledOrbit isMarkDragging={isMarkDragging} />

      <EffectComposer>
        {/* A low luminanceThreshold makes Bloom pick up on the cells' own
            base color, not just genuinely bright highlights (pieces' glow,
            hint rings) - that reads as the whole board blooming pale/washed
            out on top of an already-bright material (see Cell.tsx's
            emissiveIntensity history). Raised further and intensity trimmed
            so Bloom only catches real highlights again. */}
        <Bloom intensity={0.35} luminanceThreshold={0.75} luminanceSmoothing={0.3} mipmapBlur />
        {/* All the earlier rounds (lighting color, emissive, environment map)
            were trying to reach "vivid" through physically-based lighting -
            realistic lighting inherently desaturates compared to a flat-lit
            source color, which is exactly why it kept reading as not vivid
            enough no matter how that lighting was tuned. A punchy "TV vivid
            mode" look is itself a deliberate, unrealistic post-process
            boost (every TV's vivid picture mode works this way) - applying
            it in screen space after lighting is the correct tool for this,
            not another lighting tweak. */}
        <HueSaturation saturation={0.45} />
        <BrightnessContrast contrast={0.12} brightness={0} />
        <Vignette eskil={false} offset={0.15} darkness={0.6} />
      </EffectComposer>
    </Canvas>
  );
}
