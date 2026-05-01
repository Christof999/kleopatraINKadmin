import {
  addDoc,
  collection,
  getDocs,
  limit,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState, Suspense, lazy } from 'react';
import { TATTOO_STYLES, WANNADO_TARGETS } from '../constants/styles';
import { getDb, getBucket, getFirebaseAuth, getFirebaseConfig } from './firebase';
import '../styles.css';
import './admin.css';

const Body3DViewer = lazy(() => import('../components/Body3DViewer'));

const CAMERA_PATTERN = /^(img|dsc|dscn|p\d|mgim|mvim)[-_]?\d/i;

function pieceFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  if (CAMERA_PATTERN.test(base)) return '';
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
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
  const placement3dRef = useRef(null);

  const [galleryRows, setGalleryRows] = useState([]);
  const [wannadoRows, setWannadoRows] = useState([]);

  useEffect(() => {
    if (!auth) return undefined;
    return onAuthStateChanged(auth, setUser);
  }, [auth]);

  const loadLists = useCallback(async () => {
    if (!db || !user) return;
    try {
      const gSnap = await getDocs(query(collection(db, 'gallery'), limit(50)));
      setGalleryRows(gSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      const wSnap = await getDocs(query(collection(db, 'wannados'), limit(80)));
      setWannadoRows(wSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      setStatus(`Liste: ${e.message || String(e)}`);
    }
  }, [db, user]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const onLogin = async (e) => {
    e.preventDefault();
    if (!auth) return;
    setAuthError('');
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
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
    placement3dRef.current = null;
  };

  const onWdFile = (e) => {
    const f = e.target.files?.[0];
    clearWdFile();
    if (!f) return;
    setWdFile(f);
    setWdPreview(URL.createObjectURL(f));
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
    const totalBytes = galFiles.reduce((s, f) => s + f.size, 0) || 1;
    let doneBytes = 0;
    let ok = 0;
    try {
      for (let i = 0; i < galFiles.length; i += 1) {
        const galFile = galFiles[i];
        const ext = galFile.name.split('.').pop() || 'jpg';
        const path = `gallery/${Date.now()}_${i}_${Math.random().toString(36).slice(2)}.${ext}`;
        const sref = ref(storage, path);
        const pieceRaw = galPiece.trim();
        const piece = pieceRaw || pieceFromFilename(galFile.name);

        const task = uploadBytesResumable(sref, galFile, { contentType: galFile.type || 'image/jpeg' });
        const src = await new Promise((resolve, reject) => {
          task.on(
            'state_changed',
            (snap) => {
              const current = doneBytes + snap.bytesTransferred;
              setGalUploadProgress(Math.min(100, Math.round((current / totalBytes) * 100)));
            },
            reject,
            async () => {
              resolve(await getDownloadURL(task.snapshot.ref));
            },
          );
        });
        await addDoc(collection(db, 'gallery'), {
          src,
          style: galStyle,
          ...(piece ? { piece } : {}),
          createdAt: serverTimestamp(),
        });
        ok += 1;
        doneBytes += galFile.size;
        setGalUploadProgress(Math.round((doneBytes / totalBytes) * 100));
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
    if (!wdFile) {
      setStatus('Bitte ein Motiv-Bild wählen.');
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
      const ext = wdFile.name.split('.').pop() || 'jpg';
      const path = `wannados/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const sref = ref(storage, path);
      await uploadBytes(sref, wdFile, { contentType: wdFile.type || 'image/jpeg' });
      const src = await getDownloadURL(sref);

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
      if (p3d && p3d.decals?.length > 0) {
        payload.placement3d = p3d;
      }
      await addDoc(collection(db, 'wannados'), payload);
      setStatus('Wanna-do: gespeichert.');
      clearWdFile();
      setWdTitle('');
      setWdPlacement('');
      setWdDesc('');
      setWdOrder('');
      setWdAvailable(true);
      placement3dRef.current = null;
      loadLists();
    } catch (err) {
      setStatus(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) {
    return (
      <div className="page with-bg admin-wrap">
        <PageHead kicker="Konfiguration" title="Firebase" titleEm="fehlt" meta={<b>.env</b>} />
        <p className="admin-error">
          Lege eine <code>.env</code> mit <code>VITE_FIREBASE_*</code> an (siehe <code>.env.example</code>).
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page with-bg admin-wrap">
        <PageHead
          kicker="Kleopatra INK"
          title="Admin"
          titleEm="Login"
          meta={
            <>
              <b>Firestore</b>
              <div>gallery · wannados</div>
            </>
          }
        />
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
    );
  }

  return (
    <div className="page with-bg admin-wrap">
      <header className="admin-top">
        <div className="admin-brand">
          <span className="admin-brand-mark">K</span>
          <span>
            KLEOPATRA <span style={{ color: 'var(--ivory-dim)' }}>INK</span>
          </span>
          <span className="admin-badge">Admin</span>
        </div>
        <button type="button" className="page-back" onClick={onLogout}>
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
      </div>

      {tab === 'gallery' && (
        <section className="admin-section">
          <h3 className="admin-h3">Neue Galerie-Bilder</h3>
          <p className="admin-lead cormorant">
            Schema: <code>src</code>, <code>style</code>, optional <code>piece</code>, optional <code>createdAt</code> (Server).
            Mehrere Dateien wählen — Upload-Fortschritt siehst du unten.
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
              <label>Stil (style)</label>
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
                Anzeigename (piece) <span style={{ opacity: 0.5 }}>optional</span>
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

          <h3 className="admin-h3" style={{ marginTop: 48 }}>
            Zuletzt in Firestore (gallery)
          </h3>
          <ul className="admin-doc-list">
            {galleryRows.map((row) => (
              <li key={row.id} className="admin-doc-item">
                <img src={row.src} alt="" className="admin-doc-thumb" />
                <div>
                  <div className="admin-doc-title">{row.style}</div>
                  <div className="admin-doc-meta">{row.piece || '—'}</div>
                  <code className="admin-doc-id">{row.id}</code>
                </div>
              </li>
            ))}
            {galleryRows.length === 0 && <li className="admin-empty">Noch keine Einträge geladen.</li>}
          </ul>
        </section>
      )}

      {tab === 'wannados' && (
        <section className="admin-section">
          <h3 className="admin-h3">Neues Wanna-do</h3>
          <p className="admin-lead cormorant">
            Pflichtfelder wie auf der Hauptseite: <code>src</code>, <code>title</code>, <code>style</code>,{' '}
            <code>placement</code>, <code>target</code>. Optional: <code>desc</code>, <code>available</code>,{' '}
            <code>order</code>. Zusätzlich: <code>placement3d</code>, wenn du im Viewer klickst.
          </p>
          <form className="admin-form" onSubmit={submitWannado}>
            <div className="field">
              <label>Motiv-Bild</label>
              <input type="file" accept="image/*" onChange={onWdFile} />
            </div>
            {wdPreview && (
              <div className="admin-preview">
                <img src={wdPreview} alt="Vorschau Motiv" />
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
              <label>Zielgruppe (target)</label>
              <select value={wdTarget} onChange={(e) => setWdTarget(e.target.value)}>
                {WANNADO_TARGETS.map((t) => (
                  <option key={t} value={t}>
                    {t === 'Alle' ? 'Alle / beides' : t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Beschreibung (desc) · optional</label>
              <textarea rows={3} value={wdDesc} onChange={(e) => setWdDesc(e.target.value)} placeholder="Kurzbeschreibung" />
            </div>
            <div className="admin-row">
              <label className="admin-check">
                <input type="checkbox" checked={wdAvailable} onChange={(e) => setWdAvailable(e.target.checked)} />
                <span>verfügbar (available)</span>
              </label>
              <div className="field admin-field-inline">
                <label>Sortierung (order) · optional</label>
                <input type="number" value={wdOrder} onChange={(e) => setWdOrder(e.target.value)} placeholder="z. B. 10" />
              </div>
            </div>

            <div className="wd-3d-section" style={{ marginTop: 32 }}>
              <div className="wd-3d-header">
                <h3 className="wd-3d-title">3D-Vorschau & Platzierung</h3>
                <p className="wd-3d-sub">
                  Nach Bildwahl: Motiv auf dem Körper platzieren — wird als <code>placement3d</code> mitgespeichert (optional).
                </p>
              </div>
              <Suspense fallback={<div className="body3d-loading">3D wird geladen …</div>}>
                <Body3DViewer
                  variant="admin"
                  tatSrc={wdPreview || null}
                  initialPlacement3d={null}
                  onPlacementChange={(serialized) => {
                    placement3dRef.current = serialized;
                  }}
                />
              </Suspense>
            </div>

            <button type="submit" className="btn-primary" style={{ marginTop: 24 }} disabled={busy}>
              Motiv hochladen & speichern
            </button>
          </form>

          <h3 className="admin-h3" style={{ marginTop: 48 }}>
            Einträge in Firestore (wannados)
          </h3>
          <ul className="admin-doc-list">
            {wannadoRows.map((row) => (
              <li key={row.id} className="admin-doc-item">
                <img src={row.src} alt="" className="admin-doc-thumb" />
                <div>
                  <div className="admin-doc-title">{row.title}</div>
                  <div className="admin-doc-meta">
                    {row.style} · {row.placement} · {row.target}
                  </div>
                  <code className="admin-doc-id">{row.id}</code>
                </div>
              </li>
            ))}
            {wannadoRows.length === 0 && <li className="admin-empty">Noch keine Einträge geladen.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
