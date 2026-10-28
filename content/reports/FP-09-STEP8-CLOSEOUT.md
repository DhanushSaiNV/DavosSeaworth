# FP-09 Step 8 — Closeout Report

**Date:** 2026-10-28
**Scope:** acceptance ledger, TECH-SPEC/GLOSSARY write-backs, historical-gate maintenance, AC-11 injection evidence, owner-manual drill tracking.
**Status:** Agent work complete. `FP-09.md` remains **DRAFT**. AC-12 and the remaining BG-06 stage-script approval stay **owner-pending**.

## 1. What landed

- `docs/feature-prds/FP-09/FP-09-ACCEPTANCE.md` — AC-1…AC-12 ledger, recorded readings, regression matrix, owner-pending drills.
- `docs/feature-prds/FP-09/FP-09-PLAN.md` — tracker rows 0–7 marked ✅; row 8 ▶ pending the owner-manual drill.
- `docs/TECH-SPEC.md` — approved/live opening, Step 6/7 as-built notes, final 15/15 registry wording, §10.5 Step 8 fence hardening, BG-01 live item closure, §14 item 10 complete.
- `docs/GLOSSARY.md` — approved/live BG-06 opening, `escapePromptText`, recalled-memory term, as-built onboarding/proactive terms.
- `scripts/verify-fp09-step8.py` — Step 8 acceptance/scope/hardening gate.

## 2. AC-11 injection evidence

`_shared/prompts/delimiters.ts` adds the pure `escapePromptText` helper (angle brackets only; ampersands stay readable). Every dynamic value that rides a prompt fence now passes through it:

| Surface | Wrapper |
|---|---|
| Active chat/intake answer | `pipeline/generate.ts` |
| Stage-1 extraction text | `pipeline/extract.ts` |
| Recent thread | `pipeline/recentContext.ts` |
| Recalled facts | `pipeline/memoryContext.ts` |
| Retrieved rules | `pipeline/generatePrompt.ts` |
| Journal extraction | `journal/extractContract.ts` |
| Anchor plan | `journal/anchorContract.ts` |
| Memory extraction | `memory/extractContract.ts` |
| Metric proposal | `metrics/propose.ts` |
| Check-in evaluation | `checkin/evalContract.ts` |
| Accountability interventions | `accountability/interventions.ts` |

Jest pins the closing-tag payloads (`</user_message>`, `</recalled_memory>`, `</rules>`) rendering as `&lt;…&gt;`, so a payload can no longer close its delimiter. The companionship path already sanitises the metric name and carries no user-authored body; the Step 7 boundary check remains the evidence for its structural suppression.

## 3. Recorded live readings (from Steps 6/7)

- Opening config and all 8 persisted `onboarding_opening` rows: exact approved text.
- BG-06: top-level `status=draft`; `opening.status=approved`.
- Rules: 144/144 with embeddings; exemplars: 233/233 with embeddings; zero `PLACEHOLDER-DEV`.
- Retrieval: `General` 0/0; `Career` 5/5; `Family` 5 retrieved / 4 surviving, `droppedTone='aggressive'`, window 15.
- Registry: 15/15; scheduled inserts ~451/day at 5 users.

## 4. Historical-gate maintenance

- FP-06 Step 5 targets `generatePrompt.ts` (the Step 3 split) and still checks `generate.ts` calls the builder.
- FP-06 Step 7's request-union check accepts the later `onboarding-drill` member.
- FP-06 Step 3 expects the closed 15-handler registry and FP-09's baseline-facts `memory_facts` writer.
- FP-08 Step 8/closeout require the final 15/15 wording and reject stale 14/15 text.
- FP-09 Step 7's delimiter checks require the escaped wrapper (`escapePromptText`).
- FP-08 Step 4/5 purity checks permit the pure `delimiters.ts` helper in `interventions.ts` for AC-11 compliance.
- FP-09 Step 4/5/6/7 scope legs are pinned to their own commits; Step 8's own leg is pinned to `fcb5edf`.

## 5. Owner-pending (not claimed)

- [ ] Full real-device interview, pacing, resume, chips, completion, dashboard.
- [ ] Next evening's anchor plan consuming the gathered routine/wake/sleep.
- [ ] Proactive pair observed (gap ask, then companionship at cadence); tone judged.
- [ ] Remaining BG-06 stage-script approval.

**Carry-over:** rotate the exposed `SUPABASE_SERVICE_ROLE_KEY` and `DEV_SMOKE_TOKEN` before further external/live testing.
