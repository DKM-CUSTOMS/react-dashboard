import { getDbConnection } from '../config/db.js';

const SYNC_SECRET = process.env.SYNC_SECRET || "change_me_in_env";

// Helper to extract GUID
const extractGuid = (linkString) => {
  if (!linkString) return "UNKNOWN";
  const match = linkString.match(/([A-F0-9]{32})/i);
  return match ? match[1] : "UNKNOWN";
};

export const syncDeclarations = async (req, res) => {
  const { items } = req.body;
  const secret = req.headers['x-sync-secret'];

  // Auth
  if (secret !== SYNC_SECRET) {
    return res.status(401).json({ error: "Unauthorized Sync" });
  }

  // Validation
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  let connection;
  try {
    connection = await getDbConnection();
    await connection.beginTransaction();

    const stats = { received: items.length, upserted: 0 };
    
    // NEW TABLE NAME: fr_section_declarations
    const query = `
      INSERT INTO fr_section_declarations (
        declaration_id, declaration_guid, mail_subject, odoo_linkstring, odoo_body, 
        commercial_reference, principal, importer_code, mrn, 
        traces_identification, linkiderp2, linkiderp4, date_of_acceptance,
        first_seen_at, last_seen_at
      ) VALUES ?
      ON DUPLICATE KEY UPDATE
        last_seen_at = NOW();
    `;

    const values = items.map(item => [
      item.DECLARATIONID,
      extractGuid(item.ODOO_LINKSTRING_STREAMSOFTWARE),
      item.MAIL_SUBJECT || "",
      item.ODOO_LINKSTRING_STREAMSOFTWARE || "",
      item.ODOO_BODY || "",
      item.COMMERCIALREFERENCE || null,
      item.PRINCIPAL || null,
      item.IMPORTERCODE || null,
      item.MRN || null,
      
      // Clean string fields
      (item.TRACESIDENTIFICATION || "").trim() || null,
      (item.LINKIDERP2 || "").trim() || null,
      (item.LINKIDERP4 || "").trim() || null,

      item.DATEOFACCEPTANCE ? new Date(item.DATEOFACCEPTANCE) : null,
      new Date(), // first_seen_at
      new Date()  // last_seen_at
    ]);

    if (values.length > 0) {
      const [result] = await connection.query(query, [values]);
      stats.upserted = result.affectedRows;
    }

    await connection.commit();
    res.json({ success: true, stats });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Sync Error:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (connection) await connection.end();
  }
};
