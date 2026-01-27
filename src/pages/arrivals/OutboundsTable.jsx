import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Package,
  FileText,
  AlertCircle,
  RefreshCw,
  CheckCircle,
  XCircle,
  ArrowUp,
  ArrowDown,
  Plus,
  X,
  Search,
  Trash2
} from 'lucide-react';
import { getMasterRecords, addOutbound, deleteOutbound } from '../../api/api';
import { getTrackingRecords, addTrackingRecord } from '../../api/trackingApi';
import { useAuth } from '../../context/AuthContext';
import PremiumConfirmationModal from '../../components/PremiumConfirmationModal';

const OutboundsTable = () => {
  const { mrn } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    mrn: '',
    nombre_total_des_conditionnements: '',
    type_de_declaration: 'IM',
    document_precedent: '',
    document_d_accompagnement: '',
    numero_de_reference: '',
    date_acceptation: ''
  });
  const [formError, setFormError] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [outboundToDelete, setOutboundToDelete] = useState(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [isSuccessState, setIsSuccessState] = useState(false);
  const { user, hasRole } = useAuth();

  // ✨ React Query - Uses cached data from ArrivalsTable (NO API CALL if cached!)
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['arrivals'],
    queryFn: getMasterRecords,
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000,
  });

  // Fetch tracking data for this MRN
  const { data: trackingRecords = [], refetch: refetchTracking } = useQuery({
    queryKey: ['tracking', mrn],
    queryFn: () => getTrackingRecords(mrn),
    staleTime: 30 * 1000,
  });

  // Mutation for approving "Needs Check"
  const approveMutation = useMutation({
    mutationFn: (note) => addTrackingRecord(mrn, {
      user: user?.name || 'Unknown User',
      action: 'approved',
      note: note || 'Manually approved by user',
      status: 'complete',
      timestamp: new Date().toISOString()
    }),
    onSuccess: async () => {
      setIsSuccessState(true);

      // Force immediate invalidation and refetch
      await queryClient.invalidateQueries({ queryKey: ['tracking', mrn] });
      await queryClient.invalidateQueries({ queryKey: ['arrivals'] });
      await queryClient.invalidateQueries({ queryKey: ['all_tracking'] });

      // Delay redirection to let user see the premium success state
      setTimeout(() => {
        navigate('/arrivals', { replace: true });
      }, 1500);
    },
    onError: (error) => {
      alert(`Failed to approve: ${error.message}`);
      setShowApproveModal(false);
    }
  });

  // Mutation for adding outbound
  const addOutboundMutation = useMutation({
    mutationFn: (outboundData) => addOutbound(mrn, outboundData),
    onSuccess: () => {
      // Invalidate and refetch arrivals data
      queryClient.invalidateQueries({ queryKey: ['arrivals'] });
      setShowAddForm(false);
      setFormData({
        mrn: '',
        nombre_total_des_conditionnements: '',
        type_de_declaration: 'IM',
        document_precedent: '',
        document_d_accompagnement: '',
        numero_de_reference: '',
        date_acceptation: ''
      });
      setFormError(null);
    },
    onError: (error) => {
      setFormError(error.message || 'Failed to add outbound. Please try again.');
    }
  });

  // Mutation for deleting outbound
  const deleteOutboundMutation = useMutation({
    mutationFn: ({ inboundMrn, outboundMrn }) => deleteOutbound(inboundMrn, outboundMrn),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrivals'] });
      setShowDeleteModal(false);
      setOutboundToDelete(null);
    },
    onError: (error) => {
      alert(`Failed to delete outbound: ${error.message}`);
    }
  });

  const arrivals = data?.records || [];
  const inboundData = arrivals.find(a => a.MRN === mrn);
  const outbounds = inboundData?.Outbounds || [];

  // Search state
  const [searchTerm, setSearchTerm] = useState('');

  // Sorting logic
  const filteredOutbounds = [...outbounds].filter(item => {
    if (!searchTerm) return true;
    const lowerTerm = searchTerm.toLowerCase();
    return (
      (item.mrn && item.mrn.toLowerCase().includes(lowerTerm)) ||
      (item.document_precedent && item.document_precedent.toLowerCase().includes(lowerTerm)) ||
      (item.numero_de_reference && item.numero_de_reference.toLowerCase().includes(lowerTerm)) ||
      (item.document_d_accompagnement && item.document_d_accompagnement.toLowerCase().includes(lowerTerm))
    );
  });

  const sortedOutbounds = filteredOutbounds.sort((a, b) => {
    if (!sortConfig.key) return 0; // No sorting if no key is selected

    const aValue = a[sortConfig.key] || '';
    const bValue = b[sortConfig.key] || '';

    // Check if the values are numeric (for packages, mass, etc.)
    const isNumeric = typeof aValue === 'number' && typeof bValue === 'number';

    let comparison = 0;
    if (aValue < bValue) {
      comparison = -1;
    } else if (aValue > bValue) {
      comparison = 1;
    }

    // Special handling for number sorting to ensure consistency
    if (isNumeric) {
      if (aValue < bValue) comparison = -1;
      if (aValue > bValue) comparison = 1;
    }

    return sortConfig.direction === 'asc' ? comparison : comparison * -1;
  });

  const handleSort = (key) => {
    setSortConfig((prevConfig) => ({
      key,
      direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  // Helper function to render the sort icon
  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return null;
    if (sortConfig.direction === 'asc') {
      return <ArrowUp className="w-3 h-3 ml-1" />;
    }
    return <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  const formatNumber = (num) => {
    return new Intl.NumberFormat('en-US').format(num || 0);
  };

  const handleRefresh = () => {
    refetch();
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text || '');
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;

    if (name === 'date_acceptation') {
      // Remove any non-digit characters
      const numbers = value.replace(/\D/g, '');
      let formatted = numbers;

      // Limit to 8 digits (DDMMYYYY)
      if (numbers.length > 8) return;

      if (numbers.length > 2) {
        formatted = `${numbers.slice(0, 2)}/${numbers.slice(2)}`;
      }
      if (numbers.length > 4) {
        formatted = `${formatted.slice(0, 5)}/${numbers.slice(4)}`;
      }

      setFormData(prev => ({
        ...prev,
        [name]: formatted
      }));
      setFormError(null);
      return;
    }

    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setFormError(null);
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (addOutboundMutation.isPending) return;
    setFormError(null);

    // Validation
    if (!formData.mrn.trim()) {
      setFormError('MRN is required');
      return;
    }
    if (!formData.nombre_total_des_conditionnements.trim()) {
      setFormError('Nombre total des conditionnements is required');
      return;
    }

    // Format document_precedent with inbound MRN if not already formatted
    let documentPrecedent = formData.document_precedent.trim();
    if (documentPrecedent && !documentPrecedent.includes(mrn)) {
      documentPrecedent = `N821 ${mrn}`;
    } else if (!documentPrecedent) {
      documentPrecedent = `N821 ${mrn}`;
    }

    const outboundData = {
      mrn: formData.mrn.trim(),
      nombre_total_des_conditionnements: formData.nombre_total_des_conditionnements.trim(),
      type_de_declaration: 'IM', // Always IM
      document_precedent: documentPrecedent,
      document_d_accompagnement: formData.document_d_accompagnement.trim() || '',
      numero_de_reference: formData.numero_de_reference.trim() || '',
      date_acceptation: formData.date_acceptation.trim() || ''
    };

    addOutboundMutation.mutate(outboundData);
  };

  const handleCancelForm = () => {
    setShowAddForm(false);
    setFormData({
      mrn: '',
      nombre_total_des_conditionnements: '',
      type_de_declaration: 'IM',
      document_precedent: '',
      document_d_accompagnement: '',
      numero_de_reference: '',
      date_acceptation: ''
    });
    setFormError(null);
  };

  // Permission check: Admin or Arrivals Agent can delete
  const canDeleteOutbound = () => {
    if (!user) return false;
    return hasRole('admin') || hasRole('Arrivals Agent');
  };

  // Check if deletion should be prevented (saldo = 0 for non-admins)
  const shouldPreventDeletion = (outbound) => {
    if (!user) return true;
    // Admins can delete even if saldo = 0
    if (hasRole('admin')) return false;
    // Non-admins cannot delete if saldo = 0 (complete)
    return inboundData?.saldo === 0;
  };

  const handleDeleteClick = (outbound) => {
    setOutboundToDelete(outbound);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = () => {
    if (!outboundToDelete) return;

    deleteOutboundMutation.mutate({
      inboundMrn: mrn,
      outboundMrn: outboundToDelete.mrn
    });
  };

  const handleCancelDelete = () => {
    setShowDeleteModal(false);
    setOutboundToDelete(null);
  };

  // Smart Suggestions: Detect issues and provide recommendations
  const getSmartSuggestions = () => {
    const suggestions = [];

    // Only show suggestions for error cases (saldo < 0 = over-declared)
    if (!inboundData || inboundData.saldo >= 0) return suggestions;

    // Detectduplicate outbounds (same packages but different MRNs)
    const packageGroups = {};
    outbounds.forEach((outbound, index) => {
      const packages = outbound.nombre_total_des_conditionnements;
      if (!packageGroups[packages]) {
        packageGroups[packages] = [];
      }
      packageGroups[packages].push({ ...outbound, index });
    });

    // Find duplicates (groups with more than 1 outbound)
    Object.entries(packageGroups).forEach(([packages, group]) => {
      if (group.length > 1) {
        // Sort by date (oldest first)
        const sorted = [...group].sort((a, b) => {
          const dateA = a.date_acceptation ? new Date(a.date_acceptation.split('/').reverse().join('-')) : new Date(0);
          const dateB = b.date_acceptation ? new Date(b.date_acceptation.split('/').reverse().join('-')) : new Date(0);
          return dateA - dateB;
        });

        const oldest = sorted[0];
        const newest = sorted[sorted.length - 1];

        suggestions.push({
          type: 'duplicate',
          severity: 'high',
          title: '🔍 Duplicate Detection',
          message: `Found ${group.length} outbounds with ${packages} packages. This suggests a replacement declaration.`,
          recommendation: `Delete the older outbound (${oldest.mrn}) - Customs likely sent a replacement due to verification.`,
          outboundToDelete: oldest,
          reason: 'Customs sends replacement declarations when there are suspicions or control requirements.'
        });
      }
    });

    return suggestions;
  };

  const suggestions = getSmartSuggestions();

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && showAddForm) {
        handleCancelForm();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showAddForm]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center max-w-md bg-surface p-8 border border-border">
          <AlertCircle className="w-16 h-16 text-error mx-auto mb-4" />
          <h2 className="text-2xl font-semibold text-text-primary mb-2">Error Loading Data</h2>
          <p className="text-text-muted mb-6">{error.message}</p>
          <button
            onClick={() => navigate('/arrivals')}
            className="px-6 py-2 bg-primary text-white hover:bg-primary-dark transition-colors"
          >
            Back to Arrivals
          </button>
        </div>
      </div>
    );
  }

  // Calculate if "Needs Check" is active
  const hasDocPrecedentAlert = outbounds.some(outbound => {
    const docPrecedent = outbound.document_precedent || '';
    return docPrecedent.trim() && !docPrecedent.trim().startsWith('N821');
  });

  const isApproved = trackingRecords.some(r => r.action === 'approved');

  const handleApprove = () => {
    setShowApproveModal(true);
  };

  const confirmApprove = () => {
    approveMutation.mutate("Verified document format manually");
  };

  if (!inboundData) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center max-w-md bg-surface p-8 border border-border">
          <AlertCircle className="w-16 h-16 text-error mx-auto mb-4" />
          <h2 className="text-2xl font-semibold text-text-primary mb-2">Record Not Found</h2>
          <p className="text-text-muted mb-6">Inbound record with MRN {mrn} was not found.</p>
          <button
            onClick={() => navigate('/arrivals')}
            className="px-6 py-2 bg-primary text-white hover:bg-primary-dark transition-colors"
          >
            Back to Arrivals
          </button>
        </div>
      </div>
    );
  }

  // Calculate saldo status
  const saldoStatus = inboundData.saldo === 0
    ? { label: 'Complete', color: 'success', icon: CheckCircle }
    : inboundData.saldo > 0
      ? { label: 'Incomplete', color: 'error', icon: XCircle }
      : null;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto">

        {/* Back Button */}
        <button
          onClick={() => navigate('/arrivals')}
          className="flex items-center gap-2 text-text-muted hover:text-primary transition-colors mb-6 border border-border px-4 py-2 bg-surface hover:bg-gray-50"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Arrivals
        </button>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-semibold text-text-primary mb-1">
                Inbound Details
              </h1>
              <div className="flex items-center gap-3">
                <p className="text-text-muted">
                  MRN: {mrn}
                </p>
                <button
                  onClick={() => handleCopy(`N821 ${mrn}`, 'chain-copy')}
                  className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-xs text-text-muted hover:text-text-primary rounded transition-colors border border-gray-200"
                  title="Copy as Document Precedent format (N821 ...)"
                >
                  {copiedId === 'chain-copy' ? <CheckCircle className="w-3 h-3 text-success" /> : <FileText className="w-3 h-3" />}
                  {copiedId === 'chain-copy' ? 'Copied!' : 'Copy Chain'}
                </button>
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={isFetching}
              className="flex items-center gap-2 px-4 py-2 border border-border bg-surface hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
              {isFetching ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Inbound Info Card */}
        <div className="bg-surface border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Package className="w-5 h-5" />
            Inbound Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-text-muted uppercase mb-1">Declaration ID</p>
              <p className="font-medium text-text-primary">{inboundData?.DECLARATIONID || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted uppercase mb-1">Commercial Reference</p>
              <p className="font-medium text-text-primary">{inboundData?.COMMERCIALREFERENCE || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted uppercase mb-1">Message Status</p>
              <p className="font-medium text-text-primary">{inboundData?.MESSAGESTATUS || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted uppercase mb-1">Total Packages</p>
              <p className="font-medium text-text-primary">{formatNumber(inboundData?.TOTAL_PACKAGES)}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted uppercase mb-1">Gross Mass (kg)</p>
              <p className="font-medium text-text-primary">{formatNumber(Math.round(inboundData?.TOTAL_ITEM_GROSSMASS || 0))}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted uppercase mb-1">Net Mass (kg)</p>
              <p className="font-medium text-text-primary">{formatNumber(Math.round(inboundData?.TOTAL_ITEM_NETMASS || 0))}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted uppercase mb-1">Arrival Date</p>
              <p className="font-medium text-text-primary">{formatDate(inboundData?.ARR_NOT_DATETIME)}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted uppercase mb-1">Release Date</p>
              <p className="font-medium text-text-primary">{formatDate(inboundData?.GDSREL_DATETIME)}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted uppercase mb-1">Outbounds Count</p>
              <p className="font-medium text-text-primary">{outbounds.length}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted uppercase mb-1">Saldo</p>
              <p className={`font-semibold ${inboundData?.saldo === 0 ? 'text-success' :
                inboundData?.saldo > 0 ? 'text-error' :
                  'text-text-muted'
                }`}>
                {inboundData?.saldo !== undefined ? formatNumber(inboundData.saldo) : 'N/A'}
              </p>
            </div>
            {saldoStatus && !isApproved && (
              <div>
                <p className="text-xs text-text-muted uppercase mb-1">Status</p>
                <div className={`inline-flex items-center gap-1.5 px-2 py-1 border text-xs font-medium ${saldoStatus.color === 'success'
                  ? 'border-success text-success bg-green-50'
                  : 'border-error text-error bg-red-50'
                  }`}>
                  <saldoStatus.icon className="w-3.5 h-3.5" />
                  {saldoStatus.label}
                </div>
              </div>
            )}
            {isApproved && inboundData.saldo === 0 && (
              <div>
                <p className="text-xs text-text-muted uppercase mb-1">Status</p>
                <div className="inline-flex items-center gap-1.5 px-2 py-1 border border-success text-success bg-green-50 text-xs font-medium">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Complete (Approved)
                </div>
              </div>
            )}
            {hasDocPrecedentAlert && !isApproved && inboundData.saldo === 0 && (
              <div>
                <p className="text-xs text-text-muted uppercase mb-1">Action Required</p>
                <button
                  onClick={handleApprove}
                  disabled={approveMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded transition-colors shadow-sm"
                  title="Mark as complete despite document format alerts"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  {approveMutation.isPending ? 'Approving...' : 'Approve as Complete'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Outbounds Header */}
        <div className="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-text-primary flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Outbound Documents ({outbounds.length})
            </h2>
            <p className="text-text-muted text-sm mt-1">
              Documents extracted and linked to this arrival
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search documents..."
                className="pl-9 pr-4 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-64 transition-all"
              />
            </div>

            {inboundData?.saldo !== 0 && (
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white hover:bg-primary-dark transition-colors rounded-md shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Add Outbound
              </button>
            )}
          </div>
        </div>

        {/* Smart Suggestions Section - Only for Error Cases */}
        {suggestions.length > 0 && (
          <div className="mb-6 space-y-3">
            {suggestions.map((suggestion, idx) => (
              <div key={idx} className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-sm shadow-sm">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-grow">
                    <h4 className="font-bold text-amber-900 mb-1">{suggestion.title}</h4>
                    <p className="text-sm text-amber-800 mb-2">{suggestion.message}</p>

                    <div className="bg-white p-3 rounded-sm border border-amber-200 mb-2">
                      <p className="text-xs font-semibold text-gray-700 mb-1">💡 Recommendation:</p>
                      <p className="text-xs text-gray-800">{suggestion.recommendation}</p>
                      <p className="text-xs text-gray-600 mt-1 italic">{suggestion.reason}</p>
                    </div>

                    {canDeleteOutbound() && !shouldPreventDeletion(suggestion.outboundToDelete) && (
                      <button
                        onClick={() => handleDeleteClick(suggestion.outboundToDelete)}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-red-600 text-white hover:bg-red-700 rounded-sm transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete {suggestion.outboundToDelete.mrn.substring(0, 15)}...
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Outbound Modal */}
        {showAddForm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
          // onClick removed to prevent closing on outside click
          >
            <div
              className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Add New Outbound
                </h3>
                <button
                  onClick={handleCancelForm}
                  disabled={addOutboundMutation.isPending}
                  className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6">
                {formError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                    <AlertCircle className="w-4 h-4 inline mr-2" />
                    {formError}
                  </div>
                )}

                <form onSubmit={handleFormSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 1. MRN */}
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-1">
                        MRN <span className="text-error">*</span>
                      </label>
                      <input
                        type="text"
                        name="mrn"
                        value={formData.mrn}
                        onChange={handleFormChange}
                        required
                        className="w-full px-3 py-2 border border-border bg-white focus:outline-none focus:border-primary transition-colors"
                        placeholder="e.g., 25BEH1000001CADYR4"
                      />
                    </div>

                    {/* 2. Date d'acceptation */}
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-1">
                        Date d'acceptation
                      </label>
                      <input
                        type="text"
                        name="date_acceptation"
                        value={formData.date_acceptation}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-border bg-white focus:outline-none focus:border-primary transition-colors"
                        placeholder="DD/MM/YYYY"
                        maxLength={10}
                      />
                      <p className="text-xs text-text-muted mt-1">
                        Numbers only (DDMMYYYY)
                      </p>
                    </div>

                    {/* Packages (Kept required) */}
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-1">
                        Nombre total des conditionnements <span className="text-error">*</span>
                      </label>
                      <input
                        type="text"
                        name="nombre_total_des_conditionnements"
                        value={formData.nombre_total_des_conditionnements}
                        onChange={handleFormChange}
                        required
                        className="w-full px-3 py-2 border border-border bg-white focus:outline-none focus:border-primary transition-colors"
                        placeholder="e.g., 7"
                      />
                      {inboundData?.saldo > 0 && (
                        <button
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, nombre_total_des_conditionnements: String(inboundData.saldo) }))}
                          className="text-xs text-primary hover:text-primary-dark mt-1 hover:underline flex items-center gap-1"
                        >
                          <ArrowDown className="w-3 h-3" />
                          Use remaining ({inboundData.saldo})
                        </button>
                      )}

                      {/* Smart Status Prediction */}
                      {formData.nombre_total_des_conditionnements && !isNaN(formData.nombre_total_des_conditionnements) && (
                        <div className="mt-2 text-xs">
                          {(() => {
                            const inputVal = parseInt(formData.nombre_total_des_conditionnements) || 0;
                            const currentSaldo = inboundData?.saldo || 0;
                            const projected = currentSaldo - inputVal;

                            if (projected < 0) {
                              return (
                                <span className="flex items-center gap-1.5 text-red-600 font-medium bg-red-50 p-1.5 rounded">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  Warning: Over-declaring by {Math.abs(projected)}! (New Saldo: {projected})
                                </span>
                              );
                            } else if (projected === 0) {
                              return (
                                <span className="flex items-center gap-1.5 text-green-600 font-medium bg-green-50 p-1.5 rounded">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  Perfect match! This will complete the arrival.
                                </span>
                              );
                            } else {
                              return (
                                <span className="flex items-center gap-1.5 text-blue-600 font-medium bg-blue-50 p-1.5 rounded">
                                  <ArrowDown className="w-3.5 h-3.5" />
                                  Partial declaration. Remaining Saldo will be: {projected}
                                </span>
                              );
                            }
                          })()}
                        </div>
                      )}
                    </div>

                    {/* 3. Type de déclaration (Fixed to IM) */}
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-1">
                        Type de déclaration
                      </label>
                      <select
                        name="type_de_declaration"
                        value={formData.type_de_declaration}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-border bg-white focus:outline-none focus:border-primary transition-colors"
                        disabled // Disabled as it's always IM
                      >
                        <option value="IM">IM</option>
                      </select>
                    </div>

                    {/* 4. Numéro de référence */}
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-1">
                        Numéro de référence
                      </label>
                      <input
                        type="text"
                        name="numero_de_reference"
                        value={formData.numero_de_reference}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-border bg-white focus:outline-none focus:border-primary transition-colors"
                        placeholder="e.g., EMCU8612798-03"
                      />
                    </div>

                    {/* 5. Document d'accompagnement */}
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-1">
                        Document d'accompagnement
                      </label>
                      <input
                        type="text"
                        name="document_d_accompagnement"
                        value={formData.document_d_accompagnement}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-border bg-white focus:outline-none focus:border-primary transition-colors"
                        placeholder="e.g., N325 EMCU8612798-03"
                      />
                    </div>

                    {/* 6. Document précédent */}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-text-primary mb-1">
                        Document précédent
                      </label>
                      <input
                        type="text"
                        name="document_precedent"
                        value={formData.document_precedent}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-border bg-white focus:outline-none focus:border-primary transition-colors"
                        placeholder={`N821 ${mrn}`}
                      />
                      <p className="text-xs text-text-muted mt-1">
                        Leave empty to auto-generate: N821 {mrn}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                    <button
                      type="button"
                      onClick={handleCancelForm}
                      disabled={addOutboundMutation.isPending}
                      className="px-6 py-2 border border-border bg-surface hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={addOutboundMutation.isPending}
                      className="px-6 py-2 bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {addOutboundMutation.isPending ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Adding...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          Add Outbound
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Summary Info Bar - Moved Above Table */}
        {outbounds.length > 0 && (
          <div className="mb-4 px-6 py-4 bg-surface border border-border">
            <div className="flex items-center justify-between text-sm mb-2">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                <span className="font-semibold text-text-primary">
                  Total: {outbounds.length} outbound {outbounds.length === 1 ? 'document' : 'documents'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text-muted">Saldo:</span>
                <span className={`font-semibold ${inboundData?.saldo === 0 ? 'text-success' :
                  inboundData?.saldo > 0 ? 'text-error' :
                    'text-orange-600'
                  }`}>
                  {inboundData?.saldo !== undefined
                    ? `${formatNumber(Math.abs(inboundData.saldo))} ${inboundData.saldo > 0 ? 'packages remaining' :
                      inboundData.saldo < 0 ? 'packages over-declared' :
                        'complete'
                    }`
                    : 'N/A'}
                </span>
              </div>
            </div>

            {/* Visual Progress Bar */}
            {inboundData?.TOTAL_PACKAGES && (
              <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-2.5 rounded-full transition-all duration-500 ${inboundData.saldo === 0 ? 'bg-success' :
                    inboundData.saldo < 0 ? 'bg-orange-500' :
                      'bg-primary'
                    }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, ((inboundData.TOTAL_PACKAGES - (inboundData.saldo || 0)) / inboundData.TOTAL_PACKAGES) * 100))}%`
                  }}
                ></div>
              </div>
            )}
          </div>
        )}

        {/* Outbounds Table */}
        <div className="bg-surface border border-border">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  #
                </th>
                {/* Sortable Column: MRN */}
                <th
                  className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort('mrn')}
                >
                  <div className="flex items-center">
                    MRN
                    {getSortIcon('mrn')}
                  </div>
                </th>
                {/* Sortable Column: Nombre total des conditionnements */}
                <th
                  className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort('nombre_total_des_conditionnements')}
                >
                  <div className="flex items-center">
                    Nombre total des conditionnements
                    {getSortIcon('nombre_total_des_conditionnements')}
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Document précédent
                </th>
                {/* Sortable Column: Date d'acceptation */}
                <th
                  className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort('date_acceptation')}
                >
                  <div className="flex items-center">
                    Date d'acceptation
                    {getSortIcon('date_acceptation')}
                  </div>
                </th>
                {/* Sortable Column: Numéro de référence */}
                <th
                  className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort('numero_de_reference')}
                >
                  <div className="flex items-center">
                    Numéro de référence
                    {getSortIcon('numero_de_reference')}
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Type de déclaration
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Document d'accompagnement
                </th>
                {canDeleteOutbound() && (
                  <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedOutbounds.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-6 py-12 text-center">
                    <FileText className="w-12 h-12 text-text-muted mx-auto mb-3 opacity-50" />
                    <p className="text-text-muted mb-2">
                      {searchTerm ? 'No documents match your search.' : 'No outbound records found for this arrival.'}
                    </p>
                    <p className="text-sm text-text-muted">
                      {searchTerm ? 'Try adjusting your search terms.' : 'Outbound documents will appear here once processed.'}
                    </p>
                  </td>
                </tr>
              ) : (
                sortedOutbounds.map((outbound, index) => (
                  <tr key={index} className="border-b border-border hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-text-muted">
                      {index + 1}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-text-primary">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(outbound.mrn, `mrn-${index}`);
                        }}
                        className={`inline-block px-2 py-1 rounded transition-all duration-300 ${copiedId === `mrn-${index}`
                          ? 'bg-primary text-white'
                          : 'hover:bg-primary hover:text-white hover:shadow-sm'
                          }`}
                      >
                        {copiedId === `mrn-${index}` ? '✓ Copied!' : outbound.mrn || 'N/A'}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-sm text-text-primary">
                      {formatNumber(outbound.nombre_total_des_conditionnements || 0)}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-primary">
                      {outbound.document_precedent || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-primary">
                      {outbound.date_acceptation || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-primary">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(outbound.numero_de_reference, `ref-${index}`);
                        }}
                        className={`inline-block px-2 py-1 rounded transition-all duration-300 ${copiedId === `ref-${index}`
                          ? 'bg-primary text-white'
                          : 'hover:bg-primary hover:text-white hover:shadow-sm'
                          }`}
                      >
                        {copiedId === `ref-${index}` ? '✓ Copied!' : outbound.numero_de_reference || 'N/A'}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-sm text-text-primary">
                      {outbound.type_de_declaration || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-primary">
                      {outbound.document_d_accompagnement || 'N/A'}
                    </td>
                    {canDeleteOutbound() && (
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleDeleteClick(outbound)}
                          disabled={shouldPreventDeletion(outbound) || deleteOutboundMutation.isPending}
                          className={`p-2 rounded-sm transition-colors ${shouldPreventDeletion(outbound)
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'hover:bg-red-50 text-red-600 hover:text-red-700'
                            } ${deleteOutboundMutation.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
                          title={shouldPreventDeletion(outbound)
                            ? 'Cannot delete: Arrival is complete (saldo = 0). Only admins can delete from complete arrivals.'
                            : 'Delete outbound'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteModal && outboundToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
            <div className="bg-white border border-gray-200 shadow-xl w-full max-w-lg rounded-lg overflow-hidden">
              <div className="bg-red-50 border-b border-red-100 px-6 py-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-red-900 flex items-center gap-2">
                  <Trash2 className="w-5 h-5" />
                  Confirm Deletion
                </h3>
                <button
                  onClick={handleCancelDelete}
                  className="text-red-400 hover:text-red-600 transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 text-sm">
                  <p className="font-semibold text-gray-700 mb-2">Record details:</p>
                  <p><span className="text-gray-500">MRN:</span> {outboundToDelete.mrn}</p>
                  <p><span className="text-gray-500">Packages:</span> {formatNumber(outboundToDelete.nombre_total_des_conditionnements)}</p>
                </div>

                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm">
                  <p className="font-bold text-blue-900 mb-2">Saldo Impact:</p>
                  <div className="flex justify-between mb-1">
                    <span className="text-blue-700">Current:</span>
                    <span className="font-mono font-bold">{formatNumber(inboundData?.saldo || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-700">New:</span>
                    <span className="font-mono font-bold text-blue-900">
                      {formatNumber((inboundData?.saldo || 0) + parseInt(outboundToDelete.nombre_total_des_conditionnements || 0))}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-red-600 font-medium text-center italic">
                  * This action cannot be reversed.
                </p>
              </div>

              <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t border-gray-100">
                <button
                  onClick={handleCancelDelete}
                  className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={deleteOutboundMutation.isPending}
                  className="px-6 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-all shadow-lg shadow-red-100 flex items-center gap-2"
                >
                  {deleteOutboundMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  {deleteOutboundMutation.isPending ? 'Deleting...' : 'Delete Permanently'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Premium Approval Modal */}
        <PremiumConfirmationModal
          isOpen={showApproveModal}
          onClose={() => setShowApproveModal(false)}
          onConfirm={confirmApprove}
          title="Manual Verification"
          message={`Confirm manual authorization for MRN ${mrn}. This action validates the document sequence and updates the system status to authorized/complete.`}
          confirmText="Authorize Release"
          cancelText="Abort"
          type="info"
          isLoading={approveMutation.isPending}
          isSuccess={isSuccessState}
          successMessage="File approved! Returning to Arrivals..."
        />
      </div>
    </div>
  );
};

export default OutboundsTable;


