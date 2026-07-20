# RingBack — the AI receptionist that texts back your missed calls

**62% of calls to small businesses go unanswered. Every one is revenue walking
away.** RingBack forwards your business line; if you don't pick up, the caller
gets a text within seconds and a Gemini-powered agent answers their questions,
qualifies the lead, and books the appointment — while you keep working.

Built for the **Build with Gemini XPRIZE** (category: Small Business Services).
The business itself is operated by AI agents, with every decision logged.

## Try it in 60 seconds (no setup)

```bash
npm install && npm run dev
# then in another terminal:
npm run simulate        # missed call → textback → SMS conversation → booking
```

Or in a browser: `npm run dev:web` → open http://localhost:5173/demo
(judge-facing SMS simulator) and http://localhost:5173/ops (live agent
operations feed). Zero credentials needed — memory store + mock modes are
automatic. Add `GEMINI_API_KEY` to `.env` for live Gemini responses.

## What happens on a missed call

```
Caller dials the business number
  → Twilio forwards to the owner's phone (20s)
  → no answer? Caller hears "we're texting you right now" +
    gets an SMS within ~5 seconds
  → Gemini 2.5 Flash holds the SMS conversation:
      • answers ONLY from the business's services/hours/FAQs
      • fetches real availability (function calling)
      • books the appointment (server-validated slots)
      • escalates to the owner when it should
  → owner gets a summary text; everything is visible in the dashboard
```

Guardrails: deterministic STOP/HELP handling before any model call, 20-turn
cap, per-tenant daily SMS budget, price-invention blocker, webhook signature
verification + idempotency, owner one-click takeover.

## The business runs on seven agents

The receptionist is just agent #7. The other six operate the company — every
execution logged to `agent_runs` and shown live on the public `/ops` page:

| Agent | Cadence | Job |
|---|---|---|
| Onboarding | on checkout | provisions number, drafts profile from the customer's website, welcomes them |
| Support | inbound email | answers product questions; billing always goes to human approval |
| Prospector | weekdays | researches local businesses, drafts outreach — **never sends; founder approves** |
| CFO | weekly | writes the P&L narrative from real Stripe/Twilio/Gemini numbers |
| Watchdog | 15 min | closes idle threads, pauses budget-breachers, pages the founder |
| QA | nightly | scores conversations 1–5, proposes prompt fixes (approval-gated) |

Full authority policy: [docs/agent-charter.md](docs/agent-charter.md).

## Stack

- **Google Cloud:** Cloud Run, Firestore, Cloud Scheduler, Secret Manager,
  BigQuery (log sink), Cloud Build
- **Gemini API:** 2.5 Flash (conversations, drafting) + 2.5 Pro (CFO reports,
  QA scoring) via `@google/genai`
- **Twilio** (voice + SMS), **Stripe** (subscriptions), **SendGrid** (email)
- Node 22 + TypeScript + Fastify; React SPA; vitest (55+ tests)

## Repo map

```
src/receptionist/   conversation engine, prompts, tools, guardrails
src/agents/         runner (evidence trail) + the six ops agents
src/routes/         Twilio/Stripe webhooks, owner API, public ops/demo API
src/lib/            store (Firestore + memory), gemini, twilio, stripe, auth
web/                landing, /demo simulator, /ops console, owner dashboard
infra/              setup.sh (GCP provisioning), deploy.sh, cloudbuild.yaml
docs/               agent-charter, runbook, compliance
test/               vitest suite
```

## Deploy

See [docs/runbook.md](docs/runbook.md). Short version:
`./infra/setup.sh` → paste secrets → `./infra/deploy.sh` → re-run setup with
`APP_URL` to create the scheduler jobs.

## Pricing

Starter **$49/mo** · Pro **$99/mo** · Founding customers: **first month $1**.
Unit economics: a tenant's variable cost (SMS + Gemini) is cents per
conversation; the CFO agent flags any tenant whose costs exceed 30% of plan.

## License & hackathon notes

Source shared for XPRIZE judging (testing@devpost.com, judging@hacker.fund).
New project, started July 20, 2026, inside the submission window. LLM calls
use the Gemini API exclusively.
