/**
 * Zwei GLBs für „Frau“ — gleicher Mann-Körper für beides.
 * Öffentliche Website: erstes Modell · Admin: zweites Modell (andere Pose).
 * Dateien liegen in `public/`.
 */
export const BODY_MODEL_PUBLIC = {
  female: '/body-female.glb',
  male: '/body-male.glb',
};

/** Admin-Bereich: zweites Frauen-Modell (Datei: `public/female_body_base_mesh.glb`, im Root: `female_body_base_mesh.glb`). */
export const BODY_MODEL_ADMIN = {
  female: '/female_body_base_mesh.glb',
  male: '/body-male.glb',
};

/** Gespeicherte ältere Admin-Uploads wiesen auf diese nicht existierende URL — auf echtes zweites Modell mappen. */
export const LEGACY_BODY_FEMALE_NEUTRAL_URL = '/body-female-neutral.glb';

export function normalizeStoredBodyModelUrl(url) {
  if (!url) return url;
  if (url === LEGACY_BODY_FEMALE_NEUTRAL_URL) return BODY_MODEL_ADMIN.female;
  return url;
}

/** @param {'public' | 'admin'} variant */
export function getBodyModelUrls(variant = 'public') {
  return variant === 'admin' ? BODY_MODEL_ADMIN : BODY_MODEL_PUBLIC;
}
