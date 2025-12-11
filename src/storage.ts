/**
 * Supabase Storage Service
 * Replaces local file storage with Supabase for persistence on Render
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

let supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return null;
    }
    if (!supabase) {
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    return supabase;
}

/**
 * Get a value from storage
 */
export async function getValue<T>(key: string, defaultValue: T): Promise<T> {
    const client = getClient();
    if (!client) {
        console.log(`[Storage] No Supabase configured, using default for ${key}`);
        return defaultValue;
    }

    try {
        const { data, error } = await client
            .from("storage")
            .select("value")
            .eq("key", key)
            .single();

        if (error || !data) {
            return defaultValue;
        }

        return data.value as T;
    } catch (err) {
        console.error(`[Storage] Error getting ${key}:`, err);
        return defaultValue;
    }
}

/**
 * Set a value in storage
 */
export async function setValue<T>(key: string, value: T): Promise<void> {
    const client = getClient();
    if (!client) {
        return;
    }

    try {
        const { error } = await client
            .from("storage")
            .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

        if (error) {
            console.error(`[Storage] Error setting ${key}:`, error.message);
        }
    } catch (err) {
        console.error(`[Storage] Error setting ${key}:`, err);
    }
}

/**
 * Check if Supabase is configured
 */
export function isStorageConfigured(): boolean {
    return Boolean(SUPABASE_URL && SUPABASE_KEY);
}
