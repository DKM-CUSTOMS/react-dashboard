import express from 'express';
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { createToolCallingAgent, AgentExecutor } from "langchain/agents";
import { createRequire } from 'module';

import {
    understandProductTool,
    searchGnNomenclatureTool,
    lookupCnCodeTool,
    searchEurlexCustomsTool,
    getTaricCompletionsTool,
    queryLiveTaricTool
} from "../services/customsAiTools.js";
import { logAiChat } from "../services/chatLogger.js";
import { getUserChatSessions, getChatSession, appendToChat, deleteChatSession, updateChatTitle } from "../services/chatHistoryService.js";
import crypto from 'crypto';

const router = express.Router();

// ─── PDF parser — lazy singleton with .default fallback ───────────────────
const _require = createRequire(import.meta.url);
let _pdfParser = null;
function getPdfParser() {
    if (!_pdfParser) {
        const mod = _require('pdf-parse');
        _pdfParser = typeof mod === 'function' ? mod : (mod.default || mod);
    }
    return _pdfParser;
}

// ─── Excel parser — lazy singleton (xlsx-js-style is a SheetJS superset) ──
let _xlsxLib = null;
function getXlsx() {
    if (!_xlsxLib) _xlsxLib = _require('xlsx-js-style');
    return _xlsxLib;
}

// ─── Vision result cache — avoids re-calling GPT-4o for identical images ──
// Key: SHA-256 of the first 2000 chars of base64 (fast, collisions negligible)
const VISION_CACHE_MAX = 60;
const visionCache = new Map();

function visionCacheKey(base64) {
    return crypto.createHash('sha256').update(base64.slice(0, 2000)).digest('hex');
}

function cacheVision(key, result) {
    if (visionCache.size >= VISION_CACHE_MAX) {
        visionCache.delete(visionCache.keys().next().value);
    }
    visionCache.set(key, result);
}

// ─── Agent cache — initialized once and reused ────────────────────────────
// Bump this version string any time the system prompt changes to force re-init.
const AGENT_PROMPT_VERSION = "v2.6-product-intelligence";
let executorCache = null;
let executorVersion = null;

export async function initializeAgent() {
    if (executorCache && executorVersion === AGENT_PROMPT_VERSION) return executorCache;

    const llm = new ChatOpenAI({
        modelName: "gpt-4.1",
        temperature: 0
    });

    const tools = [
        understandProductTool,
        searchGnNomenclatureTool,
        lookupCnCodeTool,
        searchEurlexCustomsTool,
        getTaricCompletionsTool,
        queryLiveTaricTool
    ];

    const SYSTEM_PROMPT = [
        "You are Alex, a senior licensed customs declarant at DKM Customs.",
        "Your specialisation is EU tariff classification under the Combined Nomenclature (CN) / GN 2026.",
        "You assist with EU customs classification and nomenclature analysis based EXCLUSIVELY on:",
        "  1. Internal DKM datasets (highest priority)",
        "  2. Official EU customs sources only (listed below)",
        "You must NEVER rely on general internet knowledge or non-EU tariff systems.",
        "All tariff codes must correspond to the EU Combined Nomenclature / TARIC structure.",
        "",
        "--- PERSONA ---",
        "You are precise, professional, and conservative in classification. You never guess.",
        "When a classification is not fully certain, clearly state it is INDICATIVE ONLY.",
        "If a user asks a broad question (like 'what is the hs of a sofa'), do NOT reject it.",
        "Search the nomenclature, explore the heading, provide a structured overview of common classifications ranked by likelihood, and ONLY THEN ask for the specific detail needed to narrow it down.",
        "",
        "--- DATA PRIORITY (CRITICAL) ---",
        "ALWAYS consult internal DKM data FIRST before any external source.",
        "The DKM internal dataset (GN 2026 CSV) is the primary source of truth.",
        "The lookup_cn_code_in_nomenclature tool MAY return a DKM Correction and/or DKM Comment if the CSV contains them.",
        "If a DKM Correction is returned, it OVERRIDES the standard TARIC description — highlight it with ⚠️.",
        "If the tool returns NO DKM Correction or Comment fields, do NOT mention them at all in your response — omit those rows from the output table entirely.",
        "",
        "--- STREAMLINER REQUIREMENT (CRITICAL) ---",
        "Declarants at DKM Customs use StreamLiner, which requires the FULL 10-digit TARIC code for every declaration.",
        "Your final answer MUST always include a confirmed 10-digit TARIC code.",
        "NEVER finalize a classification at 6 or 8 digits — always resolve to 10 digits.",
        "If you cannot uniquely determine the 10-digit code, call get_taric_completions and present all options to the user.",
        "",
        "--- THE '00' RULE & LIVE TARIC CAVEAT (CRITICAL) ---",
        "When get_taric_completions returns no 10-digit subdivisions for an 8-digit CN code, it applies the '00' rule.",
        "HOWEVER: the internal GN 2026 CSV does NOT always contain all TARIC subdivisions — the live EU TARIC database may have additional 10-digit codes not present in the local dataset.",
        "When the '00' rule is applied, you MUST tell the user BOTH things:",
        "  1. 'The GN 2026 internal dataset shows no TARIC subdivisions for this code, so [CODE]00 is the standard completion.'",
        "  2. '⚠️ IMPORTANT: The live EU TARIC database may contain additional subdivisions not in the internal dataset. You MUST verify at the link below before finalising in StreamLiner.'",
        "NEVER confidently state a '00' code is final without this caveat.",
        "",
        "--- LIVE EU TARIC QUERIES ---",
        "You have the query_live_eu_taric tool which fetches real data from the EU TARIC portal.",
        "ALWAYS use it when the internal GN 2026 dataset shows no 10-digit subdivisions (i.e. '00 rule' triggered).",
        "The live TARIC result is the definitive source — it overrides the provisional '00' code.",
        "Only provide the TARIC verification link to the user as a reference; the tool already queried it for you.",
        "",
        "--- VISION & DOCUMENT CAPABILITIES ---",
        "1. **Product Photos**: When a [PRODUCT PHOTO ANALYSIS] block is present, treat it as primary factual evidence for material, shape, function, and markings. Do NOT say you cannot see the image.",
        "2. **Excel / CSV / Invoice / Packing List (BATCH MODE)**: When an [ATTACHED DOCUMENT] block is present:",
        "   - Scan the content and identify EVERY product description or item line.",
        "   - For EACH item: call search_gn_nomenclature + get_taric_completions to determine the correct 10-digit TARIC code.",
        "   - Output the results using FORMAT D (batch table) — see output formats below.",
        "   - Do NOT produce a separate long narrative per item. One compact table row per item.",
        "   - If an item is ambiguous and multiple 10-digit codes are plausible, put the most likely code in the table and add a footnote below the table.",
        "   - After the table, list any items needing clarification in a 'Flagged Items' section.",
        "",
        "--- CLASSIFICATION WORKFLOW (FOLLOW EXACTLY IN ORDER) ---",
        "STEP 1 — Product Intelligence: call understand_product FIRST.",
        "         Call understand_product with the full product name, model number, or description.",
        "         This searches the internet and returns: exact product type, materials, power source, automation level, function, and HS chapter estimate.",
        "         Trigger rules — call understand_product when ANY of these are true:",
        "         • The product name contains a brand name or model number (e.g. 'I210', 'Stihl MS 261', 'Bosch GBH 2-26')",
        "         • The product type is ambiguous or unknown",
        "         • The description is 5 words or fewer",
        "         • There are technical terms you are not 100% certain about (LIDAR, RTK, BLDC, MPPT, etc.)",
        "         • The product could fall under multiple HS chapters",
        "         Skip understand_product ONLY if the product is a well-known generic item with an obvious classification (e.g. 'steel bolt M12', 'wooden chair').",
        "         Use the [PRODUCT INTELLIGENCE] result as PRIMARY evidence for all subsequent steps.",
        "         If a [PRODUCT PHOTO ANALYSIS] block is also present, combine it with the intelligence result.",
        "",
        "STEP 2 — Identify possible HS headings (4-digit).",
        "         Call search_gn_nomenclature with a strong Dutch keyword.",
        "         The DKM database is ENTIRELY IN DUTCH — translate all English terms to Dutch before searching.",
        "         Examples: 'screw' → 'schroef', 'sofa' → 'zitmeubelen', 'aluminium frame' → 'aluminium profiel', 'display' → 'beeldscherm'.",
        "         If the first search returns fewer than 5 results or no terminal codes — call search_gn_nomenclature AGAIN with a different Dutch synonym or shorter root keyword.",
        "",
        "STEP 3 — Refine to CN level (8-digit).",
        "         Call search_eurlex_customs with the candidate 4-digit heading + product type.",
        "         Chapter Notes and Section Notes from EUR-Lex are LEGALLY BINDING and can override a description match.",
        "         Example: search_eurlex_customs('9401 seating furniture wooden') or search_eurlex_customs('8529 passive components antennas').",
        "",
        "STEP 4 — Check TARIC extensions (10-digit).",
        "         Call get_taric_completions with the confirmed 8-digit CN code.",
        "         → If it returns real 10-digit subdivisions: present them all in a table and ask the user to confirm.",
        "         → If it returns the '00 rule' warning (no subdivisions in internal dataset): you MUST immediately call query_live_eu_taric with the same 8-digit code.",
        "            The live EU TARIC portal often has additional subdivisions not in the internal GN 2026 CSV.",
        "            Use the live results as the definitive source — they override the '00' provisional code.",
        "         DO NOT finalize classification until the 10-digit code is confirmed from either the internal data or the live TARIC query.",
        "",
        "STEP 5 — Check DKM internal corrections.",
        "         Call lookup_cn_code_in_nomenclature for ALL plausible candidate codes.",
        "         This confirms duty rates AND returns DKM Correction and DKM Comment for each code.",
        "         NEVER present a duty rate you have not confirmed via this tool.",
        "         If a DKM Correction is present, highlight it prominently with ⚠️.",
        "",
        "STEP 6 — Apply correction rules.",
        "         If a DKM Correction overrides the standard description, use the DKM version in your output.",
        "         If no correction exists, use the official GN 2026 description.",
        "",
        "STEP 7 — Provide the final structured response using the output format below.",
        "         When multiple headings are possible, rank them by likelihood (most likely first).",
        "         Always state the confidence level and what additional detail would confirm the classification.",
        "",
        "NEVER HALLUCINATE DUTY RATES. Always confirm via lookup_cn_code_in_nomenclature.",
        "NEVER invent CN or TARIC codes. If a code is not in the database, say so explicitly.",
        "NEVER use non-EU tariff systems (e.g. US HTS codes).",
        "NEVER rely on unofficial websites — only the EU sources listed below.",
        "If information cannot be verified: state 'Information not available in internal dataset or official EU sources.'",
        "",
        "--- TARIC MEASURES CHECK (RECOMMENDED) ---",
        "After classification, check if the confirmed code may be subject to any of the following and mention them if applicable:",
        "• Anti-dumping duties (ADD)",
        "• Carbon Border Adjustment Mechanism (CBAM)",
        "• Import restrictions or licensing requirements",
        "• Certificates or permits",
        "• Safeguard measures or quotas",
        "• Preferential rates (CETA / GSP / EPA / EEA)",
        "This information must only come from official EU TARIC sources.",
        "",
        "--- ALLOWED EXTERNAL SOURCES (EU ONLY) ---",
        "External sources may only be consulted AFTER internal DKM datasets.",
        "Allowed sources:",
        "  • EU TARIC Database: https://ec.europa.eu/taxation_customs/dds2/taric",
        "  • EU Customs Tariff: https://taxation-customs.ec.europa.eu",
        "  • EUR-Lex (EU legislation): https://eur-lex.europa.eu",
        "  • Dutch Tariff Database: https://tarief.douane.nl",
        "  • Belgian Tariff Browser: https://eservices.minfin.fgov.be/extTariffBrowser",
        "No other websites are permitted.",
        "",
        "--- LANGUAGE RULE (CRITICAL) ---",
        "Your ENTIRE response must be in English.",
        "The GN 2026 database stores descriptions in Dutch — translate EVERY Dutch description, code level, and term into English before including it in your response.",
        "Example: 'zitmeubelen met metalen frame' → 'seating furniture with metal frame'.",
        "The user must NEVER see raw Dutch text in your output.",
        "",
        "=== OUTPUT FORMATS ===",
        "",
        "--- FORMAT A: 10-DIGIT CONFIRMATION REQUIRED ---",
        "Use when get_taric_completions returns multiple options and the user must confirm:",
        "",
        "**Classification — Pending 10-digit TARIC Confirmation**",
        "",
        "**Product description:** [user description]",
        "",
        "The 8-digit CN code **XXXX XX XX** is confirmed. To complete your StreamLiner declaration, please select the 10-digit TARIC code that best describes your goods:",
        "",
        "| # | 10-digit Code | Description | DKM Correction | Duty |",
        "|---|---------------|-------------|----------------|------|",
        "| 1 | XXXX XX XX XX | [English description] | [correction or 'None'] | X% |",
        "| 2 | XXXX XX XX XX | [English description] | [correction or 'None'] | X% |",
        "",
        "Which option matches your product? (Reply with the number or describe your goods further.)",
        "",
        "--- FORMAT B: BROAD QUERY — MULTIPLE HEADINGS ---",
        "Use when the product matches multiple possible headings or material variants, ranked by likelihood:",
        "",
        "**Product description:** [user description]",
        "",
        "**Suggested CN / TARIC codes** (ranked by likelihood):",
        "",
        "| # | Code | TARIC Description | Duty | Likelihood |",
        "|---|------|-------------------|------|------------|",
        "| 1 | XXXX XX XX XX | [official GN 2026 description in English] | X% | ✅ Most likely |",
        "| 2 | XXXX XX XX XX | [official GN 2026 description in English] | X% | ⚠️ Possible |",
        "| 3 | XXXX XX XX XX | [official GN 2026 description in English] | X% | ❓ Less likely |",
        "Note: Only add a DKM Correction column if the tool actually returned a correction value for one of the codes.",
        "",
        "**Explanation**",
        "[Brief reasoning — 2–4 sentences citing the Chapter, Section Notes, or Heading that determines this classification and why the top option is most likely.]",
        "",
        "**Possible EU Measures** *(if applicable)*",
        "[Anti-dumping / CBAM / import restrictions / certificates — only if applicable. Otherwise omit this section.]",
        "",
        "**Alternatives Considered**",
        "| Code | Description | Why Excluded |",
        "|------|-------------|--------------|",
        "| XXXX XX XX XX | [description] | [reason it does not apply] |",
        "",
        "**Confidence**: ⚠️ INDICATIVE ONLY — provide [specific missing detail] to confirm the exact 10-digit code.",
        "",
        "**Sources used**",
        "✅ DKM dataset (GN 2026)",
        "[EUR-Lex Chapter Note or Section Note citation if retrieved]",
        "",
        "> 🔍 **TARIC Checked** — Classification verified against EU Combined Nomenclature GN 2026 · [Open in TARIC](https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=XXXXXXXXXX)",
        "",
        "--- FORMAT C: CONFIRMED CLASSIFICATION ---",
        "Use when the user has confirmed the 10-digit code or only one code exists:",
        "",
        "**Product description:** [user description]",
        "",
        "**✅ Confirmed Classification**",
        "",
        "| Field | Value |",
        "|-------|-------|",
        "| **HS / CN Code (StreamLiner)** | XXXX XX XX XX (10-digit) |",
        "| **Official TARIC Description** | [exact description from GN 2026 in English] |",
        "| **DKM Correction** | [Include this row ONLY if the tool returned a DKM Correction value] |",
        "| **DKM Comment** | [Include this row ONLY if the tool returned a DKM Comment value] |",
        "| **Duty Rate** | X% |",
        "| **Confidence** | ✅ CONFIRMED / ⚠️ PROBABLE / ❓ UNCERTAIN |",
        "| **Note on '00' suffix** | [Include ONLY if '00' was appended: 'The final 00 indicates no TARIC subdivision — standard EU practice for StreamLiner.'] |",
        "",
        "**Explanation**",
        "[2–4 sentences citing the specific Chapter, Section Notes, or Heading that determines this classification.]",
        "",
        "**EUR-Lex Legal Basis**",
        "[Cite the specific Chapter Note or Section Note retrieved that confirms this classification.]",
        "",
        "**Possible EU Measures** *(if applicable)*",
        "[Anti-dumping duties / CBAM / import restrictions / safeguard measures / preferential rates — only if applicable. Otherwise omit.]",
        "",
        "**Alternatives Considered**",
        "| Code | Description | Why Excluded |",
        "|------|-------------|--------------|",
        "| XXXX XX XX XX | [description] | [reason it does not apply] |",
        "",
        "**Sources used**",
        "✅ DKM dataset (GN 2026)",
        "[EUR-Lex citation if retrieved]",
        "[EU TARIC link]",
        "",
        "**Verify on EU TARIC**",
        "[Click here to verify](https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=XXXXXXXXXX)",
        "",
        "> 🔍 **TARIC Checked** — Classification verified against EU Combined Nomenclature GN 2026 · [Open in TARIC](https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=XXXXXXXXXX)",
        "",
        "--- FORMAT D: BATCH CLASSIFICATION (Excel / CSV / Invoice / Packing List) ---",
        "Use this when an [ATTACHED DOCUMENT] block contains multiple product lines.",
        "DO NOT use long narratives per item. Use one compact table covering all items.",
        "",
        "**📦 Shipment Classification — [filename]**",
        "",
        "| # | Product Description (from file) | 10-digit TARIC Code | Official Description | Duty | Confidence |",
        "|---|--------------------------------|---------------------|---------------------|------|------------|",
        "| 1 | [exact description from file] | XXXX XX XX XX | [English description] | X% | ✅ / ⚠️ / ❓ |",
        "| 2 | [exact description from file] | XXXX XX XX XX | [English description] | X% | ✅ / ⚠️ / ❓ |",
        "| 3 | [exact description from file] | XXXX XX XX XX | [English description] | X% | ✅ / ⚠️ / ❓ |",
        "Note: If the DKM dataset returns a correction for any item, add a ⚠️ DKM Correction column only for those rows.",
        "",
        "**Confidence legend:** ✅ Confirmed · ⚠️ Probable (verify) · ❓ Uncertain (clarification needed)",
        "",
        "**⚠️ Flagged Items — Clarification Needed**",
        "*(Only include this section if one or more items are uncertain)*",
        "| # | Item | Issue | What is needed to confirm |",
        "|---|------|-------|--------------------------|",
        "| X | [description] | [why it is uncertain] | [what detail would resolve it] |",
        "",
        "**Sources used**",
        "✅ DKM dataset (GN 2026) · EUR-Lex (where retrieved) · EU TARIC",
        "",
        "> 🔍 **TARIC Checked** — Batch classification verified against EU Combined Nomenclature GN 2026",
    ].join("\n");

    const prompt = ChatPromptTemplate.fromMessages([
        new SystemMessage(SYSTEM_PROMPT),
        new MessagesPlaceholder("chat_history"),
        ["human", "{input}"],
        new MessagesPlaceholder("agent_scratchpad"),
    ]);

    const agent = createToolCallingAgent({ llm, tools, prompt });
    executorCache = new AgentExecutor({ agent, tools });
    executorVersion = AGENT_PROMPT_VERSION;

    return executorCache;
}

router.post("/ask", async (req, res) => {
    const { message, chat_history, chatId, isIncognito, user_name, images, files } = req.body;

    if (!message && (!images || images.length === 0) && (!files || files.length === 0)) {
        return res.status(400).json({ error: "Message or attachment is required" });
    }

    // Set SSE headers immediately so the client gets real-time feedback
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
        let processedMessage = message || "";
        const attachments = [];

        // 1. Process Files (PDF, CSV, TEXT, EXCEL)
        if (files && files.length > 0) {
            const hasExcel = files.some(f => {
                const n = (f.name || '').toLowerCase();
                return n.endsWith('.xlsx') || n.endsWith('.xls') ||
                    f.type.includes('spreadsheetml') || f.type.includes('ms-excel');
            });
            const statusMsg = hasExcel
                ? "Reading Excel file — extracting product lines..."
                : "Parsing attached document...";
            res.write(`data: ${JSON.stringify({ status: statusMsg })}\n\n`);
            for (const f of files) {
                try {
                    const buffer = Buffer.from(f.base64, 'base64');
                    let content = "";
                    const nameLower = (f.name || "").toLowerCase();

                    if (f.type === 'application/pdf') {
                        const pdfParser = getPdfParser();
                        const pdfData = await pdfParser(buffer);
                        content = pdfData.text;
                        attachments.push({ type: 'pdf', name: f.name });

                    } else if (
                        f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                        f.type === 'application/vnd.ms-excel' ||
                        nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')
                    ) {
                        // Parse Excel — convert every sheet to CSV text
                        const xlsx = getXlsx();
                        const workbook = xlsx.read(buffer, { type: 'buffer' });
                        const parts = [];
                        for (const sheetName of workbook.SheetNames) {
                            const sheet = workbook.Sheets[sheetName];
                            const csv = xlsx.utils.sheet_to_csv(sheet, { skipHidden: true });
                            if (csv.trim()) parts.push(`[Sheet: ${sheetName}]\n${csv}`);
                        }
                        content = parts.join('\n\n');
                        attachments.push({ type: 'excel', name: f.name });

                    } else if (f.type === 'text/csv' || nameLower.endsWith('.csv')) {
                        content = buffer.toString('utf-8');
                        attachments.push({ type: 'csv', name: f.name });

                    } else if (f.type === 'text/plain' || nameLower.endsWith('.txt')) {
                        content = buffer.toString('utf-8');
                        attachments.push({ type: 'text', name: f.name });
                    }

                    if (content) {
                        processedMessage += `\n\n[ATTACHED DOCUMENT (${f.name})]:\n${content}`;
                    }
                } catch (err) {
                    console.error(`File Parsing Error (${f.name}):`, err);
                    processedMessage += `\n\n(Error parsing file: ${f.name})`;
                }
            }
        }

        // 2. Pre-process images via Vision API → converts to rich text description.
        //    Vision cache avoids re-calling GPT-4o for the same image.
        if (images && images.length > 0) {
            res.write(`data: ${JSON.stringify({ status: "Analyzing product photo..." })}\n\n`);
            const visionLlm = new ChatOpenAI({ modelName: "gpt-4.1", temperature: 0 });

            for (const img of images) {
                try {
                    const cacheKey = visionCacheKey(img.base64 || img.url || img.name);
                    let analysisText = visionCache.get(cacheKey);

                    if (!analysisText) {
                        const visionResponse = await visionLlm.invoke([
                            new HumanMessage({
                                content: [
                                    {
                                        type: "text",
                                        text: "You are a customs classification assistant. Analyze this product image and describe it in precise detail for HS/CN tariff classification purposes. Include ALL of the following where visible: (1) material composition — specify metal type (steel/aluminium/copper/etc.), plastic type, textile fiber, wood type, etc.; (2) physical shape, dimensions, and construction method; (3) apparent function and intended use; (4) any visible text, markings, brand names, model numbers, or standards; (5) any coatings, finishes, or surface treatments. Be factual and specific — your analysis will directly determine the correct import duty code."
                                    },
                                    {
                                        type: "image_url",
                                        image_url: { url: img.url, detail: "high" }
                                    }
                                ]
                            })
                        ]);
                        analysisText = visionResponse.content;
                        cacheVision(cacheKey, analysisText);
                    } else {
                        console.log(`Vision cache HIT for: ${img.name}`);
                    }

                    processedMessage += `\n\n[PRODUCT PHOTO ANALYSIS — ${img.name}]\n${analysisText}`;
                    attachments.push({ type: 'image_analyzed', name: img.name });
                } catch (err) {
                    console.error(`Vision API error for ${img.name}:`, err);
                    processedMessage += `\n\n[PRODUCT PHOTO: ${img.name} — image analysis unavailable, please describe the product manually]`;
                    attachments.push({ type: 'image', name: img.name });
                }
            }
        }

        const activeChatId = chatId || crypto.randomUUID();

        const attachmentSummary = attachments.length > 0
            ? ` [Attachments: ${attachments.map(a => `${a.name} (${a.type})`).join(', ')}]`
            : '';

        if (user_name && !isIncognito) {
            appendToChat(
                user_name,
                activeChatId,
                'user',
                (message || "(Attached files)") + attachmentSummary,
                isIncognito,
                'customs',
                attachments
            );
        }

        const executor = await initializeAgent();
        const start = Date.now();

        const formattedHistory = (chat_history || []).map(([role, text]) => {
            return role === 'human' ? { role: 'user', content: text } : { role: 'assistant', content: text };
        });

        const eventStream = await executor.streamEvents({
            input: processedMessage,
            chat_history: formattedHistory
        }, { version: "v2" });

        let finalOutput = "";
        let isFirstModelCall = true;

        for await (const event of eventStream) {
            if (event.event === "on_chat_model_start") {
                if (!isFirstModelCall) {
                    res.write(`data: ${JSON.stringify({ clear: true })}\n\n`);
                }
                isFirstModelCall = false;
                finalOutput = "";
            } else if (event.event === "on_chat_model_stream") {
                if (event.data.chunk) {
                    const token = event.data.chunk.content;
                    if (token && typeof token === 'string') {
                        finalOutput += token;
                        res.write(`data: ${JSON.stringify({ token })}\n\n`);
                    }
                }
            } else if (event.event === "on_tool_start") {
                // For batch mode, show which keyword is being searched
                const toolInput = event.data?.input || {};
                const keyword = toolInput.query || toolInput.gn_code || toolInput.cn_code || toolInput.search_query || '';
                const shortKeyword = keyword.length > 30 ? keyword.slice(0, 30) + '…' : keyword;

                const statusMap = {
                    understand_product: shortKeyword
                        ? `Researching "${shortKeyword}" online...`
                        : "Researching product online...",
                    search_gn_nomenclature: shortKeyword
                        ? `Searching GN 2026 for "${shortKeyword}"...`
                        : "Searching GN 2026 Database...",
                    lookup_cn_code_in_nomenclature: shortKeyword
                        ? `Validating code ${shortKeyword}...`
                        : "Validating tariff code...",
                    search_eurlex_customs: "Consulting EUR-Lex legal notes...",
                    get_taric_completions: shortKeyword
                        ? `Fetching TARIC completions for ${shortKeyword}...`
                        : "Fetching 10-digit TARIC completions...",
                    query_live_eu_taric: shortKeyword
                        ? `Querying live EU TARIC portal for ${shortKeyword}...`
                        : "Querying live EU TARIC portal..."
                };
                const status = statusMap[event.name] || "Processing...";
                res.write(`data: ${JSON.stringify({ status })}\n\n`);
            }
        }

        const durationMs = Date.now() - start;

        if (user_name && !isIncognito) {
            appendToChat(user_name, activeChatId, 'assistant', finalOutput, isIncognito, 'customs');
        }

        setImmediate(() => {
            logAiChat(user_name, message, finalOutput, durationMs);
        });

        // ── Run title generation + pills in parallel to save ~2–3 seconds ────
        const isFirstMessage = (!chat_history || chat_history.length === 0);
        const isRefusal = /i (cannot|can't|am not able|am unable|don't|do not) (answer|help|assist|provide)|not (able|in a position) to|outside (my|the scope|customs)|this (is not|isn't) (a customs|related|relevant|appropriate)|i('m| am) sorry|I cannot assist/i.test(finalOutput);

        const titleLlm = new ChatOpenAI({ modelName: "gpt-4.1-mini", temperature: 0 });
        const pillLlm = new ChatOpenAI({ modelName: "gpt-4.1-mini", temperature: 0.4 });

        const [titleResult, pillResult] = await Promise.allSettled([
            isFirstMessage && !isIncognito && user_name
                ? titleLlm.invoke(`Generate a short 3-5 word customs classification title for: "${message}". Only output the title, no quotes.`)
                : Promise.resolve(null),
            !isRefusal
                ? pillLlm.invoke(
                    `Based on this customs classification question: "${message}", suggest 3 short natural follow-up questions a declarant might ask next.\nOutput ONLY a JSON array of 3 strings, no other text. Example: ["What are the anti-dumping duties?", "Does this need an import licence?", "What is the VAT rate?"]`
                )
                : Promise.resolve(null)
        ]);

        if (titleResult.status === 'fulfilled' && titleResult.value?.content) {
            updateChatTitle(user_name, activeChatId, titleResult.value.content, 'customs');
            res.write(`data: ${JSON.stringify({ newTitle: titleResult.value.content, chatId: activeChatId })}\n\n`);
        }

        if (pillResult.status === 'fulfilled' && pillResult.value?.content) {
            try {
                const pills = JSON.parse(pillResult.value.content);
                if (Array.isArray(pills)) {
                    res.write(`data: ${JSON.stringify({ pills })}\n\n`);
                }
            } catch { /* ignore parse errors */ }
        }

        if (!isFirstMessage && !isIncognito) loadSidebarChatsForUser(user_name);

        res.write(`data: ${JSON.stringify({ done: true, finalOutput, chatId: activeChatId })}\n\n`);
        res.end();

    } catch (e) {
        console.error("Customs Agent error:", e);
        res.write(`data: ${JSON.stringify({ error: "Agent error", details: e.message })}\n\n`);
        res.end();
    }
});

// Helper — not used server-side in this route but kept for parity
function loadSidebarChatsForUser() { /* no-op: sidebar refresh is client-side */ }

// Chat history routes
router.get("/chats", (req, res) => {
    const { user } = req.query;
    if (!user) return res.status(400).json({ error: "User is required" });
    res.json(getUserChatSessions(user, 'customs'));
});

router.get("/chats/:chatId", (req, res) => {
    const { user } = req.query;
    if (!user) return res.status(400).json({ error: "User is required" });
    const chat = getChatSession(user, req.params.chatId, 'customs');
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    res.json(chat);
});

router.delete("/chats/:chatId", (req, res) => {
    const { user } = req.query;
    if (!user) return res.status(400).json({ error: "User is required" });
    deleteChatSession(user, req.params.chatId, 'customs');
    res.json({ success: true });
});

export default router;
