# Weekend Triage — Submit by Monday Aug 17

**Now:** Sat Aug 15, ~07:30 CDT · **Deadline:** Mon Aug 17, 1:00pm PT = **3:00pm CDT**
**Target submit time: Mon 1:00pm CDT** (2-hour buffer — Devpost gets slow at the wire).

## The honest situation

| Item | State |
|---|---|
| Product | Built, reviewed (3 robustness rounds → APPROVE), 68 tests green |
| Deployed | ❌ Nothing live |
| GitHub repo | ❌ Local only — **required** for submission |
| Revenue / customers | ❌ $0 / 0 |
| Twilio A2P 10DLC | ❌ Impossible — takes weeks. **Do not wait on it.** |

**Two of the three judging criteria are still fully winnable** (AI-Native Operations,
Category Impact). Business Viability will be thin — get whatever is *honestly* real,
report it accurately, and don't inflate it. A complete submission with a live,
judge-testable product beats a perfect one submitted at 3:01pm.

---

## SATURDAY — deploy fast, then sell in person

Saturday is the **only** in-person selling day (salons and barbers are open and
staffed today; most are closed Sunday). Be out the door by 11am.

### 07:30–09:30 · Get it live (2h)
1. **Gemini key** (2 min): https://aistudio.google.com/apikey
2. **GCP**: confirm billing/free-trial on project `learning-183922`
3. Run setup, paste secrets, deploy:
   ```
   cd ringback
   PROJECT_ID=learning-183922 ./infra/setup.sh
   printf '%s' 'YOUR_GEMINI_KEY' | gcloud secrets versions add GEMINI_API_KEY --data-file=-
   openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add SESSION_SECRET --data-file=-
   ./infra/deploy.sh
   # note the URL, then redeploy with it so links/cookies are right:
   APP_BASE_URL=https://<your-url> ./infra/deploy.sh
   APP_URL=https://<your-url> PROJECT_ID=learning-183922 ./infra/setup.sh   # creates the 5 cron jobs
   ```
   **The app now boots with only the Gemini key** — Twilio/Stripe are optional and
   their routes fail closed until configured. Wait for Firestore indexes to finish
   building before the first deploy (setup.sh creates them; they take a few minutes).
4. **Verify:** open `/demo` (book an appointment) and `/ops` (agent runs appearing).

> Deploying this morning compounds: the watchdog runs every 15 min, so by Monday
> you'll have ~200 real agent executions logged, QA runs both nights, and the
> **CFO agent generates your P&L automatically Monday 10am CDT** — right before you submit.

### 09:30–10:00 · GitHub (required — don't skip)
```
cd ringback
gh repo create ringback --private --source=. --remote=origin --push
```
Then add both judges as collaborators (Settings → Collaborators), or make it public:
`testing@devpost.com` and `judging@hacker.fund`.

### 10:00–10:45 · Money + phone
- **Stripe**: activate, then create a **Payment Link** for "$1 founding month" and one
  for "$49/mo Starter". A Payment Link needs zero code — you can charge a customer
  standing in front of you today. (Full checkout integration can wait.)
- **Twilio**: upgrade off trial (~$20) → buy a **toll-free** number (NOT a local
  10DLC one) → submit toll-free verification → **immediately test an SMS to your own
  phone.** You'll know within 30 minutes whether the phone flow is filmable.
  - Works → your video's money shot is a real phone ringing.
  - Blocked → fine, `/demo` is the judge path. Move on, don't debug carriers today.

### 10:45–17:00 · Sell (the highest-value hours of the weekend)
Walk into salons, barbers, nail salons, dog groomers. The pitch is 30 seconds:

> "Can I show you something on your phone? … That's what happens when you miss a
> call — the caller gets texted back and books themselves in. First month is $1."

**Be honest about state.** If SMS isn't live yet, say so: *"SMS switches on this week
when the carrier registration clears — the $1 locks founding pricing."* An honest
presale is real revenue; a misrepresented one isn't worth a prize.

Target: 2–5 paying customers. Even $1 each is **real arms-length revenue** and gives
you named customers with contact details for the customer-evidence section.
Log every one: name, business, email, phone, what they paid, what you promised.

### Evening
- Screenshot `/ops`, the Stripe payments list, Cloud Run metrics.
- Leave the service running — the crons keep generating evidence overnight.

---

## SUNDAY — make the submission

### Morning: the 3-minute video (script: `docs/submission/video-script.md`)
Film in this order so you always have *something* usable:
1. `/demo` on your phone — miss-call → textback → conversation → booking (works regardless of carriers)
2. `/ops` — live agent feed, expand a run to show the Gemini transcript + tool calls,
   show the approval queue, show the CFO report
3. Real phone call, **only if** SMS delivered on Saturday
4. Stripe dashboard + a customer quote if you got one

### Afternoon: written assets
- `docs/submission/devpost-submission.md` — **paste-ready**, fill the `[N]` placeholders
- `docs/submission/narrative.md` — update numbers, keep the humans-vs-AI section
- **P&L**: use the XPRIZE template; expenses ≈ Twilio $20 + domain $12 + GCP $0 (free trial)
  + Gemini ~$1 = **~$35 total, $0 marketing spend** (disclose the zero explicitly — it's required)
- Customer evidence: names/emails/phones + permission to share. Report any friends/family
  revenue **separately** as related-party — the rules require it and judges check.

---

## MONDAY — submit early

- 08:00 Final `/ops` screenshots, final Stripe export
- 10:00 CFO agent auto-generates the weekly P&L — use its output
- 11:00 Fill remaining Devpost fields, re-check the repo is shared with both judge emails
- **13:00 SUBMIT** (2h buffer)

---

## Rules-compliance checklist (verify before submitting)

- [ ] Uses ≥1 Google Cloud product → Cloud Run, Firestore, Scheduler, Secret Manager, BigQuery ✅
- [ ] Gemini API for ≥1 LLM call in the **deployed** app → yes, once the key is set ✅
- [ ] Repo shared with `testing@devpost.com` + `judging@hacker.fund`
- [ ] Public 3-min video on YouTube/Vimeo, no copyrighted music
- [ ] Written narrative 500–1000 words
- [ ] Revenue by month (May/Jun/Jul/Aug 2026) — yours is Aug only
- [ ] Total expenses **and** marketing spend disclosed (even if $0)
- [ ] Related-party revenue reported separately
- [ ] Judge-testable link that needs no credentials → `/demo` and `/ops`
- [ ] Category selected: **Small Business Services**

## If you fall behind — the minimum viable submission
Deployed URL + `/demo` + `/ops` + GitHub repo + 3-min video + narrative + a P&L
showing honest zeros. That is a **complete, valid entry**. Missing pieces cost points;
missing the deadline costs everything.
