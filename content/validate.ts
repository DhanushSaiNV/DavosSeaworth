/**
 * content/validate.ts — BG-01 Step 1 content validation (Deno CLI).
 *
 * Thin CLI over the shared validation core (supabase/functions/_shared/content.ts),
 * which is the single source of truth shared with the content-seed function —
 * the AGENTS §8.4 gate and the TECH-SPECS §3.3 schema are enforced identically
 * at authoring time and seed time.
 *
 * Validates content/rules.csv and content/exemplars.csv:
 *   - required columns present (schema)
 *   - domain ∈ approved enum (TECH-SPECS §3.3, per BG-02 decision memo)
 *   - tone ∈ {aggressive, empathetic, neutral}
 *   - priority integer in [1, 100]
 *   - source_figure / label non-empty
 *   - text non-empty
 *   - near-duplicate text detection within each file (Jaccard >= 0.85)
 *
 * Prints a per-row error report; exits non-zero if any row is invalid.
 * Usage: deno run --allow-read content/validate.ts
 */

import {
  parseCsv,
  requiredColumnsPresent,
  validateExemplarRows,
  validateRuleRows,
  type CsvRow,
  type ErrorEntry,
} from "../supabase/functions/_shared/content.ts";

function readText(path: string): string {
  const bytes = Deno.readFileSync(path);
  return new TextDecoder().decode(bytes);
}

function main(): void {
  const rulesPath = "content/rules.csv";
  const exemplarsPath = "content/exemplars.csv";

  let allErrors: ErrorEntry[] = [];
  const statusCounts = new Map<string, number>();

  for (const [path, required, validator] of [
    [rulesPath, ["id", "text", "domain", "source_figure", "tone", "priority", "status"], validateRuleRows] as const,
    [exemplarsPath, ["id", "set_kind", "label", "text", "status"], validateExemplarRows] as const,
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
    for (const row of rows as CsvRow[]) {
      const status = (row["status"] ?? "").trim();
      if (status) statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    }
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

  const statusSummary = [...statusCounts.entries()].map(([s, n]) => `${s}=${n}`).join(", ");
  console.log(`\nValidation PASSED — all rows valid (status: ${statusSummary}).`);
}

main();
