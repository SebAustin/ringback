# Devpost long-form answers — paste-ready

Numbers current as of **Aug 16, 2026 20:40 CDT**. Refresh from `/api/ops/summary`
before submitting if you want the latest.

---

**Date started:** `07-20-26`
**Submitter type:** `Individual`
**Organization name / EIN:** *(leave blank — sole proprietor, no EIN)*
**Country of residence:** `United States`
**Category:** `Small Business Services`

---

## Explain how your project uses AI to impact the world, specifically in your category

Small local businesses miss a large share of their inbound calls — studies put it between 40% and 60% — and most callers who reach voicemail don't leave one; they call the next business on Google. For a one-chair salon or a two-person plumbing outfit, every missed call is revenue lost while the owner is doing exactly what they should be doing: their job. A human receptionist costs more than the revenue at stake, so the problem has simply gone unsolved.

RingBack closes that gap. When a call is missed, the caller receives a text within seconds and a Gemini-powered receptionist holds a real conversation: it answers from that business's own services, hours and FAQs, retrieves genuinely open slots through function calling, and books the appointment. The owner never touches their phone.

The category impact is direct: it converts calls that were previously lost into booked revenue for businesses that could never afford front-desk staff. It does not displace a job — our customers never had that role — it recovers income that was evaporating, which is what funds a second chair or an apprentice.

## How do you measure impact?

**Theory of change.** Missed calls are a measurable revenue leak for small service businesses. If an AI can answer within seconds and book competently, a meaningful share of otherwise-lost callers convert. Recovered bookings are income the business would not have had.

**Hypotheses.** (1) A majority of missed callers will engage with an immediate, identified textback. (2) The AI can complete a booking without human help in most engaged conversations. (3) The recovered revenue per month materially exceeds the $49 subscription, making the value obvious.

**Outputs we measure — all instrumented today and visible at /ops:** missed calls captured, textback latency, conversations engaged, appointments booked, AI resolution rate (share of conversations resolved without escalation), escalations to the owner, QA quality score (1–5, scored nightly by a separate agent), and cost per conversation.

**Current measured outputs:** 48 agent runs at a 100% success rate, 9 conversations, 5 bookings, 100% AI resolution rate, $0.02 total Gemini spend. These are demo-tenant conversations, not customer traffic — stated plainly so the number isn't mistaken for traction.

**Outcomes we expect.** Short term: recovered bookings per business per month, and owner-reported time saved. Long term: businesses that can quantify their inbound demand for the first time, because calls that used to vanish are now logged and attributed.

**How we prove it.** Every conversation and every agent decision is logged with its outcome. Booking counts per tenant are directly attributable to calls the business missed — a counterfactual that is unusually clean, since without RingBack those callers left no trace at all.

## Explain the underlying business model

**B2B SaaS, sold to local service businesses** — salons, barbers, nail studios, dog groomers, trades.

**Acquisition.** Direct founder-led sales: in-person visits and calls to local businesses, where the demo is the pitch (miss a call and watch yourself get texted back and booked). A Prospector agent researches candidate businesses and drafts personalized outreach daily, but it never sends — the founder approves and sends from his own inbox.

**Value creation.** Recovered revenue. A single recovered appointment typically exceeds a month's subscription, which makes the ROI conversation short.

**Retention.** Value compounds as the business's profile, FAQs and hours get tuned, and the tenant's booking history accumulates. Switching means going back to losing calls silently.

**Revenue.** Subscription: Starter $49/month (textback, conversation, booking), Pro $99/month (adds FAQ training and a weekly lead report). Founding customers pay $1 for the first month to remove all friction from the first sale.

## How will you sustain business operations in the future?

**Resource allocation.** The dominant cost is per-conversation inference and SMS, both metered and both tiny relative to the subscription. Fixed costs are near zero: infrastructure is serverless and scales to zero, and the operations layer is agents rather than staff. Founder time goes almost entirely to selling, because onboarding, support, monitoring and reporting are already automated.

**Threats.** (1) Carrier registration and SMS deliverability — the main external dependency, and the reason SMS is not live today. (2) Per-tenant cost overrun, mitigated by hard daily SMS budgets with an automatic kill switch and a CFO agent that flags any tenant whose variable cost exceeds 30% of their plan. (3) Quality drift in AI conversations, mitigated by nightly QA scoring and approval-gated prompt changes. (4) Competitive pressure from incumbent booking platforms adding textback.

**How operations change after the hackathon.** Carrier registration completes, SMS goes live, and the first paying customers onboard through the already-built automated path. The agent layer is designed so that adding tenants adds inference cost but not headcount.

## Which AI tools have you leveraged while working on this project?

**In the product (production):** Google Gemini API — Gemini 2.5 Flash for all customer conversations, function calling and drafting; Gemini 2.5 Pro for weekly CFO financial reports and nightly conversation QA scoring.

**In building it:** Claude Code as the primary development environment, driving a multi-agent workflow — separate agents for architecture, implementation, adversarial robustness review, security auditing (STRIDE), test engineering and independent verification. The entire codebase, test suite, infrastructure scripts and documentation were produced this way, with the founder directing and reviewing. The demo video and submission assets were generated programmatically by driving the live production site with headless Chromium.

## Explain how your business model is sustainable and viable

**Five-year goal.** The US has roughly 5 million small service businesses in the target categories. Capturing 0.5% at an average $60/month blended ARPU is approximately $18M ARR. Our five-year target is 25,000 tenants — about 0.5% share — with a serviceable market well above that.

**Path to profitability.** Unit economics are the strongest part of this business. Measured today, a full conversation costs well under a cent of Gemini inference; adding SMS at scale keeps variable cost in the low single-digit dollars per tenant per month against a $49 subscription — a gross margin above 90%. Because the operations layer is agents, the fixed-cost base does not grow linearly with customers. With near-zero fixed costs, profitability arrives at a very low tenant count — on the order of tens of paying tenants, not thousands.

**Why it's achievable.** The hackathon P&L shows total expenses of $0.02 to run a complete production system, including a live conversational AI, six autonomous operating agents, scheduled jobs, dashboards and logging. That is the core evidence: the cost structure is real and measured, not projected.

**Evidence of product-market fit — stated honestly.** We do not yet claim product-market fit. We have zero paying customers and zero revenue. What we have is a working product, verifiable production operations, and a problem that is well documented independently of us. Demonstrating willingness to pay is the immediate next milestone, and we would rather say that plainly than infer traction we haven't earned.

## Please explain how your business operates with AI

Seven agents run RingBack. The receptionist is only the seventh; the other six operate the company itself:

- **Onboarding** — fires on Stripe checkout: provisions the phone number, reads the customer's website with Gemini, drafts their service list and FAQ, sends the welcome email. No human touches a standard onboarding.
- **Support** — classifies inbound email and answers from a product knowledge document; billing and cancellation always escalate.
- **Prospector** — researches local businesses, scores fit, drafts outreach. Draft-only by design.
- **CFO** — pulls real Stripe, Twilio and Gemini figures weekly and writes the P&L narrative.
- **Watchdog** — every 15 minutes: closes idle conversations, flags stuck threads as incidents, pauses tenants over budget, pages the founder.
- **QA** — nightly, samples conversations and scores them 1–5 against a rubric, proposing prompt fixes.

What this achieves that moves the needle: a business serving local customers 24/7 with no staff, at a cost structure ($0.02 total during this hackathon) that makes a $49/month price viable for businesses that could never afford a receptionist. Every execution is logged to an append-only store and published live at /ops with its Gemini transcript, tool calls, cost and outcome — the claim is auditable, not asserted.

## Please explain the extent to which AI is live in production and executes key decisions

AI is live in production now and makes these decisions unaided:

**Customer-facing:** whether to answer a question or escalate to the owner; which appointment slots to offer; whether the customer has supplied enough information to book; when to commit a booking (a real database write through a validated tool); when a conversation is beyond its competence and a human is needed.

**Operational:** whether a conversation is stuck and warrants an incident; whether a tenant has breached its SMS budget and must be paused (the agent pauses it); when to close and summarize an idle conversation; how to classify an inbound support email and whether it can be answered without a human; what the weekly financial narrative says; whether a conversation's quality is below standard.

**Measured:** 48 agent runs at 100% success, running unattended since deployment — 32 scheduled watchdog executions triggered by Google Cloud Scheduler over OIDC and 16 event-driven receptionist executions.

**Deliberately reserved for humans:** moving money (no agent can charge, refund or change a price), sending cold outreach (drafted only), and applying prompt changes. These limits are documented per-agent in `docs/agent-charter.md` in the repository.

## Which product from Google Cloud did you use and how?

Six, all in production:

- **Cloud Run** — hosts the entire application (API, webhooks, dashboards). Scales to zero; deployed with `--no-cpu-throttling` specifically so post-response agent work completes reliably.
- **Firestore (Native)** — system of record for tenants, conversations, messages, appointments, and the `agent_runs` evidence log. Six composite indexes are committed to the repo and verified at boot; the app deliberately fails fast on a missing index rather than silently degrading.
- **Cloud Scheduler** — invokes five agents on cron (watchdog every 15 min, QA nightly, prospector weekdays, CFO weekly, onboarding check-ins daily), authenticating with OIDC tokens tied to a dedicated service account.
- **Secret Manager** — all credentials; the Cloud Run runtime holds `secretAccessor` only, and nothing secret is in the repository.
- **BigQuery** — log sink for structured application logs (message bodies deliberately excluded).
- **Cloud Build** — container builds and deploys.

## If your project uses an LLM, explain which LLMs and how the Gemini API is used

**Gemini is the only LLM used. There is no other model provider in the project.**

- **Gemini 2.5 Flash** — every customer conversation, using function calling with four server-side tools (`get_availability`, `book_appointment`, `escalate_to_owner`, `mark_lead_qualified`). Also drafts tenant profiles from a customer's website during onboarding, drafts prospect outreach, and classifies inbound support email.
- **Gemini 2.5 Pro** — writes the weekly CFO financial narrative and performs nightly QA scoring of conversations against a rubric.

Integration is via the official `@google/genai` SDK (`src/lib/gemini.ts`), with per-call timeouts, one bounded retry on 429/5xx, and token/cost accounting recorded on every agent run. Judges can trigger a live Gemini call themselves at `/demo` and watch the resulting run — including its cost — appear at `/ops` seconds later.

## GitHub repo URL
`https://github.com/SebAustin/ringback` — **public, MIT licensed.**

## Pre-existing business resources (anything before May 19, 2026)
None. There were no pre-existing employees, customer relationships, contact lists, audiences, partnerships, code, or brand assets. RingBack was started from an empty directory on July 20, 2026; the full commit history is public in the repository. The founder has no prior customers in this market.

## Total Revenue
`$0`

## Revenue by Month
`May: $0, June: $0, July: $0, August: $0`

## Explain the revenue
Revenue is $0. No customer has been charged and no payment has been processed. Pricing is defined — Starter $49/month, Pro $99/month, founding customers $1 for the first month — and the Stripe subscription path plus the onboarding agent that provisions a tenant on checkout are implemented and tested, but zero paying users and zero transactions occurred during the hackathon period. US carrier registration for A2P SMS requires multiple weeks, longer than the hackathon window; rather than claim a live SMS business, we made the product fully evaluable over the web while registration proceeds.

## Related-Party Revenue
`$0`

## Total Expenses
`$0.02`

## Explain the expenses
Total expenses were $0.02. (1) **COGS: 100%** — entirely metered Gemini API inference across 48 production agent runs. (2) **Sales and marketing: 0%** — there was no advertising, promotion or paid customer acquisition of any kind. (3) **R&D: 0%** in cash terms — the only input was unpaid founder time; no contractors, no paid tooling. (4) **G&A: 0%** — no entity formation, legal or accounting spend. Drivers: COGS was driven by conversation volume and scheduled agent executions; all Google Cloud usage (Cloud Run, Firestore, Cloud Scheduler, Secret Manager, BigQuery, Cloud Build) fell inside free-tier limits at $0.00; Twilio was never provisioned because carrier registration could not complete in the window.

## Total COGS
`$0.02`

## Explain COGS
COGS is Gemini API inference — the direct variable cost of producing the service. Gemini 2.5 Flash handles customer conversations and function calling; Gemini 2.5 Pro handles weekly CFO reporting and nightly QA scoring. Cost is metered per call and recorded on each individual agent run, visible in the public log at /ops. Google Cloud infrastructure, which would ordinarily also be COGS, was $0.00 within free-tier limits. Telephony (Twilio), the other future COGS line, was $0.00 as no numbers were provisioned.

## Total marketing and customer acquisition expense
`$0`

## Explain marketing and customer acquisition expenses
Zero. No money was spent on customer acquisition during the hackathon period. (1) **Marketing: $0** — no advertising, no sponsored placement, no content or SEO spend, no paid tools. (2) **Sales: $0** — no sales staff, commissions, travel or lead-list purchases. The intended acquisition motion is founder-led direct sales supported by an AI Prospector agent that drafts outreach for human approval, which carries no cash cost beyond inference already counted in COGS.

## Additional expenses
None. All costs incurred during the hackathon period are captured above.

## Number of users acquired during the hackathon
`0`

*(If Devpost requires a non-zero interpretation, the honest framing is: 0 acquired users; 1 tenant configured — the public demo tenant — plus anonymous visitors who exercised the live demo. Report **0**.)*

## Number of those users paying
`0`

## Verifiable public testimonial
None. No customer has used the product, so there is no testimonial to report.

## Level of learning derived
`Significant`

## Agentic Economy Prize (Circle)
Not opting in — the project has no Circle wallet integration or on-chain transactions. Leave the opt-in and all three related fields blank.
