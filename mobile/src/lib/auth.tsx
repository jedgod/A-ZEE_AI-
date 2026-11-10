import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler } from "./api";
import { clearToken, loadToken, saveToken } from "./storage";
import { clearIfDifferentAccount } from "./keyboard";
import { unlinkKeyboard } from "../../modules/azlinqext";

export type User = { id: string; name: string; email: string; verified?: boolean };

type AuthState = {
  loading: boolean;
  user: User | null;
  verified: boolean;
  signIn(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Re-reads the account (for example after the email was verified in the browser). */
  refresh(): Promise<void>;
  /** After the account was deleted on the server: forget the session on this device. */
  forget(): Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

type Session = { user: User; token?: string };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [verified, setVerified] = useState(false);

  // Signing out also erases the AZLinqext keyboard's credential on this device (the server ends it too, because it belongs to this session).
  const forget = useCallback(async () => { await unlinkKeyboard().catch(() => undefined); await clearToken(); setUser(null); setVerified(false); }, []);

  const refresh = useCallback(async () => {
    const token = await loadToken();
    if (!token) { setUser(null); setVerified(false); return; }
    try {
      const me = await api<{ user: User | null; verified: boolean }>("/api/auth/me", { token, skipUnauthorized: true });
      if (!me.user) { await clearToken(); setUser(null); setVerified(false); return; }
      setUser(me.user); setVerified(me.verified);
    } catch {
      // Offline at launch: keep the session; the next request will find out if it expired.
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { void forget(); });
    refresh().finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, [forget, refresh]);

  const start = useCallback(async (path: string, body: object) => {
    const session = await api<Session>(path, { method: "POST", body, token: null });
    if (!session.token) throw new Error("The server didn't return a session.");
    await clearIfDifferentAccount(session.user.id).catch(() => undefined); // account switching: never leave the last account's keyboard behind
    await saveToken(session.token);
    setUser(session.user); setVerified(session.user.verified === true);
  }, []);

  const value = useMemo<AuthState>(() => ({
    loading, user, verified,
    signIn: (email, password) => start("/api/auth/login", { email: email.trim(), password }),
    register: (name, email, password) => start("/api/auth/register", { name: name.trim(), email: email.trim(), password }),
    signOut: async () => { try { await api("/api/auth/logout", { method: "POST", skipUnauthorized: true }); } catch { /* sign out locally anyway */ } await forget(); },
    refresh, forget,
  }), [loading, user, verified, start, refresh, forget]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
