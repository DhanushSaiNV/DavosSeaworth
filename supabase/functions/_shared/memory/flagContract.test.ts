// supabase/functions/_shared/memory/flagContract.test.ts
// FP-06 Step 2 — the flag loop's pure half (FR-1, FR-2, FR-17).
// Refs: FP-06 FR-1, FR-2; TECH-SPEC §7.6, §5.4.

import { decideFlag, isPurgeable, parseFlagBody } from "./flagContract.ts";

describe("parseFlagBody", () => {
  const valid = "b986f2fd-bfa5-49c3-b39f-4e9e330d0299";

  it("accepts a uuid message_id", () => {
    expect(parseFlagBody({ message_id: valid })).toEqual({ ok: true, messageId: valid });
  });

  it("rejects a missing / non-string / non-uuid id with 400", () => {
    for (const body of [{}, { message_id: 7 }, { message_id: "nope" }, { message_id: "" }]) {
      const out = parseFlagBody(body);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.status).toBe(400);
    }
  });

  it("rejects a non-object body with 400", () => {
    for (const body of [null, undefined, "x", 42, [valid]]) {
      const out = parseFlagBody(body);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.status).toBe(400);
    }
  });
});

describe("decideFlag", () => {
  it("absent row → not_found (the own-rows boundary makes foreign ids absent too)", () => {
    expect(decideFlag(null)).toBe("not_found");
  });

  it("assistant row → assistant (flagging Davos's own words is meaningless)", () => {
    expect(decideFlag({ role: "assistant", unsavable: false })).toBe("assistant");
  });

  it("own user row, unflagged → flip", () => {
    expect(decideFlag({ role: "user", unsavable: false })).toBe("flip");
  });

  it("own user row, already flagged → already_flagged (ok, no job)", () => {
    expect(decideFlag({ role: "user", unsavable: true })).toBe("already_flagged");
  });

  it("a missing unsavable value reads as unflagged (defensive default)", () => {
    expect(decideFlag({ role: "user" })).toBe("flip");
  });
});

describe("isPurgeable (the dispatcher's guard, as data)", () => {
  it("unpurged non-oath rows are purgeable", () => {
    expect(isPurgeable({ fact_type: "chat", purged_at: null })).toBe(true);
    expect(isPurgeable({ fact_type: "journal" })).toBe(true);
    expect(isPurgeable({ fact_type: "baseline" })).toBe(true);
  });

  it("already-purged rows are skipped (idempotent re-run)", () => {
    expect(isPurgeable({ fact_type: "chat", purged_at: "2026-10-20T00:00:00Z" })).toBe(false);
  });

  it("oath rows are exempt (the §5.4 guard, written before any writer exists)", () => {
    expect(isPurgeable({ fact_type: "oath", purged_at: null })).toBe(false);
  });
});
