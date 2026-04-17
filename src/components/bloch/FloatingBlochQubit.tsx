import { useRef, useState, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshTransmissionMaterial, Float, Html } from '@react-three/drei';
import { damp, damp3 } from 'maath/easing';
import {
  Vector3,
  Group,
  Mesh,
  Color,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
} from 'three';

const TEAL = new Color('#00B4D8');
const TEAL_LIGHT = new Color('#48CAE4');

interface BlochCoord { x: number; y: number; z: number }

interface FloatingBlochQubitProps {
  qubit: BlochCoord;
  index: number;
  targetPosition: Vector3;
  selected: boolean;
  reducedMotion: boolean;
  /** true while a recently-added gate touches this qubit — triggers a one-shot tilt */
  gateReaction?: boolean;
  /** fades others when a different qubit is grabbed */
  dimmed?: boolean;
  onSelect: () => void;
}

/**
 * One quantum qubit rendered as a frosted glass sphere with an emissive
 * state arrow. Reacts to hover, drag-to-inspect, and gate edits.
 *
 * Physics-honest: arrow length equals |Bloch vector|. Pure states → full
 * length. Entanglement shrinks the arrow toward the origin naturally,
 * because that's what the reduced density matrix says.
 */
export function FloatingBlochQubit({
  qubit,
  index,
  targetPosition,
  selected,
  reducedMotion,
  gateReaction = false,
  dimmed = false,
  onSelect,
}: FloatingBlochQubitProps) {
  const groupRef = useRef<Group>(null);
  const arrowRef = useRef<Group>(null);
  const sphereRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const grabOffsetRef = useRef(new Vector3());
  const arrowTargetRef = useRef(new Vector3());
  const tiltUntilRef = useRef(0);
  const ambientScaleRef = useRef(0);

  // Bloch convention → Three.js axis remap: x→x, z→y (up is |0⟩), y→z.
  // Update the ref in an effect so we're never touching ref.current during render.
  useEffect(() => {
    arrowTargetRef.current.set(qubit.x, qubit.z, qubit.y);
  }, [qubit.x, qubit.y, qubit.z]);

  // One-shot gate-reaction timer — 500 ms tilt window.
  useEffect(() => {
    if (gateReaction) tiltUntilRef.current = performance.now() + 500;
  }, [gateReaction]);

  const arrowLen = Math.hypot(qubit.x, qubit.y, qubit.z);

  useFrame((_, delta) => {
    const group = groupRef.current;
    const arrow = arrowRef.current;
    const sphere = sphereRef.current;
    if (!group || !arrow || !sphere) return;

    // Spring to constellation slot (plus a lift toward camera when grabbed)
    const lift = grabbing ? 0.6 : 0;
    const target = targetPosition.clone().add(grabOffsetRef.current.clone().multiplyScalar(grabbing ? 1 : 0));
    target.z += lift;

    if (reducedMotion) {
      group.position.copy(target);
    } else {
      damp3(group.position, [target.x, target.y, target.z], 0.18, delta);
    }

    // Arrow orientation & length spring toward current bloch vector
    const targetVec = arrowTargetRef.current;
    const targetLength = Math.max(0.001, targetVec.length());
    const normalized = targetVec.clone().normalize();
    arrow.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normalized);
    damp(arrow.scale, 'y', targetLength, reducedMotion ? 0.0001 : 0.2, delta);

    // Gate-reaction tilt: briefly lean the sphere toward the camera
    const now = performance.now();
    const tiltActive = now < tiltUntilRef.current;
    const desiredTilt = tiltActive ? 0.14 : 0;
    damp(group.rotation, 'x', desiredTilt, 0.12, delta);

    // Hover scale
    const hoverScale = hovered || grabbing ? 1.06 : 1;
    damp(sphere.scale, 'x', hoverScale, 0.12, delta);
    damp(sphere.scale, 'y', hoverScale, 0.12, delta);
    damp(sphere.scale, 'z', hoverScale, 0.12, delta);

    // Ambient emissive pulse — very subtle, frame-rate independent
    ambientScaleRef.current += delta;
    const pulse = 0.3 + 0.12 * Math.sin(ambientScaleRef.current * 2.6);
    const emissive = (sphere.material as { emissiveIntensity?: number }).emissiveIntensity;
    if (emissive !== undefined) {
      (sphere.material as { emissiveIntensity: number }).emissiveIntensity = reducedMotion ? 0.3 : pulse;
    }
  });

  // Arrow geometries built once per instance
  const { shaftGeo, coneGeo, tipGeo } = useMemo(() => {
    const shaft = new CylinderGeometry(0.02, 0.02, 1, 10);
    shaft.translate(0, 0.5, 0);
    const cone = new ConeGeometry(0.06, 0.14, 14);
    cone.translate(0, 1.07, 0);
    const tip = new SphereGeometry(0.05, 16, 16);
    tip.translate(0, 1.07, 0);
    return { shaftGeo: shaft, coneGeo: cone, tipGeo: tip };
  }, []);

  const opacity = dimmed ? 0.35 : 1;

  return (
    <Float
      speed={reducedMotion ? 0 : 0.6}
      floatIntensity={reducedMotion ? 0 : 0.15}
      rotationIntensity={reducedMotion ? 0 : 0.05}
    >
      <group
        ref={groupRef}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'grab'; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}
        onPointerDown={(e) => {
          e.stopPropagation();
          setGrabbing(true);
          document.body.style.cursor = 'grabbing';
          (e.target as Element)?.setPointerCapture?.(e.pointerId);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          const wasQuick = !hovered || !grabbing;
          setGrabbing(false);
          document.body.style.cursor = 'grab';
          if (wasQuick) onSelect();
        }}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        {/* Frosted glass sphere — the qubit shell */}
        <mesh ref={sphereRef}>
          <sphereGeometry args={[1, 48, 48]} />
          <MeshTransmissionMaterial
            transmission={0.92}
            thickness={0.4}
            roughness={0.22}
            chromaticAberration={0.06}
            anisotropicBlur={0.18}
            distortion={0.1}
            distortionScale={0.2}
            temporalDistortion={reducedMotion ? 0 : 0.1}
            color={new Color('#0F1B2D')}
            attenuationColor={TEAL}
            attenuationDistance={2.4}
            ior={1.3}
            transparent
            opacity={opacity}
          />
        </mesh>

        {/* Inner glow sphere — small, emissive, sits at the origin */}
        <mesh>
          <sphereGeometry args={[0.22, 24, 24]} />
          <meshBasicMaterial color={TEAL} transparent opacity={0.22 * opacity} />
        </mesh>

        {/* State arrow */}
        <group ref={arrowRef} scale={[1, arrowLen, 1]}>
          <mesh geometry={shaftGeo}>
            <meshStandardMaterial
              color={TEAL}
              emissive={TEAL}
              emissiveIntensity={1.2}
              transparent
              opacity={opacity}
            />
          </mesh>
          <mesh geometry={coneGeo}>
            <meshStandardMaterial
              color={TEAL_LIGHT}
              emissive={TEAL_LIGHT}
              emissiveIntensity={1.6}
              transparent
              opacity={opacity}
            />
          </mesh>
          <mesh geometry={tipGeo}>
            <meshBasicMaterial color={'#ffffff'} transparent opacity={0.85 * opacity} />
          </mesh>
        </group>

        {/* Qubit label — anchored to the bottom of the sphere as an Html overlay */}
        <Html
          position={[0, -1.25, 0]}
          center
          distanceFactor={6}
          style={{
            pointerEvents: 'none',
            color: selected ? '#00B4D8' : '#94A3B8',
            fontFamily: "'Fira Code', monospace",
            fontSize: 11,
            fontWeight: 600,
            textShadow: '0 0 8px rgba(0,180,216,0.4)',
            whiteSpace: 'nowrap',
            opacity,
          }}
        >
          q{index}
        </Html>
      </group>
    </Float>
  );
}
