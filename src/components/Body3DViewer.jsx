import { Suspense, useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { getBodyModelUrls } from '../constants/bodyModels';

function resolveActiveModelUrl(gender, placement3d) {
  const defaults = getBodyModelUrls();
  if (placement3d?.bodyModelUrl && placement3d.gender === gender) {
    return placement3d.bodyModelUrl;
  }
  return defaults[gender];
}

const DEFAULT_URLS = getBodyModelUrls();
useGLTF.preload(DEFAULT_URLS.female);
useGLTF.preload(DEFAULT_URLS.male);

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
export function serializeDecals(gender, fallbackDecalSize, decals, bodyModelUrl) {
  return {
    version: 1,
    gender,
    bodyModelUrl: bodyModelUrl ?? null,
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

// ── Body + eine Platzierung: erster Klick setzt, dann ziehen / Shift+ziehen ───

function BodyPlaceAndDrag({
  modelUrl,
  meshListRef,
  onMeshesReady,
  texture,
  decal,
  defaultSize,
  onFirstPlace,
  onDecalChange,
  setOrbitEnabled,
}) {
  const { scene } = useGLTF(modelUrl);
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const dragRef = useRef(null);

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

  const hitFromClient = useCallback(
    (clientX, clientY) => {
      const meshes = meshListRef.current;
      if (!meshes?.length) return null;
      const rect = gl.domElement.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) return null;
      const hit = hits[0];
      const mesh = hit.object;
      const meshIndex = meshes.indexOf(mesh);
      if (meshIndex < 0) return null;
      const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      const wn = hit.face.normal.clone().applyMatrix3(nm).normalize();
      return {
        meshIndex,
        point: hit.point.clone(),
        normal: wn,
      };
    },
    [camera, gl, meshListRef, raycaster],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setOrbitEnabled(true);
  }, [setOrbitEnabled]);

  useEffect(() => {
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d || !decal) return;

      if (d.type === 'scale') {
        const dy = ev.clientY - d.startY;
        const next = THREE.MathUtils.clamp(d.startSize - dy * 0.0028, 0.05, 0.48);
        onDecalChange({ ...decal, size: next });
        return;
      }

      if (d.type === 'move') {
        const hit = hitFromClient(ev.clientX, ev.clientY);
        if (hit) {
          onDecalChange({
            ...decal,
            meshIndex: hit.meshIndex,
            point: hit.point,
            normal: hit.normal,
            mesh: null,
          });
        }
      }
    };

    const onUp = () => {
      if (dragRef.current) endDrag();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [decal, endDrag, hitFromClient, onDecalChange]);

  const handlePointerDown = useCallback(
    (e) => {
      e.stopPropagation();
      if (!texture || !e.face || !(e.object instanceof THREE.Mesh)) return;

      const meshes = meshListRef.current || [];
      const mesh = e.object;
      const meshIndex = meshes.indexOf(mesh);
      if (meshIndex < 0) return;

      const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      const wn = e.face.normal.clone().applyMatrix3(nm).normalize();

      if (!decal) {
        onFirstPlace({
          meshIndex,
          point: e.point.clone(),
          normal: wn,
          size: defaultSize,
        });
        return;
      }

      if (e.shiftKey) {
        dragRef.current = {
          type: 'scale',
          startY: e.clientY,
          startSize: decal.size,
        };
      } else {
        dragRef.current = { type: 'move' };
      }
      setOrbitEnabled(false);
    },
    [decal, defaultSize, meshListRef, onFirstPlace, setOrbitEnabled, texture],
  );

  return (
    <group scale={groupScale} position={groupPos}>
      <primitive object={cloned} onPointerDown={handlePointerDown} />
    </group>
  );
}

// ── Three scene ───────────────────────────────────────────────────────────────

function Scene({
  modelUrl,
  meshListRef,
  meshTick,
  decal,
  texture,
  defaultSize,
  onFirstPlace,
  onDecalChange,
  orbitEnabled,
  setOrbitEnabled,
  onMeshesReady,
}) {
  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[2, 4, 3]} intensity={1.3} castShadow={false} />
      <directionalLight position={[-2, 1, -2]} intensity={0.35} />
      <Suspense fallback={null}>
        <BodyPlaceAndDrag
          modelUrl={modelUrl}
          meshListRef={meshListRef}
          onMeshesReady={onMeshesReady}
          texture={texture}
          decal={decal}
          defaultSize={defaultSize}
          onFirstPlace={onFirstPlace}
          onDecalChange={onDecalChange}
          setOrbitEnabled={setOrbitEnabled}
        />
      </Suspense>
      {texture && decal && (
        <TattooDecal
          key={`${meshTick}-${decal.meshIndex}`}
          mesh={meshListRef.current?.[decal.meshIndex]}
          point={decal.point}
          normal={decal.normal}
          size={decal.size}
          texture={texture}
        />
      )}
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={0.3}
        maxDistance={8}
        target={[0, 0, 0]}
        enabled={orbitEnabled}
      />
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
  const [decal, setDecal] = useState(null);
  const [texture, setTexture] = useState(null);
  const [decalSize, setDecalSize] = useState(initialPlacement3d?.decalSize ?? 0.18);
  const [meshTick, setMeshTick] = useState(0);
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const texRef = useRef(null);
  const sizeRef = useRef(decalSize);
  const meshListRef = useRef([]);
  const hydratedKeyRef = useRef('');
  sizeRef.current = decalSize;

  const activeModelUrl = useMemo(
    () => resolveActiveModelUrl(gender, initialPlacement3d),
    [gender, initialPlacement3d],
  );

  const onMeshesReady = useCallback(() => {
    setMeshTick((n) => n + 1);
  }, []);

  useEffect(() => {
    setDecal(null);
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
    (nextDecal, g = gender, sizeFallback = sizeRef.current) => {
      if (!onPlacementChange) return;
      if (!tatSrc || !nextDecal) {
        onPlacementChange(null);
        return;
      }
      const sz = nextDecal.size ?? sizeFallback;
      const bodyModelUrl = resolveActiveModelUrl(g, null);
      onPlacementChange(serializeDecals(g, sz, [nextDecal], bodyModelUrl));
    },
    [gender, onPlacementChange, tatSrc],
  );

  const handleFirstPlace = useCallback(
    (d) => {
      const next = { ...d, mesh: null };
      setDecal(next);
      setDecalSize(next.size);
      sizeRef.current = next.size;
      emitSerialized(next);
    },
    [emitSerialized],
  );

  const handleDecalChange = useCallback(
    (next) => {
      setDecal(next);
      setDecalSize(next.size);
      sizeRef.current = next.size;
      emitSerialized(next);
    },
    [emitSerialized],
  );

  const changeGender = (g) => {
    setGender(g);
    setDecal(null);
    emitSerialized(null, g);
  };

  const clearDecal = () => {
    setDecal(null);
    emitSerialized(null);
  };

  useEffect(() => {
    if (!initialPlacement3d || !initialPlacement3d.decals?.length) return;
    const key = JSON.stringify(initialPlacement3d);
    if (key === hydratedKeyRef.current) return;
    hydratedKeyRef.current = key;
    setGender(initialPlacement3d.gender || 'female');
    const list = decalsFromSerialized(initialPlacement3d);
    const first = list[0];
    if (first) {
      if (typeof initialPlacement3d.decalSize === 'number') {
        setDecalSize(initialPlacement3d.decalSize);
        sizeRef.current = initialPlacement3d.decalSize;
      }
      setDecal({ ...first, size: first.size ?? initialPlacement3d.decalSize ?? 0.18 });
    }
  }, [initialPlacement3d]);

  const hasDecal = !!decal;

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
            max={0.48}
            step={0.01}
            value={decalSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              setDecalSize(v);
              sizeRef.current = v;
              setDecal((prev) => {
                if (!prev) return prev;
                const next = { ...prev, size: v };
                emitSerialized(next, gender, v);
                return next;
              });
            }}
          />
        </label>

        {hasDecal && (
          <button type="button" className="body3d-clear" onClick={clearDecal}>
            × löschen
          </button>
        )}
      </div>

      <p className="body3d-hint">
        {!tatSrc && 'Lade oder wähle ein Motiv — dann hier auf den Körper klicken'}
        {tatSrc && !hasDecal && 'Erster Klick auf den Körper setzt das Motiv · danach ziehen zum Verschieben'}
        {tatSrc && hasDecal && (
          <>
            Auf der Haut ziehen = verschieben · <strong>Shift</strong> halten und ziehen (hoch/runter) = Größe · Ansicht drehen wie gewohnt (wenn nicht gerade gezogen wird)
          </>
        )}
      </p>

      <Canvas
        className="body3d-canvas"
        camera={{ position: [0, 0, 3.2], fov: 55, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: true }}
        style={{
          cursor: !tatSrc ? 'grab' : !hasDecal ? 'crosshair' : 'grab',
        }}
      >
        <Scene
          modelUrl={activeModelUrl}
          meshListRef={meshListRef}
          meshTick={meshTick}
          decal={decal}
          texture={texture}
          defaultSize={decalSize}
          onFirstPlace={handleFirstPlace}
          onDecalChange={handleDecalChange}
          orbitEnabled={orbitEnabled}
          setOrbitEnabled={setOrbitEnabled}
          onMeshesReady={onMeshesReady}
        />
      </Canvas>
    </div>
  );
}
