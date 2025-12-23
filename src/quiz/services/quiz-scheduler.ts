/**
 * Quiz Scheduler Service
 * Manages quiz scheduling with cron jobs for 8 AM and 8 PM IST
 */

import cron from "node-cron";
import { quizConfig } from "../config";
import { getValue, setValue } from "../../data/storage";
import { selectQuestions, markQuestionsUsed, getSubjects, getChapters } from "./quiz-data";
import { checkQuestionQuality, generateSchedule, createSubjectSummaries, selectSubjectsWithAI } from "./quiz-ai";
import { runQuiz, sendQuizNotification } from "./quiz-bot";
import type { QuizSchedule, QualityCheckInput, AstraQuestion } from "../types";

const SCHEDULES_KEY = "quiz_schedules";

/**
 * Generate a unique ID
 */
function generateId(): string {
    return `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get current date in IST (YYYY-MM-DD)
 */
function getISTDate(): string {
    const now = new Date();
    // IST is UTC+5:30
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    return istDate.toISOString().split('T')[0] as string;
}

/**
 * Get current time in IST (HH:MM)
 */
function getISTTime(): string {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    return istDate.toISOString().split('T')[1]!.substring(0, 5);
}

/**
 * Load schedules from storage
 */
export async function loadSchedules(): Promise<QuizSchedule[]> {
    return await getValue<QuizSchedule[]>(SCHEDULES_KEY, []);
}

/**
 * Save schedules to storage
 */
export async function saveSchedules(schedules: QuizSchedule[]): Promise<void> {
    await setValue(SCHEDULES_KEY, schedules);
}

/**
 * Get upcoming schedules (not completed or cancelled)
 */
export async function getUpcomingSchedules(): Promise<QuizSchedule[]> {
    const schedules = await loadSchedules();
    const today = getISTDate();

    return schedules.filter(s =>
        s.status === 'scheduled' &&
        s.date >= today
    );
}

/**
 * Get schedule for specific date and time
 */
export async function getScheduleFor(date: string, time: '08:00' | '20:00'): Promise<QuizSchedule | null> {
    const schedules = await loadSchedules();
    return schedules.find(s =>
        s.date === date &&
        s.time === time &&
        s.status === 'scheduled'
    ) || null;
}

/**
 * Create a new schedule
 */
export async function createSchedule(
    schedule: Omit<QuizSchedule, 'id' | 'status' | 'createdAt'>
): Promise<QuizSchedule> {
    const newSchedule: QuizSchedule = {
        ...schedule,
        id: generateId(),
        status: 'scheduled',
        createdAt: new Date().toISOString(),
    };

    const schedules = await loadSchedules();
    schedules.push(newSchedule);
    await saveSchedules(schedules);

    console.log(`[QuizScheduler] Created schedule: ${newSchedule.title} on ${newSchedule.date} at ${newSchedule.time}`);

    return newSchedule;
}

/**
 * Update schedule status
 */
export async function updateScheduleStatus(
    id: string,
    status: QuizSchedule['status']
): Promise<void> {
    const schedules = await loadSchedules();
    const index = schedules.findIndex(s => s.id === id);

    if (index >= 0) {
        const schedule = schedules[index]!;
        schedule.status = status;
        if (status === 'completed') {
            schedule.completedAt = new Date().toISOString();
        }
        await saveSchedules(schedules);
    }
}

/**
 * Execute a scheduled quiz
 * Fetches extra questions if AI rejects some to ensure full count
 */
export async function executeScheduledQuiz(schedule: QuizSchedule): Promise<void> {
    console.log(`[QuizScheduler] Executing quiz: ${schedule.title}`);

    try {
        // Update status to in_progress
        await updateScheduleStatus(schedule.id, 'in_progress');

        const targetCount = schedule.questionCount;
        const allApprovedQuestions: AstraQuestion[] = [];
        const usedQuestionIds = new Set<string>();
        const maxAttempts = 3; // Maximum retry attempts
        let attempt = 0;

        while (allApprovedQuestions.length < targetCount && attempt < maxAttempts) {
            attempt++;
            const needed = targetCount - allApprovedQuestions.length;
            // Fetch extra questions to account for potential rejections (fetch 50% more)
            const fetchCount = Math.ceil(needed * 1.5);

            console.log(`[QuizScheduler] Attempt ${attempt}: Fetching ${fetchCount} questions (need ${needed} more)`);

            // Select questions, excluding already used ones
            const questions = await selectQuestions({
                subjectIds: schedule.subjectIds,
                chapterIds: schedule.chapterIds,
                count: fetchCount,
            });

            // Filter out already used questions
            const newQuestions = questions.filter(q => !usedQuestionIds.has(q._id));

            if (newQuestions.length === 0) {
                console.warn(`[QuizScheduler] No more new questions available`);
                break;
            }

            // Mark these as used (to avoid re-fetching)
            newQuestions.forEach(q => usedQuestionIds.add(q._id));

            console.log(`[QuizScheduler] Got ${newQuestions.length} new questions`);

            // Run AI quality check
            const qualityInput: QualityCheckInput[] = newQuestions.map(q => ({
                id: q._id,
                text: q.englishText,
                options: q.optionsEnglish,
            }));

            const qualityResults = await checkQuestionQuality(qualityInput);

            // Filter approved questions
            const approvedIds = new Set(
                qualityResults.filter(r => r.approved).map(r => r.id)
            );
            const approvedQuestions = newQuestions.filter(q => approvedIds.has(q._id));

            console.log(`[QuizScheduler] ${approvedQuestions.length}/${newQuestions.length} passed quality check`);

            // Add approved questions to our pool
            allApprovedQuestions.push(...approvedQuestions);

            // Stop if we have enough
            if (allApprovedQuestions.length >= targetCount) {
                break;
            }
        }

        // Trim to exact target count
        const finalQuestions = allApprovedQuestions.slice(0, targetCount);

        console.log(`[QuizScheduler] Final: ${finalQuestions.length}/${targetCount} questions ready`);

        if (finalQuestions.length === 0) {
            console.error(`[QuizScheduler] No questions available for quiz: ${schedule.title}`);
            await updateScheduleStatus(schedule.id, 'cancelled');
            return;
        }

        if (finalQuestions.length < targetCount) {
            console.warn(`[QuizScheduler] ⚠️ Only ${finalQuestions.length} questions available (wanted ${targetCount})`);
        }

        // Run the quiz
        const result = await runQuiz(schedule, finalQuestions);

        if (result.success) {
            // Mark questions as used
            await markQuestionsUsed(
                finalQuestions.map(q => q._id),
                schedule.id
            );
            await updateScheduleStatus(schedule.id, 'completed');
        } else {
            await updateScheduleStatus(schedule.id, 'cancelled');
        }
    } catch (error: any) {
        console.error(`[QuizScheduler] Quiz execution failed:`, error.message);
        await updateScheduleStatus(schedule.id, 'cancelled');
    }
}

/**
 * Check and execute quiz for a specific time slot
 */
async function checkAndExecuteQuiz(time: '08:00' | '20:00'): Promise<void> {
    const today = getISTDate();
    console.log(`[QuizScheduler] Checking for quiz at ${time} on ${today}`);

    const schedule = await getScheduleFor(today, time);

    if (schedule) {
        await executeScheduledQuiz(schedule);
    } else {
        console.log(`[QuizScheduler] No quiz scheduled for ${today} ${time}`);

        // Auto-generate a quiz if none scheduled
        await autoGenerateQuiz(today, time);
    }
}

/**
 * Send notification for upcoming quiz
 */
async function checkAndSendNotification(time: '08:00' | '20:00'): Promise<void> {
    const today = getISTDate();
    console.log(`[QuizScheduler] Checking notification for ${time}`);

    const schedule = await getScheduleFor(today, time);

    if (schedule) {
        await sendQuizNotification(schedule);
    }
}

/**
 * Auto-generate a quiz using AI or simple logic
 */
async function autoGenerateQuiz(date: string, time: '08:00' | '20:00'): Promise<void> {
    console.log(`[QuizScheduler] Auto-generating quiz for ${date} ${time}`);

    try {
        // Get available subjects and chapters
        const subjects = await getSubjects();
        const chapters = await getChapters();

        if (subjects.length === 0) {
            console.warn(`[QuizScheduler] No subjects available for auto-generation`);
            return;
        }

        // Simple selection: pick a random subject
        const randomSubject = subjects[Math.floor(Math.random() * subjects.length)]!;
        const subjectChapters = chapters.filter(c => c.subjectId === randomSubject._id);

        // Pick up to 3 random chapters
        const shuffledChapters = subjectChapters.sort(() => Math.random() - 0.5);
        const selectedChapters = shuffledChapters.slice(0, 3);

        const newSchedule = await createSchedule({
            date,
            time,
            subjectIds: [randomSubject._id],
            chapterIds: selectedChapters.map(c => c._id),
            subjectNames: [randomSubject.name],
            chapterNames: selectedChapters.map(c => c.name),
            questionCount: quizConfig.selection.defaultQuestionCount,
            title: `${randomSubject.name} - ${selectedChapters.map(c => c.name).join(', ')}`,
        });

        // Execute the auto-generated quiz
        await executeScheduledQuiz(newSchedule);
    } catch (error: any) {
        console.error(`[QuizScheduler] Auto-generation failed:`, error.message);
    }
}

/**
 * Generate schedules for the upcoming week using AI
 */
export async function generateWeeklySchedule(): Promise<QuizSchedule[]> {
    console.log(`[QuizScheduler] Generating weekly schedule`);

    try {
        const subjects = await getSubjects();
        const chapters = await getChapters();

        if (subjects.length === 0) {
            console.warn(`[QuizScheduler] No subjects available`);
            return [];
        }

        const summaries = createSubjectSummaries(subjects, chapters);
        const aiSchedules = await generateSchedule(summaries, 7);

        const createdSchedules: QuizSchedule[] = [];

        for (const schedule of aiSchedules) {
            const created = await createSchedule(schedule);
            createdSchedules.push(created);
        }

        console.log(`[QuizScheduler] Created ${createdSchedules.length} schedules for the week`);

        return createdSchedules;
    } catch (error: any) {
        console.error(`[QuizScheduler] Weekly schedule generation failed:`, error.message);
        return [];
    }
}

/**
 * Initialize the scheduler with cron jobs
 */
export function initScheduler(): void {
    console.log(`[QuizScheduler] Initializing cron jobs for 8 AM and 8 PM IST`);

    // IST is UTC+5:30
    // 8:00 AM IST = 2:30 AM UTC
    // 8:00 PM IST = 2:30 PM UTC (14:30)

    // Quiz execution at 8 AM IST (2:30 AM UTC)
    cron.schedule('30 2 * * *', () => {
        console.log(`[QuizScheduler] Triggered 8:00 AM IST quiz`);
        checkAndExecuteQuiz('08:00').catch(console.error);
    });

    // Quiz execution at 8 PM IST (2:30 PM UTC / 14:30)
    cron.schedule('30 14 * * *', () => {
        console.log(`[QuizScheduler] Triggered 8:00 PM IST quiz`);
        checkAndExecuteQuiz('20:00').catch(console.error);
    });

    // Notifications 30 min before (7:30 AM IST = 2:00 AM UTC)
    cron.schedule('0 2 * * *', () => {
        console.log(`[QuizScheduler] Sending 8:00 AM notification`);
        checkAndSendNotification('08:00').catch(console.error);
    });

    // Notifications 30 min before (7:30 PM IST = 2:00 PM UTC / 14:00)
    cron.schedule('0 14 * * *', () => {
        console.log(`[QuizScheduler] Sending 8:00 PM notification`);
        checkAndSendNotification('20:00').catch(console.error);
    });

    console.log(`[QuizScheduler] Cron jobs scheduled:`);
    console.log(`  - 8:00 AM IST quiz (2:30 AM UTC)`);
    console.log(`  - 8:00 PM IST quiz (2:30 PM UTC)`);
    console.log(`  - Notifications 30 min before each`);
}

/**
 * Manually trigger a quiz for testing - uses AI for subject selection
 */
export async function triggerTestQuiz(questionCount: number = 20): Promise<void> {
    console.log(`\n[QuizScheduler] 🚀 Starting AI-powered test quiz with ${questionCount} questions\n`);

    const today = getISTDate();
    const now = getISTTime();

    // Get all subjects and chapters
    const subjects = await getSubjects();
    const chapters = await getChapters();

    if (subjects.length === 0) {
        console.error(`[QuizScheduler] No subjects available for test quiz`);
        return;
    }

    console.log(`[QuizScheduler] Found ${subjects.length} subjects and ${chapters.length} chapters`);

    // Create subject summaries for AI
    const summaries = createSubjectSummaries(subjects, chapters);

    // Use AI to select subjects and chapters
    const aiSelection = await selectSubjectsWithAI(summaries, questionCount);

    let selectedSubjectIds: string[];
    let selectedChapterIds: string[];
    let quizTitle: string;

    if (aiSelection) {
        // Use AI selection
        selectedSubjectIds = aiSelection.subjectIds;
        selectedChapterIds = aiSelection.chapterIds;
        quizTitle = aiSelection.title;
    } else {
        // Fallback to random selection
        console.log(`[QuizScheduler] AI selection failed, using random selection`);
        const randomSubject = subjects[Math.floor(Math.random() * subjects.length)]!;
        const subjectChapters = chapters.filter(c => c.subjectId === randomSubject._id);
        const selectedChapters = subjectChapters.slice(0, 3);

        selectedSubjectIds = [randomSubject._id];
        selectedChapterIds = selectedChapters.map(c => c._id);
        quizTitle = `${randomSubject.name} Quiz`;
    }

    // Get names for display
    const selectedSubjectNames = subjects
        .filter(s => selectedSubjectIds.includes(s._id))
        .map(s => s.name);
    const selectedChapterNames = chapters
        .filter(c => selectedChapterIds.includes(c._id))
        .map(c => c.name);

    console.log(`[QuizScheduler] 📚 Selected subjects: ${selectedSubjectNames.join(', ')}`);
    console.log(`[QuizScheduler] 📖 Selected chapters: ${selectedChapterNames.join(', ')}`);

    // Create the quiz schedule
    const testSchedule = await createSchedule({
        date: today,
        time: now.startsWith('0') || now.startsWith('1') ? '08:00' : '20:00',
        subjectIds: selectedSubjectIds,
        chapterIds: selectedChapterIds,
        subjectNames: selectedSubjectNames,
        chapterNames: selectedChapterNames,
        questionCount,
        title: quizTitle,
    });

    // Execute the quiz
    await executeScheduledQuiz(testSchedule);
}

