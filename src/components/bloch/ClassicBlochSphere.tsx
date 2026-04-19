import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line, Html } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Interactive Bloch sphere in the style of the bits-and-electrons
 * simulator (https://github.com/bits-and-electrons/bloch-sphere-simulator).
 * Ported from their vanilla Three.js reference into React Three Fiber so
 * it composes into Nuclei's panel layout, stays type-safe, and reacts to
 * state flowing out of the Python kernel.
 *
 * Conventions preserved from the reference:
 *   Z axis (blue)  → |0⟩ (top) / |1⟩ (bottom)
 *   X axis (red)   → |+⟩ / |−⟩
 *   Y axis (green) → |+i⟩ / |−i⟩
 *
 * Kernel bloch_coords are already Cartesian components of the Bloch
 * vector, so no conversion is required — the arrow points from origin
 * to (x, y, z). A length shorter than 1 signals a mixed / entangled
 * reduced state (also shown in the readout).
 */

// Axis colors lifted from the reference so our sphere reads the same.
const AXIS_X_COLOR = '#e05252';
const AXIS_Y_COLOR = '#3ddc84';
const AXIS_Z_COLOR = '#4a9eff';

const STATE_COLOR = '#00e5ff';
const WIRE_COLOR = '#42506a';
const EQUATOR_COLOR = '#5b6d8a';
const LABEL_COLOR = '#cdd6e2';

interface BlochCoord {
  x: number;
  y: number;
  z: number;
}

interface ClassicBlochSphereProps {
  coord?: BlochCoord | null;
  qubitLabel?: string;
  /** Pixel size of the canvas; parent is expected to clip if needed. */
  size?: number;
}

function axisPoints(dir: 'x' | 'y' | 'z', extent: number): [THREE.Vector3, THREE.Vector3] {
  if (dir === 'x') return [new THREE.Vector3(-extent, 0, 0), new THREE.Vector3(extent, 0, 0)];
  if (dir === 'y') return [new THREE.Vector3(0, -extent, 0), new THREE.Vector3(0, extent, 0)];
  return [new THREE.Vector3(0, 0, -extent), new THREE.Vector3(0, 0, extent)];
}

function equatorPoints(segments = 96): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(t), 0, Math.sin(t)));
  }
  return pts;
}

function meridianPoints(segments = 96): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(0, Math.cos(t), Math.sin(t)));
  }
  return pts;
}

function StateArrow({ coord }: { coord: BlochCoord }) {
  // Render the vector as a thick line from origin to the tip plus a small
  // sphere at the tip so the state is visible at any camera angle.
  const tip = useMemo(() => new THREE.Vector3(coord.x, coord.z, coord.y), [coord]);
  // Note: we rebind kernel (x, y, z) → three's (x, z, y) so that the
  // kernel's z-axis (which holds |0⟩/|1⟩) points up in world space.
  const len = tip.length();
  return (
    <group>
      <Line
        points={[new THREE.Vector3(0, 0, 0), tip]}
        color={STATE_COLOR}
        lineWidth={2.5}
      />
      <mesh position={tip}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshStandardMaterial
          color={STATE_COLOR}
          emissive={STATE_COLOR}
          emissiveIntensity={0.8}
          roughness={0.3}
        />
      </mesh>
      {/* Cap of the arrow — tiny disk so the vector looks terminated. */}
      {len > 0.02 && (
        <mesh position={tip.clone().multiplyScalar(0.97)}>
          <sphereGeometry args={[0.022, 12, 12]} />
          <meshBasicMaterial color={STATE_COLOR} />
        </mesh>
      )}
    </group>
  );
}

function AxisLine({
  dir,
  color,
  label,
}: {
  dir: 'x' | 'y' | 'z';
  color: string;
  label: string;
}) {
  const [start, end] = axisPoints(dir, 1.15);
  // Tight label offset — the camera framing is finite, and pushing labels
  // too far past the axis tip clips them on narrow rail widths.
  const labelPos = end.clone().multiplyScalar(1.08);
  return (
    <group>
      <Line points={[start, end]} color={color} lineWidth={1.2} />
      <Html
        position={labelPos}
        center
        zIndexRange={[10, 0]}
        style={{
          color,
          fontFamily: "'Geist Sans', sans-serif",
          fontSize: 11,
          fontWeight: 600,
          pointerEvents: 'none',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          opacity: 0.95,
        }}
      >
        {label}
      </Html>
    </group>
  );
}

export function ClassicBlochSphere({
  coord,
  qubitLabel,
  size,
}: ClassicBlochSphereProps) {
  const equator = useMemo(() => equatorPoints(), []);
  const meridianA = useMemo(() => meridianPoints(), []);
  const meridianB = useMemo(() => {
    // Rotate the second meridian 90° around the vertical (world-Y) axis
    // to give the sphere a recognizable wireframe without overdrawing.
    return meridianPoints().map(
      (p) => new THREE.Vector3(p.z, p.y, -p.x),
    );
  }, []);

  const containerStyle: React.CSSProperties = size
    ? { width: size, height: size }
    : { width: '100%', height: '100%' };

  return (
    <div style={{ ...containerStyle, position: 'relative' }}>
      <Canvas
        dpr={[1, 2]}
        // Framing sized so a sphere of radius 1 plus axis/basis labels at
        // ~1.22 never clip vertically, even at narrow-rail aspect ratios.
        // Distance ≈ 4.07, fov 45° → vertical half-extent ≈ 1.69 at origin.
        camera={{ position: [2.6, 1.7, 2.6], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 4, 5]} intensity={0.65} />

        {/* Translucent sphere shell — gives subtle depth without hiding the arrow. */}
        <mesh>
          <sphereGeometry args={[1, 48, 48]} />
          <meshBasicMaterial
            color="#0d1520"
            transparent
            opacity={0.18}
            side={THREE.BackSide}
          />
        </mesh>

        {/* Wireframe: equator + two meridians. */}
        <Line points={equator} color={EQUATOR_COLOR} lineWidth={0.8} />
        <Line points={meridianA} color={WIRE_COLOR} lineWidth={0.6} />
        <Line points={meridianB} color={WIRE_COLOR} lineWidth={0.6} />

        {/* Cartesian axes: note world-Y is kernel-Z so |0⟩ reads as up. */}
        <AxisLine dir="y" color={AXIS_Z_COLOR} label="Z" />
        <AxisLine dir="x" color={AXIS_X_COLOR} label="X" />
        <AxisLine dir="z" color={AXIS_Y_COLOR} label="Y" />

        {/* Basis state labels at the poles. Rendered as DOM overlays via
            drei <Html> so we don't depend on any external font load (which
            drei <Text> does — and that CDN fetch fails in a Tauri bundle). */}
        <Html
          position={[0, 1.22, 0]}
          center
          zIndexRange={[10, 0]}
          style={{
            color: LABEL_COLOR,
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 11,
            fontWeight: 500,
            pointerEvents: 'none',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          |0⟩
        </Html>
        <Html
          position={[0, -1.22, 0]}
          center
          zIndexRange={[10, 0]}
          style={{
            color: LABEL_COLOR,
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 11,
            fontWeight: 500,
            pointerEvents: 'none',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          |1⟩
        </Html>

        {/* State vector. */}
        {coord && <StateArrow coord={coord} />}

        <OrbitControls
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          // Clamp zoom so labels stay inside the view. minDistance just past
          // the sphere surface; maxDistance wide enough for comfortable
          // overview but short enough to keep the state arrow visible.
          minDistance={2.2}
          maxDistance={6.5}
          rotateSpeed={0.8}
          target={[0, 0, 0]}
        />
      </Canvas>
      {qubitLabel && (
        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: 6,
            color: LABEL_COLOR,
            opacity: 0.72,
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 11,
            letterSpacing: 0.3,
            pointerEvents: 'none',
          }}
        >
          {qubitLabel}
        </div>
      )}
    </div>
  );
}
