// supabase/functions/_shared/auth.ts
// JWT → user resolution for user-scoped Edge Functions (TECH-SPECS §7.11).
//
// The gateway (`verify_jwt = true`, the deploy default) already rejects a missing or
// unverifiable token with 401 before we run. We still resolve the user here via the
// anon key so the function never trusts an unverified token if it is ever deployed
// with `--no-verify-jwt`.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Supabase injects SUPABASE_ANON_KEY; newer projects also expose SUPABASE_PUBLISHABLE_KEY.
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";

const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

export type AuthOutcome =
  | { ok: true; userId: string }
  | { ok: false; status: number; message: string };

export async function resolveUserId(req: Request): Promise<AuthOutcome> {
  if (!SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, message: "Auth is not configured" };
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return { ok: false, status: 401, message: "Missing bearer token" };
  }

  const { data, error } = await supabaseAuth.auth.getUser(jwt);
  if (error || !data?.user) {
    return { ok: false, status: 401, message: "Invalid or expired token" };
  }

  return { ok: true, userId: data.user.id };
}
