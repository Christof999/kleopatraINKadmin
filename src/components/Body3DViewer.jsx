import { Suspense, useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

const MODELS = {
  female: '/body-female.glb',
  male: '/body-male.glb',
};

useGLTF.preload(MODELS.female);
useGLTF.preload(MODELS.male);

function makeOrientation(point, worldNormal) {
  const helper = new THREE.Object3D();
  helper.position.copy(point);
  helper.lookAt(new THREE.Vector3().addVectors(point, worldNormal));
  return helper.rotation.clone();
}

/** Tiefe-zuerst: stabile Mesh-Liste wie beim ersten Rendern */
function collectMeshes(root) {
  const meshes = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry) meshes.push(o);
  });
  return meshes;
}

/**
 * Firestore-freundliche Platzierung (ohne THREE-Objekte).
 * Optional Feld `placement3d` im Wannado-Dokument.
 */
export function serializeDecals(gender, fallbackDecalSize, decals) {
  return {
    version: 1,
    gender,
    decalSize: fallbackDecalSize,
    decals: decals.map((d) => ({
      meshIndex: d.meshIndex,
      point: { x: d.point.x, y: d.point.y, z: d.point.z },
      normal: { x: d.normal.x, y: d.normal.y, z: d.normal.z },
      size: d.size,
    })),
  };
}

export function decalsFromSerialized(serialized) {
  if (!serialized || !Array.isArray(serialized.decals)) return [];
  return serialized.decals.map((d) => ({
    meshIndex: d.meshIndex,
    point: new THREE.Vector3(d.point.x, d.point.y, d.point.z),
    normal: new THREE.Vector3(d.normal.x, d.normal.y, d.normal.z),
    size: d.size,
    mesh: null,
  }));
}

// ── Decal ─────────────────────────────────────────────────────────────────────

function TattooDecal({ mesh, point, normal, size, texture }) {
  const geom = useMemo(() => {
    if (!mesh || !point || !normal) return null;
    try {
      return new DecalGeometry(
        mesh,
        point,
        makeOrientation(point, normal),
        new THREE.Vector3(size, size, size * 0.4),
      );
    } catch {
      return null;
    }
  }, [mesh, point, normal, size]);

  if (!geom || !texture) return null;
  return (
    <mesh geometry={geom} renderOrder={2}>
      <meshBasicMaterial
        map={texture}
        transparent
        depthTest
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
      />
    </mesh>
  );
}

// ── Body model ────────────────────────────────────────────────────────────────

function BodyModel({ gender, meshListRef, onMeshesReady, onPlace, canPlace }) {
  const { scene } = useGLTF(MODELS[gender]);

  const { cloned, groupPos, groupScale } = useMemo(() => {
    const c = scene.clone(true);
    const box = new THREE.Box3().setFromObject(c, true);
    const h = box.max.y - box.min.y;
    const s = h > 0.001 ? 2.2 / h : 1;
    const mid = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
    return { cloned: c, groupScale: s, groupPos: [-mid.x, -mid.y, -mid.z] };
  }, [scene]);

  useLayoutEffect(() => {
    meshListRef.current = collectMeshes(cloned);
    onMeshesReady?.();
  }, [cloned, meshListRef, onMeshesReady]);

  const handlePointerDown = useCallback(
    (e) => {
      e.stopPropagation();
      if (!canPlace || !e.face || !(e.object instanceof THREE.Mesh)) return;
      const mesh = e.object;
      const list = meshListRef.current || [];
      const meshIndex = list.indexOf(mesh);
      if (meshIndex < 0) return;
      const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      const wn = e.face.normal.clone().applyMatrix3(nm).normalize();
      onPlace({
        mesh,
        meshIndex,
        point: e.point.clone(),
        normal: wn,
      });
    },
    [canPlace, meshListRef, onPlace],
  );

  return (
    <group scale={groupScale} position={groupPos}>
      <primitive object={cloned} onPointerDown={handlePointerDown} />
    </group>
  );
}

// ── Three scene ───────────────────────────────────────────────────────────────

function Scene({ gender, meshListRef, meshTick, decals, texture, onPlace, onMeshesReady }) {
  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[2, 4, 3]} intensity={1.3} castShadow={false} />
      <directionalLight position={[-2, 1, -2]} intensity={0.35} />
      <Suspense fallback={null}>
        <BodyModel
          gender={gender}
          meshListRef={meshListRef}
          onMeshesReady={onMeshesReady}
          onPlace={onPlace}
          canPlace={!!texture}
        />
      </Suspense>
      {texture &&
        decals.map((d, i) => {
          const mesh = meshListRef.current?.[d.meshIndex];
          if (!mesh) return null;
          return <TattooDecal key={`${meshTick}-${i}`} mesh={mesh} point={d.point} normal={d.normal} size={d.size} texture={texture} />;
        })}
      <OrbitControls makeDefault enablePan={false} minDistance={0.3} maxDistance={8} target={[0, 0, 0]} />
    </>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

/**
 * @param {string|null} tatSrc – Bild-URL oder Object-URL
 * @param {object|null} initialPlacement3d – gespeichertes Objekt von serializeDecals()
 * @param {(serialized: object|null) => void} [onPlacementChange] – Callback bei jeder Änderung der Platzierungen
 */
export default function Body3DViewer({ tatSrc, initialPlacement3d = null, onPlacementChange }) {
  const [gender, setGender] = useState(initialPlacement3d?.gender || 'female');
  const [decals, setDecals] = useState([]);
  const [texture, setTexture] = useState(null);
  const [decalSize, setDecalSize] = useState(initialPlacement3d?.decalSize ?? 0.18);
  const [meshTick, setMeshTick] = useState(0);
  const texRef = useRef(null);
  const sizeRef = useRef(decalSize);
  const meshListRef = useRef([]);
  const hydratedKeyRef = useRef('');
  sizeRef.current = decalSize;

  const onMeshesReady = useCallback(() => {
    setMeshTick((n) => n + 1);
  }, []);

  useEffect(() => {
    setDecals([]);
    hydratedKeyRef.current = '';
    if (onPlacementChange) onPlacementChange(null);
  }, [tatSrc, onPlacementChange]);

  useEffect(() => {
    if (!tatSrc) {
      setTexture(null);
      return;
    }
    let alive = true;
    new THREE.TextureLoader().load(tatSrc, (t) => {
      if (!alive) {
        t.dispose();
        return;
      }
      t.colorSpace = THREE.SRGBColorSpace;
      if (texRef.current) texRef.current.dispose();
      texRef.current = t;
      setTexture(t);
    });
    return () => {
      alive = false;
    };
  }, [tatSrc]);

  const emitSerialized = useCallback(
    (nextDecals, g = gender, size = sizeRef.current) => {
      if (!onPlacementChange) return;
      if (!tatSrc || nextDecals.length === 0) {
        onPlacementChange(null);
        return;
      }
      onPlacementChange(serializeDecals(g, size, nextDecals));
    },
    [gender, onPlacementChange, tatSrc],
  );

  const handlePlace = useCallback(
    (d) => {
      setDecals((p) => {
        const next = [...p, { ...d, size: sizeRef.current }];
        emitSerialized(next);
        return next;
      });
    },
    [emitSerialized],
  );

  const changeGender = (g) => {
    setGender(g);
    setDecals([]);
    emitSerialized([], g);
  };

  const clearDecals = () => {
    setDecals([]);
    emitSerialized([]);
  };

  useEffect(() => {
    if (!initialPlacement3d || !initialPlacement3d.decals?.length) return;
    const key = JSON.stringify(initialPlacement3d);
    if (key === hydratedKeyRef.current) return;
    hydratedKeyRef.current = key;
    setGender(initialPlacement3d.gender || 'female');
    if (typeof initialPlacement3d.decalSize === 'number') {
      setDecalSize(initialPlacement3d.decalSize);
      sizeRef.current = initialPlacement3d.decalSize;
    }
    setDecals(decalsFromSerialized(initialPlacement3d));
  }, [initialPlacement3d]);

  return (
    <div className="body3d-wrap">
      <div className="body3d-controls">
        <div className="body3d-toggle">
          <button
            type="button"
            className={`body3d-btn${gender === 'female' ? ' active' : ''}`}
            onClick={() => changeGender('female')}
          >
            Frau
          </button>
          <button
            type="button"
            className={`body3d-btn${gender === 'male' ? ' active' : ''}`}
            onClick={() => changeGender('male')}
          >
            Mann
          </button>
        </div>

        <label className="body3d-size-lbl">
          <span>Größe</span>
          <input
            type="range"
            min={0.05}
            max={0.4}
            step={0.01}
            value={decalSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              setDecalSize(v);
              sizeRef.current = v;
              setDecals((prev) => {
                if (prev.length === 0) return prev;
                const mapped = prev.map((x) => ({ ...x, size: v }));
                emitSerialized(mapped, gender, v);
                return mapped;
              });
            }}
          />
        </label>

        {decals.length > 0 && (
          <button type="button" className="body3d-clear" onClick={clearDecals}>
            × löschen
          </button>
        )}
      </div>

      <p className="body3d-hint">
        {tatSrc
          ? 'Klick auf den Körper um das Motiv zu platzieren · Ziehen zum Drehen'
          : 'Lade oder wähle ein Motiv — dann hier auf den Körper klicken'}
      </p>

      <Canvas
        className="body3d-canvas"
        camera={{ position: [0, 0, 3.2], fov: 55, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: true }}
        style={{ cursor: tatSrc ? 'crosshair' : 'grab' }}
      >
        <Scene
          gender={gender}
          meshListRef={meshListRef}
          meshTick={meshTick}
          decals={decals}
          texture={texture}
          onPlace={handlePlace}
          onMeshesReady={onMeshesReady}
        />
      </Canvas>
    </div>
  );
}
