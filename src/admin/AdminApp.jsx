import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState, Suspense, lazy } from 'react';
import { TATTOO_STYLES, WANNADO_TARGETS } from '../constants/styles';
import LuckyWheel, { formatSegment, segmentColor } from '../components/LuckyWheel';
import StencilTool from './StencilTool';
import { getDb, getBucket, getFirebaseAuth, getFirebaseConfig } from './firebase';
import brandLogoUrl from '../../IMG_0708.jpeg';
import { addGalleryWatermark, galleryUploadExtension, preloadWatermarkLogo } from './watermark';
import '../styles.css';
import './admin.css';

const Body3DViewer = lazy(() => import('../components/Body3DViewer'));

const WHEEL_CONFIG_DOC = 'main';
const WHEEL_TYPES = [
  { value: 'amount', label: 'Betrag (€)' },
  { value: 'percent', label: 'Prozent (%)' },
  { value: 'text', label: 'Freitext' },
];

function newSegmentId() {
  return `seg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeBlankSegment() {
  return { id: newSegmentId(), type: 'amount', label: '', value: '', color: '' };
}

function normalizeSegmentForSave(seg) {
  const type = WHEEL_TYPES.some((t) => t.value === seg.type) ? seg.type : 'text';
  const out = { id: seg.id || newSegmentId(), type, label: (seg.label || '').trim() };
  if (type === 'amount' || type === 'percent') {
    const raw = String(seg.value ?? '').trim().replace(/\./g, '').replace(',', '.');
    const num = Number(raw);
    out.value = Number.isFinite(num) ? num : 0;
  }
  if (seg.color && seg.color.trim()) out.color = seg.color.trim();
  return out;
}

function formatDateTime(value) {
  if (!value) return '—';
  let date;
  if (typeof value?.toDate === 'function') date = value.toDate();
  else if (value instanceof Date) date = value;
  else if (typeof value === 'number') date = new Date(value);
  else if (typeof value === 'string') date = new Date(value);
  else return '—';
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

const ADMIN_EMAILS = new Set(['info@soergel-design.de', 'info@kleopatra-ink.com']);
const CAMERA_PATTERN = /^(img|dsc|dscn|p\d|mgim|mvim)[-_]?\d/i;
const EUR_FORMATTER = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
});

function isAdminEmail(email) {
  return ADMIN_EMAILS.has(String(email || '').trim().toLowerCase());
}

function adminAccessMessage(email) {
  return email
    ? `Dieses Konto (${email}) ist nicht für das Admin-Portal freigeschaltet.`
    : 'Dieses Konto ist nicht für das Admin-Portal freigeschaltet.';
}

function parsePriceInput(value) {
  const normalized = String(value).trim().replace(/\./g, '').replace(',', '.');
  const price = Number(normalized);
  return Number.isFinite(price) ? price : null;
}

function formatPrice(value) {
  const price = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(price) ? EUR_FORMATTER.format(price) : '—';
}

function sortPiercingRows(rows) {
  return [...rows].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

function userFullName(row) {
  const firstName = row.firstName || row.firstname || '';
  const lastName = row.lastName || row.lastname || '';
  const combined = `${firstName} ${lastName}`.trim();
  return row.fullName || row.name || combined || 'Ohne Namen';
}

function userPhone(row) {
  return row.phone || row.phoneNumber || row.telephone || row.tel || '';
}

function sortUserRows(rows) {
  return [...rows].sort((a, b) => {
    const nameCompare = userFullName(a).localeCompare(userFullName(b));
    if (nameCompare !== 0) return nameCompare;
    return (a.email || '').localeCompare(b.email || '');
  });
}

function pieceFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  if (CAMERA_PATTERN.test(base)) return '';
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function storageRefFromDownloadUrl(bucket, url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const marker = '/o/';
    const i = url.indexOf(marker);
    if (i === -1) return null;
    const encoded = url.slice(i + marker.length).split('?')[0];
    const path = decodeURIComponent(encoded);
    return ref(bucket, path);
  } catch {
    return null;
  }
}

const PLACEMENT_HINTS = [
  'Unterarm',
  'Oberarm',
  'Schulter',
  'Schulterblatt',
  'Brust',
  'Rippen',
  'Hand',
  'Bein',
  'Wade',
  'Rücken',
  'Nacken',
  'Knie',
];

function PageHead({ kicker, title, titleEm, meta }) {
  return (
    <div className="page-head admin-page-head">
      <div>
        <div className="page-kicker">{kicker}</div>
        <h1 className="page-title">
          {title}
          {titleEm && (
            <>
              {' '}
              <em>{titleEm}</em>
            </>
          )}
        </h1>
      </div>
      {meta && <div className="page-meta">{meta}</div>}
    </div>
  );
}

export default function AdminApp() {
  const cfg = getFirebaseConfig();
  const db = getDb();
  const storage = getBucket();
  const auth = getFirebaseAuth();

  const [user, setUser] = useState(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [listError, setListError] = useState('');
  const [tab, setTab] = useState('gallery');

  const [galFiles, setGalFiles] = useState([]);
  const [galPreviewUrls, setGalPreviewUrls] = useState([]);
  const [galStyle, setGalStyle] = useState(TATTOO_STYLES[0]);
  const [galPiece, setGalPiece] = useState('');
  const [galUploadProgress, setGalUploadProgress] = useState(null);

  const [wdFile, setWdFile] = useState(null);
  const [wdPreview, setWdPreview] = useState('');
  const [wdTitle, setWdTitle] = useState('');
  const [wdStyle, setWdStyle] = useState(TATTOO_STYLES[0]);
  const [wdPlacement, setWdPlacement] = useState('');
  const [wdTarget, setWdTarget] = useState('Alle');
  const [wdDesc, setWdDesc] = useState('');
  const [wdAvailable, setWdAvailable] = useState(true);
  const [wdOrder, setWdOrder] = useState('');
  const [wdEditingId, setWdEditingId] = useState(null);
  const [wdRemoteSrc, setWdRemoteSrc] = useState(null);
  const [wdPlacementInitial, setWdPlacementInitial] = useState(null);
  const [piercingTitle, setPiercingTitle] = useState('');
  const [piercingDesc, setPiercingDesc] = useState('');
  const [piercingPrice, setPiercingPrice] = useState('');
  const [piercingEditingId, setPiercingEditingId] = useState(null);
  const [customerEditingId, setCustomerEditingId] = useState(null);
  const [customerFirstName, setCustomerFirstName] = useState('');
  const [customerLastName, setCustomerLastName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [galleryRows, setGalleryRows] = useState([]);
  const [wannadoRows, setWannadoRows] = useState([]);
  const [piercingRows, setPiercingRows] = useState([]);
  const [customerRows, setCustomerRows] = useState([]);
  const [wheelSegments, setWheelSegments] = useState([]);
  const [wheelActive, setWheelActive] = useState(true);
  const [wheelDirty, setWheelDirty] = useState(false);
  const [wheelLoaded, setWheelLoaded] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [userSearch, setUserSearch] = useState('');
  const placement3dRef = useRef(null);

  useEffect(() => {
    if (!auth) return undefined;
    return onAuthStateChanged(auth, async (nextUser) => {
      if (!nextUser) {
        setUser(null);
        return;
      }

      if (isAdminEmail(nextUser.email)) {
        setAuthError('');
        setUser(nextUser);
        return;
      }

      setUser(null);
      setAuthError(adminAccessMessage(nextUser.email));
      try {
        await signOut(auth);
      } catch {
        /* Auth-State wird beim nächsten Wechsel erneut geprüft. */
      }
    });
  }, [auth]);

  const loadLists = useCallback(async () => {
    if (!db || !user) return;
    const parts = [];
    try {
      const wSnap = await getDocs(query(collection(db, 'wannados'), limit(200)));
      setWannadoRows(wSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      parts.push(`Wanna-dos: ${e.message || String(e)}`);
      setWannadoRows([]);
    }
    if (parts.length) setListError(parts.join(' · '));
    else setListError('');
  }, [db, user]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    preloadWatermarkLogo(brandLogoUrl).catch(() => {
      /* Fehler wird beim Galerie-Upload angezeigt. */
    });
  }, []);

  useEffect(() => {
    if (!db || !user) {
      setGalleryRows([]);
      return undefined;
    }
    const galleryQuery = query(collection(db, 'gallery'), limit(200));
    return onSnapshot(
      galleryQuery,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        setGalleryRows(rows);
      },
      (e) => {
        setListError((current) => {
          const otherParts = current.split(' · ').filter((p) => p && !p.startsWith('Galerie:'));
          return [...otherParts, `Galerie: ${e.message || String(e)}`].join(' · ');
        });
      },
    );
  }, [db, user]);

  useEffect(() => {
    if (!db || !user) {
      setPiercingRows([]);
      return undefined;
    }

    const piercingQuery = query(collection(db, 'piercingPrices'), limit(200));
    return onSnapshot(
      piercingQuery,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPiercingRows(sortPiercingRows(rows));
      },
      (e) => {
        setPiercingRows([]);
        setListError((current) => {
          const otherParts = current
            .split(' · ')
            .filter((part) => part && !part.startsWith('Piercings:'));
          return [...otherParts, `Piercings: ${e.message || String(e)}`].join(' · ');
        });
      },
    );
  }, [db, user]);

  useEffect(() => {
    if (!db || !user) {
      setWheelSegments([]);
      setWheelActive(true);
      setWheelLoaded(false);
      return undefined;
    }
    return onSnapshot(
      doc(db, 'wheelConfig', WHEEL_CONFIG_DOC),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() || {};
          setWheelSegments(Array.isArray(data.segments) ? data.segments : []);
          setWheelActive(data.active !== false);
        } else {
          setWheelSegments([]);
          setWheelActive(true);
        }
        setWheelLoaded(true);
        setWheelDirty(false);
      },
      (e) => {
        setWheelLoaded(true);
        setListError((current) => {
          const otherParts = current
            .split(' · ')
            .filter((part) => part && !part.startsWith('Glücksrad:'));
          return [...otherParts, `Glücksrad: ${e.message || String(e)}`].join(' · ');
        });
      },
    );
  }, [db, user]);

  useEffect(() => {
    if (!db || !user) {
      setCustomerRows([]);
      return undefined;
    }

    const usersQuery = query(collection(db, 'users'), limit(500));
    return onSnapshot(
      usersQuery,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCustomerRows(sortUserRows(rows));
        setListError((current) =>
          current
            .split(' · ')
            .filter((part) => part && !part.startsWith('User:'))
            .join(' · '),
        );
      },
      (e) => {
        setCustomerRows([]);
        setListError((current) => {
          const otherParts = current
            .split(' · ')
            .filter((part) => part && !part.startsWith('User:'));
          return [...otherParts, `User: ${e.message || String(e)}`].join(' · ');
        });
      },
    );
  }, [db, user]);

  const onLogin = async (e) => {
    e.preventDefault();
    if (!auth) return;
    setAuthError('');
    setBusy(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, authEmail.trim().toLowerCase(), authPassword);
      if (!isAdminEmail(credential.user.email)) {
        await signOut(auth);
        setUser(null);
        setAuthError(adminAccessMessage(credential.user.email));
        return;
      }
      setAuthPassword('');
    } catch (err) {
      setAuthError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const onLogout = async () => {
    if (!auth) return;
    await signOut(auth);
  };

  const clearGalSelection = () => {
    galPreviewUrls.forEach((u) => URL.revokeObjectURL(u));
    setGalFiles([]);
    setGalPreviewUrls([]);
    setGalUploadProgress(null);
  };

  const onGalFiles = (e) => {
    const list = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    galPreviewUrls.forEach((u) => URL.revokeObjectURL(u));
    setGalFiles(list);
    setGalPreviewUrls(list.map((f) => URL.createObjectURL(f)));
    e.target.value = '';
  };

  const clearWdFile = () => {
    if (wdPreview) URL.revokeObjectURL(wdPreview);
    setWdFile(null);
    setWdPreview('');
  };

  const resetWannadoForm = () => {
    clearWdFile();
    setWdEditingId(null);
    setWdRemoteSrc(null);
    setWdTitle('');
    setWdStyle(TATTOO_STYLES[0]);
    setWdPlacement('');
    setWdTarget('Alle');
    setWdDesc('');
    setWdAvailable(true);
    setWdOrder('');
    placement3dRef.current = null;
    setWdPlacementInitial(null);
  };

  const loadWannadoForEdit = (row) => {
    if (wdPreview) URL.revokeObjectURL(wdPreview);
    setWdFile(null);
    setWdPreview('');
    setWdEditingId(row.id);
    setWdRemoteSrc(row.src);
    setWdTitle(row.title || '');
    setWdStyle(TATTOO_STYLES.includes(row.style) ? row.style : TATTOO_STYLES[0]);
    setWdPlacement(row.placement || '');
    setWdTarget(WANNADO_TARGETS.includes(row.target) ? row.target : 'Alle');
    setWdDesc(row.desc || '');
    setWdAvailable(row.available !== false);
    setWdOrder(row.order != null && row.order !== '' ? String(row.order) : '');
    placement3dRef.current = row.placement3d ?? null;
    setWdPlacementInitial(row.placement3d ?? null);
    setTab('wannados');
  };

  const resetPiercingForm = () => {
    setPiercingEditingId(null);
    setPiercingTitle('');
    setPiercingDesc('');
    setPiercingPrice('');
  };

  const loadPiercingForEdit = (row) => {
    setPiercingEditingId(row.id);
    setPiercingTitle(row.title || '');
    setPiercingDesc(row.desc || '');
    setPiercingPrice(row.price != null ? String(row.price).replace('.', ',') : '');
    setTab('piercings');
  };

  const resetCustomerForm = () => {
    setCustomerEditingId(null);
    setCustomerFirstName('');
    setCustomerLastName('');
    setCustomerEmail('');
    setCustomerPhone('');
  };

  const loadCustomerForEdit = (row) => {
    const fullName = userFullName(row);
    const parts = fullName === 'Ohne Namen' ? [] : fullName.split(/\s+/);
    setCustomerEditingId(row.id);
    setCustomerFirstName(row.firstName || row.firstname || parts.slice(0, -1).join(' ') || fullName);
    setCustomerLastName(row.lastName || row.lastname || (parts.length > 1 ? parts.slice(-1).join('') : ''));
    setCustomerEmail(row.email || '');
    setCustomerPhone(userPhone(row));
    setTab('users');
  };

  const onWdFile = (e) => {
    const f = e.target.files?.[0];
    clearWdFile();
    if (!f) return;
    setWdFile(f);
    setWdPreview(URL.createObjectURL(f));
    setWdRemoteSrc(null);
    placement3dRef.current = null;
    setWdPlacementInitial(null);
  };

  const triggerFlickrUpload = useCallback(async (galleryId, payload) => {
    if (!db || !auth?.currentUser) return;
    const docRef = doc(db, 'gallery', galleryId);
    try {
      await updateDoc(docRef, {
        flickr: { status: 'pending', startedAt: new Date().toISOString() },
      });
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/flickr-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          downloadUrl: payload.originalSrc || payload.src,
          docId: galleryId,
          style: payload.style || '',
          piece: payload.piece || '',
        }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = { success: false, error: `Antwort konnte nicht gelesen werden (HTTP ${res.status})` };
      }
      if (res.ok && data.success) {
        await updateDoc(docRef, {
          flickr: {
            status: 'success',
            photoId: data.photoId || '',
            photoUrl: data.photoUrl || '',
            title: data.title || '',
            tags: data.tags || '',
            uploadedAt: serverTimestamp(),
          },
        });
      } else {
        await updateDoc(docRef, {
          flickr: {
            status: 'failed',
            error: data.error || `HTTP ${res.status}`,
            attemptedAt: serverTimestamp(),
          },
        });
      }
    } catch (e) {
      try {
        await updateDoc(docRef, {
          flickr: {
            status: 'failed',
            error: e.message || String(e),
            attemptedAt: serverTimestamp(),
          },
        });
      } catch {
        /* Update ebenfalls fehlgeschlagen — Network down. */
      }
    }
  }, [db, auth]);

  const retryFlickrUpload = (row) => {
    if (!row?.id || !row?.src) return;
    triggerFlickrUpload(row.id, {
      src: row.src,
      originalSrc: row.originalSrc,
      style: row.style,
      piece: row.piece,
    });
  };

  const submitGallery = async (e) => {
    e.preventDefault();
    if (!db || !storage || !user) return;
    if (galFiles.length === 0) {
      setStatus('Bitte mindestens ein Bild wählen.');
      return;
    }
    setBusy(true);
    setStatus('');
    setGalUploadProgress(0);
    let ok = 0;
    try {
      for (let i = 0; i < galFiles.length; i += 1) {
        const galFile = galFiles[i];
        setStatus(`Wasserzeichen wird vorbereitet (${i + 1}/${galFiles.length}) …`);
        const uploadFile = await addGalleryWatermark(galFile, brandLogoUrl);
        const ext = galleryUploadExtension(uploadFile.type, galFile.name);
        const extOrig = galFile.name.split('.').pop() || 'jpg';
        const baseId = `${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`;
        const pieceRaw = galPiece.trim();
        const piece = pieceRaw || pieceFromFilename(galFile.name);

        const uploadOne = (file, storagePath, contentType) =>
          new Promise((resolve, reject) => {
            const sref = ref(storage, storagePath);
            const task = uploadBytesResumable(sref, file, {
              contentType: contentType || file.type || 'image/jpeg',
            });
            task.on(
              'state_changed',
              (snap) => {
                const fileProgress = snap.bytesTransferred / Math.max(1, file.size);
                const progress = ((i + fileProgress) / galFiles.length) * 100;
                setGalUploadProgress(Math.min(99, Math.round(progress)));
              },
              reject,
              async () => {
                resolve(await getDownloadURL(task.snapshot.ref));
              },
            );
          });

        // Original unter gallery/orig_* — nutzt bestehende Storage-Regel match /gallery/{fileName}
        // (kein separater Pfad gallery-originals/, der ggf. noch nicht deployed ist)
        const [originalSrc, src] = await Promise.all([
          uploadOne(galFile, `gallery/orig_${baseId}.${extOrig}`, galFile.type),
          uploadOne(uploadFile, `gallery/${baseId}.${ext}`, uploadFile.type),
        ]);

        const created = await addDoc(collection(db, 'gallery'), {
          src,
          originalSrc,
          style: galStyle,
          ...(piece ? { piece } : {}),
          createdAt: serverTimestamp(),
          flickr: { status: 'pending', startedAt: new Date().toISOString() },
        });
        // Flickr: Original ohne Wasserzeichen (Pixsy). Website nutzt src mit Wasserzeichen.
        triggerFlickrUpload(created.id, { src, originalSrc, style: galStyle, piece });
        ok += 1;
        setGalUploadProgress(Math.round(((i + 1) / galFiles.length) * 100));
      }
      setStatus(`Galerie: ${ok} Bild(er) gespeichert.`);
      clearGalSelection();
      setGalPiece('');
      loadLists();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
      setGalUploadProgress(null);
    }
  };

  const submitWannado = async (e) => {
    e.preventDefault();
    if (!db || !storage || !user) return;
    const remoteSrc = wdEditingId ? wdRemoteSrc : null;
    const tatForViewer = wdPreview || remoteSrc;
    if (!tatForViewer) {
      setStatus('Bitte ein Motiv-Bild wählen oder Eintrag bearbeiten.');
      return;
    }
    if (!wdTitle.trim()) {
      setStatus('Titel fehlt.');
      return;
    }
    if (!wdPlacement.trim()) {
      setStatus('Körperstelle (placement) fehlt.');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      let src = remoteSrc;
      if (wdFile) {
        const ext = wdFile.name.split('.').pop() || 'jpg';
        const path = `wannados/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const sref = ref(storage, path);
        await uploadBytes(sref, wdFile, { contentType: wdFile.type || 'image/jpeg' });
        src = await getDownloadURL(sref);
        if (remoteSrc && remoteSrc !== src) {
          const oldRef = storageRefFromDownloadUrl(storage, remoteSrc);
          if (oldRef)
            try {
              await deleteObject(oldRef);
            } catch {
              /* ignore */
            }
        }
      }

      const orderNum = wdOrder === '' ? null : Number(wdOrder);
      const payload = {
        src,
        title: wdTitle.trim(),
        style: wdStyle,
        placement: wdPlacement.trim(),
        target: wdTarget,
        desc: wdDesc.trim(),
        available: wdAvailable,
        ...(orderNum !== null && !Number.isNaN(orderNum) ? { order: orderNum } : {}),
      };
      const p3d = placement3dRef.current;
      if (wdEditingId) {
        if (p3d && p3d.decals?.length > 0) payload.placement3d = p3d;
        else payload.placement3d = deleteField();
      } else if (p3d && p3d.decals?.length > 0) {
        payload.placement3d = p3d;
      }

      if (wdEditingId) {
        await updateDoc(doc(db, 'wannados', wdEditingId), payload);
        setStatus('Wanna-do: Aktualisiert.');
      } else {
        await addDoc(collection(db, 'wannados'), payload);
        setStatus('Wanna-do: gespeichert.');
      }
      resetWannadoForm();
      loadLists();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteWannado = async (row) => {
    if (!db || !storage || !user) return;
    const ok = window.confirm(`„${row.title || 'Eintrag'}" wirklich löschen?`);
    if (!ok) return;
    setBusy(true);
    setStatus('');
    try {
      const sref = storageRefFromDownloadUrl(storage, row.src);
      if (sref)
        try {
          await deleteObject(sref);
        } catch {
          /* Datei schon weg oder Pfad unbekannt */
        }
      await deleteDoc(doc(db, 'wannados', row.id));
      if (wdEditingId === row.id) resetWannadoForm();
      setStatus('Wanna-do gelöscht.');
      loadLists();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitPiercing = async (e) => {
    e.preventDefault();
    if (!db || !user) return;
    const title = piercingTitle.trim();
    const desc = piercingDesc.trim();
    const price = parsePriceInput(piercingPrice);

    if (!title) {
      setStatus('Piercing: Titel fehlt.');
      return;
    }
    if (price === null || price <= 0) {
      setStatus('Piercing: Bitte einen gültigen Preis eingeben.');
      return;
    }

    setBusy(true);
    setStatus('');
    try {
      const payload = {
        title,
        desc,
        price,
        updatedAt: serverTimestamp(),
      };

      if (piercingEditingId) {
        await updateDoc(doc(db, 'piercingPrices', piercingEditingId), payload);
        setStatus('Piercing-Preis aktualisiert.');
      } else {
        await addDoc(collection(db, 'piercingPrices'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        setStatus('Piercing-Preis gespeichert.');
      }

      resetPiercingForm();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const deletePiercing = async (row) => {
    if (!db || !user) return;
    const ok = window.confirm(`„${row.title || 'Piercing'}" wirklich löschen?`);
    if (!ok) return;
    setBusy(true);
    setStatus('');
    try {
      await deleteDoc(doc(db, 'piercingPrices', row.id));
      if (piercingEditingId === row.id) resetPiercingForm();
      setStatus('Piercing-Preis gelöscht.');
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCustomer = async (e) => {
    e.preventDefault();
    if (!db || !user || !customerEditingId) return;

    const firstName = customerFirstName.trim();
    const lastName = customerLastName.trim();
    const email = customerEmail.trim().toLowerCase();
    const phone = customerPhone.trim();

    if (!firstName || !lastName) {
      setStatus('User: Vor- und Nachname fehlen.');
      return;
    }
    if (!email) {
      setStatus('User: E-Mail-Adresse fehlt.');
      return;
    }

    setBusy(true);
    setStatus('');
    try {
      await updateDoc(doc(db, 'users', customerEditingId), {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        email,
        phone,
        updatedAt: serverTimestamp(),
      });
      setStatus('User-Profil aktualisiert.');
      resetCustomerForm();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const updateWheelSegment = (id, patch) => {
    setWheelSegments((segs) => segs.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setWheelDirty(true);
  };

  const removeWheelSegment = (id) => {
    setWheelSegments((segs) => segs.filter((s) => s.id !== id));
    setWheelDirty(true);
  };

  const addWheelSegment = () => {
    setWheelSegments((segs) => [...segs, makeBlankSegment()]);
    setWheelDirty(true);
  };

  const moveWheelSegment = (id, delta) => {
    setWheelSegments((segs) => {
      const idx = segs.findIndex((s) => s.id === id);
      if (idx === -1) return segs;
      const next = idx + delta;
      if (next < 0 || next >= segs.length) return segs;
      const copy = [...segs];
      const [item] = copy.splice(idx, 1);
      copy.splice(next, 0, item);
      return copy;
    });
    setWheelDirty(true);
  };

  const toggleWheelActive = (next) => {
    setWheelActive(next);
    setWheelDirty(true);
  };

  const saveWheelConfig = async () => {
    if (!db || !user) return;
    const cleaned = wheelSegments.map(normalizeSegmentForSave);
    if (cleaned.length === 0) {
      setStatus('Glücksrad: Bitte mindestens ein Segment hinzufügen.');
      return;
    }
    const invalid = cleaned.find((s) => {
      if (s.type === 'text') return !s.label;
      return !Number.isFinite(s.value) || s.value < 0;
    });
    if (invalid) {
      setStatus('Glücksrad: Bitte alle Segmente vollständig ausfüllen (Beschriftung bzw. Wert).');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      await setDoc(
        doc(db, 'wheelConfig', WHEEL_CONFIG_DOC),
        {
          segments: cleaned,
          active: wheelActive,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setWheelSegments(cleaned);
      setWheelDirty(false);
      setStatus('Glücksrad-Konfiguration gespeichert.');
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleUserSpinAvailable = async (row, next) => {
    if (!db || !user) return;
    setBusy(true);
    setStatus('');
    try {
      await updateDoc(doc(db, 'users', row.id), {
        wheelSpinAvailable: next,
        wheelUpdatedAt: serverTimestamp(),
      });
      setStatus(
        next
          ? `Glücksrad für ${userFullName(row)} freigeschaltet. Beim nächsten Login kann erneut gedreht werden.`
          : `Glücksrad für ${userFullName(row)} gesperrt.`,
      );
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const setSpinRedeemed = async (row, spinId, redeemed) => {
    if (!db || !user) return;
    const history = Array.isArray(row.wheelSpinHistory) ? row.wheelSpinHistory : [];
    const nextHistory = history.map((entry) =>
      entry.id === spinId
        ? {
            ...entry,
            redeemed,
            redeemedAt: redeemed ? new Date().toISOString() : null,
          }
        : entry,
    );
    setBusy(true);
    setStatus('');
    try {
      await updateDoc(doc(db, 'users', row.id), {
        wheelSpinHistory: nextHistory,
        wheelUpdatedAt: serverTimestamp(),
      });
      setStatus(redeemed ? 'Gewinn als eingelöst markiert.' : 'Gewinn auf „nicht eingelöst" zurückgesetzt.');
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) {
    return (
      <div className="page with-bg admin-wrap admin-app" style={{ minHeight: '100vh' }}>
        <PageHead kicker="Konfiguration" title="Firebase" titleEm="unvollständig" meta={<b>.env</b>} />
        <p className="admin-error">
          Alle <code>VITE_FIREBASE_*</code> Werte in Vercel/ <code>.env</code> setzen:{' '}
          <code>API_KEY</code>, <code>AUTH_DOMAIN</code>, <code>PROJECT_ID</code>, <code>STORAGE_BUCKET</code>,{' '}
          <code>MESSAGING_SENDER_ID</code>, <code>APP_ID</code> (siehe <code>.env.example</code>).
        </p>
        <p className="cormorant" style={{ color: 'var(--ivory-dim)', fontSize: 16 }}>
          Fehlt ein Wert, bricht die Firebase-App nach dem Login ab — dann erscheint die Seite leer.
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page with-bg admin-wrap admin-app admin-login-mode">
        <PageHead
          kicker="Kleopatra INK"
          title="Admin"
          titleEm="Login"
          meta={
            <>
              <b>Geschützter Bereich</b>
              <div>Nur für freigeschaltete Admins</div>
            </>
          }
        />
        <div className="admin-login-card">
          <form className="admin-login" onSubmit={onLogin}>
          <div className="field">
            <label>E-Mail</label>
            <input
              type="email"
              autoComplete="username"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Passwort</label>
            <input
              type="password"
              autoComplete="current-password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              required
            />
          </div>
          {authError && <p className="admin-error">{authError}</p>}
          <button type="submit" className="btn-primary" disabled={busy || !auth}>
            Anmelden
          </button>
        </form>
        </div>
      </div>
    );
  }

  return (
    <div className="page with-bg admin-wrap admin-app" style={{ minHeight: '100vh' }}>
      <header className="admin-top">
        <div className="admin-brand">
          <span className="admin-brand-mark">
            <img src="/app-icon.jpeg" alt="" />
          </span>
          <span>
            KLEOPATRA <span style={{ color: 'var(--ivory-dim)' }}>INK</span>
          </span>
          <span className="admin-badge">Admin</span>
        </div>
        <button type="button" className="admin-btn-ghost" onClick={onLogout}>
          Abmelden
        </button>
      </header>

      <PageHead
        kicker="Inhalte · Firebase"
        title="Studio"
        titleEm="Verwaltung"
        meta={
          <>
            <b>eingeloggt</b>
            <div>{user.email}</div>
          </>
        }
      />

      {status && (
        <p className={`admin-status ${status.includes('fehl') || status.includes('Bitte') ? 'admin-status-warn' : ''}`}>
          {status}
        </p>
      )}

      {listError && (
        <p className="admin-status admin-status-warn" role="alert">
          {listError}
        </p>
      )}

      <div className="admin-tabs" role="tablist">
        <button
          type="button"
          className={`gal-chip ${tab === 'gallery' ? 'active' : ''}`}
          onClick={() => setTab('gallery')}
        >
          Galerie
        </button>
        <button
          type="button"
          className={`gal-chip ${tab === 'wannados' ? 'active' : ''}`}
          onClick={() => setTab('wannados')}
        >
          Wanna-dos
        </button>
        <button
          type="button"
          className={`gal-chip ${tab === 'piercings' ? 'active' : ''}`}
          onClick={() => setTab('piercings')}
        >
          Piercings
        </button>
        <button
          type="button"
          className={`gal-chip ${tab === 'users' ? 'active' : ''}`}
          onClick={() => setTab('users')}
        >
          User
        </button>
        <button
          type="button"
          className={`gal-chip ${tab === 'wheel' ? 'active' : ''}`}
          onClick={() => setTab('wheel')}
        >
          Glücksrad
        </button>
        <button
          type="button"
          className={`gal-chip ${tab === 'stencil' ? 'active' : ''}`}
          onClick={() => setTab('stencil')}
        >
          Stencil-Tool
        </button>
      </div>

      {tab === 'gallery' && (
        <section className="admin-section">
          <div className="admin-card">
            <h3 className="admin-h3">Neue Galerie-Bilder</h3>
          <p className="admin-lead cormorant">
            Wähle ein oder mehrere fertige Tattoo-Fotos aus, ordne sie einem Stil zu und speichere sie.
            Ein Anzeigename ist optional und kann leer bleiben.
          </p>
          <p className="admin-help">
            Beim Speichern wird das Studio-Logo automatisch als Wasserzeichen eingebrannt (Anzeige auf der Website).
            Das Original ohne Wasserzeichen geht parallel an Flickr für den Urheberschutz (Pixsy).
          </p>
          <form className="admin-form" onSubmit={submitGallery}>
            <div className="field">
              <label>Bilddateien (Mehrfachauswahl)</label>
              <input type="file" accept="image/*" multiple onChange={onGalFiles} />
            </div>
            {galPreviewUrls.length > 0 && (
              <div className="admin-preview-grid">
                {galPreviewUrls.map((url, idx) => (
                  <div key={url} className="admin-preview-cell">
                    <img src={url} alt="" />
                    <span className="admin-preview-name">{galFiles[idx]?.name}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="field">
              <label>Tattoo-Stil</label>
              <select value={galStyle} onChange={(e) => setGalStyle(e.target.value)}>
                {TATTOO_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>
                Anzeigename <span style={{ opacity: 0.5 }}>optional</span>
              </label>
              <input
                type="text"
                value={galPiece}
                onChange={(e) => setGalPiece(e.target.value)}
                placeholder="Leer lassen: Name aus Dateiname je Bild"
              />
            </div>
            {galUploadProgress !== null && (
              <div className="admin-progress-wrap" aria-live="polite">
                <div className="admin-progress-track">
                  <div className="admin-progress-fill" style={{ width: `${galUploadProgress}%` }} />
                </div>
                <div className="admin-progress-label">{galUploadProgress}%</div>
              </div>
            )}
            <button type="submit" className="btn-primary" disabled={busy || galFiles.length === 0}>
              {galFiles.length > 1 ? `${galFiles.length} Bilder hochladen` : 'Hochladen & speichern'}
            </button>
          </form>
          </div>

          <div className="admin-card admin-card-list">
            <h3 className="admin-h3">Zuletzt gespeicherte Galerie-Bilder</h3>
            <p className="admin-help">
              Website zeigt die Version mit Wasserzeichen. Flickr erhält das Original (Pixsy-Sync).
              Bei Fehlern erscheint ein Button für manuellen Re-Upload.
            </p>
            <ul className="admin-doc-list">
              {galleryRows.map((row) => {
                const f = row.flickr || null;
                const status = f?.status || 'none';
                const statusLabel =
                  status === 'success' ? 'Flickr synchronisiert'
                    : status === 'pending' ? 'Flickr läuft …'
                    : status === 'failed' ? 'Flickr fehlgeschlagen'
                    : 'Flickr nicht synchronisiert';
                const showRetry = status === 'failed' || status === 'none';
                return (
                  <li key={row.id} className="admin-doc-item admin-doc-item-row">
                    <div className="admin-doc-main admin-doc-main-static">
                      <img src={row.src} alt="" className="admin-doc-thumb" />
                      <div className="admin-doc-main-text">
                        <div className="admin-doc-title">{row.style}</div>
                        <div className="admin-doc-meta">{row.piece || '—'}</div>
                        <div className="admin-flickr-meta">
                          <span className={`admin-flickr-pill admin-flickr-pill-${status}`}>
                            {statusLabel}
                          </span>
                          {f?.photoUrl && (
                            <a
                              href={f.photoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="admin-flickr-link"
                            >
                              Auf Flickr ansehen ↗
                            </a>
                          )}
                          {status === 'failed' && f?.error && (
                            <span className="admin-flickr-error" title={f.error}>
                              {f.error.length > 80 ? `${f.error.slice(0, 80)}…` : f.error}
                            </span>
                          )}
                        </div>
                        <code className="admin-doc-id">{row.id}</code>
                      </div>
                    </div>
                    {showRetry && (
                      <div className="admin-doc-actions">
                        <button
                          type="button"
                          className="gal-chip"
                          onClick={() => retryFlickrUpload(row)}
                          disabled={busy}
                        >
                          {status === 'none' ? 'Zu Flickr hochladen' : 'Erneut versuchen'}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
              {galleryRows.length === 0 && <li className="admin-empty">Noch keine Einträge geladen.</li>}
            </ul>
          </div>
        </section>
      )}

      {tab === 'wannados' && (
        <section className="admin-section">
          <div className="admin-card">
            <h3 className="admin-h3">{wdEditingId ? 'Wanna-do bearbeiten' : 'Neues Wanna-do'}</h3>
          <p className="admin-lead cormorant">
            Lade ein Motiv hoch, gib Titel, Stil und Körperstelle an und lege fest, ob es für Frauen,
            Männer oder alle angezeigt werden soll. Optional kannst du eine kurze Beschreibung,
            Sortierung und eine 3D-Platzierung ergänzen.
          </p>
          <form className="admin-form" onSubmit={submitWannado}>
            <div className="field">
              <label>Motiv-Bild {wdEditingId && '(optional — leer lassen behält aktuelles Bild)'}</label>
              <input type="file" accept="image/*" onChange={onWdFile} />
            </div>
            {(wdPreview || wdRemoteSrc) && (
              <div className="admin-preview">
                <img src={wdPreview || wdRemoteSrc} alt="Vorschau Motiv" />
              </div>
            )}
            <div className="field">
              <label>Titel</label>
              <input type="text" value={wdTitle} onChange={(e) => setWdTitle(e.target.value)} required placeholder="Name des Motivs" />
            </div>
            <div className="field">
              <label>Stil</label>
              <select value={wdStyle} onChange={(e) => setWdStyle(e.target.value)}>
                {TATTOO_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Körperstelle (placement)</label>
              <input
                type="text"
                value={wdPlacement}
                onChange={(e) => setWdPlacement(e.target.value)}
                list="placement-list"
                placeholder="z. B. Unterarm"
                required
              />
              <datalist id="placement-list">
                {PLACEMENT_HINTS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>Für wen soll es angezeigt werden?</label>
              <select value={wdTarget} onChange={(e) => setWdTarget(e.target.value)}>
                {WANNADO_TARGETS.map((t) => (
                  <option key={t} value={t}>
                    {t === 'Alle' ? 'Alle / beides' : t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Beschreibung optional</label>
              <textarea rows={3} value={wdDesc} onChange={(e) => setWdDesc(e.target.value)} placeholder="Kurzbeschreibung" />
            </div>
            <div className="admin-row">
              <label className="admin-check">
                <input type="checkbox" checked={wdAvailable} onChange={(e) => setWdAvailable(e.target.checked)} />
                <span>verfügbar</span>
              </label>
              <div className="field admin-field-inline">
                <label>Reihenfolge optional</label>
                <input type="number" value={wdOrder} onChange={(e) => setWdOrder(e.target.value)} placeholder="z. B. 10" />
              </div>
            </div>

            <div className="wd-3d-section" style={{ marginTop: 32 }}>
              <div className="wd-3d-header">
                <h3 className="wd-3d-title">3D-Vorschau & Platzierung</h3>
                <p className="wd-3d-sub">
                  Optional: Klicke auf den Körper, um das Motiv als Vorschau an der passenden Stelle zu platzieren.
                </p>
              </div>
              <Suspense fallback={<div className="body3d-loading">3D wird geladen …</div>}>
                <Body3DViewer
                  key={`${wdEditingId || 'new'}-${wdRemoteSrc || ''}-${wdPreview || ''}`}
                  variant="admin"
                  tatSrc={wdPreview || wdRemoteSrc || null}
                  initialPlacement3d={wdPlacementInitial}
                  onPlacementChange={(serialized) => {
                    placement3dRef.current = serialized;
                  }}
                />
              </Suspense>
            </div>

            <div className="admin-form-actions">
              <button type="submit" className="btn-primary" disabled={busy}>
                {wdEditingId ? 'Änderungen speichern' : 'Motiv hochladen & speichern'}
              </button>
              {wdEditingId && (
                <button type="button" className="admin-btn-ghost" onClick={() => resetWannadoForm()}>
                  Abbrechen
                </button>
              )}
            </div>
          </form>
          </div>

          <div className="admin-card admin-card-list">
            <h3 className="admin-h3">Gespeicherte Wanna-dos</h3>
            <ul className="admin-doc-list">
              {wannadoRows.map((row) => (
              <li key={row.id} className="admin-doc-item admin-doc-item-row">
                <button type="button" className="admin-doc-main" onClick={() => loadWannadoForEdit(row)}>
                  <img src={row.src} alt="" className="admin-doc-thumb" />
                  <div className="admin-doc-main-text">
                    <div className="admin-doc-title">{row.title}</div>
                    <div className="admin-doc-meta">
                      {row.style} · {row.placement} · {row.target}
                    </div>
                    <code className="admin-doc-id">{row.id}</code>
                  </div>
                </button>
                <div className="admin-doc-actions">
                  <button type="button" className="gal-chip" onClick={() => loadWannadoForEdit(row)}>
                    Bearbeiten
                  </button>
                  <button type="button" className="gal-chip admin-doc-delete" onClick={() => deleteWannado(row)}>
                    Löschen
                  </button>
                </div>
              </li>
            ))}
            {wannadoRows.length === 0 && <li className="admin-empty">Noch keine Einträge geladen.</li>}
            </ul>
          </div>
        </section>
      )}

      {tab === 'piercings' && (
        <section className="admin-section">
          <div className="admin-card">
            <h3 className="admin-h3">{piercingEditingId ? 'Piercing-Preis bearbeiten' : 'Neuer Piercing-Preis'}</h3>
            <p className="admin-lead cormorant">
              Trage hier ein Piercing mit Preis ein. Die Beschreibung ist freiwillig und kann zum Beispiel
              Hinweise wie „inklusive Erstschmuck“ enthalten.
            </p>
            <form className="admin-form" onSubmit={submitPiercing}>
              <div className="field">
                <label>Titel</label>
                <input
                  type="text"
                  value={piercingTitle}
                  onChange={(e) => setPiercingTitle(e.target.value)}
                  placeholder="z. B. Helix"
                  required
                />
              </div>
              <div className="field">
                <label>Beschreibung optional</label>
                <textarea
                  rows={3}
                  value={piercingDesc}
                  onChange={(e) => setPiercingDesc(e.target.value)}
                  placeholder="z. B. inkl. Erstschmuck"
                />
              </div>
              <div className="field admin-field-price">
                <label>Preis in Euro</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={piercingPrice}
                  onChange={(e) => setPiercingPrice(e.target.value)}
                  placeholder="z. B. 45 oder 45,00"
                  required
                />
              </div>
              <div className="admin-form-actions">
                <button type="submit" className="btn-primary" disabled={busy}>
                  {piercingEditingId ? 'Preis aktualisieren' : 'Preis speichern'}
                </button>
                {piercingEditingId && (
                  <button type="button" className="admin-btn-ghost" onClick={resetPiercingForm}>
                    Abbrechen
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="admin-card admin-card-list">
            <h3 className="admin-h3">Gespeicherte Piercing-Preise</h3>
            <ul className="admin-doc-list">
              {piercingRows.map((row) => (
                <li key={row.id} className="admin-doc-item admin-doc-item-row">
                  <button type="button" className="admin-doc-main admin-doc-main-no-thumb" onClick={() => loadPiercingForEdit(row)}>
                    <div className="admin-doc-main-text">
                      <div className="admin-doc-title">{row.title}</div>
                      <div className="admin-doc-meta">
                        <span className="admin-price-highlight">{formatPrice(row.price)}</span>
                        {row.desc ? ` · ${row.desc}` : ''}
                      </div>
                      <code className="admin-doc-id">{row.id}</code>
                    </div>
                  </button>
                  <div className="admin-doc-actions">
                    <button type="button" className="gal-chip" onClick={() => loadPiercingForEdit(row)}>
                      Bearbeiten
                    </button>
                    <button type="button" className="gal-chip admin-doc-delete" onClick={() => deletePiercing(row)}>
                      Löschen
                    </button>
                  </div>
                </li>
              ))}
              {piercingRows.length === 0 && <li className="admin-empty">Noch keine Preise geladen.</li>}
            </ul>
          </div>
        </section>
      )}

      {tab === 'users' && (
        <section className="admin-section">
          {customerEditingId && (
            <div className="admin-card">
              <h3 className="admin-h3">User bearbeiten</h3>
              <p className="admin-lead cormorant">
                Ändere hier die gespeicherten Kontaktdaten des Kunden. Das Passwort bleibt dabei unverändert.
              </p>
              <form className="admin-form" onSubmit={submitCustomer}>
                <div className="admin-row">
                  <div className="field admin-field-inline">
                    <label>Vorname</label>
                    <input
                      type="text"
                      value={customerFirstName}
                      onChange={(e) => setCustomerFirstName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field admin-field-inline">
                    <label>Nachname</label>
                    <input
                      type="text"
                      value={customerLastName}
                      onChange={(e) => setCustomerLastName(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="admin-row">
                  <div className="field admin-field-inline">
                    <label>E-Mail</label>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field admin-field-inline">
                    <label>Telefon</label>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                    />
                  </div>
                </div>
                <div className="admin-form-actions">
                  <button type="submit" className="btn-primary" disabled={busy}>
                    User speichern
                  </button>
                  <button type="button" className="admin-btn-ghost" onClick={resetCustomerForm}>
                    Abbrechen
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="admin-card admin-card-list">
            <h3 className="admin-h3">Registrierte Kunden</h3>
            <p className="admin-help">
              Hier siehst du alle Kunden, die sich auf der Website registriert haben.
              Klicke auf einen Eintrag, um Name, E-Mail-Adresse oder Telefonnummer zu bearbeiten.
              Über „Glücksrad anzeigen" siehst du den Spin-Status und kannst den nächsten Dreh freigeben.
            </p>
            {(() => {
              const q = userSearch.trim().toLowerCase();
              const filteredCustomers = q
                ? customerRows.filter((row) => {
                    const haystack = [
                      row.firstName,
                      row.firstname,
                      row.lastName,
                      row.lastname,
                      row.fullName,
                      row.name,
                      row.email,
                      userPhone(row),
                    ]
                      .filter(Boolean)
                      .join(' ')
                      .toLowerCase();
                    return haystack.includes(q);
                  })
                : customerRows;
              return (
                <>
                  <div className="admin-user-search">
                    <input
                      type="search"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Suche: Name, E-Mail oder Telefon …"
                      aria-label="User durchsuchen"
                    />
                    {userSearch && (
                      <button
                        type="button"
                        className="admin-user-search-clear"
                        onClick={() => setUserSearch('')}
                        aria-label="Suche zurücksetzen"
                      >
                        ×
                      </button>
                    )}
                    {q && (
                      <span className="admin-user-search-count">
                        {filteredCustomers.length} von {customerRows.length}
                      </span>
                    )}
                  </div>
                  <ul className="admin-doc-list">
                    {filteredCustomers.map((row) => {
                const history = Array.isArray(row.wheelSpinHistory) ? row.wheelSpinHistory : [];
                const latestSpin = history.length > 0 ? history[history.length - 1] : null;
                const canSpin = row.wheelSpinAvailable !== false;
                const pillLabel = canSpin
                  ? history.length === 0
                    ? 'Bereit für ersten Dreh'
                    : 'Erneuter Dreh freigegeben'
                  : 'Bereits gedreht';
                const expanded = expandedUserId === row.id;
                return (
                  <li key={row.id} className="admin-doc-item admin-user-card">
                    <div className="admin-doc-item-row admin-user-row">
                      <button type="button" className="admin-doc-main admin-doc-main-no-thumb" onClick={() => loadCustomerForEdit(row)}>
                        <div className="admin-doc-main-text">
                          <div className="admin-doc-title">{userFullName(row)}</div>
                          <div className="admin-doc-meta admin-user-meta">
                            <span>{row.email || 'Keine E-Mail'}</span>
                            <span>{userPhone(row) || 'Keine Telefonnummer'}</span>
                          </div>
                          <div className="admin-user-wheel-meta">
                            <span className={`admin-wheel-pill ${canSpin ? 'is-on' : 'is-off'}`}>
                              {pillLabel}
                            </span>
                            {latestSpin && (
                              <span className="admin-wheel-pill admin-wheel-pill-result">
                                Letzter Gewinn: {formatSegment(latestSpin)}
                                {latestSpin.redeemed ? ' · eingelöst' : ' · offen'}
                              </span>
                            )}
                            <span className="admin-wheel-pill admin-wheel-pill-muted">
                              {history.length} Dreh{history.length === 1 ? '' : 's'}
                            </span>
                          </div>
                          <code className="admin-doc-id">{row.id}</code>
                        </div>
                      </button>
                      <div className="admin-doc-actions">
                        <button type="button" className="gal-chip" onClick={() => loadCustomerForEdit(row)}>
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          className="gal-chip"
                          onClick={() => setExpandedUserId(expanded ? null : row.id)}
                        >
                          {expanded ? 'Glücksrad ausblenden' : 'Glücksrad anzeigen'}
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="admin-user-wheel-panel">
                        <div className="admin-user-wheel-controls">
                          <label className="admin-check">
                            <input
                              type="checkbox"
                              checked={canSpin}
                              onChange={(e) => toggleUserSpinAvailable(row, e.target.checked)}
                              disabled={busy}
                            />
                            <span>Beim nächsten Login darf dieser User (erneut) drehen</span>
                          </label>
                          <p className="admin-user-wheel-hint">
                            Haken aktiv = Nutzer sieht das Glücksrad und kann einmal drehen. Nach dem Dreh wird der Haken automatisch entfernt.
                          </p>
                        </div>

                        <div className="admin-user-wheel-history">
                          <h4 className="admin-user-wheel-h4">Historie</h4>
                          {history.length === 0 ? (
                            <p className="admin-user-wheel-empty">Dieser User hat noch nicht gedreht.</p>
                          ) : (
                            <ul className="admin-user-wheel-list">
                              {history
                                .slice()
                                .reverse()
                                .map((entry) => (
                                  <li key={entry.id || entry.spunAt} className="admin-user-wheel-entry">
                                    <div className="admin-user-wheel-entry-main">
                                      <div className="admin-user-wheel-entry-prize">
                                        {formatSegment(entry)}
                                      </div>
                                      <div className="admin-user-wheel-entry-meta">
                                        <span>{formatDateTime(entry.spunAt)}</span>
                                        {entry.label && entry.type !== 'text' && (
                                          <span>· {entry.label}</span>
                                        )}
                                        <span className={`admin-wheel-pill ${entry.redeemed ? 'is-on' : 'is-warn'}`}>
                                          {entry.redeemed ? 'Eingelöst' : 'Offen'}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="admin-user-wheel-entry-actions">
                                      <button
                                        type="button"
                                        className="gal-chip"
                                        onClick={() => setSpinRedeemed(row, entry.id, !entry.redeemed)}
                                        disabled={busy}
                                      >
                                        {entry.redeemed ? 'Als offen markieren' : 'Als eingelöst markieren'}
                                      </button>
                                    </div>
                                  </li>
                                ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                    </li>
                  );
                })}
                    {customerRows.length === 0 && <li className="admin-empty">Noch keine User geladen.</li>}
                    {customerRows.length > 0 && filteredCustomers.length === 0 && (
                      <li className="admin-empty">Keine User passen zur Suche.</li>
                    )}
                  </ul>
                </>
              );
            })()}
          </div>
        </section>
      )}

      {tab === 'wheel' && (
        <section className="admin-section">
          <div className="admin-card">
            <h3 className="admin-h3">Glücksrad konfigurieren</h3>
            <p className="admin-lead cormorant">
              Lege fest, welche Felder auf dem Glücksrad zu sehen sind. Jedes Segment kann ein
              Geldbetrag, ein Prozent-Rabatt oder ein freier Text sein. Reihenfolge und Farben lassen sich
              individuell anpassen. Speichere die Konfiguration, bevor du das Rad live schaltest.
            </p>

            <label className="admin-check" style={{ marginBottom: 20 }}>
              <input
                type="checkbox"
                checked={wheelActive}
                onChange={(e) => toggleWheelActive(e.target.checked)}
              />
              <span>Glücksrad ist auf der Website aktiv</span>
            </label>

            <div className="admin-wheel-grid">
              <div className="admin-wheel-segments">
                {wheelSegments.length === 0 && (
                  <p className="admin-user-wheel-empty">
                    Noch keine Segmente. Füge unten das erste Feld hinzu.
                  </p>
                )}
                {wheelSegments.map((seg, idx) => (
                  <div key={seg.id} className="admin-wheel-segment">
                    <div className="admin-wheel-segment-head">
                      <span
                        className="admin-wheel-color-dot"
                        style={{ background: segmentColor(seg, idx) }}
                      />
                      <span className="admin-wheel-segment-idx">Feld {idx + 1}</span>
                      <div className="admin-wheel-segment-head-actions">
                        <button type="button" className="gal-chip" onClick={() => moveWheelSegment(seg.id, -1)} disabled={idx === 0}>
                          ↑
                        </button>
                        <button
                          type="button"
                          className="gal-chip"
                          onClick={() => moveWheelSegment(seg.id, 1)}
                          disabled={idx === wheelSegments.length - 1}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="gal-chip admin-doc-delete"
                          onClick={() => removeWheelSegment(seg.id)}
                        >
                          Entfernen
                        </button>
                      </div>
                    </div>
                    <div className="admin-row admin-wheel-segment-row">
                      <div className="field admin-field-inline">
                        <label>Typ</label>
                        <select
                          value={seg.type || 'amount'}
                          onChange={(e) => updateWheelSegment(seg.id, { type: e.target.value })}
                        >
                          {WHEEL_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {(seg.type === 'amount' || seg.type === 'percent') && (
                        <div className="field admin-field-inline">
                          <label>Wert {seg.type === 'amount' ? '(€)' : '(%)'}</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={seg.value ?? ''}
                            onChange={(e) => updateWheelSegment(seg.id, { value: e.target.value })}
                            placeholder={seg.type === 'amount' ? 'z. B. 50' : 'z. B. 10'}
                          />
                        </div>
                      )}
                      <div className="field admin-field-inline">
                        <label>Beschriftung {seg.type === 'text' ? '' : '(optional)'}</label>
                        <input
                          type="text"
                          value={seg.label || ''}
                          onChange={(e) => updateWheelSegment(seg.id, { label: e.target.value })}
                          placeholder={
                            seg.type === 'text' ? 'z. B. Gratis Beratung' : 'z. B. 50€ Gutschein'
                          }
                        />
                      </div>
                      <div className="field admin-field-inline admin-wheel-color-field">
                        <label>Farbe</label>
                        <input
                          type="color"
                          value={seg.color || segmentColor(seg, idx)}
                          onChange={(e) => updateWheelSegment(seg.id, { color: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="admin-form-actions">
                  <button type="button" className="admin-btn-ghost" onClick={addWheelSegment}>
                    + Segment hinzufügen
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={saveWheelConfig}
                    disabled={busy || !wheelDirty}
                  >
                    {wheelDirty ? 'Konfiguration speichern' : 'Gespeichert'}
                  </button>
                </div>
              </div>

              <div className="admin-wheel-preview">
                <h4 className="admin-user-wheel-h4">Vorschau</h4>
                <p className="admin-wheel-preview-hint">
                  So sehen deine User das Rad. Drücke „Drehen" um einen Beispieldreh zu testen.
                </p>
                {wheelLoaded && (
                  <LuckyWheel
                    segments={wheelSegments.map(normalizeSegmentForSave)}
                    buttonLabel="Test-Dreh"
                    size={320}
                  />
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === 'stencil' && <StencilTool auth={auth} />}
    </div>
  );
}
