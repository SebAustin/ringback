# RingBack Runbook

## Local development (zero credentials needed)

```bash
npm install
npm run dev            # API on :8080, memory store + Gemini mock + Twilio mock
npm run dev:web        # Vite dev server on :5173 (proxies /api → :8080)
npm run simulate       # drives a full missed-call → SMS → booking flow
npm test               # 55+ vitest tests
```

The demo tenant ("Luxe Cuts Salon", id `demo-luxe-cuts`) is auto-seeded on
boot. `/demo` and `/ops` work immediately.

Add a real `GEMINI_API_KEY` to `.env` to switch from canned mock replies to
live Gemini (still no Twilio/Stripe needed — SMS sends are recorded to the
`sms_out` collection instead of hitting carriers).

## Production deploy (Cloud Run)

Day-1 sequence (human tasks marked 👤):

1. 👤 GCP project with billing; `gcloud auth login`.
2. `PROJECT_ID=... ./infra/setup.sh` — enables APIs, Firestore, secrets,
   scheduler SA, BigQuery sink.
3. 👤 Create accounts + paste secrets (`gcloud secrets versions add NAME --data-file=-`):
   - Gemini API key (aistudio.google.com/apikey)
   - Twilio: **upgrade off trial immediately**, then submit BOTH
     (a) toll-free number verification and (b) 10DLC sole-prop brand+campaign
     ("customer care / appointment booking"). Enable Advanced Opt-Out on the
     Messaging Service. Set a $50 spend alert.
   - Stripe: activate account, create Products/Prices for Starter $49 and
     Pro $99 (+ a $1 founding-month coupon), add webhook endpoint
     `https://<app>/webhooks/stripe` (checkout.session.completed,
     customer.subscription.*, invoice.paid, invoice.payment_failed).
   - SendGrid: API key + inbound parse → `https://<app>/webhooks/inbound-email?key=<INBOUND_KEY>`
     (print the key with: `node -e "const c=require('crypto');console.log(c.createHmac('sha256',process.env.SESSION_SECRET).update('inbound-email').digest('hex').slice(0,32))"`)
   - `SESSION_SECRET`: `openssl rand -hex 32`
4. `./infra/deploy.sh` → note the service URL, redeploy with
   `APP_BASE_URL=<url>`, then `APP_URL=<url> ./infra/setup.sh` to create the
   5 Cloud Scheduler jobs.
5. Point the demo tenant's Twilio number webhooks at
   `/webhooks/twilio/voice` and `/webhooks/twilio/sms` (the onboarding agent
   does this automatically for numbers it buys).
6. Smoke test: call the demo number, let it ring out, receive the textback,
   book via SMS; check `/ops` for the receptionist run.

## Cron inventory (UTC)

| Job | Schedule | Endpoint |
|---|---|---|
| watchdog-15min | `*/15 * * * *` | POST /agents/watchdog |
| qa-nightly | `0 9 * * *` | POST /agents/qa |
| prospector-daily | `0 13 * * 1-5` | POST /agents/prospector |
| cfo-weekly | `0 15 * * 1` | POST /agents/cfo |
| onboarding-checkin | `0 16 * * *` | POST /agents/onboarding |

All jobs authenticate with an OIDC token (audience = APP_BASE_URL) from
`scheduler-invoker@<project>.iam.gserviceaccount.com`.

## Incidents

- **Paged by watchdog SMS** → check `/ops` incidents + Cloud Run logs
  (`gcloud run services logs read ringback-app --region us-central1`).
- **Runaway SMS loop** → watchdog auto-pauses the tenant at its daily cap.
  Manual: set tenant `status: "paused"` in Firestore.
- **AI misbehaving with a live customer** → open the conversation in the
  dashboard → "Take over" (AI pauses instantly). Nightly QA will flag it too.
- **Stripe webhook failures** → replay from the Stripe dashboard; handlers
  are idempotent (`events/stripe_<id>` dedupe).
- **Twilio webhook signature failures** → confirm APP_BASE_URL matches the
  public URL exactly (scheme + host, no trailing slash).

## Data hygiene

- Churned tenant purge (until automated):
  delete `tenants/<id>/conversations/*` 30 days after cancellation.
- Never hand out Firestore access; all reads go through the app's redaction.
