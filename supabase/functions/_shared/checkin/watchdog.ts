// supabase/functions/_shared/checkin/watchdog.ts
// FP-04 Step 6 — the check-in watchdog's **pure** half: which closed windows count as missed,
// and the generation context a missed window produces.
//
// Refs: FP-04 FR-15, FR-16, FR-18; TECH-SPEC §2.2–2.3, §7.1, §11; D2, D9, D12.
//
// Pure: it imports `windows.ts` (which imports nothing) and no `Deno.env`, no service client —
// so `watchdog.test.ts` loads it under jest. The impure half is `runWatchdog.ts` (the profiles
// walk, the two lookups, the job insert, the generation call), the same split as
// `windows.ts` / `loadGrid.ts` and `bands.ts` / `persona.ts`.
//
// Why the split matters here: the scan's *decisions* (which windows are missed, what the model is
// asked) are the parts a unit test can pin, and they are exactly the parts NFR-3 requires to be
// deterministic. Everything this module does is a function of the grid, the clock, the config
// bounds and two id sets.

import {
  utcToLocalLabel,
  windowsClosedBetween,
  type Grid,
  type GridWindow,
} from "./windows.ts";

/** `intervention` payload's `reason` value (FR-15). One value today; the enum is FR-scoped. */
export const MISSED_CHECKIN_REASON = "missed_checkin";

export interface MissedScanInput {
  grid: Grid;
  nowMs: number;
  /** `config.watchdog_grace_minutes` in ms — a window closed sooner than this is not yet missed. */
  graceMs: number;
  /** `config.watchdog_lookback_minutes` in ms — older than this is out of scope. */
  lookbackMs: number;
  /** Canonical window starts (epoch ms) that already have a doing — the `checkin_window` join. */
  answeredStartMs: ReadonlySet<number>;
  /** Canonical window starts that already have a non-terminal `intervention` job — the dedup. */
  queuedStartMs: ReadonlySet<number>;
}

/**
 * The windows the watchdog must alert on (FR-15): closes in `(now - lookback, now - grace]`,
 * within active hours by construction (only emitted grid windows are generated), minus the
 * windows already answered by a doing and minus the ones that already have an intervention
 * queued. Ascending, so a scan's inserts follow the order the day happened in.
 *
 * Both bounds are half-open exactly as `windowsClosedBetween` documents them: a close exactly at
 * `now - grace` is *missed* (the grace window has elapsed), a close exactly at `now - lookback`
 * is not considered. `lookbackMs <= graceMs` therefore yields nothing.
 */
export function selectMissedWindows(input: MissedScanInput): GridWindow[] {
  const { grid, nowMs, graceMs, lookbackMs, answeredStartMs, queuedStartMs } = input;
  const closed = windowsClosedBetween(grid, nowMs - lookbackMs, nowMs - graceMs);
  return closed.filter(
    (w) => !answeredStartMs.has(w.startMs) && !queuedStartMs.has(w.startMs),
  );
}

export interface ThreadLine {
  role: string;
  content: string;
}

export interface InterventionContextInput {
  window: GridWindow;
  /** `intervention` payload's `reason` — carried into the prompt verbatim (FR-16). */
  reason: string;
  /** `profiles.timezone`, for the human-readable local label. */
  timezone: string;
  nowMs: number;
  /** Recent thread, **oldest first**. Already filtered to savable rows by the caller. */
  recent: ThreadLine[];
}

/**
 * The context the intervention generates from (FR-16): the reason, the missed window, and a
 * recent-thread summary. Returned as plain text because that is what stage 5 takes — `userText`,
 * which `generateReply` wraps in the `<user_message>` delimiters under the §5.1 injection guard,
 * exactly like a real turn's text (AGENTS.md §4.6). Nothing here is regex-processed afterwards.
 *
 * The window is stated both ways: the local wall-clock labels the user would recognise, and the
 * instants, so a model that reasons in either frame has the unambiguous form.
 */
export function buildInterventionContext(input: InterventionContextInput): string {
  const { window, reason, timezone, nowMs, recent } = input;
  const startLabel = utcToLocalLabel(timezone, window.startMs) ?? "?";
  const endLabel = utcToLocalLabel(timezone, window.closeMs) ?? "?";
  const minutesAgo = Math.max(0, Math.round((nowMs - window.closeMs) / 60_000));

  const lines: string[] = [
    "This turn is unprompted: the user did not submit a check-in for the window below,",
    "so no message from them is waiting to be answered. Reach out first.",
    "",
    `reason: ${reason}`,
    `missed window: ${startLabel}-${endLabel} local time (${timezone}) ` +
      `[${new Date(window.startMs).toISOString()} - ${new Date(window.closeMs).toISOString()}] ` +
      `— closed about ${minutesAgo} minute(s) ago`,
    "",
  ];

  if (recent.length === 0) {
    lines.push("Recent conversation: none yet — this is the first thing in the thread.");
  } else {
    lines.push("Recent conversation (oldest first):");
    for (const line of recent) {
      lines.push(`[${line.role}] ${line.content}`);
    }
  }

  return lines.join("\n");
}
