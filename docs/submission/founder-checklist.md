# Founder Action Checklist (things only a human can do)

The code is built and verified. These are the account/payment/identity steps
Claude cannot perform for you, in priority order. Day-1 items unblock
everything else.

## Day 1 — accounts & registrations (≈1.5h, ~$35)

- [ ] **Twilio**: create account → **upgrade off trial immediately** (~$20
      credit). Then, in parallel (both pipelines racing — this is the #1
      schedule risk):
  - [ ] Buy a **toll-free number** and submit toll-free verification
        (use case: "appointment booking / customer care for local businesses")
  - [ ] Submit **A2P 10DLC** sole-proprietor brand + campaign
  - [ ] Enable Advanced Opt-Out on the Messaging Service; set $50 spend alert
- [ ] **Stripe**: activate account (business details) → create Products:
      Starter $49/mo, Pro $99/mo → create a "FOUNDING" coupon ($48 off first
      month) → webhook endpoint (URL from runbook) → copy price IDs + keys
- [ ] **Gemini API key**: aistudio.google.com/apikey (free tier is plenty)
- [ ] **GCP**: confirm billing on the project (free-trial credits OK) → run
      `./infra/setup.sh` → paste all secrets → `./infra/deploy.sh`
- [ ] **Domain** (~$12): buy (e.g. ringback.app style) and map to Cloud Run
- [ ] **SendGrid**: free account, verified sender, API key; inbound parse per
      runbook (support@yourdomain)

## Day 2 — go live

- [ ] Point the toll-free number's voice/SMS webhooks at the deployed app
- [ ] Smoke test with your own phone: call, miss, get texted, book
- [ ] Set your cell as `FOUNDER_PHONE` (watchdog pages you there)
- [ ] Record the smoke test on camera — it's the opening of the demo video

## Daily (30–60 min) — the sales motion you chose

- [ ] Morning: open /ops → review Prospector drafts → approve the good ones →
      they arrive in your inbox → send from your own email
- [ ] Walk into 2–3 local businesses with the live demo (highest conversion)
- [ ] Answer escalations the agents route to you

## Before submission (Aug 10–15)

- [ ] Export Stripe revenue evidence + the CFO agent's P&L report
- [ ] Fill the XPRIZE P&L template (link in the brief) — disclose ALL spend
- [ ] Collect 2–3 customer quotes (with written permission to share contact info)
- [ ] Record the 3-minute video (script: docs/submission/video-script.md)
- [ ] Finalize the narrative (docs/submission/narrative.md — update numbers)
- [ ] Push repo to GitHub; share with testing@devpost.com and judging@hacker.fund
- [ ] Submit on Devpost by **Aug 15** (buffer before the Aug 17, 1pm PT cutoff)
