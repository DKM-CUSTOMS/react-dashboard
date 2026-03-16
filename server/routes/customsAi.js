import express from 'express';
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { SystemMessage } from "@langchain/core/messages";
import { createToolCallingAgent, AgentExecutor } from "langchain/agents";

import {
    searchGnNomenclatureTool,
    lookupCnCodeTool,
    searchEurlexCustomsTool
} from "../services/customsAiTools.js";
import { logAiChat } from "../services/chatLogger.js";
import { getUserChatSessions, getChatSession, appendToChat, deleteChatSession, updateChatTitle } from "../services/chatHistoryService.js";
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const router = express.Router();

// In-memory agent cache — initialized once and reused
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
        searchEurlexCustomsTool
    ];

    const SYSTEM_PROMPT = [
        "You are Alex, a senior licensed customs declarant at DKM Customs. Your specialisation is EU tariff classification under the Combined Nomenclature (CN) / GN 2026.",
        "",
        "--- PERSONA ---",
        "You are precise, professional, and helpful. You never guess.",
        "Crucially, if a user asks a broad question (like 'what is the hs of a sofa' or 'shoes'), do NOT reject the request or immediately ask for details.",
        "Instead, search the nomenclature, explore the heading, provide a structured overview of the common classifications, and ONLY THEN ask the user for the specific details needed to narrow it down.",
        "",
        "--- VISION & DOCUMENT CAPABILITIES ---",
        "1. **Product Photos**: You can now see images of products. If a user uploads a photo, analyze the material, shape, and function. Use this visual evidence to suggest the most likely HS/CN headings.",
        "2. **Invoice/Packing List Parsing**: If a PDF or text document is attached, you will receive its contents. You should extract all relevant product line-items from the document and provide HS code suggestions for the entire shipment in a structured markdown table.",
        "",
        "--- OUTPUT FORMAT FOR BROAD QUERIES ---",
        "When providing an overview for a broad query, you MUST use this visually appealing markdown structure:",
        "",
        "**Product Description**",
        "[Brief description of the product based on the heading]",
        "",
        "**Classification — CN Heading [Heading Code]**",
        "The correct code depends on [factors like material, use, etc.]:",
        "",
        "🪵 [Category 1 (e.g., Wooden frame)]",
        "| Code | Description | Duty |",
        "|------|-------------|------|",
        "| ...  | ...         | ...  |",
        "",
        "🔩 [Category 2 (e.g., Metal frame)]",
        "| Code | Description | Duty |",
        "|------|-------------|------|",
        "| ...  | ...         | ...  |",
        "",
        "**TARIC (10-digit)**",
        "Provide a few standard 10-digit default options for the user.",
        "",
        "**Explanation**",
        "Briefly explain the heading subdivisions.",
        "",
        "**Sources used**",
        "✅ DKM internal dataset (GN_nomenclatuur_2026)",
        "ℹ️ Verification: EU TARIC",
        "⚠️ To confirm the exact code, please provide [missing detail 1] and [missing detail 2].",
        "",
        "--- OUTPUT FORMAT FOR SPECIFIC/FINALIZED QUERIES ---",
        "If you have enough detail to pinpoint an EXACT final classification, use this structure:",
        "1. **HS / CN Code**: The confirmed 10-digit code (e.g. 8529 90 96 00)",
        "2. **Official Description**: Exact description from the nomenclature.",
        "3. **Classification Rationale**: A brief 2-3 sentence explanation citing the relevant Chapters, Notes, or Headings.",
        "4. **Duty Rate**: The exact rate from the GN 2026 database.",
        "5. **Important Notes**: Any VAT, anti-dumping, or quota considerations if relevant.",
        "",
        "--- REQUIRED WORKFLOW (CRITICAL - FOLLOW IN ORDER) ---",
        "  STEP 1: Call search_gn_nomenclature. NOTE: The database terminology is entirely in DUTCH. You MUST translate English keywords into DUTCH before searching (e.g., 'sofa' -> 'zitmeubelen' or 'bank', 'wood' -> 'hout', 'apple' -> 'appelen'). Provide single, strong Dutch keywords for the best results.",
        "  STEP 2: Use lookup_cn_code_in_nomenclature to verify candidate codes, discover subcategories, and retrieve official duty rates.",
        "  STEP 3: Format the response appropriately as explained above.",
        "  STEP 4: If legal context is needed, call search_eurlex_customs.",
        "",
        "NEVER HALLUCINATE DUTY RATES. Always confirm via lookup_cn_code_in_nomenclature.",
        "NEVER invent codes. If a code is not found, say so explicitly."
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
    try {
        const { message, chat_history, chatId, isIncognito, user_name, images, files } = req.body;

        if (!message && (!images || images.length === 0) && (!files || files.length === 0)) {
            return res.status(400).json({ error: "Message or attachment is required" });
        }

        let processedMessage = message || "";
        const attachments = [];

        // 1. Process Files if any (PDF, CSV, TEXT)
        if (files && files.length > 0) {
            for (const f of files) {
                try {
                    const buffer = Buffer.from(f.base64, 'base64');
                    let content = "";
                    
                    if (f.type === 'application/pdf') {
                        const pdfData = await pdf(buffer);
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

        // 2. Prepare Vision Content if images exist
        let chatInput = processedMessage;
        if (images && images.length > 0) {
            chatInput = [
                { type: "text", text: processedMessage },
                ...images.map(img => ({
                    type: "image_url",
                    image_url: { url: img.url } // Assuming data URL from frontend
                }))
            ];
            images.forEach(img => attachments.push({ type: 'image', name: img.name || 'Image' }));
        }

        const activeChatId = chatId || crypto.randomUUID();

        // Persist user message
        if (user_name && !isIncognito) {
            appendToChat(user_name, activeChatId, 'user', message || "(Attached files)", isIncognito, 'customs', attachments);
        }

        const executor = await initializeAgent();

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const start = Date.now();

        // Build a proper LangChain chat_history array from client tuples
        const formattedHistory = (chat_history || []).map(([role, text]) => {
            return role === 'human' ? { role: 'user', content: text } : { role: 'assistant', content: text };
        });

        const eventStream = await executor.streamEvents({
            input: chatInput,
            chat_history: formattedHistory
        }, { version: "v2" });

        let finalOutput = "";
        let isFirstModelCall = true;

        for await (const event of eventStream) {
            if (event.event === "on_chat_model_start") {
                // Intermediate tool-use model calls can produce noise — only clear on the
                // FINAL response, which comes after tool calls are done
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
                const toolName = event.name;
                const statusMap = {
                    search_gn_nomenclature: "Searching GN 2026 Database...",
                    lookup_cn_code_in_nomenclature: "Validating tariff code...",
                    search_eurlex_customs: "Consulting EUR-Lex legal notes..."
                };
                const status = statusMap[toolName] || "Processing...";
                res.write(`data: ${JSON.stringify({ status })}\n\n`);
            }
        }

        const durationMs = Date.now() - start;

        // Persist assistant message
        if (user_name && !isIncognito) {
            appendToChat(user_name, activeChatId, 'assistant', finalOutput, isIncognito, 'customs');
        }

        // Log asynchronously
        setImmediate(() => {
            logAiChat(user_name, message, finalOutput, durationMs);
        });

        // Generate a chat title on first message
        if ((!chat_history || chat_history.length === 0) && !isIncognito && user_name) {
            try {
                const titleLlm = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0 });
                const titleReq = await titleLlm.invoke(
                    `Generate a short 3-5 word customs classification title for: "${message}". Only output the title, no quotes.`
                );
                if (titleReq?.content) {
                    updateChatTitle(user_name, activeChatId, titleReq.content, 'customs');
                    res.write(`data: ${JSON.stringify({ newTitle: titleReq.content, chatId: activeChatId })}\n\n`);
                }
            } catch (e) {
                console.error("Title generation error:", e.message);
            }
        }

        // Generate contextual follow-up pill suggestions
        try {
            const pillLlm = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0.4 });
            const pillReq = await pillLlm.invoke(
                `Based on this customs classification question: "${message}", suggest 3 short natural follow-up questions a declarant might ask next. 
Output ONLY a JSON array of 3 strings, no other text. Example: ["What are the anti-dumping duties?", "Does this need an import licence?", "What is the VAT rate?"]`
            );
            if (pillReq?.content) {
                try {
                    const pills = JSON.parse(pillReq.content);
                    if (Array.isArray(pills)) {
                        res.write(`data: ${JSON.stringify({ pills })}\n\n`);
                    }
                } catch { /* ignore parse errors */ }
            }
        } catch (e) {
            console.error("Pills generation error:", e.message);
        }

        res.write(`data: ${JSON.stringify({ done: true, finalOutput, chatId: activeChatId })}\n\n`);
        res.end();

    } catch (e) {
        console.error("Customs Agent error:", e);
        if (!res.headersSent) {
            res.status(500).json({ error: "Agent error", details: e.message });
        } else {
            res.write(`data: ${JSON.stringify({ error: "Agent error", details: e.message })}\n\n`);
            res.end();
        }
    }
});

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
