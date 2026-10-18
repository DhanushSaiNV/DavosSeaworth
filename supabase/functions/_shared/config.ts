// supabase/functions/_shared/config.ts
// Shared runtime config reader + service-role client.
// [SPEC] values live in the `config` table (TECH-SPEC §11 registry) and are read at
// runtime — never hardcoded into logic (AGENTS.md §2).

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function getConfig(key: string): Promise<unknown> {
  const { data, error } = await supabaseService
    .from("config")
    .select("value")
    .eq("key", key)
    .single();
  if (error || !data) return null;
  return data.value;
}

/**
 * Read a numeric [SPEC] config value. Throws when the key is missing or not numeric —
 * a missing config key is a misconfiguration we surface, never paper over with a
 * hardcoded default.
 */
export async function getConfigNumber(key: string): Promise<number> {
  const val = await getConfig(key);
  if (val === null) {
    throw new Error(`config key "${key}" is missing`);
  }
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n)) {
    throw new Error(`config key "${key}" is not numeric`);
  }
  return n;
}

/**
 * Read a string [SPEC] config value. Fail-closed like its numeric sibling: a missing,
 * empty or mistyped key throws rather than handing the caller a value it would then
 * treat as a real setting (e.g. a persona or reply string).
 */
export async function getConfigString(key: string): Promise<string> {
  const val = await getConfig(key);
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`config key "${key}" is missing or not a non-empty string`);
  }
  return val;
}

/**
 * Read a boolean [SPEC] config flag. Fail-closed: only a real JSON `true`
 * enables the behaviour — missing or mistyped keys throw, never silently
 * enable a surface.
 */
export async function getConfigBoolean(key: string): Promise<boolean> {
  const val = await getConfig(key);
  if (val === null) {
    throw new Error(`config key "${key}" is missing`);
  }
  if (typeof val !== "boolean") {
    throw new Error(`config key "${key}" is not boolean`);
  }
  return val;
}
