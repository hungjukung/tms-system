import { createContext, useContext, useState, ReactNode } from "react";
import { AuthUser, LoginResponse } from "@tms/shared";
import { apiClient } from "../api/client";

interface AuthContextValue {
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function loadStoredUser(): AuthUser | null {
  const raw = sessionStorage.getItem("tms_user");
  return raw ? (JSON.parse(raw) as AuthUser) : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadStoredUser());

  async function login(username: string, password: string) {
    const res = await apiClient.post<LoginResponse>("/auth/login", { username, password });
    sessionStorage.setItem("tms_token", res.data.accessToken);
    sessionStorage.setItem("tms_user", JSON.stringify(res.data.user));
    setUser(res.data.user);
  }

  function logout() {
    sessionStorage.removeItem("tms_token");
    sessionStorage.removeItem("tms_user");
    setUser(null);
  }

  function updateUser(updated: AuthUser) {
    sessionStorage.setItem("tms_user", JSON.stringify(updated));
    setUser(updated);
  }

  return <AuthContext.Provider value={{ user, login, logout, updateUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必須在 AuthProvider 內使用");
  return ctx;
}
