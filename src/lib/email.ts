import { cfg } from '../config.js';
import { getStore } from './store.js';
import { nowIso } from './time.js';

/**
 * Send an email via SendGrid. Without an API key the message is recorded to
 * the `emails_out` collection only (visible in /ops for local demos).
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ delivered: boolean }> {
  let delivered = false;
  if (cfg.SENDGRID_API_KEY) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: opts.to }] }],
        from: { email: cfg.EMAIL_FROM, name: 'RingBack' },
        subject: opts.subject,
        content: [
          { type: 'text/plain', value: opts.text },
          ...(opts.html ? [{ type: 'text/html', value: opts.html }] : []),
        ],
      }),
    });
    delivered = res.status === 202;
    if (!delivered) {
      const detail = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.error(`SendGrid send failed (${res.status}): ${detail.slice(0, 300)}`);
    }
  }
  await getStore().add('emails_out', {
    to: opts.to,
    subject: opts.subject,
    text: opts.text.slice(0, 2000),
    delivered,
    createdAt: nowIso(),
  });
  return { delivered };
}
