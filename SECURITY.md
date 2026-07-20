# RingBack Security Audit & Threat Model

Scope: `src/`, `infra/`, `Dockerfile`, `test/`. Excludes `web/` (built separately) and `node_modules/`.
Method: STRIDE threat model + manual code review + `npm audit --omit=dev`.
Nature: **read-only audit** — no source files were modified. Every "Fix" below is a recommendation for the team to apply.

---

## 1. System decomposition

### Trust boundaries
- **Public internet → Fastify (Cloud Run, `--allow-unauthenticated`)**: the platform accepts *all* traffic; every access-control decision is made in application code.
- **Untrusted webhook senders → webhook routes**: Twilio (voice/SMS), Stripe (billing), SendGrid (inbound email), Cloud Scheduler (cron agents).
- **Untrusted callers → LLM**: caller SMS bodies and demo text flow into Gemini as `user` content (prompt-injection surface).
- **Owner/founder browser → session-cookie API** (`/api/*`).
- **App → external APIs**: Gemini, Twilio, Stripe, SendGrid, Google Places, arbitrary tenant websites (onboarding fetch), Firestore.

### Entry points
- `POST /webhooks/twilio/{voice,voice/status,sms,sms/status}` — Twilio-signature gated (fail-closed in prod).
- `POST /webhooks/stripe` — Stripe-signature gated (raw body).
- `POST /webhooks/inbound-email` — shared-secret query-param gated.
- `POST /agents/{watchdog,cfo,qa,prospector,onboarding}` — OIDC/founder gated.
- `POST /api/agents/approve/:runId`, `GET /api/prospects` — founder-role gated.
- `/api/auth/*`, `/api/tenant`, `/api/conversations/*`, `/api/appointments`, `/api/checkout`, `/api/billing/portal` — session gated.
- `GET /api/ops/*`, `POST /api/demo/*` — **public, unauthenticated by design**.

### Data stores & sensitive data
- Firestore: tenants (owner email/phone, Twilio number, Stripe IDs), per-tenant conversations & messages (caller phone numbers + SMS bodies = PII), appointments (caller name/phone), prospects, support tickets (customer emails + bodies), `agent_runs` (transcripts), `optouts`, `sms_out`, `payments`.
- Secrets: Gemini/Twilio/Stripe/SendGrid keys, `SESSION_SECRET` (also the derivation root for the inbound-email key and the dev bypass key).

---

## 2. Findings

| # | Severity | Title | Location |
|---|----------|-------|----------|
| 1 | HIGH | Cron-agent OIDC check trusts *any* Google service account | `src/routes/agents.ts:30` |
| 2 | HIGH | Customer PII (support emails/addresses/bodies) exposed on public `/api/ops/*` feed | `src/routes/ops.ts:17-40`; `src/agents/support.ts:84,93` |
| 3 | MEDIUM | Secrets in URL query strings are written to request logs → BigQuery sink | `src/routes/api.ts:103,109`; `src/routes/agents.ts:81`; `src/server.ts:24` |
| 4 | MEDIUM | SSRF via onboarding website fetch (no allowlist / private-IP block) | `src/agents/onboarding.ts:19-39` |
| 5 | MEDIUM | Unauthenticated, expensive `/api/ops/summary` → Firestore read amplification / cost DoS | `src/routes/ops.ts:44-94` |
| 6 | MEDIUM | Demo pipeline has no Gemini spend cap (web_sim skips daily budget) | `src/routes/ops.ts:185`; `src/receptionist/conversation.ts:256` |
| 7 | MEDIUM | `@fastify/static` moderate advisories + 9 moderate npm-audit findings | `package.json`; `npm audit` |
| 8 | MEDIUM | No HTTP security headers (CSP/HSTS/X-Frame-Options/nosniff/Referrer-Policy) | `src/server.ts` |
| 9 | MEDIUM | Inbound-email webhook: no rate limit, static shared key, spoofable `from`, auto-replies | `src/routes/agents.ts:79-91`; `src/agents/support.ts:96-105` |
| 10 | MEDIUM | Magic-link tokens are multi-use within TTL (no single-use/jti) and reused in nudge emails | `src/lib/auth.ts:52-59`; `src/agents/onboarding.ts:134,160,164` |
| 11 | LOW | Prompt-injected caller can spam owner alerts / fill availability with fake bookings | `src/receptionist/tools.ts:120-188` |
| 12 | LOW | `GEMINI_MOCK=1` is honored in production (silent LLM disable) | `src/config.ts:51` |
| 13 | LOW | Founder is god-mode via email possession only; sessions non-revocable for 7 days | `src/routes/api.ts:115`; `src/lib/auth.ts:45-50` |
| 14 | LOW | No explicit CSRF token on state-changing endpoints (mitigated by SameSite=lax) | `src/routes/api.ts:126-133` |
| 15 | LOW | `.env.example` ships a `dev-secret` `SESSION_SECRET` placeholder + real founder email | `.env.example` |

---

## 3. Detailed findings

### [HIGH-1] Cron-agent OIDC check trusts any Google service account
`src/routes/agents.ts:19-37`. The invoker guard verifies the OIDC token is Google-signed with `audience = APP_BASE_URL`, then authorizes on `email.endsWith('.gserviceaccount.com')`. Any Google Cloud customer can mint an identity token for *their own* service account with an arbitrary audience (`gcloud auth print-identity-token --audiences=<target APP_BASE_URL>`); that token's email ends in `.gserviceaccount.com` and passes. Because Cloud Run is deployed `--allow-unauthenticated` (`infra/deploy.sh:27`), the platform-level `run.invoker` binding created in `infra/setup.sh:71-73` is bypassed, so this app check is the only gate. An attacker can invoke `watchdog`, `cfo`, `qa`, `prospector`, `onboarding` on demand → Gemini/Places cost burn, spurious agent runs, forced outbound drafts.

**STRIDE**: Elevation of Privilege, Denial of Service.
**Fix**: Pin the exact caller identity. The expected SA is already known: `scheduler-invoker@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com`. Replace the check with an equality comparison and confirm `payload.email_verified === true`:
```ts
const expected = `scheduler-invoker@${cfg.GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com`;
return ticket.getPayload()?.email === expected;
```
Ideally also split the cron agents onto a Cloud Run service that is *not* `--allow-unauthenticated` and rely on IAM.

### [HIGH-2] Customer PII exposed on public ops feed
`/api/ops/runs`, `/api/ops/queue`, `/api/ops/summary` are unauthenticated. `redactRun`/`redactText` (`src/routes/ops.ts:17-40`) only mask *phone-shaped* strings. Email addresses, caller/customer names, and free-text bodies pass through untouched. The support agent writes the sender's email and subject into `publicSummary` (`src/agents/support.ts:84,93` → e.g. "classified email from bob@acme.com as spam") and into transcript `prompt`/`response` (agent is not `receptionist`, so it is *not* body-redacted). Result: real customers' email addresses and support-message content are published on a public endpoint. Onboarding/prospector transcripts similarly expose business emails and scraped website text.

**STRIDE**: Information Disclosure.
**Fix**: Require founder auth on `/api/ops/*`, OR (to keep the public demo) restrict the public feed to `demo`-tenant runs only, redact email addresses in `redactText`, and never expose transcript bodies for the `support`/`onboarding`/`prospector` agents (whitelist agent+field rather than blacklist patterns).

### [MEDIUM-3] Secrets in URL query strings reach the logs
Fastify's default request logging (`src/server.ts:20-30`, structured JSON → Cloud Logging → BigQuery per `infra/setup.sh:41-46`) records `req.url` including the query string. Two secrets travel in query strings: the magic-link token (`/api/auth/callback?token=...`, sent in emails at `src/routes/api.ts:103` and `src/agents/onboarding.ts:140,164`) and the SendGrid inbound key (`?key=...`, `src/routes/agents.ts:81`). Anyone with log/BigQuery read access can replay a magic token (15-min window, multi-use — see MEDIUM-10) or forge inbound-email calls.

**STRIDE**: Information Disclosure, Spoofing.
**Fix**: Move the magic token to a POST body or one-time exchange; move the inbound key to a header or use SendGrid's signed-event verification; add a Fastify log serializer that strips `token`/`key` query params.

### [MEDIUM-4] SSRF in onboarding website fetch
`fetchWebsiteText` (`src/agents/onboarding.ts:19-39`) fetches an attacker-influenced URL (`info.website`, originally from the public `/api/checkout` `website` field) with no scheme allowlist, no DNS/IP filtering, and follows redirects. Cloud Run's metadata endpoint requires a `Metadata-Flavor` header (so SA-token theft is blocked), but internal-service probing, private-range access, and redirect-based SSRF remain. Reachability requires a completed Stripe checkout, which raises the bar (payment + audit trail).

**STRIDE**: Information Disclosure, DoS.
**Fix**: Resolve the host and reject private/link-local/loopback ranges, allow only `http(s)`, cap redirects and response size, and set a short timeout (already 6s). Consider an egress allowlist.

### [MEDIUM-5] Unauthenticated expensive endpoint (`/api/ops/summary`)
`src/routes/ops.ts:44-94` runs one `metrics_daily` query, one `tenants` scan, a 1000-row `agent_runs` scan, then a per-tenant conversations sub-query in a loop. It is public and only bounded by the global 300/min limit. Repeated hits multiply Firestore reads → cost amplification and latency DoS.

**STRIDE**: Denial of Service.
**Fix**: Cache the summary (e.g., 60s), tighten the per-route rate limit, and precompute KPIs in the watchdog rather than fanning out per request.

### [MEDIUM-6] Demo pipeline has no LLM spend cap
`isOverDailyBudget` is only consulted for `channel === 'sms'` (`src/receptionist/conversation.ts:256`); `web_sim` (demo) skips it. `/api/demo/message` (`src/routes/ops.ts:185`) triggers a real Gemini `flash` loop (up to `MAX_TOOL_ITERATIONS = 4` calls) and is bounded only by a per-IP 15/min rate limit. IP rotation (or the shared 300/min global) enables unbounded Gemini cost against the demo tenant.

**STRIDE**: Denial of Service (cost).
**Fix**: Apply a global daily Gemini spend/turn counter for the demo tenant and short-circuit when exceeded; consider a lightweight challenge on `/api/demo/start`.

### [MEDIUM-7] Dependency vulnerabilities (`npm audit --omit=dev`)
9 moderate advisories. Most relevant: **`@fastify/static` 8.1.1** is affected by GHSA-pr96-94w5-mx2h (path traversal in directory listing) and GHSA-x428-ghpx-8j92 (route-guard bypass via encoded path separators) — directly relevant since the app serves the SPA and routes `/api|/webhooks|/agents` around it (`src/server.ts:50-58`). The rest are transitive under `firebase-admin` (`google-gax`, `gaxios`→`uuid`, `retry-request`/`teeny-request`, `@google-cloud/{firestore,storage}`).
**Fix**: Upgrade `@fastify/static` to ^10 and `firebase-admin` to ^14 (both semver-major — test after). Re-run `npm audit --omit=dev` in CI (`infra/cloudbuild.yaml`) and fail the build on high/critical.

### [MEDIUM-8] Missing HTTP security headers
No `@fastify/helmet` or manual headers. Per the project's own `web/security.md`, production should send CSP (nonce-based), HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, and `Permissions-Policy`. Absent, the SPA is exposed to clickjacking and MIME-sniffing, and there is no CSP defense-in-depth for XSS.
**Fix**: Register `@fastify/helmet` with a tuned CSP; add HSTS at the Cloud Run/ingress layer.

### [MEDIUM-9] Inbound-email webhook abuse
`POST /webhooks/inbound-email` (`src/routes/agents.ts:79-91`) has no rate limit, authenticates with a static key derived from `SESSION_SECRET`, and the `from` field is fully attacker-controlled (SMTP spoofing). On non-billing classifications the support agent auto-sends a reply to `from` (`src/agents/support.ts:96-105`). Anyone who obtains the key (see MEDIUM-3 log exposure) can drive Gemini cost and emit RingBack-branded emails to arbitrary victims (reflection/spam).
**Fix**: Verify SendGrid's Inbound-Parse signature instead of a shared key, add a per-route rate limit, and never auto-send to an unverified `from`.

### [MEDIUM-10] Magic-link tokens are replayable within TTL
`createMagicToken` (`src/lib/auth.ts:52-59`) has no `jti`/nonce and is not invalidated on use, so a captured token works repeatedly for 15 minutes. The same construction is emailed in onboarding welcome and day-3 nudge messages (`src/agents/onboarding.ts:140,164`). Combined with query-string logging (MEDIUM-3), a leaked token is directly replayable to mint a session.
**Fix**: Make magic tokens single-use (store a `jti`, mark consumed on callback), keep them out of query strings, and rotate the session on login.

### [LOW-11] Prompt-injection → owner spam / booking flooding
Server-side booking validation is **correct**: `book_appointment` re-fetches availability and rejects any slot not genuinely open or in the past (`src/receptionist/tools.ts:127-137`), and past-slot/empty-name are rejected — so the model cannot be injected into booking arbitrary times or cross-tenant data (tool context is tenant-scoped). Residual abuse: a caller can, within the 20-turn cap, trigger repeated `escalate_to_owner`/`book_appointment` owner SMS and create multiple fake confirmed appointments, occupying real availability. Owner alerts count toward the tenant daily-SMS budget, which caps volume, but there is no per-caller booking limit.
**Fix**: Cap confirmed bookings per caller/conversation; require an explicit confirmation step; de-duplicate identical bookings.

### [LOW-12] `GEMINI_MOCK` honored in production
`geminiMock = cfg.GEMINI_MOCK === '1' || (!cfg.GEMINI_API_KEY && !isProd)` (`src/config.ts:51`). A stray `GEMINI_MOCK=1` in a prod deployment silently serves canned replies. Not a signature bypass, but a correctness/trust hazard. (Note: `twilioMock` and `geminiMock` cannot silently disable webhook signature verification in prod because `assertProdConfig()` — called in `main()`, `src/server.ts:64` — hard-fails on missing Twilio/Gemini/Stripe creds and on a `dev-secret` `SESSION_SECRET`. This is correct.)
**Fix**: Ignore `GEMINI_MOCK` when `isProd`.

### [LOW-13] Founder god-mode & non-revocable sessions
Founder role is granted purely by controlling `FOUNDER_EMAIL`'s inbox (`src/routes/api.ts:115`); there is no second factor. Session tokens are stateless HMAC with a 7-day TTL and no server-side revocation — logout only clears the client cookie (`src/routes/api.ts:136-139`), so a captured cookie remains valid until expiry.
**Fix**: Consider a founder allowlist + optional TOTP; add a session-version/`jti` denylist to support real revocation and `SESSION_SECRET` rotation.

### [LOW-14] No explicit CSRF token
State-changing session endpoints rely on `SameSite=lax` (`src/routes/api.ts:129`), which blocks cross-site POST and is adequate for the current surface, but there is no anti-CSRF token as defense-in-depth.
**Fix**: Keep `SameSite=lax`; add a double-submit CSRF token for the dashboard mutations if the cookie policy ever loosens.

### [LOW-15] `.env.example` hygiene
Ships `SESSION_SECRET=dev-secret-...` (guarded against in prod by `assertProdConfig`) and the founder's real personal email. Low risk; ensure the production `SESSION_SECRET` is a fresh `openssl rand -hex 32` in Secret Manager and treat the founder email as public.

---

## 4. What was verified as CORRECT (no action needed)

- **Stripe webhook authenticity**: raw-body preserved via a scoped content-type parser and verified with `constructEvent` against `STRIPE_WEBHOOK_SECRET`; invalid signatures → 400; event idempotency via `createIfAbsent('events', 'stripe_<id>')`. (`src/routes/stripe.ts`, `src/lib/stripe.ts:19-21`)
- **Twilio webhook authenticity**: every Twilio route calls `verified()` first and returns 403 on failure; `validateTwilioSignature` fails closed (returns `false` when the signature header is missing) and only bypasses in mock mode, which prod cannot enter (creds enforced by `assertProdConfig`). URL is reconstructed from `APP_BASE_URL + req.raw.url` with `trustProxy`. (`src/routes/twilio.ts:22-25`, `src/lib/twilio.ts:66-75`)
- **Production cannot silently run with verification disabled**: `assertProdConfig()` hard-fails on missing Twilio/Gemini/Stripe secrets and on a `dev-secret` `SESSION_SECRET`. (`src/config.ts:56-74`, `src/server.ts:64`)
- **Token construction/verification**: HMAC-SHA256, length-check + `timingSafeEqual` constant-time compare, expiry enforced, and clean `kind` separation prevents magic↔session confusion. (`src/lib/auth.ts:28-71`)
- **Tenant isolation**: `tenantId` is derived from the session (owner's `ownerEmail` lookup at login), never from request input; all reads/writes are scoped to `tenants/{tenantId}/...` subcollections; conversation/appointment lookups are tenant-scoped — no IDOR path for an owner to read another tenant. (`src/routes/api.ts:28-45`)
- **Founder gating**: `/api/agents/approve/:runId` and `/api/prospects` require `isFounder`. (`src/routes/ops.ts:125-152`)
- **Prompt-injection → tool misuse**: booking is server-validated against real availability; opt-out/STOP/HELP are handled deterministically *before* any LLM call; system prompt explicitly treats caller text as untrusted; tool loop is capped (`MAX_TOOL_ITERATIONS = 4`); per-tenant daily SMS budget and per-conversation turn cap bound cost and looping. (`src/receptionist/{tools,guardrails,conversation,prompts}.ts`)
- **Container hardening**: multi-stage build, `USER node` (non-root), `npm ci --omit=dev`, `NODE_ENV=production`, 256 KB body limit. (`Dockerfile`, `src/server.ts:29`)
- **Secret handling**: no secrets committed; `.gitignore` excludes `.env*`; secrets injected from Secret Manager at deploy (`infra/deploy.sh:13-33`).
- **Idempotency**: missed-call (`call_<CallSid>`), inbound SMS (`in_<MessageSid>`), Stripe events, and onboarding (per subscription) are all de-duplicated.

---

## 5. Severity counts

- CRITICAL: 0
- HIGH: 2
- MEDIUM: 8
- LOW: 5

`npm audit --omit=dev`: 9 moderate (0 high/critical).

---

## 6. Fix now — before your first real customer

1. **[HIGH-1] Pin the cron-agent identity.** Replace the `.gserviceaccount.com` suffix check in `src/routes/agents.ts:30` with an exact match on `scheduler-invoker@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com` (+ `email_verified`). Today any GCP user can trigger your agents.
2. **[HIGH-2] Stop leaking customer PII on `/api/ops/*`.** Gate the ops feed behind founder auth or restrict it to the demo tenant; redact email addresses; never publish `support`/`onboarding` transcript bodies or the customer email in `publicSummary`.
3. **[MEDIUM-3 + MEDIUM-10] Get tokens out of query strings and make magic links single-use.** They currently land in Cloud Logging/BigQuery and are replayable for 15 minutes.
4. **[MEDIUM-9] Lock down `/webhooks/inbound-email`.** Verify SendGrid's signature, add a rate limit, and don't auto-reply to an unverified `from`.
5. **[MEDIUM-6 + MEDIUM-5] Cap public spend.** Add a daily Gemini budget for the demo tenant and cache/rate-limit `/api/ops/summary`.
6. **[MEDIUM-4] Block SSRF** in the onboarding website fetch (reject private IPs, cap redirects/size).
7. **[MEDIUM-7 + MEDIUM-8] Patch deps and add security headers.** Upgrade `@fastify/static` (→^10) and `firebase-admin` (→^14); register `@fastify/helmet` with CSP/HSTS; fail CI on high/critical audit findings.
