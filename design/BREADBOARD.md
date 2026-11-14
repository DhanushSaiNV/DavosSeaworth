# BREADBOARD.md — Breadboards & Flow Architectures

**Mode:** MODE A (Spec Compilation)  
**Governing Documents:** `design/DESIGN_PRD.md` §0 & §7, `design/RECON.md`

---

## 1. Place Count & Minimization

*Source: `design/DESIGN_PRD.md` §0 & §7*

- **Total Places:** 6 Core Places (S1–S6).
- **Core Places:**
  - `S1` **Thread** (Davos) — Compact: tab, full screen; Regular/Wide: centre column.
  - `S2` **Today** — Compact/Regular: tab; Wide: docked beside S1.
  - `S3` **Proof** — Tab, with Oath section first.
  - `S4` **Oath Ceremony** — Full-screen modal, 2 steps (`S4a` Draft, `S4b` Read-back).
  - `S5` **Settings** — Accessed from overflow.
  - `S6` **Sign-in** — Dedicated authentication screen.
- **Inline, Not Places:** Check-in response row, urge handling, evening reflection, inline Plan editor, Doing correction, undo toast, and sync status all remain **inside S1 and S2**.
- **Place Minimization Ratio:** Replaces ~13 conventional screens/dialogs with only 2 modal steps (the Oath ceremony steps `S4a` and `S4b`).

---

## 2. Key Flows (F1–F5)

**Notation:** `P` = Place, `→` = connection line, `(inline)` = same Place, no navigation.

### F1: Hourly Check-in
*Source: `design/DESIGN_PRD.md` §7.1*

```
P-N  Notification (OS)
     Affordances: Davos prompt text (≤2 sentences, builder-set); ~ quick-reply actions
     → tap: P1
P1   Thread, pending prompt at bottom
     Affordances: prompt; response row [Did it] [Partly] [Didn't] [Something else];
                  composer; Urge; status line
     → [Did it]: Doing logged, Davos acknowledges (inline); undo toast, 10 s (builder-set)
     → [Partly] or [Something else]: composer focused, "What did you do?" (inline)
     → [Didn't]: Davos asks one short question "What got in the way?" (inline)
```

- **No Plan item for interval:** Response row is replaced by composer, focused [A6].
- **Places:** 2 (P-N → P1). Form and confirmation collapse into the Thread.
- **BLOCKED (Data Layer):** `submit-checkin` accepts only `content: string`; no structured status enum column exists in `doings_logs` to capture discrete button selections (*Did it / Partly / Didn't / Something else*).
- **OPEN (PRD Gap):** Undo toast duration is marked builder-set (10 s); dismiss button affordance and timeout animation are unspecified.

---

### F2: Urge
*Source: `design/DESIGN_PRD.md` §7.2*

```
P1   Thread
     Affordances: Urge (left of input), input, Send (right)
     → Urge: Davos replies immediately with one tactic (inline), with "Why this?"
     → later: Davos follows up "Did you hold?" [Held] [Gave in] (inline);
              interval is builder-set; backend support is unverified [A18]
```

- **Offline Behavior:** Davos cannot generate replies offline. Show short stored local line and queue the report [A].
- **BLOCKED (Data Layer):** Backend has no delayed urge follow-up job type, cron runner, or scheduled push notification mechanism (`design/RECON.md` §7.1); `AGENTS.md` strictly forbids adding backend compute or job types.
- **OPEN (PRD Gap):** Follow-up delay interval is marked builder-set (default 10 minutes in copy, unverified in spec).

---

### F3: Evening Session
*Source: `design/DESIGN_PRD.md` §7.3*

```
P1   Thread, Davos opens at evening time (default 20:30, builder-set) [A19]
     Affordances: question 1 (what went well, what slipped), question 2 (one lesson),
                  question 3 (tomorrow's things)
     → Davos proposes the Plan: an inline Plan list
     → [Edit]: edit in place (add, change time, up/down, remove)
     → [Confirm plan]: Plan locked, Reflection saved (inline)
```

- **Wide Screens:** Plan also renders in docked Today panel (same canonical component).
- **Places:** 1 (3 conventional steps collapsed into Thread).
- **BLOCKED (Data Layer):** Backend `anchor_plans` stores an unindexed JSONB blob (`anchors`); no API or RPC exists for item-level CRUD, status mutations, or reordering (`design/RECON.md` §7.2).
- **BLOCKED (Data Layer):** No backend service generates or stores Davos's one-line summary attached to a Reflection object (`design/RECON.md` §7.3).
- **OPEN (PRD Gap):** A15 scope of change log visibility on Plan edits made after day starts is unspecified ("Your decision").

---

### F4: Oath Ceremony (Justified Exception to Place Minimization)
*Source: `design/DESIGN_PRD.md` §7.4*

```
P1   Thread: Davos asks "Make this an Oath?"   or   P3 Proof → Oath section
     → [Draft an Oath]: S4
S4a  Draft (full-screen, isolated)
     Affordances: commitment text; how I'll be judged [A]; review date;
                  [Discard draft]
     → [Read it back]: S4b
S4b  Read-back
     Affordances: commitment in large type; one plain line "This can't be edited or deleted.";
                  [Back]; [Bind], enabled after 5 s (builder-set), online only
     → [Bind]: P1, Davos acknowledges (inline); Oath appears in Proof
```

- **Why Exception:** R5 break for irreversible, non-purgable commitment requiring isolated focus.
- **BLOCKED (Data Layer):** Backend stores only finalized oaths in `memory_facts`; no draft persistence table, discard endpoint, or standing derivation service exists (`design/RECON.md` §7.4).
- **OPEN (PRD Gap):** "How I'll be judged" criteria and "review date" have no backend schema fields or validation rules.
- **OPEN (PRD Gap):** A8 non-purgable definition relative to account deletion/export is unspecified.

---

### F5: Return After Absence
*Source: `design/DESIGN_PRD.md` §7.5*

```
P1   Thread, on open after missed intervals (threshold builder-set)
     Affordances: one Davos message stating the facts plainly, one question
     No backlog list in Thread. Missed intervals are marked "missed" in Today.
```

- **Places:** 1.
- **OPEN (PRD Gap):** Threshold number of missed intervals or days before triggering the return message is marked "threshold builder-set".
- **BLOCKED (Data Layer):** `doings_logs` lacks an explicit "missed" marker row (missed status is currently derived purely on the fly by watchdog or client grid).
