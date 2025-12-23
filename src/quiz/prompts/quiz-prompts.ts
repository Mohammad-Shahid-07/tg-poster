/**
 * Quiz AI Prompts
 * Centralized prompts for AI-powered quiz features
 */

/**
 * System prompt for quality checking questions
 */
export const QUALITY_CHECK_SYSTEM_PROMPT = `You are a quality checker for educational quiz questions. Your job is to review questions and identify any that should be removed from a quiz.

EVALUATE EACH QUESTION FOR:
1. Clarity - Is the question clear and understandable?
2. Completeness - Does the question have all necessary information?
3. Options - Are all options valid and distinct?
4. Similarity - Are any questions too similar to others in the batch?
5. Accuracy - Does the question make factual sense?

MARK FOR REMOVAL if:
- Question is incomplete or truncated
- Options are missing or don't make sense
- Question is identical or nearly identical to another in the batch
- Question contains obvious errors
- Question is too vague to answer

RESPOND WITH JSON ARRAY:
[
  {"id": "question_id", "approved": true},
  {"id": "question_id", "approved": false, "reason": "brief reason"}
]

Be lenient - only reject questions with significant issues. Most questions should pass.`;

/**
 * System prompt for generating quiz schedule
 */
export const SCHEDULE_GENERATION_SYSTEM_PROMPT = `You are a quiz scheduler for an educational Telegram channel. Your job is to create a weekly quiz schedule that covers various subjects and chapters.

GUIDELINES:
1. Balance coverage across all subjects
2. Mix single-chapter and multi-chapter quizzes
3. Gradually increase difficulty through the week
4. Create engaging titles for each quiz
5. Quizzes are at 8:00 AM and 8:00 PM IST

RESPOND WITH JSON ARRAY:
[
  {
    "date": "YYYY-MM-DD",
    "time": "08:00" or "20:00",
    "subjectIds": ["id1", "id2"],
    "chapterIds": ["id1", "id2"],
    "questionCount": 20,
    "title": "Quiz Title"
  }
]`;

/**
 * Generate user prompt for quality check
 */
export function getQualityCheckUserPrompt(
    questions: Array<{ id: string; text: string; options: string[] }>
): string {
    const formatted = questions.map((q, i) => {
        const optionsText = q.options.map((opt, j) =>
            `  ${String.fromCharCode(65 + j)}) ${opt}`
        ).join('\n');

        return `[${i + 1}] ID: ${q.id}\nQ: ${q.text}\n${optionsText}`;
    }).join('\n\n');

    return `Review these ${questions.length} questions and identify any that should be removed:\n\n${formatted}`;
}

/**
 * Generate user prompt for schedule generation
 */
export function getScheduleGenerationUserPrompt(
    subjects: Array<{ id: string; name: string; totalQuestions: number; chapters: Array<{ id: string; name: string; questionCount: number }> }>,
    daysAhead: number
): string {
    const today = new Date();
    const dates: string[] = [];

    for (let i = 0; i < daysAhead; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        dates.push(date.toISOString().split('T')[0] as string);
    }

    const subjectsInfo = subjects.map(s => {
        const chaptersInfo = s.chapters.map(c =>
            `    - ${c.name} (${c.questionCount} questions) [ID: ${c.id}]`
        ).join('\n');

        return `- ${s.name} (${s.totalQuestions} questions) [ID: ${s.id}]\n${chaptersInfo}`;
    }).join('\n\n');

    return `Create a quiz schedule for the next ${daysAhead} days.

Available dates: ${dates.join(', ')}
Times: 08:00 (morning) and 20:00 (evening) IST

SUBJECTS AND CHAPTERS:
${subjectsInfo}

Create 2 quizzes per day (morning and evening). Vary the difficulty and mix subjects/chapters appropriately.`;
}

/**
 * System prompt for selecting subjects and chapters for a quiz
 */
export const SUBJECT_SELECTION_SYSTEM_PROMPT = `You are an educational quiz planner. Your job is to select the best subjects and chapters for today's quiz.

GUIDELINES:
1. Choose subjects that students need to practice
2. Mix easy and challenging chapters
3. Create an engaging quiz title
4. Consider question availability (pick chapters with more questions)

RESPOND WITH JSON:
{
    "subjectIds": ["id1"],
    "chapterIds": ["id1", "id2"],
    "title": "Engaging Quiz Title",
    "reasoning": "Brief explanation of why you chose these"
}`;

/**
 * Generate user prompt for subject selection
 */
export function getSubjectSelectionUserPrompt(
    subjects: Array<{ id: string; name: string; totalQuestions: number; chapters: Array<{ id: string; name: string; questionCount: number }> }>,
    questionCount: number
): string {
    const subjectsInfo = subjects.map(s => {
        const chaptersInfo = s.chapters.map(c =>
            `    - ${c.name} (${c.questionCount} questions) [ID: ${c.id}]`
        ).join('\n');

        return `- ${s.name} (${s.totalQuestions} total questions) [ID: ${s.id}]\n${chaptersInfo}`;
    }).join('\n\n');

    return `Select subjects and chapters for today's quiz.

REQUIREMENTS:
- Need ${questionCount} questions total
- Pick chapters that have enough questions
- Create an interesting mix

AVAILABLE SUBJECTS AND CHAPTERS:
${subjectsInfo}

Choose wisely and provide an engaging quiz title!`;
}

