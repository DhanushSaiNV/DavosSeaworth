// supabase/functions/_shared/accountability/rider.test.ts
// FP-08 AC-2 (unit half) — the D20 rider's decision table.
// Refs: FP-08 FR-2, FR-4, FR-6, FR-8, FR-18; TECH-SPEC §5.3–5.4; D8, D20, D21.
//
// Type-checked by `deno check` and run by jest.

import {
  BAND_SHIFT_OVERRIDE_FLOOR,
  BAND_SHIFT_SUCCESS_CAP,
  IMPULSE_CANDOR_CAP_PER_DAY,
  admissionDelta,
  clampBandShift,
  clampTrustScore,
  decideRider,
  impulseCandorCredit,
  normalizeOpennessDelta,
  signalsFromExtraction,
  type RiderState,
} from "./rider.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeTruthy(): void;
  toBeGreaterThan(expected: number): void;
  toContain(expected: string): void;
  toHaveLength(expected: number): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const BASE: RiderState = {
  trust_score: 50,
  dialog_state: "OPEN",
  lockdown_started_at: null,
  live_habits: [],
  local_date: "2026-10-21",
  watch_days: 7,
  breaker_hours: 24,
  quit_signal: null,
  quit_signal_threshold: 0.75,
  now_iso: "2026-10-21T09:00:00Z",
};

describe("arithmetic helpers (§5.4, §11)", () => {
  it("clamps the score onto 0–100", () => {
    expect(clampTrustScore(-5)).toBe(0);
    expect(clampTrustScore(105)).toBe(100);
    expect(clampTrustScore(49.6)).toBe(50);
  });

  it("clamps openness to the contract's ±5", () => {
    expect(normalizeOpennessDelta(9)).toBe(5);
    expect(normalizeOpennessDelta(-9)).toBe(-5);
    expect(normalizeOpennessDelta(Number.NaN)).toBe(0);
    expect(normalizeOpennessDelta(null)).toBe(0);
  });

  it("admits +10 only on a true flag", () => {
    expect(admissionDelta(true)).toBe(10);
    expect(admissionDelta(false)).toBe(0);
    expect(admissionDelta(null)).toBe(0);
  });

  it("caps the impulse candor credit at three per local day", () => {
    expect(IMPULSE_CANDOR_CAP_PER_DAY).toBe(3);
    expect(impulseCandorCredit(0)).toBe(1);
    expect(impulseCandorCredit(2)).toBe(1);
    expect(impulseCandorCredit(3)).toBe(0);
    expect(impulseCandorCredit(99)).toBe(0);
  });

  it("bands the adaptive weighting to the D8 floor and cap", () => {
    expect(clampBandShift(0, -0.02)).toBe(-0.02);
    expect(clampBandShift(-0.09, -0.02)).toBe(BAND_SHIFT_OVERRIDE_FLOOR);
    expect(clampBandShift(0.09, 0.01)).toBe(BAND_SHIFT_SUCCESS_CAP);
    expect(clampBandShift(0.1, 0.01)).toBe(BAND_SHIFT_SUCCESS_CAP);
  });
});

describe("neutral turns write nothing", () => {
  it("no flags, OPEN, no habits → empty decision", () => {
    const decision = decideRider({ openness_delta: 0 }, BASE);
    expect(decision.trust_delta).toBe(0);
    expect(decision.trust_events).toHaveLength(0);
    expect(decision.habit_updates).toHaveLength(0);
    expect(decision.strike_jobs).toHaveLength(0);
    expect(decision.lockdown).toEqual({ enter: false, exit: false, refresh_started_at: false });
    expect(decision.changed).toBe(false);
  });

  it("a locked turn with no signals stays locked and unchanged", () => {
    const decision = decideRider({}, { ...BASE, dialog_state: "LOCKDOWN", lockdown_started_at: "2026-10-21T01:00:00Z" });
    expect(decision.dialog_state).toBe("LOCKDOWN");
    expect(decision.changed).toBe(false);
  });
});

describe("trust deltas", () => {
  it("openness_delta → one openness event and the same delta", () => {
    const decision = decideRider({ openness_delta: 3 }, BASE);
    expect(decision.trust_delta).toBe(3);
    expect(decision.trust_events).toEqual([{ reason: "openness", delta: 3 }]);
    expect(decision.changed).toBe(true);
  });

  it("a negative openness delta is clamped at −5", () => {
    const decision = decideRider({ openness_delta: -12 }, BASE);
    expect(decision.trust_delta).toBe(-5);
  });

  it("admission → +10 under its own reason", () => {
    const decision = decideRider({ admission: true }, BASE);
    expect(decision.trust_events).toEqual([{ reason: "admission", delta: 10 }]);
  });

  it("both signals emit both rows and coalesce the delta under the clamp", () => {
    const decision = decideRider({ openness_delta: 5, admission: true }, { ...BASE, trust_score: 95 });
    expect(decision.trust_events).toHaveLength(2);
    expect(decision.trust_delta).toBe(5); // 95 + 15 clamps to 100
  });

  it("the decrement path floors at 0", () => {
    const decision = decideRider({ openness_delta: -5 }, { ...BASE, trust_score: 2 });
    expect(decision.trust_delta).toBe(-2);
  });
});

describe("lockdown entry (FR-6)", () => {
  it("give_up enters from OPEN", () => {
    const decision = decideRider({ give_up: true }, BASE);
    expect(decision.lockdown.enter).toBe(true);
    expect(decision.dialog_state).toBe("LOCKDOWN");
  });

  it("false_constraint enters from OPEN", () => {
    expect(decideRider({ false_constraint: true }, BASE).lockdown.enter).toBe(true);
  });

  it("the classifier's quit signal enters at the threshold", () => {
    expect(decideRider({}, { ...BASE, quit_signal: 0.75 }).lockdown.enter).toBe(true);
    expect(decideRider({}, { ...BASE, quit_signal: 0.8 }).lockdown.enter).toBe(true);
  });

  it("a quit signal under the threshold does not enter", () => {
    expect(decideRider({}, { ...BASE, quit_signal: 0.74 }).lockdown.enter).toBe(false);
  });

  it("re-entry refreshes the timestamp without a second entry", () => {
    const decision = decideRider({ give_up: true }, {
      ...BASE,
      dialog_state: "LOCKDOWN",
      lockdown_started_at: "2026-10-21T08:00:00Z",
    });
    expect(decision.lockdown.enter).toBe(false);
    expect(decision.lockdown.refresh_started_at).toBe(true);
    expect(decision.changed).toBe(true);
  });
});

describe("lockdown exits (FR-8)", () => {
  const locked: RiderState = {
    ...BASE,
    dialog_state: "LOCKDOWN",
    lockdown_started_at: "2026-10-21T08:00:00Z",
  };

  it("a concession opens the dialog", () => {
    const decision = decideRider({ concession: true }, locked);
    expect(decision.lockdown.exit).toBe(true);
    expect(decision.dialog_state).toBe("OPEN");
  });

  it("exit beats a simultaneous entry signal", () => {
    const decision = decideRider({ concession: true, give_up: true }, locked);
    expect(decision.lockdown.exit).toBe(true);
    expect(decision.lockdown.enter).toBe(false);
    expect(decision.dialog_state).toBe("OPEN");
  });

  it("the lazy breaker exits after the configured hours", () => {
    const decision = decideRider({}, { ...locked, now_iso: "2026-10-22T09:00:00Z" });
    expect(decision.lockdown.exit).toBe(true);
  });

  it("the breaker does not exit one minute early", () => {
    const decision = decideRider({}, { ...locked, now_iso: "2026-10-22T07:59:00Z" });
    expect(decision.lockdown.exit).toBe(false);
  });

  it("journal S1/S2 exits, S3 does not", () => {
    expect(decideRider({}, { ...locked, severity: "S1" }).lockdown.exit).toBe(true);
    expect(decideRider({}, { ...locked, severity: "S2" }).lockdown.exit).toBe(true);
    expect(decideRider({}, { ...locked, severity: "S3" }).lockdown.exit).toBe(false);
  });

  it("an OPEN turn never reports an exit", () => {
    expect(decideRider({ concession: true }, BASE).lockdown.exit).toBe(false);
  });
});

describe("habit transitions + watch entries (FR-18)", () => {
  const liveHabits = [
    { id: "h1", status: "detected" as const },
    { id: "h2", status: "confronted" as const },
    { id: "h3", status: "watch" as const },
  ];

  it("concession watches confronted habits only, with strike_at = today + watch days", () => {
    const decision = decideRider({ concession: true }, { ...BASE, live_habits: liveHabits });
    expect(decision.habit_updates).toEqual([{
      id: "h2",
      status: "watch",
      watch_started_at: "2026-10-21",
      strike_at: "2026-10-28",
    }]);
    expect(decision.strike_jobs).toEqual([{ habit_id: "h2", strike_at: "2026-10-28" }]);
  });

  it("no strike job is inserted without a watch entry", () => {
    const decision = decideRider({ openness_delta: 1 }, { ...BASE, live_habits: liveHabits });
    expect(decision.habit_updates).toHaveLength(0);
    expect(decision.strike_jobs).toHaveLength(0);
  });

  it("quit_commitment cancels every live habit and beats the concession watch", () => {
    const decision = decideRider({ quit_commitment: true, concession: true }, { ...BASE, live_habits: liveHabits });
    expect(decision.habit_updates).toEqual([
      { id: "h1", status: "quit_committed" },
      { id: "h2", status: "quit_committed" },
      { id: "h3", status: "quit_committed" },
    ]);
    expect(decision.strike_jobs).toHaveLength(0);
  });

  it("quit_commitment still exits lockdown through the concession flag", () => {
    const decision = decideRider({ quit_commitment: true, concession: true }, {
      ...BASE,
      dialog_state: "LOCKDOWN",
      lockdown_started_at: "2026-10-21T08:00:00Z",
      live_habits: liveHabits,
    });
    expect(decision.dialog_state).toBe("OPEN");
    expect(decision.habit_updates.every((update) => update.status === "quit_committed")).toBe(true);
  });

  it("a neutral turn with habits writes nothing", () => {
    const decision = decideRider({}, { ...BASE, live_habits: liveHabits });
    expect(decision.changed).toBe(false);
  });
});

describe("signalsFromExtraction (the chat call-site mapping)", () => {
  it("maps the intent flags and the openness delta", () => {
    const signals = signalsFromExtraction(
      { admission: true, quit_commitment: true, concession: true },
      3,
    );
    expect(signals.admission).toBe(true);
    expect(signals.quit_commitment).toBe(true);
    expect(signals.concession).toBe(true);
    expect(signals.openness_delta).toBe(3);
  });

  it("carries give_up and false_constraint through (the lockdown-entry arms)", () => {
    const signals = signalsFromExtraction({ give_up: true, false_constraint: true }, -2);
    expect(signals.give_up).toBe(true);
    expect(signals.false_constraint).toBe(true);
    expect(signals.openness_delta).toBe(-2);
  });

  it("keeps absent flags absent — a neutral turn yields no signal", () => {
    const signals = signalsFromExtraction({}, null);
    expect(signals.admission).toBeUndefined();
    expect(signals.concession).toBeUndefined();
    expect(signals.openness_delta).toBeNull();
    expect(signalsFromExtraction(null, undefined).openness_delta).toBeUndefined();
  });
});
