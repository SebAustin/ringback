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
