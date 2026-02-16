import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { BlobServiceClient } from '@azure/storage-blob';

// Load environment variables from .env file natively (Node.js 21.7.0+)
try {
  process.loadEnvFile();
  console.log('Environment variables loaded from .env');
} catch (e) {
  // .env file might not exist in production
  console.log('No .env file found, using system environment variables');
}



// Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// Path to JSON store
const DATA_FILE = path.join(__dirname, 'tracking-data.json');

// Helper to read data
const readData = () => {
  if (!fs.existsSync(DATA_FILE)) {
    return { records: [] };
  }
  const data = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(data);
};

// Helper to write data
const writeData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// API Routes
app.get('/api/tracking', (req, res) => {
  const data = readData();
  res.json({ records: data.records });
});

app.get('/api/tracking/:mrn', (req, res) => {
  const { mrn } = req.params;
  const data = readData();
  const record = data.records.find(r => r.MRN === mrn);
  res.json({ tracking_records: record ? record.tracking_records : [] });
});

app.post('/api/tracking', (req, res) => {
  const { mrn, tracking_data } = req.body;
  
  if (!mrn || !tracking_data) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const data = readData();
  let record = data.records.find(r => r.MRN === mrn);

  if (!record) {
    record = { MRN: mrn, tracking_records: [] };
    data.records.push(record);
  }

  record.tracking_records.unshift(tracking_data); // Add new record at start
  writeData(data);

  res.json({ success: true, message: 'Tracking recorded' });
});

app.post('/api/tracking/bulk', (req, res) => {
  const { records } = req.body; // Array of { mrn, tracking_data }
  
  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: 'Invalid input containing records array' });
  }

  const data = readData();
  let updateCount = 0;

  records.forEach(({ mrn, tracking_data }) => {
    let record = data.records.find(r => r.MRN === mrn);
    if (!record) {
      record = { MRN: mrn, tracking_records: [] };
      data.records.push(record);
    }
    // Add new record at start
    record.tracking_records.unshift(tracking_data);
    updateCount++;
  });

  writeData(data);
  res.json({ success: true, message: `${updateCount} records updated successfully` });
});

// ============================================================
// Fiscal Representation - Azure Blob Storage CRUD for Principals
// ============================================================
const FISCAL_CONTAINER = "document-intelligence";
const FISCAL_BLOB_PATH = "FiscalRepresentationWebApp/principals.json";

// Helper: get blob client
const getFiscalBlobClient = () => {
  const connectionString = process.env.VITE_AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('VITE_AZURE_STORAGE_CONNECTION_STRING is not configured');
  }
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(FISCAL_CONTAINER);
  return containerClient.getBlockBlobClient(FISCAL_BLOB_PATH);
};

// Helper: read principals from blob
const readPrincipals = async () => {
  try {
    const blobClient = getFiscalBlobClient();
    const downloadResponse = await blobClient.download(0);
    const chunks = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf8');
    const data = JSON.parse(content);
    return data.principals || [];
  } catch (err) {
    if (err.statusCode === 404) {
      return [];
    }
    throw err;
  }
};

// Helper: write principals to blob
const writePrincipals = async (principals) => {
  const blobClient = getFiscalBlobClient();
  const content = JSON.stringify({ principals }, null, 2);
  await blobClient.upload(content, content.length, {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
};

// GET - List all principals
app.get('/api/fiscal/principals', async (req, res) => {
  try {
    const principals = await readPrincipals();
    res.json({ principals });
  } catch (err) {
    console.error('Error reading principals:', err);
    res.status(500).json({ error: 'Failed to read principals' });
  }
});

// POST - Add a principal
app.post('/api/fiscal/principals', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Principal name is required' });
    }

    const principals = await readPrincipals();
    const trimmed = name.trim();

    if (principals.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
      return res.status(409).json({ error: 'Principal already exists' });
    }

    principals.push(trimmed);
    principals.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await writePrincipals(principals);

    res.json({ success: true, message: `"${trimmed}" added`, principals });
  } catch (err) {
    console.error('Error adding principal:', err);
    res.status(500).json({ error: 'Failed to add principal' });
  }
});

// PUT - Update a principal
app.put('/api/fiscal/principals', async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    if (!oldName || !newName || !newName.trim()) {
      return res.status(400).json({ error: 'Both oldName and newName are required' });
    }

    const principals = await readPrincipals();
    const index = principals.findIndex(p => p === oldName);

    if (index === -1) {
      return res.status(404).json({ error: 'Principal not found' });
    }

    const trimmed = newName.trim();
    if (principals.some(p => p.toLowerCase() === trimmed.toLowerCase() && p !== oldName)) {
      return res.status(409).json({ error: 'A principal with this name already exists' });
    }

    principals[index] = trimmed;
    principals.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await writePrincipals(principals);

    res.json({ success: true, message: `"${oldName}" renamed to "${trimmed}"`, principals });
  } catch (err) {
    console.error('Error updating principal:', err);
    res.status(500).json({ error: 'Failed to update principal' });
  }
});

// DELETE - Remove a principal
app.delete('/api/fiscal/principals', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Principal name is required' });
    }

    const principals = await readPrincipals();
    const index = principals.findIndex(p => p === name);

    if (index === -1) {
      return res.status(404).json({ error: 'Principal not found' });
    }

    principals.splice(index, 1);
    await writePrincipals(principals);

    res.json({ success: true, message: `"${name}" removed`, principals });
  } catch (err) {
    console.error('Error deleting principal:', err);
    res.status(500).json({ error: 'Failed to delete principal' });
  }
});

// Health Check & Version
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.3.0', timestamp: new Date().toISOString() });
});

// Debug middleware for unhandled requests
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.url}`);
  next();
});

// Handle SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
