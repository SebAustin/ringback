import type { AgentName } from '../types';

/** Colored monospace label identifying which of the seven agents acted. */
export function AgentBadge({ agent }: { agent: AgentName | string }) {
  return <span className={`agent-badge agent-${agent}`}>{agent}</span>;
}
