import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', 'data');
const CHAT_LOG_FILE = join(LOG_DIR, 'ai_chat_history.jsonl'); // Using JSON Lines format

if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
}

export function logAiChat(userName, message, reply, durationMs) {
    try {
        const logEntry = {
            timestamp: new Date().toISOString(),
            userName: userName || "Unknown User",
            message: message,
            reply: reply,
            durationMs: durationMs
        };
        appendFileSync(CHAT_LOG_FILE, JSON.stringify(logEntry) + '\n', 'utf-8');
    } catch (err) {
        console.error("Failed to write to chat log:", err);
    }
}
