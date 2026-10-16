// lib/journal/strip.ts
// Pure client-side Unsavable strip (BG-10 Step 1).
//
// Block model: blocks are paragraphs separated by one or more blank lines
// (a single newline stays INSIDE a block). Whitespace-only runs between
// blocks are separators, never blocks. Carriage returns are treated as plain
// whitespace — CRLF input is handled without a separate code path.
//
// Contract:
//   - splitBlocks(raw) → blocks with exact source spans (offsets into raw).
//   - stripUnsavable(raw, flaggedTexts) → flagged blocks removed, INCLUDING one
//     adjacent separator, so no orphan blank lines remain. Everything surviving
//     is byte-identical to the original (no whitespace normalization).
//   - Flag keying is by exact block text (owner decision): it survives edits
//     ABOVE a block (unlike index keying). Duplicate identical blocks flag
//     together — accepted beta trade-off, documented here.
//   - A flagged block whose text was edited detaches (exact match fails) —
//     predictable, never silent: edited text is treated as a NEW block.
//   - Empty result: all blocks flagged → "".
//
// Trace: D3; TECH-SPECS §7.4, §10.2. No React, no Supabase imports — pure.

export interface Block {
  /** Exact block text (no surrounding separator). */
  text: string;
  /** Offset of the first block character in the raw string. */
  start: number;
  /** Offset one past the last block character in the raw string. */
  end: number;
}

/** Find the next newline index at or after `from`; returns raw.length if none. */
function indexOfNewline(raw: string, from: number): number {
  const i = raw.indexOf("\n", from);
  return i === -1 ? raw.length : i;
}

/**
 * Split raw text into paragraph blocks separated by blank lines.
 * A "blank line" is a line containing only whitespace (<2 chars of non-newline
 * content... precisely: zero non-whitespace characters). Lines with ANY visible
 * character keep the block going — single newlines stay inside the block.
 */
export function splitBlocks(raw: string): Block[] {
  const blocks: Block[] = [];
  const n = raw.length;
  let i = 0;

  while (i < n) {
    // Skip blank lines (lines with no visible characters).
    let j = i;
    while (j < n) {
      const nl = indexOfNewline(raw, j);
      const line = raw.slice(j, nl);
      if (line.trim() === "") {
        j = nl + 1; // consume the newline too (or land on n if none)
      } else {
        break;
      }
    }
    if (j >= n) break;

    // j is the start of a line with visible content → block begins.
    const start = j;
    // Consume lines until a blank line or end of input.
    let end = j;
    while (j < n) {
      const nl = indexOfNewline(raw, j);
      const line = raw.slice(j, nl);
      if (line.trim() === "") break; // blank line ends the block (not consumed)
      end = nl; // block currently ends at the newline (excluded below)
      j = nl + 1;
    }
    blocks.push({ text: raw.slice(start, end), start, end });
    i = j;
  }

  return blocks;
}

/** Offsets of any run of blank lines: [sepStart, sepEnd) in raw coordinates. */
interface Span {
  start: number;
  end: number;
}

/**
 * Remove flagged blocks from raw text. Flag matching is exact block-text
 * equality against `flaggedTexts`. For each removed block the ONE adjacent
 * separator is also removed (preferring the separator AFTER the block, else
 * the one before it) so the survivors join without orphan blank lines.
 * Survivors are byte-identical to the original — nothing is reflowed.
 */
export function stripUnsavable(raw: string, flaggedTexts: ReadonlySet<string> | readonly string[]): string {
  const flagged = flaggedTexts instanceof Set ? flaggedTexts : new Set(flaggedTexts);
  if (flagged.size === 0 || raw === "") return raw;

  const blocks = splitBlocks(raw);
  if (blocks.length === 0) return raw;

  const removed = blocks.filter((b) => flagged.has(b.text));
  if (removed.length === 0) return raw;
  if (removed.length === blocks.length) return "";

  type Removal = Span;
  const removals: Removal[] = [];

  for (const b of removed) {
    const bi = blocks.indexOf(b);
    const hasNext = bi + 1 < blocks.length;
    const hasPrev = bi - 1 >= 0;

    if (hasNext) {
      // Block + separator AFTER it: from this block start to next block start.
      removals.push({ start: b.start, end: blocks[bi + 1].start });
    } else if (hasPrev) {
      // Last block: separator BEFORE it — from previous block end to this end.
      removals.push({ start: blocks[bi - 1].end, end: b.end });
    } else {
      // Only one block and it was removed — handled above; unreachable.
      removals.push({ start: b.start, end: b.end });
    }
  }

  // Merge overlapping/adjacent removals (consecutive flagged blocks share
  // the separator span, e.g. remove [end1→start2] and [end2→start3]).
  removals.sort((a, b) => a.start - b.start);
  const merged: Removal[] = [];
  for (const r of removals) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  // Splice from the end so earlier offsets stay valid.
  let out = raw;
  for (let k = merged.length - 1; k >= 0; k--) {
    out = out.slice(0, merged[k].start) + out.slice(merged[k].end);
  }
  return out;
}

/** Convenience: number the blocks a UI list would show ("N of M will be sent"). */
export function stripSummary(raw: string, flaggedTexts: ReadonlySet<string> | readonly string[]): {
  total: number;
  flagged: number;
  sent: number;
  stripped: string;
} {
  const blocks = splitBlocks(raw);
  const flagged = flaggedTexts instanceof Set ? flaggedTexts : new Set(flaggedTexts);
  const flaggedCount = blocks.filter((b) => flagged.has(b.text)).length;
  return {
    total: blocks.length,
    flagged: flaggedCount,
    sent: blocks.length - flaggedCount,
    stripped: stripUnsavable(raw, flagged),
  };
}
