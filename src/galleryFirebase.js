import { collection, getDocs, limit, query } from 'firebase/firestore';
import { getDb } from './firebase/client';

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

export async function fetchGalleryFromFirestore(maxDocs = 120) {
  const db = getDb();
  if (!db) return [];
  const snap = await getDocs(query(collection(db, 'gallery'), limit(maxDocs)));
  const rows = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        src: data.src,
        style: data.style,
        piece: data.piece,
        createdAt: data.createdAt ?? null,
      };
    })
    .filter((row) => row.src && row.style);

  rows.sort((a, b) => {
    const createdDiff = timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt);
    if (createdDiff !== 0) return createdDiff;
    return (a.style || '').localeCompare(b.style || '');
  });

  return rows;
}
