import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2 } from 'lucide-react';



export default function CustomInstructionsModal({ open, onClose, userEmail, onSaved }) {
    const [aboutUser, setAboutUser] = useState('');
    const [responseStyle, setResponseStyle] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const modalRef = useRef(null);

    // Load instructions from server when modal opens
    useEffect(() => {
        if (!open || !userEmail) return;
        setLoading(true);
        fetch(`/api/ai/instructions?user=${encodeURIComponent(userEmail)}`)
            .then(r => r.ok ? r.json() : null)
            .then((data) => {
                const instructions = data?.instructions || null;
                if (instructions) {
                    setAboutUser(instructions.aboutUser || '');
                    setResponseStyle(instructions.responseStyle || '');
                }
            })
            .finally(() => setLoading(false));
    }, [open, userEmail]);

    useEffect(() => {
        if (!open) return;
        const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open, onClose]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/ai/instructions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user: userEmail,
                    aboutUser,
                    responseStyle
                })
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.instructions && onSaved) {
                onSaved(data.instructions);
            }
            onClose();
        } catch (err) {
            console.error('Failed to save instructions:', err);
        } finally {
            setSaving(false);
        }
    };

    const handleClear = async () => {
        setAboutUser('');
        setResponseStyle('');
        try {
            await fetch(`/api/ai/instructions?user=${encodeURIComponent(userEmail)}`, {
                method: 'DELETE'
            });
            if (onSaved) {
                onSaved(null);
            }
        } catch (err) {
            console.error('Failed to clear instructions:', err);
        }
    };

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                ref={modalRef}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] mx-4 overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f0f0]">
                    <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Custom instructions</h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f2f2f2] text-[#999] hover:text-[#333] transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 size={20} className="animate-spin text-[#999]" />
                    </div>
                ) : (
                    <div className="px-6 py-5 space-y-5">
                        {/* Field 1 */}
                        <div>
                            <label className="block text-[14px] font-medium text-[#2d2d2d] mb-2">
                                What would you like HR Intelligence to know about you?
                            </label>
                            <p className="text-[12px] text-[#999] mb-2">
                                e.g. your role, team, preferred language, or context about your work
                            </p>
                            <textarea
                                value={aboutUser}
                                onChange={(e) => setAboutUser(e.target.value)}
                                placeholder="I'm the manager of the import team. I speak French and English."
                                className="w-full h-28 px-3.5 py-2.5 border border-[#e0e0e0] rounded-xl text-[14px] text-[#2d2d2d] placeholder:text-[#bbb] resize-none focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-colors"
                                maxLength={1500}
                            />
                            <p className="text-right text-[11px] text-[#ccc] mt-1">{aboutUser.length}/1500</p>
                        </div>

                        {/* Field 2 */}
                        <div>
                            <label className="block text-[14px] font-medium text-[#2d2d2d] mb-2">
                                How would you like HR Intelligence to respond?
                            </label>
                            <p className="text-[12px] text-[#999] mb-2">
                                e.g. format, tone, length, language of responses
                            </p>
                            <textarea
                                value={responseStyle}
                                onChange={(e) => setResponseStyle(e.target.value)}
                                placeholder="Keep responses concise with bullet points. Use tables for data comparisons. Respond in French."
                                className="w-full h-28 px-3.5 py-2.5 border border-[#e0e0e0] rounded-xl text-[14px] text-[#2d2d2d] placeholder:text-[#bbb] resize-none focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-colors"
                                maxLength={1500}
                            />
                            <p className="text-right text-[11px] text-[#ccc] mt-1">{responseStyle.length}/1500</p>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-[#f0f0f0] bg-[#fafafa]">
                    <button
                        onClick={handleClear}
                        disabled={saving}
                        className="text-[13px] text-[#999] hover:text-[#e44] transition-colors"
                    >
                        Clear all
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-[13px] font-medium text-[#666] hover:bg-[#f0f0f0] rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || loading}
                            className="px-5 py-2 text-[13px] font-medium text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors disabled:opacity-50"
                        >
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
