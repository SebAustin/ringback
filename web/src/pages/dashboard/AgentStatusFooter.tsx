import { useCallback, useState } from 'react';
import { usePoll } from '../../hooks/usePoll';
import { getOpsRuns } from '../../api';
import { formatRelativeTime } from '../../lib/time';

const POLL_MS = 30_000;
const WATCHDOG_AGENT = 'watchdog';

/** Small footer showing when the watchdog agent last ran, pulled from /api/ops/runs. */
export function AgentStatusFooter() {
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const fetchRuns = useCallback(() => {
    getOpsRuns(20)
      .then((res) => {
        const watchdogRun = res.runs.find((run) => run.agent === WATCHDOG_AGENT);
        setLastRunAt(watchdogRun ? watchdogRun.startedAt : null);
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, []);

  usePoll(fetchRuns, POLL_MS);

  return (
    <div className="dashboard-sidebar-footer">
      {!checked
        ? 'Checking agent status…'
        : lastRunAt
          ? `Watchdog last ran ${formatRelativeTime(lastRunAt)}`
          : 'Watchdog has not run yet'}
    </div>
  );
}
