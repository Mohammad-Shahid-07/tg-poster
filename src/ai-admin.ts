/**
 * AI Admin - Acts as an intelligent channel admin
 * Not just "forward or not" - actually rewrites and adds value
 */

import { aiConfig } from "./ai-config";

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";

export interface AdminDecision {
    shouldPost: boolean;
    reason: string;
    transformedText: string;
}

interface MistralMessage {
    role: "user" | "assistant" | "system";
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

/**
 * Call Mistral API
 */
async function callMistral(
    messages: MistralMessage[],
    model: string,
    maxTokens: number = 1000
): Promise<string | null> {
    try {
        const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${MISTRAL_API_KEY}`,
            },
            body: JSON.stringify({
                model,
                messages,
                max_tokens: maxTokens,
                temperature: 0.7,
            }),
        });

        const data = (await response.json()) as any;

        if (data.error) {
            console.error(`[AI Admin] API Error: ${data.error.message}`);
            return null;
        }

        return data.choices?.[0]?.message?.content || null;
    } catch (err: any) {
        console.error(`[AI Admin] Request failed:`, err.message);
        return null;
    }
}

/**
 * The main AI admin function - evaluates AND transforms content
 */
export async function evaluateContent(
    text: string,
    imageUrls: string[] = [],
    sourceChannel: string
): Promise<AdminDecision> {
    if (!MISTRAL_API_KEY) {
        console.warn("[AI Admin] No API key - passing through original");
        return { shouldPost: true, reason: "No AI", transformedText: text };
    }

    console.log(`[AI Admin] Processing content from @${sourceChannel}...`);

    const hasImages = imageUrls.length > 0;
    const model = hasImages ? aiConfig.models.contentEvaluation : aiConfig.models.textDecision;

    // Build the prompt - this is the key part
    const systemPrompt = `You are admin for "${aiConfig.channel.name}".

STYLE RULES (VERY IMPORTANT):
1. Keep it SHORT - 2-4 lines max, no essays
2. Use BILINGUAL - mix Hindi + English naturally (Hinglish style)
3. Be CASUAL - like chatting with friends, not formal corporate
4. NO filler text - no "Stay prepared!", "Good luck!", "Stay informed!"
5. NO excessive emojis - 1-2 max, or none
6. NO hashtags unless truly necessary
7. Just state the facts directly

GOOD EXAMPLE:
"RPSC ka जलवा बरकरार 

APO मे मात्र 4 स्टूडेंट पास किया है

Vacancy - 181"

BAD EXAMPLE (too formal, too long):
"📢 REET Exam Updates! 📢
The Rajasthan Public Service Commission has released key details...
Stay informed and keep preparing! 🚀
#REET #TeacherExam"

WHAT TO DO:
- Skip if not relevant to rajasthan govt exams
- Remove source channel branding (@mentions, join links)
- Keep original information, just clean it up
- Use hindi/english both 
- Give as much info possible in the caption

RESPOND JSON:
{"shouldPost": true/false, "reason": "short reason", "transformedText": "your short version"}`;


    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

    userContent.push({
        type: "text",
        text: `SOURCE: @${sourceChannel}

ORIGINAL CONTENT:
${text || "(only images, no text)"}

${hasImages ? `This post has ${imageUrls.length} image(s).` : ""}

Now evaluate and REWRITE this content. Remember: don't just copy, create YOUR version.`,
    });

    // Add images for vision analysis
    for (const url of imageUrls.slice(0, 3)) {
        userContent.push({
            type: "image_url",
            image_url: { url },
        });
    }

    const messages: MistralMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
    ];

    const response = await callMistral(messages, model, 1500);

    if (!response) {
        console.warn("[AI Admin] AI failed - using original");
        return { shouldPost: true, reason: "AI unavailable", transformedText: text };
    }

    try {
        // Parse JSON response
        let jsonStr = response;
        const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch?.[1]) jsonStr = jsonMatch[1];

        const decision = JSON.parse(jsonStr.trim()) as AdminDecision;

        // Validate the response
        if (typeof decision.shouldPost !== "boolean") {
            throw new Error("Invalid shouldPost");
        }



        console.log(`[AI Admin] ${decision.shouldPost ? "✅ POSTING" : "❌ SKIPPING"}: ${decision.reason}`);

        if (decision.shouldPost) {
            console.log(`[AI Admin] Rewritten: "${decision.transformedText.slice(0, 100)}..."`);
        }

        return decision;
    } catch (err) {
        console.error("[AI Admin] Failed to parse:", response.slice(0, 200));
        return { shouldPost: true, reason: "Parse failed", transformedText: text };
    }
}

/**
 * Analyze an image and describe what's in it
 */
export async function analyzeImage(imageUrl: string): Promise<string | null> {
    if (!MISTRAL_API_KEY) return null;

    const messages: MistralMessage[] = [{
        role: "user",
        content: [
            { type: "text", text: "Describe this image. What is it? Is it educational content related to exams?" },
            { type: "image_url", image_url: { url: imageUrl } },
        ],
    }];

    return callMistral(messages, aiConfig.models.imageAnalysis, 300);
}
