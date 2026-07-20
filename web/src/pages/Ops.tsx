import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import '../styles/console.css';
import { KpiTile } from '../components/KpiTile';
import { usePoll } from '../hooks/usePoll';
import { getOpsQueue, getOpsRuns, getOpsSummary } from '../api';
import { RunFeed } from './ops/RunFeed';
import { ApprovalQueue } from './ops/ApprovalQueue';
import { ReportPanel } from './ops/ReportPanel';
import type { AgentRun, OpsSummary, QueueItem } from '../types';

const RUNS_POLL_MS = 5000;
const SUMMARY_POLL_MS = 10000;
const QUEUE_POLL_MS = 5000;

const percentFormatter = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function Ops() {
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [runsLoading, setRunsLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(() => {
    getOpsSummary()
      .then((res) => {
        setSummary(res);
        setSummaryLoading(false);
        setError(null);
      })
      .catch((err: unknown) => {
        setSummaryLoading(false);
        setError(err instanceof Error ? err.message : 'Failed to load operations summary.');
      });
  }, []);

  const fetchRuns = useCallback(() => {
    getOpsRuns(50)
      .then((res) => {
        setRuns(res.runs);
        setRunsLoading(false);
      })
      .catch(() => setRunsLoading(false));
  }, []);

  const fetchQueue = useCallback(() => {
    getOpsQueue()
      .then((res) => {
        setQueue(res.items);
        setQueueLoading(false);
      })
      .catch(() => setQueueLoading(false));
  }, []);

  usePoll(fetchSummary, SUMMARY_POLL_MS);
  usePoll(fetchRuns, RUNS_POLL_MS);
  usePoll(fetchQueue, QUEUE_POLL_MS);

  const kpis = summary?.kpis;

  return (
    <div className="console">
      <header className="console-header">
        <div className="console-title">
          <span className="live-dot" aria-hidden="true" />
          RingBack Operations — live
        </div>
        <nav aria-label="Operations navigation" style={{ fontSize: 'var(--text-sm)' }}>
          <Link to="/" style={{ color: 'var(--console-text-dim)', textDecoration: 'none' }}>
            Back to site
          </Link>
        </nav>
      </header>

      <main className="console-body">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}

        <section className="kpi-row" aria-label="Key metrics">
          <KpiTile label="MRR" value={kpis ? currencyFormatter.format(kpis.mrrUsd) : '—'} loading={summaryLoading} />
          <KpiTile label="Active tenants" value={kpis ? String(kpis.activeTenants) : '—'} loading={summaryLoading} />
          <KpiTile label="Conversations (7d)" value={kpis ? String(kpis.conversations7d) : '—'} loading={summaryLoading} />
          <KpiTile label="Bookings (7d)" value={kpis ? String(kpis.bookings7d) : '—'} loading={summaryLoading} />
          <KpiTile
            label="AI resolution rate"
            value={kpis ? percentFormatter.format(kpis.aiResolutionRate) : '—'}
            loading={summaryLoading}
          />
          <KpiTile label="Agent runs" value={kpis ? String(kpis.totalAgentRuns) : '—'} loading={summaryLoading} />
        </section>

        <div className="counter-strip mono" aria-live="off">
          <span>{kpis ? kpis.totalAgentRuns : 0} agent runs</span>
          <span>·</span>
          <span>{kpis ? kpis.autonomousActions : 0} autonomous actions</span>
          <span>·</span>
          <span>{kpis ? kpis.humanApprovals : 0} human approvals</span>
        </div>

        <div className="console-columns">
          <RunFeed runs={runs} loading={runsLoading} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
            <ApprovalQueue items={queue} loading={queueLoading} onDecided={fetchQueue} />
            <ReportPanel report={summary?.latestReport ?? null} loading={summaryLoading} />
          </div>
        </div>
      </main>
    </div>
  );
}
