import { cfg } from '../config.js';
import { getStore } from './store.js';
import { nowIso } from './time.js';
import { retryOnce } from './async.js';

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
    try {
      const res = await retryOnce(async () => {
        const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          signal: AbortSignal.timeout(5000),
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
        if (r.status === 429 || r.status >= 500) {
          throw Object.assign(new Error(`SendGrid ${r.status}`), { status: r.status });
        }
        return r;
      }, 'sendgrid:send');
      delivered = res.status === 202;
      if (!delivered) {
        const detail = await res.text().catch(() => '');
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({ severity: 'error', msg: 'SendGrid send failed', status: res.status, detail: detail.slice(0, 300) }),
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ severity: 'error', msg: 'SendGrid send error', err: String(err) }));
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
