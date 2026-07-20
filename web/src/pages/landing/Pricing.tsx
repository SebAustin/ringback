import { PricingCard } from './PricingCard';

export function Pricing() {
  return (
    <section className="section" aria-labelledby="pricing-heading" id="pricing">
      <div className="section-heading">
        <h2 id="pricing-heading">Pricing</h2>
        <span className="section-kicker">No setup fee, cancel anytime</span>
      </div>
      <span className="founding-banner">Founding customers: $1 for your first month</span>
      <div className="pricing-grid">
        <PricingCard
          plan="starter"
          name="Starter"
          price="$49"
          features={[
            'Missed-call textback on one number',
            'Up to 200 conversations / month',
            'FAQ + hours answering',
            'Email support',
          ]}
        />
        <PricingCard
          plan="pro"
          name="Pro"
          price="$99"
          featured
          features={[
            'Everything in Starter',
            'Unlimited conversations',
            'Appointment booking',
            'Priority support + weekly report',
          ]}
        />
      </div>
    </section>
  );
}
