import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import KleopatraHead from './components/KleopatraHead';
import Background from './components/Background';
import InstagramFeed from './components/InstagramFeed';

const KleopatraHead3D = lazy(() => import('./components/KleopatraHead3D'));
const Body3DViewer    = lazy(() => import('./components/Body3DViewer'));
import { useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakRadio } from './components/TweaksPanel';
import { GAL_ITEMS, GAL_FILTERS } from './gallery-items';
import { getFirebaseConfig } from './firebase/client';
import { fetchPiercingPricesFromFirestore } from './piercingPricesFirebase';
import { fetchWannadosFromFirestore } from './wannadosFirebase';
import { WANNADO_ITEMS } from './wannado-items';
import './styles.css';

const EUR_FORMATTER = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
});

function formatPrice(value) {
  const price = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(price) ? EUR_FORMATTER.format(price) : 'Preis auf Anfrage';
}

const NAV = [
  { id: 'gallery',      label: 'Galerie',        sub: 'Werke',       angle: -90 },
  { id: 'about',        label: 'Das sind wir',   sub: 'Studio',      angle: -38 },
  { id: 'booking',      label: 'Termin buchen',  sub: 'Appointment', angle:  14 },
  { id: 'piercings',    label: 'Piercings',      sub: 'Preise',      angle:  66 },
  { id: 'testimonials', label: 'Unsere Kunden',  sub: 'Stimmen',     angle: 118 },
  { id: 'socials',      label: 'Instagram',      sub: 'Follow',      angle: 170 },
  { id: 'wannados',     label: 'Wanna-dos',      sub: 'Flash',       angle: 222 },
];

// ── Landing ───────────────────────────────────────────────────────────────────

// Prüfen ob ein .glb vorhanden ist (Feature-Flag)
const HAS_3D_MODEL = false; // → auf true setzen sobald kleopatra-3d.glb hochgeladen ist

function Landing({ onNav, tweaks }) {
  const dialRef = useRef(null);
  const [dialSize, setDialSize] = useState(600);
  const [hoveredNav, setHoveredNav] = useState(null);

  useEffect(() => {
    const measure = () => {
      if (dialRef.current) {
        const w = dialRef.current.offsetWidth;
        setDialSize((prev) => (Math.abs(prev - w) > 1 ? w : prev));
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div className="stage">
      <Background mode={tweaks.bgMode} goldIntensity={tweaks.gold} />

      <div className="chrome">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>KLEOPATRA <span style={{ color: 'var(--ivory-dim)' }}>INK</span></div>
        </div>
        <div className="chrome-meta">
          <span>EST 2018</span>
          <span>GUNZENHAUSEN</span>
          <span>DI — SA</span>
        </div>
      </div>

      <div className="composition">
        <div className="dial" ref={dialRef}>
          <div className="dial-ring outer" />
          <div className="dial-ring" />
          <div className="dial-ring inner" />

          <svg className="dial-ticks" viewBox="0 0 100 100" preserveAspectRatio="none">
            {Array.from({ length: 60 }).map((_, i) => {
              const a = (i / 60) * Math.PI * 2;
              const major = i % 5 === 0;
              const r1 = major ? 47 : 48.5;
              const r2 = 50;
              return (
                <line key={i}
                  x1={50 + Math.cos(a) * r1} y1={50 + Math.sin(a) * r1}
                  x2={50 + Math.cos(a) * r2} y2={50 + Math.sin(a) * r2}
                  stroke={major ? 'rgba(212,165,55,0.5)' : 'rgba(212,165,55,0.18)'}
                  strokeWidth={major ? 0.3 : 0.15}
                />
              );
            })}
          </svg>

          {!HAS_3D_MODEL && <div className="head-halo" />}
          <div className="head-slot" style={HAS_3D_MODEL ? { inset: '-8%', overflow: 'visible' } : {}}>
            {HAS_3D_MODEL
              ? <Suspense fallback={<KleopatraHead style={tweaks.headStyle} goldIntensity={tweaks.gold} />}>
                  <KleopatraHead3D hoveredNav={hoveredNav} />
                </Suspense>
              : <KleopatraHead style={tweaks.headStyle} goldIntensity={tweaks.gold} />
            }
          </div>

          {NAV.map((n) => {
            const rad = (n.angle * Math.PI) / 180;
            const x = 50 + Math.cos(rad) * 58;
            const y = 50 + Math.sin(rad) * 58;
            return (
              <button
                key={n.id}
                className="node"
                style={{ left: `${x}%`, top: `${y}%` }}
                onClick={() => onNav(n.id)}
                onMouseEnter={(e) => { e.currentTarget.classList.add('is-hover'); setHoveredNav(n.id); }}
                onMouseLeave={(e) => { e.currentTarget.classList.remove('is-hover'); setHoveredNav(null); }}
              >
                <span className="node-dot" />
                <span>
                  <div className="node-lbl">{n.label}</div>
                  <div className="node-sub">{n.sub}</div>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <nav className="mobile-nav" aria-label="Navigation">
        {NAV.map((n) => (
          <button
            key={n.id}
            className="mobile-nav-item"
            onClick={() => onNav(n.id)}
          >
            <span className="mobile-nav-dot" />
            <span className="mobile-nav-lbl">{n.label}</span>
            <span className="mobile-nav-sub">{n.sub}</span>
          </button>
        ))}
      </nav>

      <div className="corner bl">
        <div>Marktplatz 7</div>
        <div>91710 Gunzenhausen</div>
        <div><span className="gold">+49 9831 6 84 21</span></div>
      </div>
      <div className="corner br">
        <div>Beratung · Termin</div>
        <div>Fineline · Dotwork · Realism</div>
        <div>Neotraditional · Oldschool</div>
      </div>

      <div className="tagline">
        <div className="tagline-kicker">SEIT 2018 · GUNZENHAUSEN</div>
        <div className="tagline-main">Kunst auf deiner Haut.</div>
      </div>
    </div>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

function PageHead({ kicker, title, titleEm, meta, onBack }) {
  return (
    <>
      <button className="page-back" onClick={onBack}>← Zurück</button>
      <div className="page-head">
        <div>
          <div className="page-kicker">{kicker}</div>
          <h1 className="page-title">{title}{titleEm && <> <em>{titleEm}</em></>}</h1>
        </div>
        {meta && <div className="page-meta">{meta}</div>}
      </div>
    </>
  );
}

// ── Gallery ───────────────────────────────────────────────────────────────────

function Gallery({ onBack }) {
  const [filter, setFilter] = useState('Alle');
  const items = filter === 'Alle' ? GAL_ITEMS : GAL_ITEMS.filter((i) => i.style === filter);
  return (
    <div className="page with-bg">
      <PageHead
        kicker="Portfolio · Kleopatra INK"
        title="Werke &" titleEm="Wunden"
        meta={<>
          <b>{GAL_ITEMS.length > 0 ? `${GAL_ITEMS.length} Arbeiten` : 'Demnächst'}</b>
          <div>2018 — 2026</div>
        </>}
        onBack={onBack}
      />
      <div className="gal-filters">
        {GAL_FILTERS.map((f) => (
          <button key={f}
            className={`gal-chip ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="gal-empty">
          {filter === 'Alle' ? 'Bilder folgen bald.' : `Noch keine ${filter}-Arbeiten vorhanden.`}
        </p>
      ) : (
        <div className="gal-grid">
          {items.map((it, i) => (
            <div key={i} className="gal-item">
              <img className="gal-img" src={it.src} alt={it.piece || it.style} loading="lazy" />
              {(it.piece || it.style) && (
                <div className="gal-caption">
                  <div className="gal-caption-style">{it.style}</div>
                  {it.piece && <div className="gal-caption-piece">{it.piece}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── About ─────────────────────────────────────────────────────────────────────

function About({ onBack }) {
  return (
    <div className="page with-bg">
      <PageHead
        kicker="Über uns · Est. 2018"
        title="Das sind" titleEm="wir"
        meta={<>
          <b>Seit 2018</b>
          <div>Gunzenhausen</div>
          <div>Kleopatra INK</div>
        </>}
        onBack={onBack}
      />
      <div className="about-hero">
        <div className="about-copy">
          <p>Kleopatra INK ist ein Familienstudio in Gunzenhausen — gegründet 2018, gewachsen aus echter Leidenschaft für Tätowierkunst. Ein Künstler, eine Familie, eine Handschrift. Und der Glaube, dass jedes Tattoo ein Einzelstück sein muss.</p>
          <p>Jede Arbeit beginnt mit einem persönlichen Gespräch. Wir hören zu, skizzieren, verwerfen und zeichnen wieder — bis das Motiv so scharf ist wie die Nadel, die es setzt. Kein Motiv verlässt unser Studio zweimal.</p>
          <p>Hygiene nach DIN EN 17141. Pigmente nach EU-REACH. Kein Small-Talk, keine Kompromisse.</p>
        </div>
        <div className="placeholder about-img">
          <div className="ph-label">STUDIO SHOT</div>
          <div className="ph-sub">Innenraum, warmes Licht, Arbeitsplatz</div>
        </div>
      </div>

      <h3 className="serif" style={{ fontSize: 12, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 24px' }}>Der Künstler</h3>
      <div className="team-grid solo">
        <div className="team-card">
          <div className="placeholder">
            <div className="ph-label">PORTRAIT</div>
            <div className="ph-sub">Im Studio, bei der Arbeit</div>
          </div>
          <div className="team-info">
            <h4 className="team-name">Kleopatra INK</h4>
            <div className="team-role">Tätowierer · Gründer</div>
            <div className="team-bio">Seit 2018 in Gunzenhausen zuhause. Spezialisiert auf präzises Fineline, Realism und Neotraditional. Jede Arbeit ein Einzelstück — nichts wird doppelt getätowiert.</div>
            <div className="team-specs">
              <span className="spec">Fineline</span>
              <span className="spec">Dotwork</span>
              <span className="spec">Realism</span>
              <span className="spec">Black & White</span>
              <span className="spec">Neotraditional</span>
              <span className="spec">Oldschool</span>
            </div>
          </div>
        </div>
      </div>

      <h3 className="serif" style={{ fontSize: 12, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--gold)', margin: '60px 0 24px' }}>Die Familie</h3>
      <div className="family-section">
        <div className="placeholder family-img">
          <div className="ph-label">FAMILIENFOTO</div>
          <div className="ph-sub">Familie · Kinder · Hund</div>
        </div>
        <div className="family-copy">
          <p className="cormorant">Hinter Kleopatra INK steckt mehr als ein Studio — es ist ein Familienunternehmen. Termine, Organisation und das herzliche Empfangen der Kunden liegen in familiärer Hand. Wer herkommt, ist kein Laufkundschaft, sondern Gast.</p>
          <p className="cormorant">Das spürt man vom ersten Anruf an.</p>
        </div>
      </div>
    </div>
  );
}

// ── Booking — Beratungstermin ─────────────────────────────────────────────────

const SLOTS = ['10:00', '11:30', '13:00', '14:30', '16:00', '17:30', '19:00'];
const DISABLED = new Set(['13:00', '17:30']);

const INTERESTS = [
  { id: 'fineline',       name: 'Fineline'       },
  { id: 'dotwork',        name: 'Dotwork'        },
  { id: 'realism',        name: 'Realism'        },
  { id: 'blackandwhite',  name: 'Black & White'  },
  { id: 'neotraditional', name: 'Neotraditional' },
  { id: 'oldschool',      name: 'Oldschool'      },
  { id: 'unsure',         name: 'Noch unsicher'  },
];

// ── Piercings ──────────────────────────────────────────────────────────────────

function Piercings({ onBack, onBook }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!getFirebaseConfig()) return undefined;

    setLoading(true);
    setError('');
    fetchPiercingPricesFromFirestore()
      .then((rows) => {
        if (!cancelled) setItems(Array.isArray(rows) ? rows : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page with-bg">
      <PageHead
        kicker="Piercings · Preisliste"
        title="Piercing-" titleEm="Preise"
        meta={<>
          <b>{items.length > 0 ? `${items.length} Preise` : 'Demnächst'}</b>
          <div>ohne Geschlechtertrennung</div>
        </>}
        onBack={onBack}
      />

      <div className="piercing-intro">
        <p className="cormorant">
          Unsere Piercing-Preise werden direkt aus der Studio-Verwaltung geladen.
          Die Angaben gelten ohne Unterscheidung zwischen weiblich und männlich.
        </p>
      </div>

      {loading && (
        <p className="gal-empty" style={{ paddingBottom: 12 }}>
          Preisliste wird geladen …
        </p>
      )}
      {error && (
        <p className="gal-empty" style={{ color: 'var(--muted)', paddingBottom: 12 }}>
          Konnte Preisliste nicht laden ({error}).
        </p>
      )}

      {items.length === 0 && !loading ? (
        <p className="gal-empty">Piercing-Preise folgen bald.</p>
      ) : (
        <div className="piercing-list">
          {items.map((item) => (
            <article key={item.id} className="piercing-card">
              <div>
                <h3 className="piercing-title">{item.title}</h3>
                {item.desc && <p className="piercing-desc">{item.desc}</p>}
              </div>
              <div className="piercing-price">{formatPrice(item.price)}</div>
            </article>
          ))}
        </div>
      )}

      <div className="piercing-note">
        <div>
          <b>Fragen zu Schmuck, Heilung oder Termin?</b>
          <span> Schreib uns deine Idee kurz in die Anfrage.</span>
        </div>
        <button type="button" className="wd-btn" onClick={onBook}>
          Termin anfragen →
        </button>
      </div>
    </div>
  );
}

// ── Wanna-dos ─────────────────────────────────────────────────────────────────

const HAS_3D_BODY = true;

function WannaDos({ onBack, onBook }) {
  const [filter, setFilter] = useState('Alle');
  const [viewItem, setViewItem] = useState(null);
  const [items, setItems] = useState(WANNADO_ITEMS);
  const [wdLoading, setWdLoading] = useState(false);
  const [wdError, setWdError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!getFirebaseConfig()) {
      setWdError('Firebase-Umgebung (VITE_FIREBASE_*) ist nicht gesetzt — es können keine gespeicherten Motive geladen werden.');
      setWdLoading(false);
      return undefined;
    }
    setWdLoading(true);
    setWdError('');
    fetchWannadosFromFirestore()
      .then((rows) => {
        if (!cancelled) setItems(Array.isArray(rows) ? rows : WANNADO_ITEMS);
      })
      .catch((e) => {
        if (!cancelled) setWdError(e.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setWdLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const available = items.filter((i) => i.available !== false);
  const filtered = filter === 'Alle'
    ? items
    : items.filter((i) => i.target === filter || i.target === 'Alle');

  return (
    <div className="page with-bg">
      <PageHead
        kicker="Flash & Wanna-dos · Kleopatra INK"
        title="Wanna-" titleEm="dos"
        meta={<>
          <b>{available.length > 0 ? `${available.length} verfügbar` : 'Demnächst'}</b>
          <div>Flash & Unikate</div>
        </>}
        onBack={onBack}
      />

      <div className="gal-filters" style={{ marginBottom: 32 }}>
        {['Alle', 'Frau', 'Mann'].map((f) => (
          <button key={f}
            className={`gal-chip ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >{f}</button>
        ))}
      </div>

      {wdLoading && (
        <p className="gal-empty" style={{ paddingBottom: 12 }}>
          Motive werden geladen …
        </p>
      )}
      {wdError && (
        <p className="gal-empty" style={{ color: 'var(--muted)', paddingBottom: 12 }}>
          Konnte Firestore nicht laden ({wdError}). Lokale Liste wird angezeigt.
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="gal-empty">
          {filter === 'Alle' ? 'Neue Motive folgen bald.' : `Keine Motive für ${filter} verfügbar.`}
        </p>
      ) : (
        <div className="wd-grid">
          {filtered.map((item, i) => (
            <div key={item.id ?? i} className={`wd-card${item.available === false ? ' wd-taken' : ''}${viewItem === item ? ' wd-viewing' : ''}`}>
              <div className="wd-img-wrap">
                <img src={item.src} alt={item.title} className="wd-img" loading="lazy" />
                {item.available === false && (
                  <div className="wd-overlay-taken">Vergeben</div>
                )}
              </div>
              <div className="wd-info">
                <div className="wd-badges">
                  <span className="wd-badge">{item.style}</span>
                  <span className="wd-badge wd-badge-target">{item.target}</span>
                </div>
                <h3 className="wd-title">{item.title}</h3>
                <div className="wd-meta">{item.placement}</div>
                {item.desc && <p className="wd-desc">{item.desc}</p>}
                <div className="wd-actions">
                  {HAS_3D_BODY && item.available !== false && (
                    <button
                      className={`wd-btn-view${viewItem === item ? ' active' : ''}`}
                      onClick={() => setViewItem(viewItem === item ? null : item)}
                    >
                      {viewItem === item ? '3D aktiv ✓' : 'Auf Körper zeigen'}
                    </button>
                  )}
                  <button
                    className="wd-btn"
                    disabled={item.available === false}
                    onClick={() => item.available !== false && onBook(item)}
                  >
                    {item.available === false ? 'Vergeben' : 'Ich will das →'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {HAS_3D_BODY && (
        <div className="wd-3d-section">
          <div className="wd-3d-header">
            <h3 className="wd-3d-title">Tattoo visualisieren</h3>
            <p className="wd-3d-sub">
              {viewItem
                ? `„${viewItem.title}" — einmal auf den Körper klicken, dann ziehen zum Verschieben (Shift + Ziehen = Größe)`
                : 'Wähle ein Motiv aus und klicke auf „Auf Körper zeigen"'}
            </p>
          </div>
          <Suspense fallback={<div className="body3d-loading">3D-Modell wird geladen …</div>}>
            <Body3DViewer
              tatSrc={viewItem?.src ?? null}
              initialPlacement3d={viewItem?.placement3d ?? null}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

// ── Booking ───────────────────────────────────────────────────────────────────

function Booking({ onBack, wannado }) {
  const [interest, setInterest] = useState('unsure');
  const [slot, setSlot] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [desc, setDesc] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="page with-bg" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div style={{ maxWidth: 540, textAlign: 'center', padding: '20px' }}>
          <div className="page-kicker">Beratungstermin angefragt</div>
          <h1 className="page-title" style={{ marginBottom: 24 }}>Bis <em>bald</em></h1>
          <p className="cormorant" style={{ fontSize: 20, color: 'var(--ivory)', opacity: 0.9, lineHeight: 1.5 }}>
            Ich bestätige deinen Beratungstermin innerhalb von 48 Stunden per Mail an <b style={{ color: 'var(--gold)' }}>{email || 'dich'}</b>. Bring gerne Referenzen mit — und viel Zeit für Fragen.
          </p>
          <button className="page-back" style={{ marginTop: 32 }} onClick={onBack}>← Zurück zur Seite</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page with-bg">
      <PageHead
        kicker="Beratungstermin · kostenlos"
        title="Termin" titleEm="buchen"
        meta={<>
          <b>~45 min</b>
          <div>Kostenfrei</div>
          <div>Unverbindlich</div>
        </>}
        onBack={onBack}
      />
      {wannado && (
        <div className="wd-booking-banner">
          <img src={wannado.src} alt={wannado.title} className="wd-booking-img" />
          <div>
            <div className="wd-booking-label">Ausgewähltes Motiv</div>
            <div className="wd-booking-name">{wannado.title}</div>
            <div className="wd-booking-meta">{wannado.style} · {wannado.placement}</div>
          </div>
        </div>
      )}

      <div className="book-intro">
        <p className="cormorant">
          <b className="gold">Jedes Tattoo beginnt mit einem Gespräch.</b> Bevor die Nadel ansetzt, treffen wir uns für eine unverbindliche Beratung — im Studio oder per Video. Wir besprechen dein Motiv, schauen Referenzen an, ich skizziere, wir klären Platzierung, Aufwand und einen realistischen Preis. Erst danach vereinbaren wir den eigentlichen Tattoo-Termin.
        </p>
      </div>
      <div className="booking-wrap">
        <div className="book-col">
          <h3>01 · Worum geht&apos;s ungefähr?</h3>
          <div className="style-grid">
            {INTERESTS.map((s) => (
              <div key={s.id}
                className={`style-card ${interest === s.id ? 'selected' : ''}`}
                onClick={() => setInterest(s.id)}>
                <div className="style-name">{s.name}</div>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: 36 }}>02 · Dein Wunsch-Slot — Di 12. Mai</h3>
          <div className="slot-grid">
            {SLOTS.map((s) => (
              <button key={s}
                className={`slot ${slot === s ? 'selected' : ''} ${DISABLED.has(s) ? 'disabled' : ''}`}
                disabled={DISABLED.has(s)}
                onClick={() => setSlot(s)}>{s}</button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--ivory-dim)', letterSpacing: '0.08em', marginBottom: 24, marginTop: -8 }}>
            Dauer ca. 45 Minuten. Andere Tage? Schreib&apos;s unten ins Freitextfeld.
          </div>

          <h3 style={{ marginTop: 12 }}>03 · Deine Details</h3>
          <div className="field">
            <label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vor- und Nachname" />
          </div>
          <div className="field">
            <label>E-Mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="deine@email.de" />
          </div>
          <div className="field">
            <label>Telefon <span style={{ opacity: 0.5, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49 …" />
          </div>
          <div className="field">
            <label>Kurz zu deiner Idee</label>
            <textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Motiv, Körperstelle, ungefähre Größe, Referenzen — alles was dir einfällt. Keine Angst, noch muss nichts feststehen." />
          </div>
        </div>

        <div className="summary">
          <h4>Dein Beratungstermin</h4>
          <div className="sum-row"><span className="sum-k">Art</span><span className="sum-v">Erstberatung</span></div>
          <div className="sum-row"><span className="sum-k">Thema</span><span className="sum-v">{INTERESTS.find((s) => s.id === interest)?.name}</span></div>
          <div className="sum-row"><span className="sum-k">Termin</span><span className={`sum-v ${slot ? '' : 'empty'}`}>{slot ? `Di 12. Mai · ${slot}` : 'noch nicht gewählt'}</span></div>
          <div className="sum-row"><span className="sum-k">Dauer</span><span className="sum-v">~45 Min</span></div>
          <div className="sum-row"><span className="sum-k">Kosten</span><span className="sum-v gold">Kostenfrei</span></div>
          <button
            className="btn-primary"
            style={{ marginTop: 24, opacity: (slot && name && email) ? 1 : 0.4, cursor: (slot && name && email) ? 'pointer' : 'not-allowed' }}
            disabled={!(slot && name && email)}
            onClick={() => setSubmitted(true)}>
            Beratung anfragen →
          </button>
          <div style={{ marginTop: 14, fontSize: 10, color: 'var(--ivory-dim)', letterSpacing: '0.06em', lineHeight: 1.5 }}>
            Unverbindlich. Bestätigung per Mail binnen 48 Stunden. Der eigentliche Tattoo-Termin wird im Anschluss gemeinsam vereinbart.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Testimonials ──────────────────────────────────────────────────────────────

const TESTIS = [
  { name: 'Sam78',           info: 'vor 6 Monaten',  stars: 5, text: 'Super sympathisches Tattoo-Studio! Hat uns als Familie total ernst genommen und unsere Wünsche ehrlich und professionell beurteilt, sodass wir alle mit einem tollen Ergebnis nach Hause gegangen sind.' },
  { name: 'Janine',          info: 'vor 9 Monaten',  stars: 5, text: 'Bin absolut begeistert. Ich war vor 2 Wochen in diesem Tattoostudio, um mir mein allererstes Tattoo stechen zu lassen. Es wurde mir empfohlen und ich bekam echt das beste Ergebnis, das ich mir vorstellen konnte.' },
  { name: 'Mareen Bickel',   info: 'vor 7 Monaten',  stars: 5, text: 'Ich habe mir heute ein Tattoo bei den beiden stechen lassen und ein weiteres verschönern. Ich bin mehr als begeistert und meeeega happy damit! Besser hätte man es nicht umsetzen können.' },
  { name: 'Sina Le',         info: 'vor 9 Monaten',  stars: 5, text: 'Hier kommt man gerne her. Super lieb, tolle Atmosphäre und geniale Umsetzung. Bin einfach begeistert.' },
  { name: 'Angela Weidner',  info: 'vor 3 Jahren',   stars: 5, text: 'Super Arbeit richtige Kunstwerke werden da gemacht. Ich habe 4 Tattoos stechen lassen und jedes einzelne ist so schön geworden. Man nimmt sich total viel Zeit für jeden Kunden.' },
  { name: 'Sven Höfler',     info: 'vor einem Jahr', stars: 5, text: 'Das Studio wurde mir empfohlen und ich muss sagen, dass mein Tattoo absolut Klasse geworden ist. Vom Beratungsgespräch bis zum Endergebnis ist absolute Professionalität zu spüren.' },
  { name: 'Laura-Jane Büscher', info: 'vor 2 Jahren', stars: 5, text: 'Bin mehr als zufrieden mit meinem Tattoo. Sehr präzise und professionell gestochen.' },
  { name: 'Klara Popp',      info: 'vor 2 Jahren',   stars: 5, text: 'Das Studio wurde mir von meiner Freundin empfohlen. Hinter einem unscheinbaren Studio steckt absolute Leidenschaft und Professionalität!' },
  { name: 'Frank Carlet',    info: 'vor 2 Jahren',   stars: 5, text: 'Ich habe heute mein erstes Tattoo bekommen. Das Studio wurde mir von einer Freundin empfohlen und ich traf auf einen Künstler der seine Arbeit mit totaler Hingabe ausführt.' },
  { name: 'Maria Sillinger', info: 'vor 3 Jahren',   stars: 5, text: 'Ich hatte nur einen Termin zur Besprechung, aber da er Zeit hatte, hat er mir das Tattoo direkt ohne neuen Termin gestochen, war echt super.' },
  { name: 'Jürgen M.',       info: 'vor 3 Jahren',   stars: 5, text: 'Sehr tollen Eindruck von dort bekommen und es ist ganz einfach zu finden. Meine Erwartungen wurden übertroffen 👍 einfach genial.' },
  { name: 'Melany Deinzer',  info: 'vor 2 Jahren',   stars: 5, text: 'Absolut tolle und freundliche Beratung. Wurde so herzlich und lieb behandelt. Alles ist absolut professionell und auch das Stechen hat super wunderbar funktioniert.' },
  { name: 'Jannis Rabus',    info: 'vor 3 Jahren',   stars: 5, text: 'Durch Zufall auf diesen KÜNSTLER gestoßen. Seine Arbeit ist mehr als perfekt, nimmt sich Zeit für seinen Kunden und geht auf jeden Wunsch ein.' },
  { name: 'Thomas',          info: 'vor 3 Jahren',   stars: 5, text: 'Ich bin durch meinen besten Freund an dieses Studio geraten — und wahnsinnig glücklich darüber!' },
  { name: 'Vanessa Zapke',   info: 'vor 3 Jahren',   stars: 5, text: 'Bin sehr begeistert. Ganz liebe Besitzer und ein sauberes Studio. Man fühlt sich von Anfang an sehr wohl und gut aufgehoben. Eine super Beratung im Vorfeld.' },
  { name: 'Julia M.',        info: 'vor 2 Jahren',   stars: 5, text: 'Ich bin mehr als zufrieden. Mein Tattoo ist sehr sauber gestochen und war innerhalb kürzester Zeit ohne Komplikationen abgeheilt. Ich bin absolut glücklich damit und bereue es keine Sekunde. Gerne wieder ❤️' },
  { name: 'Celine Weissmann',info: 'vor 2 Jahren',   stars: 5, text: 'Ich bin mega zufrieden mit meinem Tattoo. Alle beide sind super sympathisch und wissen genau was sie machen. Es wurde super beraten und man bekommt schnell einen Termin.' },
  { name: 'Lisa',            info: 'vor 4 Jahren',   stars: 5, text: 'Super tolles Team! Mega saubere, akkurate Arbeit und immer freundlich. Sind aus Sachsen und zufällig auf dieses Tattoostudio gestoßen. Beide waren sehr herzlich und zuvorkommend.' },
  { name: 'Sabrina Fichtner',info: 'vor 3 Jahren',   stars: 5, text: 'TOP Tattoostudio! Kompetente und freundliche Beratung, ich bin was Tattoos angeht durch ganz Deutschland getingelt, meine Motive wurden aber nie so umgesetzt wie hier.' },
  { name: 'Evelyn Root',     info: 'vor 2 Jahren',   stars: 5, text: 'Ich war heute mittlerweile zum fünften Mal dort. Ich kann dieses Studio jedem wirklich nur ans Herz legen, mit Abstand das beste Studio in dem ich bisher war.' },
  { name: 'S. Winkler',      info: 'vor 3 Jahren',   stars: 5, text: 'Absolut empfehlenswert, die Besitzer sind sehr freundlich und kommen gerne den Wünschen nach. Mein Beratungstermin wurde anschließend direkt zum Tattoo-Termin.' },
  { name: 'Sigrid Grüner',   info: 'vor einem Jahr', stars: 5, text: 'Tolle Arbeit, super nett. Sehr talentiert. Mega Ergebnis. Seine Frau macht Termine und sie ist sehr freundlich und hat die angenehmste Stimme die ich je hörte am Telefon.' },
  { name: 'Kipfl',           info: 'vor 2 Jahren',   stars: 5, text: '100% Vertrauen in ein Cover-Up gelegt und nicht enttäuscht worden! Super Studio, modern und sauber — der Tätowierer ist unfassbar begabt.' },
];

function Testimonials({ onBack }) {
  return (
    <div className="page with-bg">
      <PageHead
        kicker="Stimmen · Google"
        title="Was unsere" titleEm="Kunden sagen"
        meta={<>
          <b>5,0 ★</b>
          <div>23 Bewertungen</div>
          <div>Google</div>
        </>}
        onBack={onBack}
      />
      <div className="testi-grid">
        {TESTIS.map((t, i) => (
          <div key={i} className="testi">
            <div className="testi-stars">{'★'.repeat(t.stars)}{'☆'.repeat(5 - t.stars)}</div>
            <div className="testi-quote">{t.text}</div>
            <div className="testi-meta">
              <div className="testi-name">{t.name}</div>
              <div className="testi-info">{t.info}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Socials ───────────────────────────────────────────────────────────────────

function Socials({ onBack }) {
  return (
    <div className="page with-bg">
      <PageHead
        kicker="Instagram · @kleopatra.ink"
        title="Unsere" titleEm="Arbeiten"
        meta={<>
          <div>Tägliche Posts</div>
          <div>DM offen</div>
        </>}
        onBack={onBack}
      />
      <InstagramFeed />
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

const TWEAK_DEFAULTS = {
  gold: 70,
  bgMode: 'particles',
  headStyle: 'classic',
};

export default function App() {
  const [page, setPage] = useState('home');
  const [selectedWannado, setSelectedWannado] = useState(null);
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  const onBack = () => { setPage('home'); setSelectedWannado(null); };

  const onBookWannado = (item) => {
    setSelectedWannado(item);
    setPage('booking');
  };

  return (
    <>
      {page === 'home'         && <Landing onNav={setPage} tweaks={t} />}
      {page === 'gallery'      && <Gallery onBack={onBack} />}
      {page === 'about'        && <About onBack={onBack} />}
      {page === 'booking'      && <Booking onBack={onBack} wannado={selectedWannado} />}
      {page === 'piercings'    && <Piercings onBack={onBack} onBook={() => setPage('booking')} />}
      {page === 'testimonials' && <Testimonials onBack={onBack} />}
      {page === 'socials'      && <Socials onBack={onBack} />}
      {page === 'wannados'     && <WannaDos onBack={onBack} onBook={onBookWannado} />}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Vibe" />
        <TweakSlider
          label="Gold-Intensität" unit="%"
          value={t.gold} min={20} max={100} step={5}
          onChange={(v) => setTweak('gold', v)}
        />
        <TweakRadio
          label="Hintergrund"
          value={t.bgMode}
          options={[
            { value: 'particles',   label: 'Sand'  },
            { value: 'hieroglyphs', label: 'Hiero' },
            { value: 'clean',       label: 'Clean' },
          ]}
          onChange={(v) => setTweak('bgMode', v)}
        />
        <TweakSection label="Kleopatra" />
        <TweakRadio
          label="3D-Stil"
          value={t.headStyle}
          options={[
            { value: 'classic', label: 'Classic' },
            { value: 'faceted', label: 'Faceted' },
            { value: 'smooth',  label: 'Smooth'  },
          ]}
          onChange={(v) => setTweak('headStyle', v)}
        />
      </TweaksPanel>
    </>
  );
}
