// Vercel Serverless Function — Stencil-Tool (KI-Lineart via Replicate)
//
// Wandelt ein Vorlagen-Bild (KI-generiert oder Foto eines gestochenen Tattoos)
// in ein Stencil/Strichzeichnung um:
//   1. (optional) Hintergrund entfernen
//   2. KI-Lineart erzeugen (Linien nachzeichnen, Farbe entfällt automatisch)
//
// Aufruf vom Admin-Frontend (POST /api/stencil):
//   Headers:  Authorization: Bearer <Firebase ID Token>
//   Body:     { image: <data-URL>, removeBackground?: boolean }
//   Response: { success: true, output: <bild-url>, steps: {...} }
//             | { success: false, error }
//   Status:   GET /api/stencil  →  { configured: boolean }
//
// Setup (Vercel → Settings → Environment Variables):
//   REPLICATE_API_TOKEN        = r8_…                         (Pflicht)
//   REPLICATE_LINEART_VERSION  = <Version-Hash Lineart-Modell> (Pflicht)
//   REPLICATE_BG_VERSION       = <Version-Hash BG-Removal>     (optional, für "Hintergrund entfernen")
//   REPLICATE_LINEART_IMAGE_KEY = image                        (optional, Default "image")
//   REPLICATE_BG_IMAGE_KEY      = image                        (optional, Default "image")
//
// Empfohlene Replicate-Modelle (Version-Hash aus der jeweiligen "API"-Seite kopieren):
//   Lineart:        "Informative Drawings" / ein ControlNet-Lineart-Preprocessor
//   Hintergrund:    ein rembg / background-removal Modell
// Da Replicate die Version-Hashes pflegt, werden sie bewusst über Env-Vars gesetzt
// und nicht im Code hartcodiert.

const REPLICATE_API = 'https://api.replicate.com/v1/predictions';
const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 55000;

const ADMIN_EMAILS = new Set([
  'info@soergel-design.de',
  'info@kleopatra-ink.com',
]);

// ── Admin-Auth (identisch zu flickr-upload.js) ──────────────────────────────

async function verifyAdminToken(idToken) {
  const apiKey =
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.FIREBASE_WEB_API_KEY ||
    process.env.FIREBASE_API_KEY;
  if (!apiKey || !idToken) return null;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!r.ok) return null;
    const data = await r.json();
    const user = data?.users?.[0];
    if (!user) return null;
    const email = String(user.email || '').trim().toLowerCase();
    return ADMIN_EMAILS.has(email) ? email : null;
  } catch {
    return null;
  }
}

// ── Replicate ───────────────────────────────────────────────────────────────

function firstOutput(output) {
  if (Array.isArray(output)) return output[output.length - 1] || null;
  return output || null;
}

async function runReplicate(version, input, token) {
  const create = await fetch(REPLICATE_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // synchroner Modus: Replicate wartet bis zu 60 s auf das Ergebnis
      Prefer: 'wait',
    },
    body: JSON.stringify({ version, input }),
  });

  let pred = await create.json();
  if (create.status >= 400 || pred?.error) {
    throw new Error(pred?.detail || pred?.error || `Replicate HTTP ${create.status}`);
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  while (pred.status === 'starting' || pred.status === 'processing') {
    if (Date.now() > deadline) throw new Error('Zeitüberschreitung bei der KI-Verarbeitung');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetch(`${REPLICATE_API}/${pred.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    pred = await poll.json();
  }

  if (pred.status !== 'succeeded') {
    throw new Error(pred?.error || `KI-Status: ${pred.status}`);
  }
  const out = firstOutput(pred.output);
  if (!out) throw new Error('KI lieferte kein Bild zurück');
  return out;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const token = process.env.REPLICATE_API_TOKEN;
  const lineartVersion = process.env.REPLICATE_LINEART_VERSION;

  if (req.method === 'GET') {
    return res.status(200).json({ configured: Boolean(token && lineartVersion) });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const idToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const adminEmail = await verifyAdminToken(idToken);
  if (!adminEmail) {
    return res.status(401).json({ success: false, error: 'Nicht autorisiert' });
  }

  if (!token || !lineartVersion) {
    return res.status(500).json({
      success: false,
      error: 'Stencil-Tool nicht konfiguriert (REPLICATE_API_TOKEN / REPLICATE_LINEART_VERSION fehlen).',
    });
  }

  const { image, removeBackground } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ success: false, error: 'Bild fehlt' });
  }

  const steps = {};
  try {
    let working = image;

    // 1. Hintergrund entfernen (optional, nur wenn Modell konfiguriert)
    const bgVersion = process.env.REPLICATE_BG_VERSION;
    if (removeBackground && bgVersion) {
      const bgKey = process.env.REPLICATE_BG_IMAGE_KEY || 'image';
      working = await runReplicate(bgVersion, { [bgKey]: working }, token);
      steps.background = working;
    }

    // 2. KI-Lineart / Linien nachzeichnen
    const lineartKey = process.env.REPLICATE_LINEART_IMAGE_KEY || 'image';
    const output = await runReplicate(lineartVersion, { [lineartKey]: working }, token);
    steps.lineart = output;

    return res.status(200).json({ success: true, output, steps });
  } catch (err) {
    console.error('Stencil generation failed:', err);
    return res.status(502).json({ success: false, error: err.message });
  }
}
