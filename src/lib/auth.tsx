import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { MeDTO } from '../../shared/types';
import { api, tokenStore } from './api';

interface AuthValue {
  me: MeDTO | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    username: string;
    displayName: string;
    password: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  setMe: (me: MeDTO | null) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const { user } = await api.me();
      setMe(user);
    } catch {
      tokenStore.set(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const { token, user } = await api.login(identifier, password);
    tokenStore.set(token);
    setMe(user);
  }, []);

  const signUp = useCallback(
    async (input: { email: string; username: string; displayName: string; password: string }) => {
      const { token, user } = await api.register(input);
      tokenStore.set(token);
      setMe(user);
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* the token is dropped either way */
    }
    tokenStore.set(null);
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ me, loading, refresh, signIn, signUp, signOut, setMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Auth is not ready yet.');
  return value;
}
