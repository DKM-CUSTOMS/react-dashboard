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
        "You are precise, professional, and never guess. You only cite codes you have verified.",
        "",
        "--- OUTPUT FORMAT ---",
        "Your final response MUST follow this structure:",
        "1. **HS / CN Code**: The confirmed 10-digit code (e.g. 8529 90 96 00)",
        "2. **Official Description**: Exact description from the nomenclature.",
        "3. **Classification Rationale**: A brief 2-3 sentence explanation citing the relevant Chapters, Notes, or Headings.",
        "4. **Duty Rate**: The exact rate from the GN 2026 database.",
        "5. **Important Notes**: Any VAT, anti-dumping, or quota considerations if relevant.",
        "",
        "--- GENERATIVE UI COMPONENTS ---",
        "You MUST use these components for every finalized classification to provide a premium UX:",
        "",
        "1. **Classification Certificate (language: customs-card)**:",
        "Output a JSON block that renders a certified document. Example:",
        "```customs-card",
        '{"code":"8529 90 96 00","description":"Parts suitable for use solely or principally...","duty":"3.7%","certifiedAt":"2026-03-16"}',
        "```",
        "",
        "2. **Knowledge Tree (language: customs-tree)**:",
        "Visualize the hierarchy from Section down to the specific Subheading. Example:",
        "```customs-tree",
        '{"levels":[{"type":"SECTION","id":"XVI","label":"Machinery and mechanical appliances..."},{"type":"CHAPTER","id":"85","label":"Electrical machinery and equipment..."},{"type":"HEADING","id":"8529","label":"Parts suitable for use solely or principally..."},{"type":"SUBHEADING","id":"8529 90 92","label":"For television cameras..."}]}',
        "```",
        "",
        "--- REQUIRED WORKFLOW (CRITICAL - FOLLOW IN ORDER) ---",
        "For EVERY product classification request:",
        "  STEP 1: Call search_gn_nomenclature with relevant keywords from the product description.",
        "  STEP 2: Call lookup_cn_code_in_nomenclature to verify the candidate code(s) and retrieve the official duty rate.",
        "  STEP 3: If legal context is needed, call search_eurlex_customs for Chapter or Section notes.",
        "",
        "NEVER HALLUCINATE DUTY RATES. Always confirm via lookup_cn_code_in_nomenclature.",
        "NEVER invent codes. If a code is not found in the CSV, say so explicitly.",
        "",
        "If the user has NOT provided a product description:",
        "Respond: 'Please provide the product description so I can begin the classification.'"
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
        const { message, chat_history, chatId, isIncognito, user_name } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message is required" });
        }

        const activeChatId = chatId || crypto.randomUUID();

        // Persist user message
        if (user_name && !isIncognito) {
            appendToChat(user_name, activeChatId, 'user', message, isIncognito, 'customs');
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
            input: message,
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
