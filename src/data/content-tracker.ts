/**
 * Content Tracker - Prevents duplicate posts using AI + Supabase storage
 */

import { getValue, setValue, isStorageConfigured } from "./storage";
import { aiConfig } from "../ai-config";

interface PostedContent {
    summary: string;
    hash: string;
    sourceChannel: string;
    originalId: string;
    postedAt: string;
}

const MAX_STORED_POSTS = 100;

// In-memory cache
let postsCache: PostedContent[] = [];
let cacheLoaded = false;

/**
 * Load posts from Supabase (call on startup)
 */
export async function loadPostedContent(): Promise<void> {
    if (isStorageConfigured()) {
        postsCache = await getValue<PostedContent[]>("posted_content", []);
        console.log("[Dedup] Loaded", postsCache.length, "posts from Supabase");
    }
    cacheLoaded = true;
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
 * Check for duplicates using AI
 */
export async function isDuplicate(text: string, imageCount: number, imageUrls: string[] = []): Promise<{ isDupe: boolean; reason?: string }> {
    if (!text.trim() && imageCount === 0) return { isDupe: false };

    // Include image identifiers in hash for better image-based duplicate detection
    const imageFingerprint = imageUrls
        .map(url => {
            const match = url.match(/\/([^\/]+)\.(jpg|jpeg|png|webp)$/i);
            return match ? match[1] : url.split('/').pop() || "";
        })
        .sort()
        .join("|");

    const contentToHash = `${text}::${imageFingerprint}`;
    const currentHash = hashContent(contentToHash);

    // Exact hash match
    const exactMatch = postsCache.find((p) => p.hash === currentHash);
    if (exactMatch) {
        return { isDupe: true, reason: `Exact match from @${exactMatch.sourceChannel}` };
    }

    if (postsCache.length === 0) return { isDupe: false };

    const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
    if (!MISTRAL_API_KEY) return { isDupe: false };

    // Send last 20 summaries to AI
    const recentPosts = postsCache.slice(-20);
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
                    content: `Recent posts:\n${summariesList}\n\nNEW:\n${text.slice(0, 1000)}\n\nIs NEW a duplicate? Same exam/announcement = duplicate.\nJSON only: {"isDuplicate": true/false, "matchedPost": <num or null>, "reason": "why"}`,
                }],
                max_tokens: 100,
                temperature: 0.1,
            }),
        });

        const data = (await response.json()) as any;
        let content = data.choices?.[0]?.message?.content || "";

        // Extract JSON - try multiple patterns
        let jsonStr = content;
        const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch?.[1]) {
            jsonStr = codeBlockMatch[1];
        } else {
            // Find JSON object directly
            const jsonObjMatch = content.match(/\{[\s\S]*\}/);
            if (jsonObjMatch) {
                jsonStr = jsonObjMatch[0];
            }
        }

        const result = JSON.parse(jsonStr.trim());

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
 * Record a post
 */
export async function recordPost(text: string, sourceChannel: string, originalId: string, imageUrls: string[] = []): Promise<void> {
    const summary = await generateSummary(text);

    // Include image identifiers in hash (consistent with isDuplicate)
    const imageFingerprint = imageUrls
        .map(url => {
            const match = url.match(/\/([^\/]+)\.(jpg|jpeg|png|webp)$/i);
            return match ? match[1] : url.split('/').pop() || "";
        })
        .sort()
        .join("|");

    const contentToHash = `${text}::${imageFingerprint}`;

    postsCache.push({
        summary,
        hash: hashContent(contentToHash),
        sourceChannel,
        originalId,
        postedAt: new Date().toISOString(),
    });

    // Trim to max size
    if (postsCache.length > MAX_STORED_POSTS) {
        postsCache = postsCache.slice(-MAX_STORED_POSTS);
    }

    // Save to Supabase
    if (isStorageConfigured()) {
        await setValue("posted_content", postsCache);
    }

    console.log(`[Dedup] Recorded: "${summary}"`);
}
