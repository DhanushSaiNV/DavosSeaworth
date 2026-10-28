// supabase/functions/_shared/pipeline/autoAdopt.test.ts
// FP-04 Step 3b — the §5.3 qualifying-row rule, both FR-10 directions (AC-7).
//
// Refs: TECH-SPEC §5.3; FP-04 FR-10, AC-7; D8.
//
// Rows are given **newest first**, exactly as `send-message`'s query returns them. Every reply
// carries its anchor row in the same slice, as a real slice does: a primary reply's anchor is
// the user row it answered, which is written immediately before it.

import {
  CHECKIN_SOURCE,
  ONBOARDING_SOURCE,
  decideAutoAdopt,
  type AutoAdoptRow,
} from "./autoAdopt.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes
// `supabase/functions`, and eslint ignores it), so declare the ones used here. Babel erases
// these at transform time and jest supplies the real implementations at runtime.
interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const NOW = Date.parse("2026-10-17T12:00:00.000Z");
const WINDOW = 10;

function at(minutesAgo: number): string {
  return new Date(NOW - minutesAgo * 60_000).toISOString();
}

/** A `role:'user'` row: the new arrival's predecessors, or a reply's anchor. */
function user(id: string, minutesAgo: number, metadata: Record<string, unknown> | null = {}): AutoAdoptRow {
  return { id, role: "user", reply_to_message_id: null, metadata, created_at: at(minutesAgo) };
}

/** An `role:'assistant'` row anchored on `anchorId` — a primary reply, or an unprompted row. */
function assistant(
  id: string,
  anchorId: string | null,
  minutesAgo: number,
  metadata: Record<string, unknown> | null,
): AutoAdoptRow {
  return { id, role: "assistant", reply_to_message_id: anchorId, metadata, created_at: at(minutesAgo) };
}

const autoMeta = (domain: string, extra: Record<string, unknown> = {}) => ({
  route: "auto",
  domain,
  source: "pipeline",
  ...extra,
});

const decide = (rows: AutoAdoptRow[]) =>
  decideAutoAdopt({ rows, nowMs: NOW, windowMinutes: WINDOW });

describe("decideAutoAdopt — §5.3 clauses", () => {
  it("qualifies on an auto-route primary reply inside the window", () => {
    const rows = [
      assistant("r1", "u1", 3, autoMeta("Fitness")),
      user("u1", 4),
    ];
    expect(decide(rows)).toEqual({
      qualifies: true,
      reason: "qualifies",
      domain: "Fitness",
      replyAgoMs: 3 * 60_000,
    });
  });

  it("stops at a user row in between (D-B: the answer to the wrong turn)", () => {
    const rows = [
      user("u2", 1),
      assistant("r1", "u1", 3, autoMeta("Fitness")),
      user("u1", 4),
    ];
    expect(decide(rows)).toEqual({
      qualifies: false,
      reason: "preceded_by_user",
      domain: null,
      replyAgoMs: null,
    });
  });

  it("rejects a secondary reply (no anchor — a chip tap is not the sync turn's own reply)", () => {
    const rows = [
      assistant("s1", null, 2, { route: "options", source: "pipeline_secondary" }),
      user("u1", 3),
    ];
    expect(decide(rows).reason).toBe("not_primary");
  });

  it("rejects the degrade holding reply (primary, but route='degrade')", () => {
    const rows = [
      assistant("h1", "u1", 2, { route: "degrade", source: "sync_degrade" }),
      user("u1", 3),
    ];
    expect(decide(rows).reason).toBe("not_auto");
  });

  it("rejects a reply outside auto_adopt_window_minutes (server clock)", () => {
    const rows = [
      assistant("r1", "u1", 45, autoMeta("Fitness")),
      user("u1", 46),
    ];
    expect(decide(rows)).toEqual({
      qualifies: false,
      reason: "stale",
      domain: null,
      replyAgoMs: null,
    });
  });

  it("rejects an auto reply with no domain", () => {
    const rows = [
      assistant("r1", "u1", 2, { route: "auto", source: "pipeline" }),
      user("u1", 3),
    ];
    expect(decide(rows).reason).toBe("no_domain");
  });

  it("qualifies a source-less row — the NULL-safety trap (a bare SQL neq would drop it)", () => {
    const rows = [
      assistant("r1", "u1", 3, { route: "auto", domain: "Career" }),
      user("u1", 4),
    ];
    expect(decide(rows).qualifies).toBe(true);
    expect(decide(rows).domain).toBe("Career");
  });

  it("does not throw on a null metadata column", () => {
    const rows = [
      assistant("r1", "u1", 3, null),
      user("u1", 4, null),
    ];
    expect(decide(rows).reason).toBe("not_auto");
  });

  it("has nothing to score on an empty slice", () => {
    expect(decide([]).reason).toBe("no_rows");
  });
});

describe("decideAutoAdopt — FR-10 check-in transparency (AC-7)", () => {
  it("keeps the success countable across a full check-in turn (reply + its user row)", () => {
    const rows = [
      assistant("ca", "cu", 1, autoMeta("Fitness")),
      user("cu", 2, { source: CHECKIN_SOURCE }),
      assistant("r_auto", "u_ask", 3, autoMeta("Career")),
      user("u_ask", 4),
    ];
    expect(decide(rows)).toEqual({
      qualifies: true,
      reason: "qualifies",
      domain: "Career",
      replyAgoMs: 3 * 60_000,
    });
  });

  it("keeps the success countable across a check-in user row whose reply never landed", () => {
    const rows = [
      user("cu", 1, { source: CHECKIN_SOURCE }),
      assistant("r_auto", "u_ask", 2, autoMeta("Career")),
      user("u_ask", 3),
    ];
    expect(decide(rows).qualifies).toBe(true);
  });

  it("never counts a check-in arrival as one, however auto-shaped its reply is", () => {
    const rows = [
      assistant("ca", "cu", 1, autoMeta("Fitness")),
      user("cu", 2, { source: CHECKIN_SOURCE }),
    ];
    expect(decide(rows).reason).toBe("no_rows");
  });

  it("never counts the check-in user row itself", () => {
    // Transparent, and with nothing behind it there is no chain left to score: "no_rows".
    expect(decide([user("cu", 1, { source: CHECKIN_SOURCE })]).reason).toBe("no_rows");
  });

  it("stops conservatively when the intervention reply's anchor is outside the slice", () => {
    // Only reachable when the walk has descended a run of check-in rows to the slice's oldest
    // row; §5.3's bias is a lost count rather than a wrong one.
    const rows = [
      user("cu2", 1, { source: CHECKIN_SOURCE }),
      assistant("ca", "cu-not-fetched", 3, autoMeta("Fitness")),
    ];
    expect(decide(rows).reason).toBe("anchor_unresolved");
  });

  it("still breaks the chain on an unprompted watchdog row (only check-ins/onboarding are transparent)", () => {
    const rows = [
      assistant("w1", null, 1, { route: "auto", domain: "Career", source: "watchdog_intervention" }),
      assistant("r_auto", "u_ask", 3, autoMeta("Career")),
      user("u_ask", 4),
    ];
    expect(decide(rows).reason).toBe("not_primary");
  });
});

describe("decideAutoAdopt — FP-09 onboarding transparency", () => {
  it("keeps a prior success countable across a full onboarding turn", () => {
    const rows = [
      assistant("oa", "ou", 1, autoMeta("Baseline", { source: ONBOARDING_SOURCE })),
      user("ou", 2, { source: ONBOARDING_SOURCE, onboarding_stage: "baseline" }),
      assistant("r_auto", "u_ask", 3, autoMeta("Career")),
      user("u_ask", 4),
    ];
    expect(decide(rows)).toEqual({
      qualifies: true,
      reason: "qualifies",
      domain: "Career",
      replyAgoMs: 3 * 60_000,
    });
  });

  it("never counts an onboarding arrival as a success, however auto-shaped its reply is", () => {
    const rows = [
      assistant("oa", "ou", 1, autoMeta("Baseline", { source: ONBOARDING_SOURCE })),
      user("ou", 2, { source: ONBOARDING_SOURCE, onboarding_stage: "baseline" }),
    ];
    expect(decide(rows).reason).toBe("no_rows");
  });

  it("treats an onboarding reply as transparent even when only its anchor is tagged", () => {
    const rows = [
      assistant("oa", "ou", 1, autoMeta("Baseline")),
      user("ou", 2, { source: ONBOARDING_SOURCE, onboarding_stage: "baseline" }),
      assistant("r_auto", "u_ask", 3, autoMeta("Career")),
      user("u_ask", 4),
    ];
    expect(decide(rows).qualifies).toBe(true);
    expect(decide(rows).domain).toBe("Career");
  });
});
