/**
 * Quiz Module Configuration
 * Centralized configuration for the quiz bot feature
 */

import { config } from "../config";

export const quizConfig = {
    astra: {
        endpoint: process.env.ASTRA_DB_ENDPOINT || "",
        token: process.env.ASTRA_DB_TOKEN || "",
        namespace: process.env.ASTRA_DB_NAMESPACE || "default_keyspace",
        collections: {
            questions: process.env.ASTRA_DB_COLLECTION_QUESTIONS || "questionsbank",
            subjects: process.env.ASTRA_DB_COLLECTION_SUBJECTS || "subjects",
            chapters: process.env.ASTRA_DB_COLLECTION_CHAPTERS || "chapters",
        },
    },

    telegram: {
        // Use QUIZ_CHANNEL_ID if set, otherwise fall back to main channel
        channelId: process.env.QUIZ_CHANNEL_ID || config.channelId,
    },

    timing: {
        // Fixed quiz times in IST
        quizTimes: ['08:00', '20:00'] as const,

        // Send notification this many minutes before quiz
        notificationMinutesBefore: 30,

        // Delay between Hindi and English versions of same question (ms)
        delayBetweenLanguages: 3000,

        // Delay between question pairs (ms)
        questionInterval: parseInt(process.env.QUIZ_QUESTION_INTERVAL || "3000"),
    },

    selection: {
        // Default number of questions per quiz
        defaultQuestionCount: parseInt(process.env.QUIZ_DEFAULT_COUNT || "20"),

        // Target difficulty distribution
        difficultyRatio: {
            EASY: 0.3,
            MEDIUM: 0.5,
            HARD: 0.2,
        },

        // Don't repeat questions used in last N days
        avoidRecentDays: 7,
    },

    ai: {
        // Model for quality checking
        qualityCheckModel: "mistral-large-latest",

        // Model for schedule generation
        scheduleModel: "mistral-large-latest",

        // Max tokens for quality check response
        maxTokens: 2000,
    },
};

/**
 * Validate that required quiz configuration is present
 */
export function validateQuizConfig(): boolean {
    const hasAstra = Boolean(
        quizConfig.astra.endpoint &&
        quizConfig.astra.token
    );

    const hasChannel = Boolean(quizConfig.telegram.channelId);

    return hasAstra && hasChannel;
}

/**
 * Get configuration status for logging
 */
export function getQuizConfigStatus(): {
    astraConfigured: boolean;
    channelConfigured: boolean;
    quizChannelId: string;
} {
    return {
        astraConfigured: Boolean(quizConfig.astra.endpoint && quizConfig.astra.token),
        channelConfigured: Boolean(quizConfig.telegram.channelId),
        quizChannelId: quizConfig.telegram.channelId,
    };
}
