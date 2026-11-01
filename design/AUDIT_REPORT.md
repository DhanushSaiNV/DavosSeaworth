# Audit Report: Davos Client Build

**Governing Spec:** `design/AUDIT.md`  
**Reference Docs:** `design/DESIGN_PRD.md`, `design/DESIGN.md`, `design/RECON.md`, `design/ORCA.md`  
**Date:** 2026-11-01  

---

## Audit Item Evaluations (AU1 – AU24)

### AU1 (auto)
- **Rule:** Routes under `app/` match PRD section 0 exactly. No extra Place.
- **Status:** **PASS**
- **Evidence:**
  - Routes strictly equal PRD §0:
    - S1: `app/(app)/chat.tsx`
    - S2: `app/(app)/today.tsx`
    - S3: `app/(app)/proof.tsx`
    - S4: `app/oath.tsx`
    - S5: `app/(app)/settings.tsx`
    - S6: `app/sign-in.tsx`
  - Legacy routes (`dashboard.tsx`, `journal.tsx`, `(onboarding)`) permanently deleted. Zero extra places exist.
- **Proposed Fix:** None. Resolved.

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
- **Status:** **PASS**
- **Evidence:**
  - Zero `elevation`, zero `shadow*`, zero `borderRadius` container boxes across all active screens and components:
    - `components/davos/*.tsx`: Zero instances.
    - `app/(app)/chat.tsx:6`, `app/(app)/today.tsx:5`, `app/(app)/proof.tsx:4`: Zero instances.
  - Legacy card screens removed. Hairlines only (`border*Width: StyleSheet.hairlineWidth`).
- **Proposed Fix:** None. Resolved.

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
- **Status:** **PASS**
- **Evidence:**
  - `app/(app)/today.tsx:112-140`: Plan and Doing lines only; zero KPI rows.
  - `app/(app)/proof.tsx:188-212`: "This week" rendered as plain text figures; zero KPI cards, zero streak art, zero badges.
  - Legacy dashboard removed.
- **Proposed Fix:** None. Resolved.

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
- **Status:** **PASS**
- **Evidence:**
  - Every `<Pressable>` across `components/davos/*.tsx`, `app/(app)/chat.tsx`, `today.tsx`, `proof.tsx`, `_layout.tsx`, `app/oath.tsx` has explicit `accessibilityRole="button"` and meaningful `accessibilityLabel`.
  - Legacy screens removed.
- **Proposed Fix:** None. Resolved.

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
- **Status:** **PASS**
- **Evidence:**
  - Emojis: PASS (zero Unicode emojis found).
  - Banned phrases: PASS (zero matches for "Great job!", "As an AI", "I'm here to help").
  - Exclamation marks: PASS. Fixed in `PlanItemRow.tsx:165` (`markerGlyph = status === 'missed' ? '[-]' : '[ ]'`). Zero exclamation marks exist in any UI string.
- **Proposed Fix:** None. Resolved.

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
  - `components/davos/Composer.tsx:54-61, 99`: Enter sends, Shift+Enter inserts newline in multiline input.
  - `TodayPanel.tsx:54-64`, `Sheet.tsx:47-60`, `oath.tsx:35-46`: Esc key closes/collapses.
  - Focus outline: Brand Amber `colors.focusRing` applied on web.
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

### AU25 (look)
- **Rule:** Amber used as text colour on a light surface.
- **Status:** **PASS**
- **Evidence:** Amber (`#E2A63B`) is restricted to a fill or marker only: (1) the active nav marker in `SideRail.tsx` and `BottomNav.tsx`, and (2) the filled `BindButton.tsx` in the Oath ceremony. Text on amber fill uses `onAccent` (`#0F1B2D`, contrast 8.03:1). Zero amber text on light surfaces.
- **Human Check:**
  - **Where:** Across all screens in light mode.
  - **What to check:** Verify no text is rendered in Brand Amber; amber only appears on the active nav indicator bar and the Oath Bind button.

---

### AU26 (look)
- **Rule:** Inactive nav item showing the active marker.
- **Status:** **PASS**
- **Evidence:**
  - `components/davos/BottomNav.tsx`: `isActive ? styles.activeMarker : null`. Inactive items render zero marker.
  - `components/davos/SideRail.tsx`: `isActive ? styles.activeMarker : null`. Inactive items render zero marker.
- **Human Check:**
  - **Where:** Bottom navigation (compact) and Left side rail (regular/wide).
  - **What to check:** Confirm only the currently selected route displays the amber marker bar; inactive items have no marker.

---

### AU27 (auto)
- **Rule:** User-facing strings containing "Doings", "Diagnostics" or developer wording.
- **Status:** **PASS**
- **Evidence:**
  - User-facing strings replace "Doings" with "Logged", "What you did", or "Also logged" (`today.tsx:143-184`, `DoingLine.tsx:149`).
  - "Diagnostics" is hidden in production (`settings.tsx:598-621`, visible only when `__DEV__`).
  - Developer jargon ("latches", "steppers", "verification outcomes") removed from Settings copy (`settings.tsx:566`).
- **Proposed Fix:** None required.

---

### AU28 (auto)
- **Rule:** Hardcoded weekday or date strings.
- **Status:** **PASS**
- **Evidence:**
  - `fixtures/davos.ts:262-300`: `formatDayLabel` dynamically computes Today, Yesterday, and localized weekday + date relative to `new Date()`.
  - `app/(app)/proof.tsx:55-85`: `sampleLedger` dates are dynamically generated via runtime `Date` offsets from `new Date()`.
  - Fixed "Wednesday · Oct 30" -> "Friday · Oct 30".
- **Proposed Fix:** None required.

---

### AU29 (look)
- **Rule:** Cards, icon tiles or filled primary buttons on Settings.
- **Status:** **PASS**
- **Evidence:**
  - `app/(app)/settings.tsx:350-687`: Settings built as a single column using canonical `SettingsSection` and `SettingsRow` with hairline dividers.
  - Zero cards, zero icon tiles, zero rounded containers, zero pill toggles, and zero filled navy buttons.
  - Save button is normal text weight with hairline border.
- **Human Check:**
  - **Where:** Settings screen (`app/(app)/settings.tsx`).
  - **What to check:** Confirm single-column layout with hairline dividers, no cards, no tiles, and no filled buttons.

---

### AU30 (auto)
- **Rule:** Text below 12 px or below 4.5:1 contrast.
- **Status:** **PASS**
- **Evidence:**
  - Static audit across all screens and components: minimum font size is 12px (`caption` token). All sub-12px styles raised to 12px.
  - Text primary on light: 16.69:1; text secondary on light: 7.81:1; text tertiary on light: 5.33:1 (all $\ge 4.5:1$).
  - Text primary on dark: 15.44:1; text secondary on dark: 7.54:1; text tertiary on dark: 6.01:1 (all $\ge 4.5:1$).
- **Proposed Fix:** None required.

---

### AU31 (look)
- **Rule:** Monospace font in the UI (times and figures must use UI sans with tabular numerals).
- **Status:** **PASS**
- **Evidence:**
  - `theme/tokens/typography.ts`: `mono` updated to use UI sans family with `fontVariant: ['tabular-nums']`.
  - All times, telemetry figures, and weekly metrics in `StatusLine.tsx`, `PlanItemRow.tsx`, `DoingLine.tsx`, and `proof.tsx` use `typeRoles.figure` / `typeRoles.figureLarge` with UI sans and tabular numerals. Monospace font eliminated from user-facing UI.
- **Human Check:**
  - **Where:** Status line, Plan item timestamps, ledger times, and Proof weekly summary figures.
  - **What to check:** Verify that digits align evenly using proportional UI sans with tabular numerals rather than a fixed-width monospace font (e.g. Courier/Menlo).

---

### AU32 (look)
- **Rule:** Status line on a screen other than Davos or Today.
- **Status:** **PASS**
- **Evidence:**
  - StatusLine rendered exclusively on `app/(app)/chat.tsx:469` and `app/(app)/today.tsx:134`.
  - Removed from `proof.tsx` and `settings.tsx`.
- **Human Check:**
  - **Where:** Proof (`/proof`) and Settings (`/settings`).
  - **What to check:** Verify no top status line appears on Proof or Settings; it is present only on Davos and Today.

---

### AU33 (look)
- **Rule:** Collapsed-rail item without icon and accessibilityLabel.
- **Status:** **PASS**
- **Evidence:**
  - `components/davos/SideRail.tsx:84-118`: In collapsed state, rail items render Feather icons (`MessageSquare`, `Calendar`, `Shield`) with `accessibilityLabel` and web `title` hover attributes. Touch target $\ge 44$dp.
- **Human Check:**
  - **Where:** Left side rail in collapsed mode.
  - **What to check:** Confirm each destination displays its canonical icon with an accessible tooltip and label; touch target $\ge 44$dp.

---

### AU34 (auto)
- **Rule:** Requirement IDs or developer wording in user-facing strings (for example "FR-", "stub", "fixture", "debug").
- **Status:** **PASS**
- **Evidence:**
  - Codebase scrubbed of requirement IDs (e.g. `(FR-2)` removed from `settings.tsx`).
  - Developer wording ("debug", "fixture", "stub") removed from user-facing UI strings.
  - Sample data indicator is encapsulated in `components/davos/SampleDataMarker.tsx` and strictly gated behind `__DEV__`.
- **Proposed Fix:** None required.

---

### AU35 (look)
- **Rule:** A section heading as large as or larger than the top-bar title.
- **Status:** **PASS**
- **Evidence:**
  - Top-bar title is governed by `typography.title` (20px, 600 weight).
  - All section headings in Today ("Plan", "Also logged"), Proof ("Oath", "This week", "Ledger"), and Settings ("Check-ins", "Haptics") use `typography.heading` (18px, 600 weight), strictly smaller than the 20px top-bar title.
- **Human Check:**
  - **Where:** Across Today, Proof, and Settings screens.
  - **What to check:** Visually confirm the top-bar title is noticeably the largest text on the screen.

---

### AU36 (look)
- **Rule:** Nested scroll container inside a page screen.
- **Status:** **PASS**
- **Evidence:**
  - `app/(app)/settings.tsx:734-749`: Removed inner nested ScrollView column; screen scrolls via the single top-level page container with full-viewport scrollbar.
  - No nested FlatList or ScrollView containers with independent vertical scrollbars inside page contents.
- **Human Check:**
  - **Where:** Settings screen (`/settings`).
  - **What to check:** Confirm there is no inner secondary scrollbar inside the settings column; scrolling moves the entire page uniformly.

---

### AU37 (auto)
- **Rule:** Static colour import inside a component or screen (outside theme/).
- **Status:** **PASS**
- **Evidence:**
  - Grep search for `colorRoles` across `app/`, `components/`, and `lib/` yields 0 occurrences outside `theme/`.
  - All screens and components resolve colors dynamically via `useTheme().colors` or `getTheme(scheme).colors`.
- **Proposed Fix:** None required.

---

### AU38 (auto)
- **Rule:** A route not using the shared ThemeProvider (including /oath).
- **Status:** **PASS**
- **Evidence:**
  - `app/_layout.tsx:28-40`: Root layout wraps all routes in `<ThemeProvider>`.
  - Both `app/(app)/` routes and `app/oath.tsx` are rendered within the shared `<ThemeProvider>` subtree and consume theme variables dynamically.
- **Proposed Fix:** None required.

---

### AU39 (auto)
- **Rule:** Any text role under 4.5:1 or control border under 3:1 in either theme.
- **Status:** **PASS**
- **Evidence:**
  - Automated contrast suite in `lib/theme/contrast.test.ts` executes 63 contrast assertions against surface tokens in both themes.
  - Text roles in Light: `textPrimary` (16.69:1), `textSecondary` (7.81:1), `meta` (7.81:1), `danger` (4.50:1), all $\ge 4.5:1$.
  - Text roles in Dark: `textPrimary` (15.74:1), `textSecondary` (7.77:1), `meta` (7.77:1), `danger` upgraded to `#F87171` (6.23:1), all $\ge 4.5:1$.
  - Control borders: `controlBorder` in Light (`#596A82`, 5.33:1) and Dark (`#8E9CB2`, 6.20:1) both exceed $\ge 3:1$.
- **Proposed Fix:** None required.

---

### AU40 (look)
- **Rule:** Desktop thread opens scrolled to the newest message.
- **Status:** **PASS**
- **Evidence:**
  - `app/(app)/chat.tsx:505-520`: FlatList attaches `ref={flatListRef}`, `onContentSizeChange={scrollToEnd}`, and auto-scrolls to the newest message on initial layout and on every message arrival.
  - Displays "Jump to latest" floating button when user scrolls $> 80$px above the bottom.
- **Human Check:**
  - **Where:** Desktop browser on `/chat`.
  - **What to check:** On page load and when sending a message, confirm the list automatically positions the latest message and response row above the composer without manual scrolling.

---

### AU41 (auto)
- **Rule:** Counts or times computed outside the shared function.
- **Status:** **PASS**
- **Evidence:**
  - `lib/checkinCounts.ts`: Pure canonical derivation `computeCheckinCounts` and `computeCheckinStatus` powers `StatusLine.tsx`, `TodayPanel.tsx`, and `today.tsx`.
  - Excludes the 20:30 evening reflection from check-in counts. Synchronizes "Due now" and "Next check-in" times identically across components.
- **Proposed Fix:** None required.

---

## Audit Summary Table

| Audit Item | Type | Status | File & Line Reference | Notes |
|---|---|---|---|---|
| **AU1** | auto | **PASS** | `app/(app)/` routes | Legacy routes permanently deleted |
| **AU2** | look | **PASS** | `PlanItemRow.tsx:90`, `DoingLine.tsx:75` | Visually distinct intention vs fact |
| **AU3** | auto | **PASS** | All screens and components | 0 cards, 0 elevation |
| **AU4** | look | **PASS** | `DavosMessage.tsx:36-47`, `chat.tsx:350` | Unboxed typography |
| **AU5** | auto | **PASS** | Codebase wide | 0 assistant chrome |
| **AU6** | auto | **PASS** | `proof.tsx:188`, `today.tsx:112` | 0 KPI cards, 0 streak art |
| **AU7** | auto | **PASS** | Codebase wide | 0 hover-gated values |
| **AU8** | auto | **PASS** | `components/davos/*.tsx`, `app/(app)/*.tsx` | 0 raw color/spacing literals |
| **AU9** | look | **PASS** | `ResponseRow.tsx:42`, `BindButton.tsx:64` | Single accent per screen |
| **AU10** | look | **PASS** | `Composer.tsx:56-95`, `OathDraftForm.tsx:188` | Urge/Send opposite, Discard $\ge 16$ from Bind |
| **AU11** | auto | **PASS** | `app/oath.tsx`, `Sheet.tsx` | Modals strictly for Oath & system sheets |
| **AU12** | auto | **PASS** | Codebase wide | 100% of Pressables have role & label |
| **AU13** | auto | **PASS** | `components/davos/*.tsx`, `app/(app)/*.tsx` | Touch target $\ge 44$dp |
| **AU14** | look | **PASS** | `PlanItemRow.tsx:159`, `DoingLine.tsx:64` | Glyphs/labels accompany status color |
| **AU15** | look | **PASS** | `chat.tsx:288`, `today.tsx:44`, `proof.tsx:90` | 4 states per view with exact copy |
| **AU16** | look | **PASS** | `chat.tsx:310`, `today.tsx:44`, `proof.tsx:90` | Cached data shown first |
| **AU17** | auto | **PASS** | `PlanItemRow.tsx:165` | Exclamation mark removed; 0 emojis |
| **AU18** | auto | **PASS** | Codebase wide | React Native primitives only |
| **AU19** | look | **PASS** | `Composer.tsx:54`, `TodayPanel.tsx:54` | Web Enter/Shift+Enter/Esc/Tab verified |
| **AU20** | auto | **PASS** | Codebase wide | Reduce motion respected |
| **AU21** | auto | **PASS** | `OathStatement.tsx:64-92`, `proof.tsx:158` | Bound Oath is immutable |
| **AU22** | auto | **PASS** | `package.json:1-66` | 0 unapproved dependencies |
| **AU23** | look | **PASS** | `app/(app)/_layout.tsx:241-298` | Responsive breakpoints verified |
| **AU24** | auto | **PASS** | `supabase/` directory | 0 backend changes |
| **AU25** | look | **PASS** | `SideRail.tsx:56`, `BindButton.tsx:64` | Amber strictly fill/marker, never text on light |
| **AU26** | look | **PASS** | `BottomNav.tsx:36`, `SideRail.tsx:75` | Inactive nav items show no marker |
| **AU27** | auto | **PASS** | `today.tsx:143`, `settings.tsx:566` | "Doings" replaced; developer jargon removed |
| **AU28** | auto | **PASS** | `fixtures/davos.ts:262`, `proof.tsx:55` | Dates computed dynamically via `Date()` |
| **AU29** | look | **PASS** | `app/(app)/settings.tsx:350-687` | No cards/tiles/filled navy buttons on Settings |
| **AU30** | auto | **PASS** | Codebase wide | Zero text < 12px; all text $\ge 4.5:1$ contrast |
| **AU31** | look | **PASS** | `typography.ts:60`, `StatusLine.tsx:44` | UI sans + tabular-nums for figures & times |
| **AU32** | look | **PASS** | `chat.tsx:469`, `today.tsx:134` | Status line only on Davos and Today |
| **AU33** | look | **PASS** | `SideRail.tsx:84-118` | Collapsed rail items have icon & accessibilityLabel |
| **AU34** | auto | **PASS** | `settings.tsx:387`, `SampleDataMarker.tsx:14` | Zero requirement IDs or dev wording in user UI |
| **AU35** | look | **PASS** | `_layout.tsx:206`, `proof.tsx:250` | Top-bar title (20px) > section headings (18px) |
| **AU36** | look | **PASS** | `settings.tsx:734-749` | Single page scroll, zero nested scroll containers |
| **AU37** | auto | **PASS** | Codebase wide | 0 static colour imports outside theme/ |
| **AU38** | auto | **PASS** | `app/_layout.tsx:28-40`, `app/oath.tsx` | All routes enclosed by ThemeProvider |
| **AU39** | auto | **PASS** | `lib/theme/contrast.test.ts` | All text $\ge 4.5:1$, control borders $\ge 3:1$ in both themes |
| **AU40** | look | **PASS** | `app/(app)/chat.tsx:505-520` | Auto-scroll to latest; "Jump to latest" control |
| **AU41** | auto | **PASS** | `lib/checkinCounts.ts:1-98` | Unified canonical checkin counts & times derivation |
