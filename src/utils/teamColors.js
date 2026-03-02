export const TEAM_COLORS = [
    { name: 'blue', hex: '#3b82f6', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', bgSolid: 'bg-blue-600', textSolid: 'text-blue-500', borderSolid: 'border-blue-500' },
    { name: 'emerald', hex: '#10b981', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bgSolid: 'bg-emerald-600', textSolid: 'text-emerald-500', borderSolid: 'border-emerald-500' },
    { name: 'amber', hex: '#f59e0b', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', bgSolid: 'bg-amber-600', textSolid: 'text-amber-500', borderSolid: 'border-amber-500' },
    { name: 'purple', hex: '#8b5cf6', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', bgSolid: 'bg-purple-600', textSolid: 'text-purple-500', borderSolid: 'border-purple-500' },
    { name: 'pink', hex: '#ec4899', bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', bgSolid: 'bg-pink-600', textSolid: 'text-pink-500', borderSolid: 'border-pink-500' },
    { name: 'cyan', hex: '#06b6d4', bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', bgSolid: 'bg-cyan-600', textSolid: 'text-cyan-500', borderSolid: 'border-cyan-500' },
    { name: 'orange', hex: '#f97316', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', bgSolid: 'bg-orange-600', textSolid: 'text-orange-500', borderSolid: 'border-orange-500' },
    { name: 'rose', hex: '#f43f5e', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', bgSolid: 'bg-rose-600', textSolid: 'text-rose-500', borderSolid: 'border-rose-500' },
    { name: 'indigo', hex: '#6366f1', bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', bgSolid: 'bg-indigo-600', textSolid: 'text-indigo-500', borderSolid: 'border-indigo-500' },
    { name: 'teal', hex: '#14b8a6', bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', bgSolid: 'bg-teal-600', textSolid: 'text-teal-500', borderSolid: 'border-teal-500' }
];

export const getTeamColorConfig = (teamName) => {
    if (!teamName || teamName.toLowerCase().trim() === 'unassigned') {
        return { name: 'gray', hex: '#6b7280', bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200', bgSolid: 'bg-gray-500', textSolid: 'text-gray-500', borderSolid: 'border-gray-500' };
    }

    // Explicit color assignments for main teams
    const name = teamName.toLowerCase().trim();
    if (name === 'import') return TEAM_COLORS.find(c => c.name === 'blue');
    if (name === 'export') return TEAM_COLORS.find(c => c.name === 'emerald');
    if (name === 'transit') return TEAM_COLORS.find(c => c.name === 'orange');

    // Consistent hash for any other teams
    let hash = 0;
    for (let i = 0; i < teamName.length; i++) {
        hash = teamName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % TEAM_COLORS.length;
    return TEAM_COLORS[idx];
};

export const getTeamHexColor = (teamName) => getTeamColorConfig(teamName).hex;

export const getTeamTailwindColors = (teamName) => {
    const config = getTeamColorConfig(teamName);
    return {
        bg: config.bg,
        text: config.text,
        border: config.border,
        bgSolid: config.bgSolid,
        textSolid: config.textSolid
    };
};
