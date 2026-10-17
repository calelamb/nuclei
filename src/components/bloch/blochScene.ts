import * as THREE from 'three';
import type { BlochPalette } from '../../lib/blochPalette';
import { MIXED_EPSILON, PURE_THRESHOLD, blochLength, type BlochVector } from '../../lib/blochMath';
import { TYPOGRAPHY } from '../../styles/tokens';
import { labelHeightFraction } from './blochFraming';

/**
 * The static Bloch-sphere scene shared by every viewport: shell, great circles,
 * axes and labels are built once; only the state arrow and the mixed-state
 * marker are re-posed per sphere right before it is drawn.
 *
 * Kernel (x, y, z) maps to world (x, z, y) so |0> (kernel +z) points up.
 */

const ARROW_RADIUS = 0.022;
const HEAD_LENGTH = 0.16;
const HEAD_RADIUS = 0.06;
const AXIS_EXTENT = 1.12;
const UP = new THREE.Vector3(0, 1, 0);
const LABEL_FONT_PX = 22;
const LABEL_PAD_PX = 6;
const LABEL_SCALE = 3;

function labelSprite(text: string, color: string, height: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `600 ${LABEL_FONT_PX * LABEL_SCALE}px ${TYPOGRAPHY.fontSans}`;
  const h = (LABEL_FONT_PX + LABEL_PAD_PX * 2) * LABEL_SCALE;
  let w = 64;
  if (ctx) {
    ctx.font = font;
    w = Math.ceil(ctx.measureText(text).width + LABEL_PAD_PX * 2 * LABEL_SCALE);
  }
  canvas.width = w;
  canvas.height = h;
  if (ctx) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  // sizeAttenuation off: labels keep a constant on-screen size rather than shrinking with the sphere.
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false, sizeAttenuation: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(height * (w / h), height, 1);
  sprite.userData = { base: height, aspect: w / h };
  sprite.renderOrder = 10;
  return sprite;
}

function ring(radius: number, tube: number, color: string): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 6, 128),
    new THREE.MeshBasicMaterial({ color }),
  );
}

function axis(color: string, rotate: (m: THREE.Mesh) => void): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.011, AXIS_EXTENT * 2, 8),
    new THREE.MeshBasicMaterial({ color }),
  );
  rotate(mesh);
  return mesh;
}

export interface BlochScene {
  scene: THREE.Scene;
  /** Pose the arrow and mixed-state marker for `coord` (call before rendering that sphere). */
  pose(coord: BlochVector): void;
  /** Size the labels for a viewport `viewportPx` tall (call before rendering that sphere). */
  fitLabels(viewportPx: number): void;
  setPalette(palette: BlochPalette): void;
  dispose(): void;
}

export function createBlochScene(initial: BlochPalette): BlochScene {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const disposables: Array<{ dispose(): void }> = [];

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshBasicMaterial({ color: initial.shell, transparent: true, opacity: initial.shellOpacity, side: THREE.BackSide, depthWrite: false }),
  );
  const equator = ring(1, 0.007, initial.equator);
  equator.rotation.x = Math.PI / 2;
  const meridianA = ring(1, 0.005, initial.wire);
  const meridianB = ring(1, 0.005, initial.wire);
  meridianB.rotation.y = Math.PI / 2;
  // World Y is kernel Z (|0> up); world Z is kernel Y.
  const axisZ = axis(initial.axisZ, () => {});
  const axisX = axis(initial.axisX, (m) => { m.rotation.z = Math.PI / 2; });
  const axisY = axis(initial.axisY, (m) => { m.rotation.x = Math.PI / 2; });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(ARROW_RADIUS, ARROW_RADIUS, 1, 16), new THREE.MeshBasicMaterial({ color: initial.state }));
  const head = new THREE.Mesh(new THREE.ConeGeometry(HEAD_RADIUS, HEAD_LENGTH, 20), new THREE.MeshBasicMaterial({ color: initial.state }));
  const mixed = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 24),
    new THREE.MeshBasicMaterial({ color: initial.state, transparent: true, opacity: 0.16, depthWrite: false }),
  );

  root.add(shell, equator, meridianA, meridianB, axisX, axisY, axisZ, mixed, shaft, head);
  for (const mesh of [shell, equator, meridianA, meridianB, axisX, axisY, axisZ, shaft, head, mixed]) {
    disposables.push(mesh.geometry, mesh.material as THREE.Material);
  }

  let labels: THREE.Sprite[] = [];
  const buildLabels = (p: BlochPalette) => {
    for (const s of labels) {
      root.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
    const make = (text: string, color: string, pos: [number, number, number], h: number) => {
      const s = labelSprite(text, color, h);
      s.position.set(...pos);
      root.add(s);
      return s;
    };
    labels = [
      make('|0⟩', p.label, [0, 1.3, 0], 0.085),
      make('|1⟩', p.label, [0, -1.3, 0], 0.085),
      make('X', p.axisX, [1.28, 0, 0], 0.075),
      make('Y', p.axisY, [0, 0, 1.28], 0.075),
    ];
  };
  buildLabels(initial);

  const dir = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  return {
    scene,
    pose(coord) {
      dir.set(coord.x, coord.z, coord.y);
      const len = dir.length();
      const showArrow = len > MIXED_EPSILON;
      shaft.visible = showArrow;
      head.visible = showArrow;
      if (showArrow) {
        dir.normalize();
        quat.setFromUnitVectors(UP, dir);
        const shaftLen = Math.max(0.001, len - HEAD_LENGTH);
        shaft.quaternion.copy(quat);
        shaft.scale.set(1, shaftLen, 1);
        shaft.position.copy(dir).multiplyScalar(shaftLen / 2);
        head.quaternion.copy(quat);
        head.position.copy(dir).multiplyScalar(Math.max(0, len - HEAD_LENGTH / 2));
      }
      const r = blochLength(coord);
      mixed.visible = r < PURE_THRESHOLD;
      mixed.scale.setScalar(Math.max(0.05, r));
      (mixed.material as THREE.MeshBasicMaterial).opacity = r < MIXED_EPSILON ? 0.85 : 0.16;
    },
    fitLabels(viewportPx) {
      for (const s of labels) {
        const { base, aspect } = s.userData as { base: number; aspect: number };
        const height = labelHeightFraction(base, viewportPx);
        s.scale.set(height * aspect, height, 1);
      }
    },
    setPalette(p) {
      (shell.material as THREE.MeshBasicMaterial).color.set(p.shell);
      (shell.material as THREE.MeshBasicMaterial).opacity = p.shellOpacity;
      (equator.material as THREE.MeshBasicMaterial).color.set(p.equator);
      (meridianA.material as THREE.MeshBasicMaterial).color.set(p.wire);
      (meridianB.material as THREE.MeshBasicMaterial).color.set(p.wire);
      (axisX.material as THREE.MeshBasicMaterial).color.set(p.axisX);
      (axisY.material as THREE.MeshBasicMaterial).color.set(p.axisY);
      (axisZ.material as THREE.MeshBasicMaterial).color.set(p.axisZ);
      for (const m of [shaft, head, mixed]) (m.material as THREE.MeshBasicMaterial).color.set(p.state);
      buildLabels(p);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      for (const s of labels) { s.material.map?.dispose(); s.material.dispose(); }
    },
  };
}
