import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, startCheckout } from '../../api';
import { useToast } from '../../components/Toast';

interface PricingCardProps {
  plan: 'starter' | 'pro';
  name: string;
  price: string;
  featured?: boolean;
  features: string[];
}

const CHECKOUT_UNAVAILABLE_MESSAGE =
  "Checkout isn't live yet — email hello@ringback.app and we'll get you set up by hand.";

export function PricingCard({ plan, name, price, featured = false, features }: PricingCardProps) {
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { url } = await startCheckout({
        plan,
        email,
        businessName,
        website: website || undefined,
      });
      window.location.href = url;
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        showToast(CHECKOUT_UNAVAILABLE_MESSAGE, 'error');
      } else {
        const message = error instanceof Error ? error.message : 'Something went wrong.';
        showToast(message, 'error');
      }
      setSubmitting(false);
    }
  };

  return (
    <div className={`price-card${featured ? ' featured' : ''}`}>
      <span className="plan-name">{name}</span>
      <div className="plan-price">
        {price} <small>/ month</small>
      </div>
      <ul>
        {features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <form className="checkout-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor={`${plan}-business`}>Business name</label>
          <input
            id={`${plan}-business`}
            required
            value={businessName}
            onChange={(event) => setBusinessName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${plan}-email`}>Work email</label>
          <input
            id={`${plan}-email`}
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${plan}-website`}>Website (optional)</label>
          <input id={`${plan}-website`} value={website} onChange={(event) => setWebsite(event.target.value)} />
        </div>
        <button type="submit" className={`btn ${featured ? 'btn-accent' : 'btn-primary'}`} disabled={submitting}>
          {submitting ? 'Starting checkout…' : `Start ${name}`}
        </button>
      </form>
    </div>
  );
}
