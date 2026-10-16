// supabase/functions/_shared/pipeline/classify.test.ts
// Unit tests for the pure half of the real classifier — `composeClassification` (§6.3) and
// `D7Fallback` (§6.4). FP-03 FR-7–FR-10, FR-12; AC-3, AC-4 (unit level), AC-5 (classify level).
// Refs: TECH-SPEC §6.2, §6.3, §6.4.
//
// Only the pure module is under test: importing `classifyReal.ts` would pull in
// `_shared/config.ts`, which reads `Deno.env` at import time and cannot load under jest.
// The RPC leg is covered by `scripts/verify-fp03-step4.py` against the live function.

import {
  composeClassification,
  D7Fallback,
  type ClassifyThresholds,
  type ExemplarMatch,
  type SetKind,
} from "./classify.ts";

// Deno's checker sees no jest globals in this tree (tsconfig.json excludes
// `supabase/functions`, and eslint ignores it), so declare the three we use. Babel erases
// these at transform time and jest supplies the real implementations at runtime.
interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

/** The [SPEC] bounds as seeded in `config` — fixtures only; the sources read the real keys. */
const T: ClassifyThresholds = {
  quitSignalThreshold: 0.75,
  energyExhaustedMax: 3,
  energyDeterminedMin: 8,
};

function m(setKind: SetKind, label: string, sim: number): ExemplarMatch {
  return { setKind, label, sim };
}

describe("composeClassification", () => {
  it("argmaxes each set independently and returns the §6.3 block in order", () => {
    const c = composeClassification(
      [
        m("domain", "Fitness", 0.61),
        m("domain", "Career", 0.72),
        m("emotion", "frustrated", 0.66),
        m("emotion", "proud", 0.55),
        m("quit_signal", "quit", 0.2),
        m("quit_signal", "false_constraint", 0.1),
      ],
      null,
      T,
    );

    expect(c.domain).toBe("Career");
    expect(c.domain_conf).toBe(0.72);
    expect(c.emotion).toBe("frustrated");
    expect(c.emotion_conf).toBe(0.66);
    expect(c.quit_signal).toBe(false);
    expect(c.overall_conf).toBe(0.66);
    expect(Object.keys(c)).toEqual([
      "domain",
      "domain_conf",
      "emotion",
      "emotion_conf",
      "quit_signal",
      "overall_conf",
    ]);
  });

  it("sets overall_conf to min(domain_conf, emotion_conf)", () => {
    const c = composeClassification(
      [m("domain", "Fitness", 0.9), m("emotion", "proud", 0.42)],
      null,
      T,
    );
    expect(c.overall_conf).toBe(0.42);
  });

  it("aggregates duplicate labels by max similarity (the RPC's per-label rows)", () => {
    const c = composeClassification(
      [
        m("emotion", "exhausted", 0.4),
        m("emotion", "exhausted", 0.58),
        m("domain", "Fitness", 0.7),
      ],
      2,
      T,
    );
    expect(c.emotion).toBe("exhausted");
    expect(c.emotion_conf).toBe(0.58);
  });

  describe("energy override (§6.2, FR-8)", () => {
    const rows = [
      m("domain", "Fitness", 0.8),
      m("emotion", "proud", 0.95),
      m("emotion", "exhausted", 0.3),
    ];

    it("forces exhausted at or below the floor, overriding a higher-scoring argmax", () => {
      const c = composeClassification(rows, 2, T);
      expect(c.emotion).toBe("exhausted");
      // D4: the forced label's own best similarity, not the argmax's.
      expect(c.emotion_conf).toBe(0.3);
      expect(c.overall_conf).toBe(0.3);
    });

    it("forces determined at or above the ceiling", () => {
      const c = composeClassification(
        [
          m("domain", "Fitness", 0.8),
          m("emotion", "frustrated", 0.9),
          m("emotion", "determined", 0.5),
        ],
        9,
        T,
      );
      expect(c.emotion).toBe("determined");
      expect(c.emotion_conf).toBe(0.5);
    });

    it("treats both bounds as inclusive and leaves the middle band alone", () => {
      expect(composeClassification(rows, 3, T).emotion).toBe("exhausted");
      expect(composeClassification(rows, 4, T).emotion).toBe("proud");
      expect(composeClassification(rows, 7, T).emotion).toBe("proud");
      expect(composeClassification(rows, 8, T).emotion).toBe("determined");
    });

    it("leaves the argmax standing when energy is absent or null", () => {
      expect(composeClassification(rows, undefined, T).emotion).toBe("proud");
      expect(composeClassification(rows, null, T).emotion).toBe("proud");
    });

    it("gives a forced label confidence 0 when it has no rows", () => {
      const c = composeClassification(
        [m("domain", "Fitness", 0.8), m("emotion", "proud", 0.9)],
        2,
        T,
      );
      expect(c.emotion).toBe("exhausted");
      expect(c.emotion_conf).toBe(0);
      expect(c.overall_conf).toBe(0);
    });

    it("prefers exhausted when a misconfigured threshold pair overlaps", () => {
      const overlapping: ClassifyThresholds = {
        quitSignalThreshold: 0.75,
        energyExhaustedMax: 9,
        energyDeterminedMin: 2,
      };
      expect(composeClassification([m("emotion", "proud", 0.9)], 5, overlapping).emotion).toBe(
        "exhausted",
      );
    });
  });

  describe("quit_signal (§6.3)", () => {
    const emotion = m("emotion", "frustrated", 0.6);

    it("is true at or above the threshold, false below it", () => {
      const flagged = composeClassification([emotion, m("quit_signal", "quit", 0.75)], null, T);
      const below = composeClassification([emotion, m("quit_signal", "quit", 0.74)], null, T);
      expect(flagged.quit_signal).toBe(true);
      expect(below.quit_signal).toBe(false);
    });

    it("reads the whole quit set, either label", () => {
      expect(
        composeClassification([m("quit_signal", "false_constraint", 0.9)], null, T).quit_signal,
      ).toBe(true);
    });

    it("is false when the quit set has no rows", () => {
      expect(composeClassification([emotion], null, T).quit_signal).toBe(false);
    });
  });

  describe("degraded inputs", () => {
    it("returns the D7 block for an empty corpus", () => {
      expect(composeClassification([], null, T)).toEqual(D7Fallback());
      expect(D7Fallback()).toEqual({
        domain: null,
        domain_conf: 0,
        emotion: null,
        emotion_conf: 0,
        quit_signal: false,
        overall_conf: 0,
      });
    });

    it("leaves emotion null and overall_conf 0 when only the domain set has rows", () => {
      const c = composeClassification([m("domain", "Fitness", 0.9)], null, T);
      expect(c.domain).toBe("Fitness");
      expect(c.domain_conf).toBe(0.9);
      expect(c.emotion).toBe(null);
      expect(c.emotion_conf).toBe(0);
      expect(c.overall_conf).toBe(0);
    });

    it("ignores rows from an unknown set", () => {
      const bogus = [{ setKind: "bogus", label: "x", sim: 0.99 } as unknown as ExemplarMatch];
      expect(composeClassification(bogus, null, T)).toEqual(D7Fallback());
    });

    it("clamps similarities into the documented 0..1 range", () => {
      const c = composeClassification(
        [m("domain", "Fitness", -0.2), m("emotion", "proud", 1.4)],
        null,
        T,
      );
      expect(c.domain_conf).toBe(0);
      expect(c.emotion_conf).toBe(1);
      expect(c.overall_conf).toBe(0);
    });
  });

  it("is deterministic and independent of the RPC's row order, even on a tie", () => {
    const a = [
      m("domain", "Fitness", 0.9),
      m("domain", "Career", 0.9),
      m("emotion", "proud", 0.8),
      m("emotion", "exhausted", 0.75),
      m("quit_signal", "quit", 0.4),
    ];
    const shuffled = [a[4], a[2], a[0], a[3], a[1]];

    const first = composeClassification(a, null, T);
    const second = composeClassification(shuffled, null, T);
    expect(first).toEqual(second);
    expect(first.domain).toBe("Career"); // tie broken on the lower label
  });
});
