const MAX_GALLERY_IMAGE_SIDE = 2400;
const WATERMARK_SIZE_RATIO = 0.44;
const WATERMARK_OPACITY = 0.24;
const JPEG_QUALITY = 0.9;

let logoImagePromise = null;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Logo oder Bild konnte nicht geladen werden.'));
    image.src = src;
  });
}

export function preloadWatermarkLogo(logoUrl) {
  if (!logoImagePromise) {
    logoImagePromise = loadImage(logoUrl);
  }
  return logoImagePromise;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Wasserzeichen-Bild konnte nicht erzeugt werden.'));
      },
      type,
      quality,
    );
  });
}

function outputTypeFor(file) {
  return file.type === 'image/png' ? 'image/png' : 'image/jpeg';
}

export function galleryUploadExtension(type, originalName) {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/jpeg') return 'jpg';
  return originalName.split('.').pop()?.toLowerCase() || 'jpg';
}

function createMonochromeWatermark(sourceLogo, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceLogo, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const sourceAlpha = pixels[i + 3] / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    // Das JPEG-Logo hat einen schwarzen Hintergrund. Helle Logo-Anteile werden
    // als transparente, farblose Maske genutzt; dunkle Flächen bleiben unsichtbar.
    const visible = Math.max(0, Math.min(1, (luminance - 18) / 210));
    pixels[i] = 244;
    pixels[i + 1] = 244;
    pixels[i + 2] = 244;
    pixels[i + 3] = Math.round(255 * visible * sourceAlpha);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export async function addGalleryWatermark(file, logoUrl) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const [sourceImage, logoImage] = await Promise.all([
      loadImage(sourceUrl),
      preloadWatermarkLogo(logoUrl),
    ]);

    const sourceWidth = sourceImage.naturalWidth || sourceImage.width;
    const sourceHeight = sourceImage.naturalHeight || sourceImage.height;
    const scale = Math.min(1, MAX_GALLERY_IMAGE_SIDE / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));

    const ctx = canvas.getContext('2d');
    ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

    const logoWidth = logoImage.naturalWidth || logoImage.width;
    const logoHeight = logoImage.naturalHeight || logoImage.height;
    const maxWatermarkSide = Math.min(canvas.width, canvas.height) * WATERMARK_SIZE_RATIO;
    const logoRatio = logoWidth / logoHeight || 1;
    const watermarkWidth = logoRatio >= 1 ? maxWatermarkSide : maxWatermarkSide * logoRatio;
    const watermarkHeight = logoRatio >= 1 ? maxWatermarkSide / logoRatio : maxWatermarkSide;
    const watermark = createMonochromeWatermark(logoImage, watermarkWidth, watermarkHeight);
    const x = (canvas.width - watermark.width) / 2;
    const y = (canvas.height - watermark.height) / 2;

    ctx.save();
    ctx.globalAlpha = WATERMARK_OPACITY;
    ctx.drawImage(watermark, x, y);
    ctx.restore();

    const type = outputTypeFor(file);
    const blob = await canvasToBlob(canvas, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined);
    const extension = galleryUploadExtension(type, file.name);
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'gallery';

    return new File([blob], `${baseName}-watermark.${extension}`, {
      type,
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
