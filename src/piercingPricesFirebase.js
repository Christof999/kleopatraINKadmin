import { collection, getDocs, limit, query } from 'firebase/firestore';
import { getDb } from './firebase/client';

function normalizePrice(value) {
  const price = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(price) ? price : 0;
}

export async function fetchPiercingPricesFromFirestore(maxDocs = 200) {
  const db = getDb();
  if (!db) return [];
  const snap = await getDocs(query(collection(db, 'piercingPrices'), limit(maxDocs)));
  const rows = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: data.title,
        desc: data.desc || '',
        price: normalizePrice(data.price),
      };
    })
    .filter((row) => row.title && row.price > 0);

  rows.sort((a, b) => a.title.localeCompare(b.title));
  return rows;
}
