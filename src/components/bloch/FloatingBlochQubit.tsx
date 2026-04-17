import { useRef, useState, useMemo, useEffect } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Float, Html } from '@react-three/drei';
import { damp, damp3 } from 'maath/easing';
import {
  Vector3,
  Group,
  Mesh,
  Color,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MeshBasicMaterial,
} from 'three';

const TEAL = new Color('#00B4D8');
const TEAL_LIGHT = new Color('#48CAE4');
const SHELL_COLOR = new Color('#0B1828');

interface BlochCoord { x: number; y: number; z: number }

interface FloatingBlochQubitProps {
  qubit: BlochCoord;
  index: number;
  targetPosition: Vector3;
  selected: boolean;
  reducedMotion: boolean;
  gateReaction?: boolean;
  dimmed?: boolean;
  onSelect: () => void;
}

/**
 * One qubit as a translucent shell with an inner emissive state arrow.
 *
 * Layer order (outer → inner):
 *   SlotGroup    — position in the constellation (damped toward target)
 *     Float      — ambient drift, runs in its own subtree so it doesn't
 *                  fight the slot-position damping
 *       Content  — sphere + arrow + label, hover/scale happen here
 *
 * Splitting Float out of the damped group is what fixes the "jittery"
 * look — two parents writing to the same transform was the bug.
 *
 * Material: MeshPhysicalMaterial with a small transmission value +
 * clearcoat. Cheaper than MeshTransmissionMaterial, reads cleaner at
 * IDE panel scale, still holds "glass."
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
  const slotRef = useRef<Group>(null);
  const contentRef = useRef<Group>(null);
  const arrowRef = useRef<Group>(null);
  const sphereRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const pressedAtRef = useRef(0);
  const arrowTargetRef = useRef(new Vector3());
  const tiltUntilRef = useRef(0);
  const ambientTimeRef = useRef(0);

  // Bloch → Three.js axis remap (x→x, z→y up, y→z).
  useEffect(() => {
    arrowTargetRef.current.set(qubit.x, qubit.z, qubit.y);
  }, [qubit.x, qubit.y, qubit.z]);

  useEffect(() => {
    if (gateReaction) tiltUntilRef.current = performance.now() + 480;
  }, [gateReaction]);

  const arrowLen = Math.hypot(qubit.x, qubit.y, qubit.z);

  // Materials built once, reused across renders
  const { shellMaterial, arrowShaftMat, arrowConeMat, tipMaterial, coreMat } = useMemo(() => ({
    shellMaterial: new MeshPhysicalMaterial({
      color: SHELL_COLOR,
      metalness: 0.0,
      roughness: 0.35,
      transmission: 0.55,
      thickness: 0.35,
      ior: 1.25,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
      attenuationColor: TEAL,
      attenuationDistance: 2.8,
      transparent: true,
      opacity: 0.95,
    }),
    arrowShaftMat: new MeshStandardMaterial({
      color: TEAL,
      emissive: TEAL,
      emissiveIntensity: 1.1,
      metalness: 0.2,
      roughness: 0.35,
      toneMapped: false,
    }),
    arrowConeMat: new MeshStandardMaterial({
      color: TEAL_LIGHT,
      emissive: TEAL_LIGHT,
      emissiveIntensity: 1.6,
      metalness: 0.2,
      roughness: 0.3,
      toneMapped: false,
    }),
    tipMaterial: new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
    }),
    coreMat: new MeshBasicMaterial({
      color: TEAL,
      transparent: true,
      opacity: 0.16,
      toneMapped: false,
    }),
  }), []);

  const { shaftGeo, coneGeo, tipGeo } = useMemo(() => {
    const shaft = new CylinderGeometry(0.022, 0.022, 1, 12);
    shaft.translate(0, 0.5, 0);
    const cone = new ConeGeometry(0.07, 0.17, 16);
    cone.translate(0, 1.08, 0);
    const tip = new SphereGeometry(0.052, 16, 16);
    tip.translate(0, 1.08, 0);
    return { shaftGeo: shaft, coneGeo: cone, tipGeo: tip };
  }, []);

  useFrame((_, delta) => {
    const slot = slotRef.current;
    const content = contentRef.current;
    const arrow = arrowRef.current;
    const sphere = sphereRef.current;
    if (!slot || !content || !arrow || !sphere) return;

    // Slot group handles constellation position. Grab adds a forward lift
    // in the z-axis (toward the camera at z+5).
    const lift = grabbing ? 0.6 : 0;
    if (reducedMotion) {
      slot.position.set(targetPosition.x, targetPosition.y, targetPosition.z + lift);
    } else {
      damp3(slot.position, [targetPosition.x, targetPosition.y, targetPosition.z + lift], 0.22, delta);
    }

    // Arrow orientation + length driven by the current Bloch vector
    const targetVec = arrowTargetRef.current;
    const len = Math.max(0.001, targetVec.length());
    arrow.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), targetVec.clone().normalize());
    damp(arrow.scale, 'y', len, reducedMotion ? 0.0001 : 0.22, delta);

    // Content group holds the gate-reaction tilt — applied to the inner
    // sub-tree so Float's ambient drift isn't overwritten.
    const tiltActive = performance.now() < tiltUntilRef.current;
    damp(content.rotation, 'x', tiltActive && !reducedMotion ? 0.12 : 0, 0.14, delta);

    // Hover scale on the sphere only — not the whole group — so the label
    // and arrow tip don't move when hovered.
    const hoverScale = hovered || grabbing ? 1.05 : 1;
    damp(sphere.scale, 'x', hoverScale, 0.12, delta);
    damp(sphere.scale, 'y', hoverScale, 0.12, delta);
    damp(sphere.scale, 'z', hoverScale, 0.12, delta);

    // Subtle emissive pulse on the inner core, not the shell.
    if (!reducedMotion) {
      ambientTimeRef.current += delta;
      const pulse = 0.14 + 0.06 * Math.sin(ambientTimeRef.current * 2.2);
      // eslint-disable-next-line react-hooks/immutability -- three.js materials mutate in-place by design
      coreMat.opacity = pulse * (dimmed ? 0.35 : 1);
    }
  });

  useEffect(() => {
    // Sync material opacities with dimmed state without allocating new
    // materials — three.js is inherently mutable here and creating fresh
    // materials on every prop change would churn GPU resources.
    const dimOpacity = dimmed ? 0.35 : 1;
    /* eslint-disable react-hooks/immutability */
    shellMaterial.opacity = 0.92 * (dimmed ? 0.4 : 1);
    arrowShaftMat.opacity = dimOpacity;
    arrowShaftMat.transparent = dimmed;
    arrowConeMat.opacity = dimOpacity;
    arrowConeMat.transparent = dimmed;
    tipMaterial.opacity = 0.95 * dimOpacity;
    /* eslint-enable react-hooks/immutability */
  }, [dimmed, shellMaterial, arrowShaftMat, arrowConeMat, tipMaterial]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    pressedAtRef.current = performance.now();
    setGrabbing(true);
  };
  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const held = performance.now() - pressedAtRef.current;
    setGrabbing(false);
    if (held < 250) onSelect();
  };

  return (
    <group ref={slotRef}>
      <Float
        speed={reducedMotion ? 0 : 0.9}
        floatIntensity={reducedMotion ? 0 : 0.22}
        rotationIntensity={reducedMotion ? 0 : 0.08}
        floatingRange={[-0.04, 0.04]}
      >
        <group
          ref={contentRef}
          onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'grab'; }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        >
          {/* Translucent shell */}
          <mesh ref={sphereRef} material={shellMaterial}>
            <sphereGeometry args={[1, 56, 56]} />
          </mesh>

          {/* Quiet inner core — gives the sphere a center without
              competing with the arrow. */}
          <mesh material={coreMat}>
            <sphereGeometry args={[0.25, 24, 24]} />
          </mesh>

          {/* Selection ring — only visible when selected */}
          {selected && (
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[1.08, 0.012, 8, 96]} />
              <meshBasicMaterial color={TEAL_LIGHT} transparent opacity={0.85} toneMapped={false} />
            </mesh>
          )}

          {/* State arrow */}
          <group ref={arrowRef} scale={[1, arrowLen, 1]}>
            <mesh geometry={shaftGeo} material={arrowShaftMat} />
            <mesh geometry={coneGeo} material={arrowConeMat} />
            <mesh geometry={tipGeo} material={tipMaterial} />
          </group>

          {/* Qubit label, anchored just below the shell */}
          <Html
            position={[0, -1.25, 0]}
            center
            distanceFactor={6}
            style={{
              pointerEvents: 'none',
              color: selected ? '#00B4D8' : 'rgba(148, 163, 184, 0.85)',
              fontFamily: "'Fira Code', monospace",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.3,
              whiteSpace: 'nowrap',
              textShadow: selected ? '0 0 10px rgba(0, 180, 216, 0.55)' : '0 1px 2px rgba(0,0,0,0.6)',
            }}
          >
            q{index}
          </Html>
        </group>
      </Float>
    </group>
  );
}
