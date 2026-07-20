import { Link } from 'react-router-dom';

export function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-footer-inner">
        <p>
          © {new Date().getFullYear()} RingBack. Callers can opt out anytime — reply STOP.
        </p>
        <ul className="landing-footer-links">
          <li>
            <Link to="/demo">Demo</Link>
          </li>
          <li>
            <Link to="/ops">Operations</Link>
          </li>
          <li>
            <Link to="/login">Log in</Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}
