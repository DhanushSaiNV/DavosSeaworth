// supabase/functions/select-metrics/index.ts
// FP-09 Step 4 — the onboarding metric selection (TECH-SPEC §7.7, §7.9).
//
// One synchronous call, zero providers. The request carries the assistant proposal row
// and 1–2 keys; the chip list is read from that row's `metadata.metric_options`, never
// from the request. Every key resolves to a preset formula from the server library and
// is written through `insertValidatedMetric`, so the §7.9 gate runs on the stored formula
// (AGENTS.md §4.4: the only evaluable code is JSONLogic through the validation gate).
//
// Ordering is the resilience contract (FP-09 FR-7): metric rows land before the stage
// compare-and-set. A crash between the two leaves `metric_selection` + rows, and a
// re-confirm reuses the rows by preset name before flipping the stage. A call at
// `complete` is a no-op returning the existing rows (`duplicate`).
//
// The 400/404 table mirrors `select-persona`: malformed body/keys, a non-assistant row,
// a row without options, and keys outside that row's options are all server-state
// decisions. Unknown or foreign message ids are 404. A proposal row can be answered
// before `send-message`'s advance lands, so the stage guard accepts the `routine` race
// as well as `metric_selection`; earlier stages are 409.
//
// Refs: FP-09 FR-7, FR-8; TECH-SPECS §5.3, §7.7, §7.9, §9; D10, D17; AGENTS.md §4.1,
// §4.4. Security: the service client writes only inside this function; no user text,
// tactical_analysis or trust state is read or returned.

import { getConfig, supabaseService } from "../_shared/config.ts";
import { resolveUserId } from "../_shared/auth.ts";
import { parseFormulaBounds, insertValidatedMetric } from "../_shared/metrics/create.ts";
import { METRIC_PRESETS, type MetricPreset } from "../_shared/metrics/presets.ts";
import { advanceOnboardingStage } from "../_shared/onboarding/apply.ts";
import type { MetricOption } from "../_shared/onboarding/state.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // supabase-js sets `x-client-info` on every browser call (the select-persona precedent).
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

// Request-input validation only (never LLM output — AGENTS.md §5.1).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRESET_BY_NAME: ReadonlyMap<string, MetricPreset> = new Map(
  METRIC_PRESETS.map((preset) => [preset.name, preset]),
);

/** The stages that may answer a metric proposal: the normal path plus the advance race. */
const SELECTABLE_STAGES: ReadonlySet<string> = new Set(["metric_selection", "routine"]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** The stored chip list. A malformed list is server-state corruption, never partially used. */
function readMetricOptions(metadata: unknown): MetricOption[] | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const raw = (metadata as { metric_options?: unknown }).metric_options;
  // The proposal contract is exactly three chips (Step 3's chipPayload / apply parser).
  if (!Array.isArray(raw) || raw.length !== 3) return null;

  const options: MetricOption[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const option = entry as Record<string, unknown>;
    if (
      typeof option.key !== "string" || option.key.length === 0 ||
      typeof option.label !== "string" || option.label.length === 0 ||
      typeof option.domain !== "string" || option.domain.length === 0 ||
      typeof option.output_unit !== "string" || option.output_unit.length === 0 ||
      seen.has(option.key)
    ) {
      return null;
    }
    seen.add(option.key);
    options.push({
      key: option.key,
      label: option.label,
      domain: option.domain,
      output_unit: option.output_unit,
    });
  }
  return options;
}

/** 1–2 unique, non-empty keys. The order is preserved for the response. */
function readKeys(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) return null;
  const keys: string[] = [];
  for (const key of raw) {
    if (typeof key !== "string" || key.length === 0 || key.length > 128) return null;
    if (keys.includes(key)) return null;
    keys.push(key);
  }
  return keys;
}

/** The caller's own active core metrics with one of the requested preset names. */
async function readExistingCoreMetrics(
  userId: string,
  keys: readonly string[],
): Promise<Map<string, string>> {
  const { data, error } = await supabaseService
    .from("metrics")
    .select("id, name, created_at")
    .eq("user_id", userId)
    .eq("is_core", true)
    .is("archived_at", null)
    .in("name", keys)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const byName = new Map<string, string>();
  for (const row of data ?? []) {
    const name = row.name as string;
    if (!byName.has(name)) byName.set(name, row.id as string);
  }
  return byName;
}

/** Metric ids in request-key order, skipping a key with no existing row. */
function orderedIds(keys: readonly string[], byName: ReadonlyMap<string, string>): string[] {
  return keys.map((key) => byName.get(key)).filter((id): id is string => typeof id === "string");
}

/** Read the stage once; a missing/non-string value is a corrupt profile, not a guess. */
async function readStage(userId: string): Promise<string | null> {
  const { data, error } = await supabaseService
    .from("profiles")
    .select("onboarding_stage")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  const stage = data?.onboarding_stage;
  return typeof stage === "string" ? stage : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // JWT is verified by the gateway; resolve the user ourselves so --no-verify-jwt can
  // never turn an unverified token into a user id (the select-persona discipline).
  const auth = await resolveUserId(req);
  if (!auth.ok) {
    return json({ error: auth.message }, auth.status);
  }
  const userId = auth.userId;

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const messageId = body.message_id;
  if (typeof messageId !== "string" || !UUID_RE.test(messageId)) {
    return json({ error: "message_id must be a uuid" }, 400);
  }

  const keys = readKeys(body.keys);
  if (!keys) {
    return json({ error: "keys must be 1–2 unique non-empty strings" }, 400);
  }

  try {
    // --- The proposal row and its server-owned chip list ---
    const { data: option, error: optionError } = await supabaseService
      .from("messages")
      .select("id, role, user_id, metadata")
      .eq("id", messageId)
      .eq("user_id", userId)
      .maybeSingle();
    if (optionError) throw optionError;
    if (!option) return json({ error: "message not found" }, 404);
    if (option.role !== "assistant") {
      return json({ error: "message_id must reference an assistant reply" }, 400);
    }

    const options = readMetricOptions(option.metadata);
    if (!options) return json({ error: "message carries no metric options" }, 400);

    // FR-7: the keys must be a subset of THIS row's options. The client's list is never
    // trusted, and a key with no preset is corrupt server state.
    const offered = new Set(options.map((option) => option.key));
    for (const key of keys) {
      if (!offered.has(key)) {
        return json({ error: "keys must be a subset of this message's metric options" }, 400);
      }
      if (!PRESET_BY_NAME.has(key)) {
        console.error("[select-metrics] stored option has no preset:", messageId, key);
        return json({ error: "metric option is not a known preset" }, 400);
      }
    }

    const stage = await readStage(userId);
    if (stage === "complete") {
      const existing = await readExistingCoreMetrics(userId, keys);
      return json({ status: "duplicate", metric_ids: orderedIds(keys, existing) });
    }
    if (stage === null || !SELECTABLE_STAGES.has(stage)) {
      return json({ error: "onboarding is not at metric selection" }, 409);
    }

    const bounds = parseFormulaBounds(await getConfig("metric_formula_bounds"));
    if (!bounds) {
      throw new Error("config.metric_formula_bounds is missing or malformed");
    }

    // --- Rows first: reuse an active core row (a crash/retry between calls), else insert
    // through the one validated writer. Any failure stops before the stage flip. ---
    const existing = await readExistingCoreMetrics(userId, keys);
    const metricIds: string[] = [];
    for (const key of keys) {
      const reused = existing.get(key);
      if (reused) {
        metricIds.push(reused);
        continue;
      }

      const preset = PRESET_BY_NAME.get(key)!;
      const created = await insertValidatedMetric(
        {
          user_id: userId,
          name: preset.name,
          domain: preset.domain,
          output_unit: preset.output_unit,
          formula: preset.formula,
          is_core: true,
        },
        bounds,
      );
      if (!created.ok) {
        const detail = created.stage === "insert"
          ? created.detail
          : created.errors[0]?.message ?? "formula gate rejected the preset";
        throw new Error(`metric insert failed for "${key}": ${detail}`);
      }
      metricIds.push(created.metricId);
    }

    // --- Then the compare-and-set. A lost race means a concurrent confirm flipped it. ---
    const advanced = await advanceOnboardingStage({
      userId,
      from: stage as "metric_selection" | "routine",
      to: "complete",
    });
    if (!advanced) {
      const winnerStage = await readStage(userId);
      if (winnerStage === "complete") {
        const rows = await readExistingCoreMetrics(userId, keys);
        return json({ status: "duplicate", metric_ids: orderedIds(keys, rows) });
      }
      return json({ error: "onboarding stage changed during selection" }, 409);
    }

    console.log(
      JSON.stringify({
        tag: "[select-metrics]",
        event: "selected",
        userId,
        messageId,
        keys,
        metricIds,
        fromStage: stage,
      }),
    );

    return json({ status: "ok", metric_ids: metricIds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[select-metrics] failed:", msg);
    return json({ error: "Failed to select metrics" }, 500);
  }
});
