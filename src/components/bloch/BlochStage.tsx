import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Sparkles, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';

interface BlochStageProps {
  reducedMotion: boolean;
  children: React.ReactNode;
}

/**
 * R3F canvas wrapper. Owns lighting, environment, postprocessing, and the
 * background atmosphere. Children render into this scene.
 *
 * Design notes:
 * - `dpr={[1, 2]}` caps pixel ratio at 2 on retina — beyond that the cost
 *   outweighs the perceptual gain on a panel this size.
 * - `gl.antialias` disabled; we rely on postprocess + MSAA from the
 *   composer. Saves fill-rate.
 * - Environment uses "city" preset — warm-ish IBL that plays nicely with
 *   teal emission. Swap to "dawn" or "sunset" for different moods.
 * - Sparkles disabled in reduced-motion to avoid vestibular triggers.
 */
export function BlochStage({ reducedMotion, children }: BlochStageProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 38, position: [0, 0, 5], near: 0.1, far: 50 }}
      style={{ background: 'transparent' }}
    >
      <Suspense fallback={null}>
        <color attach="background" args={['#05090F']} />
        <fog attach="fog" args={['#05090F', 6, 14]} />

        {/* Key + fill + rim — three-point lighting anchored to the teal palette */}
        <ambientLight intensity={0.22} />
        <directionalLight position={[3, 4, 3]} intensity={0.55} color="#D7EFFF" />
        <directionalLight position={[-3, -1, 2]} intensity={0.3} color="#00B4D8" />
        <pointLight position={[0, 0, 4]} intensity={0.8} color="#48CAE4" distance={6} decay={2} />

        <Environment preset="city" environmentIntensity={0.5} />

        {/* Atmospheric dust — subtle, more felt than seen */}
        {!reducedMotion && (
          <Sparkles
            count={40}
            scale={[6, 4, 6]}
            size={1.5}
            speed={0.25}
            opacity={0.35}
            color="#48CAE4"
          />
        )}

        {children}

        {/* Ground shadow — the objects feel anchored in space */}
        <ContactShadows
          opacity={0.35}
          blur={2.8}
          far={6}
          resolution={256}
          position={[0, -1.8, 0]}
          scale={8}
          color="#00B4D8"
        />

        <EffectComposer multisampling={2}>
          <Bloom
            intensity={0.55}
            luminanceThreshold={0.72}
            luminanceSmoothing={0.22}
            mipmapBlur
          />
          <Vignette offset={0.25} darkness={0.55} eskil={false} />
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}
