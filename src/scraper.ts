import * as cheerio from "cheerio";
import type { TelegramMessage } from "./types";

const BASE_URL = "https://t.me/s";

// Cache of channels that have been validated
const channelStatus: Map<string, { works: boolean; reason?: string }> = new Map();

/**
 * Check if a channel supports web preview
 */
export async function validateChannel(
    channelUsername: string
): Promise<{ valid: boolean; reason?: string }> {
    const url = `${BASE_URL}/${channelUsername}`;

    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
        });

        if (!response.ok) {
            return { valid: false, reason: `HTTP ${response.status}` };
        }

        const html = await response.text();

        // Check if channel exists
        if (html.includes("tgme_page_icon_error") || html.includes("If you have <strong>Telegram</strong>")) {
            return { valid: false, reason: "Channel not found or private" };
        }

        // Check if messages are present (preview enabled)
        if (!html.includes("tgme_widget_message")) {
            return { valid: false, reason: "Web preview disabled by admin" };
        }

        return { valid: true };
    } catch (err: any) {
        return { valid: false, reason: err.message };
    }
}

/**
 * Validate all source channels and return working ones
 */
export async function validateChannels(
    channels: string[]
): Promise<{ working: string[]; failed: { name: string; reason: string }[] }> {
    const working: string[] = [];
    const failed: { name: string; reason: string }[] = [];

    console.log("\n[Validator] Checking channel availability...\n");

    for (const channel of channels) {
        const result = await validateChannel(channel);
        channelStatus.set(channel, { works: result.valid, reason: result.reason });

        if (result.valid) {
            console.log(`  ✅ @${channel} - Web preview available`);
            working.push(channel);
        } else {
            console.log(`  ❌ @${channel} - ${result.reason}`);
            failed.push({ name: channel, reason: result.reason || "Unknown" });
        }
    }

    console.log(`\n[Validator] ${working.length}/${channels.length} channels available\n`);

    return { working, failed };
}

/**
 * Scrape messages from a public Telegram channel
 */
export async function scrapeChannel(
    channelUsername: string,
    limit: number = 20
): Promise<TelegramMessage[]> {
    // Check cached status
    const status = channelStatus.get(channelUsername);
    if (status && !status.works) {
        console.log(`[Scraper] Skipping @${channelUsername} - ${status.reason}`);
        return [];
    }

    const url = `${BASE_URL}/${channelUsername}`;

    console.log(`[Scraper] Fetching ${url}`);

    const response = await fetch(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
    });

    if (!response.ok) {
        throw new Error(
            `Failed to fetch channel ${channelUsername}: ${response.status}`
        );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const messages: TelegramMessage[] = [];

    // Each message is in a .tgme_widget_message_wrap
    $(".tgme_widget_message_wrap").each((_, element) => {
        try {
            const $msg = $(element);
            const $bubble = $msg.find(".tgme_widget_message");

            // Get message ID from data attribute
            const dataPost = $bubble.attr("data-post") || "";
            const id = dataPost.split("/").pop() || "";

            if (!id) return;

            // Get text content
            const $text = $bubble.find(".tgme_widget_message_text");
            const text = $text.text().trim();
            const html = $text.html() || "";

            // Get date
            const $date = $bubble.find(".tgme_widget_message_date time");
            const date = $date.attr("datetime") || "";

            // Get images
            const images: string[] = [];
            $bubble.find(".tgme_widget_message_photo_wrap").each((_, img) => {
                const style = $(img).attr("style") || "";
                const match = style.match(/url\(['"]?(.*?)['"]?\)/);
                if (match && match[1]) {
                    images.push(match[1]);
                }
            });

            // Get videos (poster images as we can't easily get video URLs)
            const videos: string[] = [];
            $bubble.find("video").each((_, vid) => {
                const src = $(vid).attr("src");
                if (src) videos.push(src);
            });

            // Get links
            const links: string[] = [];
            $text.find("a").each((_, link) => {
                const href = $(link).attr("href");
                if (href && !href.startsWith("tg://")) {
                    links.push(href);
                }
            });

            messages.push({
                id,
                text,
                html,
                date,
                images,
                videos,
                links,
                channel: channelUsername,
            });
        } catch (err) {
            console.error("[Scraper] Error parsing message:", err);
        }
    });

    // Sort by ID (newest first) and limit
    messages.sort((a, b) => parseInt(b.id) - parseInt(a.id));

    // Update cache if no messages found
    if (messages.length === 0 && !status) {
        channelStatus.set(channelUsername, { works: false, reason: "No messages found (preview may be disabled)" });
        console.log(`[Scraper] ⚠️ @${channelUsername} returned 0 messages - web preview may be disabled`);
    } else {
        console.log(`[Scraper] Found ${messages.length} messages from @${channelUsername}`);
    }

    return messages.slice(0, limit);
}

/**
 * Get new messages since last processed ID
 */
export function getNewMessages(
    messages: TelegramMessage[],
    lastId: string | undefined
): TelegramMessage[] {
    if (!lastId) {
        // First run - return only the latest message to avoid spam
        return messages.slice(0, 1);
    }

    const lastIdNum = parseInt(lastId);
    return messages.filter((m) => parseInt(m.id) > lastIdNum);
}
