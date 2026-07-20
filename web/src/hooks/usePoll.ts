import { useEffect, useRef } from 'react';

/**
 * Invokes `fn` immediately and then every `intervalMs`, pausing while the
 * document is hidden (e.g. background tab) and resuming on visibility.
 * `fn` should be stable across renders that don't need to change polling
 * behavior — wrap it in useCallback at the call site if needed.
 */
export function usePoll(fn: () => void, intervalMs: number): void {
  const savedFn = useRef(fn);
  savedFn.current = fn;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => savedFn.current();

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(tick, intervalMs);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        tick();
        start();
      }
    };

    // Always fetch once on mount (even in hidden/embedded contexts) so the
    // page never renders permanently empty; only the *interval* pauses.
    tick();
    if (!document.hidden) {
      start();
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [intervalMs]);
}
