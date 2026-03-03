import express from 'express';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../data/teams_persistence.json');

const router = express.Router();

// Helper for Mock Persistence
const getMockData = () => {
    if (!fs.existsSync(path.dirname(DATA_FILE))) {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = { teams: MOCK_TEAMS, users: MOCK_DB_USERS };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
};

const saveMockData = (data) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

const getDbConnection = async () => {
    return await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DB,
        ssl: { rejectUnauthorized: false }
    });
};

const MOCK_TEAMS = [
    {
        id: 1,
        name: 'Import',
        parent_id: null,
        location: 'Local Mock',
        members: [
            'FADWA.ERRAZIKI', 'AYOUB.SOURISTE', 'AYMANE.BERRIOUA', 'SANA.IDRISSI', 'AMINA.SAISS',
            'KHADIJA.OUFKIR', 'ZOHRA.HMOUDOU', 'SIMO.ONSI', 'YOUSSEF.ASSABIR', 'ABOULHASSAN.AMINA',
        ],
        leaders: ['FADWA.ERRAZIKI']
    },
    {
        id: 2,
        name: 'Export',
        parent_id: null,
        location: 'Local Mock',
        members: [
            'IKRAM.OULHIANE', 'MOURAD.ELBAHAZ', 'MOHSINE.SABIL', 'AYA.HANNI',
            'ZAHIRA.OUHADDA', 'CHAIMAAE.EJJARI', 'HAFIDA.BOOHADDOU', 'KHADIJA.HICHAMI', 'FATIMA.ZAHRA.BOUGSIM'
        ],
        leaders: ['IKRAM.OULHIANE']
    }
];

const MOCK_DB_USERS = [
    ...MOCK_TEAMS[0].members.map(u => ({ usercode: u, role: 'member', location: 'Local Mock' })),
    ...MOCK_TEAMS[1].members.map(u => ({ usercode: u, role: 'member', location: 'Local Mock' })),
];

// GET /api/teams
// Returns a list of all teams, their members, and all registered users
router.get('/', async (req, res) => {
    if (process.env.USE_MOCK_DB === 'true') {
        const data = getMockData();
        return res.json({
            success: true,
            teams: data.teams,
            dbUsers: data.users,
            isMock: true
        });
    }

    try {
        const connection = await getDbConnection();

        // Fetch all teams
        const [teams] = await connection.execute('SELECT * FROM teams');

        // Fetch all members
        const [members] = await connection.execute(`
      SELECT tm.team_id, tm.usercode, tm.is_leader, u.role, u.location
      FROM team_members tm
      JOIN users u ON tm.usercode = u.usercode
    `);

        // Fetch all users existing in DB
        const [users] = await connection.execute('SELECT * FROM users');

        await connection.end();

        // Group members by team
        const teamsWithMembers = teams.map(team => ({
            ...team,
            members: members.filter(m => m.team_id === team.id).map(m => m.usercode),
            leaders: members.filter(m => m.team_id === team.id && !!m.is_leader).map(m => m.usercode)
        }));

        res.json({
            success: true,
            teams: teamsWithMembers,
            dbUsers: users
        });

    } catch (error) {
        console.warn('Error fetching DB teams, falling back to mock data:', error.message);
        const data = getMockData();
        res.json({
            success: true,
            teams: data.teams,
            dbUsers: data.users,
            isMock: true
        });
    }
});

// POST /api/teams - Create a new team
router.post('/', async (req, res) => {
    const { name, parent_id, location } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Team name is required' });

    if (process.env.USE_MOCK_DB === 'true') {
        const data = getMockData();
        const newId = data.teams.length > 0 ? Math.max(...data.teams.map(t => t.id)) + 1 : 1;
        const newTeam = {
            id: newId,
            name,
            parent_id: parent_id || null,
            location: location || 'Mock',
            members: [],
            leaders: []
        };
        data.teams.push(newTeam);
        saveMockData(data);
        return res.json({ success: true, teamId: newId });
    }

    try {
        const connection = await getDbConnection();
        const [result] = await connection.execute(
            'INSERT INTO teams (name, parent_id, location) VALUES (?, ?, ?)',
            [name, parent_id || null, location || null]
        );
        await connection.end();

        res.json({ success: true, teamId: result.insertId });
    } catch (error) {
        console.error('Error creating team:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/teams/:id - Delete a team
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const teamId = parseInt(id);

    if (process.env.USE_MOCK_DB === 'true') {
        const data = getMockData();
        const teamToDelete = data.teams.find(t => t.id === teamId);
        if (teamToDelete) {
            // Remove team and its subteams
            data.teams = data.teams.filter(t => t.id !== teamId && t.parent_id !== teamId);
            saveMockData(data);
        }
        return res.json({ success: true, message: 'Team deleted' });
    }

    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM teams WHERE id = ?', [id]);
        await connection.end();

        res.json({ success: true, message: 'Team deleted' });
    } catch (error) {
        console.error('Error deleting team:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/teams/members - Assign a user to a team
router.post('/members', async (req, res) => {
    const { team_id, usercode, role = 'member' } = req.body;
    if (!team_id || !usercode) return res.status(400).json({ success: false, error: 'team_id and usercode are required' });

    if (process.env.USE_MOCK_DB === 'true') {
        const data = getMockData();
        
        // Remove from other teams first
        data.teams.forEach(t => {
            t.members = t.members.filter(m => m !== usercode);
            t.leaders = t.leaders.filter(m => m !== usercode);
        });

        // Add to targeted team
        const targetTeam = data.teams.find(t => t.id === parseInt(team_id));
        if (targetTeam) {
            if (!targetTeam.members.includes(usercode)) {
                targetTeam.members.push(usercode);
            }
        }

        // Add to users if not present
        if (!data.users.find(u => u.usercode === usercode)) {
            data.users.push({ usercode, role, location: 'Mock' });
        }

        saveMockData(data);
        return res.json({ success: true, message: 'User assigned to team' });
    }

    try {
        const connection = await getDbConnection();

        // Ensure user exists in users table first
        const [userExists] = await connection.execute('SELECT * FROM users WHERE usercode = ?', [usercode]);
        if (userExists.length === 0) {
            await connection.execute(
                'INSERT INTO users (usercode, role) VALUES (?, ?)',
                [usercode, role]
            );
        }

        // Assign to team
        await connection.execute(
            'INSERT INTO team_members (team_id, usercode) VALUES (?, ?) ON DUPLICATE KEY UPDATE team_id = VALUES(team_id)',
            [team_id, usercode]
        );

        await connection.end();
        res.json({ success: true, message: 'User assigned to team' });
    } catch (error) {
        console.error('Error assigning user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/teams/:teamId/members/:usercode - Remove a user from a team
router.delete('/:teamId/members/:usercode', async (req, res) => {
    const { teamId, usercode } = req.params;

    if (process.env.USE_MOCK_DB === 'true') {
        const data = getMockData();
        const targetTeam = data.teams.find(t => t.id === parseInt(teamId));
        if (targetTeam) {
            targetTeam.members = targetTeam.members.filter(m => m !== usercode);
            targetTeam.leaders = (targetTeam.leaders || []).filter(m => m !== usercode);
            saveMockData(data);
        }
        return res.json({ success: true, message: 'User removed from team' });
    }

    try {
        const connection = await getDbConnection();
        await connection.execute(
            'DELETE FROM team_members WHERE team_id = ? AND usercode = ?',
            [teamId, usercode]
        );
        await connection.end();

        res.json({ success: true, message: 'User removed from team' });
    } catch (error) {
        console.error('Error removing user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/teams/:teamId/members/:usercode/leader
router.put('/:teamId/members/:usercode/leader', async (req, res) => {
    const { teamId, usercode } = req.params;
    const { is_leader } = req.body;

    if (process.env.USE_MOCK_DB === 'true') {
        const data = getMockData();
        const targetTeam = data.teams.find(t => t.id === parseInt(teamId));
        if (targetTeam) {
            if (!targetTeam.leaders) targetTeam.leaders = [];
            if (is_leader) {
                if (!targetTeam.leaders.includes(usercode)) targetTeam.leaders.push(usercode);
            } else {
                targetTeam.leaders = targetTeam.leaders.filter(m => m !== usercode);
            }
            saveMockData(data);
        }
        return res.json({ success: true, message: 'User leadership updated' });
    }

    try {
        const connection = await getDbConnection();
        await connection.execute(
            'UPDATE team_members SET is_leader = ? WHERE team_id = ? AND usercode = ?',
            [is_leader ? 1 : 0, teamId, usercode]
        );
        await connection.end();
        res.json({ success: true, message: 'User leadership updated' });
    } catch (error) {
        console.error('Error updating leadership:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
