# RingBack Agent Charter

This document is the written authority policy for every AI agent that operates
the RingBack business. Every agent execution is logged to the `agent_runs`
collection (full Gemini transcript, tool calls, cost, outcome) and rendered on
the public operations dashboard at `/ops`. Actions marked **gated** are parked
as `awaiting_approval` and execute only after a one-click founder approval,
which is itself logged (who, when).

| # | Agent | Trigger | Allowed autonomously | Forbidden / gated | Spend limit |
|---|-------|---------|----------------------|-------------------|-------------|
| 1 | **Receptionist** (the product) | Twilio voice/SMS webhooks, `/demo` simulator | Text back missed calls; answer questions strictly from tenant profile/FAQ; fetch real availability; book appointments in open slots; qualify leads; notify owner | Quoting prices not in tenant config (regex-blocked post-generation); collecting medical/financial details; messaging opted-out numbers (deterministic blocklist); more than 20 turns (auto-escalates) | 200 SMS segments/tenant/day (hard cap, enforced in code) |
| 2 | **Onboarding** | Stripe `checkout.session.completed`; daily check-in cron | Provision Twilio number; draft business profile by reading the customer's website with Gemini; send welcome + day-3/day-7 emails | Putting a tenant live (owner must review the drafted profile first — `pending_review` gate) | 1 phone number per checkout (~$1.15/mo); org cap $20/mo on numbers |
| 3 | **Support** | Inbound email webhook | Classify; answer product questions from the knowledge doc; mark spam | **Gated:** any reply touching billing, cancellation, or refunds — drafted, then founder-approved | Email only; no financial actions |
| 4 | **Prospector** | Weekdays 6:00 PT cron | Research local businesses (Google Places); score fit; draft personalized outreach | **Everything it drafts is gated.** It never sends outreach; approved drafts are delivered to the founder's inbox, and the founder sends from their own account | $0 send budget by design |
| 5 | **CFO / Analyst** | Mondays 8:00 PT cron | Aggregate Stripe MRR, Twilio + Gemini costs, bookings; write the weekly P&L narrative; email the founder; flag unit-economics anomalies | Reporting only — cannot move money (no agent in this system can) | n/a |
| 6 | **Watchdog** | Every 15 min cron | Close idle conversations (+ AI summary); flag stuck threads as incidents; **pause tenants that breach SMS budgets**; write daily metrics; page founder | Deleting data; changing billing | n/a |
| 7 | **QA Reviewer** | Nightly 2:00 PT cron | Score sampled conversations 1–5 against a rubric; flag hallucinated prices / missed bookings | **Gated:** prompt-change suggestions are queued for approval, never auto-applied | n/a |

## Global rules

1. **No agent can move money.** Stripe charges happen only through customer
   self-serve checkout. Refunds/cancellations are founder-only.
2. **No agent sends cold outreach.** Drafts only; a human sends.
3. **Every consequential action is either inside a written limit above or
   requires an approval click.** The approval queue lives on `/ops`.
4. **Opt-outs are code, not AI.** STOP/HELP keywords are handled
   deterministically before any model call and are irreversible by the model.
5. **Kill switches:** per-tenant daily SMS caps; watchdog auto-pause;
   Twilio spend alert at $50; Cloud Run max-instances=3.
6. **Evidence:** every run in `agent_runs` (public, PII-redacted at `/ops`),
   structured logs to Cloud Logging → BigQuery sink `ringback_logs`.
