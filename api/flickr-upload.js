// Vercel Serverless Function — Flickr-Upload für Tattoo-Galerie (Urheberschutz via Pixsy-Sync)
//
// Aufruf vom Admin-Frontend (POST /api/flickr-upload):
//   Headers:  Authorization: Bearer <Firebase ID Token>
//   Body:     { downloadUrl, docId, title?, description?, tags?, style?, piece? }
//   Response: { success: true, photoId, photoUrl } | { success: false, error }
//
// Setup:
//   1. scripts/flickr-oauth-setup.js einmalig lokal ausführen
//   2. Die vier Werte (API Key, Shared Secret, Access Token, Access Token Secret)
//      in Vercel → Settings → Environment Variables eintragen
//   3. Optional: FLICKR_STUDIO_NAME, FLICKR_ARTIST_NAME, FLICKR_USER_ID

import crypto from 'crypto';
import { verifyAdminRequest } from './_lib/admin-auth.js';

const FLICKR_UPLOAD_URL = 'https://up.flickr.com/services/upload/';

// ── OAuth 1.0a Signing ──────────────────────────────────────────────────────

function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function signRequest(method, url, params, consumerSecret, tokenSecret) {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const base = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || '')}`;
  return crypto.createHmac('sha1', key).update(base).digest('base64');
}

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

// ── Admin-Verifizierung via Firebase Identity Toolkit ───────────────────────

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

// ── Flickr XML-Response parsen ──────────────────────────────────────────────

function parseFlickrResponse(xml) {
  const okMatch = xml.match(/stat="ok"/);
  if (okMatch) {
    const idMatch = xml.match(/<photoid[^>]*>([^<]+)<\/photoid>/);
    return { success: true, photoId: idMatch ? idMatch[1].trim() : null };
  }
  const errMatch = xml.match(/<err\s+code="([^"]+)"\s+msg="([^"]+)"/);
  return {
    success: false,
    error: errMatch ? `Flickr ${errMatch[1]}: ${errMatch[2]}` : 'Unbekannte Flickr-Antwort',
  };
}

// ── Default Title / Tags / Description ──────────────────────────────────────

function buildDefaults({ docId, style, piece, title, description, tags }) {
  const studio = process.env.FLICKR_STUDIO_NAME || 'KleopatraINK';
  const artist = process.env.FLICKR_ARTIST_NAME || '';
  const nameParts = [studio, style, piece, docId].filter(Boolean).map((p) => String(p).replace(/[^a-zA-Z0-9_-]+/g, '_'));
  const defaultTitle = title?.trim() || nameParts.join('_') || 'Tattoo_Original_Design';
  const tagList = (tags && tags.length
    ? String(tags).split(/[\s,]+/)
    : ['Tattoo', 'Original_Design', studio, artist, style, piece]
  )
    .map((t) => String(t || '').trim().replace(/\s+/g, '_'))
    .filter(Boolean);
  const uniqueTags = [...new Set(tagList)].join(' ');
  const defaultDesc =
    description?.trim() ||
    `Original-Design von ${artist || studio}. Geschützt via Pixsy-Sync.${piece ? ` Motiv: ${piece}.` : ''}${style ? ` Stil: ${style}.` : ''}`;
  return { title: defaultTitle, tags: uniqueTags, description: defaultDesc };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Auth
  const adminEmail = await verifyAdminRequest(req);
  if (!adminEmail) {
    return res.status(401).json({ success: false, error: 'Nicht autorisiert' });
  }

  // Credentials prüfen
  const apiKey = process.env.FLICKR_API_KEY;
  const sharedSecret = process.env.FLICKR_SHARED_SECRET;
  const accessToken = process.env.FLICKR_ACCESS_TOKEN;
  const accessSecret = process.env.FLICKR_ACCESS_TOKEN_SECRET;
  if (!apiKey || !sharedSecret || !accessToken || !accessSecret) {
    return res.status(500).json({
      success: false,
      error:
        'Flickr-Credentials fehlen. Setze FLICKR_API_KEY, FLICKR_SHARED_SECRET, FLICKR_ACCESS_TOKEN, FLICKR_ACCESS_TOKEN_SECRET in Vercel.',
    });
  }

  const body = req.body || {};
  const { downloadUrl, docId, style, piece } = body;
  if (!downloadUrl) {
    return res.status(400).json({ success: false, error: 'downloadUrl fehlt' });
  }

  // 1. Original-Bild aus Firebase Storage holen
  let imgBuffer;
  let contentType = 'image/jpeg';
  try {
    const imgRes = await fetch(downloadUrl);
    if (!imgRes.ok) {
      return res
        .status(502)
        .json({ success: false, error: `Bild konnte nicht geladen werden (HTTP ${imgRes.status})` });
    }
    contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  } catch (e) {
    return res.status(502).json({ success: false, error: `Bild-Fetch fehlgeschlagen: ${e.message}` });
  }

  // 2. Default-Metadaten
  const meta = buildDefaults({ docId, style, piece, ...body });

  // 3. OAuth-Parameter
  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_token: accessToken,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: generateNonce(),
    oauth_version: '1.0',
  };

  // 4. API-Parameter (gehen in die Signatur, OHNE das Foto selbst)
  const apiParams = {
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
    is_public: '1',
    is_friend: '0',
    is_family: '0',
    safety_level: '1',
    content_type: '1',
    hidden: '2', // 2 = aus Suchindex ausschließen, API/Feed bleibt erreichbar
  };

  const signature = signRequest(
    'POST',
    FLICKR_UPLOAD_URL,
    { ...oauthParams, ...apiParams },
    sharedSecret,
    accessSecret,
  );

  // 5. Multipart-Form bauen
  const form = new FormData();
  for (const [k, v] of Object.entries(apiParams)) form.append(k, String(v));
  for (const [k, v] of Object.entries(oauthParams)) form.append(k, String(v));
  form.append('oauth_signature', signature);
  const ext = contentType.split('/')[1] || 'jpg';
  const blob = new Blob([imgBuffer], { type: contentType });
  form.append('photo', blob, `${docId || 'design'}.${ext}`);

  // 6. Upload an Flickr
  let uploadXml = '';
  try {
    const uploadRes = await fetch(FLICKR_UPLOAD_URL, { method: 'POST', body: form });
    uploadXml = await uploadRes.text();
  } catch (e) {
    return res.status(502).json({ success: false, error: `Flickr-Upload fehlgeschlagen: ${e.message}` });
  }

  const parsed = parseFlickrResponse(uploadXml);
  if (!parsed.success) {
    return res.status(502).json({ success: false, error: parsed.error, raw: uploadXml.slice(0, 400) });
  }

  const flickrUserId = process.env.FLICKR_USER_ID;
  const photoUrl = flickrUserId
    ? `https://www.flickr.com/photos/${flickrUserId}/${parsed.photoId}/`
    : `https://www.flickr.com/photo.gne?id=${parsed.photoId}`;

  return res.status(200).json({
    success: true,
    photoId: parsed.photoId,
    photoUrl,
    title: meta.title,
    tags: meta.tags,
  });
}
