import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import './login/login.css';
import { requestMagicLink } from '../api';

export function Login() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await requestMagicLink(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-panel">
        <Link to="/" className="brand">
          RingBack
        </Link>
        {sent ? (
          <>
            <div className="login-sent-icon" aria-hidden="true">
              ✉
            </div>
            <h1>Check your inbox</h1>
            <p>
              If <strong>{email}</strong> has a RingBack account, a sign-in link is on its way.
            </p>
          </>
        ) : (
          <>
            <h1>Log in</h1>
            <p>We'll email you a magic link — no password to remember.</p>
            <form className="login-form" onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              {error ? (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              ) : null}
              <button type="submit" className="btn btn-accent" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send my login link'}
              </button>
            </form>
          </>
        )}
        <p className="login-dev-hint">
          In local dev the link is printed in emails_out / server logs.
        </p>
      </div>
    </main>
  );
}
