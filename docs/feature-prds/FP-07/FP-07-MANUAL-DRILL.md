# FP-07 Manual Drill — Owner Guide

**Purpose:** complete the manual half of `FP-07-PLAN.md` Step 7 and turn the two remaining ⏳ rows into evidence:

1. **AC-7 native** — judge the dashboard on a real iOS and Android build.
2. **Proposal judgment** — run the `metric-drill` propose leg once in real mode and judge the formula.
3. **Pre-beta reset** — leave `dev_overrides_enabled` and the drill data in the right state.

This guide is deliberately operational: every command is copy/paste, every visual check has an expected result, and every cleanup step is listed.

**Time:** 30–45 minutes for the accelerated path, plus 7 days if you want a fully organic trend.

**Companion:** `docs/feature-prds/FP-07/FP-07-ACCEPTANCE.md` §5.

---

## 0. Safety rules (read this first)

- **Use your own account or a dedicated drill account.** The commands below seed and clear only the eight preset metrics. They do **not** delete your doings, check-ins, journal entries, chat, or non-preset metrics.
- **Do not run `clear-metrics` if you already have metrics with preset names that you care about.** It is scoped by name and will delete those rows. Check first (Step 1.2). If you have any, use a dedicated drill account.
- **A real-mode proposal makes a real provider call.** Run it in a quiet window, make one call, and restore `llm_stub_mode` immediately.
- **Never put the service-role key in the client, a screenshot, or a chat message.** The commands below use only `DEV_SMOKE_TOKEN`.
- **The empty-state check needs a user with zero metrics.** If your account has other metrics, use a fresh drill account or record “not applicable — account has non-drill metrics” rather than deleting real metrics.
- **Dates are profile-local.** `metric-drill eval` takes a calendar date in your `profiles.timezone`, not UTC. If your laptop timezone differs from your profile timezone, use the SQL in Step 2.2 to list the dates.

---

## 1. Prerequisites

### 1.1 Load the environment (PowerShell)

From the repo root:

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    Set-Item -Path "env:$($matches[1])" -Value $matches[2].Trim().Trim('"').Trim("'")
  }
}
$base  = $env:EXPO_PUBLIC_SUPABASE_URL.TrimEnd('/')
$token = $env:DEV_SMOKE_TOKEN
$headers = @{ Authorization = "Bearer $token" }
```

Check that the values are present **without printing the token**:

```powershell
"base=$base"
"token_present=$([bool]$token)"
```

Expected: `token_present=True`.

### 1.2 Find your user UUID and check for preset-name collisions

Your user UUID is in **Supabase Dashboard → Authentication → Users** (copy the `id`, not the email). Set it once:

```powershell
$userId = "<paste-your-uuid-here>"
```

Check for existing preset-name metrics:

```powershell
$presetNames = @(
  'Momentum','Deep Work Hours','Check-in Consistency','Energy Level',
  'Impulse Control','Journal Positivity','Quest Completions','Life Balance'
)
$inList = ($presetNames | ForEach-Object { "`"$_`"" }) -join ','
$check = Invoke-RestMethod -Method Get `
  -Uri "$base/rest/v1/metrics?select=id,name&user_id=eq.$userId&name=in.($inList)" `
  -Headers @{ apikey = $env:SUPABASE_SERVICE_ROLE_KEY; Authorization = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY" }
$check | ConvertTo-Json -Depth 4
```

- **`[]`** → safe to continue on this account.
- **Any rows** → stop and use a dedicated drill account. Do **not** clear someone’s real metrics.

> The REST check uses the service key only at your terminal. If you prefer no service key, skip the check and seed on a dedicated account.

### 1.3 Confirm the dashboard route works

```powershell
npm run web
```

Open the printed URL, sign in, and open **Dashboard** (`/dashboard`). On a fresh user it should show **“No metrics yet”** — not an error screen. Leave this browser tab open.

For native, have your current iOS/Android dev build ready. The same account must be signed in.

---

## 2. Seed the eight presets and capture the “fresh metric” state

### 2.1 Seed

```powershell
$seed = Invoke-RestMethod -Method Post `
  -Uri "$base/functions/v1/dev-smoke?action=seed-metrics&user=$userId" `
  -Headers $headers
$seed | ConvertTo-Json -Depth 5
```

Expected:

```json
{ "ok": true, "inserted": 8, "skipped": 0, "failed": 0, "adapterCalls": 0 }
```

Reload **Dashboard**. Expected now: **eight cards**, each showing the metric name and the `StatCard` body. There are no points yet, so latest/delta are empty. This is the **AC-7 fresh-metric/StatCard state** — record it before moving on.

If you see “No metrics yet,” the seed did not land for the signed-in user. Check that `$userId` matches the signed-in account.

### 2.2 Create seven point-days (accelerated)

The heatmap toggle requires **≥7 points**. The eval runner writes a point for every active validated metric even on a zero-activity day, so seven forced evals are enough to unlock the layout.

List your last seven **profile-local** dates in the Supabase SQL editor:

```sql
select (now() at time zone timezone)::date - i as day
from profiles, generate_series(0, 6) i
where id = '<paste-your-uuid-here>'
order by day;
```

Copy them oldest → newest into a PowerShell array:

```powershell
$dates = @(
  '2026-10-15',
  '2026-10-16',
  '2026-10-17',
  '2026-10-18',
  '2026-10-19',
  '2026-10-20',
  '2026-10-21'
)
```

Run the production evaluator for each date:

```powershell
foreach ($d in $dates) {
  $r = Invoke-RestMethod -Method Post `
    -Uri "$base/functions/v1/dev-smoke?action=metric-drill&leg=eval&user=$userId&date=$d" `
    -Headers $headers
  "{0}: metrics={1} points={2} disabled={3}" -f $d, $r.metrics, $r.pointsWritten, $r.disabled
}
```

Expected: every line has `disabled=False`, `metrics>=8`, and `points>=8`. If `disabled=True`, `metric_eval_enabled` is off — stop and check config before judging.

Reload **Dashboard**. Expected now:

- Each card with ≥2 points renders `TrendLineGraph`.
- Each trend with ≥7 points shows the **Trend / Heatmap** toggle.
- The heatmap shows seven cells and toggles back to the trend.

The older zero days will give flat zero values; that is expected. To judge whether the numbers *mean* something, put real data on today (Step 3) and compare.

---

## 3. Put one honest day on the board

Do this in the app as a normal user:

1. Complete a check-in with **one doing** and an **energy value**.
2. Send one chat message (this may add a chat-sourced doing).
3. Write one journal entry with a clear positive or negative tone.
4. Return to Dashboard and force today:

```powershell
$today = (Get-Date).ToString('yyyy-MM-dd')   # only if laptop TZ == profile TZ
$r = Invoke-RestMethod -Method Post `
  -Uri "$base/functions/v1/dev-smoke?action=metric-drill&leg=eval&user=$userId&date=$today" `
  -Headers $headers
$r | ConvertTo-Json -Depth 8
```

Then read the day’s inputs:

```powershell
$report = Invoke-RestMethod -Method Post `
  -Uri "$base/functions/v1/dev-smoke?action=metric-drill&leg=report&user=$userId&date=$today" `
  -Headers $headers
$report | ConvertTo-Json -Depth 10
```

Use `viewRow`, `vars`, `expectedWindows`, `answeredWindows`, and `zeroData` to explain what the cards *should* show:

| Card | Expected from the report |
|---|---|
| Momentum | `vars.doings_count` |
| Deep Work Hours | `vars.hours_logged` (distinct check-in windows × cadence / 60) |
| Check-in Consistency | `vars.checkin_compliance_rate × 100` |
| Energy Level | `vars.energy_avg`, or **0** when `doings_count = 0` |
| Impulse Control | **1** when `impulse_failures = 0`, otherwise **0** |
| Journal Positivity | positive / (positive + negative) × 100, or 0 with no mentions |
| Quest Completions | `vars.quest_completions` (completed quest metrics with deadline = that day) |
| Life Balance | `min(doings,8) + min(hours,8) + compliance × 4` |

If a value disagrees, record the report values and the card value. Do not “fix” the card by editing the database; that is a bug to investigate.

---

## 4. Add a quest-shaped card (ProgressBar)

The eight presets are core metrics, not quests. To exercise the `ProgressBar` path, add one drill-only quest. This is a **visual fixture**, not a production-created metric; delete it in cleanup.

In the Supabase SQL editor:

```sql
insert into metrics (
  user_id, name, domain, is_quest, quest_status, quest_deadline,
  formula, formula_status, output_unit, is_core, created_at
)
select
  '<paste-your-uuid-here>'::uuid,
  'FP-07 Drill Quest',
  'Career',
  true,
  'active',
  current_date + 4,
  '{"var":"doings_count"}'::jsonb,
  'validated',
  'steps',
  false,
  now() - interval '3 days'
where not exists (
  select 1 from metrics
  where user_id = '<paste-your-uuid-here>'::uuid
    and name = 'FP-07 Drill Quest'
);
```

Reload Dashboard. Expected: a **ProgressBar** card named `FP-07 Drill Quest`, with an elapsed fraction from three days ago to four days from now. It does not need points; the rule is “quest + deadline wins.”

> This SQL bypasses the normal `insertValidatedMetric` helper because it is a manual drill fixture. The formula is already whitelisted and no AI output is involved. Do not reuse this SQL as a product write path.

---

## 5. Web drill checklist (AC-7 web half)

Open Dashboard at 1280px wide (or your normal desktop width) and check:

| Check | Expected |
|---|---|
| Cards | Eight preset cards + the drill quest; no error screen |
| Header text | Metric name, unit, latest value, and day-over-day delta are outside the registry body |
| Delta | `+N` / `-N` vs the previous point; no delta on a single-point metric |
| Trend | A non-quest metric with ≥2 points renders the normalized trend strip |
| Heatmap toggle | Appears only at ≥7 points; clicking it replaces the trend with a 7-cell heatmap and switches back |
| StatCard | Step 2.1’s fresh state: all eight presets render as StatCards with no latest/delta before any eval |
| ProgressBar | The drill quest renders as a progress bar with a visible fraction |
| Theme | Toggle light/dark: cards, text, gridlines, and heatmap remain legible; no hardcoded colors |
| Markup | Any metric name containing `<b>…</b>` appears as literal text, never as an HTML element |
| Empty state | After cleanup on a zero-metric account, “No metrics yet” — no crash, no error card |
| Refresh | Tab away and back, or use the refresh control; values do not duplicate or disappear |

Record each row as **Pass / Fail / N/A**, with a screenshot filename and one sentence of judgment.

### 5.1 What to judge, not just check

- **At a glance:** can you tell whether today was better or worse without reading every number?
- **Truth:** do the latest value and delta match the report from Step 3?
- **Meaning:** does each preset’s number correspond to a behavior you would actually coach? If a preset reads as noise on real data, write it down as a retune candidate; do not silently change thresholds.
- **Heatmap:** does the toggle earn its place, or is it visual noise? Record the answer; this is an advisory judgment.
- **Progress:** does the elapsed fraction communicate the quest’s remaining time?

---

## 6. Native drill checklist (AC-7 native half)

Run the same account on iOS and Android. For each platform:

| Check | Expected |
|---|---|
| Dashboard loads | Cards render, no red error screen |
| Layout | No clipped cards, no horizontal scroll, safe areas respected |
| Latest/delta | Same values as web for the same account/date |
| Trend | Touch-scrolling the page does not fight the chart |
| Heatmap toggle | Tappable, ≥44pt target, switches on the first tap |
| ProgressBar | Quest card renders with the correct label/fraction |
| Light/dark | Both themes legible; system theme change updates without restart |
| Refresh | Focus refresh does not flicker or duplicate cards |
| Performance | Dashboard opens and settles without a visible stall on a mid-range device |

If a platform fails only visually (padding, truncation, contrast), record it as a **UI fix** with a screenshot; if the numbers differ from web/DB, record it as a **data bug**.

---

## 7. Proposal drill (real mode)

### 7.1 Snapshot the config

Do this before changing anything:

```powershell
$configKeys = 'llm_stub_mode','llm_stub_malformed','llm_force_fail','dev_overrides_enabled','metric_eval_enabled'
$before = Invoke-RestMethod -Method Get `
  -Uri "$base/rest/v1/config?select=key,value&key=in.($($configKeys -join ','))" `
  -Headers @{ apikey = $env:SUPABASE_SERVICE_ROLE_KEY; Authorization = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY" }
$before | ConvertTo-Json -Depth 5
```

Write the values down. You will restore them exactly.

### 7.2 Switch on real generation

In the Supabase SQL editor:

```sql
update config set value = 'false'::jsonb where key = 'llm_stub_mode';
```

Confirm:

```sql
select key, value from config where key = 'llm_stub_mode';
```

Expected: `false`. If your provider keys are not configured, stop — do not treat a stub response as a real proposal.

### 7.3 Run exactly one proposal

```powershell
$domain = [uri]::EscapeDataString('Learning')
$text   = [uri]::EscapeDataString('I want to read 20 pages every day')
$uri = "$base/functions/v1/dev-smoke?action=metric-drill&leg=propose&user=$userId&domain=$domain&text=$text"
$proposal = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers
$proposal | ConvertTo-Json -Depth 12
```

Expected shape (success):

```json
{
  "ok": true,
  "leg": "propose",
  "user": "…",
  "status": "validated",
  "proposal": {
    "name": "…",
    "domain": "Learning",
    "formula": { "…": [] },
    "output_unit": "…",
    "rationale": "…"
  },
  "attempts": 1,
  "adapterCalls": 1,
  "gateRejections": []
}
```

Allowed outcomes:

- `validated` — judge the formula below.
- `described` — the model failed the gate twice and returned a human description. Record it; this is a valid fallback, not a crash.
- `error` — provider/transport/config failure. Record the error; do not loop.

### 7.4 Judge the formula

| Question | Pass condition |
|---|---|
| Variables | Only the eight legal names: `doings_count`, `hours_logged`, `checkin_compliance_rate`, `energy_avg`, `impulse_failures`, `journal_positive_mentions`, `journal_negative_mentions`, `quest_completions` |
| Operators | Only the 18 whitelisted ops (`var`, arithmetic, comparisons, `if`, `and`, `or`, `not`, `min`, `max`) |
| Result | Numeric; not a top-level boolean (booleans are skipped by the dashboard) |
| Denominator | Division by zero is guarded or impossible in practice |
| Unit | Matches what the formula actually computes |
| Domain | One of the canonical 16 domains (or `General`) |
| Name | Short, human, not a duplicate of an existing preset |
| Rationale | Explains why the number is worth coaching, not how the JSON works |
| Writes | Zero rows: `metrics` count before and after is unchanged |
| Security | `tactical_analysis` is **absent** from the response |

Count rows before/after in SQL:

```sql
select count(*) as metrics_before from metrics where user_id = '<paste-your-uuid-here>';
-- run the proposal
select count(*) as metrics_after from metrics where user_id = '<paste-your-uuid-here>';
```

Expected: same number. If the proposal wrote a row, stop; that violates FP-07’s no-write contract.

### 7.5 Restore config immediately

Restore the **exact values from Step 7.1**. The project default for this drill is:

```sql
update config set value = 'true'::jsonb where key = 'llm_stub_mode';
update config set value = 'false'::jsonb where key = 'llm_stub_malformed';
update config set value = '"none"'::jsonb where key = 'llm_force_fail';
```

`llm_force_fail` is a JSON string; keep the original quoting. If your Step 7.1 snapshot differs (for example because the production-intended `llm_stub_mode` is `false`), use the snapshot value instead. Restore `dev_overrides_enabled` to its snapshot value.

Confirm:

```sql
select key, value from config
where key in ('llm_stub_mode','llm_stub_malformed','llm_force_fail','dev_overrides_enabled','metric_eval_enabled')
order by key;
```

---

## 8. Record the result and flip AC-7

Paste this block into `docs/feature-prds/FP-07/FP-07-ACCEPTANCE.md` §5 (replace the placeholders):

```markdown
### AC-7 owner drill — YYYY-MM-DD

**Build:** <commit / build id> · **Platforms:** web, iOS, Android
**User:** <uuid> · **Profile timezone:** <tz> · **Dates:** <oldest>…<today>

| Check | Result | Evidence / note |
|---|---|---|
| Eight preset cards + quest | Pass / Fail | |
| Latest + delta match report | Pass / Fail | |
| Trend at ≥2 points | Pass / Fail | |
| Heatmap toggle at ≥7 points | Pass / Fail | |
| StatCard on fresh metric | Pass / Fail | |
| ProgressBar on quest | Pass / Fail | |
| Light/dark legibility | Pass / Fail | |
| Web full render | Pass / Fail | |
| iOS render | Pass / Fail | |
| Android render | Pass / Fail | |
| Empty state | Pass / Fail / N/A | |

**Meaning judgment:** <one paragraph: which presets read clearly, which are noise, retune candidates>
**Native notes:** <clipping / touch / contrast / performance>
**Proposal drill:** status=<validated|described|error>; attempts=<n>; calls=<n>;
formula=<paste>; unit=<unit>; rationale=<paste>; rows_written=0; tactical_absent=<yes/no>.
**Verdict:** AC-7 ✅ / retune before sign-off / blocked by <reason>
```

Then edit the AC-7 row in §1 from `✅ web / ⏳ native` to **✅**, and add the evidence tags:

```markdown
| AC-7 | … | `[script]` web drill; `[owner-observed]` iOS/Android + proposal | ✅ |
```

If you found a retune candidate, leave AC-7 at ⏳ until the preset/formula is retuned and re-drilled. Do not mark a known-meaningless preset as passed.

---

## 9. Cleanup and reset (do not skip)

### 9.1 Delete the drill-only quest

```sql
delete from metrics
where user_id = '<paste-your-uuid-here>'::uuid
  and name = 'FP-07 Drill Quest';
```

### 9.2 Clear the seeded presets

```powershell
$clear = Invoke-RestMethod -Method Post `
  -Uri "$base/functions/v1/dev-smoke?action=clear-metrics&user=$userId" `
  -Headers $headers
$clear | ConvertTo-Json -Depth 5
```

Expected: `deleted=8`, `adapterCalls=0`. If `deleted` is less than 8, you had collisions or already cleared some; record the actual count.

### 9.3 Confirm the account is back to its pre-drill shape

- Dashboard: “No metrics yet” **if and only if** the account had no other metrics. Otherwise your real metrics remain and the empty state is N/A.
- Config: `llm_stub_mode` restored; `llm_stub_malformed=false`; `llm_force_fail='none'`; `dev_overrides_enabled` restored/false.
- `metric_eval_enabled=true` for the beta; the cron schedule `metric-eval-daily` remains active.
- No `FP-07 Drill Quest` row remains.
- No test/proposal rows remain in `metrics`.

### 9.4 Pre-beta checklist

- [ ] AC-7 web/native is ✅ or an explicit ⏳ with a named blocker.
- [ ] Proposal drill recorded; zero rows written; `tactical_analysis` absent.
- [ ] `dev_overrides_enabled` is `false` unless another approved drill still needs it.
- [ ] `llm_stub_mode` is restored to the production-intended value.
- [ ] `llm_force_fail='none'`.
- [ ] Drill quest and preset metrics removed from your account.
- [ ] The dashboard empty state is still “No metrics yet,” not an error screen.
- [ ] `cron.job` still has `metric-eval-daily` active at `*/15 * * * *`.
- [ ] FP-03 BG-04 and FP-06 owner drills are still tracked separately; this drill does not close them.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Forbidden: dev-smoke requires bearer token` | Missing/wrong `DEV_SMOKE_TOKEN` | Reload `.env`; use `Authorization: Bearer $env:DEV_SMOKE_TOKEN` |
| `400 date=YYYY-MM-DD is required` | Missing date or wrong format | Use a profile-local `YYYY-MM-DD` |
| `400 domain is required…` | Domain not canonical | Use `Career`, `Learning`, `Health`, etc. (URL-encode it) |
| Seed returns `inserted=0` | Presets already exist | Expected; re-seed is idempotent. Note skipped count |
| Dashboard still says “No metrics yet” | Wrong signed-in user, or seed on another UUID | Confirm `$userId` equals the JWT `sub` |
| No heatmap toggle | Fewer than 7 points | Run eval for 6 more dates |
| Quest renders as trend/stat | Missing `is_quest` or `quest_deadline` | Re-check the quest fixture |
| No StatCard | Every metric already has points | Add a fresh metric with 0 points, or inspect before the first eval |
| Empty state not shown after cleanup | Account has non-preset metrics | Use a zero-metric drill account or record N/A |
| Values do not match | Wrong local date, missing view row, zero-data fallback, or profile timezone | Run `leg=report`; compare `vars`, `expectedWindows`, `answeredWindows`, `zeroData` |
| Energy shows 7 but you logged 9 | More than one energy value; average is used | Check `viewRow.energy_avg` |
| Impulse Control is 0/1, not a count | Preset is a binary “no impulse” score | Expected; this is the preset’s design |
| Proposal returns `status=described` | Two gate failures then fallback | Valid outcome; judge the description. Do not loop |
| Proposal returns `status=error` | Provider keys/transport/config | Restore stub mode, record the error, retry once in a quiet window |
| `tactical_analysis` appears in the JSON | Security bug | Stop; do not persist or screenshot it; report it |
| Proposal wrote a row | Contract violation | Stop; inspect `propose.ts` and the caller; do not continue the drill |

---

## 11. One-page command appendix

```powershell
# 0) Load env
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    Set-Item -Path "env:$($matches[1])" -Value $matches[2].Trim().Trim('"').Trim("'")
  }
}
$base = $env:EXPO_PUBLIC_SUPABASE_URL.TrimEnd('/')
$headers = @{ Authorization = "Bearer $env:DEV_SMOKE_TOKEN" }
$userId = '<uuid>'

# 1) Seed
Invoke-RestMethod -Method Post -Uri "$base/functions/v1/dev-smoke?action=seed-metrics&user=$userId" -Headers $headers

# 2) Force seven local days (replace dates)
@('2026-10-15','2026-10-16','2026-10-17','2026-10-18','2026-10-19','2026-10-20','2026-10-21') |
  ForEach-Object {
    $r = Invoke-RestMethod -Method Post -Uri "$base/functions/v1/dev-smoke?action=metric-drill&leg=eval&user=$userId&date=$_" -Headers $headers
    "$_ metrics=$($r.metrics) points=$($r.pointsWritten)"
  }

# 3) Report today
Invoke-RestMethod -Method Post -Uri "$base/functions/v1/dev-smoke?action=metric-drill&leg=report&user=$userId&date=$(Get-Date -Format yyyy-MM-dd)" -Headers $headers |
  ConvertTo-Json -Depth 10

# 4) Proposal (real mode only; restore llm_stub_mode afterwards)
$domain = [uri]::EscapeDataString('Learning')
$text = [uri]::EscapeDataString('I want to read 20 pages every day')
Invoke-RestMethod -Method Post -Uri "$base/functions/v1/dev-smoke?action=metric-drill&leg=propose&user=$userId&domain=$domain&text=$text" -Headers $headers |
  ConvertTo-Json -Depth 12

# 5) Cleanup
Invoke-RestMethod -Method Post -Uri "$base/functions/v1/dev-smoke?action=clear-metrics&user=$userId" -Headers $headers
```

**Done means:** AC-7 is ✅ with native evidence, the proposal judgment is recorded, config is restored, and the drill data is gone.
