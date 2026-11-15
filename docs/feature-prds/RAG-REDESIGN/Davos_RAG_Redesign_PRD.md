**Document type:** Product Requirements Document (PRD) and implementation specification  
**Status:** Proposed baseline for implementation  
**Product:** Davos personal AI mentor / coach  
**Audience:** Solo developer, coding agent, future maintainers  
**Architecture basis:** Wave 1 architecture audit and Wave 2 Personal Data Retrieval Audit, both performed 14 November 2026  
**Cost constraint:** $0 additional operating budget; reuse the current stack and existing free-tier provider access  
**Delivery constraint:** One developer; prioritize a narrow, working vertical slice over a large platform rewrite

\newpage

## Contents

0. How to use this document  
1. Product overview  
2. Goals, non-goals, and success criteria  
3. Current architecture and confirmed limitations  
4. Target architecture  
5. Turn planner specification  
6. Tool registry and execution contracts  
7. Evidence assembly and relevance policy  
8. Prompt and response-generation requirements  
9. Privacy, security, and data-access boundaries  
10. Vector search and embedding requirements  
11. Data limitations and prohibited inferences  
12. Performance, reliability, and $0 operating constraint  
13. Error handling and fallback behavior  
14. Testing and verification - solo-developer plan  
15. Implementation plan and sequencing  
16. Acceptance criteria / definition of done  
17. Open decisions and explicit unknowns  
18. Code areas and database objects to inspect  
19. Source audit references  
20. Final engineering direction

\newpage

---

## 0. How to use this document

This document is the standalone engineering specification for redesigning Davos's retrieval pipeline. An engineer or coding agent who has not read the preceding conversation must be able to understand the product, current implementation, proposed behavior, safety boundaries, and delivery requirements from this document alone.

The implementation agent must first inspect the current code and migrations referenced below. The audit reports are evidence, not permission to assume that the repository has not changed since the audits. Re-check the live branch and schema before editing. Where this PRD calls out an unknown or a decision, do not invent an answer: preserve the safe behavior and report the blocker.

### Evidence notation

- **Confirmed current state** means observed in the Wave 1 or Wave 2 audit against source code or the live Supabase catalog on 14 November 2026.
- **Requirement** means behavior the redesigned application must implement.
- **Decision** means an architectural choice made by this PRD to make implementation concrete.
- **Future / out of scope** means explicitly not required for the first release.

### Scope discipline

This is a retrieval and response-orchestration redesign. It is not authorization to rewrite the mobile application, redesign the database wholesale, replace the LLM provider abstraction, replace onboarding/accountability features, or change unrelated product behavior. Preserve existing behavior unless this document explicitly changes it or an implementation dependency requires a narrowly scoped change.

---

# 1. Product overview

## 1.1 What Davos is

Davos is a personal AI mentor and coach for young people who want guidance, reflection, accountability, and help making better decisions. It should behave like a coherent conversational mentor: understand what the user is asking, remember relevant context, examine the user's actual history when needed, apply relevant decision principles, and respond naturally.

The product is not intended to be a generic chatbot that merely receives a fixed bundle of user data. It is intended to be a personal reasoning system that can determine what information is needed for a particular question and retrieve that information through controlled, auditable application tools.

## 1.2 Data the product holds

The current application stores or derives information including:

- User messages and assistant replies.
- Check-in / doing records, including logged content, energy, source, timestamps, and check-in windows.
- Impulse-yield events (`impulse_failure`).
- Journal-entry metadata, such as date, severity, vagueness score, probed state, and habit flag.
- Extracted memory facts from conversations and journals.
- Habit records and their current status.
- Anchor plans for a date.
- Metrics and daily metric points, including quest metrics.
- Schedule and profile information, including timezone and check-in cadence.
- Trust-related events and internal adaptation state (some of which are deliberately not user-visible and must remain excluded from retrieval).
- A curated global library of approximately 144 guiding rules across 16 domains at the time of the audit.

The database does **not** currently persist every behavior the product may eventually want to analyze. In particular, held urges are device-local only; no canonical goals table exists; habit and anchor-plan history are overwritten; and several behavioral dimensions such as duration, intensity, location, and trigger are not captured.

## 1.3 Core product problem

The current pipeline supplies the model with predetermined context. The model cannot reliably request missing information from the primary database. The supplied data may be incomplete, fixed-size, or irrelevant to the question. The model can then overfit to whatever context it receives and attempt to use irrelevant records.

The redesign must replace fixed, hardcoded context selection with **model-directed, backend-controlled retrieval**. The model may decide what it needs; the backend decides what is safe and valid to execute.

## 1.4 Product outcome

For each user turn, Davos should:

1. Understand the user's request and the conversational context.
2. Decide whether personal data, historical memory, guiding rules, or no additional retrieval is needed.
3. Request the minimum useful information from approved tools.
4. Retrieve structured personal data from SQL and semantic memory/rules from pgvector when appropriate.
5. Assess whether the returned evidence is relevant and sufficient.
6. Retrieve once more when a specific, reasonable gap remains.
7. Generate a natural response that distinguishes observed facts from interpretation and general common sense.
8. Never invent personal facts or make unsupported behavioral claims.

---

# 2. Goals, non-goals, and success criteria

## 2.1 Goals

| ID | Goal | Required outcome |
|---|---|---|
| G-01 | Dynamic personal-data retrieval | The model can request approved user-specific datasets and operations instead of relying only on pre-injected records. |
| G-02 | SQL as primary source of truth | Structured claims about actual user activity, habits, energy, metrics, schedule, and events are grounded in SQL records or explicitly identified derived calculations. |
| G-03 | Semantic recall | The model can retrieve relevant, non-purged memory facts using pgvector when exact structured filters are insufficient. |
| G-04 | Relevant principles | The model can retrieve applicable curated rules without being forced to use irrelevant rules or restricted to an exact predicted domain. |
| G-05 | Relevance and abstention | Empty, irrelevant, stale, or conflicting results are not treated as mandatory evidence. |
| G-06 | Human-quality conversation | Tool usage is normally invisible; responses are coherent, context-aware, direct, and appropriately uncertain. |
| G-07 | Privacy and isolation | No cross-user reads, arbitrary SQL, unsavable-message leakage, purged-fact leakage, or access to hidden internal fields. |
| G-08 | Zero additional budget | No paid infrastructure, hosted reranker, separate vector database, or new paid AI service is introduced. |
| G-09 | Solo-developer delivery | The design is simple to implement and verify with targeted tests and manual checks. |

## 2.2 Non-goals for the first release

The first release will not:

- Give the model arbitrary SQL execution or a generic SQL console.
- Add a separate vector database or external search service.
- Add a paid reranker, paid observability platform, paid evaluation platform, or separate agent framework.
- Add unlimited autonomous tool loops.
- Search or return raw message/journal text through the personal-data tool.
- Introduce a new general-purpose document/chunk ingestion system.
- Create new goals, urges, habit-history, or plan-history tables solely as part of this retrieval release.
- Claim that the system can infer causal relationships from timestamp correlations.
- Claim that a user resisted or held an urge when no held-urge event is persisted.
- Claim that a user was late based on `doings_logs.logged_at`.
- Replace the classifier, persona, onboarding, accountability, quest, notification, or memory-extraction systems unless a narrowly required integration change is approved.
- Guarantee unlimited free model inference. The design must operate within current free-tier quotas and degrade safely when quotas are exhausted.

## 2.3 Success criteria

The release is successful when all of the following are true:

1. A user message can cause the planner to request zero, one, or multiple approved retrieval tools depending on the question.
2. Independent tool calls in the same plan can execute concurrently.
3. All personal-data reads are scoped to the authenticated user and enforce the restrictions in this PRD.
4. The planner cannot specify SQL, arbitrary fields, arbitrary JSON paths, unbounded date ranges, or unbounded result limits.
5. The model can answer using general knowledge for common-sense explanation, but personal facts and behavior-based decisions are grounded in retrieved evidence.
6. Irrelevant retrieval can be discarded; absence of useful evidence is a valid outcome.
7. At most one additional retrieval round is allowed after the initial retrieval round.
8. Typical turns target the existing two-generation-call pattern where feasible; the extra retrieval round is the exception, not the default.
9. No production personal records are needed for tests; fixtures can validate the dataset and aggregation behavior.
10. Existing essential chat, onboarding, authentication, memory extraction, and response-persistence behavior remains intact.

---

# 3. Current architecture and confirmed limitations

## 3.1 Current request lifecycle

The audited live path is:

`app/(app)/chat.tsx` -> `lib/chatService.ts` -> `supabase/functions/send-message` -> `runPipeline` -> retrieval/classification/prompt generation -> provider adapter -> persisted assistant reply -> realtime client update.

The request currently performs authentication and message validation, inserts the user message idempotently, may enqueue memory extraction, handles onboarding, then runs a fixed pipeline. The pipeline performs context extraction and message embedding in parallel, classifier retrieval, fixed rule retrieval, memory-fact retrieval, recent-message loading, day-plan/anchor context loading, and final response generation.

The current pipeline normally uses two generation calls and one embedding call. The existing provider abstraction is `_shared/llm/adapter.ts`; primary model at audit time was `gemini-3.5-flash-lite`, with Groq `openai/gpt-oss-120b` as fallback. These are observed audit-time settings, not guarantees that model names or provider quotas remain unchanged.

## 3.2 Existing retrieval components

Davos uses PostgreSQL with the `pgvector` extension in the existing Supabase project. There is no separate vector database.

| Corpus | Current role | Current limitation |
|---|---|---|
| `rules` | Curated guiding rules | Exact domain pre-filter, fixed top-5, no relevance threshold or abstention. |
| `exemplars` | Intent/domain/emotion/quit classification | Classifier asset; generation uses three static examples rather than retrieved exemplar rows. |
| `memory_facts` | Extracted personal facts | Fixed top-5, no recency/supersession/contradiction handling. |
| `doings_logs` | Check-ins and impulse-yield records | Embeddings are written, but no vector query/RPC reads them. |
| `messages` | Conversation history | Only a fixed recent window is supplied; user-facing retrieval must not expose raw contents under the Wave 2 restrictions. |
| `journal_entries` | Journal records | Long-form content exists but must not be returned or searched by the new personal-data tool. |

At audit time, `gemini-embedding-001` was used with 768 dimensions and cosine distance. Existing query embeddings incorrectly use `RETRIEVAL_DOCUMENT` for the user query. The redesign should use `RETRIEVAL_QUERY` for query-side embedding while preserving the stored embedding model identity and dimensions unless a separate migration/backfill plan is approved.

## 3.3 Confirmed retrieval defects

- Rule top-K is hardcoded to five in multiple places.
- Rules are filtered by exact domain before similarity ranking.
- No similarity threshold exists for rules or memory facts.
- No explicit abstention or retrieval-sufficiency behavior exists.
- No hybrid lexical/vector retrieval or reranking exists.
- Memory facts have no supersession, recency, or semantic contradiction policy.
- `doings_logs` embeddings are unused.
- No retrieval-quality evaluation set exists.
- No unit tests cover the primary rule retrieval and conflict-filter path.
- `match_rules` has an audit-identified default `PUBLIC`/`anon` execute grant and no pinned `search_path`; this is a security-hardening item.
- Configuration is fetched repeatedly, around 8-12 reads per turn according to the audit.

## 3.4 Existing behavior that must be preserved

The implementation agent must inspect and preserve all applicable behaviors, including:

- JWT validation and server-side user resolution.
- Idempotent user-message insertion and duplicate handling.
- Primary-reply persistence guard.
- Existing onboarding path and onboarding stage behavior.
- Existing context extraction contract and any downstream consumers.
- Classifier/exemplar behavior unless a narrowly scoped change is needed.
- Persona routing, lockdown, energy/confidence bands, and relevant existing guardrails.
- Memory extraction and unsavable-message purge behavior.
- Existing fallback model/provider handling and graceful error responses.
- Day-plan and anchor context features.
- Existing push notification behavior and bounded push timeout.
- Existing response JSON contract expected by the Expo client.

Do not remove a current pipeline stage merely because it appears redundant. Trace its outputs first.

---

# 4. Target architecture

## 4.1 Architecture decision

Implement a **bounded, model-directed retrieval orchestrator** inside the existing Supabase Edge Function / pipeline architecture.

The language model proposes a retrieval plan using structured JSON. The backend validates and executes only approved tools. The model does not directly connect to Postgres, create SQL, choose a user ID, or bypass RLS.

This achieves flexible retrieval without unrestricted text-to-SQL or a large autonomous agent framework.

## 4.2 Logical components

| Component | Responsibility |
|---|---|
| Chat request handler | Authenticate, validate, persist the user turn, and preserve idempotency. |
| Context bootstrapper | Load the minimal current context needed to interpret the message, including the configured recent conversation window and safe stable profile context. |
| Turn planner | Interpret the user request and propose a structured retrieval plan. |
| Tool registry | Describe approved tools, JSON arguments, dataset/operation allowlists, and result contracts. |
| Tool validator | Validate every tool name and argument; enforce identity, date, row, field, and budget limits. |
| Tool executor | Execute approved reads with user-level isolation; execute independent reads concurrently. |
| Evidence assembler | Normalize, label, bound, and organize results; preserve provenance and data limitations. |
| Sufficiency/refinement stage | Decide whether one specific additional retrieval round is justified or the available evidence is sufficient/insufficient. |
| Response generator | Produce the user-facing answer from the current message, conversation context, and evidence bundle. |
| Telemetry | Record bounded operational metadata such as tool name, latency, result count, and error category without storing raw sensitive results. |

## 4.3 Request flow

1. Authenticate the request and resolve the user from the verified JWT.
2. Validate message length, request shape, and idempotency key using existing behavior.
3. Persist the user message using the current mechanism.
4. Load the recent conversation context using the current configured sliding window. Keep the existing `unsavable = false` restriction. The current audit noted that the UI can load 50 messages while the model receives eight; correct the mismatch or make it explicit in configuration, but do not blindly increase prompt size.
5. Load only minimal stable profile context required for interpretation (for example, timezone and schedule preferences). Do not load large personal datasets into the bootstrap context.
6. Run the existing extraction/classification preparation. Prefer a single Stage 1 structured model response that preserves the existing extraction contract and also includes the retrieval plan. If the existing extraction contract cannot safely be combined, preserve the separate call rather than dropping outputs.
7. Produce the user query embedding only as required by existing classification or selected vector tools. Use `RETRIEVAL_QUERY` for query-side embedding. Reuse a query embedding when semantically applicable; batch multiple distinct query embeddings when needed.
8. Validate the retrieval plan. Reject unknown tools, fields, filters, operations, date ranges, or limits. Never trust the model-supplied user ID.
9. Execute validated, independent retrieval requests in parallel.
10. Assemble the results into a compact evidence bundle with provenance, timezone, time window, row count, and coverage caveats.
11. Give the evidence bundle to the model. The model either returns a final response or requests one additional validated retrieval round.
12. If a refinement request is present, validate and execute it once, then generate the final response. No third retrieval round.
13. Persist and return the assistant response using the existing response contract and primary-reply guard.
14. Continue existing post-response hooks only where required by the current product flow.

## 4.4 Retrieval loop and call budget

| Limit | Requirement |
|---|---|
| Initial planning | One structured planning call per ordinary turn. |
| Initial tool round | Any number of approved independent tools, subject to a small configured call/result budget. Execute concurrently where safe. |
| Refinement | Zero or one additional retrieval round. |
| Final generation | One final response generation after the initial results, or after refinement if refinement is used. |
| Typical generation calls | Target two, by combining existing extraction/turn analysis with planning when safe. |
| Maximum generation calls | Target three for a turn that needs refinement, excluding exceptional provider fallback behavior. Preserve existing deadline/retry safeguards. |
| Embeddings | Reuse one query embedding where it matches the retrieval query; batch distinct query embeddings; do not embed for SQL-only requests unless existing classifier behavior still requires it. |
| Row/date budget | Enforce the limits in Section 8. |

**No-retrieval path:** If the planner decides that the question is conversational, conceptual, or answerable without personal facts/rules, skip personal-data retrieval. The absence of tool calls is a normal result, not a failure.

**Insufficient-data path:** If the relevant dataset is empty, incomplete, unsupported, or unavailable, the final model must state the limitation, ask a focused follow-up when useful, or give clearly labeled general guidance. It must not fabricate the missing information.

---

# 5. Turn planner specification

## 5.1 Purpose

The planner decides what evidence is needed for the current turn. It is not the final answer generator and must not attempt to produce a long user-facing response while planning.

It may request:

- Structured personal data from the SQL registry.
- Semantic personal memory facts.
- Curated guiding rules.
- No additional retrieval.

It may not request arbitrary table access, raw SQL, unrestricted message/journal text, private internal scores, or writes.

## 5.2 Planner inputs

- Current user message.
- Current recent conversation window, excluding unsavable messages.
- Minimal allowed profile/schedule context.
- Existing route/classification/persona signals that the current system already uses.
- Descriptions of the available tools and their allowed datasets/operations.
- Any previous retrieval results, only during the optional refinement step.

## 5.3 Planner output contract

Use a strict structured JSON schema compatible with the current provider adapter's structured-output support. The exact SDK representation must be checked in `_shared/llm/adapter.ts` and `geminiSchema.ts`.

Illustrative contract:

```json
{
  "intent": "personalized_advice",
  "retrieval_required": true,
  "retrieval_requests": [
    {
      "tool": "query_personal_data",
      "arguments": {
        "dataset": "checkins",
        "operation": "timeseries",
        "filters": {
          "date_from": "2026-11-01",
          "date_to": "2026-11-14"
        },
        "group_by": ["day"],
        "metrics": [
          { "op": "count" },
          { "op": "avg", "field": "energy" }
        ],
        "bucket": "day",
        "limit": 30
      },
      "purpose": "Compare recent check-in volume and energy by local day."
    },
    {
      "tool": "search_personal_memory",
      "arguments": {
        "query": "previously stated productivity obstacles and motivation patterns",
        "fact_types": ["chat", "journal", "baseline", "oath"],
        "limit": 5
      },
      "purpose": "Find relevant previously extracted personal context."
    }
  ],
  "answer_mode": "personalized_analysis"
}
```

This is illustrative. Do not copy the dates or tool parameters as fixed defaults.

### Required planner fields

| Field | Type | Meaning |
|---|---|---|
| `intent` | enum/string from a small allowlist | High-level request type, such as conversation, explanation, personal_reflection, personalized_advice, progress_review, decision_support, or factual_recall. |
| `retrieval_required` | boolean | Whether any tool is needed. |
| `retrieval_requests` | array | Zero or more approved tool requests. Empty when no retrieval is needed. |
| `purpose` | short string per request | One-sentence description of what the request is meant to establish; not chain-of-thought. |
| `answer_mode` | allowlisted enum | Expected response style, e.g. conversational, explanation, personalized_analysis, decision_support, or clarification. |

### Planner validation rules

- If `retrieval_required` is false, `retrieval_requests` must be empty.
- Every tool name must exist in the server-side registry.
- Tool arguments must pass strict schemas; unknown keys are rejected.
- User identity is never accepted from model output.
- The planner cannot pass SQL, SQL fragments, column names outside the registry, arbitrary expressions, or arbitrary JSON paths.
- The planner cannot request writes, job enqueueing, user-data deletion, profile mutation, quest acceptance, or schedule updates.
- The planner cannot request data excluded in Sections 7-9.
- Requested date ranges must be explicit after relative dates are resolved by trusted server time and the user's profile timezone.
- Requests must have an explicit limit wherever an operation returns rows.
- If the plan exceeds the total request budget, reject or trim deterministically and record a non-sensitive validation event; do not execute a partial unbounded plan.

## 5.4 Planner behavior rules

The system instruction for planning must communicate:

1. Retrieve personal data only when the answer materially depends on it.
2. Use SQL tools for structured counts, trends, comparisons, schedules, and known records.
3. Use semantic memory search for recalled personal context that cannot be expressed as simple structured filters.
4. Use rule search for decisions, recommendations, and behavior guidance when principles can materially improve the answer.
5. Do not retrieve rules for every ordinary message.
6. Request only the dimensions/time ranges needed to answer the question.
7. Prefer aggregation over raw-row retrieval for trend questions.
8. Do not infer an unavailable metric from a nearby metric.
9. Do not request raw message or journal content.
10. Treat empty results as evidence of missing data, not permission to guess.

---

# 6. Tool registry and execution contracts

The first release has three tools. Their names may be adapted to the repository's naming conventions, but their behavior and boundaries must remain equivalent.

## 6.1 Tool A  -  `query_personal_data`

### Purpose

Provide validated, user-scoped access to structured personal data, including filtered lists, counts, aggregates, and time series.

### Important architectural rule

This is a **query DSL**, not text-to-SQL. The language model selects a dataset, operation, permitted filters, metrics, dimensions, and limit. Server code constructs parameterized queries using allowlisted identifiers and fixed query builders.

### Input contract

```json
{
  "dataset": "checkins",
  "operation": "timeseries",
  "filters": {
    "date_from": "2026-11-01",
    "date_to": "2026-11-14",
    "source": ["checkin_reply"]
  },
  "group_by": ["day"],
  "metrics": [
    { "op": "count" },
    { "op": "avg", "field": "energy" }
  ],
  "bucket": "day",
  "order": [{ "field": "day", "dir": "asc" }],
  "limit": 200
}
```

### Supported filter primitives

- `date_from`, `date_to`: profile-local calendar dates.
- `datetime_from`, `datetime_to`: explicit timestamps.
- `enum_in`: allowlisted enum values only.
- `id_in`: bounded list of UUIDs; ownership is always rechecked by the query.
- `numeric_range`: allowlisted numeric fields only.
- `boolean`: allowlisted boolean fields only.
- `has_window`: boolean filter for check-in window presence.
- `cursor`: opaque server-generated cursor only; no client/model-authored SQL cursor.

### Supported metric primitives

- `count`
- `sum`
- `avg`
- `min`
- `max`
- `count_distinct`
- `latest`

Only combinations listed for a dataset below are valid. No user-supplied formula, arbitrary arithmetic, JSONLogic, SQL expression, or raw aggregate expression is allowed.

### Supported dimensions

- `day`, `week`, `month`
- `weekday`, `hour_of_day`
- Dataset-specific allowlisted dimensions: `source`, `status`, `kind`, `role`, `fact_type`, `domain`, `severity`, `metric_id`, `habit_flag`

All date/hour dimensions must be calculated in the user's validated profile timezone. They must not be calculated in UTC unless UTC is explicitly the user's valid timezone or an explicit fallback is reported internally.

### Operations

| Operation | Contract |
|---|---|
| `list` | Return bounded rows with allowlisted projection and ordering. `limit` required, maximum 500. Use opaque cursor for pagination. |
| `count` | Count rows matching validated filters. |
| `aggregate` | Run allowlisted metrics and groupings only. |
| `timeseries` | Bucket metrics by day/week/month; range maximum 366 days; local-day boundaries. |
| `latest` | Return latest N records; N maximum 20. |
| `compare_periods` | Optional in first release. If implemented, accept exactly two bounded date ranges and the same metric/dimension set for both. Do not delay core delivery for this operation. |
| `read_one` | Only for `schedule_profile`, returning one allowlisted profile subset. |

### Global query limits

- `user_id` is injected from the verified authenticated identity; never accepted in tool arguments.
- Maximum date range is 366 days unless a smaller dataset-specific limit applies.
- Maximum list result is 500 rows; `limit` is mandatory.
- `latest` is capped at 20.
- Memory fact list is separately capped at 50.
- Check-in content is separately capped at 20 rows and 280 characters per content value.
- No arbitrary full-table scan initiated by the model.
- Query execution must have a configured timeout. Reuse the existing request deadline and apply a smaller per-tool budget where practical.
- Empty days in time series must be zero-filled when the metric semantics require a complete calendar series.
- Always return `timezone`, `day_basis`, and requested date range metadata for day-based results.

### Dataset registry

The registry below is normative. The implementation may split a dataset into multiple fixed query-builder functions, but it must not silently expand the fields/operations available to the model.

### `checkins`

- **Grain/source:** One row per answered check-in window from `doings_logs` where `kind='doing'`.
- **Filters:** Local date range, source, energy range, `has_window`.
- **Metrics:** Count, count-distinct check-in window, average/sum/min/max energy.
- **Dimensions:** Day, week, weekday, hour-of-day, source.
- **Operations:** `list`, `count`, `aggregate`, `timeseries`, `latest`.
- **Special rules:** `logged_at` represents window close, not receipt time. `created_at` is insert time. `content` is allowed only in list, maximum 20 rows and 280 characters per value.

### `impulse_events`

- **Grain/source:** One row per impulse yield from `doings_logs` where `kind='impulse_failure'`.
- **Filters:** Local date range, source.
- **Metrics:** Count.
- **Dimensions:** Day, week, weekday, hour-of-day, source.
- **Operations:** `count`, `aggregate`, `timeseries`, metadata-only `list`.
- **Special rules:** Never return content. No held/resisted-urge dataset exists.

### `checkin_compliance`

- **Grain/source:** One row per local day, derived from `doings_logs` and the frozen check-in window grid.
- **Filters:** Local date range.
- **Metrics:** Answered windows, scheduled windows elapsed, compliance rate; optional diagnostic receipt timing only.
- **Dimensions:** Day, week, weekday.
- **Operations:** `aggregate`, `timeseries`.
- **Special rules:** Denominator comes from the frozen grid (`lib/checkinGrid.ts` and `_shared/checkin/windows.ts`), excluding future windows. Do not rely on `metric_vars_daily` for compliance. Do not label `created_at`-based values as definitive lateness because offline queue flushes can distort receipt time.

### `journal`

- **Grain/source:** One row per journal entry from `journal_entries`.
- **Filters:** Local entry-date range, severity, probed, habit flag.
- **Metrics:** Count, average vagueness score, count by severity.
- **Dimensions:** Day, week, severity, habit flag.
- **Operations:** `count`, `aggregate`, `timeseries`, metadata-only `list`.
- **Special rules:** Never return `journal_entries.content`; no content search. Severity is model-assigned and vagueness score can be null.

### `anchor_plans`

- **Grain/source:** One row per user/date from `anchor_plans`.
- **Filters:** Date range.
- **Metrics:** Plan count, anchor count, anchor count by kind/status.
- **Dimensions:** Day, kind, status.
- **Operations:** `list`, `aggregate`, `latest`.
- **Special rules:** Expose only allowlisted anchor properties: `start`, `end`, `title`, `kind`, `status`, `evidence`. No plan edit history exists.

### `habits`

- **Grain/source:** One row per habit from `habits`, representing current state.
- **Filters:** Status, detected date range, watch date range.
- **Metrics:** Count, count by status.
- **Dimensions:** Status, detected day.
- **Operations:** `list`, `aggregate`.
- **Special rules:** `description` may be returned in list because it is a user-facing habit description. No history exists; do not make historical improvement or relapse claims.

### `metrics_catalog`

- **Grain/source:** One row per metric definition from `metrics`.
- **Filters:** Domain, formula status, quest flag/status, archived flag, created date range.
- **Metrics:** Count.
- **Dimensions:** Domain, formula status, quest flag/status.
- **Operations:** `list`, `aggregate`.
- **Special rules:** Never expose `formula`. Only validated metrics have points.

### `metric_series`

- **Grain/source:** One row per metric/day from `metric_points` joined to `metrics`.
- **Filters:** Metric ID, metric name, domain, date range.
- **Metrics:** Value latest/average/sum/min/max, point count, day-over-day delta.
- **Dimensions:** Day, week, metric ID, domain.
- **Operations:** `list`, `timeseries`, `latest`, `aggregate`.
- **Special rules:** Always join `metrics` for ownership and name because `metric_points` has no `user_id`. Exclude archived metrics by default. Include archived metrics only if explicitly supported and requested.

### `quests`

- **Grain/source:** One row per quest metric from `metrics` where `is_quest=true`.
- **Filters:** Quest status, deadline range, domain.
- **Metrics:** Count, count by status.
- **Dimensions:** Status, domain, deadline day.
- **Operations:** `list`, `aggregate`.
- **Special rules:** Do not infer completion date from `quest_deadline`.

### `daily_vars`

- **Grain/source:** One row per local day, derived using the intended semantics of `metric_vars_daily`.
- **Filters:** Local date range.
- **Metrics:** `doings_count`, `hours_logged`, `energy_avg`, `impulse_failures`, `journal_positive_mentions`, `journal_negative_mentions`.
- **Dimensions:** Day, week, weekday.
- **Operations:** `list`, `timeseries`, `aggregate`.
- **Special rules:** Compute or correct from underlying RLS-accessible tables. Zero-fill missing days. `hours_logged` means answered windows multiplied by configured cadence, not measured duration. Do not treat `quest_completions` from the existing view as a completion-day metric; it is attributed to `quest_deadline`.

### `conversation`

- **Grain/source:** One row per message from `messages`.
- **Filters:** Date range, role, allowlisted `metadata.source` values.
- **Metrics:** Count, count by role/source.
- **Dimensions:** Day, hour-of-day, role, source.
- **Operations:** `count`, `aggregate`, `timeseries`, metadata-only `list`.
- **Special rules:** Force `unsavable=false`. Never return content. Metadata keys must be individually allowlisted.

### `memory_facts`

- **Grain/source:** One row per extracted fact from `memory_facts`.
- **Filters:** Fact type, created date range, has source.
- **Metrics:** Count.
- **Dimensions:** Fact type, created day.
- **Operations:** `list` (maximum 50), `count`, `aggregate`.
- **Special rules:** Always enforce `purged_at IS NULL`; never return embedding or embedding model. Include source IDs only if needed for internal provenance and never expose hidden data.

### `schedule_profile`

- **Grain/source:** One row per user, an allowlisted subset of `profiles`.
- **Filters:** None.
- **Metrics/dimensions:** None.
- **Operations:** `read_one` only.
- **Special rules:** Return `timezone`, cadence, active hours, wake/sleep preferences, onboarding stage, and dialog state as approved. Never return `trust_score` or `lockdown_started_at`.

### Important SQL semantics

1. `metric_points` has no `user_id`; always join through `metrics` and verify `metrics.user_id` equals the authenticated user.
2. `metric_vars_daily` is service-role-only, has no zero-filled days, can omit a user with an invalid timezone due to an inner join, and attributes quest counts to `quest_deadline`. Do not expose it directly as a source of truth for the new tool.
3. `doings_logs.logged_at` is the check-in window close time. It is not the event receipt time.
4. `created_at` is the database insert time; offline queue flushes can make it later than the user's actual submission time.
5. `hours_logged` is a schedule-based estimate: count of answered windows multiplied by configured cadence. It is not actual measured time.
6. Journal `entry_date` is already a local date; do not shift it through timezone conversion.
7. Quest completion date is not reliably persisted in the current schema. Do not invent it from deadline.
8. `habits` and `anchor_plans` are mutable current-state records, not event histories.
9. All user-facing time windows must be interpreted using `profiles.timezone` and returned with the timezone/day-basis metadata.

## 6.2 Tool B  -  `search_personal_memory`

### Purpose

Find relevant previously extracted facts about the user when the question requires semantic recall rather than a structured aggregation.

### Source

`memory_facts` using the existing pgvector corpus and `match_facts` logic, with safe authorization changes described in Section 10.

### Input

```json
{
  "query": "previously stated goals and recurring obstacles related to studying",
  "fact_types": ["chat", "journal", "baseline", "oath"],
  "date_from": "2026-01-01",
  "date_to": "2026-11-14",
  "limit": 5
}
```

`fact_types` and date filters are optional; unknown fact types are rejected. The tool must always exclude `purged_at IS NOT NULL`.

### Behavior

- Embed the semantic query using the query task type.
- Search only facts belonging to the authenticated user.
- Apply optional allowed fact-type/date filters.
- Return a bounded number of facts with IDs, fact text, fact type, creation time, and limited provenance metadata.
- Never return embeddings or internal embedding model identifiers.
- Do not treat cosine rank alone as proof of relevance. Add a configurable relevance cutoff; initial values must be calibrated against a small hand-reviewed fixture set rather than copied blindly from another corpus.
- Preserve the fact timestamp and source type so the response generator can treat old and current facts differently.
- If facts conflict, return enough provenance for the evidence layer to identify possible conflict; do not silently merge or declare one current without a validity signal.
- A missing fact is not evidence that the user never said something.

### Memory limitations

The schema has no explicit supersession/validity mechanism. The first release must not claim full temporal truth resolution. Where two facts conflict and timestamps alone cannot establish which is valid, the assistant must qualify the uncertainty or ask the user.

## 6.3 Tool C  -  `search_guiding_rules`

### Purpose

Retrieve global curated principles that may help with decision-making, coaching, or behavior guidance.

### Source

`rules` table, currently approximately 144 rule rows across 16 domains.

### Input

```json
{
  "query": "principles for building consistent habits when motivation is low",
  "domain_hints": ["Discipline/Habits", "Learning"],
  "limit": 6
}
```

### Behavior

- Use semantic similarity across the full rule corpus by default.
- Domain hints may boost ranking or break ties, but must not be a hard exclusion filter.
- Support a small keyword/lexical fallback where it improves exact-term recall and remains inexpensive in Postgres.
- Use a configurable relevance cutoff and bounded result count. Calibrate the cutoff with a small rule-query fixture set.
- Return rule ID, text, domain, tone, priority, source attribution, and relevance metadata.
- Keep rule provenance internally. Cite a source in the user-visible response only when it genuinely helps; do not force a citation on every conversational reply.
- Treat rules as recommendations/principles, never as evidence of what the user did.
- Apply existing tone/guardrail/lockdown logic after retrieval where still applicable.

### Required change from current behavior

Remove the current exact-domain pre-filter as a hard gate. A predicted domain is a hint, not proof that all other domains are irrelevant. Remove the fixed hardcoded top-5 behavior and use validated configurable limits. The system must be able to return fewer than the requested maximum, including zero, when no result is relevant.

## 6.4 Explicitly excluded tool  -  raw conversation/journal search

The Wave 2 data audit prohibits free-text search and returning raw `messages.content` or `journal_entries.content` through the personal-data query tool. `conversation` is metadata-only. Journal is metadata-only. This is the default privacy boundary for this release.

Therefore:

- Do not create a `search_conversation_history` tool that returns historical message text.
- Use the current recent conversation context for immediate conversational continuity.
- Use `search_personal_memory` for extracted, non-purged semantic facts from earlier conversations/journals.
- If the product later needs verbatim historic recall, it requires a separate explicit privacy/product decision and its own access, retention, unsavable, and deletion design. It is not silently included in this PRD.

---

# 7. Evidence assembly and relevance policy

## 7.1 Purpose

Raw tool results must not be concatenated blindly into the generation prompt. Evidence assembly creates a compact, labeled representation of what was found, what it means, and what it does not establish.

## 7.2 Evidence item contract

Each evidence block should include, where applicable:

```json
{
  "source_type": "checkins",
  "source_ids": ["..."],
  "retrieval_method": "sql_aggregate",
  "time_range": {
    "start": "2026-11-01",
    "end": "2026-11-14"
  },
  "timezone": "Asia/Kolkata",
  "day_basis": "profile_local_day",
  "row_count": 14,
  "data": {},
  "limitations": ["hours_logged is schedule-estimated, not measured duration"]
}
```

Do not expose internal SQL, credentials, query plans, or raw tool execution metadata to the model. Provide the minimum structured evidence required for a correct answer.

## 7.3 Required evidence classifications

The evidence assembler must preserve these distinctions:

| Classification | Meaning | Response handling |
|---|---|---|
| Observed fact | Directly represented in an allowed database record. | May be stated as fact with correct time period and scope. |
| Derived metric | Calculated by deterministic application logic from records. | State the metric definition where ambiguity matters. |
| Semantic memory | An extracted memory fact, possibly from a prior conversation or journal. | Attribute as something previously shared/remembered; respect age and source. |
| Guiding principle | A curated rule. | Use as advice or a reasoning lens, not a fact about the user. |
| General knowledge | Common-sense/explanatory knowledge from the LLM. | May explain concepts; cannot establish user-specific facts. |
| Unsupported / unavailable | Data absent, not captured, excluded, or too weak to infer. | Say it is unavailable; ask a follow-up if needed. |

## 7.4 Relevance filtering

- Retrieval results are candidates, not instructions.
- Apply relevance thresholds at retrieval where possible.
- The final model must be told to ignore evidence that does not materially contribute to the current question.
- Rule results should be included only when they affect the decision or explanation.
- Personal facts should not be forced into casual/conceptual answers.
- If there are no relevant results, render a clear internal `no_relevant_evidence` state, not a fake evidence block.
- Do not increase top-K merely to ensure that something is returned.

## 7.5 Recency and contradiction handling

- SQL event records retain their recorded timestamps; queries must use those timestamps correctly.
- Memory facts retain `created_at`, source ID, and fact type. There is no explicit `valid_from`, `valid_to`, or `supersedes_fact_id` in the existing schema.
- The first release may use timestamps as a weak signal but must not assume newer always means true.
- Contradictory facts should be surfaced to the generation model with both timestamps/sources and a clear uncertainty marker.
- Do not silently resolve conflicting habit descriptions, goals, plans, or preferences without source evidence.
- Do not claim historical change where the schema only stores current state.

## 7.6 Sufficiency and one refinement round

After the first tool round, the model may:

- Return a final response if evidence is sufficient.
- Request one additional tool round if a specific missing dataset or narrower query is likely to resolve the gap.
- Return an insufficient-data result if the necessary evidence does not exist or is intentionally unavailable.

Do not run the additional round just because the first results are sparse. There must be an identifiable question the next query can answer. No further retrieval loop is allowed in the first release.

---

# 8. Prompt and response-generation requirements

## 8.1 Prompt structure

Preserve the existing prompt controls and compatible riders, but separate the concepts more clearly:

1. Product identity and mentor role.
2. Safety, privacy, and instruction hierarchy.
3. Existing route/persona/voice instructions.
4. Existing onboarding/lockdown/day-plan instructions when applicable.
5. Relevant guiding principles, if any.
6. Recent conversation context.
7. Evidence bundle, if any, with source/time/limitations labels.
8. Response-format requirements.

Do not include empty or irrelevant sections. If no rules were retrieved, do not pressure the model to invent or quote rules. If no evidence is available, the prompt must clearly say so.

## 8.2 Mandatory response rules

The response generator must follow these rules:

- Use SQL evidence for concrete personal claims and user-specific decisions.
- Use general model knowledge only for common-sense explanations, definitions, and reasoning context.
- Do not claim personal behavior, progress, consistency, relapse, energy patterns, or trends without supporting records.
- Treat a rule as a principle, not a fact.
- Ignore irrelevant retrieved context even when it is present.
- Do not fill gaps with plausible-sounding assumptions.
- State uncertainty plainly and ask one focused question when a missing fact materially changes the recommendation.
- Avoid exposing internal tool names, retrieval mechanics, raw metadata, or database language unless the user asks.
- Keep responses conversational and natural without pretending the AI is a human being.
- Do not reveal hidden internal scoring or adaptation values.

## 8.3 Source attribution

Keep record IDs and source details in the internal evidence bundle. User-visible source references are optional and should be used when they improve trust or when the user asks "why do you think that?" Do not add artificial citations to ordinary coaching messages.

## 8.4 Existing prompt injection controls

Keep the current injection guard, delimiter escaping, and structured output anchoring. Escaping `<` and `>` is not sufficient by itself to neutralize malicious instructions inside user-provided content. Tool outputs and memory facts are data, not instructions. No retrieved content may override system-level instructions, data-access restrictions, or this PRD's safety rules.

---

# 9. Privacy, security, and data-access boundaries

## 9.1 Identity and authorization

- User identity must be resolved from the verified request JWT using the existing authentication path.
- The planner and tool arguments must never supply or override `user_id`.
- Every personal-data query must be scoped to the authenticated user.
- Prefer database access under the caller's JWT and normal RLS for personal data.
- Do not create a generic service-role query executor that accepts arbitrary model parameters.
- If a narrowly scoped server-only operation is unavoidable, it must have explicit user identity derived from the already verified auth context, strict query allowlists, no arbitrary SQL, and a reviewed least-privilege design. The preferred design remains user-JWT-scoped reads.

## 9.2 Mandatory exclusions

The following are never selectable by model-directed retrieval:

- `profiles.trust_score`
- `trust_events.delta` (counts by reason may be allowed; the delta itself is not)
- `persona_stats`
- `push_tokens.token`
- `config`
- `jobs` and job payloads
- `metrics.formula` (JSONLogic internals)
- All embedding vectors and `embed_model` values
- `messages.content`
- `journal_entries.content`
- `messages` rows where `unsavable = true`
- `memory_facts` rows where `purged_at IS NOT NULL`
- `tactical_analysis` and any other server-only internal analysis
- Held-urge events, because no server-side dataset exists
- Raw SQL, arbitrary JSONB paths, arbitrary table names, or arbitrary field projections

## 9.3 Conditional content access

- `doings_logs.content` may be returned only through a `checkins` list operation, no more than 20 rows, and truncated to 280 characters per row.
- `impulse_events` returns metadata only; never return its content.
- `habits.description` may be returned through the habits list because it is the user-facing habit description.
- `anchor_plans` exposes only the allowlisted anchor fields in Section 6.1.
- `memory_facts.fact` may be returned only when `purged_at IS NULL` and the fact belongs to the authenticated user.
- `journal` and `conversation` datasets remain metadata-only.

## 9.4 Database function and privilege hardening

Before exposing new retrieval paths:

1. Fix `match_rules` default `PUBLIC`/`anon` execute exposure. Revoke unneeded grants, grant only the required roles, and pin a safe `search_path` if a `SECURITY DEFINER` function remains.
2. Review `match_facts` authorization. The current live function is service-role-only. Prefer enabling an authenticated, user-JWT-scoped call that derives the user from `auth.uid()` rather than accepting arbitrary user IDs. Preserve non-service caller isolation. Do not weaken it to make integration easier.
3. Review `match_exemplars` grants and keep it limited to the intended global classifier corpus.
4. Review residual grants identified in Wave 2, especially `TRUNCATE`/other table-level privileges on user tables and write grants on `trust_events`. Revoke unnecessary privileges without breaking legitimate application flows.
5. Review `config` exposure. Wave 2 found RLS disabled with authenticated SELECT; confirm the client dependency and reduce access to only what the client truly needs. Do not let the new retrieval tools read `config`.
6. Confirm the actual live ACL after migrations, not only the migration text.

Security migrations must be narrow, reversible where practical, and separately tested. Do not bundle unrelated privilege cleanup into an unreviewable migration.

## 9.5 User content and unsavable handling

`unsavable=true` is a marker, not deletion; the message remains in the database. The new retrieval layer must not return its content or derive a result from it. Existing memory purge rules must remain active. Every query touching messages must force `unsavable=false`, not rely on the model to request that filter.

## 9.6 Privacy and youth-facing product safeguards

Davos serves young people and may receive highly personal disclosures. The retrieval redesign must:

- Minimize the amount of personal data sent to the LLM.
- Avoid logging raw journals, message contents, impulse text, or memory fact bodies in telemetry.
- Keep user data isolated and avoid cross-user retrieval.
- Preserve unsavable and purge semantics.
- Avoid clinical diagnoses, treatment claims, or pretending to replace a qualified professional.
- Route serious safety disclosures through the product's existing safety behavior. Before production use with minors, the product owner must verify whether a suitable safety/escalation path exists; if none exists, that is a separate release blocker, not something to invent inside the retrieval tool.

---

# 10. Vector search and embedding requirements

## 10.1 Keep the current infrastructure

Use Supabase Postgres and `pgvector`. Do not introduce an external vector database. The corpora are small enough for Postgres, and the current deployment already contains the data.

## 10.2 Embedding contract

- Preserve `gemini-embedding-001` and the existing 768-dimensional identity for the first release unless the current provider/API no longer supports it.
- Use `RETRIEVAL_DOCUMENT` when creating corpus embeddings.
- Use `RETRIEVAL_QUERY` for query embeddings.
- Ensure query and document vectors are compatible in model identity and dimension.
- Reuse or batch embeddings within a request to avoid duplicate calls.
- Do not introduce a re-embedding migration in the retrieval PR unless a verified compatibility issue requires it.

## 10.3 Rules search

- Search across all rule domains; domain labels are hints/ranking features only.
- Remove exact-domain gating as the default retrieval constraint.
- Use cosine distance as the current baseline.
- Return fewer than the requested limit when the relevance cutoff rejects weak matches.
- A small lexical fallback is acceptable because the rule corpus is only around 144 rows; do not add a hosted search dependency.
- Avoid adding an ANN index just for the 144-row rules corpus. Revisit only when measured scale warrants it.

## 10.4 Personal memory search

- Keep user scoping inside the database query/function, not as a post-query filter.
- Keep `purged_at IS NULL` in the database predicate.
- Use a relevance cutoff and bounded result count.
- Consider recency in ranking only as a secondary factor; do not let recency override a clearly more relevant fact without a defined policy.
- Do not add vector search over raw conversations or journals in this release.

## 10.5 Doings embeddings

`doings_logs` has embeddings but no current similarity query RPC. The first release may continue using structured SQL filters and bounded check-in lists for doings. Do not automatically expose semantic search over all doings content. A future feature may introduce a carefully bounded semantic activity search only after privacy approval, explicit content-use rules, and a demonstrated need.

---

# 11. Data limitations and prohibited inferences

These are product-level constraints, not mere implementation inconveniences. The model must be informed of them when relevant.

| Requested insight | Current support | Required behavior |
|---|---|---|
| Number of answered check-ins | Directly queryable | May answer using `doings_logs` and correct local-day semantics. |
| Energy average/trend | Directly queryable, with nullable values | May compute using actual non-null energy values; state coverage if incomplete. |
| Impulse yields | Directly queryable from `kind='impulse_failure'` | May count yields; current live dataset had zero rows at audit time. |
| Urges resisted/held | Not persisted server-side; device-local AsyncStorage only | Must not calculate held count or held rate. |
| Check-in lateness | Not reliably persisted | Must not claim definitive lateness/on-time rate from `logged_at`; `created_at` can be delayed by offline queue flush. |
| Check-in compliance | Derivable using frozen grid and answered windows | May compute answered/scheduled windows elapsed, excluding future windows. |
| Actual time spent | Not captured | Do not call `hours_logged` actual hours; it is answered windows x cadence. |
| Validated metric trends | Queryable through `metric_points` joined to `metrics` | May return series for owned, validated, non-archived metrics by default. |
| Daily summary | Derivable | Compute locally with correct timezone and zero-filled days; do not rely on existing view defects. |
| Quest completion day | Not reliably captured | Do not assign completion to deadline date. Quest status/deadline may be reported, not completion date. |
| Goals as structured entities | No `goals` table | Use memory facts/profile routine context only; do not invent a canonical goal list or structured goal progress. |
| Habit history | Not stored; current status mutates in place | May describe current habit records; must not claim historical improvement/decline. |
| Anchor-plan change history | Not stored; upsert overwrites plan | May describe the currently stored plan; must not claim how it changed. |
| Behavioral causal patterns | Inadequate capture (no triggers, duration, intensity, location, or intervention-to-outcome link) | May describe simple counts/time-of-day/weekday distributions where data supports them; no causal claims such as "you relapse because...". |
| Conversation volume | Metadata/counts available | May describe counts/trends; cannot retrieve arbitrary old message text via tool. |
| Previous personal disclosures | Extracted memory facts available, with limitations | Use `search_personal_memory`; qualify source/time and contradictions. |

### Data-capture extensions are future work

Potential future schema/product work includes persisted held-urge events, explicit goal entities and progress history, habit-state event history, anchor-plan revision history, reliable client event timestamps for offline check-ins, and richer activity attributes. None is required to complete this retrieval redesign. Do not fabricate these features in query code.

---

# 12. Performance, reliability, and $0 operating constraint

## 12.1 Cost principles

- Reuse the current Supabase project, Postgres, pgvector, LLM provider adapter, and provider fallback.
- No paid external vector database, reranker, search platform, analytics platform, or agent framework.
- Do not call an LLM merely to classify a tool result when deterministic code is sufficient.
- Do not run personal-data retrieval for every user turn.
- Use SQL aggregation instead of retrieving hundreds of raw rows where possible.
- Execute independent database reads concurrently.
- Reuse query embeddings and static configuration within a request.
- Keep prompt/evidence context bounded.
- Do not assume free provider quotas are unlimited or permanent. On quota exhaustion, use the existing fallback/degrade behavior and do not silently switch to a paid model.

## 12.2 Performance budgets

The Wave 1 audit found that LLM generation dominates current latency and retrieval calls are comparatively small. Actual p50/p95 measurements were unavailable. Therefore:

- Preserve the existing 30-second per-LLM-call timeout and 120-second pipeline deadline unless the current live config has changed.
- Keep ordinary turns near the current generation-call count.
- Execute DB retrieval calls in parallel where independent.
- Apply a per-tool timeout and a total tool execution budget.
- Enforce row/date/result caps before executing SQL.
- Return a controlled insufficient-data/provider-unavailable response when provider quota or database access fails.
- Never make a paid upgrade or silently call a paid endpoint to complete a turn.

Do not invent strict latency SLOs before obtaining a baseline. Record elapsed time using the existing structured logging approach and make a small manual baseline comparison before/after the redesign.

## 12.3 Caching

A per-request cache is allowed for repeated identical configuration reads, user timezone, and identical retrieval arguments. Do not build distributed caching. Cross-turn caching of personal data is out of scope initially because freshness and invalidation are non-trivial.

The existing repeated config reads should be consolidated or cached at the request level, but avoid a broad config refactor unrelated to the retrieval work.

## 12.4 Logging and telemetry

Add compact structured logs for:

- Planner outcome (no retrieval / retrieval requested / invalid plan).
- Tool names invoked.
- Dataset and operation identifiers, not raw content.
- Tool latency, result count, truncation status, and error category.
- Whether an additional retrieval round was used.
- Total pipeline latency and provider/model latency already logged by the adapter.

Do not log raw memory facts, check-in text, journal content, message content, impulse content, access tokens, SQL parameters containing personal data, or full evidence bundles.

---

# 13. Error handling and fallback behavior

| Failure | Required behavior |
|---|---|
| Planner returns malformed JSON | Retry only within existing bounded model retry policy; otherwise skip dynamic tools and produce a safe fallback or clarification. |
| Planner requests unknown tool/field/dataset | Reject the plan; do not execute the invalid request. If other requests are independently valid, execute only if the plan can be safely normalized without changing intent; otherwise fail the retrieval plan as a whole. Prefer whole-plan rejection for malformed structures. |
| User identity missing/invalid | Abort before personal-data retrieval. Existing auth behavior applies. |
| RLS denies access | Treat as authorization failure; never retry with service-role access. |
| Tool timeout | Mark that evidence source unavailable; continue only if remaining evidence is sufficient and response can be qualified. |
| Empty dataset | Return an explicit empty result with range/timezone metadata. Do not invent data. |
| Invalid timezone | Do not silently treat it as the user's local timezone. Use a clearly marked UTC fallback only if safe for the operation, or fail local-day aggregation and ask the user to fix the setting. Log the condition without personal content. |
| Embedding provider failure | Skip semantic retrieval; continue with SQL tools if possible. Do not silently treat an embedding failure as "no memory exists." |
| LLM provider quota/failure | Use the existing Groq fallback if it remains configured and available; never use paid fallback. If all providers fail, use existing holding/retry response. |
| Evidence conflict | Pass conflict markers to generation; ask or qualify rather than arbitrarily choosing. |
| Additional retrieval exceeds budget | Stop retrieval and answer with known evidence plus explicit limitation. |
| Evidence too large | Summarize deterministically or reduce rows at tool layer; do not pass oversized raw records. |

---

# 14. Testing and verification  -  solo-developer plan

This project has one developer and no budget for a months-long evaluation program. The testing plan must be small, risk-based, and integrated into normal implementation. Do not build a separate evaluation platform.

## 14.1 Required minimum tests

Add focused tests to the existing Jest setup. Prefer pure-function tests and a small number of DB integration checks.

### A. Query validation tests

Test that:

1. Unknown datasets, operations, fields, filters, metrics, dimensions, and enum values are rejected.
2. `user_id`, raw SQL, SQL fragments, arbitrary JSON paths, and formulas are rejected.
3. Missing `limit`, excessive limit, date range over 366 days, and excessive list/cursor requests are rejected.
4. `latest` above 20 and memory-fact list above 50 are rejected.
5. Check-in content is capped at 20 rows and 280 characters.
6. `messages.content`, `journal_entries.content`, trust score/delta, formulas, tokens, embeddings, config, jobs, and unsavable rows cannot be selected.

### B. Data semantics tests

Test:

1. Local-day conversion with at least one non-UTC timezone.
2. Invalid timezone behavior (explicit failure or explicit UTC fallback marker).
3. Check-in compliance excludes future windows and uses the frozen grid.
4. `logged_at` is not interpreted as receipt time.
5. `hours_logged` is labeled as cadence-estimated, not actual measured duration.
6. Daily variables zero-fill missing days.
7. Quest completion is not assigned to `quest_deadline`.
8. Metric series joins through metrics ownership and excludes other users' metrics.
9. Unsavable messages and purged memory facts are excluded at query time.

### C. Orchestration tests

Test:

1. A no-retrieval plan executes zero tools.
2. One valid tool request is executed.
3. Multiple independent valid tool requests execute concurrently.
4. Invalid plan is rejected before any query executes.
5. One refinement round can occur; a second refinement is rejected.
6. Empty retrieval results are passed as empty, not fabricated.
7. A tool failure does not trigger service-role bypass.
8. Existing onboarding and primary-reply persistence tests/behavior remain intact.

### D. Retrieval quality smoke set

Create a small hand-reviewed fixture set of approximately 8-12 prompts, not a large benchmark. Include:

- Casual greeting/conversation requiring no retrieval.
- General conceptual question requiring no personal data.
- One check-in count/energy question.
- One two-dataset trend question.
- One previous-personal-context question using memory facts.
- One decision-support question needing both personal data and guiding rules.
- One question where a retrieved rule is irrelevant and must be ignored.
- One question where no required data exists (e.g. held urge history) and the model must abstain.
- One contradiction/stale-memory example.
- One request attempting to obtain excluded/private data.

The expected output should identify which tools/datasets are appropriate and which data must not be invented. This is a smoke test, not a research-grade benchmark.

## 14.2 Manual verification checklist

Before release, manually run the 8-12 fixture prompts against a development/test user with synthetic records and inspect:

- Correct tool selection.
- No needless retrieval on casual/general questions.
- Correct user/timezone scope.
- Correct aggregation values.
- No irrelevant rules forced into answer.
- No hidden or excluded fields surfaced.
- Clear handling of unavailable data.
- Natural user-facing response.
- End-to-end persistence and app display.

Use synthetic or dedicated development data. Do not create test fixtures from real users' sensitive message or journal content.

## 14.3 What not to build

Do not build a separate evaluation dashboard, LLM-as-judge pipeline, large golden dataset, continuous experiment platform, external tracing product, or multi-week manual scoring program. Use existing Jest tests and a short manual smoke checklist. If time is very limited, prioritize authorization, query validation, privacy exclusions, timezone correctness, and no-fabrication behavior over broad prompt-quality scoring.

---

# 15. Implementation plan and sequencing

Deliver as a small vertical slice in the existing codebase. Do not start with broad refactoring.

## Phase 0  -  Reconnaissance and compatibility map

1. Re-open the current branch and confirm the call path from chat UI through `send-message`, `runPipeline`, retrieval functions, prompts, and provider adapter.
2. Inspect `extractContract.ts`, `runPipeline.ts`, `generatePrompt.ts`, `generate.ts`, `adapter.ts`, `retrieveRules.ts`, `memoryContext.ts`, current migrations, and all consumers of existing extraction fields.
3. Map current authenticated Supabase client creation and determine how the user JWT is available to the retrieval executor.
4. Verify all live table names/columns/RLS/ACLs against the Wave 2 registry before coding.
5. Write a concise implementation note listing any mismatch from this PRD. Do not expand scope without approval.

**Exit condition:** the agent can identify exact insertion points and preserve existing contracts.

## Phase 1  -  Secure query foundation

1. Implement the server-side dataset registry and strict query DSL validator.
2. Implement query builders for the most useful initial datasets: `checkins`, `daily_vars`, `metric_series`, `schedule_profile`, and `habits`/`metrics_catalog` as needed.
3. Add the remaining registry datasets without expanding permissions beyond the allowlist.
4. Ensure reads execute under the authenticated user's JWT/RLS context.
5. Implement derived `checkin_compliance` and `daily_vars` using canonical local-time/frozen-grid logic.
6. Add query validation and data semantics tests.

**Exit condition:** deterministic tool calls can return correct fixture-backed data without involving an LLM.

## Phase 2  -  Semantic tools

1. Harden the `match_rules` function and grants.
2. Add cross-domain rule search with configurable limit and relevance cutoff.
3. Harden `match_facts` for authenticated user-scoped invocation derived from `auth.uid()`; never accept arbitrary user identity.
4. Add `search_personal_memory` with `purged_at IS NULL`, query embeddings, and bounded results.
5. Correct query embedding task type to `RETRIEVAL_QUERY` while preserving model/dimension compatibility.
6. Add rule/memory retrieval smoke tests and fixture examples.

**Exit condition:** semantic tools work independently and cannot access another user's content.

## Phase 3  -  Planner and bounded orchestrator

1. Define strict planner JSON schema.
2. Integrate it into the existing pipeline while preserving the extraction contract and classifier/persona behavior.
3. Validate and execute tool requests.
4. Execute independent reads concurrently.
5. Add evidence assembly and one optional refinement round.
6. Feed the evidence bundle to final generation.
7. Preserve existing persistence, onboarding, fallback, and response contracts.

**Exit condition:** one real end-to-end request can choose no tools, one tool, or multiple tools and produce a grounded response.

## Phase 4  -  Privacy hardening and smoke acceptance

1. Verify all excluded fields and content boundaries at the query-builder layer.
2. Verify user JWT/RLS isolation with two synthetic users.
3. Verify unsavable and purged records are excluded.
4. Run the 8-12 prompt smoke set.
5. Check logs for sensitive content leakage.
6. Compare typical model-call count and latency with the pre-change baseline.
7. Fix only release-blocking issues in scope.

**Exit condition:** acceptance criteria in Section 16 pass.

## Suggested implementation priority if time is constrained

P0: authenticated data isolation, SQL query DSL, query validation, core check-in/energy/metric retrieval, no raw message/journal access, no-fabrication behavior.  
P1: personal memory semantic search, cross-domain rules search, daily/compliance derived calculations, bounded refinement round.  
P2: remaining dataset registry operations, lexical fallback, request-level config cache, richer telemetry.

If P0 is not secure and correct, do not release dynamic data retrieval. If time runs short, defer P2 rather than weakening privacy or authorization.

---

# 16. Acceptance criteria / definition of done

The redesign is done when all P0 and P1 criteria below are satisfied, and P2 items are either completed or explicitly deferred.

## 16.1 Functional

- [ ] The planner can return a no-retrieval plan.
- [ ] The planner can request SQL personal data, semantic memory, and guiding-rule search.
- [ ] At least two independent tools can execute concurrently.
- [ ] One additional retrieval round is possible and hard-limited.
- [ ] Final generation sees a compact evidence bundle rather than raw unrestricted query output.
- [ ] The model can ignore irrelevant rules/facts and can say when data is unavailable.
- [ ] Existing chat response contract and persisted reply behavior remain compatible with the client.

## 16.2 Data correctness

- [ ] Dataset registry matches the current live schema.
- [ ] All date/day grouping uses profile-local timezone and states the day basis.
- [ ] Invalid timezone behavior is explicit.
- [ ] Check-in compliance uses the frozen grid and excludes future windows.
- [ ] No definitive late/on-time claim is derived from `logged_at` or unverified `created_at` semantics.
- [ ] `hours_logged` is described as schedule-estimated.
- [ ] Quest completion is not inferred from deadline.
- [ ] Habit/plan/goal/urge history claims respect the data limitations.
- [ ] Metric ownership is always verified through the parent metrics row.

## 16.3 Security and privacy

- [ ] No model-supplied user ID is accepted.
- [ ] Every personal data request is authenticated and user-scoped.
- [ ] No raw SQL or unrestricted field selection is possible.
- [ ] Unsavable message content is never returned or searched.
- [ ] Purged memory facts are never returned.
- [ ] Journal and conversation content are not exposed through the tool layer.
- [ ] Trust score/delta, persona stats, push tokens, config, jobs, formulas, and embeddings are excluded.
- [ ] No service-role bypass is used to recover from RLS denial.
- [ ] The `match_rules` ACL/search_path drift is addressed or documented as a release blocker with a mitigation.

## 16.4 Reliability and cost

- [ ] No paid service or new paid dependency is introduced.
- [ ] Provider quota failure degrades safely without paid fallback.
- [ ] Tool calls obey date, row, and execution budgets.
- [ ] Logs contain operational metadata only, not sensitive user content.
- [ ] Existing provider fallback and request deadline handling remain functional.

## 16.5 Test completion

- [ ] Focused validator tests pass.
- [ ] Data semantics tests pass.
- [ ] Orchestration tests pass.
- [ ] Existing relevant test suite passes.
- [ ] Manual smoke set passes on synthetic development data.

---

# 17. Open decisions and explicit unknowns

These are not reasons to stop drafting or to invent functionality. The implementation agent must surface them during Phase 0 and use the safe default below unless the product owner decides otherwise.

| Question / unknown | Safe default for first release |
|---|---|
| Are current provider model names and free quotas still available? | Re-check current configuration; use existing adapter/fallback only; do not add paid endpoints. |
| Is the existing extraction call combinable with planner output? | Combine only if every existing extraction field and consumer is preserved. Otherwise keep the separate call. |
| Is user JWT available to `runPipeline` query clients? | Propagate the verified request JWT to a user-scoped Supabase client. Never fall back to service-role arbitrary queries. |
| Should old raw messages/journals be searchable? | No. Use recent context and memory facts only. A separate privacy decision is required to change this. |
| What exact threshold gives good rule/memory relevance? | Add a configurable threshold and calibrate with a small hand-reviewed set; do not guess a universal value. |
| What are actual p50/p95 latencies and provider quota headroom? | Unknown from the audits. Measure a small before/after sample using existing logs. |
| Is the profile timezone always valid? | Validate. On invalid value, do not silently claim local-day accuracy. |
| Is `doings_logs.source='chat'` still written? | Treat as legacy/unverified until a code path confirms an active writer. |
| What is the retention policy for messages and doings? | No retention policy was found in the audits. Do not introduce deletion/retention behavior in this change; raise as a separate product/privacy decision. |
| Should new data capture be added for held urges, goal entities, habit history, and plan history? | No schema expansion in this retrieval release. Track as separate future work. |
| Does Davos already have a safety escalation path for minors or high-risk disclosures? | Verify before production use with minors. Do not invent a workflow within this PRD. |

---

# 18. Code areas and database objects to inspect

The following names are from the two audits. Paths and line numbers may shift; search for symbols rather than blindly applying line edits.

## 18.1 Chat and orchestration

- `app/(app)/chat.tsx`
- `lib/chatService.ts`
- `supabase/functions/send-message/index.ts`
- `supabase/functions/send-message/runPipeline.ts`
- `_shared/llm/adapter.ts`
- `generate.ts`
- `generatePrompt.ts`
- `extractContract.ts`
- `retrieveRules.ts`
- `memoryContext.ts`
- `recentContext.ts`
- `guardrails.ts`
- `delimiters.ts`
- `geminiSchema.ts`

## 18.2 Data and existing services

- `lib/todayService.ts`
- `lib/proofService.ts`
- `lib/metricsService.ts`
- `lib/metricsData.ts`
- `lib/checkinGrid.ts`
- `lib/checkinCounts.ts`
- `lib/urgeService.ts`
- `domain/daySnapshot.ts`
- `supabase/functions/submit-checkin/index.ts`
- `supabase/functions/log-impulse/index.ts`
- `supabase/functions/flag-unsavable/index.ts`
- Memory extraction and purge handlers.

## 18.3 Database objects

- `doings_logs`
- `messages`
- `journal_entries`
- `anchor_plans`
- `habits`
- `metrics`
- `metric_points`
- `trust_events`
- `memory_facts`
- `persona_stats` (must remain excluded)
- `profiles`
- `metric_vars_daily` (do not expose directly as the new authoritative daily summary without correcting its semantics)
- `rules`
- `exemplars`
- `config` (must remain excluded from model retrieval)
- RPCs: `match_rules`, `match_facts`, `match_exemplars`, `save_anchor_plan`, plus relevant migrations and grants.

---

# 19. Source audit references

This PRD is based on these two source audits. They were read-only and performed on 14 November 2026. The implementation agent should re-verify the current branch and live database before making changes.

1. **Davos RAG / Chatbot Architecture Audit (Wave 1).** Covers request lifecycle, vector search, document model, SQL/RPC surface, LLM integration, prompt behavior, security, performance, tests, and existing technical debt. Key findings: Sections 2-3 (request/retrieval), 5-8 (SQL/LLM/prompts/security), 9-11 (performance/testing/debt).
2. **Wave 2  -  Personal Data Retrieval Audit.** Covers live personal-data schema, direct vs. derived data, reusable services, query capability, safe-operation matrix, dataset registry, and known defects. Key findings: Sections 1-4 (datasets/schema/services), 5-8 (capabilities/provenance/tool rules/registry), 9-10 (defects and unknowns).

The normative implementation requirements are in this PRD. If an audit observation and this PRD appear inconsistent, preserve the stricter privacy/security constraint and raise the conflict rather than silently weakening it.

---

# 20. Final engineering direction

Build Davos as a **controlled personal-data reasoning system**, not an unrestricted autonomous agent.

The model decides what information would help answer the user's question. The application validates that request, retrieves only approved data for the authenticated user, preserves source and time semantics, filters irrelevant evidence, and gives the model a bounded opportunity to refine retrieval. The final answer may use common sense for explanation, but all claims about the user's actual life must be grounded in available records or explicitly qualified.

The first release should be small enough for one developer: secure SQL query tools, memory/rule search, structured planning, evidence assembly, one optional refinement round, and focused tests. Do not let the design expand into a new platform. Do not trade away privacy, data correctness, or the $0 constraint for extra autonomy.
