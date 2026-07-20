/** Three animated dots indicating the AI is composing a reply. */
export function TypingIndicator() {
  return (
    <div className="typing-indicator" role="status" aria-label="Assistant is typing">
      <span />
      <span />
      <span />
    </div>
  );
}
