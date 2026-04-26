import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const StatCard = ({
  label,
  value,
  sub,
  icon: Icon,
  color = 'blue',
  trend,
  trendLabel,
  onClick,
  loading,
  formatter,
}) => {
  const colorMap = {
    blue:   { bg: 'bg-blue-50',   text: 'text-blue-600',   icon: 'text-blue-500'   },
    green:  { bg: 'bg-green-50',  text: 'text-green-600',  icon: 'text-green-500'  },
    yellow: { bg: 'bg-yellow-50', text: 'text-yellow-600', icon: 'text-yellow-500' },
    red:    { bg: 'bg-red-50',    text: 'text-red-600',    icon: 'text-red-500'    },
    purple: { bg: 'bg-purple-50', text: 'text-purple-600', icon: 'text-purple-500' },
    gray:   { bg: 'bg-gray-50',   text: 'text-gray-600',   icon: 'text-gray-400'   },
  };
  const c = colorMap[color] || colorMap.blue;
  const display = formatter ? formatter(value) : (value ?? '—');

  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2 shadow-sm ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center`}>
            <Icon size={16} className={c.icon} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="h-7 w-24 bg-gray-100 rounded animate-pulse" />
      ) : (
        <div className={`text-2xl font-bold ${c.text}`}>{display}</div>
      )}
      <div className="flex items-center justify-between">
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${
            trend > 0 ? 'text-green-500' : trend < 0 ? 'text-red-500' : 'text-gray-400'
          }`}>
            {trend > 0 ? <TrendingUp size={12} /> : trend < 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
            {trendLabel || `${Math.abs(trend)}%`}
          </div>
        )}
      </div>
    </div>
  );
};

export default StatCard;
