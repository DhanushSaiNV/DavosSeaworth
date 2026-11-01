**Stage 3, Part 3 of 4.** Same ground rules as Parts 1 and 2. IDs carry over (A1-A22, DR1-DR12, S1-S6, F1-F5, PRD §numbers). This part adds three **new** ledger entries (E31-E33, from the research I just did) and three new assumptions:

| ID  | Assumption                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A23 | A front end already exists in some form, and the backend (schema, functions, API contracts) stays untouched. So the prompt sequence starts with read-only reconnaissance. |
| A24 | Anything that binds an Oath during testing runs against a fake adapter or a test project, never production data.                                                          |
| A25 | Pass counts in the test table are PRD requirements written before testing (builder-set). They are not statistical thresholds.                                             |

**Part status:** this part covers deliverable 5 (hypotheses and acceptance criteria) and deliverable 6 (AI coding prompt sequence, ending in a design-QA prompt). Part 4 covers deliverables 7 and 8.

---

## 5. Hypotheses and acceptance criteria

**Rules for these tests** (from Stage 2 §6.1):

- With 5 users, report counts ("4 of 5"), never percentages. One failure is a finding to investigate, not a rate.
- E29 supports finding qualitative problems with 5 users **per distinct user group**. If your 5 beta users split into clearly different groups (say phone-heavy vs desktop-heavy), the test covers each group only thinly [A10].
- E28 supports only the direction that a correct first click goes with higher task success. Every count below is builder-set under A25.
- Beta users who know you may be polite. Tell them to look for what's wrong, and record each issue as _blocker_ or _annoyance_.
- **Never bind a real Oath in any test** [A24].
- A failure changes the Design PRD first, then the affected screens get regenerated.

| ID  | Decision                                 | Hypothesis                                                                                         | Verification                                                                                                                                                                                                                                                                                      | Pass criterion                                                                                                                                                                           | Type · basis                                              |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| H1  | DR1, DR9: Thread is home, 3 destinations | First-time users start in the right place                                                          | First-click test on compact (bottom bar) and wide (rail) screenshots. One task each, worded without any label printed on screen: (a) "Davos just asked you something. Answer it." (b) "See what you planned for today." (c) "See what you did this week." (d) "Make a commitment you can't undo." | Correct first click: (a) 5 of 5. (b), (c), (d) at least 4 of 5 each. For any miss, record where they clicked, then fix labels or placement in PRD §6                                     | Real · E28 (direction only)                               |
| H2  | DR2: one-tap check-in                    | Answering takes fewer steps than free text and the record is still accurate                        | On the unstyled slice, each user does 3 check-ins in two variants (one-tap row, composer only), order alternated. Count taps plus typed fields. After each, ask "Does this record show what you did?"                                                                                             | For every user, steps in the one-tap variant ≤ steps in the free-text variant measured in the same session, and no more "the record is wrong" answers than in the baseline               | Real · baseline measured in-session; E14 for direction    |
| H3  | DR4: Urge action                         | Users can report an urge in the moment, without navigating and without mis-taps                    | Scenario: "You want to open a distraction app right now. Tell Davos." from S1. Then each user sends 20 messages (builder-set)                                                                                                                                                                     | Report made inside the Thread with 1 tap for 5 of 5. **0** accidental Urge activations across all sends. Inspection: Urge and Send sit on opposite sides of the input                    | Real + proxy · E19 (direction only)                       |
| H4  | DR3: inline Plan editor                  | Users can revise a plan without regenerating it, and read status from Today                        | Task: "Move gym to 18:00, delete reading, add 'call mom' at 20:00." Then, from Today: "Which items are done, partly done, missed?"                                                                                                                                                                | 5 of 5 complete all three edits in place, unaided. Untouched items unchanged (data diff). 5 of 5 read statuses correctly with no legend                                                  | Real · E9, E12 (direction); no chat-only baseline run     |
| H5  | DR5: plain Proof                         | Users can read their week from the ledger and come back to it                                      | (a) Show Proof on a seeded week: "How many check-ins did you answer? What did you skip most?" (b) Beta week: count user-initiated Proof opens. Qualitative only: show a KPI-and-streak mock and ask which they'd open again                                                                       | (a) 5 of 5 answer both from the screen. (b) At least 4 of 5 open Proof unprompted at least once. Mock preference is recorded, not scored                                                 | Real · [P]. E15-E17 counter-evidence is _not_ tested here |
| H6  | DR6: Oath ceremony                       | Users understand irreversibility and don't bind text they don't mean                               | Think-aloud on S4 with the fake adapter and a deliberately flawed draft (a typo)                                                                                                                                                                                                                  | Before binding, each user says in their own words that it can't be edited or deleted: 5 of 5. Zero users bind the flawed text without noticing. Record every abandonment with its reason | Real · Q13, [A17]                                         |
| H7  | DR7: notification landing                | Tapping a notification opens the pending prompt                                                    | 10 trials (builder-set) per platform where notifications exist: cold start, warm start, app in background                                                                                                                                                                                         | Lands on S1 with the same pending prompt in 10 of 10. On web, opening the app shows the pending prompt                                                                                   | Proxy · E33                                               |
| H8  | DR8: return after absence                | Returning users know the next step and don't feel they must clear a backlog                        | Seed 2 missed days. Open the app: "What do you do now?" then "Is there anything you feel you have to catch up on?"                                                                                                                                                                                | First click on the response row or composer: 5 of 5. Any "catch up" statement is a finding to resolve                                                                                    | Real · E17 (direction)                                    |
| H9  | DR1, DR12: no history list               | Users still find older guidance                                                                    | Task: "Find what Davos told you yesterday about [seeded topic]"                                                                                                                                                                                                                                   | 4 of 5 find it unaided by scrolling or search. If fewer, add a date jump, not a history list                                                                                             | Real · [P]                                                |
| H10 | DR9, DR10: platform parity               | Every core task works on every platform and width                                                  | Walk F1-F5 on web at 360, 768 and 1200 wide, and on an iOS and an Android device                                                                                                                                                                                                                  | Each flow completes with no hover-only step, no horizontal page scroll, no hidden required control (tick each)                                                                           | Proxy · [A]                                               |
| H11 | PRD §11: failure and recovery            | Failures never lose input or look blank                                                            | Force: network off during send, check-in and plan edit; kill the app mid-log; reconnect                                                                                                                                                                                                           | Each case shows the PRD copy and keeps input. After reconnect there is exactly one Doing per log. Needs backend confirmation [A22]                                                       | Proxy · E22 (direction)                                   |
| H12 | A16: corrections                         | Users can fix a wrong log and the original is kept                                                 | Task: "Fix the entry you just logged wrongly", once via undo and once via later edit                                                                                                                                                                                                              | 5 of 5 correct it unaided. The data shows the original with a "corrected" marker                                                                                                         | Real · [P]                                                |
| H13 | PRD §13: accessibility                   | Core flows work without a pointer and with assistive settings                                      | Web keyboard-only through F1 and F3; screen reader on S1; 200% text size; reduce-motion on                                                                                                                                                                                                        | Flows complete. Every Pressable is named. The response row stays visible and unclipped at large text. Nothing relies on colour alone                                                     | Proxy · no ledger source; WCAG AA is your stated target   |
| H14 | PRD §11: first run and empty states      | New users can start without help                                                                   | New account: "What would you do first?" then "Set your active hours"                                                                                                                                                                                                                              | 5 of 5 name the intended first action and set active hours unaided                                                                                                                       | Real · E11 (direction)                                    |
| H15 | A2: hourly cadence                       | Users keep the cadence                                                                             | Beta week: per user, answered vs missed check-ins, and whether they cut frequency or muted. 10-minute interview at week end                                                                                                                                                                       | At least 3 of 5 keep the schedule unchanged all week. Record the reasons of the others                                                                                                   | Real · [A2]. E17 (direction)                              |
| H16 | DR11: visual restraint                   | The build has fewer template tells than an unspecified prompt, and each remaining one is justified | Score the Stage 0 baseline screen and the final screens against `AUDIT.md`                                                                                                                                                                                                                        | Final has fewer FAIL items than baseline, and each remaining FAIL has a written exception in the PRD. n=1, so no general claim                                                           | Proxy · E26                                               |

**When to run what**

- **Screenshots, before styling:** H1 (also on the compact and wide mock).
- **Unstyled slice (Gate 2):** H2, H3, H4, H6, H8, H9, H12, H14.
- **Styled build:** H5(a), H7, H10, H11, H13, H16.
- **Beta week:** H5(b), H15, plus a repeat of H2 and H8 in real use.

---

## 6. AI coding prompt sequence (Antigravity, Opencode)

### 6.0 Tool facts, and new ledger entries

| ID          | Claim                                                                                                                                                                                                                                                                                                                                                                                                            | Source                                                                                             | Status · confidence                                                                                                     | Limitation                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| E31 **NEW** | Opencode takes custom instructions from an AGENTS.md file in the project root, falls back to CLAUDE.md only if no AGENTS.md exists, and does not automatically follow file references written inside AGENTS.md; extra instruction files are listed in opencode.json                                                                                                                                              | opencode.ai/docs/rules (first-party)                                                               | documented · high                                                                                                       | Says nothing about context-size limits. `/init` can add to an existing AGENTS.md, so review any diff |
| E32 **NEW** | Antigravity's own docs list AGENTS.md, GEMINI.md and a .agents/rules/ folder (older .agent/rules/ still accepted) as workspace rule locations. Third-party guides say GEMINI.md takes priority over AGENTS.md. One guide gives a 12,000-character limit per rules file                                                                                                                                           | antigravity.google/docs/rules (first-party); agentpedia.codes and thepromptshelf.dev (third-party) | File locations: documented · medium. Priority order and the character limit: **unverified**, single third-party sources | I treat 12,000 as a cap and keep `AGENTS.md` far below it                                            |
| E33 **NEW** | The current expo-notifications docs list Android and iOS as supported platforms, with no web. Remote push is unavailable in Expo Go on Android from SDK 53, so a development build is required; local notifications still work in Expo Go. Expo Router can route a tapped notification using a url in its data. A changelog entry says Android action buttons are supported when the app isn't in the foreground | docs.expo.dev (first-party), expo-notifications changelog (secondary)                              | documented · medium                                                                                                     | I did not verify text-input quick replies on iOS or Android, or which SDK your app uses              |

**What this changes in the plan**

- **A9 is partly settled:** web cannot use expo-notifications per the current docs. Web must rely on the app showing the pending prompt on open, with no notification dependency.
- **~ quick reply from the notification** stays a nice-to-have, unverified.
- **Beta on Android:** testing remote push needs a development build, not Expo Go.
- **Rules file:** one root `AGENTS.md` works in both tools, so you maintain one file. Don't also create a `GEMINI.md` with different content.
- **Per-stage sessions:** start a fresh task or session after editing rules, so they reload.
- **Which tool for which mode:** Modes A and C are text-only and cheaper. Run Mode B in whichever tool has more free quota left that day.

### 6.1 Setup (manual, about 30 minutes)

1. Create `/design`. Save Part 2 as `design/DESIGN_PRD.md`. Save Part 1 §1.2, §1.3 and §2.2-§2.5 as `design/ANALYSIS.md`.
2. **Before** creating `AGENTS.md`, run Stage 0 below (optional but recommended). Rules would contaminate the baseline.
3. Save the two files below as `AGENTS.md` (repo root) and `design/AUDIT.md`.
4. Optional for Opencode, in `opencode.json`: `{ "$schema": "https://opencode.ai/config.json", "instructions": ["design/DESIGN.md", "design/AUDIT.md"] }`.

**`AGENTS.md`** (about 2,500 characters)

```
# Davos: agent rules (read at the start of every task)

## Project
Davos is a proactive, chat-first AI life mentor. Universal Expo Router app (iOS, Android, Web).
React Native primitives only (View, Text, Pressable, TextInput, FlatList). No DOM elements, no CSS
files, no UI kit. Tokens live in theme/tokens/. The backend (Supabase, existing pipeline) is OUT OF
SCOPE: never change schema, functions or API contracts. Free tiers only: add no dependency, paid
service or API key without asking first.
Testing rule: never call a real Oath bind against production data. Use the fake adapter or a test project.

## Design files (read the ones the task names before doing anything)
design/DESIGN_PRD.md (source of truth), design/ANALYSIS.md, design/ORCA.md, design/BREADBOARD.md,
design/DESIGN.md, design/AUDIT.md, design/RECON.md.
If a file is missing, or two files contradict each other, stop and report. Do not guess.

## Modes (the task names exactly one)
MODE A (spec): write or edit files in /design only. No app code.
MODE B (build): implement only the slice named. Add no Place, route, affordance, component or token
that is not in the design files. If one is needed, stop and ask.
MODE C (audit): read-only, except the single report file named in the task. Change no app code.

## Always
- Use only tokens from theme/tokens/, through the role map in design/DESIGN.md. No raw colour,
  spacing or radius values.
- One canonical component per object (PRD section 12). Never reuse one object's component for another.
- No stacked bordered or elevated cards. Hierarchy comes from type scale, spacing and hairlines.
- Every Pressable has accessibilityRole and accessibilityLabel. Touch targets at least 44.
- Four states for every view: empty, loading, populated, error. Use PRD copy only.
- Check the Expo SDK and Expo Router versions in package.json and follow that version's docs.
- Before replying, report: (1) every item in PRD section 14 as pass/fail with file and line;
  (2) every decision you made that the spec did not specify.
```

**`design/AUDIT.md`** (the audit list; "auto" = a script or grep can find it, "look" = a human check)

```
AU1  auto  Routes under app/ match PRD section 0 exactly. No extra Place.
AU2  look  One canonical component per object. Plan item and Doing look different (PRD section 3).
AU3  auto  No stacked bordered or elevated cards: flag elevation, shadow* props, and list items that
           combine border + radius + padding as a boxed container. Modal sheets excepted.
AU4  look  No chat bubbles or avatars on Davos messages.
AU5  auto  No history list, session list, regenerate, copy-message or model picker.
AU6  auto  No points, badges, leaderboard or streak art. No row of KPI cards on Today or Proof.
AU7  auto  No tier-1 value shown only on hover (search hover handlers that gate visibility).
AU8  auto  No raw colour (hex, rgb, hsl, oklch literals) or off-scale spacing outside theme/.
AU9  look  Accent colour appears on at most one element per screen.
AU10 look  Urge and Send on opposite sides of the input. Discard draft at least 16 from Bind.
AU11 auto  Modals only for the Oath ceremony and system sheets.
AU12 auto  Every Pressable has accessibilityRole and accessibilityLabel.
AU13 auto  Touch targets at least 44 (minHeight/minWidth or hitSlop).
AU14 look  Status is never colour alone (glyph or label present).
AU15 look  Each view has empty, loading, populated and error states with PRD copy.
AU16 look  Loading shows cached data first where cached data exists.
AU17 auto  No emoji or exclamation marks in UI strings. None of the PRD "never says" phrases.
AU18 auto  No DOM elements (div, span, etc.) and no CSS files.
AU19 look  Web: Enter sends, Shift+Enter newline, Esc closes, visible focus, Tab follows visual order.
AU20 auto  Reduce-motion is respected for every animation.
AU21 auto  No edit or delete affordance on a bound Oath anywhere.
AU22 auto  package.json diff: no dependency added without approval.
AU23 look  Compact: bottom bar with 3 items. Regular and wide: left rail.
AU24 auto  No backend, schema or API-contract change in the diff.
```

### 6.2 Stage 0: baseline (optional, 20 minutes, before `AGENTS.md` exists)

```
On a new git branch called baseline, create one route app/baseline.tsx. Build "the main screen of a
proactive AI life-coach app called Davos". Use only the existing tokens in theme/tokens/. Do not touch
any other file. Stop when done.
```

Screenshot it and score it against `AUDIT.md` (this is H16's baseline). Then delete the branch.

### 6.3 Prompt 0: reconnaissance (Mode C)

```
	MODE C. TASK: reconnaissance only. Write one file: design/RECON.md. Change no other file.
READ: AGENTS.md, design/DESIGN_PRD.md, design/ANALYSIS.md, package.json, everything under app/,
theme/tokens/, and wherever the data hooks and API clients live.
Report:
1. Expo SDK, Expo Router and React Native versions; whether expo-notifications is installed.
2. Route tree: every file under app/ with a one-line purpose.
3. Data layer: each hook or service the UI can call, with inputs and outputs, mapped to the ORCA
   objects (Thread, Check-in, Doing, Plan, Reflection, Oath). Mark any object with no data source MISSING.
4. Token inventory: the exact exported token names for colour, type, spacing and radius, and whether
   light and dark both exist.
5. Existing UI: which current screens correspond to S1-S6 in PRD section 0; which have no counterpart;
   which existing screens have no place in the PRD (list as CANDIDATES FOR REMOVAL, do not remove).
6. Offline sync queue: where it lives and which operations go through it.
7. Anything in the PRD that the data layer cannot support (for example the delayed urge follow-up in F2).
Stop after writing RECON.md.
```

**Gate 0:** read RECON.md. Any BLOCKED item is a backend question for you (Part 4), and the PRD gets amended before building.

### 6.4 Stage 1: Spec (Mode A)

**Prompt 1.1: compile the spec files**

```
MODE A. TASK: compile the spec files from the PRD. Compress; do not invent.
Create:
- design/ORCA.md: PRD section 3 plus the task table from design/ANALYSIS.md section 1.2.
- design/BREADBOARD.md: PRD section 7, flows F1-F5, as Places / Affordances / Connection lines, plus
  the Place count.
- design/DESIGN.md: the machine-readable spec: principles (section 2), viewport budget (8), visibility
  tiers (9), familiar-vs-invented (10), states and recovery (11), token roles and rules and component
  inventory (12), interaction and tone rules (13), do-not list (14).
Rules: where the PRD is silent write "OPEN:" and the gap. Where design/RECON.md shows the data layer
cannot support something write "BLOCKED:" and the reason. Add no screens, flows, tokens or copy.
Stop. Output: a list of every OPEN and BLOCKED item.
```

**Prompt 1.2: consistency check and token map**

```
MODE A. TASK: consistency check and token map. Append "TOKEN MAP" and "CHECK RESULTS" to design/DESIGN.md.
Edit nothing else.
1. TOKEN MAP: for each colour and type role in PRD section 12, name the exact existing token in
   theme/tokens/ that fills it, for dark and light. Where none exists write "MISSING: <role>". Create nothing.
2. CHECK RESULTS, list: (a) objects in BREADBOARD.md missing from ORCA.md; (b) CTAs attached to no
   object; (c) any Place in BREADBOARD.md that is not in PRD section 0; (d) principles or tokens in
   DESIGN.md that trace to no PRD section; (e) tier-1 values placed in a hidden tier; (f) custom
   patterns with no named convention failure; (g) any OPEN item on a Core Job screen.
Propose no fixes. Stop.
```

**Gate 1:** no OPEN items on Core Job screens. Contradictions are fixed in the PRD, not only in DESIGN.md. You've read DESIGN.md once, start to end. MISSING tokens are your decision.

### 6.5 Stage 2: Structure (Mode B, unstyled vertical slices)

**Prompt 2.1: F1, the hourly check-in (S1)**

```
MODE B. TASK: vertical slice of flow F1 (hourly check-in) in unstyled RN primitives.
SCOPE: screen S1 (Thread) only, at the route RECON.md maps to S1.
Build exactly the F1 affordances in design/BREADBOARD.md: status line as Text; message stream with
Davos and user messages as plain Text; a pending check-in prompt with the response row
[Did it] [Partly] [Didn't] [Something else]; composer (TextInput + Send); Urge to the LEFT of the input
and Send to the RIGHT.
Behaviour: [Did it] logs a Doing, shows a Davos acknowledgement and an undo control for 10 seconds.
[Partly] and [Something else] focus the composer. [Didn't] shows Davos's single follow-up question.
With no Plan item for the interval, the response row is replaced by the focused composer.
Data: use the existing hooks from RECON.md where they exist. For MISSING or BLOCKED parts use a local
fixture module (fixtures/davos.ts) shaped like the ORCA attributes.
Styling: layout only (flex, spacing-scale padding). No colours, borders, icons or fonts beyond defaults.
Output: the route, the fixture file, and Places and Affordances built vs BREADBOARD.md F1. Stop.
```

**Gate 2.1:** run F1 yourself, then H2, H3, H8, H9, H14 with beta users.

**Prompt 2.2: F3 and S2 (evening session, Plan, Today)**

```
MODE B. TASK: vertical slice of F3 (evening session) and screen S2 (Today), unstyled.
Build:
1. In S1: Davos's evening questions as plain messages with free-text answers.
2. An inline PlanList: items with text, time and status. Edit in place: change text and time, up/down
   reorder buttons (no drag), remove, add. A [Confirm plan] action.
3. Screen S2: the Plan items with Doings logged under each, and a "next check-in" line.
PlanItemRow (time at left) and DoingLine (time at right) must be two different elements (PRD section 3).
Data and styling rules as in the F1 slice. Output and stop.
```

**Prompt 2.3: F4 (the Oath ceremony, S4)**

```
MODE B. TASK: vertical slice of F4 (Oath ceremony, S4), unstyled.
Build the two steps in BREADBOARD.md F4. Draft: commitment text, review date, [Discard draft],
[Read it back]. Read-back: commitment text, the single line "This can't be edited or deleted.",
[Back], [Bind]. [Bind] is disabled for 5 seconds after the read-back appears, and when offline.
Persistence: do NOT call the real bind endpoint. Define OathAdapter { saveDraft, discardDraft, bind }
with an in-memory fake only. Real wiring comes later and only against a test backend.
There must be no edit or delete affordance on a bound Oath anywhere. Output and stop.
```

**Gate 2.3:** H6 with the fake adapter.

**Prompt 2.4: notification landing (F1 entry)**

```
MODE B. TASK: notification landing for F1, following the expo-notifications docs for this project's SDK.
Build: (1) a dev-only screen app/dev/notify.tsx that schedules a LOCAL test notification 10 seconds
ahead with data { url: '<route for S1>' }; (2) in the root layout, a notification-response observer that
routes to that url for warm start and cold start (getLastNotificationResponseAsync); (3) on arrival,
S1 shows the same pending prompt as the notification.
Do not implement remote push, token registration or any server code. On web, check the docs for web
support first and guard notification code by Platform; the web path just shows the pending prompt on open.
Report what works on which platform and what you could not verify without a device. Stop.
```

**Gate 2:** H7 on real devices. Fix any structural finding in `BREADBOARD.md` first and regenerate the affected slice. Don't patch it in code.

### 6.6 Stage 3: Components (Mode B)

**Prompt 3.1: role layer**

```
MODE B. TASK: create theme/roles.ts. Export the semantic roles from PRD section 12 (colour: surface,
textPrimary, textSecondary, divider, accent, onAccent, danger, focusRing, disabled; type: davosVoice,
userText, meta, figure, heading) as aliases of existing tokens, per the TOKEN MAP in design/DESIGN.md,
for dark and light. Where the map says MISSING, stop and list options; do not invent a value.
Change no component. Stop.
```

**Prompt 3.2: component group (repeat once per group, in this order)**

```
MODE B. TASK: build component group [G] from the component inventory in design/DESIGN.md.
For each component in the group: props exactly as listed; every listed state; only theme/roles.ts;
RN primitives only; hairline dividers, no card containers, no elevation; accessibilityRole and
accessibilityLabel on every Pressable; text scales with system settings.
Create a dev-only section in app/dev/components.tsx that renders every component of the group in every
state (empty, loading, populated, error, where they apply), dark and light side by side.
Change no screen. If a component needs something not in the spec, stop and ask.
Output: files created and a states-rendered checklist. Stop.
```

Groups, in order:

- **G1 Thread:** DavosMessage, UserMessage, SystemLine, StatusLine, Composer (with Urge placement).
- **G2 Check-in:** CheckInPrompt with ResponseRow, UndoToast.
- **G3 Plan and Doing:** PlanItemRow, PlanList, DoingLine, ReflectionEntry.
- **G4 Oath:** OathStatement, OathDraftForm, OathReadBack, BindButton.
- **G5 Shell:** BottomNav, SideRail, TodayPanel (~).

**Gate 3.2:** open the preview with everything side by side. A Plan item and a Doing are clearly different. No card look anywhere. The accent appears once. Take a first-click screenshot of S1 at compact width.

**Prompt 3.3: assemble screens and shell**

```
MODE B. TASK: assemble S1, S2, S3 and the shell from the existing components. Replace the unstyled
slice markup with components. Create no new components.
Shell: compact (width under 768): bottom bar with 3 items. Regular (768-1199): collapsible left rail.
Wide (1200+): rail, plus the optional docked TodayPanel flush to the edge (a ~ nice-to-have: build it
only if everything else passes). Use useWindowDimensions for breakpoints. Items: Davos, Today, Proof.
Settings in an overflow menu.
S3: Oath section first (OathStatement), then "this week" as plain lines, then the dated ledger.
Implement the PRD section 11 states for every view with the PRD copy exactly, and the offline and
error behaviour in section 11.
Output: screens changed, states implemented, any OPEN or BLOCKED item hit. Stop.
```

**Gate 3.3:** H1 on screenshots at compact and wide.

### 6.7 Stage 4: Polish (Modes C and B)

**Prompt 4.1: audit (Mode C)**

```
MODE C. TASK: audit the build against design/AUDIT.md. Write design/AUDIT_REPORT.md only.
For every AU item output: PASS / FAIL, file:line evidence, proposed fix. Use grep and code reading for
"auto" items. For "look" items state what a human must check and where. Fix nothing.
```

**Prompt 4.2: approved fixes and behaviour pass (Mode B)**

```
MODE B. TASK: apply only the fixes I approve below, then a behaviour pass.
APPROVED FIXES: [paste the rows you approve from design/AUDIT_REPORT.md]
BEHAVIOUR PASS:
1. Web: Enter sends, Shift+Enter inserts a newline, Esc closes a sheet or panel, visible focus,
   Tab order follows the visual order.
2. Respect reduce-motion for every animation.
3. At 200% text size the response row is not clipped or hidden.
4. Forced failures (network off during send, check-in and plan edit): each shows the PRD copy and
   keeps the user's input.
5. A Doing logged offline appears as waiting and syncs without duplicating.
6. Loading shows cached data first where it exists.
7. At 360 wide: no horizontal scroll and no hidden required control.
Report each as done / not done with file:line. Stop.
```

### 6.8 Final prompt: design QA against the PRD (Mode C)

```
MODE C. TASK: design QA of the finished build against design/DESIGN_PRD.md. Write design/QA_REPORT.md
only. Fix nothing.
For each PRD section 0-14 output a table: requirement | PASS / FAIL / CANNOT VERIFY FROM CODE |
evidence (file:line or route) | note. Check specifically:
- Section 0: the route list equals the PRD screen list; list any extra Place.
- Sections 3 and 12: one canonical component per object; Plan item and Doing visually distinct; no
  component reused across objects.
- Sections 6 and 8: breakpoints, shell per width, viewport budget, Urge-to-Send spacing,
  Discard-to-Bind spacing.
- Section 7: each flow F1-F5 can be traced in code with the listed affordances and no extra ones;
  report the Place count.
- Section 9: no tier-1 value is hover-only.
- Section 11: every view has empty, loading, populated and error with the PRD copy; the recovery
  behaviour per consequential action.
- Section 12: no raw colour, spacing or radius outside tokens; accent at most once per screen.
- Section 13: web keys, accessibility floor, and tone rules: scan every user-facing string for emoji,
  exclamation marks and the "never says" phrases.
- Section 14: every do-not item as PASS / FAIL.
- Dependencies and backend: package.json diff shows no unapproved addition; no backend change.
Finish with: (a) the FAIL list sorted by severity (blocks a key task / degrades a key task / cosmetic);
(b) a checklist of the items only a human with a device can verify.
```

Fix every FAIL with a 4.2-style prompt, then re-run this one. Items marked CANNOT VERIFY go to your device testing (H7, H10, H13).

### 6.9 Chain table

| Prompt element                           | Basis                                             | Verification                                 |
| ---------------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| Specs as files, no UI code before them   | E24, E27 (corroborated · medium), E2 (documented) | Gate 1: no OPEN items on Core Job screens    |
| Recon first                              | A23, [P]                                          | RECON.md exists before any spec work         |
| One stage per prompt, human gate between | E5 (documented), E29                              | Gate notes above                             |
| Slices before styling                    | E5, E4                                            | Place count vs BREADBOARD.md                 |
| One component per object                 | E6 (documented · high)                            | Gate 3.2 side-by-side                        |
| Audit after every generation             | E24, E27                                          | AUDIT_REPORT.md                              |
| Fresh QA against the PRD                 | E24, E27                                          | QA_REPORT.md                                 |
| Rules in `AGENTS.md`                     | E31, E32                                          | Agent's invented-decision list at every gate |

---

**Part 3 is complete:** deliverables 5 and 6 (with new ledger entries E31-E33).
**Next is Part 4:** deliverable 7 (a day-by-day plan fitted to 14 days at about 3 hours a day [A1], with the artifact produced each day) and deliverable 8 (every assumption and the open questions whose answers would change the plan). Say "continue" for Part 4.
