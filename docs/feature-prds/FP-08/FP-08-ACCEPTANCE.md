# FP-08-ACCEPTANCE.md — Acceptance Ledger: Drift Detection, Side Quests, Habits/Strike, Trust/Oath, Lockdown & Impulse Interception

**Companion to:** `docs/feature-prds/FP-08/FP-08.md` → `docs/feature-prds/FP-08/FP-08-PLAN.md`
**Gates:** `scripts/verify-fp08-step1.py` … `scripts/verify-fp08-step8.py` · `scripts/verify-fp08-closeout.py` · **Governed by:** `AGENTS.md`

> The AC ids below are parsed from `FP-08.md` by `scripts/verify-fp08-closeout.py`; the two files
> cannot drift without the closeout gate failing.
>
> Retirement note: `decisions1.md` and every `decisions-review*.md` are superseded and are not
> cited. The governing architectural record is `docs/adr/decisions2.md` (D20–D26 for this FP).

---

## 1. AC Ledger (ids mirror FP-08.md §6)

| AC   | Description | Evidence Tag | Status |
| ---- | ----------- | ------------ | ------ |
| AC-1 | Migration `0032_accountability_fp08`: one column (`journal_entries.habit_flag`), two indexes, three functions (both ticks + `accept_quest`), two schedules, fifteen seeds; both tick truth tables (kill switch, guard, window/qualification/any-status); every new key read fail-closed. | `[script]` `verify-fp08-step1.py` (live schema + direct RPC calls) | ✅ |
| AC-2 | Rider: openness ±5 with events, admission +10, clamps, first-3-per-day impulse credit, band-shift caps, delta-0 override audit; chat + journal call sites live; FP-06 golden byte-identity. | `[script]` `verify-fp08-step2.py`, `verify-fp08-step3.py`; `[measured]` jest golden suite | ✅ |
| AC-3 | Lockdown: three signals; forced confrontation + filtered retrieval + redirect on a foreign domain; all three exits; redirect-not-refuse. | `[script]` `verify-fp08-step4.py` (owner drill with restore) | ✅ |
| AC-4 | Oath + breakdown: 69 no request / 70 one request; cooldown; confirmed send writes the verbatim fact; plain next message does not (D26); late flag does not purge; breakdown only at trust ≥ 70, with aggregates + oath. | `[script]` `verify-fp08-step4.py` | ✅ |
| AC-5 | Drift: each pattern fires on planted data and not on its boundary neighbor; same-day dedupe; FAST drain; kill switch; streak +2 once per local day. | `[script]` `verify-fp08-step5.py` (five fixtures, UTC) | ✅ |
| AC-6 | Habits: impulse ≥ 3/week and journal ≥ 3 `habit_flag` entries each surface; live guard; confrontation → `confronted`; concession → `watch` + future `strike_fire`; `quit_commitment` → `quit_committed` and the strike no-ops. | `[script]` `verify-fp08-step5.py`, `verify-fp08-step3.py`, `verify-fp08-step7.py` | ✅ |
| AC-7 | Quests: card metadata; accept → validated `is_quest` metric + in-bounds deadline + `quest_expire`; dashboard `ProgressBar` with **zero FP-07 edits**; duplicate tap; completed/failed/expired verdicts; decline; one-active-quest; rollback on job failure. | `[script]` `verify-fp08-step6.py` + `git diff` assert | ✅ |
| AC-8 | Strike: Tiered Proof context; planted fabricated deadline rejected → one corrected re-output → template on the second; S1/S2 snooze; `struck` + push; watchdog path byte-identical. | `[script]` `verify-fp08-step7.py` (live dispatcher) | ✅ |
| AC-9 | Interception: both `log-impulse` captures + capped candor; Android quick-action + in-app button log; 14 failures cluster → one fire at start − 15 min → deterministic text + deep link; 2-failure cold start; top-2; empty activities → generic text; zero raw `console.*`. | `[script]` `verify-fp08-step8.py` (server + client static); `[owner-observed]` Android backgrounded quick action and visible web pass **pending** | ⏳ |
| AC-10 | Surface discipline: 15 registered / **fourteen** implemented (`proactive` deferred); client `logger` + `traceNetworkCall`, zero raw `console.*`; enumerated touch set; every touched FP's gate family green. | `[script]` regression run in §5; `[measured]` secret scan (92 files) | ✅ |
| AC-11 | Injection: planted payloads inert in doings/journal/habit prompts; claim-check table; quest rationale + habit description render literally. | `[script]` `verify-fp08-step2.py` / `step5` / `step7` prompt-build asserts | ✅ |
| AC-12 | End-to-end owner drill: drift → quest → debrief; refused habit → Strike; admission → Oath → breakdown; impulse → preemptive ping; tone judged. | `[owner-observed]` **owner manual pending** | ⏳ |

`✅` = automated evidence recorded. `⏳` = automated half recorded, owner/device judgment still open (the FP-03 AC-8 precedent).

---

## 2. Recorded Readings

Every **[recorded reading]** from `FP-08.md`, with where it was read. `[script]` values were
printed by the named gate; `[measured]` values were read from the live project; `[derived]`
values follow from the named code/config and are asserted structurally.

| Reading | Recorded value | Source |
| ------- | -------------- | ------ |
| Candor credit and cap | Rows 1–3 of the local day each write one `trust_events('openness', +1)`; row 4 writes none. Live: trust `0 → 3` after four impulse logs; exactly three events. | `[script]` `verify-fp08-step8.py` §D |
| Streak carrier and day rule | `+2` once per local day; two consecutive scans write one event. A two-day energy slide stays below the award floor. | `[script]` `verify-fp08-step5.py` |
| Override audit row | A band override writes `trust_events(reason='override', delta=0)`; the row is visible on the owner account (four total after the drills). | `[script]` `verify-fp08-step3.py`; `[measured]` owner `trust_events` |
| Accountability-domain pair | `lockdown_accountability_domains = ["Career","Discipline/Habits"]`. An in-set domain queries that domain only; a foreign domain queries the whole set and appends the redirect. | `[script]` `verify-fp08-step1.py` (seed), `verify-fp08-step4.py` (prompt) |
| Oath cooldown + thread position | `oath_request_cooldown_days = 7`. Trust 69 + admission → no request; 70 → one; a second admission inside cooldown → none. Only `oath_confirmed:true` + the immediately preceding unconsumed `oath_request_id` captures the fact; a plain next message does not (D26). | `[script]` `verify-fp08-step1.py`, `verify-fp08-step4.py` |
| Oath fact is non-purgeable | Confirmed capture writes the verbatim text as `fact_type='oath'`; a later `flag-unsavable` leaves it. | `[script]` `verify-fp08-step4.py` |
| Impulse-cluster routing | 14 failures at local hour 20 → one qualifying bucket → fire at `19:45` (bucket start − 15 min). Three clusters (14/5/4) → fires only for 20 and 07; the 12 cluster is counted and not fired (top-2). | `[script]` `verify-fp08-step8.py` §E/§I |
| Cold start / boundary | 2 failures → `skipped:'cold_start'`, zero fires; 3 failures → one fire (`histogram_bucket_min_count = 3`). | `[script]` `verify-fp08-step8.py` §H |
| Empty activities degradation | `high_dopamine_activities=[]` → the generic in-code text, `metadata.activity=null`. | `[script]` `verify-fp08-step8.py` §G |
| In-code templates | The preemptive text is `preemptiveText(activity, bucket, lead)`; no provider import, embed, generate, or fetch in `runHistogram.ts`. The fire leg's only external call is the push. | `[script]` `verify-fp08-step8.py` static |
| Live-habit guard | A second scan writes no duplicate habit and no new confrontation job (job count unchanged). | `[script]` `verify-fp08-step5.py` |
| Quest verdict fraction + expiry | `quest_completion_fraction = 0.5`; 5/7 passing → `completed`; 1/7 → `failed`; 0 points → `expired`. Deadline is clamped to `{min_days:3, max_days:21}`; `quest_expire.next_retry_at = deadline + 1 day at 01:15 local`; each verdict archives the metric and writes one debrief. | `[script]` `verify-fp08-step1.py`, `verify-fp08-step6.py` |
| Future-dated strike job | A concession moves the habit to `watch`; `strike_at = watch_started_at + 7 days` at `strike_fire_local_hour = 18` local; one pending `strike_fire` job carries the habit id. | `[script]` `verify-fp08-step3.py`; `[derived]` `_shared/accountability/habits.ts` |
| Snooze decrement | A journal S1/S2 within 24 h returns `{snooze_until: now + 24 h}`; the real dispatcher resets the row to `pending`, pushes `next_retry_at` +24 h, decrements `attempts` back to `0`, writes no strike; a re-fire after the window strikes exactly once. Five consecutive deferrals never dead-letter. | `[script]` `verify-fp08-step7.py` (unit + live dispatcher) |
| Claim-check + fallback | A planted `"400-hour deadline"` fails the claim-check; one corrected re-output drops it; a second violation delivers the deterministic template. The template is claim-checked **before** delivery and carries only licensed figures. | `[script]` `verify-fp08-step7.py` |
| Strike cancellation | `quit_committed` completes the job and writes no strike row; the habit keeps `quit_committed`. Re-firing a `struck` habit is the status no-op. | `[script]` `verify-fp08-step7.py` |
| Registries | 15 job types; **fourteen** dispatcher handlers; `proactive` is the sole deferred type. `FAST_JOB_TYPES` = `smoke_test`, `watchdog_checkin`, `purge_memory`, `metric_eval`, `drift_scan`. | `[script]` `verify-fp08-step8.py` + `verify-fp04-step6.py` |
| `cancelled` reserved | `habits.status` includes `cancelled`; no FP-08 path writes it. `quit_committed` is the used terminal state. The unused value stays for a future owner decision. | `[derived]` schema + `runStrike` status table |
| `proactive` deferred | Not implemented and not registered as a handler. Its seam is §7.5's habit-topic suppression, recorded for the Proactive Conversationalist FP because `habits` carries no topic column. | `[derived]` TECH-SPEC §2.3 + §7.5 |
| iOS/web impulse surfaces | Expo remote push is Android-only in beta; iOS/web render in-thread. The preemptive row's `davos://chat?focus=alternative` is a tap target, not a delivery guarantee. The in-app button is not Platform-gated. The Android ongoing notification is local and unaffected. | `[script]` `verify-fp08-step8.py` static; `[owner-observed]` device pass pending |

---

## 3. Step Evidence

| Step | Commit | Gate result |
| ---- | ------ | ----------- |
| 0 | — | Dependency gate GREEN (FP-07 merged at `f89285d`) |
| 1 | `29d0d92` | `verify-fp08-step1.py` **PASS** (live schema, seeds, three RPC truth tables) |
| 2 | `b7e6794` | `verify-fp08-step2.py` **PASS** (eight zero-import modules + decision tables) |
| 3 | `e5cbcef` | `verify-fp08-step3.py` **PASS** (rider call sites, habit transitions, single writer) |
| 4 | `6996bef` | `verify-fp08-step4.py` **PASS** (lockdown, oath, breakdown; owner state restored) |
| 5 | `675c4af` | `verify-fp08-step5.py` **PASS** (five fixtures; patterns, habits, streak, quest offer) |
| 6 | `28b5527` | `verify-fp08-step6.py --no-fp07` **PASS** (accept/duplicate/conflict/decline/three verdicts) |
| 7 | `16b93d8` | `verify-fp08-step7.py` **PASS** (static + live correction/template/snooze/cancel) |
| 8 | `cca68e2` | `verify-fp08-step8.py` **PASS** (static + live log-impulse/histogram/client) |

Owner asset commits (e.g. `bcc5aab`) sit between FP-08 steps and are **not** part of this FP.

---

## 4. Verification Notes (honest exceptions)

1. **No browser automation.** This harness has no browser driver. AC-9's in-app button and
   `focus=alternative` scroll are verified structurally and the server halves live; the visible
   web pass and the Android backgrounded quick action are the owner's device drill. The Step 8
   gate prints this note rather than claiming a pass.
2. **Real-mode extraction variance.** The FP-05 regression leg runs in real mode. The severe
   fixture may be labelled S1 or S2 (both are severe and both open the probe/lockdown); the
   vague/clear fixtures are asserted by probe presence rather than a fixed vagueness decimal.
   The FP-05 acceptance's semantic thresholds remain the point-in-time record.
3. **Regression fixes made during Step 9** (all in the touched gate/baseline set):
   - `_shared/dev/overrides.ts`: forcing the D7 tier now returns `0`, so a rider-shifted
     `low_low` cannot turn a forced fallback into `low_question` (the band-shift regression).
   - `_shared/journal/runChain.ts`: the `anchor_plan` / `journal_probe` existence checks use
     `.limit(1).maybeSingle()`, so a pre-existing duplicate (a cron/drill race) cannot turn the
     idempotent re-claim into a 500.
   - Older gates were re-baselined for FP-08's additions: 14 handlers, `drift_scan` in
     `FAST_JOB_TYPES`, the oath `memory_facts` writer, the breakdown intervention insert, the
     rider's `trust_events` **reads**, and committed-only package comparison.
4. **Owner data.** The Step 3/4 live gates use the owner account by design and snapshot/restore
   `trust_score`, `dialog_state`, and the drill rows. During closeout a stale stub breakdown row
   and two owner-run audit `openness` events were removed, restoring the account to
   `trust_score=0`, `dialog_state=OPEN`. No owner journal/doings content was edited.
5. **Client UI for Oath confirm affordance (D26) deferred in chat.tsx (owner drill finding).**
   Tracing the client revealed that while `chat.tsx` renders the Side Quest card (`metadata.quest_offer`)
   and the impulse button, no UI confirm affordance/action exists for `metadata.source='oath_request'`
   assistant rows. The demand renders as plain text, and a typed reply from the standard chat
   composer sends `{ content }` without `oath_confirmed: true` or `oath_request_id` (so per D26,
   it is intentionally not captured as a permanent oath memory fact). For the hands-on drill,
   the Oath capture leg is driven via a scripted `send-message` POST carrying
   `{ content, oath_confirmed: true, oath_request_id }` (the exact payload the client button will
   send when wired). The missing client button is recorded in the drill's findings list as an Item 11
   backlog candidate.

---

## 5. Regression Legs (Step 9)

| Family | Command | Result |
| ------ | ------- | ------ |
| FP-02 audit | `python scripts/verify-step11.py --turns 6 --cleanup` (throwaway audit user) | **PASS** (all automated checks; owner-live ACs listed as manual) |
| FP-03 | `python scripts/verify-fp03-step7.py --static-only --no-jest --no-fp02` | **PASS** |
| FP-04 | `verify-fp04-step1/2/3/4/6.py --static-only` (with `--no-deno`/`--no-tsc` where offered) | **PASS** (all five) |
| FP-05 | `verify-fp05-step3.py` (real, temp user), `step4 --static-only`, `step5.py` (real, temp user), `step6.py` (stub, temp user), `step7 --static-only` | **PASS** (all five) |
| FP-06 | `verify-fp06-step1…7.py --static-only` | **PASS** (all seven; includes the golden-string suites) |
| FP-07 | `verify-fp07-step1/3/4/5/6.py` (each plants its own quest metric; temp users) | **PASS** (all five) |
| FP-08 | `verify-fp08-step1…8.py` (1 live; 2 static; 3–7 static + live; 8 live) | **PASS** (all eight) |
| Toolchain | `npx tsc --noEmit` · `npx jest --ci` · `deno check` on the touched Edge files | **896 tests pass**; tsc/deno clean |
| Secret scan | `verify-step11.py` static scan | **92 files, no secret / no service-role name in client** |

The FP-07 leg with a live quest metric is `verify-fp07-step1.py` (it inserts a quest metric and
asserts the quest aggregate), `step4` (completed quest + `quest_completions` variables), and
`step6` (dashboard data). All passed after the FP-08 changes.

---

## 6. Write-Back Ledger

| Reference | Written back | Commit |
| --------- | ------------ | ------ |
| TECH-SPEC §2.2 | Snooze convention (handler returns `{snooze_until}`; dispatcher resets pending, sets retry, decrements attempts) | Step 7 |
| TECH-SPEC §2.3 | Four implemented job types; 15 registered / fourteen handled; `proactive` deferred; FAST set updated | Steps 5–8 |
| TECH-SPEC §3.2 / §3.4–3.5 | `journal_entries.habit_flag`; migration order; the two tick functions and `accept_quest` | Step 1 |
| TECH-SPEC §4.3 | Journal extraction contract gains `habit_flag` + as-built note | Steps 3–5, Step 9 |
| TECH-SPEC §5.3 | Rider as-built: arithmetic, clamps, single writer, override audit | Step 3 |
| TECH-SPEC §5.4 | Oath confirm affordance (D26), non-purgeable oath facts, breakdown gate | Step 4 |
| TECH-SPEC §7.3 | Drift scan sources/dedups, habit lifecycle, quest offer gate | Step 5 |
| TECH-SPEC §7.5 | Tiered Proof, claim-check, one correction, template fallback, strike snooze | Step 7 |
| TECH-SPEC §7.8 | Histogram rebuild/fire legs, caps, deterministic text, client surfaces | Step 8 |
| TECH-SPEC §8 | Preemptive push + `focus=alternative`; Android persistent local notification | Step 8 |
| TECH-SPEC §11 | Fifteen FP-08 config keys + the reshaped `habit_detection_thresholds` | Step 1 |
| TECH-SPEC §12 | 441 scheduled inserts/day recount (144 drift + ~5 histogram on top of 292) | Step 1 |
| TECH-SPEC §13 | iOS amendment extended to every FP-08 push (Android-only remote; iOS/web in-thread) | Step 9 |
| GLOSSARY §2 | Journal chain notes `habit_flag` as the FP-08 surfacing input | Step 9 |
| GLOSSARY §12 | `drift_scan`, `quest_expire`, `strike_fire`, `histogram_daily` implemented notes | Steps 5–8 |
| GLOSSARY §13 | `drift-drill` legs (scan/report/quest/strike/oath/histogram) and `log-impulse` | Steps 5–8 |
| GLOSSARY §15 | Accountability modules, ticks, `accept-quest`, `log-impulse`, client surfaces, metadata sources | Steps 1–9 |
| GLOSSARY §16 | FP-08 config keys | Step 1 |
| ADR / decisions | D20 (rider), D21 (lockdown), D22 (Strike/histogram/quests), D23 (habits), D24 (drift), D25 (quest verdict), D26 (oath confirmation) | Steps 1–9 |
| PRD | FR-1…FR-21 / AC-1…AC-12 implemented; AC-9 device half and AC-12 owner drill remain owner-observed | This doc |

---

## 7. AGENTS.md §9 Checklist

- [x] RLS present on every new table — **no new table**; one column on `journal_entries` (existing policies).
- [x] No secrets in client code or migrations.
- [x] No new paid services, external servers, or third-party infrastructure.
- [x] All model/embedding calls go through the provider adapter — `runHistogram.ts` and `log-impulse` call no provider; the Strike and quest handlers use the adapter.
- [x] No regex on LLM output; no unbounded retry loops — the claim-check plus one corrected re-output, then the template.
- [x] No HTML/DOM elements — React Native primitives only.
- [x] `tactical_analysis` stripped server-side (FP-02 static leg re-run green).
- [x] `trust_score` never rendered in UI or client API responses (FP-08 Step 3 static).
- [x] Client logging uses `logger`; zero raw `console.*` in `lib/impulse.ts`, `lib/impulseButton.ts`, and the chat/layout changes.
- [x] New job types idempotent + registered in TECH-SPEC §2.3 and GLOSSARY §12 (`drift_scan`, `quest_expire`, `strike_fire`, `histogram_daily`).
- [x] New terms/identifiers added to GLOSSARY.
- [x] Quota impact checked — 441/day scheduled inserts against the 5-user basis; no per-minute LLM polling.
- [x] `[SPEC]` values read from `config` — all fifteen keys seeded in 0032 and read at runtime.
- [x] Journal strip remains client-side; flagged text never transmitted (FP-03 leg).
- [x] Docs updated in the same change.
- [x] Governing references cited in every FP-08 commit.

---

## 8. Re-run Recipe

```powershell
# 1. Load the gate credentials (never print them).
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    Set-Item -Path "env:$($matches[1])" -Value $matches[2].Trim().Trim('"').Trim("'")
  }
}
$env:SUPABASE_URL = $env:EXPO_PUBLIC_SUPABASE_URL
$env:SUPABASE_ANON_KEY = $env:EXPO_PUBLIC_SUPABASE_ANON_KEY

# 2. FP-08 gates. Each live gate creates and deletes its own fixtures.
python scripts/verify-fp08-step1.py
python scripts/verify-fp08-step2.py
python scripts/verify-fp08-step3.py --no-toolchain
python scripts/verify-fp08-step4.py --no-toolchain   # owner drill; snapshots/restores
python scripts/verify-fp08-step5.py --no-toolchain
python scripts/verify-fp08-step6.py --no-fp07 --no-toolchain
python scripts/verify-fp08-step7.py --no-toolchain
python scripts/verify-fp08-step8.py --no-toolchain

# 3. Closeout (parses AC ids, write-backs, tracker, checklist).
python scripts/verify-fp08-closeout.py

# 4. Full toolchain.
npx tsc --noEmit
npx jest --ci
```

Owner drills (AC-9 device/web half and AC-12) are listed in `FP-08-PLAN.md` Step 9 and are the
only reason those two rows stay `⏳`. They require the app on a device/browser; no script can
settle tone or a notification tray.

---

## 9. Owner Manual Sign-off (pending)

- [ ] **Tone drill:** planted drift week → read the confrontation; refused habit → watch → read
      the Strike; admission at 70 → Oath; planted breakdown → hear the oath quoted back. Retune
      the system-prompt halves if the voice is wrong.
- [ ] **Platform drill:** quest card accept/decline/confirmed; impulse button; preemptive ping
      15 min before the planted danger hour. Android: backgrounded quick action posts
      `log-impulse`. Web: card/button/`focus=alternative` deep-link pass.
- [ ] **Lifecycle drill:** one quest to `completed` (or forced) with its debrief; one refused
      habit to `struck` with the Strike in-thread.
- [ ] Re-check the standing `dev_overrides_enabled=true` plan; FP-08's drill legs join its
      "done" set before it flips to `false` for real beta users.

### Drill Findings List

1. **Client Oath Confirm Affordance (D26):** `app/(app)/chat.tsx` does not render a confirm button/action on assistant rows with `metadata.source='oath_request'`. The demand appears as plain assistant text. Per D26, a standard typed reply from the composer sends `{ content }` without `oath_confirmed: true` or `oath_request_id` and is intentionally not captured as an oath memory fact (protecting the user from unintentional binding oaths). For the manual drill, the Oath capture leg is driven via scripted `send-message` with `{"content": "<oath_text>", "oath_confirmed": true, "oath_request_id": "<request_id>"}`. The missing client confirm UI is logged as a finding and added to the Item 11 / client polish backlog.
