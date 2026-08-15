# Devpost submission — paste-ready

Fill every `[N]` / `[...]` with real numbers before submitting. **Never round up or
invent.** If a number is zero, write zero — judges verify, and honesty about a small
number scores better than a claim that collapses under a follow-up call.

---

## Category
**Small Business Services**

## Elevator pitch (one line)
The AI receptionist that texts back your missed calls in five seconds, answers from
your own service list, and books the appointment — run by seven AI agents, one founder.

---

## About the project

**The problem.** Call a barber at 2pm on a Friday and nobody answers — they're
mid-fade. Industry studies put unanswered calls at small local businesses around
40–60%, and most callers who reach voicemail simply dial the next shop on Google.
For a one-chair salon or a two-person plumbing outfit, that's revenue evaporating
while they're literally doing their job.

**What RingBack does.** The business forwards its line to a RingBack number. If
nobody picks up, the caller gets a text within seconds and a Gemini-powered
receptionist takes over the conversation: it answers questions strictly from that
business's own services, hours and FAQs, fetches genuinely open slots, and books the
appointment. The owner gets a summary text and can take over any thread with one tap.

**What makes it different: the business itself is operated by AI.** The receptionist
is only agent #7. Six more agents run the company, and every single execution is
written to an `agent_runs` log rendered live on a public operations page:

| Agent | Cadence | What it decides |
|---|---|---|
| Receptionist | per call/text | Answer, fetch availability, book, or escalate |
| Onboarding | on Stripe checkout | Provisions the number, reads the customer's website with Gemini, drafts their profile, sends the welcome |
| Support | inbound email | Classifies and answers from a knowledge doc; billing always escalates |
| Prospector | weekdays | Researches local businesses and drafts outreach — **never sends; a human approves** |
| CFO | weekly | Writes the P&L narrative from real Stripe/Twilio/Gemini numbers |
| Watchdog | every 15 min | Closes idle threads, pauses tenants over budget, pages the founder |
| QA | nightly | Scores conversations 1–5, proposes prompt fixes (approval-gated) |

The authority policy is written down in `docs/agent-charter.md`: what each agent may
do alone, what requires a human click, and its spend limit. **No agent can move money,
and no agent sends cold outreach.**

**Guardrails, because this talks to real customers.** STOP/HELP opt-outs are handled
deterministically in code before any model call; the AI cannot quote a price that
isn't in the business's own configuration (post-generation check); there's a 20-turn
cap, a per-tenant daily SMS budget with an automatic kill switch, quiet hours, webhook
signature verification, and a one-tap owner takeover.

**Testable right now, no signup:**
- Live product demo → `[YOUR_URL]/demo`
- Live AI operations console → `[YOUR_URL]/ops`

---

## Built with
Google Cloud (Cloud Run, Firestore, Cloud Scheduler, Secret Manager, BigQuery,
Cloud Build) · Gemini API (2.5 Flash for conversations and function calling, 2.5 Pro
for CFO reports and QA scoring) · Twilio (voice + SMS) · Stripe · SendGrid ·
Node 22 · TypeScript · Fastify · React · Vitest

---

## Revenue evidence

| Field | Value |
|---|---|
| Total revenue (arms-length, in window) | **$[N]** |
| May 2026 | $0 |
| June 2026 | $0 |
| July 2026 | $0 |
| August 2026 | $[N] |
| Related-party revenue (reported separately) | $[N] |
| Total expenses | $[~35] |
| — Twilio | $[20] |
| — Domain | $[12] |
| — Google Cloud | $0 (free trial) |
| — Gemini API | $[~1] |
| **Marketing / customer-acquisition spend** | **$0** |

Customers acquired entirely through in-person visits by the founder; zero paid
acquisition. Costs are unusually low because the operations layer is agents rather
than staff — the CFO agent's own weekly report is attached as the P&L.

## User evidence
[N] paying businesses, all US local service businesses (salons, barbers, [...]),
plus [N] demo-simulator sessions from [...]. Customer names, emails and phone numbers
supplied separately with their permission. Testimonials: [...]

## Product evidence
- Public live agent feed: `[YOUR_URL]/ops` — every agent execution with its Gemini
  transcript, tool calls, cost and outcome
- [N] agent runs logged since launch; [N] autonomous actions; [N] human approvals
- Cloud Scheduler jobs firing 5 agents on schedule; BigQuery log sink
- Screenshots: Stripe payments, Cloud Run metrics, approval queue

---

## Testing instructions for judges
1. Open `[YOUR_URL]/demo` — you're the caller whose call was just missed. Ask about
   availability, give a name, and the AI books you. This is the real production
   pipeline (same engine, same Gemini calls, same booking validation), just over the
   web instead of SMS so no carrier registration is needed to evaluate it.
2. Open `[YOUR_URL]/ops` — watch your own conversation appear in the live agent feed
   within seconds, and expand it to see the Gemini transcript and tool calls.
3. Repo: `[REPO_URL]` (shared with testing@devpost.com and judging@hacker.fund).
   `npm install && npm test` runs 68 tests with zero credentials.

## Known state at submission
SMS delivery runs on a toll-free number pending carrier A2P verification —
a registration queue, not a technical gap. The conversation engine, booking,
agent-operations layer and dashboards are all live in production and testable
above. [Delete or amend this paragraph if SMS is live by Monday.]
