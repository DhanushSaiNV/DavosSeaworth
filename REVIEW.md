# Code Review: DavosSeaworth 2432497..working-tree

## Summary — what changed + overall assessment

This review covers the staged, unstaged, and untracked changes since commit `2432497` ("Guard one primary reply per user message and repair unanswered turns"). The delta implements **FP-02 Step 5b: Composer UI + Realtime render + client thread logic**, plus a new background work-package catalog (`FP-BG.md`).

**Key changes:**
- **Client chat thread** (`app/(app)/chat.tsx`): Full rewrite with composer, optimistic bubbles, Realtime subscription, watchdog re-select, retry holdoff, error classification, and fail-closed config gating.
- **Pure chat logic** (`lib/chat.ts`, `lib/chat.test.ts`): Framework-agnostic reducers for ordering, primary/secondary reply dedupe, orphan detection, merge, retry gating.
- **Runtime config** (`lib/config.ts`): Memoized `config` table reader, loaded once at `(app)` layout, fail-closed (no hardcoded defaults).
- **Client message IDs** (`lib/ids.ts`): Dependency-free RFC 4122 v4 generator.
- **Migration `0018_config_chat_client.sql`**: Three new `[SPEC]` config keys (`chat_send_timeout_ms`, `chat_realtime_watchdog_ms`, `chat_retry_holdoff_ms`).
- **Documentation**: `TECH-SPEC.md` §7.10/§9/§11, `GLOSSARY.md` §8/§16 updated; `FP-02-PLAN.md` step status advanced.
- **New artifact**: `docs/feature-prds/FP-BG/FP-BG.md` — 17 background work packages (BG-01…BG-17) for parallel content/infra work.

**Overall assessment:** The implementation is thorough, well-tested (19 tests pass, 7 new), and aligns with AGENTS.md constraints (fail-closed config, no hardcoded `[SPEC]`, React Native primitives only, `tactical_analysis`/`trust_score` never client-exposed). The pure-logic separation (`lib/chat.ts` without React imports) is a strong pattern. No Blocker or Critical issues found.

## Verdict — Approve with comments

## Findings

### Minor

**MIN-001 — Math.random fallback in UUID generator** / Category: correctness / File: `lib/ids.ts:31-37` / Evidence: `randomBytes()` falls back to `Math.random()` when `crypto.getRandomValues` is unavailable (Hermes without polyfill). The comment acknowledges "Uniqueness (not unpredictability) is what matters here." / Impact: Theoretical collision risk for dedupe keys under high concurrency or poor entropy; acceptable for 5 beta users but not production-grade. / Suggested fix: Add `expo-crypto` (Expo SDK includes polyfill) or `react-native-get-random-values` to guarantee `crypto.getRandomValues` availability; or document the fallback as a known limitation for beta. / Effort: small

**MIN-002 — Config load has no backoff/retry policy** / Category: reliability / File: `lib/config.ts:87-111` / Evidence: `loadConfig()` retries on next call after failure but has no exponential backoff, max attempts, or jitter. A transient Supabase outage leaves the composer disabled until manual retry. / Impact: Poor UX during brief backend blips; user sees "Chat configuration is unavailable" with a Retry button but no automatic recovery. / Suggested fix: Add a simple retry-with-backoff (e.g., 3 attempts, 1s/2s/4s) inside `loadConfig()` before emitting `error` status; keep the manual Retry button as fallback. / Effort: small

**MIN-003 — 4xx errors retry immediately with no holdoff** / Category: reliability / File: `lib/chat.ts:272-278` / Evidence: `retryDelayFor()` returns `0` for `client` (4xx) kind; the bubble offers Retry immediately. The comment acknowledges "retrying verbatim will not help." / Impact: User may spam Retry on validation errors (e.g., message too long), wasting cycles. / Suggested fix: Apply a short holdoff (e.g., 2-5 s) for `client` errors too, or disable the Retry button for 4xx and show a descriptive error instead. / Effort: small

**MIN-004 — `CHAT_LAST_N` hardcoded, not a `[SPEC]` config key** / Category: maintainability / File: `app/(app)/chat.tsx:30-31` / Evidence: `const CHAT_LAST_N = 50;` is a local constant. AGENTS.md §2 requires `[SPEC]` values to live in `config`. / Impact: Changing the page size requires a code deploy; inconsistent with the "all `[SPEC]` in config" pattern established for timeouts/holdoffs. / Suggested fix: Add `chat_last_n` to `config` table (migration) and read via `requireConfigNumber`. / Effort: small

**MIN-005 — `FP-BG.md` proposes AGENTS.md amendment but not applied** / Category: docs / File: `docs/feature-prds/FP-BG/FP-BG.md:23-25` / Evidence: Section 2.1 states an amendment to AGENTS.md §8.4 "approved with this FP — quote into AGENTS.md in the first BG PR" but AGENTS.md is unchanged. / Impact: The binding rule for content drafting (`status=draft`, DRAFT label) is not yet in the canonical AGENTS.md; agents could miss it. / Suggested fix: Either apply the amendment to AGENTS.md in this change, or move the amendment to a follow-up BG-01 PR with a clear dependency. / Effort: small

### Nit

**NIT-001 — Unused import in `app/(app)/chat.tsx`** / Category: style / File: `app/(app)/chat.tsx:14` / Evidence: `useAuth` is imported from `../../lib/auth` but `useAuth` is not used (the component uses `const { user } = useAuth();` on line 48 — wait, it IS used. Disregard.

**NIT-002 — `REVIEW.md` deleted, `REVIEWER.md` untracked** / Category: housekeeping / File: repo root / Evidence: `git status` shows `deleted: REVIEW.md` and untracked `REVIEWER.md`. / Impact: Working artifacts left in repo root; `REVIEWER.md` is the review template, not a project document. / Suggested fix: Remove `REVIEWER.md` (it's the template you're following); ensure `REVIEW.md` deletion is intentional (it was a prior review artifact). / Effort: trivial

**NIT-003 — `.expo/devices.json` tracked despite `.gitignore`** / Category: housekeeping / File: `.expo/devices.json` / Evidence: `.gitignore` contains `.expo/` but `git diff HEAD -- .expo/devices.json` shows a staged change. / Impact: Local device state leaks into commits. / Suggested fix: `git rm --cached .expo/devices.json` and ensure `.expo/` stays ignored. / Effort: trivial

**NIT-004 — `lib/config.ts` exports `parseConfigRows`/`coerceConfigNumber` for tests but they're not tested** / Category: tests / File: `lib/config.ts:54-67` / Evidence: Functions are exported with "Exported for tests" comments but `lib/chat.test.ts` doesn't test them. / Impact: Minor test gap; pure helpers should have unit tests. / Suggested fix: Add tests for `parseConfigRows` (empty array, duplicate keys, non-numeric values) and `coerceConfigNumber` (null, undefined, string number, invalid string). / Effort: small

## Needs Verification

**NV-001 — Realtime watchdog race with `pruneResolvedPending`** / What to check: When the watchdog fires and fetches the assistant row by ID, `mergeRows` adds it. The `pruneResolvedPending` effect (line 284-289) then runs and may drop the pending entry. Verify that the watchdog path doesn't create a duplicate assistant row if Realtime delivers shortly after the watchdog fetch. The `seenIds` set in `dedupeAssistantRows` should handle this, but confirm with an integration test or manual scenario. / Why: The watchdog and Realtime are two async paths to the same row; idempotency relies on `message.id` uniqueness.

**NV-002 — Config fail-closed UX on slow networks** / What to check: On a cold start with slow network, `config.status` stays `loading` → composer disabled with "Loading configuration…" spinner. Verify the timeout feels acceptable (<3 s) and the Retry button works. / Why: Fail-closed is correct per AGENTS.md §2, but UX must not feel broken.

**NV-003 — Offline queue not implemented but documented** / What to check: TECH-SPECS §7.10 describes offline queue (SQLite/AsyncStorage) as `[SPEC]` but it's not in this delta. Confirm this is intentionally deferred and no code path assumes it exists. / Why: The send path uses `client_sent_at` for ordering truth; if offline queue lands later, it must integrate cleanly.

## Positive Notes

- **Pure logic separation**: `lib/chat.ts` has zero React/React Native imports, making it fully unit-testable and portable. The 7 new tests cover error classification, sorting, dedupe, merge, optimistic→durable transition, orphan self-heal, and UUID shape.
- **Fail-closed config**: `lib/config.ts` throws on missing keys instead of defaulting, enforcing AGENTS.md §2 at runtime. The composer stays disabled until config loads — no silent misconfiguration.
- **Primary/secondary reply dedupe**: Client-side `dedupeAssistantRows` mirrors the server's `messages_one_primary_reply` index exactly (first primary wins, secondaries always render). The `keyExtractor = client_message_id ?? id` preserves optimistic bubble identity across the server-row swap.
- **Retry holdoff matches sync limit**: `chat_retry_holdoff_ms = 150000` equals the verified 150 s Edge Function limit, guaranteeing no overlapping pipeline runs for unknown outcomes.
- **Documentation discipline**: Every new `[SPEC]` key appears in migration, TECH-SPEC §11, GLOSSARY §16, and client code — no drift.
- **Fixed pre-existing bug**: `fetchMessages` now loads newest 50 (`.order('created_at', { ascending: false })`) instead of oldest 50, so long threads show recent messages.

## Test Coverage

| Area | Coverage | Gaps |
|------|----------|------|
| `lib/chat.ts` | 7 tests (19 total) — error buckets, ordering, dedupe, merge, buildChatItems, orphan healing, UUID | No test for `mergeRows` with concurrent Realtime + watchdog delivery; no test for `nextRetryAt` with multiple failed items |
| `lib/config.ts` | 0 direct tests (helpers exported but untested) | `parseConfigRows`, `coerceConfigNumber`, `loadConfig` retry behavior |
| `lib/ids.ts` | 1 test (uniqueness + RFC 4122 shape) | Collision probability under Math.random fallback |
| `app/(app)/chat.tsx` | 0 integration tests (React Native) | Composer flow, Realtime reconnect, watchdog, retry UI |

**Recommended tests:**
1. Integration test for `send` → `awaiting-reply` → Realtime delivery → `pruneResolvedPending`.
2. Test `mergeRows` idempotency when watchdog and Realtime deliver the same row.
3. Unit tests for `lib/config.ts` pure helpers.
4. E2E smoke test on device (owner verification per FP-02-PLAN).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Config load failure → composer permanently disabled | Low (Supabase free tier stable) | Medium (user blocked) | Retry button + MIN-002 backoff |
| Realtime message loss → watchdog fetch fails silently | Low | Medium (missing reply) | Watchdog logs warn; user can pull-to-refresh |
| UUID collision (Math.random fallback) | Very low (5 users, 122-bit space) | Low (dedupe failure) | MIN-001 fix or accept for beta |
| Offline queue absent → message loss on no network | Medium (mobile) | High (data loss) | Deferred per plan; documented as `[SPEC]` |

**Rollback safety**: Migration `0018` is additive (3 config rows). Client code is backward-compatible with older config (fail-closed). No breaking API changes.

## Recommended Next Steps

1. **Fix MIN-001, MIN-002, MIN-003, MIN-004** before merging (all small, low risk).
2. **Apply AGENTS.md amendment** from FP-BG §2.1 or explicitly defer to BG-01.
3. **Remove `REVIEWER.md`** and clean up `.expo/devices.json` tracking.
4. **Add unit tests** for `lib/config.ts` helpers (NIT-004).
5. **Verify NV-001, NV-002, NV-003** on device/emulator before beta.
6. **Proceed to FP-02 Step 6** (Tier routing: chips + `select-persona` + dev override) once this merges.