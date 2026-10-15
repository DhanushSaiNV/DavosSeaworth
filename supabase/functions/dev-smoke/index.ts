// supabase/functions/dev-smoke/index.ts
// Dev-only smoke test Edge Function for FP-02 provider adapter verification

import { createClient } from "npm:@supabase/supabase-js@2";
import { generate, embed } from "../_shared/llm/adapter.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEV_SMOKE_TOKEN = Deno.env.get("DEV_SMOKE_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface SmokeRequest {
  action: "embed" | "generate" | "models" | "seed-rules" | "clear-rules" | "retrieve" | "pipeline";
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
        available: ["embed", "generate", "models", "seed-rules", "clear-rules", "retrieve", "pipeline"],
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
        const devRules = [
          {
            id: crypto.randomUUID(),
            text: "Discipline is the bridge between goals and accomplishment.",
            domain: "Discipline/Habits",
            source_figure: "PLACEHOLDER-DEV",
            tone: "aggressive",
            priority: 80,
          },
          {
            id: crypto.randomUUID(),
            text: "Small daily habits compound into massive results over time.",
            domain: "Discipline/Habits",
            source_figure: "PLACEHOLDER-DEV",
            tone: "empathetic",
            priority: 70,
          },
        ];

        const { error } = await supabase.from("rules").upsert(
          devRules.map((r) => ({
            ...r,
            embed_model: "gemini-embedding-001@768",
            embedding: Array(768).fill(0).map((_, i) => Math.sin(i * 0.1 + Math.random())),
          })),
        );

        if (error) throw error;
        return new Response(
          JSON.stringify({ ok: true, seeded: devRules.length, domains: [...new Set(devRules.map((r) => r.domain))] }),
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

      case "retrieve": {
        const domain = url.searchParams.get("domain") || "Discipline/Habits";
        const text = url.searchParams.get("text") || "I can't stick to my habits";

        const embedResult = await embed([text]);
        if (!embedResult.ok) throw new Error(embedResult.error);

        const queryEmbedding = embedResult.data!.embeddings[0];

        const { data: rules, error } = await supabase.rpc("match_rules", {
          query_embedding: queryEmbedding,
          match_domain: domain,
          match_count: 5,
        });

        if (error) throw error;

        const byTone = new Map<string, typeof rules>();
        for (const rule of rules || []) {
          const tone = rule.tone;
          if (!byTone.has(tone)) byTone.set(tone, []);
          byTone.get(tone)!.push(rule);
        }

        let surviving = rules || [];
        if (byTone.has("aggressive") && byTone.has("empathetic")) {
          const agg = byTone.get("aggressive")!;
          const emp = byTone.get("empathetic")!;
          const maxAgg = Math.max(...agg.map((r) => r.priority));
          const maxEmp = Math.max(...emp.map((r) => r.priority));
          if (Math.abs(maxAgg - maxEmp) <= 15) {
            if (maxAgg >= maxEmp) {
              surviving = surviving.filter((r) => r.tone !== "empathetic");
            } else {
              surviving = surviving.filter((r) => r.tone !== "aggressive");
            }
          }
        }

        return new Response(
          JSON.stringify({
            ok: true,
            domain,
            query: text,
            retrieved: rules?.length || 0,
            surviving: surviving.length,
            survivingIds: surviving.map((r) => r.id),
            survivingTones: surviving.map((r) => r.tone),
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      case "pipeline": {
        return new Response(
          JSON.stringify({
            ok: true,
            message: "Pipeline smoke test - full pipeline not yet wired. See Step 3 implementation.",
            force: url.searchParams.get("force"),
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