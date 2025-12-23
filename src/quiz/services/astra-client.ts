/**
 * AstraDB Client Service
 * Manages connection to Astra DB Data API
 */

import { DataAPIClient, Db, Collection } from "@datastax/astra-db-ts";
import { quizConfig } from "../config";
import type { AstraQuestion, Subject, Chapter } from "../types";

let client: DataAPIClient | null = null;
let db: Db | null = null;

/**
 * Initialize and get the DataAPI client
 */
function getClient(): DataAPIClient {
    if (!client) {
        if (!quizConfig.astra.token) {
            throw new Error("[AstraDB] Token not configured");
        }
        client = new DataAPIClient(quizConfig.astra.token);
    }
    return client;
}

/**
 * Get the database instance
 */
function getDb(): Db {
    if (!db) {
        if (!quizConfig.astra.endpoint) {
            throw new Error("[AstraDB] Endpoint not configured");
        }
        const c = getClient();
        db = c.db(quizConfig.astra.endpoint, {
            keyspace: quizConfig.astra.namespace,
        });
    }
    return db;
}

/**
 * Get the questions collection
 */
export function getQuestionsCollection(): Collection<AstraQuestion> {
    return getDb().collection<AstraQuestion>(quizConfig.astra.collections.questions);
}

/**
 * Get the subjects collection
 */
export function getSubjectsCollection(): Collection<Subject> {
    return getDb().collection<Subject>(quizConfig.astra.collections.subjects);
}

/**
 * Get the chapters collection
 */
export function getChaptersCollection(): Collection<Chapter> {
    return getDb().collection<Chapter>(quizConfig.astra.collections.chapters);
}

/**
 * Test the database connection
 * @returns true if connection successful
 */
export async function testConnection(): Promise<boolean> {
    try {
        const database = getDb();

        // Try to list collections to verify connection
        const collections = await database.listCollections();
        console.log(`[AstraDB] Connected successfully. Found ${collections.length} collections.`);

        // Log available collections
        const collectionNames = collections.map(c => c.name);
        console.log(`[AstraDB] Collections: ${collectionNames.join(", ")}`);

        return true;
    } catch (error: any) {
        console.error("[AstraDB] Connection failed:", error.message);
        return false;
    }
}

/**
 * Get counts from all quiz-related collections
 */
export async function getCollectionStats(): Promise<{
    questions: number;
    subjects: number;
    chapters: number;
}> {
    try {
        // Use estimatedDocumentCount or just try to count with limit
        const questionsCol = getQuestionsCollection();
        const subjectsCol = getSubjectsCollection();
        const chaptersCol = getChaptersCollection();

        // Try counting - if it fails due to limit, that means there ARE documents
        let questionsCount = 0;
        let subjectsCount = 0;
        let chaptersCount = 0;

        try {
            questionsCount = await questionsCol.countDocuments({}, 1000);
        } catch (e: any) {
            if (e.message?.includes("Too many")) {
                questionsCount = 1000; // At least 1000+
                console.log("[AstraDB] Questions: 1000+ (count limit exceeded)");
            }
        }

        try {
            subjectsCount = await subjectsCol.countDocuments({}, 1000);
        } catch (e: any) {
            if (e.message?.includes("Too many")) {
                subjectsCount = 1000;
            }
        }

        try {
            chaptersCount = await chaptersCol.countDocuments({}, 1000);
        } catch (e: any) {
            if (e.message?.includes("Too many")) {
                chaptersCount = 1000;
            }
        }

        return {
            questions: questionsCount,
            subjects: subjectsCount,
            chapters: chaptersCount,
        };
    } catch (error: any) {
        console.error("[AstraDB] Failed to get collection stats:", error.message);
        return { questions: 0, subjects: 0, chapters: 0 };
    }
}

/**
 * Close the client connection (for cleanup)
 */
export function closeConnection(): void {
    if (client) {
        client.close();
        client = null;
        db = null;
        console.log("[AstraDB] Connection closed");
    }
}
