import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getConversation, resumeConversation, takeoverConversation } from '../../api';
import { MessageBubble } from '../../components/MessageBubble';
import { StatusChip } from '../../components/StatusChip';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { formatDateTime } from '../../lib/time';
import type { ConversationDetailResponse } from '../../types';

const AI_PAUSED_STATUS = 'escalated';

export function ConversationDetail() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [detail, setDetail] = useState<ConversationDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [resuming, setResuming] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    getConversation(id)
      .then((res) => setDetail(res))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load conversation.'));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTakeover = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id || !draft.trim()) return;
    setSending(true);
    try {
      await takeoverConversation(id, draft.trim());
      setDraft('');
      showToast('Sent. The AI has paused on this thread.');
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send message.', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleResume = async () => {
    if (!id) return;
    setResuming(true);
    try {
      await resumeConversation(id);
      showToast('AI resumed on this conversation.');
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not resume the AI.', 'error');
    } finally {
      setResuming(false);
    }
  };

  if (error) {
    return (
      <div className="error-banner" role="alert">
        {error}
      </div>
    );
  }

  if (!detail) {
    return (
      <div>
        <Skeleton height="1.5rem" width="10rem" />
        <div style={{ marginTop: '1rem' }}>
          <Skeleton height="20rem" />
        </div>
      </div>
    );
  }

  const { conversation, messages } = detail;
  const isPaused = conversation.status === AI_PAUSED_STATUS;

  return (
    <>
      <div className="dashboard-header">
        <div>
          <Link to="/dashboard" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', textDecoration: 'none' }}>
            ← All conversations
          </Link>
          <h1>{conversation.callerName || conversation.callerPhone}</h1>
        </div>
        <StatusChip status={conversation.status} pulse={conversation.status === 'active'} />
      </div>

      <div className="conversation-detail">
        <div className="conversation-thread" aria-live="polite">
          {messages.length === 0 ? (
            <div className="empty-state">
              <h3>No messages yet</h3>
              <p>This thread hasn't started.</p>
            </div>
          ) : (
            messages.map((message, index) => (
              <MessageBubble key={index} role={message.role} body={message.body} time={formatDateTime(message.createdAt)} />
            ))
          )}
        </div>

        <div className="conversation-rail">
          <div className="rail-card">
            <h3>Caller</h3>
            <p>{conversation.callerName || 'Unknown name'}</p>
            <p className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)' }}>
              {conversation.callerPhone}
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', marginTop: 'var(--space-2xs)' }}>
              {conversation.summary || 'No summary yet.'}
            </p>
          </div>

          <div className="rail-card">
            <h3>Take over</h3>
            {isPaused ? (
              <>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', marginBottom: 'var(--space-xs)' }}>
                  You're in control of this thread.
                </p>
                <button type="button" className="btn btn-outline btn-sm" onClick={handleResume} disabled={resuming}>
                  {resuming ? 'Resuming…' : 'Resume AI'}
                </button>
              </>
            ) : (
              <form className="takeover-composer" onSubmit={handleTakeover}>
                <p className="takeover-note">You're taking over — the AI will pause.</p>
                <div className="field">
                  <label htmlFor="takeover-body">Message</label>
                  <textarea
                    id="takeover-body"
                    rows={3}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !draft.trim()}>
                  {sending ? 'Sending…' : 'Send & take over'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
