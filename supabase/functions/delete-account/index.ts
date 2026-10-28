// supabase/functions/delete-account/index.ts
// Decision 27 (2026-10-28) / TECH-SPEC §7.13 — the self-service account lifecycle surface.
//
// Two modes, one endpoint, one confirmation contract:
//   { mode: "reset",  confirm: "RESET"  } → purge the caller's rows, recreate the profile,
//                                          and let the 0033 trigger write the opening message.
//   { mode: "delete", confirm: "DELETE" } → purge the caller's rows, then delete the auth user
//                                          (cascades are the second line of defence).
//
// The `user_id` is always the JWT-derived id (`resolveUserId`) — never accepted from the
// body (AGENTS.md §4.1). The heavy lifting is in migration 0034's SECURITY DEFINER functions:
// `purge_user_data` / `reset_user_data` exist so a reset is one transaction and takes the same
// per-user advisory lock as the FP-08 strike path.
//
// Delete is purge-then-admin-delete (two transactions). A failure between them leaves an auth
// user with no data; retrying the same request completes it, and a 404 from the admin API is
// treated as success so a retry after a lost response is idempotent.
//
// Kill switch: `config.account_lifecycle_enabled` [SPEC]. A missing/mistyped key is a 500
// (`getConfigBoolean` fails closed), never a silently-enabled destructive surface.
//
// Zero provider calls: no LLM/embedding import anywhere on this path.

import { getConfigBoolean, supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { parseAccountBody } from "../_shared/account/lifecycleContract.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // JWT is verified by the gateway (verify_jwt default); we still resolve it ourselves.
  const auth = await resolveUserId(req);
  if (!auth.ok) {
    return json({ error: auth.message }, auth.status);
  }
  const userId = auth.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = parseAccountBody(body);
  if (!parsed.ok) {
    return json({ error: parsed.error }, parsed.status);
  }

  let enabled: boolean;
  try {
    enabled = await getConfigBoolean("account_lifecycle_enabled");
  } catch (err) {
    console.error("[delete-account] kill switch unavailable", String(err));
    return json({ error: "Account lifecycle is not configured" }, 500);
  }
  if (!enabled) {
    return json({ error: "Account lifecycle is disabled" }, 403);
  }

  try {
    if (parsed.mode === "reset") {
      const { data, error } = await supabaseService.rpc("reset_user_data", {
        p_user_id: userId,
      });
      if (error) throw error;

      console.log(
        "[delete-account]",
        JSON.stringify({ mode: "reset", user_id: userId, counts: data }),
      );
      return json({ status: "ok", mode: "reset", counts: data ?? {} });
    }

    const { data, error } = await supabaseService.rpc("purge_user_data", {
      p_user_id: userId,
    });
    if (error) throw error;

    let authDeleted = true;
    const { error: deleteError } = await supabaseService.auth.admin.deleteUser(userId);
    if (deleteError) {
      // supabase-js surfaces a missing user as a 404 AuthApiError. A purge already ran, so
      // "the user is absent" is the success state a retry converges on.
      const status = (deleteError as { status?: number }).status;
      if (status !== 404) throw deleteError;
      authDeleted = false;
    }

    console.log(
      "[delete-account]",
      JSON.stringify({ mode: "delete", user_id: userId, counts: data, auth_deleted: authDeleted }),
    );
    return json({
      status: "ok",
      mode: "delete",
      counts: data ?? {},
      auth_deleted: authDeleted,
    });
  } catch (err) {
    // No email, no token, no row contents in the log line.
    console.error("[delete-account] failed", String(err));
    return json({ error: "Account operation failed" }, 500);
  }
});
