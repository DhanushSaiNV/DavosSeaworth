# DESIGN PRD: Davos

**Primary platform:** phone, with web and tablet co-equal [A3]. **Status:** draft, approved for slice once you've read the open decisions in §16.

## 0. Zones and screen inventory

| ID  | Screen / Place                                                                                                                                | Form                                                       | Zone           | Why                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------- | ------------------------------------------------------------ |
| S1  | **Thread** (Davos)                                                                                                                            | Compact: tab, full screen. Regular and wide: centre column | Core Job       | The primary job [DR1]                                        |
| S2  | **Today**                                                                                                                                     | Compact and regular: tab. Wide: docked beside S1 (Davos thread only, never on Today, Proof or Settings)      | Core Job       | Plan against actual [DR3, DR9]                               |
| S3  | **Proof** (with Oath section first: quiet text row if no Oath, full OathStatement once bound)                                                  | Tab                                                        | Core Job       | Evidence [DR5]                                               |
| S4  | **Oath ceremony** (Draft, then Read-back)                                                                                                     | Full-screen modal, 2 steps                                 | Core Job       | Irreversible action [DR6]                                    |
| S5  | Settings                                                                                                                                      | From overflow                                              | Standard Shell | Schedule, quiet hours, notifications, theme, account, export |
| S6  | Sign-in                                                                                                                                       | Screen                                                     | Standard Shell | Conventional                                                 |
| —   | **Inline, not screens:** check-in response row, urge handling, evening session, inline Plan editor, Doing correction, undo toast, sync status | Inside S1 and S2                                           | Core Job       | Place minimization [E4]                                      |

**Place count:** my count of a conventional version of these flows is about 13 extra screens or dialogs (log form and confirmation 2, urge 3, reflection and plan 3, Doing edit 1, Oath 4). This plan needs 2 (the two Oath steps). The count is illustrative.

## 1. Brief

- **For:** a driven, self-directed young striver or knowledge worker who plans well and then slips.
- **Struggling moment:** mid-day, when focus or resolve drops and nobody is watching.
- **Job:** "When my plan, focus or resolve slips during the day, speak to me first, find out what I actually did, and hold me to what I committed, so I do what I said I would."
- **Not for:** people who want a general-purpose assistant, a gentle passive wellness app, or team management [A12].
- **Appetite:** 14 days at about 3 h a day (about 42 h), design and front-end slice [A1].
- **No-Gos (v1):** history or session list; regenerate, copy or model picker; points, badges, leaderboards; browsable rules library [A7]; custom dashboards; multiple Oaths; snooze that erases a missed check-in; emoji in Davos's strings.
- **Nice-to-haves (~, cut first):**
  - ~ docked Today panel on wide web
  - ~ keyboard shortcuts beyond Enter, Shift+Enter and Esc
  - ~ quick reply from the notification itself
  - ~ haptics on log
  - ~ light-theme polish pass (tokens exist for both)

## 2. Tie-breaking principles

Full rationale, alternatives and basis are in Part 1 §2.2. Each means:

1. **One thread, no detours:** we refuse any new screen for something the Thread can hold inline.
2. **Seconds, not forms:** we refuse any logging step that needs more than one tap plus optional words.
3. **Davos is a person, not a tool:** we refuse assistant chrome (history, regenerate, avatars, bubbles).
4. **Proof is plain and true:** we refuse decoration on facts (points, badges, streak art, KPI cards).
5. **Ceremony only where it can't be undone:** we refuse to add ceremony anywhere except the Oath.

**Standing visual constraint:** no stacked bordered cards.

## 3. Object inventory (ORCA)

| Object         | Relationships                                                                                        | Role → CTA                                                                                                               | Core attributes (always visible)                                                | Metadata (can hide)                                        |
| -------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Thread**     | One per user [A4]. Contains Messages (davos, user, system)                                           | User: send, search. Davos: speak first                                                                                   | Latest message, pending-prompt state                                            | Timestamps, delivery and sync state                        |
| **Check-in**   | Belongs to a Day. Appears in the Thread. Links to 0-1 Plan item. Resolves into 1+ Doings or "missed" | User: answer (Did it / Partly / Didn't / Something else). No snooze [A14]                                                | Interval time, prompt text, status (pending / answered / missed)                | Scheduled and delivered times, channel                     |
| **Doing**      | Belongs to a Day. Source: check-in, urge or manual. Links to 0-1 Plan item                           | User: log, correct (original kept) [A16]. Davos: reflect on it                                                           | What (text), when, kind (action, impulse held, impulse yielded) [A5], plan link | Source, "corrected" marker with original value, sync state |
| **Plan**       | One per Day. Contains Plan items (text, time, order). Written in the evening session                 | User: add, edit, reorder (up/down), remove, confirm. Davos: propose                                                      | Items with time and status (pending / done / partly / missed)                   | Author (Davos proposal or user), change log [A15]          |
| **Reflection** | One per Day. Produced in the evening session                                                         | User: answer. Davos: ask, summarise                                                                                      | Date, Davos's one-line summary                                                  | Full answers (collapsed), duration                         |
| **Oath**       | Has Doings as evidence (derived). Shown in Proof                                                     | User: draft, edit draft, discard draft, read back, bind. Davos: propose, check against. **No delete or edit after bind** | Commitment text, bound date, current standing                                   | Draft history                                              |

**Rules:**

- Every noun has one canonical component (see §12).
- Plan items and Doings look different on purpose. A Plan item is an _intention_ (outlined marker, time at left). A Doing is a _fact_ (filled marker, time at right). This avoids a Masked Object [E6].
- Every CTA sits on or next to its object. There is no global toolbar.
- The "Why this?" detail (rule name plus one line) attaches to a Davos tactic message [A7].

## 4. Task table

See Part 1 §1.2. **Basis for every frequency: assumption.**

## 5. Interaction mode and choice structure

| Core task       | Mode                                                  | Why not the next-simplest alternative                           |
| --------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Check-in        | Conversation with an inline structured response [DR2] | Free text only costs more seconds at the highest-frequency task |
| Urge            | Conversation, immediate Davos reply [DR4]             | A form adds friction at the moment of lowest willpower          |
| Evening session | Conversation leading to an editable list [DR3]        | Chat-only editing fails for revision [E9, E12]                  |
| Proof           | Record view [DR5]                                     | A card dashboard is a template tell [E26]                       |
| Oath            | Form-like ceremony [DR6]                              | One confirm button is too easy for something non-purgable [P]   |

**Entry structure:** a single guided next step, which is the pending prompt, with Today and Proof as browse escapes [E15, E16, direction]. For novices, one pending prompt avoids choice paralysis. For this audience the risk is that experienced users find the guidance too narrow [A], so Today and Proof stay one tap away.

## 6. Platform and navigation shell

| Width                             | Shell                                                                 | Source                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Compact, under 768 (builder-set)  | Bottom bar with 3 items                                               | [E21, E15] show bottom bars exist. The 3-item cap is [A]                                                  |
| Regular, 768-1199 (builder-set)   | Collapsible left rail with 3 items                                    | [E1, E22] left object rail                                                                                |
| Wide, 1200 and over (builder-set) | Rail, centred Thread, optional docked Today panel flush to the edge beside the Davos thread only (never on Today, Proof or Settings) ~ | [E9]/[E22] side-by-side idea, [E14] flush docking. **No ledger source for cross-platform adaptation** [A] |

- **Destinations:** Davos, Today, Proof. The Oath is the first section of Proof. Settings is not a rail destination (accessed via overflow).
- **Collapsed rail:** icon-only items for Davos, Today and Proof, each with accessibilityLabel and a hover title on web. Active: amber marker bar plus primary-colour icon. Inactive: textSecondary icon. Touch target at least 44.
- **Cap of 3:** only three of the six objects are viewed at a glance daily or weekly [P].
- **Implementation note:** you use React Native primitives, so breakpoints come from the window-width hook, not CSS media queries. Verify against your current Expo version.

## 7. Key flows and breadboards

**Notation:** `P` = Place, `→` = connection line, `(inline)` = same Place, no navigation.

### F1: Hourly check-in

```
P-N  Notification (OS)
     Affordances: Davos's prompt text (≤2 sentences, builder-set); ~ quick-reply actions
     → tap: P1
P1   Thread, pending prompt at the bottom
     Affordances: prompt; response row [Did it] [Partly] [Didn't] [Something else];
                  composer; Urge; status line
     → [Did it]: Doing logged, Davos acknowledges (inline); undo toast, 10 s (builder-set)
     → [Partly] or [Something else]: composer focused, "What did you do?" (inline)
     → [Didn't]: Davos asks one short question "What got in the way?" (inline)
```

- **No Plan item for that interval:** the response row is replaced by the composer, focused [A6].
- **Places:** 2, so the form and confirmation collapse into the Thread.

### F2: Urge

```
P1   Thread
     Affordances: Urge (left of the input), input, Send (right)
     → Urge: Davos replies immediately with one tactic (inline), with "Why this?"
     → later: Davos follows up "Did you hold?" [Held] [Gave in] (inline);
              interval is builder-set; backend support is unverified [A18]
```

- **Offline:** Davos can't generate a reply offline. Show a short stored local line and queue the report [A].

### F3: Evening session

```
P1   Thread, Davos opens at the evening time (default 20:30, builder-set) [A19]
     Affordances: question 1 (what went well, what slipped), question 2 (one lesson),
                  question 3 (tomorrow's things)
     → Davos proposes the Plan: an inline Plan list
     → [Edit]: edit in place (add, change time, up/down, remove)
     → [Confirm plan]: Plan locked, Reflection saved (inline)
```

- **On wide screens**, the Plan also shows in the docked Today panel (same component).
- **Places:** 1, with 3 collapsed.

### F4: Oath ceremony (the justified exception to Place minimization)

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

- **Why this breaks Place minimization:** the Stage 1 rulebook breaks R5 for destructive or irreversible confirmation that needs isolated focus [E4, E11, corroborated].
- **Alternatives I didn't choose:** press-and-hold (poor motor accessibility), typed phrase (gimmicky), grace-edit window (a product decision, see §16).

### F5: Return after absence

```
P1   Thread, on open after missed intervals (threshold builder-set)
     Affordances: one Davos message stating the facts plainly, one question
     No backlog list in the Thread. Missed intervals are marked "missed" in Today.
```

[E17, documented · medium, direction], [P], [A].

## 8. Screen and viewport budget

All size numbers are (builder-set), and a reason is required in a PR if you change them.

| Screen    | Primary action                                    | Most space                                                                | Docked                               | Hidden until needed                 |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------- |
| S1 Thread | Answer the pending prompt                         | Message stream, with Davos's latest message and the response row dominant | Composer (bottom), status line (top) | "Why this?", older messages, search |
| S2 Today  | See and update today's plan against what happened | The Plan list                                                             | Next-check-in line (top)             | Item edit, Doing correction         |
| S3 Proof  | See what I did                                    | Dated ledger                                                              | Oath section (top)                   | Older weeks                         |
| S4 Oath   | Bind, enabled after read-back                     | The commitment in large type                                              | None (isolated)                      | Everything else                     |

**Layout order, top to bottom:**

- **S1:** status line → stream → response row (when pending) → composer. (Status line shows on Davos).
- **S2:** next check-in status line → Plan items with status → Doings under each item. (Status line shows on Today).
- **S3:** Oath (one quiet text row "No Oath. Draft one" when no Oath exists; full OathStatement once bound) → this week (plain lines, large figures over quiet labels, tabular numerals) → day-by-day ledger. (No status line on Proof).
- **S4:** step title → commitment → one line → actions.
- **S5:** Settings: top-bar title "Settings" with back control to Davos, single scrolling column, no status line.

**Sizing rules:**

- Thread column max width 680 (builder-set).
- Minimum touch target 44 (builder-set, from platform convention, not the ledger).
- Urge sits left of the input and Send sits right, so they are never adjacent. E19 supports only the direction that adjacent competing targets cause accidental activation.
- Discard draft is at least 16 from Bind (builder-set).

## 9. Visibility tiers

As Part 1 §2.5. One addition for web: hover may reveal **only** secondary metadata such as per-message timestamps. Nothing the user needs per check-in is hover-only [E14].

## 10. Familiar vs invented

| Core Job Zone | Custom pattern                                   | Convention replaced           | Named failure                                                  | Basis                          |
| ------------- | ------------------------------------------------ | ----------------------------- | -------------------------------------------------------------- | ------------------------------ |
| Thread        | Unboxed messages, one thread, Davos speaks first | Bubble feed plus session list | Session model contradicts a single mentor relationship (other) | [P], E9 for the limits of chat |
| Check-in row  | One tap relative to Plan item                    | Free-text reply               | Input cost at the highest-frequency task (other)               | [P], [A2]                      |
| Plan          | Inline-editable list                             | Edit by chat                  | Artifact mutation friction                                     | [E9, E12]                      |
| Proof         | Plain ledger                                     | Card dashboard, streaks       | Decoration competing with facts (other)                        | [P]. Counter-evidence E15-E17  |
| Oath          | Draft, read-back, delayed bind                   | Single confirm                | Irreversible action with one tap (other)                       | [P], R5 break                  |
| Return        | One plain message                                | Backlog list                  | Return overwhelm                                               | [E17]                          |

**Standard Shell zones** (conventions only): Settings, Sign-in, system sheets, keyboards, export.

## 11. States and recovery

Copy below is draft, in Davos's voice (§13).

| View             | Empty                                                                                           | Loading                                              | Populated                | Error / partial failure                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Thread**       | First run: Davos introduces himself and asks when you start and stop (schedule controls inline) | Cached messages shown at once, status line "Syncing" | Stream                   | Send fails: message stays, "Not sent. Retry." Offline: "Offline. 2 waiting."                         |
| **Check-in row** | No Plan item: row replaced by focused composer                                                  | Optimistic: acknowledgement appears at once [A]      | Row of options           | Log queued: "Saved here. Will sync."                                                                 |
| **Plan list**    | "Nothing planned. Give me tomorrow's three things."                                             | Cached                                               | Items with status        | Edit failed: local edit kept, "Not synced"                                                           |
| **Today**        | "No plan for today. Set one now." + [Add first item]                                            | Cached                                               | Plan with Doings         | "Can't refresh. Showing data from 14:05."                                                            |
| **Proof**        | "Nothing here yet. Your first answered check-in starts the record."                             | Cached figures, "Updating"                           | Oath, week lines, ledger | "Can't refresh. Showing data from 14:05."                                                            |
| **Oath**         | "No Oath. It can't be undone. Start one when you're sure."                                      | n/a                                                  | Statement with standing  | Bind fails: "Not bound. Nothing was saved. Try again." Offline: Bind disabled, "Needs a connection." |

**Consequential actions and recovery**

| Action                                  | Recovery                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Answer a check-in or report an urge     | Undo toast (10 s, builder-set), then correct later. The original is kept with a "corrected" marker [A16]                        |
| Edit the Plan after the day has started | Allowed, change shown, never hidden [A15]                                                                                       |
| Change check-in schedule                | Preview "Next check-in: 14:00" before confirming                                                                                |
| Bind an Oath                            | No undo, by design. Read-back, delay, online only. Draft can be discarded                                                       |
| Offline logging                         | Doings are append-only, so they can't conflict. Plan edits last-write-wins and are logged [A22]. **Needs backend confirmation** |

## 12. Tokens and components

**Tokens.** Use only what exists in `theme/tokens/`. Roles needed (map each to an existing token):

- Colour: `surface`, `text-primary`, `text-secondary`, `divider` (hairline), `accent` (Brand Amber), `on-accent`, `danger`, `focus-ring`, `disabled`.
- Type scale (one scale on every screen):
  - Top-bar title: largest text on the screen (`title`: 20px, semibold 600).
  - Section heading: one step smaller, semibold (`heading`: 18px, semibold 600).
  - Day or group heading: smaller still, medium, textSecondary (14–15px, medium 500, `textSecondary`).
  - Body: 15px, regular 400 (`body` / `user-text`).
  - Meta: 12px, medium 500 (`caption` / `meta`, never below 12px).
- Roles: `davos-voice` (15px / 500), `user-text` (15px / 400), `meta` (12px / 500), `figure` (13px / 500, tabular numerals, UI sans), `figureLarge` (28px / 600, tabular numerals, UI sans), `heading` (18px / 600), `title` (20px / 600). Note: `figureLarge` is added to `theme/tokens/typography.ts` for large KPI summaries in Proof.
- Times and figures use the UI sans family with tabular numerals (`fontVariant: ['tabular-nums']`), NEVER a monospace family.
- Spacing: your 4pt scale only. Radius: your existing scale.

**Rules:**

- Theme rule: one ThemeProvider at the root. Every colour in every component comes from a theme hook reading the roles in theme/roles. No component or screen imports a static palette or token value directly. Default: follow the system scheme. Settings gets an "Appearance" row (System / Light / Dark), stored locally with whatever storage the app already uses.
- Counts rule: check-ins scheduled today (M); answered on time; answered late (a missed check-in that the user answered after Davos's follow-up); missed. Status wording: "N of M answered", plus " · 1 missed" when any are missed. One function feeds the status line, TodayPanel and Today.
- Status line rule: The status line shows only on Davos and Today. Not on Proof, not on Settings. When a check-in is pending, say "Due now 14:00 · N of M answered" (plus " · 1 missed" if applicable). When none is pending, say "Next check-in 15:00 · N of M answered". M is the number of check-ins scheduled for today, and the 20:30 evening reflection is not a check-in.
- Collapsed rail: icon-only items for Davos, Today and Proof, each with accessibilityLabel and a hover title on web. Active: amber marker bar plus primary-colour icon. Inactive: textSecondary icon. Settings is not a rail destination.
- Amber rule: amber is a fill or marker only, never text on a light surface. It appears only on (1) the active nav marker and (2) the Bind button in the Oath ceremony. Nowhere else. Text on an amber fill uses onAccent.
- User-facing words: replace "Doings" with "Logged" or "What you did". No "Diagnostics" in production.
- Accent appears on at most 1 element per screen (builder-set): the primary response, or Bind.
- Hairlines only, no elevation shadows.
- **Type decision recorded [A20]:** one family for the MVP (UI sans). Davos's voice is distinguished by size and weight, not a new font. Revisit after the beta. Monospace fonts are banned in the UI (AU31).
- One-offer rule: the Thread renders at most ONE pending prompt or offer at a time. Priority: (1) an open check-in question or follow-up, (2) the evening session at its scheduled time, (3) an Oath offer. Lower-priority offers wait.
- Time format: one shared formatter, 24-hour by default, used everywhere (messages, system lines, panel, ledger, Oath).
- Radius rule: outer = inner + padding where containers nest (low priority).
- Primitives: RN core components only (View, Text, Pressable, TextInput, and list components such as FlatList). No DOM elements, no third-party UI kit [A].

**Component inventory** (one canonical component per object):

| Component                                 | Object     | Props                                 | States                                 |
| ----------------------------------------- | ---------- | ------------------------------------- | -------------------------------------- |
| ThreadStream                              | Thread     | messages, pending                     | empty, loading, populated, offline     |
| DavosMessage                              | Thread     | text, time, ruleId?                   | default, expanded "Why this?"          |
| UserMessage                               | Thread     | text, time, sendState                 | sent, sending, failed                  |
| SystemLine                                | Thread     | text                                  | sync, missed                           |
| CheckInPrompt + ResponseRow               | Check-in   | interval, planItem?, status           | pending, answered, missed              |
| Composer                                  | Thread     | value, onSend, onUrge                 | enabled, disabled, offline             |
| StatusLine                                | Thread     | nextCheckIn, progress, syncState      | normal, offline                        |
| DoingLine                                 | Doing      | what, when, kind, planLink, corrected | default, editing                       |
| PlanItemRow / PlanList                    | Plan       | text, time, status, order             | pending, done, partly, missed, editing |
| StatusMark                                | Plan       | status                                | done, partly, pending, missed          |
| ReflectionEntry                           | Reflection | date, summary, answers                | collapsed, expanded                    |
| OathStatement                             | Oath       | text, boundOn, standing               | draft, bound                           |
| OathDraftForm / OathReadBack / BindButton | Oath       | fields, delay                         | disabled, enabled, error               |
| SettingsSection                           | Settings   | title, children                       | default                                |
| SettingsRow                               | Settings   | label, control, description?          | default                                |
| BottomNav / SideRail / TodayPanel         | Shell      | items                                 | selected, collapsed                    |
| LogoMark                                  | Shell      | size                                  | default                                |
| UndoToast                                 | Doing      | label, timeout                        | visible                                |

## 13. Interaction and tone rules

**Interaction**

- **Web keys:** Enter sends, Shift+Enter inserts a newline, Esc closes a sheet or panel, Tab order follows the visual order. ~ Linear-style shortcuts are a nice-to-have.
- **Reorder:** up/down buttons, no drag, so it works by keyboard and screen reader.
- **Motion:** minimal, and respects the reduce-motion setting.
- **Accessibility floor:**
  - WCAG AA contrast (from your tokens).
  - Accessible name and role on every Pressable.
  - Visible focus on web.
  - Text scales with system settings.
  - Status is never colour alone. Plan item status uses a glyph and label plus colour.
  - New Davos messages are announced to screen readers (verify per platform).
  - Keyboard-only completion of the primary flow on web.

**Tone of voice (UI strings and fallbacks).** The model's voice is governed by your backend prompt, a separate artifact.

- **Three adjectives:** direct, steady, fair.
- **Rules:** one question per message, at most 2 sentences for a proactive prompt (builder-set), no emoji [A], no exclamation marks, plain numbers.
- **Never says:** "Great job!", "As an AI", "I'm here to help", shaming or insults, therapy or medical claims.

| Moment         | Example line                                                |
| -------------- | ----------------------------------------------------------- |
| Check-in       | "14:00. Plan says deep work. Did you do it?"                |
| Done           | "Logged. Next check-in 15:00."                              |
| Missed         | "Missed. What got in the way?"                              |
| Return         | "Two days, no record. What happened?"                       |
| Urge           | "Name the urge. Stay with me ten minutes. I'll check back." |
| Oath read-back | "This can't be edited or deleted."                          |

## 14. Do-not list

| #   | Do not                                                                       | Traces to                      |
| --- | ---------------------------------------------------------------------------- | ------------------------------ |
| 1   | Stacked bordered or elevated cards for messages, Plan items, Doings or Proof | DR11, your stated dislike, E26 |
| 2   | Chat bubbles or avatars on Davos's messages                                  | DR12, DR1                      |
| 3   | History or session list, regenerate, copy, model picker                      | DR12                           |
| 4   | Points, badges, leaderboards, streak art                                     | DR5                            |
| 5   | KPI card row on Today or Proof                                               | DR5, E26                       |
| 6   | Hover-only critical data                                                     | §9, E14                        |
| 7   | A new Place not in §0, without updating this PRD first                       | E4                             |
| 8   | A modal for anything except the Oath and system sheets                       | DR6, R5                        |
| 9   | Raw colour or spacing values outside tokens                                  | §12                            |
| 10  | Snooze that erases a missed check-in; editing or deleting a bound Oath       | A14, A8                        |
| 11  | More than one offer or prompt visible in the Thread at a time (One-offer rule) | DR7, AU42                      |
| 12  | Mixed time formats across UI (must use shared 24-hour formatter everywhere)   | Time format rule, AU43         |
| 13  | Ledger or "Also logged" entry text set at meta size (must be body size)       | Type scale rule, AU44          |
| 14  | Duplicate labels in Settings (section and row)                               | Settings UX, AU45              |
| 15  | Red used for text that isn't an error or a destructive control               | Color role rule, AU46          |

## 15. Test plan

Defined in deliverable 5 (Part 3), one row per decision DR1-DR12 and per state, with a pass criterion for each.

## 16. Assumption register

**New assumptions introduced in this PRD** (A1-A13 are in Part 1 §0):

| ID  | Assumption                                                                | Resolves through                             |
| --- | ------------------------------------------------------------------------- | -------------------------------------------- |
| A14 | No snooze. A missed check-in is recorded as missed                        | Beta friction log, user feedback             |
| A15 | Plan edits after the day starts are allowed and shown                     | **Your decision** (integrity vs flexibility) |
| A16 | Doing corrections keep the original value                                 | **Your decision**                            |
| A17 | Oath bind has a 5 s read-back delay and requires a connection             | Think-aloud on the slice                     |
| A18 | Davos can follow up after a delay on an urge, and the backend supports it | **Backend check**                            |
| A19 | Evening session defaults to 20:30 and is user-adjustable                  | Settings feedback                            |
| A20 | One type family for the MVP                                               | Visual review after the beta                 |
| A21 | Breakpoints 768 and 1200, column max 680                                  | Visual check on each platform                |
| A22 | Doings are append-only offline. Plan edits are last-write-wins and logged | **Backend check**                            |

**Decisions I need from you** (also in Part 4): A15, A16, A8 (what non-purgable means for an Oath and for account deletion), A18, A22.
