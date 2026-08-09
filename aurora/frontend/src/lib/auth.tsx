import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, getMe } from "./api";

type User = { id: number; username: string };

const AuthContext = createContext<{
  user: User | null;
  loading: boolean;
  refresh: () => void;
}>({ user: null, loading: true, refresh: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    const token = localStorage.getItem("aurora_token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    getMe(token)
      .then((u) => setUser({ id: u.id, username: u.username }))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
