/**
 * MTProto Scraper - Uses session string for private channels
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { getValue, setValue, isStorageConfigured } from "./data/storage";
import type { TelegramMessage } from "./types";

const API_ID = parseInt(process.env.API_ID || "0");
const API_HASH = process.env.API_HASH || "";

let client: TelegramClient | null = null;
let sessionString: string = "";

/**
 * Check if MTProto is configured
 */
export function isMTProtoConfigured(): boolean {
    return Boolean(API_ID && API_HASH);
}

/**
 * Load session string - check env first, then Supabase
 */
export async function loadSession(): Promise<boolean> {
    if (!isMTProtoConfigured()) return false;

    // 1. Check env var first (most secure)
    if (process.env.SESSION_STRING) {
        sessionString = process.env.SESSION_STRING;
        console.log("[MTProto] Session loaded from env");
        return true;
    }

    // 2. Fallback to Supabase (for initial auth)
    if (isStorageConfigured()) {
        sessionString = await getValue<string>("session_string", "");
        if (sessionString) {
            console.log("[MTProto] Session loaded from Supabase");
            console.log("[MTProto] TIP: Copy session to SESSION_STRING env var for security");
            return true;
        }
    }
    return false;
}

/**
 * Save session string (just in-memory, user will copy to env)
 */
function saveSession(session: string): void {
    sessionString = session;
    console.log("[MTProto] Session generated - copy to SESSION_STRING env var");
}

/**
 * Get connected client
 */
async function getClient(): Promise<TelegramClient | null> {
    if (!isMTProtoConfigured() || !sessionString) return null;

    if (!client) {
        const session = new StringSession(sessionString);
        client = new TelegramClient(session, API_ID, API_HASH, {
            connectionRetries: 3,
        });
        await client.connect();
        console.log("[MTProto] Connected");
    }
    return client;
}

/**
 * Scrape messages using MTProto (for private channels)
 */
export async function scrapeChannelMTProto(
    channelUsername: string,
    limit: number = 20
): Promise<TelegramMessage[]> {
    const tgClient = await getClient();
    if (!tgClient) return [];

    try {
        console.log(`[MTProto] Fetching @${channelUsername}...`);

        const entity = await tgClient.getEntity(channelUsername);
        const messages = await tgClient.getMessages(entity, { limit });

        const result: TelegramMessage[] = [];
        for (const msg of messages) {
            if (!msg.message && !msg.media) continue;

            // Detect media type
            const hasDocument = msg.media?.className === "MessageMediaDocument";
            const hasPhoto = msg.media?.className === "MessageMediaPhoto";

            result.push({
                id: msg.id.toString(),
                text: msg.message || "",
                html: msg.message || "",
                date: msg.date ? new Date(msg.date * 1000).toISOString() : "",
                images: hasPhoto ? ["mtproto:photo"] : [],
                videos: [],
                documents: hasDocument ? [{ url: "mtproto:forward", title: "document" }] : [],
                links: [],
                channel: channelUsername,
            });
        }

        console.log(`[MTProto] Got ${result.length} messages from @${channelUsername}`);
        return result;
    } catch (err: any) {
        console.error(`[MTProto] Error fetching @${channelUsername}:`, err.message);
        return [];
    }
}

/**
 * Forward a message directly (no download needed!)
 */
export async function forwardMessage(
    fromChannel: string,
    messageId: number,
    toChannel: string
): Promise<boolean> {
    const tgClient = await getClient();
    if (!tgClient) return false;

    try {
        const fromEntity = await tgClient.getEntity(fromChannel);
        const toEntity = await tgClient.getEntity(toChannel);

        await tgClient.forwardMessages(toEntity, {
            messages: [messageId],
            fromPeer: fromEntity,
        });

        console.log(`[MTProto] Forwarded message ${messageId} from @${fromChannel}`);
        return true;
    } catch (err: any) {
        console.error(`[MTProto] Forward failed:`, err.message);
        return false;
    }
}

/**
 * Send a message with optional media copy (for when we need to modify text)
 */
export async function sendMessage(
    toChannel: string,
    text: string,
    fromChannel?: string,
    messageId?: number
): Promise<boolean> {
    const tgClient = await getClient();
    if (!tgClient) return false;

    try {
        const toEntity = await tgClient.getEntity(toChannel);

        // If we have source message, copy media and send with new text
        if (fromChannel && messageId) {
            const fromEntity = await tgClient.getEntity(fromChannel);
            const [sourceMsg] = await tgClient.getMessages(fromEntity, { ids: [messageId] });

            if (sourceMsg?.media) {
                // Send with media + new caption
                await tgClient.sendMessage(toEntity, {
                    message: text,
                    file: sourceMsg.media,
                });
                console.log(`[MTProto] Sent with media to @${toChannel}`);
                return true;
            }
        }

        // Just text
        await tgClient.sendMessage(toEntity, { message: text });
        console.log(`[MTProto] Sent text to @${toChannel}`);
        return true;
    } catch (err: any) {
        console.error(`[MTProto] Send failed:`, err.message);
        return false;
    }
}


// Auth state for web flow
let authState: {
    phoneNumber?: string;
    phoneCodeHash?: string;
    pendingClient?: TelegramClient;
} = {};

/**
 * Start auth flow - send code to phone
 */
export async function startAuth(phoneNumber: string): Promise<{ success: boolean; error?: string }> {
    if (!isMTProtoConfigured()) {
        return { success: false, error: "API_ID and API_HASH not configured" };
    }

    try {
        const session = new StringSession("");
        const tgClient = new TelegramClient(session, API_ID, API_HASH, {
            connectionRetries: 3,
        });
        await tgClient.connect();

        const result = await tgClient.sendCode(
            { apiId: API_ID, apiHash: API_HASH },
            phoneNumber
        );

        authState = {
            phoneNumber,
            phoneCodeHash: result.phoneCodeHash,
            pendingClient: tgClient,
        };

        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/**
 * Complete auth - verify code
 */
export async function completeAuth(code: string): Promise<{ success: boolean; session?: string; needs2FA?: boolean; error?: string }> {
    if (!authState.pendingClient || !authState.phoneNumber || !authState.phoneCodeHash) {
        return { success: false, error: "No pending auth. Start auth first." };
    }

    try {
        await authState.pendingClient.invoke(
            new (await import("telegram/tl")).Api.auth.SignIn({
                phoneNumber: authState.phoneNumber,
                phoneCodeHash: authState.phoneCodeHash,
                phoneCode: code,
            })
        );

        // Success without 2FA
        return await finishAuth();
    } catch (err: any) {
        if (err.message.includes("SESSION_PASSWORD_NEEDED")) {
            // Need 2FA - keep state and return flag
            return { success: false, needs2FA: true };
        }
        return { success: false, error: err.message };
    }
}

/**
 * Complete 2FA - verify password
 */
export async function complete2FA(password: string): Promise<{ success: boolean; session?: string; error?: string }> {
    if (!authState.pendingClient) {
        return { success: false, error: "No pending auth. Start auth first." };
    }

    try {
        const { Api } = await import("telegram/tl");

        // Get password info
        const passwordInfo = await authState.pendingClient.invoke(
            new Api.account.GetPassword()
        );

        // Calculate SRP parameters
        const { computeCheck } = await import("telegram/Password");
        const srpResult = await computeCheck(passwordInfo, password);

        // Submit password
        await authState.pendingClient.invoke(
            new Api.auth.CheckPassword({ password: srpResult })
        );

        return await finishAuth();
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

/**
 * Finish auth and return session
 */
async function finishAuth(): Promise<{ success: boolean; session?: string; error?: string }> {
    if (!authState.pendingClient) {
        return { success: false, error: "No pending client" };
    }

    const session = authState.pendingClient.session.save() as unknown as string;
    await saveSession(session);
    client = authState.pendingClient;
    authState = {};

    return { success: true, session };
}

/**
 * Get auth status
 */
export function getAuthStatus(): { configured: boolean; authenticated: boolean } {
    return {
        configured: isMTProtoConfigured(),
        authenticated: Boolean(sessionString),
    };
}

/**
 * Start real-time updates for MTProto channels
 * Messages are received instantly via event handlers (no polling!)
 */
export async function startRealtimeUpdates(
    channels: string[],
    onNewMessage: (msg: TelegramMessage) => Promise<void>
): Promise<boolean> {
    const tgClient = await getClient();
    if (!tgClient || channels.length === 0) return false;

    try {
        // Import NewMessage event handler
        const { NewMessage } = await import("telegram/events");

        // Get channel peer IDs for filtering
        const channelIds: string[] = [];
        const channelMap: Record<string, string> = {}; // id -> username

        for (const username of channels) {
            try {
                const entity = await tgClient.getEntity(username);
                // Get the peer ID (works for channels/chats)
                const peerId = entity.id?.toString();
                if (peerId) {
                    channelIds.push(peerId);
                    channelMap[peerId] = username;
                    console.log(`[MTProto] Subscribed to @${username} (ID: ${peerId})`);
                }
            } catch (err: any) {
                console.error(`[MTProto] Could not subscribe to @${username}:`, err.message);
            }
        }

        if (channelIds.length === 0) {
            console.log("[MTProto] No channels to subscribe to");
            return false;
        }

        // Add event handler for new messages (without chats filter - we'll filter in handler)
        tgClient.addEventHandler(async (event: any) => {
            try {
                const msg = event.message;

                // Debug: log ALL incoming events
                console.log(`[MTProto DEBUG] Event received, msg id: ${msg?.id}, has text: ${!!msg?.message}, has media: ${!!msg?.media}`);

                if (!msg?.message && !msg?.media) return;

                // Get channel info from the event
                let channelUsername = "";
                let chatId = "";
                try {
                    const chat = await event.getChat();
                    chatId = chat?.id?.toString() || "";
                    channelUsername = chat?.username || chat?.title || "";
                    console.log(`[MTProto DEBUG] From chat: ${channelUsername} (ID: ${chatId})`);
                    console.log(`[MTProto DEBUG] Subscribed IDs: ${channelIds.join(', ')}`);
                } catch (err: any) {
                    console.log(`[MTProto DEBUG] Could not get chat: ${err.message}`);
                    return; // Can't identify source, skip
                }

                // Only process if it's from one of our subscribed channels
                if (!channelIds.includes(chatId)) {
                    console.log(`[MTProto DEBUG] Chat ID ${chatId} not in subscribed list, skipping`);
                    return;
                }

                // Use stored username if available
                const storedName = channelMap[chatId];
                if (storedName) {
                    channelUsername = storedName;
                }

                // Detect media types and handle grouped messages
                const hasDocument = msg.media?.className === "MessageMediaDocument";
                const hasPhoto = msg.media?.className === "MessageMediaPhoto";
                const groupedId = msg.groupedId?.toString() || null;

                const telegramMessage: TelegramMessage = {
                    id: msg.id.toString(),
                    text: msg.message || "",
                    html: msg.message || "",
                    date: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString(),
                    images: hasPhoto ? ["mtproto:photo"] : [],
                    videos: [],
                    documents: hasDocument ? [{ url: "mtproto:forward", title: "document" }] : [],
                    links: [],
                    channel: channelUsername,
                    groupedId,
                };

                console.log(`[MTProto] ⚡ New message from @${channelUsername}`);
                await onNewMessage(telegramMessage);
            } catch (err: any) {
                console.error("[MTProto] Event handler error:", err.message);
            }
        }, new NewMessage({}));

        console.log(`[MTProto] Real-time updates enabled for ${channelIds.length} channel(s)`);
        return true;
    } catch (err: any) {
        console.error("[MTProto] Failed to start real-time updates:", err.message);
        return false;
    }
}

/**
 * Check if real-time updates are supported (client connected + authenticated)
 */
export function isRealtimeSupported(): boolean {
    return Boolean(client) && Boolean(sessionString);
}

