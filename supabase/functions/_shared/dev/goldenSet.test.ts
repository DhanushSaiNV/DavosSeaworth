// supabase/functions/_shared/dev/goldenSet.test.ts
// Fixture self-checks for the classifier golden set — FP-03 NFR-4, AC-9; §6.4.
// Refs: TECH-SPEC §6.4; FP-03-PLAN Step 6.
//
// This is a *data* suite: it proves the fixture is well-formed (counts, ids, per-case
// expectation shape, disjointness inside the set) so the eval gate never fails for a fixture
// reason. Generalisation against the exemplar corpus is measured live by
// `scripts/verify-fp03-step6.py`, which also checks leakage against `placeholderExemplars.ts`
// and the seeded rows.

import {
  GOLDEN_SET,
  GOLDEN_SET_SOURCE,
  type GoldenCase,
  type GoldenExpectation,
  type GoldenItem,
} from "./goldenSet.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes
// `supabase/functions`, and eslint ignores it), so declare the three we use. Babel erases
// these at transform time and jest supplies the real implementations at runtime.
interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toBeGreaterThan(expected: number): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

/** The plan's per-case counts (FP-03-PLAN Step 6 item 1). */
const EXPECTED_COUNTS: Record<GoldenCase, number> = {
  clear: 12,
  ambiguous: 8,
  energy: 8,
  quit: 6,
  false_constraint: 6,
};

const CASES = Object.keys(EXPECTED_COUNTS) as GoldenCase[];

/** The only keys a case's `expect` may carry — an extra key means a mis-authored item. */
const EXPECT_KEYS: Record<GoldenCase, string[]> = {
  clear: ["domain"],
  ambiguous: ["domains"],
  energy: ["emotion", "energy"],
  quit: ["quit_label"],
  false_constraint: ["quit_label"],
};

function itemsOf(kase: GoldenCase): GoldenItem[] {
  return GOLDEN_SET.filter((item) => item.case === kase);
}

function keysOf(expect: GoldenExpectation): string[] {
  return Object.keys(expect).sort();
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

describe("GOLDEN_SET shape", () => {
  it("holds the plan's 40 items with the plan's per-case counts", () => {
    expect(GOLDEN_SET.length).toBe(40);
    for (const kase of CASES) {
      expect(itemsOf(kase).length).toBe(EXPECTED_COUNTS[kase]);
    }
  });

  it("uses unique, non-empty ids and unique, non-empty texts", () => {
    const ids = GOLDEN_SET.map((item) => item.id);
    expect(new Set(ids).size).toBe(GOLDEN_SET.length);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);

    const texts = GOLDEN_SET.map((item) => normalize(item.text));
    for (const text of texts) expect(text.length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(GOLDEN_SET.length);
  });

  it("declares only the five known cases", () => {
    for (const item of GOLDEN_SET) expect(CASES).toContain(item.case);
  });

  it("carries exactly the expectation keys its case defines", () => {
    for (const item of GOLDEN_SET) {
      expect(keysOf(item.expect)).toEqual(EXPECT_KEYS[item.case]);
    }
  });

  it("is stamped as a draft fixture, not as seeded content", () => {
    expect(GOLDEN_SET_SOURCE).toBe("GOLDEN-ACCEPTED");
  });
});

describe("GOLDEN_SET clear bucket", () => {
  it("names a distinct §3.3 domain on every item", () => {
    const domains = itemsOf("clear").map((item) => item.expect.domain);
    for (const domain of domains) {
      expect(typeof domain).toBe("string");
      expect((domain ?? "").length).toBeGreaterThan(0);
    }
    // Distinct labels: a repeated domain would double-count one label in the accuracy gate.
    expect(new Set(domains).size).toBe(domains.length);
  });
});

describe("GOLDEN_SET ambiguous bucket", () => {
  it("lists two distinct plausible domains on every item", () => {
    for (const item of itemsOf("ambiguous")) {
      const pair = item.expect.domains;
      expect(pair?.length).toBe(2);
      const [first, second] = pair ?? [];
      expect((first ?? "").length).toBeGreaterThan(0);
      expect((second ?? "").length).toBeGreaterThan(0);
      expect(first === second).toBe(false);
    }
  });
});

describe("GOLDEN_SET energy bucket", () => {
  it("splits 4 low / 4 high and forces the emotion the override dictates", () => {
    const energy = itemsOf("energy");
    const low = energy.filter((item) => (item.expect.energy ?? 0) <= 3);
    const high = energy.filter((item) => (item.expect.energy ?? 0) >= 8);
    expect(low.length).toBe(4);
    expect(high.length).toBe(4);

    for (const item of low) expect(item.expect.emotion).toBe("exhausted");
    for (const item of high) expect(item.expect.emotion).toBe("determined");
  });

  it("carries a finite numeric energy on every item", () => {
    for (const item of itemsOf("energy")) {
      expect(typeof item.expect.energy).toBe("number");
      expect(Number.isFinite(item.expect.energy)).toBe(true);
    }
  });
});

describe("GOLDEN_SET quit bucket", () => {
  it("labels every quit item `quit` and every false-constraint item `false_constraint`", () => {
    for (const item of itemsOf("quit")) expect(item.expect.quit_label).toBe("quit");
    for (const item of itemsOf("false_constraint")) {
      expect(item.expect.quit_label).toBe("false_constraint");
    }
  });
});
