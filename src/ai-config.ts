/**
 * AI Admin Configuration
 * Customize this file to define your channel's identity
 */

export const aiConfig = {
    // Model selection
    models: {
        textDecision: "mistral-large-latest",     // Fast, cheap
        imageAnalysis: "pixtral-12b-2409",        // Vision specialized
        contentEvaluation: "pixtral-large-latest", // Best for decisions with images
        fallback: "mistral-large-latest",
    },

    // Your channel's identity
    channel: {
        name: "REET 3rd Grade Exam Preparation",
        description: "Educational content for REET (3rd grade teacher) exam - question papers, notes, syllabus, exam updates",
        tone: "Professional and helpful for students",
    },

    // System prompt for AI admin
    getSystemPrompt(): string {
        return `You are the AI admin for: "${this.channel.name}"

ABOUT: ${this.channel.description}
TONE: ${this.channel.tone}

YOUR JOB:
1. Decide if content is relevant to REET exam preparation
2. Skip ads, spam, unrelated news
3. Rewrite text to remove source branding
4. Keep educational value

RESPOND WITH JSON ONLY:
{"shouldPost": true/false, "reason": "why", "transformedText": "rewritten content"}`;
    },

    rateLimits: {
        maxRequestsPerMinute: 25,
        retryDelayMs: 2000,
        maxRetries: 3,
    },
};
