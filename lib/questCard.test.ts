// lib/questCard.test.ts
// FP-08 Step 6 — the pure quest card state (FR-17): strict offer parsing, the persisted
// accepted/declined states, the in-flight tap, and the response mapping (AC-7's double tap).

import {
  acceptOutcome,
  parseQuestOffer,
  persistedState,
  questCardFor,
} from "./questCard";

const OFFER = {
  name: "Three A Day",
  domain: "Discipline/Habits",
  output_unit: "doings",
  deadline_days: 7,
  rationale: "Three logged doings a day keeps the chain alive.",
};

describe("parseQuestOffer", () => {
  it("accepts the exact card shape and rounds the deadline", () => {
    expect(parseQuestOffer({ ...OFFER, deadline_days: 6.6 })).toEqual({ ...OFFER, deadline_days: 7 });
  });

  it("rejects missing or malformed fields", () => {
    expect(parseQuestOffer(null)).toBe(null);
    expect(parseQuestOffer({ ...OFFER, name: "" })).toBe(null);
    expect(parseQuestOffer({ ...OFFER, output_unit: "  " })).toBe(null);
    expect(parseQuestOffer({ ...OFFER, deadline_days: 0 })).toBe(null);
    expect(parseQuestOffer({ ...OFFER, deadline_days: "seven" })).toBe(null);
  });

  it("keeps rationale optional", () => {
    const { rationale: _drop, ...bare } = OFFER;
    expect(parseQuestOffer(bare)?.rationale).toBe(undefined);
  });
});

describe("persistedState (the row is the truth)", () => {
  it("defaults to offer", () => {
    expect(persistedState({})).toBe("offer");
    expect(persistedState(null)).toBe("offer");
  });

  it("reads accepted and declined from metadata", () => {
    expect(persistedState({ quest_accepted: true })).toBe("accepted");
    expect(persistedState({ quest_consumed: true })).toBe("accepted");
    expect(persistedState({ quest_declined: true, quest_consumed: true })).toBe("declined");
  });
});

describe("questCardFor", () => {
  it("renders no card without a valid offer", () => {
    expect(questCardFor({})).toBe(null);
    expect(questCardFor({ quest_offer: { name: "x" } })).toBe(null);
  });

  it("carries the persisted metric id after a refetch", () => {
    const card = questCardFor({ quest_offer: OFFER, quest_accepted: true, quest_metric_id: "m1" });
    expect(card?.state).toBe("accepted");
    expect(card?.metricId).toBe("m1");
  });

  it("a pending tap renders accepting, a result overrides it", () => {
    expect(questCardFor({ quest_offer: OFFER }, { pending: true })?.state).toBe("accepting");
    expect(questCardFor({ quest_offer: OFFER }, { pending: true, result: "conflict" })?.state)
      .toBe("conflict");
  });

  it("a completed result wins over stale metadata", () => {
    const card = questCardFor(
      { quest_offer: OFFER, quest_consumed: true, quest_accepted: true },
      { result: "error", error: "nope" },
    );
    expect(card?.state).toBe("error");
    expect(card?.error).toBe("nope");
  });
});

describe("acceptOutcome (AC-7)", () => {
  it("ok and duplicate both render accepted", () => {
    expect(acceptOutcome(200, { status: "ok", metric_id: "m1" }))
      .toEqual({ state: "accepted", metricId: "m1" });
    expect(acceptOutcome(200, { status: "duplicate" })).toEqual({ state: "accepted", metricId: undefined });
  });

  it("decline collapses", () => {
    expect(acceptOutcome(200, { status: "declined" })).toEqual({ state: "declined" });
  });

  it("the one-active-quest conflict is its own state", () => {
    expect(acceptOutcome(409, { status: "conflict" }).state).toBe("conflict");
  });

  it("a gate failure and an unknown row are errors", () => {
    expect(acceptOutcome(422, { status: "invalid_formula" }).state).toBe("error");
    expect(acceptOutcome(404, { status: "not_found" }).state).toBe("error");
    expect(acceptOutcome(undefined, null).state).toBe("error");
  });
});
