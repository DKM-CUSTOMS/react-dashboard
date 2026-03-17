import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import Papa from 'papaparse';
import { BlobServiceClient } from '@azure/storage-blob';

let cachedGnDf = null;

// Lazy initialization — created on first use, not at import time.
let _pc = null;
let _embeddings = null;

function getPineconeClient() {
    if (!_pc) _pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    return _pc;
}

function getEmbeddings() {
    if (!_embeddings) _embeddings = new OpenAIEmbeddings({ modelName: "text-embedding-3-small" });
    return _embeddings;
}

// ─── Performance caches (per server restart) ───────────────────────────────

// GN nomenclature text-search cache — avoids O(n) re-scanning for repeated queries
const GN_SEARCH_CACHE_MAX = 300;
const gnSearchCache = new Map();

function cacheGnResult(query, result) {
    if (gnSearchCache.size >= GN_SEARCH_CACHE_MAX) {
        gnSearchCache.delete(gnSearchCache.keys().next().value); // evict oldest
    }
    gnSearchCache.set(query, result);
}

// Pinecone embedding+query cache — avoids re-embedding + round-trip for repeated queries
const PINECONE_CACHE_MAX = 200;
const pineconeCache = new Map();

function cachePineconeResult(query, result) {
    if (pineconeCache.size >= PINECONE_CACHE_MAX) {
        pineconeCache.delete(pineconeCache.keys().next().value);
    }
    pineconeCache.set(query, result);
}

// ─── Stage 0: Load GN 2026 CSV from Azure Blob ────────────────────────────

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

        await new Promise((resolve, reject) => {
            Papa.parse(csvText, {
                header: true,
                delimiter: ";",
                skipEmptyLines: true,
                complete: (results) => {
                    cachedGnDf = results.data.map(row => ({
                        gn_code: (row.gn_code || "").trim(),
                        douanerecht: (row.douanerecht || "").trim(),
                        omschrijving: (row.omschrijving || ""),
                        code_niveau: (row.code_niveau || "")
                    }));
                    console.log(`✅ Nomenclature DB loaded! Total rows: ${cachedGnDf.length}`);
                    resolve();
                },
                error: reject
            });
        });

        return cachedGnDf;
    } catch (err) {
        console.error("Failed to load GN Nomenclature DB", err);
        return [];
    }
}

// ─── Tool 1: GN 2026 Keyword Search ──────────────────────────────────────

export const searchGnNomenclatureTool = new DynamicStructuredTool({
    name: "search_gn_nomenclature",
    description: "Search the official EU Combined Nomenclature 2026 database by product description keywords. The database is in DUTCH — translate keywords before searching. Call multiple times with different Dutch synonyms if the first search returns fewer than 5 results or no terminal codes.",
    schema: z.object({
        query: z.string().describe("The product description or keywords to search for in DUTCH.")
    }),
    func: async ({ query }) => {
        if (!cachedGnDf) await initializeNomenclatureDB();

        const cacheKey = query.toLowerCase().trim();
        if (gnSearchCache.has(cacheKey)) {
            return gnSearchCache.get(cacheKey);
        }

        const queryTokens = cacheKey.split(/\s+/).filter(t => t.length > 2);

        const levelPriority = {
            "onderverdeling_10": 3,
            "onderverdeling_8": 2,
            "onderverdeling_6": 1,
            "hoofdpost": 0
        };

        const scoredRows = cachedGnDf.map(row => {
            const desc = row.omschrijving.toLowerCase();
            const descWords = desc.split(/\s+/);

            // Exact substring = 2pts, prefix/stem match = 1pt (handles Dutch morphology)
            const textScore = queryTokens.reduce((acc, tok) => {
                if (desc.includes(tok)) return acc + 2;
                if (descWords.some(w => w.startsWith(tok) || tok.startsWith(w))) return acc + 1;
                return acc;
            }, 0);

            const levelBoost = textScore > 0 ? (levelPriority[row.code_niveau] || 0) * 0.5 : 0;

            return { ...row, _score: textScore + levelBoost };
        })
            .filter(r => r._score > 0)
            .sort((a, b) => b._score - a._score)
            .slice(0, 15);

        let result;
        if (scoredRows.length === 0) {
            result = `No matching descriptions found in GN 2026 for query: "${query}".\nTry a different Dutch synonym or a shorter root keyword.`;
        } else {
            const levelMap = {
                "hoofdpost": "HS Heading (4-digit)",
                "onderverdeling_6": "HS Subheading (6-digit)",
                "onderverdeling_8": "CN Code (8-digit)",
                "onderverdeling_10": "TARIC Subdivision (10-digit)"
            };

            result = `✅ GN 2026 — Found ${scoredRows.length} candidate(s) for "${query}":\n\n`;
            for (const r of scoredRows) {
                const niveau = levelMap[r.code_niveau] || r.code_niveau;
                const duty = r.douanerecht ? r.douanerecht : "(see subdivisions)";
                result += `  Code      : ${r.gn_code}\n  Level     : ${niveau}\n  Description (NL): ${r.omschrijving}\n  Duty rate : ${duty}\n  ----------------------------------------------\n`;
            }
        }

        cacheGnResult(cacheKey, result);
        return result;
    }
});

// ─── Tool 2: Exact CN Code Lookup ─────────────────────────────────────────

export const lookupCnCodeTool = new DynamicStructuredTool({
    name: "lookup_cn_code_in_nomenclature",
    description: "Perform an exact lookup of a specific code in the official EU Combined Nomenclature CSV database. Run for ALL plausible candidate codes to confirm duty rates.",
    schema: z.object({
        gn_code: z.string().describe("The exact GN or CN code to look up.")
    }),
    func: async ({ gn_code }) => {
        if (!cachedGnDf) await initializeNomenclatureDB();

        const codeClean = gn_code.trim().replace(/[\s.]/g, "");
        const exact = cachedGnDf.find(r => r.gn_code === codeClean);

        if (!exact) {
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

            let errorMsg = `❌ CODE NOT FOUND: '${gn_code}' does not exist as a terminal code in GN 2026.\n\n`;
            if (parentMatch) {
                errorMsg += `💡 Parent category '${parentMatch}' exists. Valid sub-categories under it:\n`;
                const subs = cachedGnDf
                    .filter(r => r.gn_code.startsWith(parentMatch) && r.gn_code.length > parentMatch.length)
                    .slice(0, 15);
                for (const r of subs) {
                    const dutyStr = r.douanerecht ? r.douanerecht : "(see further subcategories)";
                    errorMsg += `  - ${r.gn_code}: ${r.omschrijving} [Duty: ${dutyStr}]\n`;
                }
                errorMsg += "\n⚠️ Review these options and ask the user for the specific detail needed.";
            } else {
                errorMsg += "No matching parent heading found. Revise the classification approach.";
            }
            return errorMsg;
        }

        return `✅ GN 2026 Code Confirmed: ${codeClean}\n\nDescription : ${exact.omschrijving}\nDuty rate   : ${exact.douanerecht || "0%"}\nLevel       : ${exact.code_niveau}\n`;
    }
});

// ─── Tool 3: EUR-Lex Pinecone Vector Search ────────────────────────────────

export const searchEurlexCustomsTool = new DynamicStructuredTool({
    name: "search_eurlex_customs",
    description: "Search the official EUR-Lex customs legal database on Pinecone. MANDATORY — call with the candidate heading code + product type to retrieve legally binding Chapter Notes and Section Notes that may override description matches.",
    schema: z.object({
        search_query: z.string().describe("The query to search in EUR-Lex — include the 4-digit heading code + product description.")
    }),
    func: async ({ search_query }) => {
        const cacheKey = search_query.toLowerCase().trim();
        if (pineconeCache.has(cacheKey)) {
            console.log(`Pinecone cache HIT for: ${search_query}`);
            return pineconeCache.get(cacheKey);
        }

        console.log(`Querying Pinecone for: ${search_query}`);
        try {
            let expandedQuery = search_query;
            const targetCodes = search_query.match(/\b\d{6,10}\b/g) || [];

            targetCodes.forEach(code => {
                const p1 = code.slice(0, 4);
                const p2 = `${code.slice(0, 4)} ${code.slice(4, 6)}`;
                expandedQuery += ` ${p1} ${p2}`;
                if (code.length >= 8) expandedQuery += ` ${code.slice(0, 4)} ${code.slice(4, 6)} ${code.slice(6, 8)}`;
            });

            console.log("Expanded Pinecone Query:", expandedQuery);

            const index = getPineconeClient().index("customs-eurlex");
            const queryEmbedding = await getEmbeddings().embedQuery(expandedQuery);

            const queryResponse = await index.query({
                vector: queryEmbedding,
                topK: 8,
                includeMetadata: true
            });

            const relevant = queryResponse.matches.filter(m => m.score > 0.70).slice(0, 5);

            let result;
            if (relevant.length === 0) {
                result = "No sufficiently relevant EUR-Lex legal texts found for this query. Proceed with GN 2026 data only and note that legal basis could not be confirmed.";
            } else {
                result = "Official EUR-Lex Customs Legal Texts:\n\n";
                relevant.forEach((match, i) => {
                    const meta = match.metadata || {};
                    result += `--- [${i + 1}] ${meta.section || 'Unknown'} | ${meta.chapter || 'Unknown'} (relevance: ${match.score.toFixed(2)}) ---\n${meta.text || 'Document Match'}\n\n`;
                });
            }

            cachePineconeResult(cacheKey, result);
            return result;
        } catch (err) {
            console.error(err);
            return `Error retrieving from EUR-Lex database: ${err.message}`;
        }
    }
});

// ─── Tool 4: TARIC 10-digit Completions ───────────────────────────────────

export const getTaricCompletionsTool = new DynamicStructuredTool({
    name: "get_taric_completions",
    description: "Get ALL possible 10-digit TARIC code completions for a confirmed CN code. Call this AFTER step 3 with the 8-digit CN code. If multiple 10-digit options exist, present them ALL to the user in a table and ask which best describes their goods. The 10-digit code is REQUIRED for StreamLiner declarations.",
    schema: z.object({
        cn_code: z.string().describe("The 6 or 8-digit parent CN code to find 10-digit TARIC completions for.")
    }),
    func: async ({ cn_code }) => {
        if (!cachedGnDf) await initializeNomenclatureDB();

        const codeClean = cn_code.trim().replace(/[\s.]/g, "");

        // If already 10 digits, verify and confirm
        if (codeClean.length >= 10) {
            const exact = cachedGnDf.find(r => r.gn_code === codeClean);
            if (exact) {
                return `✅ ${codeClean} is a confirmed 10-digit TARIC code.\n\nDescription: ${exact.omschrijving}\nDuty rate: ${exact.douanerecht || '0%'}\n\n🔗 Verify: https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${codeClean}`;
            }
            return `❌ ${codeClean} not found in GN 2026 at the 10-digit level.`;
        }

        // Find all 10-digit children
        const tenDigit = cachedGnDf.filter(r =>
            r.code_niveau === 'onderverdeling_10' &&
            r.gn_code.startsWith(codeClean)
        );

        // Find all 8-digit children (fallback if no 10-digit)
        const eightDigit = cachedGnDf.filter(r =>
            r.code_niveau === 'onderverdeling_8' &&
            r.gn_code.startsWith(codeClean) &&
            r.gn_code.length === 8
        );

        let output = '';

        if (tenDigit.length === 1) {
            // Unique 10-digit code — confirm automatically
            const r = tenDigit[0];
            output = `✅ Unique 10-digit TARIC code found:\n\n**${r.gn_code}** — ${r.omschrijving}\nDuty rate: ${r.douanerecht || '0%'}\n\n🔗 Verify: https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${r.gn_code}`;
        } else if (tenDigit.length > 1) {
            output = `📋 **${tenDigit.length} possible 10-digit TARIC codes** under ${codeClean}:\n\n`;
            output += `**→ Ask the user to confirm which option describes their goods:**\n\n`;
            output += `| # | Code | Description (NL — translate to EN) | Duty |\n`;
            output += `|---|------|--------------------------------------|------|\n`;
            tenDigit.slice(0, 20).forEach((r, i) => {
                const duty = r.douanerecht || '0%';
                output += `| ${i + 1} | **${r.gn_code}** | ${r.omschrijving} | ${duty} |\n`;
            });
            if (tenDigit.length > 20) {
                output += `\n... and ${tenDigit.length - 20} more options. Use a more specific parent code to narrow down.\n`;
            }
            output += `\n⚠️ **Present these options to the user (translate descriptions to English) and ask:** "Which of these descriptions best matches your specific product?"\n`;
            output += `\n🔗 Check all options: https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${codeClean}`;
        } else if (eightDigit.length > 0) {
            // No 10-digit TARIC subdivisions — standard EU practice: append "00"
            output = `📋 No 10-digit TARIC subdivisions found for ${codeClean} in GN 2026.\n\n`;
            output += `✅ **Standard "00" completion applies — StreamLiner 10-digit codes:**\n\n`;
            output += `| # | CN Code (8-digit) | StreamLiner 10-digit | Description (NL — translate to EN) | Duty |\n`;
            output += `|---|-------------------|---------------------|--------------------------------------|------|\n`;
            eightDigit.slice(0, 10).forEach((r, i) => {
                const duty = r.douanerecht || '0%';
                output += `| ${i + 1} | ${r.gn_code} | **${r.gn_code}00** | ${r.omschrijving} | ${duty} |\n`;
            });
            output += `\n🔔 **TARIC "00" RULE — MUST INCLUDE IN YOUR RESPONSE:**\n`;
            output += `GN 2026 has no further TARIC subdivisions for this heading. Per standard EU TARIC practice, the full 10-digit code is the 8-digit CN code + "00". `;
            output += `You MUST tell the user: "The '00' suffix was added because no TARIC subdivisions exist for this code. This is the correct and standard 10-digit code to enter in StreamLiner."\n`;
            output += `\n🔗 Verify: https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${codeClean}00`;
        } else {
            const exact = cachedGnDf.find(r => r.gn_code === codeClean);
            if (exact && exact.code_niveau === 'onderverdeling_8') {
                // Direct 8-digit match — append 00
                output = `✅ ${codeClean} is a confirmed 8-digit CN terminal code with no TARIC subdivisions.\n\n`;
                output += `**StreamLiner 10-digit code: ${codeClean}00**\n\n`;
                output += `Description: ${exact.omschrijving}\nDuty: ${exact.douanerecht || '0%'}\n\n`;
                output += `🔔 **Tell the user**: "00" was appended per standard EU TARIC practice because no subdivisions exist. This is the correct code for StreamLiner.\n`;
                output += `\n🔗 Verify: https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${codeClean}00`;
            } else if (exact) {
                output = `✅ ${codeClean} is a terminal code (${exact.code_niveau}). No further subdivisions.\n\nDescription: ${exact.omschrijving}\nDuty: ${exact.douanerecht || '0%'}`;
            } else {
                output = `❌ No completions found for code ${codeClean}. Please verify the parent code is correct.`;
            }
        }

        return output;
    }
});
