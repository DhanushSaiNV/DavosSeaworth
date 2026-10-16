/**
 * content/validate.ts — BG-01 Step 1 content validation (Deno).
 *
 * Validates content/rules.csv and content/exemplars.csv against the schemas in
 * TECH-SPECS §3.3 plus the `status` draft/approval column (AGENTS §8.4).
 *
 * Checks per row:
 *   - required columns present (schema)
 *   - domain ∈ enum (approved 16 from TECH-SPECS §3.3, per BG-02 decision memo)
 *   - tone ∈ {aggressive, empathetic, neutral}
 *   - priority integer in [1, 100]
 *   - source_figure / label non-empty
 *   - text non-empty
 *   - near-duplicate text detection within each file (Jaccard >= 0.85)
 *
 * Prints a per-row error report; exits non-zero if any row is invalid.
 * Usage: deno run content/validate.ts
 */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

const DOMAIN_ENUM = new Set([
  "mind",
  "mastery",
  "strategy",
  "wealth",
  "health",
  "character",
  "relationships",
  "creativity",
  "resilience",
  "purpose",
  "spirituality",
  "time",
  "communication",
  "learning",
  "leadership",
  "habits",
]);

const TONE_ENUM = new Set(["aggressive", "empathetic", "neutral"]);
const SET_KIND_ENUM = new Set(["domain", "emotion", "quit_signal"]);
const STATUS_ENUM = new Set(["draft", "approved"]);

const PRIORITY_MIN = 1;
const PRIORITY_MAX = 100;
const NEAR_DUP_THRESHOLD = 0.85;

type ErrorEntry = { row: number; field: string; message: string };
type CsvRow = Record<string, string>;

function readText(path: string): string {
  const bytes = Deno.readFileSync(path);
  return DECODER.decode(bytes);
}

/**
 * Minimal RFC-4180 CSV parser. Handles quoted fields, embedded commas, and
 * doubled quotes ("") inside quoted fields. No external dependencies.
 */
function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
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
    } else {
      if (ch === '"') {
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

function requiredColumnsPresent(header: string[], required: string[]): string[] {
  const missing: string[] = [];
  for (const col of required) {
    if (!header.includes(col)) missing.push(col);
  }
  return missing;
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 1;
  return intersection.size / union.size;
}

function validateRules(rows: CsvRow[]): ErrorEntry[] {
  const errors: ErrorEntry[] = [];
  const required = ["id", "text", "domain", "source_figure", "tone", "priority", "status"];

  // Schema check on header is done by caller; here validate each row.
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

function validateExemplars(rows: CsvRow[]): ErrorEntry[] {
  const errors: ErrorEntry[] = [];
  const required = ["id", "set_kind", "label", "text", "status"];

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

function main(): void {
  const rulesPath = "content/rules.csv";
  const exemplarsPath = "content/exemplars.csv";

  let allErrors: ErrorEntry[] = [];

  for (const [path, required, validator] of [
    [rulesPath, ["id", "text", "domain", "source_figure", "tone", "priority", "status"], validateRules] as const,
    [exemplarsPath, ["id", "set_kind", "label", "text", "status"], validateExemplars] as const,
  ]) {
    let text: string;
    try {
      text = readText(path);
    } catch {
      console.error(`ERROR: cannot read ${path}`);
      Deno.exit(1);
    }

    const { header, rows } = parseCsv(text);
    const missing = requiredColumnsPresent(header, required);
    if (missing.length > 0) {
      console.error(`ERROR: ${path} missing required columns: ${missing.join(", ")}`);
      console.error(`  header found: ${header.join(", ")}`);
      Deno.exit(1);
    }

    const errors = validator(rows);
    allErrors = allErrors.concat(errors);
    if (errors.length > 0) {
      console.error(`\n${path}: ${errors.length} validation error(s):`);
      for (const e of errors) {
        console.error(`  row ${e.row} [${e.field}]: ${e.message}`);
      }
    } else {
      console.log(`${path}: OK (${rows.length} row(s))`);
    }
  }

  if (allErrors.length > 0) {
    console.error(`\nTOTAL: ${allErrors.length} error(s). Validation FAILED.`);
    Deno.exit(1);
  }

  console.log("\nValidation PASSED — all rows valid, all status=draft.");
}

main();
