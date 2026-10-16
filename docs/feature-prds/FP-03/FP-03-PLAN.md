# FP-03-PLAN — Implementation Plan: Real Classifier

**Feature PRD:** `docs/feature-prds/FP-03.md`
**Spec:** TECH-SPECS §6 (classifier contract), §6.3 (output shape), §14 step 4
**Decisions:** D2 (execution paths), D4 (pipeline + tiers), D13 (guardrails), D18 (providers), D19 (classifier)
**Branch / worktree:** `fp/03-real-classifier` cut from `main`; one worktree per agent session (AGENTS.md git model); on the second merge conflict, park the branch and log it
**Estimate:** 7 focused solo-dev sessions (S1–S7 below)
**Ship strategy:** merge dark (`classifier.mode = 'stub'`) → backfill → golden-set eval → calibrate → flip to `'real'`

> **Note on reconciliation:** this sandbox lost the prior `docs/` tree; wherever this plan touches an FP-01/FP-02 artifact (jobs API shape, §6.3 field names, metrics location), the merged repo is the source of truth. Appendix B lists every such point explicitly.

---

## Phase 0 — Preflight (before S1)

| # | Check | Pass condition |
|---|---|---|
| P-01 | FP-02 merged on `main`; stage-2 stub reachable where FP-02-PLAN put it | pipeline test suite green on `main` |
| P-02 | pgvector available on the Supabase project | `select * from pg_extension where extname = 'vector'` returns a row (if not, Migration 0007 creates it) |
| P-03 | Provider adapter exposes an embeddings path | if FP-02 shipped chat-only, `embedBatch` is added in Phase 3 (planned here) |
| P-04 | Config helper from FP-01 available in `_shared` | `classifier.*` keys readable with defaults |
| P-05 | Worktree created | `git worktree add ../davos-fp03 -b fp/03-real-classifier main` |
| P-06 | Gemini embedding quota verified in AI Studio console | free-tier RPD/RPM for `gemini-embedding-001` recorded in the worklog (feeds R-07) |

---

## Phase 1 — Migration 0007: `classifier_exemplars` + config seeds (S1)

### 1.1 Migration file — `supabase/migrations/0007_classifier_exemplars.sql`

```sql
-- FP-03: exemplar store for the embedding-similarity classifier (D19)
create extension if not exists vector;

create table public.classifier_exemplars (
  id          uuid primary key default gen_random_uuid(),
  set_kind    text not null check (set_kind in ('domain','emotion','quit','false_constraint')),
  label       text not null,                                   -- domain slug / emotion name / 'quit' / 'false_constraint'
  text        text not null check (char_length(text) between 5 and 400),
  source      text not null default 'placeholder'
              check (source in ('placeholder','bg04_approved','calibration')),
  status      text not null default 'draft' check (status in ('draft','approved')),
  active      boolean not null default true,
  embedding   vector(768),                                     -- gemini-embedding-001, frozen per D18
  embedded_at timestamptz,
  metadata    jsonb not null default '{}'::jsonb,              -- e.g. {"bg04_batch": 1}
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (set_kind, label, text)
);

alter table public.classifier_exemplars enable row level security;
-- Intentionally NO policies: anon/authenticated get zero access.
-- Edge Functions run with the service role (bypasses RLS). (NFR-08)

create index classifier_exemplars_set_label_idx
  on public.classifier_exemplars (set_kind, label) where active;

-- No vector index at ~228 rows: a seq scan is faster than index traversal.
-- Revisit (HNSW, vector_cosine_ops) above ~1k active exemplars. (PRD Out-of-scope)

-- updated_at trigger: reuse the touch-trigger helper from earlier migrations
-- if one exists; otherwise create the standard one here.
```

### 1.2 Config seeds (append to the migration or the seed script used in FP-01)

| Key | Default | Purpose |
|---|---|---|
| `classifier.mode` | `'stub'` | stage-2 branch: `stub` \| `real` (FR-12; dark-ship) |
| `classifier.tier.high` | `0.75` | High tier floor (auto-adopt) |
| `classifier.tier.medium` | `0.55` | Medium tier floor (chips) |
| `classifier.tier.low` | `0.40` | Low tier floor (question) |
| `classifier.flag.quit` | `0.75` | quit flag cutoff |
| `classifier.flag.false_constraint` | `0.75` | false-constraint flag cutoff |
| `classifier.energy.floor` | `3` | energy ≤ floor → forced `exhausted` |
| `classifier.energy.ceiling` | `8` | energy ≥ ceiling → forced `determined` |
| `classifier.energy.conf_floor` | `0.75` | confidence floor for forced labels (FR-07; Appendix B) |
| `classifier.embedding.model` | `'gemini-embedding-001'` | frozen (D18) |
| `classifier.embedding.dims` | `768` | frozen (D18) |
| `classifier.embedding.task_type` | `'SEMANTIC_SIMILARITY'` | symmetric comparison (Appendix B) |
| `classifier.backfill.batch` | `50` | rows per backfill run |

### 1.3 Verification (run in SQL editor)

```sql
-- table + RLS
select relname, relrowsecurity from pg_class where relname = 'classifier_exemplars';            -- true
select count(*) from pg_policies where tablename = 'classifier_exemplars';                      -- 0
-- config seeded
select key, value from app_config where key like 'classifier.%';                                -- 13 rows (per FP-01 config table name)
```

**Exit criteria:** migration applies clean on a fresh branch database; P-02/P-04 verified; worklog updated.

---

## Phase 2 — Placeholder exemplars + seed script (S2)

### 2.1 Content files (DRAFT per AGENTS.md §8.4)

```
content/classifier-exemplars/
  placeholder.domains.json          # 16 labels × 10 items  (labels = canonical list, TECH-SPECS §6 / BG-02)
  placeholder.emotions.json         # 6 labels × 8 items
  placeholder.flags.json            # quit × 10, false_constraint × 10
  golden-set.json                   # 40 eval items (Phase 6; NOT seeded)
```

Item schema:

```json
{
  "set_kind": "domain",
  "label": "<domain-slug>",
  "text": "First-person, 1–2 sentences, 5–400 chars, clearly voiced for the label",
  "source": "placeholder",
  "status": "draft"
}
```

**Authoring rules (placeholders):**
1. First-person user voice — how a beta user would actually phrase it, not dictionary definitions.
2. One idea per item; no item that plausibly belongs to two labels (that's what golden-set *ambiguous* cases are for).
3. Vary length and register across a label's set (short vent / longer explanation / casual fragment).
4. **No leakage:** no placeholder text may appear verbatim in `golden-set.json`.
5. Domain slugs must match the TECH-SPECS §6 canonical list exactly (case-sensitive); when BG-02's memo lands, its enum wins (FR-02 keeps this data-only).

Samples (format reference — real set is authored in-session):

```json
[
  { "set_kind": "domain", "label": "<slug>", "text": "My manager rewrote my whole section of the report and put their name on it.", "source": "placeholder", "status": "draft" },
  { "set_kind": "emotion", "label": "exhausted", "text": "I honestly can't think about this anymore today. Everything in me is done.", "source": "placeholder", "status": "draft" },
  { "set_kind": "quit", "label": "quit", "text": "I'm done with this. I'm going to tell them I quit and I'm not coming back.", "source": "placeholder", "status": "draft" },
  { "set_kind": "false_constraint", "label": "false_constraint", "text": "I'd rest but I literally have no choice, there's no other option.", "source": "placeholder", "status": "draft" }
]
```

### 2.2 Seed script — `scripts/seed-exemplars.ts` (deno task)

- Reads the three `placeholder.*.json` files; upserts on `(set_kind, label, text)` (idempotent — re-running never duplicates, never overwrites embeddings of unchanged text).
- Refuses to run if `source = 'bg04_approved'` rows exist for the same `(set_kind, label)` unless `--force` is passed (protects the BG-04 swap).
- Runs with the service role from CI/local only — never exposed as an Edge Function.

**Exit criteria:** `select set_kind, count(*) from classifier_exemplars group by 1` returns ~160 / 48 / 10 / 10; all rows `source = 'placeholder'`, `status = 'draft'`, `embedding is null`.

---

## Phase 3 — Embedding backfill (S3)

### 3.1 Adapter: `embedBatch` (extend the FP-02 provider adapter)

```ts
// _shared/adapter additions — chat models unchanged (D18: Groq fallback is chat-only)
export interface EmbedConfig { model: string; dims: number; taskType: string; } // frozen: gemini-embedding-001 / 768 / SEMANTIC_SIMILARITY

// modes mirror FP-02: 'real' | 'stub' | 'fail'
// real:  Gemini batchEmbedContents — ONE request for the whole batch (quota-friendly)
// stub:  deterministic pseudo-vectors (hash of text, normalized) — tests get stable sims
// fail:  throws ProviderError — exercises the degradation path
export async function embedBatch(texts: string[], cfg: EmbedConfig): Promise<number[][]>;
export async function embed(text: string, cfg: EmbedConfig): Promise<number[]>; // single-item wrapper
```

**FR-05 hard rule:** exemplars (backfill) and messages (runtime) MUST construct their `EmbedConfig` from the same `classifier.embedding.*` config keys — one shared factory function, one test asserting both call sites use it (R-06).

### 3.2 Job handler — `exemplar_embed` (FP-01 jobs system)

```ts
// job-dispatcher: new case (lease/backoff/dead-letter semantics inherited from FP-01)
case 'exemplar_embed': {
  const batch = await db`
    select id, text from classifier_exemplars
    where active and embedding is null and embedded_at is null
    order by created_at limit ${cfg.backfill.batch}`;
  if (batch.length === 0) return JobResult.complete;          // idempotent drain (FR-04, AC-07)

  const vecs = await adapter.embedBatch(batch.map(r => r.text), embedCfg);

  await db`
    update classifier_exemplars e
    set embedding = v.emb, embedded_at = now(), updated_at = now()
    from (select unnest(${batch.map(r => r.id)}::uuid[]) as id,
                 unnest(${vecs}::float8[][]) ... ) v           -- write back per-row vectors
    where e.id = v.id`;

  const remaining = await db`select count(*) from classifier_exemplars
                             where active and embedding is null and embedded_at is null`;
  return remaining > 0 ? JobResult.reenqueue : JobResult.complete;
}
```

- **Enqueue:** `select jobs_enqueue('exemplar_embed', '{}'::jsonb);` (FP-01 jobs helper — see Appendix B for API-name reconciliation).
- **Partial failure:** if `embedBatch` throws, no rows are written; the job retries with backoff and dead-letters after the FP-01 threshold. Never a partial batch.
- **Quota ledger:** 228 texts ÷ batch 50 → **5 requests, one time** (batch API). Runtime: 1 request per user message. For 5 beta users this is noise (record actual quota in the worklog per P-06).

### 3.3 Verification

```sql
select set_kind, count(*) filter (where embedding is not null) as embedded,
       count(*) as total
from classifier_exemplars group by 1;   -- embedded = total per set
```

Re-enqueue once more → handler returns `complete` immediately (no-op). Flip adapter to `fail` mode → job retries then dead-letters; row count with embeddings unchanged.

**Exit criteria:** 228/228 embedded; idempotency + dead-letter behaviors observed; quota numbers logged.

## Phase 4 — Classification engine (S4)

### 4.1 Module — `supabase/functions/_shared/classifier/engine.ts`

```ts
// Drop-in for the FP-02 stage-2 stub. Output = the §6.3 classification block,
// field names reconciled 1:1 with the stub's (Appendix B) — the FP-02 contract
// test is the source of truth and must pass UNCHANGED (FR-11, AC-01).

export interface Classification {
  domain: string;                  // argmax over set_kind='domain'
  domain_conf: number;
  emotion: string;                 // argmax over set_kind='emotion', possibly energy-forced
  emotion_conf: number;
  emotion_forced: boolean;         // energy override fired (FR-07)
  energy: number;                  // passthrough from stage-1 extraction
  quit_flag: boolean;              // conf >= classifier.flag.quit (FR-10)
  quit_conf: number;
  false_constraint_flag: boolean;  // conf >= classifier.flag.false_constraint
  false_constraint_conf: number;
  overall_conf: number;            // min(domain_conf, emotion_conf)  (D19, FR-08)
  suggested_tier: 'high' | 'medium' | 'low' | 'inquirer';  // FR-09
  degraded: boolean;               // FR-13
  model: string;                   // 'gemini-embedding-001@768'
  exemplar_counts: Record<string, number>;  // audit: active exemplars seen per set
}

export async function classify(
  messageText: string,
  extraction: Extraction,           // stage-1 output (energy lives here)
  cfg: ClassifierConfig,           // assembled from classifier.* keys
): Promise<Classification> {
  // 0. Dev tier-forcer — FIRST, non-prod only (FR-14, AC-10)
  if (isDev && DEV_FORCE_TIER) return forcedTierResult(extraction, DEV_FORCE_TIER);

  // 1. Embed — one call, ONE bounded retry, no loops (D13, FR-13)
  let emb: number[];
  try {
    emb = await withBoundedRetry(() => adapter.embed(messageText, embedCfg));
  } catch (err) {
    log.warn('classifier.degraded', { err });
    metrics.increment('classifier_degraded_total');
    return degradedResult(extraction);   // overall_conf=0 → 'inquirer'; pipeline continues
  }

  // 2. Similarity — ONE SQL round trip, max cosine sim per (set_kind, label)
  const sims = await repo.bestSimPerLabel(emb);   // query below

  // 3. Argmax per set (labels are data — FR-02)
  const domain = argmax(sims, 'domain');
  let emotion = argmax(sims, 'emotion');
  let forced = false;

  // 4. Energy override (D19, FR-07, AC-03)
  if (extraction.energy <= cfg.energyFloor)       { emotion = labelResult(sims, 'emotion', 'exhausted', cfg); forced = true; }
  else if (extraction.energy >= cfg.energyCeiling){ emotion = labelResult(sims, 'emotion', 'determined', cfg); forced = true; }
  // labelResult: conf = max(best similarity of that label, cfg.energyConfFloor)

  // 5. Compose + flags + tier
  const overall = Math.min(domain.conf, emotion.conf);          // FR-08
  return {
    domain: domain.label, domain_conf: domain.conf,
    emotion: emotion.label, emotion_conf: emotion.conf, emotion_forced: forced,
    energy: extraction.energy,
    quit_flag: best(sims, 'quit') >= cfg.flagQuit,
    quit_conf: best(sims, 'quit'),
    false_constraint_flag: best(sims, 'false_constraint') >= cfg.flagFalseConstraint,
    false_constraint_conf: best(sims, 'false_constraint'),
    overall_conf: overall,
    suggested_tier: tierOf(overall, cfg),   // >=0.75 high; >=0.55 medium; >=0.40 low; else inquirer
    degraded: false, model: embedCfg.modelTag,
    exemplar_counts: countsBySet(sims),
  };
}
```

### 4.2 Similarity query (single round trip)

```sql
-- repo.bestSimPerLabel(emb)
select e.set_kind, e.label,
       max(1 - (e.embedding <=> $1::vector)) as conf,   -- cosine similarity, pgvector
       count(*) as n
from public.classifier_exemplars e
where e.active and e.embedding is not null
group by e.set_kind, e.label;
-- ~228 rows × 768 dims: sub-millisecond; result filtered/argmaxed in TS.
-- Calibration option (deferred): top-k mean via lateral join if R-01 noise appears.
```

### 4.3 Degraded result (FR-13)

`degradedResult` returns the §6.3 shape with: `domain = null`-per-§6.3-representation, `overall_conf = 0`, `suggested_tier = 'inquirer'`, `degraded = true`, flags false. **`send-message` always proceeds to generation** — the user always gets a reply; persona determination falls back to inquirer mode (already exercised by FP-02's degrade path for `llm_retry`).

### 4.4 Tests (unit + contract)

| ID | Case | Expected |
|---|---|---|
| U-01 | Stub-mode embeddings, one-hot per label | exact argmax picks the intended domain and emotion |
| U-02 | `energy = 2`, similarity favors another emotion | emotion = `exhausted`, `emotion_forced = true`, conf ≥ `energy.conf_floor` |
| U-03 | `energy = 9` | emotion = `determined`, forced |
| U-04 | domain_conf 0.8, emotion_conf 0.6 | `overall_conf = 0.6` (min rule) |
| U-05 | overall 0.75 / 0.749 / 0.55 / 0.549 / 0.40 / 0.399 | tiers high / medium / medium / low / low / inquirer (boundary-exact) |
| U-06 | quit sim 0.76 vs cutoff 0.75 | `quit_flag = true`; sim 0.74 → false |
| U-07 | Adapter in `fail` mode | exactly 2 attempts (1 + 1 retry), then degraded result; no further calls |
| U-08 | Both embed call sites (backfill + engine) | use the SAME `EmbedConfig` factory object (R-06) |
| C-01 | §6.3 contract test from FP-02 | passes unchanged against engine output (FR-11) |
| C-02 | `DEV_FORCE_TIER` × 4 values | each tier forced in dev; ignored in prod build |

**Exit criteria:** U-01…U-08, C-01, C-02 green; stage-2 still runs the stub end-to-end on `main`- parity config.

---

## Phase 5 — Pipeline integration (S5)

### 5.1 `send-message` stage 2 — the swap

```ts
// stage 2: classify
const mode = await config.get('classifier.mode');        // cached per invocation
const classification =
  mode === 'real'
    ? await engine.classify(messageText, extraction, classifierCfg)
    : stubClassify(messageText, extraction);             // FP-02 stub, byte-for-byte unchanged
// persist where FP-02 persisted the stub block (message row / classifications table
// per FP-02-PLAN) + server-only per-label sims for audit (NFR-07)
```

- **Stage 3 (rule retrieval):** filter rules by `classification.domain` — replaces the stub's default domain; conflict filter untouched (FR-15).
- **Stage 4 (persona determination):** consume real `suggested_tier` / `overall_conf` → auto-adopt (high) / chips (medium) / question (low) / inquirer — behavior definitions unchanged from FP-02; only the signal becomes real.
- **Metrics (FR-17):** `classifier_stage_ms` (histogram), `tier_total{tier}` (counter), `classifier_degraded_total` — same sink FP-02 uses for stage metrics.

### 5.2 Integration tests

| ID | Case | Expected |
|---|---|---|
| I-01 | `mode=real` + stub embeddings + medium-conf fixture | persona chips appear; stage 3 pulled the classified domain's rules |
| I-02 | `mode=real` + high-conf fixture | auto-adopt path; `auto_adopt_successes` increments (FP-02 table) |
| I-03 | `mode=real` + adapter `fail` | full pipeline completes; reply generated; inquirer persona; degraded metric +1 |
| I-04 | `mode=stub` after all of the above | FP-02 test suite green — rollback proven (AC-06) |

**Exit criteria:** I-01…I-04 green in CI; no stage-3/4 code touched beyond wiring the real values.

---

## Phase 6 — Golden set + calibration (S6)

### 6.1 `content/classifier-exemplars/golden-set.json` — 40 items, composition:

| Case type | Count | Asserts |
|---|---|---|
| clear-domain (one per sampled domain, no overlap) | 12 | domain correct |
| ambiguous (plausibly two domains) | 8 | domain ∈ top-2 OR tier ≠ high (no confident misrouting) |
| emotion w/ energy override (4 low, 4 high) | 8 | forced emotion; 100% compliance |
| quit phrasing | 6 | `quit_flag = true` |
| false-constraint phrasing | 6 | `false_constraint_flag = true` |

Item schema: `{ "id", "text", "case", "expect": { domain?, emotion?, energy?, tier?, quit?, false_constraint? } }`. **No item may duplicate a placeholder exemplar** (leakage rule).

### 6.2 Eval runner — `scripts/eval-classifier.ts` (deno task, dev-only)

- Loads golden set → calls `engine.classify` directly (service role, adapter `real` mode) → emits `docs/eval-reports/FP-03-golden-set-<date>.md`:
  - clear-case domain accuracy (gate ≥ 0.90 — AC-09)
  - emotion accuracy + override compliance (gate = 100% — AC-03)
  - flag precision/recall on quit / false-constraint subsets
  - tier distribution histogram + per-label confidence distributions (calibration evidence for R-01)
- **Calibration procedure (config-only, never code):** if tiers skew, adjust `classifier.tier.*` in config → re-run eval → record values + rationale in the report and worklog. If per-label sims are noisy, escalate to the deferred top-k mean option (§4.2) as a tracked follow-up.

**Exit criteria:** report archived; gates met (or documented deviation + agreed thresholds); flip decision recorded.

---

## Phase 7 — Verification, ship, rollback (S7)

### 7.1 AC walkthrough (fill per AC, link test IDs)

| AC | Verified by | Command/notes |
|---|---|---|
| AC-01 | I-01, I-02, C-01 | mode=real end-to-end + contract |
| AC-02 | U-05 | boundary table |
| AC-03 | U-02, U-03, golden set | 100% override |
| AC-04 | U-06, golden set | flags |
| AC-05 | I-03, U-07 | degradation |
| AC-06 | I-04 | config flip |
| AC-07 | Phase 3.3 | backfill + no-op + dead-letter |
| AC-08 | runbook drill (7.3) | mini approved-set swap |
| AC-09 | eval report | ≥ 0.90 clear-case |
| AC-10 | C-02 | dev forcer |

### 7.2 Ship sequence (dark → flip)

1. Merge `fp/03-real-classifier` → `main` with `classifier.mode = 'stub'` (zero behavior change at merge).
2. Run seed script + enqueue backfill → verify 228/228 embedded.
3. Run golden-set eval in dev → calibrate thresholds (config-only) → record report.
4. Flip `classifier.mode = 'real'` **in dev**; exercise all four tiers via `DEV_FORCE_TIER` removal + real messages; watch `classifier_stage_ms` p95 ≤ 1.5 s (NFR-01).
5. Flip in prod; monitor tier distribution + degraded rate for the first session of live traffic.
6. Log the flip (who/when/why) in the worklog — DoD item.

### 7.3 Rollback & BG-04 runbooks

**Rollback (any time, no redeploy):** set `classifier.mode = 'stub'`. Done — FP-02 stub is preserved verbatim. Migration 0007 is additive-only (new table + config rows), so no schema rollback is ever required.

**BG-04 hot-swap (when approved exemplars land):**
1. `scripts/seed-exemplars.ts --input content/classifier-exemplars/bg04.domains.json --source bg04_approved` (same upsert semantics; texts get `status: 'approved'`).
2. `update classifier_exemplars set active = false where source = 'placeholder';` (placeholders kept for history, never deleted).
3. `select jobs_enqueue('exemplar_embed', '{}'::jsonb);` → new rows embed.
4. Re-run golden-set eval → confirm gates → record in worklog. If accuracy regresses: `update classifier_exemplars set active = true where source = 'placeholder'` and deactivate the batch — data-only revert (AC-08 drill covers this with the mini set).
5. When BG-02's domain enum memo lands: run the orphan-label validation query (`select distinct label from classifier_exemplars where set_kind='domain'` vs enum) — FR-02/R-05.

### 7.4 DoD checklist — mirror of PRD §9; verify each box, then close FP-03 in the worklog and cut the branch.

---

## Appendix A — Full test matrix

| Layer | IDs | Where |
|---|---|---|
| Unit (engine) | U-01…U-08 | `_shared/classifier/engine_test.ts` |
| Contract | C-01 (§6.3 shape), C-02 (forcer) | FP-02 contract suite, unchanged |
| Integration (pipeline) | I-01…I-04 | `send-message` suite |
| Data | seed idempotency, backfill no-op, dead-letter | Phase 2/3 verification |
| Eval | golden set gates | `scripts/eval-classifier.ts` + archived report |

## Appendix B — Open spec reconciliations (TECH-SPECS wins per precedence)

| # | Point | This plan assumes | Reconcile against |
|---|---|---|---|
| B-01 | Forced-emotion confidence when energy override fires | `max(label's best sim, classifier.energy.conf_floor = 0.75)` | TECH-SPECS §6 — if it prescribes another composition, §6 wins and config default follows it |
| B-02 | Exact §6.3 field names (e.g., `emotion_forced`, `model`, `exemplar_counts`) | Names above; shape per FP-02 stub | §6.3 + the FP-02 contract test — rename, never reshape |
| B-03 | Embedding task type | `SEMANTIC_SIMILARITY` (symmetric message↔exemplar) | Gemini docs + TECH-SPECS LLM layer; exemplars and messages MUST share it (FR-05) |
| B-04 | Jobs API names (`jobs_enqueue`, `JobResult.reenqueue`, lease semantics) | Illustrative, matching FP-01's dispatcher | FP-01 merged code — adjust call sites, not behavior |
| B-05 | Where the classification block persists | Wherever FP-02 persisted the stub block | FP-02-PLAN / merged schema |
| B-06 | Config table name (`app_config` illustrative) | FP-01's seeded config table | FP-01 migration |

## Appendix C — Quota ledger ($0 invariant)

| Item | Requests | Notes |
|---|---|---|
| Backfill (one-time) | ~5 | 228 texts, batch 50, `batchEmbedContents` |
| BG-04 re-embed (future) | ~5 | same math, data-only |
| Runtime | 1 per user message | within the existing per-message envelope; 5 beta users ≈ negligible |
| Chat models | unchanged | classification adds zero chat calls (NFR-03) |
| Edge Function invocations | +~0 | engine runs inside `send-message`; backfill rides the existing dispatcher |

Record observed free-tier embedding limits from P-06 here after verification.

