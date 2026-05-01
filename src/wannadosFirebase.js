import { collection, getDocs, limit, query } from 'firebase/firestore';
import { getDb } from './firebase/client';

/** Konvertiert Firestore-Zeitstempel nicht — nur Top-Level Felder für die UI. */

export async function fetchWannadosFromFirestore(maxDocs = 120) {
  const db = getDb();
  if (!db) return [];
  const snap = await getDocs(query(collection(db, 'wannados'), limit(maxDocs)));
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      src: data.src,
      title: data.title,
      style: data.style,
      placement: data.placement,
      target: data.target,
      desc: data.desc,
      available: data.available !== false,
      order: typeof data.order === 'number' ? data.order : undefined,
      placement3d: data.placement3d ?? null,
    };
  });
  rows.sort((a, b) => {
    const ao = a.order ?? 9999;
    const bo = b.order ?? 9999;
    if (ao !== bo) return ao - bo;
    return (a.title || '').localeCompare(b.title || '');
  });
  return rows;
}
