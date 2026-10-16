// supabase/functions/dev-smoke/index.ts
// Dev-only smoke test Edge Function for FP-02 provider adapter verification

import { createClient } from "npm:@supabase/supabase-js@2";
import { generate, embed } from "../_shared/llm/adapter.ts";
import { getConfigBoolean } from "../_shared/config.ts";
import { classify, D7Fallback, type Classification } from "../_shared/pipeline/classify.ts";
import { classifyReal } from "../_shared/pipeline/classifyReal.ts";
import { retrieveRules } from "../_shared/pipeline/retrieveRules.ts";
import { runPipeline } from "../_shared/pipeline/runPipeline.ts";
import { determinePersona, readConfidenceBands } from "../_shared/pipeline/persona.ts";
import { overridesFromForce } from "../_shared/dev/overrides.ts";
import {
  PLACEHOLDER_RULES,
  PLACEHOLDER_SOURCE_FIGURE,
  PLACEHOLDER_EMBED_MODEL,
} from "../_shared/dev/placeholderRules.ts";
import {
  PLACEHOLDER_EXEMPLARS,
  PLACEHOLDER_EXEMPLAR_SOURCE,
} from "../_shared/dev/placeholderExemplars.ts";
import {
  GOLDEN_SET,
  GOLDEN_SET_SOURCE,
  type GoldenCase,
  type GoldenExpectation,
} from "../_shared/dev/goldenSet.ts";

// FP-03 Step 2: 228 exemplar texts exceed the untested single-call batch size, so the seed
// is chunked (NFR-2 "adapter-chunked, ≤ ~3 requests"): 228 -> 3 calls of <= 100.
const SEED_EXEMPLAR_BATCH_SIZE = 100;

// FP-03 Step 6 amendment: Gemini counts *every item* of a `batchEmbedContents` call against the
// embedding quota (TECH-SPEC §12: 100 RPM / 1,000 RPD — measured at 140/100 RPM in the Cloud
// console during the first Step 6 live run), while one Edge invocation is capped at 150 s. 228
// items therefore need ~2.3 min of quota and can never fit in one invocation, so the seed is
// resumable and seeds one quota-safe *window* per call; the caller paces the windows.
const SEED_EXEMPLAR_WINDOW = 80;

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
    | "seed-exemplars"
    | "clear-exemplars"
    | "match-exemplars"
    | "classify"
    | "retrieve"
    | "pipeline"
    | "eval-classifier";
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
          "seed-exemplars",
          "clear-exemplars",
          "match-exemplars",
          "classify",
          "retrieve",
          "pipeline",
          "eval-classifier",
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
        // `&reset=` (defaulting to on for offset 0) clears the prior placeholder rows first. A
        // bare call therefore keeps Step 2's idempotent semantics, while a resumed window appends
        // instead of restarting an interrupted seed. The response always carries `next`/`done`.
        const offsetRaw = url.searchParams.get("offset");
        const limitRaw = url.searchParams.get("limit");
        const resetRaw = url.searchParams.get("reset");
        const offset = offsetRaw === null ? 0 : Number(offsetRaw);
        const limit = limitRaw === null ? SEED_EXEMPLAR_WINDOW : Number(limitRaw);
        const reset = resetRaw === null ? offset === 0 : resetRaw === "1";
        const total = PLACEHOLDER_EXEMPLARS.length;

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

        // Idempotent: a re-seed from offset 0 clears the prior placeholder rows first. The
        // predicate is the source tag, so a re-seed never deletes the Step 7 BG-04 rows.
        if (reset) {
          const { error: clearError } = await supabase
            .from("exemplars")
            .delete()
            .eq("source", PLACEHOLDER_EXEMPLAR_SOURCE);
          if (clearError) throw clearError;
        }

        const window = PLACEHOLDER_EXEMPLARS.slice(offset, offset + limit);
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
              embedModel: PLACEHOLDER_EMBED_MODEL,
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
          source: PLACEHOLDER_EXEMPLAR_SOURCE,
          embed_model: PLACEHOLDER_EMBED_MODEL,
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
            embedModel: PLACEHOLDER_EMBED_MODEL,
            provider: embedResult.provider,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "clear-exemplars": {
        const { error } = await supabase
          .from("exemplars")
          .delete()
          .eq("source", PLACEHOLDER_EXEMPLAR_SOURCE);
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true }), {
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

        const overrides = overridesFromForce({
          force,
          domain: url.searchParams.get("domain"),
          emotion: url.searchParams.get("emotion"),
          bands: await readConfidenceBands(),
        });

        const result = await runPipeline({ text, overrides, energy, classifierMode });

        return new Response(
          JSON.stringify({
            ok: true,
            force,
            text,
            energy,
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