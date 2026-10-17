import * as THREE from 'three';
import type { BlochPalette } from '../../lib/blochPalette';
import { easeOutCubic, interpolateBloch, type BlochVector } from '../../lib/blochMath';
import {
  DEFAULT_ORBIT_POSE,
  decayVelocity,
  dragPose,
  orbitPosition,
  zoomPose,
  type OrbitPose,
} from '../../lib/blochOrbit';
import { createBlochScene, type BlochScene } from './blochScene';

/**
 * One WebGL renderer for every Bloch sphere on screen. Each sphere is a DOM box
 * (`element`); the stage draws into that box's rectangle of a single canvas with
 * viewport + scissor, so any number of qubits costs one GL context.
 *
 * It draws only on demand: a frame is scheduled by a coord change, a drag, a
 * resize, a theme change, or an animation still in flight. Idle means no GPU work.
 */

export interface StageView {
  element: HTMLElement;
  coord: BlochVector;
}

interface ViewState {
  element: HTMLElement;
  pose: OrbitPose;
  from: BlochVector;
  to: BlochVector;
  shown: BlochVector;
  startedAt: number;
  velocity: { azimuth: number; polar: number };
  dragging: boolean;
  lastPointer: { x: number; y: number; t: number } | null;
  detach: () => void;
}

export const TRANSITION_MS = 280;
const MAX_DPR = 2;

export interface StageOptions {
  reducedMotion: boolean;
}

export class BlochStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly blochScene: BlochScene;
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
  private readonly views = new Map<HTMLElement, ViewState>();
  private raf = 0;
  private lastFrameAt = 0;
  private disposed = false;
  private sized = { dpr: 0, width: 0, height: 0 };
  private readonly onContextLost = (e: Event) => e.preventDefault();
  private readonly onContextRestored = () => this.requestRender();

  private readonly canvas: HTMLCanvasElement;
  private options: StageOptions;

  constructor(canvas: HTMLCanvasElement, palette: BlochPalette, options: StageOptions) {
    this.canvas = canvas;
    this.options = options;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.blochScene = createBlochScene(palette);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  setReducedMotion(reducedMotion: boolean): void {
    this.options = { reducedMotion };
  }

  setPalette(palette: BlochPalette): void {
    this.blochScene.setPalette(palette);
    this.requestRender();
  }

  /** Replace the set of drawn spheres. Existing boxes keep their rotation and tween to the new coord. */
  setViews(next: readonly StageView[]): void {
    const now = performance.now();
    const keep = new Set(next.map((v) => v.element));
    for (const [element, state] of this.views) {
      if (!keep.has(element)) {
        state.detach();
        this.views.delete(element);
      }
    }
    for (const { element, coord } of next) {
      const existing = this.views.get(element);
      if (!existing) {
        this.views.set(element, this.createView(element, coord));
      } else if (!sameVector(existing.to, coord)) {
        existing.from = existing.shown;
        existing.to = coord;
        existing.startedAt = now;
        if (this.options.reducedMotion) existing.shown = coord;
      }
    }
    this.requestRender();
  }

  resize(): void {
    this.requestRender();
  }

  requestRender(): void {
    if (this.raf !== 0 || this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const state of this.views.values()) state.detach();
    this.views.clear();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.blochScene.dispose();
    // No forceContextLoss(): React StrictMode re-attaches the same canvas, which must stay usable.
    this.renderer.dispose();
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = this.lastFrameAt === 0 ? 1 / 60 : Math.min(0.05, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    const stillMoving = this.draw(now, dt);
    if (stillMoving) this.requestRender();
    else this.lastFrameAt = 0;
  };

  /** Draw every view. Returns true while any tween or inertia is still running. */
  private draw(now: number, dt: number): boolean {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return false;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    if (dpr !== this.sized.dpr || bounds.width !== this.sized.width || bounds.height !== this.sized.height) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(bounds.width, bounds.height, false);
      this.sized = { dpr, width: bounds.width, height: bounds.height };
    }
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.setScissorTest(true);

    let moving = false;
    for (const view of this.views.values()) {
      moving = this.advance(view, now, dt) || moving;
      this.drawView(view, bounds);
    }
    this.renderer.setScissorTest(false);
    return moving;
  }

  private advance(view: ViewState, now: number, dt: number): boolean {
    let moving = false;
    const t = (now - view.startedAt) / TRANSITION_MS;
    if (!this.options.reducedMotion && t < 1) {
      view.shown = interpolateBloch(view.from, view.to, easeOutCubic(t));
      moving = true;
    } else {
      view.shown = view.to;
    }
    if (!view.dragging && (view.velocity.azimuth !== 0 || view.velocity.polar !== 0)) {
      view.pose = {
        ...view.pose,
        azimuth: view.pose.azimuth + view.velocity.azimuth * dt,
        polar: clampPolar(view.pose.polar + view.velocity.polar * dt),
      };
      view.velocity = {
        azimuth: decayVelocity(view.velocity.azimuth, dt),
        polar: decayVelocity(view.velocity.polar, dt),
      };
      moving = true;
    }
    return moving;
  }

  private drawView(view: ViewState, canvasBounds: DOMRect): void {
    const box = view.element.getBoundingClientRect();
    const left = box.left - canvasBounds.left;
    const top = box.top - canvasBounds.top;
    if (box.width < 1 || box.height < 1) return;
    if (left + box.width < 0 || top + box.height < 0 || left > canvasBounds.width || top > canvasBounds.height) return;
    const bottom = canvasBounds.height - (top + box.height);
    this.renderer.setViewport(left, bottom, box.width, box.height);
    this.renderer.setScissor(left, bottom, box.width, box.height);
    const [x, y, z] = orbitPosition(view.pose);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
    this.camera.aspect = box.width / box.height;
    this.camera.updateProjectionMatrix();
    this.blochScene.pose(view.shown);
    this.renderer.render(this.blochScene.scene, this.camera);
  }

  private createView(element: HTMLElement, coord: BlochVector): ViewState {
    const view: ViewState = {
      element,
      pose: DEFAULT_ORBIT_POSE,
      from: coord,
      to: coord,
      shown: coord,
      startedAt: performance.now() - TRANSITION_MS,
      velocity: { azimuth: 0, polar: 0 },
      dragging: false,
      lastPointer: null,
      detach: () => {},
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      view.dragging = true;
      view.velocity = { azimuth: 0, polar: 0 };
      view.lastPointer = { x: e.clientX, y: e.clientY, t: performance.now() };
      element.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!view.dragging || !view.lastPointer) return;
      const dx = e.clientX - view.lastPointer.x;
      const dy = e.clientY - view.lastPointer.y;
      const height = element.getBoundingClientRect().height;
      const t = performance.now();
      const seconds = Math.max(0.001, (t - view.lastPointer.t) / 1000);
      const next = dragPose(view.pose, dx, dy, height);
      view.velocity = {
        azimuth: (next.azimuth - view.pose.azimuth) / seconds,
        polar: (next.polar - view.pose.polar) / seconds,
      };
      view.pose = next;
      view.lastPointer = { x: e.clientX, y: e.clientY, t };
      this.requestRender();
    };
    const onUp = (e: PointerEvent) => {
      if (!view.dragging) return;
      view.dragging = false;
      view.lastPointer = null;
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
      if (this.options.reducedMotion) view.velocity = { azimuth: 0, polar: 0 };
      this.requestRender();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.pose = zoomPose(view.pose, e.deltaY);
      this.requestRender();
    };
    const onDouble = () => {
      view.pose = DEFAULT_ORBIT_POSE;
      view.velocity = { azimuth: 0, polar: 0 };
      this.requestRender();
    };

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('dblclick', onDouble);
    view.detach = () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('dblclick', onDouble);
    };
    return view;
  }
}

function sameVector(a: BlochVector, b: BlochVector): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function clampPolar(polar: number): number {
  return Math.min(Math.PI - 0.12, Math.max(0.12, polar));
}
