import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Package,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Clock,
  MessageSquare,
  Mail,
  Download, // Icon for export
  CheckSquare,
  Square,
  X, // Added for clear button
  FileSpreadsheet
} from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import ExportModal from '../../components/ExportModal';
import { getMasterRecords } from '../../api/api';
import { calculateDaysSinceRelease, getAllTrackingRecords, addBulkTrackingRecords } from '../../api/trackingApi';
import { useAuth } from '../../context/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import TrackingModal from '../../components/TrackingModal';

// Options pour le menu déroulant du filtre
const StatusFilterOptions = [
  { value: 'all', label: 'All Statuses' },
  { value: 'complete', label: 'Complete', color: 'text-success' },
  { value: 'error', label: 'Error', color: 'text-error' },
  { value: 'waiting', label: 'Waiting for Outbounds', color: 'text-blue-700' },
  { value: 'unknown', label: 'Unknown', color: 'text-warning' },
];

const ArrivalsTable = () => {
  // Initialize state from sessionStorage or defaults
  const [searchTerm, setSearchTerm] = useState(() => {
    return sessionStorage.getItem('arrivals_searchTerm') || '';
  });
  const [statusFilter, setStatusFilter] = useState(() => {
    return sessionStorage.getItem('arrivals_statusFilter') || 'all';
  });
  const [currentPage, setCurrentPage] = useState(() => {
    const saved = sessionStorage.getItem('arrivals_currentPage');
    return saved ? parseInt(saved, 10) : 1;
  });
  const [copiedId, setCopiedId] = useState(null);
  const [trackingModalOpen, setTrackingModalOpen] = useState(false);
  const [selectedArrival, setSelectedArrival] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]); // Array of selected MRNs
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkNote, setBulkNote] = useState('');
  const [exportModal, setExportModal] = useState({ isOpen: false, scope: 'all' });
  const [isExporting, setIsExporting] = useState(false);

  // Date Filters
  const [startDate, setStartDate] = useState(() => sessionStorage.getItem('arrivals_startDate') || '');
  const [endDate, setEndDate] = useState(() => sessionStorage.getItem('arrivals_endDate') || '');

  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const rowsPerPage = 8;

  // Track if this is the initial mount
  const isInitialMount = React.useRef(true);

  // Configuration de React Query pour la récupération des données
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['arrivals'],
    queryFn: getMasterRecords,
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000, // Refresh every 15 minutes
  });

  // Fetch all tracking records
  const { data: trackingData = [], refetch: refetchTracking } = useQuery({
    queryKey: ['all_tracking'],
    queryFn: getAllTrackingRecords,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const arrivals = data?.records || [];


  // Helper to find latest check for an MRN
  const getLatestTrackingInfo = (mrn) => {
    if (!trackingData || !Array.isArray(trackingData)) return null;

    // Normalize MRN for comparison (trim whitespace and uppercase)
    const normalizedMrn = String(mrn).trim().toUpperCase();
    const record = trackingData.find(r => String(r.MRN).trim().toUpperCase() === normalizedMrn);

    if (!record || !record.tracking_records || record.tracking_records.length === 0) return null;

    // Find the latest 'checked' action
    const checkedRecords = record.tracking_records.filter(r => r.action === 'checked');
    if (checkedRecords.length === 0) return null;

    // Sort by timestamp desc
    return checkedRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  };

  // Fonction pour déterminer le statut en fonction du saldo et du nombre d'outbounds
  const getStatus = (arrival) => {
    const saldo = arrival.saldo;
    const outboundsCount = Array.isArray(arrival.Outbounds) ? arrival.Outbounds.length : 0;

    // Règles de statut :
    // - Saldo = 0 -> Complete
    if (saldo === 0) {
      return {
        label: 'Complete',
        value: 'complete',
        color: 'success',
        icon: CheckCircle
      };
    }

    // - Saldo != 0 et Outbounds > 0 -> Error (includes over-declared when saldo < 0)
    if (saldo !== 0 && outboundsCount > 0) {
      return {
        label: 'Error',
        value: 'error',
        color: 'error',
        icon: XCircle
      };
    }

    // - Saldo > 0 et Outbounds = 0 -> Waiting for Outbounds
    if (saldo > 0 && outboundsCount === 0) {
      return {
        label: 'Waiting for Outbounds',
        value: 'waiting',
        color: 'info',
        icon: Clock
      };
    }

    // - Autres cas -> Unknown
    return {
      label: 'Unknown',
      value: 'unknown',
      color: 'warning',
      icon: AlertCircle
    };
  };

  // Logique de filtrage combinée (Recherche + Statut)
  const filteredArrivals = arrivals.filter(arrival => {
    const searchLower = searchTerm.toLowerCase();

    // 1. Filtrage par terme de recherche
    const matchesSearch = (
      arrival.MRN?.toLowerCase().includes(searchLower) ||
      arrival.COMMERCIALREFERENCE?.toLowerCase().includes(searchLower) ||
      arrival.DECLARATIONID?.toString().includes(searchLower)
    );

    if (!matchesSearch) return false;

    // 2. Filtrage par statut
    const status = getStatus(arrival);
    let statusMatch = true;

    if (statusFilter === 'critical') {
      const days = calculateDaysSinceRelease(arrival.GDSREL_DATETIME);
      statusMatch = status.value === 'error' && days >= 2;
    } else if (statusFilter === 'longWaiting') {
      const days = calculateDaysSinceRelease(arrival.GDSREL_DATETIME);
      statusMatch = status.value === 'waiting' && days >= 2;
    } else if (statusFilter !== 'all') {
      statusMatch = status.value === statusFilter;
    }

    // 3. Date Range Filter
    let dateMatch = true;
    if (startDate || endDate) {
      if (!arrival.GDSREL_DATETIME) {
        dateMatch = false; // No date means no match if filter active
      } else {
        const releaseDate = new Date(arrival.GDSREL_DATETIME);
        if (startDate) {
          dateMatch = dateMatch && releaseDate >= new Date(startDate);
        }
        if (endDate) {
          // Set end date to end of day
          const endDateTime = new Date(endDate);
          endDateTime.setHours(23, 59, 59, 999);
          dateMatch = dateMatch && releaseDate <= endDateTime;
        }
      }
    }

    return statusMatch && dateMatch;
  });

  // Tri : Par date de release descendant uniquement
  const sortedArrivals = [...filteredArrivals].sort((a, b) => {
    // Tri par date de release descendant (plus récent en premier)
    const aDate = a.GDSREL_DATETIME ? new Date(a.GDSREL_DATETIME).getTime() : 0;
    const bDate = b.GDSREL_DATETIME ? new Date(b.GDSREL_DATETIME).getTime() : 0;
    return bDate - aDate;
  });

  // Logique de pagination
  const totalPages = Math.ceil(sortedArrivals.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const paginatedArrivals = sortedArrivals.slice(startIndex, endIndex);

  // Save state to sessionStorage whenever it changes
  useEffect(() => {
    sessionStorage.setItem('arrivals_searchTerm', searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    sessionStorage.setItem('arrivals_statusFilter', statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    sessionStorage.setItem('arrivals_currentPage', currentPage.toString());
  }, [currentPage]);

  // Effet pour réinitialiser la pagination lors du changement de recherche ou de filtre
  // But NOT on initial mount (to preserve the saved page)
  useEffect(() => {
    // Skip on initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // Reset to page 1 when search or filter changes
    setCurrentPage(1);
  }, [searchTerm, statusFilter]);

  useEffect(() => {
    sessionStorage.setItem('arrivals_startDate', startDate);
  }, [startDate]);

  useEffect(() => {
    sessionStorage.setItem('arrivals_endDate', endDate);
  }, [endDate]);

  // Handle Escape key to clear selection, close modal, or reset filter
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (bulkModalOpen) {
          setBulkModalOpen(false);
        } else if (selectedIds.length > 0) {
          setSelectedIds([]);
        } else if (statusFilter !== 'all') {
          setStatusFilter('all');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bulkModalOpen, selectedIds, statusFilter]);

  // Statistiques par statut principal
  const stats = {
    total: arrivals.length,
    complete: arrivals.filter(a => getStatus(a).value === 'complete').length,
    error: arrivals.filter(a => getStatus(a).value === 'error').length,
    waiting: arrivals.filter(a => getStatus(a).value === 'waiting').length,
    criticalErrors: arrivals.filter(a => {
      const status = getStatus(a);
      const days = calculateDaysSinceRelease(a.GDSREL_DATETIME);
      return status.value === 'error' && days >= 2;
    }).length,
    longWaiting: arrivals.filter(a => {
      const status = getStatus(a);
      const days = calculateDaysSinceRelease(a.GDSREL_DATETIME);
      return status.value === 'waiting' && days >= 2;
    }).length,
  };

  // Fonctions d'aide
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
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

  const handleRowClick = (mrn) => {
    navigate(`/arrivals/outbounds/${mrn}`);
  };

  const handleRefresh = () => {
    refetch();
    refetchTracking();
    setSelectedIds([]); // Clear selection on refresh
  };

  const handlePreviousPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text || '');
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Selection Logic
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      // Select all on current page
      const pageMrns = paginatedArrivals.map(a => a.MRN);
      setSelectedIds(prev => {
        const newSet = new Set([...prev, ...pageMrns]);
        return Array.from(newSet);
      });
    } else {
      // Deselect all on current page
      const pageMrns = paginatedArrivals.map(a => a.MRN);
      setSelectedIds(prev => prev.filter(id => !pageMrns.includes(id)));
    }
  };

  const handleSelectRow = (mrn, e) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      if (prev.includes(mrn)) {
        return prev.filter(id => id !== mrn);
      } else {
        return [...prev, mrn];
      }
    });
  };




  // Bulk Mutation
  const bulkMutation = useMutation({
    mutationFn: (records) => addBulkTrackingRecords(records),
    onSuccess: (data) => {
      queryClient.invalidateQueries(['all_tracking']);
      queryClient.invalidateQueries(['arrivals']);
      setSelectedIds([]);
      setBulkModalOpen(false);
      setBulkNote('');
    }
  });

  const handleBulkCheck = () => {
    setBulkModalOpen(true);
  };

  const handleBulkConfirm = () => {
    // Prepare records
    const records = selectedIds.map(mrn => {
      const arrival = arrivals.find(a => a.MRN === mrn);
      if (!arrival) return null;
      // Skip complete items
      if (getStatus(arrival).value === 'complete') return null;

      return {
        mrn: mrn,
        tracking_data: {
          user: user?.name || 'Unknown User',
          action: 'checked',
          note: bulkNote || 'Bulk checked',
          status: getStatus(arrival).value,
          saldo: arrival.saldo,
          outbounds_count: arrival.Outbounds?.length || 0,
          timestamp: new Date().toISOString()
        }
      };
    }).filter(Boolean);

    bulkMutation.mutate(records);
  };

  const handleRequestExport = (scope) => {
    setExportModal({ isOpen: true, scope });
  };

  const executeExport = async ({ includeOutbounds }) => {
    setIsExporting(true);
    try {
      // Helper for styling
      const applyStyles = (ws, headerColor = "FFD966") => {
        if (!ws['!ref']) return;
        const range = XLSX.utils.decode_range(ws['!ref']);

        // Auto-width (naive)
        const cols = [];
        for (let C = range.s.c; C <= range.e.c; ++C) {
          cols.push({ wch: 18 });
        }
        ws['!cols'] = cols;

        // Apply styles
        for (let R = range.s.r; R <= range.e.r; ++R) {
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            if (!ws[addr]) continue;

            // Base Cell Style (Borders)
            ws[addr].s = {
              border: {
                top: { style: 'thin', color: { auto: 1 } },
                bottom: { style: 'thin', color: { auto: 1 } },
                left: { style: 'thin', color: { auto: 1 } },
                right: { style: 'thin', color: { auto: 1 } }
              }
            };

            // Header Row Style
            if (R === 0) {
              ws[addr].s = {
                ...ws[addr].s,
                fill: { fgColor: { rgb: headerColor } },
                font: { bold: true, sz: 11, name: "Calibri", color: { rgb: "000000" } },
                alignment: { horizontal: "center", vertical: "center" }
              };
            }
          }
        }
      };

      // 1. Determine items to export
      const itemsToExport = exportModal.scope === 'selection' && selectedIds.length > 0
        ? arrivals.filter(a => selectedIds.includes(a.MRN))
        : filteredArrivals;

      // 2. Prepare Inbound Data (Sheet 1)
      const inboundData = itemsToExport.map(arrival => {
        const status = getStatus(arrival);
        const tracking = getLatestTrackingInfo(arrival.MRN);
        const days = calculateDaysSinceRelease(arrival.GDSREL_DATETIME);

        return {
          'MRN': arrival.MRN,
          'Declaration ID': arrival.DECLARATIONID,
          'Commercial Ref': arrival.COMMERCIALREFERENCE || '',
          'Status': status.label,
          'Days Waiting': (status.value === 'waiting' || status.value === 'error') ? days : '',
          'Packages': arrival.TOTAL_PACKAGES,
          'Gross Mass': arrival.TOTAL_ITEM_GROSSMASS,
          'Saldo': arrival.saldo
        };
      });

      // 3. Prepare Outbound Data (Sheet 2) if requested
      let outboundData = [];
      if (includeOutbounds) {
        // Collect all related outbounds
        itemsToExport.forEach(arrival => {
          if (arrival.Outbounds && Array.isArray(arrival.Outbounds)) {
            arrival.Outbounds.forEach(out => {
              outboundData.push({
                'Parent Inbound MRN': arrival.MRN,
                'Outbound MRN': out.mrn || '',
                'Type': out.type_de_declaration || 'IM',
                'Packages': out.nombre_total_des_conditionnements || 0,
                'Reference': out.numero_de_reference || '',
                'Accepted Date': out.date_acceptation || '',
                'Previous Doc': out.document_precedent || '',
                'Accompanying Doc': out.document_d_accompagnement || ''
              });
            });
          }
        });
      }

      // 4. Create Workbook
      const wb = XLSX.utils.book_new();

      // Sheet 1: Inbounds
      const ws1 = XLSX.utils.json_to_sheet(inboundData);
      applyStyles(ws1, "FFD966"); // Yellow Header
      XLSX.utils.book_append_sheet(wb, ws1, "Inbounds");

      // Sheet 2: Outbounds (if requested)
      if (includeOutbounds) {
        const ws2 = XLSX.utils.json_to_sheet(outboundData);
        applyStyles(ws2, "FFE699"); // Lighter Yellow Header
        XLSX.utils.book_append_sheet(wb, ws2, "Linked Outbounds");
      }

      // 5. Download
      const fileName = `arrivals_export_${includeOutbounds ? 'full' : 'basic'}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

    } catch (error) {
      console.error("Export failed", error);
      alert("Export failed. Please check console.");
    } finally {
      setIsExporting(false);
      setExportModal({ isOpen: false, scope: 'all' });
    }
  };

  const handleOpenTracking = (arrival, e) => {
    e.stopPropagation();
    setSelectedArrival(arrival);
    setTrackingModalOpen(true);
  };

  const handleCloseTracking = () => {
    setTrackingModalOpen(false);
    setSelectedArrival(null);
  };

  // Rendu de l'état de chargement et d'erreur
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-text-muted text-lg">Loading arrivals data...</p>
        </div>
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
            onClick={handleRefresh}
            className="px-6 py-2 bg-primary text-white hover:bg-primary-dark transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto">

        {/* Header and Controls */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-semibold text-text-primary mb-1">
                Arrivals
              </h1>
              <p className="text-text-muted">
                Manage customs declarations and track shipment status
              </p>
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

          {/* Stats Bar */}
          {/* Stats Bar */}
          <div className="flex items-center gap-8 py-4 px-6 bg-surface border border-border mb-6">
            <div
              className={`flex items-center gap-2 cursor-pointer p-2 rounded transition-all ${statusFilter === 'all' ? 'bg-gray-100 ring-1 ring-gray-300 shadow-sm opacity-100' : 'opacity-50 hover:opacity-100 hover:bg-gray-50'}`}
              onClick={() => setStatusFilter('all')}
              title="Show all arrivals"
            >
              <Package className="w-5 h-5 text-text-muted" />
              <span className="text-text-muted">Total:</span>
              <span className="font-semibold text-text-primary">{stats.total}</span>
            </div>
            <div
              className={`flex items-center gap-2 cursor-pointer p-2 rounded transition-all ${statusFilter === 'complete' ? 'bg-green-50 ring-1 ring-green-200 shadow-sm opacity-100' : statusFilter === 'all' ? 'opacity-100 hover:bg-gray-50' : 'opacity-50 hover:opacity-100'}`}
              onClick={() => setStatusFilter('complete')}
              title="Shipments with Saldo = 0 (Completed)"
            >
              <CheckCircle className="w-5 h-5 text-success" />
              <span className="text-text-muted">Complete:</span>
              <span className="font-semibold text-success">{stats.complete}</span>
            </div>
            <div
              className={`flex items-center gap-2 cursor-pointer p-2 rounded transition-all ${statusFilter === 'error' ? 'bg-red-50 ring-1 ring-red-200 shadow-sm opacity-100' : statusFilter === 'all' ? 'opacity-100 hover:bg-gray-50' : 'opacity-50 hover:opacity-100'}`}
              onClick={() => setStatusFilter('error')}
              title="Shipments with Saldo discrepancies (started but incorrect)"
            >
              <XCircle className="w-5 h-5 text-error" />
              <span className="text-text-muted">Error:</span>
              <span className="font-semibold text-error">{stats.error}</span>
            </div>
            <div
              className={`flex items-center gap-2 cursor-pointer p-2 rounded transition-all ${statusFilter === 'waiting' ? 'bg-blue-50 ring-1 ring-blue-200 shadow-sm opacity-100' : statusFilter === 'all' ? 'opacity-100 hover:bg-gray-50' : 'opacity-50 hover:opacity-100'}`}
              onClick={() => setStatusFilter('waiting')}
              title="Shipments released but not yet declared (Saldo > 0, No Outbounds)"
            >
              <Clock className="w-5 h-5 text-blue-700" />
              <span className="text-text-muted">Waiting:</span>
              <span className="font-semibold text-blue-700">{stats.waiting}</span>
            </div>

            {/* Critical Stats Separator */}
            <div className="w-px h-8 bg-border mx-2"></div>

            <div
              className={`flex items-center gap-2 cursor-pointer p-2 rounded transition-all ${statusFilter === 'critical' ? 'bg-red-50 ring-1 ring-red-200 shadow-sm opacity-100' : statusFilter === 'all' ? 'opacity-100 hover:bg-gray-50' : 'opacity-50 hover:opacity-100'}`}
              onClick={() => setStatusFilter(statusFilter === 'critical' ? 'all' : 'critical')}
              title="CRITICAL ERROR: Discrepancy persisting for more than 48 hours. Requires immediate fix."
            >
              <AlertCircle className={`w-5 h-5 text-red-600 ${stats.criticalErrors > 0 ? 'animate-pulse' : ''}`} />
              <span className="text-text-muted">Critical Errors ({'>'}2d):</span>
              <span className="font-bold text-red-600">{stats.criticalErrors}</span>
            </div>
            <div
              className={`flex items-center gap-2 cursor-pointer p-2 rounded transition-all ${statusFilter === 'longWaiting' ? 'bg-orange-50 ring-1 ring-orange-200 shadow-sm opacity-100' : statusFilter === 'all' ? 'opacity-100 hover:bg-gray-50' : 'opacity-50 hover:opacity-100'}`}
              onClick={() => setStatusFilter(statusFilter === 'longWaiting' ? 'all' : 'longWaiting')}
              title="HIGH ALERT: Released more than 48 hours ago with NO action taken. Ghost shipment."
            >
              <Mail className={`w-5 h-5 text-orange-600 ${stats.longWaiting > 0 ? 'animate-pulse' : ''}`} />
              <span className="text-text-muted">High Alert ({'>'}2d):</span>
              <span className="font-bold text-orange-600">{stats.longWaiting}</span>
            </div>

            {isFetching && (
              <div className="ml-auto flex items-center gap-2 text-sm text-text-muted">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Updating...
              </div>
            )}
          </div>

          {/* Search and Filter Bar */}
          <div className="flex gap-4">
            {/* Search Bar */}
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
              <input
                type="text"
                placeholder="Search by ID, MRN, or Commercial Reference..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-surface border border-border focus:outline-none focus:border-primary transition-colors"
                autoComplete="off"
              />
            </div>

            {/* Date Filters */}
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 bg-surface border border-border focus:outline-none focus:border-primary transition-colors text-sm text-text-primary w-36 rounded-sm uppercase"
                title="Start Date (Release)"
              />
              <span className="text-text-muted">-</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 bg-surface border border-border focus:outline-none focus:border-primary transition-colors text-sm text-text-primary w-36 rounded-sm uppercase"
                title="End Date (Release)"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                  }}
                  className="p-1 hover:bg-gray-100 rounded text-text-muted transition-colors"
                  title="Clear date filter"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Status Filter */}
            <div className="relative pointer-events-none">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="appearance-none w-full pl-10 pr-8 py-2 bg-surface border border-border focus:outline-none focus:border-primary transition-colors cursor-pointer pointer-events-auto"
              >
                {StatusFilterOptions.map(option => (
                  <option
                    key={option.value}
                    value={option.value}
                    className={option.color}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Export Button */}
            <button
              onClick={() => handleRequestExport('all')}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white hover:bg-green-700 transition-colors shadow-sm"
              title="Export filtered list to Excel"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-surface border border-border">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-gray-50">
                <th className="px-3 py-3 text-left w-12">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    onChange={handleSelectAll}
                    checked={paginatedArrivals.length > 0 && paginatedArrivals.every(a => selectedIds.includes(a.MRN))}
                    onClick={(e) => e.stopPropagation()}
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  MRN
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Commercial Ref
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Packages
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Gross Mass (kg)
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Released Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Outbounds
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Saldo
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedArrivals.length === 0 ? (
                <tr>
                  <td colSpan="11" className="px-6 py-12 text-center">
                    <Package className="w-12 h-12 text-text-muted mx-auto mb-3 opacity-50" />
                    <p className="text-text-muted">
                      {searchTerm || statusFilter !== 'all'
                        ? 'No arrivals found matching your current filters.'
                        : 'No arrivals data available.'}
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedArrivals.map((arrival, index) => {
                  const status = getStatus(arrival);
                  const StatusIcon = status.icon;
                  const trackingInfo = getLatestTrackingInfo(arrival.MRN);

                  // Calculate re-check status
                  // calculateDaysSinceRelease calculates diff in days from a date string to now
                  const daysSinceCheck = trackingInfo ? calculateDaysSinceRelease(trackingInfo.timestamp) : 0;
                  const needsRecheck = trackingInfo && daysSinceCheck >= 3; // 2-3 days passed

                  // Classes CSS pour les différents statuts
                  let statusClasses = status.color === 'success'
                    ? 'border-success text-success bg-green-50'
                    : status.color === 'error'
                      ? 'border-error text-error bg-red-50'
                      : status.color === 'info'
                        ? 'border-blue-400 text-blue-700 bg-blue-50' // Style pour "Waiting for Outbounds"
                        : 'border-gray-300 text-text-muted bg-gray-50';

                  // Override style if checked
                  if (trackingInfo && !needsRecheck && (status.value === 'error' || status.value === 'waiting')) {
                    statusClasses = 'border-green-300 text-green-700 bg-green-50';
                  }

                  return (
                    <tr
                      key={arrival.MRN || index}
                      onClick={() => handleRowClick(arrival.MRN)}
                      className={`border-b border-border hover:bg-gray-50 cursor-pointer transition-colors ${needsRecheck ? 'bg-red-50/30' : ''} ${selectedIds.includes(arrival.MRN) ? 'bg-blue-50' : ''}`}
                    >
                      <td
                        className="px-3 py-4 w-12"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          checked={selectedIds.includes(arrival.MRN)}
                          onChange={(e) => handleSelectRow(arrival.MRN, e)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-6 py-4 text-sm text-text-primary">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(arrival.DECLARATIONID, `id-${arrival.DECLARATIONID}`);
                          }}
                          className={`relative px-2 py-1 rounded transition-all duration-300 text-left ${copiedId === `id-${arrival.DECLARATIONID}`
                            ? 'bg-primary text-white'
                            : 'hover:bg-primary hover:text-white hover:shadow-sm'
                            }`}
                        >
                          {copiedId === `id-${arrival.DECLARATIONID}` ? '✓ Copied!' : arrival.DECLARATIONID || 'N/A'}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-text-primary">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(arrival.MRN, `mrn-${arrival.MRN}`);
                          }}
                          className={`relative px-2 py-1 rounded transition-all duration-300 text-left ${copiedId === `mrn-${arrival.MRN}`
                            ? 'bg-primary text-white'
                            : 'hover:bg-primary hover:text-white hover:shadow-sm'
                            }`}
                        >
                          {copiedId === `mrn-${arrival.MRN}` ? '✓ Copied!' : arrival.MRN || 'N/A'}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-sm text-text-primary">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(arrival.COMMERCIALREFERENCE, `ref-${arrival.COMMERCIALREFERENCE}`);
                          }}
                          className={`relative px-2 py-1 rounded transition-all duration-300 text-left ${copiedId === `ref-${arrival.COMMERCIALREFERENCE}`
                            ? 'bg-primary text-white'
                            : 'hover:bg-primary hover:text-white hover:shadow-sm'
                            }`}
                        >
                          {copiedId === `ref-${arrival.COMMERCIALREFERENCE}` ? '✓ Copied!' : arrival.COMMERCIALREFERENCE || 'N/A'}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-text-primary">
                        {formatNumber(arrival.TOTAL_PACKAGES)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-text-primary">
                          {formatNumber(Math.round(arrival.TOTAL_ITEM_GROSSMASS || 0))}
                        </div>
                        {arrival.TOTAL_ITEM_NETMASS > 0 && (
                          <div className="text-xs text-text-muted">
                            Net: {formatNumber(Math.round(arrival.TOTAL_ITEM_NETMASS))}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-text-primary">
                          {formatDate(arrival.GDSREL_DATETIME)}
                        </div>
                        {arrival.ARR_NOT_DATETIME && (
                          <div className="text-xs text-text-muted">
                            Arr: {formatDate(arrival.ARR_NOT_DATETIME)}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary">
                            {arrival.Outbounds ? arrival.Outbounds.length : 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-sm font-semibold ${arrival.saldo === 0
                          ? 'text-success'
                          : arrival.saldo > 0
                            ? 'text-error'
                            : 'text-text-muted'
                          }`}>
                          {arrival.saldo !== undefined ? formatNumber(arrival.saldo) : 'N/A'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <div className={`flex items-center w-fit gap-1.5 px-2 py-1 border text-xs font-medium ${statusClasses}`}>
                            <StatusIcon className="w-3.5 h-3.5" />
                            {status.label}
                          </div>

                          {/* Checked Status Info */}
                          {trackingInfo && (
                            <div className={`text-xs mt-1 flex flex-col ${needsRecheck ? 'text-red-600 font-medium' : 'text-green-600'}`}>
                              <span className="flex items-center gap-1">
                                {needsRecheck ? <AlertCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                                {needsRecheck ? 'Re-check needed' : 'Checked'}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {status.value === 'complete' ? (
                          trackingInfo && (
                            <button
                              onClick={(e) => handleOpenTracking(arrival, e)}
                              className="relative flex items-center gap-1.5 px-2 py-1 bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200 rounded transition-colors"
                              title="View tracking history"
                            >
                              <Clock className="w-3 h-3" />
                              <span className="text-xs font-medium">History</span>
                            </button>
                          )
                        ) : (
                          <button
                            onClick={(e) => handleOpenTracking(arrival, e)}
                            className={`relative flex items-center gap-1.5 px-2 py-1 rounded transition-all ${(calculateDaysSinceRelease(arrival.GDSREL_DATETIME) >= 2 && status.value === 'waiting' && !trackingInfo) || needsRecheck
                              ? 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
                              : trackingInfo
                                ? 'bg-green-100 text-green-700 border border-green-300 hover:bg-green-200'
                                : 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200'
                              }`}
                            title={
                              needsRecheck
                                ? 'Checked > 3 days ago - Re-check required'
                                : calculateDaysSinceRelease(arrival.GDSREL_DATETIME) >= 2 && status.value === 'waiting'
                                  ? `Waiting ${calculateDaysSinceRelease(arrival.GDSREL_DATETIME)} days - Email required`
                                  : 'View tracking & notes'
                            }
                          >
                            {(calculateDaysSinceRelease(arrival.GDSREL_DATETIME) >= 2 && status.value === 'waiting' && !trackingInfo) || needsRecheck ? (
                              <>
                                <Mail className="w-3 h-3" />
                                <span className="text-xs font-semibold">Alert</span>
                              </>
                            ) : (
                              <>
                                {trackingInfo ? <CheckCircle className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                                <span className="text-xs">{trackingInfo ? 'View' : 'Track'}</span>
                              </>
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer with Pagination */}
        <div className="mt-4 px-6 py-3 bg-surface border border-border">
          <div className="flex items-center justify-between text-sm text-text-muted">
            <span>
              Showing {startIndex + 1}-{Math.min(endIndex, sortedArrivals.length)} of {sortedArrivals.length} arrivals
              {sortedArrivals.length !== arrivals.length && ` (filtered from ${arrivals.length})`}
            </span>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePreviousPage}
                  disabled={currentPage === 1}
                  className="flex items-center gap-1 px-3 py-1 border border-border bg-surface hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>

                <span className="px-3 py-1">
                  Page {currentPage} of {totalPages}
                </span>

                <button
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages}
                  className="flex items-center gap-1 px-3 py-1 border border-border bg-surface hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
                <ChevronRight className="w-4 h-4" />
              </div>
            )}

            <span>
              {isFetching ? 'Updating...' : `Last updated: ${new Date().toLocaleTimeString()}`}
            </span>
          </div>
        </div>
      </div>

      {/* Tracking Modal */}
      {/* Floating Bulk Data Bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-primary/95 backdrop-blur text-white px-6 py-3 rounded-full shadow-lg z-40 flex items-center gap-6 animate-in slide-in-from-bottom-5">
          <div className="flex items-center gap-2 border-r border-white/20 pr-4">
            <span className="font-bold text-lg">{selectedIds.length}</span>
            <span className="text-sm font-light">Selected</span>
          </div>

          <div className="flex items-center gap-2">
            {arrivals.filter(a => selectedIds.includes(a.MRN) && getStatus(a).value !== 'complete').length > 0 && (
              <button
                onClick={handleBulkCheck}
                className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-white/20 rounded transition-colors"
              >
                <CheckSquare className="w-4 h-4" />
                <span className="text-sm">Mark Checked</span>
              </button>
            )}
            <button
              onClick={() => handleRequestExport('selection')}
              className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-white/20 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span className="text-sm">Export Selected</span>
            </button>
          </div>

          <button
            onClick={() => setSelectedIds([])}
            className="ml-2 hover:text-white/80"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      )}

      {trackingModalOpen && selectedArrival && (
        <TrackingModal
          arrival={selectedArrival}
          onClose={handleCloseTracking}
          currentUser={user?.name || user?.email || 'Unknown User'}
        />
      )}

      {exportModal.isOpen && (
        <ExportModal
          isOpen={exportModal.isOpen}
          onClose={() => setExportModal({ ...exportModal, isOpen: false })}
          onExport={executeExport}
          count={exportModal.scope === 'selection' ? selectedIds.length : filteredArrivals.length}
          scope={exportModal.scope}
        />
      )}

      {/* Bulk Check Modal */}
      {bulkModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-semibold mb-4 text-gray-900 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-primary" />
              Mark Checked
            </h3>
            <p className="text-gray-600 mb-4">
              You are about to mark <strong>{selectedIds.length}</strong> items as checked.
            </p>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Add a Note (Optional)
              </label>
              <textarea
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
                placeholder="e.g. Cleared for release"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none h-24"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setBulkModalOpen(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkConfirm}
                disabled={bulkMutation.isLoading}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium shadow-sm disabled:opacity-50"
              >
                {bulkMutation.isLoading ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArrivalsTable;