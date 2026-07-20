# RingBack — AI Receptionist for the Build with Gemini XPRIZE

## Context

The user is entering the **Build with Gemini XPRIZE** (xprize.devpost.com): build a real, AI-agent-operated business with real arms-length revenue during the submission window. Today is **Jul 20, 2026**; submission closes **Aug 17, 2026 (1pm PT)** — ~4 weeks remain. The workspace is greenfield.

User decisions (confirmed via Q&A):
- **Concept:** AI Receptionist for local service businesses — category **Small Business Services**
- **Budget cap:** < $100 total (infra + marketing), disclosed in P&L
- **Market:** English/global
- **Sales motion:** AI drafts all outreach; the user sends (~30–60 min/day) and takes calls

**Product:** When a local business (salon, barber, plumber, contractor) misses a call, the system instantly texts the caller back; a Gemini-powered agent holds the SMS conversation, answers FAQs, qualifies the lead, and books an appointment; the owner gets a summary. Judges can test it via a live phone number **and** a web-based SMS simulator at `/demo` (immune to carrier filtering).

**Hackathon compliance built in:** Gemini API in production (required), Google Cloud products (Cloud Run, Firestore, Cloud Scheduler, Secret Manager, BigQuery, Cloud Build), Stripe revenue evidence, judge-visible agent execution logs.

## Architecture (approved by Plan agent)

- **One repo, one Cloud Run service** (`ringback-app`): Node 22 + TypeScript + Fastify; Vite/React SPA (owner dashboard + `/ops` + `/demo`) served statically from the same service. Scale-to-zero, `--cpu-boost`.
- **DB:** Firestore Native (free tier, real-time listeners power the live ops feed).
- **LLM:** Gemini 2.5 Flash for conversations (function calling: `get_availability`, `book_appointment`, `escalate_to_owner`, `mark_lead_qualified`); Gemini 2.5 Pro for weekly CFO reports and nightly QA scoring.
- **Telephony:** Twilio — voice webhook `<Dial>`s the owner's cell; on no-answer, textback SMS within ~5s and AI takes over the SMS thread.
- **Payments:** Stripe Checkout + Billing Portal + webhooks. Tiers: Starter $49/mo, Pro $99/mo; $1 founding-customer first month.
- **Core flow:** missed call → `POST /webhooks/twilio/voice/status` → create conversation + textback → `POST /webhooks/twilio/sms` per reply → Gemini + tools → booking → owner notification. Guardrails: deterministic STOP/HELP before any LLM call, 20-turn cap, per-tenant daily SMS budget (200 segments), price-invention regex check, webhook idempotency on `MessageSid`/`CallSid`.

### AI Operations Layer (the "AI-Native Operations" judging criterion)

Seven agents; each execution logged to a top-level `agent_runs` collection (full Gemini transcript, tool calls, cost, outcome) rendered live on the public read-only `/ops` dashboard (PII-redacted). Shared `runAgent()` wrapper in `src/agents/runner.ts`.

| Agent | Trigger | Authority |
|---|---|---|
| Receptionist (product) | Twilio webhooks | Auto: replies, bookings, FAQs. Escalates complaints/off-script. |
| Onboarding | Stripe checkout webhook | Auto-provisions tenant, Twilio number, Gemini-drafted profile from customer's website; owner reviews before go-live. |
| Support | Inbound email → `/agents/support` | Auto: informational replies + safe actions. Billing → approval queue. |
| Prospector | Cron 6am PT weekdays | Researches 25 local businesses, scores fit, drafts outreach. **Draft-only — the user approves each send from /ops** (matches chosen sales motion + spam safety). |
| CFO/Analyst | Cron Mon 8am PT | Pulls Stripe/Twilio/Gemini costs + metrics; writes weekly P&L narrative (this literally becomes the submission P&L). |
| Watchdog | Cron every 15 min | Auto: retries, closes idle convos, pauses budget-breaching tenants; pages founder on incidents. |
| QA Reviewer | Cron nightly | Scores sampled conversations 1–5; proposes prompt-diff fixes, applied only after approval. |

Decision authority + spend limits documented in `docs/agent-charter.md` (judge evidence).

### Repo layout (single package, no monorepo tooling)

```
ringback/
├── src/{server.ts, config.ts}
├── src/routes/{twilio,stripe,api,demo,agents}.ts
├── src/receptionist/{conversation,prompts,tools,guardrails}.ts
├── src/agents/{runner,onboarding,support,prospector,cfo,watchdog,qa}.ts
├── src/lib/{firestore,gemini,twilio,stripe,email}.ts
├── web/            # Vite React: Dashboard, Conversations, Settings, Ops, Demo
├── docs/{agent-charter,runbook,compliance}.md
├── infra/{setup.sh, cloudbuild.yaml}
├── scripts/{seed-demo-tenant,simulate-missed-call}.ts
├── test/           # vitest: guardrails, tools, webhook signatures
└── Dockerfile
```

**Data model (Firestore):** `tenants` (profile, hours, services, FAQs, Twilio number, denormalized Stripe billing, limits) → subcollections `conversations` → `messages`, `appointments`; top-level `agent_runs`, `prospects`, `support_tickets`, `metrics_daily`, `incidents`.

**Auth:** magic-link email login only (no passwords). Agent endpoints OIDC-verified (Cloud Scheduler service account). Twilio/Stripe signature verification on all webhooks. Secrets in Secret Manager.

## Execution plan (agency orchestration)

Follow the `/agency` loop with this plan as PLAN.md source of truth:

1. **Scaffold + build loop (this week):** `builder` implements in small units → `test-engineer` (vitest on guardrails/tools/webhooks) → `security-auditor` (STRIDE; SECURITY.md) → `solution-verifier` (solution-rubric, repeat ≤6 iterations until SOLID).
2. **Deploy:** `fde` — `infra/setup.sh` provisions GCP (enable APIs, Firestore, Secret Manager, Scheduler jobs, BigQuery log sink), Cloud Build → Cloud Run on push to main.
3. **Docs:** `doc-writer` — README, agent-charter, runbook, compliance, ACCEPTANCE.md.
4. **Launch assets:** `launch-comms` + `marketing-agent` — landing page copy, outreach templates, demo-video script, 500–1000-word narrative draft.

### Week-by-week

- **W1 (Jul 20–26):** GCP + repo + CI live Day 1; Twilio voice/SMS flow, conversation engine, booking, `/demo` simulator, owner dashboard, Stripe checkout, watchdog agent. **Exit: a stranger can call the demo number ("Luxe Cuts Salon" seed tenant), get texted back, and book; judges can do the same at `/demo`.**
- **W2 (Jul 27–Aug 2):** Remaining 5 ops agents + `/ops` dashboard live; prospector drafting daily; user sends approved outreach + visits local businesses. Goal: 2–3 paying tenants (even at $1 founding deal — Stripe records are the evidence).
- **W3 (Aug 3–9):** Optional AI-answered voice (timeboxed 3 days, cut without guilt); Google Calendar sync if requested; evidence sprint (metrics_daily, screen recordings, testimonials, BigQuery queries). Goal: 5 paying tenants, ≥25 real conversations, ≥5 bookings.
- **W4 (Aug 10–17):** Feature freeze Aug 12. 3-min video, written narrative, P&L (export of the CFO agent's own report), judge access package. **Submit Aug 15** (2-day buffer). Repo shared with testing@devpost.com and judging@hacker.fund.

### Actions requiring the user (guardrails — Claude cannot do these)

- Create/upgrade accounts and enter payment details: **Twilio upgrade off trial (~$20, Day 1 — critical), Stripe activation, GCP billing/free-trial, domain purchase (~$12), SendGrid**.
- Day 1: submit **A2P 10DLC sole-prop registration AND toll-free number verification in parallel** (top risk: registration delays; `/demo` simulator is the fallback demo path).
- Send all outreach emails/DMs and take sales calls (AI drafts; user approves + sends from `/ops`).
- Provide API keys/secrets into Secret Manager (Claude will prepare `setup.sh` and `.env.example`; user pastes values).

### Top risks

1. **A2P 10DLC delay** → dual-path registration Day 1 + toll-free + `/demo` simulator fallback.
2. **No customers by deadline** → $1 founding pricing, in-person demos, front-loaded W2 selling; worst case, demo tenant + heavy `/ops` evidence still tells the story.
3. **AI misbehavior with real callers** → pending_review go-live gate, guardrails, owner takeover, nightly QA.
4. **Runaway cost** → per-tenant SMS caps, Twilio $50 spend alert, Gemini Flash pricing (~pennies).
5. **Solo time** → voice + calendar sync are designated cut lines; W1 scope is the only sacred scope.

### Compliance (docs/compliance.md)

TCPA: textback replies to consumer-initiated contact (implied consent); first SMS identifies business + "Reply STOP to opt out"; deterministic STOP/HELP handling pre-LLM; quiet hours 9pm–8am; no marketing messages. No HIPAA targets (dental/vet/chiro booking only, no health details). PII redaction on public `/ops`; BigQuery sink excludes message bodies.

## Verification

- **Unit/integration:** vitest green on guardrails (STOP/HELP, turn caps, price check), booking tools, webhook signature + idempotency paths.
- **E2E local:** `scripts/simulate-missed-call.ts` drives the full pipeline against the emulator/dev deploy.
- **E2E prod:** real phone call to demo number → observe textback, hold an SMS conversation, book an appointment, receive owner summary; verify conversation + `agent_runs` docs and `/ops` live feed.
- **Web path:** `/demo` simulator completes the same flow in a browser (this is what judges will use).
- **Ops agents:** manually trigger each `/agents/*` endpoint once; confirm cron firing via Cloud Scheduler logs; confirm CFO report renders on `/ops`.
- **Billing:** Stripe test-mode checkout end-to-end, then one live $1 founding-customer charge.
