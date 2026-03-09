import express from 'express';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'data', 'customInstructions.json');

const router = express.Router();

function readStore() {
    try {
        const raw = readFileSync(DATA_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function writeStore(data) {
    writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// GET /api/ai/instructions?user=email@example.com
router.get('/', (req, res) => {
    const userId = req.query.user;
    if (!userId) {
        return res.status(400).json({ error: 'User identifier is required' });
    }

    const store = readStore();
    const instructions = store[userId] || { aboutUser: '', responseStyle: '' };
    res.json({ success: true, instructions });
});

// POST /api/ai/instructions
router.post('/', (req, res) => {
    const { user, aboutUser, responseStyle } = req.body;
    if (!user) {
        return res.status(400).json({ error: 'User identifier is required' });
    }

    const store = readStore();
    store[user] = {
        aboutUser: (aboutUser || '').slice(0, 1500),
        responseStyle: (responseStyle || '').slice(0, 1500),
        updatedAt: new Date().toISOString()
    };
    writeStore(store);

    res.json({ success: true, instructions: store[user] });
});

// DELETE /api/ai/instructions?user=email@example.com
router.delete('/', (req, res) => {
    const userId = req.query.user;
    if (!userId) {
        return res.status(400).json({ error: 'User identifier is required' });
    }

    const store = readStore();
    delete store[userId];
    writeStore(store);

    res.json({ success: true });
});

export default router;
