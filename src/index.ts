/**
 * Telegram Poster Bot - Entry Point
 */
import cron from "node-cron";
import { config, ensureDirectories, validateConfig, loadLastProcessed } from "./config";
import { runPoster } from "./poster";
import { initBot } from "./bot";
import { validateChannels } from "./scraper";
import { loadPostedContent } from "./data/content-tracker";
import { isStorageConfigured } from "./data/storage";
import { loadSession, getAuthStatus, isMTProtoConfigured } from "./mtproto-scraper";
import { loadChannels, getPublicChannels } from "./data/channels";
import { startServer } from "./server";
import { initQuizModule } from "./quiz";

async function main() {
  console.log("=================================");
  console.log("  Telegram Poster Bot Starting");
  console.log("=================================\n");

  try {
    validateConfig();
  } catch (err: any) {
    console.error("[Error]", err.message);
    console.error("\nRequired: BOT_TOKEN, CHANNEL_ID");
    process.exit(1);
  }

  ensureDirectories();

  // Load from Supabase
  if (isStorageConfigured()) {
    console.log("[Storage] Loading from Supabase...");
    await loadLastProcessed();
    await loadPostedContent();
    await loadSession();
    await loadChannels();
  }

  // Check MTProto status
  if (isMTProtoConfigured()) {
    const status = getAuthStatus();
    if (status.authenticated) {
      console.log("[MTProto] Session available - can access private channels");
    } else {
      console.log("[MTProto] Not authenticated - visit /auth to login");
    }
  }

  // Initialize bot
  initBot();

  // Start HTTP server
  startServer();

  // Validate channels from database
  const allChannels = getPublicChannels();
  if (allChannels.length > 0) {
    const { failed } = await validateChannels(allChannels);
    if (failed.length > 0) {
      console.log("[Warning] Some channels have web preview disabled");
    }
  } else {
    console.log("[Info] No channels configured. Add channels at /channels");
  }

  // Initialize quiz module (runs on 8 AM and 8 PM IST schedule)
  await initQuizModule();

  // Run initial poster check
  console.log("[Startup] Running initial check...");
  await runPoster();

  // Schedule poster cron job
  console.log(`[Scheduler] Cron: ${config.cronSchedule}`);
  cron.schedule(config.cronSchedule, () => runPoster());

  console.log("[Bot] Running. Press Ctrl+C to stop.\n");

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
