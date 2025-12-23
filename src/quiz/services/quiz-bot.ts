/**
 * Quiz Bot Service
 * Handles sending quiz questions as Telegram polls
 */

import { initBot } from "../../bot";
import { quizConfig } from "../config";
import type { AstraQuestion, QuizSchedule } from "../types";

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get the correct option index from the answer letter (A, B, C, D)
 */
function getCorrectOptionIndex(question: AstraQuestion): number {
    const answer = question.correctAnswer.toUpperCase().trim();

    // Handle single letter answers (A, B, C, D)
    if (answer.length === 1) {
        const index = answer.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
        if (index >= 0 && index < question.optionsEnglish.length) {
            return index;
        }
    }

    // Handle full option text match
    const optionIndex = question.optionsEnglish.findIndex(
        opt => opt.toLowerCase().includes(answer.toLowerCase())
    );
    if (optionIndex >= 0) return optionIndex;

    // Default to first option if can't determine
    console.warn(`[QuizBot] Could not determine correct answer for question ${question._id}`);
    return 0;
}

/**
 * Truncate text to Telegram's limits
 * Poll question: 300 chars, Poll option: 100 chars, Explanation: 200 chars
 */
function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + "...";
}

/**
 * Format explanation for poll
 */
function formatExplanation(explanation: string): string {
    // Clean up markdown if present
    let cleaned = explanation
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/_/g, '')
        .trim();

    return truncate(cleaned, 200);
}

/**
 * Send quiz start message
 */
export async function sendQuizStartMessage(schedule: QuizSchedule): Promise<void> {
    const bot = initBot();
    const channelId = quizConfig.telegram.channelId;

    const subjectsText = schedule.subjectNames.join(", ") || "Mixed";
    const chaptersText = schedule.chapterNames.length > 0
        ? schedule.chapterNames.join(", ")
        : "All chapters";

    const message = `🎯 <b>QUIZ STARTING NOW!</b> 🎯

📚 <b>Subject:</b> ${subjectsText}
📖 <b>Chapters:</b> ${chaptersText}
❓ <b>Questions:</b> ${schedule.questionCount}
🌐 <b>Format:</b> Bilingual (Hindi + English)

📝 Each question will appear as a poll.
✅ Tap an option to answer and see the explanation!

<i>Good luck! 🍀</i>`;

    await bot.api.sendMessage(channelId, message, {
        parse_mode: "HTML",
    });
}

/**
 * Detect if subject is language-specific and return the language
 * Returns 'hindi' | 'english' | 'bilingual'
 */
function detectSubjectLanguage(subjectName: string): 'hindi' | 'english' | 'bilingual' {
    const lower = subjectName.toLowerCase();

    // Hindi language subjects - send only Hindi
    if (lower.includes('hindi') || lower.includes('हिंदी') || lower.includes('हिन्दी')) {
        return 'hindi';
    }

    // English language subjects - send only English
    if (lower.includes('english') || lower.includes('अंग्रेजी') || lower.includes('अंग्रेज़ी')) {
        return 'english';
    }

    // Default: send both languages
    return 'bilingual';
}

// Store current quiz language mode
let currentQuizLanguage: 'hindi' | 'english' | 'bilingual' = 'bilingual';

/**
 * Set the language mode for the current quiz based on subject names
 */
export function setQuizLanguageMode(subjectNames: string[]): void {
    // Check if any subject is language-specific
    for (const name of subjectNames) {
        const lang = detectSubjectLanguage(name);
        if (lang !== 'bilingual') {
            currentQuizLanguage = lang;
            console.log(`[QuizBot] 🌐 Language mode: ${lang.toUpperCase()} only (detected from "${name}")`);
            return;
        }
    }
    currentQuizLanguage = 'bilingual';
    console.log(`[QuizBot] 🌐 Language mode: BILINGUAL (Hindi + English)`);
}

/**
 * Send a single question as poll(s) based on language mode
 */
export async function sendQuestionPoll(
    question: AstraQuestion,
    index: number,
    total: number
): Promise<void> {
    const bot = initBot();
    const channelId = quizConfig.telegram.channelId;
    const correctIndex = getCorrectOptionIndex(question);

    // Send Hindi poll (if bilingual or hindi-only)
    if (currentQuizLanguage === 'bilingual' || currentQuizLanguage === 'hindi') {
        const hindiQuestion = truncate(
            `प्रश्न ${index}/${total}\n\n${question.hindiText}`,
            300
        );
        const hindiOptions = question.optionsHindi.map(opt => truncate(opt, 100));
        const hindiExplanation = formatExplanation(question.explanationHindi || "");

        try {
            await bot.api.sendPoll(channelId, hindiQuestion, hindiOptions, {
                type: "quiz",
                correct_option_id: correctIndex,
                explanation: hindiExplanation || undefined,
                explanation_parse_mode: "HTML",
                is_anonymous: true,
            });
        } catch (error: any) {
            console.error(`[QuizBot] Failed to send Hindi poll for Q${index}:`, error.message);
        }

        // Wait between polls if sending both
        if (currentQuizLanguage === 'bilingual') {
            await delay(quizConfig.timing.delayBetweenLanguages);
        }
    }

    // Send English poll (if bilingual or english-only)
    if (currentQuizLanguage === 'bilingual' || currentQuizLanguage === 'english') {
        const englishQuestion = truncate(
            `Question ${index}/${total}\n\n${question.englishText}`,
            300
        );
        const englishOptions = question.optionsEnglish.map(opt => truncate(opt, 100));
        const englishExplanation = formatExplanation(question.explanationEnglish || "");

        try {
            await bot.api.sendPoll(channelId, englishQuestion, englishOptions, {
                type: "quiz",
                correct_option_id: correctIndex,
                explanation: englishExplanation || undefined,
                explanation_parse_mode: "HTML",
                is_anonymous: true,
            });
        } catch (error: any) {
            console.error(`[QuizBot] Failed to send English poll for Q${index}:`, error.message);
        }
    }
}

/**
 * Send quiz completion message
 */
export async function sendQuizCompleteMessage(
    schedule: QuizSchedule,
    questionsSent: number
): Promise<void> {
    const bot = initBot();
    const channelId = quizConfig.telegram.channelId;

    const message = `🎉 <b>QUIZ COMPLETE!</b> 🎉

✅ <b>Questions:</b> ${questionsSent} completed
📚 <b>Topic:</b> ${schedule.title}

📊 Check your answers above!
💡 Tap any poll to see the explanation.

<i>See you at the next quiz! 📖</i>`;

    await bot.api.sendMessage(channelId, message, {
        parse_mode: "HTML",
    });
}

/**
 * Send notification about upcoming quiz
 */
export async function sendQuizNotification(schedule: QuizSchedule): Promise<void> {
    const bot = initBot();
    const channelId = quizConfig.telegram.channelId;

    const subjectsText = schedule.subjectNames.join(", ") || "Mixed";
    const chaptersText = schedule.chapterNames.length > 0
        ? schedule.chapterNames.join(", ")
        : "All chapters";

    const timeDisplay = schedule.time === "08:00" ? "8:00 AM" : "8:00 PM";

    const message = `📚 <b>QUIZ STARTING IN ${quizConfig.timing.notificationMinutesBefore} MINUTES!</b> 📚

📅 <b>Time:</b> ${timeDisplay} IST
📖 <b>Subject:</b> ${subjectsText}
📝 <b>Chapters:</b> ${chaptersText}
❓ <b>Questions:</b> ${schedule.questionCount}

<i>Get ready! 🚀</i>`;

    await bot.api.sendMessage(channelId, message, {
        parse_mode: "HTML",
    });

    console.log(`[QuizBot] Sent notification for quiz: ${schedule.title}`);
}

/**
 * Run a complete quiz session
 */
export async function runQuiz(
    schedule: QuizSchedule,
    questions: AstraQuestion[]
): Promise<{ success: boolean; questionsSent: number }> {
    console.log(`[QuizBot] Starting quiz: ${schedule.title}`);
    console.log(`[QuizBot] Questions: ${questions.length}, Channel: ${quizConfig.telegram.channelId}`);

    // Set language mode based on subject names
    setQuizLanguageMode(schedule.subjectNames);

    try {
        // Send start message
        await sendQuizStartMessage(schedule);
        await delay(3000); // Wait a bit before starting questions

        let questionsSent = 0;

        // Send each question
        for (let i = 0; i < questions.length; i++) {
            const question = questions[i]!;
            const questionNumber = i + 1;

            console.log(`[QuizBot] Sending question ${questionNumber}/${questions.length}`);

            await sendQuestionPoll(question, questionNumber, questions.length);
            questionsSent++;

            // Wait between question pairs (not after last question)
            if (i < questions.length - 1) {
                await delay(quizConfig.timing.questionInterval);
            }
        }

        // Wait a moment then send completion message
        await delay(3000);
        await sendQuizCompleteMessage(schedule, questionsSent);

        console.log(`[QuizBot] Quiz complete: ${questionsSent} questions sent`);

        return { success: true, questionsSent };
    } catch (error: any) {
        console.error(`[QuizBot] Quiz failed:`, error.message);
        return { success: false, questionsSent: 0 };
    }
}
