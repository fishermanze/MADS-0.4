import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authApi } from "../api/authApi";
import type { AuthResponse, LoginCredential, UserInfo } from "../types/auth";

function isUserInfo(raw: unknown): raw is UserInfo {
  if (!(raw !== null && typeof raw === "object")) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.username !== "string" || typeof r.role !== "string") {
    return false;
  }
  if ("mustSetPassword" in r && typeof r.mustSetPassword !== "boolean") return false;
  return true;
}
function normalizeAuthPayload(res: AuthResponse): AuthResponse {
  if (
    typeof res.accessToken !== "string" ||
    res.accessToken.length < 10 ||
    !isUserInfo(res.user)
  ) {
    throw new Error("无效的登录响应");
  }
  return res;
}

interface AuthState {
  user: UserInfo | null;
  loading: boolean;
  login: (credential: LoginCredential) => Promise<void>;
  logout: () => void;
  setUser: (u: UserInfo | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await authApi.me();
      if (!isUserInfo(me)) {
        throw new Error("无效的用户资料");
      }
      setUser(me);
    } catch {
      localStorage.removeItem("token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const login = useCallback(async (credential: LoginCredential) => {
    const res = normalizeAuthPayload(await authApi.login(credential));
    localStorage.setItem("token", res.accessToken);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      setUser,
    }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
