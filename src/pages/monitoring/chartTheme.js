// Central colour + style system for all Brain Analytics charts.
// Keep every chart import from here so palette changes are one-file edits.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const P = {
  indigo:  '#6366F1',
  violet:  '#8B5CF6',
  emerald: '#10B981',
  cyan:    '#06B6D4',
  amber:   '#F59E0B',
  orange:  '#F97316',
  rose:    '#F43F5E',
  pink:    '#EC4899',
  lime:    '#84CC16',
  sky:     '#38BDF8',
  slate:   '#94A3B8',
};

// Ordered palette for categorical charts (8 distinct slots)
export const CHART_PALETTE = [
  P.indigo,
  P.emerald,
  P.amber,
  P.violet,
  P.cyan,
  P.orange,
  P.pink,
  P.lime,
];

// Semantic status colours
export const STATUS_COLORS = {
  rendered:       P.emerald,
  review_required: P.amber,
  failed:          P.rose,
  processing:      P.sky,
  unknown:         P.slate,
};

// Muted fills for area charts (10% opacity)
export const areaFill = (hex) => `${hex}18`;

// ---------------------------------------------------------------------------
// Recharts shared defaults
// ---------------------------------------------------------------------------

export const GRID_PROPS = {
  strokeDasharray: '3 3',
  stroke: '#F1F5F9',
  vertical: false,
};

export const AXIS_STYLE = {
  tick: { fontSize: 11, fill: '#94A3B8', fontFamily: 'inherit' },
  axisLine: false,
  tickLine: false,
};

export const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#1E293B',
    border: 'none',
    borderRadius: 10,
    color: '#F8FAFC',
    fontSize: 12,
    padding: '8px 12px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  },
  labelStyle: { color: '#94A3B8', marginBottom: 4 },
  itemStyle:  { color: '#F8FAFC' },
  cursor:     { fill: '#F1F5F900' },
};

export const LEGEND_PROPS = {
  iconSize: 8,
  iconType: 'circle',
  wrapperStyle: { fontSize: 11, color: '#64748B' },
};

// Bar radius (top corners only)
export const BAR_RADIUS = [4, 4, 0, 0];
export const BAR_RADIUS_H = [0, 4, 4, 0]; // horizontal bars
