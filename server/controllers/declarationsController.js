
import { getDbConnection } from '../config/db.js';

// GET /api/declarations
export const getDeclarations = async (req, res) => {
  // MOCK MODE for Local Development
  if (process.env.USE_MOCK_DB === 'true') {
    console.log('Serving Mock Data for Declarations');
    const mockData = [
      {
        "declaration_id": 154438,
        "declaration_guid": "57419AC664EB465EFEAB08DE2D0324B4",
        "mail_subject": "154438Reference : S01BE00000610/CI - APFELKONI - 25BEH10000018LIDR4",
        "odoo_linkstring": "+++++CUSTOMS/IDMS-AES EXPORT/57419AC664EB465EFEAB08DE2D0324B4/[LGYO7QB28SII69FO]+++++ (Please do not remove this line)",
        "odoo_body": "Destination: DE - Link5: DE-13587 BERLIN TURKUAZ GMBH - ImportercountryDE - Importer: APFELKONIGIN GMBH - FiscalRepresentedAPFELKONI - FiscalConsigneeTURKUAZ GM",
        "commercial_reference": "S01BE00000610/CI",
        "principal": "IDEAL",
        "importer_code": "APFELKONI",
        "mrn": "25BEH10000018LIDR4",
        "traces_identification": null,
        "linkiderp2": null,
        "linkiderp4": null,
        "date_of_acceptance": "2025-11-27T00:00:00.000Z",
        "first_seen_at": "2026-02-17T16:40:57.000Z",
        "last_seen_at": "2026-02-18T11:13:16.000Z",
        "odoo_status": "NEW",
        "odoo_project_id": null,
        "odoo_error": null,
        "odoo_updated_at": null
      },
      {
        "declaration_id": 154439,
        "declaration_guid": "MOCK_GUID_2",
        "mail_subject": "MOCK SUBJECT 2",
        "odoo_linkstring": "MOCK LINKSTRING",
        "odoo_body": "MOCK BODY",
        "commercial_reference": "MOCK/REF/2",
        "principal": "TEST_PRINCIPAL",
        "importer_code": "TEST_IMPORTER",
        "mrn": "MOCK_MRN_2",
        "traces_identification": null,
        "linkiderp2": null,
        "linkiderp4": null,
        "date_of_acceptance": "2025-12-01T00:00:00.000Z",
        "first_seen_at": "2026-02-18T10:00:00.000Z",
        "last_seen_at": "2026-02-18T12:00:00.000Z",
        "odoo_status": "CREATED",
        "odoo_project_id": "PROJECT_123",
        "odoo_error": null,
        "odoo_updated_at": "2026-02-18T12:00:00.000Z"
      }
    ];

    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;

    // Simple mock filtering
    let filtered = mockData.filter(item => {
      if (req.query.status && item.odoo_status !== req.query.status) return false;
      if (req.query.principal && !item.principal.includes(req.query.principal)) return false;
      if (req.query.importer && !item.importer_code.includes(req.query.importer)) return false;
      return true;
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

    const { from, to, status, principal, importer } = req.query;

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

    connection = await getDbConnection();

    // 1. Get Total Count
    const [countRows] = await connection.execute(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = countRows[0].total;

    // 2. Get Data
    // Use interpolation for LIMIT/OFFSET to avoid prepared statement issues (safe because we parseInt'ed them)
    const dataQuery = `SELECT * ${baseQuery} ORDER BY date_of_acceptance DESC LIMIT ${pageSize} OFFSET ${offset}`;

    // Use .query() instead of .execute() for better compatibility with dynamic queries
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

    // 1. Construct Mock Declaration Object from the mockData array or provided ID
    const mockData = [
      {
        "declaration_id": 154438,
        "declaration_guid": "57419AC664EB465EFEAB08DE2D0324B4",
        "mail_subject": "154438Reference : S01BE00000610/CI - APFELKONI - 25BEH10000018LIDR4",
        "odoo_linkstring": "+++++CUSTOMS/IDMS-AES EXPORT/57419AC664EB465EFEAB08DE2D0324B4/[LGYO7QB28SII69FO]+++++ (Please do not remove this line)",
        "odoo_body": "Destination: DE - Link5: DE-13587 BERLIN TURKUAZ GMBH - ImportercountryDE - Importer: APFELKONIGIN GMBH - FiscalRepresentedAPFELKONI - FiscalConsigneeTURKUAZ GM",
        "commercial_reference": "S01BE00000610/CI",
        "principal": "IDEAL",
        "importer_code": "APFELKONI",
        "mrn": "25BEH10000018LIDR4",
        "traces_identification": null,
        "linkiderp2": null,
        "linkiderp4": null,
        "date_of_acceptance": "2025-11-27T00:00:00.000Z",
        "odoo_status": "NEW"
      },
      {
        "declaration_id": 154439,
        "declaration_guid": "MOCK_GUID_2",
        "mail_subject": "MOCK SUBJECT 2",
        "odoo_linkstring": "MOCK LINKSTRING",
        "odoo_body": "MOCK BODY",
        "commercial_reference": "MOCK/REF/2",
        "principal": "TEST_PRINCIPAL",
        "importer_code": "TEST_IMPORTER",
        "mrn": "MOCK_MRN_2",
        "traces_identification": null,
        "linkiderp2": null,
        "linkiderp4": null,
        "date_of_acceptance": "2025-12-01T00:00:00.000Z",
        "odoo_status": "CREATED"
      }
    ];

    let mockDeclaration = mockData.find(d => d.declaration_id == id);

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

    try {
      // 2. Call REAL Odoo Service
      const ticketId = await createOdooTicket(mockDeclaration);
      console.log(`[Success] Odoo Ticket Created via Mock Mode! ID: ${ticketId}`);

      // Return success with REAL ticket ID
      return res.json({
        success: true,
        odoo_project_id: ticketId,
        status: 'CREATED'
      });

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
