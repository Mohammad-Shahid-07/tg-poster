/**
 * Quiz AI Service
 * Handles AI-powered quality checks and schedule generation
 */

import { quizConfig } from "../config";
import {
    QUALITY_CHECK_SYSTEM_PROMPT,
    SCHEDULE_GENERATION_SYSTEM_PROMPT,
    SUBJECT_SELECTION_SYSTEM_PROMPT,
    getQualityCheckUserPrompt,
    getScheduleGenerationUserPrompt,
    getSubjectSelectionUserPrompt,
} from "../prompts/quiz-prompts";
import type { QualityCheckInput, QualityCheckResult, QuizSchedule, Subject, Chapter } from "../types";

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";

interface MistralMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/**
 * Call Mistral API
 */
async function callMistral(
    messages: MistralMessage[],
    model: string = quizConfig.ai.qualityCheckModel,
    maxTokens: number = quizConfig.ai.maxTokens
): Promise<string | null> {
    if (!MISTRAL_API_KEY) {
        console.error("[QuizAI] MISTRAL_API_KEY not configured");
        return null;
    }

    try {
        const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${MISTRAL_API_KEY}`,
            },
            body: JSON.stringify({
                model,
                messages,
                max_tokens: maxTokens,
                response_format: { type: "json_object" },
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            console.error("[QuizAI] Mistral API error:", response.status, error);
            return null;
        }

        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        return data.choices?.[0]?.message?.content || null;
    } catch (error: any) {
        console.error("[QuizAI] API call failed:", error.message);
        return null;
    }
}

/**
 * Parse JSON response safely
 */
function parseJsonResponse<T>(response: string | null, defaultValue: T): T {
    if (!response) return defaultValue;

    try {
        // Try to extract JSON array or object from response
        const jsonMatch = response.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return JSON.parse(response);
    } catch (error) {
        console.error("[QuizAI] Failed to parse JSON response:", error);
        return defaultValue;
    }
}

/**
 * Check quality of questions
 * Only sends English text + options to save tokens
 */
export async function checkQuestionQuality(
    questions: QualityCheckInput[]
): Promise<QualityCheckResult[]> {
    if (questions.length === 0) {
        return [];
    }

    console.log(`[QuizAI] Checking quality of ${questions.length} questions`);

    const messages: MistralMessage[] = [
        { role: "system", content: QUALITY_CHECK_SYSTEM_PROMPT },
        { role: "user", content: getQualityCheckUserPrompt(questions) },
    ];

    const response = await callMistral(messages);

    if (!response) {
        // If AI fails, approve all questions (fail-safe)
        console.warn("[QuizAI] Quality check failed, approving all questions");
        return questions.map(q => ({ id: q.id, approved: true }));
    }

    const results = parseJsonResponse<QualityCheckResult[]>(response, []);

    // Ensure all questions have a result
    const resultMap = new Map(results.map(r => [r.id, r]));
    const finalResults: QualityCheckResult[] = questions.map(q => {
        const result = resultMap.get(q.id);
        return result || { id: q.id, approved: true };
    });

    const approved = finalResults.filter(r => r.approved).length;
    const rejected = finalResults.filter(r => !r.approved).length;
    console.log(`[QuizAI] Quality check complete: ${approved} approved, ${rejected} rejected`);

    // Log rejection reasons
    finalResults
        .filter(r => !r.approved)
        .forEach(r => console.log(`[QuizAI] Rejected ${r.id}: ${r.reason}`));

    return finalResults;
}

/**
 * Subject summary for schedule generation
 */
interface SubjectSummary {
    id: string;
    name: string;
    totalQuestions: number;
    chapters: Array<{
        id: string;
        name: string;
        questionCount: number;
    }>;
}

/**
 * Generate quiz schedule for upcoming days
 */
export async function generateSchedule(
    subjects: SubjectSummary[],
    daysAhead: number = 7
): Promise<Omit<QuizSchedule, 'id' | 'status' | 'createdAt'>[]> {
    if (subjects.length === 0) {
        console.warn("[QuizAI] No subjects available for schedule generation");
        return [];
    }

    console.log(`[QuizAI] Generating schedule for ${daysAhead} days`);

    const messages: MistralMessage[] = [
        { role: "system", content: SCHEDULE_GENERATION_SYSTEM_PROMPT },
        { role: "user", content: getScheduleGenerationUserPrompt(subjects, daysAhead) },
    ];

    const response = await callMistral(messages, quizConfig.ai.scheduleModel);

    if (!response) {
        console.error("[QuizAI] Schedule generation failed");
        return [];
    }

    const schedules = parseJsonResponse<Array<{
        date: string;
        time: '08:00' | '20:00';
        subjectIds: string[];
        chapterIds: string[];
        questionCount: number;
        title: string;
    }>>(response, []);

    console.log(`[QuizAI] Generated ${schedules.length} scheduled quizzes`);

    // Add subject/chapter names
    const enrichedSchedules = schedules.map(s => ({
        ...s,
        subjectNames: subjects
            .filter(sub => s.subjectIds.includes(sub.id))
            .map(sub => sub.name),
        chapterNames: subjects
            .flatMap(sub => sub.chapters)
            .filter(ch => s.chapterIds.includes(ch.id))
            .map(ch => ch.name),
    }));

    return enrichedSchedules;
}

/**
 * Create subject summaries from raw subjects and chapters
 */
export function createSubjectSummaries(
    subjects: Subject[],
    chapters: Chapter[]
): SubjectSummary[] {
    return subjects.map(subject => {
        const subjectChapters = chapters
            .filter(ch => ch.subjectId === subject._id)
            .map(ch => ({
                id: ch._id,
                name: ch.name,
                questionCount: ch.totalQuestions,
            }));

        return {
            id: subject._id,
            name: subject.name,
            totalQuestions: subject.totalQuestions,
            chapters: subjectChapters,
        };
    });
}

/**
 * AI Selection Result
 */
export interface AISelectionResult {
    subjectIds: string[];
    chapterIds: string[];
    title: string;
    reasoning: string;
}

/**
 * Use AI to select subjects and chapters for a quiz
 */
export async function selectSubjectsWithAI(
    subjects: SubjectSummary[],
    questionCount: number
): Promise<AISelectionResult | null> {
    if (subjects.length === 0) {
        console.warn("[QuizAI] No subjects available for AI selection");
        return null;
    }

    console.log(`[QuizAI] 🤖 AI selecting subjects/chapters for ${questionCount} questions...`);

    const messages: MistralMessage[] = [
        { role: "system", content: SUBJECT_SELECTION_SYSTEM_PROMPT },
        { role: "user", content: getSubjectSelectionUserPrompt(subjects, questionCount) },
    ];

    const response = await callMistral(messages);

    if (!response) {
        console.error("[QuizAI] AI selection failed");
        return null;
    }

    const result = parseJsonResponse<AISelectionResult | null>(response, null);

    if (result) {
        console.log(`[QuizAI] 🎯 AI selected: "${result.title}"`);
        console.log(`[QuizAI] 📝 Reasoning: ${result.reasoning}`);
    }

    return result;
}

