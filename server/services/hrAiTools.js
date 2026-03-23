import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import Fuse from "fuse.js";
import { BlobServiceClient } from '@azure/storage-blob';
// In-memory Azure State Cache
export const AZURE_CACHE = {
    employees: [],  // [{ user, summary }] sourced from individual usersV3/ blobs
    teams: { import: [], export: [], customs: [] }
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
    description: "Fetch a list of all current company teams and their members. Use this when you are asked about who is in a specific team, or what teams exist.",
    schema: z.object({}),
    func: async () => {
        // Force refresh the cache before serving to get the latest DB/mock data
        await refreshTeamsCache();

        if (Object.keys(AZURE_CACHE.teams).length === 0) {
            return "No teams found in the database. The team structure might be empty.";
        }

        let report = `Current Company Teams List:\n\n`;
        for (const [teamName, members] of Object.entries(AZURE_CACHE.teams)) {
            report += `### ${teamName.toUpperCase()} Team\n`;
            report += `Members (${members.length}): ${members.length > 0 ? members.join(', ') : 'No members yet'}\n\n`;
        }
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
        const teamKey = team_name.toLowerCase().replace(" team", "").trim();
        const members = AZURE_CACHE.teams[teamKey];
        if (!members) return `Team '${team_name}' not found. Available teams: ${Object.keys(AZURE_CACHE.teams).join(', ')}`;

        let totalFiles = 0;
        let totalDeletions = 0;
        let activeMembers = 0;
        let foundLogsInPeriod = false;

        let report = `Team Overview for ${team_name.toUpperCase()}:\n`;
        if (start_date || end_date) {
            report += `Period: ${start_date || 'beginning'} to ${end_date || 'now'}\n`;
        }
        report += `Members: ${members.join(', ')}\n\n`;

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
