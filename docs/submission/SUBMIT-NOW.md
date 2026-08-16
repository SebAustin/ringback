# Final 30 Hours — submit by Monday Aug 17

**Now:** Sun Aug 16, ~09:00 CDT · **Deadline:** Mon Aug 17, 1:00pm PT = **3:00pm CDT**
**Target submit: Mon 1:00pm CDT** (2h buffer — Devpost crawls at the wire).

## Where you actually stand

| Item | State |
|---|---|
| Product | Built, 3 robustness rounds → APPROVE, 70 tests green |
| Deployed | ❌ Nothing live — **this is today's first job** |
| GitHub repo | ❌ Local only — **required** for submission |
| Revenue / customers | $0 / 0 |
| Twilio A2P 10DLC | ❌ Takes weeks. Not happening. Don't spend an hour on it. |

Two of three judging criteria — **AI-Native Operations** and **Category Impact** —
are still fully winnable and are entirely in your control today. Business Viability
will be thin; report it honestly. **A complete submission beats a perfect one that
misses 3:00pm.**

---

## SUNDAY (today) — ship the submission, sell where you can

### 09:00–11:00 · Get it live (2h) — do this before anything else
1. **Gemini key** (2 min): https://aistudio.google.com/apikey
2. Confirm billing/free-trial on GCP project `learning-183922`
3. ```
   cd ringback
   PROJECT_ID=learning-183922 ./infra/setup.sh          # APIs, Firestore, indexes, secrets, BQ sink
   printf '%s' 'YOUR_GEMINI_KEY' | gcloud secrets versions add GEMINI_API_KEY --data-file=-
   openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add SESSION_SECRET --data-file=-
   ./infra/deploy.sh                                     # note the URL
   APP_BASE_URL=https://<url> ./infra/deploy.sh          # redeploy so links/cookies are right
   APP_URL=https://<url> PROJECT_ID=learning-183922 ./infra/setup.sh   # 5 cron jobs
   ```
   The app boots with **only the Gemini key**; Twilio/Stripe are optional and their
   routes fail closed until configured. Let the Firestore indexes finish building
   before the first deploy.
4. **Verify:** `/demo` books an appointment, `/ops` shows agent runs.

> Deploying now compounds: the watchdog fires every 15 min, so by submission you'll
> have **~100 real agent executions logged**, a QA run overnight, and the **CFO agent
> writes your P&L automatically Monday ~10am CDT** — an hour before you submit.

### 11:00–11:20 · GitHub (required — don't let this slip)
```
cd ringback
gh repo create ringback --private --source=. --remote=origin --push
```
Then add `testing@devpost.com` and `judging@hacker.fund` as collaborators
(Settings → Collaborators), or make the repo public.

### 11:20–12:00 · Stripe (so Monday morning can take money)
Activate the account, then create two **Payment Links** — "$1 founding month" and
"$49/mo Starter". Payment Links need zero code; you can charge someone standing in
front of you tomorrow morning. Full checkout integration is not needed for this.

*(Twilio: optional. If you want the real-phone shot, upgrade ~$20, buy a **toll-free**
number, submit verification, and test an SMS to your own phone. If it's filtered,
shrug and move on — `/demo` is the judge path and always works.)*

### 12:00–16:00 · Video + written assets (the bulk of the submission)
Film in this order so you always have something usable:
1. `/demo` on your phone: missed call → textback → conversation → booking
2. `/ops`: live agent feed, expand a run to show the Gemini transcript and tool calls,
   the approval queue, the CFO report
3. Real phone call **only if** SMS delivered
4. Stripe dashboard if you have a payment

Then fill `docs/submission/devpost-submission.md` (paste-ready) and update
`docs/submission/narrative.md` with real numbers.

**P&L:** expenses ≈ Twilio $[0–20] + GCP $0 (free trial) + Gemini ~$1 + domain $[0–12].
**Marketing spend: $0 — you must state this explicitly even though it's zero.**

### 16:00–19:00 · Sunday selling (what's actually open)
Nail salons, some barbershops, dog groomers and restaurants trade on Sundays. Also
work channels that don't care what day it is: local business Facebook groups,
Nextdoor, r/smallbusiness, and direct DMs to shops whose Google listing shows lots of
"didn't answer" reviews. Offer the $1 founding month with the live `/demo` link.

**Be honest about state.** If SMS isn't live: *"SMS switches on when carrier
registration clears this week — $1 locks founding pricing."* An honest presale is real
revenue. A misrepresented one isn't worth a prize.

### Evening
Have the **entire Devpost draft saved** — every field filled except final numbers.
Upload the video to YouTube (public/unlisted) tonight so Monday is only numbers.

---

## MONDAY — best remaining sales window, then submit

- **08:00–11:00** Businesses are open: call/visit your best 10 prospects with the live
  demo. This is your last and best revenue hour-block. Log every customer:
  name, business, email, phone, amount paid.
- **11:00** CFO agent's weekly P&L has run — use its output
- **11:30** Final `/ops` + Stripe screenshots; update the numbers in the Devpost draft
- **13:00 SUBMIT** — do not push past this

---

## Pre-submit checklist

- [ ] ≥1 Google Cloud product → Cloud Run, Firestore, Scheduler, Secret Manager, BigQuery ✅
- [ ] Gemini API for ≥1 LLM call in the **deployed** app ✅ (once the key is set)
- [ ] Repo shared with `testing@devpost.com` + `judging@hacker.fund`
- [ ] Public 3-min video, no copyrighted music/trademarks
- [ ] Narrative 500–1000 words
- [ ] Revenue by month (May/Jun/Jul/Aug 2026 — yours is Aug only, or $0)
- [ ] Total expenses **and** marketing spend (state the $0)
- [ ] Related-party revenue reported separately
- [ ] Judge-testable links needing no credentials → `/demo`, `/ops`
- [ ] Category: **Small Business Services**

## Minimum viable submission (if the day goes sideways)
Deployed URL + `/demo` + `/ops` + GitHub repo + 3-min video + narrative + an honest
P&L with zeros. That is a **complete, valid entry** and scores on two of three
criteria. Missing pieces cost points; missing 3:00pm costs everything.
