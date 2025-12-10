import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

// Environment variables
export const config = {
    // Bot configuration
    botToken: process.env.BOT_TOKEN || "",
    channelId: process.env.CHANNEL_ID || "",

    // Source channels to monitor (comma-separated usernames without @)
    sourceChannels: (process.env.SOURCE_CHANNELS || "durov")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),

    // How often to check for new messages (cron format)
    cronSchedule: process.env.CRON_SCHEDULE || "*/5 * * * *", // every 5 mins

    // Include source attribution in posts
    includeSource: process.env.INCLUDE_SOURCE !== "false",

    // Data directory (must be /tmp on Hugging Face)
    dataDir: process.env.DATA_DIR || "./public/data",
    mediaDir: process.env.MEDIA_DIR || "./public/media",
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

// Last processed messages tracking
const lastProcessedPath = () => `${config.dataDir}/last-messages.json`;

export function getLastProcessed(): Record<string, string> {
    try {
        if (existsSync(lastProcessedPath())) {
            return JSON.parse(readFileSync(lastProcessedPath(), "utf-8"));
        }
    } catch {
        // ignore
    }
    return {};
}

export function setLastProcessed(channel: string, messageId: string) {
    const data = getLastProcessed();
    data[channel] = messageId;
    writeFileSync(lastProcessedPath(), JSON.stringify(data, null, 2));
}

// Validate config
export function validateConfig() {
    if (!config.botToken) {
        throw new Error("BOT_TOKEN is required");
    }
    if (!config.channelId) {
        throw new Error("CHANNEL_ID is required");
    }
    if (config.sourceChannels.length === 0) {
        throw new Error("SOURCE_CHANNELS is required");
    }
}
