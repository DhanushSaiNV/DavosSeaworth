AU1 auto Routes under app/ match PRD section 0 exactly. No extra Place.
AU2 look One canonical component per object. Plan item and Doing look different (PRD section 3).
AU3 auto No stacked bordered or elevated cards: flag elevation, shadow* props, and list items that
combine border + radius + padding as a boxed container. Modal sheets excepted.
AU4 look No chat bubbles or avatars on Davos messages.
AU5 auto No history list, session list, regenerate, copy-message or model picker.
AU6 auto No points, badges, leaderboard or streak art. No row of KPI cards on Today or Proof.
AU7 auto No tier-1 value shown only on hover (search hover handlers that gate visibility).
AU8 auto No raw colour (hex, rgb, hsl, oklch literals) or off-scale spacing outside theme/.
AU9 look Accent colour appears on at most one element per screen.
AU10 look Urge and Send on opposite sides of the input. Discard draft at least 16 from Bind.
AU11 auto Modals only for the Oath ceremony and system sheets.
AU12 auto Every Pressable has accessibilityRole and accessibilityLabel.
AU13 auto Touch targets at least 44 (minHeight/minWidth or hitSlop).
AU14 look Status is never colour alone (glyph or label present).
AU15 look Each view has empty, loading, populated and error states with PRD copy.
AU16 look Loading shows cached data first where cached data exists.
AU17 auto No emoji or exclamation marks in UI strings. None of the PRD "never says" phrases.
AU18 auto No DOM elements (div, span, etc.) and no CSS files.
AU19 look Web: Enter sends, Shift+Enter newline, Esc closes, visible focus, Tab follows visual order.
AU20 auto Reduce-motion is respected for every animation.
AU21 auto No edit or delete affordance on a bound Oath anywhere.
AU22 auto package.json diff: no dependency added without approval.
AU23 look Compact: bottom bar with 3 items. Regular and wide: left rail.
AU24 auto No backend, schema or API-contract change in the diff.
