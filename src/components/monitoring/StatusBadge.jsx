import React from 'react';
import { CheckCircle, AlertTriangle, XCircle, Clock, HelpCircle } from 'lucide-react';

const STATUS_CONFIG = {
  rendered:       { label: 'Rendered',    color: 'bg-green-100 text-green-700',  icon: CheckCircle },
  review_required:{ label: 'Review',      color: 'bg-yellow-100 text-yellow-700',icon: AlertTriangle },
  failed:         { label: 'Failed',      color: 'bg-red-100 text-red-700',      icon: XCircle },
  processing:     { label: 'Processing',  color: 'bg-blue-100 text-blue-700',    icon: Clock },
  success:        { label: 'Success',     color: 'bg-green-100 text-green-700',  icon: CheckCircle },
  warning:        { label: 'Warning',     color: 'bg-yellow-100 text-yellow-700',icon: AlertTriangle },
  error:          { label: 'Error',       color: 'bg-red-100 text-red-700',      icon: XCircle },
};

const StatusBadge = ({ status, size = 'sm' }) => {
  const cfg = STATUS_CONFIG[status?.toLowerCase()] || {
    label: status || 'Unknown',
    color: 'bg-gray-100 text-gray-600',
    icon: HelpCircle,
  };
  const Icon = cfg.icon;
  const iconSize = size === 'sm' ? 11 : 14;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon size={iconSize} />
      {cfg.label}
    </span>
  );
};

export default StatusBadge;
