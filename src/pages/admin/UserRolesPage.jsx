import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const USER_ROLES_API = '/api/user-roles';

const ALL_ROLES = [
  { id: 'developer',      label: 'Developer',     bg: 'bg-violet-50',  text: 'text-violet-700', border: 'border-violet-200' },
  { id: 'admin',          label: 'Admin',          bg: 'bg-red-50',     text: 'text-red-700',    border: 'border-red-200' },
  { id: 'manager',        label: 'Manager',        bg: 'bg-orange-50',  text: 'text-orange-700', border: 'border-orange-200' },
  { id: 'Administrator',  label: 'Administrator',  bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200' },
  { id: 'Team Leader',    label: 'Team Leader',    bg: 'bg-teal-50',    text: 'text-teal-700',   border: 'border-teal-200' },
  { id: 'Senior',         label: 'Senior',         bg: 'bg-sky-50',     text: 'text-sky-700',    border: 'border-sky-200' },
  { id: 'Arrivals Agent', label: 'Arrivals Agent', bg: 'bg-green-50',   text: 'text-green-700',  border: 'border-green-200' },
];

const roleById = Object.fromEntries(ALL_ROLES.map(r => [r.id, r]));

function RoleBadge({ roleId }) {
  const r = roleById[roleId];
  const base = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border';
  if (!r) return <span className={`${base} bg-gray-50 text-gray-600 border-gray-200`}>{roleId}</span>;
  return <span className={`${base} ${r.bg} ${r.text} ${r.border}`}>{r.label}</span>;
}

// ─── Role selector used in both Add form and Edit drawer ─────────────────────
function RoleSelector({ selected, onChange }) {
  const toggle = (id) =>
    onChange(selected.includes(id) ? selected.filter(r => r !== id) : [...selected, id]);

  return (
    <div className="grid grid-cols-2 gap-2">
      {ALL_ROLES.map(role => {
        const active = selected.includes(role.id);
        return (
          <button
            key={role.id}
            type="button"
            onClick={() => toggle(role.id)}
            className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-sm font-medium transition-all text-left
              ${active
                ? `${role.bg} ${role.text} ${role.border}`
                : 'bg-white text-text-muted border-border hover:border-gray-400 hover:text-text-primary'
              }`}
          >
            <span>{role.label}</span>
            <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors
              ${active ? 'bg-primary border-primary' : 'border-gray-300'}`}
            >
              {active && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10">
                  <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Edit Drawer ──────────────────────────────────────────────────────────────
function EditDrawer({ user, onSave, onClose, saving }) {
  const [selected, setSelected] = useState(user.roles);
  const dirty = useMemo(
    () => JSON.stringify([...selected].sort()) !== JSON.stringify([...user.roles].sort()),
    [selected, user.roles]
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex justify-end"
    >
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="relative w-full max-w-sm bg-white h-full shadow-2xl flex flex-col border-l border-border"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Editing roles for</p>
              <p className="font-bold text-text-primary text-sm break-all">{user.email}</p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 text-xs font-semibold text-text-muted hover:text-text-primary border border-border px-2.5 py-1 rounded transition-colors"
            >
              Close
            </button>
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border">
              {selected.map(r => <RoleBadge key={r} roleId={r} />)}
            </div>
          )}
        </div>

        {/* Role grid */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-3">Select Roles</p>
          <RoleSelector selected={selected} onChange={setSelected} />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-semibold text-text-muted bg-gray-50 hover:bg-gray-100 border border-border rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(user.email, selected)}
            disabled={saving || !dirty}
            className="flex-1 py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function UserRolesPage() {
  const [users, setUsers]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [search, setSearch]         = useState('');
  const [roleFilter, setRoleFilter] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [savingEmail, setSavingEmail] = useState(null);
  const [deletingEmail, setDeletingEmail] = useState(null);
  const [toast, setToast]           = useState(null);
  const [sortField, setSortField]   = useState('email');
  const [sortAsc, setSortAsc]       = useState(true);

  // Add user form
  const [newEmail, setNewEmail]     = useState('');
  const [newRoles, setNewRoles]     = useState([]);
  const [addError, setAddError]     = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(USER_ROLES_API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Unknown error');
      setUsers(json.users);
    } catch (err) {
      setError('Could not load users: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  // ── Add new user ────────────────────────────────────────────────────────
  const handleAdd = async (e) => {
    e.preventDefault();
    setAddError('');
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) { setAddError('Enter a valid email address.'); return; }
    if (newRoles.length === 0) { setAddError('Select at least one role.'); return; }
    if (users.find(u => u.email === email)) { setAddError('This user already exists.'); return; }

    setAddLoading(true);
    try {
      const res = await fetch(`${USER_ROLES_API}/${encodeURIComponent(email)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: newRoles }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers(prev => [...prev, { email, roles: newRoles, updated_at: new Date().toISOString() }]);
      setNewEmail('');
      setNewRoles([]);
      showToast(`${email} added`);
    } catch (err) {
      setAddError('Failed to add user: ' + err.message);
    } finally {
      setAddLoading(false);
    }
  };

  // ── Save edited roles ───────────────────────────────────────────────────
  const handleSave = async (email, roles) => {
    setSavingEmail(email);
    try {
      const res = await fetch(`${USER_ROLES_API}/${encodeURIComponent(email)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers(prev => prev.map(u => u.email === email ? { ...u, roles } : u));
      setEditingUser(null);
      showToast(`Updated ${email}`);
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error');
    } finally {
      setSavingEmail(null);
    }
  };

  // ── Delete user ─────────────────────────────────────────────────────────
  const handleDelete = async (email) => {
    if (!window.confirm(`Remove ${email} from the access list?`)) return;
    setDeletingEmail(email);
    try {
      const res = await fetch(`${USER_ROLES_API}/${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers(prev => prev.filter(u => u.email !== email));
      showToast(`${email} removed`);
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error');
    } finally {
      setDeletingEmail(null);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) setSortAsc(v => !v);
    else { setSortField(field); setSortAsc(true); }
  };

  // ── Stats ────────────────────────────────────────────────────────────────
  const roleCounts = useMemo(() => {
    const counts = {};
    users.forEach(u => u.roles.forEach(r => { counts[r] = (counts[r] || 0) + 1; }));
    return counts;
  }, [users]);

  // ── Filtered + sorted ────────────────────────────────────────────────────
  const displayed = useMemo(() => {
    const q = search.toLowerCase();
    let list = users.filter(u => {
      const matchSearch = u.email.includes(q);
      const matchRole   = !roleFilter || u.roles.includes(roleFilter);
      return matchSearch && matchRole;
    });
    return [...list].sort((a, b) => {
      const va = sortField === 'roles' ? a.roles.length : a.email;
      const vb = sortField === 'roles' ? b.roles.length : b.email;
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ?  1 : -1;
      return 0;
    });
  }, [users, search, roleFilter, sortField, sortAsc]);

  const SortIndicator = ({ field }) => {
    if (sortField !== field) return <span className="text-gray-300 ml-1 text-xs">↕</span>;
    return <span className="text-primary ml-1 text-xs">{sortAsc ? '↑' : '↓'}</span>;
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)] bg-background p-6 gap-5">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-text-primary tracking-tight">User Access Control</h1>
          <p className="text-sm text-text-muted mt-1">Control which users can access the dashboard and what they can see</p>
        </div>
        <button
          onClick={fetchUsers}
          disabled={loading}
          className="text-sm font-semibold text-text-muted bg-surface border border-border px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* ── Stats ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Users',  value: users.length },
          { label: 'Developers',   value: roleCounts['developer'] || 0 },
          { label: 'Admins',       value: roleCounts['admin'] || 0 },
          { label: 'Managers',     value: (roleCounts['manager'] || 0) + (roleCounts['Administrator'] || 0) },
        ].map(c => (
          <div key={c.label} className="bg-surface border border-border rounded-xl p-5">
            <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-2">{c.label}</p>
            <p className="text-3xl font-black text-text-primary">{c.value}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="text-sm text-error bg-red-50 border border-red-200 px-4 py-3 rounded-lg">{error}</div>
      )}

      {/* ── Add user panel ───────────────────────────────────────────────── */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <h2 className="text-sm font-bold text-text-primary mb-4">Add New User</h2>
        <form onSubmit={handleAdd} className="flex flex-col gap-4">
          <div className="flex gap-3 items-start">
            <div className="flex-1">
              <input
                type="email"
                placeholder="user@dkm-customs.com"
                value={newEmail}
                onChange={e => { setNewEmail(e.target.value); setAddError(''); }}
                className="w-full px-3.5 py-2.5 border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-background"
              />
              {addError && <p className="text-xs text-error mt-1.5">{addError}</p>}
            </div>
            <button
              type="submit"
              disabled={addLoading}
              className="shrink-0 px-5 py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-dark disabled:opacity-40 rounded-lg transition-colors"
            >
              {addLoading ? 'Adding…' : 'Add User'}
            </button>
          </div>
          <div>
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Roles for new user</p>
            <RoleSelector selected={newRoles} onChange={setNewRoles} />
          </div>
        </form>
      </div>

      {/* ── Table card ───────────────────────────────────────────────────── */}
      <div className="bg-surface border border-border rounded-xl flex flex-col flex-1 overflow-hidden">

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-border">
          <input
            type="text"
            placeholder="Search by email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 px-3.5 py-2 border border-border rounded-lg text-sm placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-background"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setRoleFilter(null)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all ${
                !roleFilter ? 'bg-primary text-white border-primary' : 'bg-surface text-text-muted border-border hover:border-gray-400'
              }`}
            >
              All
            </button>
            {ALL_ROLES.map(r => (
              <button
                key={r.id}
                onClick={() => setRoleFilter(prev => prev === r.id ? null : r.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all ${
                  roleFilter === r.id
                    ? `${r.bg} ${r.text} ${r.border}`
                    : 'bg-surface text-text-muted border-border hover:border-gray-400'
                }`}
              >
                {r.label}
                {roleCounts[r.id] ? <span className="ml-1 opacity-50">{roleCounts[r.id]}</span> : null}
              </button>
            ))}
          </div>
        </div>

        {/* Count */}
        <div className="px-4 py-2 bg-gray-50 border-b border-border text-xs text-text-muted">
          <span className="font-semibold text-text-primary">{displayed.length}</span> of{' '}
          <span className="font-semibold text-text-primary">{users.length}</span> users
          {roleFilter && <span className="ml-2 text-primary font-semibold">· {roleFilter}</span>}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-text-muted text-sm">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider w-10">#</th>
                  <th
                    className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary select-none"
                    onClick={() => handleSort('email')}
                  >
                    Email <SortIndicator field="email" />
                  </th>
                  <th
                    className="px-4 py-3 text-left text-[11px] font-bold text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-primary select-none"
                    onClick={() => handleSort('roles')}
                  >
                    Roles <SortIndicator field="roles" />
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold text-text-muted uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayed.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-16 text-text-muted text-sm">
                      {users.length === 0 ? 'No users added yet. Use the form above to add your first user.' : 'No users match the current filter.'}
                    </td>
                  </tr>
                ) : (
                  displayed.map((user, idx) => (
                    <tr key={user.email} className="hover:bg-gray-50/60 group transition-colors">
                      <td className="px-4 py-3.5 text-xs text-text-muted font-mono">{idx + 1}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                            {user.email.substring(0, 2).toUpperCase()}
                          </div>
                          <span className="font-medium text-text-primary">{user.email}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {user.roles.length === 0 ? (
                          <span className="text-xs text-text-muted opacity-40 italic">No roles</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {user.roles.map(r => <RoleBadge key={r} roleId={r} />)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditingUser(user)}
                            className="text-xs font-semibold text-primary hover:text-primary-dark border border-primary/30 hover:border-primary px-3 py-1.5 rounded-md transition-all"
                          >
                            Edit roles
                          </button>
                          <button
                            onClick={() => handleDelete(user.email)}
                            disabled={deletingEmail === user.email}
                            className="text-xs font-semibold text-text-muted hover:text-error border border-border hover:border-red-200 px-3 py-1.5 rounded-md transition-all disabled:opacity-40"
                          >
                            {deletingEmail === user.email ? '…' : 'Remove'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Edit Drawer ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {editingUser && (
          <EditDrawer
            user={editingUser}
            onSave={handleSave}
            onClose={() => setEditingUser(null)}
            saving={savingEmail === editingUser?.email}
          />
        )}
      </AnimatePresence>

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold text-white z-[60]
              ${toast.type === 'error' ? 'bg-error' : 'bg-primary'}`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
