import { useState, useEffect, useMemo } from 'react';
import { Shield, Search, Save, RefreshCw, Loader2, X, Check, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const AZURE_USERS_API = '/api/users/azure';
const USER_ROLES_API = '/api/user-roles';
const AZURE_CACHE_KEY = 'azure_users_cache_v1';
const AZURE_CACHE_TTL = 24 * 60 * 60 * 1000;

const ALL_ROLES = [
  { id: 'developer',      label: 'Developer',      color: 'bg-purple-100 text-purple-800 border-purple-200' },
  { id: 'admin',          label: 'Admin',           color: 'bg-red-100 text-red-800 border-red-200' },
  { id: 'manager',        label: 'Manager',         color: 'bg-orange-100 text-orange-800 border-orange-200' },
  { id: 'Administrator',  label: 'Administrator',   color: 'bg-blue-100 text-blue-800 border-blue-200' },
  { id: 'Team Leader',    label: 'Team Leader',     color: 'bg-teal-100 text-teal-800 border-teal-200' },
  { id: 'Senior',         label: 'Senior',          color: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
  { id: 'Arrivals Agent', label: 'Arrivals Agent',  color: 'bg-green-100 text-green-800 border-green-200' },
];

const roleColorMap = Object.fromEntries(ALL_ROLES.map(r => [r.id, r.color]));

function RoleBadge({ role }) {
  const color = roleColorMap[role] || 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${color}`}>
      {role}
    </span>
  );
}

function UserRow({ user, dbRoles, onSave, saving }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(dbRoles);
  const [dirty, setDirty] = useState(false);

  // Sync if parent data changes (e.g. after refresh)
  useEffect(() => {
    setSelected(dbRoles);
    setDirty(false);
  }, [dbRoles]);

  const toggleRole = (roleId) => {
    setSelected(prev => {
      const next = prev.includes(roleId) ? prev.filter(r => r !== roleId) : [...prev, roleId];
      setDirty(JSON.stringify(next.sort()) !== JSON.stringify(dbRoles.slice().sort()));
      return next;
    });
  };

  const handleSave = async () => {
    await onSave(user.email, selected);
    setDirty(false);
  };

  const handleCancel = () => {
    setSelected(dbRoles);
    setDirty(false);
    setExpanded(false);
  };

  return (
    <div className={`border rounded-lg bg-white transition-shadow ${expanded ? 'shadow-md border-blue-200' : 'border-gray-200 hover:border-gray-300'}`}>
      {/* Row header */}
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
          {user.email.substring(0, 2).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{user.email}</p>
          {user.name && <p className="text-xs text-gray-400 truncate">{user.name}</p>}
        </div>

        <div className="flex flex-wrap gap-1.5 justify-end flex-1">
          {selected.length === 0 ? (
            <span className="text-xs text-gray-400 italic">No roles</span>
          ) : (
            selected.map(r => <RoleBadge key={r} role={r} />)
          )}
        </div>

        <div className="shrink-0 ml-2 text-gray-400">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Expanded editor */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-gray-100 pt-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Assign Roles</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {ALL_ROLES.map(role => {
                  const active = selected.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      onClick={() => toggleRole(role.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all
                        ${active
                          ? `${role.color} shadow-sm`
                          : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-400'
                        }`}
                    >
                      {active && <Check size={11} strokeWidth={3} />}
                      {role.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCancel}
                  className="px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function UserRolesPage() {
  const [azureUsers, setAzureUsers] = useState([]);
  const [dbRolesMap, setDbRolesMap] = useState({}); // email -> roles[]
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [savingEmail, setSavingEmail] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchAzureUsers = async (force = false) => {
    setLoadingUsers(true);
    try {
      if (!force) {
        const cached = localStorage.getItem(AZURE_CACHE_KEY);
        if (cached) {
          const { timestamp, data } = JSON.parse(cached);
          if (Date.now() - timestamp < AZURE_CACHE_TTL) {
            setAzureUsers(data);
            setLoadingUsers(false);
            return;
          }
        }
      }
      const res = await fetch(AZURE_USERS_API);
      if (!res.ok) throw new Error('Failed to fetch Azure users');
      const data = await res.json();
      if (data.status === 'success' && data.users) {
        const users = data.users.map(u => ({ email: u.usercode?.toLowerCase(), name: u.displayName || '' }));
        localStorage.setItem(AZURE_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: users }));
        setAzureUsers(users);
      }
    } catch (err) {
      setError('Could not load Azure users: ' + err.message);
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchDbRoles = async () => {
    setLoadingRoles(true);
    try {
      const res = await fetch(USER_ROLES_API);
      if (!res.ok) throw new Error('Failed to fetch roles');
      const data = await res.json();
      if (data.success) {
        const map = {};
        data.users.forEach(u => { map[u.email.toLowerCase()] = u.roles; });
        setDbRolesMap(map);
      }
    } catch (err) {
      setError('Could not load role data: ' + err.message);
    } finally {
      setLoadingRoles(false);
    }
  };

  useEffect(() => {
    fetchAzureUsers();
    fetchDbRoles();
  }, []);

  const handleSave = async (email, roles) => {
    setSavingEmail(email);
    try {
      const res = await fetch(`${USER_ROLES_API}/${encodeURIComponent(email)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles }),
      });
      if (!res.ok) throw new Error('Save failed');
      setDbRolesMap(prev => ({ ...prev, [email]: roles }));
      showToast(`Roles updated for ${email}`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingEmail(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return azureUsers.filter(u => u.email?.includes(q) || u.name?.toLowerCase().includes(q));
  }, [azureUsers, search]);

  const loading = loadingUsers || loadingRoles;

  return (
    <div className="p-4 md:p-8 w-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start mb-6 bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 flex items-center gap-3">
            <div className="bg-purple-50 p-2 rounded-lg">
              <Shield className="w-7 h-7 text-purple-600" />
            </div>
            User Access Control
          </h1>
          <p className="text-sm text-gray-500 mt-2">Assign roles to control what each user can access on the dashboard.</p>
        </div>
        <button
          onClick={() => { fetchAzureUsers(true); fetchDbRoles(); }}
          disabled={loading}
          className="flex items-center gap-2 text-sm font-semibold text-gray-600 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 px-4 py-3 rounded-lg">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by email or name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 text-xs text-gray-500 mb-4 px-1">
        <span><strong className="text-gray-700">{azureUsers.length}</strong> total users</span>
        <span><strong className="text-gray-700">{Object.keys(dbRolesMap).length}</strong> with assigned roles</span>
        {search && <span><strong className="text-gray-700">{filtered.length}</strong> matching</span>}
      </div>

      {/* User list */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Loader2 className="animate-spin w-8 h-8 mb-3" />
          <p className="text-sm">Loading users and roles...</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filtered.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">No users found.</div>
            ) : (
              filtered.map(user => (
                <motion.div
                  key={user.email}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <UserRow
                    user={user}
                    dbRoles={dbRolesMap[user.email] || []}
                    onSave={handleSave}
                    saving={savingEmail === user.email}
                  />
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white z-50
              ${toast.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}
          >
            {toast.type === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
