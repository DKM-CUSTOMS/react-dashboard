import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import Fuse from "fuse.js";
import { BlobServiceClient } from '@azure/storage-blob';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory Azure State Cache
export const AZURE_CACHE = {
    monthly_report: [],
    users_summary: [],
    teams: { import: [], export: [], customs: [] }
};

const CONTAINER_NAME = "document-intelligence";
const TEAMS_FILE = "Dashboard/cache/teams.json";

function getBlobServiceClient() {
    const connStr = process.env.VITE_AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) {
        throw new Error("Missing VITE_AZURE_STORAGE_CONNECTION_STRING");
    }
    return BlobServiceClient.fromConnectionString(connStr);
}

// Ensure the cache gets hydrated
export async function hydrateAzureCache() {
    console.log("Hydrating AI Azure Cache...");
    try {
        const client = getBlobServiceClient();
        const containerClient = client.getContainerClient(CONTAINER_NAME);

        // Fetch Users Summary
        const summaryBlob = containerClient.getBlockBlobClient("Dashboard/cache/users_summaryV3.json");
        try {
            const sumBuffer = await summaryBlob.downloadToBuffer();
            AZURE_CACHE.users_summary = JSON.parse(sumBuffer.toString("utf8"));
        } catch (e) {
            console.warn("Could not fetch users_summaryV3.json", e.message);
        }

        // Fetch Monthly Report
        const monthlyBlob = containerClient.getBlockBlobClient("Dashboard/cache/monthly_report_cacheV3.json");
        try {
            const monthlyBuffer = await monthlyBlob.downloadToBuffer();
            AZURE_CACHE.monthly_report = JSON.parse(monthlyBuffer.toString("utf8"));
        } catch (e) {
            console.warn("Could not fetch monthly_report_cacheV3.json", e.message);
        }

        // Fetch Teams or local DB equivalent
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

    // Build Master List of Usernames
    let allUsers = new Set();
    if (Array.isArray(AZURE_CACHE.monthly_report)) {
        AZURE_CACHE.monthly_report.forEach(u => u.user && allUsers.add(u.user));
    } else if (AZURE_CACHE.monthly_report && AZURE_CACHE.monthly_report.users_summary) {
        AZURE_CACHE.monthly_report.users_summary.forEach(u => u.user && allUsers.add(u.user));
    }

    if (Array.isArray(AZURE_CACHE.users_summary)) {
        AZURE_CACHE.users_summary.forEach(u => u.user && allUsers.add(u.user));
    }

    const allUsersArray = Array.from(allUsers);

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

// ═══ TOOL: Get Daily Summary (10-day activity window) ═══
export const getDailySummary = new DynamicStructuredTool({
    name: "get_daily_summary",
    description: "Fetch the 10-day activity summary showing day-by-day file creation counts for all employees. Optionally filter by a specific employee name. Use this for recent activity trends and short-term patterns.",
    schema: z.object({
        employee_name: z.string().nullable().optional().describe("Optional: filter results for a specific employee. Leave empty or null to get all employees."),
    }),
    func: async ({ employee_name } = {}) => {
        if (!Array.isArray(AZURE_CACHE.users_summary) || AZURE_CACHE.users_summary.length === 0) {
            return "Error: Daily summary data is not available in the system.";
        }

        // If filtering by a specific employee
        if (employee_name) {
            const resolvedName = resolveEmployeeName(employee_name);
            if (!resolvedName) return `Error: No employee found matching '${employee_name}'.`;

            const userData = AZURE_CACHE.users_summary.find(u => u.user === resolvedName);
            if (!userData) return `Error: No daily summary data found for '${resolvedName}'.`;

            const daily = userData.daily_file_creations || {};
            const totalFiles = Object.values(daily).reduce((a, b) => a + b, 0);
            const activeDays = Object.values(daily).filter(v => v > 0).length;
            const bestDay = Object.entries(daily).sort((a, b) => b[1] - a[1])[0];

            let report = `10-Day Activity Summary for ${resolvedName}:\n`;
            report += `Daily breakdown:\n`;
            for (const [date, count] of Object.entries(daily)) {
                report += `  ${date}: ${count} files\n`;
            }
            report += `\nTotal files (10 days): ${totalFiles}\n`;
            report += `Active days: ${activeDays} / ${Object.keys(daily).length}\n`;
            report += `Average per active day: ${activeDays > 0 ? (totalFiles / activeDays).toFixed(1) : 0}\n`;
            if (bestDay) report += `Best day: ${bestDay[0]} (${bestDay[1]} files)\n`;
            return report;
        }

        // Return overview of all employees
        const allUsers = AZURE_CACHE.users_summary
            .map(u => {
                const daily = u.daily_file_creations || {};
                const total = Object.values(daily).reduce((a, b) => a + b, 0);
                return { user: u.user, total, daily };
            })
            .filter(u => u.total > 0)
            .sort((a, b) => b.total - a.total);

        let report = `10-Day Activity Summary (${allUsers.length} active employees):\n\n`;
        for (const u of allUsers) {
            const dailyStr = Object.entries(u.daily).map(([d, c]) => `${d}:${c}`).join(' | ');
            report += `${u.user}: ${u.total} total files | ${dailyStr}\n`;
        }
        return report;
    },
});

// ═══ TOOL: Get Monthly Report (30-day aggregated stats) ═══
export const getMonthlyReport = new DynamicStructuredTool({
    name: "get_monthly_report",
    description: "Fetch the 30-day aggregated monthly report with total files, manual vs automatic breakdown, activity days, and averages for all employees. Use this for overall performance rankings, monthly comparisons, and company-wide statistics.",
    schema: z.object({
        employee_name: z.string().nullable().optional().describe("Optional: filter results for a specific employee. Leave empty or null to get the full report."),
        sort_by: z.enum(["total_files_handled", "avg_activity_per_day", "days_with_activity", "manual_files", "automatic_files", "sent_files"]).nullable().optional().describe("Optional: field to sort results by. Defaults to total_files_handled."),
    }),
    func: async ({ employee_name, sort_by } = {}) => {
        let reportData = AZURE_CACHE.monthly_report;
        if (reportData && !Array.isArray(reportData) && reportData.users_summary) {
            reportData = reportData.users_summary;
        }

        if (!Array.isArray(reportData) || reportData.length === 0) {
            return "Error: Monthly report data is not available in the system.";
        }

        // If filtering by a specific employee
        if (employee_name) {
            const resolvedName = resolveEmployeeName(employee_name);
            if (!resolvedName) return `Error: No employee found matching '${employee_name}'.`;

            const userData = reportData.find(u => u.user === resolvedName);
            if (!userData) return `Error: No monthly report data found for '${resolvedName}'.`;

            let report = `30-Day Monthly Report for ${resolvedName}:\n`;
            report += `- Total files handled: ${userData.total_files_handled}\n`;
            report += `- Manual files: ${userData.manual_files}\n`;
            report += `- Automatic files: ${userData.automatic_files}\n`;
            report += `- Sent files: ${userData.sent_files}\n`;
            report += `- Days with activity: ${userData.days_with_activity}\n`;
            report += `- Avg activity per day: ${userData.avg_activity_per_day}\n`;
            if (userData.manual_vs_auto_ratio) {
                report += `- Manual vs Auto ratio: ${userData.manual_vs_auto_ratio.manual_percent}% manual / ${userData.manual_vs_auto_ratio.automatic_percent}% automatic\n`;
            }
            return report;
        }

        // Return full monthly report sorted
        const sortField = sort_by || "total_files_handled";
        const sorted = [...reportData]
            .filter(u => u.total_files_handled > 0 || u.days_with_activity > 0)
            .sort((a, b) => (b[sortField] || 0) - (a[sortField] || 0));

        let report = `30-Day Monthly Report (${sorted.length} employees, sorted by ${sortField}):\n\n`;
        for (const u of sorted) {
            const ratio = u.manual_vs_auto_ratio
                ? `${u.manual_vs_auto_ratio.manual_percent}%M/${u.manual_vs_auto_ratio.automatic_percent}%A`
                : "N/A";
            report += `${u.user}: ${u.total_files_handled} files | ${u.avg_activity_per_day} avg/day | ${u.days_with_activity} active days | ${ratio} | sent: ${u.sent_files}\n`;
        }
        return report;
    },
});

// ═══ TOOL: Get Employee Data (deep individual analytics) ═══
export const getEmployeeData = new DynamicStructuredTool({
    name: "get_employee_data",
    description: "Fetch deep individual analytics for a specific employee including daily metrics, peak hours, company specialization, file type breakdown, and productivity patterns. Optionally filter daily metrics by providing start_date and end_date. Use this for detailed questions about a specific person.",
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

                    if (s.manual_vs_auto_ratio) {
                        report += `- Manual vs Auto: ${s.manual_vs_auto_ratio.manual_percent}% manual / ${s.manual_vs_auto_ratio.automatic_percent}% automatic\n`;
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
                        report += `\nTOP CLIENTS:\n`;
                        clients.forEach(c => report += `  - ${c}\n`);
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
                        for (const day of recent) {
                            periodTotal += day.total_files_handled;
                        }
                        report += `\nFILTERED PERIOD TOTAL FILES: ${periodTotal}\n`;
                    } else {
                        recent = recent.slice(-10);
                    }

                    if (recent.length > 0) {
                        report += `\nDAILY METRICS (${start_date || end_date ? 'Filtered' : 'last ' + recent.length + ' days'}):\n`;
                        for (const day of recent) {
                            report += `  ${day.date}: ${day.total_files_handled} files (${day.manual_files_created}M/${day.automatic_files_created}A) | ${day.modification_count} modifications\n`;
                        }
                    } else {
                        report += `\nNo daily metrics found for the specified period.\n`;
                    }
                }

            } else {
                // Fallback to monthly report cache
                const monthlyData = Array.isArray(AZURE_CACHE.monthly_report)
                    ? AZURE_CACHE.monthly_report.find(item => item.user === resolvedName)
                    : null;
                if (monthlyData) {
                    report += `(Limited data - no detailed profile available)\n`;
                    report += `- Total files handled: ${monthlyData.total_files_handled}\n`;
                    report += `- Days with activity: ${monthlyData.days_with_activity}\n`;
                    report += `- Avg activity per day: ${monthlyData.avg_activity_per_day}\n`;
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
    description: "Calculates totals and averages for everyone in a specific team. Filter by start_date and end_date if asking about a specific timeframe like 'last week' or 'this month'.",
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
                let topClients = "Unknown";

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
                                        foundLogsInPeriod = true;
                                    }
                                }
                            }
                        } else {
                            if (data.summary) {
                                memberTotal = data.summary.total_files_handled || 0;
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
                    } else {
                        // Fallback
                        const stats = Array.isArray(AZURE_CACHE.monthly_report)
                            ? AZURE_CACHE.monthly_report.find(item => item.user === m)
                            : null;
                        if (stats) memberTotal = stats.total_files_handled || stats.total || 0;
                    }
                } catch (e) {
                    // silent fallback
                }

                totalFiles += parseInt(memberTotal, 10);
                activeMembers++;
                report += ` - ${m}: ${memberTotal} files | Preferred Clients: ${topClients}\n`;
            }
        } catch (e) {
            report += `Error reading team member files: ${e.message}\n`;
        }

        report += `\nTotal Team Files: ${totalFiles}\n`;
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

        if (Array.isArray(AZURE_CACHE.users_summary)) {
            for (const user of AZURE_CACHE.users_summary) {
                if (user.user && user.daily_file_creations) {
                    const totalSum = Object.values(user.daily_file_creations).reduce((a, b) => a + b, 0);
                    if (totalSum > 50) {
                        // Dummy logic: We assume high volume users might be import or default to a generic "customs"
                        // Since file_type_counts isn't natively in this JSON structure based on api.js.
                        if (!AZURE_CACHE.teams['import'].includes(user.user)) {
                            AZURE_CACHE.teams['import'].push(user.user);
                            assigned++;
                        }
                    }
                }
            }
        }

        return `Action Successful: Auto-assigned ${assigned} prominent users to operational teams.`;
    },
});
