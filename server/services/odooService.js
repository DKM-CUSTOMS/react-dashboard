
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
        this.teamCache = {};
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

    async createTicket({ name, teamName, description, priority = "1", partnerEmail }) {
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
const PASSWORD = process.env.ODOO_API_KEY || '2d4be578f0419c3600626515d93e25e6be9406eb';

const odooClient = new OdooClient(ODOO_URL, DB, USERNAME, PASSWORD);
const helpdeskService = new HelpdeskService(odooClient);

/**
 * Main export for creating tickets from declarations
 */
export const createOdooTicket = async (declaration) => {
    try {
        const ticketId = await helpdeskService.createTicket({
            name: declaration.mail_subject || `Declaration ${declaration.declaration_id}`,
            description: declaration.odoo_body || `Generated from declaration ${declaration.declaration_id}`,
            teamName: 'Internal', // Use a name as per the new service logic
            priority: '1',
            // partnerEmail: declaration.importer_email // if available
        });
        return ticketId;
    } catch (error) {
        console.error('Create Odoo Ticket Error:', error);
        throw error;
    }
};

export const authenticate = () => odooClient.authenticate();
