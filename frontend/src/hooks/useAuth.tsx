import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, setUnauthorizedHandler, tokenStore } from "../services/api";
import { authApi } from "../services/endpoints";
import type { TokenResponse, User } from "../types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  register: (data: { email: string; full_name: string; password: string; preferred_language: string }) => Promise<void>;
  signInWith: (result: TokenResponse, remember?: boolean) => void;
  logout: () => void;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const restore = async (attempt: number) => {
      try {
        const me = await authApi.me();
        if (!cancelled) setUser(me);
      } catch (err) {
        // Only an explicit rejection ends the session; a backend restart or network blip is retried.
        if (err instanceof ApiError && err.status !== 0 && err.status < 500) {
          tokenStore.clear();
        } else if (attempt < 5 && !cancelled) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          return restore(attempt + 1);
        }
      }
      if (!cancelled) setLoading(false);
    };
    restore(0);
    return () => {
      cancelled = true;
    };
  }, [logout]);

  const signInWith = useCallback((result: TokenResponse, remember = true) => {
    tokenStore.set(result.access_token, remember);
    setUser(result.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string, remember = true) => signInWith(await authApi.login(email, password), remember),
    [signInWith],
  );

  const register = useCallback(
    async (data: { email: string; full_name: string; password: string; preferred_language: string }) =>
      signInWith(await authApi.register(data)),
    [signInWith],
  );

  const value = useMemo(
    () => ({ user, loading, login, register, signInWith, logout, setUser }),
    [user, loading, login, register, signInWith, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export const isStaff = (user: User | null) => user?.role === "staff" || user?.role === "admin";
export const isAdmin = (user: User | null) => user?.role === "admin";
