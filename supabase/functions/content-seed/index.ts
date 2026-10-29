// supabase/functions/content-seed/index.ts
// BG-01 Steps 2–3 — content seeding pipeline (dry-run / live seed / clear).
//
// Owner-gated path from DRAFT content to seeded RAG rows (AGENTS §8.4):
//   1. Owner approves rows in content/*.csv (status='approved') — authoring
//      gate is content/validate.ts, same core as this function.
//   2. Caller POSTs the approved CSV here. This function re-validates, embeds
//      via the provider adapter (llm.embed only — AGENTS §3.5), and upserts
//      with the frozen embedding identity (embed_model='gemini-embedding-001@768').
//   3. Dry-run mode reports per-table/per-status counts and writes nothing.
//   4. content-clear (this function's `clear` action) deletes by explicit ids
//      or dev label — the inverse operation.
//
// Idempotency: deterministic uuid v5 ids derived from the CSV string ids
// (rules.id / exemplars.id have no DB default), so re-seeding upserts instead
// of duplicating. Never seeds draft rows. Auth: bearer CONTENT_SEED_TOKEN
// (same pattern as dev-smoke; gateway verify_jwt is off, enforcement in-code).

import { createClient } from "npm:@supabase/supabase-js@2";
import { embed } from "../_shared/llm/adapter.ts";
import {
  EMBED_MODEL,
  parseCsv,
  requiredColumnsPresent,
  uuidV5,
  validateExemplarRows,
  validateRuleRows,
} from "../_shared/content.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONTENT_SEED_TOKEN = Deno.env.get("CONTENT_SEED_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Gemini batchEmbedContents is bounded; seed in safe chunks (TECH-SPECS §12 headroom). */
const EMBED_CHUNK = 50;

type ContentTable = "rules" | "exemplars";
type SeedMode = "dry-run" | "live";

interface SeedRequest {
  action: "seed" | "clear" | "counts";
  table?: ContentTable;
  csv?: string;
  mode?: SeedMode;
  /** clear: content string ids (e.g. "r_mind_01") — mapped to deterministic uuids. */
  ids?: string[];
  /** clear: delete rows whose source_figure (rules) / label (exemplars) equals this. */
  devLabel?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function tableCounts(table: ContentTable): Promise<{ total: number; withEmbedding: number }> {
  const { count: total, error: e1 } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (e1) throw new Error(`count ${table}: ${e1.message}`);
  const { count: withEmbedding, error: e2 } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .not("embedding", "is", null);
  if (e2) throw new Error(`count ${table} embeddings: ${e2.message}`);
  return { total: total ?? 0, withEmbedding: withEmbedding ?? 0 };
}

async function handleSeed(body: SeedRequest): Promise<Response> {
  const table = body.table;
  if (table !== "rules" && table !== "exemplars") {
    return json({ ok: false, error: "seed requires table: 'rules' | 'exemplars'" }, 400);
  }
  if (typeof body.csv !== "string" || body.csv.trim() === "") {
    return json({ ok: false, error: "seed requires csv: <file content>" }, 400);
  }
  const mode: SeedMode = body.mode === "live" ? "live" : "dry-run";

  // 1. Parse + schema (required columns).
  const { header, rows } = parseCsv(body.csv);
  const required =
    table === "rules"
      ? ["id", "text", "domain", "source_figure", "tone", "priority", "status"]
      : ["id", "set_kind", "label", "text", "status"];
  const missing = requiredColumnsPresent(header, required);
  if (missing.length > 0) {
    return json({ ok: false, error: `${table} csv missing required columns: ${missing.join(", ")}` }, 400);
  }

  // 2. Validate — the exact same gate as content/validate.ts (shared core).
  const errors = table === "rules" ? validateRuleRows(rows) : validateExemplarRows(rows);
  if (errors.length > 0) {
    return json({ ok: false, error: "validation failed — nothing written", table, errors }, 422);
  }

  // 3. Status split — drafts are reported and never seeded (AGENTS §8.4).
  const approved = rows.filter((r) => (r["status"] ?? "").trim() === "approved");
  const draft = rows.length - approved.length;
  const counts = { table, total: rows.length, approved: approved.length, draft };

  if (mode === "dry-run") {
    const dbBefore = {
      rules: await tableCounts("rules"),
      exemplars: await tableCounts("exemplars"),
    };
    return json({ ok: true, action: "seed", mode, ...counts, dbBefore, note: "dry-run: nothing written" });
  }

  if (approved.length === 0) {
    return json({
      ok: true,
      action: "seed",
      mode,
      ...counts,
      seeded: 0,
      note: "no approved rows — nothing seeded (AGENTS §8.4: drafts are never seeded)",
    });
  }

  // 4. Embed everything BEFORE writing — an embed failure leaves the DB untouched.
  const texts = approved.map((r) => (r["text"] ?? "").trim());
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_CHUNK) {
    const chunk = texts.slice(i, i + EMBED_CHUNK);
    const result = await embed(chunk);
    if (!result.ok || !result.data) {
      return json({ ok: false, error: `embed failed (chunk ${Math.floor(i / EMBED_CHUNK)}): ${result.error ?? "unknown"}` }, 502);
    }
    if (result.data.embeddings.length !== chunk.length) {
      return json({
        ok: false,
        error: `embed returned ${result.data.embeddings.length} vector(s) for ${chunk.length} text(s) — ` +
          `if llm_stub_mode is on, disable it for seeding (stub returns a single vector)`,
      }, 409);
    }
    vectors.push(...result.data.embeddings);
  }

  // 5. Deterministic ids + upsert (idempotent re-seed).
  if (table === "rules") {
    const payload = await Promise.all(
      approved.map(async (r, i) => ({
        id: await uuidV5((r["id"] ?? "").trim()),
        text: (r["text"] ?? "").trim(),
        domain: (r["domain"] ?? "").trim(),
        source_figure: (r["source_figure"] ?? "").trim(),
        tone: (r["tone"] ?? "").trim(),
        priority: Number((r["priority"] ?? "").trim()),
        embed_model: EMBED_MODEL,
        embedding: vectors[i],
      })),
    );
    const { error } = await supabase.from("rules").upsert(payload, { onConflict: "id" });
    if (error) return json({ ok: false, error: `upsert rules: ${error.message}` }, 500);
  } else {
    const payload = await Promise.all(
      approved.map(async (r, i) => ({
        id: await uuidV5((r["id"] ?? "").trim()),
        set_kind: (r["set_kind"] ?? "").trim(),
        label: (r["label"] ?? "").trim(),
        text: (r["text"] ?? "").trim(),
        source: (r["source"] ?? "BG-04").trim(),
        embed_model: EMBED_MODEL,
        embedding: vectors[i],
      })),
    );
    const { error } = await supabase.from("exemplars").upsert(payload, { onConflict: "id" });
    if (error) return json({ ok: false, error: `upsert exemplars: ${error.message}` }, 500);
  }

  return json({
    ok: true,
    action: "seed",
    mode,
    ...counts,
    seeded: approved.length,
    seededIds: approved.map((r) => (r["id"] ?? "").trim()),
    embedModel: EMBED_MODEL,
    dbAfter: {
      rules: await tableCounts("rules"),
      exemplars: await tableCounts("exemplars"),
    },
  });
}

async function handleClear(body: SeedRequest): Promise<Response> {
  const results: Record<string, unknown> = {};

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const uuids = await Promise.all(body.ids.map((id) => uuidV5(id)));
    const delRules = await supabase.from("rules").delete().in("id", uuids).select("id");
    if (delRules.error) return json({ ok: false, error: `clear rules: ${delRules.error.message}` }, 500);
    const delExemplars = await supabase.from("exemplars").delete().in("id", uuids).select("id");
    if (delExemplars.error) return json({ ok: false, error: `clear exemplars: ${delExemplars.error.message}` }, 500);
    results.byIds = {
      requested: body.ids.length,
      rulesDeleted: delRules.data?.length ?? 0,
      exemplarsDeleted: delExemplars.data?.length ?? 0,
    };
  }

  if (typeof body.devLabel === "string" && body.devLabel.trim() !== "") {
    const label = body.devLabel.trim();
    const delRules = await supabase.from("rules").delete().eq("source_figure", label).select("id");
    if (delRules.error) return json({ ok: false, error: `clear rules by label: ${delRules.error.message}` }, 500);
    // Exemplars have no source_figure column; their dev label lives in `label`.
    const delExemplars = await supabase.from("exemplars").delete().eq("label", label).select("id");
    if (delExemplars.error) return json({ ok: false, error: `clear exemplars by label: ${delExemplars.error.message}` }, 500);
    results.byDevLabel = {
      label,
      rulesDeleted: delRules.data?.length ?? 0,
      exemplarsDeleted: delExemplars.data?.length ?? 0,
    };
  }

  if (Object.keys(results).length === 0) {
    return json({ ok: false, error: "clear requires ids: string[] and/or devLabel: string" }, 400);
  }

  return json({
    ok: true,
    action: "clear",
    ...results,
    dbAfter: {
      rules: await tableCounts("rules"),
      exemplars: await tableCounts("exemplars"),
    },
  });
}

async function handleCounts(): Promise<Response> {
  return json({
    ok: true,
    action: "counts",
    rules: await tableCounts("rules"),
    exemplars: await tableCounts("exemplars"),
  });
}

Deno.serve(async (req) => {
  // CORS (curl/tooling friendly).
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      status: 204,
    });
  }

  // Dev/ops tooling only: dedicated bearer token required (service-role class).
  // Gateway verify_jwt is off, so enforcement happens here (dev-smoke pattern).
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${CONTENT_SEED_TOKEN}`) {
    return json({ ok: false, error: "Forbidden: content-seed requires bearer token" }, 401);
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method not allowed — POST only" }, 405);
  }

  let body: SeedRequest;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }

  try {
    switch (body.action) {
      case "seed":
        return await handleSeed(body);
      case "clear":
        return await handleClear(body);
      case "counts":
        return await handleCounts();
      default:
        return json({ ok: false, error: "action must be 'seed' | 'clear' | 'counts'" }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: `unexpected: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});
