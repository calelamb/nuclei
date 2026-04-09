import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useSimulationStore } from '../../stores/simulationStore';

const TEAL = 0x00b4d8;
const GRID_COLOR = 0x1a2a42;
const BG_COLOR = 0x0a1220;
const AXIS_LENGTH = 1.3;

function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  // Ambient + directional light
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
  scene.add(new THREE.Mesh(sphereGeo, sphereMat));

  // Wireframe
  const wireGeo = new THREE.SphereGeometry(1, 24, 16);
  const wireMat = new THREE.MeshBasicMaterial({
    color: GRID_COLOR,
    wireframe: true,
    transparent: true,
    opacity: 0.3,
  });
  scene.add(new THREE.Mesh(wireGeo, wireMat));

  // Equator circle
  const equatorGeo = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 129 }, (_, i) => {
      const angle = (i / 128) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    })
  );
  scene.add(new THREE.Line(equatorGeo, new THREE.LineBasicMaterial({ color: GRID_COLOR, transparent: true, opacity: 0.5 })));

  // Meridian circles (XZ and YZ planes)
  for (const rotFn of [
    (a: number) => new THREE.Vector3(Math.cos(a), Math.sin(a), 0),
    (a: number) => new THREE.Vector3(0, Math.sin(a), Math.cos(a)),
  ]) {
    const geo = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 129 }, (_, i) => rotFn((i / 128) * Math.PI * 2))
    );
    scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: GRID_COLOR, transparent: true, opacity: 0.3 })));
  }

  // Axes
  const axes: Array<{ dir: THREE.Vector3; color: number; labelPos: string; labelNeg: string }> = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xe06c75, labelPos: '|+⟩', labelNeg: '|-⟩' },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x98c379, labelPos: '|0⟩', labelNeg: '|1⟩' },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x48cae4, labelPos: '|+i⟩', labelNeg: '|-i⟩' },
  ];

  for (const { dir, color } of axes) {
    const arrowPos = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), AXIS_LENGTH, color, 0.08, 0.04);
    const arrowNeg = new THREE.ArrowHelper(dir.clone().negate(), new THREE.Vector3(0, 0, 0), AXIS_LENGTH, color, 0.08, 0.04);
    arrowPos.line.material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
    arrowNeg.line.material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 });
    scene.add(arrowPos, arrowNeg);
  }

  return { scene, axes };
}

function createStateArrow(scene: THREE.Scene) {
  const arrowGroup = new THREE.Group();

  // Shaft
  const shaftGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 8);
  shaftGeo.translate(0, 0.5, 0);
  const shaftMat = new THREE.MeshPhongMaterial({ color: TEAL, emissive: TEAL, emissiveIntensity: 0.3 });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  arrowGroup.add(shaft);

  // Cone tip
  const coneGeo = new THREE.ConeGeometry(0.06, 0.12, 12);
  coneGeo.translate(0, 1.06, 0);
  const coneMat = new THREE.MeshPhongMaterial({ color: TEAL, emissive: TEAL, emissiveIntensity: 0.3 });
  arrowGroup.add(new THREE.Mesh(coneGeo, coneMat));

  // Glow sphere at tip
  const glowGeo = new THREE.SphereGeometry(0.05, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.6 });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(0, 1.06, 0);
  arrowGroup.add(glow);

  scene.add(arrowGroup);
  return arrowGroup;
}

function pointArrowAt(arrow: THREE.Group, target: THREE.Vector3, currentTarget: { current: THREE.Vector3 }, lerpFactor: number) {
  // Smooth interpolation
  currentTarget.current.lerp(target, lerpFactor);
  const t = currentTarget.current;

  const length = t.length();
  if (length < 0.001) {
    arrow.visible = false;
    return;
  }
  arrow.visible = true;

  // Scale shaft to length
  arrow.scale.set(1, length, 1);

  // Point the arrow (default Y-up) toward the target
  arrow.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    t.clone().normalize()
  );
}

interface BlochSphereProps {
  blochCoord: { x: number; y: number; z: number } | null;
}

function BlochSphere3D({ blochCoord }: BlochSphereProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const arrowRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number>(0);
  const currentTarget = useRef(new THREE.Vector3(0, 1, 0));
  const defaultCameraPos = useRef(new THREE.Vector3(2.2, 1.8, 2.2));

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.copy(defaultCameraPos.current);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Scene
    const { scene } = createScene();
    sceneRef.current = scene;

    // State arrow
    const arrow = createStateArrow(scene);
    arrowRef.current = arrow;

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.enablePan = false;
    controls.minDistance = 1.5;
    controls.maxDistance = 6;
    controlsRef.current = controls;

    // Animation loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update arrow when bloch coord changes
  useEffect(() => {
    if (!arrowRef.current) return;

    if (!blochCoord) {
      arrowRef.current.visible = false;
      return;
    }

    // Bloch sphere convention: Y axis = Z (|0⟩/|1⟩), X axis = X, Z axis = Y
    // Map quantum Bloch coords to Three.js: x→x, z→y, y→z
    const target = new THREE.Vector3(blochCoord.x, blochCoord.z, blochCoord.y);
    pointArrowAt(arrowRef.current, target, currentTarget, 0.15);
  }, [blochCoord]);

  const resetView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    // Animate back to default
    cameraRef.current.position.copy(defaultCameraPos.current);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* Axis labels rendered as HTML overlays */}
      <div style={{
        position: 'absolute', top: 8, right: 8,
        display: 'flex', gap: 4,
      }}>
        <button
          onClick={resetView}
          title="Reset view"
          style={{
            padding: '4px 8px',
            background: '#1A2A42',
            color: '#3D5A80',
            border: '1px solid #1A2A42',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'Inter, sans-serif',
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#00B4D8'; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#3D5A80'; }}
        >
          ⟲ Reset
        </button>
      </div>
    </div>
  );
}

/** Generate a screen-reader description for the Bloch sphere state */
function describeBlochState(coord: { x: number; y: number; z: number }, qubitIndex: number): string {
  const { x, y, z } = coord;
  // Interpret the state based on coordinates
  if (z > 0.9) return `Qubit ${qubitIndex}: near |0⟩ state (pointing up)`;
  if (z < -0.9) return `Qubit ${qubitIndex}: near |1⟩ state (pointing down)`;
  if (x > 0.9) return `Qubit ${qubitIndex}: near |+⟩ state (superposition, pointing +X)`;
  if (x < -0.9) return `Qubit ${qubitIndex}: near |-⟩ state (superposition, pointing -X)`;
  if (y > 0.9) return `Qubit ${qubitIndex}: near |+i⟩ state (pointing +Y)`;
  if (y < -0.9) return `Qubit ${qubitIndex}: near |-i⟩ state (pointing -Y)`;
  return `Qubit ${qubitIndex}: in superposition state (x=${x.toFixed(2)}, y=${y.toFixed(2)}, z=${z.toFixed(2)})`;
}

export function BlochPanel() {
  const result = useSimulationStore((s) => s.result);
  const [selectedQubit, setSelectedQubit] = useState(0);

  const blochCoords = result?.bloch_coords ?? [];
  const qubitCount = blochCoords.length;

  // Clamp selection if qubit count shrinks
  const displayQubit = qubitCount > 0 && selectedQubit >= qubitCount ? 0 : selectedQubit;

  if (!result || qubitCount === 0) {
    return (
      <div style={{
        height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 8,
      }}>
        {/* Ghost wireframe sphere */}
        <svg width={64} height={64} viewBox="0 0 64 64" style={{ opacity: 0.12 }}>
          <circle cx={32} cy={32} r={28} fill="none" stroke="#3D5A80" strokeWidth={1} />
          <ellipse cx={32} cy={32} rx={28} ry={10} fill="none" stroke="#3D5A80" strokeWidth={0.5} />
          <ellipse cx={32} cy={32} rx={10} ry={28} fill="none" stroke="#3D5A80" strokeWidth={0.5} />
          <line x1={32} y1={4} x2={32} y2={60} stroke="#3D5A80" strokeWidth={0.5} strokeDasharray="2,2" />
          <line x1={4} y1={32} x2={60} y2={32} stroke="#3D5A80" strokeWidth={0.5} strokeDasharray="2,2" />
        </svg>
        <span style={{ color: '#475569', fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
          Run a simulation to visualize qubit states
        </span>
      </div>
    );
  }

  const currentCoord = blochCoords[displayQubit] ?? null;
  const stateDescription = currentCoord ? describeBlochState(currentCoord, displayQubit) : 'No qubit state to display';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }} role="region" aria-label="Bloch sphere visualization" aria-description={stateDescription}>
      {/* Qubit tab selector */}
      {qubitCount > 1 && (
        <div style={{
          display: 'flex',
          borderBottom: '1px solid #1A2A42',
          backgroundColor: '#0A1220',
          flexShrink: 0,
        }}>
          {Array.from({ length: qubitCount }, (_, i) => (
            <button
              key={i}
              onClick={() => setSelectedQubit(i)}
              style={{
                padding: '4px 12px',
                background: displayQubit === i ? '#0F1B2D' : 'transparent',
                color: displayQubit === i ? '#00B4D8' : '#3D5A80',
                border: 'none',
                borderBottom: displayQubit === i ? '2px solid #00B4D8' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: 'Inter, sans-serif',
              }}
            >
              q{i}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <BlochSphere3D blochCoord={currentCoord} />
      </div>
    </div>
  );
}
