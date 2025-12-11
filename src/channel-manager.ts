/**
 * Channel Manager - Stores channels in Supabase, not env
 */

import { getValue, setValue, isStorageConfigured } from "./storage";

export interface ChannelConfig {
    username: string;
    type: "public" | "mtproto";  // public = web scrape, mtproto = session
    addedAt: string;
}

let channelsCache: ChannelConfig[] = [];

/**
 * Load channels from Supabase
 */
export async function loadChannels(): Promise<void> {
    if (isStorageConfigured()) {
        channelsCache = await getValue<ChannelConfig[]>("channels", []);
        console.log("[Channels] Loaded", channelsCache.length, "channels from DB");
    }

    // Fallback to env if no channels in DB
    if (channelsCache.length === 0 && process.env.SOURCE_CHANNELS) {
        const envChannels = process.env.SOURCE_CHANNELS.split(",").map(c => c.trim()).filter(Boolean);
        channelsCache = envChannels.map(username => ({
            username,
            type: "public" as const,
            addedAt: new Date().toISOString(),
        }));
        console.log("[Channels] Using", channelsCache.length, "channels from env");
    }
}

/**
 * Get all channels
 */
export function getChannels(): ChannelConfig[] {
    return channelsCache;
}

/**
 * Get channels by type
 */
export function getPublicChannels(): string[] {
    return channelsCache.filter(c => c.type === "public").map(c => c.username);
}

export function getMTProtoChannels(): string[] {
    return channelsCache.filter(c => c.type === "mtproto").map(c => c.username);
}

/**
 * Add a channel
 */
export async function addChannel(username: string, type: "public" | "mtproto"): Promise<boolean> {
    // Clean username (remove @ and t.me/ prefix)
    username = username.replace(/^@/, "").replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "").trim();

    if (!username) return false;

    // Check if already exists
    if (channelsCache.some(c => c.username.toLowerCase() === username.toLowerCase())) {
        return false;
    }

    channelsCache.push({
        username,
        type,
        addedAt: new Date().toISOString(),
    });

    if (isStorageConfigured()) {
        await setValue("channels", channelsCache);
    }

    console.log(`[Channels] Added @${username} (${type})`);
    return true;
}

/**
 * Remove a channel
 */
export async function removeChannel(username: string): Promise<boolean> {
    const idx = channelsCache.findIndex(c => c.username.toLowerCase() === username.toLowerCase());
    if (idx === -1) return false;

    channelsCache.splice(idx, 1);

    if (isStorageConfigured()) {
        await setValue("channels", channelsCache);
    }

    console.log(`[Channels] Removed @${username}`);
    return true;
}
