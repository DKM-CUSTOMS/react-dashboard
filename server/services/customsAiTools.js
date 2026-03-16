import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import Papa from 'papaparse';
import { BlobServiceClient } from '@azure/storage-blob';

let cachedGnDf = null;

// Initialize Pinecone Client
const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY || "pcsk_6uX13E_DSFjcSSH8cfrm87h3bGwSBEgsTX9pNdYuitJnxK5DxsbcT9wRMwsbiQUjY5vtwm"
});

/**
 * Stage 0: Load and Parse the CSV Nomenclature DB from Azure Blob into Memory 
 * Uses the same BlobServiceClient pattern as hrAiTools.js
 */
export async function initializeNomenclatureDB() {
    if (cachedGnDf) return cachedGnDf;

    console.log("Downloading GN 2026 DB from Azure storage into memory...");
    try {
        const connStr = process.env.VITE_AZURE_STORAGE_CONNECTION_STRING;
        if (!connStr) throw new Error("Missing VITE_AZURE_STORAGE_CONNECTION_STRING");

        const blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
        const containerClient = blobServiceClient.getContainerClient("document-intelligence");
        const blobClient = containerClient.getBlockBlobClient("AI/GN_nomenclatuur_2026.csv");

        console.log("Fetching GN 2026 CSV from Azure Blob: document-intelligence/AI/GN_nomenclatuur_2026.csv");
        const downloadBuffer = await blobClient.downloadToBuffer();
        const csvText = downloadBuffer.toString("utf-8");

        Papa.parse(csvText, {
            header: true,
            delimiter: ";", // Match Python logic
            skipEmptyLines: true,
            complete: (results) => {
                // Clean the data by stripping whitespace exactly like Python implementation
                cachedGnDf = results.data.map(row => ({
                    gn_code: (row.gn_code || "").trim(),
                    douanerecht: (row.douanerecht || "").trim(),
                    omschrijving: (row.omschrijving || ""),
                    code_niveau: (row.code_niveau || "")
                }));
                console.log(`✅ Nomenclature DB loaded perfectly! Total rows: ${cachedGnDf.length}`);
            }
        });

        return cachedGnDf;
    } catch (err) {
        console.error("Failed to load GN Nomenclature DB", err);
        return [];
    }
}

/**
 * 1. GN 2026 Search Tool (Replaces pandas string matching)
 */
export const searchGnNomenclatureTool = new DynamicStructuredTool({
    name: "search_gn_nomenclature",
    description: "Search the official EU Combined Nomenclature 2026 database by product description keywords.",
    schema: z.object({
        query: z.string().describe("The product description or keywords to search for.")
    }),
    func: async ({ query }) => {
        if (!cachedGnDf) await initializeNomenclatureDB();

        const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

        // Map and score every row just like the python logic
        const scoredRows = cachedGnDf.map(row => {
            const desc = row.omschrijving.toLowerCase();
            const score = queryTokens.reduce((acc, tok) => acc + (desc.includes(tok) ? 1 : 0), 0);
            return { ...row, _score: score };
        }).filter(r => r._score >= 2).sort((a, b) => b._score - a._score).slice(0, 8); // Top 8 matches

        if (scoredRows.length === 0) {
            return "No matching descriptions found in GN 2026 nomenclature for the given query terms.\nProceeding to Stage 1 internet research.";
        }

        const levelMap = {
            "hoofdpost": "HS Heading (4-digit)",
            "onderverdeling_6": "HS Subheading (6-digit)",
            "onderverdeling_8": "CN Code (8-digit)",
            "onderverdeling_10": "TARIC Subdivision (10-digit)"
        };

        let output = `✅ GN 2026 — Found ${scoredRows.length} candidate(s) matching your query:\n\n`;
        for (const r of scoredRows) {
            const niveau = levelMap[r.code_niveau] || r.code_niveau;
            const duty = r.douanerecht ? r.douanerecht : "(see subdivisions)";
            output += `  Code      : ${r.gn_code}\n  Level     : ${niveau}\n  Description (NL): ${r.omschrijving}\n  Duty rate : ${duty}\n  ----------------------------------------------\n`;
        }
        return output;
    }
});

/**
 * 2. EXACT Code Lookup Tool (Replaces pandas parent fallback logic)
 */
export const lookupCnCodeTool = new DynamicStructuredTool({
    name: "lookup_cn_code_in_nomenclature",
    description: "Perform an exact lookup of a specific code in the official EU Combined Nomenclature CSV database. MANDATORY.",
    schema: z.object({
        gn_code: z.string().describe("The exact GN or CN code to look up.")
    }),
    func: async ({ gn_code }) => {
        if (!cachedGnDf) await initializeNomenclatureDB();

        const codeClean = gn_code.trim().replace(/[\s\.]/g, "");
        const exact = cachedGnDf.find(r => r.gn_code === codeClean);

        if (!exact) {
            // Find parent fallback
            let parentMatch = null;
            for (const len of [8, 6, 4]) {
                if (codeClean.length > len) {
                    const parentCode = codeClean.slice(0, len);
                    const hasParent = cachedGnDf.some(r => r.gn_code === parentCode);
                    if (hasParent) {
                        parentMatch = parentCode;
                        break;
                    }
                }
            }

            let errorMsg = `❌ CODE NOT FOUND: '${gn_code}' does not exactly exist as a terminal code.\n\n`;
            if (parentMatch) {
                errorMsg += `💡 However, parent category '${parentMatch}' DOES exist! Valid sub-categories under it:\n`;
                const subs = cachedGnDf.filter(r => r.gn_code.startsWith(parentMatch) && r.gn_code.length > parentMatch.length).slice(0, 15);
                for (const r of subs) {
                    const dutyStr = r.douanerecht ? r.douanerecht : "(see further subcategories)";
                    errorMsg += `  - ${r.gn_code}: ${r.omschrijving.substring(0, 80)}... [Duty: ${dutyStr}]\n`;
                }
                errorMsg += "\n⚠️ Please review these valid options and ask the user for more details.";
            } else {
                errorMsg += "No matching parent heading found. Revise classification.";
            }
            return errorMsg;
        }

        return `✅ GN 2026 Code Confirmed: ${codeClean}\n\nDescription: ${exact.omschrijving}\nDuty rate  : ${exact.douanerecht || "0%"}\n\n`;
    }
});

/**
 * 3. EUR-Lex Pinecone Cloud Vector Search Tool
 */
export const searchEurlexCustomsTool = new DynamicStructuredTool({
    name: "search_eurlex_customs",
    description: "Search official EUR-Lex customs database hosted on Pinecone.",
    schema: z.object({
        search_query: z.string().describe("The query to search in EUR-Lex.")
    }),
    func: async ({ search_query }) => {
        console.log(`Querying Pinecone for: ${search_query}`);
        try {
            // Replicate Python Smart Expansion Regex
            let expandedQuery = search_query;
            const targetCodes = search_query.match(/\b\d{6,10}\b/g) || [];

            targetCodes.forEach(code => {
                const p1 = code.slice(0, 4);
                const p2 = `${code.slice(0, 4)} ${code.slice(4, 6)}`;
                expandedQuery += ` ${p1} ${p2}`;
                if (code.length >= 8) expandedQuery += ` ${code.slice(0, 4)} ${code.slice(4, 6)} ${code.slice(6, 8)}`;
            });

            console.log("Expanded Pinecone Query:", expandedQuery);

            const index = pc.Index("customs-eurlex");
            const embeddings = new OpenAIEmbeddings({ modelName: "text-embedding-3-small" });
            const queryEmbedding = await embeddings.embedQuery(expandedQuery);

            // Search Vector DB
            const queryResponse = await index.query({
                vector: queryEmbedding,
                topK: 5,
                includeMetadata: true
            });

            if (queryResponse.matches.length === 0) {
                return "No official EU legal texts found matching this query in the Pinecone database.";
            }

            let result = "Official EUR-Lex Customs Document Retrieval Results:\n\n";
            queryResponse.matches.forEach((match, i) => {
                const meta = match.metadata || {};
                result += `--- Result ${i + 1} : ${meta.section || 'Unknown'} | ${meta.chapter || 'Unknown'} ---\n${meta.text || 'Document Match'}\n\n`;
            });

            return result;
        } catch (err) {
            console.error(err);
            return `Error retrieving from Pinecone official database: ${err.message}`;
        }
    }
});
