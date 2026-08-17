# RingBack — final submission content (paste-ready)

Numbers below are pulled live from production on **Aug 16, 2026, 19:15 CDT**.
Refresh them Monday morning before you submit (`/api/ops/summary`).
Everything here is literally true and survives a judge checking it.

---

## Project name
**RingBack**

## Elevator pitch (one line)
The AI receptionist that texts back your missed calls in five seconds, answers
from your own service list, and books the appointment — a business run by seven
AI agents and one founder.

## Category
**Small Business Services**

## Links
| Field | Value |
|---|---|
| Try the product | https://ringback-app-hmyecsfq3q-uc.a.run.app/demo |
| Watch the AI run the business | https://ringback-app-hmyecsfq3q-uc.a.run.app/ops |
| Repository (public, MIT) | https://github.com/SebAustin/ringback |
| Demo video | *(paste your YouTube link)* |

---

## About the project

**The problem.** Call a barber at 2pm on a Friday and there's a good chance
nobody answers — they're mid-fade. Studies of small local businesses put
unanswered calls somewhere between 40% and 60%, and most callers who reach
voicemail simply dial the next shop on Google. For a one-chair salon or a
two-person plumbing outfit, that is revenue evaporating while they are doing
exactly what they are supposed to be doing: working.

**What RingBack does.** The business forwards its line to a RingBack number. If
nobody picks up, the caller receives a text within seconds, and a Gemini-powered
receptionist takes the conversation from there: it answers questions strictly
from that business's own services, hours and FAQs, fetches genuinely open slots
from their calendar, and books the appointment. The owner gets a summary and can
take over any thread with one tap.

**What makes it different: the business itself is operated by AI.** The
receptionist is only agent #7. Six more agents run the company, and every single
execution is written to an `agent_runs` log rendered live on a public operations
page — not a screenshot, a live URL anyone can open:

| Agent | Cadence | What it decides |
|---|---|---|
| Receptionist | per call/text | Answer, fetch availability, book, or escalate |
| Onboarding | on Stripe checkout | Provisions the number, reads the customer's website with Gemini, drafts their profile, sends the welcome |
| Support | inbound email | Classifies and answers from a knowledge doc; anything billing escalates |
| Prospector | weekdays | Researches local businesses and drafts outreach — **never sends; a human approves** |
| CFO | weekly | Writes the P&L narrative from real Stripe, Twilio and Gemini numbers |
| Watchdog | every 15 min | Closes idle threads, pauses tenants over budget, pages the founder |
| QA | nightly | Scores conversations 1–5 against a rubric, proposes prompt fixes (approval-gated) |

Each agent's authority is written down in `docs/agent-charter.md`: what it may
do alone, what needs a human click, and its spend limit. **No agent can move
money, and no agent sends cold outreach.**

**Guardrails, because this talks to real customers.** STOP/HELP opt-outs are
handled deterministically in code *before* any model call. The AI cannot quote a
price that isn't in the business's own configuration — a post-generation check
blocks it. There is a 20-turn cap, a per-tenant daily SMS budget with an
automatic kill switch, quiet hours, webhook signature verification, two-phase
idempotency on every webhook, and one-tap owner takeover.

**Engineering.** 74 automated tests. Three rounds of adversarial robustness
review before launch, which caught four critical production failure modes —
including a textback path that would have silently never fired on scale-to-zero
Cloud Run, and missing Firestore indexes that would have failed every SMS with a
200 OK and no alert.

---

## Built with
Google Cloud — **Cloud Run, Firestore, Cloud Scheduler, Secret Manager,
BigQuery, Cloud Build** · **Gemini API** (2.5 Flash for conversations and
function calling, 2.5 Pro for CFO reports and QA scoring) · Twilio · Stripe ·
SendGrid · Node 22 · TypeScript · Fastify · React · Vitest

---

## Product evidence (live, verifiable)

Measured in production at **Aug 16, 2026 19:15 CDT**:

| Metric | Value |
|---|---|
| Agent runs logged | **41** |
| Run success rate | **100%** (41/41 succeeded) |
| Breakdown | 32 watchdog (scheduled), 9 receptionist (event-driven) |
| Continuous operation | since 16:55 UTC Aug 16, watchdog firing every 15 min on Cloud Scheduler |
| Conversations handled | 8 |
| Appointments booked | 4 |
| AI resolution rate | 100% |
| Gemini spend across all runs | $0.0182 |

Anyone can verify this at `/ops` — the feed shows each agent run with its Gemini
transcript, tool calls, cost and outcome.

**Honest scope statement:** these conversations ran on the demo tenant ("Luxe
Cuts Salon"), exercised by the founder and by evaluators of the live demo. They
are **not** customer traffic. The bookings are real writes to Firestore made by
the AI through validated tools, but the caller was not a paying customer's
caller. The scheduled agents (watchdog) are genuine unattended production runs.

---

## Revenue evidence

| Field | Value |
|---|---|
| Total revenue, arms-length third parties | **$0.00** |
| May 2026 | $0.00 |
| June 2026 | $0.00 |
| July 2026 | $0.00 |
| August 2026 | $0.00 |
| Related-party revenue | $0.00 |

**Explanation.** RingBack reached production on August 16, 2026. No customer has
been charged, so revenue is zero and we report it as zero. The billing path
(Stripe subscriptions) is implemented and the onboarding agent that provisions a
tenant on checkout is written and tested, but it has not processed a paying
customer.

The honest constraint: US carrier registration for application-to-person SMS
(A2P 10DLC) takes multiple weeks, which is longer than this hackathon window.
Rather than claim a live SMS product we could not deliver, we built the
conversation engine to be fully exercisable over the web at `/demo` — the same
engine, the same Gemini calls, the same validated booking — so the product can
be evaluated honestly today while carrier registration proceeds.

## Expenses

| Item | Amount |
|---|---|
| Gemini API | $0.02 |
| Google Cloud (Cloud Run, Firestore, Scheduler, BigQuery) | $0.00 — free trial |
| Twilio | $0.00 |
| Domain | $0.00 |
| **Total expenses** | **$0.02** |
| **Marketing / customer-acquisition spend** | **$0.00** |

Marketing spend is zero. There was no paid acquisition of any kind. Operating
costs are near zero because the operations layer is agents rather than staff.

## User evidence
1 tenant configured (the public demo tenant). 0 paying customers. Visitors to
`/demo` interact with the live conversation engine; those sessions appear in the
public agent feed. No testimonials to report.

---

## Testing instructions for judges

1. Open **https://ringback-app-hmyecsfq3q-uc.a.run.app/demo** — you are the
   caller whose call was just missed. Try: *"Hi, do you have anything open this
   week for a men's cut?"* then *"The first one works. My name is Alex."* The AI
   checks the salon's real calendar and books you. This is the production
   pipeline — same engine, same Gemini calls, same server-side booking
   validation — running over the web instead of SMS so no carrier registration
   is needed to evaluate it.
2. Open **https://ringback-app-hmyecsfq3q-uc.a.run.app/ops** — your conversation
   appears in the live agent feed within seconds. Expand it to see the Gemini
   transcript and the tool calls.
3. Repo: **https://github.com/SebAustin/ringback** (public, MIT).
   `npm install && npm test` runs 74 tests with zero credentials required.

## Known state at submission
SMS delivery awaits US carrier A2P registration — a queue, not a technical gap.
The conversation engine, booking, agent-operations layer and dashboards are all
live in production and testable above.
