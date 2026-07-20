import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>Nobody picked up this page.</h1>
      <p style={{ color: 'var(--ink-soft)' }}>Fitting, for a company about missed calls.</p>
      <Link to="/" className="btn btn-primary">
        Back to RingBack
      </Link>
    </main>
  );
}
