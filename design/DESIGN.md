# DESIGN.md — Machine-Readable Design Specification

**Mode:** MODE A (Spec Compilation)  
**Governing Documents:** `design/DESIGN_PRD.md` (§2, §8–§14), `design/RECON.md`, `theme/tokens/`

---

## 1. Tie-Breaking Principles (§2)

*Source: `design/DESIGN_PRD.md` §2*

1. **One thread, no detours** over a multi-screen app: Refuse any new screen for something the Thread can hold inline.
2. **Seconds, not forms** over rich logging: Refuse any logging step requiring more than one tap plus optional words.
3. **Davos is a person, not a tool** over assistant conveniences: Refuse assistant chrome (session/history lists, regenerate, copy, model pickers, chat bubbles, avatars).
4. **Proof is plain and true** over motivating decoration: Refuse decoration on facts (points, badges, streak art, KPI card rows).
5. **Ceremony only where it can't be undone** over uniform speed: Refuse ceremony anywhere except the Oath.

**Standing Visual Constraint:** No stacked bordered cards. Hierarchy comes strictly from type scale, spacing, and hairlines.

---

## 2. Screen & Viewport Budget (§8)

*Source: `design/DESIGN_PRD.md` §6 & §8*

### 2.1. Screen Allocation Table
| Screen | Primary Action | Most Space | Docked | Hidden Until Needed |
| :--- | :--- | :--- | :--- | :--- |
| **S1 Thread** | Answer pending prompt | Message stream; latest message and response row dominant | Composer (bottom), status line (top) | "Why this?", older messages, search |
| **S2 Today** | See & update today's plan against actual | Plan list | Next-check-in line (top) | Item edit, Doing correction |
| **S3 Proof** | Review factual record | Dated ledger | Oath section (top) | Older weeks |
| **S4 Oath** | Bind (enabled after read-back) | Commitment text in large type | None (isolated) | Everything else |

### 2.2. Layout Hierarchy (Top to Bottom)
- **S1:** Status line → message stream → response row (when pending) → composer.
- **S2:** Next check-in status → Plan items with status glyph/label → Doings grouped under items.
- **S3:** Bound Oath statement → this week summary (plain lines with tabular numerals) → dated day-by-day ledger.
- **S4:** Step title (`S4a` Draft or `S4b` Read-back) → commitment text → advisory line ("This can't be edited or deleted.") → actions.

### 2.3. Sizing & Geometry Rules
- **Column Width:** Thread column max width 680 (builder-set).
- **Touch Targets:** Minimum touch target 44dp (`hitSlop={8}` or `minHeight: 44, minWidth: 44`).
- **Input Spacing:** Urge action sits strictly to the left of TextInput; Send action sits strictly to the right. Never adjacent.
- **Button Spacing:** Discard draft is separated by at least 16dp from Bind.
- **Breakpoints (Window-Width Hook):**
  - Compact (< 768dp): Bottom navigation bar with 3 items (Davos, Today, Proof).
  - Regular (768–1199dp): Collapsible left rail with 3 items.
  - Wide (≥ 1200dp): Left rail, centred Thread (max 680), optional docked Today panel flush to edge (~ nice-to-have).  
    *OPEN: Mechanism to toggle docked Today panel on wide screens.*

---

## 3. Visibility Tiers (§9)

*Source: `design/DESIGN_PRD.md` §9 & Part 1 §2.5*

- **Tier 1 (Always Visible on Thread):** Davos's latest message, pending prompt, prompt response affordances, composer, Urge action, top status line (next check-in time, today's progress).
- **Tier 2 (One Gesture Away):** Inline Plan editor (tap status line), Doing correction, "Why this?" tactic explanation, Oath ceremony modal, Proof tab, search thread, scroll historical messages.  
  *Web Rule:* Hover may reveal **only** secondary metadata (e.g., timestamps). Nothing required for check-in is hover-only.
- **Tier 3 (Settings - Overflow):** Schedule, quiet hours, notification settings, theme toggle, account, data export, sync telemetry.
- **Tier 4 (Excluded from MVP - No-Gos):** Conversation history/session list, regenerate button, model picker, badges/points, streak art, leaderboards, browsable rules library, custom analytics dashboards, multiple active Oaths.

---

## 4. Familiar vs. Invented Patterns (§10)

*Source: `design/DESIGN_PRD.md` §10*

| Core Job Zone | Custom Pattern | Convention Replaced | Named Failure Avoided | Basis |
| :--- | :--- | :--- | :--- | :--- |
| **Thread** | Unboxed messages, one thread, Davos speaks first | Bubble feed + session list | Session model contradicts single continuous mentor relationship | [P], E9 |
| **Check-in Row** | One tap relative to Plan item | Free-text reply form | Input friction at highest-frequency task | [P], [A2] |
| **Plan** | Inline-editable list | Chat-only edit | Artifact mutation friction | [E9, E12] |
| **Proof** | Plain typographic ledger | Card dashboard, streaks | Decoration competing with factual doings | [P] |
| **Oath** | Draft, read-back, delayed bind | Single confirm modal | Accidental irreversible binding | [P], R5 break |
| **Return** | One plain message | Backlog catch-up list | Return overwhelm | [E17] |

**Standard Shell Zones (Conventions Only):** Settings, Sign-in, system sheets, OS keyboards, data export.

---

## 5. States & Recovery (§11)

*Source: `design/DESIGN_PRD.md` §11*

### 5.1. View State Matrix
| View | Empty | Loading | Populated | Error / Partial Failure |
| :--- | :--- | :--- | :--- | :--- |
| **Thread** | First run: Davos introduces himself and asks start/stop hours inline. | Cached messages shown immediately; status line: "Syncing" | Active message stream | Send fails: message retained, "Not sent. Retry."<br>Offline: "Offline. 2 waiting." |
| **Check-in Row** | No Plan item: replaced by focused composer. | Optimistic: acknowledgement appears at once [A]. | Row of structured options ([Did it], [Partly], [Didn't], [Something else]).<br>*BLOCKED: Structured enum unsupported by data layer.* | Log queued: "Saved here. Will sync." |
| **Plan List** | "Nothing planned. Give me tomorrow's three things." | Cached items | Items with status glyph and label | Edit failed: local edit kept, "Not synced".<br>*BLOCKED: Plan items CRUD/reorder unsupported by backend.* |
| **Today** | "No plan for today. Set one now." + [Add first item] | Cached plan | Plan with grouped Doings | "Can't refresh. Showing data from 14:05." |
| **Proof** | "Nothing here yet. Your first answered check-in starts the record." | Cached figures; status: "Updating" | Bound Oath, weekly summary lines, dated ledger | "Can't refresh. Showing data from 14:05."<br>*BLOCKED: Derived standing service missing.* |
| **Oath** | "No Oath. It can't be undone. Start one when you're sure." | n/a | Active Oath statement with standing facts | Bind fails: "Not bound. Nothing was saved. Try again."<br>Offline: Bind disabled, "Needs a connection." |

### 5.2. Consequential Actions & Recovery
- **Answer Check-in / Report Urge:** Undo toast for 10 s (builder-set), then correct later. Original is preserved with "corrected" marker.<br>*BLOCKED: `doings_logs` lacks audit columns; edits overwrite original value.*<br>*OPEN: Undo toast dismiss interaction.*
- **Edit Plan After Day Starts:** Permitted, change is shown and never hidden [A15].<br>*OPEN: A15 scope of change log display.*
- **Change Check-in Schedule:** Preview "Next check-in: 14:00" before confirming.
- **Bind an Oath:** Irreversible by design (no undo). 5-second read-back delay, online only. Draft can be discarded prior to bind.
- **Offline Logging:** Doings append-only via `checkinQueue`. Chat queued via `sendQueue`.

---

## 6. Token Roles, Rules & Canonical Component Inventory (§12)

*Sources: `design/DESIGN_PRD.md` §12, `design/RECON.md` §4, `theme/tokens/`*

### 6.1. Token Role Mapping
All styling must strictly route through these role mappings. Zero raw color, spacing, or radius literals.

| Token Role | Source Token (`theme/tokens/`) | Light Value | Dark Value | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `surface` | `colors.surface` | `#FAFBFD` | `#131E30` | Primary screen canvas and message backgrounds |
| `surface-subtle` | `colors.surfaceSubtle` | `#E8EDF3` | `#0E1624` | Recessed containers, input fills, inactive chips |
| `surface-raised` | `colors.surfaceRaised` | `#F5F7FA` | `#1A283E` | Modals (Oath ceremony S4), popovers |
| `text-primary` | `colors.textPrimary` | `#0F1B2D` | `#F4F6F9` | Primary headings, message body copy |
| `text-secondary` | `colors.textSecondary` | `#415167` | `#A3AFC2` | Subtitles, secondary status copy |
| `disabled` | `colors.textTertiary` | `#596A82` | `#8E9CB2` | Disabled controls, tertiary metadata |
| `divider` | `colors.borderSubtle` | `#E2E7EE` | `#192538` | Structural hairlines and section rows |
| `border` | `colors.border` | `#D0D7E2` | `#25364F` | Standard control borders, input outlines |
| `focus-ring` | `colors.borderFocus` | `#0F1B2D` | `#E2A63B` | Keyboard and web focus rings |
| `accent` | `colors.accent` | `#0F1B2D` | `#E2A63B` | Primary interactive trigger, Bind button (Amber in dark) |
| `on-accent` | `colors.onAccent` | `#FAFBFD` | `#0F1B2D` | Text/icon placed on filled accent buttons |
| `lantern` | `colors.lantern` | `#A76505` | `#E2A63B` | Brand Amber beacon / prompt indicator |
| `danger` | `colors.danger` | `#DF2935` | `#E5484D` | Destructive actions ([Discard draft], error lines) |

### 6.2. Typography Role Mapping
*Source: `theme/tokens/typography.ts`*
- `davos-voice`: `typography.bodyMedium` (15px / line-height 22 / weight 500).
- `user-text`: `typography.body` (15px / line-height 22 / weight 400).
- `heading`: `typography.heading` (18px / line-height 24 / weight 600) and `typography.title` (20px / 26 / 600).
- `meta`: `typography.caption` (12px / line-height 16 / weight 500).
- `figure`: `typography.mono` (13px / line-height 18 / tabularNums) for telemetry, timestamps, and Proof figures.

### 6.3. Spacing, Radius, and Geometry Rules
- **Spacing:** Strictly use `spacing` scale: `none` (0), `xxs` (4), `xs` (8), `sm` (16), `md` (24), `lg` (32), `xl` (40), `xxl` (48), `huge` (64).
- **Radius:** Strictly use `radius` scale: `sm` (6), `md` (12), `lg` (16), `full` (9999). Outer radius = inner radius + padding where nested.
- **Accent Budget:** Accent color appears on at most **1 element per screen** (primary response button or Bind).
- **No Shadows:** Hairlines only (`borderWidth: 1`, `borderColor: theme.borderSubtle`). Zero shadow or elevation props.
- **Primitives Only:** React Native core primitives (`View`, `Text`, `Pressable`, `TextInput`, `FlatList`). Zero DOM elements, zero CSS.

### 6.4. Canonical Component Inventory
*One canonical component per object (`design/DESIGN_PRD.md` §12)*

| Component | Object | Props | States | Data Layer Status |
| :--- | :--- | :--- | :--- | :--- |
| `ThreadStream` | Thread | `messages`, `pending` | `empty`, `loading`, `populated`, `offline` | PRESENT |
| `DavosMessage` | Thread | `text`, `time`, `ruleId?` | `default`, `expanded "Why this?"` | PRESENT |
| `UserMessage` | Thread | `text`, `time`, `sendState` | `sent`, `sending`, `failed` | PRESENT |
| `SystemLine` | Thread | `text` | `sync`, `missed` | PRESENT |
| `CheckInPrompt` + `ResponseRow` | Check-in | `interval`, `planItem?`, `status` | `pending`, `answered`, `missed` | **BLOCKED:** Structured status response not saved to DB |
| `Composer` | Thread | `value`, `onSend`, `onUrge` | `enabled`, `disabled`, `offline` | PRESENT |
| `StatusLine` | Thread | `nextCheckIn`, `progress`, `syncState` | `normal`, `offline` | PRESENT |
| `DoingLine` | Doing | `what`, `when`, `kind`, `planLink`, `corrected` | `default`, `editing` | **BLOCKED:** Correction audit trail unsupported |
| `PlanItemRow` / `PlanList` | Plan | `text`, `time`, `status`, `order` | `pending`, `done`, `partly`, `missed`, `editing` | **BLOCKED:** Item CRUD and reordering unsupported |
| `ReflectionEntry` | Reflection | `date`, `summary`, `answers` | `collapsed`, `expanded` | **BLOCKED:** Summary from Davos unsupported |
| `OathStatement` | Oath | `text`, `boundOn`, `standing` | `draft`, `bound` | **BLOCKED:** Standing derivation service unsupported |
| `OathDraftForm` / `OathReadBack` / `BindButton` | Oath | `fields`, `delay` | `disabled`, `enabled`, `error` | **BLOCKED:** Draft persistence unsupported |
| `BottomNav` / `SideRail` / `TodayPanel` | Shell | `items` | `selected`, `collapsed` | PRESENT |
| `UndoToast` | Doing | `label`, `timeout` | `visible` | PRESENT (local state) |

---

## 7. Interaction & Tone Rules (§13)

*Source: `design/DESIGN_PRD.md` §13*

### 7.1. Interaction Rules
- **Web Keybindings:**
  - `Enter`: Sends message.
  - `Shift+Enter`: Inserts newline in composer.
  - `Esc`: Closes modal or panel.
  - `Tab`: Focus follows strict DOM/visual order with visible `borderFocus` ring.
- **Reordering:** Plan items reorder via discrete up/down buttons; no drag gestures (keyboard and screen-reader accessible).
- **Motion:** Minimal; strictly queries and honors `AccessibilityInfo.isReduceMotionEnabled()`.
- **Accessibility Floor:**
  - Every `Pressable` carries `accessibilityRole` and `accessibilityLabel`.
  - Minimum touch target 44dp (`minHeight: 44, minWidth: 44` or `hitSlop: 8`).
  - Status is never communicated by color alone (always paired with glyph/label).
  - New Davos messages trigger screen reader announcements (`accessibilityLiveRegion="polite"`).

### 7.2. Tone of Voice
- **Tone Adjectives:** Direct, steady, fair.
- **Rules:** Exactly one question per message; at most 2 sentences for proactive prompts; no exclamation marks; no emoji in Davos's strings; plain numbers.
- **Forbidden Phrases (Never Says):**
  - "Great job!"
  - "As an AI"
  - "I'm here to help"
  - Shaming or insults
  - Therapy or medical claims

---

## 8. Do-Not List (§14)

*Source: `design/DESIGN_PRD.md` §14*

1. **Do not** use stacked bordered or elevated cards for messages, Plan items, Doings, or Proof.
2. **Do not** render chat bubbles or avatars on Davos's messages.
3. **Do not** add history or session lists, regenerate button, copy button, or model picker.
4. **Do not** add points, badges, leaderboards, or streak art.
5. **Do not** add a KPI card row on Today or Proof.
6. **Do not** gate critical check-in data behind hover-only states.
7. **Do not** add a new Place not in §0 without updating the PRD first.
8. **Do not** use a modal for anything except the Oath ceremony (S4) and system sheets.
9. **Do not** use raw color, spacing, or radius values outside `theme/tokens/`.
10. **Do not** add snooze that erases a missed check-in, or affordances to edit/delete a bound Oath.


---

## 9. Token Map

*Source: `design/DESIGN_PRD.md` §12, `theme/tokens/`*

### 9.1. Colour Roles
| PRD §12 Role | Light Token (`theme/tokens/colors.ts`) | Dark Token (`theme/tokens/colors.ts`) | Notes |
| :--- | :--- | :--- | :--- |
| `surface` | `lightColors.surface` (`#FAFBFD`) | `darkColors.surface` (`#131E30`) | |
| `text-primary` | `lightColors.textPrimary` (`#0F1B2D`) | `darkColors.textPrimary` (`#F4F6F9`) | |
| `text-secondary` | `lightColors.textSecondary` (`#415167`) | `darkColors.textSecondary` (`#A3AFC2`) | |
| `divider` (hairline) | `lightColors.borderSubtle` (`#E2E7EE`) | `darkColors.borderSubtle` (`#192538`) | |
| `accent` (Brand Amber) | `lightColors.lantern` (`#A76505`) | `darkColors.accent` (`#E2A63B`) | In light mode, `lightColors.accent` is Deep Navy (`#0F1B2D`); `lightColors.lantern` is the Brand Amber token. In dark mode, `darkColors.accent` is `#E2A63B`. |
| `on-accent` | `lightColors.onAccent` (`#FAFBFD`) | `darkColors.onAccent` (`#0F1B2D`) | |
| `danger` | `lightColors.danger` (`#DF2935`) | `darkColors.danger` (`#E5484D`) | |
| `focus-ring` | `lightColors.borderFocus` (`#0F1B2D`) | `darkColors.borderFocus` (`#E2A63B`) | |
| `disabled` | MISSING: disabled | MISSING: disabled | Neither `lightColors` nor `darkColors` exports a `disabled` token (only `textTertiary` for muted text, but no semantic `disabled` token). |

### 9.2. Type Roles
| PRD §12 Role | Light Token (`theme/tokens/typography.ts`) | Dark Token (`theme/tokens/typography.ts`) | Notes |
| :--- | :--- | :--- | :--- |
| `davos-voice` | `typography.bodyMedium` | `typography.bodyMedium` | System font; typography scale is uniform across color schemes. |
| `user-text` | `typography.body` | `typography.body` | |
| `meta` | `typography.caption` | `typography.caption` | |
| `figure` | `typography.mono` | `typography.mono` | Contains `tabularNums` (`fontVariant: ['tabular-nums']`). |
| `heading` | `typography.heading` | `typography.heading` | |

---

## 10. Check Results

### (a) Objects in BREADBOARD.md missing from ORCA.md
- **None.** All domain objects referenced in `BREADBOARD.md` (Thread, Check-in, Doing, Plan, Reflection, Oath) are defined in `ORCA.md`.

### (b) CTAs attached to no object
- **Search:** Listed in PRD §8 (S1 Hidden until needed) and Visibility Tiers without being attached to any domain object in ORCA.
- **Settings / Overflow:** Attached to the application shell navigation bar/rail rather than an ORCA domain object.

### (c) Any Place in BREADBOARD.md that is not in PRD section 0
- **`P-N` (OS Notification):** Appears in `BREADBOARD.md` F1 breadboard; it is an external OS notification surface, not listed in the in-app Place table (S1–S6) of PRD §0. (All in-app Places `P1`, `Today`, `P3`, `S4a`, `S4b` map directly to S1–S4).

### (d) Principles or tokens in DESIGN.md that trace to no PRD section
- **Principles:** None. All 5 principles and the visual constraint trace directly to PRD §2.
- **Tokens in `DESIGN.md` §6.1 not required by PRD §12:**
  - `surface-subtle` (from `colors.surfaceSubtle`)
  - `surface-raised` (from `colors.surfaceRaised`)
  - `border` (from `colors.border`)
  - `lantern` (from `colors.lantern`, distinct from `accent`)

### (e) Tier-1 values placed in a hidden tier
- **None.** No critical check-in value is placed in a hidden tier. (Note: "Why this?" tactic detail is placed in Tier 2 hidden-until-needed, but is attached inline to Davos's urge tactic response in F2).

### (f) Custom patterns with no named convention failure
- **Undo Toast (10 s auto-dismiss for Doing logging):** Custom pattern introduced in PRD §7 F1 and §11 for Doing recovery; has no named convention failure in the PRD §10 table.
- **Urge Action (Spaced opposite Send on Composer):** Custom pattern introduced in PRD §7 F2 and §8 to prevent mis-clicks; has no named convention failure in the PRD §10 table.

### (g) Any OPEN item on a Core Job screen
- **S1 Thread:**
  - OPEN (F1 Undo Toast Interaction): Undo toast duration is marked builder-set (10 s); dismiss button affordance, interaction while toast is active, and timeout animation are unspecified.
  - OPEN (F2 Urge Check-Back Interval): Exact interval for Davos to follow up ("Did you hold? [Held] [Gave in]") is marked builder-set (copy cites 10 minutes, spec does not lock it).
  - OPEN (F5 Return After Absence Threshold): Threshold number of missed intervals or days before Davos triggers the unprompted return message is marked "threshold builder-set".
  - OPEN (Search Affordance): PRD §8 lists "search" under S1 hidden-until-needed, but the trigger affordance in Thread is unspecified.
- **S2 Today:**
  - OPEN (A15 Plan Edits Change Log Scope): PRD §16 records A15 as an open decision ("Your decision (integrity vs flexibility)") regarding how detailed the visible change log should be for edits made after the day starts.
  - OPEN (Doing Original Inspection): PRD §3 specifies a "corrected" marker with original value, but the UI affordance to inspect the original text (inline toggle, expander, tooltip) is unspecified.
  - OPEN (Docked Today Panel Toggle on Wide Screens): Mechanism to toggle or collapse the docked Today panel on wide screens (≥1200dp) is marked "~ nice-to-have, builder-set".
- **S3 Proof:**
  - OPEN (Standing Facts Format & Calculation): PRD §3/§11 lists "statement with standing" and plain weekly lines, but the precise standing aggregation formula and display rules are unspecified.
- **S4 Oath Ceremony:**
  - OPEN (F4 Oath Review Date & Criteria Schema): PRD §7 F4 specifies "how I'll be judged [A]" and "review date" in the Draft step, but no schema fields or validation rules are defined.
  - OPEN (A8 Non-Purgable Oath Scope): PRD §16 records A8 as an open decision regarding what non-purgable means for an Oath in the context of account deletion and export.
