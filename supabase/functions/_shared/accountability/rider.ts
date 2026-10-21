// supabase/functions/_shared/accountability/rider.ts
// FP-08 Step 2 — the D20 trust/openness rider's pure decision core.
//
// Refs: FP-08 FR-2, FR-4, FR-6, FR-8, FR-18; TECH-SPEC §5.3–5.4, §11; D8, D20, D21;
//       AGENTS.md §4.7 (trust_score is hidden by design — this module is server-only).
//
// Pure: imports nothing (the `windows.ts` pattern). The thin apply — `profiles.trust_score`,
// `trust_events` rows, habit transitions, `strike_fire` job inserts — lives in the call sites
// (`send-message`, `journal_extract`, `select-persona`, the auto-adopt recorder), so the
// decision table here is jest-loadable with zero Deno shims and every rule is pinned by tests.
//
// Arithmetic lives in code by design (FR-2): only `trust_threshold` runs through `config`
// (§11's row fixes 70 for the oath/breakdown gates). The deltas below are §5.4's rider:
//   * `openness_delta` (the extraction contract bounds it to ±5) → score += delta, reason
//     `openness`;
//   * `admission` → +10, reason `admission`;
//   * a streak day (see `streak.ts`) → +2, reason `streak` — that award lives in the scan,
//     not here;
//   * a persona override → a `trust_events('override', 0)` audit row, no score change
//     (the enum demands a reason and an override is not a trust delta — FR-4's recorded
//     reading).
// `band_shift` is the adaptive-weighting knob (D8): override −0.02 (floor −0.10), an
// auto-adopt success +0.01 (cap +0.10). The helpers below are the single place those steps and
// bounds are spelled.
//
// The module deliberately imports nothing at all — not even types. The chat call site's
// `intent_flags` and the journal call site's `admission_flag` are mapped into `RiderSignals`
// structurally, so jest loads this file with zero Deno shims and the static gate can assert a
// literal zero-import file.

// ---------------------------------------------------------------------------
// Constants (§5.4 + §11's trust_threshold row)
// ---------------------------------------------------------------------------

/** The profile column's CHECK bounds (0002). */
export const TRUST_MIN = 0;
export const TRUST_MAX = 100;

/** The §4.3 extraction contract's openness bound ("integer -5..5"). */
export const OPENNESS_BOUND = 5;

/** §5.4: an admission is the strongest single-turn trust signal. */
export const ADMISSION_BONUS = 10;

/** The impulse candor cap: a self-logged failure earns +1 openness, first three per local day. */
export const IMPULSE_CANDOR_CAP_PER_DAY = 3;

/** D8 adaptive weighting: one override step, one success step, and their bounds. */
export const BAND_SHIFT_OVERRIDE_STEP = -0.02;
export const BAND_SHIFT_OVERRIDE_FLOOR = -0.1;
export const BAND_SHIFT_SUCCESS_STEP = 0.01;
export const BAND_SHIFT_SUCCESS_CAP = 0.1;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The rider's normalized signal set. Chat turns map `ExtractionResult.intent_flags` into it
 * (`admission` ← `admission`), journal turns map the journal contract (`admission` ←
 * `admission_flag`). Keeping one shape here is what lets FR-2 say "through one module".
 */
export interface RiderSignals {
  openness_delta?: number | null;
  admission?: boolean | null;
  give_up?: boolean | null;
  false_constraint?: boolean | null;
  concession?: boolean | null;
  quit_commitment?: boolean | null;
}

/** A habit row in a live status (the only rows the rider may transition). */
export interface LiveHabit {
  id: string;
  status: "detected" | "confronted" | "watch";
}

/** The state the decision needs; the callers supply the config values. */
export interface RiderState {
  trust_score: number;
  dialog_state: "OPEN" | "LOCKDOWN";
  /** `profiles.lockdown_started_at`; required for the lazy breaker. */
  lockdown_started_at?: string | null;
  /** The live habits the turn may transition (`status` ∈ detected/confronted/watch). */
  live_habits: LiveHabit[];
  /** The caller's local date (`YYYY-MM-DD`) — used for watch entry and `strike_at`. */
  local_date: string;
  /** `config.strike_watch_days_default` (`§11`: 7). */
  watch_days: number;
  /** `config.lockdown_circuit_breaker_hours` (`§11`: 24). */
  breaker_hours: number;
  /** Classifier `quit_signal` probability, when stage 2 ran. */
  quit_signal?: number | null;
  /** `config.quit_signal_threshold` (`§11`: 0.75). */
  quit_signal_threshold?: number;
  /** Journal severity, when the call site is `journal_extract` (FR-8's S1/S2 exit). */
  severity?: "S1" | "S2" | "S3" | null;
  /** Inject for deterministic tests; defaults to the wall clock. */
  now_iso?: string;
}

export type TrustReason = "openness" | "admission" | "streak" | "override";

export interface TrustEventDraft {
  reason: TrustReason;
  delta: number;
}

export interface HabitUpdate {
  id: string;
  status: "watch" | "quit_committed";
  /** `watch` only. */
  watch_started_at?: string;
  /** `watch` only. */
  strike_at?: string;
}

export interface RiderDecision {
  /** Coalesced score delta after clamping (0 when no signal fired). */
  trust_delta: number;
  /** The rows to append; empty on a neutral turn. */
  trust_events: TrustEventDraft[];
  /** Habit transitions; empty on a neutral turn. */
  habit_updates: HabitUpdate[];
  /** `watch` entries that need a future-dated `strike_fire` job. */
  strike_jobs: Array<{ habit_id: string; strike_at: string }>;
  /** Lockdown transitions. `refresh_started_at` re-entry only refreshes the timestamp. */
  lockdown: { enter: boolean; exit: boolean; refresh_started_at: boolean };
  dialog_state: "OPEN" | "LOCKDOWN";
  /** True iff anything must be written (the neutral-turn floor). */
  changed: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Clamp anything onto the profiles column's CHECK bounds. */
export function clampTrustScore(score: number): number {
  if (!Number.isFinite(score)) return TRUST_MIN;
  return Math.max(TRUST_MIN, Math.min(TRUST_MAX, Math.round(score)));
}

/** The contract says ±5; tolerate a malformed model value by clamping, never by trusting it. */
export function normalizeOpennessDelta(raw: number | null | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.max(-OPENNESS_BOUND, Math.min(OPENNESS_BOUND, Math.round(raw)));
}

/** §5.4: `admission` → +10, once. */
export function admissionDelta(admission: boolean | null | undefined): number {
  return admission === true ? ADMISSION_BONUS : 0;
}

/**
 * The candor credit: +1 for a self-logged impulse failure while fewer than three credits have
 * already been awarded today (FR-2's recorded reading — an uncapped tap loop would inflate the
 * score; the `reason` enum has no impulse value, so the event rides `openness`).
 */
export function impulseCandorCredit(creditsAlreadyToday: number): number {
  const used = Number.isFinite(creditsAlreadyToday) ? Math.max(0, creditsAlreadyToday) : 0;
  return used < IMPULSE_CANDOR_CAP_PER_DAY ? 1 : 0;
}

/** The next `band_shift`, clamped to the D8 bounds (floor −0.10, cap +0.10). */
export function clampBandShift(current: number, step: number): number {
  const base = Number.isFinite(current) ? current : 0;
  const next = base + (Number.isFinite(step) ? step : 0);
  return Math.max(BAND_SHIFT_OVERRIDE_FLOOR, Math.min(BAND_SHIFT_SUCCESS_CAP, Number(next.toFixed(4))));
}

/** `YYYY-MM-DD` + N days, calendar-safe in UTC (the date strings are already user-local). */
export function addDays(localDate: string, days: number): string {
  const start = Date.parse(`${localDate}T00:00:00Z`);
  if (!Number.isFinite(start)) return localDate;
  const next = new Date(start + Math.max(0, Math.round(days)) * 86_400_000);
  return next.toISOString().slice(0, 10);
}

/**
 * The lockdown entry rule (FR-6): any of the two extraction flags, or the classifier's
 * redundant quit signal at/over the threshold. D21's signals arm independently.
 */
export function lockdownSignal(
  signals: RiderSignals,
  quitSignal: number | null | undefined,
  quitSignalThreshold = 0.75,
): boolean {
  if (signals.give_up === true || signals.false_constraint === true) return true;
  return typeof quitSignal === "number" && Number.isFinite(quitSignal) &&
    quitSignal >= quitSignalThreshold;
}

/** The lazy circuit breaker (FR-8): elapsed ≥ hours. A missing start never expires. */
export function breakerExpired(
  startedAt: string | null | undefined,
  nowIso: string,
  breakerHours: number,
): boolean {
  if (!startedAt) return false;
  const started = Date.parse(startedAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return false;
  return now - started >= Math.max(0, breakerHours) * 3_600_000;
}

/** FR-8's severity override: S1/S2 outranks accountability. */
export function severityForcesExit(severity: "S1" | "S2" | "S3" | null | undefined): boolean {
  return severity === "S1" || severity === "S2";
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * Decide the whole rider effect set for one turn.
 *
 * Precedence (documented so the table tests can pin it):
 *  1. **Exit beats entry.** A concession (or the breaker, or journal S1/S2) opens the dialog
 *     even if this same turn also carries an entry signal — the conceding turn answers
 *     normally (FR-8), and a contradictory extraction must not re-lock the user mid-concession.
 *  2. **`quit_commitment` beats `concession` for habits.** Cancellation takes precedence
 *     (FR-18): every live habit ends `quit_committed`, no watch entries, no strike jobs.
 *  3. **Concession watches confronted habits only** (FR-18). A `detected` habit has not been
 *     confronted yet, so there is nothing to concede; a `watch` habit already runs its window.
 *  4. **Re-entry refreshes.** An entry signal while already LOCKDOWN only refreshes
 *     `lockdown_started_at` (FR-6) — it does not emit a second entry.
 *  5. **A neutral turn changes nothing** — no trust events, no habit updates, no job rows.
 */
export function decideRider(signals: RiderSignals, state: RiderState): RiderDecision {
  const nowIso = state.now_iso ?? new Date().toISOString();

  // --- 1. Trust deltas ------------------------------------------------------
  const openness = normalizeOpennessDelta(signals.openness_delta);
  const admission = admissionDelta(signals.admission);
  const trustEvents: TrustEventDraft[] = [];
  if (openness !== 0) trustEvents.push({ reason: "openness", delta: openness });
  if (admission !== 0) trustEvents.push({ reason: "admission", delta: admission });
  const rawDelta = trustEvents.reduce((sum, event) => sum + event.delta, 0);
  const trustDelta = clampTrustScore(state.trust_score + rawDelta) - clampTrustScore(state.trust_score);

  // --- 2. Lockdown transitions ---------------------------------------------
  const entrySignal = lockdownSignal(signals, state.quit_signal, state.quit_signal_threshold);
  const exitSignal =
    signals.concession === true ||
    severityForcesExit(state.severity) ||
    breakerExpired(state.lockdown_started_at, nowIso, state.breaker_hours);
  const exit = state.dialog_state === "LOCKDOWN" && exitSignal;
  const enter = state.dialog_state === "OPEN" && entrySignal;
  const refresh = state.dialog_state === "LOCKDOWN" && !exit && entrySignal;
  const dialogState: "OPEN" | "LOCKDOWN" = exit ? "OPEN" : enter ? "LOCKDOWN" : state.dialog_state;

  // --- 3. Habit transitions -------------------------------------------------
  const habitUpdates: HabitUpdate[] = [];
  const strikeJobs: Array<{ habit_id: string; strike_at: string }> = [];
  const liveHabits = Array.isArray(state.live_habits) ? state.live_habits : [];

  if (signals.quit_commitment === true) {
    for (const habit of liveHabits) {
      habitUpdates.push({ id: habit.id, status: "quit_committed" });
    }
  } else if (signals.concession === true) {
    const strikeAt = addDays(state.local_date, state.watch_days);
    for (const habit of liveHabits) {
      if (habit.status !== "confronted") continue;
      habitUpdates.push({
        id: habit.id,
        status: "watch",
        watch_started_at: state.local_date,
        strike_at: strikeAt,
      });
      strikeJobs.push({ habit_id: habit.id, strike_at: strikeAt });
    }
  }

  const changed =
    trustEvents.length > 0 ||
    habitUpdates.length > 0 ||
    enter ||
    exit ||
    refresh;

  return {
    trust_delta: trustDelta,
    trust_events: trustEvents,
    habit_updates: habitUpdates,
    strike_jobs: strikeJobs,
    lockdown: { enter, exit, refresh_started_at: refresh },
    dialog_state: dialogState,
    changed,
  };
}

/** Convenience for the chat call site: map `ExtractionResult.intent_flags` into the signals. */
export interface ChatIntentFlags {
  give_up?: boolean;
  false_constraint?: boolean;
  concession?: boolean;
  quit_commitment?: boolean;
  admission?: boolean;
}

export function signalsFromExtraction(
  intentFlags: Partial<ChatIntentFlags> | null | undefined,
  opennessDelta: number | null | undefined,
): RiderSignals {
  const flags = intentFlags ?? {};
  return {
    openness_delta: opennessDelta,
    admission: flags.admission,
    give_up: flags.give_up,
    false_constraint: flags.false_constraint,
    concession: flags.concession,
    quit_commitment: flags.quit_commitment,
  };
}
