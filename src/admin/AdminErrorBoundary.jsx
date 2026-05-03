import { Component } from 'react';

/**
 * Ohne Error Boundary: jeder Laufzeitfehler in der Admin-UI = leerer schwarzer Bildschirm.
 */
export default class AdminErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error('[Admin]', err, info?.componentStack);
  }

  render() {
    if (this.state.err) {
      return (
        <div
          className="page with-bg admin-wrap admin-app"
          style={{ minHeight: '100vh', padding: 32, maxWidth: 640, margin: '0 auto' }}
        >
          <h1 className="page-title" style={{ fontSize: 28, marginBottom: 16 }}>
            Admin <em style={{ color: 'var(--gold)' }}>Fehler</em>
          </h1>
          <p className="admin-error cormorant" style={{ fontSize: 18, lineHeight: 1.5 }}>
            Die Oberfläche ist abgestürzt. Details in der Browser-Konsole (F12).
          </p>
          <pre
            style={{
              marginTop: 20,
              padding: 16,
              fontSize: 12,
              overflow: 'auto',
              border: '1px solid var(--line)',
              background: 'var(--bg-elev)',
              color: 'var(--ivory-dim)',
            }}
          >
            {this.state.err?.message || String(this.state.err)}
          </pre>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 24 }}
            onClick={() => this.setState({ err: null })}
          >
            Erneut versuchen
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
