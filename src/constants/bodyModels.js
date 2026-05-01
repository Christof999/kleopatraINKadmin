/**
 * GLB-Dateien ins Verzeichnis `public/` legen und hier oder per .env verknüpfen.
 * VITE_BODY_MODEL_FEMALE_URL=/dein-modell.glb
 */
export function getBodyModelUrls() {
  return {
    female:
      import.meta.env.VITE_BODY_MODEL_FEMALE_URL?.trim() || '/body-female.glb',
    male: import.meta.env.VITE_BODY_MODEL_MALE_URL?.trim() || '/body-male.glb',
  };
}
