import { useState } from 'react';
import { AgentBadge } from '../../components/AgentBadge';
import { StatusChip } from '../../components/StatusChip';
import type { AgentRun } from '../../types';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function formatCost(run: AgentRun): string {
  const total = run.costUsd.gemini + run.costUsd.twilio + run.costUsd.other;
  return `$${total.toFixed(3)}`;
}

export function RunRow({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="run-row"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <span className="run-time mono">{formatTime(run.startedAt)}</span>
        <AgentBadge agent={run.agent} />
        <span className="run-summary">{run.publicSummary}</span>
        <StatusChip status={run.status} pulse={run.status === 'running'} />
      </button>
      {expanded ? (
        <div className="run-detail">
          <p className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--console-text-dim)', marginBottom: 'var(--space-2xs)' }}>
            trigger: {run.trigger.type} — {run.trigger.detail} · cost: {formatCost(run)}
            {run.durationMs ? ` · ${run.durationMs}ms` : ''}
          </p>
          <pre className="transcript-pre">
            {run.transcript.length === 0
              ? 'No transcript steps recorded.'
              : run.transcript
                  .map((step) => {
                    const lines = [`[${formatTime(step.at)}] ${step.step}`];
                    if (step.toolCall) lines.push(`  tool: ${step.toolCall}`);
                    if (step.prompt) lines.push(`  prompt: ${step.prompt}`);
                    if (step.response) lines.push(`  response: ${step.response}`);
                    if (step.result) lines.push(`  result: ${step.result}`);
                    return lines.join('\n');
                  })
                  .join('\n\n')}
          </pre>
          {run.actions.length > 0 ? (
            <p className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--console-text-dim)', marginTop: 'var(--space-2xs)' }}>
              actions: {run.actions.map((action) => `${action.type}${action.executed ? '' : ' (pending)'}`).join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
