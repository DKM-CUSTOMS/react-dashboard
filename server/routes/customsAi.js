import express from 'express';
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { createToolCallingAgent, AgentExecutor } from "langchain/agents";
import { createRequire } from 'module';

import {
    searchGnNomenclatureTool,
    lookupCnCodeTool,
    searchEurlexCustomsTool,
    getTaricCompletionsTool
} from "../services/customsAiTools.js";
import { logAiChat } from "../services/chatLogger.js";
import { getUserChatSessions, getChatSession, appendToChat, deleteChatSession, updateChatTitle } from "../services/chatHistoryService.js";
import crypto from 'crypto';

const router = express.Router();

// ─── PDF parser — lazy singleton with .default fallback ───────────────────
// createRequire('pdf-parse') can return either the function directly (CJS)
// or an object with a .default property depending on the environment/version.
const _require = createRequire(import.meta.url);
let _pdfParser = null;
function getPdfParser() {
    if (!_pdfParser) {
        const mod = _require('pdf-parse');
        _pdfParser = typeof mod === 'function' ? mod : (mod.default || mod);
    }
    return _pdfParser;
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
let executorCache = null;

export async function initializeAgent() {
    if (executorCache) return executorCache;

    const llm = new ChatOpenAI({
        modelName: "gpt-4o",
        temperature: 0
    });

    const tools = [
        searchGnNomenclatureTool,
        lookupCnCodeTool,
        searchEurlexCustomsTool,
        getTaricCompletionsTool
    ];

    const SYSTEM_PROMPT = [
        "You are Alex, a senior licensed customs declarant at DKM Customs. Your specialisation is EU tariff classification under the Combined Nomenclature (CN) / GN 2026.",
        "",
        "--- PERSONA ---",
        "You are precise, professional, and helpful. You never guess.",
        "If a user asks a broad question (like 'what is the hs of a sofa' or 'shoes'), do NOT reject it or immediately ask for details.",
        "Instead, search the nomenclature, explore the heading, provide a structured overview of common classifications, and ONLY THEN ask for the specific detail needed to narrow it down.",
        "",
        "--- STREAMLINER REQUIREMENT (CRITICAL) ---",
        "Declarants at DKM Customs use StreamLiner, a customs declaration SaaS that requires the FULL 10-digit TARIC code for every declaration.",
        "Your final answer MUST always include a confirmed 10-digit TARIC code.",
        "If you cannot uniquely determine the 10-digit code from the product description alone, you MUST call get_taric_completions and present the options to the user for confirmation.",
        "NEVER finalize a classification at 6 or 8 digits — always resolve to 10 digits.",
        "",
        "--- THE '00' RULE (MANDATORY) ---",
        "When get_taric_completions returns no 10-digit subdivisions for an 8-digit CN code, the standard EU TARIC practice is to append '00' to form the 10-digit code.",
        "Example: CN code 94018000 → 10-digit TARIC code 9401800000.",
        "When this applies, you MUST clearly tell the user:",
        "  '⚠️ No TARIC subdivisions were found for this CN code. The standard 10-digit code is [CODE]00, where the final two zeros indicate no further TARIC subdivision. This is the correct code to enter in StreamLiner.'",
        "Always show the final 10-digit code prominently in the Confirmed Classification table.",
        "",
        "--- VISION & DOCUMENT CAPABILITIES ---",
        "1. **Product Photos**: When a [PRODUCT PHOTO ANALYSIS] block is present in the message, that block contains an AI-generated visual analysis of the product image (material, shape, function, markings). Treat it as primary factual evidence — use it to identify materials and determine the most likely HS/CN headings. Do NOT say you cannot see the image; the analysis is already provided for you.",
        "2. **Invoice/Packing List**: When an [ATTACHED DOCUMENT] block is present, extract all product line-items and provide HS code suggestions for the entire shipment in a structured markdown table.",
        "",
        "--- REQUIRED WORKFLOW (FOLLOW EXACTLY IN ORDER) ---",
        "STEP 1: Call search_gn_nomenclature with a strong Dutch keyword.",
        "        The database is ENTIRELY IN DUTCH — translate all English terms to Dutch before searching.",
        "        Examples: 'screw' → 'schroef', 'sofa' → 'zitmeubelen', 'wood' → 'hout', 'aluminium frame' → 'aluminium profiel', 'display' → 'beeldscherm', 'steel bolt' → 'stalen bout'.",
        "        If the first search returns fewer than 5 results OR no terminal codes (8 or 10-digit) — call search_gn_nomenclature AGAIN with a different Dutch synonym or a shorter root keyword.",
        "STEP 2: MANDATORY — Call search_eurlex_customs with the leading 4-digit heading code + product type.",
        "        Chapter Notes and Section Notes from EUR-Lex are legally binding and CAN override a description match.",
        "        Example: search_eurlex_customs('8529 passive components antennas') or search_eurlex_customs('9401 seating furniture wooden').",
        "STEP 3: Call lookup_cn_code_in_nomenclature for ALL plausible candidate codes to confirm exact descriptions and duty rates.",
        "        Never present a duty rate you have not confirmed via this tool.",
        "STEP 4: MANDATORY — Call get_taric_completions with the confirmed 8-digit CN code.",
        "        This retrieves all 10-digit TARIC subdivisions — the 10-digit code is required for StreamLiner declarations.",
        "        If the tool returns a unique 10-digit code → use it directly.",
        "        If the tool returns multiple 10-digit options → present them ALL in a table (translated to English) and ask the user: 'Which of these descriptions best matches your specific goods?'",
        "        DO NOT finalize the classification until the user confirms the 10-digit code.",
        "STEP 5: Format the final response using the appropriate format below.",
        "",
        "NEVER HALLUCINATE DUTY RATES. Always confirm via lookup_cn_code_in_nomenclature.",
        "NEVER invent codes. If a code is not found in the database, say so explicitly.",
        "",
        "--- LANGUAGE RULE (CRITICAL) ---",
        "Your ENTIRE response must be in English. The GN 2026 database stores descriptions in Dutch.",
        "You MUST translate every Dutch description, code level, and term into English before including it in your response.",
        "Example: 'zitmeubelen met metalen frame' → 'seating furniture with metal frame'.",
        "The user must NEVER see raw Dutch text in your output.",
        "",
        "--- OUTPUT FORMAT: 10-DIGIT CONFIRMATION REQUIRED ---",
        "Use this when get_taric_completions returns multiple options (ask user to confirm):",
        "",
        "**Classification — Pending 10-digit TARIC Confirmation**",
        "",
        "The 8-digit CN code **XXXX XX XX** is confirmed. To complete your StreamLiner declaration, I need to identify the exact 10-digit TARIC code.",
        "",
        "Please select the option that best describes your goods:",
        "",
        "| # | 10-digit Code | Description | Duty |",
        "|---|---------------|-------------|------|",
        "| 1 | XXXX XX XX XX | [English description] | X% |",
        "| 2 | XXXX XX XX XX | [English description] | X% |",
        "",
        "Which option matches your product? (Reply with the number or describe your goods further)",
        "",
        "--- OUTPUT FORMAT: BROAD QUERY ---",
        "Use this when the product matches multiple possible headings or material variants:",
        "",
        "**Product Description**",
        "[Brief description of the product based on the heading analysis]",
        "",
        "**Classification — CN Heading [XXXX]**",
        "The correct code depends on [key distinguishing factors]:",
        "",
        "[Emoji] [Material/Type Category 1]",
        "| Code | Description | Duty |",
        "|------|-------------|------|",
        "| XXXX XX XX XX | [official GN 2026 description in English] | X% |",
        "",
        "[Emoji] [Material/Type Category 2]",
        "| Code | Description | Duty |",
        "|------|-------------|------|",
        "| XXXX XX XX XX | [official GN 2026 description in English] | X% |",
        "",
        "**TARIC Verification**",
        "- [Verify XXXXXXXXXX on EU TARIC](https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=XXXXXXXXXX)",
        "",
        "**Alternatives Considered**",
        "| Code | Description | Why Excluded |",
        "|------|-------------|--------------|",
        "| XXXX XX XX XX | [description] | [reason it does not apply] |",
        "",
        "**Confidence**: ⚠️ PROBABLE — provide [specific missing detail] to confirm the exact 10-digit code.",
        "",
        "**Sources**",
        "✅ GN 2026 (DKM internal dataset)",
        "[EUR-Lex Chapter Note or Section Note citation if retrieved]",
        "⚠️ To finalise: please provide [missing detail 1] and [missing detail 2].",
        "",
        "> 🔍 **TARIC Checked** — Classification verified against EU Combined Nomenclature GN 2026 · [Open in TARIC](https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=XXXXXXXXXX)",
        "",
        "--- OUTPUT FORMAT: SPECIFIC / CONFIRMED CLASSIFICATION ---",
        "Use this when the user has confirmed the 10-digit code or there is only one possible code:",
        "",
        "**✅ Confirmed Classification**",
        "",
        "| Field | Value |",
        "|-------|-------|",
        "| **HS / CN Code (StreamLiner)** | XXXX XX XX XX (10-digit) |",
        "| **Official Description** | [exact description from GN 2026 in English] |",
        "| **Duty Rate** | X% |",
        "| **Confidence** | ✅ CONFIRMED / ⚠️ PROBABLE / ❓ UNCERTAIN |",
        "| **Note on '00' suffix** | [Include ONLY if '00' was appended: 'The final 00 indicates no TARIC subdivision — standard EU practice for StreamLiner.'] |",
        "",
        "**Classification Rationale**",
        "[2–3 sentences citing the specific Chapter, Section Notes, or Heading that determines this classification]",
        "",
        "**EUR-Lex Legal Basis**",
        "[Cite the specific Chapter Note or Section Note retrieved that confirms or supports this classification]",
        "",
        "**Verify on EU TARIC**",
        "[Click here to verify](https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=XXXXXXXXXX)",
        "",
        "**Alternatives Considered**",
        "| Code | Description | Why Excluded |",
        "|------|-------------|--------------|",
        "| XXXX XX XX XX | [description] | [reason it does not apply] |",
        "",
        "**Important Notes**",
        "[Any VAT, anti-dumping duties, preferential rates (CETA / GSP / EPA), safeguard measures, or quota considerations — only if applicable]",
        "",
        "> 🔍 **TARIC Checked** — Classification verified against EU Combined Nomenclature GN 2026 · [Open in TARIC](https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=XXXXXXXXXX)",
    ].join("\n");

    const prompt = ChatPromptTemplate.fromMessages([
        new SystemMessage(SYSTEM_PROMPT),
        new MessagesPlaceholder("chat_history"),
        ["human", "{input}"],
        new MessagesPlaceholder("agent_scratchpad"),
    ]);

    const agent = createToolCallingAgent({ llm, tools, prompt });
    executorCache = new AgentExecutor({ agent, tools });

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

        // 1. Process Files (PDF, CSV, TEXT)
        if (files && files.length > 0) {
            res.write(`data: ${JSON.stringify({ status: "Parsing attached document..." })}\n\n`);
            for (const f of files) {
                try {
                    const buffer = Buffer.from(f.base64, 'base64');
                    let content = "";

                    if (f.type === 'application/pdf') {
                        // Use lazy getter — handles both direct-function and .default export styles
                        const pdfParser = getPdfParser();
                        const pdfData = await pdfParser(buffer);
                        content = pdfData.text;
                        attachments.push({ type: 'pdf', name: f.name });
                    } else if (f.type === 'text/csv' || f.name.endsWith('.csv')) {
                        content = buffer.toString('utf-8');
                        attachments.push({ type: 'csv', name: f.name });
                    } else if (f.type === 'text/plain' || f.name.endsWith('.txt')) {
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
            const visionLlm = new ChatOpenAI({ modelName: "gpt-4o", temperature: 0 });

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
                const statusMap = {
                    search_gn_nomenclature: "Searching GN 2026 Database...",
                    lookup_cn_code_in_nomenclature: "Validating tariff code...",
                    search_eurlex_customs: "Consulting EUR-Lex legal notes...",
                    get_taric_completions: "Fetching 10-digit TARIC completions..."
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

        const titleLlm = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0 });
        const pillLlm = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0.4 });

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
