import cron from "node-cron";
import { config, ensureDirectories, validateConfig } from "./config";
import { runPoster } from "./poster";
import { initBot } from "./bot";
import { validateChannels } from "./scraper";

async function main() {
    console.log("=================================");
    console.log("  Telegram Poster Bot Starting");
    console.log("=================================\n");

    // Validate configuration
    try {
        validateConfig();
    } catch (err: any) {
        console.error("[Error]", err.message);
        console.error("\nPlease set the required environment variables:");
        console.error("  BOT_TOKEN=your_bot_token");
        console.error("  CHANNEL_ID=your_channel_id (e.g., -100xxxxxxxxxx)");
        console.error("  SOURCE_CHANNELS=channel1,channel2 (without @)");
        process.exit(1);
    }

    // Ensure directories exist
    ensureDirectories();

    // Initialize bot
    initBot();

    console.log("[Config] Bot Token:", config.botToken.slice(0, 10) + "...");
    console.log("[Config] Channel ID:", config.channelId);
    console.log("[Config] Source Channels:", config.sourceChannels.join(", "));
    console.log("[Config] Cron Schedule:", config.cronSchedule);
    console.log("[Config] Include Source:", config.includeSource);

    // Validate channels (check which have web preview enabled)
    const { working, failed } = await validateChannels(config.sourceChannels);

    if (failed.length > 0) {
        console.log("[Warning] The following channels have web preview DISABLED:");
        console.log("[Warning] These channels cannot be scraped without using sessions.");
        console.log("[Warning] Ask the channel admins to enable 'Preview Page' or use alternative channels.\n");
    }

    if (working.length === 0) {
        console.error("[Error] No working channels found! Bot cannot proceed.");
        console.error("[Error] Please add channels that have web preview enabled.");
        process.exit(1);
    }

    // Update config to only use working channels
    config.sourceChannels.length = 0;
    config.sourceChannels.push(...working);

    // Run once immediately
    console.log("[Startup] Running initial check...");
    await runPoster();

    // Schedule periodic runs
    console.log(`[Scheduler] Starting cron job: ${config.cronSchedule}`);
    cron.schedule(config.cronSchedule, async () => {
        await runPoster();
    });

    console.log("[Scheduler] Bot is running. Press Ctrl+C to stop.\n");

    // Keep the process alive
    process.on("SIGINT", () => {
        console.log("\n[Shutdown] Stopping bot...");
        process.exit(0);
    });

    process.on("SIGTERM", () => {
        console.log("\n[Shutdown] Stopping bot...");
        process.exit(0);
    });
}

main().catch((err) => {
    console.error("[Fatal Error]", err);
    process.exit(1);
});
