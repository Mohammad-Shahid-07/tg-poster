/**
 * Content Tracker - Prevents duplicate posts using AI
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { config } from "./config";
import { aiConfig } from "./ai-config";

interface PostedContent {
    summary: string;
    hash: string;
    sourceChannel: string;
    originalId: string;
    postedAt: string;
}

interface ContentStore {
    posts: PostedContent[];
}

const STORE_PATH = () => `${config.dataDir}/posted-content.json`;
const MAX_STORED_POSTS = 500;

function loadStore(): ContentStore {
    try {
        if (existsSync(STORE_PATH())) {
            return JSON.parse(readFileSync(STORE_PATH(), "utf-8"));
        }
    } catch {
        // ignore
    }
    return { posts: [] };
}

function saveStore(store: ContentStore): void {
    if (store.posts.length > MAX_STORED_POSTS) {
        store.posts = store.posts.slice(-MAX_STORED_POSTS);
    }
    writeFileSync(STORE_PATH(), JSON.stringify(store, null, 2));
}

function hashContent(text: string): string {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim().slice(0, 500);
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
        hash = hash & hash;
    }
    return hash.toString(36);
}

async function generateSummary(text: string): Promise<string> {
    const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
    if (!MISTRAL_API_KEY || !text.trim()) {
        return text.slice(0, 200).toLowerCase().trim();
    }

    try {
        const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${MISTRAL_API_KEY}`,
            },
            body: JSON.stringify({
                model: aiConfig.models.textDecision,
                messages: [{
                    role: "user",
                    content: `Summarize in 10-15 words. Only the summary:\n\n${text.slice(0, 1000)}`,
                }],
                max_tokens: 50,
                temperature: 0.3,
            }),
        });
        const data = (await response.json()) as any;
        return data.choices?.[0]?.message?.content?.toLowerCase().trim() || text.slice(0, 200);
    } catch {
        return text.slice(0, 200).toLowerCase().trim();
    }
}

/**
 * Check for duplicates using AI semantic comparison
 */
export async function isDuplicate(text: string, imageCount: number): Promise<{ isDupe: boolean; reason?: string }> {
    if (!text.trim() && imageCount === 0) return { isDupe: false };

    const store = loadStore();
    const currentHash = hashContent(text);

    // Exact hash match
    const exactMatch = store.posts.find((p) => p.hash === currentHash);
    if (exactMatch) {
        return { isDupe: true, reason: `Exact match from @${exactMatch.sourceChannel}` };
    }

    if (store.posts.length === 0) return { isDupe: false };

    const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
    if (!MISTRAL_API_KEY) return { isDupe: false };

    // Send last 20 summaries to AI for comparison
    const recentPosts = store.posts.slice(-20);
    const summariesList = recentPosts.map((p, i) => `${i + 1}. [${p.sourceChannel}] ${p.summary}`).join("\n");

    console.log(`[Dedup] Checking against ${recentPosts.length} recent posts...`);

    try {
        const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${MISTRAL_API_KEY}`,
            },
            body: JSON.stringify({
                model: aiConfig.models.textDecision,
                messages: [{
                    role: "user",
                    content: `Recent posts:\n${summariesList}\n\nNEW:\n${text.slice(0, 1000)}\n\nIs NEW a duplicate of any recent post? Same exam/announcement = duplicate.\nJSON only: {"isDuplicate": true/false, "matchedPost": <num or null>, "reason": "why"}`,
                }],
                max_tokens: 100,
                temperature: 0.1,
            }),
        });

        const data = (await response.json()) as any;
        let content = data.choices?.[0]?.message?.content || "";

        // Extract JSON
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch?.[1]) content = jsonMatch[1];

        const result = JSON.parse(content.trim());

        if (result.isDuplicate && result.matchedPost) {
            const matched = recentPosts[result.matchedPost - 1];
            console.log(`[Dedup] Duplicate: ${result.reason}`);
            return { isDupe: true, reason: `${result.reason} (from @${matched?.sourceChannel})` };
        }

        console.log(`[Dedup] Not duplicate: ${result.reason}`);
        return { isDupe: false };
    } catch (err: any) {
        console.error("[Dedup] AI check failed:", err.message);
        return { isDupe: false };
    }
}

/**
 * Record a post to prevent future duplicates
 */
export async function recordPost(text: string, sourceChannel: string, originalId: string): Promise<void> {
    const store = loadStore();
    const summary = await generateSummary(text);

    store.posts.push({
        summary,
        hash: hashContent(text),
        sourceChannel,
        originalId,
        postedAt: new Date().toISOString(),
    });

    saveStore(store);
    console.log(`[Dedup] Recorded: "${summary}"`);
}
