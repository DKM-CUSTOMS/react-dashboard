/**
 * One-time script to upload initial principals.json to Azure Blob Storage.
 * Run with: node --env-file=.env scripts/seed-principals.js
 */

import { BlobServiceClient } from '@azure/storage-blob';



const CONTAINER = "document-intelligence";
const BLOB_PATH = "FiscalRepresentationWebApp/principals.json";

const initialData = {
  principals: [
    "PRINCIPAL",
    "ACT",
    "Ideal",
    "Auriga",
    "TCI",
    "Ozer",
    "Leschaco",
    "Sealogis",
    "Middlegate",
    "AFL",
    "Monroe",
    "Embassy",
    "Mainfreight",
    "Levaco",
    "Blue Shipping",
    "Seacon FR",
    "Alphacargo",
    "Marken",
    "Fed Mog",
    "KMS",
    "Debeaux",
    "MC",
    "TBL",
    "OSL",
    "Hamann",
    "Omnifreight",
    "Fox Global",
    "Sevenhills",
    "Blackstone",
    "Dilissen",
    "MG Int",
    "Spark",
    "Brinks",
    "Hellmann",
    "Tenneco ES",
    "Ocean Crown",
    "VS Logistics",
    "Seacon ES",
    "Akomar"
  ]
};

async function seed() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString || connectionString.includes('YOUR_ACCOUNT')) {
    console.error('ERROR: Set AZURE_STORAGE_CONNECTION_STRING in .env first');
    process.exit(1);
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(CONTAINER);
  const blobClient = containerClient.getBlockBlobClient(BLOB_PATH);

  const content = JSON.stringify(initialData, null, 2);

  console.log(`Uploading to: ${CONTAINER}/${BLOB_PATH}`);
  await blobClient.upload(content, content.length, {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });

  console.log('Done! Principals uploaded successfully.');
  console.log(`${initialData.principals.length} principals seeded.`);
}

seed().catch(err => {
  console.error('Upload failed:', err.message);
  process.exit(1);
});
