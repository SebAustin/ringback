import type {
  AppointmentsResponse,
  CheckoutRequest,
  ConversationDetailResponse,
  ConversationsResponse,
  DemoMessageResponse,
  DemoStartResponse,
  MeResponse,
  OpsQueueResponse,
  OpsRunsResponse,
  OpsSummary,
  Tenant,
} from './types';

/**
 * Thrown for any non-2xx API response. Callers can inspect `status` to
 * branch on auth (401/403) vs. generic failure.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : undefined) ?? `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, data);
  }

  return data as T;
}

// ── Public: ops console ──────────────────────────────────────────────────
export const getOpsSummary = () => request<OpsSummary>('/api/ops/summary');

export const getOpsRuns = (limit = 50) => request<OpsRunsResponse>(`/api/ops/runs?limit=${limit}`);

export const getOpsQueue = () => request<OpsQueueResponse>('/api/ops/queue');

export const approveAgentAction = (runId: string, actionIndex: number, approve: boolean) =>
  request<{ ok: true }>(`/api/agents/approve/${runId}`, {
    method: 'POST',
    body: { actionIndex, approve },
  });

// ── Public: demo simulator ───────────────────────────────────────────────
export const startDemo = () => request<DemoStartResponse>('/api/demo/start', { method: 'POST', body: {} });

export const sendDemoMessage = (conversationId: string, text: string) =>
  request<DemoMessageResponse>('/api/demo/message', {
    method: 'POST',
    body: { conversationId, text },
  });

// ── Public: auth & checkout ──────────────────────────────────────────────
export const requestMagicLink = (email: string) =>
  request<{ ok: true }>('/api/auth/magic-link', { method: 'POST', body: { email } });

export const logout = () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' });

export const startCheckout = (payload: CheckoutRequest) =>
  request<{ url: string }>('/api/checkout', { method: 'POST', body: payload });

// ── Authed: session & tenant ─────────────────────────────────────────────
export const getMe = () => request<MeResponse>('/api/me');

export const getTenant = () => request<Tenant>('/api/tenant');

export const updateTenant = (patch: Partial<Pick<Tenant, 'name' | 'forwardPhone' | 'profile'>>) =>
  request<Tenant>('/api/tenant', { method: 'PATCH', body: patch });

// ── Authed: conversations ────────────────────────────────────────────────
export const getConversations = (limit = 50) =>
  request<ConversationsResponse>(`/api/conversations?limit=${limit}`);

export const getConversation = (id: string) =>
  request<ConversationDetailResponse>(`/api/conversations/${id}`);

export const takeoverConversation = (id: string, body: string) =>
  request<{ ok: true }>(`/api/conversations/${id}/takeover`, { method: 'POST', body: { body } });

export const resumeConversation = (id: string) =>
  request<{ ok: true }>(`/api/conversations/${id}/resume`, { method: 'POST', body: {} });

// ── Authed: appointments & billing ───────────────────────────────────────
export const getAppointments = () => request<AppointmentsResponse>('/api/appointments');

export const openBillingPortal = () => request<{ url: string }>('/api/billing/portal', { method: 'POST', body: {} });
