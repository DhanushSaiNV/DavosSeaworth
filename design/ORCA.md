# ORCA.md — Object Inventory & Task Table

**Mode:** MODE A (Spec Compilation)  
**Governing Documents:** `design/DESIGN_PRD.md` §3, `design/ANALYSIS.md` §1.2, `design/RECON.md`

---

## 1. Object Inventory (ORCA)

*Source: `design/DESIGN_PRD.md` §3*

| Object | Relationships | Role → CTA | Core Attributes (always visible) | Metadata (can hide) |
| :--- | :--- | :--- | :--- | :--- |
| **Thread** | One per user [A4]. Contains Messages (davos, user, system). | **User:** send, search.<br>**Davos:** speak first. | Latest message, pending-prompt state. | Timestamps, delivery and sync state. |
| **Check-in** | Belongs to a Day. Appears in the Thread. Links to 0–1 Plan item. Resolves into 1+ Doings or "missed". | **User:** answer (Did it / Partly / Didn't / Something else). No snooze [A14].<br>*BLOCKED: `submit-checkin` accepts only `content: string`; no structured status enum column exists in `doings_logs`.* | Interval time, prompt text, status (pending / answered / missed). | Scheduled and delivered times, channel. |
| **Doing** | Belongs to a Day. Source: check-in, urge, or manual. Links to 0–1 Plan item. | **User:** log, correct (original kept) [A16].<br>*BLOCKED: `doings_logs` lacks `original_content` or revision tracking for corrections; direct edits overwrite.*<br>**Davos:** reflect on it. | What (text), when, kind (action, impulse held, impulse yielded) [A5], plan link. | Source, "corrected" marker with original value, sync state.<br>*OPEN: UI affordance to inspect original pre-correction text.* |
| **Plan** | One per Day. Contains Plan items (text, time, order). Written in the evening session. | **User:** add, edit, reorder (up/down), remove, confirm.<br>**Davos:** propose.<br>*BLOCKED: Backend `anchor_plans` stores an unindexed JSONB blob without granular item CRUD, reordering RPC, or item status tracking.* | Items with time and status (pending / done / partly / missed). | Author (Davos proposal or user), change log [A15].<br>*OPEN: A15 scope of change log display.* |
| **Reflection** | One per Day. Produced in the evening session. | **User:** answer.<br>**Davos:** ask, summarise.<br>*BLOCKED: No backend service generates or stores Davos's one-line summary attached to Reflection.* | Date, Davos's one-line summary. | Full answers (collapsed), duration. |
| **Oath** | Has Doings as evidence (derived). Shown in Proof. | **User:** draft, edit draft, discard draft, read back, bind.<br>**Davos:** propose, check against. **No delete or edit after bind.**<br>*BLOCKED: Backend only stores finalized oaths in `memory_facts`; no draft persistence, discard, or derived standing service exists.* | Commitment text, bound date, current standing.<br>*OPEN: How standing is calculated and formatted.* | Draft history.<br>*OPEN: Review date and judgment criteria fields (PRD §7 F4) have no backend schema.* |

### ORCA Structural Rules
- Every noun has exactly one canonical component (`design/DESIGN_PRD.md` §12).
- Plan items and Doings look different by design: Plan item is an *intention* (outlined marker, time at left); Doing is a *fact* (filled marker, time at right) to prevent Masked Objects [E6].
- Every CTA sits on or directly adjacent to its object. There is no global toolbar.
- The "Why this?" detail (rule name plus one line) attaches to a Davos tactic message [A7].
- *Day* is a grouping key for Plan, Check-ins, Doings, and Reflection, not an independent object.
- *Rule* is not an object.

---

## 2. Task Table

*Source: `design/ANALYSIS.md` §1.2*

| # | Task | When | Who Starts It | Frequency (Per Day) | Expertise Needed | Cost of a Mistake |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Receive Davos's prompt | Each interval | Davos | up to 8 | None | Low (a missed prompt) |
| 2 | Answer the check-in: what did I do? | Each interval | Davos | up to 8 | None | Medium (a wrong log weakens Proof).<br>*BLOCKED: Quick-response buttons lack structured backend column.* |
| 3 | Report or resist an impulse | Unpredictable | User | 0–3 | None | Medium, but any friction in the moment may cause the user to quit |
| 4 | Read Davos's guidance and act on it | After 2 or 3 | Davos | ~ as often as 2 and 3 | None | Low |
| 5 | Evening reflection | Evening | Davos | 1 | Low | Low.<br>*BLOCKED: Reflection summary from Davos unsupported.* |
| 6 | Set or edit tomorrow's Plan | Evening | Davos, then user | 1 | Low | Low to medium.<br>*BLOCKED: Granular Plan item CRUD/reordering unsupported.* |
| 7 | Correct a mistaken log | Occasional | User | < 1 | Low | Medium (data integrity).<br>*BLOCKED: Audit-preserving correction unsupported.* |
| 8 | Review Proof | Weekly, or when doubting | User | 0–1 | Low | Low.<br>*BLOCKED: Derived standing and doings evidence query unsupported.* |
| 9 | Create an Oath | Rare | Davos or user | < 1 / week | Medium | **High** (irreversible).<br>*BLOCKED: Draft persistence unsupported; OPEN: review date schema.* |
| 10 | Change schedule or quiet hours | Rare | User | Rare | Low | Medium (mistimed prompts) |
