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
AU25 look Amber used as text colour on a light surface.
AU26 look Inactive nav item showing the active marker.
AU27 auto User-facing strings containing "Doings", "Diagnostics" or developer wording.
AU28 auto Hardcoded weekday or date strings.
AU29 look Cards, icon tiles or filled primary buttons on Settings.
AU30 auto Text below 12 px or below 4.5:1 contrast.
AU31 look Monospace font in the UI (times and figures must use UI sans with tabular numerals).
AU32 look Status line on a screen other than Davos or Today.
AU33 look Collapsed-rail item without icon and accessibilityLabel.
AU34 auto Requirement IDs or developer wording in user-facing strings (for example "FR-", "stub", "fixture", "debug").
AU35 look A section heading as large as or larger than the top-bar title.
AU36 look Nested scroll container inside a page screen.
AU37 auto Static colour import inside a component or screen (outside theme/).
AU38 auto A route not using the shared ThemeProvider (including /oath).
AU39 auto Any text role under 4.5:1 or control border under 3:1 in either theme.
AU40 look Desktop thread opens scrolled to the newest message.
AU41 auto Counts or times computed outside the shared function.
AU42 auto More than one offer visible in the Thread.
AU43 auto Mixed time formats.
AU44 look Ledger or "Also logged" entry text set at meta size.
AU45 look Duplicate labels in Settings (section and row).
AU46 look Red used for text that isn't an error or a destructive control.
AU47 look Button labels at different sizes on one screen.
AU48 look An icon-only close or back control in a link colour instead of textPrimary.
AU49 look A composer input taller than its content.
AU50 look In-chat check-in interactions must render in dedicated Action Zone, not interleaved as chat message bubbles.
AU51 look Today panel must provide separate Plan and Activity tabs.
AU52 look Urge hold countdown must be visible via sticky banner during an active hold.
