import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getMe, getToken, setToken } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Restore session from the stored token; listen for global 401s.
  useEffect(() => {
    let alive = true;

    if (!getToken()) {
      setLoading(false);
      return undefined;
    }
    getMe()
      .then((res) => {
        if (!alive) return;
        setUser(res.user);
        setPermissions(res.permissions || []);
      })
      .catch(() => {
        if (!alive) return;
        setToken('');
        setUser(null);
        setPermissions([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    const onUnauthorized = () => {
      if (!alive) return;
      setUser(null);
      setPermissions([]);
    };
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener('auth:unauthorized', onUnauthorized);
    };
  }, []);

  const login = useCallback(async (token) => {
    setToken(token);
    const res = await getMe();
    setUser(res.user);
    setPermissions(res.permissions || []);
  }, []);

  const logout = useCallback(() => {
    setToken('');
    setUser(null);
    setPermissions([]);
  }, []);

  const hasPerm = useCallback((perm) => permissions.includes(perm), [permissions]);

  const value = useMemo(
    () => ({
      user,
      permissions,
      loading,
      login,
      logout,
      hasPerm,
      isAdmin: permissions.includes('admin-config-read') || permissions.includes('user-manage-all'),
    }),
    [user, permissions, loading, login, logout, hasPerm],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
