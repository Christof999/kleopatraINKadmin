/**
 * Zwei GLBs für „Frau“ — gleicher Mann-Körper für beides.
 * Öffentliche Website: erstes Modell · Admin: zweites Modell (andere Pose).
 * Dateien liegen in `public/`.
 */
export const BODY_MODEL_PUBLIC = {
  female: '/body-female.glb',
  male: '/body-male.glb',
};

/** Admin-Bereich: zweites Frauen-Modell (nicht die Pose mit ausgestreckten Armen). */
export const BODY_MODEL_ADMIN = {
  female: '/body-female-neutral.glb',
  male: '/body-male.glb',
};

/** @param {'public' | 'admin'} variant */
export function getBodyModelUrls(variant = 'public') {
  return variant === 'admin' ? BODY_MODEL_ADMIN : BODY_MODEL_PUBLIC;
}
