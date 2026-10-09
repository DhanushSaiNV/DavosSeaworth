# Architecture Audit: decisions1.md vs ULTIMATE-PRD1.md

**Scope note before verdicts:** decisions1.md repeatedly cites predecessor documents (`decisions-review1.md`, `decisions-review1_2.md`, "Round 1") that were not provided. I can only validate the final decision state against the PRD. Also, the document's own numbering is broken — 17 decision rows exist, only some carry labels ("Decision 6", "Decision 7 Update", etc.), and several rows are unlabeled. I reference them below as **D1–D17 in document order**. Renumber before TECH-SPECS or cross-references will be ambiguous.

---

## 1. Per-Decision Audit

**D1 — Universal App (React Native via Expo Router)**
- **PRD served:** §3.0 chat-primary UI; §3.1 check-ins via persistent notification/widget; §3.2 interception via persistent widget/notification.
- **Verdict:** Partial
- **Issues/Risks:** (a) The rationale claims the PRD requires accessibility on desktop/web — the PRD never mentions web or desktop; web is added scope, not a requirement. (b) The "single TypeScript codebase" claim is materially false for the widget requirement: iOS WidgetKit / Android AppWidget require native Swift/Kotlin modules + Expo config plugins; widgets live outside the RN codebase entirely. (c) PRD says "notification **or** widget," so notification-only is compliant — the native widget work is optional but the decision doesn't say so.
- **Recommended change:** Reframe as mobile-first Expo app; declare web best-effort (not a tested requirement); explicitly scope home-screen widgets as native-module work or defer them to persistent notifications for beta.

**D2 — Database-backed cron polling**
- **PRD served:** §3.0 proactive engagement; §3.1 (verbatim: "background database polling"); §3.2 multi-day silent Strike tracking.
- **Verdict:** Aligned
- **Issues/Risks:** (a) PRD §3.1/§4.3 require "immediate/instant" evaluation and intervention — a minute-cadence poll is a different contract; the synchronous vs. asynchronous execution split is never drawn. (b) Retry/error handling is acknowledged as manual but undesigned. (c) Mechanism gap: pg_cron cannot invoke Edge Functions natively (needs pg_net); invocations are fire-and-forget with no retry or observability — contradicting this decision's own "write the retry logic" intent. (d) Its context line cites "weekly analysis," which does not exist in the current PRD (drift evaluation is continuous per §3.1) — stale carryover.
- **Recommended change:** Define two execution entrypoints: client-invoked synchronous (chat replies, check-in ingestion + evaluation) and cron-invoked asynchronous (proactive, strike, drift); make cron write a jobs table with status so failures are visible and retryable.

**D3 — Postgres + pgvector (Supabase), client-side pre-filtering**
- **PRD served:** §2 Doings Memory Engine; §3.4 Permissioned Extraction (opt-out "Unsavable" flag).
- **Verdict:** Aligned
- **Issues/Risks:** Pre-submission stripping is one valid reading of §3.4, but chat messages can only be flagged *after* sending — so the system has two different enforcement points (see D6). Late flagging → purge of already-stored vectors is undefined. Boundary is client-trusted (acceptable for a beta where the client's user is the data subject).
- **Recommended change:** Define flag semantics once in TECH-SPECS: pre-submission strip for journal composition; post-submission flag with purge for chat.

**D4 — PRD-mapped sequential pipeline**
- **PRD served:** §2 Rules Engine cross-referencing + Dynamic Persona Engine; §3.0 agentic interface.
- **Verdict:** Partial
- **Issues/Risks:** (a) The pipeline has no stage or outcome for PRD §2's **Medium** confidence (present 2–3 persona options for user selection) and **Low** confidence (explicitly prompt user to define interaction mode). Only the total-failure fallback (D7) is handled. (b) §2's "ensuring no contradictory advice" requires a conflict-resolution/dedup step in Rule Retrieval — absent. (c) The pipeline depends on a deterministic classifier that no decision designs. (d) Execution context (client-sync vs. cron) undefined, which is what determines the D12 timeout exposure.
- **Recommended change:** Add a persona-confidence stage with all three tier outcomes; add rule-conflict filtering; specify the classifier contract (inputs/outputs/confidence score) even if implementation is deferred.

**D5 — Embeddings via Supabase Edge Functions + Gemini free tier**
- **PRD served:** §2 Doings ingestion; §3.4 permission boundary before RAG ingestion.
- **Verdict:** Aligned (material risk)
- **Issues/Risks:** Single point of failure: Google free-tier limits or model deprecation breaks the *entire* memory subsystem (rules seeding, doings, journals, chat memory). No fallback path. Embedding model must be frozen — switching models later invalidates every stored vector; no versioning strategy.
- **Recommended change:** Record embedding model/version in metadata; decide a second free provider as fallback before TECH-SPECS.

**D6 — Chat memory: selective extraction + implicit auto-ingest**
- **PRD served:** §3.4 Permissioned Extraction applied to chat messages (opt-out flag) — verbatim match.
- **Verdict:** Aligned
- **Issues/Risks:** (a) The flag is honored at extraction time; if extraction already ran, flagging later does nothing — and the decision itself admits wrong facts become "permanent… won't easily see to correct," which weakens the very §3.4 permission model it claims to satisfy. (b) The decision justifies itself via an agreement ("you established a new global rule") documented only in files not provided — an unstated external dependency. (c) Extra LLM call per conversation chunk (cost on the constrained pipeline).
- **Recommended change:** Specify flag-vs-extraction timing and a purge-on-late-flag behavior. A "what I remember" review surface is an optional mitigation, not a PRD requirement — decide explicitly whether to include it.

**D7 — Classifier fallback: Safe Inquirer default**
- **PRD served:** §2 Classifier Fallback — verbatim.
- **Verdict:** Aligned
- **Issues/Risks:** Restates the PRD without adding design (what the fallback state contains; how the *next* message re-routes out of it).
- **Recommended change:** None beyond specifying the fallback state record.

**D8 — Persona confidence: "Amend the PRD to Adaptive Statistical Model"**
- **PRD served:** §2 — but see issue.
- **Verdict:** Partial (stale record; substance matches)
- **Issues/Risks:** **The decision's premise contradicts the provided PRD.** It states "The PRD explicitly requires 'Machine Learning'" — ULTIMATE-PRD1.md §2 already specifies the "Adaptive Statistical Weighting System… replacing standard ML model overhead." Either the amendment was already applied (decision is moot and must be closed, not carried open into TECH-SPECS), or you are holding a different PRD version than the one given as source of truth.
- **Recommended change:** Mark resolved/closed and confirm PRD version (see Open Questions). No open "amend the PRD" action should survive into TECH-SPECS.

**D9 — Hybrid check-in submission (direct reply + deep-link fallback)**
- **PRD served:** §3.1 Interval Check-ins ("via OS direct reply or deep link" — verbatim); §4.2–4.3.
- **Verdict:** Partial
- **Issues/Risks:** (a) **Omits the PRD-required 1–10/emoji energy rating.** OS direct reply is a single text field; no mechanism is decided (parse a trailing digit? notification action buttons?), yet D14's task assignment depends on this data. (b) "Schedule the next interval check-in only after response" creates a chain-break: one missed reply stops all future local check-ins — while §4.3 requires ignored-check-in interventions. No server-side watchdog/re-arm is decided. (c) Evaluation delegated to the cron worker re-introduces the "immediate" ambiguity.
- **Recommended change:** Decide energy capture (e.g., quick-tap notification actions for coarse levels + digit parsing from reply text); pre-schedule a rolling window of local check-ins with server-side missed-check-in detection re-firing Expo remote pushes; run evaluation synchronously at ingestion.

**D10 — Flexible formula schema + constrained visualization**
- **PRD served:** §3.5 Progressive Metric Onboarding — verbatim, including the JSONLogic example and pre-built registry constraint.
- **Verdict:** Aligned
- **Issues/Risks:** The option list names Math.js and "parameterized SQL" as candidate evaluators — Math.js `eval` has documented sandbox escapes, and AI-authored SQL (even parameterized) is an injection surface. Validation of AI-generated formulas before persistence is unspecified.
- **Recommended change:** Commit to JSONLogic only; add a validation layer (whitelisted operators, numeric bounds) before storing any AI formula.

**D11 — Tiered Proof Architecture (Strike)**
- **PRD served:** §3.2 Bad-Habit Diagnosis — the three tiers verbatim.
- **Verdict:** Aligned
- **Issues/Risks:** Strike *initiation* ("user refuses to quit a bad habit") is undefined — how is refusal detected? "$X$ days" has no value or source. Strike message delivery path (push + chat) implied but unstated.
- **Recommended change:** Define refusal-detection heuristic and make X a configurable per-habit parameter; specify delivery.

**D12 — All-in-One Supabase (Edge Functions + pg_cron)**
- **PRD served:** None directly (infrastructure); external zero-budget constraint.
- **Verdict:** Partial
- **Issues/Risks:** (a) **Unverified free-tier viability:** Edge Function execution limits vs. a multi-step pipeline of sequential LLM calls (D4, D16 probing, Strike generation). The decision flags this but its escape hatch (paid VPS) violates the zero-budget constraint it cites as the reason for choosing Option 3 — i.e., the plan has no valid failure path. (b) Free-tier projects auto-pause after inactivity; whether pg_cron/pg_net activity prevents pausing must be verified — if not, all proactive features (the core differentiator) die silently. (c) pg_cron → Edge Function invocation via pg_net is fire-and-forget (no retries), contradicting D2's stated retry intent.
- **Recommended change:** Verify current limits before TECH-SPECS; design cron jobs to write a jobs table (status/backoff); decide a genuinely zero-cost fallback (e.g., splitting the pipeline into shorter function invocations).

**D13 — Non-LLM persona guardrails: few-shot + structural anchoring**
- **PRD served:** §3.0 Non-LLM Persona Guardrails — verbatim, including the explicit ban on regex post-processing and retry-loop regeneration.
- **Verdict:** Aligned
- **Issues/Risks:** The anchored JSON (`tactical_analysis` + `direct_quote`) ships internal reasoning to the client unless stripped server-side. Structured-output reliability depends on the (undecided) LLM provider's JSON mode.
- **Recommended change:** Strip internal fields server-side; pin the provider's structured-output capability.

**D14 — Just-in-time blocking + lightweight energy scale**
- **PRD served:** §3.1 Context-Aware Day Planning — verbatim (JIT blocking, energy-based assignment, conversational approval for rescheduling, boredom-relief).
- **Verdict:** Aligned
- **Issues/Risks:** (a) Depends on energy data whose capture mechanism is unresolved (D9). (b) Free-block detection method undefined. (c) **Tension with PRD §4.4**, which requires Davos to output a "deadline-bound plan for the next day" after journaling — this decision's "no bird's-eye view" trade-off conflicts with an evening next-day plan.
- **Recommended change:** Reconcile explicitly: evening output = next-day hard commitments/deadlines; free-block task assignment remains JIT.

**D15 — Dynamic drift detection + dashboard quest integration**
- **PRD served:** §3.1 Long-Term Foresight & Side Quests — verbatim (polling, drift, deadline-bound quests, temporary registry components).
- **Verdict:** Aligned
- **Issues/Risks:** Cites pg_cron "sub-minute scheduling" as a benefit — unnecessary cadence, wasted free-tier DB compute, and lock contention the trade-off itself warns about. Temporary-metric lifecycle (creation/expiry/cleanup) unspecified.
- **Recommended change:** Set drift cadence to 5–15 minutes or event-trigger on ingestion; specify quest component cleanup.

**D16 — Hybrid journaling flow**
- **PRD served:** §3.4 End-of-Day Journaling — verbatim (brain dump + targeted probing for vague/severe entries).
- **Verdict:** Aligned
- **Issues/Risks:** Adds an LLM evaluation call per entry on the same constrained pipeline; "vague or signals severe issues" classification criteria undefined; probe delivery when the app is closed (push path) implied but unstated.
- **Recommended change:** Define vagueness/severity heuristics; reuse the D4 classifier contract rather than an ad-hoc prompt.

**D17 — Immediate conversational onboarding + pre-seeded rules**
- **PRD served:** §4.1 (verbatim: zero forms, Davos speaks first, conversational assessment); §2 pre-seeded universal rules.
- **Verdict:** Aligned
- **Issues/Risks:** Onboarding resume state machine acknowledged as needed but undesigned; §3.5 says the user "initially selects 1–2 core metrics" while §4.1 says metrics come via dialogue — reconcile (selection offered conversationally); the 100+ rules / 16 domains / 50+ figures library is a content deliverable with no sourcing/owner defined.
- **Recommended change:** Specify onboarding state persistence; list the rules-library authoring/seeding migration as an explicit deliverable.

---

## 2. PRD Requirements Not Covered by Any Decision

1. **§2 Dynamic Persona Engine, Medium and Low confidence flows** — presenting 2–3 persona options for user selection; explicitly prompting the user to define interaction mode. Only the total-failure fallback (D7) is decided. The confidence *score production* and *tier UX* are entirely absent.
2. **§3.3 The Oath** — the hidden Trust/Openness Score (definition, computation, threshold), breakthrough-acknowledgment detection, oath storage, and the "day-1-to-now summary" generation/re-presentation. Entire subsystem, zero coverage (also §4.5).
3. **§3.3 Anti-Quit Protocol / Dialog State Lockdown** — give-up/false-constraint detection, topic-change blocking, concession detection. Zero coverage.
4. **§3.3 Fact-Based Confrontation** — BS-excuse detection (distinct from generic domain classification). Zero coverage.
5. **§3.2 Urge prediction & preemptive interception** — predicting time/context of future urges from logged failures, scheduling preemptive notifications, and sourcing "high-dopamine alternative activities." D9 covers only the check-in loop. Impulse-failure logging UX via the persistent widget/notification is also undecided.
6. **§3.1 Energy rating capture mechanism** — referenced by D14 but no decided input path (see D9).
7. **§4.4 Evening "deadline-bound plan for the next day"** — unresolved and in direct tension with D14.
8. **§3.4 Proactive Conversationalist profile-gap detection** — what model determines "missing gaps in the user's profile" and triggers questions; D2 lists trigger categories only loosely.
9. **The deterministic domain/emotional-state classifier itself** — referenced by D4/D7/D8 but never designed.

---

## 3. Internal Inconsistencies / New Issues Found

1. **D8's premise contradicts the provided PRD** ("PRD explicitly requires Machine Learning" vs. PRD §2's already-amended statistical weighting system). Stale or version-mismatched record — must be resolved before specs.
2. **LLM provider assumptions conflict across the document:** D5/D13 assume Gemini; D12 says "Groq/Gemini." No decision names the primary generation model.
3. **Permission enforcement split-brain:** journaling = pre-submission client strip (D3/D5); chat = post-submission flag honored at extraction time (D6). No purge path for late flags or wrongly extracted "permanent" facts — which the D6 trade-off itself admits — undermining the §3.4 model the document claims to satisfy.
4. **"Immediate evaluation" (§3.1, §4.3) vs. minute-cadence polling (D2) vs. ingestion-endpoint loop (D9):** three inconsistent descriptions of when evaluation runs; the sync/async split is never drawn.
5. **Check-in chain-break:** D9 schedules the next local check-in only after a response; one missed reply kills all future check-ins, with no server-side re-arm — yet §4.3 requires ignored-check-in interventions.
6. **D12's fallback (paid VPS) contradicts the hard zero-budget constraint** that motivated the choice — the architecture has no valid failure path if Edge Function limits are hit.
7. **pg_cron → Edge Functions is fire-and-forget** (via pg_net, no retries, no observability), contradicting D2's stated intent to hand-write retry logic; nothing designs the retry state machine.
8. **D1's "single codebase" claim vs. native Swift/Kotlin widget work** required by any home-screen widget.
9. **PRD §4.4 evening next-day plan vs. D14's no-full-day-view trade-off** — carried forward unreconciled.
10. **D2's context references "weekly analysis,"** which does not exist in the current PRD — stale carryover from an earlier version.
11. **Broken decision numbering:** 17 rows, mixed labeled/unlabeled/"Update" labels, fragile cross-references ("Decision 6").
12. **D9/D13 ship internal reasoning fields to the client** unless stripped server-side; **D10 lists known-unsafe evaluators** (Math.js eval, AI-authored SQL) alongside the safe one the PRD itself names.

---

## 4. Missing Decisions

1. Primary LLM provider/model for all generation stages (chat, extraction, journal evaluation, Strike, formula generation) + rate-limit behavior and user-facing failure UX.
2. Deterministic classifier design (domain + emotional state + confidence score).
3. Persona confidence tier UX and threshold storage (Medium/Low flows per §2).
4. Trust/Openness Score computation and the Oath subsystem (trigger, storage, day-1-to-now summary, re-presentation).
5. Anti-Quit Dialog State Lockdown state machine + excuse/give-up detection.
6. Urge prediction algorithm, preemptive notification scheduling, alternative-activity content source.
7. Energy-rating capture in direct replies (blocks D9 and D14).
8. Chat transport and storage (Supabase Realtime vs. polling), message schema, offline queueing.
9. Strike parameters: refusal detection, X-days value, escalation ladder.
10. Memory management: viewing/deleting extracted facts; purge on late "Unsavable" flags.
11. Auth provider (implied Supabase Auth — confirm) and Expo push-token/permission lifecycle.
12. Home-screen widget scope (native modules) vs. notification-only for beta.
13. User profile/routine data model produced by onboarding (check-in cadence, fixed routines, hard deadlines — D14 depends on it).

---

## 5. Open Questions for You

1. **D8/PRD authority:** The provided PRD already specifies the statistical weighting system. Is Decision 8's amendment already executed (I'd then mark it closed), or is there a different PRD version in circulation? My verdict on that row depends on your answer.
2. **Is web/desktop actually in scope?** D1 justifies the Universal App partly by desktop users, but the PRD never mentions them. Mobile-only shrinks the auth/deep-link/testing surface considerably.
3. **Is notification-only acceptable** for the "persistent notification or widget" requirements (§3.1/§3.2) in beta, deferring native widget modules?
4. **Which LLM provider is primary (Gemini vs. Groq), and is the budget a hard $0** or is a small monthly ceiling available (this determines whether D12's VPS fallback is real)?
5. **Can you verify current Supabase free-tier limits:** (a) Edge Function max duration for multi-LLM-call pipelines, (b) whether pg_cron/pg_net activity prevents the inactivity auto-pause? D2, D5, D12 all rest on these unverified assumptions. If you can't verify, they should be treated as blocking spike items before TECH-SPECS.
6. **Strike parameters:** what value/source for "$X$ days," and what counts as "refusing to quit"?
7. **"Unsavable" flag semantics:** pre-submission strip only (as D3/D5 implement), or must post-submission flagging purge already-extracted memories (the more literal reading of §3.4)?

---

## 6. Readiness for TECH-SPECS.md

**Not ready.** Blocking items:

1. Resolve the D8/PRD-version contradiction — the requirements source of truth must be unambiguous before specifications are written.
2. Decide the missing subsystems in §4 items 1–6 (LLM provider, classifier, persona confidence tiers, Oath/Trust Score, Anti-Quit lockdown, urge prediction). These are PRD-mandated features with zero architectural coverage; TECH-SPECS cannot be complete without them.
3. Verify Supabase free-tier execution limits and auto-pause behavior — D2/D5/D12 all depend on unverified assumptions that could invalidate the entire backend approach.
4. Fix the D9 energy-capture gap and check-in chain-break — §3.1 and D14 both structurally depend on them.
5. Renumber/relabel decisions1.md and close stale "Update" records so TECH-SPECS can reference decisions unambiguously.

Non-blocking but recommended before specs: reconcile §4.4's evening plan with D14; commit D10 to JSONLogic; define the synchronous/asynchronous execution split; define flag-purge semantics for chat memory.