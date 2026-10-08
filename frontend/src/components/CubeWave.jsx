import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Cube Wave - the product's ambient visual.
 *
 * Performance: ONE InstancedMesh (a single draw call) of GRID x GRID cubes,
 * rendered on demand at ~30 fps. It stops when the tab is hidden or the
 * canvas is off-screen, renders a single still frame when the user prefers
 * reduced motion, and the wrapper falls back to a CSS pattern when WebGL is
 * unavailable. It is purely decorative (aria-hidden).
 */

const GRID = 15;
const SPACING = 1.12;
const FRAME_MS = 1000 / 30;

const LOW = new THREE.Color("#2b2740");
const HIGH = new THREE.Color("#a58bf2");

function Cubes({ time }) {
  const mesh = useRef(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const light = useRef(null);

  const update = (t) => {
    const mid = (GRID - 1) / 2;
    let i = 0;

    for (let x = 0; x < GRID; x += 1) {
      for (let z = 0; z < GRID; z += 1) {
        const dx = x - mid;
        const dz = z - mid;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // concentric wave travelling outward from the centre
        const wave = (Math.sin(dist * 0.8 - t * 1.2) + 1) / 2;
        const height = 0.2 + wave * 1.05;

        dummy.position.set(dx * SPACING, height / 2 - 1, dz * SPACING);
        dummy.scale.set(1, height, 1);
        dummy.updateMatrix();

        mesh.current.setMatrixAt(i, dummy.matrix);
        mesh.current.setColorAt(i, color.copy(LOW).lerp(HIGH, wave));

        i += 1;
      }
    }

    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.instanceColor.needsUpdate = true;

    if (light.current) {
      light.current.position.set(Math.cos(t * 0.5) * 5, 3.2, Math.sin(t * 0.5) * 5);
    }
  };

  useLayoutEffect(() => {
    update(time.current);
  });

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 9, 3]} intensity={1.7} color="#d9ccff" />
      <pointLight ref={light} intensity={46} distance={16} color="#ffffff" />

      <instancedMesh ref={mesh} args={[undefined, undefined, GRID * GRID]}>
        <boxGeometry args={[0.92, 1, 0.92]} />
        <meshStandardMaterial roughness={0.62} metalness={0.05} />
      </instancedMesh>
    </>
  );
}

/** Drives frames manually so we can cap fps and pause cleanly. */
function Loop({ running, time }) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();

    if (!running) return undefined;

    let last = performance.now();

    const id = setInterval(() => {
      const now = performance.now();
      time.current += (now - last) / 1000;
      last = now;
      invalidate();
    }, FRAME_MS);

    return () => clearInterval(id);
  }, [running, invalidate, time]);

  return null;
}

function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");

    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl"))
    );
  } catch {
    return false;
  }
}

function CubeWave({ className = "" }) {
  const wrapper = useRef(null);
  const time = useRef(2.2);

  const [supported] = useState(hasWebGL);
  const [visible, setVisible] = useState(true);
  const [tabActive, setTabActive] = useState(!document.hidden);
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMedia = (event) => setReduced(event.matches);
    const onVisibility = () => setTabActive(!document.hidden);

    media?.addEventListener?.("change", onMedia);
    document.addEventListener("visibilitychange", onVisibility);

    let observer;

    if (wrapper.current && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
      observer.observe(wrapper.current);
    }

    return () => {
      media?.removeEventListener?.("change", onMedia);
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, []);

  const running = visible && tabActive && !reduced;

  return (
    <div ref={wrapper} className={`cube-wave ${className}`} aria-hidden="true">
      {supported ? (
        <Canvas
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ position: [0, 10.5, 12.5], fov: 36, near: 0.1, far: 60 }}
          gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
          onCreated={({ camera }) => camera.lookAt(0, 0.4, 0)}
        >
          <Cubes time={time} />
          <Loop running={running} time={time} />
        </Canvas>
      ) : (
        <div className="cube-wave-fallback" />
      )}
    </div>
  );
}

export default CubeWave;
