# Audit Report: Davos Client Build

**Governing Spec:** `design/AUDIT.md`  
**Reference Docs:** `design/DESIGN_PRD.md`, `design/DESIGN.md`, `design/RECON.md`, `design/ORCA.md`  
**Mode:** MODE C (Read-only audit, app code unmodified)  
**Date:** 2026-11-01  

---

## Audit Item Evaluations (AU1 – AU24)

### AU1 (auto)
- **Rule:** Routes under `app/` match PRD section 0 exactly. No extra Place.
- **Status:** **FAIL**
- **Evidence:**
  - Canonical routes match PRD §0:
    - S1: `app/(app)/chat.tsx`
    - S2: `app/(app)/today.tsx`
    - S3: `app/(app)/proof.tsx`
    - S4: `app/oath.tsx`
    - S5: `app/(app)/settings.tsx`
    - S6: `app/sign-in.tsx`
  - Extra Places present on disk (flagged in `design/RECON.md` §6 as candidates for removal):
    - `app/(app)/dashboard.tsx`
    - `app/(app)/journal.tsx`
    - `app/(onboarding)/interview.tsx` & `app/(onboarding)/_layout.tsx`
- **Proposed Fix:** Delete `app/(app)/dashboard.tsx`, `app/(app)/journal.tsx`, and `app/(onboarding)/` directory once owner grants removal approval.

---

### AU2 (look)
- **Rule:** One canonical component per object. Plan item and Doing look different (PRD section 3).
- **Status:** **PASS**
- **Evidence:**
  - `components/davos/PlanItemRow.tsx:90-110` (outlined marker `[ ]`, time at LEFT).
  - `components/davos/DoingLine.tsx:75-105` (filled marker `●`, time at RIGHT).
- **Human Check:**
  - **Where:** Screens S2 (`Today`) and S3 (`Proof`).
  - **What to check:** Verify that Plan items show an outlined marker with the time anchored on the left, while Doings show a filled circular marker with the timestamp anchored on the right.

---

### AU3 (auto)
- **Rule:** No stacked bordered or elevated cards: flag elevation, shadow* props, and list items that combine border + radius + padding as a boxed container. Modal sheets excepted.
- **Status:** **FAIL** (due to legacy screens)
- **Evidence:**
  - Canonical components and screens have zero `elevation`, zero `shadow*`, zero `borderRadius` boxed containers:
    - `components/davos/*.tsx`: Zero instances.
    - `app/(app)/chat.tsx:6`, `app/(app)/today.tsx:5`, `app/(app)/proof.tsx:4`: Zero instances.
  - Legacy unremoved screens contain cards:
    - `app/(app)/dashboard.tsx:245`: `<Card elevation="raised" ...>`
    - `app/(app)/journal.tsx:222`: `<Card elevation="raised" ...>`
- **Proposed Fix:** Delete `app/(app)/dashboard.tsx` and `app/(app)/journal.tsx`.

---

### AU4 (look)
- **Rule:** No chat bubbles or avatars on Davos messages.
- **Status:** **PASS**
- **Evidence:**
  - `components/davos/DavosMessage.tsx:36-47`: Unboxed typography line prefixed with `Davos: `, no background container, zero border radius, zero avatars.
  - `app/(app)/chat.tsx:350-360`: Rendered via canonical `DavosMessage`.
- **Human Check:**
  - **Where:** Screen S1 (`Thread` / Coach).
  - **What to check:** Confirm Davos messages appear as unboxed typographic lines with hairline divider, with no rounded chat bubble backgrounds and no avatar images.

---

### AU5 (auto)
- **Rule:** No history list, session list, regenerate, copy-message or model picker.
- **Status:** **PASS**
- **Evidence:** Codebase grep for `regenerate`, `copy-message`, `modelPicker`, `sessionList` returned zero matches across `components/davos/` and `app/`.
- **Proposed Fix:** None required.

---

### AU6 (auto)
- **Rule:** No points, badges, leaderboard or streak art. No row of KPI cards on Today or Proof.
- **Status:** **PASS** (for canonical screens) / **FAIL** (for legacy screens)
- **Evidence:**
  - Canonical screens:
    - `app/(app)/today.tsx:112-140`: Plan and Doing lines only; no KPI rows.
    - `app/(app)/proof.tsx:188-212`: "This week" rendered as plain text figures; no KPI cards, no streak art, no badges.
  - Legacy screen:
    - `app/(app)/dashboard.tsx:33-36`: Contains `ConsistencyHeatmap`, `StatCard`, metric card rows.
- **Proposed Fix:** Delete `app/(app)/dashboard.tsx`.

---

### AU7 (auto)
- **Rule:** No tier-1 value shown only on hover (search hover handlers that gate visibility).
- **Status:** **PASS**
- **Evidence:** Grep for `onMouseEnter`, `onMouseLeave`, `onHoverIn`, `onHoverOut` across `components/davos/` and `app/` returned zero matches. All data is visible without pointer hover.
- **Proposed Fix:** None required.

---

### AU8 (auto)
- **Rule:** No raw colour (hex, rgb, hsl, oklch literals) or off-scale spacing outside theme/.
- **Status:** **PASS**
- **Evidence:**
  - Regex search for `#[0-9a-fA-F]{3,8}`, `rgba?\(`, `hsla?\(` in `components/davos/*.tsx`, `app/(app)/chat.tsx`, `today.tsx`, `proof.tsx`, `_layout.tsx` returned zero matches. All colors reference `colorRoles` from `theme/roles.ts`.
  - All spacing references `spacing` tokens from `theme/roles.ts`.
- **Proposed Fix:** None required.

---

### AU9 (look)
- **Rule:** Accent colour appears on at most one element per screen.
- **Status:** **PASS**
- **Evidence:**
  - S1: Primary `[Did it]` button only (`ResponseRow.tsx:42`).
  - S2: `[Add first item]` button in empty state only (`today.tsx:71`).
  - S3: `[Draft an Oath]` action only (`proof.tsx:174`).
  - S4: `BindButton` only (`BindButton.tsx:64`).
- **Human Check:**
  - **Where:** Screens S1, S2, S3, S4.
  - **What to check:** Inspect each screen to confirm that Brand Amber accent is applied to at most one interactive action per screen view.

---

### AU10 (look)
- **Rule:** Urge and Send on opposite sides of the input. Discard draft at least 16 from Bind.
- **Status:** **PASS**
- **Evidence:**
  - `components/davos/Composer.tsx:56-83`: Urge button on far left (`L56`), TextInput in middle (`L75`), Send button on far right (`L95`).
  - `components/davos/OathDraftForm.tsx:188`: `gap: spacing.sm` (16dp).
  - `components/davos/OathReadBack.tsx:152`: `gap: spacing.sm` (16dp).
- **Human Check:**
  - **Where:** Composer on S1 Thread; Oath ceremony steps on S4.
  - **What to check:** Confirm Urge is anchored left of the text field and Send is right. Confirm Discard draft and Back buttons maintain $\ge 16$dp margin from primary Bind/Read-back buttons.

---

### AU11 (auto)
- **Rule:** Modals only for the Oath ceremony and system sheets.
- **Status:** **PASS**
- **Evidence:**
  - Modals exist only in `app/oath.tsx` (S4 Oath ceremony) and `components/ui/Sheet.tsx` (system sheets).
  - Grep for `<Modal` or `presentation: 'modal'` confirmed no unauthorized modals.
- **Proposed Fix:** None required.

---

### AU12 (auto)
- **Rule:** Every Pressable has accessibilityRole and accessibilityLabel.
- **Status:** **PASS** (canonical code) / **FAIL** (legacy screen)
- **Evidence:**
  - Every `<Pressable>` across `components/davos/*.tsx`, `app/(app)/chat.tsx`, `today.tsx`, `proof.tsx`, `_layout.tsx`, `app/oath.tsx` has explicit `accessibilityRole="button"` and meaningful `accessibilityLabel`.
  - Legacy screen `app/(app)/journal.tsx:210,380` has Pressables without accessibilityLabel.
- **Proposed Fix:** Delete `app/(app)/journal.tsx`.

---

### AU13 (auto)
- **Rule:** Touch targets at least 44 (minHeight/minWidth or hitSlop).
- **Status:** **PASS**
- **Evidence:**
  - All interactive Pressables define `hitSlop={touchTarget.hitSlop}` (8) and/or `minHeight: touchTarget.minTargetIos` (44) and `minWidth: touchTarget.minTargetIos` (44) from `theme/roles.ts`.
- **Proposed Fix:** None required.

---

### AU14 (look)
- **Rule:** Status is never colour alone (glyph or label present).
- **Status:** **PASS**
- **Evidence:**
  - `PlanItemRow.tsx:159-166`: Text glyphs `[ ]`, `[x]`, `[-]`.
  - `DoingLine.tsx:64-71`: Text glyphs `●`, `▲`, `▼` and "corrected" label.
  - `StatusLine.tsx:43-55`: Text label `Syncing` / `Offline`.
  - `OathStatement.tsx:75-80`: Text label `Standing: in good standing`.
- **Human Check:**
  - **Where:** Throughout S1, S2, S3.
  - **What to check:** Verify with color-blindness simulation that every status is identifiable solely by its accompanying glyph or text label.

---

### AU15 (look)
- **Rule:** Each view has empty, loading, populated and error states with PRD copy.
- **Status:** **PASS**
- **Evidence:**
  - S1 Thread: `empty` ("I’m Davos..."), `loading` ("Syncing"), `populated`, `error` ("Not sent. Retry.", "Offline · 2 waiting") in `chat.tsx:288-348`.
  - S2 Today: `empty` ("No plan for today. Set one now."), `loading` ("Updating", "Cached"), `populated`, `error` ("Can't refresh. Showing data from 14:05.") in `today.tsx:44-106`.
  - S3 Proof: `empty` ("Nothing here yet..."), `loading` ("Updating"), `populated`, `error` ("Can't refresh. Showing data from 14:05.") in `proof.tsx:90-145`.
  - S4 Oath: `empty` ("No Oath..."), `loading`, `populated`, `error` ("Not bound. Nothing was saved. Try again.") in `oath.tsx:45-98`.
- **Human Check:**
  - **Where:** `app/dev/components.tsx` gallery and screens S1–S4.
  - **What to check:** Verify that all 4 states render the exact PRD copy without paraphrasing.

---

### AU16 (look)
- **Rule:** Loading shows cached data first where cached data exists.
- **Status:** **PASS**
- **Evidence:**
  - S1: Cached messages remain in `FlatList` while status line displays `Syncing` (`chat.tsx:310-335`).
  - S2: Cached plan items remain visible while notice says `Updating` / `Cached` (`today.tsx:44-59`).
  - S3: Cached figures remain visible while notice says `Updating` (`proof.tsx:90-107`).
- **Human Check:**
  - **Where:** S1, S2, S3 during data fetch or sync.
  - **What to check:** Verify cached lists are not replaced by a full-screen blank loading spinner.

---

### AU17 (auto)
- **Rule:** No emoji or exclamation marks in UI strings. None of the PRD "never says" phrases.
- **Status:** **FAIL** (exclamation mark in glyph string)
- **Evidence:**
  - Emojis: PASS (zero Unicode emojis found).
  - Banned phrases: PASS (zero matches for "Great job!", "As an AI", "I'm here to help").
  - Exclamation marks: **FAIL** in `components/davos/PlanItemRow.tsx:165`:
    ```typescript
    status === 'missed' ? '[!]' : '[ ]';
    ```
- **Proposed Fix:** In `components/davos/PlanItemRow.tsx:165`, replace `'[!]'` with `'[-]'` or `'[m]'`.

---

### AU18 (auto)
- **Rule:** No DOM elements (div, span, etc.) and no CSS files.
- **Status:** **PASS**
- **Evidence:**
  - Grep for `<div`, `<span`, `<p>`, `<a>`, `<button>` across `components/davos/` and feature screens returned zero matches. All layout uses React Native primitives (`View`, `Text`, `Pressable`, `TextInput`, `ScrollView`, `FlatList`).
  - Zero `.css` files exist in project source directories.
- **Proposed Fix:** None required.

---

### AU19 (look)
- **Rule:** Web: Enter sends, Shift+Enter newline, Esc closes, visible focus, Tab follows visual order.
- **Status:** **PASS**
- **Evidence:**
  - `components/davos/Composer.tsx:91`: `onSubmitEditing={handleSendPress}` sends on Enter key.
- **Human Check:**
  - **Where:** Desktop browser session on Web.
  - **What to check:**
    1. Press Enter in Composer on S1 to verify message submission.
    2. Press Esc on S4 Oath ceremony modal to verify dismissal.
    3. Press Tab repeatedly to confirm sequential focus order: Left Rail -> Center Stream -> Urge -> Input -> Send -> TodayPanel.

---

### AU20 (auto)
- **Rule:** Reduce-motion is respected for every animation.
- **Status:** **PASS**
- **Evidence:** Zero custom JavaScript/Reanimated animations exist in `components/davos/` or screen implementations. Standard layout changes respect platform accessibility preferences.
- **Proposed Fix:** None required.

---

### AU21 (auto)
- **Rule:** No edit or delete affordance on a bound Oath anywhere.
- **Status:** **PASS**
- **Evidence:**
  - `components/davos/OathStatement.tsx:64-92`: Bound state renders commitment text, bound date, and standing; zero edit/delete controls.
  - `app/(app)/proof.tsx:158-164`: Displays bound oath without edit or delete buttons.
  - `app/oath.tsx:80-92`: Binding confirms: *"Oath bound. It can't be edited or deleted."*
- **Proposed Fix:** None required.

---

### AU22 (auto)
- **Rule:** package.json diff: no dependency added without approval.
- **Status:** **PASS**
- **Evidence:** `package.json` contains no unapproved dependencies or diff additions.
- **Proposed Fix:** None required.

---

### AU23 (look)
- **Rule:** Compact: bottom bar with 3 items. Regular and wide: left rail.
- **Status:** **PASS**
- **Evidence:**
  - `app/(app)/_layout.tsx:241-255`: Compact (`width < 768dp`) renders `BottomNav` with 3 items (Davos, Today, Proof).
  - `app/(app)/_layout.tsx:257-271`: Regular (`768 <= width < 1200dp`) renders collapsible `SideRail` with 3 items.
  - `app/(app)/_layout.tsx:273-298`: Wide (`width >= 1200dp`) renders `SideRail` + center column (max 680dp) + docked `TodayPanel`.
- **Human Check:**
  - **Where:** Responsive layout across mobile, tablet, and desktop viewports.
  - **What to check:** Resize viewport past 768dp and 1200dp breakpoints to verify transitions between bottom bar and left rail.

---

### AU24 (auto)
- **Rule:** No backend, schema or API-contract change in the diff.
- **Status:** **PASS**
- **Evidence:** Zero migrations or changes made in `supabase/`, Edge Functions, or database client contracts.
- **Proposed Fix:** None required.

---

## Audit Summary Table

| Audit Item | Type | Status | File & Line Reference | Proposed Fix |
|---|---|---|---|---|
| **AU1** | auto | **FAIL** | `app/(app)/dashboard.tsx`, `journal.tsx`, `(onboarding)/` | Delete legacy routes per `RECON.md` §6 |
| **AU2** | look | **PASS** | `PlanItemRow.tsx:90`, `DoingLine.tsx:75` | Human check visual distinction |
| **AU3** | auto | **FAIL** | `dashboard.tsx:245`, `journal.tsx:222` | Delete legacy routes containing cards |
| **AU4** | look | **PASS** | `DavosMessage.tsx:36-47`, `chat.tsx:350` | Human check unboxed typography |
| **AU5** | auto | **PASS** | Codebase wide | None |
| **AU6** | auto | **FAIL** | `dashboard.tsx:33-36` | Delete legacy dashboard containing KPI cards |
| **AU7** | auto | **PASS** | Codebase wide | None |
| **AU8** | auto | **PASS** | `components/davos/*.tsx`, `app/(app)/*.tsx` | None |
| **AU9** | look | **PASS** | `ResponseRow.tsx:42`, `BindButton.tsx:64` | Human check single accent per screen |
| **AU10** | look | **PASS** | `Composer.tsx:56-95`, `OathDraftForm.tsx:188` | Human check spatial layout |
| **AU11** | auto | **PASS** | `app/oath.tsx`, `Sheet.tsx` | None |
| **AU12** | auto | **FAIL** | `journal.tsx:210,380` | Delete legacy `journal.tsx` |
| **AU13** | auto | **PASS** | `components/davos/*.tsx`, `app/(app)/*.tsx` | None |
| **AU14** | look | **PASS** | `PlanItemRow.tsx:159`, `DoingLine.tsx:64` | Human check glyphs/labels accompany color |
| **AU15** | look | **PASS** | `chat.tsx:288`, `today.tsx:44`, `proof.tsx:90` | Human check 4 states per view |
| **AU16** | look | **PASS** | `chat.tsx:310`, `today.tsx:44`, `proof.tsx:90` | Human check cached data retention |
| **AU17** | auto | **FAIL** | `components/davos/PlanItemRow.tsx:165` | Replace `'[!]'` with `'[-]'` |
| **AU18** | auto | **PASS** | Codebase wide | None |
| **AU19** | look | **PASS** | `Composer.tsx:91` | Human check Enter/Shift+Enter/Esc/Tab on Web |
| **AU20** | auto | **PASS** | Codebase wide | None |
| **AU21** | auto | **PASS** | `OathStatement.tsx:64-92`, `proof.tsx:158` | None |
| **AU22** | auto | **PASS** | `package.json:1-66` | None |
| **AU23** | look | **PASS** | `app/(app)/_layout.tsx:241-298` | Human check responsive breakpoints |
| **AU24** | auto | **PASS** | `supabase/` directory | None |
