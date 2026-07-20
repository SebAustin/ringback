import { Link } from 'react-router-dom';
import './landing/landing.css';
import { Hero } from './landing/Hero';
import { HowItWorks } from './landing/HowItWorks';
import { AgentsStrip } from './landing/AgentsStrip';
import { Pricing } from './landing/Pricing';
import { Faq } from './landing/Faq';
import { LandingFooter } from './landing/LandingFooter';

export function Landing() {
  return (
    <div className="landing">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header>
        <nav className="landing-nav" aria-label="Main navigation">
          <Link to="/" className="brand">
            RingBack
          </Link>
          <div className="landing-nav-links">
            <Link to="/demo">Demo</Link>
            <Link to="/ops">Live ops</Link>
            <a href="#pricing">Pricing</a>
            <Link to="/login" className="btn btn-outline btn-sm">
              Log in
            </Link>
          </div>
        </nav>
      </header>
      <main id="main-content">
        <Hero />
        <HowItWorks />
        <AgentsStrip />
        <Pricing />
        <Faq />
      </main>
      <LandingFooter />
    </div>
  );
}
