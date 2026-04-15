import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import Fuse from "fuse.js";
import { BlobServiceClient } from '@azure/storage-blob';
// In-memory Azure State Cache
export const AZURE_CACHE = {
    employees: [],  // [{ user, summary }] sourced from individual usersV3/ blobs
    teams: { import: [], export: [], customs: [] },  // flat map: teamName → [members]
    teamsData: []   // full team objects: [{ id, name, parent_id, members, leaders }]
};

const CONTAINER_NAME = "document-intelligence";
const USERS_BLOB_PREFIX = "Dashboard/cache/usersV3/";

function getBlobServiceClient() {
    const connStr = process.env.VITE_AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) {
        throw new Error("Missing VITE_AZURE_STORAGE_CONNECTION_STRING");
    }
    return BlobServiceClient.fromConnectionString(connStr);
}

// Ensure the cache gets hydrated — single source of truth: individual user blobs
export async function hydrateAzureCache() {
    console.log("Hydrating AI Azure Cache from individual user blobs...");
    try {
        const client = getBlobServiceClient();
        const containerClient = client.getContainerClient(CONTAINER_NAME);

        // List all individual user blobs and cache their summaries
        try {
            const userNames = [];
            for await (const blob of containerClient.listBlobsFlat({ prefix: USERS_BLOB_PREFIX })) {
                if (blob.name.endsWith('.json')) {
                    const userName = blob.name.replace(USERS_BLOB_PREFIX, '').replace('.json', '');
                    userNames.push(userName);
                }
            }

            // Fetch summaries in parallel (batched to avoid overwhelming Azure)
            const batchSize = 15;
            const allEmployees = [];
            for (let i = 0; i < userNames.length; i += batchSize) {
                const batch = userNames.slice(i, i + batchSize);
                const results = await Promise.allSettled(
                    batch.map(async (userName) => {
                        const blob = containerClient.getBlockBlobClient(`${USERS_BLOB_PREFIX}${userName}.json`);
                        const buffer = await blob.downloadToBuffer();
                        const data = JSON.parse(buffer.toString("utf8"));
                        return { user: userName, summary: data.summary || {} };
                    })
                );
                for (const r of results) {
                    if (r.status === 'fulfilled') allEmployees.push(r.value);
                }
            }

            AZURE_CACHE.employees = allEmployees;
            console.log(`Cached ${AZURE_CACHE.employees.length} employee summaries from individual blobs.`);
        } catch (e) {
            console.warn("Could not list/fetch usersV3 blobs:", e.message);
        }

        // Fetch Teams
        await refreshTeamsCache();

    } catch (e) {
        console.error("Failed to hydrate azure cache:", e);
    }
}

async function refreshTeamsCache() {
    try {
        const res = await fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/teams');
        if (res.ok) {
            const tData = await res.json();
            if (tData.success && tData.teams) {
                AZURE_CACHE.teams = {};
                AZURE_CACHE.teamsData = tData.teams;
                tData.teams.forEach(t => {
                    AZURE_CACHE.teams[t.name.toLowerCase()] = t.members.map(m => m.toUpperCase());
                });
            }
        } else {
            console.warn("Could not fetch local /api/teams");
        }
    } catch (e) {
        console.warn("Error fetching local teams API", e.message);
    }
}

// Returns all members of a team including members from all sub-teams (recursive).
// Also returns a breakdown: [{ teamName, isSubTeam, leader, members }]
function getAllTeamMembers(teamNameOrId) {
    const allTeams = AZURE_CACHE.teamsData;
    if (!allTeams || allTeams.length === 0) {
        // Fallback to flat cache
        const key = teamNameOrId.toString().toLowerCase().replace(" team", "").trim();
        return { allMembers: AZURE_CACHE.teams[key] || [], breakdown: [] };
    }

    // Find the root team — match by name (case-insensitive) or by id
    const key = teamNameOrId.toString().toLowerCase().replace(" team", "").trim();
    const rootTeam = allTeams.find(t =>
        t.name.toLowerCase() === key || String(t.id) === key
    );

    if (!rootTeam) return { allMembers: [], breakdown: [] };

    const breakdown = [];
    const allMembers = new Set();

    // Recursive collector
    function collect(team, depth) {
        const members = (team.members || []).map(m => m.toUpperCase());
        const leaders = (team.leaders || []).map(m => m.toUpperCase());
        members.forEach(m => allMembers.add(m));
        breakdown.push({ teamName: team.name, depth, leaders, members });

        // Find children
        const children = allTeams.filter(t => t.parent_id === team.id);
        children.forEach(child => collect(child, depth + 1));
    }

    collect(rootTeam, 0);
    return { allMembers: [...allMembers], breakdown };
}


// Helper function to resolve names
function resolveEmployeeName(searchName) {
    let upperSearch = searchName.toUpperCase().trim();

    // Standardize common Moroccan spelling variants
    const aliasMap = {
        "FADIOUA": "FADWA",
        "FADOUA": "FADWA",
        "MOHAMED": "MOHAMMED",
        "MAHAMMED": "MOHAMMED",
        "ABDEL": "ABDEL",
        "ABDOUL": "ABDEL",
        "SANAA": "SANA",
        "SANAE": "SANA",
        "CHAIMAA": "CHAIMAAE",
        "CHAIMAE": "CHAIMAAE"
    };

    // Apply aliases if present in the search string
    for (const [alias, real] of Object.entries(aliasMap)) {
        if (upperSearch === alias || upperSearch.includes(alias)) {
            upperSearch = upperSearch.replace(alias, real);
        }
    }

    // Build Master List of Usernames from individual employee blobs
    const allUsersArray = AZURE_CACHE.employees.map(e => e.user);

    // 1. Check for exact match against first name or last name independently
    const exactNameMatch = allUsersArray.find(u => {
        const parts = u.split('.');
        return parts.some(p => p === upperSearch);
    });
    if (exactNameMatch) return exactNameMatch;

    // 2. Check if first name or last name starts with exactly the string
    const startsWithMatch = allUsersArray.find(u => {
        const parts = u.split('.');
        return parts.some(p => p.startsWith(upperSearch));
    });
    if (startsWithMatch) return startsWithMatch;

    // 3. Fallback to basic includes
    const includesMatch = allUsersArray.find(u => u.includes(upperSearch));
    if (includesMatch) return includesMatch;

    // 4. Fall back to fuzzy search
    const fuseArray = allUsersArray.map(name => ({ name }));
    const fuse = new Fuse(fuseArray, {
        keys: ["name"],
        threshold: 0.4,
        ignoreLocation: true
    });
    const results = fuse.search(upperSearch);

    if (results.length > 0) {
        return results[0].item.name;
    }
    return null;
}

// ═══ TOOL: Get Teams List ═══
export const getTeamsList = new DynamicStructuredTool({
    name: "get_teams_list",
    description: "Fetch a list of all current company teams and their members, including sub-team hierarchy. Use this when asked about who is in a specific team, what teams exist, or who the team leaders/seniors are.",
    schema: z.object({}),
    func: async () => {
        await refreshTeamsCache();

        const allTeams = AZURE_CACHE.teamsData;

        if (!allTeams || allTeams.length === 0) {
            // Fallback to flat cache
            if (Object.keys(AZURE_CACHE.teams).length === 0) {
                return "No teams found in the database. The team structure might be empty.";
            }
            let report = `Current Company Teams List:\n\n`;
            for (const [teamName, members] of Object.entries(AZURE_CACHE.teams)) {
                report += `### ${teamName.toUpperCase()} Team\n`;
                report += `Members (${members.length}): ${members.length > 0 ? members.join(', ') : 'No members yet'}\n\n`;
            }
            return report;
        }

        // Build hierarchy: top-level teams first, then their children
        const topLevel = allTeams.filter(t => !t.parent_id);
        let report = `Company Team Structure:\n\n`;

        function renderTeam(team, indent) {
            const prefix = '  '.repeat(indent);
            const leaders = (team.leaders || []);
            const directMembers = (team.members || []).map(m => m.toUpperCase());
            const { allMembers } = getAllTeamMembers(team.name);

            report += `${prefix}▸ ${team.name.toUpperCase()}`;
            if (leaders.length > 0) report += ` — Senior/Leader: ${leaders.map(l => l.toUpperCase()).join(', ')}`;
            report += `\n`;

            if (indent === 0 && allMembers.length !== directMembers.length) {
                report += `${prefix}  Total members (incl. sub-teams): ${allMembers.length}\n`;
                report += `${prefix}  Direct members: ${directMembers.length > 0 ? directMembers.join(', ') : 'none'}\n`;
            } else {
                report += `${prefix}  Members (${directMembers.length}): ${directMembers.length > 0 ? directMembers.join(', ') : 'none'}\n`;
            }

            const children = allTeams.filter(t => t.parent_id === team.id);
            children.forEach(child => renderTeam(child, indent + 1));
            report += `\n`;
        }

        topLevel.forEach(team => renderTeam(team, 0));
        return report;
    },
});

// ═══ TOOL: Get All Employees Overview (sourced from individual user blobs) ═══
export const getAllEmployeesOverview = new DynamicStructuredTool({
    name: "get_all_employees_overview",
    description: "Fetch a summary overview of ALL employees. Shows total files, manual/auto breakdown, deletions, days active, avg files per day, avg creation time, and top principal. Sortable by multiple fields. Optionally filter by start_date/end_date to see stats for a specific period (e.g. last week, this month). When dates are provided, daily_metrics are summed per employee for that range. Use this for rankings, company-wide comparisons, and broad performance questions.",
    schema: z.object({
        sort_by: z.enum(["total_files_handled", "avg_files_per_day", "days_active", "total_manual_files", "total_automatic_files", "total_deletions", "total_modifications"]).nullable().optional().describe("Optional: field to sort results by. Defaults to total_files_handled."),
        start_date: z.string().optional().describe("Optional start date in YYYY-MM-DD format for period filtering"),
        end_date: z.string().optional().describe("Optional end date in YYYY-MM-DD format for period filtering"),
    }),
    func: async ({ sort_by, start_date, end_date } = {}) => {
        if (!AZURE_CACHE.employees || AZURE_CACHE.employees.length === 0) {
            return "Error: Employee data is not available. The cache may not have been initialized.";
        }

        const useDateFilter = !!(start_date || end_date);
        const sortField = sort_by || "total_files_handled";

        // If date filtering is requested, we need to read full blobs and sum daily_metrics
        if (useDateFilter) {
            let report = `All Employees Overview — Period: ${start_date || 'beginning'} to ${end_date || 'now'} (sorted by ${sortField}):\n\n`;

            try {
                const client = getBlobServiceClient();
                const containerClient = client.getContainerClient(CONTAINER_NAME);

                const employeeStats = [];
                const batchSize = 15;
                const userNames = AZURE_CACHE.employees.map(e => e.user);

                for (let i = 0; i < userNames.length; i += batchSize) {
                    const batch = userNames.slice(i, i + batchSize);
                    const results = await Promise.allSettled(
                        batch.map(async (userName) => {
                            const blob = containerClient.getBlockBlobClient(`${USERS_BLOB_PREFIX}${userName}.json`);
                            const buffer = await blob.downloadToBuffer();
                            const data = JSON.parse(buffer.toString("utf8"));

                            // Filter daily_metrics by date range
                            const filtered = (data.daily_metrics || []).filter(day => {
                                const d = new Date(day.date);
                                let within = true;
                                if (start_date && d < new Date(start_date)) within = false;
                                if (end_date && d > new Date(end_date)) within = false;
                                return within;
                            });

                            // Sum up stats for the filtered period
                            let totalFiles = 0, manual = 0, auto = 0, deletions = 0, modifications = 0;
                            let delOwn = 0, delOthers = 0, avgTimeSum = 0, avgTimeCount = 0;
                            for (const day of filtered) {
                                totalFiles += (day.total_files_handled || 0);
                                manual += (day.manual_files_created || 0);
                                auto += (day.automatic_files_created || 0);
                                deletions += (day.deleted_file_ids || []).length;
                                delOwn += (day.deleted_own_file_ids || []).length;
                                delOthers += (day.deleted_others_file_ids || []).length;
                                modifications += (day.modification_count || 0);
                                if (day.avg_creation_time !== null && day.avg_creation_time !== undefined) {
                                    avgTimeSum += day.avg_creation_time;
                                    avgTimeCount++;
                                }
                            }

                            return {
                                user: userName,
                                total_files_handled: totalFiles,
                                total_manual_files: manual,
                                total_automatic_files: auto,
                                total_deletions: deletions,
                                deleted_own_files: delOwn,
                                deleted_others_files: delOthers,
                                total_modifications: modifications,
                                days_active: filtered.length,
                                avg_files_per_day: filtered.length > 0 ? +(totalFiles / filtered.length).toFixed(1) : 0,
                                avg_creation_time: avgTimeCount > 0 ? +(avgTimeSum / avgTimeCount).toFixed(1) : null,
                            };
                        })
                    );
                    for (const r of results) {
                        if (r.status === 'fulfilled') employeeStats.push(r.value);
                    }
                }

                const sorted = employeeStats
                    .filter(e => e.total_files_handled > 0 || e.days_active > 0)
                    .sort((a, b) => ((b[sortField] || 0) - (a[sortField] || 0)));

                for (const e of sorted) {
                    const manualPct = e.total_files_handled > 0 ? Math.round(e.total_manual_files / e.total_files_handled * 100) : 0;
                    const autoPct = 100 - manualPct;
                    const delStr = e.total_deletions ? ` | del: ${e.total_deletions} (own:${e.deleted_own_files}/others:${e.deleted_others_files})` : '';
                    const avgTime = e.avg_creation_time !== null ? ` | avgTime: ${e.avg_creation_time}s` : '';
                    report += `${e.user}: ${e.total_files_handled} files (${e.total_manual_files}M/${e.total_automatic_files}A) | ${e.avg_files_per_day} avg/day | ${e.days_active} active days | ${manualPct}%M/${autoPct}%A${delStr}${avgTime}\n`;
                }

                report += `\nTotal: ${sorted.length} employees with activity in this period.`;
                return report;

            } catch (e) {
                return `Error reading employee data for date filtering: ${e.message}`;
            }
        }

        // No date filter — use cached summaries (fast path)
        const sorted = [...AZURE_CACHE.employees]
            .filter(e => e.summary && ((e.summary.total_files_handled || 0) > 0 || (e.summary.days_active || 0) > 0))
            .sort((a, b) => ((b.summary[sortField] || 0) - (a.summary[sortField] || 0)));

        let report = `All Employees Overview (${sorted.length} employees, sorted by ${sortField}):\n\n`;
        for (const e of sorted) {
            const s = e.summary;
            const ratio = s.manual_vs_auto_ratio
                ? `${s.manual_vs_auto_ratio.manual_percent}%M/${s.manual_vs_auto_ratio.automatic_percent}%A`
                : "N/A";
            const delStr = s.total_deletions ? ` | del: ${s.total_deletions} (own:${s.deleted_own_files || 0}/others:${s.deleted_others_files || 0})` : '';
            const avgTime = s.avg_creation_time !== undefined && s.avg_creation_time !== null ? ` | avgTime: ${s.avg_creation_time}s` : '';

            // Top principal
            let topPrincipal = '';
            if (s.principal_specialization && Object.keys(s.principal_specialization).length > 0) {
                const top = Object.entries(s.principal_specialization).sort((a, b) => b[1] - a[1])[0];
                topPrincipal = ` | top principal: ${top[0]} (${top[1]})`;
            }

            report += `${e.user}: ${s.total_files_handled || 0} files (${s.total_manual_files || 0}M/${s.total_automatic_files || 0}A) | ${s.avg_files_per_day || 0} avg/day | ${s.days_active || 0} active days | ${ratio}${delStr}${avgTime}${topPrincipal}\n`;
        }
        return report;
    },
});

// ═══ TOOL: Get Employee Data (deep individual analytics) ═══
export const getEmployeeData = new DynamicStructuredTool({
    name: "get_employee_data",
    description: "Fetch deep individual analytics for a specific employee including daily metrics, peak hours, company specialization, principal specialization, file type breakdown, deletion stats (own vs others), avg creation time, and productivity patterns. Optionally filter daily metrics by providing start_date and end_date. Use this for detailed questions about a specific person.",
    schema: z.object({
        employee_name: z.string().describe("The name or partial name of the employee"),
        start_date: z.string().optional().describe("Optional start date in YYYY-MM-DD format"),
        end_date: z.string().optional().describe("Optional end date in YYYY-MM-DD format"),
    }),
    func: async ({ employee_name, start_date, end_date }) => {
        const resolvedName = resolveEmployeeName(employee_name);
        if (!resolvedName) return `Error: No data found in the system matching '${employee_name}'.`;

        let report = `═══ Deep Analytics for ${resolvedName} ═══\n`;
        if (start_date || end_date) {
            report += `(Filtered for Period: ${start_date || 'beginning'} to ${end_date || 'now'})\n\n`;
        } else {
            report += `\n`;
        }

        // Deep fetch from users blob directly
        try {
            const client = getBlobServiceClient();
            const containerClient = client.getContainerClient(CONTAINER_NAME);
            const blob = containerClient.getBlockBlobClient(`Dashboard/cache/usersV3/${resolvedName}.json`);

            if (await blob.exists()) {
                const buffer = await blob.downloadToBuffer();
                const data = JSON.parse(buffer.toString("utf8"));

                if (data.summary) {
                    const s = data.summary;
                    report += `SUMMARY STATS:\n`;
                    report += `- Total files handled: ${s.total_files_handled}\n`;
                    report += `- Manual files: ${s.total_manual_files}\n`;
                    report += `- Automatic files: ${s.total_automatic_files}\n`;
                    report += `- Total modifications: ${s.total_modifications}\n`;
                    report += `- Avg files per day: ${s.avg_files_per_day}\n`;
                    report += `- Days active: ${s.days_active}\n`;
                    report += `- Most productive day: ${s.most_productive_day}\n`;
                    if (s.avg_creation_time !== undefined && s.avg_creation_time !== null) {
                        report += `- Avg creation time: ${s.avg_creation_time}s (${s.avg_creation_time_minutes ? s.avg_creation_time_minutes.toFixed(1) + ' min' : 'N/A'})\n`;
                    }
                    if (s.modifications_per_file !== undefined) {
                        report += `- Modifications per file: ${s.modifications_per_file}\n`;
                    }

                    if (s.manual_vs_auto_ratio) {
                        report += `- Manual vs Auto: ${s.manual_vs_auto_ratio.manual_percent}% manual / ${s.manual_vs_auto_ratio.automatic_percent}% automatic\n`;
                    }

                    // Deletion stats
                    if (s.total_deletions !== undefined) {
                        report += `\nDELETION STATS:\n`;
                        report += `- Total deletions: ${s.total_deletions}\n`;
                        report += `- Deleted own files: ${s.deleted_own_files || 0}\n`;
                        report += `- Deleted others' files: ${s.deleted_others_files || 0}\n`;
                        report += `- Deleted manual files: ${s.deleted_manual_files || 0}\n`;
                        report += `- Deleted automatic files: ${s.deleted_automatic_files || 0}\n`;
                    }

                    // Peak activity hours
                    if (s.activity_by_hour && Object.keys(s.activity_by_hour).length > 0) {
                        const topHours = Object.entries(s.activity_by_hour)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 5)
                            .map(([h, c]) => `${h}:00 (${c} actions)`).join(', ');
                        report += `\nPEAK HOURS: ${topHours}\n`;
                        if (s.hour_with_most_activity !== undefined) {
                            report += `- Most active hour: ${s.hour_with_most_activity}:00\n`;
                        }
                    }

                    // Company specialization
                    if (s.company_specialization && Object.keys(s.company_specialization).length > 0) {
                        const totalCompanyWork = Object.values(s.company_specialization).reduce((a, b) => a + b, 0);
                        const clients = Object.entries(s.company_specialization)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 5)
                            .map(([name, count]) => `${name}: ${count} (${((count / totalCompanyWork) * 100).toFixed(1)}%)`);
                        report += `\nTOP CLIENTS (Companies):\n`;
                        clients.forEach(c => report += `  - ${c}\n`);
                    }

                    // Principal specialization
                    if (s.principal_specialization && Object.keys(s.principal_specialization).length > 0) {
                        const totalPrincipalWork = Object.values(s.principal_specialization).reduce((a, b) => a + b, 0);
                        const principals = Object.entries(s.principal_specialization)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 10)
                            .map(([name, count]) => `${name}: ${count} (${((count / totalPrincipalWork) * 100).toFixed(1)}%)`);
                        report += `\nTOP PRINCIPALS:\n`;
                        principals.forEach(p => report += `  - ${p}\n`);
                    }

                    // File type breakdown
                    if (s.file_type_counts && Object.keys(s.file_type_counts).length > 0) {
                        report += `\nFILE TYPES:\n`;
                        Object.entries(s.file_type_counts)
                            .sort((a, b) => b[1] - a[1])
                            .forEach(([type, count]) => report += `  - ${type}: ${count}\n`);
                    }

                    // Inactivity days
                    if (s.inactivity_days && s.inactivity_days.length > 0) {
                        report += `\nINACTIVE DAYS (${s.inactivity_days.length}): ${s.inactivity_days.slice(0, 10).join(', ')}${s.inactivity_days.length > 10 ? '...' : ''}\n`;
                    }
                }

                // Recent daily metrics (last 10 entries) or filter by date
                if (data.daily_metrics && data.daily_metrics.length > 0) {
                    let recent = data.daily_metrics;
                    if (start_date || end_date) {
                        recent = recent.filter(day => {
                            const d = new Date(day.date);
                            let within = true;
                            if (start_date && d < new Date(start_date)) within = false;
                            if (end_date && d > new Date(end_date)) within = false;
                            return within;
                        });
                        
                        let periodTotal = 0;
                        let periodManual = 0;
                        let periodAuto = 0;
                        let periodDeletions = 0;
                        let periodDeletedOwn = 0;
                        let periodDeletedOthers = 0;
                        let periodModifications = 0;
                        let periodAvgTimeSum = 0;
                        let periodAvgTimeCount = 0;
                        for (const day of recent) {
                            periodTotal += day.total_files_handled;
                            periodManual += (day.manual_files_created || 0);
                            periodAuto += (day.automatic_files_created || 0);
                            periodDeletions += (day.deleted_file_ids || []).length;
                            periodDeletedOwn += (day.deleted_own_file_ids || []).length;
                            periodDeletedOthers += (day.deleted_others_file_ids || []).length;
                            periodModifications += (day.modification_count || 0);
                            if (day.avg_creation_time !== null && day.avg_creation_time !== undefined) {
                                periodAvgTimeSum += day.avg_creation_time;
                                periodAvgTimeCount++;
                            }
                        }
                        const periodAvgTime = periodAvgTimeCount > 0 ? (periodAvgTimeSum / periodAvgTimeCount).toFixed(1) : 'N/A';
                        report += `\nFILTERED PERIOD TOTALS (${recent.length} days):\n`;
                        report += `- Files: ${periodTotal} (${periodManual} manual / ${periodAuto} automatic)\n`;
                        report += `- Modifications: ${periodModifications}\n`;
                        report += `- Deletions: ${periodDeletions} (own: ${periodDeletedOwn} / others: ${periodDeletedOthers})\n`;
                        report += `- Avg creation time: ${periodAvgTime}s\n`;
                        report += `- Avg files per day: ${recent.length > 0 ? (periodTotal / recent.length).toFixed(1) : 0}\n`;
                    } else {
                        recent = recent.slice(-10);
                    }

                    if (recent.length > 0) {
                        report += `\nDAILY METRICS (${start_date || end_date ? 'Filtered' : 'last ' + recent.length + ' days'}):\n`;
                        for (const day of recent) {
                            const deleted = (day.deleted_file_ids || []).length;
                            const deletedOwn = (day.deleted_own_file_ids || []).length;
                            const deletedOthers = (day.deleted_others_file_ids || []).length;
                            const avgTime = day.avg_creation_time !== null && day.avg_creation_time !== undefined ? ` | avg time: ${day.avg_creation_time}s` : '';
                            const delInfo = deleted > 0 ? ` | ${deleted} deleted (own:${deletedOwn}/others:${deletedOthers})` : '';
                            report += `  ${day.date}: ${day.total_files_handled} files (${day.manual_files_created}M/${day.automatic_files_created}A) | ${day.modification_count} modifs${delInfo}${avgTime}\n`;
                        }
                    } else {
                        report += `\nNo daily metrics found for the specified period.\n`;
                    }
                }

            } else {
                // Fallback to cached summary from hydration
                const cachedEmp = AZURE_CACHE.employees.find(e => e.user === resolvedName);
                if (cachedEmp && cachedEmp.summary) {
                    report += `(Limited data - blob not found, using cached summary)\n`;
                    report += `- Total files handled: ${cachedEmp.summary.total_files_handled || 0}\n`;
                    report += `- Days active: ${cachedEmp.summary.days_active || 0}\n`;
                    report += `- Avg files per day: ${cachedEmp.summary.avg_files_per_day || 0}\n`;
                } else {
                    report += `(No data found for this employee)\n`;
                }
            }
        } catch (e) {
            report += `(Error loading data: ${e.message})\n`;
        }

        return report;
    },
});

export const getTeamOverview = new DynamicStructuredTool({
    name: "get_team_overview",
    description: "Calculates totals, deletions, and averages for everyone in a specific team. Shows preferred clients and top principals per member. Filter by start_date and end_date if asking about a specific timeframe like 'last week' or 'this month'.",
    schema: z.object({
        team_name: z.string().describe("The name of the team (e.g. import, export)"),
        start_date: z.string().optional().describe("Optional start date in YYYY-MM-DD format (e.g. 2026-03-02)"),
        end_date: z.string().optional().describe("Optional end date in YYYY-MM-DD format (e.g. 2026-03-08)"),
    }),
    func: async ({ team_name, start_date, end_date }) => {
        await refreshTeamsCache();

        const teamKey = team_name.toLowerCase().replace(" team", "").trim();
        const { allMembers, breakdown } = getAllTeamMembers(teamKey);

        // Fallback to flat cache if teamsData isn't populated
        const members = allMembers.length > 0 ? allMembers : AZURE_CACHE.teams[teamKey];
        if (!members || members.length === 0) return `Team '${team_name}' not found. Available teams: ${Object.keys(AZURE_CACHE.teams).join(', ')}`;

        let totalFiles = 0;
        let totalDeletions = 0;
        let activeMembers = 0;
        let foundLogsInPeriod = false;

        let report = `Team Overview for ${team_name.toUpperCase()}:\n`;
        if (start_date || end_date) {
            report += `Period: ${start_date || 'beginning'} to ${end_date || 'now'}\n`;
        }

        // Show hierarchy breakdown if sub-teams exist
        if (breakdown.length > 1) {
            report += `\nTeam Structure:\n`;
            breakdown.forEach(({ teamName, depth, leaders, members: bMembers }) => {
                const indent = '  '.repeat(depth);
                const leaderStr = leaders.length > 0 ? ` [Senior: ${leaders.join(', ')}]` : '';
                report += `${indent}▸ ${teamName}${leaderStr}: ${bMembers.length} member(s)\n`;
            });
            report += `\nAll Members (${members.length}): ${members.join(', ')}\n\n`;
        } else {
            report += `Members: ${members.join(', ')}\n\n`;
        }

        try {
            const client = getBlobServiceClient();
            const containerClient = client.getContainerClient(CONTAINER_NAME);

            for (const m of members) {
                let memberTotal = 0;
                let memberDeletions = 0;
                let topClients = "Unknown";
                let topPrincipals = "Unknown";

                try {
                    const blob = containerClient.getBlockBlobClient(`Dashboard/cache/usersV3/${m}.json`);
                    if (await blob.exists()) {
                        const buffer = await blob.downloadToBuffer();
                        const data = JSON.parse(buffer.toString("utf8"));

                        if (start_date || end_date) {
                            if (data.daily_metrics) {
                                for (const metric of data.daily_metrics) {
                                    const d = new Date(metric.date);
                                    let within = true;
                                    if (start_date && d < new Date(start_date)) within = false;
                                    if (end_date && d > new Date(end_date)) within = false;
                                    if (within) {
                                        memberTotal += (metric.total_files_handled || 0);
                                        memberDeletions += (metric.deleted_file_ids || []).length;
                                        foundLogsInPeriod = true;
                                    }
                                }
                            }
                        } else {
                            if (data.summary) {
                                memberTotal = data.summary.total_files_handled || 0;
                                memberDeletions = data.summary.total_deletions || 0;
                                foundLogsInPeriod = true;
                            }
                        }

                        if (data.summary && data.summary.company_specialization && Object.keys(data.summary.company_specialization).length > 0) {
                            topClients = Object.entries(data.summary.company_specialization)
                                .sort((a, b) => b[1] - a[1])
                                .slice(0, 3)
                                .map(x => x[0]).join(', ');
                        } else {
                            topClients = "None";
                        }

                        if (data.summary && data.summary.principal_specialization && Object.keys(data.summary.principal_specialization).length > 0) {
                            topPrincipals = Object.entries(data.summary.principal_specialization)
                                .sort((a, b) => b[1] - a[1])
                                .slice(0, 3)
                                .map(x => x[0]).join(', ');
                        } else {
                            topPrincipals = "None";
                        }
                    } else {
                        // Fallback to cached summary
                        const cachedEmp = AZURE_CACHE.employees.find(e => e.user === m);
                        if (cachedEmp && cachedEmp.summary) {
                            memberTotal = cachedEmp.summary.total_files_handled || 0;
                            memberDeletions = cachedEmp.summary.total_deletions || 0;
                        }
                    }
                } catch (e) {
                    // silent fallback
                }

                totalFiles += parseInt(memberTotal, 10);
                totalDeletions += parseInt(memberDeletions, 10);
                activeMembers++;
                const delStr = memberDeletions > 0 ? ` | ${memberDeletions} deleted` : '';
                report += ` - ${m}: ${memberTotal} files${delStr} | Clients: ${topClients} | Principals: ${topPrincipals}\n`;
            }
        } catch (e) {
            report += `Error reading team member files: ${e.message}\n`;
        }

        report += `\nTotal Team Files: ${totalFiles}\n`;
        if (totalDeletions > 0) report += `Total Team Deletions: ${totalDeletions}\n`;
        if (activeMembers > 0) report += `Avg Per Member: ${(totalFiles / activeMembers).toFixed(2)}\n`;

        if ((start_date || end_date) && !foundLogsInPeriod) {
            report += `\n[WARNING FOR AI: There are absolutely no activity logs found for any member of this team during the requested dates (${start_date || 'start'} to ${end_date || 'now'}). The 0 files shown above simply mean no work was logged yet.]\n`;
        }

        return report;
    },
});

export const getTeamPrincipals = new DynamicStructuredTool({
    name: "get_team_principals",
    description: "Returns the exact principals found in employee data for one team or for all teams. Use this whenever the user asks to list principals, count principals, or asks which principals belong to a team or to all teams. Never guess principal names manually when this tool is available.",
    schema: z.object({
        team_name: z.string().optional().describe("Optional team name. If omitted, returns principals for all teams."),
    }),
    func: async ({ team_name } = {}) => {
        await refreshTeamsCache();

        const allTeams = AZURE_CACHE.teamsData || [];
        const topLevelTeams = allTeams.length > 0
            ? allTeams.filter(t => !t.parent_id)
            : Object.entries(AZURE_CACHE.teams)
                .map(([name, members]) => ({ name, members }))
                .filter(t => Array.isArray(t.members));

        if (topLevelTeams.length === 0) {
            return "No teams are available in the system right now.";
        }

        const requestedKey = team_name?.toLowerCase().replace(" team", "").trim();
        const teamsToAnalyze = requestedKey
            ? topLevelTeams.filter(t => t.name.toLowerCase() === requestedKey || t.name.toLowerCase().includes(requestedKey))
            : topLevelTeams;

        if (teamsToAnalyze.length === 0) {
            return `Team '${team_name}' not found. Available teams: ${topLevelTeams.map(t => t.name).join(', ')}`;
        }

        const client = getBlobServiceClient();
        const containerClient = client.getContainerClient(CONTAINER_NAME);
        const memberPrincipalCache = new Map();

        async function getMemberPrincipalSpec(memberName) {
            if (memberPrincipalCache.has(memberName)) {
                return memberPrincipalCache.get(memberName);
            }

            let principalSpec = {};

            try {
                const blob = containerClient.getBlockBlobClient(`${USERS_BLOB_PREFIX}${memberName}.json`);
                if (await blob.exists()) {
                    const buffer = await blob.downloadToBuffer();
                    const data = JSON.parse(buffer.toString("utf8"));
                    principalSpec = data.summary?.principal_specialization || {};
                } else {
                    const cachedEmp = AZURE_CACHE.employees.find(e => e.user === memberName);
                    principalSpec = cachedEmp?.summary?.principal_specialization || {};
                }
            } catch {
                const cachedEmp = AZURE_CACHE.employees.find(e => e.user === memberName);
                principalSpec = cachedEmp?.summary?.principal_specialization || {};
            }

            memberPrincipalCache.set(memberName, principalSpec);
            return principalSpec;
        }

        const sections = [];

        for (const team of teamsToAnalyze) {
            const { allMembers } = getAllTeamMembers(team.name);
            const members = allMembers.length > 0
                ? allMembers
                : (team.members || []).map(m => String(m).toUpperCase());

            const principalTotals = new Map();
            const principalHandlers = new Map();

            for (const member of members) {
                const principalSpec = await getMemberPrincipalSpec(member);
                for (const [principal, count] of Object.entries(principalSpec)) {
                    principalTotals.set(principal, (principalTotals.get(principal) || 0) + Number(count || 0));
                    principalHandlers.set(principal, (principalHandlers.get(principal) || 0) + 1);
                }
            }

            const sortedPrincipals = [...principalTotals.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

            let section = `${team.name.toUpperCase()} Team Principals\n`;
            section += `Members considered: ${members.length}\n`;

            if (sortedPrincipals.length === 0) {
                section += `No principal data found in current member files.\n`;
            } else {
                sortedPrincipals.forEach(([principal, totalCount]) => {
                    const handlers = principalHandlers.get(principal) || 0;
                    section += `- ${principal} | files: ${totalCount} | handlers: ${handlers}\n`;
                });
                section += `Total Principals: ${sortedPrincipals.length}\n`;
            }

            sections.push(section);
        }

        if (!team_name) {
            const totalUniquePrincipals = new Set();
            sections.forEach(section => {
                section.split('\n')
                    .filter(line => line.startsWith('- '))
                    .forEach(line => totalUniquePrincipals.add(line.slice(2).split(' | ')[0]));
            });

            return `All Teams Principal Report\n${'='.repeat(30)}\n\n${sections.join('\n')}\nUnique principals across all listed teams: ${totalUniquePrincipals.size}`;
        }

        return sections.join('\n');
    },
});

export const getTeamPrincipalCoverage = new DynamicStructuredTool({
    name: "get_team_principal_coverage",
    description: "For a specific team, returns each principal with the top users who actually handled it, ranked by real file volume from principal_specialization. Use this for questions like 'for each principal in Import, who are the top 3 users?' or 'group the team by principal'.",
    schema: z.object({
        team_name: z.string().describe("Team name to analyze."),
        top_n: z.number().optional().describe("How many top users to return per principal. Defaults to 3."),
    }),
    func: async ({ team_name, top_n } = {}) => {
        await refreshTeamsCache();

        const limit = Math.max(1, Math.min(Number(top_n || 3), 10));
        const { allMembers } = getAllTeamMembers(team_name);
        if (allMembers.length === 0) {
            return `Team '${team_name}' not found.`;
        }

        const client = getBlobServiceClient();
        const containerClient = client.getContainerClient(CONTAINER_NAME);
        const principalMap = new Map();

        for (const member of allMembers) {
            let principalSpec = {};

            try {
                const blob = containerClient.getBlockBlobClient(`${USERS_BLOB_PREFIX}${member}.json`);
                if (await blob.exists()) {
                    const buffer = await blob.downloadToBuffer();
                    const data = JSON.parse(buffer.toString("utf8"));
                    principalSpec = data.summary?.principal_specialization || {};
                } else {
                    const cachedEmp = AZURE_CACHE.employees.find(e => e.user === member);
                    principalSpec = cachedEmp?.summary?.principal_specialization || {};
                }
            } catch {
                const cachedEmp = AZURE_CACHE.employees.find(e => e.user === member);
                principalSpec = cachedEmp?.summary?.principal_specialization || {};
            }

            for (const [principal, count] of Object.entries(principalSpec)) {
                const numericCount = Number(count || 0);
                if (numericCount <= 0) continue;
                if (!principalMap.has(principal)) {
                    principalMap.set(principal, []);
                }
                principalMap.get(principal).push({ user: member, count: numericCount });
            }
        }

        const principals = [...principalMap.entries()]
            .map(([principal, users]) => ({
                principal,
                total: users.reduce((sum, row) => sum + row.count, 0),
                users: users.sort((a, b) => b.count - a.count || a.user.localeCompare(b.user)),
            }))
            .sort((a, b) => b.total - a.total || a.principal.localeCompare(b.principal));

        if (principals.length === 0) {
            return `No principal coverage data found for team '${team_name}'.`;
        }

        let report = `TEAM PRINCIPAL COVERAGE — ${team_name.toUpperCase()}\n`;
        report += `${'='.repeat(58)}\n`;
        report += `Members considered: ${allMembers.length}\n`;
        report += `Principals found: ${principals.length}\n`;
        report += `Top users per principal: ${limit}\n\n`;

        for (const row of principals) {
            report += `${row.principal} — total files: ${row.total}\n`;
            row.users.slice(0, limit).forEach((userRow, index) => {
                report += `  ${index + 1}. ${userRow.user}: ${userRow.count}\n`;
            });
            report += `\n`;
        }

        return report.trim();
    },
});

export const addUserToTeam = new DynamicStructuredTool({
    name: "add_user_to_team",
    description: "Assign an employee to a specific team.",
    schema: z.object({
        employee_name: z.string(),
        team_name: z.string(),
    }),
    func: async ({ employee_name, team_name }) => {
        const team = team_name.toLowerCase().replace(" team", "").trim();
        const resolvedName = resolveEmployeeName(employee_name);

        if (!resolvedName) return `Error: Could not resolve name '${employee_name}'`;

        let removedFrom = null;
        for (const [tName, members] of Object.entries(AZURE_CACHE.teams)) {
            const index = members.indexOf(resolvedName);
            if (index > -1) {
                members.splice(index, 1);
                removedFrom = tName;
            }
        }

        if (!AZURE_CACHE.teams[team]) AZURE_CACHE.teams[team] = [];
        AZURE_CACHE.teams[team].push(resolvedName);

        // We aren't doing the fully synced API save since we don't have the team UUID easily available here, 
        // but it modifies the internal memory for the agent simulation.

        return `Action Successful: Added ${resolvedName} to the '${team}' team.` +
            (removedFrom ? ` (Removed from ${removedFrom})` : "");
    },
});

export const removeUserFromTeam = new DynamicStructuredTool({
    name: "remove_user_from_team",
    description: "Remove an employee from all tracking teams.",
    schema: z.object({
        employee_name: z.string(),
    }),
    func: async ({ employee_name }) => {
        const resolvedName = resolveEmployeeName(employee_name);
        if (!resolvedName) return `Error: Could not resolve name '${employee_name}'`;

        let removedFrom = null;
        for (const [tName, members] of Object.entries(AZURE_CACHE.teams)) {
            const index = members.indexOf(resolvedName);
            if (index > -1) {
                members.splice(index, 1);
                removedFrom = tName;
            }
        }

        return removedFrom
            ? `Action Successful: Removed ${resolvedName} from ${removedFrom}.`
            : `User ${resolvedName} was not found in any team.`;
    },
});

export const autoAssignTeamsByFileTypes = new DynamicStructuredTool({
    name: "auto_assign_teams_by_file_types",
    description: "Loops all users, looks at file creation trends and auto-assigns matching users to Import/Export.",
    schema: z.object({}),
    func: async () => {
        let assigned = 0;

        for (const emp of AZURE_CACHE.employees) {
            if (!emp.user || !emp.summary) continue;
            const fileTypes = emp.summary.file_type_counts || {};
            const totalFiles = emp.summary.total_files_handled || 0;
            if (totalFiles < 50) continue;

            // Determine team based on file type specialization
            const hasImport = Object.keys(fileTypes).some(t => t.toUpperCase().includes('IMPORT'));
            const hasExport = Object.keys(fileTypes).some(t => t.toUpperCase().includes('EXPORT'));

            let targetTeam = 'customs'; // default
            if (hasImport && !hasExport) targetTeam = 'import';
            else if (hasExport && !hasImport) targetTeam = 'export';
            else if (hasImport && hasExport) {
                // Assign to whichever has more volume
                const importCount = Object.entries(fileTypes).filter(([t]) => t.toUpperCase().includes('IMPORT')).reduce((s, [, c]) => s + c, 0);
                const exportCount = Object.entries(fileTypes).filter(([t]) => t.toUpperCase().includes('EXPORT')).reduce((s, [, c]) => s + c, 0);
                targetTeam = importCount >= exportCount ? 'import' : 'export';
            }

            if (!AZURE_CACHE.teams[targetTeam]) AZURE_CACHE.teams[targetTeam] = [];
            if (!AZURE_CACHE.teams[targetTeam].includes(emp.user)) {
                AZURE_CACHE.teams[targetTeam].push(emp.user);
                assigned++;
            }
        }

        return `Action Successful: Auto-assigned ${assigned} prominent users to operational teams based on their file type specialization.`;
    },
});

// ═══ TOOL: Monthly Report ═══
export const getMonthlyReport = new DynamicStructuredTool({
    name: "get_monthly_report",
    description: "Generate a full monthly performance report for all employees, broken down by team. Shows total files, manual/auto split, avg per active day, modifications, and deletions for the given month. Ranks employees within each team. Use this when asked about monthly performance, monthly rankings, how the team did this month, or month-over-month comparisons.",
    schema: z.object({
        month: z.string().optional().describe("Month in YYYY-MM format (e.g. '2026-04'). Defaults to the current month."),
        team_name: z.string().optional().describe("Optional: filter report to a single team name.")
    }),
    func: async ({ month, team_name } = {}) => {
        await refreshTeamsCache();

        // Determine date range
        const now = new Date();
        const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const [yr, mo] = targetMonth.split('-').map(Number);
        const startDate = new Date(yr, mo - 1, 1);
        const endDate = new Date(yr, mo, 0); // last day of month

        const allTeams = AZURE_CACHE.teamsData || [];
        const client = getBlobServiceClient();
        const containerClient = client.getContainerClient(CONTAINER_NAME);

        // Collect stats for every known employee
        const userNames = AZURE_CACHE.employees.map(e => e.user);
        const statsMap = {};

        const batchSize = 15;
        for (let i = 0; i < userNames.length; i += batchSize) {
            const batch = userNames.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(async (userName) => {
                const blob = containerClient.getBlockBlobClient(`${USERS_BLOB_PREFIX}${userName}.json`);
                if (!(await blob.exists())) return null;
                const buffer = await blob.downloadToBuffer();
                const data = JSON.parse(buffer.toString('utf8'));

                const filtered = (data.daily_metrics || []).filter(day => {
                    const d = new Date(day.date);
                    return d >= startDate && d <= endDate;
                });

                if (filtered.length === 0) return null;

                let total = 0, manual = 0, auto = 0, mods = 0, dels = 0, delOwn = 0, delOthers = 0;
                for (const day of filtered) {
                    total += day.total_files_handled || 0;
                    manual += day.manual_files_created || 0;
                    auto += day.automatic_files_created || 0;
                    mods += day.modification_count || 0;
                    dels += (day.deleted_file_ids || []).length;
                    delOwn += (day.deleted_own_file_ids || []).length;
                    delOthers += (day.deleted_others_file_ids || []).length;
                }

                const daysActive = filtered.length;
                const avgPerDay = daysActive > 0 ? +(total / daysActive).toFixed(1) : 0;
                const manualPct = total > 0 ? Math.round(manual / total * 100) : 0;

                return {
                    user: userName,
                    total, manual, auto, mods, dels, delOwn, delOthers,
                    daysActive, avgPerDay, manualPct, autoPct: 100 - manualPct
                };
            }));

            for (const r of results) {
                if (r.status === 'fulfilled' && r.value) statsMap[r.value.user] = r.value;
            }
        }

        if (Object.keys(statsMap).length === 0) {
            return `No activity data found for ${targetMonth}. Logs may not have been generated yet for this month.`;
        }

        // Group by top-level team
        const teamBuckets = {};
        const assignedUsers = new Set();

        // Walk teams: assign user to their top-level parent team
        function getTopLevelTeam(teamId) {
            const t = allTeams.find(x => x.id === teamId);
            if (!t) return null;
            if (!t.parent_id) return t.name;
            return getTopLevelTeam(t.parent_id);
        }

        for (const team of allTeams) {
            for (const member of (team.members || [])) {
                const topTeam = getTopLevelTeam(team.id);
                if (!topTeam) continue;
                if (!teamBuckets[topTeam]) teamBuckets[topTeam] = [];
                if (!assignedUsers.has(member.toUpperCase())) {
                    assignedUsers.add(member.toUpperCase());
                    teamBuckets[topTeam].push(member.toUpperCase());
                }
            }
        }

        // Put employees without a team assignment in Unassigned
        for (const userName of Object.keys(statsMap)) {
            if (!assignedUsers.has(userName)) {
                if (!teamBuckets['Unassigned']) teamBuckets['Unassigned'] = [];
                teamBuckets['Unassigned'].push(userName);
            }
        }

        // Filter by team if requested
        const teamsToShow = team_name
            ? Object.keys(teamBuckets).filter(t => t.toLowerCase().includes(team_name.toLowerCase()))
            : Object.keys(teamBuckets).sort();

        let report = `Monthly Performance Report — ${targetMonth}\n`;
        report += `${'═'.repeat(50)}\n\n`;

        let grandTotal = 0, grandActive = 0;

        for (const teamLabel of teamsToShow) {
            const members = teamBuckets[teamLabel] || [];
            const memberStats = members.map(m => statsMap[m]).filter(Boolean);
            if (memberStats.length === 0) continue;

            memberStats.sort((a, b) => b.total - a.total);

            const teamTotal = memberStats.reduce((s, e) => s + e.total, 0);
            const teamAvg = memberStats.length > 0 ? +(teamTotal / memberStats.length).toFixed(1) : 0;
            grandTotal += teamTotal;
            grandActive += memberStats.length;

            report += `▸ ${teamLabel.toUpperCase()} TEAM — ${memberStats.length} active members | ${teamTotal} total files | avg ${teamAvg} files/member\n`;
            report += `${'─'.repeat(50)}\n`;

            memberStats.forEach((e, i) => {
                const rank = i + 1;
                const delStr = e.dels > 0 ? ` | del: ${e.dels} (own:${e.delOwn}/others:${e.delOthers})` : '';
                const modsStr = e.mods > 0 ? ` | ${e.mods} mods` : '';
                report += `  ${rank}. ${e.user}: ${e.total} files (${e.manualPct}%M/${e.autoPct}%A) | ${e.avgPerDay} avg/day | ${e.daysActive} days active${modsStr}${delStr}\n`;
            });
            report += `\n`;
        }

        report += `${'═'.repeat(50)}\n`;
        report += `GRAND TOTAL: ${grandTotal} files across ${grandActive} active employees\n`;
        report += `Company target: 13 files/day minimum per employee\n`;

        // Underperformers (< 13 files/day avg)
        const underperformers = Object.values(statsMap).filter(e => e.avgPerDay < 13 && e.daysActive >= 5);
        if (underperformers.length > 0) {
            report += `\n⚠️ BELOW TARGET (<13 files/day, min 5 active days):\n`;
            underperformers.sort((a, b) => a.avgPerDay - b.avgPerDay).forEach(e => {
                report += `  - ${e.user}: ${e.avgPerDay} avg/day (${e.total} total, ${e.daysActive} days)\n`;
            });
        }

        return report;
    }
});

// ═══ TOOL: Compare Employees ═══
export const compareEmployees = new DynamicStructuredTool({
    name: "compare_employees",
    description: "Expert data-science comparison of any number of employees (2 or more — no upper limit). Calculates efficiency scores, consistency, workload capacity, automation rate, principal/company specialization depth, and generates strategic work-distribution recommendations. Use this when asked to compare employees, distribute principal workload, identify who should handle which clients, rebalance team assignments, or get a head-to-head analysis.",
    schema: z.object({
        employee_names: z.array(z.string()).min(2).describe("List of 2 or more employee names to compare. No upper limit."),
        start_date: z.string().optional().describe("Optional start date YYYY-MM-DD for period-specific comparison."),
        end_date: z.string().optional().describe("Optional end date YYYY-MM-DD for period-specific comparison.")
    }),
    func: async ({ employee_names, start_date, end_date }) => {
        const client = getBlobServiceClient();
        const containerClient = client.getContainerClient(CONTAINER_NAME);

        // Resolve and fetch all employees in parallel
        const resolved = employee_names.map(n => resolveEmployeeName(n));
        const notFound = employee_names.filter((_, i) => !resolved[i]);
        if (notFound.length > 0) return `Could not resolve: ${notFound.join(', ')}. Check spelling or use get_all_employees_overview to see available names.`;

        const fetchResults = await Promise.allSettled(resolved.map(async (name) => {
            const blob = containerClient.getBlockBlobClient(`${USERS_BLOB_PREFIX}${name}.json`);
            if (!(await blob.exists())) return null;
            const buffer = await blob.downloadToBuffer();
            return { name, data: JSON.parse(buffer.toString('utf8')) };
        }));

        const profiles = fetchResults
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);

        if (profiles.length < 2) return `Could not load data for at least 2 employees. Check that their performance files exist.`;

        // Compute stats per employee (period-filtered if dates given)
        const stats = profiles.map(({ name, data }) => {
            const { summary, daily_metrics = [] } = data;

            let days = daily_metrics;
            if (start_date || end_date) {
                days = daily_metrics.filter(day => {
                    const d = new Date(day.date);
                    if (start_date && d < new Date(start_date)) return false;
                    if (end_date && d > new Date(end_date)) return false;
                    return true;
                });
            }

            // Period totals
            let total = 0, manual = 0, auto = 0, mods = 0, dels = 0, delOwn = 0, delOthers = 0;
            for (const day of days) {
                total += day.total_files_handled || 0;
                manual += day.manual_files_created || 0;
                auto += day.automatic_files_created || 0;
                mods += day.modification_count || 0;
                dels += (day.deleted_file_ids || []).length;
                delOwn += (day.deleted_own_file_ids || []).length;
                delOthers += (day.deleted_others_file_ids || []).length;
            }

            const daysActive = days.length;
            const avgPerDay = daysActive > 0 ? +(total / daysActive).toFixed(2) : 0;
            const autoPct = total > 0 ? Math.round(auto / total * 100) : (summary?.manual_vs_auto_ratio?.automatic_percent || 0);
            const modsPerFile = total > 0 ? +(mods / total).toFixed(2) : (summary?.modifications_per_file || 0);

            // Efficiency score (same formula as the Compare page)
            const outputScore = Math.min(avgPerDay * 8, 50);
            const complexityBonus = Math.min(modsPerFile * 1.5, 25);
            const automationScore = autoPct * 0.25;
            const efficiencyScore = Math.round(Math.min(100, outputScore + complexityBonus + automationScore));

            // Consistency score (coefficient of variation over last 30 active days)
            const recentFiles = days.slice(-30).map(d => d.total_files_handled || 0).filter(f => f > 0);
            let consistencyScore = 50, consistencyLabel = 'Insufficient Data';
            if (recentFiles.length >= 3) {
                const mean = recentFiles.reduce((a, b) => a + b, 0) / recentFiles.length;
                const variance = recentFiles.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / recentFiles.length;
                const cv = mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 100;
                consistencyScore = Math.round(Math.max(0, Math.min(100, 100 - cv)));
                if (consistencyScore >= 80) consistencyLabel = 'Very Consistent';
                else if (consistencyScore >= 60) consistencyLabel = 'Consistent';
                else if (consistencyScore >= 40) consistencyLabel = 'Moderate';
                else consistencyLabel = 'Variable';
            }

            // Capacity
            const maxDay = days.length > 0 ? Math.max(...days.map(d => d.total_files_handled || 0)) : 0;
            const utilization = maxDay > 0 ? Math.round((avgPerDay / maxDay) * 100) : 0;

            // Full principal & company breakdown (always from full summary for specialization depth)
            const principalSpec = summary?.principal_specialization || {};
            const companySpec = summary?.company_specialization || {};
            const topCompany = Object.keys(companySpec).length > 0
                ? Object.entries(companySpec).sort((a, b) => b[1] - a[1])[0][0] : 'N/A';
            const topPrincipal = Object.keys(principalSpec).length > 0
                ? Object.entries(principalSpec).sort((a, b) => b[1] - a[1])[0][0] : 'N/A';

            // Top 5 principals with volumes for work-distribution analysis
            const top5Principals = Object.entries(principalSpec)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([p, c]) => ({ principal: p, count: c }));

            const top5Companies = Object.entries(companySpec)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([c, count]) => ({ company: c, count }));

            // Capacity headroom in absolute files (how many more files/day before hitting personal max)
            const capacityHeadroomFiles = maxDay > 0 ? +(maxDay - avgPerDay).toFixed(1) : 0;

            return {
                name, total, manual, auto, mods, dels, delOwn, delOthers,
                daysActive, avgPerDay, autoPct, modsPerFile,
                efficiencyScore, consistencyScore, consistencyLabel,
                maxDay, utilization, headroom: 100 - utilization, capacityHeadroomFiles,
                topCompany, topPrincipal, top5Principals, top5Companies,
                principalSpec, companySpec,
                avgCreationTime: summary?.avg_creation_time || null
            };
        });

        // Sort by efficiency score descending
        stats.sort((a, b) => b.efficiencyScore - a.efficiencyScore);

        const periodLabel = (start_date || end_date)
            ? `${start_date || 'start'} → ${end_date || 'now'}`
            : 'Full History';

        let report = `Employee Comparison Report — ${periodLabel}\n`;
        report += `${'═'.repeat(55)}\n\n`;

        // Side-by-side metrics table
        report += `PERFORMANCE METRICS:\n`;
        report += `${'─'.repeat(55)}\n`;
        const col = (v) => String(v).padStart(12);
        report += `${'Metric'.padEnd(28)}${stats.map(s => col(s.name.split('.')[0])).join('')}\n`;
        report += `${'─'.repeat(55)}\n`;

        const rows = [
            ['Total Files', s => s.total],
            ['Avg Files/Day', s => s.avgPerDay],
            ['Days Active', s => s.daysActive],
            ['Max Day', s => s.maxDay],
            ['Manual %', s => `${100 - s.autoPct}%`],
            ['Auto %', s => `${s.autoPct}%`],
            ['Mods/File', s => s.modsPerFile],
            ['Deletions', s => s.dels],
            ['Del Others', s => s.delOthers],
            ['Efficiency Score', s => `${s.efficiencyScore}/100`],
            ['Consistency', s => `${s.consistencyScore} (${s.consistencyLabel})`],
            ['Capacity Util.', s => `${s.utilization}%`],
            ['Top Company', s => s.topCompany],
            ['Top Principal', s => s.topPrincipal],
        ];

        for (const [label, fn] of rows) {
            report += `${label.padEnd(28)}${stats.map(s => col(fn(s))).join('')}\n`;
        }

        // Rankings
        report += `\nRANKINGS (1 = best):\n`;
        report += `${'─'.repeat(55)}\n`;
        const rankMetrics = [
            ['Efficiency Score', s => s.efficiencyScore, true],
            ['Avg Files/Day', s => s.avgPerDay, true],
            ['Consistency', s => s.consistencyScore, true],
            ['Automation Rate', s => s.autoPct, true],
            ['Deletions of Others', s => s.delOthers, false],
        ];
        for (const [label, fn, higherBetter] of rankMetrics) {
            const sorted = [...stats].sort((a, b) => higherBetter ? fn(b) - fn(a) : fn(a) - fn(b));
            const rankStr = stats.map(s => col(`#${sorted.findIndex(x => x.name === s.name) + 1}`)).join('');
            report += `${label.padEnd(28)}${rankStr}\n`;
        }

        // Strategic recommendations
        report += `\nSTRATEGIC RECOMMENDATIONS:\n`;
        report += `${'─'.repeat(55)}\n`;
        const recommendations = [];

        // Efficiency gap
        const topEff = stats[0], bottomEff = stats[stats.length - 1];
        if (topEff.efficiencyScore - bottomEff.efficiencyScore > 15) {
            recommendations.push(`⚡ Efficiency Gap: ${topEff.name} scores ${topEff.efficiencyScore}/100 vs ${bottomEff.name}'s ${bottomEff.efficiencyScore}/100. Consider knowledge transfer from ${topEff.name}.`);
        }

        // Automation gap
        const maxAuto = stats.reduce((a, b) => a.autoPct > b.autoPct ? a : b);
        const minAuto = stats.reduce((a, b) => a.autoPct < b.autoPct ? a : b);
        if (maxAuto.autoPct - minAuto.autoPct > 30) {
            recommendations.push(`🤖 Automation Gap: ${maxAuto.name} uses ${maxAuto.autoPct}% automation while ${minAuto.name} is only at ${minAuto.autoPct}%. Explore training ${minAuto.name} on automated workflows.`);
        }

        // Consistency issues
        const inconsistent = stats.filter(s => s.consistencyScore < 50);
        inconsistent.forEach(s => {
            recommendations.push(`📊 Inconsistent Output: ${s.name} has a consistency score of ${s.consistencyScore}/100 (${s.consistencyLabel}). Investigate daily blockers or workload distribution.`);
        });

        // Cross-deletions
        stats.forEach(s => {
            if (s.delOthers > 10 && s.dels > 0 && s.delOthers / s.dels > 0.3) {
                recommendations.push(`🗑️ Cross-Deletion Pattern: ${s.name} deleted ${s.delOthers} files created by others (${Math.round(s.delOthers / s.dels * 100)}% of their total deletions). Review for quality control or coordination issues.`);
            }
        });

        // Complexity distribution
        const maxMods = stats.reduce((a, b) => a.modsPerFile > b.modsPerFile ? a : b);
        const minMods = stats.reduce((a, b) => a.modsPerFile < b.modsPerFile ? a : b);
        if (maxMods.modsPerFile - minMods.modsPerFile > 10) {
            recommendations.push(`📋 Complexity Distribution: ${maxMods.name} handles more complex declarations (${maxMods.modsPerFile} edits/file) vs ${minMods.name} (${minMods.modsPerFile} edits/file). Consider balancing complex declaration assignments.`);
        }

        // Specialization synergy
        const uniqueCompanies = new Set(stats.map(s => s.topCompany));
        if (uniqueCompanies.size > 1) {
            const pairs = stats.map(s => `${s.name.split('.')[0]} → ${s.topCompany}/${s.topPrincipal}`).join(', ');
            recommendations.push(`🤝 Specialization Synergy: Employees handle different clients — ${pairs}. Cross-training opportunity for team coverage.`);
        }

        if (recommendations.length === 0) {
            recommendations.push('✅ No major performance gaps detected. All employees are performing within similar ranges.');
        }
        recommendations.forEach(r => report += `${r}\n\n`);

        // ── PRINCIPAL DISTRIBUTION ANALYSIS (work-spreading) ──────────────────
        report += `\nPRINCIPAL DISTRIBUTION ANALYSIS\n`;
        report += `${'═'.repeat(55)}\n`;
        report += `(Use this to decide who should handle which client/principal)\n\n`;

        // Aggregate all principals across compared employees
        const allPrincipals = new Map();
        for (const s of stats) {
            for (const [p, c] of Object.entries(s.principalSpec || {})) {
                if (!allPrincipals.has(p)) allPrincipals.set(p, {});
                allPrincipals.get(p)[s.name] = c;
            }
        }

        // Sort principals by total volume descending
        const principalRows = [...allPrincipals.entries()]
            .map(([p, volumes]) => ({
                principal: p,
                total: Object.values(volumes).reduce((a, b) => a + b, 0),
                volumes
            }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 20); // top 20 principals

        if (principalRows.length > 0) {
            // Header
            const nameCol = (n) => n.split('.')[0].padStart(10);
            report += `${'Principal'.padEnd(22)}${'Total'.padStart(7)}${stats.map(s => nameCol(s.name)).join('')}\n`;
            report += `${'─'.repeat(22 + 7 + stats.length * 10)}\n`;

            for (const row of principalRows) {
                const volCols = stats.map(s => String(row.volumes[s.name] || 0).padStart(10)).join('');
                // Mark the dominant handler
                const dominant = stats.reduce((best, s) =>
                    (row.volumes[s.name] || 0) > (row.volumes[best.name] || 0) ? s : best
                );
                report += `${row.principal.slice(0, 21).padEnd(22)}${String(row.total).padStart(7)}${volCols}  ← ${dominant.name.split('.')[0]}\n`;
            }

            // Work-spreading recommendations per principal
            report += `\nWORK-SPREADING RECOMMENDATIONS:\n`;
            report += `${'─'.repeat(55)}\n`;

            for (const row of principalRows.slice(0, 10)) {
                const dominant = stats.reduce((best, s) =>
                    (row.volumes[s.name] || 0) > (row.volumes[best.name] || 0) ? s : best
                );
                const dominantPct = row.total > 0
                    ? Math.round((row.volumes[dominant.name] || 0) / row.total * 100) : 0;

                // Over-concentration: one person handles >70% of a principal
                if (dominantPct >= 70 && row.total >= 20) {
                    // Find best candidate to absorb overflow (high efficiency + headroom + some existing exposure)
                    const candidates = stats
                        .filter(s => s.name !== dominant.name && s.capacityHeadroomFiles > 3)
                        .sort((a, b) => {
                            const aExp = row.volumes[a.name] || 0;
                            const bExp = row.volumes[b.name] || 0;
                            return (b.efficiencyScore + bExp) - (a.efficiencyScore + aExp);
                        });

                    const candidate = candidates[0];
                    if (candidate) {
                        report += `⚠️  ${row.principal}: ${dominant.name.split('.')[0]} handles ${dominantPct}% (${row.volumes[dominant.name]} files). Risk: single point of failure.\n`;
                        report += `    → Recommend transferring ~30% to ${candidate.name.split('.')[0]} (efficiency: ${candidate.efficiencyScore}/100, headroom: ${candidate.capacityHeadroomFiles} files/day).\n\n`;
                    }
                } else if (dominantPct < 50 && row.total >= 30) {
                    report += `✅ ${row.principal}: Well distributed across team (no single handler above 50%).\n\n`;
                }
            }
        } else {
            report += `No principal specialization data available for these employees.\n`;
        }

        // Capacity summary for work assignment
        report += `\nCAPACITY HEADROOM SUMMARY:\n`;
        report += `${'─'.repeat(55)}\n`;
        report += `(How many more files/day each employee can absorb before hitting their personal peak)\n`;
        stats.forEach(s => {
            const bar = '█'.repeat(Math.min(20, Math.round(s.utilization / 5)));
            const empty = '░'.repeat(20 - Math.min(20, Math.round(s.utilization / 5)));
            report += `  ${s.name.padEnd(28)} [${bar}${empty}] ${s.utilization}% utilized | +${s.capacityHeadroomFiles} files/day available\n`;
        });

        return report;
    }
});

// ═══ TOOL: Principal Assignment Plan ═══
export const getPrincipalAssignmentPlan = new DynamicStructuredTool({
    name: "get_principal_assignment_plan",
    description: "Expert work-distribution planner. Given a list of principals (clients) to assign, analyzes each employee's capacity, efficiency score, current exposure to that principal, and automation rate to produce an optimal assignment matrix. Outputs one clear action per principal: who should own it, who backs it up, and why. Use this when the manager asks 'who should handle X?', 'how do I spread this workload?', or 'redistribute principals across the team'.",
    schema: z.object({
        principals: z.array(z.string()).optional().describe("Specific principal names to assign. If omitted, analyzes all principals in the team history."),
        team_name: z.string().optional().describe("Team to draw employees from. If omitted, uses all known employees."),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD for workload analysis window."),
        end_date: z.string().optional().describe("End date YYYY-MM-DD for workload analysis window.")
    }),
    func: async ({ principals, team_name, start_date, end_date } = {}) => {
        await refreshTeamsCache();
        const client = getBlobServiceClient();
        const containerClient = client.getContainerClient(CONTAINER_NAME);

        let employeePool = [];
        if (team_name) {
            const { allMembers } = getAllTeamMembers(team_name);
            employeePool = allMembers.length > 0 ? allMembers : Object.values(AZURE_CACHE.teams).flat();
        } else {
            employeePool = AZURE_CACHE.employees.map(e => e.user);
        }

        if (employeePool.length === 0) return 'No employees found. Run get_teams_list first.';

        const profiles = [];
        const batchSize = 10;
        for (let i = 0; i < employeePool.length; i += batchSize) {
            const batch = employeePool.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(async name => {
                const blob = containerClient.getBlockBlobClient(`${USERS_BLOB_PREFIX}${name}.json`);
                if (!(await blob.exists())) return null;
                const buf = await blob.downloadToBuffer();
                const data = JSON.parse(buf.toString('utf8'));

                let days = data.daily_metrics || [];
                if (start_date || end_date) {
                    days = days.filter(d => {
                        const dt = new Date(d.date);
                        if (start_date && dt < new Date(start_date)) return false;
                        if (end_date && dt > new Date(end_date)) return false;
                        return true;
                    });
                }

                let total = 0, mods = 0, auto = 0;
                for (const d of days) {
                    total += d.total_files_handled || 0;
                    mods += d.modification_count || 0;
                    auto += d.automatic_files_created || 0;
                }
                const daysActive = days.length;
                const avgPerDay = daysActive > 0 ? +(total / daysActive).toFixed(2) : 0;
                const autoPct = total > 0 ? Math.round(auto / total * 100) : (data.summary?.manual_vs_auto_ratio?.automatic_percent || 0);
                const modsPerFile = total > 0 ? +(mods / total).toFixed(2) : (data.summary?.modifications_per_file || 0);
                const maxDay = days.length > 0 ? Math.max(...days.map(d => d.total_files_handled || 0)) : 0;

                const outputScore = Math.min(avgPerDay * 8, 50);
                const complexityBonus = Math.min(modsPerFile * 1.5, 25);
                const efficiencyScore = Math.round(Math.min(100, outputScore + complexityBonus + autoPct * 0.25));
                const capacityHeadroom = maxDay > 0 ? +(maxDay - avgPerDay).toFixed(1) : 0;
                const principalSpec = data.summary?.principal_specialization || {};

                return { name, total, avgPerDay, autoPct, modsPerFile, efficiencyScore, capacityHeadroom, maxDay, principalSpec };
            }));
            for (const r of results) {
                if (r.status === 'fulfilled' && r.value) profiles.push(r.value);
            }
        }

        if (profiles.length === 0) return 'No performance data found for the employee pool.';

        let targetPrincipals = principals || [];
        if (targetPrincipals.length === 0) {
            const allP = new Map();
            for (const p of profiles) {
                for (const [principal, count] of Object.entries(p.principalSpec)) {
                    allP.set(principal, (allP.get(principal) || 0) + count);
                }
            }
            targetPrincipals = [...allP.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([p]) => p);
        }

        let report = 'PRINCIPAL ASSIGNMENT PLAN\n' + '='.repeat(60) + '\n';
        const periodLabel = start_date || end_date ? `${start_date || 'start'} to ${end_date || 'now'}` : 'Full History';
        report += `Period: ${periodLabel} | Employees analyzed: ${profiles.length}\n\n`;

        const actions = [];

        for (const principal of targetPrincipals) {
            const scored = profiles.map(p => {
                const exposure = p.principalSpec[principal] || 0;
                const exposureScore = Math.min(exposure * 2, 30);
                const effScore = p.efficiencyScore * 0.5;
                const capacityScore = Math.min(p.capacityHeadroom * 2, 20);
                const totalScore = exposureScore + effScore + capacityScore;
                return { ...p, exposure, totalScore };
            }).sort((a, b) => b.totalScore - a.totalScore);

            const primary = scored[0];
            const backup = scored[1] || null;
            const totalVolume = scored.reduce((s, e) => s + (e.principalSpec[principal] || 0), 0);
            const primaryPct = totalVolume > 0 ? Math.round((primary.principalSpec[principal] || 0) / totalVolume * 100) : 0;

            const reasons = [];
            if (primary.exposure > 0) reasons.push(`${primary.exposure} prior files (${primaryPct}% of team volume)`);
            if (primary.efficiencyScore >= 70) reasons.push(`high efficiency (${primary.efficiencyScore}/100)`);
            if (primary.capacityHeadroom > 5) reasons.push(`${primary.capacityHeadroom} files/day headroom`);

            report += `> ${principal}\n`;
            report += `  PRIMARY: ${primary.name} (score: ${primary.totalScore.toFixed(0)}) — ${reasons.join(', ') || 'best available'}\n`;
            if (backup) {
                report += `  BACKUP:  ${backup.name} (score: ${backup.totalScore.toFixed(0)}) — exposure: ${backup.principalSpec[principal] || 0} files\n`;
            }
            report += `  Team volume: ${totalVolume} files | Current concentration: ${primaryPct}%\n\n`;

            actions.push(`Assign ${principal} -> PRIMARY: ${primary.name.split('.')[0]}${backup ? ` | BACKUP: ${backup.name.split('.')[0]}` : ''}`);
        }

        report += '='.repeat(60) + '\nACTION LIST (copy-paste ready):\n';
        actions.forEach((a, i) => { report += `${i + 1}. ${a}\n`; });

        return report;
    }
});

// ═══ TOOL: Detect Underperformance Patterns ═══
export const detectUnderperformancePatterns = new DynamicStructuredTool({
    name: "detect_underperformance_patterns",
    description: "Scans all employees for chronic underperformance patterns: sustained below-target output (<13 files/day), long inactivity streaks, sudden output drops, high cross-deletion rates, and spike-crash patterns. Returns prioritized findings with severity labels. Use this for weekly/monthly audits, identifying who needs attention, or preparing a performance review.",
    schema: z.object({
        days_back: z.number().optional().describe("How many calendar days back to scan. Defaults to 30."),
        min_active_days: z.number().optional().describe("Minimum active days required to include employee. Defaults to 5.")
    }),
    func: async ({ days_back, min_active_days } = {}) => {
        const lookback = days_back || 30;
        const minDays = min_active_days || 5;
        const now = new Date();
        const cutoff = new Date(now.getTime() - lookback * 24 * 60 * 60 * 1000);

        const client = getBlobServiceClient();
        const containerClient = client.getContainerClient(CONTAINER_NAME);
        const userNames = AZURE_CACHE.employees.map(e => e.user);
        const findings = [];

        const batchSize = 10;
        for (let i = 0; i < userNames.length; i += batchSize) {
            const batch = userNames.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(async name => {
                const blob = containerClient.getBlockBlobClient(`${USERS_BLOB_PREFIX}${name}.json`);
                if (!(await blob.exists())) return null;
                const buf = await blob.downloadToBuffer();
                const data = JSON.parse(buf.toString('utf8'));

                const days = (data.daily_metrics || [])
                    .filter(d => new Date(d.date) >= cutoff && new Date(d.date) <= now)
                    .sort((a, b) => new Date(a.date) - new Date(b.date));

                if (days.length < minDays) return null;

                const totalFiles = days.reduce((s, d) => s + (d.total_files_handled || 0), 0);
                const avgPerDay = totalFiles / days.length;
                const userFindings = [];

                // 1. Chronic under-target
                const belowTargetDays = days.filter(d => (d.total_files_handled || 0) < 13 && (d.total_files_handled || 0) > 0).length;
                const belowTargetPct = Math.round(belowTargetDays / days.length * 100);
                if (belowTargetPct >= 60) {
                    userFindings.push({
                        severity: belowTargetPct >= 80 ? 'CRITICAL' : 'HIGH',
                        type: 'chronic_underperformance',
                        detail: `${belowTargetPct}% of active days below 13-file target (avg ${avgPerDay.toFixed(1)}/day)`
                    });
                }

                // 2. Inactivity streaks
                let maxStreak = 0, streak = 0;
                for (const d of days) {
                    if ((d.total_files_handled || 0) === 0) { streak++; maxStreak = Math.max(maxStreak, streak); }
                    else streak = 0;
                }
                if (maxStreak >= 3) {
                    userFindings.push({ severity: maxStreak >= 5 ? 'HIGH' : 'MEDIUM', type: 'inactivity_streak', detail: `Longest inactivity streak: ${maxStreak} consecutive zero-output days` });
                }

                // 3. Output drop (last 7 vs prior 7)
                if (days.length >= 14) {
                    const recent7 = days.slice(-7);
                    const prior7 = days.slice(-14, -7);
                    const recentAvg = recent7.reduce((s, d) => s + (d.total_files_handled || 0), 0) / 7;
                    const priorAvg = prior7.reduce((s, d) => s + (d.total_files_handled || 0), 0) / 7;
                    const dropPct = priorAvg > 0 ? Math.round((priorAvg - recentAvg) / priorAvg * 100) : 0;
                    if (dropPct >= 35) {
                        userFindings.push({ severity: dropPct >= 50 ? 'HIGH' : 'MEDIUM', type: 'output_drop', detail: `Output dropped ${dropPct}% in last 7 days (${recentAvg.toFixed(1)} vs ${priorAvg.toFixed(1)} prior week)` });
                    }
                }

                // 4. High cross-deletion
                const crossDels = days.reduce((s, d) => s + (d.deleted_others_file_ids || []).length, 0);
                if (crossDels > 5 && totalFiles > 0 && crossDels / totalFiles > 0.05) {
                    userFindings.push({ severity: 'MEDIUM', type: 'high_cross_deletion', detail: `${crossDels} deletions of others' files (${Math.round(crossDels / totalFiles * 100)}% of own output)` });
                }

                // 5. Spike-crash
                const fileCounts = days.map(d => d.total_files_handled || 0).filter(f => f > 0);
                if (fileCounts.length >= 5) {
                    const mean = fileCounts.reduce((a, b) => a + b, 0) / fileCounts.length;
                    const variance = fileCounts.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / fileCounts.length;
                    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
                    if (cv > 0.8 && mean < 13) {
                        userFindings.push({ severity: 'LOW', type: 'spike_crash', detail: `High output volatility (CV=${cv.toFixed(2)}) — inconsistent daily performance` });
                    }
                }

                if (userFindings.length > 0) return { name, avgPerDay: +avgPerDay.toFixed(1), daysActive: days.length, findings: userFindings };
                return null;
            }));
            for (const r of results) { if (r.status === 'fulfilled' && r.value) findings.push(r.value); }
        }

        if (findings.length === 0) return `No significant underperformance patterns detected in the last ${lookback} days.`;

        const sevOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        findings.sort((a, b) => {
            const aMax = Math.min(...a.findings.map(f => sevOrder[f.severity] ?? 4));
            const bMax = Math.min(...b.findings.map(f => sevOrder[f.severity] ?? 4));
            return aMax - bMax;
        });

        let report = `UNDERPERFORMANCE PATTERN SCAN — Last ${lookback} days\n` + '='.repeat(58) + '\n';
        report += `Scanned: ${userNames.length} | Flagged: ${findings.length}\n\n`;

        for (const emp of findings) {
            const maxSev = emp.findings.reduce((best, f) => sevOrder[f.severity] < sevOrder[best] ? f.severity : best, 'LOW');
            const icon = { CRITICAL: '[CRITICAL]', HIGH: '[HIGH]', MEDIUM: '[MEDIUM]', LOW: '[LOW]' }[maxSev];
            report += `${icon} ${emp.name} — avg ${emp.avgPerDay} files/day | ${emp.daysActive} active days\n`;
            for (const f of emp.findings) {
                report += `  [${f.severity}] ${f.type.replace(/_/g, ' ')}: ${f.detail}\n`;
            }
            report += '\n';
        }

        report += '='.repeat(58) + '\nPRIORITY ACTIONS:\n';
        findings.filter(e => e.findings.some(f => f.severity === 'CRITICAL' || f.severity === 'HIGH'))
            .forEach((e, i) => {
                const top = e.findings.find(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
                report += `${i + 1}. 1:1 with ${e.name.split('.')[0]} — ${top?.type.replace(/_/g, ' ')}\n`;
            });

        return report;
    }
});

// ═══ TOOL: Workload Balance Report ═══
export const getWorkloadBalanceReport = new DynamicStructuredTool({
    name: "get_workload_balance_report",
    description: "Analyzes workload distribution across a team. Shows each member's current load vs capacity, flags overloaded and underutilized employees, and suggests concrete file-count transfers to rebalance. Use this when asked about workload distribution, who is overloaded, how to rebalance a team, or for capacity planning.",
    schema: z.object({
        team_name: z.string().describe("Team name to analyze."),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD."),
        end_date: z.string().optional().describe("End date YYYY-MM-DD.")
    }),
    func: async ({ team_name, start_date, end_date }) => {
        await refreshTeamsCache();
        const { allMembers } = getAllTeamMembers(team_name);
        if (allMembers.length === 0) return `Team '${team_name}' not found.`;

        const client = getBlobServiceClient();
        const containerClient = client.getContainerClient(CONTAINER_NAME);
        const profiles = [];

        for (const name of allMembers) {
            try {
                const blob = containerClient.getBlockBlobClient(`${USERS_BLOB_PREFIX}${name}.json`);
                if (!(await blob.exists())) continue;
                const buf = await blob.downloadToBuffer();
                const data = JSON.parse(buf.toString('utf8'));

                let days = data.daily_metrics || [];
                if (start_date || end_date) {
                    days = days.filter(d => {
                        const dt = new Date(d.date);
                        if (start_date && dt < new Date(start_date)) return false;
                        if (end_date && dt > new Date(end_date)) return false;
                        return true;
                    });
                } else {
                    days = days.slice(-30);
                }
                if (days.length === 0) continue;

                const total = days.reduce((s, d) => s + (d.total_files_handled || 0), 0);
                const avgPerDay = +(total / days.length).toFixed(2);
                const maxDay = Math.max(...days.map(d => d.total_files_handled || 0));
                const headroom = +(maxDay - avgPerDay).toFixed(1);
                const utilizationVsPeak = maxDay > 0 ? Math.round(avgPerDay / maxDay * 100) : 0;

                profiles.push({ name, total, avgPerDay, maxDay, headroom, utilizationVsPeak, daysActive: days.length, principalSpec: data.summary?.principal_specialization || {} });
            } catch { /* skip */ }
        }

        if (profiles.length === 0) return 'No data found for this team.';

        const overloaded = profiles.filter(p => p.avgPerDay > 22 || p.utilizationVsPeak > 85);
        const underutilized = profiles.filter(p => p.avgPerDay < 10 && p.daysActive >= 5);
        const onTarget = profiles.filter(p => p.avgPerDay >= 10 && p.avgPerDay <= 22);
        const teamAvg = +(profiles.reduce((s, p) => s + p.avgPerDay, 0) / profiles.length).toFixed(1);

        let report = `WORKLOAD BALANCE REPORT — ${team_name.toUpperCase()}\n` + '='.repeat(58) + '\n';
        const periodLabel = start_date || end_date ? `${start_date || 'start'} to ${end_date || 'now'}` : 'Last 30 days';
        report += `Period: ${periodLabel} | Members: ${profiles.length} | Team avg: ${teamAvg}/day\n\n`;

        report += 'CAPACITY UTILIZATION:\n' + '-'.repeat(58) + '\n';
        profiles.sort((a, b) => b.avgPerDay - a.avgPerDay).forEach(p => {
            const filled = Math.min(20, Math.round(p.avgPerDay / 25 * 20));
            const bar = '#'.repeat(filled) + '.'.repeat(20 - filled);
            const flag = p.avgPerDay > 22 ? ' [OVERLOADED]' : p.avgPerDay < 10 ? ' [LOW]' : ' [OK]';
            report += `  ${p.name.padEnd(28)} [${bar}] ${p.avgPerDay}/day${flag}\n`;
        });

        if (overloaded.length > 0) {
            report += '\nOVERLOADED (>22/day or >85% of peak):\n';
            overloaded.forEach(p => { report += `  * ${p.name}: ${p.avgPerDay}/day (${p.utilizationVsPeak}% of peak ${p.maxDay})\n`; });
        }
        if (underutilized.length > 0) {
            report += '\nUNDERUTILIZED (<10/day):\n';
            underutilized.forEach(p => { report += `  * ${p.name}: ${p.avgPerDay}/day — ${p.headroom} files/day available\n`; });
        }

        if (overloaded.length > 0 && underutilized.length > 0) {
            report += '\nREBALANCING SUGGESTIONS:\n' + '-'.repeat(58) + '\n';
            for (const src of overloaded) {
                const excess = +(src.avgPerDay - 18).toFixed(1);
                if (excess <= 0) continue;
                const receivers = underutilized
                    .filter(p => p.headroom >= excess)
                    .sort((a, b) => {
                        const aOverlap = Object.keys(src.principalSpec).filter(p => a.principalSpec[p]).length;
                        const bOverlap = Object.keys(src.principalSpec).filter(p => b.principalSpec[p]).length;
                        return (bOverlap + b.headroom) - (aOverlap + a.headroom);
                    });
                if (receivers[0]) {
                    const recv = receivers[0];
                    const overlap = Object.keys(src.principalSpec).filter(p => recv.principalSpec[p]);
                    report += `  Transfer ~${excess} files/day: ${src.name.split('.')[0]} -> ${recv.name.split('.')[0]}\n`;
                    if (overlap.length > 0) report += `    Shared principals for smooth handover: ${overlap.slice(0, 3).join(', ')}\n`;
                    report += `    After: ${src.name.split('.')[0]} ~${(src.avgPerDay - excess).toFixed(1)}/day | ${recv.name.split('.')[0]} ~${(recv.avgPerDay + excess).toFixed(1)}/day\n\n`;
                }
            }
        } else if (overloaded.length === 0 && underutilized.length === 0) {
            report += '\nTeam workload is well balanced.\n';
        }

        report += '='.repeat(58) + '\n';
        report += `SUMMARY: ${overloaded.length} overloaded | ${onTarget.length} on-target | ${underutilized.length} underutilized\n`;

        return report;
    }
});

// ═══ TOOL: Cross-Deletion Investigation ═══
export const getCrossDeletionReport = new DynamicStructuredTool({
    name: "get_cross_deletion_report",
    description: "Investigates deletion patterns across the team. Shows who is deleting files created by others, how many, and what percentage of their activity this represents. Flags employees with unusual cross-deletion rates. Use this when asked about deletions, who is deleting other people's work, or for quality audit.",
    schema: z.object({
        team_name: z.string().optional().describe("Optional team name to filter. If omitted, scans all employees."),
        start_date: z.string().optional().describe("Start date YYYY-MM-DD."),
        end_date: z.string().optional().describe("End date YYYY-MM-DD.")
    }),
    func: async ({ team_name, start_date, end_date } = {}) => {
        await refreshTeamsCache();
        let employeePool = team_name
            ? (getAllTeamMembers(team_name).allMembers || AZURE_CACHE.employees.map(e => e.user))
            : AZURE_CACHE.employees.map(e => e.user);

        const client = getBlobServiceClient();
        const containerClient = client.getContainerClient(CONTAINER_NAME);
        const records = [];

        const batchSize = 10;
        for (let i = 0; i < employeePool.length; i += batchSize) {
            const batch = employeePool.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(async name => {
                const blob = containerClient.getBlockBlobClient(`${USERS_BLOB_PREFIX}${name}.json`);
                if (!(await blob.exists())) return null;
                const buf = await blob.downloadToBuffer();
                const data = JSON.parse(buf.toString('utf8'));

                let days = data.daily_metrics || [];
                if (start_date || end_date) {
                    days = days.filter(d => {
                        const dt = new Date(d.date);
                        if (start_date && dt < new Date(start_date)) return false;
                        if (end_date && dt > new Date(end_date)) return false;
                        return true;
                    });
                }

                const total = days.reduce((s, d) => s + (d.total_files_handled || 0), 0);
                const delOwn = days.reduce((s, d) => s + (d.deleted_own_file_ids || []).length, 0);
                const delOthers = days.reduce((s, d) => s + (d.deleted_others_file_ids || []).length, 0);
                const delTotal = delOwn + delOthers;
                if (delTotal === 0) return null;

                const crossDeletionRate = total > 0 ? +(delOthers / total * 100).toFixed(1) : 0;
                const crossPctOfDels = delTotal > 0 ? Math.round(delOthers / delTotal * 100) : 0;
                return { name, total, delOwn, delOthers, delTotal, crossDeletionRate, crossPctOfDels };
            }));
            for (const r of results) { if (r.status === 'fulfilled' && r.value) records.push(r.value); }
        }

        if (records.length === 0) return 'No deletion activity found in the specified period.';

        records.sort((a, b) => b.delOthers - a.delOthers);
        const periodLabel = start_date || end_date ? `${start_date || 'start'} to ${end_date || 'now'}` : 'Full History';

        let report = `CROSS-DELETION INVESTIGATION REPORT\n` + '='.repeat(56) + '\n';
        report += `Period: ${periodLabel}${team_name ? ` | Team: ${team_name}` : ''}\n\n`;
        report += `${'Employee'.padEnd(28)} ${'Own'.padStart(5)} ${'Others'.padStart(7)} ${'Cross%'.padStart(7)} ${'Of Output'.padStart(10)}\n`;
        report += '-'.repeat(56) + '\n';

        for (const r of records) {
            const flag = r.delOthers > 10 && r.crossPctOfDels > 30 ? ' [REVIEW]' : '';
            report += `${r.name.padEnd(28)} ${String(r.delOwn).padStart(5)} ${String(r.delOthers).padStart(7)} ${(r.crossPctOfDels + '%').padStart(7)} ${(r.crossDeletionRate + '%').padStart(10)}${flag}\n`;
        }

        const flagged = records.filter(r => r.delOthers > 10 && r.crossPctOfDels > 30);
        if (flagged.length > 0) {
            report += '\nFLAGGED FOR REVIEW:\n';
            for (const r of flagged) {
                report += `  * ${r.name}: ${r.delOthers} cross-deletions (${r.crossPctOfDels}% of their total, ${r.crossDeletionRate}% of output)\n`;
                report += `    -> Investigate: quality control role? coordination gap? accidental deletions?\n`;
            }
        }

        const totalCross = records.reduce((s, r) => s + r.delOthers, 0);
        const totalOwn = records.reduce((s, r) => s + r.delOwn, 0);
        report += `\nTOTALS: ${totalOwn} own-file deletions | ${totalCross} cross-deletions\n`;

        return report;
    }
});
