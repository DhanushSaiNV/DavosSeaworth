// supabase/functions/dev-smoke/index.ts
// Dev-only smoke test Edge Function for FP-02 provider adapter verification

import { createClient } from "npm:@supabase/supabase-js@2";
import { generate, embed } from "../_shared/llm/adapter.ts";
import { getConfigBoolean } from "../_shared/config.ts";
import { retrieveRules } from "../_shared/pipeline/retrieveRules.ts";
import { runPipeline } from "../_shared/pipeline/runPipeline.ts";
import { readConfidenceBands } from "../_shared/pipeline/persona.ts";
import { overridesFromForce } from "../_shared/dev/overrides.ts";
import {
  PLACEHOLDER_RULES,
  PLACEHOLDER_SOURCE_FIGURE,
  PLACEHOLDER_EMBED_MODEL,
} from "../_shared/dev/placeholderRules.ts";
import {
  PLACEHOLDER_EXEMPLARS,
  PLACEHOLDER_EXEMPLAR_SOURCE,
  type PlaceholderExemplar,
} from "../_shared/dev/placeholderExemplars.ts";

// FP-03 Step 2: 228 exemplar texts exceed the untested single-call batch size, so the seed
// is chunked (NFR-2 "adapter-chunked, ≤ ~3 requests"): 228 -> 3 calls of <= 100.
const SEED_EXEMPLAR_BATCH_SIZE = 100;

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
    | "retrieve"
    | "pipeline";
  domain?: string;
  text?: string;
  force?: "high" | "medium" | "low" | "fallback";
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
          "retrieve",
          "pipeline",
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

        // Idempotent: clear any prior placeholder rows before re-seeding. The predicate is the
        // source tag, so a re-seed never deletes the Step 7 BG-04 rows.
        const { error: clearError } = await supabase
          .from("exemplars")
          .delete()
          .eq("source", PLACEHOLDER_EXEMPLAR_SOURCE);
        if (clearError) throw clearError;

        const chunks: PlaceholderExemplar[][] = [];
        for (let i = 0; i < PLACEHOLDER_EXEMPLARS.length; i += SEED_EXEMPLAR_BATCH_SIZE) {
          chunks.push(PLACEHOLDER_EXEMPLARS.slice(i, i + SEED_EXEMPLAR_BATCH_SIZE));
        }

        // Real embeddings through the same provider adapter path as messages (FR-5, D5).
        const sets: Record<string, number> = {};
        let provider = "";
        for (const chunk of chunks) {
          const embedResult = await embed(chunk.map((e) => e.text));
          if (!embedResult.ok) throw new Error(embedResult.error);
          const vectors = embedResult.data!.embeddings;
          if (vectors.length !== chunk.length) {
            throw new Error(`embedding count mismatch: ${vectors.length} != ${chunk.length}`);
          }
          provider = embedResult.provider;

          const rows = chunk.map((e, i) => ({
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

          for (const e of chunk) sets[e.setKind] = (sets[e.setKind] ?? 0) + 1;
        }

        return new Response(
          JSON.stringify({
            ok: true,
            seeded: PLACEHOLDER_EXEMPLARS.length,
            sets,
            embedCalls: chunks.length,
            embedModel: PLACEHOLDER_EMBED_MODEL,
            provider,
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

        const overrides = overridesFromForce({
          force,
          domain: url.searchParams.get("domain"),
          emotion: url.searchParams.get("emotion"),
          bands: await readConfidenceBands(),
        });

        const result = await runPipeline({ text, overrides });

        return new Response(
          JSON.stringify({ ok: true, force, text, ...result }),
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