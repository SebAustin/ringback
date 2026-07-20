import { RunRow } from './RunRow';
import type { AgentRun } from '../../types';

interface RunFeedProps {
  runs: AgentRun[] | null;
  loading: boolean;
}

export function RunFeed({ runs, loading }: RunFeedProps) {
  return (
    <section className="console-panel" aria-labelledby="feed-heading">
      <div className="console-panel-header">
        <h2 id="feed-heading">Live agent feed</h2>
      </div>
      {loading && !runs ? (
        <div style={{ padding: 'var(--space-md)' }}>
          <div className="skeleton console-skeleton" style={{ height: '2.5rem', marginBottom: '0.5rem' }} />
          <div className="skeleton console-skeleton" style={{ height: '2.5rem', marginBottom: '0.5rem' }} />
          <div className="skeleton console-skeleton" style={{ height: '2.5rem' }} />
        </div>
      ) : !runs || runs.length === 0 ? (
        <div className="console-empty">No agent runs yet — the switchboard is quiet.</div>
      ) : (
        <div role="log" aria-live="polite" aria-relevant="additions">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </div>
      )}
    </section>
  );
}
