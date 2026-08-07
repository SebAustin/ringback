# RingBack Compliance Notes

## SMS / TCPA posture

- **Consent basis.** RingBack's first text is a reply to a consumer who just
  placed a phone call to the business (consumer-initiated contact). This is a
  conversational/transactional use, not marketing. We never send marketing
  blasts, and the system has no bulk-send capability.
- **Identification.** The first message always identifies the business and
  includes "Reply STOP to opt out."
- **Opt-out.** STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT are handled in code
  before any AI involvement: blocklist entry written, single confirmation
  message sent, all further sends blocked (checked on every send path,
  including new conversations and missed-call textbacks). START re-subscribes.
  Twilio Advanced Opt-Out should be enabled as a carrier-level backstop.
- **HELP** returns business identification and contact guidance.
- **Quiet hours.** Enforced in code: no AI textback between 21:00 and 08:00
  tenant-local time — the owner is still alerted, and the caller is texted the
  next business morning by the owner or a fresh call. Scheduled/agent-initiated
  messages (check-ins) go by email instead of SMS.
- **A2P registration.** Production traffic runs on a verified toll-free number
  and/or a registered 10DLC campaign ("customer care / appointment booking"
  use case). Both registrations are submitted on day 1 — see runbook.

## Data protection

- PII (caller phone numbers, names, message bodies) lives in Firestore only.
- The public `/ops` dashboard masks all phone numbers (`+1***1234`) and fully
  redacts real-customer conversation transcripts; only the demo tenant's
  transcripts are shown verbatim.
- The BigQuery log sink receives structured request logs, not message bodies.
- Churned tenants: conversations are purged 30 days after cancellation
  (watchdog responsibility; see runbook for the manual command until automated).
- Secrets live in GCP Secret Manager; the Cloud Run service account has
  `secretAccessor` only. Nothing secret is in the repo.

## Scope limits

- **No HIPAA.** Target customers are salons, barbers, trades, groomers —
  not medical providers. The receptionist prompt forbids soliciting medical,
  financial, or other sensitive details, and escalates such topics to a human.
- **No payment collection over SMS.** The AI never asks for card numbers or
  takes payments; bookings are reservations only.
- **Prompt injection.** Caller SMS is treated as untrusted customer speech;
  the only side-effect channel is server-validated tools (slot must exist and
  be genuinely open, phone must match the conversation, etc.). The system
  prompt explicitly refuses instruction-taking from message content.
