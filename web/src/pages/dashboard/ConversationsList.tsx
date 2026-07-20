import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getConversations } from '../../api';
import { StatusChip } from '../../components/StatusChip';
import { Skeleton } from '../../components/Skeleton';
import { formatRelativeTime } from '../../lib/time';
import type { ConversationSummary } from '../../types';

function statusPulse(status: string): boolean {
  return status === 'active';
}

export function ConversationsList() {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getConversations(50)
      .then((res) => {
        if (!cancelled) setConversations(res.conversations);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load conversations.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kpis = useMemo(() => {
    if (!conversations) return null;
    return {
      total: conversations.length,
      active: conversations.filter((c) => c.status === 'active').length,
      escalated: conversations.filter((c) => c.status === 'escalated').length,
      booked: conversations.filter((c) => c.outcome === 'booked').length,
    };
  }, [conversations]);

  return (
    <>
      <div className="dashboard-header">
        <h1>Conversations</h1>
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : (
        <>
          <section className="dashboard-kpi-row" aria-label="Conversation metrics">
            <div className="dashboard-kpi-tile">
              <div className="kpi-label">Total</div>
              <div className="kpi-value">{kpis ? kpis.total : <Skeleton height="1.6rem" />}</div>
            </div>
            <div className="dashboard-kpi-tile">
              <div className="kpi-label">Active</div>
              <div className="kpi-value">{kpis ? kpis.active : <Skeleton height="1.6rem" />}</div>
            </div>
            <div className="dashboard-kpi-tile">
              <div className="kpi-label">Escalated</div>
              <div className="kpi-value">{kpis ? kpis.escalated : <Skeleton height="1.6rem" />}</div>
            </div>
            <div className="dashboard-kpi-tile">
              <div className="kpi-label">Booked</div>
              <div className="kpi-value">{kpis ? kpis.booked : <Skeleton height="1.6rem" />}</div>
            </div>
          </section>

          {!conversations ? (
            <div>
              <Skeleton height="2.5rem" className="visually-hidden" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <Skeleton height="2.5rem" />
                <Skeleton height="2.5rem" />
                <Skeleton height="2.5rem" />
              </div>
            </div>
          ) : conversations.length === 0 ? (
            <div className="empty-state">
              <h3>No conversations yet</h3>
              <p>Your phone hasn't missed anyone. When it does, the text thread shows up here.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Caller</th>
                  <th scope="col">Status</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Turns</th>
                  <th scope="col">Last message</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conversation) => (
                  <tr key={conversation.id}>
                    <td>
                      <Link to={`/dashboard/conversations/${conversation.id}`}>
                        {conversation.callerName || conversation.callerPhone}
                      </Link>
                    </td>
                    <td>
                      <StatusChip status={conversation.status} pulse={statusPulse(conversation.status)} />
                    </td>
                    <td>{conversation.outcome ? <StatusChip status="booked" label={conversation.outcome} /> : '—'}</td>
                    <td>{conversation.turnCount}</td>
                    <td>{formatRelativeTime(conversation.lastMessageAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
