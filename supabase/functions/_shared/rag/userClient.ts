// supabase/functions/_shared/rag/userClient.ts
// P3 — the user-JWT client the retrieval RPCs require (PRD §6.1, §14.1 C7).
//
// The ten `query_*` functions and the two memory functions are `authenticated`-only: the
// `anon` and `service_role` roles are refused with `42501`, so the pipeline's service-role
// client cannot execute a plan. This module builds a client that carries the *caller's* token,
// which is also the only shape that lets RLS do its job — the retrieval layer never sees a
// service-role key (PLAN.md §3).
//
// Separate from `dispatch.ts` on purpose: the dispatcher declares a three-method structural
// interface and imports nothing, so it stays testable. This is the one module that knows how a
// request becomes a client, and it is never imported by a Jest suite (`Deno.env` at module
// scope).

import { createClient } from "npm:@supabase/supabase-js@2";
import type { RagClient } from "./dispatch.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Supabase injects SUPABASE_ANON_KEY; newer projects also expose SUPABASE_PUBLISHABLE_KEY.
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";

/**
 * A client bound to the incoming request's bearer token, or `undefined` when there is none.
 *
 * `undefined` is the honest answer and the planner's off switch: without a user token the
 * retrieval RPCs cannot run, so the caller keeps the legacy path rather than issuing requests
 * that are guaranteed to be refused. The gateway already rejects an unauthenticated request,
 * so this is a defence in depth for a `--no-verify-jwt` deployment.
 */
export function ragClientFor(req: Request): RagClient | undefined {
  if (!SUPABASE_ANON_KEY) return undefined;
  const authorization = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authorization) return undefined;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  }) as unknown as RagClient;
}
