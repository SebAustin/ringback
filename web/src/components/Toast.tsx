import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface ToastEntry {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

interface ToastContextValue {
  showToast: (message: string, tone?: 'info' | 'error') => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_LIFETIME_MS = 4200;

/**
 * App-wide toast notifications. Wrap the tree once near the root; call
 * `useToast().showToast(message)` from anywhere below it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, tone: 'info' | 'error' = 'info') => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TOAST_LIFETIME_MS);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" role="status">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast${toast.tone === 'error' ? ' toast-error' : ''}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
