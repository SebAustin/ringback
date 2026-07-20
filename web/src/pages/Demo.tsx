import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import './demo/demo.css';
import { PhonePanel } from '../components/PhonePanel';
import { MessageBubble } from '../components/MessageBubble';
import { TypingIndicator } from './demo/TypingIndicator';
import { BookingTicket } from './demo/BookingTicket';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { sendDemoMessage, startDemo } from '../api';
import type { DemoBooked, DemoMessage, DemoTenant } from '../types';

export function Demo() {
  const { showToast } = useToast();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [tenant, setTenant] = useState<DemoTenant | null>(null);
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [booked, setBooked] = useState<DemoBooked | null>(null);
  const [starting, setStarting] = useState(true);
  const [sending, setSending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    startDemo()
      .then((res) => {
        if (cancelled) return;
        setConversationId(res.conversationId);
        setTenant(res.tenant);
        if (res.messages) setMessages(res.messages);
        setStarting(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Could not start the demo.';
        setStartError(message);
        setStarting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pendingText]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !conversationId || sending) return;

    setDraft('');
    setPendingText(text);
    setSending(true);

    try {
      const res = await sendDemoMessage(conversationId, text);
      setMessages(res.messages);
      setPendingText(null);
      if (res.booked) setBooked(res.booked);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Message failed to send. Try again.';
      showToast(message, 'error');
      setPendingText(null);
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="demo-page">
      <div className="demo-topbar">
        <Link to="/" className="brand">
          RingBack
        </Link>
        <Link to="/">Exit demo</Link>
      </div>

      <div className="demo-intro">
        <h1>You missed a call from {tenant?.name ?? 'a local business'}.</h1>
        <p>This is the text you'd get, right now, automatically.</p>
      </div>

      <div className="demo-stage">
        <div className="demo-phone-column">
          <PhonePanel
            contactName={tenant?.name ?? 'RingBack'}
            contactMeta={tenant?.hoursNote}
            footer={
              <form className="demo-composer" onSubmit={handleSubmit}>
                <label htmlFor="demo-draft" className="visually-hidden">
                  Message
                </label>
                <input
                  id="demo-draft"
                  placeholder={starting ? 'Connecting…' : 'Type a message…'}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={starting || !!startError}
                  autoComplete="off"
                />
                <button type="submit" className="btn btn-accent btn-sm" disabled={starting || sending || !draft.trim()}>
                  Send
                </button>
              </form>
            }
          >
            {starting ? (
              <>
                <Skeleton height="2.4rem" width="70%" />
                <Skeleton height="2.4rem" width="55%" />
              </>
            ) : startError ? (
              <div className="error-banner" role="alert">
                {startError} — refresh to try again.
              </div>
            ) : (
              <>
                {messages.map((message, index) => (
                  <MessageBubble key={index} role={message.role} body={message.body} />
                ))}
                {pendingText ? <MessageBubble role="caller" body={pendingText} /> : null}
                {sending ? <TypingIndicator /> : null}
                <div ref={threadEndRef} />
              </>
            )}
          </PhonePanel>
        </div>
        {booked ? <BookingTicket booked={booked} /> : null}
      </div>
    </div>
  );
}
