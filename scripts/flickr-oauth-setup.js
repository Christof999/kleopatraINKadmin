#!/usr/bin/env node
/**
 * Flickr OAuth 1.0a Setup-CLI — einmalig lokal ausführen.
 *
 *   node scripts/flickr-oauth-setup.js
 *
 * Was passiert:
 *   1. Du gibst API Key + Shared Secret ein (von flickr.com/services/apps/by/me)
 *   2. Script holt ein Request-Token, öffnet die Flickr-Authorize-URL
 *   3. Du autorisierst die App im Browser → Flickr zeigt dir einen 9-stelligen Code
 *   4. Code zurück ins Terminal kopieren
 *   5. Script tauscht das gegen einen permanenten Access-Token
 *   6. Vier Zeilen für die Vercel-Env-Vars werden ausgegeben
 *
 * Die Tokens sind unbegrenzt gültig (bis du sie auf Flickr widerrufst).
 */

import crypto from 'node:crypto';
import readline from 'node:readline';

const REQUEST_TOKEN_URL = 'https://www.flickr.com/services/oauth/request_token';
const AUTHORIZE_URL = 'https://www.flickr.com/services/oauth/authorize';
const ACCESS_TOKEN_URL = 'https://www.flickr.com/services/oauth/access_token';
const CALLBACK_URL = 'oob'; // out-of-band → Flickr zeigt den Code im Browser an

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

function parseQs(qs) {
  return Object.fromEntries(
    qs
      .split('&')
      .filter(Boolean)
      .map((pair) => pair.split('=').map(decodeURIComponent)),
  );
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

async function main() {
  console.log('\n🔑  Flickr OAuth 1.0a Setup\n');
  console.log('Brauchst du noch API Key + Shared Secret? → https://www.flickr.com/services/apps/create/apply/\n');

  const consumerKey = await ask('API Key:        ');
  const consumerSecret = await ask('Shared Secret:  ');
  if (!consumerKey || !consumerSecret) {
    console.error('\n❌  API Key und Shared Secret sind erforderlich. Abbruch.');
    rl.close();
    process.exit(1);
  }

  // ── 1. Request Token holen ───────────────────────────────────────────────
  const reqParams = {
    oauth_callback: CALLBACK_URL,
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
  };
  reqParams.oauth_signature = signRequest('GET', REQUEST_TOKEN_URL, reqParams, consumerSecret, '');

  const reqUrl = `${REQUEST_TOKEN_URL}?${new URLSearchParams(reqParams).toString()}`;
  const reqRes = await fetch(reqUrl);
  const reqText = await reqRes.text();
  if (!reqRes.ok) {
    console.error(`\n❌  Request-Token fehlgeschlagen (HTTP ${reqRes.status}):\n${reqText}\n`);
    rl.close();
    process.exit(1);
  }
  const reqData = parseQs(reqText);
  if (!reqData.oauth_token || !reqData.oauth_token_secret) {
    console.error(`\n❌  Flickr-Antwort enthält keine Request-Tokens:\n${reqText}\n`);
    rl.close();
    process.exit(1);
  }

  // ── 2. Authorize-URL anzeigen ────────────────────────────────────────────
  const authUrl = `${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(reqData.oauth_token)}&perms=write`;
  console.log('\n👉  Öffne diese URL im Browser, logge dich mit dem Flickr-Account ein und autorisiere die App:\n');
  console.log(`   ${authUrl}\n`);
  console.log('Flickr zeigt dir danach einen 9-stelligen Bestätigungscode.\n');

  const verifier = await ask('Bestätigungscode aus Flickr:  ');
  if (!verifier) {
    console.error('\n❌  Kein Code eingegeben. Abbruch.');
    rl.close();
    process.exit(1);
  }

  // ── 3. Access Token tauschen ─────────────────────────────────────────────
  const accessParams = {
    oauth_consumer_key: consumerKey,
    oauth_token: reqData.oauth_token,
    oauth_verifier: verifier,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
  };
  accessParams.oauth_signature = signRequest(
    'GET',
    ACCESS_TOKEN_URL,
    accessParams,
    consumerSecret,
    reqData.oauth_token_secret,
  );

  const accessUrl = `${ACCESS_TOKEN_URL}?${new URLSearchParams(accessParams).toString()}`;
  const accessRes = await fetch(accessUrl);
  const accessText = await accessRes.text();
  if (!accessRes.ok) {
    console.error(`\n❌  Access-Token-Tausch fehlgeschlagen (HTTP ${accessRes.status}):\n${accessText}\n`);
    rl.close();
    process.exit(1);
  }
  const accessData = parseQs(accessText);
  if (!accessData.oauth_token || !accessData.oauth_token_secret) {
    console.error(`\n❌  Antwort enthält keinen Access Token:\n${accessText}\n`);
    rl.close();
    process.exit(1);
  }

  console.log('\n✅  Erfolgreich autorisiert!\n');
  console.log(`Account:  ${accessData.username || '?'}  (NSID: ${accessData.user_nsid || '?'})\n`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log('Diese vier Werte in Vercel → Settings → Environment Variables:');
  console.log('───────────────────────────────────────────────────────────────\n');
  console.log(`FLICKR_API_KEY=${consumerKey}`);
  console.log(`FLICKR_SHARED_SECRET=${consumerSecret}`);
  console.log(`FLICKR_ACCESS_TOKEN=${accessData.oauth_token}`);
  console.log(`FLICKR_ACCESS_TOKEN_SECRET=${accessData.oauth_token_secret}`);
  if (accessData.user_nsid) console.log(`FLICKR_USER_ID=${accessData.user_nsid}`);
  console.log('\nOptional:');
  console.log('FLICKR_STUDIO_NAME=KleopatraINK');
  console.log('FLICKR_ARTIST_NAME=Nadia_Reyhani');
  console.log('\n💡  Tipp: für lokale Tests dieselben Werte in .env eintragen.\n');

  rl.close();
}

main().catch((e) => {
  console.error('\n❌  Unerwarteter Fehler:', e.message || e);
  rl.close();
  process.exit(1);
});
