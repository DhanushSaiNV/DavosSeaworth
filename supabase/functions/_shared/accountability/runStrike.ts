// supabase/functions/_shared/accountability/runStrike.ts
// FP-08 Step 7 — the Strike handler (FR-18 fire half, FR-19).
//
// Order is the safety contract:
//   1. payload + habit status guard (`watch` only; anything else is the cancellation no-op);
//   2. kill switch (`strike_fire_enabled` false completes without generating);
//   3. duplicate repair (a crash after the message, before the status flip);
//   4. S1/S2 trailing-24 h snooze — return `{snooze_until}` and the dispatcher defers the row;
//   5. Tiered Proof: server-assembled ground truth + top-5 `match_facts` against the habit
//      description (one embed; unverified mode when none are retrievable);
//   6. generation under `intervention_persona`, then the deterministic claim-check: one
//      corrected re-output quoting the rejected claims, then the in-code template;
//   7. `habits.status='struck'`, unprompted `metadata.source='strike'` row, high push.
//
// Idempotency: the message lookup is the dedupe key; a re-claimed job that finds the row
// repairs the status flip and returns `duplicate`. A crash before the row is simply a retry.
//
// Refs: FP-08 FR-18, FR-19; TECH-SPEC §7.5, §2.2, §4.2, §5.4, §8; D11, D24, D13; PRD §3.2.

import { getConfigBoolean, getConfigNumber, getConfigString, supabaseService } from "../config.ts";
import { embed } from "../llm/adapter.ts";
import { loadGrid } from "../checkin/loadGrid.ts";
import { localWallToUtcMs, windowsForLocalDay } from "../checkin/windows.ts";
import { FALLBACK_DOMAIN } from "../pipeline/persona.ts";
import { deliverIntervention } from "../checkin/runWatchdog.ts";
import { addDays, elapsedDays } from "./quests.ts";
import {
  assembleEvidence,
  checkClaims,
  snoozeDecision,
  type ClaimViolation,
  type EvidenceContext,
  type SeverityEvent,
  type StrikeGroundTruth,
} from "./strike.ts";
import { strikeTemplate } from "./templates.ts";
import {
  buildStrikeContext,
  buildStrikeCorrectionContext,
  type StrikePromptGroundTruth,
} from "./interventions.ts";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

interface HabitRow {
  id: string;
  user_id: string;
  description: string;
  status: string;
  watch_started_at: string | null;
  strike_at: string | null;
}

export type StrikeOutcome =
  | {
    status: "written";
    assistantMessageId: string;
    mode: "verified" | "unverified";
    claim_check: "passed" | "corrected" | "template";
    context: string;
  }
  | { status: "duplicate"; assistantMessageId: string }
  | { status: "skipped"; reason: string }
  | { status: "snoozed"; snooze_until: string };

function dayParts(date: string): { y: number; mo: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isInteger(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

/** Local midnight for a `YYYY-MM-DD` label, or null when the wall time does not exist. */
function localMidnightMs(timezone: string, date: string): number | null {
  const parts = dayParts(date);
  if (!parts) return null;
  return localWallToUtcMs(timezone, parts.y, parts.mo, parts.d, 0, 0);
}

function localNoonMs(timezone: string, date: string): number | null {
  const parts = dayParts(date);
  if (!parts) return null;
  return localWallToUtcMs(timezone, parts.y, parts.mo, parts.d, 12, 0);
}

/** The exclusive watch-day count (14 → 21 is 7), never negative. */
function watchDays(watchStartedAt: string, strikeAt: string): number {
  const days = elapsedDays(watchStartedAt, strikeAt) - 1;
  return Number.isFinite(days) && days > 0 ? days : 0;
}

async function findStrikeMessage(userId: string, habitId: string): Promise<string | null> {
  const { data, error } = await supabaseService
    .from("messages")
    .select("id")
    .eq("user_id", userId)
    .eq("metadata->>source", "strike")
    .eq("metadata->>habit_id", habitId)
    .limit(1);
  if (error) throw new Error(`strike dedupe read failed: ${error.message}`);
  return (data?.[0]?.id as string | undefined) ?? null;
}

/** The status flip; conditional so a cancellation that won the race is never overwritten. */
async function markStruck(userId: string, habitId: string): Promise<void> {
  const { error } = await supabaseService
    .from("habits")
    .update({ status: "struck" })
    .eq("id", habitId)
    .eq("user_id", userId)
    .eq("status", "watch");
  if (error) throw new Error(`habit strike update failed: ${error.message}`);
}

async function loadGroundTruth(args: {
  userId: string;
  habit: HabitRow;
  watchStartedAt: string;
  strikeAt: string;
}): Promise<StrikeGroundTruth> {
  const grid = await loadGrid(args.userId);
  if (!grid) throw new Error(`strike: no usable check-in grid for ${args.userId}`);

  // The ground-truth window is every complete local day of the watch: start .. strike-1.
  const windowEnd = addDays(args.strikeAt, -1);
  const expected = new Map<number, number>();
  let cursor = args.watchStartedAt;
  for (let guard = 0; guard < 400; guard += 1) {
    if (cursor > windowEnd) break;
    const noon = localNoonMs(grid.timezone, cursor);
    if (noon !== null) {
      for (const window of windowsForLocalDay(grid, noon)) expected.set(window.startMs, window.startMs);
    }
    cursor = addDays(cursor, 1);
  }

  const startMs = localMidnightMs(grid.timezone, args.watchStartedAt);
  const endMs = localMidnightMs(grid.timezone, args.strikeAt);
  if (startMs === null || endMs === null || endMs <= startMs) {
    throw new Error(`strike: invalid watch window ${args.watchStartedAt}..${args.strikeAt}`);
  }

  const { data, error } = await supabaseService
    .from("doings_logs")
    .select("kind, checkin_window")
    .eq("user_id", args.userId)
    .gte("logged_at", new Date(startMs).toISOString())
    .lt("logged_at", new Date(endMs).toISOString());
  if (error) throw new Error(`strike: doings read failed: ${error.message}`);

  const rows = data ?? [];
  const doings = rows.filter((row) => row.kind === "doing");
  const impulses = rows.filter((row) => row.kind === "impulse_failure");
  const answered = new Set<number>();
  for (const row of doings) {
    if (!row.checkin_window) continue;
    const start = Date.parse(String(row.checkin_window));
    if (Number.isFinite(start) && expected.has(start)) answered.add(start);
  }

  const hours = Math.round((answered.size * grid.cadenceMinutes / 60) * 100) / 100;
  return {
    doings_count: doings.length,
    hours_logged: hours,
    missed_windows: Math.max(0, expected.size - answered.size),
    impulse_failures: impulses.length,
    watch_started_at: args.watchStartedAt,
    strike_at: args.strikeAt,
    window: { start: args.watchStartedAt, end: windowEnd },
  };
}

/** Top-5 facts against the habit description (one embed); fail-open to unverified mode. */
async function loadVerifiedGoals(description: string, userId: string): Promise<string[]> {
  try {
    const embedded = await embed([description]);
    if (!embedded.ok || !embedded.data) {
      console.warn(`[strike] goal retrieval embed failed: ${embedded.error ?? "unknown"}`);
      return [];
    }
    const { data, error } = await supabaseService.rpc("match_facts", {
      p_user_id: userId,
      p_query_embedding: embedded.data.embeddings[0],
      p_top_k: 5,
    });
    if (error) {
      console.warn(`[strike] match_facts failed: ${error.message}`);
      return [];
    }
    return (data ?? [])
      .map((row: Record<string, unknown>) => (typeof row.fact === "string" ? row.fact : null))
      .filter((fact: string | null): fact is string => fact !== null && fact.length > 0);
  } catch (err) {
    console.warn(`[strike] goal retrieval skipped: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

async function loadS1S2(userId: string, nowMs: number): Promise<SeverityEvent[]> {
  const since = new Date(nowMs - 24 * 3_600_000).toISOString();
  const { data, error } = await supabaseService
    .from("journal_entries")
    .select("severity, created_at")
    .eq("user_id", userId)
    .in("severity", ["S1", "S2"])
    .gte("created_at", since)
    .lte("created_at", new Date(nowMs).toISOString());
  if (error) throw new Error(`strike: severity read failed: ${error.message}`);
  return (data ?? [])
    .filter((row) => row.severity === "S1" || row.severity === "S2")
    .map((row) => ({ severity: row.severity as "S1" | "S2", at: String(row.created_at) }));
}

/** Read a dev-only planted quote from the payload, only when overrides are enabled. */
function plantedQuote(
  payload: Record<string, unknown>,
  key: "stub_quote" | "stub_corrected_quote",
  enabled: boolean,
): { direct_quote: string } | undefined {
  if (!enabled) return undefined;
  const quote = asString(payload[key]);
  return quote === null ? undefined : { direct_quote: quote };
}

function violationSummaries(violations: ClaimViolation[]): Array<{ raw: string; detail: string }> {
  return violations.map((violation) => ({ raw: violation.claim.raw, detail: violation.detail }));
}

export async function runStrike(payload: Record<string, unknown>): Promise<StrikeOutcome> {
  const userId = asString(payload.user_id);
  const habitId = asString(payload.habit_id);
  if (!userId || !habitId) {
    console.error(`[strike] unusable payload: ${JSON.stringify(payload)}`);
    return { status: "skipped", reason: "invalid_payload" };
  }

  const { data: habitData, error: habitError } = await supabaseService
    .from("habits")
    .select("id, user_id, description, status, watch_started_at, strike_at")
    .eq("id", habitId)
    .eq("user_id", userId)
    .maybeSingle();
  if (habitError) throw new Error(`strike: habit read failed: ${habitError.message}`);
  if (!habitData) {
    console.log("[strike]", JSON.stringify({ user_id: userId, habit_id: habitId, skipped: "habit_missing" }));
    return { status: "skipped", reason: "habit_missing" };
  }
  const habit = habitData as HabitRow;

  if (habit.status !== "watch") {
    console.log(
      "[strike]",
      JSON.stringify({ user_id: userId, habit_id: habitId, skipped: `status_${habit.status}` }),
    );
    return { status: "skipped", reason: `status_${habit.status}` };
  }

  if (!(await getConfigBoolean("strike_fire_enabled"))) {
    console.log("[strike]", JSON.stringify({ user_id: userId, habit_id: habitId, skipped: "disabled" }));
    return { status: "skipped", reason: "disabled" };
  }

  const existing = await findStrikeMessage(userId, habitId);
  if (existing) {
    // A crash after the row landed but before the flip: repair and report duplicate.
    await markStruck(userId, habitId);
    console.log(
      "[strike]",
      JSON.stringify({ user_id: userId, habit_id: habitId, duplicate: existing, repaired: true }),
    );
    return { status: "duplicate", assistantMessageId: existing };
  }

  const watchStartedAt = asString(habit.watch_started_at);
  const strikeAt = asString(habit.strike_at);
  if (!watchStartedAt || !strikeAt) {
    console.log(
      "[strike]",
      JSON.stringify({ user_id: userId, habit_id: habitId, skipped: "missing_dates" }),
    );
    return { status: "skipped", reason: "missing_dates" };
  }

  const nowMs = Date.now();
  const snooze = snoozeDecision(await loadS1S2(userId, nowMs), new Date(nowMs).toISOString());
  if (snooze) {
    console.log(
      "[strike]",
      JSON.stringify({
        user_id: userId,
        habit_id: habitId,
        snoozed_until: snooze.snooze_until,
      }),
    );
    return { status: "snoozed", snooze_until: snooze.snooze_until };
  }

  const [persona, budget, groundTruth, verifiedGoals, overridesEnabled] = await Promise.all([
    getConfigString("intervention_persona"),
    getConfigNumber("pipeline_deadline_ms"),
    loadGroundTruth({ userId, habit, watchStartedAt, strikeAt }),
    loadVerifiedGoals(habit.description, userId),
    getConfigBoolean("dev_overrides_enabled").catch(() => false),
  ]);

  const evidence: EvidenceContext = { ground_truth: groundTruth, verified_goals: verifiedGoals };
  const assembled = assembleEvidence(evidence);
  const promptGroundTruth: StrikePromptGroundTruth = {
    ...groundTruth,
    watch_days: watchDays(watchStartedAt, strikeAt),
  };
  const baseContext = buildStrikeContext({
    habit: habit.description,
    ground_truth: promptGroundTruth,
    verified_goals: verifiedGoals,
  });

  const deadlineAt = Date.now() + Math.max(0, budget);
  const { runLockedPersonaReply } = await import("../pipeline/runPipeline.ts");
  const first = await runLockedPersonaReply({
    text: baseContext,
    domain: FALLBACK_DOMAIN,
    persona,
    deadlineAt,
    ...(plantedQuote(payload, "stub_quote", overridesEnabled)
      ? { stubContext: plantedQuote(payload, "stub_quote", overridesEnabled) }
      : {}),
  });

  let content = first.assistantContent;
  let claimCheck: "passed" | "corrected" | "template" = "passed";
  let rejected = 0;

  if (first.degraded) {
    // The §4.2 fallback is a generic holding line, not a Strike. Use the evidence template.
    content = strikeTemplate({ ...groundTruth, watch_days: promptGroundTruth.watch_days });
    claimCheck = "template";
  } else {
    const violations = checkClaims(content, evidence);
    rejected = violations.length;
    if (violations.length > 0) {
      const correctionContext = buildStrikeCorrectionContext(baseContext, violationSummaries(violations));
      try {
        const corrected = await runLockedPersonaReply({
          text: correctionContext,
          domain: FALLBACK_DOMAIN,
          persona,
          deadlineAt: Date.now() + Math.max(0, budget),
          ...(plantedQuote(payload, "stub_corrected_quote", overridesEnabled)
            ? { stubContext: plantedQuote(payload, "stub_corrected_quote", overridesEnabled) }
            : {}),
        });
        if (!corrected.degraded && checkClaims(corrected.assistantContent, evidence).length === 0) {
          content = corrected.assistantContent;
          claimCheck = "corrected";
        } else {
          content = strikeTemplate({ ...groundTruth, watch_days: promptGroundTruth.watch_days });
          claimCheck = "template";
        }
      } catch (err) {
        console.error(`[strike] correction generation failed: ${err instanceof Error ? err.message : err}`);
        content = strikeTemplate({ ...groundTruth, watch_days: promptGroundTruth.watch_days });
        claimCheck = "template";
      }
    }
  }

  // The template exists as the safe fallback; if it ever stops passing the claim-check, that
  // is a code defect, not something to deliver. Guard it before the row lands.
  if (claimCheck === "template" && checkClaims(content, evidence).length > 0) {
    throw new Error("strike: the template fallback failed the claim-check");
  }

  const assistantMessageId = await deliverIntervention({
    userId,
    persona: first.persona,
    content,
    metadata: {
      persona: first.persona,
      domain: first.domain,
      rule_ids: first.ruleIds,
      source: "strike",
      habit_id: habitId,
      evidence_mode: assembled.mode,
      claim_check: claimCheck,
      rejected_claims: rejected,
    },
  });

  await markStruck(userId, habitId);

  console.log(
    "[strike]",
    JSON.stringify({
      user_id: userId,
      habit_id: habitId,
      assistant_message_id: assistantMessageId,
      mode: assembled.mode,
      claim_check: claimCheck,
      rejected_claims: rejected,
      watch_days: promptGroundTruth.watch_days,
    }),
  );

  return {
    status: "written",
    assistantMessageId,
    mode: assembled.mode,
    claim_check: claimCheck,
    context: baseContext,
  };
}
