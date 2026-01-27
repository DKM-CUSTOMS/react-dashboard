import React from 'react';
import { X, AlertCircle, CheckCircle, ShieldCheck, RefreshCw, Trash2, ArrowRight } from 'lucide-react';

const PremiumConfirmationModal = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    type = "info", // 'warning' | 'success' | 'info'
    isLoading = false,
    isSuccess = false,
    successMessage = "Action completed successfully!"
}) => {
    if (!isOpen) return null;

    const config = {
        warning: {
            icon: AlertCircle,
            headerBg: "bg-red-50",
            headerBorder: "border-red-100",
            headerText: "text-red-900",
            iconColor: "text-red-600",
            btnColor: "bg-red-600 hover:bg-red-700 shadow-red-100 shadow-lg",
            secondaryIcon: AlertCircle
        },
        info: {
            icon: ShieldCheck,
            headerBg: "bg-blue-50",
            headerBorder: "border-blue-100",
            headerText: "text-gray-900",
            iconColor: "text-blue-600",
            btnColor: "bg-primary hover:bg-primary/90 shadow-primary/20 shadow-lg",
            secondaryIcon: ArrowRight
        },
        success: {
            icon: CheckCircle,
            headerBg: "bg-green-50",
            headerBorder: "border-green-100",
            headerText: "text-green-900",
            iconColor: "text-green-600",
            btnColor: "bg-green-600 hover:bg-green-700 shadow-green-100 shadow-lg",
            secondaryIcon: CheckCircle
        }
    };

    const currentConfig = config[type] || config.info;
    const Icon = currentConfig.icon;

    if (isSuccess) {
        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm transition-all duration-300">
                <div className="bg-white border border-gray-200 shadow-xl w-full max-w-sm rounded-lg overflow-hidden animate-in zoom-in duration-300 flex flex-col items-center text-center p-10">
                    <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-6 border border-green-100">
                        <CheckCircle className="w-8 h-8 text-green-600" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Success!</h3>
                    <p className="text-gray-500 text-sm leading-relaxed mb-8">{successMessage}</p>
                    <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 animate-[progress_1.5s_ease-in-out_forwards]"></div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm transition-all duration-300">
            <div className="bg-white border border-gray-200 shadow-xl w-full max-w-lg rounded-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className={`${currentConfig.headerBg} border-b ${currentConfig.headerBorder} px-6 py-4 flex items-center justify-between`}>
                    <h3 className={`text-lg font-bold ${currentConfig.headerText} flex items-center gap-2`}>
                        <Icon className={`w-5 h-5 ${currentConfig.iconColor}`} />
                        {title}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        disabled={isLoading}
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-4">
                    <div className="bg-gray-50 p-6 rounded-lg border border-gray-100">
                        <p className="text-gray-600 text-sm leading-relaxed font-medium">
                            {message}
                        </p>
                    </div>

                    <p className="text-xs text-gray-400 font-medium text-center italic">
                        * This action will be logged in the system history.
                    </p>
                </div>

                {/* Footer */}
                <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t border-gray-100">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors border border-gray-200 bg-white"
                        disabled={isLoading}
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isLoading}
                        className={`px-6 py-2 text-white font-bold rounded-lg transition-all shadow-lg flex items-center gap-2 group ${currentConfig.btnColor}`}
                    >
                        {isLoading ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                            <currentConfig.secondaryIcon className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                        )}
                        {isLoading ? 'Processing...' : confirmText}
                    </button>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes progress {
                    from { width: 0%; }
                    to { width: 100%; }
                }
            `}} />
        </div>
    );
};

export default PremiumConfirmationModal;
