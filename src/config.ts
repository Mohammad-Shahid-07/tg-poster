import { existsSync, mkdirSync } from "fs";
import { getValue, setValue, isStorageConfigured } from "./storage";

// Environment variables
export const config = {
    botToken: process.env.BOT_TOKEN || "",
    channelId: process.env.CHANNEL_ID || "",
    sourceChannels: (process.env.SOURCE_CHANNELS || "durov")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    cronSchedule: process.env.CRON_SCHEDULE || "*/5 * * * *",
    includeSource: process.env.INCLUDE_SOURCE !== "false",
    dataDir: process.env.DATA_DIR || "/tmp/data",
    mediaDir: process.env.MEDIA_DIR || "/tmp/media",
};

// Ensure directories exist
export function ensureDirectories() {
    if (!existsSync(config.dataDir)) {
        mkdirSync(config.dataDir, { recursive: true });
    }
    if (!existsSync(config.mediaDir)) {
        mkdirSync(config.mediaDir, { recursive: true });
    }
}

// In-memory cache for last processed (synced with Supabase)
let lastProcessedCache: Record<string, string> = {};
let cacheLoaded = false;

/**
 * Load last processed from Supabase (call on startup)
 */
export async function loadLastProcessed(): Promise<void> {
    if (isStorageConfigured()) {
        lastProcessedCache = await getValue<Record<string, string>>("last_processed", {});
        console.log("[Config] Loaded last processed from Supabase:", Object.keys(lastProcessedCache).length, "channels");
    }
    cacheLoaded = true;
}

/**
 * Get last processed messages
 */
export function getLastProcessed(): Record<string, string> {
    return lastProcessedCache;
}

/**
 * Set last processed for a channel (async save to Supabase)
 */
export async function setLastProcessed(channel: string, messageId: string): Promise<void> {
    lastProcessedCache[channel] = messageId;

    if (isStorageConfigured()) {
        await setValue("last_processed", lastProcessedCache);
    }
}

// Validate config
export function validateConfig() {
    if (!config.botToken) throw new Error("BOT_TOKEN is required");
    if (!config.channelId) throw new Error("CHANNEL_ID is required");
    if (config.sourceChannels.length === 0) throw new Error("SOURCE_CHANNELS is required");
}
