// src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getUser } from '../utils/getUser';

const AuthContext = createContext();

const inheritedRoles = {
  developer: ['admin', 'manager', 'team leader', 'senior', 'declarant', 'arrivals agent', 'administrator', 'operator', 'user', 'authenticated'],
  admin: ['manager', 'team leader', 'senior', 'declarant', 'arrivals agent', 'administrator', 'operator', 'user', 'authenticated'],
  manager: ['team leader', 'senior', 'declarant', 'arrivals agent', 'user', 'authenticated'],
  'team leader': ['senior', 'declarant', 'user', 'authenticated'],
  senior: ['declarant', 'user', 'authenticated'],
};

function expandRoles(roles) {
  const expanded = new Set((roles || []).map((role) => String(role).toLowerCase()));
  const queue = [...expanded];

  while (queue.length > 0) {
    const current = queue.shift();
    const implied = inheritedRoles[current] || [];
    for (const role of implied) {
      if (!expanded.has(role)) {
        expanded.add(role);
        queue.push(role);
      }
    }
  }

  return expanded;
}

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
  const effectiveRoles = useMemo(() => expandRoles(roles), [roles]);
  const isAuthenticated = !!user;

  const hasRole = role => {
    if (!role) return false;
    if (role === 'public') return true;
    if (role === 'authenticated') return isAuthenticated;
    return effectiveRoles.has(role.toLowerCase());
  };

  return (
    <AuthContext.Provider value={{ user, roles, effectiveRoles: [...effectiveRoles], loading, isAuthenticated, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
