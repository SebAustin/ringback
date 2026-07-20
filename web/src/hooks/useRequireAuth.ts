import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, getMe } from '../api';
import type { MeResponse } from '../types';

interface RequireAuthState {
  me: MeResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the current session and redirects to /login on 401. Use inside
 * any authed dashboard route. Renders nothing itself — pages decide their
 * own loading/error UI based on the returned state.
 */
export function useRequireAuth(): RequireAuthState {
  const navigate = useNavigate();
  const [state, setState] = useState<RequireAuthState>({ me: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    getMe()
      .then((me) => {
        if (!cancelled) setState({ me, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          navigate('/login', { replace: true });
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load session';
        setState({ me: null, loading: false, error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return state;
}
