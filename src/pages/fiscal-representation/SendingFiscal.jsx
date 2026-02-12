import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Plus,
  Trash2,
  Pencil,
  Search,
  RefreshCw,
  CheckCircle,
  X,
  AlertCircle,
  Save,
  Landmark,
  Building2,
} from 'lucide-react';
import { getPrincipals, addPrincipal, updatePrincipal, deletePrincipal } from '../../api/fiscalApi';
import PremiumConfirmationModal from '../../components/PremiumConfirmationModal';

const SendingFiscal = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [newName, setNewName] = useState('');
  const [editingIndex, setEditingIndex] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleteSuccess, setIsDeleteSuccess] = useState(false);
  const [addSuccess, setAddSuccess] = useState(null);
  const queryClient = useQueryClient();

  const { data: principals = [], isLoading, error, isFetching } = useQuery({
    queryKey: ['principals'],
    queryFn: getPrincipals,
    staleTime: 30 * 1000,
  });

  const addMutation = useMutation({
    mutationFn: addPrincipal,
    onSuccess: async (_, name) => {
      await queryClient.invalidateQueries({ queryKey: ['principals'] });
      setAddSuccess(name);
      setNewName('');
      setTimeout(() => setAddSuccess(null), 2000);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ oldName, newName }) => updatePrincipal(oldName, newName),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['principals'] });
      setEditingIndex(null);
      setEditValue('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deletePrincipal,
    onSuccess: async () => {
      setIsDeleteSuccess(true);
      await queryClient.invalidateQueries({ queryKey: ['principals'] });
      setTimeout(() => {
        setShowDeleteModal(false);
        setIsDeleteSuccess(false);
        setDeleteTarget(null);
      }, 1200);
    },
  });

  const handleAdd = (e) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (principals.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
      alert('This principal already exists.');
      return;
    }
    addMutation.mutate(trimmed);
  };

  const handleUpdate = (oldName) => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === oldName) {
      setEditingIndex(null);
      return;
    }
    if (principals.some(p => p.toLowerCase() === trimmed.toLowerCase() && p !== oldName)) {
      alert('A principal with this name already exists.');
      return;
    }
    updateMutation.mutate({ oldName, newName: trimmed });
  };

  const handleDeleteClick = (name) => {
    setDeleteTarget(name);
    setIsDeleteSuccess(false);
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    if (deleteTarget) deleteMutation.mutate(deleteTarget);
  };

  const startEditing = (index, currentName) => {
    setEditingIndex(index);
    setEditValue(currentName);
  };

  const cancelEditing = () => {
    setEditingIndex(null);
    setEditValue('');
  };

  const filtered = principals.filter(p =>
    p.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center">
            <RefreshCw className="w-7 h-7 text-primary animate-spin" />
          </div>
          <div className="text-center">
            <p className="text-text-primary font-medium text-sm">Loading principals</p>
            <p className="text-text-muted text-xs mt-1">Connecting to Azure Storage...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="text-center max-w-sm bg-white p-8 border border-border rounded-xl shadow-sm">
          <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-7 h-7 text-error" />
          </div>
          <h2 className="text-lg font-bold text-text-primary mb-1">Connection Failed</h2>
          <p className="text-text-muted text-sm mb-6 leading-relaxed">{error.message}</p>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['principals'] })}
            className="px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-dark transition-colors inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto">

        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
              <Landmark className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-primary">Fiscal Representation</h1>
              <p className="text-text-muted text-xs">Manage principal companies for sending fiscal documents</p>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white border border-border rounded-xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{principals.length}</p>
              <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide">Total Principals</p>
            </div>
          </div>
          <div className="bg-white border border-border rounded-xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{filtered.length}</p>
              <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide">
                {searchTerm ? 'Matching Results' : 'Active Principals'}
              </p>
            </div>
          </div>
          <div className="bg-white border border-border rounded-xl p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isFetching ? 'bg-amber-50' : 'bg-gray-50'}`}>
              {isFetching ? (
                <RefreshCw className="w-5 h-5 text-amber-600 animate-spin" />
              ) : (
                <CheckCircle className="w-5 h-5 text-gray-400" />
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-text-primary">{isFetching ? 'Syncing...' : 'Synced'}</p>
              <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide">Azure Storage</p>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="bg-white border border-border rounded-xl p-4 mb-4 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Add Form */}
            <form onSubmit={handleAdd} className="flex gap-2 flex-1">
              <div className="relative flex-1">
                <Plus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Enter new principal name..."
                  className="w-full pl-9 pr-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all placeholder:text-gray-400"
                />
              </div>
              <button
                type="submit"
                disabled={addMutation.isPending || !newName.trim()}
                className="px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-sm shadow-primary/20"
              >
                {addMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : addSuccess ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                {addMutation.isPending ? 'Adding...' : addSuccess ? 'Added!' : 'Add Principal'}
              </button>
            </form>

            {/* Divider */}
            <div className="hidden sm:block w-px bg-border" />

            {/* Search */}
            <div className="relative sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search principals..."
                className="w-full pl-9 pr-8 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all placeholder:text-gray-400"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Success toast */}
          {addSuccess && (
            <div className="mt-3 flex items-center gap-2 text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-xs font-medium animate-in fade-in slide-in-from-top-1">
              <CheckCircle className="w-3.5 h-3.5" />
              "{addSuccess}" has been added to the principals list.
            </div>
          )}
        </div>

        {/* Filter indicator */}
        {searchTerm && (
          <div className="flex items-center gap-2 mb-3 px-1">
            <span className="text-xs text-text-muted">
              Showing {filtered.length} of {principals.length} principals matching
            </span>
            <span className="text-xs font-semibold text-primary bg-primary/5 px-2 py-0.5 rounded-full">
              "{searchTerm}"
            </span>
          </div>
        )}

        {/* Principals Table */}
        <div className="bg-white border border-border rounded-xl overflow-hidden shadow-sm">
          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Users className="w-7 h-7 text-text-muted opacity-50" />
              </div>
              <p className="text-text-primary font-medium text-sm mb-1">
                {searchTerm ? 'No results found' : 'No principals yet'}
              </p>
              <p className="text-text-muted text-xs">
                {searchTerm
                  ? `No principals match "${searchTerm}". Try a different search.`
                  : 'Get started by adding your first principal above.'}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80">
                  <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider w-16">#</th>
                  <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider">Principal Name</th>
                  <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider w-36">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((name, index) => {
                  const globalIndex = principals.indexOf(name);
                  const isEditing = editingIndex === globalIndex;
                  const initial = name.charAt(0).toUpperCase();

                  return (
                    <tr
                      key={name}
                      className={`border-b border-gray-50 last:border-0 transition-all ${
                        isEditing ? 'bg-blue-50/40' : 'hover:bg-gray-50/60'
                      }`}
                    >
                      <td className="px-5 py-3">
                        <span className="text-[11px] text-text-muted font-mono">{String(index + 1).padStart(2, '0')}</span>
                      </td>
                      <td className="px-5 py-3">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdate(name);
                                if (e.key === 'Escape') cancelEditing();
                              }}
                              autoFocus
                              className="flex-1 px-3 py-1.5 border-2 border-primary rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                            />
                            <button
                              onClick={() => handleUpdate(name)}
                              disabled={updateMutation.isPending}
                              className="px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-1"
                            >
                              {updateMutation.isPending ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Save className="w-3 h-3" />
                              )}
                              Save
                            </button>
                            <button
                              onClick={cancelEditing}
                              className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-primary/8 border border-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-primary">{initial}</span>
                            </div>
                            <span className="text-sm text-text-primary font-medium">{name}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {!isEditing && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => startEditing(globalIndex, name)}
                              className="p-2 text-text-muted hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                              title="Edit principal"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteClick(name)}
                              className="p-2 text-text-muted hover:text-error hover:bg-red-50 rounded-lg transition-all"
                              title="Delete principal"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Table Footer */}
          {filtered.length > 0 && (
            <div className="px-5 py-3 bg-gray-50/50 border-t border-gray-100 flex items-center justify-between">
              <span className="text-[11px] text-text-muted">
                {filtered.length} principal{filtered.length !== 1 ? 's' : ''} listed
              </span>
              <span className="text-[11px] text-text-muted flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                Stored on Azure Blob Storage
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <PremiumConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setDeleteTarget(null); }}
        onConfirm={confirmDelete}
        title="Delete Principal"
        message={`Are you sure you want to remove "${deleteTarget}" from the principals list? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        type="warning"
        isLoading={deleteMutation.isPending}
        isSuccess={isDeleteSuccess}
        successMessage={`"${deleteTarget}" has been removed.`}
      />
    </div>
  );
};

export default SendingFiscal;
