# FP-09-ACCEPTANCE.md — Acceptance Ledger: Onboarding Interview, Proactive Conversationalist & Content Migrations

**Companion to:** `docs/feature-prds/FP-09/FP-09.md` ↔ `docs/feature-prds/FP-09/FP-09-PLAN.md`
**Gates:** `scripts/verify-fp09-step1.py` … `scripts/verify-fp09-step8.py` · **Governed by:** `AGENTS.md`
**Status:** Step 8 agent work complete. `FP-09.md` remains **DRAFT**; the BG-06 opening is approved/live, the stage scripts remain DRAFT, and AC-12 stays owner-pending.

---

## 1. AC Ledger (parsed from FP-09.md)

| AC | Description | Evidence Tag | Status |
|----|-------------|--------------|--------|
| AC-1 | Migration: clean/idempotent `0033`; zero columns beyond `0032`; the trigger plants exactly one opening row (tag, stage, no `persona_key`); the backfill is once-only; the tick truth table (windows, silence boundary, onboarding gate, any-status dedup, kill switch); eight keys fail-closed | `[script]` `verify-fp09-step1.py`; live migration/backfill readings in §2 | ✅ |
| AC-2 | Contract: flagged stub emits the onboarding block; non-flagged §4.2/§4.3 prompts are byte-identical to FP-08; per-field fail-open warnings; FP-05/FP-08 stub legs unchanged | `[script]` `verify-fp09-step2.py`, `verify-fp09-step3.py`, the FP-06/FP-08 golden families | ✅ |
| AC-3 | State machine: configured stage counts advance; close/resume continues without re-ask or skip; stage stamps; repair replay does not double-advance; `metric_selection` free text re-offers the same chips; intake writes zero `trust_events`/`persona_stats` and post-`complete` turns resume them | `[script]` `verify-fp09-step3.py` (fresh intro → baseline → resume → apply → metric → complete → reset) | ✅ |
| AC-4 | Metric selection: 1–2 valid keys create gate-validated `is_core` preset rows, stage → `complete`, `{status:'ok', metric_ids}`; a second confirm is `duplicate`; malformed/foreign/no-options follow the 400/404 table; the dashboard needs zero FP-07 file changes; the nightly `metric_eval` qualifies | `[script]` `verify-fp09-step4.py` (contract table + `git diff` domain assert); live Step 4 readings | ✅ |
| AC-5 | Routing: fresh auth lands in the interview; `complete` lands in `(app)/chat`; a `davos://chat` deep link during intake bounces to the interview; no check-in notification can arm during intake; `profiles.timezone` follows the device TZ after mount | `[script]` `verify-fp09-step4.py` (route gate, scheduler/push/impulse mount guard, mount TZ sync) | ✅ |
| AC-6 | Server gates: an `intro` user with planted missed windows/late starts receives zero watchdog/drift interventions; the same plants fire for a complete user; FP-04/FP-08 families stay green with `complete` fixtures | `[script]` `verify-fp09-step5.py`, `verify-fp04-step6.py`, `verify-fp08-step5.py` with `complete` fixtures | ✅ |
| AC-7 | Proactive: both windows fire once per local day, a second allowed, a third never; silence/onboarding/kill-switch gates; gap ask vs companionship; tick-to-fire race guard; row metadata + push payload; no habit/watch/impulse symbol in any proactive prompt; registry 15/15 | `[script]` `verify-fp09-step5.py` (qualification table, both kinds, race, duplicate, gates); §2 live readings | ✅ |
| AC-8 | Content I: canonical 16-domain `DOMAIN_ENUM`; `validate.ts` passes 144 approved rules + 233 approved exemplars (`approved=377`); BG-06 onboarding copy/opening configured and validated; frozen owner texts verbatim | `[script]` `verify-fp09-step6.py`; `[owner-approved]` opening only; remaining stage scripts DRAFT | ⏳ partial |
| AC-9 | Content II: live DB 144 rules + 233/233 embedded exemplars, zero placeholders; zero rules in an intake prompt; rules active on complete turns; live conflict-filter drop asserted; injection payloads in intake/companionship stay delimited and inert | `[script]` `verify-fp09-step7.py` + `verify-fp09-step8.py`; §2 live readings | ✅ |
| AC-10 | Surface discipline: the enumerated pre-existing touch set + new files; all eight earlier FP families green after write-backs; zero new job types (15/15), zero columns beyond `0032`, one new sync function, zero new client dependencies, no new secrets beyond BG-01's token | `[script]` `verify-fp09-step8.py` scope leg + the family sweep in §3 | ✅ |
| AC-11 | Injection: planted payloads in intake answers and companionship context stay inert; a malicious rule text in a scratch batch renders literally and its instructions are not followed | `[script]` `verify-fp09-step8.py`; Jest delimiter suite + `escapePromptText` at every dynamic fence | ✅ |
| AC-12 | End-to-end drill (owner): real-device interview, opening/pacing/resume/chips/completion, dashboard with chosen core metrics, next evening's anchor plan consuming the gathered routine/wake/sleep, the proactive pair observed, tone judged throughout (OWNER MANUAL) | `[owner-manual]` not performed | ⏳ |

**Legend:** ✅ accepted with automated evidence · ⏳ pending owner action or owner-manual drill · `[script]` deterministic verifier · `[live]` live project readback · `[owner-manual]` requires the owner's hands/eyes.

---

## 2. Recorded Readings

| Reading | Value | Source |
|---|---|---|
| Approved opening (config) | `Hey, it's Davos. We'll get to the big stuff soon enough — first, how's your day actually going?` | live `config.onboarding_opening_text`, readback after promotion |
| Persisted opening rows | 8/8 exact matches of the approved text | live `messages` rows with `metadata.source='onboarding_opening'` |
| BG-06 file state | top-level `status=draft`; `opening.status=approved`; stage scripts DRAFT | `content/ui-copy/onboarding-scripts.json` |
| Live rule corpus | 144/144 rules with embeddings, all 16 canonical domains | `content-seed {action:"counts"}` / `verify-fp09-step7.py` |
| Live exemplar corpus | 233/233 exemplars with embeddings, zero `PLACEHOLDER-DEV` | `content-seed {action:"counts"}` / `verify-fp09-step7.py` |
| Retrieval — `General` | 0 retrieved / 0 surviving rules | live `dev-smoke ?action=retrieve` |
| Retrieval — `Career` | 5 retrieved / 5 surviving rules | live `dev-smoke ?action=retrieve` |
| Retrieval — `Family` | 5 retrieved / 4 surviving; `droppedTone='aggressive'`; `conflict_priority_window=15` | live `dev-smoke ?action=retrieve` + prompt build |
| Proactive prompt boundary | `omitRules=true`; no rules block rendered; no habit/watch/impulse symbol | `verify-fp09-step5.py`, `verify-fp09-step7.py` |
| Dispatcher registry | 15 registered / 15 implemented; `FAST_JOB_TYPES` unchanged | `TECH-SPEC §2.3`, `verify-fp09-step5.py` |
| Quota recount | ~451 scheduled inserts/day at 5 users (~500 line) | `TECH-SPEC §12` |
| Injection fence | `</user_message>` in active/recent text, `</recalled_memory>` in facts, `</rules>` in rule text, and journal/check-in/memory/metric payloads all render as `&lt;…&gt;`; the delimiter remains closed | Jest 130/130 + `verify-fp09-step8.py` |

---

## 3. Regression Matrix

| Family | Gate(s) | Result |
|---|---|---|
| FP-03 | `verify-fp03-step7.py` (static + Steps 1–6 legs + deno/jest/tsc/eslint) | ✅ |
| FP-04 | `verify-fp04-step6.py` (static + deno) | ✅ `complete` fixture |
| FP-05 | `verify-fp05-step3.py`, `verify-fp05-step7.py` | ✅ static legs (+ jest) |
| FP-06 | `verify-fp06-step3.py`, `verify-fp06-step5.py`, `verify-fp06-step7.py` | ✅ static legs |
| FP-07 | `verify-fp07-step5.py`, `verify-fp07-step6.py` (+ jest) | ✅ static legs |
| FP-08 | `verify-fp08-step5.py`, `verify-fp08-step8.py`, `verify-fp08-closeout.py` | ✅ static legs; closeout's pre-commit "only owner work uncommitted" check passes on a clean tree (by design) |
| FP-09 | Steps 1 (recorded live), 3, 4, 5, 6, 7, 8 | ✅ static/live legs where applicable; Step 3 re-ran the full toolchain (tsc/jest/deno/eslint) after the Step 8 edits |
| Toolchain | `tsc`, full Jest, `deno check`, ESLint | ✅ final pass inside `verify-fp09-step3.py` |

**Historical-gate maintenance (no weakening):**
- FP-06 Step 5 now asserts the prompt-append contract in `generatePrompt.ts` (the FP-09 Step 3 split) and still asserts `generate.ts` calls the builder.
- FP-06 Step 7's request-union check accepts the later `onboarding-drill` member while still requiring `memory-drill` and `metric-drill`.
- FP-06 Step 3 now expects the **closed 15-handler registry** (FP-09's `proactive`) and the third legitimate `memory_facts` writer (FP-09 Step 3's baseline-facts apply module).
- FP-08 Step 8 / closeout now require the **final** `15 of 15` registry wording and reject stale `14 of 15` text.
- FP-09 Step 7's delimiter checks were strengthened, not relaxed: they now require the wrapped text to pass through `escapePromptText`.
- FP-09 Step 4/5/6/7 scope legs are pinned to their own commits (`f76c874`, `a780ec1`, the three content commits `cb63c70`/`ba66b38`/`a641c20`, `e18b614`), and Step 8's own leg is pinned to `fcb5edf`, so a later commit cannot pollute a historical touch set.

---

## 4. Owner-Pending Drills (AC-12 and owner-observed portions)

These were **not** executed by the agent and are not claimed as passed:

- [ ] Full real-device interview: opening, stage pacing, close/resume, chip proposal, completion.
- [ ] Dashboard after completion shows the chosen core metrics and points.
- [ ] Next evening's anchor plan consumes the gathered `wake_time`/`sleep_time`/`routine`.
- [ ] Proactive pair observed live: one gap ask, then a companionship message at cadence.
- [ ] Tone judged throughout the interview and proactive pair.
- [ ] BG-06 stage-script approval (the opening is already approved/live; the remaining stage scripts must flip from DRAFT only by owner action).

**Carry-over blockers (not FP-09 acceptance):** the exposed `SUPABASE_SERVICE_ROLE_KEY` and `DEV_SMOKE_TOKEN` still need rotation before further external/live testing.

---

## 5. Scope Statement

FP-09 Step 8 added **no** schema, job type, provider, client dependency or secret. It added one pure prompt-hardening module and its Jest suite, the acceptance ledger, the TECH-SPEC/GLOSSARY write-backs, the stale-gate maintenance above, and the Step 8 verifier. `FP-09.md` remains DRAFT; only the BG-06 opening is approved and live.
