/* UserComparisonSelector.jsx - Multi-User Support */
import React, { useState, useMemo } from "react";
import {
  User, Users, ArrowLeftRight, X, AlertTriangle, Search,
  ArrowRight, Brain, Sparkles, CheckCircle, XCircle, Trophy, Target
} from "lucide-react";
import { useNavigate } from "react-router-dom";

// User lists
const IMPORT_USERS = [
  'FADWA.ERRAZIKI', 'AYOUB.SOURISTE', 'AYMANE.BERRIOUA', 'SANA.IDRISSI', 'AMINA.SAISS',
  'KHADIJA.OUFKIR', 'ZOHRA.HMOUDOU', 'SIMO.ONSI', 'YOUSSEF.ASSABIR', 'ABOULHASSAN.AMINA',
  'MEHDI.OUAZIR', 'OUMAIMA.EL.OUTMANI', 'HAMZA.ALLALI', 'MUSTAPHA.BOUJALA', 'HIND.EZZAOUI'
];

const EXPORT_USERS = [
  'IKRAM.OULHIANE', 'MOURAD.ELBAHAZ', 'MOHSINE.SABIL', 'AYA.HANNI',
  'ZAHIRA.OUHADDA', 'CHAIMAAE.EJJARI', 'HAFIDA.BOOHADDOU', 'KHADIJA.HICHAMI', 'FATIMA.ZAHRA.BOUGSIM'
];

// Helper to get team
const getUserTeam = (username) => {
  if (IMPORT_USERS.includes(username)) return "Import";
  if (EXPORT_USERS.includes(username)) return "Export";
  return "Unknown";
};

// Format name
const formatName = (username) => username.replace(/\./g, " ").replace(/\b\w/g, l => l.toUpperCase());

// Get initials
const getInitials = (username) => username.split('.').map(n => n[0]).join('').toUpperCase();

const UserComparisonSelector = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [activeTeamFilter, setActiveTeamFilter] = useState("all");
  const [comparisonMode, setComparisonMode] = useState("multi"); // "pair" or "multi"

  const maxUsers = comparisonMode === "pair" ? 2 : 6;

  // All users combined
  const allUsers = useMemo(() => [
    ...IMPORT_USERS.map(u => ({ id: u, name: formatName(u), team: 'Import' })),
    ...EXPORT_USERS.map(u => ({ id: u, name: formatName(u), team: 'Export' }))
  ].sort((a, b) => a.name.localeCompare(b.name)), []);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return allUsers
      .filter(u => !selectedUsers.includes(u.id))
      .filter(u => activeTeamFilter === 'all' || u.team === activeTeamFilter)
      .filter(u => u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.id.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [allUsers, selectedUsers, activeTeamFilter, searchTerm]);

  // Add/Remove user
  const toggleUser = (userId) => {
    if (selectedUsers.includes(userId)) {
      setSelectedUsers(prev => prev.filter(u => u !== userId));
    } else if (selectedUsers.length < maxUsers) {
      setSelectedUsers(prev => [...prev, userId]);
    }
  };

  // Start comparison
  const startComparison = () => {
    if (selectedUsers.length >= 2) {
      // Always use multi route for consistency
      navigate(`/statistics/performance/compare-multi/${selectedUsers.join(',')}`);
    }
  };

  // Check if mixed team comparison
  const teamCounts = useMemo(() => {
    const counts = { Import: 0, Export: 0 };
    selectedUsers.forEach(u => {
      const team = getUserTeam(u);
      if (team !== 'Unknown') counts[team]++;
    });
    return counts;
  }, [selectedUsers]);

  const isMixedComparison = teamCounts.Import > 0 && teamCounts.Export > 0;

  // Get user colors
  const getUserColor = (index) => {
    const colors = ['blue', 'emerald', 'purple', 'orange', 'pink', 'cyan'];
    return colors[index % colors.length];
  };

  const colorClasses = {
    blue: 'bg-blue-600 border-blue-400 shadow-blue-100',
    emerald: 'bg-emerald-600 border-emerald-400 shadow-emerald-100',
    purple: 'bg-purple-600 border-purple-400 shadow-purple-100',
    orange: 'bg-orange-600 border-orange-400 shadow-orange-100',
    pink: 'bg-pink-600 border-pink-400 shadow-pink-100',
    cyan: 'bg-cyan-600 border-cyan-400 shadow-cyan-100'
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="px-6 py-4">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-10 h-10 bg-purple-100 rounded-sm flex items-center justify-center">
              <Brain className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Performance Comparison</h1>
              <p className="text-xs text-gray-500">Compare team members and identify top performers</p>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-sm w-fit">
            <button
              onClick={() => {
                setComparisonMode("pair");
                if (selectedUsers.length > 2) setSelectedUsers(selectedUsers.slice(0, 2));
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-sm transition-all ${comparisonMode === "pair"
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Head-to-Head (2 users)
            </button>
            <button
              onClick={() => setComparisonMode("multi")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-sm transition-all ${comparisonMode === "multi"
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              Team Rankings (2-6 users)
            </button>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {/* Selected Users Display */}
        <div className="mb-6">
          {comparisonMode === "pair" ? (
            // Pair Mode - VS Layout
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {[0, 1].map(index => (
                <React.Fragment key={index}>
                  {index === 1 && (
                    <div className="flex items-center justify-center">
                      <div className="w-14 h-14 bg-gray-900 rounded-full flex items-center justify-center shadow-lg">
                        <ArrowLeftRight className="w-6 h-6 text-white" />
                      </div>
                    </div>
                  )}
                  <div className={`bg-white rounded-sm border-2 transition-all ${selectedUsers[index]
                    ? `border-${getUserColor(index)}-400 shadow-lg shadow-${getUserColor(index)}-100`
                    : 'border-dashed border-gray-200'
                    }`}>
                    <div className="p-5">
                      {selectedUsers[index] ? (
                        <div className="text-center">
                          <div className={`w-16 h-16 ${colorClasses[getUserColor(index)].split(' ')[0]} rounded-sm mx-auto flex items-center justify-center text-white text-xl font-bold mb-3`}>
                            {getInitials(selectedUsers[index])}
                          </div>
                          <h3 className="font-bold text-gray-900">{formatName(selectedUsers[index])}</h3>
                          <span className={`inline-block mt-1 text-xs bg-${getUserColor(index)}-100 text-${getUserColor(index)}-700 px-2 py-0.5 rounded-full`}>
                            {getUserTeam(selectedUsers[index])} Team
                          </span>
                          <button
                            onClick={() => toggleUser(selectedUsers[index])}
                            className="mt-3 flex items-center justify-center gap-1 mx-auto text-xs text-red-600 hover:text-red-700"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Remove
                          </button>
                        </div>
                      ) : (
                        <div className="text-center py-6">
                          <div className="w-16 h-16 bg-gray-100 rounded-sm mx-auto flex items-center justify-center mb-3">
                            <User className="w-8 h-8 text-gray-300" />
                          </div>
                          <p className="text-sm text-gray-400">Select User {index + 1}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          ) : (
            // Multi Mode - Horizontal List
            <div className="bg-white rounded-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <Target className="w-4 h-4 text-gray-400" />
                  Selected for Rankings ({selectedUsers.length}/{maxUsers})
                </h3>
                {selectedUsers.length > 0 && (
                  <button
                    onClick={() => setSelectedUsers([])}
                    className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
                  >
                    <X className="w-3 h-3" /> Clear All
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {Array.from({ length: maxUsers }).map((_, index) => (
                  <div key={index} className={`p-3 rounded-sm border-2 transition-all ${selectedUsers[index]
                    ? colorClasses[getUserColor(index)].split(' ').slice(1).join(' ')
                    : 'border-dashed border-gray-200'
                    }`}>
                    {selectedUsers[index] ? (
                      <div className="text-center">
                        <div className={`w-10 h-10 ${colorClasses[getUserColor(index)].split(' ')[0]} rounded-sm mx-auto flex items-center justify-center text-white text-xs font-bold mb-2`}>
                          {getInitials(selectedUsers[index])}
                        </div>
                        <p className="text-xs font-medium text-gray-900 truncate mb-1">{formatName(selectedUsers[index])}</p>
                        <button
                          onClick={() => toggleUser(selectedUsers[index])}
                          className="text-[10px] text-red-600 hover:text-red-700 mx-auto flex items-center gap-0.5"
                        >
                          <XCircle className="w-2.5 h-2.5" /> Remove
                        </button>
                      </div>
                    ) : (
                      <div className="text-center py-2">
                        <div className="w-10 h-10 bg-gray-100 rounded-sm mx-auto flex items-center justify-center mb-2">
                          <User className="w-5 h-5 text-gray-300" />
                        </div>
                        <p className="text-[10px] text-gray-400">User {index + 1}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Warning for Mixed Teams */}
        {isMixedComparison && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-sm p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-amber-900 text-sm">Cross-Team Comparison</h3>
                <p className="text-xs text-amber-700 mt-1">
                  Comparing {teamCounts.Import} Import and {teamCounts.Export} Export team members.
                  Results may vary due to different workflows.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Compare Button */}
        <div className="mb-6">
          <button
            onClick={startComparison}
            disabled={selectedUsers.length < 2}
            className={`w-full flex items-center justify-center gap-2 px-6 py-4 font-bold rounded-sm transition-all ${selectedUsers.length >= 2
              ? "bg-gray-900 hover:bg-gray-800 text-white shadow-lg"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
          >
            {selectedUsers.length >= 2 ? (
              <>
                <Sparkles className="w-5 h-5" />
                {comparisonMode === "pair" ? "Start Head-to-Head Analysis" : "Generate Team Rankings"}
                <ArrowRight className="w-5 h-5" />
              </>
            ) : (
              <>
                <Users className="w-5 h-5" />
                Select at least 2 users to compare
              </>
            )}
          </button>
        </div>

        {/* User Selection Grid */}
        <div className="bg-white rounded-sm border border-gray-100 shadow-sm">
          {/* Search & Filter Header */}
          <div className="p-4 border-b border-gray-100">
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Search */}
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search declarants..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Team Filter */}
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-sm">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'Import', label: 'Import' },
                  { id: 'Export', label: 'Export' }
                ].map(filter => (
                  <button
                    key={filter.id}
                    onClick={() => setActiveTeamFilter(filter.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-sm transition-all ${activeTeamFilter === filter.id
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* User Grid */}
          <div className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {filteredUsers.map(user => {
                const isSelected = selectedUsers.includes(user.id);
                const canSelect = !isSelected && selectedUsers.length < maxUsers;

                return (
                  <button
                    key={user.id}
                    onClick={() => canSelect && toggleUser(user.id)}
                    disabled={!canSelect}
                    className={`p-3 rounded-sm border text-left transition-all ${canSelect
                      ? 'border-gray-200 hover:border-gray-400 hover:bg-gray-50 cursor-pointer'
                      : 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                      }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-6 h-6 rounded-sm flex items-center justify-center text-[10px] font-bold text-white ${user.team === 'Import' ? 'bg-blue-500' : 'bg-emerald-500'
                        }`}>
                        {getInitials(user.id)}
                      </div>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${user.team === 'Import' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                        {user.team}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-gray-900 truncate">{user.name}</p>
                  </button>
                );
              })}
            </div>

            {filteredUsers.length === 0 && (
              <div className="text-center py-12">
                <Search className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No users found</p>
              </div>
            )}
          </div>

          {/* Footer Stats */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>{filteredUsers.length} declarants available</span>
            <span>{selectedUsers.length}/{maxUsers} selected</span>
          </div>
        </div>

        {/* Tip Box */}
        <div className="mt-6 bg-blue-50 border border-blue-100 rounded-sm p-4">
          <div className="flex items-start gap-3">
            <div className="p-1.5 bg-blue-100 rounded-sm">
              <Sparkles className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h3 className="font-bold text-blue-900 text-sm">
                {comparisonMode === "pair" ? "Head-to-Head Mode" : "Team Rankings Mode"}
              </h3>
              <p className="text-xs text-blue-700 mt-1">
                {comparisonMode === "pair"
                  ? "Compare two users side-by-side with in-depth efficiency analysis and strategic recommendations."
                  : "Rank 2-6 team members based on performance metrics. Perfect for identifying top performers and training opportunities."}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default UserComparisonSelector;