// supabase/functions/_shared/memory/boundary.test.ts
// FP-06 Step 4 — the boundary trigger's pure half: the count table and a scripted-thread
// walk (FR-3). Refs: FP-06 FR-3; TECH-SPEC §7.6.

import { buildMemoryExtractPayload, shouldExtractAtBoundary } from "./boundary.ts";

describe("shouldExtractAtBoundary (window 8)", () => {
  it("fires exactly at the window multiples", () => {
    const fired = [7, 8, 9, 15, 16, 17, 24].filter((n) => shouldExtractAtBoundary(n, 8));
    expect(fired).toEqual([8, 16, 24]);
  });

  it("never fires before the first full window", () => {
    expect(shouldExtractAtBoundary(0, 8)).toBe(false);
    expect(shouldExtractAtBoundary(1, 8)).toBe(false);
  });

  it("is fail-closed on nonsense inputs", () => {
    expect(shouldExtractAtBoundary(8, 0)).toBe(false);
    expect(shouldExtractAtBoundary(8, -1)).toBe(false);
    expect(shouldExtractAtBoundary(Number.NaN, 8)).toBe(false);
  });

  it("honours a reconfigured window", () => {
    expect(shouldExtractAtBoundary(4, 4)).toBe(true);
    expect(shouldExtractAtBoundary(8, 4)).toBe(true);
    expect(shouldExtractAtBoundary(6, 4)).toBe(false);
  });
});

describe("buildMemoryExtractPayload", () => {
  it("carries user_id and the boundary count", () => {
    expect(buildMemoryExtractPayload("u-1", 8)).toEqual({ user_id: "u-1", boundary: 8 });
  });
});

describe("scripted-thread walk (the fresh-insert clause discipline)", () => {
  it("a 16-message mix fires at exactly 8 and 16 — count is user-role rows, all sources", () => {
    // Alternating user/assistant rows; one user row is a check-in-sourced write (FR-3
    // reading: the count is role-based, so every user-role row advances it).
    const thread: Array<{ role: "user" | "assistant"; source?: string }> = [];
    for (let i = 0; i < 16; i++) {
      thread.push({ role: "user", ...(i === 2 ? { source: "checkin" } : {}) });
      thread.push({ role: "assistant" });
    }
    const boundaries: number[] = [];
    let userCount = 0;
    for (const row of thread) {
      if (row.role !== "user") continue;
      userCount += 1;
      if (shouldExtractAtBoundary(userCount, 8)) boundaries.push(userCount);
    }
    expect(boundaries).toEqual([8, 16]);
  });

  it("duplicate / repair / replay legs advance nothing (only fresh inserts call the rule)", () => {
    // The exactly-once guarantee is the call-site discipline (fresh-insert branch only,
    // pinned statically in verify-fp06-step4.py). What the pure level can pin is the
    // walk's arithmetic when that discipline holds: duplicate/repair/replay events do
    // not advance the count and do not evaluate the rule.
    type Event = { kind: "fresh" | "duplicate" | "repair" | "replay" };
    const events: Event[] = [];
    for (let i = 0; i < 8; i++) events.push({ kind: "fresh" });
    events.push({ kind: "duplicate" }, { kind: "repair" }, { kind: "replay" });
    for (let i = 0; i < 8; i++) events.push({ kind: "fresh" });

    const boundaries: number[] = [];
    let userCount = 0;
    for (const event of events) {
      if (event.kind !== "fresh") continue; // the other branches never reach the hook
      userCount += 1;
      if (shouldExtractAtBoundary(userCount, 8)) boundaries.push(userCount);
    }
    expect(boundaries).toEqual([8, 16]);
  });
});
