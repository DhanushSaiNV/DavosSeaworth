# BG-03 — Rules Library Draft: Final Sweep Report

**Status: DRAFT — not owner-approved. Zero rows seeded (AGENTS §8.4).**
**Date:** 2026-10-16 · **Package:** FP-BG BG-03 (Steps 1–5) · **Corpus:** `content/rules.json` (frozen) · **Assembled:** `content/rules.csv` (120 rows)
**Governing refs:** PRD §2; D17; TECH-SPECS §3.3, §5.2; AGENTS §8.4; BG-02 decision memo (approved enum).

## 1. Headline numbers

| Metric | Value | Target | |
| --- | --- | --- | --- |
| Total rules | **120** | ≥ 100 (PRD §2) | ✓ |
| Domains | 16 (approved enum, BG-02) | 16 (PRD §2) | ✓ |
| Min rules per domain | **6** (purpose, spirituality, time, communication, learning, habits) | ≥ 6 | ✓ |
| Max rules per domain | 10 (mind, mastery, wealth) | — | |
| Distinct named figures | **~74** (aliases merged: Buffett/Warren Buffett, Jobs/Steve Jobs, Caesar/Julius Caesar, da Vinci/Leonardo da Vinci, Munger/Charlie Munger, Dalio/Ray Dalio, Taleb/Nassim Taleb, Roosevelt/Theodore Roosevelt, Churchill/Winston Churchill, Picasso/Pablo Picasso, Musk/Elon Musk, James/William James) | ≥ 50 (PRD §2) | ✓ |
| Validation | `validate.ts` clean (schema, tone enum, priority range, non-empty figures, near-dup Jaccard ≥ 0.85) | clean | ✓ |
| Rows seeded | **0** (seeding = BG-01 Step 3, owner-gated) | 0 | ✓ |

## 2. Per-domain distribution (count · aggressive/empathetic/neutral · priority range)

| Domain | n | A/E/N | Priority |
| --- | --- | --- | --- |
| mind | 10 | 1/0/9 | 58–88 |
| mastery | 10 | 6/0/4 | 68–93 |
| strategy | 9 | 1/0/8 | 48–88 |
| wealth | 10 | 3/1/6 | 45–90 |
| health | 7 | 3/1/3 | 52–88 |
| character | 9 | 4/2/3 | 55–94 |
| relationships | 8 | 2/2/4 | 56–78 |
| creativity | 7 | 1/0/6 | 54–78 |
| resilience | 7 | 2/0/5 | 62–82 |
| purpose | 6 | 1/2/3 | 58–80 |
| spirituality | 6 | 0/2/4 | 60–82 |
| time | 6 | 2/1/3 | 54–86 |
| communication | 6 | 0/0/6 | 54–78 |
| learning | 6 | 1/0/5 | 58–80 |
| leadership | 7 | 1/0/6 | 56–76 |
| habits | 6 | 2/0/4 | 64–86 |
| **Total** | **120** | **30/11/79** | |

Tone totals: **aggressive 30 (25%) · empathetic 11 (9%) · neutral 79 (66%)** — per the style-guide rubric (tone = the rule's rhetorical stance, domain leanings respected).

Priority bands: 90–95 **5** (core doctrine) · 75–89 **40** (pillars) · 55–74 **68** (standard) · 35–54 **7** (supporting) · <35 **0** (situational band intentionally unused — see §4 gaps).

## 3. Figure inventory (107 distinct source entries; `[g]` = generic non-person entry)

Alexander (1) · Alexander the Great (2) · Aristotle (9) · `[g]` Aristotle's Rhetoric (1) · Bach (1) · Beethoven (4) · Bezos (1) · `[g]` Bezos's regret minimization (1) · `[g]` Bhagavad Gita (2) · Bruce Lee (2) · Brunelleschi (1) · Buddha (1) · Buffett (13) · Caesar (2) · Carl Jacobi (1) · Carnegie (13) · Charlie Munger (2) · Churchill (10) · Confucius (7) · Copernicus (1) · da Vinci (5) · `[g]` da Vinci's regret (1) · Dalio (3) · Darwin (15) · Descartes (1) · Disraeli (1) · Dostoevsky (1) · Edison (3) · Einstein (3) · Elon Musk (1) · Epictetus (2) · Feynman (8) · Frankl (2) · Franklin (25) · `[g]` Franklin's routine structure (1) · Gandhi (2) · Gates (1) · Genghis Khan (2) · George Clason (1) · Grant (2) · Homer (1) · J.P. Morgan (1) · `[g]` Jack Welch synthesis (1) · James (1) · Jefferson (2) · Jerry Seinfeld method (1) · Jobs (4) · `[g]` Judo principle (1) · Julius Caesar (1) · Kant (5) · Kekulé (1) · Lao Tzu (4) · Leonardo da Vinci (1) · Lincoln (21) · Lynch (1) · Machiavelli (5) · Mandela (6) · Marcus Aurelius (16) · Marcus Aurelius (Memento Mori) (1) · `[g]` Matthew Walker's synthesis (1) · Michelangelo (1) · `[g]` modern synthesis (3) · `[g]` modern synthesis of ancient practice (1) · Montaigne (1) · `[g]` most military greats (1) · Mozart (1) · Munger (6) · Musashi (6) · Musk (2) · Napoleon (12) · Nassim Taleb (2) · Newton (2) · Nietzsche (2) · Pablo Picasso (1) · Pascal (1) · Patton (2) · Picasso (2) · Poincaré (2) · Ray Dalio (1) · `[g]` Robert Kiyosaki's synthesis of Carnegie (1) · Rockefeller (10) · Roosevelt (3) · `[g]` Samurai tradition (1) · Schopenhauer (1) · `[g]` self-educated greats (1) · Seneca (10) · Shakespeare (1) · Socrates (3) · `[g]` Spartan principle (1) · `[g]` Spartan tradition (1) · Steve Jobs (2) · Sun Tzu (7) · `[g]` Synthesis: Buffett's 25/5 rule (1) · Taleb (2) · Tesla (2) · `[g]` the Stoics (1) · Theodore Roosevelt (2) · Tolstoy (3) · Victor Hugo (1) · von Neumann (1) · Warren Buffett (2) · Washington (5) · Welch (1) · William James (2) · Winston Churchill (1) · `[g]` Zen concept of Shoshin (1) · `[g]` Zen tradition (1)

Most-cited: Franklin 25 · Darwin 15 · Marcus Aurelius 16 · Lincoln 21 · Buffett 13 · Carnegie 13 · Napoleon 12 · Churchill 10 · Rockefeller 10 · Seneca 10.

## 4. Gaps and notes for owner review

1. **18 generic non-person attributions** (`[g]` above) are grandfathered verbatim from the owner corpus (Bhagavad Gita, Zen tradition, "modern synthesis", …). They satisfy the non-empty check but not the named-figure ideal; owner may replace them at approval time.
2. **Empathetic tone is thin (11/120, 9%)** and concentrated in relationships/spirituality/purpose/health/character. Domains with zero empathetic rules (mind, mastery, strategy, creativity, resilience, communication, learning, leadership, habits) will never trigger the §5.2 empathetic group — acceptable (they are method domains), but a deliberate owner check.
3. **One agent-authored rule** (the only content not verbatim from the corpus): `purpose_06` — "Pick the work you would still do unpaid — obsession outlasts every paycheck." (Pablo Picasso, neutral, 62) — closes the ≥6/domain gap flagged in the BG-02 memo. DRAFT; reject or replace freely.
4. **Priority spread:** the 35–54 band holds 7 rules and nothing sits below 35 — the situational band is effectively unused, per style-guide §4 (doctrine rules rarely are situational). Priority ranges are meaningful within every domain (e.g., mastery 68–93, relationships 56–78).
5. **Alias variants** in `source_figure` (Buffett/Warren Buffett, …) are preserved verbatim from the corpus; normalizing them is an owner-approved cleanup (does not affect ids or retrieval).
6. **5 rules cite a single source entry** (single-figure corpus rules) — valid per §3.3.

## 5. Approval handoff (owner manual)

1. Review per domain via `content/rules/{domain}.json` (decisions + label) and `content/rules.csv` (assembled rows).
2. Approve by flipping `status` to `approved` — file-level (whole domain) or per-rule (a decision's `status` field) — then re-run `deno run --allow-read --allow-write content/assemble.ts` + `content/validate.ts`.
3. Seeding happens **only** via BG-01 Step 3 (`content-seed`, approved rows only, `embed_model='gemini-embedding-001@768'`) — never from this package.
