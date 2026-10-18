# Davos Seaworth — Design System & UI Overhaul (DESIGN_DECISIONS.md)

This document records the complete audit, design direction, token definitions, primitive architecture, migration records, and verification results for the Davos mobile & web application.

---

## Stage 1: Design & Codebase Audit

### 1.1 Screen List & Shared Components
- `app/sign-in.tsx`: Authentication screen (email magic link & Google OAuth).
- `app/verify-code.tsx`: OTP verification screen (6-digit numeric input with inline error badge).
- `app/(onboarding)/interview.tsx`: Onboarding intake & conversational interview screen (previously an unstyled 23-line stub).
- `app/(app)/chat.tsx`: Primary coaching interface, message thread, optimistic bubbles, check-in banner, inline energy selector, dev override controls.
- `app/(app)/dashboard.tsx`: Daily telemetry, coach status, streak & active habits overview (previously an unstyled 23-line stub).
- `app/(app)/journal.tsx`: Distraction-free evening journal editor with client-side block flagging ("Unsavable") and post-strip preview.
- `app/(app)/settings.tsx`: Check-in cadence preferences, active hours steppers, notification permissions, developer forcer, and sign out.
- `app/(app)/_layout.tsx`: Main application tab bar layout (previously lacked any tab icons).
- `app/(onboarding)/_layout.tsx`: Onboarding stack layout.
- `app/_layout.tsx`: Root application shell and session lifecycle manager.

### 1.2 Duplicated Components & Inconsistencies
- **Buttons**:
  - `sign-in.tsx`: `button` (height 52, radius 12, black), `googleButton` (height 52, radius 12, border #ddd).
  - `verify-code.tsx`: `button` (height 56, radius 12, black), `resendButton` (paddingVertical 10, underlined).
  - `chat.tsx`: `sendButton` (height 48, radius 24, pill), `retryText` (underlined white text).
  - `settings.tsx`: `button` (height 52, radius 12, black), `saveButton` (height 44, radius 12, black), `secondaryButton` (padding 10, radius 8, border #ccc), `stepperButton` (40x36, radius 8).
  - *Resolution*: Unify under `Button` primitive supporting `primary`, `secondary`, `ghost`, and `destructive` variants with standardized height tiers (sm: 36px, md: 44px, lg: 52px).
- **Cards & Surfaces**:
  - Inconsistent elevation (some with raw shadow props, some border only, some plain background).
  - *Resolution*: Standardize under `Card` / `Surface` primitive with 3 elevation levels (`flat`, `raised`, `overlay`).
- **Chips & Selectors**:
  - `settings.tsx` (`tierChip`), `chat.tsx` (`chip` / `energyChip`): Different padding, borders, and active colors.
  - *Resolution*: Standardize under `Chip` primitive with consistent selected/disabled state styling.

### 1.3 Literal Token Counts (Audit)
- **Hard-coded Hex Colors**: 167 instances across 13 source files.
- **Hard-coded Font Sizes**: 65 instances (`10, 11, 12, 13, 14, 15, 16, 18, 24, 28`).
- **Hard-coded Border Radii**: 29 instances (`4, 8, 10, 12, 16, 24, 999`).
- **Hard-coded Spacing Literals (margin/padding)**: 108 instances.

### 1.4 Accessibility Gaps & Contrast Failures
- **Contrast ratio failures (< 4.5:1)**:
  - Text color `#999` on `#fff` (ratio: 2.85:1 — fails WCAG AA).
  - Placeholder text `#999` on `#fafafa` (ratio: 2.76:1 — fails WCAG AA 3:1 for UI boundaries).
  - Text color `#bbb` on `#000` (ratio: 3.1:1 — fails WCAG AA 4.5:1 for body/captions).
- **Touch target violations (< 44x44pt)**:
  - Stepper buttons in `settings.tsx`: 40x36pt with no hitSlop.
  - Resend link, inline badges: sub-44pt bounds without sufficient hit area.
  - Count pill in `journal.tsx`: sub-44pt bounds.
- **Missing Accessibility Props**:
  - Tab bar items had no icons or explicit accessibility hints.
  - Several `TextInput` components lacked explicit `accessibilityLabel`.
  - Icon-only or glyph-only controls lacked accessible descriptions.
- **Dark Mode Support**:
  - 0% dark mode support in previous codebase. The app used fixed `#fff` backgrounds, creating blinding white screens when the system was in dark mode.

### 1.5 Emoji as Icons & Placeholder Copy
- `journal.tsx`: Used emoji `🔒 UNSAVABLE` as a functional action label.
- `settings.tsx`: Used raw ASCII `✓` for saved state, and raw text `-` and `+` for steppers.
- `chat.tsx`: Energy selector used emoji (`😴`, `⚡`, `😄`) inside functional chips.
- `dashboard.tsx` & `interview.tsx`: Contained bare placeholder text (`"Dashboard"`, `"Interview"`).

### 1.6 Baseline Rubric Scores (1–5) Before Redesign
| Screen / Surface | Visual Identity | Typography | Color | Spacing | Hierarchy | Components | Accessibility | Responsive / Dark | Motion | Copy | Overall |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `sign-in.tsx` | 2.5 | 3.0 | 2.5 | 3.0 | 3.0 | 2.5 | 2.5 | 2.0 | 2.0 | 3.0 | **2.6** |
| `verify-code.tsx` | 2.5 | 3.0 | 2.5 | 3.0 | 3.0 | 2.5 | 2.5 | 2.0 | 2.0 | 3.0 | **2.6** |
| `interview.tsx` | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | **1.0** |
| `chat.tsx` | 3.0 | 3.0 | 2.5 | 3.0 | 3.0 | 3.0 | 2.5 | 2.0 | 2.5 | 3.5 | **2.8** |
| `dashboard.tsx` | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | **1.0** |
| `journal.tsx` | 2.5 | 3.0 | 2.5 | 2.5 | 2.5 | 2.5 | 2.5 | 2.0 | 2.0 | 3.0 | **2.5** |
| `settings.tsx` | 2.5 | 3.0 | 2.5 | 2.5 | 2.5 | 2.5 | 2.5 | 2.0 | 2.0 | 3.5 | **2.6** |
| `(app)/_layout.tsx` | 2.0 | 2.0 | 2.0 | 2.5 | 2.0 | 2.0 | 2.0 | 1.5 | 1.5 | 3.0 | **2.0** |

---

## Stage 2: Design Direction Plan

1. **Audience**: Thoughtful professionals, self-starters, and creators who value clarity, quiet focus, and disciplined personal growth.
2. **Primary Job**: Serve as an honest, calm life mentor (Davos Seaworth: unpretentious, steadfast, grounded) with zero dopamine-trap gamification.
3. **Aesthetic Direction**: **Architectural Editorial Minimalism (Linear meets Dieter Rams & Swiss Typography)**. Crisp typography, deliberate whitespace, subtle hairline borders, structured telemetry.
4. **Color Palette**:
   - `neutral.black`: `#090A0F` (True deep ink)
   - `neutral.white`: `#FFFFFF` (Pure light surface)
   - `neutral.darkBg`: `#0B0D13` (Obsidian background)
   - `neutral.darkSurface`: `#13161F` (Elevated dark card)
   - `brand.amber`: `#D97706` (Light mode warmth) / `#F59E0B` (Dark mode luminescence) — Davos's steadfast lantern
   - `semantic.danger`: `#DC2626` / `#EF4444`
   - `semantic.success`: `#059669` / `#10B981`
   - `semantic.info`: `#2563EB` / `#3B82F6`
5. **Type Roles & Hierarchy**: System font family (SF Pro on iOS, Roboto on Android, Inter on Web) with strict optical role definitions: Display (28/34, 700), Title (20/26, 600), Body (15/22, 400/500), Caption (12/16, 500), Monospace/Tabular for metrics and timestamps.
6. **Layout Concept**: Structured single-column flow with responsive max-width bounds (safe on small phones, centered at 560px on tablets/desktop web), safe-area keyboard avoidance on every screen.
7. **The ONE Memorable Design Move**: **The "Lantern & Ledger" Micro-Language** — warm amber micro-accents on active coach states paired with hairline-bordered tactile status cards with tabular telemetry (energy meters, check-in windows, cadence pills).
8. **What We Are Deliberately NOT Doing**: No purple/indigo AI gradient soup; no bouncy playful cartoon illustrations; no cards inside cards; no emoji as functional icons.
9. **Dark Mode Integration**: Full system-synchronized dark mode via `useTheme` hook with contrast-computed token sets.
10. **Design System Modules**: Centralized in `theme/` and `components/ui/` with 100% backward-compatible prop interfaces.

---
