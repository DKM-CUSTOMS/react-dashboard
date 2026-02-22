import React, { useState, useMemo } from 'react';
import {
    FileText,
    Send,
    RefreshCw,
    CheckCircle2,
    AlertCircle,
    Mail,
    Trash2,
    Clock,
    ArrowRight,
    ShieldCheck,
    Info
} from 'lucide-react';
import { requestFiscalDocuments } from '../../api/fiscalApi';

const DocumentRequest = () => {
    const [input, setInput] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionStatus, setSubmissionStatus] = useState(null); // 'success', 'not_found', 'error'
    const [apiResponse, setApiResponse] = useState(null);
    const [currentStep, setCurrentStep] = useState(0);
    const [requestTime, setRequestTime] = useState(null);

    const steps = [
        "Verifying IDs...",
        "Generating Documents...",
        "Dispatching Emails..."
    ];

    // Normalize IDs from textarea
    const normalizedIds = useMemo(() => {
        if (!input.trim()) return [];
        // Extract all digit sequences
        const ids = input.match(/\d+/g) || [];
        // Deduplicate
        return [...new Set(ids)];
    }, [input]);

    const isInputValid = useMemo(() => {
        if (normalizedIds.length === 0) return true;
        const invalidChars = input.replace(/[\d\s,]/g, '');
        return invalidChars.length === 0;
    }, [input, normalizedIds]);

    const validationError = useMemo(() => {
        if (input.trim() && normalizedIds.length === 0) return "Please enter at least one declaration ID.";
        if (!isInputValid) return "IDs must be numeric only.";
        if (normalizedIds.length > 50) return "Max 50 IDs per batch.";
        return null;
    }, [input, normalizedIds, isInputValid]);

    const simulateProgress = async () => {
        for (let i = 0; i < steps.length; i++) {
            setCurrentStep(i);
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (validationError || normalizedIds.length === 0) return;

        setIsSubmitting(true);
        setSubmissionStatus(null);
        setApiResponse(null);
        setRequestTime(new Date());

        const progressPromise = simulateProgress();

        try {
            const result = await requestFiscalDocuments(normalizedIds);
            await progressPromise;
            setApiResponse(result);

            if (result.ok) {
                setSubmissionStatus('success');
            } else if (result.statusCode === 404 || result.status === 'not_found') {
                setSubmissionStatus('not_found');
            } else {
                setSubmissionStatus('error');
            }
        } catch (err) {
            setSubmissionStatus('error');
            setApiResponse({ message: err.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetForm = () => {
        setInput('');
        setSubmissionStatus(null);
        setApiResponse(null);
        setCurrentStep(0);
    };

    return (
        <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
            <div className="w-full">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="w-10 h-10 bg-primary/10 rounded-sm flex items-center justify-center">
                            <FileText className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-text-primary uppercase tracking-tight">DebetNote generator</h1>
                            <p className="text-text-muted text-xs">Automated generation and distribution system</p>
                        </div>
                    </div>
                </div>

                {!submissionStatus && !isSubmitting ? (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-in fade-in duration-300">
                        {/* Input Area */}
                        <div className="lg:col-span-3">
                            <div className="bg-white border border-border rounded-sm shadow-sm overflow-hidden">
                                <div className="p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <label className="text-xs font-bold text-text-muted uppercase tracking-wider">
                                            Declaration IDs
                                        </label>
                                        {normalizedIds.length > 0 && (
                                            <span className="text-[10px] font-bold text-primary bg-primary/5 px-3 py-1 rounded-sm border border-primary/10">
                                                {normalizedIds.length} UNIQUE ID{normalizedIds.length !== 1 ? 'S' : ''} DETECTED
                                            </span>
                                        )}
                                    </div>

                                    <div className="relative">
                                        <textarea
                                            value={input}
                                            onChange={(e) => setInput(e.target.value)}
                                            placeholder="Paste your declaration IDs here... (separated by space, comma or new line)"
                                            className={`w-full min-h-[500px] p-5 bg-[#FDFDFD] border rounded-sm text-sm font-mono focus:outline-none focus:ring-1 transition-all resize-none ${validationError ? 'border-error/50 focus:ring-error' : 'border-border focus:ring-primary'
                                                }`}
                                        />
                                        {input.trim() && (
                                            <button
                                                onClick={() => setInput('')}
                                                className="absolute top-4 right-4 p-2 text-text-muted hover:text-error hover:bg-error/5 rounded-sm transition-all"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>

                                    {validationError && (
                                        <div className="mt-3 flex items-center gap-2 text-error text-xs font-bold animate-in slide-in-from-top-1">
                                            <AlertCircle className="w-4 h-4" />
                                            {validationError}
                                        </div>
                                    )}

                                    <div className="mt-8 flex items-center justify-between pt-6 border-t border-border">
                                        <p className="text-[11px] text-text-muted max-w-md italic">
                                            Deduplication is handled automatically. Max 50 IDs per batch.
                                        </p>

                                        <button
                                            onClick={handleSubmit}
                                            disabled={normalizedIds.length === 0 || !!validationError}
                                            className="px-12 py-3 bg-primary text-white rounded-sm font-bold text-sm tracking-wide hover:bg-primary-dark transition-all shadow-sm active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            <Send className="w-4 h-4" />
                                            SEND DOCUMENTS
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Distribution Sidebar */}
                        <div className="lg:col-span-1 space-y-4">
                            <div className="bg-white border border-border rounded-sm p-6 shadow-sm">
                                <h3 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-6 border-b border-border pb-3">
                                    Distribution List
                                </h3>
                                <div className="space-y-6">
                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 bg-primary/5 rounded-sm flex items-center justify-center flex-shrink-0 border border-primary/10">
                                            <Mail className="w-5 h-5 text-primary" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-text-primary leading-tight">Primary Recipients</p>
                                            <div className="mt-2 space-y-1">
                                                <p className="text-[10px] text-text-muted break-all">fiscalrepresentation@dkm-customs.com</p>
                                                <p className="text-[10px] text-text-muted break-all">swwcustoms@dkm-customs.com</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 bg-primary/5 rounded-sm flex items-center justify-center flex-shrink-0 border border-primary/10">
                                            <ShieldCheck className="w-5 h-5 text-primary" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-text-primary leading-tight">Subject Logic</p>
                                            <p className="text-[11px] text-text-muted mt-1.5 leading-relaxed">
                                                Emails are automatically labeled with <strong>Principal</strong> or <strong>Consignee</strong> based on declaration metadata.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 bg-primary/5 rounded-sm flex items-center justify-center flex-shrink-0 border border-primary/10">
                                            <Info className="w-5 h-5 text-primary" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-text-primary leading-tight">Internal CC</p>
                                            <p className="text-[11px] text-text-muted mt-1.5 leading-relaxed">
                                                Automated copies are sent to internal administration for processing records.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-amber-50/50 border border-amber-100 rounded-sm p-5">
                                <h3 className="text-[10px] font-bold text-amber-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-amber-600" />
                                    Notice
                                </h3>
                                <p className="text-[11px] text-amber-800 leading-relaxed">
                                    Emails are usually dispatched within 5-10 minutes. Please check the primary mailboxes listed above.
                                </p>
                            </div>
                        </div>
                    </div>
                ) : isSubmitting ? (
                    <div className="bg-white border border-border rounded-sm p-20 shadow-sm w-full">
                        <div className="flex flex-col items-center">
                            <div className="w-16 h-16 bg-primary/5 rounded-sm flex items-center justify-center mb-6 border border-primary/10">
                                <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                            </div>

                            <h2 className="text-xl font-bold text-text-primary mb-1 uppercase tracking-tight">Processing Request</h2>
                            <p className="text-text-muted text-xs mb-12">
                                Preparing documents for {normalizedIds.length} identifiers
                            </p>

                            <div className="w-full max-w-xs space-y-4">
                                {steps.map((step, idx) => (
                                    <div key={idx} className="flex items-center gap-4">
                                        <div className={`w-6 h-6 rounded-sm flex items-center justify-center flex-shrink-0 border ${currentStep > idx ? 'bg-success border-success text-white' :
                                                currentStep === idx ? 'bg-primary border-primary text-white' :
                                                    'bg-white border-border text-text-muted'
                                            }`}>
                                            {currentStep > idx ? <CheckCircle2 className="w-4 h-4" /> : <span className="text-[10px] font-bold">{idx + 1}</span>}
                                        </div>
                                        <span className={`text-xs font-bold tracking-tight uppercase ${currentStep >= idx ? 'text-text-primary' : 'text-text-muted opacity-40'
                                            }`}>
                                            {step}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="w-full animate-in fade-in duration-300">
                        {submissionStatus === 'success' && (
                            <div className="bg-white border border-border rounded-sm shadow-sm overflow-hidden">
                                <div className="p-12 text-center bg-success/5 border-b border-success/10">
                                    <div className="w-16 h-16 bg-white rounded-sm shadow-sm border border-success/20 flex items-center justify-center mx-auto mb-6">
                                        <CheckCircle2 className="w-8 h-8 text-success" />
                                    </div>
                                    <h2 className="text-3xl font-bold text-text-primary mb-2 uppercase tracking-tight">Documents Sent</h2>
                                    <p className="text-text-muted text-sm max-w-xl mx-auto">
                                        The generation process and email dispatch have been triggered successfully.
                                    </p>
                                </div>
                                <div className="p-10">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                                        <div className="bg-background border border-border p-6 rounded-sm">
                                            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Total Items</p>
                                            <p className="text-xl font-bold text-text-primary">{normalizedIds.length} Declarations</p>
                                        </div>
                                        <div className="bg-background border border-border p-6 rounded-sm">
                                            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Completion Time</p>
                                            <p className="text-xl font-bold text-text-primary">{requestTime?.toLocaleTimeString()}</p>
                                        </div>
                                        <div className="bg-background border border-border p-6 rounded-sm">
                                            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Status</p>
                                            <p className="text-xl font-bold text-success">Finished</p>
                                        </div>
                                    </div>

                                    <div className="bg-primary/5 border border-primary/10 rounded-sm p-8 mb-12">
                                        <div className="flex gap-4">
                                            <div className="w-12 h-12 bg-white rounded-sm border border-primary/20 flex items-center justify-center flex-shrink-0">
                                                <Mail className="w-6 h-6 text-primary" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-2">Destination Reached</h4>
                                                <p className="text-xs text-text-muted leading-relaxed max-w-2xl">
                                                    Emails are now queued for <strong>fiscalrepresentation@dkm-customs.com</strong> and <strong>swwcustoms@dkm-customs.com</strong>.
                                                    Subject lines vary between <strong>Principal</strong> and <strong>Consignee</strong> based on the declaration's fiscal profile.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-center pt-4">
                                        <button
                                            onClick={resetForm}
                                            className="px-16 py-4 bg-primary text-white rounded-sm font-bold text-sm uppercase tracking-widest hover:bg-primary-dark transition-all shadow-sm flex items-center gap-3"
                                        >
                                            Start New Batch
                                            <ArrowRight className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {submissionStatus === 'not_found' && (
                            <div className="bg-white border border-border rounded-sm p-20 text-center shadow-sm">
                                <div className="w-16 h-16 bg-background rounded-sm border border-border flex items-center justify-center mx-auto mb-6">
                                    <Search className="w-8 h-8 text-text-muted" />
                                </div>
                                <h2 className="text-2xl font-bold text-text-primary uppercase tracking-tighter">No Matches Found</h2>
                                <p className="text-text-muted text-sm mt-3 max-w-md mx-auto">
                                    We couldn't find any declarations matching the IDs provided in the core database.
                                </p>
                                <button
                                    onClick={() => setSubmissionStatus(null)}
                                    className="mt-10 bg-text-primary text-white text-[10px] font-bold py-3 px-10 rounded-sm uppercase tracking-widest hover:bg-black transition-all"
                                >
                                    Modify IDs
                                </button>
                            </div>
                        )}

                        {submissionStatus === 'error' && (
                            <div className="bg-white border border-border rounded-sm p-20 text-center shadow-sm">
                                <div className="w-16 h-16 bg-error/5 rounded-sm border border-error/20 flex items-center justify-center mx-auto mb-6">
                                    <AlertCircle className="w-8 h-8 text-error" />
                                </div>
                                <h2 className="text-2xl font-bold text-text-primary uppercase tracking-tighter">Something went wrong</h2>
                                <p className="text-error font-medium text-xs mt-4 px-6">
                                    {apiResponse?.message || "Service Communication Fault"}
                                </p>

                                <div className="mt-10 flex items-center justify-center gap-4">
                                    <button
                                        onClick={handleSubmit}
                                        className="bg-error text-white text-[10px] font-bold py-3 px-10 rounded-sm uppercase tracking-widest transition-all shadow-sm"
                                    >
                                        RETRY NOW
                                    </button>
                                    <button
                                        onClick={() => setSubmissionStatus(null)}
                                        className="bg-white border border-border text-text-primary text-[10px] font-bold py-3 px-10 rounded-sm uppercase tracking-widest hover:bg-background transition-all"
                                    >
                                        EDIT LIST
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DocumentRequest;
