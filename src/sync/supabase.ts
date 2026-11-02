import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function readConfig(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null; // Req 8.1

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // Req 8.2
  }
  if (parsed.protocol !== "https:") return null; // Req 8.2

  return { url, anonKey };
}

const config = readConfig();

/**
 * `null` ⇒ Local_Only_Mode. No client is constructed, so no request can fire
 * (Req 8.4). `persistSession` + `autoRefreshToken` keep the session alive
 * across reloads (Req 3.1–3.3); `detectSessionInUrl` completes the OAuth
 * redirect.
 */
export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/** Single source of truth the UI reads to decide whether sync is available (Req 8.3, 2.1). */
export const isSyncConfigured = supabase !== null;
