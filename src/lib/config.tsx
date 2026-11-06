import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppConfigDTO } from '../../shared/types';
import { api } from './api';

const ConfigContext = createContext<AppConfigDTO | null>(null);
const ErrorContext = createContext<string | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfigDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .config()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (error) {
    return (
      <div className="boot">
        <div className="boot__inner">
          <h1 className="wordmark">GoatMedia</h1>
          <p className="boot__text">
            The server did not answer. It may still be deploying, or the API address is not
            configured for this build.
          </p>
          <p className="boot__detail">{error}</p>
          <button className="button" type="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="boot" aria-busy="true">
        <div className="boot__inner">
          <h1 className="wordmark">GoatMedia</h1>
          <p className="boot__text">Waking the goats…</p>
          <div className="boot__bar" aria-hidden="true">
            <span />
          </div>
        </div>
      </div>
    );
  }

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useConfig(): AppConfigDTO {
  const value = useContext(ConfigContext);
  if (!value) throw new Error('Config is not ready yet.');
  return value;
}

export function useCategoryLabel(id: string): string {
  const { categories } = useConfig();
  return useMemo(() => categories.find((c) => c.id === id)?.label || id, [categories, id]);
}

export function useRetry() {
  const [attempt, setAttempt] = useState(0);
  return { attempt, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}

export { ErrorContext };
