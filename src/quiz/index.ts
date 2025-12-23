/**
 * Quiz Module - Entry Point
 * Telegram Quiz Bot with AstraDB integration
 */

import { quizConfig, getQuizConfigStatus } from "./config";
import { testConnection, getCollectionStats } from "./services/astra-client";
import { initScheduler, triggerTestQuiz, generateWeeklySchedule, getUpcomingSchedules } from "./services/quiz-scheduler";

export { quizConfig } from "./config";
export * from "./types";
export * from "./services/quiz-data";
export * from "./services/quiz-ai";
export * from "./services/quiz-bot";
export * from "./services/quiz-scheduler";

/**
 * Initialize the quiz module
 * Called automatically on application startup
 */
export async function initQuizModule(): Promise<boolean> {
    console.log("\n================================");
    console.log("  Quiz Module Initializing");
    console.log("================================\n");

    const status = getQuizConfigStatus();

    // Check configuration
    if (!status.astraConfigured) {
        console.log("[Quiz] ⚠️  AstraDB not configured");
        console.log("[Quiz] Add ASTRA_DB_ENDPOINT and ASTRA_DB_TOKEN to .env to enable");
        console.log("[Quiz] Quiz module disabled\n");
        return false;
    }

    if (!status.channelConfigured) {
        console.log("[Quiz] ⚠️  No channel configured for quizzes");
        console.log("[Quiz] Quiz module disabled\n");
        return false;
    }

    console.log(`[Quiz] Channel: ${status.quizChannelId}`);

    // Test AstraDB connection
    console.log("[Quiz] Testing AstraDB connection...");
    const connected = await testConnection();

    if (!connected) {
        console.error("[Quiz] ❌ Failed to connect to AstraDB");
        console.log("[Quiz] Quiz module disabled\n");
        return false;
    }

    // Get collection stats
    const stats = await getCollectionStats();
    console.log(`[Quiz] 📊 Database stats:`);
    console.log(`     - Subjects: ${stats.subjects}`);
    console.log(`     - Chapters: ${stats.chapters}`);
    console.log(`     - Questions: ${stats.questions}`);

    if (stats.questions === 0) {
        console.warn("[Quiz] ⚠️  No questions found in database");
    }

    // Check upcoming schedules
    const upcoming = await getUpcomingSchedules();
    console.log(`[Quiz] 📅 Upcoming quizzes: ${upcoming.length}`);

    // Initialize scheduler for 8 AM and 8 PM IST
    initScheduler();

    console.log("\n[Quiz] ✅ Quiz module initialized successfully");
    console.log("[Quiz] 📅 Quizzes scheduled for 8:00 AM and 8:00 PM IST");
    console.log("================================\n");

    return true;
}

/**
 * Get quiz module status
 */
export function getQuizStatus(): {
    enabled: boolean;
    astraConfigured: boolean;
    channelId: string;
    quizTimes: readonly string[];
} {
    const config = getQuizConfigStatus();

    return {
        enabled: config.astraConfigured && config.channelConfigured,
        astraConfigured: config.astraConfigured,
        channelId: config.quizChannelId,
        quizTimes: quizConfig.timing.quizTimes,
    };
}

// Export for manual triggering via API
export { triggerTestQuiz, generateWeeklySchedule };
