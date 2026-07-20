import { Link } from 'react-router-dom';
import { PhonePanel } from '../../components/PhonePanel';
import { MessageBubble } from '../../components/MessageBubble';
import type { MessageRole } from '../../types';

const MOCK_THREAD: { role: MessageRole; body: string; delay: number }[] = [
  { role: 'system', body: 'Missed call — 3:41 PM', delay: 0 },
  { role: 'assistant', body: "Hi! Sorry we missed you — this is Luxe Cuts' assistant. What can I help with?", delay: 350 },
  { role: 'caller', body: 'Do you have anything open Saturday for a haircut?', delay: 1400 },
  { role: 'assistant', body: 'Saturday at 11:00 AM with Jordan works. Want me to book it?', delay: 2500 },
  { role: 'caller', body: 'Yes please!', delay: 3500 },
  { role: 'assistant', body: "Booked. See you Saturday at 11:00 AM. Reply STOP to opt out.", delay: 4300 },
];

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-heading">
      <div>
        <p className="hero-eyebrow">Missed-call textback for local business</p>
        <h1 id="hero-heading">
          Your phone rings. Nobody's there. <em>We text them back in five seconds.</em>
        </h1>
        <p className="hero-sub">
          RingBack answers the calls you can't. It texts the caller instantly, answers their
          questions, and books the appointment — while you're still on the last one.
        </p>
        <div className="hero-actions">
          <Link to="/demo" className="btn btn-accent">
            Try the receptionist right now
          </Link>
          <Link to="/ops" className="btn btn-outline">
            Watch our AI run the company — live
          </Link>
        </div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <PhonePanel contactName="Luxe Cuts Salon" contactMeta="RingBack AI receptionist">
          {MOCK_THREAD.map((message, index) => (
            <MessageBubble
              key={index}
              role={message.role}
              body={message.body}
              animate
              animationDelayMs={message.delay}
            />
          ))}
        </PhonePanel>
      </div>
    </section>
  );
}
