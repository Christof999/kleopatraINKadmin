// Vercel Serverless Function — Stencil-Tool (KI-Lineart via Replicate)
//
// Wandelt ein Vorlagen-Bild (KI-generiert oder Foto eines gestochenen Tattoos)
// in ein Stencil/Strichzeichnung um: Hintergrund + Farbe entfernen, Linien
// nachzeichnen — alles in EINEM KI-Aufruf über ein "Bild bearbeiten"-Modell.
//
// Aufruf vom Admin-Frontend (POST /api/stencil):
//   Headers:  Authorization: Bearer <Firebase ID Token>
//   Body:     { image: <data-URL>, removeBackground?: boolean }
//   Response: { success: true, output: <bild-url> } | { success: false, error }
//   Status:   GET /api/stencil  →  { configured: boolean }
//
// ── Setup (Vercel → Settings → Environment Variables) ───────────────────────
//   REPLICATE_API_TOKEN = r8_…                         (Pflicht)
//   REPLICATE_MODEL     = qwen/qwen-image-edit         (Pflicht)
//
// Empfohlene Modelle (einfach den Namen eintragen, KEIN Version-Hash nötig):
//   qwen/qwen-image-edit                → Bild-Feld "image"  → nichts weiter nötig
//   black-forest-labs/flux-kontext-pro  → Bild-Feld "input_image"
//                                          → zusätzlich REPLICATE_IMAGE_KEY=input_image setzen
//
//   Optional:
//     REPLICATE_IMAGE_KEY = image    Name des Bild-Eingabefeldes des Modells
//     REPLICATE_PROMPT    = …        eigener Prompt (überschreibt den Standard)
//     REPLICATE_MODEL kann auch "owner/name:<version-hash>" sein, falls gewünscht.

const PREDICTIONS_API = 'https://api.replicate.com/v1/predictions';
const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 55000;
const MAX_IMAGE_CHARS = 12 * 1024 * 1024; // ~9 MB Bild als data-URL; schützt vor Riesen-Payloads

const DEFAULT_PROMPT =
  'Convert this image into a clean black-and-white tattoo stencil. Trace only the ' +
  'outlines and the main line work of the motif as solid crisp black lines on a plain ' +
  'white background. Remove all colour and shading, no grey tones — just clean line art ' +
  'suitable as a tattoo stencil.';

import { verifyAdminRequest } from './_lib/admin-auth.js';

function firstOutput(output) {
  if (Array.isArray(output)) return output[output.length - 1] || null;
  if (output && typeof output === 'object' && output.url) return output.url;
  return output || null;
}

// Erzeugt die Prediction — unterstützt offizielle Modelle ("owner/name", ohne
// Version) ebenso wie versionierte Modelle ("owner/name:<hash>").
async function createPrediction(model, input, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: 'wait', // synchroner Modus: Replicate wartet bis zu 60 s
  };
  if (model.includes(':')) {
    const version = model.split(':').pop();
    const r = await fetch(PREDICTIONS_API, {
      method: 'POST',
      headers,
      body: JSON.stringify({ version, input }),
    });
    return { r, body: await r.json() };
  }
  const r = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input }),
  });
  return { r, body: await r.json() };
}

async function runReplicate(model, input, token) {
  const { r, body } = await createPrediction(model, input, token);
  let pred = body;
  if (r.status === 401) {
    throw new Error(
      'Replicate lehnt den Token ab. Bitte REPLICATE_API_TOKEN in Vercel prüfen ' +
        '(ohne Leerzeichen/Anführungszeichen, beginnt mit "r8_") und neu deployen.',
    );
  }
  if (r.status >= 400 || pred?.error) {
    throw new Error(pred?.detail || pred?.error || `Replicate HTTP ${r.status}`);
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  while (pred.status === 'starting' || pred.status === 'processing') {
    if (Date.now() > deadline) throw new Error('Zeitüberschreitung bei der KI-Verarbeitung');
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
    const poll = await fetch(`${PREDICTIONS_API}/${pred.id}`, {
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

function buildPrompt(removeBackground) {
  const base = process.env.REPLICATE_PROMPT?.trim() || DEFAULT_PROMPT;
  if (removeBackground === false) {
    return `${base} Keep the original background.`;
  }
  return `${base} Also remove the background completely so only the line work remains on white.`;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const token = process.env.REPLICATE_API_TOKEN?.trim();
  const model = process.env.REPLICATE_MODEL?.trim();

  if (req.method === 'GET') {
    return res.status(200).json({ configured: Boolean(token && model) });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const adminEmail = await verifyAdminRequest(req);
  if (!adminEmail) {
    return res.status(401).json({ success: false, error: 'Nicht autorisiert' });
  }

  if (!token || !model) {
    return res.status(500).json({
      success: false,
      error: 'Stencil-Tool nicht konfiguriert (REPLICATE_API_TOKEN / REPLICATE_MODEL fehlen).',
    });
  }

  const { image, removeBackground } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ success: false, error: 'Bild fehlt' });
  }
  if (!/^(data:image\/|https:\/\/)/i.test(image)) {
    return res.status(400).json({ success: false, error: 'Ungültiges Bildformat' });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ success: false, error: 'Bild ist zu groß' });
  }

  try {
    const imageKey = process.env.REPLICATE_IMAGE_KEY || 'image';
    const input = {
      [imageKey]: image,
      prompt: buildPrompt(removeBackground),
    };
    const output = await runReplicate(model, input, token);
    return res.status(200).json({ success: true, output });
  } catch (err) {
    console.error('Stencil generation failed:', err);
    return res.status(502).json({ success: false, error: err.message });
  }
}
