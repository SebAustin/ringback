# Written Narrative (draft — ~800 words; update numbers before submission)

> Submission requirement: how the team uses AI day to day, humans vs AI,
> jobs/economic opportunity created, and the story of building this way.

## The problem we picked

Call a barber at 2pm on a Friday and there's a good chance nobody answers —
they're mid-fade. Industry studies put unanswered calls to small local
businesses around 40–62%, and most callers who hit voicemail simply dial the
next shop on Google. For a solo operator, that's thousands of dollars a month
lost while they're literally doing their job.

RingBack fixes the moment the call is missed: the caller gets a text within
seconds, and a Gemini-powered receptionist answers questions from the
business's real service list, offers real open slots, and books the
appointment. The owner sees a summary and can take over any thread with one
tap. Setup is one checkout and one call-forwarding code.

## What AI does vs. what the human does

RingBack is one founder plus seven AI agents, and we can show — not just
claim — where the line sits, because every agent execution is written to an
`agent_runs` log and rendered live on our public operations page (/ops).

**AI executes autonomously, in production:**
- **Receptionist** (the product): holds every customer conversation, decides
  when to answer, when to fetch availability, when to book, and when to
  escalate to the owner. Bookings are real function calls against
  server-validated open slots.
- **Onboarding**: when Stripe reports a new checkout, an agent provisions the
  Twilio number, reads the customer's website with Gemini, drafts their
  service list and FAQ, and emails them a review link. A human never touches
  standard onboarding.
- **Support**: inbound email is classified and answered by an agent from a
  product knowledge doc.
- **Watchdog**: every 15 minutes it closes idle threads, detects stuck
  conversations, and pauses any tenant that breaches its SMS budget.
- **CFO**: every Monday it pulls real Stripe, Twilio, and Gemini numbers and
  writes the weekly P&L narrative. The P&L attached to this submission was
  written by that agent.
- **QA**: nightly, it re-reads sampled conversations and scores them against
  a rubric.

**Humans decide, by design:**
- Cold outreach: the Prospector agent researches businesses and drafts every
  email, but nothing sends without a founder approval click — and the founder
  sends from his own inbox. AI drafts; a human owns the relationship.
- Anything touching money: billing replies, cancellations, refunds are
  drafted by the support agent but gated behind approval. No agent in the
  system can move money.
- Quality changes: the QA agent proposes prompt fixes; they apply only after
  human review.

The same split applied to *building* the company: the codebase, tests,
infrastructure scripts, and this narrative's first draft were produced by AI
coding agents orchestrated end-to-end, with the founder making the
irreversible calls (what to build, pricing, what ships to a real customer).

## Business results

<!-- UPDATE BEFORE SUBMISSION with real numbers from the CFO agent report -->
- Paying tenants: N (Starter $49 / Pro $99; founding customers $1 first month)
- Revenue in window: $X (Stripe export attached), related-party: $Y reported separately
- Conversations handled by AI in production: N; appointments booked: N
- Agent runs logged: N (see /ops); human approvals: N
- Total spend: <$100 (P&L attached — written by the CFO agent)

## Jobs and economic opportunity beyond us

RingBack doesn't replace a receptionist at the businesses we serve — our
customers never had one. It recovers revenue that was evaporating: every
booked missed-call is income the owner would not otherwise have had, which is
the most direct economic impact software can have on a one-chair salon or a
two-person plumbing outfit.

The opportunity it creates beyond the founding team:
- **For customers' businesses**: recovered bookings fund real hiring — a
  second chair, an apprentice. Booking data (captured, not lost) makes their
  demand visible for the first time.
- **For local service resellers**: the model runs as "AI operations in a
  box" — bookkeepers, marketing freelancers, and IT consultants who serve
  Main Street can resell RingBack setups as a service line (our onboarding
  agent does the technical work; they own the local relationship).
- **For the trades of the AI economy**: the playbook here — small business,
  seven logged agents, human approval gates — is replicable. We've documented
  the whole operating charter precisely so the next solo founder can run a
  company this way.

## The story

This project went from empty folder to working product — receptionist engine,
six operating agents, dashboards, tests, cloud infrastructure — in the first
day of build, because the founder's role had shifted from typing code to
directing agents and reviewing their work. The first week was product; every
week after was selling, with the AI drafting outreach each morning and the
founder walking into shops with a live demo on his phone. That's the thesis
of this hackathon made literal: one person, operating like a company, because
the company is agents.
