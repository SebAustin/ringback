import type { Prospect } from '../types.js';
import { getStore } from '../lib/store.js';
import { nowIso } from '../lib/time.js';
import { parseJson } from '../lib/gemini.js';
import { sendEmail } from '../lib/email.js';
import { cfg, geminiMock } from '../config.js';
import { runAgent, registerApprovalExecutor } from './runner.js';

/** Category/city rotation for daily prospecting sweeps. */
const ROTATION: { category: string; city: string }[] = [
  { category: 'barber shop', city: 'Austin TX' },
  { category: 'hair salon', city: 'Denver CO' },
  { category: 'plumber', city: 'Phoenix AZ' },
  { category: 'nail salon', city: 'Nashville TN' },
  { category: 'auto detailing', city: 'Tampa FL' },
  { category: 'massage therapy', city: 'Portland OR' },
  { category: 'dog groomer', city: 'Charlotte NC' },
];

interface PlaceResult {
  displayName?: { text: string };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  id?: string;
}

async function searchPlaces(category: string, city: string): Promise<PlaceResult[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': cfg.PLACES_API_KEY,
      'X-Goog-FieldMask':
        'places.displayName,places.nationalPhoneNumber,places.websiteUri,places.id',
    },
    body: JSON.stringify({ textQuery: `${category} in ${city}`, maxResultCount: 10 }),
  });
  if (!res.ok) throw new Error(`Places API error ${res.status}`);
  const data = (await res.json()) as { places?: PlaceResult[] };
  return data.places ?? [];
}

interface DraftedProspect {
  businessName: string;
  category: string;
  city: string;
  phone?: string;
  website?: string;
  placeId?: string;
  fitScore: number;
  rationale: string;
  draftSubject: string;
  draftEmail: string;
}

/**
 * Daily prospecting sweep. DRAFT-ONLY by design: nothing is ever sent without
 * a human approval click — cold outreach stays human-in-the-loop.
 */
export async function runProspector(triggerDetail: string): Promise<{ runId: string; summary: string }> {
  const result = await runAgent('prospector', { type: 'cron', detail: triggerDetail }, undefined, async (ctx) => {
    const store = getStore();
    const dayIndex = Math.floor(Date.now() / 86_400_000) % ROTATION.length;
    const { category, city } = ROTATION[dayIndex]!;
    await ctx.log('rotation', { result: `Today's segment: ${category} in ${city}` });

    let drafted: DraftedProspect[] = [];

    if (cfg.PLACES_API_KEY) {
      const places = await searchPlaces(category, city);
      await ctx.log('places-search', { result: `${places.length} businesses found` });
      for (const p of places.slice(0, 5)) {
        if (!p.displayName?.text) continue;
        const res = await ctx.gemini({
          model: 'flash',
          system:
            'You are the growth agent for RingBack, an AI receptionist that texts back missed calls for local businesses ($49/mo, first month $1). Score fit 0-100 (higher when the business likely misses calls: solo operators, no online booking on their site) and draft a 60-90 word friendly, non-pushy cold email from the founder Sebastien. Respond as JSON: {"fitScore":n,"rationale":"...","draftSubject":"...","draftEmail":"..."}',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Business: ${p.displayName.text} (${category}, ${city}). Phone: ${p.nationalPhoneNumber ?? 'unknown'}. Website: ${p.websiteUri ?? 'none found'}.`,
                },
              ],
            },
          ],
          mockKind: 'prospect',
          stepName: `draft:${p.displayName.text}`,
        });
        const parsed =
          parseJson<Omit<DraftedProspect, 'businessName' | 'category' | 'city'>>(res.text) ??
          (parseJson<DraftedProspect[]>(res.text)?.[0] as DraftedProspect | undefined);
        if (!parsed) continue;
        drafted.push({
          businessName: p.displayName.text,
          category,
          city,
          phone: p.nationalPhoneNumber,
          website: p.websiteUri,
          placeId: p.id,
          fitScore: Number(parsed.fitScore) || 50,
          rationale: String(parsed.rationale ?? '').slice(0, 400),
          draftSubject: String(parsed.draftSubject ?? 'Missed calls?').slice(0, 120),
          draftEmail: String(parsed.draftEmail ?? '').slice(0, 2000),
        });
      }
    } else if (geminiMock) {
      // Keyless local/demo mode: canned example prospect so the pipeline is visible.
      const res = await ctx.gemini({
        model: 'flash',
        system: 'mock',
        contents: [{ role: 'user', parts: [{ text: `${category} in ${city}` }] }],
        mockKind: 'prospect',
        stepName: 'draft-mock',
      });
      drafted = (parseJson<DraftedProspect[]>(res.text) ?? []).map((d) => ({
        ...d,
        category,
        city,
      }));
    } else {
      return 'Prospector skipped: PLACES_API_KEY not configured (real prospect data required — refusing to invent businesses).';
    }

    let queued = 0;
    for (const d of drafted.filter((x) => x.fitScore >= 60)) {
      const prospect: Prospect = {
        ...d,
        status: 'drafted',
        agentRunId: ctx.runId,
        createdAt: nowIso(),
      };
      const prospectId = await store.add('prospects', prospect);
      queued++;
      await ctx.action(
        'send_prospect_email',
        { prospectId, businessName: d.businessName, fitScore: d.fitScore },
        { requiresApproval: true },
      );
    }
    return `Prospector drafted ${queued} outreach emails for ${category} in ${city} (${drafted.length} researched). All await founder approval.`;
  });
  return { runId: result.runId, summary: result.summary };
}

// Approval: deliver the ready-to-forward draft to the founder's inbox (the
// founder sends from their own account — arms-length outreach stays human-sent).
registerApprovalExecutor('send_prospect_email', async (payload) => {
  const store = getStore();
  const prospectId = String(payload.prospectId ?? '');
  const prospect = await store.get<Prospect>('prospects', prospectId);
  if (!prospect) throw new Error('prospect not found');
  await store.merge('prospects', prospectId, { status: 'approved', sentAt: nowIso() });
  if (cfg.FOUNDER_EMAIL) {
    await sendEmail({
      to: cfg.FOUNDER_EMAIL,
      subject: `[RingBack outreach — ready to send] ${prospect.draftSubject}`,
      text: `Prospect: ${prospect.businessName} (${prospect.category}, ${prospect.city})\nPhone: ${prospect.phone ?? 'n/a'}\nWebsite: ${prospect.website ?? 'n/a'}\nFit ${prospect.fitScore}/100 — ${prospect.rationale}\n\n--- Subject ---\n${prospect.draftSubject}\n\n--- Body ---\n${prospect.draftEmail}`,
    });
  }
  return `Draft for ${prospect.businessName} approved and delivered to founder inbox for sending.`;
});
