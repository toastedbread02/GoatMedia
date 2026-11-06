import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppConfigDTO } from '../../shared/types.ts';
import { api } from './api.ts';

const ConfigContext = createContext<AppConfigDTO | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfigDTO | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AppConfigDTO>('/api/config')
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  return useContext(ConfigContext);
}

export function useCategories() {
  const config = useConfig();
  return useMemo(() => config?.categories ?? [], [config]);
}
