import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    Package,
    CheckCircle,
    XCircle,
    Clock,
    AlertCircle,
    Mail,
    Trash2,
    Pencil,
    Plus,
    Search,
    RefreshCw,
    Download,
    FileText,
    ChevronDown,
    ChevronRight,
    Info,
    BookOpen,
    Zap,
    Eye,
    MessageSquare,
    HelpCircle,
    ArrowRight,
    CheckSquare,
    Layers
} from 'lucide-react';

// Accordion component
const Accordion = ({ title, icon: Icon, iconColor = 'text-primary', children, defaultOpen = false, badge }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="border border-gray-200 rounded-lg overflow-hidden transition-all duration-200 hover:border-gray-300">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-5 py-4 bg-white hover:bg-gray-50 transition-colors text-left"
            >
                <div className="flex items-center gap-3">
                    {Icon && <Icon className={`w-5 h-5 ${iconColor}`} />}
                    <span className="font-semibold text-gray-900">{title}</span>
                    {badge && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full">{badge}</span>
                    )}
                </div>
                <div className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                </div>
            </button>
            {isOpen && (
                <div className="px-5 pb-5 bg-white border-t border-gray-100">
                    {children}
                </div>
            )}
        </div>
    );
};

// Status card component
const StatusCard = ({ icon: Icon, label, color, bgColor, borderColor, description, trigger }) => (
    <div className={`p-4 rounded-lg border-l-4 ${borderColor} ${bgColor} space-y-2`}>
        <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${color}`} />
            <span className={`font-bold ${color}`}>{label}</span>
        </div>
        <p className="text-sm text-gray-700">{description}</p>
        <div className="flex items-start gap-2 mt-2">
            <Zap className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-gray-500"><span className="font-semibold">Trigger:</span> {trigger}</p>
        </div>
    </div>
);



// Field info row
const FieldRow = ({ name, required, description, example }) => (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
        <td className="px-4 py-3">
            <code className="px-2 py-0.5 text-xs font-mono bg-gray-100 rounded text-gray-800">{name}</code>
            {required && <span className="ml-1.5 text-red-500 text-xs font-bold">*</span>}
        </td>
        <td className="px-4 py-3 text-sm text-gray-700">{description}</td>
        <td className="px-4 py-3">
            <span className="text-xs text-gray-500 font-mono">{example}</span>
        </td>
    </tr>
);

const ArrivalsGuide = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('overview');

    const tabs = [
        { id: 'overview', label: 'Overview', icon: BookOpen },
        { id: 'statuses', label: 'Statuses & Alerts', icon: AlertCircle },
        { id: 'actions', label: 'Actions & Tools', icon: Zap },

        { id: 'outbounds', label: 'Outbound Fields', icon: FileText },
        { id: 'workflow', label: 'Workflow', icon: ArrowRight },
        { id: 'faq', label: 'FAQ', icon: HelpCircle },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white p-6">
            <div className="max-w-[1200px] mx-auto">

                {/* Back button */}
                <button
                    onClick={() => navigate('/arrivals')}
                    className="flex items-center gap-2 text-gray-500 hover:text-primary transition-colors mb-6 text-sm"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Arrivals
                </button>

                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2.5 bg-primary/10 rounded-lg">
                            <BookOpen className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Arrivals System Guide</h1>
                            <p className="text-sm text-gray-500">Complete reference for understanding and using the Arrivals module</p>
                        </div>
                    </div>
                </div>

                {/* Tab navigation */}
                <div className="flex flex-wrap gap-1 mb-8 bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
                    {tabs.map(tab => {
                        const TabIcon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${activeTab === tab.id
                                    ? 'bg-primary text-white shadow-sm'
                                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                    }`}
                            >
                                <TabIcon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* ======================= OVERVIEW ======================= */}
                {activeTab === 'overview' && (
                    <div className="space-y-6">
                        {/* What is the Arrivals page */}
                        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                            <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                                <Package className="w-5 h-5 text-primary" />
                                What is the Arrivals Page?
                            </h2>
                            <p className="text-sm text-gray-700 leading-relaxed mb-4">
                                The Arrivals page is the <strong>central hub for tracking inbound customs declarations</strong> and their linked outbound (import) documents.
                                When goods arrive and are released by customs, they generate an <strong>inbound record</strong> with a unique MRN.
                                As import declarations are filed, <strong>outbound records</strong> are linked to the inbound, and the system automatically calculates a <strong>saldo</strong> (balance)
                                to track how many packages are accounted for.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Package className="w-4 h-4 text-blue-600" />
                                        <span className="font-semibold text-blue-900 text-sm">Inbound Record</span>
                                    </div>
                                    <p className="text-xs text-blue-800">
                                        The parent arrival — contains MRN, total packages, gross/net mass, arrival date, and release date.
                                        Data comes from customs systems automatically.
                                    </p>
                                </div>
                                <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                                    <div className="flex items-center gap-2 mb-2">
                                        <FileText className="w-4 h-4 text-indigo-600" />
                                        <span className="font-semibold text-indigo-900 text-sm">Outbound Records</span>
                                    </div>
                                    <p className="text-xs text-indigo-800">
                                        Child import declarations linked to the arrival. Each has its own MRN, package count,
                                        date, and reference documents. Can be added manually or extracted automatically.
                                    </p>
                                </div>
                                <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Layers className="w-4 h-4 text-emerald-600" />
                                        <span className="font-semibold text-emerald-900 text-sm">Saldo (Balance)</span>
                                    </div>
                                    <p className="text-xs text-emerald-800">
                                        <code className="bg-emerald-100 px-1 rounded">Saldo = Total Packages − Sum of Outbound Packages</code><br />
                                        When saldo reaches 0, the arrival is <strong>Complete</strong>. If negative, it's over-declared.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Key concepts */}
                        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                            <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                                <Info className="w-5 h-5 text-primary" />
                                Key Concepts
                            </h2>
                            <div className="space-y-3">
                                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                                    <span className="text-lg">📦</span>
                                    <div>
                                        <span className="font-semibold text-sm text-gray-900">MRN (Movement Reference Number)</span>
                                        <p className="text-xs text-gray-600 mt-0.5">Unique identifier for every customs declaration. Format: <code className="bg-gray-200 px-1 rounded">25BEH1000001CADYR4</code></p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                                    <span className="text-lg">📄</span>
                                    <div>
                                        <span className="font-semibold text-sm text-gray-900">Document Précédent</span>
                                        <p className="text-xs text-gray-600 mt-0.5">Links an outbound to its parent inbound. Should follow format <code className="bg-gray-200 px-1 rounded">N821 [inbound MRN]</code>. If it doesn't start with N821, the system flags it as "Needs Check".</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                                    <span className="text-lg">⚖️</span>
                                    <div>
                                        <span className="font-semibold text-sm text-gray-900">Saldo Calculation</span>
                                        <p className="text-xs text-gray-600 mt-0.5"><strong>Saldo = 0</strong> → Complete | <strong>Saldo &gt; 0</strong> → Packages still remaining | <strong>Saldo &lt; 0</strong> → Over-declared (error)</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                                    <span className="text-lg">📧</span>
                                    <div>
                                        <span className="font-semibold text-sm text-gray-900">Tracking & Audit Trail</span>
                                        <p className="text-xs text-gray-600 mt-0.5">Every action (checks, approvals, flags) is recorded with user name, timestamp, and notes. This creates an audit trail visible in the tracking modal.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ======================= STATUSES & ALERTS ======================= */}
                {activeTab === 'statuses' && (
                    <div className="space-y-6">
                        {/* Standard Statuses */}
                        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                                <Eye className="w-5 h-5 text-primary" />
                                Standard Statuses
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <StatusCard
                                    icon={CheckCircle}
                                    label="Complete"
                                    color="text-green-700"
                                    bgColor="bg-green-50"
                                    borderColor="border-green-500"
                                    description="All packages are accounted for. The arrival is fully processed."
                                    trigger="Saldo equals exactly 0."
                                />
                                <StatusCard
                                    icon={XCircle}
                                    label="Saldo Error"
                                    color="text-red-700"
                                    bgColor="bg-red-50"
                                    borderColor="border-red-500"
                                    description="Package count doesn't add up. Either over-declared (saldo < 0) or under-declared with existing outbounds."
                                    trigger="Saldo ≠ 0 AND at least 1 outbound exists."
                                />
                                <StatusCard
                                    icon={Clock}
                                    label="Waiting for Outbounds"
                                    color="text-blue-700"
                                    bgColor="bg-blue-50"
                                    borderColor="border-blue-500"
                                    description="Goods were released but no import declarations have been linked yet. Someone needs to file the outbound declarations."
                                    trigger="Saldo > 0 AND 0 outbounds linked."
                                />
                                <StatusCard
                                    icon={AlertCircle}
                                    label="Needs Check"
                                    color="text-amber-700"
                                    bgColor="bg-amber-50"
                                    borderColor="border-amber-500"
                                    description="A document format issue was detected OR a user manually flagged this arrival for review."
                                    trigger="Document Précédent doesn't start with 'N821', OR manually flagged by a user."
                                />
                            </div>
                        </div>

                        {/* Time-Based Escalations */}
                        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                            <h2 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
                                <Zap className="w-5 h-5 text-red-500" />
                                Time-Based Escalations (Alerts)
                            </h2>
                            <p className="text-sm text-gray-500 mb-4">
                                These are <strong>not separate statuses</strong> — they are urgency escalations that appear when a problem persists for more than <strong>72 hours</strong> since the goods release date.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-5 rounded-lg border-2 border-red-200 bg-gradient-to-br from-red-50 to-white space-y-3">
                                    <div className="flex items-center gap-2">
                                        <AlertCircle className="w-6 h-6 text-red-600 animate-pulse" />
                                        <span className="font-bold text-red-800 text-lg">🔴 Critical (&gt;3d)</span>
                                    </div>
                                    <p className="text-sm text-red-900">
                                        A <strong>Saldo Error</strong> that has been unresolved for <strong>more than 3 days</strong>.
                                        This means outbound declarations exist but the numbers don't add up, and nobody has fixed it.
                                    </p>
                                    <div className="bg-white p-3 rounded-md border border-red-100">
                                        <p className="text-xs font-semibold text-gray-700 mb-1">Condition:</p>
                                        <code className="text-xs text-red-700 bg-red-100 px-2 py-0.5 rounded">Status = "Saldo Error" AND Days since release ≥ 3</code>
                                    </div>
                                    <div className="bg-red-100 p-3 rounded-md">
                                        <p className="text-xs font-semibold text-red-800 mb-1">⚡ Action Required:</p>
                                        <ul className="text-xs text-red-700 space-y-1 list-disc pl-4">
                                            <li>Check for duplicate outbounds (same packages, different MRNs)</li>
                                            <li>Verify package counts on existing outbounds</li>
                                            <li>Add missing outbound declarations</li>
                                            <li>Delete incorrect/duplicate outbounds</li>
                                        </ul>
                                    </div>
                                </div>

                                <div className="p-5 rounded-lg border-2 border-orange-200 bg-gradient-to-br from-orange-50 to-white space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Mail className="w-6 h-6 text-orange-600 animate-pulse" />
                                        <span className="font-bold text-orange-800 text-lg">🟠 High Alert (&gt;3d)</span>
                                    </div>
                                    <p className="text-sm text-orange-900">
                                        A <strong>Waiting</strong> arrival that has had <strong>zero outbounds</strong> for more than 3 days.
                                        Called a "Ghost Shipment" because goods are physically present but have no customs follow-up.
                                    </p>
                                    <div className="bg-white p-3 rounded-md border border-orange-100">
                                        <p className="text-xs font-semibold text-gray-700 mb-1">Condition:</p>
                                        <code className="text-xs text-orange-700 bg-orange-100 px-2 py-0.5 rounded">Status = "Waiting" AND Days since release ≥ 3</code>
                                    </div>
                                    <div className="bg-orange-100 p-3 rounded-md">
                                        <p className="text-xs font-semibold text-orange-800 mb-1">📧 Action Required:</p>
                                        <ul className="text-xs text-orange-700 space-y-1 list-disc pl-4">
                                            <li>Contact the declarant/broker via email</li>
                                            <li>Verify shipment is not stuck in processing</li>
                                            <li>Use the tracking modal to log your follow-up</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Status Priority Order */}
                        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                            <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                                <Layers className="w-5 h-5 text-primary" />
                                Status Priority Order
                            </h2>
                            <p className="text-sm text-gray-500 mb-4">When multiple conditions apply, statuses are evaluated in this priority order (highest first):</p>
                            <div className="space-y-2">
                                {[
                                    { num: '1', label: 'Manually Flagged as "Needs Check"', desc: 'A user explicitly flagged this arrival → always shows Needs Check', color: 'bg-amber-100 text-amber-800', priority: 'HIGHEST' },
                                    { num: '2', label: 'Document Précédent Alert (not approved)', desc: 'An outbound has a non-N821 format AND it hasn\'t been manually approved', color: 'bg-amber-100 text-amber-800', priority: 'HIGH' },
                                    { num: '3', label: 'Saldo = 0 → Complete', desc: 'All packages are accounted for', color: 'bg-green-100 text-green-800', priority: 'NORMAL' },
                                    { num: '4', label: 'Saldo ≠ 0 with outbounds → Saldo Error', desc: 'Numbers don\'t add up', color: 'bg-red-100 text-red-800', priority: 'NORMAL' },
                                    { num: '5', label: 'Saldo > 0 with 0 outbounds → Waiting', desc: 'No declarations filed yet', color: 'bg-blue-100 text-blue-800', priority: 'NORMAL' },
                                ].map(item => (
                                    <div key={item.num} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                                        <span className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex-shrink-0">{item.num}</span>
                                        <div className="flex-grow">
                                            <span className="font-semibold text-sm text-gray-900">{item.label}</span>
                                            <p className="text-xs text-gray-500">{item.desc}</p>
                                        </div>
                                        <span className={`px-2 py-0.5 text-xs font-bold rounded ${item.color}`}>{item.priority}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ======================= ACTIONS & TOOLS ======================= */}
                {activeTab === 'actions' && (
                    <div className="space-y-4">
                        <Accordion title="Add Outbound" icon={Plus} iconColor="text-green-600" defaultOpen={true} badge="Create">
                            <div className="pt-3 space-y-3">
                                <p className="text-sm text-gray-700">Manually add a new outbound (import declaration) to an inbound arrival.</p>
                                <div className="bg-green-50 p-3 rounded-lg border border-green-100 text-sm">
                                    <p className="font-semibold text-green-800 mb-1">How to use:</p>
                                    <ol className="text-xs text-green-700 space-y-1 list-decimal pl-4">
                                        <li>Click on an arrival row to open its outbounds page</li>
                                        <li>Click the <strong>"Add Outbound"</strong> button (only visible if saldo ≠ 0)</li>
                                        <li>Fill in the required fields (MRN, packages)</li>
                                        <li>The system shows a <strong>saldo impact preview</strong> before submission</li>
                                        <li>Document Précédent auto-generates as <code className="bg-green-100 px-1 rounded">N821 [inbound MRN]</code> if left empty</li>
                                    </ol>
                                </div>
                            </div>
                        </Accordion>

                        <Accordion title="Edit Outbound" icon={Pencil} iconColor="text-blue-600" badge="Modify">
                            <div className="pt-3 space-y-3">
                                <p className="text-sm text-gray-700">Modify fields on an existing outbound record. Only <strong>changed fields</strong> are sent to the API.</p>
                                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-sm">
                                    <p className="font-semibold text-blue-800 mb-1">Editable fields:</p>
                                    <ul className="text-xs text-blue-700 space-y-1 list-disc pl-4">
                                        <li><strong>Nombre total des conditionnements</strong> (package count) — with saldo impact preview</li>
                                        <li><strong>Document précédent</strong></li>
                                        <li><strong>Document d'accompagnement</strong></li>
                                        <li><strong>Numéro de référence</strong></li>
                                        <li><strong>Date d'acceptation</strong></li>
                                    </ul>
                                    <p className="text-xs text-blue-600 mt-2 italic">Note: The outbound MRN itself cannot be changed — it's immutable.</p>
                                </div>
                            </div>
                        </Accordion>

                        <Accordion title="Delete Outbound" icon={Trash2} iconColor="text-red-600" badge="Destructive">
                            <div className="pt-3 space-y-3">
                                <p className="text-sm text-gray-700">Permanently remove an outbound record. The saldo is automatically recalculated.</p>
                                <div className="bg-red-50 p-3 rounded-lg border border-red-100 text-sm">
                                    <p className="font-semibold text-red-800 mb-1">Restrictions:</p>
                                    <ul className="text-xs text-red-700 space-y-1 list-disc pl-4">
                                        <li>Only <strong>Admin</strong> and <strong>Arrivals Agent</strong> can delete</li>
                                        <li>Non-admin users <strong>cannot delete</strong> from complete arrivals (saldo = 0)</li>
                                        <li>Admins can override and delete from any arrival</li>
                                        <li>A confirmation modal shows the <strong>saldo impact</strong> before deletion</li>
                                        <li>⚠️ This action is <strong>irreversible</strong></li>
                                    </ul>
                                </div>
                            </div>
                        </Accordion>

                        <Accordion title="Approve / Flag as Needs Check" icon={CheckCircle} iconColor="text-emerald-600" badge="Tracking">
                            <div className="pt-3 space-y-3">
                                <p className="text-sm text-gray-700">These actions manage the verification state of an arrival.</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="bg-green-50 p-3 rounded-lg border border-green-100">
                                        <p className="font-semibold text-green-800 text-sm mb-1">✅ Approve as Complete</p>
                                        <p className="text-xs text-green-700">Marks an arrival as manually verified. Available when a "Needs Check" arrival has saldo = 0. Clears the flag.</p>
                                    </div>
                                    <div className="bg-amber-50 p-3 rounded-lg border border-amber-100">
                                        <p className="font-semibold text-amber-800 text-sm mb-1">🚩 Flag as Needs Check</p>
                                        <p className="text-xs text-amber-700">Revokes approval and flags the arrival for re-verification. Available on complete arrivals. The flag takes highest priority in status calculation.</p>
                                    </div>
                                </div>
                            </div>
                        </Accordion>

                        <Accordion title="Bulk Actions" icon={CheckSquare} iconColor="text-purple-600" badge="Multi-Select">
                            <div className="pt-3 space-y-3">
                                <p className="text-sm text-gray-700">Select multiple arrivals using checkboxes for batch operations.</p>
                                <div className="bg-purple-50 p-3 rounded-lg border border-purple-100 text-sm">
                                    <p className="font-semibold text-purple-800 mb-1">Available bulk actions:</p>
                                    <ul className="text-xs text-purple-700 space-y-1 list-disc pl-4">
                                        <li><strong>Bulk Check</strong> — Log that you've reviewed the selected arrivals</li>
                                        <li><strong>Bulk Approve</strong> — Approve all selected (only if ALL are "Needs Check")</li>
                                        <li><strong>Bulk Flag</strong> — Flag all selected as Needs Check (only if ALL are "Complete")</li>
                                    </ul>
                                    <p className="text-xs text-purple-600 mt-2 italic">Tip: Press <kbd className="px-1.5 py-0.5 bg-purple-100 rounded font-mono text-xs">ESC</kbd> to clear selection</p>
                                </div>
                            </div>
                        </Accordion>

                        <Accordion title="Search, Filter & Export" icon={Search} iconColor="text-gray-600" badge="Navigation">
                            <div className="pt-3 space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Search className="w-4 h-4 text-gray-600" />
                                            <span className="font-semibold text-gray-800 text-sm">Search</span>
                                        </div>
                                        <p className="text-xs text-gray-600">Search by MRN, Declaration ID, or Commercial Reference. Results update instantly.</p>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Eye className="w-4 h-4 text-gray-600" />
                                            <span className="font-semibold text-gray-800 text-sm">Status Filter</span>
                                        </div>
                                        <p className="text-xs text-gray-600">Click any status badge in the stats bar to filter. Click again to show all. The Critical and High Alert filters are behind the separator.</p>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Download className="w-4 h-4 text-gray-600" />
                                            <span className="font-semibold text-gray-800 text-sm">Export</span>
                                        </div>
                                        <p className="text-xs text-gray-600">Export to Excel (XLSX). Choose to include outbound details or just inbound summaries. Can export filtered results or selected rows.</p>
                                    </div>
                                </div>
                            </div>
                        </Accordion>

                        <Accordion title="Smart Suggestions" icon={Zap} iconColor="text-amber-500" badge="AI-Assisted">
                            <div className="pt-3 space-y-3">
                                <p className="text-sm text-gray-700">When viewing an outbound page with a <strong>Saldo Error (negative saldo)</strong>, the system automatically detects potential issues and suggests fixes.</p>
                                <div className="bg-amber-50 p-4 rounded-lg border-l-4 border-amber-500">
                                    <p className="font-bold text-amber-900 text-sm mb-2">🔍 Duplicate Detection</p>
                                    <p className="text-xs text-amber-800 mb-2">The system checks for outbounds with the same package count but different MRNs. This usually indicates customs sent a <strong>replacement declaration</strong> due to verification.</p>
                                    <p className="text-xs text-amber-700 italic">Recommendation: Delete the older outbound — customs likely replaced it with a new one.</p>
                                </div>
                            </div>
                        </Accordion>
                    </div>
                )}



                {/* ======================= OUTBOUND FIELDS ======================= */}
                {activeTab === 'outbounds' && (
                    <div className="space-y-6">
                        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                                <FileText className="w-5 h-5 text-primary" />
                                Outbound Record Fields
                            </h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 border-b border-gray-200">
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Field</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Example</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <FieldRow
                                            name="mrn"
                                            required={true}
                                            description="The unique MRN of the outbound (import) declaration. Cannot be changed once created."
                                            example="25BEH1000001CADYR4"
                                        />
                                        <FieldRow
                                            name="nombre_total_des_conditionnements"
                                            required={true}
                                            description="Total number of packages declared in this outbound. Directly impacts the saldo calculation."
                                            example="7"
                                        />
                                        <FieldRow
                                            name="type_de_declaration"
                                            required={false}
                                            description="Always set to 'IM' (import). Fixed value, cannot be changed."
                                            example="IM"
                                        />
                                        <FieldRow
                                            name="document_precedent"
                                            required={false}
                                            description="Links this outbound to its parent inbound. Should follow format N821 + inbound MRN. Auto-generated if left empty."
                                            example="N821 24BE91..."
                                        />
                                        <FieldRow
                                            name="document_d_accompagnement"
                                            required={false}
                                            description="Accompanying transport document reference."
                                            example="N325 EMCU8612798-03"
                                        />
                                        <FieldRow
                                            name="numero_de_reference"
                                            required={false}
                                            description="External reference number, often the container/BL reference."
                                            example="EMCU8612798-03"
                                        />
                                        <FieldRow
                                            name="date_acceptation"
                                            required={false}
                                            description="Date the declaration was accepted by customs. Format: DD/MM/YYYY."
                                            example="15/02/2026"
                                        />
                                    </tbody>
                                </table>
                            </div>
                            <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
                                <p className="text-xs text-amber-700">
                                    <strong>⚠️ Important:</strong> Changing <code className="bg-amber-100 px-1 rounded">nombre_total_des_conditionnements</code> directly affects the saldo.
                                    The edit modal shows a real-time preview of the saldo impact before you save.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ======================= WORKFLOW ======================= */}
                {activeTab === 'workflow' && (
                    <div className="space-y-6">
                        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                                <ArrowRight className="w-5 h-5 text-primary" />
                                Typical Arrival Lifecycle
                            </h2>
                            <div className="space-y-0">
                                {[
                                    {
                                        step: '1',
                                        title: 'Goods Arrive & Released',
                                        desc: 'Customs releases the shipment. An inbound record is automatically created with the MRN, package count, and release date.',
                                        status: 'Waiting for Outbounds',
                                        statusColor: 'bg-blue-100 text-blue-800'
                                    },
                                    {
                                        step: '2',
                                        title: 'Import Declarations Filed',
                                        desc: 'Brokers file import declarations (outbounds). These are either extracted automatically or added manually. Each outbound reduces the saldo.',
                                        status: 'Saldo Error (if partial)',
                                        statusColor: 'bg-red-100 text-red-800'
                                    },
                                    {
                                        step: '3',
                                        title: 'All Packages Accounted For',
                                        desc: 'When the sum of outbound packages equals the inbound total, saldo reaches 0 and the arrival is marked complete.',
                                        status: 'Complete',
                                        statusColor: 'bg-green-100 text-green-800'
                                    },
                                    {
                                        step: '4',
                                        title: 'Verification (if needed)',
                                        desc: 'If Document Précédent format is unusual, the system flags for review. An agent verifies and can approve or escalate.',
                                        status: 'Needs Check → Approved',
                                        statusColor: 'bg-amber-100 text-amber-800'
                                    },
                                ].map((item, idx) => (
                                    <div key={idx} className="flex gap-4">
                                        <div className="flex flex-col items-center">
                                            <div className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                                                {item.step}
                                            </div>
                                            {idx < 3 && <div className="w-0.5 h-full bg-gray-200 my-1"></div>}
                                        </div>
                                        <div className="pb-6 flex-grow">
                                            <div className="flex items-center gap-3 mb-1">
                                                <h3 className="font-semibold text-gray-900">{item.title}</h3>
                                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${item.statusColor}`}>{item.status}</span>
                                            </div>
                                            <p className="text-sm text-gray-600">{item.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Error Resolution Flow */}
                        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                                <Zap className="w-5 h-5 text-red-500" />
                                How to Resolve Issues
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 bg-red-50 rounded-lg border border-red-100">
                                    <h3 className="font-bold text-red-800 text-sm mb-2">Saldo Error (Negative)</h3>
                                    <p className="text-xs text-red-700 mb-2">Over-declared — more packages in outbounds than in the inbound.</p>
                                    <ol className="text-xs text-red-700 space-y-1 list-decimal pl-4">
                                        <li>Check the Smart Suggestions panel for duplicates</li>
                                        <li>If a replacement was issued, delete the older outbound</li>
                                        <li>If packages are wrong, use Edit to fix the count</li>
                                    </ol>
                                </div>
                                <div className="p-4 bg-red-50 rounded-lg border border-red-100">
                                    <h3 className="font-bold text-red-800 text-sm mb-2">Saldo Error (Positive)</h3>
                                    <p className="text-xs text-red-700 mb-2">Under-declared — not all packages are covered yet.</p>
                                    <ol className="text-xs text-red-700 space-y-1 list-decimal pl-4">
                                        <li>Check if any outbounds are missing</li>
                                        <li>Add the missing outbound declaration</li>
                                        <li>Verify package counts on existing outbounds</li>
                                    </ol>
                                </div>
                                <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
                                    <h3 className="font-bold text-amber-800 text-sm mb-2">Needs Check</h3>
                                    <p className="text-xs text-amber-700 mb-2">Document format is unusual or flagged by a colleague.</p>
                                    <ol className="text-xs text-amber-700 space-y-1 list-decimal pl-4">
                                        <li>Open the outbounds page to inspect Document Précédent</li>
                                        <li>Verify with the declarant if the format is correct</li>
                                        <li>If valid, click "Approve as Complete"</li>
                                        <li>If needed, edit the outbound to fix the document</li>
                                    </ol>
                                </div>
                                <div className="p-4 bg-orange-50 rounded-lg border border-orange-100">
                                    <h3 className="font-bold text-orange-800 text-sm mb-2">Ghost Shipment (High Alert)</h3>
                                    <p className="text-xs text-orange-700 mb-2">No action taken for 3+ days.</p>
                                    <ol className="text-xs text-orange-700 space-y-1 list-decimal pl-4">
                                        <li>Open the tracking modal via the action button</li>
                                        <li>Use "Generate Email" to draft a follow-up</li>
                                        <li>Send the email to the responsible declarant</li>
                                        <li>Log your action for the audit trail</li>
                                    </ol>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ======================= FAQ ======================= */}
                {activeTab === 'faq' && (
                    <div className="space-y-4">
                        <Accordion title="What does 'saldo' mean?" icon={HelpCircle} iconColor="text-gray-500" defaultOpen={true}>
                            <div className="pt-3">
                                <p className="text-sm text-gray-700">
                                    <strong>Saldo</strong> is the Dutch/French word for "balance". It represents how many packages from the original arrival still need to be declared in outbound import declarations.
                                </p>
                                <div className="mt-2 p-3 bg-gray-50 rounded-lg font-mono text-xs">
                                    Saldo = Inbound Total Packages − Σ(Outbound Packages)
                                </div>
                            </div>
                        </Accordion>

                        <Accordion title="Why is a complete arrival showing 'Needs Check'?" icon={HelpCircle} iconColor="text-gray-500">
                            <div className="pt-3 text-sm text-gray-700 space-y-2">
                                <p>Two possible reasons:</p>
                                <ol className="list-decimal pl-5 space-y-1">
                                    <li>An outbound has a <strong>Document Précédent</strong> that doesn't start with "N821". This is a format check — the system expects all links to use the N821 code.</li>
                                    <li>A colleague <strong>manually flagged</strong> this arrival as needing review.</li>
                                </ol>
                                <p>To resolve: review the outbound documents and either fix the format or approve it as complete.</p>
                            </div>
                        </Accordion>

                        <Accordion title="What's the difference between 'Critical' and 'Saldo Error'?" icon={HelpCircle} iconColor="text-gray-500">
                            <div className="pt-3 text-sm text-gray-700 space-y-2">
                                <p><strong>Saldo Error</strong> is the base status — it means numbers don't add up. <strong>Critical</strong> is a time-based escalation of that same error.</p>
                                <p>An arrival becomes "Critical" when it has been a Saldo Error for <strong>≥ 3 days</strong> since goods release. It's an urgency indicator, not a new status.</p>
                            </div>
                        </Accordion>

                        <Accordion title="Can I change the MRN of an outbound?" icon={HelpCircle} iconColor="text-gray-500">
                            <div className="pt-3 text-sm text-gray-700">
                                <p><strong>No.</strong> The MRN is immutable. If the wrong MRN was entered, you should <strong>delete</strong> the incorrect outbound and <strong>add</strong> a new one with the correct MRN.</p>
                            </div>
                        </Accordion>

                        <Accordion title="Why can't I delete an outbound?" icon={HelpCircle} iconColor="text-gray-500">
                            <div className="pt-3 text-sm text-gray-700 space-y-2">
                                <p>Possible reasons:</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li>You don't have the <strong>admin</strong> or <strong>Arrivals Agent</strong> role</li>
                                    <li>The arrival has <strong>saldo = 0</strong> (complete) and you're not an admin — non-admins are blocked from deleting complete arrivals to prevent accidental data loss</li>
                                </ul>
                                <p>Contact an admin if you need to delete from a complete arrival.</p>
                            </div>
                        </Accordion>

                        <Accordion title="What does the tracking modal do?" icon={HelpCircle} iconColor="text-gray-500">
                            <div className="pt-3 text-sm text-gray-700 space-y-2">
                                <p>The tracking modal (opened via the action button on each row) provides:</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>Audit trail</strong> — full history of who checked, approved, or flagged this arrival</li>
                                    <li><strong>Email draft generation</strong> — auto-generates a follow-up email for ghost shipments</li>
                                    <li><strong>Notes</strong> — add context for your colleagues</li>
                                </ul>
                            </div>
                        </Accordion>

                        <Accordion title="How often does data refresh?" icon={HelpCircle} iconColor="text-gray-500">
                            <div className="pt-3 text-sm text-gray-700 space-y-2">
                                <p>The arrivals data auto-refreshes every <strong>15 minutes</strong>. Tracking data refreshes every <strong>60 seconds</strong>.</p>
                                <p>You can trigger a manual refresh at any time using the <strong>Refresh</strong> button. Cached data is used for 5 minutes to keep the interface fast.</p>
                            </div>
                        </Accordion>

                        <Accordion title="What happens when I use 'Escape' key?" icon={HelpCircle} iconColor="text-gray-500">
                            <div className="pt-3 text-sm text-gray-700">
                                <p>The ESC key has a cascading behavior:</p>
                                <ol className="list-decimal pl-5 space-y-1 mt-2">
                                    <li>If a <strong>modal is open</strong> → closes the modal</li>
                                    <li>If <strong>rows are selected</strong> → clears the selection</li>
                                    <li>If a <strong>filter is active</strong> → resets to "All"</li>
                                </ol>
                            </div>
                        </Accordion>
                    </div>
                )}

                {/* Footer */}
                <div className="mt-12 mb-6 text-center">
                    <p className="text-xs text-gray-400">
                        Arrivals System Guide • Last updated: February 2026
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ArrivalsGuide;
