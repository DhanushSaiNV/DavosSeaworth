# BG-03 Rules Library — Authoring Style Guide

**Status:** DRAFT authoring guide (BG-03) · **Governing refs:** PRD §2; D17; TECH-SPECS §3.3; AGENTS §8.4; BG-02 Option 1 (2026-10-20).

Every rule in this library must satisfy all of the following. `content/validate.ts` is the hard gate; this guide is the judgment layer the validator cannot express.

## 1. Voice and shape

- **Imperative, attributable, 1–2 sentences.** A rule is a command a mentor delivers, not an essay. Explanation lives in the corpus `detail` field (preserved in the working files), never in the rule text.
- **≤ ~140 characters** of rule text. If it needs a conjunction and a qualifier, it is two rules.
- **No hedging, no audience wobble.** Written to one person: the user Davos is coaching. "Do X." / "Never Y." / "When Z, do W."
- **No rule may depend on another rule** to make sense — retrieval serves it standalone (top-5 pgvector match, §5.2).

## 2. Attribution (`source_figure`)

- Comma-separated list of the figure(s) the rule is drawn from, verbatim from the owner corpus (e.g., `Aristotle, Elon Musk`).
- **Newly authored rules must cite ≥1 named historical figure.** Generic attributions ("modern synthesis") exist only in corpus rules and are grandfathered.
- At least one attributed figure must plausibly have said/done the thing — the detail field is the evidence chain. Never invent a quotation.

## 3. Tone (validate.ts enum: `aggressive` / `empathetic` / `neutral`)

Assign by the rule's rhetorical stance — what Davos sounds like when delivering it:

| Tone | Assign when the rule's force comes from… | Signals | Corpus examples |
| --- | --- | --- | --- |
| `aggressive` | confrontation, hard prohibition, stakes, zero-excuses framing | never, no exceptions, make enemies of, guard, kill | "Make enemies of distraction and comfort." · "Spend less than you earn. Always. No exceptions." |
| `empathetic` | care, recovery, self-compassion, sustainability, tenderness | rest, forgive, heal, gently, kindness, repair | "Be kind. Not naive — kind." · "Forgive quickly — not for others, but for yourself." |
| `neutral` | pragmatic process wisdom; neither harsh nor soft (the default) | method, principle, technique | "Invert, always invert." · "Batch similar tasks." |

- Domain leanings (guidance, not law): Relationships/Spirituality skew `empathetic`; Career/Discipline/Habits/Finance skew `aggressive`+`neutral`; Career/Learning/Communication skew `neutral`.
- A rule that reads as tough love toward a *behavior* but care toward the *person* takes the tone of its sentence, not its intent.

## 4. Priority (integer 1–100 — centrality, not importance theater)

Priority is the §5.2 conflict-filter tiebreak (same-domain aggressive+empathetic groups within `conflict_priority_window`=15 of each other → lower group dropped). Assign **honest centrality** — how core the rule is to the Davos doctrine — and never game the window:

| Band | Meaning | Examples |
| --- | --- | --- |
| 90–95 | Core doctrine — the rule Davos quotes in a Strike or an Oath moment | "Do the thing you're working on at the highest quality possible, always." · "Show up every single day, especially when you don't want to." |
| 75–89 | Domain pillar — one of the ~3 load-bearing rules of its domain | "Sleep is performance. Protect it as a non-negotiable." · "Know your enemy and yourself before every battle." |
| 55–74 | Standard practice — reliably retrievable advice | "Batch similar tasks." · "Mentor others and be mentored." |
| 35–54 | Supporting/refinement — sharpens a pillar | "Use the two-minute rule and the five-year test to filter decisions." |
| 20–34 | Situational/niche — narrow applicability | (style- or context-specific techniques) |

- Within a domain, keep the spread meaningful (a domain where everything is 80 teaches the filter nothing).

## 5. DRAFT discipline (AGENTS §8.4 — binding)

- Working files and assembled CSV rows ship with `status=draft` only. Owner approval flips status (file-level, or per-rule via a decision's `status` field) — **the only path to seeding**, which happens exclusively via BG-01 Step 3, never inside BG-03.
- Every report and summary carries a visible DRAFT label. Placeholder/draft content is never presented as final.
- Agent-authored additions go in a working file's `added[]` (never mutate the frozen corpus), must cite a named figure, and must pass the near-duplicate gate (Jaccard ≥ 0.85 → rejected by validate.ts).
