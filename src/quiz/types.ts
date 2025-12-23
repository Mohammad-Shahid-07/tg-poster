/**
 * Quiz Module Types
 * Types specific to the quiz bot functionality
 */

// Re-export the database models from a central location
// These match the AstraDB schema provided by the user

/**
 * Astra DB Question Model
 */
export interface AstraQuestion {
    _id: string;
    questionNumber: number;
    hindiText: string;
    englishText: string;
    examInfo?: string | string[];
    questionType?: 'single_choice' | 'multi_statement' | 'match_the_following' | 'assertion_reason';
    difficultyLevel?: 'EASY' | 'MEDIUM' | 'HARD';
    optionsHindi: string[];
    optionsEnglish: string[];
    correctAnswer: string;
    explanationHindi: string;
    explanationEnglish: string;
    questionImage?: string;
    explanationImage?: string;
    optionsImages?: { [key: string]: string };
    groupId?: string;
    groupContent?: string;
    isMarkdown?: boolean;
    subjectId: string;
    subjectName: string;
    chapterId: string;
    chapterName: string;
    subject: string;
    chapter: string;
    sourceFile: string;
    chunkNumber: number;
    pageRange: string;
    extractedAt: Date;
    verified: boolean;
    dedupeKey?: string;
    $vectorize?: string;
    $vector?: number[];
    $similarity?: number;
}

/**
 * Subject Model
 */
export interface Subject {
    _id: string;
    name: string;
    description?: string;
    createdAt: Date;
    updatedAt: Date;
    isActive: boolean;
    totalQuestions: number;
    totalChapters: number;
    sourceFiles: string[];
}

/**
 * Chapter Model
 */
export interface Chapter {
    _id: string;
    name: string;
    subjectId: string;
    subjectName: string;
    description?: string;
    order?: number;
    createdAt: Date;
    updatedAt: Date;
    isActive: boolean;
    totalQuestions: number;
    sourceFiles: string[];
    chunkNumbers: number[];
    pageRanges: string[];
}

/**
 * Quiz Schedule - represents a scheduled quiz session
 */
export interface QuizSchedule {
    id: string;
    date: string;                    // YYYY-MM-DD format
    time: '08:00' | '20:00';         // IST time
    subjectIds: string[];
    chapterIds: string[];
    subjectNames: string[];
    chapterNames: string[];
    questionCount: number;
    title: string;                   // Display title
    status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
    createdAt: string;
    completedAt?: string;
}

/**
 * AI Quality Check Input - minimal data sent to AI
 */
export interface QualityCheckInput {
    id: string;
    text: string;       // English text only
    options: string[];  // English options only
}

/**
 * AI Quality Check Result
 */
export interface QualityCheckResult {
    id: string;
    approved: boolean;
    reason?: string;
}

/**
 * Question Selection Options
 */
export interface QuestionSelectionOptions {
    subjectIds?: string[];
    chapterIds?: string[];
    count: number;
    difficultyRatio?: {
        EASY: number;
        MEDIUM: number;
        HARD: number;
    };
    excludeRecentDays?: number;
    includeGroupedQuestions?: boolean;
}

/**
 * Quiz Session State - tracks active quiz progress
 */
export interface QuizSessionState {
    scheduleId: string;
    currentQuestionIndex: number;
    totalQuestions: number;
    questionIds: string[];
    startedAt: string;
    status: 'running' | 'paused' | 'completed';
}

/**
 * Used Question Record - for tracking recently used questions
 */
export interface UsedQuestionRecord {
    questionId: string;
    scheduleId: string;
    usedAt: string;
}
