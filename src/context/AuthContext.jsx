// src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getUser } from '../utils/getUser';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUser().then(u => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const roles = useMemo(() => user?.roles || [], [user]);
  const isAuthenticated = !!user;

  const hasRole = role => {
    if (!role) return false;
    if (role === 'public') return true;
    if (role === 'authenticated') return isAuthenticated;

    // Developer is the master of the dashboard and has access to all roles
    const userRoleLower = roles.map(r => r.toLowerCase());
    if (userRoleLower.includes('developer')) return true;

    return userRoleLower.includes(role.toLowerCase());
  };

  return (
    <AuthContext.Provider value={{ user, roles, loading, isAuthenticated, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
