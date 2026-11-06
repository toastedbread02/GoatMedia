import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MeDTO } from '../../shared/types.ts';
import { api } from './api.ts';
import { clearFeedCache } from './feedCache.ts';

interface AuthContextValue {
  user: MeDTO | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: MeDTO | null) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<MeDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: MeDTO | null }>('/api/auth/me');
      setUserState(data.user);
    } catch {
      setUserState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setUser = useCallback((next: MeDTO | null) => {
    setUserState((previous) => {
      if (previous?.id !== next?.id) clearFeedCache();
      return next;
    });
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUserState(null);
    clearFeedCache();
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, setUser, signOut }),
    [user, loading, refresh, setUser, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
