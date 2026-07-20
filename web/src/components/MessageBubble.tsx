import './MessageBubble.css';
import type { MessageRole } from '../types';

interface MessageBubbleProps {
  role: MessageRole;
  body: string;
  time?: string;
  animate?: boolean;
  animationDelayMs?: number;
}

/** A single chat bubble in an SMS-style thread (caller / assistant / system). */
export function MessageBubble({ role, body, time, animate = false, animationDelayMs = 0 }: MessageBubbleProps) {
  return (
    <div
      className={`message-bubble-row role-${role}${animate ? ' animate-in' : ''}`}
      style={animate ? { animationDelay: `${animationDelayMs}ms` } : undefined}
    >
      <div className="message-bubble">
        {body}
        {time ? <span className="message-meta">{time}</span> : null}
      </div>
    </div>
  );
}
