import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';

interface BlochStageProps {
  children: React.ReactNode;
}

/**
 * R3F canvas wrapper. Clean three-point lighting — no Environment IBL.
 *
 * The previous version pulled in a warm "city" HDR preset that bled
 * orange through the transmission material and muddied the palette.
 * Analytical lights keep the teal reading as teal.
 *
 * Postprocess is dialed down: single soft Bloom pass and a gentle
 * Vignette. No Sparkles — they added visual noise at 300×300 panel
 * scale without helping the read.
 */
export function BlochStage({ children }: BlochStageProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 35, position: [0, 0.2, 5.2], near: 0.1, far: 50 }}
      style={{ background: 'transparent' }}
    >
      <Suspense fallback={null}>
        <color attach="background" args={['#060B16']} />

        {/* Clean lighting — cool key + cool fill + warm-ish rim for form */}
        <ambientLight intensity={0.28} color="#BCD9FF" />
        <directionalLight position={[3.5, 4.2, 3]} intensity={0.85} color="#E3F2FF" />
        <directionalLight position={[-3, 1.2, 2]} intensity={0.45} color="#2CA2C7" />
        <pointLight position={[0, 0, 3.5]} intensity={0.9} color="#48CAE4" distance={6} decay={2} />
        {/* Subtle back rim so spheres separate from the background */}
        <directionalLight position={[0, -2, -3]} intensity={0.25} color="#1E6F92" />

        {children}

        <ContactShadows
          opacity={0.28}
          blur={3.2}
          far={5.5}
          resolution={256}
          position={[0, -1.85, 0]}
          scale={7}
          color="#00B4D8"
          frames={1}
        />

        <EffectComposer multisampling={2}>
          <Bloom
            intensity={0.38}
            luminanceThreshold={0.78}
            luminanceSmoothing={0.18}
            mipmapBlur
          />
          <Vignette offset={0.28} darkness={0.45} eskil={false} />
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}
