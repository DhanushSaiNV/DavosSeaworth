# AGENTS.md — Davos: AI-Powered Life Mentor & Coach

Binding rules for any AI agent or contributor working in this repository. If a task contradicts this file, stop and ask the owner. Never resolve ambiguity by inventing behavior.

## 1. Project identity

- One product: **Davos**, a chat-first AI life coach. Expo Router app (iOS + Android + Web, co-equal platforms), Supabase all-in-one backend, RAG over "doings" data.
- Context: solo developer, **$0 infrastructure budget**, **5 beta users** capacity basis.
- Read `docs/ULTIMATE-PRD1.md` §1–2 and `docs/TECH-SPEC.md` §1 before your first task.

## 2. Source-of-truth documents

| File                     | Authority over                                                   |
| ------------------------ | ---------------------------------------------------------------- |
| `docs/ULTIMATE-PRD1.md`  | Product intent and requirements                                  |
| `docs/adr/decisions2.md` | Architecture decisions D1–D25 and their rationale ("why")        |
| `docs/TECH-SPEC.md`      | Implementation details: schemas, contracts, job registry, limits |
| `docs/GLOSSARY.md`       | Terminology and naming conventions (§1–§16)                      |

**If docs conflict, resolve by domain:**

1. Product intent → `ULTIMATE-PRD1.md` wins.
2. Architectural choice or rationale → `decisions2.md` wins.
3. Implementation details → `TECH-SPEC.md` wins.
4. Terminology or naming → `GLOSSARY.md` wins.

**Additional precedence rules:**

- `decisions1.md` and all `decisions-review*.md` files are **superseded**. Never cite or reopen them.
- The PRD at `docs/ULTIMATE-PRD1.md` is the amended, authoritative version. Any copy requiring "Machine Learning" for persona adaptation is obsolete.
- Web scope is an owner decision (D1), not PRD-derived. Do not derive web features from the PRD.
- Values marked **[SPEC]** in TECH-SPEC.md are tunable defaults. Read them from the `config` table at runtime; never hardcode them into logic.
- **A feature with no PRD section, no D#, and no TECH-SPECS § does not exist.** Do not implement it. Propose it to the owner.
- Never edit `ULTIMATE-PRD1.md`. PRD amendments are owner actions recorded as decisions (precedent: D8).

**Reference convention:** A bare `§N` always refers to a section of this file. References to other documents are always doc-qualified — `TECH-SPECS §N`, `GLOSSARY §N`, `PRD §N`.

## 3. Non-negotiable constraints

**Money & infrastructure:**

1. $0 budget. Never add a paid service, paid tier, or anything requiring a credit card. Rejected options (VPS, Inngest, Temporal, Render, Pinecone, MongoDB Atlas) stay rejected.
2. All backend compute runs inside Supabase: Edge Functions (Deno), pg_cron, pgvector, the `jobs` table. Never introduce another server, database, message broker, or orchestration framework.
3. The cron-job.org keep-alive ping to the `health` function is **mandatory** (free projects auto-pause after 7 days). Never remove, disable, or "clean it up."
4. Design every load against the 5-user capacity plan (TECH-SPECS §12). No per-minute LLM polling, no unbounded loops, no fan-out exceeding the quota math.

**Models & providers:** 5. Every LLM/embedding call goes through the provider adapter (§4.1). Never import a Gemini/Groq SDK into feature code. 6. Embedding identity is frozen: `gemini-embedding-001@768`. Never change model or dimensionality without a deliberate re-embedding migration job (D5). 7. Persona adaptation is the Adaptive Statistical Weighting System (`persona_stats`, D8). Never introduce an ML pipeline, online training, or model hosting. 8. Synchronous invocations must finish inside 150 s (verified limit). Long work is split into chained job types (D12 pattern), never stretched inside one function.

## 4. Security and permission boundaries

A violation in this section is always a bug, regardless of feature value.

1. Every user-scoped table carries `user_id` + RLS policy `auth.uid() = user_id`. Service-role writes happen only inside Edge Functions.
2. Journal "Unsavable" text is stripped **client-side before transmission**. The server must never receive, store, or log flagged journal text.
3. `tactical_analysis` (internal LLM reasoning) is server-only. It must never reach the client, the `messages` table, or client-visible logs.
4. The only evaluable code in the system is JSONLogic through the validation gate (TECH-SPECS §7.9). Never add Math.js, `eval`, `new Function`, or AI-authored SQL. Use the whitelisted ops and the variable enum exactly as specced.
5. API keys live only in Supabase Edge Function secrets — never in the client bundle, migrations, or docs.
6. Wrap all user text in delimiters in every prompt and instruct the model to ignore embedded instructions (TECH-SPECS §10).
7. `trust_score` is hidden by design. Never render it in any UI or API response to the client.
8. Oath memory facts are non-purgeable by design (TECH-SPECS §5.4). Do not extend the purge mechanism to them.

## 5. Persona guardrails (PRD-mandated bans)

1. No regex post-processing of LLM output — banned by PRD §3.0.
2. No retry-loop regeneration. The only permitted retry: one bounded attempt after a structural JSON parse failure, then the fallback reply (TECH-SPECS §4.2).
3. The generation contract is the anchored JSON schema (TECH-SPECS §4.2). Add or rename fields only through a TECH-SPECS revision, never ad hoc.

## 6. Change protocol

**Before coding:**

1. Read every governing reference for the task (PRD §, D#, TECH-SPECS §) before writing code, then cite them in the commit/PR. A task with no governing reference is out of scope (§2) — ask the owner.
2. Read the GLOSSARY entries for every domain term in the task.

**While coding:** 3. Follow the naming conventions (GLOSSARY §10): tables plural `snake_case`; job types `verb_noun`; Edge Functions `kebab-case` verb-first; config keys `snake_case`; deep links `davos://chat?focus=…`. 4. New asynchronous work = a new job type in the `jobs` table. Handlers must be idempotent. Register the type in TECH-SPECS §2.3 and GLOSSARY §12 in the same change. 5. New term or identifier = new GLOSSARY entry in the same change (GLOSSARY maintenance rule).

**After coding:** 6. Update every doc you touched, in the same change: schema → TECH-SPECS §3 + GLOSSARY §11; enum → GLOSSARY §14; config value → GLOSSARY §11 registry; job type → TECH-SPECS §2.3 + GLOSSARY §12. 7. Run the §9 checklist.

## 7. Platform and runtime rules

1. UI uses React Native primitives (`<View>`, `<Text>`). Never use HTML DOM elements. Web renders through the same Expo Router routes (D1).
2. Home-screen widgets are out of beta (D1). Do not write WidgetKit/AppWidget code; persistent notifications satisfy the PRD's "notification or widget."
3. Edge Functions run on Deno. Verify every dependency is Deno-compatible before adding it.
4. Web has no OS direct reply and no headless tasks. Use the defined web fallbacks: Web Push → chat deep link; in-app check-in banner; energy chips in-chat.
5. Follow the migration order (TECH-SPECS §3.5) and implementation order (TECH-SPECS §14). Do not reorder phases without owner approval.
6. Severity routing is fixed and approved: S1/S2 exit lockdown and force the empathetic persona (TECH-SPECS §11). Do not alter this gating (D16/D21) without an owner decision.
7. `dialog_state`, onboarding stage, and habit watch state persist server-side across sessions. Never hold them client-only.

## 8. Blocking assumptions and content you must not invent

**Do not rely on these until the owner confirms (TECH-SPECS §13):**

1. Groq JSON mode / structured output — until confirmed, the degrade path (schema-in-prompt + single parse retry) is the implementation.
2. Supabase Realtime free-tier message quota.
3. Built-in SMTP magic-link deliverability.
   State the dependency explicitly in the PR/commit when a change rests on any of them.

**Owner content deliverables — build the schema, never author the content:** 4. Rules library (100+ rules), exemplar sets, the 16-domain enum, few-shot exemplar pairs. Placeholder seeds must be clearly labeled placeholders, never presented as final content.

**Content drafting rule (BG-01 amendment, per `docs/feature-prds/FP-BG/FP-BG.md` §2.1):** Agents may draft owner-content (rules, exemplars, few-shot pairs, onboarding scripts) only in `content/`, with `status=draft` and a visible DRAFT label. Only owner-approved content (`status=approved`) may be seeded via content migrations. Placeholders remain labeled and are never presented as final content.

## 9. Pre-completion checklist (run on every change)

- [ ] RLS present on every new table
- [ ] No secrets in client code or migrations
- [ ] No new paid services, external servers, or third-party infrastructure (§3.1–3.2)
- [ ] All model/embedding calls go through the provider adapter — no direct SDK imports in feature code
- [ ] No regex on LLM output; no unbounded retry loops
- [ ] No HTML/DOM elements — React Native primitives only (§7.1)
- [ ] `tactical_analysis` stripped server-side
- [ ] `trust_score` never rendered in UI or client API responses (§4.7)
- [ ] New job types: idempotent, registered in TECH-SPECS §2.3 + GLOSSARY §12
- [ ] New terms/identifiers added to GLOSSARY
- [ ] Quota impact checked against TECH-SPECS §12 (5-user basis)
- [ ] [SPEC] values read from `config`, not hardcoded
- [ ] Journal strip remains client-side; flagged text never transmitted
- [ ] Docs updated in the same change
- [ ] Governing references cited in the commit/PR

## 10. When in doubt

1. If any document listed in §2 is missing from the repo, stop and report. Never proceed from memory of a document seen elsewhere.
2. Consult the four documents in §2, in the stated precedence.
3. If still unresolved, **ask the owner** — the correct answer is a question, not a guess.
4. Ambiguity about product intent is never yours to settle; ambiguity about a [SPEC] value is settled by `config`, not by hardcoding.
