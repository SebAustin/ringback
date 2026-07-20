import type { LatestReport } from '../../types';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function ReportPanel({ report, loading }: { report: LatestReport | null; loading: boolean }) {
  return (
    <section className="console-panel" aria-labelledby="report-heading">
      <div className="console-panel-header">
        <h2 id="report-heading">CFO weekly report</h2>
      </div>
      {loading ? (
        <div style={{ padding: 'var(--space-md)' }}>
          <div className="skeleton console-skeleton" style={{ height: '6rem' }} />
        </div>
      ) : !report ? (
        <div className="console-empty">No report filed yet — check back after the first week closes.</div>
      ) : (
        <div className="teletype">
          {`WEEK OF ${report.weekOf}\n`}
          {`MRR ${currency.format(report.mrrUsd)}  ·  CONVERSATIONS ${report.totals.conversations}  ·  BOOKINGS ${report.totals.bookings}  ·  COST ${currency.format(report.totals.costUsd)}\n`}
          {'—'.repeat(48)}
          {`\n${report.narrative}`}
        </div>
      )}
    </section>
  );
}
