import { useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_COLORS = [
  '#d4a537',
  '#1a140c',
  '#8b6914',
  '#26201a',
  '#f0c860',
  '#0a0806',
  '#b08328',
  '#3a2f1f',
];

const EUR_FORMATTER = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
});

export function formatSegment(segment) {
  if (!segment) return '';
  const type = segment.type || 'text';
  if (type === 'amount') {
    const value = Number(segment.value);
    if (Number.isFinite(value)) return `${EUR_FORMATTER.format(value)}`;
    return segment.label || '—';
  }
  if (type === 'percent') {
    const value = Number(segment.value);
    if (Number.isFinite(value)) return `${value}%`;
    return segment.label || '—';
  }
  return segment.label || '—';
}

export function segmentColor(segment, index) {
  if (segment?.color) return segment.color;
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

function polarToCartesian(cx, cy, r, angleRad) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function describeSlice(cx, cy, r, startDeg, endDeg) {
  const start = ((startDeg - 90) * Math.PI) / 180;
  const end = ((endDeg - 90) * Math.PI) / 180;
  const s = polarToCartesian(cx, cy, r, start);
  const e = polarToCartesian(cx, cy, r, end);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y} Z`;
}

/**
 * LuckyWheel — animiertes Glücksrad.
 *
 * Props:
 *   segments:      Array von { id, label, type: 'amount' | 'text' | 'percent', value?, color? }
 *   onResult(seg): Callback mit dem gewinnenden Segment, sobald die Animation zur Ruhe kommt.
 *   disabled:      true → Drehen ist deaktiviert (User hat bereits gedreht).
 *   buttonLabel:   String — Beschriftung des Spin-Buttons.
 *   size:          Pixel-Breite des Rads.
 *   spinDurationMs: Wie lange die Animation läuft.
 */
export default function LuckyWheel({
  segments = [],
  onResult,
  disabled = false,
  buttonLabel = 'Drehen',
  size = 360,
  spinDurationMs = 5200,
}) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [resultIdx, setResultIdx] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const sliceDeg = segments.length > 0 ? 360 / segments.length : 0;

  const slices = useMemo(() => {
    if (segments.length === 0) return [];
    const cx = 50;
    const cy = 50;
    const r = 50;
    return segments.map((seg, i) => {
      const startDeg = i * sliceDeg;
      const endDeg = startDeg + sliceDeg;
      return {
        path: describeSlice(cx, cy, r, startDeg, endDeg),
        midRad: (((startDeg + endDeg) / 2 - 90) * Math.PI) / 180,
        midDeg: (startDeg + endDeg) / 2,
        fill: segmentColor(seg, i),
        seg,
      };
    });
  }, [segments, sliceDeg]);

  const spin = () => {
    if (spinning || disabled || segments.length === 0) return;
    const winnerIdx = Math.floor(Math.random() * segments.length);
    const targetMid = winnerIdx * sliceDeg + sliceDeg / 2;
    const extraTurns = 6 + Math.floor(Math.random() * 3);
    const currentMod = ((rotation % 360) + 360) % 360;
    const nextRotation =
      rotation + (360 - currentMod) + extraTurns * 360 + (360 - targetMid);
    setSpinning(true);
    setResultIdx(null);
    setRotation(nextRotation);
    timeoutRef.current = setTimeout(() => {
      setSpinning(false);
      setResultIdx(winnerIdx);
      onResult?.(segments[winnerIdx], winnerIdx);
    }, spinDurationMs + 60);
  };

  if (segments.length === 0) {
    return (
      <div className="lucky-wheel-empty" style={{ width: size, maxWidth: '100%' }}>
        Noch keine Segmente konfiguriert.
      </div>
    );
  }

  return (
    <div className="lucky-wheel-wrap" style={{ width: size, maxWidth: '100%' }}>
      <div className="lucky-wheel-stage">
        <div className="lucky-wheel-pointer" aria-hidden="true" />
        <div
          className="lucky-wheel-disc"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinning
              ? `transform ${spinDurationMs}ms cubic-bezier(0.18, 0.86, 0.22, 1)`
              : 'none',
          }}
        >
          <svg viewBox="0 0 100 100" className="lucky-wheel-svg">
            {slices.map((s, i) => (
              <path key={i} d={s.path} fill={s.fill} stroke="rgba(10,8,6,0.85)" strokeWidth="0.4" />
            ))}
            {slices.map((s, i) => {
              const labelR = 33;
              const lx = 50 + labelR * Math.cos(s.midRad);
              const ly = 50 + labelR * Math.sin(s.midRad);
              const rotate = s.midDeg;
              return (
                <g key={`l${i}`} transform={`rotate(${rotate} ${lx} ${ly})`}>
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="lucky-wheel-text"
                    style={{
                      fontSize: Math.max(3, Math.min(5.2, 6.5 - segments.length * 0.18)) + 'px',
                    }}
                  >
                    {formatSegment(s.seg)}
                  </text>
                </g>
              );
            })}
            <circle cx="50" cy="50" r="6" fill="#0a0806" stroke="#d4a537" strokeWidth="0.6" />
          </svg>
        </div>
      </div>

      <button
        type="button"
        className="btn-primary lucky-wheel-btn"
        onClick={spin}
        disabled={spinning || disabled}
      >
        {spinning ? 'Dreht …' : buttonLabel}
      </button>

      {resultIdx !== null && !spinning && (
        <div className="lucky-wheel-result" role="status">
          <span className="lucky-wheel-result-kicker">Gewonnen</span>
          <span className="lucky-wheel-result-value">{formatSegment(segments[resultIdx])}</span>
          {segments[resultIdx].label && segments[resultIdx].type !== 'text' && (
            <span className="lucky-wheel-result-label">{segments[resultIdx].label}</span>
          )}
        </div>
      )}
    </div>
  );
}
