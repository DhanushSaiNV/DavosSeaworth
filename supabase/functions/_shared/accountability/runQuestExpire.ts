// supabase/functions/_shared/accountability/runQuestExpire.ts
// FP-08 Step 6 — the quest expiry handler (FR-16).
//
// One job per accepted quest, scheduled by `accept_quest()` at deadline+1 01:15 user-local
// (after the final nightly `metric_eval`). This module loads the metric + its points over the
// quest window, applies the pure verdict table (`quests.ts`), archives the metric, then writes
// the outcome-aware debrief as an unprompted row with a default-priority push.
//
// Idempotency is the archived state: the conditional update is the claim. A re-delivered job
// (or a duplicate expiry job) reads `archived_at` and returns `duplicate` without generating.
// The write order matches FR-16's recorded reading — archive first, debrief second.
//
// Zero provider calls outside the single debrief generation (via `runLockedPersonaReply`).
//
// Refs: FP-08 FR-16; TECH-SPEC §7.3, §7.9; D10, D15.

import { getConfigNumber, getConfigString, supabaseService } from "../config.ts";
import { FALLBACK_DOMAIN } from "../pipeline/persona.ts";
import { deliverIntervention } from "../checkin/runWatchdog.ts";
import {
  elapsedDays,
  localDateKey,
  progressFraction,
  questVerdict,
} from "./quests.ts";
import { buildQuestDebriefContext } from "./interventions.ts";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export type QuestExpireOutcome =
  | { status: "written"; assistantMessageId: string; verdict: string }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string };

export async function runQuestExpire(
  payload: Record<string, unknown>,
): Promise<QuestExpireOutcome> {
  const userId = asString(payload.user_id);
  const metricId = asString(payload.metric_id);
  if (!userId || !metricId) {
    return { status: "skipped", reason: "invalid_payload" };
  }

  const { data: metric, error: metricError } = await supabaseService
    .from("metrics")
    .select(
      "id, user_id, name, domain, is_quest, quest_status, quest_deadline, created_at, archived_at",
    )
    .eq("id", metricId)
    .eq("user_id", userId)
    .maybeSingle();
  if (metricError) throw new Error(`quest metric read failed: ${metricError.message}`);
  if (!metric) return { status: "skipped", reason: "metric_missing" };
  if (metric.archived_at !== null) return { status: "duplicate" };
  if (metric.is_quest !== true || metric.quest_status !== "active") {
    return { status: "skipped", reason: "not_active" };
  }
  if (typeof metric.quest_deadline !== "string") {
    return { status: "skipped", reason: "missing_deadline" };
  }

  const { data: profile, error: profileError } = await supabaseService
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw new Error(`quest profile read failed: ${profileError.message}`);
  const timezone = typeof profile?.timezone === "string" && profile.timezone.length > 0
    ? profile.timezone
    : "UTC";

  const createdAt = typeof metric.created_at === "string" ? metric.created_at : "";
  const createdMs = Date.parse(createdAt);
  const createdDate = Number.isFinite(createdMs)
    ? localDateKey(timezone, createdMs)
    : localDateKey(timezone, Date.now());
  const deadline = metric.quest_deadline;

  const { data: pointRows, error: pointsError } = await supabaseService
    .from("metric_points")
    .select("value, computed_for")
    .eq("metric_id", metricId)
    .gte("computed_for", createdDate)
    .lte("computed_for", deadline)
    .order("computed_for", { ascending: true });
  if (pointsError) throw new Error(`quest points read failed: ${pointsError.message}`);

  const points = (pointRows ?? []).map((row) => ({
    date: String(row.computed_for),
    value: Number(row.value),
  }));
  const fraction = await getConfigNumber("quest_completion_fraction");
  const verdict = questVerdict(points.map((point) => point.value), createdDate, deadline, fraction);

  // The conditional update is the idempotency claim: only one runner archives.
  const nowIso = new Date().toISOString();
  const { data: archived, error: archiveError } = await supabaseService
    .from("metrics")
    .update({ quest_status: verdict, archived_at: nowIso })
    .eq("id", metricId)
    .eq("user_id", userId)
    .is("archived_at", null)
    .select("id");
  if (archiveError) throw new Error(`quest archive failed: ${archiveError.message}`);
  if (!archived || archived.length === 0) return { status: "duplicate" };

  const days = elapsedDays(createdDate, deadline);
  const requiredDays = Math.max(0, fraction) * days;
  const passingDays = points.filter((point) => Number.isFinite(point.value) && point.value >= 1).length;
  const context = buildQuestDebriefContext({
    name: String(metric.name),
    domain: typeof metric.domain === "string" && metric.domain.length > 0
      ? metric.domain
      : "General",
    verdict,
    passingDays,
    elapsedDays: days,
    requiredDays,
    points,
  });

  const [persona, budget] = await Promise.all([
    getConfigString("intervention_persona"),
    getConfigNumber("pipeline_deadline_ms"),
  ]);

  const { runLockedPersonaReply } = await import("../pipeline/runPipeline.ts");
  const result = await runLockedPersonaReply({
    text: context,
    domain: FALLBACK_DOMAIN,
    persona,
    deadlineAt: Date.now() + Math.max(0, budget),
  });

  console.log(
    `[quest-expire] tactical_analysis (${metricId}):`,
    result.tacticalAnalysis,
    JSON.stringify({ provider: result.provider, persona: result.persona, domain: result.domain }),
  );

  const assistantMessageId = await deliverIntervention({
    userId,
    persona: result.persona,
    content: result.assistantContent,
    priority: "default",
    metadata: {
      persona: result.persona,
      domain: result.domain,
      rule_ids: result.ruleIds,
      source: "quest_debrief",
      metric_id: metricId,
      quest_status: verdict,
      passing_days: passingDays,
      elapsed_days: days,
      progress: progressFraction(metric.created_at, deadline, nowIso),
    },
  });

  console.log(
    "[quest-expire]",
    JSON.stringify({
      user_id: userId,
      metric_id: metricId,
      verdict,
      passing_days: passingDays,
      elapsed_days: days,
      assistant_message_id: assistantMessageId,
    }),
  );

  return { status: "written", assistantMessageId, verdict };
}
