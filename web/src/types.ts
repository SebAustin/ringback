/**
 * Shared frontend types mirroring the RingBack backend API contract.
 * Kept in sync manually with the server's response shapes.
 */

export type AgentName =
  | 'receptionist'
  | 'onboarding'
  | 'support'
  | 'prospector'
  | 'cfo'
  | 'watchdog'
  | 'qa';

export type RunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected';

export interface OpsKpis {
  mrrUsd: number;
  activeTenants: number;
  conversations7d: number;
  bookings7d: number;
  aiResolutionRate: number;
  totalAgentRuns: number;
  autonomousActions: number;
  humanApprovals: number;
}

export interface LatestReport {
  weekOf: string;
  narrative: string;
  mrrUsd: number;
  totals: {
    conversations: number;
    bookings: number;
    costUsd: number;
  };
}

export interface OpsSummary {
  kpis: OpsKpis;
  latestReport: LatestReport | null;
}

export interface AgentRunCost {
  gemini: number;
  twilio: number;
  other: number;
}

export interface AgentTranscriptStep {
  step: string;
  at: string;
  prompt?: string;
  response?: string;
  toolCall?: string;
  result?: string;
}

export interface AgentAction {
  type: string;
  payload: Record<string, unknown>;
  executed: boolean;
  requiresApproval?: boolean;
}

export interface AgentRun {
  id: string;
  agent: AgentName;
  trigger: { type: string; detail: string };
  status: RunStatus;
  startedAt: string;
  durationMs?: number;
  costUsd: AgentRunCost;
  publicSummary: string;
  transcript: AgentTranscriptStep[];
  actions: AgentAction[];
}

export interface OpsRunsResponse {
  runs: AgentRun[];
}

export interface QueueAction {
  type: string;
  payload: Record<string, unknown>;
  index: number;
}

export interface QueueItem {
  runId: string;
  agent: string;
  startedAt: string;
  actions: QueueAction[];
}

export interface OpsQueueResponse {
  items: QueueItem[];
}

export interface DemoTenant {
  name: string;
  services: { name: string; durationMin: number; price?: string }[];
  hoursNote: string;
}

export interface DemoStartResponse {
  conversationId: string;
  tenant: DemoTenant;
  messages?: DemoMessage[];
}

export type MessageRole = 'caller' | 'assistant' | 'system';

export interface DemoMessage {
  role: MessageRole;
  body: string;
  createdAt: string;
}

export interface DemoBooked {
  service: string;
  startsAt: string;
  label: string;
}

export interface DemoMessageResponse {
  messages: DemoMessage[];
  booked?: DemoBooked;
}

export interface MeResponse {
  email: string;
  role: 'founder' | 'owner';
  tenantId?: string;
}

export type TenantHoursWindow = [string, string];

export interface TenantProfile {
  services: { name: string; durationMin: number; price?: string }[];
  faqs: { q: string; a: string }[];
  hours: Record<string, TenantHoursWindow[]>;
  timezone: string;
  bookingPolicy?: string;
  tone?: string;
}

export interface Tenant {
  id: string;
  name: string;
  status: string;
  twilioNumber?: string;
  forwardPhone?: string;
  profile: TenantProfile;
}

export type ConversationStatus = 'active' | 'escalated' | 'closed' | string;

export interface ConversationSummary {
  id: string;
  callerPhone: string;
  callerName?: string;
  channel: string;
  status: ConversationStatus;
  outcome?: string;
  summary?: string;
  turnCount: number;
  lastMessageAt: string;
  createdAt: string;
}

export interface ConversationsResponse {
  conversations: ConversationSummary[];
}

export interface ConversationMessage {
  role: MessageRole;
  body: string;
  createdAt: string;
}

export interface ConversationDetailResponse {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
}

export interface Appointment {
  id: string;
  callerName: string;
  service: string;
  startsAt: string;
  endsAt: string;
  status: string;
}

export interface AppointmentsResponse {
  appointments: Appointment[];
}

export interface CheckoutRequest {
  plan: 'starter' | 'pro';
  email: string;
  businessName: string;
  website?: string;
}
