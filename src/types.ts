/** Firestore document shapes. All timestamps are ISO-8601 UTC strings. */

export interface Service {
  name: string;
  durationMin: number;
  /** Display price, e.g. "$45". Omit when quote-only — the AI must never invent one. */
  price?: string;
}

export interface Faq {
  q: string;
  a: string;
}

/** Weekly hours: key = mon..sun, value = list of [open, close] "HH:MM" ranges. */
export type WeeklyHours = Partial<Record<Weekday, [string, string][]>>;
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface TenantProfile {
  services: Service[];
  faqs: Faq[];
  hours: WeeklyHours;
  timezone: string;
  bookingPolicy?: string;
  tone?: string;
  website?: string;
  address?: string;
}

export interface TenantBilling {
  stripeCustomerId?: string;
  stripeSubId?: string;
  plan?: 'starter' | 'pro' | 'founding';
  status?: string;
  currentPeriodEnd?: string;
}

export type TenantStatus = 'pending_review' | 'live' | 'paused' | 'churned';

export interface Tenant {
  name: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  forwardPhone?: string;
  twilioNumber?: string;
  twilioNumberSid?: string;
  status: TenantStatus;
  profile: TenantProfile;
  limits: { dailySmsSegments: number; maxTurns: number };
  billing: TenantBilling;
  createdAt: string;
  onboardedByAgentRunId?: string;
}

export type ConversationStatus =
  | 'active'
  | 'owner_takeover'
  | 'closed'
  | 'opted_out'
  | 'escalated';

export type ConversationOutcome =
  | 'booked'
  | 'qualified'
  | 'answered_faq'
  | 'lost'
  | 'spam';

export interface Conversation {
  tenantId: string;
  callerPhone: string;
  callerName?: string;
  channel: 'sms' | 'web_sim';
  source: 'missed_call' | 'inbound_sms' | 'demo';
  status: ConversationStatus;
  outcome?: ConversationOutcome;
  summary?: string;
  qualification?: { service?: string; urgency?: string; notes?: string };
  turnCount: number;
  smsSegmentsUsed: number;
  createdAt: string;
  lastMessageAt: string;
  missedCallSid?: string;
  qaScore?: number;
  qaNotes?: string;
}

export interface Message {
  role: 'caller' | 'assistant' | 'owner' | 'system';
  body: string;
  createdAt: string;
  /** Monotonic ordering key — createdAt alone collides within a millisecond.
   * REQUIRED: every reader orders by seq and drops docs missing it. */
  seq: number;
  deliveryStatus?: string;
  geminiMeta?: {
    model: string;
    inTokens: number;
    outTokens: number;
    toolCalls: string[];
  };
}

export interface Appointment {
  tenantId: string;
  conversationId: string;
  callerPhone: string;
  callerName: string;
  service: string;
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes?: string;
  createdByAgent: boolean;
  createdAt: string;
}

export type AgentName =
  | 'receptionist'
  | 'onboarding'
  | 'support'
  | 'prospector'
  | 'cfo'
  | 'watchdog'
  | 'qa';

export type AgentRunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected';

export interface AgentAction {
  type: string;
  payload: Record<string, unknown>;
  executed: boolean;
  requiresApproval?: boolean;
  approvedBy?: string;
  approvedAt?: string;
}

export interface TranscriptStep {
  step: string;
  at: string;
  prompt?: string;
  response?: string;
  toolCall?: string;
  result?: string;
}

export interface AgentRun {
  agent: AgentName;
  trigger: { type: 'cron' | 'webhook' | 'manual'; detail: string };
  tenantId?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: AgentRunStatus;
  transcript: TranscriptStep[];
  actions: AgentAction[];
  costUsd: { gemini: number; twilio: number; other: number };
  error?: string;
  publicSummary: string;
}

export interface Prospect {
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
  status: 'drafted' | 'approved' | 'sent' | 'replied' | 'converted' | 'rejected';
  agentRunId: string;
  createdAt: string;
  sentAt?: string;
  repliedAt?: string;
}

export interface SupportTicket {
  fromEmail?: string;
  fromPhone?: string;
  tenantId?: string;
  subject: string;
  body: string;
  classification?: string;
  status: 'auto_resolved' | 'awaiting_approval' | 'escalated' | 'closed';
  agentRunId: string;
  replyBody?: string;
  createdAt: string;
}

export interface MetricsDaily {
  date: string;
  conversations: number;
  bookings: number;
  missedCallsCaptured: number;
  medianTextbackMs: number;
  smsCostUsd: number;
  geminiCostUsd: number;
  mrrUsd: number;
  activeTenants: number;
}

export interface Incident {
  severity: 'low' | 'medium' | 'high';
  detectedBy: 'watchdog';
  description: string;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
  agentRunId: string;
}

export interface WeeklyReport {
  weekOf: string;
  narrative: string;
  mrrUsd: number;
  activeTenants: number;
  totals: { conversations: number; bookings: number; costUsd: number };
  createdAt: string;
  agentRunId: string;
}

/** Opt-out blocklist entry, keyed by E.164 phone. */
export interface OptOut {
  phone: string;
  tenantId: string;
  createdAt: string;
}
