import { config, getLastProcessed, setLastProcessed } from "./config";
import { scrapeChannel, getNewMessages } from "./scraper";
import { postMessage } from "./bot";
import { evaluateContent, evaluateBatch, type AdminDecision, type BatchDecision } from "./ai-admin";
import { isDuplicate, recordPost } from "./data/content-tracker";
import { getPublicChannels, getMTProtoChannels } from "./data/channels";
import { scrapeChannelMTProto } from "./mtproto-scraper";
import type { TelegramMessage } from "./types";

const BATCH_SIZE = 4; // Max messages per AI batch call

/**
 * Main poster function - fetches new messages and posts them
 * Uses batch processing for efficiency
 */
export async function runPoster(): Promise<void> {
    console.log("\n[Poster] Starting run...");

    const lastProcessed = getLastProcessed();
    const publicChannels = getPublicChannels();
    const mtprotoChannels = getMTProtoChannels();

    if (publicChannels.length === 0 && mtprotoChannels.length === 0) {
        console.log("[Poster] No channels configured. Add channels at /channels");
        return;
    }

    // ==========================================
    // PHASE 1: Collect ALL new messages from all channels
    // ==========================================
    const allMessages: TelegramMessage[] = [];

    // Collect from public channels
    for (const channel of publicChannels) {
        try {
            console.log(`[Poster] Checking @${channel}...`);
            const messages = await scrapeChannel(channel);

            if (messages.length === 0) {
                console.log(`[Poster] No messages found for @${channel}`);
                continue;
            }

            const newMessages = getNewMessages(messages, lastProcessed[channel]);
            if (newMessages.length > 0) {
                console.log(`[Poster] Found ${newMessages.length} new message(s) for @${channel}`);
                allMessages.push(...newMessages.reverse()); // oldest first
            } else {
                console.log(`[Poster] No new messages for @${channel}`);
            }
        } catch (err) {
            console.error(`[Poster] Error fetching @${channel}:`, err);
        }
    }

    // Collect from MTProto channels
    for (const channel of mtprotoChannels) {
        try {
            console.log(`[Poster] Checking @${channel} (MTProto)...`);
            const messages = await scrapeChannelMTProto(channel);

            if (messages.length === 0) {
                console.log(`[Poster] No messages found for @${channel}`);
                continue;
            }

            const newMessages = getNewMessages(messages, lastProcessed[channel]);
            if (newMessages.length > 0) {
                console.log(`[Poster] Found ${newMessages.length} new message(s) for @${channel}`);
                allMessages.push(...newMessages.reverse());
            } else {
                console.log(`[Poster] No new messages for @${channel}`);
            }
        } catch (err) {
            console.error(`[Poster] Error fetching @${channel} (MTProto):`, err);
        }
    }

    if (allMessages.length === 0) {
        console.log("[Poster] No new messages to process");
        console.log("[Poster] Run complete\n");
        return;
    }

    console.log(`\n[Poster] Total new messages: ${allMessages.length}`);

    // ==========================================
    // PHASE 2: Filter duplicates
    // ==========================================
    const uniqueMessages: TelegramMessage[] = [];
    for (const msg of allMessages) {
        const dupeCheck = await isDuplicate(msg.text, msg.images.length);
        if (dupeCheck.isDupe) {
            console.log(`[Poster] ⏭️ Skipping duplicate from @${msg.channel}: ${dupeCheck.reason}`);
            setLastProcessed(msg.channel, msg.id);
        } else {
            uniqueMessages.push(msg);
        }
    }

    if (uniqueMessages.length === 0) {
        console.log("[Poster] All messages were duplicates");
        console.log("[Poster] Run complete\n");
        return;
    }

    console.log(`[Poster] ${uniqueMessages.length} unique messages to process`);

    // ==========================================
    // PHASE 3: Create batches (diverse channels, PDFs solo)
    // ==========================================
    const batches = createDiverseBatches(uniqueMessages, BATCH_SIZE);
    console.log(`[Poster] Created ${batches.length} batch(es)`);

    // ==========================================
    // PHASE 4: Process each batch
    // ==========================================
    for (const batch of batches) {
        if (!batch || batch.length === 0) continue;

        console.log(`\n[Poster] Processing batch (${batch.length} messages)`);

        try {
            if (batch.length === 1) {
                // Single message - use regular evaluation
                await processSingleMessage(batch[0]!);
            } else {
                // Multiple messages - use batch evaluation
                await processBatch(batch);
            }
        } catch (err) {
            console.error(`[Poster] Batch failed:`, err);
        }
    }

    console.log("\n[Poster] Run complete\n");
}

/**
 * Create batches with messages from different channels
 * PDFs and documents are processed individually (not batched)
 */
function createDiverseBatches(messages: TelegramMessage[], maxBatchSize: number): TelegramMessage[][] {
    const batches: TelegramMessage[][] = [];
    const remaining = [...messages];

    while (remaining.length > 0) {
        const batch: TelegramMessage[] = [];
        const channelsInBatch = new Set<string>();

        // Build batch with diverse channels
        for (let i = 0; i < remaining.length && batch.length < maxBatchSize;) {
            const msg = remaining[i];
            if (!msg) { i++; continue; }

            // PDFs/documents go solo (not batched)
            if (msg.documents && msg.documents.length > 0) {
                if (batch.length === 0) {
                    batch.push(msg);
                    remaining.splice(i, 1);
                    break; // PDF is its own batch
                }
                i++;
                continue;
            }

            // Prefer messages from different channels
            if (!channelsInBatch.has(msg.channel) || batch.length < 2) {
                batch.push(msg);
                channelsInBatch.add(msg.channel);
                remaining.splice(i, 1);
            } else {
                i++;
            }
        }

        // If we couldn't fill with diverse channels, add any remaining
        while (batch.length < maxBatchSize && remaining.length > 0) {
            const first = remaining[0];
            if (!first) break;
            const hasDoc = first.documents && first.documents.length > 0;
            if (hasDoc && batch.length > 0) break; // Don't mix docs with other content
            const shifted = remaining.shift();
            if (shifted) batch.push(shifted);
        }

        if (batch.length > 0) {
            batches.push(batch);
        }
    }

    return batches;
}

/**
 * Process a single message
 */
async function processSingleMessage(message: TelegramMessage): Promise<void> {
    const decision = await evaluateContent(
        message.text,
        message.images,
        message.channel
    );

    if (!decision.shouldPost) {
        console.log(`[Poster] AI skipped: ${decision.reason}`);
        setLastProcessed(message.channel, message.id);
        return;
    }

    const transformedMessage: TelegramMessage = {
        ...message,
        text: decision.transformedText || message.text,
    };

    await postMessageWithRetry(transformedMessage);
    await recordPost(transformedMessage.text, message.channel, message.id);
    setLastProcessed(message.channel, message.id);
}

/**
 * Process a batch of messages with a single AI call
 */
async function processBatch(messages: TelegramMessage[]): Promise<void> {
    // Batch evaluation - single AI call for multiple messages
    const decisions = await evaluateBatch(messages);

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (!message) continue;

        const decision = decisions[i];

        if (!decision || !decision.shouldPost) {
            console.log(`[Poster] AI skipped @${message.channel}/${message.id}: ${decision?.reason || 'No decision'}`);
            setLastProcessed(message.channel, message.id);
            continue;
        }

        const transformedMessage: TelegramMessage = {
            ...message,
            text: decision.transformedText || message.text,
        };

        await postMessageWithRetry(transformedMessage);
        await recordPost(transformedMessage.text, message.channel, message.id);
        setLastProcessed(message.channel, message.id);

        // Small delay between posts
        if (i < messages.length - 1) {
            await sleep(1000);
        }
    }
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
            console.log(`[Poster] ✅ Posted from @${message.channel}`);
            return;
        } catch (err: any) {
            console.error(
                `[Poster] Failed to post ${message.id} (attempt ${i + 1}):`,
                err.message
            );

            if (i < retries - 1) {
                await sleep(2000 * (i + 1));
            }
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process a message received in real-time from MTProto
 * This bypasses batch collection since we're handling messages instantly
 */
export async function processRealtimeMessage(message: TelegramMessage): Promise<void> {
    console.log(`[Realtime] Processing message from @${message.channel}...`);

    // Check for duplicate
    const dupeCheck = await isDuplicate(message.text, message.images.length);
    if (dupeCheck.isDupe) {
        console.log(`[Realtime] ⏭️ Skipping duplicate: ${dupeCheck.reason}`);
        setLastProcessed(message.channel, message.id);
        return;
    }

    // Evaluate with AI
    const decision = await evaluateContent(
        message.text,
        message.images,
        message.channel
    );

    if (!decision.shouldPost) {
        console.log(`[Realtime] AI skipped: ${decision.reason}`);
        setLastProcessed(message.channel, message.id);
        return;
    }

    // Post with transformed content
    const transformedMessage: TelegramMessage = {
        ...message,
        text: decision.transformedText || message.text,
    };

    await postMessageWithRetry(transformedMessage);
    await recordPost(transformedMessage.text, message.channel, message.id);
    setLastProcessed(message.channel, message.id);

    console.log(`[Realtime] ✅ Posted instantly from @${message.channel}`);
}
