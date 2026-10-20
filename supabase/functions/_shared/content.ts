/**
 * supabase/functions/_shared/content.ts — BG-01 content validation & seeding core.
 *
 * Single source of truth for the content pipeline, shared by:
 *   - content/validate.ts            (repo-side Deno CLI gate — BG-01 Step 1)
 *   - supabase/functions/content-seed (seeding pipeline — BG-01 Steps 2–3)
 *
 * Pure logic only — no I/O — so the AGENTS §8.4 gate (schema, enums, priority
 * range, near-duplicate detection) is enforced identically at authoring time
 * and at seed time. TECH-SPECS §3.3 schemas; BG-02 approved domain enum.
 */

// ---------------------------------------------------------------------------
// Enums & constants
// ---------------------------------------------------------------------------

/**
 * Approved 16-domain enum — §3.3 canonical set, signed off by the owner's BG-02
 * decision (2026-10-20, Option 1; `docs/feature-prds/FP-BG/BG-02-domain-enum-memo.md`).
 * Canonical strings match the shipped system (rules tagging, placeholder corpus,
 * golden set, config). The memo's Option 2 set (mind…habits) is not adopted; rules
 * drafted against it are pending a re-tag pass (BG-03 follow-up), so `rules.csv`
 * does not yet clear this gate.
 */
export const DOMAIN_ENUM = new Set([
  "Career",
  "Finance",
  "Fitness",
  "Health",
  "Learning",
  "Creativity",
  "Relationships",
  "Family",
  "Social",
  "Mental/Emotional",
  "Spirituality",
  "Discipline/Habits",
  "Communication",
  "Environment/Home",
  "Recreation",
  "Purpose/Legacy",
]);

export const TONE_ENUM = new Set(["aggressive", "empathetic", "neutral"]);
export const SET_KIND_ENUM = new Set(["domain", "emotion", "quit_signal"]);
export const STATUS_ENUM = new Set(["draft", "approved"]);

export const PRIORITY_MIN = 1;
export const PRIORITY_MAX = 100;
export const NEAR_DUP_THRESHOLD = 0.85;

/** Frozen embedding identity (D5) — stamped on every seeded row. */
export const EMBED_MODEL = "gemini-embedding-001@768";

/**
 * Fixed RFC-4122 namespace for deterministic content ids. uuidV5("r_mind_01")
 * always yields the same uuid, so re-seeding upserts instead of duplicating
 * (BG-01 idempotency; rules.id / exemplars.id have no DB default).
 */
export const CONTENT_NAMESPACE = "0dab05f2-9c1e-4a5e-9e3b-2f6a1d8c4e77";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CsvRow = Record<string, string>;
export type ErrorEntry = { row: number; field: string; message: string };

// ---------------------------------------------------------------------------
// CSV (RFC-4180: quoted fields, embedded commas/newlines, doubled quotes)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const rows: CsvRow[] = [];
  let current = "";
  let inQuotes = false;
  let header: string[] | null = null;
  let fieldCount = 0;
  let rowFields: string[] = [];

  function flushField() {
    rowFields.push(current);
    current = "";
  }

  function flushRow() {
    flushField();
    if (header === null) {
      header = rowFields;
    } else {
      const row: CsvRow = {};
      for (let j = 0; j < header.length; j++) {
        row[header[j]] = j < rowFields.length ? rowFields[j] : "";
      }
      rows.push(row);
    }
    rowFields = [];
    fieldCount = 0;
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      flushField();
    } else if (ch === "\r") {
      // skip carriage return; line break handled by \n
    } else if (ch === "\n") {
      flushRow();
    } else {
      current += ch;
    }
  }
  // Flush any trailing row not terminated by newline.
  if (current.length > 0 || rowFields.length > 0) {
    flushRow();
  }

  if (header === null) {
    return { header: [], rows: [] };
  }
  return { header, rows };
}

export function requiredColumnsPresent(header: readonly string[], required: readonly string[]): string[] {
  const missing: string[] = [];
  for (const col of required) {
    if (!header.includes(col)) missing.push(col);
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Near-duplicate detection (word-level Jaccard)
// ---------------------------------------------------------------------------

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 1;
  return intersection.size / union.size;
}

// ---------------------------------------------------------------------------
// Row validators (identical semantics to the original content/validate.ts)
// ---------------------------------------------------------------------------

export function validateRuleRows(rows: CsvRow[]): ErrorEntry[] {
  const errors: ErrorEntry[] = [];
  const seenIds = new Set<string>();
  const texts: { row: number; words: string[] }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +1 for header, +1 for 1-based
    const id = (row["id"] ?? "").trim();
    const text = (row["text"] ?? "").trim();
    const domain = (row["domain"] ?? "").trim();
    const sourceFigure = (row["source_figure"] ?? "").trim();
    const tone = (row["tone"] ?? "").trim();
    const priorityRaw = (row["priority"] ?? "").trim();
    const status = (row["status"] ?? "").trim();

    if (id === "") errors.push({ row: rowNum, field: "id", message: "missing id" });
    else if (seenIds.has(id)) errors.push({ row: rowNum, field: "id", message: `duplicate id "${id}"` });
    else seenIds.add(id);

    if (text === "") errors.push({ row: rowNum, field: "text", message: "missing text" });

    if (domain === "") errors.push({ row: rowNum, field: "domain", message: "missing domain" });
    else if (!DOMAIN_ENUM.has(domain)) {
      errors.push({ row: rowNum, field: "domain", message: `domain "${domain}" not in enum` });
    }

    if (sourceFigure === "") {
      errors.push({ row: rowNum, field: "source_figure", message: "missing source_figure" });
    }

    if (tone === "") errors.push({ row: rowNum, field: "tone", message: "missing tone" });
    else if (!TONE_ENUM.has(tone)) {
      errors.push({ row: rowNum, field: "tone", message: `tone "${tone}" not in enum` });
    }

    if (priorityRaw === "") {
      errors.push({ row: rowNum, field: "priority", message: "missing priority" });
    } else {
      const parsed = Number(priorityRaw);
      if (!Number.isInteger(parsed)) {
        errors.push({ row: rowNum, field: "priority", message: `priority "${priorityRaw}" is not an integer` });
      } else if (parsed < PRIORITY_MIN || parsed > PRIORITY_MAX) {
        errors.push({
          row: rowNum,
          field: "priority",
          message: `priority ${parsed} outside [${PRIORITY_MIN}, ${PRIORITY_MAX}]`,
        });
      }
    }

    if (status === "") errors.push({ row: rowNum, field: "status", message: "missing status" });
    else if (!STATUS_ENUM.has(status)) {
      errors.push({ row: rowNum, field: "status", message: `status "${status}" not in {draft, approved}` });
    }

    if (text !== "") {
      texts.push({ row: rowNum, words: normalizeWords(text) });
    }
  }

  // Near-duplicate detection within rules.
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const sim = jaccard(texts[i].words, texts[j].words);
      if (sim >= NEAR_DUP_THRESHOLD) {
        errors.push({
          row: texts[i].row,
          field: "text",
          message: `near-duplicate of row ${texts[j].row} (similarity ${sim.toFixed(2)})`,
        });
        errors.push({
          row: texts[j].row,
          field: "text",
          message: `near-duplicate of row ${texts[i].row} (similarity ${sim.toFixed(2)})`,
        });
      }
    }
  }

  return errors;
}

export function validateExemplarRows(rows: CsvRow[]): ErrorEntry[] {
  const errors: ErrorEntry[] = [];
  const seenIds = new Set<string>();
  const texts: { row: number; setKind: string; words: string[] }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const id = (row["id"] ?? "").trim();
    const setKind = (row["set_kind"] ?? "").trim();
    const label = (row["label"] ?? "").trim();
    const text = (row["text"] ?? "").trim();
    const status = (row["status"] ?? "").trim();

    if (id === "") errors.push({ row: rowNum, field: "id", message: "missing id" });
    else if (seenIds.has(id)) errors.push({ row: rowNum, field: "id", message: `duplicate id "${id}"` });
    else seenIds.add(id);

    if (setKind === "") errors.push({ row: rowNum, field: "set_kind", message: "missing set_kind" });
    else if (!SET_KIND_ENUM.has(setKind)) {
      errors.push({ row: rowNum, field: "set_kind", message: `set_kind "${setKind}" not in enum` });
    }

    if (label === "") errors.push({ row: rowNum, field: "label", message: "missing label" });

    if (text === "") errors.push({ row: rowNum, field: "text", message: "missing text" });

    if (status === "") errors.push({ row: rowNum, field: "status", message: "missing status" });
    else if (!STATUS_ENUM.has(status)) {
      errors.push({ row: rowNum, field: "status", message: `status "${status}" not in {draft, approved}` });
    }

    if (text !== "") {
      texts.push({ row: rowNum, setKind, words: normalizeWords(text) });
    }
  }

  // Near-duplicate detection within exemplars (also flags cross-set leakage candidates).
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const sim = jaccard(texts[i].words, texts[j].words);
      if (sim >= NEAR_DUP_THRESHOLD) {
        const leakage = texts[i].setKind !== texts[j].setKind ? " (cross-set leakage candidate)" : "";
        errors.push({
          row: texts[i].row,
          field: "text",
          message: `near-duplicate of row ${texts[j].row}${leakage}`,
        });
        errors.push({
          row: texts[j].row,
          field: "text",
          message: `near-duplicate of row ${texts[i].row}${leakage}`,
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Deterministic ids (uuid v5, RFC 4122 §4.3 — SHA-1 based)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/-/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function uuidV5(name: string, namespace: string = CONTENT_NAMESPACE): Promise<string> {
  const nsBytes = hexToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(nsBytes.length + nameBytes.length);
  data.set(nsBytes);
  data.set(nameBytes, nsBytes.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
