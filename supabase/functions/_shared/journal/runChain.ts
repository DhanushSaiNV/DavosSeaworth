// supabase/functions/_shared/journal/runChain.ts
// FP-05 Step 3 — the evening chain's impure half: the dispatcher handler and dev-smoke both
// drive this (the runWatchdog.ts pattern).
// Refs: FP-05 FR-4, FR-5, FR-6, FR-7, FR-9, FR-16, FR-17; TECH-SPEC §2.2–2.3, §3.3, §4.1–4.3,
// §7.4, §11; D5, D16, D20.
// Impure (loads Deno.env via adapter/supabaseService): the pure decisions live in extractContract.ts.

import { getConfigNumber, getConfigString, supabaseService } from "../config.ts";
import { embed } from "../llm/adapter.ts";
import { extractEntry } from "./extract.ts";
import type { ExtractResult, ExtractInsight } from "./extractContract.ts";
import { generateAnchorPlan } from "./anchor.ts";
import type { AnchorPlanResult } from "./anchorContract.ts";
import { runLockedPersonaReply } from "../pipeline/runPipeline.ts";
import { applyTrustRider } from "../accountability/applyRider.ts";
import { createAiMessagePushPayload, sendPush } from "../push.ts";

const EXTRACT_LOG_TAG = "[journal-extract]";

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  last_error: string | null;
}

/**
 * The journal_extract handler. Idempotent (§2.2.4) — a claimed job can be re-delivered after
 * a lease timeout. Two guards:
 *   1. If vagueness_score is already set → extraction already ran, skip to enqueue tail.
 *   2. If memory_facts for this entry exist → skip facts write on re-run.
 * The marker (vagueness_score + severity) is written BEFORE facts, so a crash between the
 * two leaves the entry extracted but facts unwritten — a re-claim re-runs facts only.
 */
export async function runJournalExtract(payload: Record<string, unknown>, job: Job): Promise<void> {
  const entryId = typeof payload.entry_id === "string" ? payload.entry_id : null;
  if (!entryId) throw new Error("journal_extract: missing entry_id in payload");

  // Load the entry
  const { data: entry, error: entryError } = await supabaseService
    .from("journal_entries")
    .select("id, user_id, content, vagueness_score, severity, entry_date")
    .eq("id", entryId)
    .maybeSingle();
  if (entryError) throw new Error(`journal_extract: could not load entry: ${entryError.message}`);
  if (!entry) throw new Error(`journal_extract: entry not found: ${entryId}`);

  const userId = entry.user_id as string;
  const content = entry.content as string;
  const existingVagueness = entry.vagueness_score as number | null;

  // Guard 1: extraction already ran (re-claim or double-fire)
  if (existingVagueness !== null) {
    console.log(`${EXTRACT_LOG_TAG} skip: entry ${entryId} already extracted (vagueness=${existingVagueness})`);
    // Still enqueue downstream jobs (idempotent via payload dedup)
    await enqueueDownstream(userId, entryId, existingVagueness, entry.severity as string | null);
    return;
  }

  // Run the extraction
  let result: ExtractResult;
  try {
    result = await extractEntry(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${EXTRACT_LOG_TAG} extraction failed for ${entryId}:`, msg);
    throw err; // let dispatcher mark job failed with backoff
  }

  const { insights, vagueness_score, severity, openness_delta, admission_flag, habit_flag } = result;

  // Write the marker FIRST (re-run marker). FP-08 FR-5: `habit_flag` joins the marker so the
  // extraction result and the surfacing decision can never disagree across a re-claim.
  const { error: markerError } = await supabaseService
    .from("journal_entries")
    .update({ vagueness_score, severity, habit_flag })
    .eq("id", entryId);
  if (markerError) throw new Error(`journal_extract: marker update failed: ${markerError.message}`);

  // FP-08 FR-2/FR-8: the journal turn applies the same D20 rider as chat — the openness
  // delta and the admission flag, plus the S1/S2 lockdown exit (D16/D21). At-most-once rides
  // the marker just written: a re-claim returns at guard 1 and never applies again (a missed
  // award is the acceptable side; a double award is not). Non-fatal by design.
  try {
    await applyTrustRider({
      userId,
      signals: { openness_delta, admission: admission_flag },
      severity,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${EXTRACT_LOG_TAG} rider apply failed for ${entryId}:`, msg);
  }

  // Guard 2: facts already written for this entry (re-claim after marker but before facts)
  const { data: existingFacts, error: factsCheckError } = await supabaseService
    .from("memory_facts")
    .select("id")
    .eq("source_journal_id", entryId)
    .limit(1);
  if (factsCheckError) throw new Error(`journal_extract: facts check failed: ${factsCheckError.message}`);
  if (existingFacts && existingFacts.length > 0) {
    console.log(`${EXTRACT_LOG_TAG} skip facts: entry ${entryId} already has ${existingFacts.length} fact row(s)`);
  } else {
    // Insert memory_facts rows (one per insight) + batched embeddings
    const factRows = insights.map((ins: ExtractInsight) => ({
      user_id: userId,
      fact: ins.text,
      fact_type: "journal" as const,
      source_journal_id: entryId,
    }));
    const { data: insertedFacts, error: factsError } = await supabaseService
      .from("memory_facts")
      .insert(factRows)
      .select("id");
    if (factsError) throw new Error(`journal_extract: facts insert failed: ${factsError.message}`);

    const factIds = (insertedFacts ?? []).map((r) => r.id as string);
    if (factIds.length > 0) {
      // Batched embedding over all insight texts via adapter
      const texts = insights.map((ins: ExtractInsight) => ins.text);
      const embedRes = await embed(texts);
      const modelStamp = embedRes.ok && embedRes.data?.model ? embedRes.data.model : "gemini-embedding-001@768";
      const embeddings = embedRes.ok && embedRes.data?.embeddings ? embedRes.data.embeddings : [];

      for (let i = 0; i < factIds.length; i++) {
        const updateData: Record<string, unknown> = { embed_model: modelStamp };
        if (embeddings[i]) {
          updateData.embedding = embeddings[i];
        } else if (embeddings[0]) {
          updateData.embedding = embeddings[0];
        }
        const { error: stampError } = await supabaseService
          .from("memory_facts")
          .update(updateData)
          .eq("id", factIds[i]);
        if (stampError) throw new Error(`journal_extract: embed_model stamp failed: ${stampError.message}`);
      }
    }
  }

  // Structured log line — one audit row per extracted entry. FP-05 logged the rider inputs
  // only; FP-08 Step 3 now applies them through the single rider writer above (FR-2, D20), so
  // the marker records the owner of `trust_score` rather than a no-op.
  console.log(
    JSON.stringify({
      tag: EXTRACT_LOG_TAG,
      entryId,
      vagueness: vagueness_score,
      severity,
      insightCount: insights.length,
      trust_score: "applied_by_rider",
      openness_delta: openness_delta,
      admission_flag: admission_flag,
      habit_flag: habit_flag,
    }),
  );

  // Enqueue downstream jobs (probe + plan) — payload-deduped on {entry_id}
  await enqueueDownstream(userId, entryId, vagueness_score, severity);
}

/**
 * Idempotent enqueue of journal_probe and anchor_plan jobs.
 * Uses onConflict to make re-claims / double-fires a no-op on the jobs table.
 */
async function enqueueDownstream(
  userId: string,
  entryId: string,
  vagueness: number,
  severity: string | null,
): Promise<void> {
  // Probe gate: vagueness ≥ threshold OR severity !== S3
  const threshold = await getConfigNumber("journal_probe_vagueness_threshold");
  const shouldProbe = vagueness >= threshold || (severity && severity !== "S3");

  if (shouldProbe) {
    const { error: probeError } = await supabaseService
      .from("jobs")
      .insert({ type: "journal_probe", payload: { entry_id: entryId } })
      .select("id");
    // Ignore 23505 (unique violation on payload dedup) — treat as success
    if (probeError && !String(probeError).includes("23505")) {
      throw new Error(`journal_extract: journal_probe enqueue failed: ${probeError.message}`);
    }
  }

  // Always enqueue anchor_plan
  const { error: planError } = await supabaseService
    .from("jobs")
    .insert({ type: "anchor_plan", payload: { entry_id: entryId } })
    .select("id");
  if (planError && !String(planError).includes("23505")) {
    throw new Error(`journal_extract: anchor_plan enqueue failed: ${planError.message}`);
  }
}

const ANCHOR_LOG_TAG = "[anchor-plan]";

/**
 * The anchor_plan handler. Idempotent (§2.2.4) — a claimed job can be re-delivered after
 * a lease timeout. Two guards:
 *   1. Existing message with metadata.source='anchor_plan' + metadata.entry_id → skip row write.
 *   2. Upsert on anchor_plans (user_id, plan_date) — latest evening wins.
 * No push (absent from §8 map — Realtime/next-open delivery).
 */
export async function runAnchorPlan(payload: Record<string, unknown>, job: Job): Promise<void> {
  const entryId = typeof payload.entry_id === "string" ? payload.entry_id : null;
  if (!entryId) throw new Error("anchor_plan: missing entry_id in payload");

  // Load the entry
  const { data: entry, error: entryError } = await supabaseService
    .from("journal_entries")
    .select("id, user_id, content, entry_date, vagueness_score, severity")
    .eq("id", entryId)
    .maybeSingle();
  if (entryError) throw new Error(`anchor_plan: could not load entry: ${entryError.message}`);
  if (!entry) throw new Error(`anchor_plan: entry not found: ${entryId}`);

  const userId = entry.user_id as string;
  const content = entry.content as string;
  const entryDate = entry.entry_date as string;
  const vagueness_score = entry.vagueness_score as number | null;
  const severity = entry.severity as string | null;

  // Load profile for routine, wake/sleep, timezone
  const { data: profile, error: profileError } = await supabaseService
    .from("profiles")
    .select("timezone, routine, wake_time, sleep_time, high_dopamine_activities")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error(`anchor_plan: profile load failed: ${profileError.message}`);
  const timezone = (profile?.timezone as string) ?? "UTC";
  const routine = (profile?.routine as Record<string, unknown>) ?? {};
  const wake_time = (profile?.wake_time as string) ?? null;
  const sleep_time = (profile?.sleep_time as string) ?? null;
  const high_dopamine = (profile?.high_dopamine_activities as unknown[]) ?? [];

  // Load active habits (status not cancelled/quit_committed)
  const { data: habits, error: habitsError } = await supabaseService
    .from("habits")
    .select("description, status")
    .eq("user_id", userId)
    .not("status", "in", "('cancelled','quit_committed')");
  if (habitsError) throw new Error(`anchor_plan: habits load failed: ${habitsError.message}`);

  // Load non-archived metrics (goals)
  const { data: metrics, error: metricsError } = await supabaseService
    .from("metrics")
    .select("name, formula, output_unit")
    .eq("user_id", userId)
    .is("archived_at", null);
  if (metricsError) throw new Error(`anchor_plan: metrics load failed: ${metricsError.message}`);

  // Compute plan_date = entry_date + 1 day (UTC math, no timezone drift)
  const planDate = nextDayDate(entryDate);

  // Pre-check: existing message with source='anchor_plan' for this entry
  const { data: existingMsg, error: msgCheckError } = await supabaseService
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .eq("metadata->>source", "anchor_plan")
    .eq("metadata->>entry_id", entryId)
    .limit(1)
    .maybeSingle();
  if (msgCheckError) throw new Error(`anchor_plan: message check failed: ${msgCheckError.message}`);
  if (existingMsg) {
    console.log(`${ANCHOR_LOG_TAG} skip: entry ${entryId} already has anchor_plan message ${existingMsg.id}`);
    // Still upsert the plan row (idempotent via onConflict)
    // but we need the plan from somewhere — in stub mode we don't have it, so just return
    return;
  }

  // Build extraction object for the prompt
  const extraction = {
    insights: [{ text: "(extracted insights)" }],
    vagueness_score: vagueness_score ?? 0,
    severity: (severity as "S1" | "S2" | "S3") ?? "S3",
    openness_delta: 0,
    admission_flag: false,
  };

  // Generate the anchor plan
  let plan: AnchorPlanResult;
  try {
    plan = await generateAnchorPlan({
      entryText: content,
      extraction,
      routine,
      wake_time,
      sleep_time,
      habits: (habits ?? []).map(h => ({ description: h.description as string, status: h.status as string })),
      metrics: (metrics ?? []).map(m => ({ name: m.name as string, target: m.formula ?? m.output_unit })),
      timezone,
      plan_date: planDate,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${ANCHOR_LOG_TAG} generation failed for ${entryId}:`, msg);
    // Fail-soft: no plan row, warning logged, job marked done (not failed) per FR-11
    console.warn(JSON.stringify({ tag: ANCHOR_LOG_TAG, entryId, reason: "generation_failed", error: msg }));
    return;
  }

  // Upsert anchor_plans (latest evening wins)
  const { error: upsertError } = await supabaseService
    .from("anchor_plans")
    .upsert(
      { user_id: userId, plan_date: planDate, anchors: plan.anchors },
      { onConflict: "user_id,plan_date" },
    );
  if (upsertError) throw new Error(`anchor_plan: upsert failed: ${upsertError.message}`);

  // Get the plan persona from config
  const planPersona = await getConfigString("anchor_plan_persona");

  // Write unprompted summary row
  const { data: insertedMsg, error: msgError } = await supabaseService
    .from("messages")
    .insert({
      user_id: userId,
      role: "assistant",
      content: plan.direct_quote,
      persona_key: planPersona,
      reply_to_message_id: null,
      metadata: {
        source: "anchor_plan",
        plan_date: planDate,
        entry_id: entryId,
        persona: planPersona,
        source_job_id: job.id,
      },
    })
    .select("id");
  if (msgError) throw new Error(`anchor_plan: message insert failed: ${msgError.message}`);

  // Structured log line — tactical_analysis logged only
  console.log(
    JSON.stringify({
      tag: ANCHOR_LOG_TAG,
      entryId,
      planDate,
      anchorCount: plan.anchors.length,
      correctedRetries: (plan as AnchorPlanResult & { correctedRetries?: number }).correctedRetries ?? 0,
      tactical_analysis: plan.tactical_analysis,
    }),
  );
}


const PROBE_LOG_TAG = "[journal-probe]";

/**
 * The journal_probe handler. Idempotent (§2.2.4) — a claimed job can be re-delivered after
 * a lease timeout. Two guards:
 *   1. Existing message with metadata.source='journal_probe' + metadata.entry_id → skip
 *      write, set probed=true if not already set.
 *   2. After writing the unprompted row, update journal_entries set probed=true.
 * Generates a targeted follow-up on the locked-persona + D7-fallback surface.
 * One default-priority Expo push with deep link davos://chat.
 * Not in FAST_JOB_TYPES.
 */
export async function runJournalProbe(payload: Record<string, unknown>, job: Job): Promise<void> {
  const entryId = typeof payload.entry_id === "string" ? payload.entry_id : null;
  if (!entryId) throw new Error("journal_probe: missing entry_id in payload");

  // Load the entry
  const { data: entry, error: entryError } = await supabaseService
    .from("journal_entries")
    .select("id, user_id, content, severity, probed")
    .eq("id", entryId)
    .maybeSingle();
  if (entryError) throw new Error(`journal_probe: could not load entry: ${entryError.message}`);
  if (!entry) throw new Error(`journal_probe: entry not found: ${entryId}`);

  const userId = entry.user_id as string;
  const severity = entry.severity as string | null;

  // Pre-check: existing unprompted row with source=journal_probe for this entry
  const { data: existingMsg, error: msgCheckError } = await supabaseService
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .eq("metadata->>source", "journal_probe")
    .eq("metadata->>entry_id", entryId)
    .limit(1)
    .maybeSingle();
  if (msgCheckError) throw new Error(`journal_probe: message check failed: ${msgCheckError.message}`);
  if (existingMsg) {
    console.log(`${PROBE_LOG_TAG} skip: entry ${entryId} already has probe message ${existingMsg.id}`);
    // Ensure probed flag is set
    const { error: flagError } = await supabaseService
      .from("journal_entries")
      .update({ probed: true })
      .eq("id", entryId);
    if (flagError) console.error(`${PROBE_LOG_TAG} probed flag update failed:`, flagError.message);
    return;
  }

  // Determine probe persona from config based on severity
  const severePersona = await getConfigString("journal_probe_persona_severe");
  const vaguePersona = await getConfigString("journal_probe_persona_vague");
  const probePersona = (severity && severity !== "S3") ? severePersona : vaguePersona;

  // Build probe context and generate follow-up
  const { data: entryFull } = await supabaseService
    .from("journal_entries")
    .select("content")
    .eq("id", entryId)
    .single();
  const entryContent = entryFull?.content as string;

  const probeResult = await runLockedPersonaReply({
    text: entryContent,
    domain: "General", // D7 fallback — no aggressive rules
    persona: probePersona,
    deadlineAt: Date.now() + 30000, // 30s budget for probe generation
  });

  // Write unprompted assistant row
  const { data: insertedMsg, error: msgError } = await supabaseService
    .from("messages")
    .insert({
      user_id: userId,
      role: "assistant",
      content: probeResult.assistantContent,
      persona_key: probePersona,
      reply_to_message_id: null,
      metadata: {
        source: "journal_probe",
        entry_id: entryId,
        severity: severity,
        persona: probePersona,
        domain: "General",
        rule_ids: probeResult.ruleIds,
        source_job_id: job.id,
      },
    })
    .select("id");
  if (msgError) throw new Error(`journal_probe: message insert failed: ${msgError.message}`);

  // Default-priority Expo push (bounded 5s await)
  const pushPayload = createAiMessagePushPayload(userId, probeResult.assistantContent, "davos://chat");
  try {
    await Promise.race([
      sendPush(pushPayload),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (err) {
    console.error(`${PROBE_LOG_TAG} push send failed:`, err instanceof Error ? err.message : err);
  }

  // Set probed flag AFTER row write (order matters for crash safety)
  const { error: flagError } = await supabaseService
    .from("journal_entries")
    .update({ probed: true })
    .eq("id", entryId);
  if (flagError) console.error(`${PROBE_LOG_TAG} probed flag update failed:`, flagError.message);

  // Structured log line
  console.log(
    JSON.stringify({
      tag: PROBE_LOG_TAG,
      entryId,
      persona: probePersona,
      severity,
      messageId: insertedMsg?.[0]?.id,
    }),
  );
}

/** Compute the next calendar day from a YYYY-MM-DD string using UTC math. */
function nextDayDate(entryDateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entryDateStr);
  if (!m) throw new Error(`Invalid entry_date format: ${entryDateStr}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const next = new Date(Date.UTC(y, mo, d + 1));
  const y2 = next.getUTCFullYear();
  const mo2 = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(next.getUTCDate()).padStart(2, "0");
  return `${y2}-${mo2}-${d2}`;
}