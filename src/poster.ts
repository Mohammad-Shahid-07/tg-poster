import { config, getLastProcessed, setLastProcessed } from "./config";
import { scrapeChannel, getNewMessages } from "./scraper";
import { postMessage } from "./bot";
import { evaluateContent, type AdminDecision } from "./ai-admin";
import { isDuplicate, recordPost } from "./content-tracker";
import type { TelegramMessage } from "./types";

/**
 * Main poster function - fetches new messages and posts them
 */
export async function runPoster(): Promise<void> {
    console.log("\n[Poster] Starting run...");

    const lastProcessed = getLastProcessed();

    for (const channel of config.sourceChannels) {
        try {
            console.log(`[Poster] Checking @${channel}...`);

            // Scrape latest messages
            const messages = await scrapeChannel(channel);

            if (messages.length === 0) {
                console.log(`[Poster] No messages found for @${channel}`);
                continue;
            }

            // Get new messages since last run
            const newMessages = getNewMessages(messages, lastProcessed[channel]);

            if (newMessages.length === 0) {
                console.log(`[Poster] No new messages for @${channel}`);
                continue;
            }

            console.log(
                `[Poster] Found ${newMessages.length} new message(s) for @${channel}`
            );

            // Post new messages (oldest first)
            const toPost = newMessages.reverse();

            for (const message of toPost) {
                // Check for duplicate content first
                const dupeCheck = await isDuplicate(message.text, message.images.length);
                if (dupeCheck.isDupe) {
                    console.log(`[Poster] ⏭️ Skipping duplicate: ${dupeCheck.reason}`);
                    setLastProcessed(channel, message.id);
                    continue;
                }

                // AI Admin evaluates the content
                const decision = await evaluateContent(
                    message.text,
                    message.images,
                    message.channel
                );

                if (!decision.shouldPost) {
                    console.log(`[Poster] AI skipped message ${message.id}: ${decision.reason}`);
                    // Still update last processed to avoid reprocessing
                    setLastProcessed(channel, message.id);
                    continue;
                }

                // Use transformed content if available
                const transformedMessage: TelegramMessage = {
                    ...message,
                    text: decision.transformedText || message.text,
                };

                await postMessageWithRetry(transformedMessage);

                // Record the post to prevent future duplicates
                await recordPost(
                    decision.transformedText || message.text,
                    message.channel,
                    message.id
                );

                // Update last processed
                setLastProcessed(channel, message.id);

                // Small delay between posts to avoid rate limits
                await sleep(1000);
            }
        } catch (err) {
            console.error(`[Poster] Error processing @${channel}:`, err);
        }
    }

    console.log("[Poster] Run complete\n");
}

/**
 * Post a message with retry logic
 */
async function postMessageWithRetry(
    message: TelegramMessage,
    retries: number = 3
): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            await postMessage(message, config.includeSource);
            console.log(`[Poster] Posted message ${message.id} from @${message.channel}`);
            return;
        } catch (err: any) {
            console.error(
                `[Poster] Failed to post message ${message.id} (attempt ${i + 1}):`,
                err.message
            );

            if (i < retries - 1) {
                // Wait before retry (exponential backoff)
                await sleep(2000 * (i + 1));
            }
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
