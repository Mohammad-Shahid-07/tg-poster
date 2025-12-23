/**
 * Quiz Data Service
 * Handles fetching questions from AstraDB with smart selection algorithm
 */

import {
    getQuestionsCollection,
    getSubjectsCollection,
    getChaptersCollection
} from "./astra-client";
import { quizConfig } from "../config";
import { getValue, setValue } from "../../data/storage";
import type {
    AstraQuestion,
    Subject,
    Chapter,
    QuestionSelectionOptions,
    UsedQuestionRecord
} from "../types";

const USED_QUESTIONS_KEY = "quiz_used_questions";

/**
 * Get all active subjects
 */
export async function getSubjects(): Promise<Subject[]> {
    try {
        const collection = getSubjectsCollection();
        const cursor = collection.find({ isActive: true });
        const subjects = await cursor.toArray();
        return subjects;
    } catch (error: any) {
        console.error("[QuizData] Failed to fetch subjects:", error.message);
        return [];
    }
}

/**
 * Get chapters, optionally filtered by subject
 */
export async function getChapters(subjectId?: string): Promise<Chapter[]> {
    try {
        const collection = getChaptersCollection();
        const filter: Record<string, any> = { isActive: true };

        if (subjectId) {
            filter.subjectId = subjectId;
        }

        const cursor = collection.find(filter);
        const chapters = await cursor.toArray();
        return chapters;
    } catch (error: any) {
        console.error("[QuizData] Failed to fetch chapters:", error.message);
        return [];
    }
}

/**
 * Get a subject by ID
 */
export async function getSubjectById(subjectId: string): Promise<Subject | null> {
    try {
        const collection = getSubjectsCollection();
        return await collection.findOne({ _id: subjectId });
    } catch (error: any) {
        console.error("[QuizData] Failed to fetch subject:", error.message);
        return null;
    }
}

/**
 * Get a chapter by ID
 */
export async function getChapterById(chapterId: string): Promise<Chapter | null> {
    try {
        const collection = getChaptersCollection();
        return await collection.findOne({ _id: chapterId });
    } catch (error: any) {
        console.error("[QuizData] Failed to fetch chapter:", error.message);
        return null;
    }
}

/**
 * Get recently used question IDs (stored in Supabase)
 */
async function getRecentlyUsedQuestionIds(days: number): Promise<Set<string>> {
    try {
        const records = await getValue<UsedQuestionRecord[]>(USED_QUESTIONS_KEY, []);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const recentIds = new Set<string>();
        for (const record of records) {
            if (new Date(record.usedAt) > cutoffDate) {
                recentIds.add(record.questionId);
            }
        }

        return recentIds;
    } catch (error: any) {
        console.error("[QuizData] Failed to get used questions:", error.message);
        return new Set();
    }
}

/**
 * Mark questions as used (persist to Supabase)
 */
export async function markQuestionsUsed(
    questionIds: string[],
    scheduleId: string
): Promise<void> {
    try {
        const existing = await getValue<UsedQuestionRecord[]>(USED_QUESTIONS_KEY, []);
        const now = new Date().toISOString();

        const newRecords: UsedQuestionRecord[] = questionIds.map(id => ({
            questionId: id,
            scheduleId,
            usedAt: now,
        }));

        // Keep only records from last 30 days to avoid unlimited growth
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30);

        const filteredExisting = existing.filter(
            r => new Date(r.usedAt) > cutoffDate
        );

        await setValue(USED_QUESTIONS_KEY, [...filteredExisting, ...newRecords]);
        console.log(`[QuizData] Marked ${questionIds.length} questions as used`);
    } catch (error: any) {
        console.error("[QuizData] Failed to mark questions used:", error.message);
    }
}

/**
 * Shuffle array using Fisher-Yates algorithm
 */
function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    return shuffled;
}

/**
 * Select questions based on difficulty ratio
 */
function selectByDifficultyRatio(
    questions: AstraQuestion[],
    count: number,
    ratio: { EASY: number; MEDIUM: number; HARD: number }
): AstraQuestion[] {
    const easy = questions.filter(q => q.difficultyLevel === 'EASY');
    const medium = questions.filter(q => q.difficultyLevel === 'MEDIUM');
    const hard = questions.filter(q => q.difficultyLevel === 'HARD');
    const unknown = questions.filter(q => !q.difficultyLevel);

    // Calculate target counts
    const easyCount = Math.round(count * ratio.EASY);
    const mediumCount = Math.round(count * ratio.MEDIUM);
    const hardCount = count - easyCount - mediumCount;

    // Select from each pool
    const selected: AstraQuestion[] = [];

    selected.push(...shuffleArray(easy).slice(0, easyCount));
    selected.push(...shuffleArray(medium).slice(0, mediumCount));
    selected.push(...shuffleArray(hard).slice(0, hardCount));

    // Fill remaining with unknown difficulty or any available
    const remaining = count - selected.length;
    if (remaining > 0) {
        const used = new Set(selected.map(q => q._id));
        const pool = [...unknown, ...easy, ...medium, ...hard]
            .filter(q => !used.has(q._id));
        selected.push(...shuffleArray(pool).slice(0, remaining));
    }

    return shuffleArray(selected);
}

/**
 * Main question selection function with smart algorithm
 */
export async function selectQuestions(
    options: QuestionSelectionOptions
): Promise<AstraQuestion[]> {
    const {
        subjectIds = [],
        chapterIds = [],
        count,
        difficultyRatio = quizConfig.selection.difficultyRatio,
        excludeRecentDays = quizConfig.selection.avoidRecentDays,
    } = options;

    try {
        const collection = getQuestionsCollection();

        // Build filter
        const filter: Record<string, any> = {
            verified: true, // Only verified questions
        };

        // Add subject/chapter filters if provided
        if (subjectIds.length > 0) {
            filter.subjectId = { $in: subjectIds };
        }

        if (chapterIds.length > 0) {
            filter.chapterId = { $in: chapterIds };
        }

        // Fetch questions (get more than needed for filtering)
        const fetchCount = Math.min(count * 5, 500); // Fetch 5x needed, max 500
        const cursor = collection.find(filter, { limit: fetchCount });
        let questions = await cursor.toArray();

        console.log(`[QuizData] Fetched ${questions.length} questions from AstraDB`);

        // Get recently used questions
        const recentlyUsed = await getRecentlyUsedQuestionIds(excludeRecentDays);
        console.log(`[QuizData] Excluding ${recentlyUsed.size} recently used questions`);

        // Filter out recently used
        questions = questions.filter(q => !recentlyUsed.has(q._id));

        // Deduplicate by dedupeKey if available
        const seenDedupeKeys = new Set<string>();
        questions = questions.filter(q => {
            if (q.dedupeKey) {
                if (seenDedupeKeys.has(q.dedupeKey)) {
                    return false;
                }
                seenDedupeKeys.add(q.dedupeKey);
            }
            return true;
        });

        console.log(`[QuizData] After filtering: ${questions.length} available questions`);

        // Not enough questions
        if (questions.length < count) {
            console.warn(`[QuizData] Only ${questions.length} questions available, requested ${count}`);
            return shuffleArray(questions);
        }

        // Apply difficulty-based selection
        const selected = selectByDifficultyRatio(questions, count, difficultyRatio);

        console.log(`[QuizData] Selected ${selected.length} questions`);

        return selected;
    } catch (error: any) {
        console.error("[QuizData] Failed to select questions:", error.message);
        return [];
    }
}

/**
 * Get specific questions by their IDs
 */
export async function getQuestionsByIds(ids: string[]): Promise<AstraQuestion[]> {
    try {
        const collection = getQuestionsCollection();
        const cursor = collection.find({ _id: { $in: ids } });
        return await cursor.toArray();
    } catch (error: any) {
        console.error("[QuizData] Failed to fetch questions by IDs:", error.message);
        return [];
    }
}

/**
 * Get subject and chapter names for display
 */
export async function getDisplayNames(
    subjectIds: string[],
    chapterIds: string[]
): Promise<{ subjectNames: string[]; chapterNames: string[] }> {
    try {
        const [subjects, chapters] = await Promise.all([
            Promise.all(subjectIds.map(id => getSubjectById(id))),
            Promise.all(chapterIds.map(id => getChapterById(id))),
        ]);

        return {
            subjectNames: subjects.filter(Boolean).map(s => s!.name),
            chapterNames: chapters.filter(Boolean).map(c => c!.name),
        };
    } catch (error: any) {
        console.error("[QuizData] Failed to get display names:", error.message);
        return { subjectNames: [], chapterNames: [] };
    }
}
