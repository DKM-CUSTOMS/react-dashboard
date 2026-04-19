
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

// Lazy-initialized singletons (env vars may not be available at import time)
let odooClient = null;
let helpdeskService = null;

const getHelpdeskService = () => {
    if (!helpdeskService) {
        const url = process.env.ODOO_URL;
        const db = process.env.ODOO_DB;
        const username = process.env.ODOO_USERNAME;
        const apiKey = process.env.ODOO_API_KEY;

        console.log(`🔧 Initializing Odoo Client — URL: ${url ? '✅' : '❌ MISSING'}, DB: ${db ? '✅' : '❌ MISSING'}, User: ${username ? '✅' : '❌ MISSING'}, Key: ${apiKey ? '✅ (hidden)' : '❌ MISSING'}`);

        if (!url || !db || !username || !apiKey) {
            throw new Error(`Missing Odoo environment variables. URL=${!!url}, DB=${!!db}, USER=${!!username}, KEY=${!!apiKey}`);
        }

        odooClient = new OdooClient(url, db, username, apiKey);
        helpdeskService = new HelpdeskService(odooClient);
    }
    return helpdeskService;
};

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

                    <!-- Principal & Commercial Reference -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
                        <div style="background-color: #f8f4f7; border: 1px solid #e8dde5; border-left: 4px solid #714B67; border-radius: 4px; padding: 14px 16px;">
                            <span style="font-size: 10px; color: #714B67; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">Principal</span>
                            <span style="font-size: 15px; font-weight: 700; color: #2c3e50;">${declaration.principal || 'N/A'}</span>
                        </div>
                        <div style="background-color: #f5f6fa; border: 1px solid #dcdde1; border-left: 4px solid #7f8c8d; border-radius: 4px; padding: 14px 16px;">
                            <span style="font-size: 10px; color: #7f8c8d; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">Commercial Reference</span>
                            <span style="font-size: 15px; font-weight: 700; color: #2c3e50; font-family: 'Courier New', monospace;">${declaration.commercial_reference || 'N/A'}</span>
                        </div>
                    </div>

                    ${(declaration.straat_en_nummer || declaration.stad || declaration.importer_code || declaration.plda_operatoridentity) ? `
                    <!-- Address & Location -->
                    <div style="margin-bottom: 20px; background-color: #f9fafb; border: 1px solid #e0e0e0; border-radius: 4px; padding: 16px;">
                        <h4 style="margin: 0 0 12px 0; font-size: 11px; color: #7f8c8d; text-transform: uppercase; font-weight: 700; border-left: 3px solid #27ae60; padding-left: 8px;">Address & Location</h4>
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                            ${declaration.straat_en_nummer || declaration.stad ? `
                            <tr style="border-bottom: 1px solid #f0f0f0;">
                                <td style="padding: 7px 0; width: 150px; font-weight: 600; color: #7f8c8d; font-size: 12px;">Address</td>
                                <td style="padding: 7px 0; color: #2c3e50; font-weight: 500;">
                                    ${[declaration.straat_en_nummer, declaration.postcode, declaration.stad, declaration.landcode].filter(Boolean).join(', ') || 'N/A'}
                                </td>
                            </tr>` : ''}
                            ${declaration.importer_code ? `
                            <tr style="border-bottom: 1px solid #f0f0f0;">
                                <td style="padding: 7px 0; font-weight: 600; color: #7f8c8d; font-size: 12px;">Importer Code</td>
                                <td style="padding: 7px 0; color: #2c3e50; font-weight: 500;">${declaration.importer_code}</td>
                            </tr>` : ''}
                            ${declaration.plda_operatoridentity ? `
                            <tr>
                                <td style="padding: 7px 0; font-weight: 600; color: #7f8c8d; font-size: 12px;">VAT Number</td>
                                <td style="padding: 7px 0; font-family: 'Courier New', monospace; color: #2c3e50; font-weight: 600;">${[declaration.plda_operatoridentitycountry, declaration.plda_operatoridentity].filter(Boolean).join('')}</td>
                            </tr>` : ''}
                        </table>
                    </div>` : ''}

                    <!-- Extracted Manifest Data -->
                    <div style="margin-bottom: 20px;">
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

                    <!-- Containers -->
                    <div style="background-color: #f8f9ff; border: 1px solid #e8eaf6; padding: 12px 16px; border-radius: 4px;">
                        <span style="font-size: 10px; color: #7f8c8d; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; display: block; margin-bottom: 8px;">Containers</span>
                        ${declaration.containers_list
                            ? `<div style="font-size: 13px; font-family: 'Courier New', monospace; color: #2c3e50; font-weight: 600;">${declaration.containers_list}</div>`
                            : `<div style="font-size: 12px; color: #b2bec3; font-style: italic;">No containers</div>`
                        }
                    </div>

                    <!-- Raw Link String Reference -->
                    <div style="margin-top: 20px; background-color: #f5f6fa; padding: 10px; border-radius: 4px;">
                        <span style="font-size: 9px; color: #7f8c8d; text-transform: uppercase; display: block; margin-bottom: 4px;">Technical Link Reference</span>
                        <div style="font-size: 9px; font-family: monospace; color: #95a5a6; word-break: break-all;">${declaration.odoo_linkstring_streamsoftware || declaration.odoo_linkstring || 'NO_LINK_STRING'}</div>
                    </div>
                </div>

                <!-- Footer -->
                <div style="background-color: #f5f6fa; padding: 12px 24px; border-top: 1px solid #dcdde1; text-align: right; border-radius: 0 0 4px 4px;">
                    <span style="font-size: 10px; color: #95a5a6; font-weight: 500;">PROCESSED AT ${timestamp} • SYSTEM INTEGRATION V3.0</span>
                </div>
            </div>
        `;

        // Create a structured and clean ticket subject
        const ticketSubject = `${declaration.declaration_id} - Reference : ${declaration.commercial_reference || 'NOREF'} - ${declaration.importer_code || 'NO_IMPORTER'} - ${declaration.mrn || 'NO_MRN'}`;

        const svc = getHelpdeskService();
        const ticketId = await svc.createTicket({
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

export const authenticate = () => {
    const svc = getHelpdeskService();
    return svc.client.authenticate();
};
