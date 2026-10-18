// lib/journal/strip.test.ts
// Unit tests for the pure Unsavable strip (no React Native involved).
// Refs: BG-10 Step 1; D3; TECH-SPECS §7.4, §10.2.

import { splitBlocks, stripSummary, stripUnsavable } from "./strip";

describe("splitBlocks", () => {
  test("single block, no separators", () => {
    const blocks = splitBlocks("hello world");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ text: "hello world", start: 0, end: 11 });
  });

  test("two blocks joined by one blank line", () => {
    const blocks = splitBlocks("one\n\ntwo");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ text: "one", start: 0, end: 3 });
    expect(blocks[1]).toEqual({ text: "two", start: 5, end: 8 });
  });

  test("single newline stays INSIDE a block", () => {
    const blocks = splitBlocks("line one\nline two\n\nnext");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("line one\nline two");
  });

  test("leading / trailing / multiple blank lines are separators, not blocks", () => {
    const blocks = splitBlocks("\n\n  \nfirst\n\n\n\nsecond\n\n");
    expect(blocks.map((b) => b.text)).toEqual(["first", "second"]);
  });

  test("whitespace-only input yields zero blocks", () => {
    expect(splitBlocks("  \n\t\n ")).toEqual([]);
    expect(splitBlocks("")).toEqual([]);
  });

  test("spans slice back to exact block text", () => {
    const raw = "alpha\nbeta\n\n  gamma  \n\n\tdelta";
    for (const b of splitBlocks(raw)) {
      expect(raw.slice(b.start, b.end)).toBe(b.text);
    }
  });

  test("CRLF input splits the same", () => {
    const blocks = splitBlocks("one\r\n\r\ntwo\r\n");
    expect(blocks.map((b) => b.text)).toEqual(["one\r", "two\r"]);
  });
});

describe("stripUnsavable", () => {
  test("no flags → input returned unchanged (same value)", () => {
    const raw = "a\n\nb\n\nc";
    expect(stripUnsavable(raw, new Set())).toBe(raw);
    expect(stripUnsavable(raw, [])).toBe(raw);
  });

  test("unmatched flag → unchanged", () => {
    const raw = "a\n\nb";
    expect(stripUnsavable(raw, new Set(["zzz"]))).toBe(raw);
  });

  test("flagged middle block removes block + following separator", () => {
    expect(stripUnsavable("a\n\nb\n\nc", new Set(["b"]))).toBe("a\n\nc");
  });

  test("flagged first block removes block + following separator", () => {
    expect(stripUnsavable("a\n\nb\n\nc", new Set(["a"]))).toBe("b\n\nc");
  });

  test("flagged last block removes preceding separator + block", () => {
    expect(stripUnsavable("a\n\nb\n\nc", new Set(["c"]))).toBe("a\n\nb");
  });

  test("consecutive flagged blocks leave no orphan blank lines", () => {
    expect(stripUnsavable("a\n\nb\n\nc\n\nd", new Set(["b", "c"]))).toBe("a\n\nd");
  });

  test("survivors are byte-identical (no whitespace normalization)", () => {
    const raw = "  spaced\tout  \nline two\n\n\n\tindented\n\ntrail   ";
    const out = stripUnsavable(raw, new Set(["\tindented"]));
    // The two-blank-line separator before the removed block survives verbatim.
    expect(out).toBe("  spaced\tout  \nline two\n\n\ntrail   ");
  });

  test("multi-blank-line separators collapse correctly", () => {
    expect(stripUnsavable("a\n\n\n\nb\n\nc", new Set(["b"]))).toBe("a\n\n\n\nc");
  });

  test("all blocks flagged → empty string", () => {
    expect(stripUnsavable("a\n\nb", new Set(["a", "b"]))).toBe("");
    expect(stripUnsavable("solo", new Set(["solo"]))).toBe("");
  });

  test("empty input → empty output", () => {
    expect(stripUnsavable("", new Set(["x"]))).toBe("");
  });

  test("accepts a plain array as well as a Set", () => {
    expect(stripUnsavable("a\n\nb", ["a"])).toBe("b");
  });

  test("edited flagged text detaches (treated as a new block)", () => {
    // Flag was set on "word", but the text is now "word!".
    expect(stripUnsavable("word!", new Set(["word"]))).toBe("word!");
  });

  test("duplicate identical blocks flag together", () => {
    expect(stripUnsavable("same\n\nsame", new Set(["same"]))).toBe("");
  });

  test("unicode content survives verbatim", () => {
    const raw = "héllo wörld 🌙\n\nkeep mé 😴\n\nbye";
    expect(stripUnsavable(raw, new Set(["bye"]))).toBe("héllo wörld 🌙\n\nkeep mé 😴");
  });

  test("CRLF: flagged block removal keeps survivors intact", () => {
    const out = stripUnsavable("one\r\n\r\ntwo\r\n\r\nthree", new Set(["two\r"]));
    expect(out).toBe("one\r\n\r\nthree");
  });
});

describe("stripSummary", () => {
  test("counts total/flagged/sent and returns the stripped text", () => {
    const s = stripSummary("a\n\nb\n\nc", new Set(["b"]));
    expect(s).toEqual({ total: 3, flagged: 1, sent: 2, stripped: "a\n\nc" });
  });

  test("unflagged flags count zero against the total", () => {
    const s = stripSummary("a\n\nb", new Set(["zzz"]));
    expect(s.total).toBe(2);
    expect(s.flagged).toBe(0);
    expect(s.sent).toBe(2);
  });
});

describe("preview pipeline (Step 3 — the exact functions the journal screen drives)", () => {
  // The screen renders: splitBlocks(raw) for the review list, and
  // stripSummary(raw, flaggedSet) for the preview panel + count line.
  // This fixture pins both ends so the preview can never drift from the tests.
  const FIXTURE = "Morning pages: slept badly.\n\nPrivate: do NOT send this.\n\nPlan: gym at six.";
  const FLAGGED = new Set(["Private: do NOT send this."]);

  test("review list shows all three blocks", () => {
    expect(splitBlocks(FIXTURE).map((b) => b.text)).toEqual([
      "Morning pages: slept badly.",
      "Private: do NOT send this.",
      "Plan: gym at six.",
    ]);
  });

  test("preview panel shows the stripped text with the sent/total counts", () => {
    const s = stripSummary(FIXTURE, FLAGGED);
    expect(s.total).toBe(3);
    expect(s.sent).toBe(2);
    expect(s.stripped).toBe("Morning pages: slept badly.\n\nPlan: gym at six.");
  });
});
