// supabase/functions/dev-smoke/index.ts
// Dev-only smoke test Edge Function for FP-02 provider adapter verification

import { createClient } from "npm:@supabase/supabase-js@2";
import { generate, embed } from "../_shared/llm/adapter.ts";
import { getConfig, getConfigBoolean } from "../_shared/config.ts";
import { classify, D7Fallback, type Classification } from "../_shared/pipeline/classify.ts";
import { classifyReal } from "../_shared/pipeline/classifyReal.ts";
import { retrieveRules } from "../_shared/pipeline/retrieveRules.ts";
import { runPipeline, loadMemoryContext, memoryRetrievalEnabled } from "../_shared/pipeline/runPipeline.ts";
import { determinePersona, readConfidenceBands } from "../_shared/pipeline/persona.ts";
import { runWatchdogScan, runIntervention } from "../_shared/checkin/runWatchdog.ts";
import { runDriftScan, loadDriftEvidence } from "../_shared/accountability/runDriftScan.ts";
import { runQuestExpire } from "../_shared/accountability/runQuestExpire.ts";
import { runStrike } from "../_shared/accountability/runStrike.ts";
import { runHistogramRebuild } from "../_shared/accountability/runHistogram.ts";
import { runJournalExtract, runJournalProbe, runAnchorPlan } from "../_shared/journal/runChain.ts";
import {
  loadMemoryBacklog,
  runMemoryExtract,
  type Job as MemoryJob,
} from "../_shared/memory/runExtract.ts";
import { runPurgeMemory } from "../_shared/memory/purge.ts";
import { insertValidatedMetric, parseFormulaBounds } from "../_shared/metrics/create.ts";
import { METRIC_PRESETS, METRIC_PRESET_NAMES } from "../_shared/metrics/presets.ts";
import { isProposalDomain, proposeMetric } from "../_shared/metrics/propose.ts";
import { readMetricDay, runMetricEval } from "../_shared/metrics/runEval.ts";
import { overridesFromForce } from "../_shared/dev/overrides.ts";
import { applyTrustRider, maybeRequestOath } from "../_shared/accountability/applyRider.ts";
import {
  OnboardingResetRefusedError,
  applyOnboardingBlock,
  forceOnboardingStage,
  readOnboardingStage,
  resetOnboardingDrill,
} from "../_shared/onboarding/apply.ts";
import {
  ONBOARDING_STAGES,
  advanceTarget,
  type OnboardingStage,
} from "../_shared/onboarding/state.ts";
import { runProactive } from "../_shared/proactive/runProactive.ts";
import { gapVector } from "../_shared/proactive/gaps.ts";
import {
  PLACEHOLDER_RULES,
  PLACEHOLDER_SOURCE_FIGURE,
  PLACEHOLDER_EMBED_MODEL,
} from "../_shared/dev/placeholderRules.ts";
import { BG04_EXEMPLARS, BG04_EXEMPLAR_SOURCE } from "../_shared/content/exemplars/bg04.ts";
import { EMBED_MODEL } from "../_shared/content.ts";
import {
  GOLDEN_SET,
  GOLDEN_SET_SOURCE,
  type GoldenCase,
  type GoldenExpectation,
} from "../_shared/dev/goldenSet.ts";

// FP-03 Step 2: 233 exemplar texts exceed the untested single-call batch size, so the seed
// is chunked (NFR-2 "adapter-chunked, ≤ ~3 requests"): 233 -> 3 calls of <= 100.
const SEED_EXEMPLAR_BATCH_SIZE = 100;

// FP-03 Step 6 amendment: Gemini counts *every item* of a `batchEmbedContents` call against the
// embedding quota (TECH-SPEC §12: 100 RPM / 1,000 RPD — measured at 140/100 RPM in the Cloud
// console during the first Step 6 run), while one Edge invocation is capped at 150 s. 233
// items therefore need ~2.3 min of quota and can never fit in one invocation, so the seed is
// resumable and seeds one quota-safe *window* per call; the caller paces the windows.
const SEED_EXEMPLAR_WINDOW = 80;

// FP-03 Step 7 (FR-16, AC-8): the exemplar `source` tag is also the content *slot*. The
// PLACEHOLDER-DEV slot was retired on 2026-10-28 (owner instruction: the approved BG-04 corpus
// is the only content), so `BG-04` is the one remaining slot and `&source=` is now required —
// no default, so a bare call can never re-embed or clear the live approved corpus by accident.
// `BG-04` reads `_shared/content/exemplars/bg04.ts` (content-only: no classifier, pipeline or
// schema code changes).
type ExemplarItem = { setKind: "domain" | "emotion" | "quit_signal"; label: string; text: string };
const EXEMPLAR_SETS: Record<string, readonly ExemplarItem[]> = {
  [BG04_EXEMPLAR_SOURCE]: BG04_EXEMPLARS,
};
const EXEMPLAR_SOURCES = Object.keys(EXEMPLAR_SETS).join(" | ");

/** `&source=` — required; the retired placeholder default is gone (2026-10-28). */
function exemplarSource(url: URL): string | null {
  const raw = url.searchParams.get("source");
  if (raw === null) return null;
  return Object.prototype.hasOwnProperty.call(EXEMPLAR_SETS, raw) ? raw : null;
}

function unknownSourceResponse(got: string | null): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "missing or unknown exemplar source",
      hint: `source must be one of: ${EXEMPLAR_SOURCES}`,
      got,
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEV_SMOKE_TOKEN = Deno.env.get("DEV_SMOKE_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface SmokeRequest {
  action:
    | "embed"
    | "generate"
    | "models"
    | "seed-rules"
    | "clear-rules"
    | "seed-metrics"
    | "clear-metrics"
    | "seed-exemplars"
    | "clear-exemplars"
    | "match-exemplars"
    | "classify"
    | "retrieve"
    | "pipeline"
    | "eval-classifier"
    | "watchdog-scan"
    | "journal-drill"
    | "accountability-drill"
    | "oath-trigger-drill"
    | "intervention-drill"
    | "drift-drill"
    | "memory-drill"
    | "metric-drill"
    | "onboarding-drill";
  domain?: string;
  text?: string;
  force?: "high" | "medium" | "low" | "fallback";
}

// ---------------------------------------------------------------------------
// FP-03 Step 6 (NFR-4, AC-9): golden-set eval types + pure aggregation helpers.
//
// The eval action is the only consumer; `scripts/verify-fp03-step6.py` recomputes every number
// here from the returned per-item results and asserts they agree, so a bug in this aggregation
// cannot silently pass the gate.
// ---------------------------------------------------------------------------

/** The quit-set argmax — the §6.3 block exposes only the boolean, not the winning label. */
interface EvalQuitTop {
  label: string;
  sim: number;
}

interface EvalCaseResult {
  id: string;
  case: GoldenCase;
  text: string;
  energy: number | null;
  expect: GoldenExpectation;
  got: Classification;
  route: string;
  bandShift: number;
  quitTop: EvalQuitTop | null;
}

/**
 * Top `quit_signal` row by similarity. Ties break on the lexicographically lower label, the
 * same rule `composeClassification` uses, so the eval never depends on RPC row order.
 */
function topQuitMatch(data: unknown): EvalQuitTop | null {
  let best: EvalQuitTop | null = null;
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    if (raw.set_kind !== "quit_signal") continue;
    const label = raw.label;
    const sim = typeof raw.sim === "number" ? raw.sim : Number.NaN;
    if (typeof label !== "string" || !Number.isFinite(sim)) continue;
    if (best === null || sim > best.sim || (sim === best.sim && label < best.label)) {
      best = { label, sim };
    }
  }
  return best;
}

/** Ratio rounded to 4 dp so the JSON is stable and the script's recomputation matches. */
function rate(hit: number, total: number): number {
  return total === 0 ? 0 : Math.round((hit / total) * 10000) / 10000;
}

function summarizeEval(results: EvalCaseResult[]) {
  const byCase = (kase: GoldenCase) => results.filter((r) => r.case === kase);
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.case] = (counts[r.case] ?? 0) + 1;

  const clear = byCase("clear");
  const clearCorrect = clear.filter((r) => r.got.domain === r.expect.domain).length;

  const energy = byCase("energy");
  const energyCompliant = energy.filter((r) => r.got.emotion === r.expect.emotion).length;

  const ambiguous = byCase("ambiguous");
  const ambiguousInPair = ambiguous.filter((r) => {
    const pair = r.expect.domains;
    return pair !== undefined && r.got.domain !== null && pair.includes(r.got.domain);
  }).length;

  // The 12 quit-set items are a two-class problem over the quit-set argmax label.
  const quitItems = byCase("quit");
  const fcItems = byCase("false_constraint");
  const predicted = (r: EvalCaseResult) => r.quitTop?.label ?? null;
  const predictedCount = (label: string) =>
    [...quitItems, ...fcItems].filter((r) => predicted(r) === label).length;
  const truePositive = (items: EvalCaseResult[], label: string) =>
    items.filter((r) => predicted(r) === label).length;

  const quitTp = truePositive(quitItems, "quit");
  const quitPredicted = predictedCount("quit");
  const fcTp = truePositive(fcItems, "false_constraint");
  const fcPredicted = predictedCount("false_constraint");

  return {
    counts,
    clear: {
      correct: clearCorrect,
      total: clear.length,
      accuracy: rate(clearCorrect, clear.length),
    },
    energy: {
      compliant: energyCompliant,
      total: energy.length,
      compliance: rate(energyCompliant, energy.length),
    },
    ambiguous: {
      in_pair: ambiguousInPair,
      total: ambiguous.length,
      rate: rate(ambiguousInPair, ambiguous.length),
    },
    quit_set: {
      quit: {
        tp: quitTp,
        fp: quitPredicted - quitTp,
        fn: quitItems.length - quitTp,
        recall: rate(quitTp, quitItems.length),
        precision: rate(quitTp, quitPredicted),
      },
      false_constraint: {
        tp: fcTp,
        fp: fcPredicted - fcTp,
        fn: fcItems.length - fcTp,
        recall: rate(fcTp, fcItems.length),
        precision: rate(fcTp, fcPredicted),
      },
      // §6.3/GLOSSARY: `quit_signal` is a single flag over the whole quit set, so both labels
      // legitimately arm it. Recorded separately from the per-label metrics above.
      quit_signal_flag: {
        quit: quitItems.filter((r) => r.got.quit_signal).length,
        false_constraint: fcItems.filter((r) => r.got.quit_signal).length,
      },
    },
  };
}

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      status: 204,
    });
  }

  // Dev-only: dedicated bearer token required (plan: "service-role key auth").
  // Decoupled from Supabase's injected key vars, which are being deprecated.
  // Gateway verify_jwt is off, so enforcement happens here.
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${DEV_SMOKE_TOKEN}`) {
    return new Response(JSON.stringify({ error: "Forbidden: dev-smoke requires bearer token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") as SmokeRequest["action"] | null;

  if (!action) {
    return new Response(
      JSON.stringify({
        error: "Missing action param",
        available: [
          "embed",
          "generate",
          "models",
          "seed-rules",
          "clear-rules",
          "seed-metrics",
          "clear-metrics",
          "seed-exemplars",
          "clear-exemplars",
          "match-exemplars",
          "classify",
          "retrieve",
          "pipeline",
          "eval-classifier",
          "watchdog-scan",
          "journal-drill",
          "memory-drill",
          "metric-drill",
        ],
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    switch (action) {
      case "embed": {
        const result = await embed(["Test embedding for dev-smoke", "Second test vector"]);
        if (!result.ok) throw new Error(result.error);
        return new Response(
          JSON.stringify({
            ok: true,
            dimension: result.data?.dimension,
            count: result.data?.embeddings.length,
            firstVector: result.data?.embeddings[0]?.slice(0, 5),
            model: result.data?.model,
            provider: result.provider,
            latencyMs: result.latencyMs,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "models": {
        const gKey = Deno.env.get("GEMINI_API_KEY")!;
        const qKey = Deno.env.get("GROQ_API_KEY")!;
        const out: Record<string, unknown> = {};

        try {
          const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${gKey}&pageSize=200`);
          const gJson = await gRes.json();
          out.gemini_status = gRes.status;
          out.gemini_models = (gJson.models ?? []).map((m: { name: string }) => m.name.replace("models/", ""));
          out.gemini_error = gJson.error?.message;
        } catch (e) {
          out.gemini_error = String(e);
        }

        try {
          const qRes = await fetch("https://api.groq.com/openai/v1/models", {
            headers: { Authorization: `Bearer ${qKey}` },
          });
          const qJson = await qRes.json();
          out.groq_status = qRes.status;
          out.groq_models = (qJson.data ?? []).map((m: { id: string }) => m.id);
          out.groq_error = qJson.error?.message;
        } catch (e) {
          out.groq_error = String(e);
        }

        return new Response(JSON.stringify(out), {
          headers: { "Content-Type": "application/json" },
        });
      }

      case "generate": {
        const result = await generate({
          system: "You are Davos, a tough but caring mentor. Respond in the exact JSON schema with tactical_analysis, direct_quote, persona, and optionally ui_metadata.persona_options.",
          messages: [
            { role: "user", content: "I'm feeling overwhelmed with work and keep procrastinating." },
          ],
          schema: {
            type: "object",
            properties: {
              tactical_analysis: { type: "string" },
              direct_quote: { type: "string" },
              persona: { type: "string" },
              ui_metadata: {
                type: "object",
                properties: {
                  persona_options: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        key: { type: "string" },
                        label: { type: "string" },
                        one_liner: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
            required: ["tactical_analysis", "direct_quote", "persona"],
          },
        });
        if (!result.ok) throw new Error(result.error);
        return new Response(
          JSON.stringify({
            ok: true,
            data: result.data,
            provider: result.provider,
            latencyMs: result.latencyMs,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "seed-rules": {
        // Idempotent: clear any prior placeholder rows before re-seeding.
        const { error: clearError } = await supabase
          .from("rules")
          .delete()
          .eq("source_figure", PLACEHOLDER_SOURCE_FIGURE);
        if (clearError) throw clearError;

        // Real embeddings via the provider adapter (one batched call).
        const embedResult = await embed(PLACEHOLDER_RULES.map((r) => r.text));
        if (!embedResult.ok) throw new Error(embedResult.error);
        const vectors = embedResult.data!.embeddings;
        if (vectors.length !== PLACEHOLDER_RULES.length) {
          throw new Error(
            `embedding count mismatch: ${vectors.length} != ${PLACEHOLDER_RULES.length}`,
          );
        }

        const rows = PLACEHOLDER_RULES.map((r, i) => ({
          id: crypto.randomUUID(),
          text: r.text,
          domain: r.domain,
          source_figure: PLACEHOLDER_SOURCE_FIGURE,
          tone: r.tone,
          priority: r.priority,
          embed_model: PLACEHOLDER_EMBED_MODEL,
          embedding: vectors[i],
        }));

        const { error } = await supabase.from("rules").insert(rows);
        if (error) throw error;

        return new Response(
          JSON.stringify({
            ok: true,
            seeded: rows.length,
            domains: [...new Set(rows.map((r) => r.domain))],
            embedModel: PLACEHOLDER_EMBED_MODEL,
            provider: embedResult.provider,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "clear-rules": {
        const { error } = await supabase
          .from("rules")
          .delete()
          .eq("source_figure", "PLACEHOLDER-DEV");
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      case "seed-metrics": {
        const userId = url.searchParams.get("user");
        if (!userId) {
          return new Response(JSON.stringify({ ok: false, error: "seed-metrics requires &user=<uuid>" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const bounds = parseFormulaBounds(await getConfig("metric_formula_bounds"));
        if (!bounds) {
          return new Response(
            JSON.stringify({ ok: false, error: "config.metric_formula_bounds is missing or malformed" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const { data: existing, error: readError } = await supabase
          .from("metrics")
          .select("name")
          .eq("user_id", userId);
        if (readError) throw readError;
        const have = new Set((existing ?? []).map((row) => row.name as string));

        let inserted = 0;
        let skipped = 0;
        const failures: Array<{ name: string; stage: string; detail: string }> = [];
        for (const preset of METRIC_PRESETS) {
          if (have.has(preset.name)) {
            skipped += 1;
            continue;
          }
          const result = await insertValidatedMetric(
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
          if (result.ok) {
            inserted += 1;
          } else {
            failures.push({
              name: preset.name,
              stage: result.stage,
              detail: result.stage === "insert" ? result.detail : result.errors[0]?.message ?? "gate",
            });
          }
        }

        console.log(
          `[dev-smoke] seed-metrics user=${userId} inserted=${inserted} skipped=${skipped} failed=${failures.length}`,
        );
        if (failures.length > 0) {
          return new Response(JSON.stringify({ ok: false, inserted, skipped, failures }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ ok: true, inserted, skipped, failed: 0, adapterCalls: 0 }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "clear-metrics": {
        const userId = url.searchParams.get("user");
        if (!userId) {
          return new Response(JSON.stringify({ ok: false, error: "clear-metrics requires &user=<uuid>" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const { data, error } = await supabase
          .from("metrics")
          .delete()
          .eq("user_id", userId)
          .in("name", [...METRIC_PRESET_NAMES])
          .select("id");
        if (error) throw error;
        const deleted = data?.length ?? 0;
        console.log(`[dev-smoke] clear-metrics user=${userId} deleted=${deleted}`);
        return new Response(
          JSON.stringify({ ok: true, deleted, adapterCalls: 0 }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "seed-exemplars": {
        // FR-4: requires real embeddings. The stub returns one vector for N texts, so fail
        // explicitly here instead of with a downstream count mismatch.
        if (await getConfigBoolean("llm_stub_mode")) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "seed-exemplars requires llm_stub_mode=false",
              hint: "the stub returns a single vector for N texts; no exemplar rows would be inserted",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        // Resumable window seed (SEED_EXEMPLAR_WINDOW): `&offset=`/`&limit=` pick the window,
        // `&reset=` (defaulting to on for offset 0) clears the prior rows *of the named source*
        // first. `&source=` (FP-03 Step 7) selects the content slot and is required since the
        // placeholder slot retired (2026-10-28), so a bare call can never clear the live corpus.
        // The response always carries `next`/`done`.
        const source = exemplarSource(url);
        if (source === null) return unknownSourceResponse(url.searchParams.get("source"));
        const set = EXEMPLAR_SETS[source];

        const offsetRaw = url.searchParams.get("offset");
        const limitRaw = url.searchParams.get("limit");
        const resetRaw = url.searchParams.get("reset");
        const offset = offsetRaw === null ? 0 : Number(offsetRaw);
        const limit = limitRaw === null ? SEED_EXEMPLAR_WINDOW : Number(limitRaw);
        const reset = resetRaw === null ? offset === 0 : resetRaw === "1";
        const total = set.length;

        if (
          !Number.isInteger(offset) || offset < 0 || offset > total ||
          !Number.isInteger(limit) || limit < 1 || limit > SEED_EXEMPLAR_BATCH_SIZE ||
          (resetRaw !== null && resetRaw !== "0" && resetRaw !== "1")
        ) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "invalid seed window",
              hint:
                `offset: integer 0..${total}; limit: integer 1..${SEED_EXEMPLAR_BATCH_SIZE}; reset: 0|1`,
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        // Idempotent: a re-seed from offset 0 clears the prior rows of the *same* source first.
        if (reset) {
          const { error: clearError } = await supabase
            .from("exemplars")
            .delete()
            .eq("source", source);
          if (clearError) throw clearError;
        }

        const window = set.slice(offset, offset + limit);
        const next = offset + window.length;

        if (window.length === 0) {
          return new Response(
            JSON.stringify({
              ok: true,
              seeded: 0,
              offset,
              next: total,
              total,
              done: true,
              sets: {},
              embedCalls: 0,
              embedModel: EMBED_MODEL,
              provider: "",
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        // Real embeddings through the same provider adapter path as messages (FR-5, D5).
        const embedResult = await embed(window.map((e) => e.text));
        if (!embedResult.ok || !embedResult.data) {
          // A quota refusal is a pacing signal, not a bug: report the window that still needs
          // seeding (next == offset) so the caller can wait and resume at the same offset.
          const quota = (embedResult.error ?? "").includes("429");
          return new Response(
            JSON.stringify({
              ok: false,
              error: embedResult.error ?? "seed-exemplars: embed failed",
              offset,
              next: offset,
              total,
              done: false,
              hint: quota
                ? "Gemini counts every item against the embedding quota (TECH-SPEC §12: 100 RPM); wait ~60 s and resume at this offset"
                : "the embedding call failed; fix the cause and resume at this offset",
            }),
            { status: quota ? 429 : 502, headers: { "Content-Type": "application/json" } },
          );
        }

        const vectors = embedResult.data.embeddings;
        if (vectors.length !== window.length) {
          throw new Error(`embedding count mismatch: ${vectors.length} != ${window.length}`);
        }

        const rows = window.map((e, i) => ({
          id: crypto.randomUUID(),
          set_kind: e.setKind,
          label: e.label,
          text: e.text,
          source,
          embed_model: EMBED_MODEL,
          embedding: vectors[i],
        }));

        const { error } = await supabase.from("exemplars").insert(rows);
        if (error) throw error;

        const sets: Record<string, number> = {};
        for (const e of window) sets[e.setKind] = (sets[e.setKind] ?? 0) + 1;

        return new Response(
          JSON.stringify({
            ok: true,
            seeded: window.length,
            offset,
            next,
            total,
            done: next >= total,
            sets,
            embedCalls: 1,
            embedModel: EMBED_MODEL,
            provider: embedResult.provider,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "clear-exemplars": {
        // FP-03 Step 7: `&source=` clears one content slot; it is required since the placeholder
        // slot retired (2026-10-28), so a bare call can never clear the live approved corpus.
        const source = exemplarSource(url);
        if (source === null) return unknownSourceResponse(url.searchParams.get("source"));
        const { error } = await supabase.from("exemplars").delete().eq("source", source);
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true, source }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      case "match-exemplars": {
        // FP-03 Step 3: embed the text, then one RPC round over every seeded label. The
        // per-set ranking is what `classifyReal` (Step 4) argmaxes over; this action is also
        // Step 6's calibration/debugging tool.
        const text = url.searchParams.get("text") || "I skipped the gym all week";

        const embedResult = await embed([text]);
        if (!embedResult.ok) throw new Error(embedResult.error);

        const { data, error } = await supabase.rpc("match_exemplars", {
          query_embedding: embedResult.data!.embeddings[0],
        });
        if (error) throw error;

        // Sort here rather than trust the transport's row order: set name, then similarity desc.
        const rows = ((data ?? []) as { set_kind: string; label: string; sim: number }[])
          .slice()
          .sort((a, b) => a.set_kind.localeCompare(b.set_kind) || b.sim - a.sim);

        const sets: Record<string, number> = {};
        const top: Record<string, { label: string; sim: number } | null> = {};
        for (const r of rows) {
          sets[r.set_kind] = (sets[r.set_kind] ?? 0) + 1;
          if (!(r.set_kind in top)) top[r.set_kind] = { label: r.label, sim: r.sim };
        }

        return new Response(
          JSON.stringify({
            ok: true,
            text,
            count: rows.length,
            sets,
            top,
            rows,
            provider: embedResult.provider,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "classify": {
        // FP-03 Step 4: the §6.3 block for one message, both modes. `mode=real` (default) is
        // the embedding classifier (one embed + one `match_exemplars` round); `mode=stub` is
        // FP-02's deterministic stub, for the field-set and behaviour diff (FR-10). `energy`
        // mirrors `profiles.latest_energy` (§6.1) — omitted/null on a non-check-in turn.
        const text = url.searchParams.get("text") || "I skipped the gym all week";
        const mode = url.searchParams.get("mode") || "real";
        if (mode !== "real" && mode !== "stub") {
          return new Response(JSON.stringify({ ok: false, error: "mode must be real or stub" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const energyRaw = url.searchParams.get("energy");
        const energy = energyRaw === null ? null : Number(energyRaw);
        if (energyRaw !== null && !Number.isFinite(energy)) {
          return new Response(JSON.stringify({ ok: false, error: "energy must be a number" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (mode === "stub") {
          const classification = classify(text, {});
          return new Response(
            JSON.stringify({
              ok: true,
              mode,
              text,
              energy,
              classification,
              fields: Object.keys(classification),
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        const embedResult = await embed([text]);
        // §5.1/FR-12: degrading a failed embed to the D7 block is the caller's job here too,
        // exactly as it will be in the orchestrator (Step 5).
        const classification =
          embedResult.ok && embedResult.data
            ? await classifyReal({ embedding: embedResult.data.embeddings[0], energy })
            : D7Fallback();

        return new Response(
          JSON.stringify({
            ok: true,
            mode,
            text,
            energy,
            classification,
            fields: Object.keys(classification),
            embedOk: embedResult.ok,
            embedError: embedResult.ok ? null : embedResult.error,
            provider: embedResult.provider,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "retrieve": {
        const domain = url.searchParams.get("domain") || "Discipline/Habits";
        const text = url.searchParams.get("text") || "I can't stick to my habits";

        const embedResult = await embed([text]);
        if (!embedResult.ok) throw new Error(embedResult.error);

        const queryEmbedding = embedResult.data!.embeddings[0];

        const result = await retrieveRules({
          domain,
          messageEmbedding: queryEmbedding,
          matchCount: 5,
        });

        return new Response(
          JSON.stringify({
            ok: true,
            domain,
            query: text,
            window: result.window,
            retrieved: result.retrieved,
            surviving: result.survivors.length,
            droppedTone: result.droppedTone,
            survivingIds: result.survivors.map((r) => r.id),
            survivingTones: result.survivors.map((r) => r.tone),
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "pipeline": {
        const text =
          url.searchParams.get("text") || "I keep saying I'll start tomorrow and then I never do.";
        const force = url.searchParams.get("force") || "none";

        // FP-03 Step 5: dev-gated stage-2 mode override for drills (`&classifier=real|stub`).
        // Absent → `runPipeline` follows `config.classifier_mode`. Dev-only like `force`: this
        // whole function sits behind `DEV_SMOKE_TOKEN`.
        const classifierRaw = url.searchParams.get("classifier");
        if (classifierRaw !== null && classifierRaw !== "real" && classifierRaw !== "stub") {
          return new Response(
            JSON.stringify({ ok: false, error: "classifier must be real or stub" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        const classifierMode = classifierRaw === null ? undefined : classifierRaw;

        // `energy` mirrors `profiles.latest_energy` (§6.1) — omitted/null on a chat turn, so
        // the orchestrator's energy plumbing is drillable end-to-end.
        const energyRaw = url.searchParams.get("energy");
        const energy = energyRaw === null ? null : Number(energyRaw);
        if (energyRaw !== null && !Number.isFinite(energy)) {
          return new Response(JSON.stringify({ ok: false, error: "energy must be a number" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // `user` (uuid) is what actually reaches the FP-05 day-plan riders: without it
        // `runPipeline` skips the rider block entirely, so `&energy=` alone can only ever
        // exercise the classifier — never a JIT band. Same `&user=<uuid>` shape as the
        // `watchdog-scan` action (§5.8); the result echoes `dayPlanProbe` so a gate can
        // assert the rider without an Edge-log export.
        const userRaw = url.searchParams.get("user");
        const userId = userRaw === null || userRaw.length === 0 ? undefined : userRaw;

        const overrides = overridesFromForce({
          force,
          domain: url.searchParams.get("domain"),
          emotion: url.searchParams.get("emotion"),
          bands: await readConfidenceBands(),
        });

        // `rider=1` opts the drill into the FP-08 D20 rider (chat turns do this in
        // send-message); the result echoes `riderProbe` so a gate can assert the apply
        // without an Edge-log export. Dev-only like `force` / `classifier`.
        const rider = url.searchParams.get("rider") === "1";

        const result = await runPipeline({
          text,
          overrides,
          energy,
          classifierMode,
          userId,
          applyRider: rider,
          sourceMessageId: url.searchParams.get("source_message_id") ?? undefined,
        });

        return new Response(
          JSON.stringify({
            ok: true,
            force,
            text,
            energy,
            user: userId ?? null,
            classifierMode: result.routeInfo.classifierMode,
            ...result,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "eval-classifier": {
        // FP-03 Step 6 (NFR-4, AC-9): run the whole golden set through the real classifier.
        // Requires real embeddings — the stub returns one vector for N texts, so every item
        // would match the same rows (seed-exemplars precedent: fail loudly, don't mislead).
        if (await getConfigBoolean("llm_stub_mode")) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "eval-classifier requires llm_stub_mode=false",
              hint: "the stub returns a single vector for N texts; the eval would be meaningless",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        // One batched embed for all 40 texts (< the 100/request limit): 1 provider call per run.
        const texts = GOLDEN_SET.map((item) => item.text);
        const embedResult = await embed(texts);
        if (!embedResult.ok || !embedResult.data) {
          // A quota refusal (429) is a pacing signal, not a broken eval: report it as 429 so the
          // gate can wait for the rolling minute to clear and retry instead of failing the run.
          const quota = (embedResult.error ?? "").includes("429");
          return new Response(
            JSON.stringify({
              ok: false,
              error: embedResult.error ?? "eval-classifier: embed failed",
              hint: quota
                ? "Gemini counts every item against the embedding quota (TECH-SPEC §12: 100 RPM); wait ~60 s and re-run"
                : "the embedding call failed",
            }),
            { status: quota ? 429 : 502, headers: { "Content-Type": "application/json" } },
          );
        }
        const vectors = embedResult.data.embeddings;
        if (vectors.length !== GOLDEN_SET.length) {
          throw new Error(
            `eval-classifier: embedded ${vectors.length} of ${GOLDEN_SET.length} texts`,
          );
        }

        const results: EvalCaseResult[] = [];
        for (let i = 0; i < GOLDEN_SET.length; i++) {
          const item = GOLDEN_SET[i];
          const energy = typeof item.expect.energy === "number" ? item.expect.energy : null;

          // The real path exactly as the orchestrator calls it (§5.1): `classifyReal` then
          // `determinePersona` (bandShift 0 — no userId, so no per-user adaptation).
          const got = await classifyReal({ embedding: vectors[i], energy });
          const decision = await determinePersona(got);

          // The quit-set argmax is not part of the §6.3 block, so one extra RPC round reads
          // it — that label is what the quit / false-constraint confusion matrix needs.
          const { data: rows, error } = await supabase.rpc("match_exemplars", {
            query_embedding: vectors[i],
          });
          if (error) throw error;

          results.push({
            id: item.id,
            case: item.case,
            text: item.text,
            energy,
            expect: item.expect,
            got,
            route: decision.route,
            bandShift: decision.bandShift,
            quitTop: topQuitMatch(rows),
          });
        }

        return new Response(
          JSON.stringify({
            ok: true,
            mode: "real",
            goldenSet: GOLDEN_SET_SOURCE,
            embedModel: embedResult.data.model,
            provider: embedResult.provider,
            summary: summarizeEval(results),
            items: results,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "watchdog-scan": {
        // FP-04 Step 6 (AC-8): drive the *production* scan from the drill, so the gate exercises
        // the same code the cron tick reaches — a second scan implementation for the drill would
        // be a second thing to drift.
        //
        // `&now=<iso>` backdates the scan's clock so a window that closed hours ago is inside the
        // (grace, lookback] band right now, rather than waiting for the real one to close.
        // `&user=<uuid>` scopes the walk to one profile: the drill must not nudge every beta
        // user, while the cron path (no `user`) always scans everyone (FR-15).
        const nowRaw = url.searchParams.get("now");
        const nowMs = nowRaw === null ? Date.now() : Date.parse(nowRaw);
        if (!Number.isFinite(nowMs)) {
          return new Response(
            JSON.stringify({ ok: false, error: "now must be an ISO-8601 instant" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const user = url.searchParams.get("user");
        const result = await runWatchdogScan({
          nowMs,
          userId: user === null || user.length === 0 ? undefined : user,
        });

        return new Response(
          JSON.stringify({ ok: true, now: new Date(nowMs).toISOString(), ...result }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "journal-drill": {
        // FP-05 Step 8: drive the evening journal chain directly for deterministic drills.
        // Mirrors the watchdog-scan pattern: drives the production chain code so the gate
        // exercises the exact same code the dispatcher reaches.
        //
        // Required: entry_id (uuid of the journal entry to process).
        // Runs the chain legs directly: extract -> probe -> plan (bypasses dispatcher).
        // Returns when all three legs complete (or fail).
        const entryId = url.searchParams.get("entry_id");
        if (!entryId) {
          return new Response(
            JSON.stringify({ ok: false, error: "entry_id is required" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        // Run the chain legs directly (bypassing pg_cron/dispatcher for determinism)
        // Each leg is idempotent via payload dedup on {entry_id}.
        // `leg=extract` stops after the extraction leg — the FP-08 rider gate drills the
        // extraction without generating an anchor plan for the drill entry; absent = all legs.
        const leg = url.searchParams.get("leg");
        await runJournalExtract({ entry_id: entryId }, { id: "drill" } as any);
        if (leg !== "extract") {
          await runJournalProbe({ entry_id: entryId }, { id: "drill" } as any);
          await runAnchorPlan({ entry_id: entryId }, { id: "drill" } as any);
        }

        return new Response(
          JSON.stringify({ ok: true, entry_id: entryId }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "accountability-drill": {
        // FP-08 Step 3: drive the D20 rider's apply half directly (the `journal-drill`
        // precedent) so the Step 3 gate can plant a state and assert the writes without a
        // provider call and without depending on a model's extraction.
        //   &user=<uuid> [&openness=2] [&admission=1] [&give_up=1] [&false_constraint=1]
        //   [&concession=1] [&quit_commitment=1] [&quit_signal=0.8] [&severity=S1|S2|S3]
        const user = url.searchParams.get("user");
        if (user === null || user.length === 0) {
          return new Response(
            JSON.stringify({ ok: false, error: "user is required" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const numberParam = (name: string): number | null => {
          const raw = url.searchParams.get(name);
          if (raw === null) return null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : Number.NaN;
        };
        const flag = (name: string): boolean => {
          const raw = url.searchParams.get(name);
          return raw === "1" || raw === "true";
        };

        const openness = numberParam("openness") ?? 0;
        const quitSignal = numberParam("quit_signal");
        if (Number.isNaN(openness) || (quitSignal !== null && Number.isNaN(quitSignal))) {
          return new Response(
            JSON.stringify({ ok: false, error: "openness and quit_signal must be numbers" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const severityRaw = url.searchParams.get("severity");
        if (severityRaw !== null && severityRaw !== "S1" && severityRaw !== "S2" && severityRaw !== "S3") {
          return new Response(
            JSON.stringify({ ok: false, error: "severity must be S1 | S2 | S3" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const probe = await applyTrustRider({
          userId: user,
          signals: {
            openness_delta: openness,
            admission: flag("admission"),
            give_up: flag("give_up"),
            false_constraint: flag("false_constraint"),
            concession: flag("concession"),
            quit_commitment: flag("quit_commitment"),
          },
          quitSignal,
          severity: severityRaw,
        });

        return new Response(
          JSON.stringify({ ok: true, probe }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "oath-trigger-drill": {
        // FP-08 Step 4 (FR-10, AC-4): exercise the trigger's real SQL (threshold, cooldown,
        // source dedupe) through the exact helper send-message calls — never a copied rule.
        // The caller supplies the pre-rider score and the admission flag the pipeline would
        // have produced, so 69-vs-70 is deterministic without a provider call.
        //   &user=<uuid>&trust_before=70&admission=1[&source_message_id=<uuid>]
        const user = url.searchParams.get("user");
        if (user === null || user.length === 0) {
          return new Response(
            JSON.stringify({ ok: false, error: "user is required" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        const trustRaw = url.searchParams.get("trust_before");
        const trustBefore = trustRaw === null ? null : Number(trustRaw);
        if (trustBefore !== null && !Number.isFinite(trustBefore)) {
          return new Response(
            JSON.stringify({ ok: false, error: "trust_before must be a number" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        const trigger = await maybeRequestOath({
          userId: user,
          admission: url.searchParams.get("admission") === "1",
          trustBefore,
          sourceMessageId: url.searchParams.get("source_message_id"),
        });
        return new Response(
          JSON.stringify({ ok: true, user, trustBefore, ...trigger }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "intervention-drill": {
        // FP-08 Step 4: run the dispatcher's exact handler body for an `oath_request` or
        // `breakdown` job without waiting for a cron claim. The built context is echoed so
        // the gate can assert the §10.5 delimiters and the oath presence — the stub model
        // cannot echo its prompt back, and the live row alone would prove too little.
        //   &user=<uuid>&reason=oath_request|breakdown[&source_message_id=<uuid>]
        //   [&window=<iso>] (watchdog reasons only)
        const user = url.searchParams.get("user");
        const reason = url.searchParams.get("reason");
        if (user === null || user.length === 0 || reason === null || reason.length === 0) {
          return new Response(
            JSON.stringify({ ok: false, error: "user and reason are required" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        const outcome = await runIntervention({
          userId: user,
          windowIso: url.searchParams.get("window"),
          reason,
          jobId: url.searchParams.get("job_id") ?? "drill",
          sourceMessageId: url.searchParams.get("source_message_id"),
          habitId: url.searchParams.get("habit_id"),
        });
        return new Response(
          JSON.stringify({ ok: true, user, reason, outcome }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "drift-drill": {
        // FP-08 Step 5/6/7: drive the exact runners the dispatcher calls.
        //   &leg=scan&user=<uuid>[&now=<iso>]     the real drift scan (default)
        //   &leg=report&user=<uuid>[&now=<iso>]   the state dump (patterns, habits, trust, quests)
        //   &leg=quest&user=<uuid>&metric=<uuid>  force the real quest expiry
        //   &leg=strike&user=<uuid>&habit=<uuid>  force-fire the real Strike (status guard kept)
        //   &leg=oath&user=<uuid>&source_message_id=<uuid>  force the oath request branch
        //   &leg=histogram&user=<uuid>[&computed_for=YYYY-MM-DD]  rebuild + dump buckets/fires
        const leg = url.searchParams.get("leg") ?? "scan";
        const user = url.searchParams.get("user");
        if (user === null || user.length === 0) {
          return new Response(
            JSON.stringify({ ok: false, error: "user is required" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const nowRaw = url.searchParams.get("now");
        const nowMs = nowRaw === null ? Date.now() : Date.parse(nowRaw);
        if (!Number.isFinite(nowMs)) {
          return new Response(
            JSON.stringify({ ok: false, error: "now must be an ISO timestamp" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "quest") {
          const metric = url.searchParams.get("metric");
          if (metric === null || metric.length === 0) {
            return new Response(
              JSON.stringify({ ok: false, error: "metric is required for leg=quest" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const outcome = await runQuestExpire({ user_id: user, metric_id: metric });
          return new Response(
            JSON.stringify({ ok: true, user, metric, outcome }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "strike") {
          const habit = url.searchParams.get("habit");
          if (habit === null || habit.length === 0) {
            return new Response(
              JSON.stringify({ ok: false, error: "habit is required for leg=strike" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const stubQuote = url.searchParams.get("stub_quote");
          const stubCorrected = url.searchParams.get("stub_corrected_quote");
          const outcome = await runStrike({
            user_id: user,
            habit_id: habit,
            ...(stubQuote === null ? {} : { stub_quote: stubQuote }),
            ...(stubCorrected === null ? {} : { stub_corrected_quote: stubCorrected }),
          });
          return new Response(
            JSON.stringify({ ok: true, user, habit, outcome }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "oath") {
          // The handler branch, not the trigger: `oath-trigger-drill` exercises the gate.
          // Deliberately dev-gated so a real beta deployment cannot demand an oath by URL.
          if (!(await getConfigBoolean("dev_overrides_enabled").catch(() => false))) {
            return new Response(
              JSON.stringify({ ok: false, error: "dev_overrides_enabled is false" }),
              { status: 403, headers: { "Content-Type": "application/json" } },
            );
          }
          const source = url.searchParams.get("source_message_id");
          if (source === null || source.length === 0) {
            return new Response(
              JSON.stringify({ ok: false, error: "source_message_id is required for leg=oath" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const outcome = await runIntervention({
            userId: user,
            windowIso: null,
            reason: "oath_request",
            jobId: "drift-drill-oath",
            sourceMessageId: source,
          });
          return new Response(
            JSON.stringify({ ok: true, user, source_message_id: source, outcome }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "histogram") {
          // FP-08 Step 8: the rebuild leg only. The fire leg is a job row, so the drill
          // returns the scheduled fires (job ids + fire times) and the gate can force/dispatch
          // them exactly as the cron would.
          const computedFor = url.searchParams.get("computed_for");
          const report = await runHistogramRebuild({
            userId: user,
            computedFor,
            nowMs,
          });
          return new Response(
            JSON.stringify({ ok: true, user, now: new Date(nowMs).toISOString(), report }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "report") {
          const client = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            { auth: { persistSession: false } },
          );
          const [{ data: profile }, { data: habits }, { data: quests }, { data: trust }, evidence] =
            await Promise.all([
              client.from("profiles")
                .select("trust_score, dialog_state, lockdown_started_at, timezone")
                .eq("id", user).maybeSingle(),
              client.from("habits")
                .select("id, description, status, watch_started_at, strike_at")
                .eq("user_id", user).order("detected_at", { ascending: false }),
              client.from("metrics")
                .select("id, name, quest_status, quest_deadline, archived_at, created_at")
                .eq("user_id", user).eq("is_quest", true)
                .order("created_at", { ascending: false }),
              client.from("trust_events")
                .select("reason, delta, created_at")
                .eq("user_id", user).order("created_at", { ascending: false }).limit(10),
              loadDriftEvidence(user, nowMs),
            ]);
          return new Response(
            JSON.stringify({
              ok: true,
              user,
              trust: profile ?? null,
              habits: habits ?? [],
              quests: quests ?? [],
              trust_events: trust ?? [],
              streak: evidence?.streak ?? null,
              patterns: evidence?.evaluation.fired ?? [],
              today: evidence?.today ?? null,
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg !== "scan") {
          return new Response(
            JSON.stringify({ ok: false, error: "leg must be scan | report | quest | strike | oath | histogram" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const report = await runDriftScan({ userId: user, nowMs });
        return new Response(
          JSON.stringify({ ok: true, user, now: new Date(nowMs).toISOString(), ...report }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "memory-drill": {
        // FP-06 Step 7: deterministic drills over the *same* shared runners the dispatcher
        // uses (the `journal-drill` precedent). Dev-gated like every action here.
        //
        //   &leg=backlog&user=<uuid>             derive the aged-out backlog (no LLM)
        //   &leg=extract&user=<uuid>             run the extraction in the current mode
        //   &leg=retrieve&user=<uuid>&text=...   match_facts + render the block
        //   &leg=purge&message_id=<uuid>         the purge half of the late-flag loop
        const leg = url.searchParams.get("leg");
        if (leg === null) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "leg is required: backlog | extract | retrieve | purge",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        const user = url.searchParams.get("user");
        if (leg !== "purge" && (user === null || user.length === 0)) {
          return new Response(
            JSON.stringify({ ok: false, error: "user is required for this leg" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "backlog") {
          const report = await loadMemoryBacklog(user as string);
          return new Response(
            JSON.stringify({
              ok: true,
              leg,
              user,
              windowCutoff: report.windowCutoff,
              candidates: report.candidates,
              backlog: report.backlog.length,
              userMessages: report.backlog.filter((m) => m.role === "user").length,
              assistantMessages: report.backlog.filter((m) => m.role === "assistant").length,
              ids: report.backlog.map((m) => m.id),
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "extract") {
          const report = await runMemoryExtract(
            { user_id: user },
            { id: "memory-drill" } as unknown as MemoryJob,
          );
          return new Response(
            JSON.stringify({ ok: true, leg, user, ...report }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "retrieve") {
          const text = url.searchParams.get("text") || "What do you remember about me?";
          const enabled = await memoryRetrievalEnabled();
          if (!enabled) {
            return new Response(
              JSON.stringify({
                ok: true,
                leg,
                user,
                text,
                enabled: false,
                probe: { reason: "disabled", facts: 0 },
              }),
              { headers: { "Content-Type": "application/json" } },
            );
          }
          const embedRes = await embed([text]);
          if (!embedRes.ok || !embedRes.data) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: embedRes.error ?? "retrieve: embed failed",
              }),
              { status: 502, headers: { "Content-Type": "application/json" } },
            );
          }
          const load = await loadMemoryContext(user as string, embedRes.data.embeddings[0]);
          return new Response(
            JSON.stringify({
              ok: true,
              leg,
              user,
              text,
              enabled: true,
              probe: load.memoryProbe,
              // The rendered block is drill output, not a client surface: it is what the
              // owner reads to judge recall relevance (never generated into a reply here).
              block: load.memoryContext ?? null,
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "purge") {
          const messageId = url.searchParams.get("message_id");
          if (messageId === null || messageId.length === 0) {
            return new Response(
              JSON.stringify({ ok: false, error: "message_id is required for leg=purge" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const report = await runPurgeMemory({ message_id: messageId });
          return new Response(
            JSON.stringify({ ok: true, leg, ...report }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({ ok: false, error: `unknown leg: ${leg}` }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      case "onboarding-drill": {
        // FP-09 Step 3: the dead-state valve and re-runnable drill.
        //
        //   &leg=advance&user=<uuid>[&to=<stage>]   force a transition
        //   &leg=reset&user=<uuid>                  back to intro + fresh opening row
        //   &leg=apply&user=<uuid>&message_id=<uuid>&block=<json>
        //                                           drive the production apply helper
        if ((await getConfig("dev_overrides_enabled")) !== true) {
          return new Response(
            JSON.stringify({ ok: false, error: "onboarding-drill requires dev_overrides_enabled" }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }

        const leg = url.searchParams.get("leg");
        const user = url.searchParams.get("user");
        if (!leg || !user) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "leg and user are required: advance | reset | apply | gaps | proactive",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const isStage = (value: string): value is OnboardingStage =>
          (ONBOARDING_STAGES as readonly string[]).includes(value);

        if (leg === "advance") {
          const current = await readOnboardingStage(user);
          const requested = url.searchParams.get("to") ?? advanceTarget(current)?.to ?? null;
          if (!requested || !isStage(requested)) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: "to is required when the current stage has no advance target",
              }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const report = await forceOnboardingStage({ userId: user, to: requested });
          return new Response(
            JSON.stringify({ ok: true, leg, ...report }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "reset") {
          try {
            const report = await resetOnboardingDrill(user);
            return new Response(
              JSON.stringify({ ok: true, leg, ...report }),
              { headers: { "Content-Type": "application/json" } },
            );
          } catch (err) {
            if (err instanceof OnboardingResetRefusedError) {
              return new Response(
                JSON.stringify({ ok: false, error: err.message }),
                { status: 409, headers: { "Content-Type": "application/json" } },
              );
            }
            throw err;
          }
        }

        if (leg === "apply") {
          const messageId = url.searchParams.get("message_id");
          const rawBlock = url.searchParams.get("block");
          if (!messageId || !rawBlock) {
            return new Response(
              JSON.stringify({ ok: false, error: "message_id and block are required for leg=apply" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const { data: row, error } = await supabase
            .from("messages")
            .select("content")
            .eq("id", messageId)
            .eq("user_id", user)
            .eq("role", "user")
            .maybeSingle();
          if (error) throw error;
          if (!row) {
            return new Response(
              JSON.stringify({ ok: false, error: "message not found for this user" }),
              { status: 404, headers: { "Content-Type": "application/json" } },
            );
          }
          let block: unknown;
          try {
            block = JSON.parse(rawBlock);
          } catch {
            return new Response(
              JSON.stringify({ ok: false, error: "block must be valid JSON" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const embedded = await embed([row.content as string]);
          const report = await applyOnboardingBlock({
            userId: user,
            messageId,
            rawBlock: block,
            embedding: embedded.ok && embedded.data ? embedded.data.embeddings[0] : null,
            embedModel: embedded.ok && embedded.data ? embedded.data.model : null,
          });
          return new Response(
            JSON.stringify({ ok: true, leg, ...report }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "gaps") {
          // FP-09 Step 5: the pure vector against this user's live profile. The drill
          // returns the first missing key and the live baseline count; it writes nothing.
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("wake_time, sleep_time, routine, high_dopamine_activities, created_at")
            .eq("id", user)
            .maybeSingle();
          if (profileError) throw profileError;
          if (!profile) {
            return new Response(
              JSON.stringify({ ok: false, error: "profile not found" }),
              { status: 404, headers: { "Content-Type": "application/json" } },
            );
          }

          const minimum = await getConfig("proactive_gap_min_baseline_facts");
          if (typeof minimum !== "number" || !Number.isInteger(minimum) || minimum < 0) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: "proactive_gap_min_baseline_facts must be a non-negative integer",
              }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          const { count: baselineFacts, error: factsError } = await supabase
            .from("memory_facts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user)
            .eq("fact_type", "baseline")
            .is("purged_at", null);
          if (factsError) throw factsError;

          const gapKey = gapVector(
            profile as {
              wake_time?: string | null;
              sleep_time?: string | null;
              routine?: unknown;
              high_dopamine_activities?: unknown;
            },
            baselineFacts ?? 0,
            { proactive_gap_min_baseline_facts: minimum },
          );

          return new Response(
            JSON.stringify({
              ok: true,
              leg,
              gap_key: gapKey,
              baseline_facts: baselineFacts ?? 0,
              profile,
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        if (leg === "proactive") {
          // FP-09 Step 5: force the tick's qualification, then fire the production handler.
          //
          //   &phase=tick[&now=<iso>]        insert the job only
          //   &phase=fire&job=<uuid>         fire an existing drill job
          //   &phase=both[&now=<iso>]        insert and fire (the happy path)
          //
          // The tick is global by design. Refuse to run it while another complete profile
          // exists, so a drill can never nudge a real beta user. All live profiles are intro
          // at the time this leg lands; after onboarding, use a pre-made job with phase=fire.
          const phase = url.searchParams.get("phase") ?? "both";
          if (phase !== "tick" && phase !== "fire" && phase !== "both") {
            return new Response(
              JSON.stringify({ ok: false, error: "phase must be tick | fire | both" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }

          const nowParam = url.searchParams.get("now");
          const nowMs = nowParam ? Date.parse(nowParam) : Date.now();
          if (!Number.isFinite(nowMs)) {
            return new Response(
              JSON.stringify({ ok: false, error: "now must be a valid ISO timestamp" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const nowIso = new Date(nowMs).toISOString();

          type DrillProactiveJob = { id: string; payload: unknown; created_at: string };
          let inserted: number | null = null;
          let job: DrillProactiveJob | null = null;

          if (phase === "tick" || phase === "both") {
            const { data: others, error: othersError } = await supabase
              .from("profiles")
              .select("id")
              .eq("onboarding_stage", "complete")
              .neq("id", user)
              .limit(1);
            if (othersError) throw othersError;
            if ((others ?? []).length > 0) {
              return new Response(
                JSON.stringify({
                  ok: false,
                  error:
                    "refusing to run the global proactive tick while another complete profile exists",
                }),
                { status: 409, headers: { "Content-Type": "application/json" } },
              );
            }

            const { data, error } = await supabase.rpc("proactive_tick", { p_now: nowIso });
            if (error) throw error;
            inserted = typeof data === "number" ? data : Number(data ?? 0);

            const { data: jobRows, error: jobError } = await supabase
              .from("jobs")
              .select("id, payload, created_at")
              .eq("type", "proactive")
              .eq("payload->>user_id", user)
              .eq("created_at", nowIso)
              .order("created_at", { ascending: false })
              .limit(1);
            if (jobError) throw jobError;
            const row = jobRows?.[0];
            job = row
              ? {
                id: String(row.id),
                payload: row.payload,
                created_at: String(row.created_at),
              }
              : null;
          }

          if (phase === "fire") {
            const jobId = url.searchParams.get("job");
            if (!jobId) {
              return new Response(
                JSON.stringify({ ok: false, error: "job is required for phase=fire" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
              );
            }
            const { data: jobRow, error: jobError } = await supabase
              .from("jobs")
              .select("id, payload, created_at")
              .eq("id", jobId)
              .eq("type", "proactive")
              .eq("payload->>user_id", user)
              .limit(1);
            if (jobError) throw jobError;
            if (!jobRow || jobRow.length === 0) {
              return new Response(
                JSON.stringify({ ok: false, error: "proactive job not found for this user" }),
                { status: 404, headers: { "Content-Type": "application/json" } },
              );
            }
            job = {
              id: String(jobRow[0].id),
              payload: jobRow[0].payload,
              created_at: String(jobRow[0].created_at),
            };
          }

          if (!job) {
            return new Response(
              JSON.stringify({
                ok: true,
                leg,
                phase,
                tick: inserted,
                job: null,
                fired: false,
              }),
              { headers: { "Content-Type": "application/json" } },
            );
          }

          const outcome = await runProactive(job.payload, job.id);
          const settledAt = new Date().toISOString();
          const { error: settleError } = await supabase
            .from("jobs")
            .update({
              status: "done",
              completed_at: settledAt,
              updated_at: settledAt,
            })
            .eq("id", job.id);
          if (settleError) throw settleError;

          return new Response(
            JSON.stringify({
              ok: true,
              leg,
              phase,
              tick: inserted,
              job,
              fired: true,
              outcome,
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({ ok: false, error: `unknown leg: ${leg}` }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      case "metric-drill": {
        // FP-07 Steps 4–5: drive the *same* runner/chain the production paths reach (the
        // journal/memory drill precedent), so the gate never re-implements evaluation.
        //
        //   &leg=eval&user=<uuid>&date=YYYY-MM-DD    run the production runner
        //   &leg=report&user=<uuid>&date=YYYY-MM-DD  dump the inputs + eight vars
        //   &leg=propose&domain=Career[&text=…][&force=gate-fail]  run the proposal chain
        const leg = url.searchParams.get("leg");

        if (leg === "propose") {
          const user = url.searchParams.get("user");
          if (user === null || user.length === 0) {
            return new Response(
              JSON.stringify({ ok: false, error: "user is required" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const domain = url.searchParams.get("domain");
          if (domain === null || !isProposalDomain(domain)) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: "domain is required and must be one of the canonical 16 plus General",
              }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const force = url.searchParams.get("force");
          if (force !== null && force !== "gate-fail") {
            return new Response(
              JSON.stringify({ ok: false, error: "force must be omitted or gate-fail" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const outcome = await proposeMetric(
            { domain, userText: url.searchParams.get("text") },
            { forceGateFail: force === "gate-fail" },
          );
          return new Response(JSON.stringify({ ok: true, leg, user, ...outcome }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (leg !== "eval" && leg !== "report") {
          return new Response(
            JSON.stringify({ ok: false, error: "leg is required: eval | report | propose" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        const user = url.searchParams.get("user");
        if (user === null || user.length === 0) {
          return new Response(
            JSON.stringify({ ok: false, error: "user is required" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        const date = url.searchParams.get("date");
        if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return new Response(
            JSON.stringify({ ok: false, error: "date=YYYY-MM-DD is required" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const report =
          leg === "eval" ? await runMetricEval(user, date) : await readMetricDay(user, date);
        return new Response(JSON.stringify({ ok: true, leg, ...report }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});