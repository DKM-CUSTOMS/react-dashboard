import express from 'express';
import { getDbConnection } from '../config/db.js';

const router = express.Router();

const parseRoles = (val) =>
  typeof val === 'string' ? JSON.parse(val) : (Array.isArray(val) ? val : []);

// Middleware: verify caller has developer or admin role in DB.
// In dev (no Azure header) we allow through — frontend already enforces access.
const requireAdminOrDeveloper = async (req, res, next) => {
  const callerEmail = req.headers['x-ms-client-principal-name']?.toLowerCase();
  if (!callerEmail) return next(); // dev mode — no header, trust frontend auth

  try {
    const conn = await getDbConnection();
    const [rows] = await conn.execute(
      'SELECT roles FROM dashboard_user_roles WHERE email = ?',
      [callerEmail]
    );
    await conn.end();

    const roles = rows.length > 0 ? parseRoles(rows[0].roles).map(r => r.toLowerCase()) : [];
    if (roles.includes('developer') || roles.includes('admin')) return next();
    return res.status(403).json({ error: 'Forbidden' });
  } catch {
    return next(); // DB unavailable — allow through, rely on frontend
  }
};

// GET /api/user-roles/me — called by getUser.js to resolve the current user's DB roles
router.get('/me', async (req, res) => {
  const email = req.headers['x-ms-client-principal-name']?.toLowerCase();
  if (!email) return res.json({ roles: [] });

  try {
    const conn = await getDbConnection();
    const [rows] = await conn.execute(
      'SELECT roles FROM dashboard_user_roles WHERE email = ?',
      [email]
    );
    await conn.end();
    if (rows.length === 0) return res.json({ roles: [] });
    return res.json({ roles: parseRoles(rows[0].roles) });
  } catch {
    return res.json({ roles: [] });
  }
});

// GET /api/user-roles — list all entries in dashboard_user_roles
router.get('/', requireAdminOrDeveloper, async (req, res) => {
  try {
    const conn = await getDbConnection();
    const [rows] = await conn.execute(
      'SELECT email, roles, updated_at FROM dashboard_user_roles ORDER BY email'
    );
    await conn.end();
    res.json({
      success: true,
      users: rows.map(r => ({ email: r.email, roles: parseRoles(r.roles), updated_at: r.updated_at })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/user-roles/:email — upsert roles for a user
router.put('/:email', requireAdminOrDeveloper, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  const { roles } = req.body;
  if (!Array.isArray(roles)) return res.status(400).json({ success: false, error: 'roles must be an array' });

  try {
    const conn = await getDbConnection();
    await conn.execute(
      `INSERT INTO dashboard_user_roles (email, roles) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE roles = VALUES(roles), updated_at = CURRENT_TIMESTAMP`,
      [email, JSON.stringify(roles)]
    );
    await conn.end();
    res.json({ success: true, email, roles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/user-roles/:email — remove a user entry entirely
router.delete('/:email', requireAdminOrDeveloper, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  try {
    const conn = await getDbConnection();
    await conn.execute('DELETE FROM dashboard_user_roles WHERE email = ?', [email]);
    await conn.end();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
