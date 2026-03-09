import React, { useState, useEffect } from 'react';
import {
    Users, UserPlus, Trash2, X, PlusCircle, CheckCircle2, Shield, Loader2, Save, Search, Settings2, MoreVertical, RefreshCw, ChevronLeft, ChevronRight, GripVertical, Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getTeamTailwindColors } from '../../utils/teamColors';

const USERS_API_URL = import.meta.env.VITE_AZURE_FUNCTION_URL;
const USERS_CACHE_KEY = "azure_users_cache_v1";
const USERS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export default function UserManagement() {
    const [availableUsers, setAvailableUsers] = useState([]);
    const [teams, setTeams] = useState([]);

    // Loading states
    const [loadingTeams, setLoadingTeams] = useState(true);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [error, setError] = useState(null);
    const [processing, setProcessing] = useState(false); // for actions

    // Drag state
    const [draggedUser, setDraggedUser] = useState(null);
    const [draggedFromTeamId, setDraggedFromTeamId] = useState(null);

    // New team modal state
    const [newTeamName, setNewTeamName] = useState('');
    const [isAddingTeam, setIsAddingTeam] = useState(false);
    const [addingParentId, setAddingParentId] = useState(null);

    // Search
    const [searchQuery, setSearchQuery] = useState('');

    // 1. Fetch DB Teams first (immediate UI rendering)
    useEffect(() => {
        async function fetchTeams() {
            try {
                setLoadingTeams(true);
                const res = await fetch('/api/teams');
                if (!res.ok) throw new Error('Failed to fetch teams from database');
                const data = await res.json();

                if (data.success) {
                    setTeams(data.teams || []);
                    // Note: After fetching teams, we fire fetchUsers to get the Azure user list
                    fetchAzureUsers(data.teams || []);
                }
            } catch (err) {
                setError(err.message);
            } finally {
                setLoadingTeams(false);
            }
        }
        fetchTeams();
    }, []);

    // 2. Fetch Azure Users (slower, ~5 secs) with Caching
    async function fetchAzureUsers(currentTeams, forceRefresh = false) {
        try {
            setLoadingUsers(true);

            let azureUsers = null;

            // Check cache first
            if (!forceRefresh) {
                const cached = localStorage.getItem(USERS_CACHE_KEY);
                if (cached) {
                    try {
                        const { timestamp, data: parsedData } = JSON.parse(cached);
                        if (Date.now() - timestamp < USERS_CACHE_TTL) {
                            azureUsers = parsedData;
                        }
                    } catch (e) {
                        console.warn("Invalid cache data", e);
                    }
                }
            }

            // Fetch from API if no valid cache
            if (!azureUsers) {
                const res = await fetch(USERS_API_URL);
                if (!res.ok) throw new Error('Failed to fetch users from Azure');
                const data = await res.json();

                if (data.status === 'success' && data.users) {
                    azureUsers = data.users.map(u => u.usercode);
                    localStorage.setItem(USERS_CACHE_KEY, JSON.stringify({
                        timestamp: Date.now(),
                        data: azureUsers
                    }));
                } else {
                    throw new Error("Invalid API response format");
                }
            }

            if (azureUsers) {
                // Find users that are already assigned to ANY team
                const assignedUsers = new Set();
                currentTeams.forEach(t => {
                    t.members.forEach(m => assignedUsers.add(m));
                });

                // The remaining are "Available"
                const unassigned = azureUsers.filter(u => !assignedUsers.has(u));
                setAvailableUsers(unassigned);
            }
        } catch (err) {
            console.error(err);
            setError("Warning: Could not fetch unassigned users list");
        } finally {
            setLoadingUsers(false);
        }
    }

    const forceRefreshUsers = () => {
        fetchAzureUsers(teams, true);
    };

    // --- Drag & Drop logic ---
    const handleDragStart = (e, usercode, sourceTeamId) => {
        setDraggedUser(usercode);
        setDraggedFromTeamId(sourceTeamId); // null if from available pool
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => {
            e.target.style.opacity = '0.5';
        }, 0);
    };

    const handleDragEnd = (e) => {
        e.target.style.opacity = '1';
        setDraggedUser(null);
        setDraggedFromTeamId(null);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    };

    const handleDropToTeam = async (e, targetTeamId) => {
        e.preventDefault();
        if (!draggedUser || processing) return;
        if (draggedFromTeamId === targetTeamId) return;

        const user = draggedUser;
        const sourceId = draggedFromTeamId;

        setProcessing(true);
        try {
            // 1. Assign via API
            let assignRes = await fetch('/api/teams/members', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ team_id: targetTeamId, usercode: user })
            });
            if (!assignRes.ok) throw new Error("Failed to assign user");

            // 2. Unassign from old team (if moving between teams)
            if (sourceId !== null) {
                let removeRes = await fetch(`/ api / teams / ${sourceId} /members/${encodeURIComponent(user)} `, {
                    method: 'DELETE'
                });
                if (!removeRes.ok) throw new Error("Failed to remove user from previous team");

                // Update local state teams
                setTeams(prev => prev.map(t => {
                    if (t.id === sourceId) return { ...t, members: t.members.filter(u => u !== user) };
                    if (t.id === targetTeamId) return { ...t, members: [...t.members, user] };
                    return t;
                }));
            } else {
                // From available -> Team
                setAvailableUsers(prev => prev.filter(u => u !== user));
                setTeams(prev => prev.map(t => {
                    if (t.id === targetTeamId) return { ...t, members: [...t.members, user] };
                    return t;
                }));
            }
        } catch (err) {
            alert("Error saving assignment: " + err.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleDropToAvailable = async (e) => {
        e.preventDefault();
        if (!draggedUser || draggedFromTeamId === null || processing) return;

        const user = draggedUser;
        const sourceId = draggedFromTeamId;

        setProcessing(true);
        try {
            // Remove from team API
            let removeRes = await fetch(`/ api / teams / ${sourceId} /members/${encodeURIComponent(user)} `, {
                method: 'DELETE'
            });
            if (!removeRes.ok) throw new Error("Failed to unassign user");

            setTeams(prev => prev.map(t => {
                if (t.id === sourceId) return { ...t, members: t.members.filter(u => u !== user) };
                return t;
            }));
            setAvailableUsers(prev => [...prev, user]);
        } catch (err) {
            alert("Error unassigning user: " + err.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleAddTeam = async () => {
        if (!newTeamName.trim() || processing) return;
        setProcessing(true);
        try {
            const res = await fetch('/api/teams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newTeamName.trim(), parent_id: addingParentId })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || "Failed to create team");

            setTeams([...teams, { id: data.teamId, name: newTeamName.trim(), members: [], leaders: [], parent_id: addingParentId }]);
            setNewTeamName('');
            setIsAddingTeam(false);
            setAddingParentId(null);
        } catch (err) {
            alert("Error creating team: " + err.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleToggleLeader = async (teamId, usercode, currentIsLeader) => {
        setProcessing(true);
        try {
            const res = await fetch(`/ api / teams / ${teamId} /members/${encodeURIComponent(usercode)}/leader`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_leader: !currentIsLeader })
            });
            if (!res.ok) throw new Error("Failed to update status");

            setTeams(prev => prev.map(t => {
                if (t.id === teamId) {
                    const newLeaders = currentIsLeader
                        ? (t.leaders || []).filter(l => l !== usercode)
                        : [...(t.leaders || []), usercode];
                    return { ...t, leaders: newLeaders };
                }
                return t;
            }));
        } catch (err) {
            alert("Error: " + err.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleDeleteTeam = async (teamId) => {
        if (processing) return;
        const teamToDelete = teams.find(t => t.id === teamId);
        if (!teamToDelete) return;
        const isConfirmed = window.confirm(`Are you sure you want to delete ${teamToDelete.name}? Members will be unassigned.`);
        if (!isConfirmed) return;

        setProcessing(true);
        try {
            const res = await fetch(`/api/teams/${teamId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error("Failed to delete team");

            setAvailableUsers(prev => [...prev, ...teamToDelete.members]);
            setTeams(teams.filter(t => t.id !== teamId));
        } catch (err) {
            alert("Error: " + err.message);
        } finally {
            setProcessing(false);
        }
    };

    // Wait for initial DB fetch
    if (loadingTeams) {
        return (
            <div className="p-8 flex items-center justify-center min-h-[50vh]">
                <div className="flex flex-col items-center gap-2 text-primary">
                    <Loader2 className="animate-spin w-8 h-8" />
                    <span className="font-medium">Loading Teams configuration...</span>
                </div>
            </div>
        );
    }

    // Computed Search
    const filteredAvailableUsers = availableUsers.filter(u =>
        u.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <>
            <div className="p-4 md:p-8 w-full max-w-[1600px] mx-auto h-[calc(100vh-64px)] flex flex-col bg-transparent">
                <div className="flex justify-between items-center mb-6 bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200 shrink-0">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight text-gray-900 group flex items-center gap-3">
                            <div className="bg-blue-50 p-2 rounded-lg">
                                <Shield className="w-7 h-7 text-blue-600" />
                            </div>
                            Team Hierarchy & User Assignment
                        </h1>
                        <p className="text-sm text-gray-500 mt-2 font-medium">Manage departmental structures, designate senior leaders, and organize the organizational hierarchy via drag and drop.</p>
                    </div>
                </div>

                {error && <div className="mb-4 text-sm text-red-600 bg-red-50 p-3 rounded-sm border border-red-100">{error}</div>}

                <div className="flex flex-col lg:flex-row gap-6 items-start flex-1 min-h-0">

                    {/* Left column: Available Users (Loads async from Azure) */}
                    <div
                        className="w-full lg:w-1/3 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full overflow-hidden"
                        onDragOver={handleDragOver}
                        onDrop={handleDropToAvailable}
                    >
                        <div className="px-5 py-4 border-b border-gray-100 bg-white flex justify-between items-center z-10">
                            <h2 className="font-black text-gray-900 flex items-center gap-2 tracking-tight text-sm">
                                <div className="bg-blue-50 text-blue-600 p-1.5 rounded-md">
                                    <Users size={16} strokeWidth={2.5} />
                                </div>
                                UNASSIGNED GLOBAL USERS
                            </h2>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={forceRefreshUsers}
                                    disabled={loadingUsers}
                                    className="p-1.5 text-gray-500 hover:text-primary transition-colors bg-white border border-border rounded-sm shadow-sm disabled:opacity-50"
                                    title="Force Refresh from Server"
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
                                </button>
                                {!loadingUsers && (
                                    <span className="bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">
                                        {availableUsers.length}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="p-3 border-b border-border bg-white">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search by name or code..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 border border-border rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-gray-50/50"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 rounded-md"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="p-4 overflow-y-auto flex-1 space-y-2 relative min-h-[300px] bg-gray-50/30">
                            {loadingUsers ? (
                                <div className="h-full flex flex-col items-center justify-center text-text-muted animate-pulse">
                                    <Loader2 className="animate-spin w-6 h-6 mb-2" />
                                    <p className="text-sm">Fetching users securely...</p>
                                    <p className="text-xs opacity-70 mt-1">(this may take up to 5s)</p>
                                </div>
                            ) : availableUsers.length === 0 ? (
                                <div className="h-40 flex flex-col items-center justify-center text-gray-400 opacity-70">
                                    <CheckCircle2 size={32} className="mb-2" />
                                    <p className="text-sm">All users assigned!</p>
                                </div>
                            ) : filteredAvailableUsers.length === 0 ? (
                                <div className="h-40 flex flex-col items-center justify-center text-gray-400 opacity-70">
                                    <Search size={32} className="mb-2 opacity-30" />
                                    <p className="text-sm">No matches found</p>
                                </div>
                            ) : (
                                <AnimatePresence>
                                    {filteredAvailableUsers.map(user => (
                                        <motion.div
                                            key={user}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.90 }}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, user, null)}
                                            onDragEnd={handleDragEnd}
                                            className="p-3 mb-2 bg-white border border-gray-200 hover:border-blue-400 hover:shadow-md rounded-lg cursor-grab active:cursor-grabbing text-sm font-medium transition-all duration-300 flex items-center gap-3 group relative overflow-hidden"
                                        >
                                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-gray-200 to-gray-300 group-hover:from-blue-400 group-hover:to-blue-600 transition-colors"></div>
                                            <div className="w-9 h-9 rounded-md bg-gray-50 border border-gray-100 flex items-center justify-center text-xs font-bold text-gray-700 group-hover:bg-blue-50 group-hover:text-blue-700 group-hover:border-blue-200 shrink-0 transition-colors shadow-sm ml-2">
                                                {user.substring(0, 2).toUpperCase()}
                                            </div>
                                            <span className="truncate flex-1 tracking-tight text-gray-700 group-hover:text-gray-900 group-hover:font-semibold transition-all">{user}</span>

                                            <div className="opacity-0 group-hover:opacity-100 transition-all transform translate-x-4 group-hover:translate-x-0 absolute right-3">
                                                <div className="px-2.5 py-1.5 bg-blue-100 text-blue-700 rounded-md text-[10px] font-black uppercase tracking-wider shadow-sm">Drop</div>
                                            </div>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            )}
                        </div>
                    </div>

                    {/* Right column: Teams */}
                    <div className="w-full lg:w-2/3 flex flex-col h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="flex gap-4 items-center bg-white p-5 border-b border-gray-100 shrink-0 z-10">
                            {isAddingTeam ? (
                                <div className="flex gap-2 w-full items-center">
                                    <input
                                        type="text"
                                        value={newTeamName}
                                        onChange={e => setNewTeamName(e.target.value)}
                                        placeholder="e.g. Finance Hub"
                                        className="px-4 py-2 border border-blue-200 rounded-lg text-sm focus:ring-4 focus:ring-blue-50 focus:border-blue-500 focus:outline-none flex-1 transition-all bg-blue-50/30"
                                        onKeyDown={e => e.key === 'Enter' && handleAddTeam()}
                                        autoFocus
                                        disabled={processing}
                                    />
                                    <button
                                        onClick={handleAddTeam}
                                        disabled={processing}
                                        className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 active:scale-95 transition-all shadow-sm shadow-blue-500/30 flex items-center gap-2 text-sm font-bold disabled:opacity-50"
                                    >
                                        <Save size={16} strokeWidth={2.5} /> Save
                                    </button>
                                    <button
                                        onClick={() => setIsAddingTeam(false)}
                                        disabled={processing}
                                        className="text-gray-400 bg-gray-50 hover:bg-red-50 hover:text-red-500 p-2.5 rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        <X size={20} strokeWidth={2.5} />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setIsAddingTeam(true)}
                                    disabled={processing}
                                    className="flex items-center gap-2 text-sm font-bold text-gray-700 bg-white border-2 border-dashed border-gray-300 px-5 py-2.5 rounded-lg hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all focus:outline-none"
                                >
                                    <PlusCircle size={18} strokeWidth={2.5} />
                                    Create New Team
                                </button>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
                                <AnimatePresence>
                                    {teams.length === 0 && !loadingTeams && (
                                        <div className="col-span-full py-12 text-center text-text-muted bg-white border border-dashed rounded-sm border-border">
                                            <p>No teams configured yet.</p>
                                        </div>
                                    )}
                                    {teams.filter(t => !t.parent_id).map(team => (
                                        <TeamCard
                                            key={team.id}
                                            team={team}
                                            allTeams={teams}
                                            draggedFromTeamId={draggedFromTeamId}
                                            draggedUser={draggedUser}
                                            handleDragOver={handleDragOver}
                                            handleDropToTeam={handleDropToTeam}
                                            handleDragStart={handleDragStart}
                                            handleDragEnd={handleDragEnd}
                                            handleDeleteTeam={handleDeleteTeam}
                                            handleToggleLeader={handleToggleLeader}
                                            setIsAddingTeam={(val, parentId) => {
                                                setIsAddingTeam(val);
                                                setAddingParentId(parentId);
                                            }}
                                            processing={processing}
                                        />
                                    ))}
                                </AnimatePresence>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
function TeamCard({ team, allTeams, draggedFromTeamId, draggedUser, handleDragOver, handleDropToTeam, handleDragStart, handleDragEnd, handleDeleteTeam, handleToggleLeader, setIsAddingTeam, processing }) {
    const subTeams = allTeams.filter(t => t.parent_id === team.id);
    const isSubTeam = team.parent_id != null;
    const parentTeam = isSubTeam ? allTeams.find(t => t.id === team.parent_id) : null;
    const colorName = parentTeam ? parentTeam.name : team.name;
    const themeColors = getTeamTailwindColors(colorName);
    const [selectedUserForAction, setSelectedUserForAction] = React.useState(null);

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onDragOver={handleDragOver}
            onDrop={(e) => { e.stopPropagation(); handleDropToTeam(e, team.id); }}
            className={`transition-all duration-300 flex flex-col rounded-lg border-2 ${isSubTeam ? 'mt-4 border-dashed' : 'mb-4 shadow-sm hover:shadow-md'} 
            ${draggedFromTeamId !== team.id && draggedUser ? `border-dashed ${themeColors.borderSolid} bg-white ring-4 ring-${themeColors.borderSolid}/20` : 'border-gray-200 bg-white'}`}
        >
            {/* Header */}
            <div className={`px-4 py-3 flex justify-between items-center group rounded-t-md ${isSubTeam ? 'bg-transparent border-b border-gray-100' : `${themeColors.bg} border-b ${themeColors.border}`}`}>
                <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full shadow-sm ${themeColors.bgSolid}`}></div>
                    <h3 className={`font-bold tracking-wide ${isSubTeam ? 'text-gray-600 text-sm' : 'text-gray-900 text-base'}`}>
                        {team.name}
                    </h3>
                    <span className="text-[10px] font-bold text-gray-500 bg-white/60 backdrop-blur-sm border border-black/5 px-2 py-0.5 rounded-full shadow-sm">
                        {team.members.length} members
                    </span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!isSubTeam && (
                        <button
                            onClick={() => setIsAddingTeam(true, team.id)}
                            disabled={processing}
                            className={`p-1.5 rounded-md transition-colors ${themeColors.textSolid} hover:${themeColors.bgSolid} hover:text-white`}
                            title="Add Sub-Team"
                        >
                            <PlusCircle size={15} strokeWidth={2.5} />
                        </button>
                    )}
                    <button
                        onClick={() => handleDeleteTeam(team.id)}
                        disabled={processing}
                        className="p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 rounded-md transition-colors disabled:opacity-50"
                        title="Delete team"
                    >
                        <Trash2 size={15} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className={`p-4 flex-1 flex flex-col gap-2 min-h-[120px] ${isSubTeam ? '' : 'bg-gray-50/30'}`}>
                {team.members.length === 0 ? (
                    <div className="flex items-center justify-center text-gray-400 text-xs font-semibold py-8 border-2 border-dashed border-gray-100 rounded-md bg-white">
                        Drop users here
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-2">
                        {team.members.map(user => {
                            const isLeader = (team.leaders || []).includes(user);
                            return (
                                <div
                                    key={user}
                                    draggable
                                    onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, user, team.id); }}
                                    onDragEnd={handleDragEnd}
                                    className={`relative p-2.5 bg-white border ${isLeader ? `border-l-4 ${themeColors.borderSolid} shadow-sm ring-1 ring-black/5` : 'border-gray-200 hover:border-gray-300'} rounded-md cursor-grab active:cursor-grabbing text-sm font-medium transition-all flex justify-between items-center group`}
                                >
                                    <div className="flex items-center gap-3 w-full" onClick={(e) => { e.stopPropagation(); setSelectedUserForAction(selectedUserForAction === user ? null : user); }}>
                                        <div className={`w-8 h-8 rounded-md shadow-sm ${isLeader ? `${themeColors.bgSolid} text-white` : `${themeColors.bg} ${themeColors.textSolid} border ${themeColors.border}`} flex items-center justify-center text-xs font-bold leading-none shrink-0`}>
                                            {user.substring(0, 2).toUpperCase()}
                                        </div>
                                        <span className={`truncate flex-1 tracking-tight ${isLeader ? 'font-bold text-gray-900' : 'text-gray-700'}`}>{user}</span>

                                        <div className="flex items-center gap-2 ml-auto z-10">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleToggleLeader(team.id, user, isLeader); setSelectedUserForAction(null); }}
                                                disabled={processing}
                                                className={`absolute right-10 flex flex-col items-center justify-center px-3 py-1.5 rounded-md transition-all text-xs font-bold tracking-wider shadow-sm backdrop-blur-md
                                                    ${selectedUserForAction === user ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none'}
                                                    ${isLeader
                                                        ? 'bg-red-500 text-white border border-red-600 hover:bg-red-600'
                                                        : 'bg-indigo-600 text-white border border-indigo-700 hover:bg-indigo-700'}`
                                                }
                                            >
                                                {isLeader ? 'Demote' : 'Make Senior'}
                                            </button>

                                            {isLeader && <span className={`text-[9px] text-white ${themeColors.bgSolid} px-2 py-0.5 rounded uppercase font-bold tracking-widest shadow-sm`}>Senior</span>}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Nested Sub Teams Container */}
            {subTeams.length > 0 && (
                <div className="px-4 pb-4">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="h-px bg-gray-200 flex-1"></div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sub-Teams</span>
                        <div className="h-px bg-gray-200 flex-1"></div>
                    </div>
                    <div className="pl-4 border-l-2 border-gray-100 space-y-4">
                        {subTeams.map(subTeam => (
                            <TeamCard
                                key={subTeam.id}
                                team={subTeam}
                                allTeams={allTeams}
                                draggedFromTeamId={draggedFromTeamId}
                                draggedUser={draggedUser}
                                handleDragOver={handleDragOver}
                                handleDropToTeam={handleDropToTeam}
                                handleDragStart={handleDragStart}
                                handleDragEnd={handleDragEnd}
                                handleDeleteTeam={handleDeleteTeam}
                                handleToggleLeader={handleToggleLeader}
                                setIsAddingTeam={setIsAddingTeam}
                                processing={processing}
                            />
                        ))}
                    </div>
                </div>
            )}
        </motion.div>
    );
}
