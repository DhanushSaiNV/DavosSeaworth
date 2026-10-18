# Davos Seaworth — Haptic Vocabulary Mapping (haptics.md)

This document maps every haptic call site in the application to its trigger, vocabulary type, and accessibility fallback.

## 1. Haptic Principles & Constraints
- **Settings Governed**: Every haptic check respects `davos_haptics_enabled` in AsyncStorage. When disabled, zero haptics fire and no information is lost (visual status and copy carry 100% of the signal).
- **Web Safety**: No haptics execute on web (`Platform.OS === 'web'`).
- **Banned Reflexes**: Zero haptics on scroll gestures, keystrokes, button hovers, or routine debounced auto-saves.

## 2. Haptic Vocabulary Specification

| Call Type | Method | Physical Sensation | Allowed Triggers | Prohibited Triggers |
| :--- | :--- | :--- | :--- | :--- |
| **Selection** | `hapticSelection()` | Crisp micro-click | Value changes: Segmented control switch, Cadence chip select, Energy chip select, Stepper increment/decrement | Scroll ticks, typing in text fields, navigating tabs |
| **Light Impact** | `hapticImpactLight()` | Clean physical snap | Button press, Sheet snap to detent, Tactile commitment latch | Background sync, card appearance |
| **Medium Impact** | `hapticImpactMedium()` | Solid weight collision | Destructive action trigger (Sign out, clear unsavable draft) | Routine submit, standard clicks |
| **Success** | `hapticNotifySuccess()` | Dual-pulse confirmation | Task outcome: Code verified, Journal entry committed, Settings successfully saved | Heartbeat ping, routine message arrival |
| **Warning** | `hapticNotifyWarning()` | Low double-bump | Stale check-in window warning, Rate limit approached | Field blur |
| **Error** | `hapticNotifyError()` | Triple alert burst | Task outcome failure: OTP verification code invalid, Network request failed, Permission denied | Typing invalid character |

## 3. Comprehensive Call-Site Registry

| File Location | Function / Event | Haptic Call | Purpose & Justification |
| :--- | :--- | :--- | :--- |
| `components/ui/Button.tsx` | `onPress` (primary/secondary) | `hapticImpactLight()` | Tactile push button feedback acknowledging user tap. |
| `components/ui/Button.tsx` | `onPress` (destructive) | `hapticImpactMedium()` | Emphasizes gravity of irreversible or destructive action. |
| `components/ui/Chip.tsx` | `onPress` (toggle/select) | `hapticSelection()` | Acknowledges selection change among mutually exclusive options. |
| `components/ui/SegmentedControl.tsx` | `onSelect` | `hapticSelection()` | Acknowledges tab switch within a segmented control. |
| `app/(app)/settings.tsx` | Stepper `+` / `-` press | `hapticSelection()` | Confirms discrete hour/minute change in active window. |
| `app/(app)/settings.tsx` | Save preferences tap | `hapticNotifySuccess()` | Task outcome: Preferences persisted to server and local cache. |
| `app/(app)/chat.tsx` | Energy chip selected | `hapticSelection()` + `hapticImpactLight()` | Signature moment: Visual latch + commitment feedback. |
| `app/(app)/journal.tsx` | Commit reflection tap | `hapticImpactLight()` + `hapticNotifySuccess()` | Signature moment: Tactile commitment latch with 5-second undo window. |
| `app/verify-code.tsx` | OTP verification success | `hapticNotifySuccess()` | Task outcome: Successful user authentication and session creation. |
| `app/verify-code.tsx` | OTP verification failure | `hapticNotifyError()` | Task outcome: Failed code entry requiring user correction. |
| `app/sign-in.tsx` | Sign-in error | `hapticNotifyError()` | Task outcome: Invalid email or OAuth failure. |
