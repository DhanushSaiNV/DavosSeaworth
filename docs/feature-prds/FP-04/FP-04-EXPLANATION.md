# FP-04 — Interval Check-In Loop, Step by Step (plain terms)

Companion to `FP-04.md` (what/why) and `FP-04-PLAN.md` (the build order). Each step below is
stated three ways: **(a)** what the user experiences, **(b)** what the code actually is, and
**(c)** the capability the step unlocks. I've **skipped Step 0** — it's a pre-flight audit (is
FP-03 closed, does `doings_logs` have the right shape, is the dispatcher alive, are the migration
slots free, are the baselines green) and ships no behaviour, so it has no user story.

> **Status (2026-10-17).** Steps **0, 1, 2, 3a and 3b** are ✅ (3b's live gate ran green: the
> intervention turn, the degrade leg, the push leg and the §5.3 exclusion all verified). Step **4**
> is ▶ (source-complete; static + `tsc` + jest green — 17 suites / 250 tests) with its real
> notification firing waiting on the Step 8 device drill. Steps **5–8** are ⬜. Tracker rows are
> flipped by the owner; the ledger of record will be `FP-04-ACCEPTANCE.md` (Step 8).

---

## Step 1 — Window index + config keys + prefs RPC (migration 0026) ✅

**(a) User perspective.** Nothing changes for the user yet — this is a dark ship. The story it
enables: the app now refuses to record **two doings for the same hour**, and the check-in settings
are validated before they're written. So if the user answers the 3 PM prompt twice (once from the
phone, once from web) or a reply is retried, the app counts it once and doesn't give them
double-counted coaching. They never see this; it's what makes the rest of the loop trustworthy.

**(b) Technical.** Adds a unique partial index `doings_logs_one_checkin_window` on
`(user_id, checkin_window) where checkin_window is not null` (and drops the now-redundant non-unique
`0003` index); seeds two `config` keys (`checkin_late_minutes = 15`, `watchdog_lookback_minutes =
120`, proper jsonb); and adds the `update_checkin_prefs` RPC (`security definer`, pinned
`search_path`, no user-id parameter — it filters `where id = auth.uid()`, updates **only** the four
check-in columns, and validates cadence ∈ {60,120}, start < end, and the timezone). No RLS change.
**Not a lockdown (recorded, honest):** `profiles` still carries its own-row UPDATE grant, so a
hand-crafted PostgREST PATCH can bypass the RPC's validation — a pre-existing FP-01 surface, tracked
as a live item, not "fixed" here.

**(c) Capability added.** A correctness foundation: one doing per window, and a safe settings write.
Dedupe, the response, and the watchdog's "answered?" join now all agree on a single canonical key.

---

## Step 2 — `submit-checkin`: the ingestion core (POST + PATCH) ✅

**(a) User perspective.** This is where the loop becomes real. The user answers the prompt — *"finished
the report, drained 4"* — and Davos permanently remembers it, with the energy reading, **without the
app being opened**. The story: accountability costs ten seconds, and the memory engine starts to
accumulate the ground truth of what the user actually did. Energy can also be added later with a
single tap (the PATCH half).

**(b) Technical.** New Edge Function `submit-checkin`: `content` cap, `capture ∈ {reply, chat}`, and
`windowTs` **canonicalized server-side** to the grid window (nearest start within ±cadence/2; a
future / >24 h-old / off-grid hint gets a **named** 400 — `window_malformed` / `window_future` /
`window_stale` / `window_off_grid`). The duplicate check runs **before any provider call** (a repeat
costs zero embeds); otherwise one `llm.embed`, one `doings_logs` insert (`checkin_window` = the
canonical window start, `logged_at` = the window's canonical close), and a best-effort
`profiles.latest_energy` update. An embed failure stores **nothing** and answers
`503 {error:'embed_unavailable'}` so the client replays the same window. PATCH sets energy on own
rows (foreign/unknown → 404, never 403). CORS mirrors `send-message` **plus PATCH** in the method
list (web's energy-chip tap would otherwise be blocked at preflight). The grid arithmetic is a pure
module (`_shared/checkin/windows.ts`) with the `profiles` read split off (`loadGrid.ts`), and one
shared fixture (`windows.fixture.ts`) that both the server and client suites run (NFR-7).

**(c) Capability added.** The single doorway: three capture paths (OS reply, deep-link/banner chat,
web banner) converge on one function where each check-in becomes a stored, vectorized doing — with
zero LLM text on the on-track path.

---

## Step 3a — The eval call + the schema-aware stub shape ✅

**(a) User perspective.** Davos can now form a small judgement about a check-in — *"is this off-plan
enough that I should say something?"* — but only on **gated** turns (energy at or below 3, or a
window answered more than 15 minutes late). The story: the user logs *"skipped the gym, feel awful,
energy 2"* and Davos compares it against the day's plan **within the hour**, instead of saying
nothing until midnight. On an ordinary on-time, mid-energy check-in, nothing happens at all.

**(b) Technical.** The eval is split by testability: a **pure** `_shared/checkin/evalContract.ts`
(`EvalResult`, `EVAL_SCHEMA`, `isEvalResult`, `formatAnchorBlock`, and the combinator `evaluateWith`
— bounded retry + **fail-open**) plus a thin Deno binder `eval.ts` (`evaluateDoing`, one
`dev_overrides_enabled` read). It rides the existing `generate<T>` with a per-call validator — no
second provider path — and it **fails open**: a structural *or* transport failure yields
`{deviation:false, intervention:false}` and a log line, because the doing is already ingested and a
check-in must never 500 on the eval. The adapter gains a **stub dispatch** table
(`_shared/llm/stubShapes.ts`, keyed by validator identity via a `WeakMap`) so `llm_stub_mode=true`
exercises the eval shape instead of failing it. `dev_force.eval_intervention` (re-checked
server-side) forces the result for drills.

**(c) Capability added.** A small, bounded, fail-open judgement call that turns a raw check-in into
the question "does the coach need to speak?" — without ever putting ingestion at risk.

---

## Step 3b — The intervention turn + the §5.3 exclusion ✅

**(a) User perspective.** When a check-in is flagged, Davos actually **speaks**: a reply appears in
the chat and a high-priority push arrives, and the reply is built **with the user's energy** so the
tone matches the number — drained gets empathy, fired-up gets push. The story: ignoring the loop is
not something the app lets slide; the coach notices and comes to the user. Separately, these
check-in turns must not secretly corrupt the persona-learning counter, so the user's future coaching
stays honest.

**(b) Technical.** The primary-reply insert helper is extracted from `send-message` into
`_shared/replies.ts` (one implementation for both functions). `submit-checkin` then gates on
`energy ≤ energy_exhausted_max` **or** `now > window close + checkin_late_minutes`; on
`intervention=true` it writes the user row (`metadata.source='checkin'`, the doing id,
`client_message_id` only for the chat path) and runs `runPipeline(text, energy)` — the per-turn
energy param FP-03 left dormant, which **activates the §6.2 energy override** — then the primary
reply and one high-priority push (bounded await; the turn is already committed). A transport failure
inside degrades through the **unchanged** §4.1 machinery (holding reply + exactly one `llm_retry`).
`send-message`'s §5.3 qualifying-row scan skips check-in-source rows **NULL-safely**, and
`submit-checkin` never calls the recorder. One structured submit log line (FR-18).

**(c) Capability added.** The intervention — Davos's unprompted voice inside the loop — plus the
transparency rule that keeps its persona adaptation unpolluted by non-engagement turns.

---

## Step 4 — Client scheduler + notifications + pending store ▶ *(source-complete; device proof in Step 8)*

**(a) User perspective.** This is the part the user directly feels: their phone nudges them at the
end of each hour with *"What did you do this hour?"*, and they can **reply right from the
notification** without opening the app. If that reply can't be sent (offline, app killed), it is
never lost — it waits and retries on its own. The story: the accountability heartbeat lives in their
pocket, and missing one reply never breaks the next.

**(b) Technical.** Three modules: `lib/checkinGrid.ts` — pure window math, the client **twin** of the
server grid (same local active-start anchoring, no-overnight rule,
`checkin_{userId}_{epochHour}` ids, fire-at-close, inclusive `±cadence/2` snap), proven against the
**one shared fixture** the server suite runs (drift is a stop condition, NFR-7); `lib/checkins.ts` —
the scheduler (`armCheckins`/`cancelCheckins`, idempotent re-arm via deterministic ids; Android
channel `checkin` and category `checkin_reply` with the Reply action and the
`davos://chat?focus=checkin` tap; timezone sync through `update_checkin_prefs`; the direct-reply
hook; the flush triggers — NetInfo, Realtime `SUBSCRIBED`, `AppState`, manual, **never a timer**);
and `lib/checkinQueue.ts` — the pending store (the `sendQueue` pattern: per-user AsyncStorage key,
entries `{content, windowTs, retryAt, attempts}`, sequential flush). Web schedules nothing
(`Platform.OS === 'web'` returns early — the banner is Step 5's). Armed at the `(app)` layout on
auth and `AppState` active; cancelled on logout.

**(c) Capability added.** The pulse — the loop now exists on the user's device, idempotent and
resilient to a killed app or a dropped connection.

---

## Step 5 — Chat check-in mode + energy chips + web banner ⬜

**(a) User perspective.** The second doorway into the same loop. Tapping the notification opens a
composer already in **check-in mode**, so the user just types and sends; afterward a row of quick-tap
**energy chips** (1–10, with the emoji map) lets them add the number in a tap. Web users, who get no
notifications, see a persistent **banner** in the app instead. The story: the user logs a check-in
from whichever surface they happen to be on.

**(b) Technical.** `chat.tsx` gains `focus=checkin` (deep link on native, `?focus=checkin` on web)
carrying the pending window; a check-in send goes to `submit-checkin`, never `send-message`. The
optimistic bubble gets a client-only **`logged` terminal state** for on-track turns (which write no
`messages` rows by design, so the orphan heuristic must not fire); an intervention reconciles through
the existing `client_message_id` machinery. Chips PATCH on tap; the server value wins on reload; a
newest-null-energy strip appears on chat open. The web banner shows during active hours when the
current window is unanswered. Unit tests for mode routing, the `logged` transition, the chip state
machine, and the banner predicate.

**(c) Capability added.** The surface — check-in becomes a first-class cross-platform chat
interaction, not just a notification.

---

## Step 6 — Watchdog schedule + dispatcher handlers (migration 0027) ⬜

**(a) User perspective.** If the user goes silent, Davos doesn't let the window slide by: within
minutes it **comes to them** — an unprompted message in the chat (plus a push where the platform
allows it). The story: ignoring the loop is not a strategy the app tolerates; absence is noticed,
not rewarded with silence.

**(b) Technical.** Migration `0027` schedules a **guarded** `insert into jobs (… 'watchdog_checkin')`
every 5 minutes (the 1-min dispatcher tick stays the sole claimer). The `watchdog_checkin` handler
reuses the **same server grid** as `submit-checkin` to find windows closed between
`watchdog_grace_minutes` and `watchdog_lookback_minutes` ago that have no answering doing and no
existing intervention job, and inserts `intervention {userId, window, reason:'missed_checkin'}`. It
joins `FAST_JOB_TYPES` (cheap: SQL + inserts); `intervention` deliberately does not (it is
generation-capable). The `intervention` handler generates with persona `mentor_tough`, writes the
**unprompted** assistant row (`reply_to` NULL, `metadata.source='watchdog_intervention'`) plus a
high-priority push, is idempotent on re-claim, and lazily imports the pipeline (a missing provider
secret fails only that job type). A dev-only `dev-smoke ?action=watchdog-scan` gives a backdated
drill.

**(c) Capability added.** The safety net — the loop now reacts to **absence**, not just to answers,
and the same delivery surface later FPs can reuse.

---

## Step 7 — Settings: cadence, active hours, permission state ⬜

**(a) User perspective.** The loop adapts to the user's day, not the reverse: they choose **hourly or
two-hourly**, set their active hours, see their timezone, and see clearly whether notifications are
allowed — with a nudge to fix it if they're off (because check-ins and accountability depend on
them). The story: the rhythm is the user's to tune, and the app is honest when the platform is
silently blocking it.

**(b) Technical.** `settings.tsx` (the FP-01 stub made real, scoped to check-ins only): a cadence
picker (60/120), active-hours pickers, read-only timezone, and notification-permission state with a
re-prompt path and the R-4 warning copy. Save → `update_checkin_prefs` → scheduler re-arm.
Client-side validation mirrors the RPC's; invalid combinations are blocked on **both** sides.

**(c) Capability added.** Control — the user can make the loop fit their life, and a schedule change
takes effect on the next arm.

---

## Step 8 — Device drill, doc write-backs, AC sweep ⬜

**(a) User perspective.** The promise behind everything above: it genuinely works on a real phone.
A notification actually fires at the hour; a background reply actually lands a row without the app
being opened; the push actually arrives; the tap actually opens the composer; the web banner
actually shows. The story: we find out it works **before** users do — and the one known gap (iOS
remote push, a $0 budget decision) is documented rather than discovered.

**(b) Technical.** A write-back sweep (confirming every TECH-SPEC / GLOSSARY edit landed with its
introducing commit, and completing the remainder — §7.1 as-built, §2.3 both handlers implemented,
§3.2 index, §4.1/§4.3 eval contract + stub dispatch, §5.1/§5.3, §6.1 energy threaded, §11/§13/§16,
GLOSSARY §2/§8/§13/§14/§15/§16); `FP-04-ACCEPTANCE.md` (the AC ledger with
`[script]`/`[measured]`/`[owner-observed]`/`[derived]` evidence tags and a re-run recipe);
the owner device-drill checklist (Android / iOS / web); and the regression legs (`verify-step11.py`
for FP-02, `verify-fp03-step7.py --static-only` for FP-03).

**(c) Capability added.** Proof and a ledger — the loop is verified on hardware, its ACs are
evidenced, and the docs match what shipped.

---

**The arc:** *one doing per window* (1) → *a stored, vectorized check-in* (2) → *a bounded judgement*
(3a) → *Davos speaks* (3b) → *the pulse on the device* (4) → *the surface everywhere* (5) →
*absence noticed* (6) → *the user's control* (7) → *proven on hardware* (8).
