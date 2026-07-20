import { Link } from 'react-router-dom';
import './login/login.css';

export function Welcome() {
  return (
    <main className="login-page">
      <div className="login-panel">
        <Link to="/" className="brand">
          RingBack
        </Link>
        <div className="login-sent-icon" aria-hidden="true">
          ☎
        </div>
        <h1>You're in.</h1>
        <p>
          Check your email for your login link — that's how you'll sign in to the dashboard from
          now on. No password required.
        </p>
        <Link to="/login" className="btn btn-accent">
          Go to login
        </Link>
        <p className="login-dev-hint">In local dev the link is printed in emails_out / server logs.</p>
      </div>
    </main>
  );
}
