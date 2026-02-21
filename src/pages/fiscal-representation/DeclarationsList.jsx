
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Search,
    Calendar,
    Filter,
    RefreshCw,
    AlertCircle,
    FileText,
    ChevronLeft,
    ChevronRight,
    Eye,
} from 'lucide-react';
import { getDeclarations, createOdooProject } from '../../api/declarationsApi';

const DeclarationsList = () => {
    const [page, setPage] = useState(1);
    const [pageSize] = useState(50);
    const [filters, setFilters] = useState({
        status: 'NEW', // Default to showing only "NEW" (Not in Odoo)
        principal: '',
        importer: '',
        from: '',
        to: ''
    });

    const [selectedDeclaration, setSelectedDeclaration] = useState(null);
    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

    // New Feature States
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [isBulkSyncing, setIsBulkSyncing] = useState(false);

    const showToast = (message, type = 'success') => {
        setToast({ show: true, message, type });
        setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 3000);
    };

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ['declarations', page, pageSize, filters],
        queryFn: () => getDeclarations({ page, pageSize, filters }),
        keepPreviousData: true,
    });

    const { data: rows = [], pagination } = data || {};

    // ⚡ Keyboard Navigation Logic
    React.useEffect(() => {
        const handleKeyDown = (e) => {
            if (selectedDeclaration) return; // Ignore if modal is open

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocusedIndex(prev => Math.min(prev + 1, rows.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocusedIndex(prev => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter') {
                if (focusedIndex >= 0) {
                    setSelectedDeclaration(rows[focusedIndex]);
                }
            } else if (e.key === ' ') { // Space
                e.preventDefault();
                if (focusedIndex >= 0) {
                    const row = rows[focusedIndex];
                    if (row.odoo_status === 'NEW') {
                        handleCreateProject(row);
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [rows, focusedIndex, selectedDeclaration]);

    const handleCopy = (text, label) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        showToast(`${label} copied to clipboard!`, 'success');
    };

    const handleCreateProject = async (targetDeclaration = null) => {
        const declaration = targetDeclaration || selectedDeclaration;
        if (!declaration || isCreatingProject || isBulkSyncing) return; // Safety Lock

        setIsCreatingProject(true);
        try {
            const result = await createOdooProject(declaration.declaration_id);

            // 1. Update main list view through refetch (or manual state update if needed)
            refetch();

            // 2. If the synced declaration is what we are looking at in the modal, update it
            if (selectedDeclaration && selectedDeclaration.declaration_id === declaration.declaration_id) {
                setSelectedDeclaration(prev => ({
                    ...prev,
                    odoo_status: 'CREATED',
                    odoo_project_id: result.odoo_project_id,
                    odoo_error: null
                }));
            }

            showToast(`Ticket #${result.odoo_project_id} Created Successfully!`);
        } catch (err) {
            console.error(err);
            showToast(`Failed to create ticket: ${err.message}`, 'error');
            refetch();
        } finally {
            setIsCreatingProject(false);
        }
    };

    const handleBulkSync = async () => {
        const idsToSync = Array.from(selectedIds);
        if (idsToSync.length === 0 || isBulkSyncing || isCreatingProject) return; // Safety Lock

        setIsBulkSyncing(true);
        showToast(`Starting Bulk Sync of ${idsToSync.length} items...`);

        let successCount = 0;
        let failCount = 0;

        for (const id of idsToSync) {
            try {
                // Find row data from local state if needed OR just pass ID
                await createOdooProject(id);
                successCount++;
            } catch (err) {
                console.error(`Sync failed for ${id}:`, err);
                failCount++;
            }
        }

        setSelectedIds(new Set());
        refetch();
        setIsBulkSyncing(false);

        if (failCount === 0) {
            showToast(`Bulk Sync Complete! ${successCount} tickets successfully created.`);
        } else {
            showToast(`${successCount} Succeeded, ${failCount} Failed.`, 'error');
        }
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === rows.length) {
            setSelectedIds(new Set());
        } else {
            const news = new Set(rows.map(r => r.declaration_id));
            setSelectedIds(news);
        }
    };

    const toggleSelectRow = (id) => {
        const news = new Set(selectedIds);
        if (news.has(id)) news.delete(id);
        else news.add(id);
        setSelectedIds(news);
    };

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
        setPage(1); // Reset to page 1 on filter change
    };

    const clearFilters = () => {
        setFilters({
            status: '',
            principal: '',
            importer: '',
            from: '',
            to: ''
        });
        setPage(1);
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'NEW': return 'bg-blue-100 text-blue-800';
            case 'PENDING': return 'bg-yellow-100 text-yellow-800';
            case 'CREATED': return 'bg-green-100 text-green-800';
            case 'FAILED': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-96">
                <RefreshCw className="animate-spin text-primary w-8 h-8" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="p-8 text-center text-red-600 bg-red-50 rounded-lg border border-red-200 m-6">
                <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                <p>Error loading declarations: {error.message}</p>
                <button onClick={refetch} className="mt-4 px-4 py-2 bg-white border border-red-300 rounded shadow-sm hover:bg-red-50">
                    Retry
                </button>
            </div>
        );
    }

    const { data: rowsData = [], pagination: rowsPagination } = data || {};

    // Calculate Stats (Current Page View)
    const stats = {
        unsynced: rows.filter(r => r.odoo_status === 'NEW').length,
        failed: rows.filter(r => r.odoo_status === 'FAILED').length,
        created: rows.filter(r => r.odoo_status === 'CREATED').length,
        today: rows.filter(r => {
            const today = new Date().toISOString().split('T')[0];
            return r.date_of_acceptance?.startsWith(today);
        }).length
    };

    return (
        <div className="min-h-screen bg-gray-50/50 p-4">
            <div className="w-full space-y-4">

                {/* Header */}
                <div className="flex justify-between items-end">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Fiscal Declarations</h1>
                        <p className="text-xs text-gray-500 mt-1">Manage and track incoming declarations from Odoo/StreamSoftware</p>
                    </div>

                    {/* 📊 Quick Stats Dashboard */}
                    <div className="flex gap-4">
                        <div className="bg-white px-4 py-2 border border-gray-200 rounded-md shadow-sm">
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Unsynced</p>
                            <p className="text-lg font-bold text-blue-600">{stats.unsynced}</p>
                        </div>
                        <div className="bg-white px-4 py-2 border border-gray-200 rounded-md shadow-sm">
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Failed Icons</p>
                            <p className="text-lg font-bold text-red-600">{stats.failed}</p>
                        </div>
                        <div className="bg-white px-4 py-2 border border-gray-200 rounded-md shadow-sm">
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Accepted Today</p>
                            <p className="text-lg font-bold text-green-600">{stats.today}</p>
                        </div>
                    </div>
                </div>

                {/* Filters Bar */}
                <div className="bg-white p-4 rounded-md border border-gray-200 shadow-sm space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">

                        {/* Search Principal */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <input
                                type="text"
                                name="principal"
                                value={filters.principal}
                                onChange={handleFilterChange}
                                placeholder="Principal..."
                                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                            />
                        </div>

                        {/* Search Importer */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <input
                                type="text"
                                name="importer"
                                value={filters.importer}
                                onChange={handleFilterChange}
                                placeholder="Importer Code..."
                                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                            />
                        </div>

                        {/* Status Dropdown */}
                        <div className="relative">
                            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <select
                                name="status"
                                value={filters.status}
                                onChange={handleFilterChange}
                                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none appearance-none bg-white"
                            >
                                <option value="">All Statuses</option>
                                <option value="NEW">New</option>
                                <option value="PENDING">Pending</option>
                                <option value="CREATED">Created</option>
                                <option value="FAILED">Failed</option>
                            </select>
                        </div>

                        {/* Date Range - From */}
                        <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <input
                                type="date"
                                name="from"
                                value={filters.from}
                                onChange={handleFilterChange}
                                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                            />
                        </div>

                        {/* Date Range - To */}
                        <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <input
                                type="date"
                                name="to"
                                value={filters.to}
                                onChange={handleFilterChange}
                                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                            />
                        </div>
                    </div>

                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            {selectedIds.size > 0 && (
                                <button
                                    onClick={handleBulkSync}
                                    disabled={isBulkSyncing}
                                    className="bg-[#714B67] text-white px-4 py-1.5 rounded-md text-xs font-bold shadow-md hover:bg-[#5a3c52] transition-all flex items-center gap-2"
                                >
                                    {isBulkSyncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                    Sync Selected ({selectedIds.size})
                                </button>
                            )}
                            {selectedIds.size > 0 && (
                                <button
                                    onClick={() => setSelectedIds(new Set())}
                                    className="text-gray-500 text-xs hover:underline"
                                >
                                    Cancel Selection
                                </button>
                            )}
                        </div>
                        <button
                            onClick={clearFilters}
                            className="text-xs text-gray-500 hover:text-primary transition-colors hover:underline"
                        >
                            Clear Filters
                        </button>
                    </div>
                </div>

                {/* Data Table */}
                <div className="bg-white rounded-md border border-gray-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left border-collapse">
                            <thead className="bg-gray-50 text-gray-400 uppercase font-bold text-[9px] border-b border-gray-200">
                                <tr>
                                    <th className="px-3 py-2 w-10">
                                        <input
                                            type="checkbox"
                                            className="rounded border-gray-300 text-[#714B67] focus:ring-[#714B67]"
                                            checked={rows.length > 0 && selectedIds.size === rows.length}
                                            onChange={toggleSelectAll}
                                        />
                                    </th>
                                    <th className="px-3 py-2 whitespace-nowrap">Declaration ID</th>
                                    <th className="px-3 py-2 whitespace-nowrap">Date</th>
                                    <th className="px-3 py-2 whitespace-nowrap">Principal</th>
                                    <th className="px-3 py-2 whitespace-nowrap">Importer</th>
                                    <th className="px-3 py-2 whitespace-nowrap">MRN</th>
                                    <th className="px-3 py-2 whitespace-nowrap">Commercial Ref</th>
                                    <th className="px-3 py-2 whitespace-nowrap">Status</th>
                                    <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {rows.length === 0 ? (
                                    <tr>
                                        <td colSpan="9" className="px-6 py-12 text-center text-gray-500">
                                            <div className="flex flex-col items-center">
                                                <FileText className="w-10 h-10 text-gray-300 mb-2" />
                                                <p>No declarations found matching your filters.</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((row, index) => (
                                        <tr
                                            key={row.declaration_id}
                                            className={`transition-colors group cursor-pointer border-b border-gray-100 last:border-0 ${focusedIndex === index ? 'bg-violet-50/80 ring-1 ring-inset ring-violet-200' : 'hover:bg-gray-50/50'
                                                } ${selectedIds.has(row.declaration_id) ? 'bg-[#714B67]/5' : ''}`}
                                            onClick={() => {
                                                setFocusedIndex(index);
                                                setSelectedDeclaration(row);
                                            }}
                                        >
                                            <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-gray-300 text-[#714B67] focus:ring-[#714B67] w-3.5 h-3.5"
                                                    checked={selectedIds.has(row.declaration_id)}
                                                    onChange={() => toggleSelectRow(row.declaration_id)}
                                                />
                                            </td>
                                            <td
                                                className="px-3 py-1.5 font-mono text-[11px] text-[#714B67] hover:underline cursor-copy font-bold"
                                                onClick={(e) => { e.stopPropagation(); handleCopy(row.declaration_id, 'Declaration ID'); }}
                                                title="Click to copy ID"
                                            >
                                                {row.declaration_id}
                                            </td>
                                            <td className="px-3 py-1.5 text-gray-900 whitespace-nowrap text-xs">
                                                {row.date_of_acceptance ? new Date(row.date_of_acceptance).toLocaleDateString() : '-'}
                                            </td>
                                            <td className="px-3 py-1.5 font-medium text-gray-900 truncate max-w-[150px] text-xs" title={row.principal || ''}>
                                                {row.principal || '-'}
                                            </td>
                                            <td className="px-3 py-1.5 text-gray-600 truncate max-w-[150px] text-xs" title={row.importer_code || ''}>
                                                {row.importer_code || '-'}
                                            </td>
                                            <td
                                                className="px-3 py-1.5 font-mono text-[10px] text-gray-400 whitespace-nowrap hover:text-gray-600 cursor-copy"
                                                onClick={(e) => { e.stopPropagation(); handleCopy(row.mrn, 'MRN'); }}
                                                title="Click to copy MRN"
                                            >
                                                {row.mrn || '-'}
                                            </td>
                                            <td
                                                className="px-3 py-1.5 text-[11px] text-gray-500 truncate max-w-[120px] hover:text-gray-700 cursor-copy"
                                                onClick={(e) => { e.stopPropagation(); handleCopy(row.commercial_reference, 'Reference'); }}
                                                title="Click to copy Reference"
                                            >
                                                {row.commercial_reference || '-'}
                                            </td>
                                            <td className="px-3 py-1.5">
                                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[2px] text-[10px] font-bold border ${row.odoo_status === 'NEW' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                                    row.odoo_status === 'PENDING' ? 'bg-yellow-50 text-yellow-700 border-yellow-100' :
                                                        row.odoo_status === 'CREATED' ? 'bg-green-50 text-green-700 border-green-100' :
                                                            'bg-red-50 text-red-700 border-red-100'
                                                    }`}>
                                                    {row.odoo_status}
                                                </span>
                                            </td>
                                            <td className="px-3 py-1.5 text-right">
                                                <div className="flex justify-end gap-1.5 items-center">
                                                    {row.odoo_status === 'NEW' && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleCreateProject(row);
                                                            }}
                                                            disabled={isCreatingProject || isBulkSyncing}
                                                            className="bg-[#714B67] hover:bg-[#5a3c52] disabled:opacity-50 disabled:cursor-not-allowed text-white text-[10px] font-bold py-1 px-3 rounded-[3px] transition-colors shadow-sm flex items-center justify-center min-w-[80px]"
                                                        >
                                                            {isCreatingProject && selectedDeclaration?.declaration_id === row.declaration_id ? (
                                                                <RefreshCw className="w-3 h-3 animate-spin" />
                                                            ) : (
                                                                'Sync Odoo'
                                                            )}
                                                        </button>
                                                    )}
                                                    {row.odoo_status === 'CREATED' && (
                                                        <a
                                                            href={`https://dkm-customs.odoo.com/odoo/helpdesk/5/tickets/${row.odoo_project_id}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="text-[#714B67] border border-[#714B67] hover:bg-[#714B67] hover:text-white text-[10px] font-bold py-1 px-3 rounded-[3px] transition-all"
                                                        >
                                                            View Ticket
                                                        </a>
                                                    )}
                                                    <button
                                                        className="text-gray-400 hover:text-[#714B67] transition-colors p-1"
                                                        title="View Details"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedDeclaration(row);
                                                        }}
                                                    >
                                                        <Eye className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {pagination && (
                        <div className="px-4 py-2 border-t border-gray-200 flex items-center justify-between bg-gray-50/50">
                            <p className="text-xs text-gray-500">
                                Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span> to <span className="font-medium">{Math.min(page * pageSize, pagination.total)}</span> of <span className="font-medium">{pagination.total}</span>
                            </p>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    className="p-1 px-2 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                                    disabled={page === pagination.totalPages}
                                    className="p-1 px-2 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Details Modal */}
            {selectedDeclaration && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
                        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50 rounded-t-lg">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">Declaration Details</h3>
                                <p className="text-xs text-gray-500 font-mono mt-0.5">#{selectedDeclaration.declaration_id} • {selectedDeclaration.mrn || 'No MRN'}</p>
                            </div>
                            <button
                                onClick={() => setSelectedDeclaration(null)}
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                            >
                                <span className="sr-only">Close</span>
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="p-6 space-y-8">

                            {/* 1. General Info */}
                            <div>
                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-100 pb-1">General Information</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6">
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">Declaration ID</label>
                                        <p className="text-sm font-semibold text-gray-900">#{selectedDeclaration.declaration_id}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">Date of Acceptance</label>
                                        <p className="text-sm font-medium text-gray-900">
                                            {selectedDeclaration.date_of_acceptance ? new Date(selectedDeclaration.date_of_acceptance).toLocaleString() : '-'}
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">Commercial Reference</label>
                                        <p className="text-sm font-medium text-gray-900">{selectedDeclaration.commercial_reference || '-'}</p>
                                    </div>
                                    <div className="col-span-3 space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">Mail Subject</label>
                                        <div className="bg-gray-50 p-2 rounded border border-gray-100 font-mono text-xs text-gray-700 break-all">
                                            {selectedDeclaration.mail_subject || '-'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 2. Customs Details */}
                            <div>
                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-100 pb-1">Customs Details</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6">
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">MRN</label>
                                        <p className="text-sm font-medium text-gray-900 break-all">{selectedDeclaration.mrn || '-'}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">Principal</label>
                                        <p className="text-sm font-medium text-gray-900">{selectedDeclaration.principal || '-'}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">Importer Code</label>
                                        <p className="text-sm font-medium text-gray-900">{selectedDeclaration.importer_code || '-'}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">Traces ID</label>
                                        <p className="text-sm font-medium text-gray-900">{selectedDeclaration.traces_identification || '-'}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">Link ID ERP 2</label>
                                        <p className="text-sm font-medium text-gray-900">{selectedDeclaration.linkiderp2 || '-'}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">Link ID ERP 4</label>
                                        <p className="text-sm font-medium text-gray-900">{selectedDeclaration.linkiderp4 || '-'}</p>
                                    </div>
                                </div>
                            </div>

                            {/* 3. StreamSoftware Raw Data */}
                            <div>
                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-100 pb-1">StreamSoftware Data</h4>
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">Odoo Body (Parsed Link)</label>
                                        <div className="bg-gray-50 p-2 rounded border border-gray-100 font-mono text-xs text-gray-600 break-words whitespace-pre-wrap">
                                            {selectedDeclaration.odoo_body || '-'}
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">Link String</label>
                                        <div className="bg-gray-50 p-2 rounded border border-gray-100 font-mono text-[10px] text-gray-500 break-all">
                                            {selectedDeclaration.odoo_linkstring || '-'}
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-400 font-medium">GUID</label>
                                        <p className="text-xs font-mono text-gray-600">{selectedDeclaration.declaration_guid}</p>
                                    </div>
                                </div>
                            </div>

                            {/* 4. Action & Status */}
                            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                                <div className="flex justify-between items-center mb-4">
                                    <div>
                                        <h4 className="text-sm font-bold text-gray-900">Odoo Project Integration</h4>
                                        <p className="text-xs text-gray-500 mt-0.5">
                                            Last Updated: {selectedDeclaration.odoo_updated_at ? new Date(selectedDeclaration.odoo_updated_at).toLocaleString() : 'Never'}
                                        </p>
                                    </div>
                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${selectedDeclaration.odoo_status === 'NEW' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                                        selectedDeclaration.odoo_status === 'PENDING' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                                            selectedDeclaration.odoo_status === 'CREATED' ? 'bg-green-100 text-green-800 border-green-200' :
                                                'bg-red-100 text-red-800 border-red-200'
                                        }`}>
                                        {selectedDeclaration.odoo_status}
                                    </span>
                                </div>

                                {selectedDeclaration.odoo_error && (
                                    <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded text-xs text-red-700 font-mono break-all">
                                        Error: {selectedDeclaration.odoo_error}
                                    </div>
                                )}

                                {selectedDeclaration.odoo_project_id ? (
                                    <div className="flex items-center gap-3 bg-white p-3 rounded border border-green-200 shadow-sm">
                                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                                            <FileText className="w-4 h-4 text-green-600" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-green-900">Ticket Created</p>
                                            <p className="text-xs text-green-700">Ticket ID: {selectedDeclaration.odoo_project_id}</p>
                                        </div>
                                        <a
                                            href={`https://dkm-customs.odoo.com/odoo/helpdesk/5/tickets/${selectedDeclaration.odoo_project_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="ml-auto text-xs font-medium text-green-700 hover:text-green-800 underline flex items-center gap-1"
                                        >
                                            Open Ticket
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                        </a>
                                    </div>
                                ) : (
                                    <button
                                        className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={handleCreateProject}
                                        disabled={selectedDeclaration.odoo_status === 'PENDING' || isCreatingProject}
                                    >
                                        {isCreatingProject ? (
                                            <>
                                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                Creating Project...
                                            </>
                                        ) : selectedDeclaration.odoo_status === 'PENDING' ? (
                                            'Syncing...'
                                        ) : (
                                            'Create Odoo Project'
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Toast Notification */}
            {toast.show && (
                <div className="fixed bottom-6 right-6 z-[100] animate-in slide-in-from-right duration-300">
                    <div className={`flex items-center gap-3 px-5 py-3 rounded-lg shadow-2xl border ${toast.type === 'success'
                        ? 'bg-white border-green-500 text-green-800'
                        : 'bg-white border-red-500 text-red-800'
                        }`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${toast.type === 'success' ? 'bg-green-100' : 'bg-red-100'
                            }`}>
                            {toast.type === 'success' ? (
                                <RefreshCw className="w-4 h-4 text-green-600" />
                            ) : (
                                <AlertCircle className="w-4 h-4 text-red-600" />
                            )}
                        </div>
                        <div>
                            <p className="text-sm font-bold">{toast.type === 'success' ? 'Success' : 'Error'}</p>
                            <p className="text-xs opacity-80">{toast.message}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DeclarationsList;
