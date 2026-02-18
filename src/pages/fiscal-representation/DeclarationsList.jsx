
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
        status: '',
        principal: '',
        importer: '',
        from: '',
        to: ''
    });

    const [selectedDeclaration, setSelectedDeclaration] = useState(null);
    const [isCreatingProject, setIsCreatingProject] = useState(false);

    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey: ['declarations', page, pageSize, filters],
        queryFn: () => getDeclarations({ page, pageSize, filters }),
        keepPreviousData: true,
    });

    const handleCreateProject = async () => {
        if (!selectedDeclaration) return;

        setIsCreatingProject(true);
        try {
            const result = await createOdooProject(selectedDeclaration.declaration_id);
            // Update local state to reflect change immediately if success
            setSelectedDeclaration(prev => ({
                ...prev,
                odoo_status: 'CREATED',
                odoo_project_id: result.odoo_project_id,
                odoo_error: null
            }));
            refetch(); // Refresh main list
            alert(`Ticket Created! ID: ${result.odoo_project_id}`);
        } catch (err) {
            console.error(err);
            alert(`Failed to create ticket: ${err.message}`);
            // If failure was recorded in DB, refetching would show it
            refetch();
        } finally {
            setIsCreatingProject(false);
        }
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

    const { data: rows = [], pagination } = data || {};



    return (
        <div className="min-h-screen bg-gray-50/50 p-4">
            <div className="w-full space-y-4">

                {/* Header */}
                <div className="flex justify-between items-center bg-white p-4 border border-gray-200 rounded-md shadow-sm">
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Fiscal Declarations</h1>
                        <p className="text-xs text-gray-500 mt-1">Manage and track incoming declarations from Odoo/StreamSoftware</p>
                    </div>
                    <button onClick={refetch} className="p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors" title="Refresh Data">
                        <RefreshCw className="w-4 h-4" />
                    </button>
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

                    <div className="flex justify-end">
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
                            <thead className="bg-gray-100 text-gray-600 uppercase font-semibold text-xs border-b border-gray-200">
                                <tr>
                                    <th className="px-4 py-3 whitespace-nowrap">Declaration ID</th>
                                    <th className="px-4 py-3 whitespace-nowrap">Date</th>
                                    <th className="px-4 py-3 whitespace-nowrap">Principal</th>
                                    <th className="px-4 py-3 whitespace-nowrap">Importer</th>
                                    <th className="px-4 py-3 whitespace-nowrap">MRN</th>
                                    <th className="px-4 py-3 whitespace-nowrap">Commercial Ref</th>
                                    <th className="px-4 py-3 whitespace-nowrap">Status</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {rows.length === 0 ? (
                                    <tr>
                                        <td colSpan="8" className="px-6 py-12 text-center text-gray-500">
                                            <div className="flex flex-col items-center">
                                                <FileText className="w-10 h-10 text-gray-300 mb-2" />
                                                <p>No declarations found matching your filters.</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((row) => (
                                        <tr
                                            key={row.declaration_id}
                                            className="hover:bg-blue-50/50 transition-colors group cursor-pointer"
                                            onClick={() => setSelectedDeclaration(row)}
                                        >
                                            <td className="px-4 py-3 font-mono text-xs text-gray-600">
                                                {row.declaration_id}
                                            </td>
                                            <td className="px-4 py-3 text-gray-900 whitespace-nowrap">
                                                {row.date_of_acceptance ? new Date(row.date_of_acceptance).toLocaleDateString() : '-'}
                                            </td>
                                            <td className="px-4 py-3 font-medium text-gray-900 truncate max-w-[150px]" title={row.principal || ''}>
                                                {row.principal || '-'}
                                            </td>
                                            <td className="px-4 py-3 text-gray-600 truncate max-w-[150px]" title={row.importer_code || ''}>
                                                {row.importer_code || '-'}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">{row.mrn || '-'}</td>
                                            <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[120px]" title={row.commercial_reference || ''}>
                                                {row.commercial_reference || '-'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium border ${row.odoo_status === 'NEW' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                                    row.odoo_status === 'PENDING' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                                        row.odoo_status === 'CREATED' ? 'bg-green-50 text-green-700 border-green-200' :
                                                            'bg-red-50 text-red-700 border-red-200'
                                                    }`}>
                                                    {row.odoo_status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        className="text-gray-400 hover:text-primary transition-colors p-1"
                                                        title="View Details"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedDeclaration(row);
                                                        }}
                                                    >
                                                        <Eye className="w-4 h-4" />
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
        </div>
    );
};

export default DeclarationsList;
