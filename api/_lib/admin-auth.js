// Gemeinsame Admin-Authentifizierung für die Vercel Serverless Functions.
// Wird von api/flickr-upload.js und api/stencil.js genutzt (eine Quelle der Wahrheit).
//
// Dateien/Ordner mit "_"-Präfix in /api werden von Vercel NICHT als eigene Route
// behandelt, sondern nur in die importierenden Functions gebündelt.

// Studio-Admins. Standardwerte; per Env ADMIN_EMAILS (kommagetrennt) überschreibbar.
const DEFAULT_ADMIN_EMAILS = ['info@soergel-design.de', 'info@kleopatra-ink.com'];

export function getAdminEmails() {
  const fromEnv = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(fromEnv.length ? fromEnv : DEFAULT_ADMIN_EMAILS);
}

// Liest den Bearer-Token aus dem Request-Header.
export function getBearerToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

// Prüft den Firebase ID-Token gegen die Google Identity Toolkit API und gibt die
// E-Mail zurück, wenn der Nutzer ein freigeschalteter Admin ist – sonst null.
export async function verifyAdminToken(idToken) {
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
    return getAdminEmails().has(email) ? email : null;
  } catch {
    return null;
  }
}

// Bequemer Helfer: verifiziert direkt aus dem Request.
export async function verifyAdminRequest(req) {
  return verifyAdminToken(getBearerToken(req));
}
