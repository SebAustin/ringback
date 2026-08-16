import { Type, type FunctionDeclaration } from '@google/genai';
import type { Appointment, Conversation, Tenant } from '../types.js';
import { getStore } from '../lib/store.js';
import {
  computeAvailability,
  formatSlotLabel,
  isWithinBusinessHours,
  nowIso,
  overlapsBooked,
  type Slot,
} from '../lib/time.js';
import { maskPhone, sendSms } from '../lib/twilio.js';
import { ownerBookingAlert, ownerEscalationAlert } from './prompts.js';

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_availability',
    description: 'Fetch real open appointment slots for the next few days. Always call this before proposing times.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        days: { type: Type.NUMBER, description: 'How many days ahead to search (default 7, max 14)' },
        service: { type: Type.STRING, description: 'Service name if the customer mentioned one' },
      },
    },
  },
  {
    name: 'book_appointment',
    description: 'Book a specific open slot. Only call after the customer picked a slot AND gave their name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        slotStartsAt: { type: Type.STRING, description: 'ISO start time of the chosen slot, exactly as returned by get_availability' },
        callerName: { type: Type.STRING, description: 'Customer name for the booking' },
        service: { type: Type.STRING, description: 'Requested service' },
        notes: { type: Type.STRING, description: 'Any extra notes from the customer' },
      },
      required: ['slotStartsAt', 'callerName', 'service'],
    },
  },
  {
    name: 'escalate_to_owner',
    description: 'Alert the business owner to take over. Use for complaints, refunds, sensitive topics, or explicit requests for a human.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: 'One-line reason the owner is needed' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'mark_lead_qualified',
    description: 'Record what the customer needs once known (service interest, urgency).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        service: { type: Type.STRING },
        urgency: { type: Type.STRING, description: 'e.g. today, this week, browsing' },
        notes: { type: Type.STRING },
      },
    },
  },
];

export interface ToolContext {
  tenantId: string;
  tenant: Tenant;
  conversationId: string;
  conversation: Conversation;
}

export interface ToolOutcome {
  response: Record<string, unknown>;
  /** Set when the tool ends the AI's involvement (escalation). */
  halt?: boolean;
  booked?: { service: string; startsAt: string; label: string };
}

async function loadBooked(tenantId: string): Promise<{ startsAt: string; endsAt: string }[]> {
  const appts = await getStore().query<Appointment>(`tenants/${tenantId}/appointments`, {
    where: [
      ['status', '==', 'confirmed'],
      ['startsAt', '>=', new Date(Date.now() - 3600_000).toISOString()],
    ],
  });
  return appts.map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt }));
}

function serviceDuration(tenant: Tenant, serviceName?: string): number {
  const match = serviceName
    ? tenant.profile.services.find((s) => s.name.toLowerCase() === serviceName.toLowerCase())
    : undefined;
  return match?.durationMin ?? tenant.profile.services[0]?.durationMin ?? 30;
}

async function getAvailability(ctx: ToolContext, args: Record<string, unknown>): Promise<Slot[]> {
  const days = Math.min(Math.max(Number(args.days) || 7, 1), 14);
  return computeAvailability({
    hours: ctx.tenant.profile.hours,
    timezone: ctx.tenant.profile.timezone,
    durationMin: serviceDuration(ctx.tenant, args.service as string | undefined),
    days,
    booked: await loadBooked(ctx.tenantId),
    maxSlots: 24,
  });
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const store = getStore();

  switch (name) {
    case 'get_availability': {
      const slots = await getAvailability(ctx, args);
      return {
        response: {
          timezone: ctx.tenant.profile.timezone,
          slots: slots.map((s) => ({ startsAt: s.startsAt, label: s.label })),
        },
      };
    }

    case 'book_appointment': {
      const slotStartsAt = String(args.slotStartsAt ?? '');
      const callerName = String(args.callerName ?? '').slice(0, 80).trim();
      const service = String(args.service ?? '').slice(0, 120).trim();
      if (!callerName || !service) {
        return { response: { ok: false, error: 'callerName and service are required' } };
      }
      const start = new Date(slotStartsAt);
      if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) {
        return { response: { ok: false, error: 'slot is invalid or in the past — call get_availability again' } };
      }
      // Server-side validation — the model cannot book arbitrary times. This
      // checks the TIME directly (business hours + no overlap) rather than
      // membership of a regenerated slot grid, whose step size depends on which
      // service built it: a time legitimately offered by one get_availability
      // call could be absent from another call's grid and get wrongly refused.
      const durationMin = serviceDuration(ctx.tenant, service);
      const endsAt = new Date(start.getTime() + durationMin * 60_000);
      const slot = {
        startsAt: start.toISOString(),
        endsAt: endsAt.toISOString(),
        label: formatSlotLabel(start, ctx.tenant.profile.timezone),
      };
      const withinHours = isWithinBusinessHours({
        hours: ctx.tenant.profile.hours,
        timezone: ctx.tenant.profile.timezone,
        startsAt: start,
        durationMin,
      });
      if (!withinHours) {
        return { response: { ok: false, error: 'that time is outside business hours — call get_availability and offer a real opening' } };
      }
      if (overlapsBooked(slot.startsAt, slot.endsAt, await loadBooked(ctx.tenantId))) {
        return { response: { ok: false, error: 'that slot is no longer open — offer the customer the latest availability' } };
      }
      // Atomic slot lock: two concurrent bookings for the same slot cannot both
      // win (check-then-act alone is racy across instances).
      const lockId = `${ctx.tenantId}:${slot.startsAt}`;
      const lockAcquired = await store.createIfAbsent('slot_locks', lockId, {
        tenantId: ctx.tenantId,
        startsAt: slot.startsAt,
        conversationId: ctx.conversationId,
        createdAt: nowIso(),
      });
      if (!lockAcquired) {
        // Self-heal orphaned locks: a lock with no confirmed appointment behind
        // it (failed write, cancellation) must not poison the slot forever (R2).
        // Known tolerated window: if this read lands between a rival's lock
        // acquisition and its appointment commit, we delete their lock and ask
        // the model to retry — by then getAvailability filters the slot out,
        // so the worst case is one spurious retry message, never a double-book.
        const stillBooked = (await loadBooked(ctx.tenantId)).some((b) => b.startsAt === slot.startsAt);
        if (stillBooked) {
          return { response: { ok: false, error: 'that slot was just taken — offer the customer the next open slot' } };
        }
        await store.delete('slot_locks', lockId);
        return { response: { ok: false, error: 'that slot needed a refresh — call book_appointment once more to confirm it' } };
      }
      const appointment: Appointment = {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        callerPhone: ctx.conversation.callerPhone,
        callerName,
        service,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: 'confirmed',
        notes: args.notes ? String(args.notes).slice(0, 500) : undefined,
        createdByAgent: true,
        createdAt: nowIso(),
      };
      try {
        await store.add(`tenants/${ctx.tenantId}/appointments`, appointment);
      } catch (err) {
        // Release the lock or the slot is unbookable forever (R2).
        await store.delete('slot_locks', lockId).catch(() => undefined);
        throw err;
      }
      await store.merge(`tenants/${ctx.tenantId}/conversations`, ctx.conversationId, {
        outcome: 'booked',
        callerName,
      });
      // Owner alert is best-effort — a bad owner number must never lose the
      // caller's confirmation after the appointment is already written.
      if (ctx.tenant.ownerPhone && ctx.conversation.channel === 'sms') {
        try {
          await sendSms({
            to: ctx.tenant.ownerPhone,
            body: ownerBookingAlert({ callerName, service, slotLabel: slot.label }),
            tenantId: ctx.tenantId,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(JSON.stringify({ severity: 'warning', msg: 'owner booking alert failed', tenantId: ctx.tenantId, err: String(err) }));
        }
      }
      return {
        response: { ok: true, confirmed: { service, startsAt: slot.startsAt, label: slot.label } },
        booked: { service, startsAt: slot.startsAt, label: slot.label },
      };
    }

    case 'escalate_to_owner': {
      const reason = String(args.reason ?? 'customer needs a human').slice(0, 200);
      await store.merge(`tenants/${ctx.tenantId}/conversations`, ctx.conversationId, {
        status: 'escalated',
      });
      if (ctx.tenant.ownerPhone && ctx.conversation.channel === 'sms') {
        try {
          await sendSms({
            to: ctx.tenant.ownerPhone,
            body: ownerEscalationAlert({
              maskedCaller: maskPhone(ctx.conversation.callerPhone),
              reason,
            }),
            tenantId: ctx.tenantId,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(JSON.stringify({ severity: 'warning', msg: 'owner escalation alert failed', tenantId: ctx.tenantId, err: String(err) }));
        }
      }
      return {
        response: { ok: true, note: 'Owner alerted. Tell the customer someone will reach out shortly.' },
        halt: true,
      };
    }

    case 'mark_lead_qualified': {
      await store.merge(`tenants/${ctx.tenantId}/conversations`, ctx.conversationId, {
        qualification: {
          service: args.service ? String(args.service).slice(0, 120) : undefined,
          urgency: args.urgency ? String(args.urgency).slice(0, 60) : undefined,
          notes: args.notes ? String(args.notes).slice(0, 300) : undefined,
        },
        outcome: ctx.conversation.outcome ?? 'qualified',
      });
      return { response: { ok: true } };
    }

    default:
      return { response: { ok: false, error: `unknown tool: ${name}` } };
  }
}

export { formatSlotLabel };
