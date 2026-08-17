# Devpost project story — paste-ready

## Inspiration

Call a barber at two in the afternoon and there's a good chance nobody answers. They're mid-fade, hands busy, phone across the room. Studies of small local businesses put unanswered calls somewhere between 40% and 60% — and most people who reach voicemail don't leave one. They call the next shop on Google.

For a one-chair salon or a two-person plumbing outfit, that's rent walking out the door while the owner is doing exactly what they should be doing: their job. They don't need a receptionist they can't afford. They need the call answered.

That's the product. But the bigger question this hackathon asks is whether a *business* can be run by AI — so we set out to prove both at once, in a way a judge could verify rather than take on faith.

## What it does

A business forwards its line to a RingBack number. If nobody picks up, the caller gets a text within seconds, and a Gemini-powered receptionist takes the conversation from there: it answers questions strictly from that business's own services, hours and FAQs, pulls genuinely open slots from their calendar, and books the appointment. The owner gets a summary and can take over any thread with one tap.

The receptionist is only agent #7. Six more agents run the company:

- **Onboarding** — fires on Stripe checkout, provisions the phone number, reads the customer's website with Gemini, drafts their service list and FAQ, sends the welcome email
- **Support** — classifies inbound email and answers from a knowledge doc; anything billing escalates to a human
- **Prospector** — researches local businesses and drafts outreach, but **never sends** — a human approves and sends from their own inbox
- **CFO** — writes the weekly P&L narrative from real Stripe, Twilio and Gemini numbers
- **Watchdog** — every 15 minutes: closes idle threads, pauses tenants over budget, pages the founder
- **QA** — nightly, scores conversations 1–5 against a rubric and proposes prompt fixes

Every execution is logged and rendered on a **public** operations page at `/ops` — a live URL, not a screenshot, showing each run with its Gemini transcript, tool calls, cost and outcome.

## How we built it

Node 22 + TypeScript + Fastify on **Cloud Run**, **Firestore** for data, **Cloud Scheduler** driving the agents on cron with OIDC auth, **Secret Manager** for credentials, **BigQuery** for the log sink, **Cloud Build** for CI. **Gemini 2.5 Flash** handles conversations with function calling (`get_availability`, `book_appointment`, `escalate_to_owner`); **Gemini 2.5 Pro** writes the CFO reports and QA scoring. Twilio for telephony, Stripe for billing, React for the dashboards.

The design decision that mattered most: **write the agent charter before the agents.** Each one has a documented authority limit — what it may do alone, what needs a human click, what it may spend. No agent can move money. No agent sends cold outreach. Those aren't technical limits, they're product decisions.

Guardrails, because this talks to real customers: STOP/HELP opt-outs handled deterministically in code *before* any model call; the AI is blocked from quoting a price that isn't in the business's own config; 20-turn cap; per-tenant daily SMS budget with an automatic kill switch; quiet hours; webhook signature verification; two-phase idempotency; one-tap owner takeover.

## Challenges we ran into

**US carrier registration (A2P 10DLC) takes weeks** — longer than this hackathon existed. That's the honest reason there's no live SMS traffic. Rather than describe a product we couldn't deliver, we made the conversation engine fully exercisable over the web so anyone can evaluate the real thing today.

**Three bugs that only production would have found**, all caught by adversarial review rounds before launch:

1. The textback ran *after* the HTTP response on scale-to-zero Cloud Run, where CPU is throttled the moment a response completes. The core product promise could have silently never fired.
2. **No Firestore composite indexes existed.** The first production SMS would have thrown, returned a clean 200 to Twilio, and failed every message after it with no alert.
3. Business hours were modelled as nested arrays — which Firestore rejects outright. Every test passed (the in-memory test store accepts them) while production was impossible to deploy.

Each was invisible to a green test suite. That's the lesson.

## Accomplishments that we're proud of

- **41 agent runs logged, 100% success rate**, running unattended in production — verifiable by anyone at `/ops`
- A public, live evidence trail rather than claims: every agent execution with its Gemini transcript and cost
- Guardrails that hold: opt-outs handled before the model, prices the AI cannot invent, money and outreach gated on a human
- 74 automated tests and three rounds of adversarial robustness review before launch
- **Total spend: $0.02.** Zero marketing spend. The operations layer is agents, not staff.

## What we learned

Agents build fast and confidently wrong. The value was never in generating code — it was in the loop: build, review adversarially, verify against evidence, keep a human on anything irreversible. Every serious bug we shipped past was caught by pointing a skeptical reviewer at the builder's output, not by the builder being careful.

We also learned to report honestly. Revenue is **$0** — no customer has been charged. We could have dressed that up. But the rules let judges request live demos and financial documentation, and a claim that collapses under a follow-up is worth less than a small true number. What we do have is fully checkable: a working product, real logged agent operations, and no customers yet.

## What's next for RingBack

Carrier registration clears in weeks, not months — at which point the SMS path that's already built and tested goes live and the first missed call belongs to a real business. From there: the first paying customers at $49/month, AI-answered voice calls (the same tools, a different channel), and Google Calendar sync.

Longer term, the interesting model isn't selling one salon at a time. It's the people who already serve Main Street — bookkeepers, local marketers, IT consultants — reselling RingBack setups while the onboarding agent does the technical work and they keep the relationship. The operating pattern is documented publicly in the repo for exactly that reason.

---

## Built with (tags)

gemini, google-cloud, cloud-run, firestore, cloud-scheduler, secret-manager, bigquery, cloud-build, typescript, node.js, fastify, react, vite, twilio, stripe, sendgrid, vitest, docker, zod
