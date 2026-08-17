# Written narrative (submission requirement: 500–1000 words)

*Word count: ~890. Paste as-is.*

---

## Building a company where the staff are agents

Call a barber at two in the afternoon and there is a good chance nobody answers.
They are mid-fade, hands busy, phone across the room. Industry studies of small
local businesses put unanswered calls somewhere between 40% and 60%, and most
people who hit voicemail don't leave one — they call the next shop on Google.
For a one-chair salon, that is rent walking out the door while the owner is
doing exactly what they should be doing: their job.

RingBack answers the call they can't. The business forwards its line to a
RingBack number; if nobody picks up, the caller gets a text within seconds and a
Gemini-powered receptionist takes it from there — answering from that business's
own services and hours, pulling genuinely open slots, and booking the
appointment. The owner gets a summary and can take over any conversation with
one tap.

But the product is only half of what we set out to prove. The other half is that
**the company itself runs on agents**, and that this is demonstrable rather than
asserted.

### What the AI does

Seven agents operate RingBack. The receptionist is only the seventh.

The **Onboarding agent** fires when Stripe reports a checkout: it provisions the
phone number, reads the customer's website with Gemini, drafts their service
list and FAQ, and emails them a review link. A human never touches a standard
onboarding. The **Support agent** classifies inbound email and answers from a
product knowledge document. The **Watchdog** runs every fifteen minutes, closing
idle threads, flagging conversations that got stuck, and pausing any tenant that
breaches its SMS budget. The **QA agent** re-reads sampled conversations nightly
and scores them one to five against a rubric. The **CFO agent** pulls real
Stripe, Twilio and Gemini numbers every Monday and writes the weekly P&L
narrative. The **Prospector** researches local businesses and drafts outreach.

Every one of those executions is written to an append-only log and rendered on a
public page at `/ops`. Not a screenshot — a live URL, showing each run with its
Gemini transcript, its tool calls, its cost, and its outcome. As of submission
there are **41 logged agent runs with a 100% success rate**, running unattended
since deployment.

### What the humans do

Three things, deliberately.

**Money never moves without a human.** No agent can issue a refund, change a
price, or charge a card. Billing and cancellation emails are drafted by the
support agent and held for approval.

**Cold outreach never sends.** The Prospector researches and writes, but its
output lands in an approval queue. The founder approves, and then sends from his
own inbox. That is a product decision, not a technical limit: a stranger's first
contact from this company should be from a person who stands behind it.

**Quality changes are proposed, not applied.** The QA agent suggests prompt
edits as diffs; a human accepts them.

Each agent's authority is written down in a charter in the repository — what it
may do alone, what needs a click, what it may spend. Building the charter first
and the agents second is the thing I would repeat.

### What we actually achieved, honestly

RingBack reached production on August 16, 2026. It is live on Cloud Run with
Firestore, Cloud Scheduler, Secret Manager and BigQuery, using the Gemini API
for every conversation. It has 74 automated tests and went through three rounds
of adversarial robustness review before launch.

**Revenue is zero, and we report it as zero.** No customer has been charged.

The binding constraint was not the software. US carrier registration for
application-to-person SMS takes multiple weeks — longer than this hackathon
existed. We could have described a live SMS business anyway. Instead we built
the conversation engine to be fully exercisable over the web, so that anyone can
open `/demo`, have a real conversation with the real engine, and watch their own
booking appear in the public agent feed seconds later. What a judge can verify
is exactly what we claim: a working product, an operations layer that genuinely
runs itself, and no customers yet.

Total spend was **two cents** of Gemini API usage, with zero marketing spend and
zero infrastructure cost inside the free tier.

### The jobs this creates

RingBack does not replace a receptionist at the businesses it serves. Our
customers never had one. It recovers revenue that was evaporating — and for a
solo operator, recovered bookings are what fund a second chair or an apprentice.
Booking data that was previously lost to voicemail becomes visible demand.

Beyond the founding team, the model is a service line for the people who already
serve Main Street: bookkeepers, local marketers and IT consultants can resell
RingBack setups, with the onboarding agent doing the technical work while they
own the relationship. And the operating pattern itself — a written agent
charter, logged executions, human gates on money and outreach — is documented
publicly in the repository precisely so the next solo founder can copy it.

### The story of building this way

The whole system was built by directing AI agents and reviewing their work.
That produced a working product in days, and it produced the specific failures
you'd expect: an adversarial review round found that the textback would have
silently never fired on scale-to-zero infrastructure, and that missing database
indexes would have failed every message with a cheerful 200 OK. Both were caught
because a reviewing agent was pointed at the builder's output and told to be
skeptical.

That is the honest lesson. Agents build fast and confidently wrong. The value
was never in generating code — it was in the loop: build, review adversarially,
verify against evidence, and keep a human on anything irreversible. The company
runs on agents. It is accountable to a person.
