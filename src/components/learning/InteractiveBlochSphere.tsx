import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useThemeStore } from '../../stores/themeStore';

const AXIS_LENGTH = 1.3;
const LERP_FACTOR = 0.12;

// --- Coordinate helpers ---

function sphericalToBloch(theta: number, phi: number): { x: number; y: number; z: number } {
  return {
    x: Math.sin(theta) * Math.cos(phi),
    y: Math.sin(theta) * Math.sin(phi),
    z: Math.cos(theta),
  };
}

function blochToSpherical(x: number, y: number, z: number): { theta: number; phi: number } {
  const theta = Math.acos(Math.max(-1, Math.min(1, z)));
  const phi = Math.atan2(y, x);
  return { theta, phi: phi < 0 ? phi + 2 * Math.PI : phi };
}

function blochToThreeJS(coord: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(coord.x, coord.z, coord.y);
}

function threeJSToBloch(v: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.z, z: v.y };
}

// --- Gate transforms (Bloch vector rotations) ---

type BlochCoord = { x: number; y: number; z: number };

const GATE_TRANSFORMS: Record<string, (c: BlochCoord) => BlochCoord> = {
  X: ({ x, y, z }) => ({ x, y: -y, z: -z }),
  Y: ({ x, y, z }) => ({ x: -x, y, z: -z }),
  Z: ({ x, y, z }) => ({ x: -x, y: -y, z }),
  H: ({ x, y, z }) => ({ x: z, y: -y, z: x }),
  S: ({ x, y, z }) => ({ x: -y, y: x, z }),
  T: ({ x, y, z }) => {
    const cos = Math.cos(Math.PI / 4);
    const sin = Math.sin(Math.PI / 4);
    return { x: x * cos - y * sin, y: x * sin + y * cos, z };
  },
};

const PRESET_STATES: Array<{ label: string; theta: number; phi: number }> = [
  { label: '|0\u27E9', theta: 0, phi: 0 },
  { label: '|1\u27E9', theta: Math.PI, phi: 0 },
  { label: '|+\u27E9', theta: Math.PI / 2, phi: 0 },
  { label: '|-\u27E9', theta: Math.PI / 2, phi: Math.PI },
  { label: '|+i\u27E9', theta: Math.PI / 2, phi: Math.PI / 2 },
  { label: '|-i\u27E9', theta: Math.PI / 2, phi: 3 * Math.PI / 2 },
];

const ALL_GATES = ['H', 'X', 'Y', 'Z', 'S', 'T'];

// --- Scene construction ---

function createScene(bgColor: number, gridColor: number) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bgColor);

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(2, 3, 4);
  scene.add(dirLight);

  // Semi-transparent sphere
  const sphereGeo = new THREE.SphereGeometry(1, 48, 48);
  const sphereMat = new THREE.MeshPhongMaterial({
    color: 0x0f1b2d,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
  scene.add(sphereMesh);

  // Wireframe
  const wireGeo = new THREE.SphereGeometry(1, 24, 16);
  const wireMat = new THREE.MeshBasicMaterial({
    color: gridColor,
    wireframe: true,
    transparent: true,
    opacity: 0.3,
  });
  scene.add(new THREE.Mesh(wireGeo, wireMat));

  // Equator
  const equatorPts = Array.from({ length: 129 }, (_, i) => {
    const angle = (i / 128) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  });
  scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(equatorPts),
    new THREE.LineBasicMaterial({ color: gridColor, transparent: true, opacity: 0.5 }),
  ));

  // Meridians (XZ and YZ planes)
  const meridianFns = [
    (a: number) => new THREE.Vector3(Math.cos(a), Math.sin(a), 0),
    (a: number) => new THREE.Vector3(0, Math.sin(a), Math.cos(a)),
  ];
  for (const fn of meridianFns) {
    const pts = Array.from({ length: 129 }, (_, i) => fn((i / 128) * Math.PI * 2));
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: gridColor, transparent: true, opacity: 0.3 }),
    ));
  }

  // Axes with labels
  const axes: Array<{ dir: THREE.Vector3; color: number }> = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xe06c75 },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x98c379 },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x48cae4 },
  ];
  for (const { dir, color } of axes) {
    const pos = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), AXIS_LENGTH, color, 0.08, 0.04);
    const neg = new THREE.ArrowHelper(dir.clone().negate(), new THREE.Vector3(0, 0, 0), AXIS_LENGTH, color, 0.08, 0.04);
    pos.line.material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
    neg.line.material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 });
    scene.add(pos, neg);
  }

  return { scene, sphereMesh };
}

function createStateArrow(scene: THREE.Scene, color: number, isGhost = false) {
  const arrowGroup = new THREE.Group();

  const opacity = isGhost ? 0.3 : 1;
  const emissiveIntensity = isGhost ? 0.1 : 0.3;

  const shaftGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 8);
  shaftGeo.translate(0, 0.5, 0);
  const shaftMat = new THREE.MeshPhongMaterial({
    color,
    emissive: color,
    emissiveIntensity,
    transparent: isGhost,
    opacity,
  });
  arrowGroup.add(new THREE.Mesh(shaftGeo, shaftMat));

  const coneGeo = new THREE.ConeGeometry(0.06, 0.12, 12);
  coneGeo.translate(0, 1.06, 0);
  const coneMat = new THREE.MeshPhongMaterial({
    color,
    emissive: color,
    emissiveIntensity,
    transparent: isGhost,
    opacity,
  });
  arrowGroup.add(new THREE.Mesh(coneGeo, coneMat));

  const glowGeo = new THREE.SphereGeometry(0.05, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isGhost ? 0.2 : 0.6 });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(0, 1.06, 0);
  arrowGroup.add(glow);

  scene.add(arrowGroup);
  return arrowGroup;
}

function pointArrowAt(arrow: THREE.Group, target: THREE.Vector3) {
  const length = target.length();
  if (length < 0.001) {
    arrow.visible = false;
    return;
  }
  arrow.visible = true;
  arrow.scale.set(1, length, 1);
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), target.clone().normalize());
}

// --- State equation formatter ---

function formatStateEquation(theta: number, phi: number): string {
  const cosHalf = Math.cos(theta / 2);
  const sinHalf = Math.sin(theta / 2);

  const formatNum = (n: number): string => {
    const abs = Math.abs(n);
    if (abs < 1e-6) return '0';
    if (Math.abs(abs - 1) < 1e-6) return n < 0 ? '-1' : '1';
    if (Math.abs(abs - Math.SQRT1_2) < 1e-4) return n < 0 ? '-0.707' : '0.707';
    return n.toFixed(3);
  };

  const alpha = formatNum(cosHalf);
  const betaReal = Math.cos(phi) * sinHalf;
  const betaImag = Math.sin(phi) * sinHalf;

  let betaStr: string;
  const rAbs = Math.abs(betaReal);
  const iAbs = Math.abs(betaImag);

  if (rAbs < 1e-6 && iAbs < 1e-6) {
    betaStr = '0';
  } else if (iAbs < 1e-6) {
    betaStr = formatNum(betaReal);
  } else if (rAbs < 1e-6) {
    const iVal = formatNum(betaImag);
    betaStr = iVal === '1' ? 'i' : iVal === '-1' ? '-i' : `${iVal}i`;
  } else {
    const rStr = formatNum(betaReal);
    const iVal = formatNum(Math.abs(betaImag));
    const iStr = iVal === '1' ? 'i' : `${iVal}i`;
    betaStr = betaImag >= 0 ? `${rStr}+${iStr}` : `${rStr}-${iStr}`;
  }

  return `${alpha}|0\u27E9 + ${betaStr}|1\u27E9`;
}

// --- Component ---

interface InteractiveBlochSphereProps {
  initialTheta?: number;
  initialPhi?: number;
  availableGates?: string[];
  challenge?: {
    targetTheta: number;
    targetPhi: number;
    description: string;
  };
}

export function InteractiveBlochSphere({
  initialTheta = 0,
  initialPhi = 0,
  availableGates = ALL_GATES,
  challenge,
}: InteractiveBlochSphereProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  const [theta, setTheta] = useState(initialTheta);
  const [phi, setPhi] = useState(initialPhi);

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const arrowRef = useRef<THREE.Group | null>(null);
  const ghostArrowRef = useRef<THREE.Group | null>(null);
  const sphereMeshRef = useRef<THREE.Mesh | null>(null);
  const animFrameRef = useRef<number>(0);
  const currentTargetRef = useRef(blochToThreeJS(sphericalToBloch(initialTheta, initialPhi)));
  const isDraggingRef = useRef(false);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  // Keep theta/phi in a ref so the animation loop reads the latest values
  const stateRef = useRef({ theta: initialTheta, phi: initialPhi });
  stateRef.current = { theta, phi };

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    const isDark = colors.bg === '#0F1B2D';
    const bgColor = isDark ? 0x0a1220 : 0xf1f5f9;
    const gridColor = isDark ? 0x1a2a42 : 0xc8d5e0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    camera.position.set(2.2, 1.8, 2.2);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const { scene, sphereMesh } = createScene(bgColor, gridColor);
    sphereMeshRef.current = sphereMesh;

    // State arrow (teal)
    const tealHex = parseInt(colors.accent.replace('#', ''), 16);
    const arrow = createStateArrow(scene, tealHex);
    arrowRef.current = arrow;

    // Ghost arrow for challenge mode
    if (challenge) {
      const ghost = createStateArrow(scene, 0xf59e0b, true);
      ghostArrowRef.current = ghost;
      const ghostCoord = sphericalToBloch(challenge.targetTheta, challenge.targetPhi);
      pointArrowAt(ghost, blochToThreeJS(ghostCoord));
    }

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.enablePan = false;
    controls.minDistance = 1.5;
    controls.maxDistance = 6;
    controlsRef.current = controls;

    // Set initial arrow
    const initCoord = sphericalToBloch(stateRef.current.theta, stateRef.current.phi);
    const initTarget = blochToThreeJS(initCoord);
    currentTargetRef.current.copy(initTarget);
    pointArrowAt(arrow, initTarget);

    // Animation loop with lerp
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      const { theta: t, phi: p } = stateRef.current;
      const desired = blochToThreeJS(sphericalToBloch(t, p));
      currentTargetRef.current.lerp(desired, LERP_FACTOR);
      pointArrowAt(arrow, currentTargetRef.current);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: rw, height: rh } = entry.contentRect;
        if (rw > 0 && rh > 0) {
          renderer.setSize(rw, rh);
          camera.aspect = rw / rh;
          camera.updateProjectionMatrix();
        }
      }
    });
    resizeObs.observe(container);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      resizeObs.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Pointer drag handlers ---

  const getNDC = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }, []);

  const intersectSphere = useCallback((ndc: THREE.Vector2): BlochCoord | null => {
    if (!cameraRef.current || !sphereMeshRef.current) return null;
    raycasterRef.current.setFromCamera(ndc, cameraRef.current);
    const hits = raycasterRef.current.intersectObject(sphereMeshRef.current);
    if (hits.length === 0) return null;
    const p = hits[0].point.clone().normalize();
    return threeJSToBloch(p);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ndc = getNDC(e);
    if (!ndc) return;
    const bloch = intersectSphere(ndc);
    if (!bloch) return;
    isDraggingRef.current = true;
    if (controlsRef.current) controlsRef.current.enabled = false;
    mouseRef.current.copy(ndc);
    const { theta: t, phi: p } = blochToSpherical(bloch.x, bloch.y, bloch.z);
    setTheta(t);
    setPhi(p);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [getNDC, intersectSphere]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const ndc = getNDC(e);
    if (!ndc) return;
    const bloch = intersectSphere(ndc);
    if (!bloch) return;
    const { theta: t, phi: p } = blochToSpherical(bloch.x, bloch.y, bloch.z);
    setTheta(t);
    setPhi(p);
  }, [getNDC, intersectSphere]);

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
    if (controlsRef.current) controlsRef.current.enabled = true;
  }, []);

  // Gate application
  const applyGate = useCallback((gate: string) => {
    const transform = GATE_TRANSFORMS[gate];
    if (!transform) return;
    const current = sphericalToBloch(stateRef.current.theta, stateRef.current.phi);
    const next = transform(current);
    const { theta: t, phi: p } = blochToSpherical(next.x, next.y, next.z);
    setTheta(t);
    setPhi(p);
  }, []);

  // Challenge distance
  const challengeDistance = challenge
    ? (() => {
        const cur = sphericalToBloch(theta, phi);
        const tgt = sphericalToBloch(challenge.targetTheta, challenge.targetPhi);
        const dx = cur.x - tgt.x;
        const dy = cur.y - tgt.y;
        const dz = cur.z - tgt.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      })()
    : null;

  const isMatched = challengeDistance !== null && challengeDistance < 0.08;

  // --- Shared inline styles ---

  const btnBase: React.CSSProperties = {
    padding: '5px 12px',
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    background: colors.bgElevated,
    color: colors.text,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    transition: 'background 150ms ease, border-color 150ms ease',
  };

  return (
    <div
      style={{
        borderRadius: 12,
        overflow: 'hidden',
        border: `1px solid ${colors.border}`,
        background: colors.bgPanel,
        boxShadow: shadow.md,
      }}
      role="region"
      aria-label="Interactive Bloch sphere"
    >
      {/* 3D canvas */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: 340, cursor: isDraggingRef.current ? 'grabbing' : 'grab' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      {/* Controls area */}
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Challenge banner */}
        {challenge && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            borderRadius: 8,
            background: isMatched ? `${colors.success}18` : `${colors.warning}18`,
            border: `1px solid ${isMatched ? colors.success : colors.warning}44`,
          }}>
            <span style={{ fontSize: 16 }}>{isMatched ? '\u2705' : '\uD83C\uDFAF'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: isMatched ? colors.success : colors.warning, fontFamily: "'Geist Sans', sans-serif" }}>
                {isMatched ? 'Matched!' : challenge.description}
              </div>
              {!isMatched && challengeDistance !== null && (
                <div style={{ fontSize: 11, color: colors.textDim, fontFamily: "'Geist Sans', sans-serif", marginTop: 2 }}>
                  Distance: {challengeDistance.toFixed(3)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Preset buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESET_STATES.map((preset) => (
            <button
              key={preset.label}
              onClick={() => { setTheta(preset.theta); setPhi(preset.phi); }}
              style={{
                ...btnBase,
                background: Math.abs(theta - preset.theta) < 0.01 && Math.abs(phi - preset.phi) < 0.01
                  ? `${colors.accent}22`
                  : colors.bgElevated,
                borderColor: Math.abs(theta - preset.theta) < 0.01 && Math.abs(phi - preset.phi) < 0.01
                  ? colors.accent
                  : colors.border,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = colors.accent; }}
              onMouseLeave={(e) => {
                const active = Math.abs(theta - preset.theta) < 0.01 && Math.abs(phi - preset.phi) < 0.01;
                e.currentTarget.style.borderColor = active ? colors.accent : colors.border;
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Gate buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {availableGates.map((gate) => (
            <button
              key={gate}
              onClick={() => applyGate(gate)}
              style={{
                ...btnBase,
                fontWeight: 600,
                color: colors.accent,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `${colors.accent}22`;
                e.currentTarget.style.borderColor = colors.accent;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = colors.bgElevated;
                e.currentTarget.style.borderColor = colors.border;
              }}
            >
              {gate}
            </button>
          ))}
        </div>

        {/* Theta / Phi sliders */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 }}>
            <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: colors.textMuted, minWidth: 78 }}>
              {'\u03B8'} = {theta.toFixed(2)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.PI}
              step={0.01}
              value={theta}
              onChange={(e) => setTheta(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: colors.accent, cursor: 'pointer' }}
              aria-label="Theta angle"
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 180 }}>
            <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: colors.textMuted, minWidth: 78 }}>
              {'\u03C6'} = {phi.toFixed(2)}
            </span>
            <input
              type="range"
              min={0}
              max={2 * Math.PI}
              step={0.01}
              value={phi}
              onChange={(e) => setPhi(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: colors.accent, cursor: 'pointer' }}
              aria-label="Phi angle"
            />
          </label>
        </div>

        {/* State equation */}
        <div style={{
          padding: '8px 12px',
          borderRadius: 8,
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 14,
          color: colors.text,
          textAlign: 'center',
          letterSpacing: 0.3,
        }}>
          <span style={{ color: colors.textDim }}>|{'\u03C8'}{'\u27E9'} = </span>
          {formatStateEquation(theta, phi)}
        </div>
      </div>
    </div>
  );
}
