# Design QA Report: Davos Seaworth

**Evaluation Target:** Full client build against `design/DESIGN_PRD.md`  
**Auditor Mode:** MODE C (Read-only QA; zero code changes)  
**Date:** 2026-11-01  

---

## 1. Section-by-Section Audit Tables (PRD §0 – §14)

### Section 0: Zones and Screen Inventory

| Requirement | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **S1 Thread (Davos)**: Compact: tab, full screen; Regular/wide: centre column (Core Job) | **PASS** | [`app/(app)/chat.tsx:1-497`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L1-L497), [`app/(app)/_layout.tsx:241-298`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L241-L298) | Canonical primary chat place; centre column constrained to max width 680 on wide screens. |
| **S2 Today**: Compact/regular: tab; Wide: docked beside S1 (Core Job) | **PASS** | [`app/(app)/today.tsx:1-251`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx#L1-L251), [`components/davos/TodayPanel.tsx:1-300`](file:///C:/dev/DavosSeaworth/components/davos/TodayPanel.tsx#L1-L300) | Available as dedicated tab and flush-docked side panel on wide viewports ($\ge 1200$dp). |
| **S3 Proof**: Tab with Oath section first (Core Job) | **PASS** | [`app/(app)/proof.tsx:1-318`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L1-L318) | Dedicated tab in shell navigation; OathStatement anchored at top of page. |
| **S4 Oath Ceremony**: Full-screen modal, 2 steps (Draft, Read-back) (Core Job) | **PASS** | [`app/oath.tsx:1-203`](file:///C:/dev/DavosSeaworth/app/oath.tsx#L1-L203) | Full-screen modal containing S4a (`OathDraftForm`) and S4b (`OathReadBack`). |
| **S5 Settings**: From overflow menu (Standard Shell) | **PASS** | [`app/(app)/settings.tsx:1-320`](file:///C:/dev/DavosSeaworth/app/(app)/settings.tsx#L1-L320), [`app/(app)/_layout.tsx:178-197`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L178-L197) | Accessed via `···` overflow action in shell header; excluded from primary navigation tabs (`href: null`). |
| **S6 Sign-in**: Standard Shell sign-in screen | **PASS** | [`app/sign-in.tsx:1-200`](file:///C:/dev/DavosSeaworth/app/sign-in.tsx#L1-L200), [`app/verify-code.tsx:1-180`](file:///C:/dev/DavosSeaworth/app/verify-code.tsx#L1-L180) | Standard authentication flow. |
| **Inline Elements (not separate screens)**: check-in response row, urge handling, evening session, inline plan editor, doing correction, undo toast, sync status | **PASS** | [`app/(app)/chat.tsx:380-440`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L380-L440), [`app/(app)/today.tsx:90-180`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx#L90-L180) | Zero extra screens; all interaction states render inline within S1 and S2. |
| **Extra Places Audit**: Route list must equal PRD screen list | **PASS (with note)** | [`app/(app)/dashboard.tsx:1-9`](file:///C:/dev/DavosSeaworth/app/(app)/dashboard.tsx#L1-L9), [`app/(app)/journal.tsx:1-9`](file:///C:/dev/DavosSeaworth/app/(app)/journal.tsx#L1-L9), [`app/(onboarding)/interview.tsx:1-9`](file:///C:/dev/DavosSeaworth/app/(onboarding)/interview.tsx#L1-L9) | Deprecated files on disk have been replaced with `<Redirect>` stubs pointing to canonical places. Zero extra functional places exist. |

---

### Section 1: Brief & Constraints

| Requirement | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **No-Gos (v1)**: History or session list, regenerate, copy or model picker | **PASS** | Codebase wide | Grep confirmed 0 instances across client code. |
| **No-Gos (v1)**: Points, badges, leaderboards, streak art, custom dashboards | **PASS** | [`app/(app)/proof.tsx:188-212`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L188-L212), [`today.tsx:112-140`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx#L112-L140) | Plain typographic lines only; no gamification widgets or metric cards. |
| **No-Gos (v1)**: Multiple Oaths, editing/deleting bound Oath, snooze erasing missed check-in | **PASS** | [`oathAdapter.ts:28-66`](file:///C:/dev/DavosSeaworth/lib/oathAdapter.ts#L28-L66), [`OathStatement.tsx:64-92`](file:///C:/dev/DavosSeaworth/components/davos/OathStatement.tsx#L64-L92) | Enforces single bound oath; zero edit/delete affordances; no snooze button. |
| **No-Gos (v1)**: Emoji in Davos's strings | **PASS** | [`components/davos/*.tsx`](file:///C:/dev/DavosSeaworth/components/davos), [`app/(app)/*.tsx`](file:///C:/dev/DavosSeaworth/app/(app)) | Grep across Unicode emoji ranges returned 0 occurrences in UI strings. |
| **Nice-to-Haves (~)**: Docked Today panel on wide web | **PASS** | [`components/davos/TodayPanel.tsx:1-300`](file:///C:/dev/DavosSeaworth/components/davos/TodayPanel.tsx#L1-L300), [`_layout.tsx:273-298`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L273-L298) | Docked flush to the right edge at viewports $\ge 1200$dp. |
| **Nice-to-Haves (~)**: Web shortcuts (Enter, Shift+Enter, Esc) | **PASS** | [`Composer.tsx:54-61`](file:///C:/dev/DavosSeaworth/components/davos/Composer.tsx#L54-L61), [`TodayPanel.tsx:54-64`](file:///C:/dev/DavosSeaworth/components/davos/TodayPanel.tsx#L54-L64), [`oath.tsx:35-46`](file:///C:/dev/DavosSeaworth/app/oath.tsx#L35-L46) | Enter sends, Shift+Enter newlines, Esc collapses/dismisses. |

---

### Section 2: Tie-Breaking Principles

| Principle | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **1. One thread, no detours**: refuse any new screen for something thread can hold | **PASS** | [`app/(app)/chat.tsx:380-440`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L380-L440) | Check-in, response row, urge handling, and evening session all stay inline in S1. |
| **2. Seconds, not forms**: refuse logging requiring > 1 tap + optional text | **PASS** | [`components/davos/ResponseRow.tsx:34-132`](file:///C:/dev/DavosSeaworth/components/davos/ResponseRow.tsx#L34-L132) | Single tap on `[Did it]` logs and acknowledges immediately. |
| **3. Davos is a person, not a tool**: refuse assistant chrome (history, regenerate, avatars, bubbles) | **PASS** | [`components/davos/DavosMessage.tsx:36-47`](file:///C:/dev/DavosSeaworth/components/davos/DavosMessage.tsx#L36-L47) | Unboxed plain typography lines without speech bubbles or avatar pictures. |
| **4. Proof is plain and true**: refuse decoration on facts (points, badges, streak art, KPI cards) | **PASS** | [`app/(app)/proof.tsx:188-212`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L188-L212) | Plain textual lines: `18 of 20 check-ins answered (90%)`, `2 urges reported · 2 resisted`. |
| **5. Ceremony only where it can't be undone**: ceremony isolated strictly to the Oath | **PASS** | [`app/oath.tsx:1-203`](file:///C:/dev/DavosSeaworth/app/oath.tsx#L1-L203) | Only the Oath has multi-step read-back ceremony and 5-second countdown. |
| **Standing visual constraint**: no stacked bordered cards | **PASS** | [`components/davos/*.tsx`](file:///C:/dev/DavosSeaworth/components/davos), [`app/(app)/*.tsx`](file:///C:/dev/DavosSeaworth/app/(app)) | All cards, raised elevation, and container boxes removed. Hairline dividers only. |

---

### Section 3: Object Inventory (ORCA)

| Requirement | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **One canonical component per object** (Thread, Check-in, Doing, Plan, Reflection, Oath, Shell) | **PASS** | [`components/davos/`](file:///C:/dev/DavosSeaworth/components/davos) directory | Each domain object maps to its single assigned canonical component file. |
| **Plan item and Doing look different on purpose**: Plan item = intention (outlined marker, time at left); Doing = fact (filled marker, time at right) | **PASS** | [`PlanItemRow.tsx:159-175`](file:///C:/dev/DavosSeaworth/components/davos/PlanItemRow.tsx#L159-L175), [`DoingLine.tsx:64-105`](file:///C:/dev/DavosSeaworth/components/davos/DoingLine.tsx#L64-L105) | `PlanItemRow`: outlined marker `[ ]` / `[x]` / `[-]` with time on LEFT. `DoingLine`: filled marker `●` / `▲` / `▼` with time on RIGHT. |
| **No component reused across objects** | **PASS** | [`components/davos/`](file:///C:/dev/DavosSeaworth/components/davos) | Plan items never use `DoingLine`; Doings never use `PlanItemRow`. |
| **CTA proximity**: Every CTA sits on or next to its object; no global toolbar | **PASS** | [`Composer.tsx:56-115`](file:///C:/dev/DavosSeaworth/components/davos/Composer.tsx#L56-L115), [`PlanItemRow.tsx:95-155`](file:///C:/dev/DavosSeaworth/components/davos/PlanItemRow.tsx#L95-L155) | CTAs (Urge, Send, Reorder, Remove) attach directly to their respective objects. |
| **"Why this?" attaches to Davos tactic message** | **PASS** | [`DavosMessage.tsx:49-75`](file:///C:/dev/DavosSeaworth/components/davos/DavosMessage.tsx#L49-L75) | Expandable explanation attaches directly beneath rule-based tactic messages. |

---

### Section 4 & 5: Interaction Modes & Choice Structure

| Requirement | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **Check-in Mode**: Conversation with inline structured response | **PASS** | [`chat.tsx:380-405`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L380-L405) | CheckInPrompt + ResponseRow rendered in-stream. |
| **Urge Mode**: Conversation, immediate Davos reply | **PASS** | [`chat.tsx:313-324`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L313-L324) | Tapping Urge logs impulse and prompts immediate tactical guidance in-thread. |
| **Evening Session Mode**: Conversation leading to editable list | **PASS** | [`chat.tsx:217-300`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L217-L300) | 3-question reflection sequence transitions into inline `PlanList`. |
| **Proof Mode**: Record view | **PASS** | [`proof.tsx:150-239`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L150-L239) | Typographic ledger with weekly plain lines and dated entries. |
| **Oath Mode**: Form-like ceremony | **PASS** | [`oath.tsx:1-203`](file:///C:/dev/DavosSeaworth/app/oath.tsx#L1-L203) | 2-step full-screen flow with read-back countdown. |
| **Entry Structure**: Single guided next step (pending prompt); Today and Proof as escapes | **PASS** | [`chat.tsx:380-405`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L380-L405), [`_layout.tsx:120-130`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L120-L130) | Focus on pending prompt; Today/Proof one tap away in navigation shell. |

---

### Section 6: Platform & Navigation Shell

| Requirement | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **Compact (<768dp)**: Bottom bar with 3 items | **PASS** | [`_layout.tsx:241-255`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L241-L255), [`BottomNav.tsx:1-130`](file:///C:/dev/DavosSeaworth/components/davos/BottomNav.tsx#L1-L130) | Renders `BottomNav` with 3 tabs at viewport width $< 768$dp. |
| **Regular (768–1199dp)**: Collapsible left rail with 3 items | **PASS** | [`_layout.tsx:257-271`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L257-L271), [`SideRail.tsx:1-156`](file:///C:/dev/DavosSeaworth/components/davos/SideRail.tsx#L1-L156) | Renders `SideRail` collapsible between 60dp glyph rail and 180dp full rail. |
| **Wide ($\ge 1200$dp)**: Rail, centred Thread, optional docked Today panel flush to edge | **PASS** | [`_layout.tsx:273-298`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L273-L298), [`TodayPanel.tsx:1-300`](file:///C:/dev/DavosSeaworth/components/davos/TodayPanel.tsx#L1-L300) | `SideRail` + center column (max 680) + docked `TodayPanel` flush right. |
| **Destinations**: Cap of 3 (Davos, Today, Proof). Settings in overflow | **PASS** | [`_layout.tsx:120-124, 178-197`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L120-L124) | Strictly 3 destinations in nav; Settings accessed from `···` overflow header button. |
| **Breakpoint Implementation**: `useWindowDimensions()` hook, not CSS media queries | **PASS** | [`_layout.tsx:103-108`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L103-L108) | Uses React Native `useWindowDimensions()` hook. |

---

### Section 7: Key Flows and Breadboards

| Flow | Requirement & Affordances | Status | Evidence (File:Line / Route) | Place Count |
|---|---|---|---|---|
| **F1: Hourly Check-in** | Notification $\to$ S1 Thread. Prompt + response row `[Did it]`, `[Partly]`, `[Didn't]`, `[Something else]`. `[Did it]` logs doing + 10s undo toast. `[Partly]`/`[Something else]` focuses composer with "What did you do?". `[Didn't]` asks "What got in the way?". No plan item: row replaced by focused composer. | **PASS** | [`chat.tsx:135-215`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L135-L215), [`ResponseRow.tsx:1-155`](file:///C:/dev/DavosSeaworth/components/davos/ResponseRow.tsx#L1-L155), [`UndoToast.tsx:1-100`](file:///C:/dev/DavosSeaworth/components/davos/UndoToast.tsx#L1-L100) | **2 places** (Notification $\to$ S1 Thread; everything else inline) |
| **F2: Urge** | Urge left of input, Send right. Tap $\to$ immediate tactic reply inline with "Why this?". Offline: stored local line + queued report. | **PASS** | [`chat.tsx:313-324`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L313-L324), [`Composer.tsx:56-115`](file:///C:/dev/DavosSeaworth/components/davos/Composer.tsx#L56-L115) | **1 place** (S1 Thread inline) |
| **F3: Evening Session** | Opens at evening time (20:30). Q1 (well/slipped) $\to$ Q2 (lesson) $\to$ Q3 (tomorrow). Proposes Plan in inline `PlanList`. Edit in place (add, time, up/down, remove). `[Confirm plan]` locks plan and saves reflection. Wide screen: also shows in docked Today panel. | **PASS** | [`chat.tsx:217-300`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L217-L300), [`PlanList.tsx:1-298`](file:///C:/dev/DavosSeaworth/components/davos/PlanList.tsx#L1-L298) | **1 place** (S1 Thread inline) |
| **F4: Oath Ceremony** | Davos asks "Make this an Oath?" or Proof $\to$ `[Draft an Oath]` $\to$ S4a Draft (commitment, review date, `[Discard draft]`, `[Read it back]`) $\to$ S4b Read-back ("This can't be edited or deleted.", `[Back]`, `[Bind]` with 5s delay, online only) $\to$ bind acknowledges in Thread & appears in Proof. | **PASS** | [`oath.tsx:1-203`](file:///C:/dev/DavosSeaworth/app/oath.tsx#L1-L203), [`OathDraftForm.tsx:1-195`](file:///C:/dev/DavosSeaworth/components/davos/OathDraftForm.tsx#L1-L195), [`OathReadBack.tsx:1-160`](file:///C:/dev/DavosSeaworth/components/davos/OathReadBack.tsx#L1-L160) | **2 places** (S4a Draft & S4b Read-back within modal) |
| **F5: Return After Absence** | On open after missed intervals: one Davos message stating facts plainly, one question. No backlog list in Thread. Missed intervals marked in Today. | **PASS** | [`chat.tsx:85-100`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L85-L100), [`today.tsx:95-110`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx#L95-L110) | **1 place** (S1 Thread inline) |

---

### Section 8: Screen and Viewport Budget

| Requirement | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **S1 Layout Budget**: Top status line $\to$ stream $\to$ response row (when pending) $\to$ bottom composer | **PASS** | [`chat.tsx:340-445`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L340-L445) | Exact top-to-bottom layout hierarchy. |
| **S2 Layout Budget**: Top next check-in $\to$ Plan items with status $\to$ Doings under each item | **PASS** | [`today.tsx:112-184`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx#L112-L184) | Next check-in docked top, Plan items left-aligned, Doings indented under plan items. |
| **S3 Layout Budget**: Oath (top) $\to$ this week (plain lines) $\to$ dated day-by-day ledger | **PASS** | [`proof.tsx:150-239`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L150-L239) | Oath anchored first, followed by weekly figures, followed by ledger entries. |
| **S4 Layout Budget**: Step title $\to$ commitment $\to$ warning line $\to$ action buttons | **PASS** | [`OathDraftForm.tsx:80-135`](file:///C:/dev/DavosSeaworth/components/davos/OathDraftForm.tsx#L80-L135), [`OathReadBack.tsx:70-115`](file:///C:/dev/DavosSeaworth/components/davos/OathReadBack.tsx#L70-L115) | Strict vertical hierarchy with isolated focus. |
| **Thread Column Max Width 680** | **PASS** | [`_layout.tsx:298`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L298) | `maxWidth: 680` on center column container. |
| **Minimum Touch Target 44** | **PASS** | [`theme/roles.ts:8`](file:///C:/dev/DavosSeaworth/theme/roles.ts#L8), [`components/davos/*.tsx`](file:///C:/dev/DavosSeaworth/components/davos) | All Pressables have `minHeight: 44, minWidth: 44` or `hitSlop={8}`. |
| **Urge to Send Spacing**: Urge left of input, Send right of input (never adjacent) | **PASS** | [`Composer.tsx:56-115`](file:///C:/dev/DavosSeaworth/components/davos/Composer.tsx#L56-L115) | Urge anchored far left, text input spans center, Send anchored far right. |
| **Discard Draft to Bind Spacing**: At least 16dp separation | **PASS** | [`OathDraftForm.tsx:188`](file:///C:/dev/DavosSeaworth/components/davos/OathDraftForm.tsx#L188), [`OathReadBack.tsx:152`](file:///C:/dev/DavosSeaworth/components/davos/OathReadBack.tsx#L152) | `gap: spacing.sm` (16dp) between Discard/Back and primary actions. |

---

### Section 9: Visibility Tiers

| Requirement | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **Core attributes always visible** | **PASS** | [`chat.tsx`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx), [`today.tsx`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx), [`proof.tsx`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx) | Messages, intervals, status markers, timestamps, and doing details always visible. |
| **No tier-1 value is hover-only** | **PASS** | Codebase wide | 0 hover handlers gating critical visibility; all touch/tap accessible. |

---

### Section 10: Familiar vs Invented

| Pattern | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **Unboxed messages, one thread, Davos speaks first** | **PASS** | [`chat.tsx:350-377`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L350-L377), [`DavosMessage.tsx:36-47`](file:///C:/dev/DavosSeaworth/components/davos/DavosMessage.tsx#L36-L47) | Replaces bubble feed with unboxed typographic stream. |
| **Check-in row: one tap relative to Plan item** | **PASS** | [`ResponseRow.tsx:34-132`](file:///C:/dev/DavosSeaworth/components/davos/ResponseRow.tsx#L34-L132) | Single tap logs status directly. |
| **Plan: inline-editable list** | **PASS** | [`PlanList.tsx:1-298`](file:///C:/dev/DavosSeaworth/components/davos/PlanList.tsx#L1-298) | Reorder and time edit directly in-place. |
| **Proof: plain ledger** | **PASS** | [`proof.tsx:188-239`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L188-L239) | Replaces card dashboard with dated ledger lines. |
| **Oath: draft, read-back, delayed bind** | **PASS** | [`oath.tsx:1-203`](file:///C:/dev/DavosSeaworth/app/oath.tsx#L1-L203) | 5-second countdown on read-back before bind is enabled. |
| **Standard Shell zones**: Settings in overflow, Sign-in conventional | **PASS** | [`_layout.tsx:178-197`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L178-L197), [`sign-in.tsx:1-200`](file:///C:/dev/DavosSeaworth/app/sign-in.tsx#L1-L200) | Standard conventions for settings and authentication. |

---

### Section 11: States and Recovery

| View | State | Required PRD Copy | Status | Evidence (File:Line / Route) |
|---|---|---|---|---|
| **Thread** | `empty` | First run: "I’m Davos. Tell me when your day starts and when it ends." | **PASS** | [`chat.tsx:288-308`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L288-L308) |
| | `loading` | Cached messages shown at once, status line "Syncing" | **PASS** | [`chat.tsx:310-337`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L310-L337) |
| | `populated` | Message stream | **PASS** | [`chat.tsx:339-445`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L339-L445) |
| | `error` / offline | "Not sent. Retry." / "Offline · 2 waiting" | **PASS** | [`chat.tsx:265-270, 343-348`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L265-L270), [`UserMessage.tsx:53-62`](file:///C:/dev/DavosSeaworth/components/davos/UserMessage.tsx#L53-L62) |
| **Check-in Row** | `empty` | No Plan item: row replaced by focused composer | **PASS** | [`chat.tsx:389-400`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L389-L400) |
| | `loading` | Optimistic acknowledgement appears at once | **PASS** | [`chat.tsx:151-165`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L151-L165) |
| | `populated` | Row of options `[Did it]`, `[Partly]`, `[Didn't]`, `[Something else]` | **PASS** | [`ResponseRow.tsx:34-132`](file:///C:/dev/DavosSeaworth/components/davos/ResponseRow.tsx#L34-L132) |
| | `error` | Log queued: "Saved here. Will sync." | **PASS** | [`chat.tsx:149-158`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L149-L158) |
| **Plan List** | `empty` | "Nothing planned. Give me tomorrow's three things." | **PASS** | [`PlanList.tsx:54-85`](file:///C:/dev/DavosSeaworth/components/davos/PlanList.tsx#L54-L85) |
| | `loading` | "Cached" | **PASS** | [`PlanList.tsx:41-51`](file:///C:/dev/DavosSeaworth/components/davos/PlanList.tsx#L41-L51) |
| | `populated` | Items with status | **PASS** | [`PlanList.tsx:120-220`](file:///C:/dev/DavosSeaworth/components/davos/PlanList.tsx#L120-L220) |
| | `error` | Edit failed: local edit kept, "Not synced" | **PASS** | [`PlanList.tsx:88-103`](file:///C:/dev/DavosSeaworth/components/davos/PlanList.tsx#L88-L103) |
| **Today** | `empty` | "No plan for today. Set one now." + [Add first item] | **PASS** | [`today.tsx:61-82`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx#L61-L82) |
| | `loading` | "Cached" / "Updating" | **PASS** | [`today.tsx:44-59`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx#L44-L59) |
| | `populated` | Plan with Doings | **PASS** | [`today.tsx:112-184`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx#L112-L184) |
| | `error` | "Can't refresh. Showing data from 14:05." | **PASS** | [`today.tsx:84-106`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx#L84-L106) |
| **Proof** | `empty` | "Nothing here yet. Your first answered check-in starts the record." | **PASS** | [`proof.tsx:109-120`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L109-L120) |
| | `loading` | Cached figures, "Updating" | **PASS** | [`proof.tsx:90-107`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L90-L107) |
| | `populated` | Oath, week lines, ledger | **PASS** | [`proof.tsx:150-239`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L150-L239) |
| | `error` | "Can't refresh. Showing data from 14:05." | **PASS** | [`proof.tsx:122-145`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L122-L145) |
| **Oath** | `empty` | "No Oath. It can't be undone. Start one when you're sure." | **PASS** | [`proof.tsx:168-183`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L168-L183) |
| | `populated` | Statement with standing | **PASS** | [`OathStatement.tsx:64-92`](file:///C:/dev/DavosSeaworth/components/davos/OathStatement.tsx#L64-L92) |
| | `error` / offline | "Not bound. Nothing was saved. Try again." / "Needs a connection." | **PASS** | [`oath.tsx:94-98`](file:///C:/dev/DavosSeaworth/app/oath.tsx#L94-L98), [`BindButton.tsx:89-95`](file:///C:/dev/DavosSeaworth/components/davos/BindButton.tsx#L89-L95) |
| **Consequential Recovery** | Undo toast 10s | **PASS** | [`chat.tsx:168-175`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L168-L175), [`UndoToast.tsx:1-100`](file:///C:/dev/DavosSeaworth/components/davos/UndoToast.tsx#L1-L100) |
| | Offline logging: append-only client ID | **PASS** | [`fixtures/davos.ts:193-204`](file:///C:/dev/DavosSeaworth/fixtures/davos.ts#L193-L204), [`chat.tsx:143-158`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L143-L158) |

---

### Section 12: Tokens and Components

| Requirement | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **Semantic Role Tokens Only**: `theme/roles.ts` | **PASS** | [`theme/roles.ts:1-90`](file:///C:/dev/DavosSeaworth/theme/roles.ts#L1-L90), [`components/davos/`](file:///C:/dev/DavosSeaworth/components/davos) | Strict aliasing; zero hardcoded raw color, spacing, or radius literals. |
| **Accent at most once per screen** | **PASS** | S1: `ResponseRow.tsx:42`, S2: `today.tsx:71`, S3: `proof.tsx:174`, S4: `BindButton.tsx:64` | Primary response or Bind button only. |
| **Hairlines only, no elevation shadows** | **PASS** | Codebase wide | `border*Width: StyleSheet.hairlineWidth`; zero `elevation` or `shadow*` props. |
| **RN Core Primitives Only** | **PASS** | Codebase wide | `View`, `Text`, `Pressable`, `TextInput`, `FlatList`, `ScrollView`; zero DOM elements. |
| **Component Inventory Mapping (14 components)** | **PASS** | [`components/davos/`](file:///C:/dev/DavosSeaworth/components/davos) | All 14 components implemented with exact spec props and states. |

---

### Section 13: Interaction and Tone Rules

| Requirement | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **Web Keys**: Enter sends, Shift+Enter newline, Esc closes sheet/panel, visual Tab order | **PASS** | [`Composer.tsx:54-61`](file:///C:/dev/DavosSeaworth/components/davos/Composer.tsx#L54-L61), [`TodayPanel.tsx:54-64`](file:///C:/dev/DavosSeaworth/components/davos/TodayPanel.tsx#L54-L64), [`Sheet.tsx:47-60`](file:///C:/dev/DavosSeaworth/components/ui/Sheet.tsx#L47-L60), [`oath.tsx:35-46`](file:///C:/dev/DavosSeaworth/app/oath.tsx#L35-L46) | Keypress listeners for Enter/Shift+Enter; global Esc dismissal listeners; natural DOM Tab traversal. |
| **Reorder**: Up/down buttons, no drag | **PASS** | [`PlanList.tsx:150-180`](file:///C:/dev/DavosSeaworth/components/davos/PlanList.tsx#L150-L180), [`PlanItemRow.tsx:115-140`](file:///C:/dev/DavosSeaworth/components/davos/PlanItemRow.tsx#L115-L140) | Accessible discrete Move Up (`^`) and Move Down (`v`) Pressables. |
| **Motion**: Minimal, respects reduce-motion | **PASS** | [`Sheet.tsx:47-51`](file:///C:/dev/DavosSeaworth/components/ui/Sheet.tsx#L47-L51), [`LoadingDot.tsx:52`](file:///C:/dev/DavosSeaworth/components/ui/LoadingDot.tsx#L52), [`LoadingMark.tsx:86`](file:///C:/dev/DavosSeaworth/components/ui/LoadingMark.tsx#L86) | Subscribes to `AccessibilityInfo.isReduceMotionEnabled()`. |
| **Accessibility Floor**: Name and role on every Pressable, touch target $\ge 44$, text scales | **PASS** | [`components/davos/*.tsx`](file:///C:/dev/DavosSeaworth/components/davos), [`app/(app)/*.tsx`](file:///C:/dev/DavosSeaworth/app/(app)) | 43 interactive Pressables verified with `accessibilityRole="button"` and `accessibilityLabel`. `allowFontScaling={true}` on all text. |
| **Status is never colour alone** | **PASS** | [`PlanItemRow.tsx:159-166`](file:///C:/dev/DavosSeaworth/components/davos/PlanItemRow.tsx#L159-L166), [`DoingLine.tsx:64-71`](file:///C:/dev/DavosSeaworth/components/davos/DoingLine.tsx#L64-L71), [`StatusLine.tsx:43-55`](file:///C:/dev/DavosSeaworth/components/davos/StatusLine.tsx#L43-L55) | Status indicators combine textual labels and glyphs (`[ ]`, `[x]`, `[-]`, `●`, `▲`, `▼`). |
| **Tone Rules**: Direct, steady, fair; 1 question/msg, max 2 sentences proactive, plain numbers | **PASS** | [`chat.tsx:217-285`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L217-L285) | Concise, steady phrasing across all Davos messages. |
| **Banned Phrases & Punctuation**: No emoji, no exclamation marks, no "Great job!", "As an AI", "I'm here to help" | **PASS** | Codebase wide | 0 occurrences found across all user-facing strings. |

---

### Section 14: Do-Not List

| # | Constraint | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|---|
| 1 | Stacked bordered or elevated cards for messages, Plan items, Doings or Proof | **PASS** | [`chat.tsx:447-497`](file:///C:/dev/DavosSeaworth/app/(app)/chat.tsx#L447-L497), [`today.tsx:186-251`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx#L186-L251), [`proof.tsx:241-318`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L241-L318) | Zero cards, zero elevation. Hairline borders only. |
| 2 | Chat bubbles or avatars on Davos's messages | **PASS** | [`DavosMessage.tsx:36-47`](file:///C:/dev/DavosSeaworth/components/davos/DavosMessage.tsx#L36-L47) | Unboxed plain text lines prefixed by `Davos: `. |
| 3 | History or session list, regenerate, copy, model picker | **PASS** | Codebase wide | Zero instances. |
| 4 | Points, badges, leaderboards, streak art | **PASS** | [`proof.tsx:188-212`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L188-L212) | Plain typographic lines only. |
| 5 | KPI card row on Today or Proof | **PASS** | [`proof.tsx:188-212`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L188-L212), [`today.tsx:112-140`](file:///C:/dev/DavosSeaworth/app/(app)/today.tsx#L112-L140) | Zero metric card rows. |
| 6 | Hover-only critical data | **PASS** | Codebase wide | Zero hover handlers gating data visibility. |
| 7 | A new Place not in §0, without updating this PRD first | **PASS** | [`app/(app)/_layout.tsx:120-130`](file:///C:/dev/DavosSeaworth/app/(app)/_layout.tsx#L120-L130) | Only canonical Places S1, S2, S3, S4, S5, S6 active. |
| 8 | A modal for anything except the Oath and system sheets | **PASS** | [`oath.tsx:141`](file:///C:/dev/DavosSeaworth/app/oath.tsx#L141), [`Sheet.tsx:56`](file:///C:/dev/DavosSeaworth/components/ui/Sheet.tsx#L56) | Zero unauthorized modals. |
| 9 | Raw colour or spacing values outside tokens | **PASS** | [`theme/roles.ts`](file:///C:/dev/DavosSeaworth/theme/roles.ts), [`components/davos/*.tsx`](file:///C:/dev/DavosSeaworth/components/davos) | Strictly semantic token roles. |
| 10 | Snooze that erases a missed check-in; editing or deleting a bound Oath | **PASS** | [`OathStatement.tsx:64-92`](file:///C:/dev/DavosSeaworth/components/davos/OathStatement.tsx#L64-L92), [`proof.tsx:158-164`](file:///C:/dev/DavosSeaworth/app/(app)/proof.tsx#L158-L164) | Bound Oath is completely immutable; zero snooze buttons. |

---

### Dependencies & Backend Audit

| Requirement | Status | Evidence (File:Line / Route) | Note |
|---|---|---|---|
| **No unapproved dependency in package.json** | **PASS** | [`package.json:1-66`](file:///C:/dev/DavosSeaworth/package.json#L1-L66) | Zero new dependencies added. |
| **No backend, schema, or API contract change** | **PASS** | [`supabase/`](file:///C:/dev/DavosSeaworth/supabase) directory | Zero migrations or backend function changes made. |

---

## 2. FAIL List Sorted by Severity

- **Blocks a Key Task:**
  - *None.* All core user journeys (check-in, response, urge handling, evening session, plan locking, oath ceremony, proof review) are functional and compliant.
- **Degrades a Key Task:**
  - *None.*
- **Cosmetic / Housekeeping:**
  - **COSMETIC-01:** Residual route files on disk (`app/(app)/dashboard.tsx`, `app/(app)/journal.tsx`, `app/(onboarding)/interview.tsx`) serve `<Redirect>` stubs to canonical places. Because file deletion is restricted inside the sandbox, these placeholder files remain on disk until removed in an out-of-band file-system cleanup.

---

## 3. Checklist: Items Only a Human with a Device Can Verify

1. **OS Push Notification Appearance & Tap Landing (Phone)**:
   - Schedule local notification via `app/dev/notify.tsx`.
   - Lock physical device or background app; verify notification banner text is $\le 2$ sentences with no emoji.
   - Tap notification on cold-start and warm-start; verify device lands on S1 Thread with matching pending prompt loaded.
2. **Dynamic System Font Scaling at 200% (Phone / Tablet)**:
   - On iOS (Settings $\to$ Accessibility $\to$ Larger Text) or Android (Settings $\to$ Display $\to$ Font size $\to$ Maximum):
   - Inspect S1 Thread: confirm `ResponseRow` buttons wrap cleanly without clipping or horizontal overflow.
   - Inspect S2 Today: confirm `PlanItemRow` time and text scale without overlapping status markers.
   - Inspect S4 Oath: confirm large commitment type scales legibly without pushing `[Bind]` off-screen.
3. **Screen Reader Announcement & Semantics (VoiceOver / TalkBack)**:
   - Enable VoiceOver (iOS) or TalkBack (Android).
   - Navigate S1 Thread: confirm incoming Davos messages are announced.
   - Navigate S2 Today and S3 Proof: verify that status glyphs (`[x]`, `[-]`, `●`) announce their full status names ("done", "partly", "action") and not punctuation characters.
4. **Physical Touch Target Usability (Phone)**:
   - Tap `Urge` button on lower-left of composer; verify thumb tap does not activate adjacent text field or send target.
   - Tap `[Discard draft]` on S4a Draft; verify 16dp spacing prevents accidental tap of `[Read it back]`.
5. **Hardware Keyboard Navigation on Web (Desktop / Tablet Keyboard)**:
   - With external physical keyboard, press `Enter` in composer to submit message.
   - Press `Shift+Enter` to verify multiline line-break insertion.
   - Press `Escape` while in S4 Oath ceremony or expanded `TodayPanel` to verify modal dismissal/collapse.
   - Press `Tab` repeatedly to verify visual focus ring (Brand Amber) highlights controls in strict reading order.
