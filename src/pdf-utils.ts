/**
 * PDF Utilities
 * Convert PDF pages to images for AI analysis
 */

import { join } from "path";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import { config } from "./config";

/**
 * Download a file from URL to temp directory
 */
export async function downloadFile(url: string, filename: string): Promise<string | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;

        const buffer = await response.arrayBuffer();
        const filepath = join(config.mediaDir, filename);
        writeFileSync(filepath, Buffer.from(buffer));
        return filepath;
    } catch (err) {
        console.error("[PDF Utils] Download failed:", err);
        return null;
    }
}

/**
 * Convert PDF buffer to base64 data URL for API
 * Note: Mistral accepts base64 images directly
 */
export function bufferToDataUrl(buffer: Buffer, mimeType: string = "image/png"): string {
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Read file as base64 data URL
 */
export function fileToDataUrl(filepath: string): string | null {
    try {
        if (!existsSync(filepath)) return null;
        const buffer = readFileSync(filepath);
        const ext = filepath.split(".").pop()?.toLowerCase();

        const mimeTypes: Record<string, string> = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            pdf: "application/pdf",
        };

        return bufferToDataUrl(buffer, mimeTypes[ext || "png"] || "image/png");
    } catch (err) {
        console.error("[PDF Utils] Failed to read file:", err);
        return null;
    }
}

/**
 * Clean up temporary file
 */
export function cleanupFile(filepath: string): void {
    try {
        if (existsSync(filepath)) {
            unlinkSync(filepath);
        }
    } catch {
        // ignore
    }
}

/**
 * Check if URL points to a PDF
 */
export function isPdfUrl(url: string): boolean {
    return url.toLowerCase().includes(".pdf") || url.includes("application/pdf");
}

/**
 * Check if URL points to an image
 */
export function isImageUrl(url: string): boolean {
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const lowerUrl = url.toLowerCase();
    return imageExtensions.some((ext) => lowerUrl.includes(ext));
}
