Read and validated `.env` (values never printed — only presence and the project host).

## What `.env` gives you

| `.env` key                      | Gate's variable                         | Status                                        |
| ------------------------------- | --------------------------------------- | --------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | `SUPABASE_URL` (accepted as a fallback) | set — host `cbwujqezrvqfcicpuwtq.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `SUPABASE_ANON_KEY` (fallback)          | set                                           |
| `SUPABASE_SERVICE_ROLE_KEY`     | `SUPABASE_SERVICE_ROLE_KEY`             | set                                           |
| `DEV_SMOKE_TOKEN`               | `DEV_SMOKE_TOKEN`                       | set                                           |
| —                               | `DAVOS_USER_JWT`                        | **missing**                                   |

Good news: `verify-fp03-step7.py`'s `env()` already accepts `EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY` as fallbacks, so **no renaming is needed**. The file is 4 plain `KEY=value` lines — no quotes, no comments, no BOM.

## The one command

```powershell
Get-Content .env | Where-Object { $_ -match '^\s*[A-Za-z_]\w*\s*=' } | ForEach-Object { $k,$v = $_ -split '=',2; Set-Item -Path "env:$($k.Trim())" -Value $v.Trim().Trim('"').Trim("'") }; $env:DAVOS_USER_JWT='<signed-in user JWT from web devtools>'; python scripts/verify-fp03-step7.py
```

I verified the loader half in this shell: all four `.env` keys resolve in-session. Drop the `$env:DAVOS_USER_JWT=…` segment for a JWT-less run, or use:

```powershell
... ; python scripts/verify-fp03-step7.py --no-fp02
```

**Two caveats before you paste it:**

1. **`DAVOS_USER_JWT` is load-bearing for a full pass.** Without it the two `verify-step11.py --turns 6 --cleanup` legs (`real` then `stub`) **SKIP**, not fail — the script still exits 0 and still prints `PASS -- all checks green`. That silently leaves **DoD row 43 ("FP-02 suite green under both modes") unprovable**, so AC-8 can flip but that row can't. Get the JWT from web devtools (the `verify-step8.py` precedent), or accept that row staying ⏳. Any `SKIP` line in the output means "green run, incomplete evidence."
2. **Budget the day.** The live half re-seeds the rules corpus inside each FP-02 leg (a full re-seed is 228 embed units ≈ 23% of the RPD), plus the paced preflight and the drill. Run it alone.

I deliberately did **not** run the live half from here — it mutates `config` and spends embedding quota, and it's your credentialed run.

## Doc changes when it comes back green

Flip these **in one change** — the gate now asserts that the tracker row and AC-8 agree, so flipping one alone will fail `--static-only`.

**`docs/feature-prds/FP-03/FP-03-ACCEPTANCE.md`**

- **line 5** status → `**Status:** **10/10 ACs PASS.**` with the run date and the counts.
- **line 28** AC-8 `⏳ OWNER` → `✅ PASS`; replace `[measured] _pending_ —` with the run's real numbers (baseline → `seed-exemplars&source=BG-04` → drill label wins ≥ 0.99 and strictly beats baseline → `clear-exemplars&source=BG-04` → baseline restored exactly, 0 `BG-04` rows). Keep the `[script]` half and the "content swap is postponed" clause.
- **line 38** DoD `All ACs verified…` → `✅`, text → "10/10 marked".
- **line 42** DoD `BG-04 hot-swap runbook committed (the Step 7 drill is its proof)` → `✅` (the live proof has now elapsed; the content swap itself stays postponed).
- **line 43** DoD `FP-02 test suite green under both modes` → `✅` **only if the JWT was supplied**; otherwise leave ⏳.
- **line 40** `Merged to main` → `✅` when you merge.

**`docs/feature-prds/FP-03/FP-03-PLAN.md`**

- **line 21** tracker row 7 `▶` → `✅`. Lines 23 and 158 are rule statements — no change.

**`PROGRESS.md`** — **append** a new entry; don't rewrite the 2026-10-17 one. Record the command, date, PASS/FAIL/SKIP counts, the drill's numbers, whether the FP-02 legs ran or skipped, and `AC-8 + DoD rows flipped; tracker row 7 ▶→✅`. The `59/0/0` figure already in that entry stays correct as the _static_ count.

**`docs/feature-prds/FP-03/FP-03-EXPLANATION.md`**

- **lines 3–8** status block → the credentialed run is no longer the outstanding verification.
- **line 76** Step 7 note: "the credentialed gate run is still the outstanding half — so the tracker row stays ▶ and AC-8 stays ⏳" → past tense.

**No change needed:** `FP-03-BG04-SWAP-RUNBOOK.md` (its status line is about the content-swap postponement, still true), `TECH-SPEC.md` §6.2/§6.4 (as-built, no pending markers), `FP-03-GOLDEN-SET-2026-10-17.md` (archived evidence; §7a already records the decisions), `FP-03.md` (your PRD).

Then the config writes, logged in `PROGRESS.md` as the flip's who/when/why:

```sql
update config set value = '"real"' where key = 'classifier_mode';        -- rollback: '"stub"'
update config set value = 'false' where key = 'dev_overrides_enabled';   -- after any force-based re-verification
```

If any check FAILs instead: leave the rows ⏳, and the failure text is the evidence to fix, not to explain away.
