import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHATS_DIR = join(__dirname, '..', 'data', 'chats');

if (!existsSync(CHATS_DIR)) {
    mkdirSync(CHATS_DIR, { recursive: true });
}

function getUserFile(userIdentifier, namespace = 'hr') {
    if (!userIdentifier) return null;
    const safeId = Buffer.from(userIdentifier).toString('base64url');
    return join(CHATS_DIR, `${safeId}_${namespace}.json`);
}

function readUserChats(userIdentifier, namespace = 'hr') {
    const file = getUserFile(userIdentifier, namespace);
    if (!file || !existsSync(file)) return [];
    try {
        return JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
        return [];
    }
}

function writeUserChats(userIdentifier, chats, namespace = 'hr') {
    const file = getUserFile(userIdentifier, namespace);
    if (file) {
        writeFileSync(file, JSON.stringify(chats, null, 2), 'utf-8');
    }
}

export function getUserChatSessions(userIdentifier, namespace = 'hr') {
    const chats = readUserChats(userIdentifier, namespace);
    return chats
        .filter(c => !c.isIncognito)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
}

export function getChatSession(userIdentifier, chatId, namespace = 'hr') {
    const chats = readUserChats(userIdentifier, namespace);
    return chats.find(c => c.id === chatId);
}

export function appendToChat(userIdentifier, chatId, role, text, isIncognito = false, namespace = 'hr', attachments = []) {
    const chats = readUserChats(userIdentifier, namespace);
    let chat = chats.find(c => c.id === chatId);

    if (!chat) {
        let safeTitle = text.slice(0, 40);
        if (text.length > 40) safeTitle += '...';

        chat = {
            id: chatId,
            title: safeTitle,
            isIncognito: isIncognito === true || isIncognito === 'true',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: []
        };
        chats.push(chat);
    }

    chat.messages.push({
        role: role,
        text: text,
        attachments: attachments,
        timestamp: new Date().toISOString()
    });
    chat.updatedAt = new Date().toISOString();

    writeUserChats(userIdentifier, chats, namespace);
    return chat;
}

export function updateChatTitle(userIdentifier, chatId, title, namespace = 'hr') {
    const chats = readUserChats(userIdentifier, namespace);
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
        chat.title = title;
        writeUserChats(userIdentifier, chats, namespace);
    }
}

export function deleteChatSession(userIdentifier, chatId, namespace = 'hr') {
    let chats = readUserChats(userIdentifier, namespace);
    chats = chats.filter(c => c.id !== chatId);
    writeUserChats(userIdentifier, chats, namespace);
}

export function getUserShortcuts(userIdentifier, namespace = 'hr') {
    const chats = readUserChats(userIdentifier, namespace);
    const prompts = new Set();
    const shortcuts = [];

    // Sort to get most recent first
    const recentChats = [...chats].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    for (const chat of recentChats) {
        if (chat.isIncognito) continue;
        const firstUserMsg = chat.messages.find(m => m.role === 'user');
        if (firstUserMsg && firstUserMsg.text.length > 10 && firstUserMsg.text.length < 100) {
            if (!prompts.has(firstUserMsg.text)) {
                prompts.add(firstUserMsg.text);
                shortcuts.push(firstUserMsg.text);
            }
        }
        if (shortcuts.length >= 4) break;
    }
    return shortcuts;
}
