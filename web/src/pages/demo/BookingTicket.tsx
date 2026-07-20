import type { DemoBooked } from '../../types';

export function BookingTicket({ booked }: { booked: DemoBooked }) {
  return (
    <aside className="booking-ticket" aria-label="Appointment confirmed">
      <div className="booking-ticket-eyebrow">Confirmed</div>
      <h3>Appointment booked</h3>
      <dl>
        <dt>Service</dt>
        <dd>{booked.service}</dd>
        <dt>When</dt>
        <dd>{booked.label}</dd>
      </dl>
    </aside>
  );
}
