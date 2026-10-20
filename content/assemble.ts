/**
 * content/assemble.ts — BG-03 Step 1 assembler (Deno).
 *
 * Joins the frozen owner corpus (content/rules.json) with per-domain authoring
 * decisions (content/rules/{domain}.json) and the BG-03 canonical domain map
 * (content/rules/domain-map.json), then writes content/rules.csv in the
 * TECH-SPECS §3.3 row schema (id,text,domain,source_figure,tone,priority,status).
 *
 * Design rule: owner rule text/source/detail are NEVER hand-copied. They are
 * read verbatim from the frozen corpus at assembly time (index-joined per
 * domain, with length + label assertions), which prevents transcription drift
 * of owner content. Working files carry only authoring decisions (tone,
 * priority, optional per-rule status) plus agent-authored additions (added[]),
 * all `status=draft` until owner approval (AGENTS §8.4). Seeding is a separate
 * owner-gated act (BG-01 Step 3) — this script never seeds.
 *
 * Domain labels are applied at assembly time: the corpus keeps its frozen memo
 * taxonomy, while domain-map.json maps each stable rule id to the BG-02
 * Option 1 canonical §3.3 domain. Re-tagging never mutates owner text.
 *
 * Usage:
 *   deno run --allow-read --allow-write content/assemble.ts --scaffold   create missing working files
 *   deno run --allow-read content/assemble.ts --dry-run                  counts only, no write
 *   deno run --allow-read --allow-write content/assemble.ts              assemble + write rules.csv
 */

const CORPUS_DOMAINS = [
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
] as const; // frozen corpus taxonomy (memo set); not the output enum

const CANONICAL_DOMAINS = [
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
] as const; // BG-02 Option 1 canonical enum (TECH-SPECS §3.3)

const CANONICAL_DOMAIN_SET = new Set<string>(CANONICAL_DOMAINS);

const CORPUS_PATH = "content/rules.json";
const RULES_DIR = "content/rules";
const DOMAIN_MAP_PATH = "content/rules/domain-map.json";
const OUT_PATH = "content/rules.csv";

const TONE_ENUM = new Set(["aggressive", "empathetic", "neutral"]);
const STATUS_ENUM = new Set(["draft", "approved"]);

type CorpusRule = { text: string; source: string; detail?: string; isNew?: boolean };
type CorpusDomain = { id: string; label: string; rules: CorpusRule[] };
type Decision = { ref?: string; tone: string; priority: number; status?: string };
type AddedRule = { text: string; source_figure: string; tone: string; priority: number; status?: string };
type WorkingFile = {
  domain: string;
  label: string;
  source?: string;
  status: string;
  decisions: Decision[];
  added: AddedRule[];
};
type DomainMapFile = {
  meta?: { status?: string; decision?: string; note?: string };
  rules?: Record<string, string>;
};
type Row = {
  id: string;
  text: string;
  domain: string;
  source_figure: string;
  tone: string;
  priority: number;
  status: string;
};

function readJson(path: string): unknown {
  return JSON.parse(new TextDecoder().decode(Deno.readFileSync(path)));
}

function fail(msg: string): never {
  console.error(`ERROR: ${msg}`);
  Deno.exit(1);
}

/** RFC-4180 field: quote when required (or forced), doubling embedded quotes. */
function csvField(value: string | number, alwaysQuote = false): string {
  const s = String(value);
  const needs = alwaysQuote || /[",\r\n]/.test(s);
  return needs ? `"${s.replace(/"/g, '""')}"` : s;
}

function checkTone(tone: string, where: string): void {
  if (!TONE_ENUM.has(tone)) fail(`${where}: tone "${tone}" not in {aggressive, empathetic, neutral}`);
}

function checkPriority(priority: number, where: string): void {
  if (!Number.isInteger(priority) || priority < 1 || priority > 100) {
    fail(`${where}: priority ${priority} must be an integer in [1, 100]`);
  }
}

function checkStatus(status: string, where: string): void {
  if (!STATUS_ENUM.has(status)) fail(`${where}: status "${status}" must be "draft" or "approved"`);
}

function loadDomainMap(): Map<string, string> {
  const raw = readJson(DOMAIN_MAP_PATH) as DomainMapFile;
  if (!raw || typeof raw !== "object" || !raw.rules || typeof raw.rules !== "object") {
    fail(`${DOMAIN_MAP_PATH}: missing "rules" object`);
  }
  const map = new Map<string, string>();
  for (const [id, domain] of Object.entries(raw.rules)) {
    if (!id.trim()) fail(`${DOMAIN_MAP_PATH}: empty rule id`);
    if (!CANONICAL_DOMAIN_SET.has(domain)) {
      fail(`${DOMAIN_MAP_PATH}: "${id}" has domain "${domain}" outside the BG-02 canonical enum`);
    }
    map.set(id, domain);
  }
  if (map.size === 0) fail(`${DOMAIN_MAP_PATH}: no rule mappings`);
  return map;
}

/**
 * Build the full row plan (deterministic: corpus domain order, then corpus order, then added order).
 * A domain with zero decisions is "pending" — skipped (not an error) so batches can assemble
 * incrementally. A PARTIALLY decided domain is an authoring error and fails hard.
 */
function buildRows(corpus: { domains: CorpusDomain[] }): { rows: Row[]; pending: string[] } {
  const byId = new Map<string, CorpusDomain>();
  for (const d of corpus.domains) byId.set(d.id, d);
  const domainMap = loadDomainMap();

  for (const id of CORPUS_DOMAINS) {
    if (!byId.has(id)) fail(`corpus ${CORPUS_PATH} is missing corpus domain "${id}"`);
  }

  const rows: Row[] = [];
  const pending: string[] = [];

  for (const id of CORPUS_DOMAINS) {
    const corpusDomain = byId.get(id)!;
    const filePath = `${RULES_DIR}/${id}.json`;
    let working: WorkingFile;
    try {
      working = readJson(filePath) as WorkingFile;
    } catch {
      fail(`cannot read ${filePath} (run with --scaffold first)`);
    }
    if (working.domain !== id) fail(`${filePath}: "domain" is "${working.domain}", expected "${id}"`);
    if (working.label !== corpusDomain.label) {
      fail(`${filePath}: label "${working.label}" does not match corpus label "${corpusDomain.label}"`);
    }
    checkStatus(working.status, filePath);
    if (!Array.isArray(working.decisions)) fail(`${filePath}: "decisions" must be an array`);
    if (working.decisions.length === 0) {
      pending.push(id);
      continue;
    }
    if (working.decisions.length !== corpusDomain.rules.length) {
      fail(
        `${filePath}: ${working.decisions.length} decision(s) for ${corpusDomain.rules.length} corpus rule(s) — ` +
          `decisions are index-joined to corpus order and the counts must match`,
      );
    }

    corpusDomain.rules.forEach((rule, i) => {
      const d = working.decisions[i];
      const where = `${filePath} decisions[${i}] (corpus: "${rule.text.slice(0, 50)}…")`;
      if (d.ref !== undefined && !rule.text.startsWith(d.ref)) {
        fail(
          `${where}: ref "${d.ref}" does not match corpus rule text — decisions are order-joined; ` +
            `fix the ref or the decision order`,
        );
      }
      checkTone(d.tone, where);
      checkPriority(d.priority, where);
      if (d.status !== undefined) checkStatus(d.status, where);
      const ruleId = `${id}_${String(i + 1).padStart(2, "0")}`;
      const canonical = domainMap.get(ruleId);
      if (!canonical) fail(`${DOMAIN_MAP_PATH} is missing a mapping for "${ruleId}"`);
      rows.push({
        id: ruleId,
        text: rule.text,
        domain: canonical,
        source_figure: rule.source,
        tone: d.tone,
        priority: d.priority,
        status: d.status ?? working.status,
      });
    });

    (working.added ?? []).forEach((a, i) => {
      const where = `${filePath} added[${i}]`;
      if (!a.text || !a.text.trim()) fail(`${where}: added rule has empty text`);
      if (!a.source_figure || !a.source_figure.trim()) fail(`${where}: added rule has empty source_figure`);
      checkTone(a.tone, where);
      checkPriority(a.priority, where);
      if (a.status !== undefined) checkStatus(a.status, where);
      const addedId = `${id}_${String(corpusDomain.rules.length + i + 1).padStart(2, "0")}`;
      const canonical = domainMap.get(addedId);
      if (!canonical) fail(`${DOMAIN_MAP_PATH} is missing a mapping for "${addedId}"`);
      rows.push({
        id: addedId,
        text: a.text,
        domain: canonical,
        source_figure: a.source_figure,
        tone: a.tone,
        priority: a.priority,
        status: a.status ?? working.status,
      });
    });
  }

  if (pending.length === 0) {
    const seen = new Set(rows.map((r) => r.id));
    const unused = [...domainMap.keys()].filter((id) => !seen.has(id));
    if (unused.length > 0) fail(`${DOMAIN_MAP_PATH}: unused mapping(s): ${unused.join(", ")}`);
  }

  return { rows, pending };
}

function figureNames(rows: Row[]): Set<string> {
  const names = new Set<string>();
  for (const r of rows) {
    for (const part of r.source_figure.split(",")) {
      const name = part.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

function printSummary(rows: Row[], perDomain: Map<string, number>): void {
  console.log("Per-domain rule counts (canonical §3.3):");
  for (const id of CANONICAL_DOMAINS) console.log(`  ${id.padEnd(18)} ${perDomain.get(id) ?? 0}`);
  console.log(`TOTAL rules:   ${rows.length}`);
  console.log(`Distinct source entries: ${new Set(rows.map((r) => r.source_figure)).size}`);
  console.log(`Distinct figure names (comma-split): ${figureNames(rows).size}`);
  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  console.log(`By status: ${[...byStatus].map(([s, n]) => `${s}=${n}`).join(", ")}`);
}

// ---- modes -----------------------------------------------------------------

const mode = Deno.args[0] ?? "";
const corpus = readJson(CORPUS_PATH) as { domains: CorpusDomain[] };

if (mode === "--scaffold") {
  let created = 0;
  for (const id of CORPUS_DOMAINS) {
    const corpusDomain = corpus.domains.find((d) => d.id === id);
    if (!corpusDomain) fail(`corpus is missing corpus domain "${id}"`);
    const filePath = `${RULES_DIR}/${id}.json`;
    try {
      Deno.statSync(filePath);
      continue; // never overwrite an existing working file
    } catch { /* missing — create */ }
    const scaffold = {
      domain: id,
      label: corpusDomain.label,
      source: `owner corpus ${CORPUS_PATH} (frozen); decisions index-joined to corpus rule order`,
      status: "draft",
      decisions: [] as Decision[],
      added: [] as AddedRule[],
    };
    Deno.writeTextFileSync(filePath, JSON.stringify(scaffold, null, 2) + "\n");
    created++;
  }
  console.log(`Scaffold: ${created} working file(s) created under ${RULES_DIR}/ (${CORPUS_DOMAINS.length - created} already present)`);
  Deno.exit(0);
}

const { rows, pending } = buildRows(corpus);
const perDomain = new Map<string, number>();
for (const r of rows) perDomain.set(r.domain, (perDomain.get(r.domain) ?? 0) + 1);

if (pending.length > 0) {
  console.log(`Pending (not yet drafted — skipped): ${pending.join(", ")}`);
}

if (mode === "--dry-run") {
  printSummary(rows, perDomain);
  Deno.exit(0);
}

if (rows.length === 0) {
  fail("refusing to write: 0 rules assembled (every domain is still pending — this would clobber content/rules.csv with a header-only file)");
}

if (pending.length > 0) {
  console.warn(`WARNING: ${pending.length} domain(s) still pending — rules.csv will contain drafted domains only until they land.`);
}

const lines = ["id,text,domain,source_figure,tone,priority,status"];
for (const r of rows) {
  lines.push(
    [
      csvField(r.id),
      csvField(r.text, true),
      csvField(r.domain),
      csvField(r.source_figure, true),
      csvField(r.tone),
      csvField(r.priority),
      csvField(r.status),
    ].join(","),
  );
}
Deno.writeTextFileSync(OUT_PATH, lines.join("\n") + "\n");
console.log(`Wrote ${OUT_PATH} (${rows.length} rows).`);
printSummary(rows, perDomain);
console.log("\nNext gate: deno run --allow-read content/validate.ts");
