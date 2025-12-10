import { Bot, InputFile } from "grammy";
import { config } from "./config";
import type { TelegramMessage } from "./types";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

let bot: Bot | null = null;

/**
 * Initialize the Grammy bot
 */
export function initBot(): Bot {
    if (!bot) {
        bot = new Bot(config.botToken);
        console.log("[Bot] Initialized");
    }
    return bot;
}

/**
 * Post a text message to the channel
 */
export async function postText(text: string): Promise<void> {
    const b = initBot();
    await b.api.sendMessage(config.channelId, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: false },
    });
}

/**
 * Post a message with optional media to the channel
 */
export async function postMessage(
    message: TelegramMessage,
    includeSource: boolean = true
): Promise<void> {
    const b = initBot();

    // Build caption/text
    let text = message.text;
    if (includeSource) {
        text += `\n\n📢 from @${message.channel}`;
    }

    // If there are images, send as photo(s)
    if (message.images.length > 0) {
        const imageUrl = message.images[0];
        if (!imageUrl) return;

        try {
            // Try to download and send
            const imagePath = await downloadMedia(imageUrl, message.id);

            if (imagePath) {
                await b.api.sendPhoto(config.channelId, new InputFile(imagePath), {
                    caption: text,
                    parse_mode: "HTML",
                });
                // Clean up
                cleanupMedia(imagePath);
                return;
            }
        } catch (err) {
            console.error("[Bot] Failed to send image, falling back to text:", err);
        }

        // Fallback: try sending URL directly
        try {
            await b.api.sendPhoto(config.channelId, imageUrl, {
                caption: text,
                parse_mode: "HTML",
            });
            return;
        } catch {
            // Fall through to text
        }
    }

    // If there are videos, try to send
    if (message.videos.length > 0) {
        const videoUrl = message.videos[0];
        if (!videoUrl) return;

        try {
            await b.api.sendVideo(config.channelId, videoUrl, {
                caption: text,
                parse_mode: "HTML",
            });
            return;
        } catch (err) {
            console.error("[Bot] Failed to send video, falling back to text:", err);
        }
    }

    // Fallback to text only
    if (text.trim()) {
        await postText(text);
    }
}

/**
 * Download media to /tmp
 */
async function downloadMedia(
    url: string,
    messageId: string
): Promise<string | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;

        const buffer = await response.arrayBuffer();
        const ext = url.split(".").pop()?.split("?")[0] || "jpg";
        const filename = `${messageId}.${ext}`;
        const filepath = join(config.mediaDir, filename);

        writeFileSync(filepath, Buffer.from(buffer));
        return filepath;
    } catch (err) {
        console.error("[Bot] Download failed:", err);
        return null;
    }
}

/**
 * Clean up downloaded media
 */
function cleanupMedia(filepath: string): void {
    try {
        if (existsSync(filepath)) {
            unlinkSync(filepath);
        }
    } catch {
        // ignore
    }
}
