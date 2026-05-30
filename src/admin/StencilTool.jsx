import { useCallback, useEffect, useRef, useState } from 'react';

// Stencil-Tool: Vorlagen-Bild → (Hintergrund weg) → KI-Lineart → Stencil zum Download.
// Die eigentliche KI-Verarbeitung läuft in /api/stencil (Replicate); hier wird das
// Bild vor dem Upload verkleinert (Vercel-Body-Limit ~4,5 MB) und das Ergebnis angezeigt.

const MAX_UPLOAD_SIDE = 1280;
const UPLOAD_QUALITY = 0.9;

function downscaleToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const w = image.naturalWidth || image.width;
        const h = image.naturalHeight || image.height;
        const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        // weißer Hintergrund, falls die Vorlage transparent ist
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', UPLOAD_QUALITY));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild konnte nicht gelesen werden.'));
    };
    image.src = url;
  });
}

export default function StencilTool({ auth }) {
  const [configured, setConfigured] = useState(null); // null = lädt
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    fetch('/api/stencil')
      .then((r) => r.json())
      .then((d) => active && setConfigured(Boolean(d?.configured)))
      .catch(() => active && setConfigured(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    setResultUrl(null);
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const reset = () => {
    setFile(null);
    setResultUrl(null);
    setError('');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const generate = useCallback(async () => {
    if (!file || !auth?.currentUser) {
      setError('Kein Bild gewählt oder nicht angemeldet.');
      return;
    }
    setBusy(true);
    setError('');
    setResultUrl(null);
    try {
      const dataUrl = await downscaleToDataUrl(file);
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/stencil', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ image: dataUrl, removeBackground }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = { success: false, error: `Antwort unlesbar (HTTP ${res.status})` };
      }
      if (res.ok && data.success && data.output) {
        setResultUrl(data.output);
      } else {
        setError(data.error || `Fehlgeschlagen (HTTP ${res.status})`);
      }
    } catch (e) {
      setError(e.message || 'Unbekannter Fehler');
    } finally {
      setBusy(false);
    }
  }, [file, auth, removeBackground]);

  const download = useCallback(async () => {
    if (!resultUrl) return;
    try {
      const r = await fetch(resultUrl);
      const blob = await r.blob();
      const ext = (blob.type && blob.type.split('/')[1]) || 'png';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stencil-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: in neuem Tab öffnen
      window.open(resultUrl, '_blank', 'noopener');
    }
  }, [resultUrl]);

  return (
    <section className="admin-section">
      <div className="admin-card">
        <h3 className="admin-h3">Stencil-Tool</h3>
        <p className="admin-lead cormorant">
          Vorlagen-Bild hochladen — Hintergrund und Farbe werden entfernt und die Linien des
          Motivs per KI nachgezeichnet, sodass ein druckfertiges Stencil entsteht. Funktioniert
          mit KI-generierten Motiven ebenso wie mit Fotos bereits gestochener Tattoos.
        </p>

        {configured === false && (
          <p className="admin-error">
            Stencil-Tool ist noch nicht konfiguriert. Bitte <code>REPLICATE_API_TOKEN</code> und{' '}
            <code>REPLICATE_MODEL</code> in den Vercel-Umgebungsvariablen setzen.
          </p>
        )}

        <div className="admin-form">
          <label className="admin-help">
            Vorlage wählen
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onPick}
              disabled={busy}
            />
          </label>

          <label className="admin-check">
            <input
              type="checkbox"
              checked={removeBackground}
              onChange={(e) => setRemoveBackground(e.target.checked)}
              disabled={busy}
            />
            Hintergrund entfernen
          </label>

          <div className="admin-form-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={generate}
              disabled={busy || !file || configured === false}
            >
              {busy ? 'Wird erstellt …' : 'Stencil erstellen'}
            </button>
            {(file || resultUrl) && (
              <button type="button" className="admin-btn-ghost" onClick={reset} disabled={busy}>
                Zurücksetzen
              </button>
            )}
          </div>

          {error && <p className="admin-error">{error}</p>}
        </div>

        {(previewUrl || resultUrl) && (
          <div className="admin-preview-grid">
            {previewUrl && (
              <div className="admin-preview-cell">
                <span className="admin-preview-name">Vorlage</span>
                <img src={previewUrl} alt="Vorlage" />
              </div>
            )}
            {resultUrl && (
              <div className="admin-preview-cell">
                <span className="admin-preview-name">Stencil</span>
                <img src={resultUrl} alt="Stencil" style={{ background: '#fff' }} />
                <button type="button" className="gal-chip" onClick={download}>
                  Herunterladen
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
