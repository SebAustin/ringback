import { useState } from 'react';
import { ApiError, approveAgentAction } from '../../api';
import { useToast } from '../../components/Toast';
import { AgentBadge } from '../../components/AgentBadge';
import type { QueueItem } from '../../types';

interface ApprovalQueueProps {
  items: QueueItem[] | null;
  loading: boolean;
  onDecided: () => void;
}

export function ApprovalQueue({ items, loading, onDecided }: ApprovalQueueProps) {
  const { showToast } = useToast();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const decide = async (runId: string, actionIndex: number, approve: boolean) => {
    const key = `${runId}:${actionIndex}`;
    setPendingKey(key);
    try {
      await approveAgentAction(runId, actionIndex, approve);
      showToast(approve ? 'Action approved.' : 'Action rejected.');
      onDecided();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        showToast('Founder login required to decide on this action.', 'error');
      } else {
        const message = error instanceof Error ? error.message : 'Could not record decision.';
        showToast(message, 'error');
      }
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <section className="console-panel" aria-labelledby="queue-heading">
      <div className="console-panel-header">
        <h2 id="queue-heading">Approval queue</h2>
      </div>
      {loading && !items ? (
        <div style={{ padding: 'var(--space-md)' }}>
          <div className="skeleton console-skeleton" style={{ height: '3rem' }} />
        </div>
      ) : !items || items.length === 0 ? (
        <div className="console-empty">Nothing awaiting a human — agents are running autonomously.</div>
      ) : (
        items.map((item) =>
          item.actions.map((action) => {
            const key = `${item.runId}:${action.index}`;
            const isPending = pendingKey === key;
            return (
              <div className="queue-item" key={key}>
                <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
                  <AgentBadge agent={item.agent} />
                  <span className="mono" style={{ fontSize: 'var(--text-xs)' }}>
                    {action.type}
                  </span>
                </div>
                <pre className="transcript-pre" style={{ maxHeight: '8rem' }}>
                  {JSON.stringify(action.payload, null, 2)}
                </pre>
                <div className="queue-actions">
                  <button
                    type="button"
                    className="btn-console"
                    disabled={isPending}
                    onClick={() => decide(item.runId, action.index, true)}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn-console reject"
                    disabled={isPending}
                    onClick={() => decide(item.runId, action.index, false)}
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          }),
        )
      )}
    </section>
  );
}
