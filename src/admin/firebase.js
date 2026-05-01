import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

/**
 * Erwartete Umgebungsvariablen (Vite): VITE_FIREBASE_*
 * Siehe .env.example im Projektroot.
 */
export function getFirebaseConfig() {
  const cfg = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  if (!cfg.apiKey || !cfg.projectId) return null;
  return cfg;
}

let appSingleton;
export function getFirebaseApp() {
  const cfg = getFirebaseConfig();
  if (!cfg) return null;
  if (!appSingleton) appSingleton = initializeApp(cfg);
  return appSingleton;
}

export function getDb() {
  const app = getFirebaseApp();
  return app ? getFirestore(app) : null;
}

export function getBucket() {
  const app = getFirebaseApp();
  return app ? getStorage(app) : null;
}

export function getFirebaseAuth() {
  const app = getFirebaseApp();
  return app ? getAuth(app) : null;
}
