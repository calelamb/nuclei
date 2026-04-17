import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { damp3 } from 'maath/easing';

interface CameraDirectorProps {
  target: Vector3;
  overview: Vector3;
  lookAt: Vector3;
  reducedMotion: boolean;
  children: React.ReactNode;
}

/**
 * Drives the camera between "overview" (all qubits in frame) and "focus"
 * (a single qubit pulled forward, others behind it). Uses maath's damp3 so
 * motion is frame-rate independent and settles to the same constant across
 * the scene — the Stark cohesion trick.
 *
 * No OrbitControls here. Selection is the only way the camera moves,
 * which keeps the scene readable in a small IDE panel. Free orbit lives
 * on a future "Showcase Mode" if we ever add one.
 */
export function CameraDirector({
  target,
  overview,
  lookAt,
  reducedMotion,
  children,
}: CameraDirectorProps) {
  const { camera } = useThree();
  const desiredPos = useRef(new Vector3());
  const currentLookAt = useRef(new Vector3());

  // Initialize camera once
  useEffect(() => {
    camera.position.copy(overview);
    camera.lookAt(lookAt);
    currentLookAt.current.copy(lookAt);
  }, [camera, overview, lookAt]);

  useFrame((_, delta) => {
    desiredPos.current.copy(target);

    if (reducedMotion) {
      camera.position.copy(desiredPos.current);
      currentLookAt.current.copy(lookAt);
    } else {
      damp3(camera.position, [desiredPos.current.x, desiredPos.current.y, desiredPos.current.z], 0.3, delta);
      damp3(currentLookAt.current, [lookAt.x, lookAt.y, lookAt.z], 0.3, delta);
    }
    camera.lookAt(currentLookAt.current);
  });

  return <>{children}</>;
}
