import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbeddings } from '@langchain/openai';
import OpenAI from 'openai';
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
                        code_niveau: (row.code_niveau || ""),
                        // DKM internal correction and comment (Column C/D) — optional fields
                        dkm_correction: (row.dkm_correction || row.correctie || row.correction || "").trim(),
                        dkm_comment: (row.dkm_comment || row.opmerking || row.comment || row.commentaar || "").trim()
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

// ─── Tool 0: Product Intelligence (web search + vision) ───────────────────
// Uses gpt-4o-search-preview to research the product on the live internet.
// Returns material composition, specs, function, and classification signals.

const PRODUCT_INTEL_CACHE_MAX = 200;
const productIntelCache = new Map();

// Search-preview models reject LangChain's default params — use raw OpenAI SDK
let _openaiClient = null;
function getOpenAIClient() {
    if (!_openaiClient) _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _openaiClient;
}

export const understandProductTool = new DynamicStructuredTool({
    name: "understand_product",
    description: "Search the internet to deeply understand a product before classification. Call this FIRST for any product where: (1) the name contains a model number, brand, or technical term you are not 100% certain about, (2) the product type is ambiguous, or (3) the description is very short. Returns material, specs, function, and key classification signals.",
    schema: z.object({
        product_query: z.string().describe("The full product name, model number, or description to research online.")
    }),
    func: async ({ product_query }) => {
        const cacheKey = product_query.toLowerCase().trim();
        if (productIntelCache.has(cacheKey)) {
            console.log(`Product intel cache HIT: ${product_query}`);
            return productIntelCache.get(cacheKey);
        }

        console.log(`Researching product online: ${product_query}`);

        try {
            const client = getOpenAIClient();
            const response = await client.chat.completions.create({
                model: "gpt-4o-search-preview",
                web_search_options: {},
                messages: [{
                    role: "user",
                    content:
                        `You are a customs classification specialist. Research this product for EU import declaration purposes:\n\n"${product_query}"\n\n` +
                        `Search the internet and return ONLY the following — be factual, concise, and specific:\n\n` +
                        `1. PRODUCT TYPE: Exact category (e.g. "robotic lawn mower", "industrial servo motor", "lithium-ion battery pack")\n` +
                        `2. BRAND & MODEL: Confirm brand and model if identifiable — what is this specific product?\n` +
                        `3. MATERIAL COMPOSITION: Primary materials (metal type, plastic type, textile fibre, etc.)\n` +
                        `4. POWER / DRIVE: Electric / combustion / manual / hydraulic / pneumatic? Battery voltage if applicable.\n` +
                        `5. AUTOMATION: Autonomous / robotic / remote-controlled / operator-controlled / manual?\n` +
                        `6. PRIMARY FUNCTION: What does it do? Where is it used?\n` +
                        `7. KEY CLASSIFICATION SIGNALS: Features that determine the HS heading (e.g. "cutting device rotates horizontally", "no direct human control", "for outdoor use", "contains PCB").\n` +
                        `8. LIKELY HS CHAPTER: Your best estimate of the 2-digit HS chapter.\n\n` +
                        `If the product cannot be found online, state that clearly and describe what you can infer from the name alone.`
                }]
            });

            const result = `[PRODUCT INTELLIGENCE — "${product_query}"]\n\n${response.choices[0].message.content}`;

            if (productIntelCache.size >= PRODUCT_INTEL_CACHE_MAX) {
                productIntelCache.delete(productIntelCache.keys().next().value);
            }
            productIntelCache.set(cacheKey, result);
            return result;

        } catch (err) {
            console.error(`Product intel error for "${product_query}":`, err.message);
            return `[PRODUCT INTELLIGENCE — could not research "${product_query}" online: ${err.message}. Proceed with product name analysis only.]`;
        }
    }
});

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

        // Only include DKM fields if the CSV actually has data in them
        const correctionLine = exact.dkm_correction ? `DKM Correction: ${exact.dkm_correction}\n` : '';
        const commentLine = exact.dkm_comment ? `DKM Comment   : ${exact.dkm_comment}\n` : '';

        return `✅ GN 2026 Code Confirmed: ${codeClean}\n\nDescription   : ${exact.omschrijving}\nDuty rate     : ${exact.douanerecht || "0%"}\nLevel         : ${exact.code_niveau}\n${correctionLine}${commentLine}`;
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
        // Graceful fallback when Pinecone is not configured
        if (!process.env.PINECONE_API_KEY) {
            console.warn("PINECONE_API_KEY not set — EUR-Lex search skipped.");
            return "EUR-Lex legal database is currently unavailable (PINECONE_API_KEY not configured). Proceed with GN 2026 data only. Note that Chapter Notes and Section Notes could not be verified from EUR-Lex.";
        }

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
            // No 10-digit TARIC subdivisions in local GN 2026 — standard "00" rule applies
            // BUT the live EU TARIC may have subdivisions not in the local dataset
            output = `📋 **GN 2026 internal dataset: No 10-digit TARIC subdivisions found for ${codeClean}.**\n\n`;
            output += `| # | CN Code (8-digit) | Provisional 10-digit | Description (NL — translate to EN) | Duty |\n`;
            output += `|---|-------------------|---------------------|--------------------------------------|------|\n`;
            eightDigit.slice(0, 10).forEach((r, i) => {
                const duty = r.douanerecht || '0%';
                output += `| ${i + 1} | ${r.gn_code} | **${r.gn_code}00** | ${r.omschrijving} | ${duty} |\n`;
            });
            output += `\n⚠️ **MANDATORY WARNING — YOU MUST INCLUDE THIS IN YOUR RESPONSE WORD FOR WORD:**\n`;
            output += `"The internal GN 2026 dataset shows no TARIC subdivisions for this 8-digit code, so ${codeClean}00 is the standard provisional completion. `;
            output += `HOWEVER, the live EU TARIC database may have additional 10-digit subdivisions that are NOT present in the internal dataset. `;
            output += `You MUST verify this code at the EU TARIC portal before using it in StreamLiner — click the link below."\n`;
            output += `\n🔗 **User must verify:** https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${codeClean}`;
        } else {
            const exact = cachedGnDf.find(r => r.gn_code === codeClean);
            if (exact && exact.code_niveau === 'onderverdeling_8') {
                // Direct 8-digit match — provisional "00" with same live TARIC caveat
                output = `⚠️ ${codeClean} is an 8-digit CN terminal code in the internal dataset with no recorded TARIC subdivisions.\n\n`;
                output += `**Provisional StreamLiner 10-digit code: ${codeClean}00**\n\n`;
                output += `Description: ${exact.omschrijving}\nDuty: ${exact.douanerecht || '0%'}\n\n`;
                output += `⚠️ **MANDATORY WARNING — YOU MUST INCLUDE THIS IN YOUR RESPONSE:**\n`;
                output += `"The '00' suffix is provisional. The live EU TARIC database may have additional subdivisions not captured in the internal GN 2026 dataset. `;
                output += `The user MUST verify at the EU TARIC portal before finalising in StreamLiner."\n`;
                output += `\n🔗 **User must verify:** https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${codeClean}`;
            } else if (exact) {
                output = `✅ ${codeClean} is a terminal code (${exact.code_niveau}). No further subdivisions.\n\nDescription: ${exact.omschrijving}\nDuty: ${exact.douanerecht || '0%'}`;
            } else {
                output = `❌ No completions found for code ${codeClean}. Please verify the parent code is correct.`;
            }
        }

        return output;
    }
});

// ─── Tool 5: Live TARIC Subdivision Lookup ────────────────────────────────
// Uses the UK Trade Tariff REST API (JSON, public, no auth) which mirrors
// the EU Combined Nomenclature at the 10-digit level. The 10-digit code
// structure is identical to EU TARIC subdivisions.

const LIVE_TARIC_CACHE_MAX = 150;
const liveTaricCache = new Map();

export const queryLiveTaricTool = new DynamicStructuredTool({
    name: "query_live_eu_taric",
    description: "Query the live TARIC database to get real 10-digit subdivisions for a CN code. ALWAYS call this when the internal GN 2026 dataset shows no 10-digit subdivisions (i.e. the '00 rule' was triggered). Returns the actual 10-digit codes with full English descriptions.",
    schema: z.object({
        cn_code: z.string().describe("The 8-digit CN code to query (no spaces or dots).")
    }),
    func: async ({ cn_code }) => {
        const parent8 = cn_code.trim().replace(/[\s.]/g, "").slice(0, 8);
        if (parent8.length < 4) return `Invalid code: ${cn_code}`;

        if (liveTaricCache.has(parent8)) {
            console.log(`Live TARIC cache HIT: ${parent8}`);
            return liveTaricCache.get(parent8);
        }

        const heading4 = parent8.slice(0, 4);
        const apiUrl = `https://www.trade-tariff.service.gov.uk/api/v2/headings/${heading4}?include=chapter,section,commodities`;
        const taricUrl = `https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${parent8}`;

        console.log(`Querying live TARIC for ${parent8} via UK Trade Tariff API...`);

        try {
            const res = await fetch(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/json'
                },
                signal: AbortSignal.timeout(15000)
            });

            if (!res.ok) {
                return `⚠️ Live TARIC API returned HTTP ${res.status}. Verify manually: ${taricUrl}`;
            }

            const data = await res.json();
            const included = data.included || [];

            // Find all commodity entries whose code starts with our 8-digit parent,
            // are exactly 10 digits, and are NOT the "00" padding of the parent itself.
            const children = included.filter(item =>
                item.type === 'commodity' &&
                typeof item.attributes?.goods_nomenclature_item_id === 'string' &&
                item.attributes.goods_nomenclature_item_id.startsWith(parent8) &&
                item.attributes.goods_nomenclature_item_id.length === 10 &&
                item.attributes.goods_nomenclature_item_id !== `${parent8}00`
            );

            // Deduplicate by code (API can return the same code multiple times)
            const seen = new Set();
            const unique = children.filter(c => {
                const code = c.attributes.goods_nomenclature_item_id;
                if (seen.has(code)) return false;
                seen.add(code);
                return true;
            });

            let result;

            if (unique.length === 0) {
                result = [
                    `✅ Live TARIC confirmed: No 10-digit subdivisions exist for ${parent8}.`,
                    `The code **${parent8}00** is correct for StreamLiner (standard '00' rule applies).`,
                    `🔗 Verify: ${taricUrl}`
                ].join('\n');
            } else {
                result = `✅ Live TARIC — **${unique.length} real 10-digit subdivision(s)** found for ${parent8}:\n\n`;
                result += `| # | TARIC Code | Official Description |\n`;
                result += `|---|------------|---------------------|\n`;
                unique.forEach((item, i) => {
                    const code = item.attributes.goods_nomenclature_item_id;
                    const desc = (item.attributes.description || item.attributes.formatted_description || '').slice(0, 180);
                    result += `| ${i + 1} | **${code}** | ${desc} |\n`;
                });
                result += `\n⚠️ **IMPORTANT: These are the REAL 10-digit TARIC codes. Do NOT use the provisional '${parent8}00' code.**`;
                result += `\nPresent these options to the user and ask which best matches their product.`;
                result += `\n🔗 EU TARIC reference: ${taricUrl}`;
            }

            if (liveTaricCache.size >= LIVE_TARIC_CACHE_MAX) {
                liveTaricCache.delete(liveTaricCache.keys().next().value);
            }
            liveTaricCache.set(parent8, result);
            return result;

        } catch (err) {
            console.error(`Live TARIC fetch error for ${parent8}:`, err.message);
            return `⚠️ Could not query live TARIC (${err.message}). Verify manually: ${taricUrl}`;
        }
    }
});
