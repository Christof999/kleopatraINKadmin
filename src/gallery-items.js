// ── Galerie — Auto-Discovery ──────────────────────────────────────────────────
//
// Bilder kommen nach:  src/assets/gallery/<stil>/dateiname.jpg
// Das war's — Vite erkennt neue Bilder beim nächsten Build automatisch.
//
// Unterordner / Stile:
//   src/assets/gallery/fineline/
//   src/assets/gallery/dotwork/
//   src/assets/gallery/realism/
//   src/assets/gallery/black-white/
//   src/assets/gallery/neotraditional/
//   src/assets/gallery/oldschool/
//
// Dateinamen-Tipp: sprechende Namen werden als Beschreibung angezeigt,
// z. B.  blume-handgelenk.jpg  →  "Blume Handgelenk"

import { TATTOO_STYLES } from './constants/styles';

const rawImages = import.meta.glob(
  './assets/gallery/**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}',
  { eager: true }
);

const STYLE_LABELS = {
  fineline:       'Fineline',
  dotwork:        'Dotwork',
  realism:        'Realism',
  'black-white':  'Black & White',
  neotraditional: 'Neotraditional',
  oldschool:      'Oldschool',
};

const CAMERA_PATTERN = /^(img|dsc|dscn|p\d|mgim|mvim)[-_]?\d/i;

function pieceFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  if (CAMERA_PATTERN.test(base)) return '';
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

export const GAL_FILTERS = ['Alle', ...TATTOO_STYLES];

export const GAL_ITEMS = Object.entries(rawImages)
  .map(([path, mod]) => {
    const segments = path.split('/');
    const folder   = segments[segments.length - 2];
    const filename = segments[segments.length - 1];
    return {
      style: STYLE_LABELS[folder] ?? folder,
      piece: pieceFromFilename(filename),
      src:   mod.default,
    };
  })
  .sort((a, b) => a.style.localeCompare(b.style));
