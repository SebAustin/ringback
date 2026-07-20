/**
 * Local end-to-end driver: simulates Twilio webhooks against a running dev
 * server (memory store + mock mode), then holds an SMS conversation.
 *
 *   npm run dev          # terminal 1
 *   npm run simulate     # terminal 2
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const CALLER = '+15550001234';
const DEMO_NUMBER = process.env.DEMO_NUMBER ?? '';

async function post(pathname: string, params: Record<string, string>): Promise<string> {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return res.text();
}

async function getDemoNumber(): Promise<string> {
  if (DEMO_NUMBER) return DEMO_NUMBER;
  // The demo tenant has no Twilio number in pure-local mode; attach a fake one.
  console.log('NOTE: set DEMO_NUMBER env var to the tenant twilioNumber, using +15551110000 default.');
  return '+15551110000';
}

async function main(): Promise<void> {
  const to = await getDemoNumber();

  console.log('1) Simulating missed call (Dial no-answer)...');
  console.log(
    await post('/webhooks/twilio/voice/status', {
      To: to,
      From: CALLER,
      CallSid: `CA_sim_${Date.now()}`,
      DialCallStatus: 'no-answer',
    }),
  );

  const turns = ['Hi, do you have anything open this week for a mens cut?', 'Thursday works. I am Alex'];
  for (const [i, text] of turns.entries()) {
    console.log(`\n${i + 2}) Caller: ${text}`);
    console.log(
      await post('/webhooks/twilio/sms', {
        To: to,
        From: CALLER,
        Body: text,
        MessageSid: `SM_sim_${Date.now()}_${i}`,
      }),
    );
  }

  console.log('\nDone. Check /ops for the agent runs and the dashboard for the conversation.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
