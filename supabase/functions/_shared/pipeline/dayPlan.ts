// supabase/functions/_shared/pipeline/dayPlan.ts
// FP-05 Step 6 — pure day-plan resolver + prompt renderer (TECH-SPEC §7.2, §5.1).
// Refs: FP-05 FR-12, FR-13, FR-14; PRD §3.1; D14.
// Pure (jest-loadable): no Deno.env, no service client — the IO half lives in runPipeline.ts.

/** One anchor in the day plan (mirrors §3.4 anchor_plans.anchors entry). */
export type AnchorPlanAnchor = {
  start: string;      // HH:mm 24h user-local
  end: string;        // HH:mm 24h user-local
  label: string;      // ≤ 80 chars
  kind: "commitment" | "deadline" | "routine" | "free_block" | "boredom_relief";
};

/** Convert HH:mm (24h) to minutes since local midnight. */
export function toMinutes(timeStr: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr ?? "").trim());
  if (!m) return -1;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return -1;
  return h * 60 + mi;
}

/**
 * Resolve the current free block containing `nowMs` in the given timezone.
 * Returns the anchor if `kind` is free_block or boredom_relief and `nowMs`
 * falls in [start, end) in the user's local time; else null.
 * Tolerant: ignores malformed anchors, non-arrays, missing fields.
 */
export function resolveCurrentFreeBlock(
  anchors: readonly AnchorPlanAnchor[],
  nowMs: number,
  timezone: string,
): AnchorPlanAnchor | null {
  if (!Array.isArray(anchors) || anchors.length === 0) return null;

  // Get user-local hour:minute from epoch ms
  let localHM: string | null = null;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    localHM = fmt.format(new Date(nowMs));
  } catch {
    // Invalid timezone → cannot resolve
    return null;
  }
  if (!localHM) return null;

  const [hStr, mStr] = localHM.split(":").map((s) => s.padStart(2, "0"));
  const nowMin = Number(hStr) * 60 + Number(mStr);
  if (!Number.isFinite(nowMin)) return null;

  for (const a of anchors) {
    if (!a || typeof a !== "object") continue;
    const startMin = toMinutes(a.start);
    const endMin = toMinutes(a.end);
    const kind = a.kind;
    if (startMin < 0 || endMin < 0 || startMin >= endMin) continue;
    if (kind !== "free_block" && kind !== "boredom_relief") continue;
    // [start, end) — start inclusive, end exclusive
    if (nowMin >= startMin && nowMin < endMin) {
      return a;
    }
  }
  return null;
}

/** Input for rendering the day-plan prompt context. */
export interface DayPlanContextInput {
  anchors: readonly AnchorPlanAnchor[];
  currentFreeBlock: AnchorPlanAnchor | null;
  energy: number | null;
}

/**
 * Render the compact day-plan context block for the generation prompt.
 * Includes: anchors list, rescheduling instruction, JIT energy-band line (if in free block).
 */
export function renderDayPlanPromptContext(input: DayPlanContextInput): string {
  const { anchors, currentFreeBlock, energy } = input;
  const lines: string[] = [];

  // Anchors block
  if (anchors.length > 0) {
    lines.push("Today's plan anchors:");
    for (const a of anchors) {
      const kindTag = a.kind ? ` (${a.kind})` : "";
      lines.push(`- ${a.start}-${a.end} ${a.label}${kindTag}`);
    }
  } else {
    lines.push("Today's plan anchors: none saved yet.");
  }

  // Rescheduling instruction (always present when there's a plan)
  lines.push("");
  lines.push("Rescheduling: moves require your conversational approval. The plan is authoritative — I don't mutate calendars.");

  // JIT energy-band instruction (only inside a free/boredom block)
  if (currentFreeBlock && energy !== null) {
    if (energy <= 3) {
      lines.push("Energy low (1–3) — pick a low-cognitive task or a boredom-relief item now.");
    } else if (energy >= 8) {
      lines.push("Energy high (8–10) — tackle a heavy task now.");
    }
  }

  return lines.join("\n");
}