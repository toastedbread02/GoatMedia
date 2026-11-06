import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'default' | 'error';
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
  leaving?: boolean;
}

interface ToastContextValue {
  notify: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const finish = useCallback((id: number) => {
    setToasts((items) => items.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
    setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 160);
  }, []);

  const notify = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = ++counter.current;
      setToasts((items) => [...items.slice(-2), { id, message, ...options }]);
      setTimeout(() => finish(id), options?.duration ?? (options?.actionLabel ? 7000 : 4200));
    },
    [finish],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast${toast.leaving ? ' is-leaving' : ''}${toast.tone === 'error' ? ' toast--error' : ''}`}>
            <span className="toast__message">{toast.message}</span>
            {toast.actionLabel && toast.onAction ? (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  toast.onAction?.();
                  finish(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            ) : null}
            <button type="button" className="toast__close" aria-label="Dismiss message" onClick={() => finish(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
