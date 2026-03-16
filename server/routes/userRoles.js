import express from 'express';
import mysql from 'mysql2/promise';
import { userRoleMap } from '../../src/utils/roleConfig.js';

const router = express.Router();

const getDbConnection = async () => {
  return await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DB,
    ssl: { rejectUnauthorized: false },
  });
};

// Middleware: only admin or developer can write; anyone authenticated can read /me
const requireAdminOrDeveloper = async (req, res, next) => {
  const callerEmail = req.headers['x-ms-client-principal-name']?.toLowerCase();
  if (!callerEmail) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const conn = await getDbConnection();
    const [rows] = await conn.execute(
      'SELECT roles FROM dashboard_user_roles WHERE email = ?',
      [callerEmail]
    );
    await conn.end();

    let roles = [];
    if (rows.length > 0) {
      roles = typeof rows[0].roles === 'string' ? JSON.parse(rows[0].roles) : rows[0].roles;
    } else {
      // Fallback to roleConfig.js
      roles = userRoleMap[callerEmail] || [];
    }

    const normalized = roles.map(r => r.toLowerCase());
    if (normalized.includes('developer') || normalized.includes('admin')) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: requires admin or developer role' });
  } catch {
    // DB unavailable — fallback to roleConfig.js for bootstrap
    const roles = userRoleMap[callerEmail] || [];
    const normalized = roles.map(r => r.toLowerCase());
    if (normalized.includes('developer') || normalized.includes('admin')) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden' });
  }
};

// GET /api/user-roles/me — current user's roles from DB (used by getUser.js)
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

    const roles = typeof rows[0].roles === 'string' ? JSON.parse(rows[0].roles) : rows[0].roles;
    return res.json({ roles });
  } catch {
    return res.json({ roles: [] });
  }
});

// GET /api/user-roles — list all users with their roles
router.get('/', requireAdminOrDeveloper, async (req, res) => {
  try {
    const conn = await getDbConnection();
    const [rows] = await conn.execute(
      'SELECT email, roles, updated_at FROM dashboard_user_roles ORDER BY email'
    );
    await conn.end();

    const users = rows.map(r => ({
      email: r.email,
      roles: typeof r.roles === 'string' ? JSON.parse(r.roles) : r.roles,
      updated_at: r.updated_at,
    }));

    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/user-roles/:email — get one user's roles
router.get('/:email', requireAdminOrDeveloper, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  try {
    const conn = await getDbConnection();
    const [rows] = await conn.execute(
      'SELECT email, roles, updated_at FROM dashboard_user_roles WHERE email = ?',
      [email]
    );
    await conn.end();

    if (rows.length === 0) return res.json({ success: true, email, roles: [] });

    const roles = typeof rows[0].roles === 'string' ? JSON.parse(rows[0].roles) : rows[0].roles;
    res.json({ success: true, email, roles, updated_at: rows[0].updated_at });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/user-roles/:email — set roles for a user
router.put('/:email', requireAdminOrDeveloper, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  const { roles } = req.body;

  if (!Array.isArray(roles)) {
    return res.status(400).json({ success: false, error: 'roles must be an array' });
  }

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

// DELETE /api/user-roles/:email — remove user entry (reverts to defaults / no special roles)
router.delete('/:email', requireAdminOrDeveloper, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  try {
    const conn = await getDbConnection();
    await conn.execute('DELETE FROM dashboard_user_roles WHERE email = ?', [email]);
    await conn.end();
    res.json({ success: true, message: 'User role entry removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
