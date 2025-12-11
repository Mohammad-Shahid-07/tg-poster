/**
 * MTProto Scraper - Uses session string for private channels
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { getValue, setValue, isStorageConfigured } from "./storage";
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

            result.push({
                id: msg.id.toString(),
                text: msg.message || "",
                html: msg.message || "",
                date: msg.date ? new Date(msg.date * 1000).toISOString() : "",
                images: [], // TODO: handle media
                videos: [],
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

