# Acceptance — RingBack (Week-1 build)

**Date:** 2026-07-20 · **Verifier verdict:** SOLID (solution-rubric 100/100)

## What was accepted

The Week-1 MVP scope from [PLAN.md](PLAN.md), built and independently verified:

| Success criterion | Status | Evidence |
|---|---|---|
| Missed call → textback → AI SMS conversation → booking | ✅ | Live E2E via `/webhooks/twilio/*` + `npm run simulate`; watchdog metrics report "1 conversations, 1 bookings" |
| Judge path: `/demo` web simulator books through the real pipeline | ✅ | Browser-verified booking with confirmation ticket; API E2E by verifier |
| Guardrails: deterministic STOP/HELP, opt-out blocklist, turn cap, price-invention block, webhook idempotency | ✅ | 55/55 vitest tests incl. dedicated guardrail suite; runtime STOP replay produced zero outbound |
| 7 AI agents with logged `agent_runs` + human-approval gates | ✅ | Watchdog/CFO/QA/Prospector cron runs executed; approval queue populated; `/ops` live feed renders runs with masked PII |
| Public `/ops` evidence dashboard, PII-redacted | ✅ | Verifier scanned responses: zero raw phones/emails |
| Auth boundaries (magic-link, founder gating, OIDC cron guard) | ✅ | 401/403 paths verified; scheduler SA exact-match; single-use magic links |
| Production build + container + infra scripts | ✅ | `npm run build` green; Dockerfile (non-root); `infra/setup.sh` + `deploy.sh` ready |
| Security: no open CRITICAL/HIGH findings | ✅ | STRIDE audit in [SECURITY.md](SECURITY.md); both HIGHs fixed and runtime-confirmed |

## Known deferrals (accepted, non-blocking)

- 9 moderate npm-audit advisories (dep upgrades) — SECURITY.md #7.
- OIDC `email_verified` assertion + DNS-rebinding-proof SSRF check — residual
  MEDIUM/LOW hardening, queued for the next security pass.
- AI-answered voice calls + Google Calendar sync — Week-3 stretch scope by plan.
- HSTS relies on Cloud Run ingress in production.

## Not yet done (requires the founder — see docs/submission/founder-checklist.md)

Deployment to Cloud Run (needs billing + pasted secrets), Twilio account
upgrade + A2P/toll-free registration, Stripe activation, domain, SendGrid —
and, above all, **selling**: the 4-week clock to Aug 17 is now a
customer-acquisition clock, not an engineering one.

---

## Addendum — robustness review cycle (2026-08-07)

A dedicated senior-engineer robustness review (new `robustness-reviewer` role)
ran three rounds against the SOLID-verified build:

- **Round 1 (REWORK):** 4 CRITICAL + 13 HIGH — headline items: textback ran
  post-response on CPU-throttled scale-to-zero Cloud Run (could silently never
  send); no Firestore composite indexes existed (first production SMS would
  fail invisibly); Stripe onboarding failure dropped paid customers silently;
  `void`-ed promise could crash the instance. All fixed in `c0574a6`.
- **Round 2 (REWORK):** the fix round itself introduced 3 regressions the
  reviewer proved: takeover messages invisible (missing `seq`), permanent slot
  poisoning from unreleased locks, webhook-budget overrun + SMS double-text on
  timeout-retry. All fixed in `b8e95d9`, with `Message.seq` made required so
  the compiler blocks recurrence.
- **Round 3: APPROVE.** Independent re-trace confirmed every fix; gate
  reproduced (tsc clean, 68/68 tests, build green).

Backlog (LOW, non-blocking, from the reviewer): tolerated lock self-heal race
(documented in tools.ts), remaining-budget-aware owner-alert timeout, M3 DST
day-stepping + booking lead-time buffer in `computeAvailability` (schedule
first — loses a day of availability twice a year), M8 transcript
subcollection, lib-layer logging via Fastify logger.
