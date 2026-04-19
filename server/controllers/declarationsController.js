
import { getDbConnection } from '../config/db.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mockDeclarations = require('../data/mock-declarations.json');

// Allowed sort columns (whitelist to prevent SQL injection)
const ALLOWED_SORT_COLUMNS = {
  'declaration_id': 'declaration_id',
  'date_of_acceptance': 'date_of_acceptance',
  'principal': 'principal',
  'importer_code': 'importer_code',
  'mrn': 'mrn',
  'commercial_reference': 'commercial_reference',
  'odoo_status': 'odoo_status',
  'first_seen_at': 'first_seen_at',
  'last_seen_at': 'last_seen_at',
  'stad': 'stad',
  'landcode': 'landcode',
  'containers_list': 'containers_list',
};

// GET /api/declarations
export const getDeclarations = async (req, res) => {
  // MOCK MODE for Local Development
  if (process.env.USE_MOCK_DB === 'true') {
    console.log('Serving Mock Data for Declarations');

    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;
    const search = (req.query.search || '').toLowerCase().trim();
    const sortBy = req.query.sortBy || 'declaration_id';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

    // Mock filtering
    let filtered = mockDeclarations.filter(item => {
      if (req.query.status && item.odoo_status !== req.query.status) return false;
      if (req.query.principal && !item.principal.includes(req.query.principal)) return false;
      if (req.query.importer && !item.importer_code.includes(req.query.importer)) return false;
      // Global search across all fields
      if (search) {
        const searchFields = [
          String(item.declaration_id || ''),
          item.principal || '',
          item.importer_code || '',
          item.mrn || '',
          item.commercial_reference || '',
          item.mail_subject || '',
          item.stad || '',
          item.postcode || '',
          item.landcode || '',
          item.plda_operatoridentity || '',
          item.containers_list || '',
        ].map(f => f.toLowerCase());
        if (!searchFields.some(f => f.includes(search))) return false;
      }
      return true;
    });

    // Mock sorting
    filtered.sort((a, b) => {
      const valA = a[sortBy] ?? '';
      const valB = b[sortBy] ?? '';
      const cmp = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

    return res.json({
      data: paginated,
      pagination: {
        page,
        pageSize,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / pageSize)
      }
    });
  }

  let connection;
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;
    const offset = (page - 1) * pageSize;

    const { from, to, status, principal, importer, search, sortBy, sortOrder } = req.query;

    let baseQuery = "FROM fr_section_declarations WHERE 1=1";
    const params = [];

    if (from) {
      baseQuery += " AND date_of_acceptance >= ?";
      params.push(from);
    }
    if (to) {
      baseQuery += " AND date_of_acceptance <= ?";
      params.push(to);
    }
    if (status) {
      baseQuery += " AND odoo_status = ?";
      params.push(status);
    }
    if (principal) {
      baseQuery += " AND principal LIKE ?";
      params.push(`%${principal}%`);
    }
    if (importer) {
      baseQuery += " AND importer_code LIKE ?";
      params.push(`%${importer}%`);
    }

    // Global search across multiple columns
    if (search && search.trim()) {
      baseQuery += ` AND (
        CAST(declaration_id AS CHAR) LIKE ?
        OR principal LIKE ?
        OR importer_code LIKE ?
        OR mrn LIKE ?
        OR commercial_reference LIKE ?
        OR mail_subject LIKE ?
        OR stad LIKE ?
        OR postcode LIKE ?
        OR landcode LIKE ?
        OR plda_operatoridentity LIKE ?
        OR containers_list LIKE ?
      )`;
      const searchTerm = `%${search.trim()}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    connection = await getDbConnection();

    // 1. Get Total Count
    const [countRows] = await connection.execute(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = countRows[0].total;

    // 2. Determine sort column (whitelist to prevent injection)
    const sortColumn = ALLOWED_SORT_COLUMNS[sortBy] || 'declaration_id';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    // 3. Get Data
    const dataQuery = `SELECT * ${baseQuery} ORDER BY ${sortColumn} ${order} LIMIT ${pageSize} OFFSET ${offset}`;

    const [rows] = await connection.query(dataQuery, params);

    res.json({
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });

  } catch (err) {
    console.error("Error fetching declarations:", err);
    res.status(500).json({ error: "Failed to fetch declarations" });
  } finally {
    if (connection) await connection.end();
  }
};

// GET /api/declarations/stats
export const getDeclarationStats = async (_req, res) => {
  if (process.env.USE_MOCK_DB === 'true') {
    const total = mockDeclarations.length;
    const unsynced = mockDeclarations.filter(d => d.odoo_status === 'NEW').length;
    const failed = mockDeclarations.filter(d => d.odoo_status === 'FAILED').length;
    const created = mockDeclarations.filter(d => d.odoo_status === 'CREATED').length;
    const today = mockDeclarations.filter(d => {
      const d2 = new Date(d.date_of_acceptance);
      const now = new Date();
      return d2.toDateString() === now.toDateString();
    }).length;
    return res.json({ unsynced, failed, created, today, total });
  }

  let connection;
  try {
    connection = await getDbConnection();
    const [rows] = await connection.execute(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN odoo_status = 'NEW' THEN 1 ELSE 0 END) as unsynced,
        SUM(CASE WHEN odoo_status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN odoo_status = 'CREATED' THEN 1 ELSE 0 END) as created,
        SUM(CASE WHEN DATE(date_of_acceptance) = CURDATE() THEN 1 ELSE 0 END) as today
      FROM fr_section_declarations
    `);
    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching declaration stats:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  } finally {
    if (connection) await connection.end();
  }
};

// GET /api/declarations/:id
export const getDeclarationById = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    connection = await getDbConnection();

    const [rows] = await connection.execute(
      "SELECT * FROM fr_section_declarations WHERE declaration_id = ?",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Declaration not found" });
    }

    res.json(rows[0]);

  } catch (err) {
    console.error("Error fetching declaration:", err);
    res.status(500).json({ error: "Failed to fetch declaration" });
  } finally {
    if (connection) await connection.end();
  }
};

import { createOdooTicket } from '../services/odooService.js';

// POST /api/declarations/:id/create-project
export const createProject = async (req, res) => {
  const { id } = req.params;

  // MOCK MODE with DATA + REAL ODOO CALL
  if (process.env.USE_MOCK_DB === 'true') {
    console.log(`[Mock Mode] Using logic: Mock Database Data -> Real Odoo API Call`);

    // 1. Construct Mock Declaration Object from the shared mockDeclarations array
    let mockDeclaration = mockDeclarations.find(d => d.declaration_id == id);

    if (!mockDeclaration) {
      // Fallback if ID doesn't match mock records
      mockDeclaration = {
        declaration_id: id,
        mail_subject: `[TEST] Declaration ${id} - Auto-Generated Ticket`,
        odoo_body: `No detailed mock body available for ID: ${id}`,
        principal: "DYNAMIC_MOCK_PRINCIPAL",
        importer_code: "DYNAMIC_MOCK_IMPORTER",
        mrn: "MOCK-MRN-" + id,
        commercial_reference: "REF-" + id,
        odoo_linkstring: "MOCK-LINKSTRING-" + id,
        declaration_guid: "MOCK-GUID-" + id,
        date_of_acceptance: new Date().toISOString()
      };
    }

    const odooReady = process.env.ODOO_URL && process.env.ODOO_DB && process.env.ODOO_USERNAME && process.env.ODOO_API_KEY;

    if (!odooReady) {
      // Simulate a successful ticket creation when Odoo creds are not set locally
      const fakeTicketId = `MOCK-${Date.now()}`;
      console.log(`[Mock Mode] Odoo credentials not configured — simulating ticket creation. Fake ID: ${fakeTicketId}`);
      return res.json({ success: true, odoo_project_id: fakeTicketId, status: 'CREATED' });
    }

    try {
      // 2. Call REAL Odoo Service (creds are present)
      const ticketId = await createOdooTicket(mockDeclaration);
      console.log(`[Mock Mode] Real Odoo Ticket Created! ID: ${ticketId}`);
      return res.json({ success: true, odoo_project_id: ticketId, status: 'CREATED' });

    } catch (odooErr) {
      console.error("ODOO ERROR (Mock Mode):", odooErr);
      return res.status(502).json({
        error: "Failed to create ticket in Odoo (Mock Mode)",
        details: odooErr.message
      });
    }
  }

  let connection;
  try {
    connection = await getDbConnection();

    // 1. Fetch Declaration
    const [rows] = await connection.execute(
      "SELECT * FROM fr_section_declarations WHERE declaration_id = ?",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Declaration not found" });
    }

    const declaration = rows[0];

    // 2. Check if already exists
    if (declaration.odoo_project_id) {
      return res.status(400).json({ error: "Ticket already exists", odoo_project_id: declaration.odoo_project_id });
    }

    // 3. Update status to PENDING
    await connection.execute(
      "UPDATE fr_section_declarations SET odoo_status = 'PENDING', odoo_updated_at = NOW() WHERE declaration_id = ?",
      [id]
    );

    // 4. Call Odoo Service
    let ticketId;
    try {
      ticketId = await createOdooTicket(declaration);
    } catch (odooErr) {
      // Handle Odoo Failure
      console.error("Odoo Creation Failed:", odooErr);
      await connection.execute(
        "UPDATE fr_section_declarations SET odoo_status = 'FAILED', odoo_error = ?, odoo_updated_at = NOW() WHERE declaration_id = ?",
        [odooErr.message || "Unknown Odoo Error", id]
      );
      return res.status(502).json({ error: "Failed to create ticket in Odoo", details: odooErr.message });
    }

    // 5. Success - Update DB
    await connection.execute(
      "UPDATE fr_section_declarations SET odoo_status = 'CREATED', odoo_project_id = ?, odoo_error = NULL, odoo_updated_at = NOW() WHERE declaration_id = ?",
      [ticketId, id]
    );

    res.json({ success: true, odoo_project_id: ticketId, status: 'CREATED' });

  } catch (err) {
    console.error("Error in createProject:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    if (connection) await connection.end();
  }
};
