
import xmlrpc from 'xmlrpc';

/**
 * Enhanced Odoo XML-RPC client mirroring the Python 'OdooClient'
 */
class OdooClient {
    constructor(url, db, username, apiKey) {
        this.url = url.replace(/\/$/, '');
        this.db = db;
        this.username = username;
        this.apiKey = apiKey;
        this.uid = null;

        const parsedUrl = new URL(this.url);
        this.commonClient = xmlrpc.createSecureClient({
            host: parsedUrl.hostname,
            port: 443,
            path: '/xmlrpc/2/common'
        });

        this.objectClient = xmlrpc.createSecureClient({
            host: parsedUrl.hostname,
            port: 443,
            path: '/xmlrpc/2/object'
        });
    }

    /**
     * Wrap XML-RPC calls in a Promise
     */
    _call(client, method, params) {
        return new Promise((resolve, reject) => {
            client.methodCall(method, params, (error, value) => {
                if (error) reject(error);
                else resolve(value);
            });
        });
    }

    async authenticate() {
        if (this.uid) return this.uid;

        console.log(`🔐 Authenticating with Odoo: ${this.url} (DB: ${this.db})`);
        try {
            const uid = await this._call(this.commonClient, 'authenticate', [
                this.db,
                this.username,
                this.apiKey,
                {}
            ]);

            if (!uid) {
                throw new Error("Odoo Authentication Failed: Invalid credentials or database name.");
            }

            this.uid = uid;
            console.log(`✅ Authenticated as user ${this.uid}`);
            return this.uid;
        } catch (error) {
            console.error("❌ Odoo Auth Error:", error.message);
            throw error;
        }
    }

    async execute(model, method, args = [], kwargs = {}) {
        await this.authenticate();
        return this._call(this.objectClient, 'execute_kw', [
            this.db,
            this.uid,
            this.apiKey,
            model,
            method,
            args,
            kwargs
        ]);
    }

    async search(model, domain, limit = null) {
        const kwargs = limit ? { limit } : {};
        return this.execute(model, 'search', [domain], kwargs);
    }

    async read(model, ids, fields = []) {
        const kwargs = fields.length ? { fields } : {};
        return this.execute(model, 'read', [ids], kwargs);
    }

    async searchRead(model, domain, fields = [], limit = null, order = null) {
        const kwargs = {};
        if (fields.length) kwargs.fields = fields;
        if (limit) kwargs.limit = limit;
        if (order) kwargs.order = order;
        return this.execute(model, 'search_read', [domain], kwargs);
    }

    async create(model, values) {
        return this.execute(model, 'create', [values]);
    }

    async write(model, ids, values) {
        return this.execute(model, 'write', [ids, values]);
    }
}

/**
 * Handles Odoo helpdesk operations mirroring the Python 'HelpdeskService'
 */
class HelpdeskService {
    constructor(client) {
        this.client = client;
        this.TICKET_MODEL = "helpdesk.ticket";
        this.TEAM_MODEL = "helpdesk.team";
        this.STAGE_MODEL = "helpdesk.stage";
        this.USER_MODEL = "res.users";
        this.teamCache = {};
        this.userCache = {};
    }

    async findUser(userName) {
        if (this.userCache[userName]) return this.userCache[userName];

        console.log(`🔍 Searching for user: ${userName}`);
        const userIds = await this.client.search(this.USER_MODEL, [['name', 'ilike', userName]], 1);
        if (userIds && userIds.length > 0) {
            this.userCache[userName] = userIds[0];
            return userIds[0];
        }
        return null;
    }

    async findTeam(teamName) {
        if (this.teamCache[teamName]) return this.teamCache[teamName];

        const teamIds = await this.client.search(this.TEAM_MODEL, [['name', 'ilike', teamName]], 1);
        if (teamIds && teamIds.length > 0) {
            this.teamCache[teamName] = teamIds[0];
            return teamIds[0];
        }
        return null;
    }

    async createTicket({ name, teamName, assignedTo, description, priority = "1", partnerEmail }) {
        const values = {
            name: name,
            priority: priority
        };

        if (teamName) {
            const teamId = await this.findTeam(teamName);
            if (teamId) {
                values.team_id = teamId;
            } else {
                console.warn(`⚠️ Helpdesk team '${teamName}' not found.`);
            }
        }

        if (assignedTo) {
            const userId = await this.findUser(assignedTo);
            if (userId) {
                values.user_id = userId;
                console.log(`👤 Assigned ticket to: ${assignedTo} (ID: ${userId})`);
            } else {
                console.warn(`⚠️ User '${assignedTo}' not found for assignment.`);
            }
        }

        if (description) {
            values.description = description;
        }

        if (partnerEmail) {
            const partnerIds = await this.client.search('res.partner', [['email', '=', partnerEmail]], 1);
            if (partnerIds && partnerIds.length > 0) {
                values.partner_id = partnerIds[0];
            }
        }

        console.log(`🎫 Creating Helpdesk Ticket: ${name}`);
        return this.client.create(this.TICKET_MODEL, values);
    }
}

// Singleton instances using environment variables
const ODOO_URL = process.env.ODOO_URL || 'https://dkm-customs.odoo.com';
const DB = process.env.ODOO_DB || 'vva-onniti-dkm-main-20654023';
const USERNAME = process.env.ODOO_USERNAME || 'anas.benabbou@dkm-customs.com';
const PASSWORD = process.env.ODOO_API_KEY || 'bba4286ed745fb6915057a5393c640fe6402a168';

const odooClient = new OdooClient(ODOO_URL, DB, USERNAME, PASSWORD);
const helpdeskService = new HelpdeskService(odooClient);

/**
 * Parses the structured 'odoo_body' string into key-value pairs for HTML display
 */
const parseOdooBody = (body) => {
    if (!body) return [];

    // Labels to look for
    const labels = [
        'Destination',
        'Link5',
        'Importercountry',
        'Importer',
        'FiscalRepresented',
        'FiscalConsignee'
    ];

    // Split by the dash delimiter
    const parts = body.split(' - ');
    const fields = [];

    parts.forEach(part => {
        let matched = false;
        for (const label of labels) {
            if (part.startsWith(label)) {
                // Remove label and potential colon/space
                let value = part.substring(label.length).replace(/^[:\s]+/, '').trim();
                fields.push({ label, value });
                matched = true;
                break;
            }
        }
        if (!matched && part.trim()) {
            fields.push({ label: 'Additional Information', value: part.trim() });
        }
    });

    return fields;
};

/**
 * Main export for creating tickets from declarations
 */
export const createOdooTicket = async (declaration) => {
    try {
        const timestamp = new Date().toLocaleString();
        const manifestFields = parseOdooBody(declaration.odoo_body);

        // High-End Professional Technical Template
        const htmlDescription = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #2c3e50; line-height: 1.5; max-width: 850px; border: 1px solid #dcdde1; border-radius: 4px; background-color: #ffffff;">
                <!-- Header -->
                <div style="background-color: #714B67; padding: 16px 24px; border-radius: 4px 4px 0 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h2 style="margin: 0; color: #ffffff; font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Customs Declaration Technical Report</h2>
                        <span style="font-size: 11px; color: #f5f6fa; font-family: font-mono;">AUTO-GENERATED • DKM-DASHBOARD</span>
                    </div>
                </div>
                
                <div style="padding: 24px;">
                    <!-- Primary Intelligence Block -->
                    <div style="margin-bottom: 24px; border-bottom: 2px solid #f1f2f6; padding-bottom: 16px;">
                        <h3 style="margin: 0 0 12px 0; font-size: 12px; color: #7f8c8d; text-transform: uppercase; font-weight: 700;">Core ID & Reference</h3>
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                            <tr style="border-bottom: 1px solid #f9f9f9;">
                                <td style="padding: 8px 0; width: 140px; font-weight: 600; color: #7f8c8d;">Declaration ID:</td>
                                <td style="padding: 8px 0; font-family: 'Courier New', Courier, monospace; color: #1e272e; font-weight: 700;">#${declaration.declaration_id}</td>
                                <td style="padding: 8px 0; width: 120px; font-weight: 600; color: #7f8c8d;">Priority:</td>
                                <td style="padding: 8px 0;"><span style="background-color: #ebfbee; color: #2f3640; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 700;">STANDARD</span></td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; font-weight: 600; color: #7f8c8d;">MRN Reference:</td>
                                <td style="padding: 8px 0; font-family: 'Courier New', Courier, monospace; color: #1e272e;">${declaration.mrn || 'N/A'}</td>
                                <td style="padding: 8px 0; font-weight: 600; color: #7f8c8d;">GUID:</td>
                                <td style="padding: 8px 0; font-size: 11px; font-family: monospace; color: #95a5a6;">${declaration.declaration_guid || 'N/A'}</td>
                            </tr>
                        </table>
                    </div>

                    <!-- Parsed Manifest Data (The structured part of odoo_body) -->
                    <div style="margin-bottom: 24px;">
                        <h4 style="margin: 0 0 12px 0; font-size: 12px; color: #7f8c8d; text-transform: uppercase; border-left: 3px solid #3498db; padding-left: 10px; font-weight: 700;">Extracted Manifest Data</h4>
                        <table style="width: 100%; border-collapse: collapse; background-color: #fcfcfc; border: 1px solid #f1f2f6; border-radius: 4px;">
                            ${manifestFields.map(f => `
                                <tr style="border-bottom: 1px solid #f1f2f6;">
                                    <td style="padding: 10px 15px; width: 180px; font-weight: 600; font-size: 12px; color: #34495e; border-right: 1px solid #f1f2f6; text-transform: capitalize;">${f.label.replace(/([A-Z])/g, ' $1').trim()}</td>
                                    <td style="padding: 10px 15px; font-size: 13px; color: #2c3e50;">${f.value || '-'}</td>
                                </tr>
                            `).join('')}
                        </table>
                    </div>

                    <!-- System Traceability -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding-top: 15px; border-top: 1px dashed #dcdde1; opacity: 0.8;">
                        <div>
                            <span style="font-size: 10px; color: #95a5a6; text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 4px;">Principal</span>
                            <span style="font-size: 12px; font-weight: 500;">${declaration.principal || 'N/A'}</span>
                        </div>
                        <div>
                            <span style="font-size: 10px; color: #95a5a6; text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 4px;">Commercial Reference</span>
                            <span style="font-size: 12px; font-weight: 500;">${declaration.commercial_reference || 'N/A'}</span>
                        </div>
                    </div>

                    <!-- Raw Link String Reference -->
                    <div style="margin-top: 20px; background-color: #f5f6fa; padding: 10px; border-radius: 4px;">
                        <span style="font-size: 9px; color: #7f8c8d; text-transform: uppercase; display: block; margin-bottom: 4px;">Technical Link Reference</span>
                        <div style="font-size: 9px; font-family: monospace; color: #95a5a6; word-break: break-all;">${declaration.odoo_linkstring || 'NO_LINK_STRING'}</div>
                    </div>
                </div>

                <!-- Footer -->
                <div style="background-color: #f5f6fa; padding: 12px 24px; border-top: 1px solid #dcdde1; text-align: right; border-radius: 0 0 4px 4px;">
                    <span style="font-size: 10px; color: #95a5a6; font-weight: 500;">PROCESSED AT ${timestamp} • SYSTEM INTEGRATION V3.0</span>
                </div>
            </div>
        `;

        // Create a structured and clean ticket subject
        const ticketSubject = `[#${declaration.declaration_id}] | ${declaration.commercial_reference || 'NOREF'} | ${declaration.principal || 'NO_PRINCIPAL'}`.toUpperCase();

        const ticketId = await helpdeskService.createTicket({
            name: ticketSubject,
            description: htmlDescription,
            teamName: 'CMR-FISCAL REPRESENTATION',
            assignedTo: 'AdministrationCMR', // Auto-assign to the requested user
            priority: '1',
        });
        return ticketId;
    } catch (error) {
        console.error('Create Odoo Ticket Error:', error);
        throw error;
    }
};

export const authenticate = () => odooClient.authenticate();
