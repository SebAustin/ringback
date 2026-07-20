# 3-Minute Demo Video Script

Goal per rules: "demonstrates the extent to which AI is live in production and
executes key decisions." Shoot horizontally; real phone in frame for the
money shot.

## 0:00–0:20 — Cold open (the problem, live)
- Handheld shot: dial the demo salon's number from a second phone. Let it ring.
- VO: "Small businesses miss up to half their calls. Watch what happens when
  this one does."
- Call rings out → cut the moment the phone buzzes with the textback.
- On-screen caption: "4.8 seconds later" (use the real measured latency from
  /ops).

## 0:20–1:10 — The product (screen-record the phone)
- Thumb-through of the real SMS thread: ask "how much is a men's cut?",
  "anything Thursday?", get slots, reply with a name → booking confirmation.
- Cut to the owner's phone receiving the booking summary SMS.
- Cut to the dashboard conversation view: same thread, "Take over" button
  hover: "the owner can silence the AI in one tap."
- VO: prices come only from the business's own config; the booking was a
  Gemini function call against real open slots — the model can't invent
  either.

## 1:10–2:15 — The company runs on agents (screen-record /ops)
- Open /ops. Slow scroll of the live agent feed.
- Point at each: "This is our onboarding agent provisioning a customer's
  phone number after a Stripe checkout — no human touched it. This is
  support answering a product question. This is the watchdog pausing a tenant
  that hit its SMS budget."
- Expand one receptionist run: show the Gemini transcript + tool calls.
- Show the approval queue: "The prospector drafted today's outreach. It can't
  send — I approve, and I send. Money and outreach always have a human gate."
- Show the CFO report panel: "Our weekly P&L is written by an agent from real
  Stripe and Twilio numbers. The P&L in this submission is its output."
- Flash the counters: N agent runs · N autonomous actions · N approvals.

## 2:15–2:45 — Real business
- Stripe dashboard (test-data blurred appropriately): paying subscriptions.
- One customer clip or quote card (with permission): what changed for them.
- Numbers slide: tenants, conversations, bookings, spend under $100.

## 2:45–3:00 — Close
- "One founder. Seven agents. Real bookings for real businesses, on Google
  Cloud and Gemini. RingBack — we text back."
- URL + XPRIZE category card: Small Business Services.

## Production notes
- Record everything at production URLs (no localhost in frame).
- No third-party music/trademarks; system UI only.
- Keep raw takes of the missed-call moment — judges may ask for a live demo.
