import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../../lib/api';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
};

export type Wallet = {
  totalRc: string;
  usedRc: string;
  reservedRc: string;
  remainingRc: string;
  expiresAt: string | null;
};

type AuthState = {
  user: AuthUser | null;
  wallet: Wallet | null;
  loading: boolean;
};

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, wallet: null, loading: true });

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: AuthUser; wallet: Wallet }>('/api/auth/me');
      setState({ user: data.user, wallet: data.wallet, loading: false });
    } catch {
      setState({ user: null, wallet: null, loading: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ user: AuthUser; wallet: Wallet }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setState({ user: data.user, wallet: data.wallet, loading: false });
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setState({ user: null, wallet: null, loading: false });
  }, []);

  const value = useMemo(
    () => ({ ...state, login, logout, refresh }),
    [state, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
