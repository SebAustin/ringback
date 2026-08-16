# Shot list — film this, in this order

**Live URL:** https://ringback-app-hmyecsfq3q-uc.a.run.app
Demo: `/demo` · Ops console: `/ops` · Repo: https://github.com/SebAustin/ringback

Total target: **under 3:00**. Judges aren't required to watch past it.
Film shots 1–3 first — those alone are a valid submission video.

---

## SHOT 1 · The product (0:00–1:10) — phone screen recording

Open `/demo` **on your phone** and screen-record. The page opens as
"You missed a call from Luxe Cuts Salon."

Type **exactly these two messages** — both verified against production today,
they book on the first try:

1. `Hi, do you have anything open this week for a men's cut?`
   → AI replies with real slots + "A men's cut is 30 minutes for $35."
2. `Tuesday at 10 works. My name is Alex`
   → AI confirms the booking and a confirmation ticket appears

**Say over it (keep it this tight):**
> "A customer calls a salon. Nobody picks up. Five seconds later they get this
> text — and it's not a canned auto-reply. It reads their question, pulls the
> salon's real open slots, and books the appointment. The owner never touched
> their phone."

**Point out the $35** — that price came from the salon's own configuration.
The AI is blocked in code from inventing a price it wasn't given.

> ⚠️ Each take books a real slot. Vary the time ("Tuesday at 11", "Wednesday at
> 2") between takes so you don't hit "that slot is no longer open."

## SHOT 2 · The company runs on agents (1:10–2:15) — screen recording of `/ops`

This is the differentiator. Slow-scroll the live feed.

- **KPI tiles** — currently: 6 agent runs · 1 active tenant · 3 conversations ·
  1 booking · 100% AI resolution rate
- **Live agent feed** — point at the entries: the receptionist run you *just*
  created, and the watchdog runs firing every 15 minutes on Cloud Scheduler
- **Expand a receptionist run** — show the Gemini transcript and the tool calls
  (`get_availability`, `book_appointment`)
- **Approval queue** — say the line that matters:

> "The prospector agent researches businesses and drafts outreach, but it
> cannot send. Money and cold outreach always stop at a human. That's written
> into the agent charter in the repo."

- **CFO panel** — "our weekly P&L is written by an agent from real Stripe,
  Twilio and Gemini numbers. The P&L in this submission is its output."

## SHOT 3 · Close (2:15–2:45)

- Show `github.com/SebAustin/ringback` (public, MIT)
- Numbers slide: agent runs, conversations, bookings, spend under $100

> "One founder, seven AI agents, running on Cloud Run, Firestore and Gemini.
> RingBack — we text back."

## SHOT 4 · Only if you have them

- Stripe dashboard showing a real payment
- A customer quote card
- A real phone call, if SMS is live

---

## Production notes
- Record at the production URL — **no localhost in frame**
- No copyrighted music. System UI only.
- Upload to YouTube **public or unlisted** and paste the link into Devpost
- Keep the raw take of the booking — judges may ask for a live demo
- If a take fumbles, `/demo` refresh starts a clean conversation instantly

## Before you hit record
Open both tabs and let them load once (Cloud Run scales to zero — the first
request after idle takes a few seconds; you don't want that pause on camera).
