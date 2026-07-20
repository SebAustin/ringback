# Assumptions Log

Documented assumptions made while building autonomously. Flag any that are
wrong and they'll be corrected.

1. **Working name "RingBack".** Chosen for clarity (missed call → we ring/text
   back). Final branding + domain purchase is a human decision (week 2).
2. **US-first telephony.** Twilio US numbers, TCPA posture, $ pricing —
   matches the chosen "English/global" market with US local businesses as the
   beachhead (largest reachable SMB pool for cold outreach in English).
3. **SMS-first, voice later.** The wedge is missed-call textback (Week-1
   scope). AI-answered voice calls are the Week-3 stretch goal, per plan.
4. **Prices**: Starter $49/mo, Pro $99/mo, founding-customer first month $1 —
   from the approved plan; configured in Stripe by the founder.
5. **Demo tenant is fictional.** "Luxe Cuts Salon" exists to let judges test
   without exposing real customer data; its transcripts are the only ones
   shown unredacted on /ops.
6. **Gemini 2.5 Flash / Pro** model IDs as of mid-2026; swap in `src/lib/gemini.ts`
   if Google renames.
7. **Founder identity**: FOUNDER_EMAIL=henry.sebastien1982@gmail.com (from
   environment); founder role = that email via magic link.
8. **Prospect outreach is founder-sent.** The prospector drafts; approved
   drafts land in the founder's inbox; the founder sends from their own
   account (arms-length, spam-safe, matches the chosen sales motion).
9. **No HIPAA-adjacent customers** in the target list (see compliance.md).
10. **GCP project `learning-183922`** (currently configured in gcloud) is
    assumed usable for deployment; a dedicated project is cleaner if available.
11. **Cloud Scheduler crons in UTC**; "PT" times in the plan are approximate
    (fixed UTC offsets, not DST-adjusted) — acceptable for ops cadence.
12. **Mock modes** (Gemini/Twilio/memory store) exist so judges and CI can run
    everything with zero credentials; production requires real keys
    (enforced by `assertProdConfig`).
