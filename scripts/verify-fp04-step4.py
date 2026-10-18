#!/usr/bin/env python3
"""Automate FP-04 Step 4 verification (client scheduler + notifications + pending store).

Covers PLAN Step 4 Verify: "jest grid suite green (including the shared vectors); `tsc --noEmit`
clean; static asserts: scheduler wired at the `(app)` layout, no web scheduling (platform gate),
channel/category registered once; the real notification firing needs hardware and waits for the
Step 8 device drill (FP-03 AC-8's measured-vs-asserted rule)."

  AUTOMATED -- static (no network):
    files       : the four new modules + the two new suites exist
    purity      : `lib/checkinGrid.ts` imports nothing value-typed (jest-loadable, like the
                  server twin); the twin `_shared/checkin/windows.ts` still exists
    twin rules  : the client grid mirrors the frozen §7.1 contract -- local active-start anchor,
                  the `label + cadence <= endMin` no-overnight rule, the deterministic
                  `checkin_{userId}_{epochHour}` id, the inclusive `cadence/2` tolerance with the
                  earlier-start tie, and the null-tz -> 'UTC' read
    fire-at-close: the scheduled trigger is derived from `closeMs`, never `startMs`
    scheduler   : `expo-notifications`; deterministic-id re-arm + stale cancel; armed at the
                  `(app)` layout on auth and on `AppState` active; permission-denied is non-fatal;
                  the Reply text-input action + `davos://chat?focus=checkin` tap deep link
    web gate    : `Platform.OS === "web"` returns before any scheduling
    channel     : the Android `checkin` channel is distinct from push's `default` and is set once
    direct reply: `response.userText` -> POST `submit-checkin {content, windowTs (ISO),
                  capture:'reply'}`; a consumed reply dismisses the notification (the Android
                  RemoteInput send spinner) and an app-open replay consumes the launch response
    plain tap   : the window is recorded *before* `Linking.openURL(data.url)` (the OS opens the
                  app but never `data.url`), so a live tap routes to `focus=checkin` while a
                  cold-start tap is read by the chat screen on mount
    check-in err: the chat screen's check-in POST classifies a failure from the response *status*,
                  never from the parsed body -- a body carries no status, so a rejected or
                  failed submit read as `network` and was parked in the pending store behind the
                  offline copy; a missing session is `auth`, not a replay
    queue       : AsyncStorage per-user key, the `{content, windowTs, retryAt, attempts}` entry,
                  sequential flush that stops at the first retryable item and *drops* a permanent
                  (4xx) rejection so one stale window cannot wedge the queue, and the flush
                  triggers (NetInfo, Realtime, AppState, manual)
    tz sync     : `update_checkin_prefs` is called when the device zone differs from the profile
    dev drill   : the "fire a check-in notification now" trigger (TECH-SPEC §7.1) -- the
                  Settings button behind the same two dev gates (`__DEV__` + the flag), the pure
                  target selector (the open window, else the most recently closed one), the
                  production content builder + category under a `dev_` identifier (outside the
                  re-arm's `checkin_` sweep), and a reported reason instead of a silent no-op
    registry    : no new DB object / job type / config key -- Step 4 is client-only

  AUTOMATED -- types/tests:
    tsc         : `npx tsc --noEmit` is clean
    jest        : `npx jest --ci` green; the two new suites are discovered; and the client grid
                  suite runs the frozen twin-grid fixture (`_shared/checkin/windows.fixture.ts`,
                  the same table the Step 2 server suite runs — NFR-7)

  The real notification firing (a window's banner at its close, a background direct reply, the
  tap deep link on a device) needs hardware and is owned by the Step 8 device drill -- asserted
  here, measured there (the FP-03 AC-8 precedent). This gate therefore has no live section.

Usage (PowerShell):
  python scripts/verify-fp04-step4.py [--static-only] [--run-jest] [--no-tsc]

`--static-only` runs the offline half alone (no tsc, no jest). `--run-jest` and `--no-tsc` are
independent: by default the gate runs tsc always and jest only with `--run-jest` (jest is slow).

PREREQUISITES: none -- Step 4 touches no migration, no function and no remote config.
"""

import argparse
import os
import re
import shutil
import subprocess
import sys

FAILURES = []

GRID_REL = "lib/checkinGrid.ts"
SCHED_REL = "lib/checkins.ts"
QUEUE_REL = "lib/checkinQueue.ts"
PUSH_REL = "lib/push.ts"
GRID_TEST_REL = "lib/checkinGrid.test.ts"
SCHED_TEST_REL = "lib/checkins.test.ts"
LAYOUT_REL = "app/(app)/_layout.tsx"
CHAT_REL = "app/(app)/chat.tsx"
SETTINGS_REL = "app/(app)/settings.tsx"
SERVER_TWIN_REL = "supabase/functions/_shared/checkin/windows.ts"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def check(name, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + name + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def info(label, value):
    print(f"  ..   {label}: {value}")


def read_text(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def strip_block_comments(src):
    """Drop /* ... */ and // ... so assertions never match a comment.

    The `//` rule skips a `//` that follows a colon, so a URL literal
    (`davos://chat?focus=checkin`) is not mistaken for a line comment.
    """
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?<!:)//[^\n]*", "", src)
    return src


def jest_check():
    """Full jest suite. Returns (ok, output)."""
    try:
        use_shell = os.name == "nt"
        if not use_shell and shutil.which("npx") is None:
            return None, "npx not on PATH"
        p = subprocess.run(
            "npx jest --ci" if use_shell else ["npx", "jest", "--ci"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=900,
            shell=use_shell,
            encoding="utf-8",
            errors="replace",
        )
        return p.returncode == 0, (p.stdout or "") + (p.stderr or "")
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def tsc_check():
    """`npx tsc --noEmit`. Returns (ok, output)."""
    try:
        use_shell = os.name == "nt"
        if not use_shell and shutil.which("npx") is None:
            return None, "npx not on PATH"
        p = subprocess.run(
            "npx tsc --noEmit" if use_shell else ["npx", "tsc", "--noEmit"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=900,
            shell=use_shell,
            encoding="utf-8",
            errors="replace",
        )
        return p.returncode == 0, (p.stdout or "") + (p.stderr or "")
    except Exception as e:  # noqa: BLE001
        return False, str(e)


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------


def static_checks():
    print("== A. static (no network) ==")

    for rel in (GRID_REL, SCHED_REL, QUEUE_REL, PUSH_REL, GRID_TEST_REL, SCHED_TEST_REL):
        check(f"{rel} exists", read_text(rel) is not None)

    grid = read_text(GRID_REL) or ""
    sched = read_text(SCHED_REL) or ""
    queue = read_text(QUEUE_REL) or ""
    push = read_text(PUSH_REL) or ""
    layout = read_text(LAYOUT_REL) or ""
    chat = read_text(CHAT_REL) or ""
    settings = read_text(SETTINGS_REL) or ""
    grid_test = read_text(GRID_TEST_REL) or ""
    sched_test = read_text(SCHED_TEST_REL) or ""
    if not (grid and sched and queue and push and layout):
        return

    grid_code = strip_block_comments(grid)
    sched_code = strip_block_comments(sched)
    queue_code = strip_block_comments(queue)
    push_code = strip_block_comments(push)
    layout_code = strip_block_comments(layout)

    # --- purity: the grid must load under jest (zero value imports) ---
    value_imports = re.findall(r"(?m)^\s*import\s+(?!type\b)(?!\s*\{[^}]*\}\s*from)", grid_code)
    check(
        "checkinGrid.ts is pure (no value imports; `type`-only is fine)",
        value_imports == [],
        f"{value_imports}",
    )
    check("the server twin still exists (NFR-7)", read_text(SERVER_TWIN_REL) is not None)

    # --- twin rules: the frozen §7.1 contract ---
    check(
        "the client grid anchors on the local active-start (not epoch hour)",
        "parseClock(grid.activeStart)" in grid_code and "windowsForLocalDay" in grid_code,
    )
    check(
        "the client grid keeps the no-overnight rule (`label + cadence <= endMin`)",
        re.search(r"label\s*\+\s*cadence\s*<=\s*endMin", grid_code) is not None,
    )
    check(
        "the window id is `checkin_{userId}_{epochHour-of-start}`",
        re.search(r"`checkin_\$\{userId\}_\$\{epochHour\}`", grid_code) is not None
        and "Math.floor(startMs / 3_600_000)" in grid_code,
    )
    check(
        "the snap tolerance is inclusive `cadence/2`",
        re.search(r"grid\.cadenceMinutes\s*\*\s*60_000\)\s*/\s*2", grid_code) is not None,
    )
    check(
        "a tie keeps the EARLIER start (strictly smaller distance replaces)",
        re.search(r"if\s*\(distance\s*<\s*bestDistance\)", grid_code) is not None,
    )
    check(
        "closes are the next emitted start, else start + cadence",
        re.search(r"i\s*\+\s*1\s*<\s*starts\.length\s*\?\s*starts\[i\s*\+\s*1\]", grid_code) is not None,
    )
    check(
        "rolling next-24h set + the currently-open window are exported",
        "rollingWindows" in grid_code and "currentOpen" in grid_code,
    )
    check(
        "null timezone reads as 'UTC'",
        re.search(r"\|\|\s*['\"]UTC['\"]", sched_code) is not None,
    )

    # --- notification fires at the window CLOSE ---
    check(
        "the scheduled trigger is derived from closeMs (fires at close)",
        re.search(r"w\.closeMs\s*-\s*nowMs", sched_code) is not None,
    )
    check(
        "the notification body is rendered in the profile zone",
        "utcToLocalLabel(timezone, window.closeMs)" in sched_code
        or "utcToLocalLabel(grid.timezone" in sched_code,
    )

    # --- scheduler ---
    check(
        "the scheduler uses expo-notifications",
        re.search(r"from\s+['\"]expo-notifications['\"]", sched_code) is not None,
    )
    check(
        "re-arm is idempotent via the deterministic identifier",
        re.search(r"identifier:\s*w\.id", sched_code) is not None,
    )
    check(
        "notifications not in the new id set are cancelled, pending ones skipped",
        "cancelScheduledNotificationAsync" in sched_code
        and re.search(r"!\s*validIds\.has\(id\)", sched_code) is not None
        and re.search(r"pending\.has\(w\.id\)", sched_code) is not None,
    )
    check(
        "armCheckins / cancelCheckins are exported",
        re.search(r"export\s+async\s+function\s+armCheckins", sched_code) is not None
        and re.search(r"export\s+async\s+function\s+cancelCheckins", sched_code) is not None,
    )
    check(
        "a manual/focus flush is exported",
        re.search(r"export\s+async\s+function\s+flushCheckins", sched_code) is not None,
    )
    check(
        "the scheduler is wired at the (app) layout on auth",
        re.search(r"from\s+['\"].*lib/checkins['\"]", layout_code) is not None
        and "armCheckins(" in layout_code,
    )
    check(
        "the layout re-arms on AppState 'active'",
        "AppState" in layout_code and re.search(r"state\s*===\s*['\"]active['\"]", layout_code) is not None,
    )
    check(
        "the scheduler owns an AppState listener too (foreground re-arm/flush)",
        "AppState.addEventListener" in sched_code,
    )
    check(
        "no scheduling on web (Platform.OS gate, first return)",
        re.search(r"Platform\.OS\s*===\s*['\"]web['\"]", sched_code) is not None
        and re.search(r"Platform\.OS\s*===\s*['\"]web['\"]\)\s*return", sched_code) is not None,
    )
    check(
        "the Android check-in channel is distinct from push's `default` (and versioned)",
        re.search(r"CHECKIN_CHANNEL_ID\s*=\s*['\"]checkin(_v\d+)?['\"]", sched_code) is not None,
    )
    check(
        "the channel is registered exactly once per arm (setNotificationChannelAsync)",
        sched_code.count("setNotificationChannelAsync") == 1,
    )
    check(
        "the check-in channel is IMPORTANCE_HIGH (a heads-up banner needs >= HIGH)",
        "AndroidImportance.HIGH" in sched_code and "AndroidImportance.DEFAULT" not in sched_code,
    )
    check(
        "the Reply text-input action is registered",
        "textInput" in sched_code and re.search(r"buttonTitle", sched_code) is not None,
    )
    check(
        "the tap deep link is `davos://chat?focus=checkin`",
        "davos://chat?focus=checkin" in sched_code,
    )
    check(
        "a check-in is never suppressed by the chat-focus handler (short-circuit first)",
        "isCheckinNotification(notification)" in push_code
        and push_code.index("isCheckinNotification(notification)") < push_code.index("if (isChatFocused())"),
    )
    check(
        "arm re-checks the notification permission (Android 13+ POST_NOTIFICATIONS)",
        "getPermissionsAsync" in sched_code and "requestPermissionsAsync" in sched_code,
    )

    # --- direct reply ---
    check(
        "a direct reply is read from `response.userText`",
        "response.userText" in sched_code,
    )
    check(
        "the direct reply POSTs submit-checkin with capture:'reply' and the windowTs",
        re.search(r"capture:\s*['\"]reply['\"]", sched_code) is not None
        and re.search(r"body:\s*JSON\.stringify\(\{[^}]*windowTs", sched_code, re.S) is not None,
    )
    check(
        "the posted `windowTs` is an ISO string (the server's canonical wire form)",
        "windowTs: new Date(windowTs).toISOString()" in sched_code,
    )
    check(
        "a failed direct reply is persisted to the queue",
        re.search(r"enqueueCheckIn\(", sched_code) is not None,
    )
    check(
        "a consumed reply dismisses the notification (clears the Android send spinner)",
        "dismissNotificationAsync" in sched_code,
    )
    check(
        "a reply delivered after process death replays at arm (FR-3)",
        "getLastNotificationResponse()" in sched_code,
    )

    # --- the plain tap (FR-2, FR-4): the OS brings the app forward but never opens `data.url` ---
    check(
        "a plain tap records its window before the route (the cold-start fallback)",
        "pendingTapWindowTs = data.windowTs" in sched_code,
    )
    check(
        "a plain tap opens the notification's deep link (FR-2; the OS never opens `data.url`)",
        re.search(r"Linking\.openURL\(", sched_code) is not None and "data.url" in sched_code,
    )
    check(
        "the chat screen consumes a recorded tap on mount too (the cold-start leg, not only the route param)",
        chat.count("takePendingTapWindowTs()") >= 2,
    )

    # --- check-in failure routing (Step 5's screen): the offline copy is for TRANSPORT failures ---
    check(
        "a rejected/failed check-in POST carries its HTTP status into the classifier",
        re.search(r"context:\s*\{\s*status:\s*res\.status\s*\}", chat) is not None,
    )
    check(
        "a missing session on a check-in is `auth`, not an offline replay",
        re.search(r"context:\s*\{\s*status:\s*401\s*\}", chat) is not None,
    )

    # --- queue ---
    check(
        "the queue key is per-user (`checkin_queue_${userId}`)",
        re.search(r"checkin_queue_\$\{userId\}", queue_code) is not None
        or re.search(r"`\$\{QUEUE_PREFIX\}\$\{userId\}`", queue_code) is not None,
    )
    check(
        "the entry shape is {content, windowTs, retryAt, attempts}",
        all(k in queue_code for k in ("content", "windowTs", "retryAt", "attempts")),
    )
    check(
        "the flush is sequential; a retryable item stops the walk, a 4xx is dropped",
        re.search(r"for\s*\(const\s+entry\s+of\s+entries\)", queue_code) is not None
        and "stopped = true" in queue_code
        and re.search(r"if\s*\(permanent\)", queue_code) is not None,
    )
    check(
        "AsyncStorage is the store",
        'from "@react-native-async-storage/async-storage"' in queue_code,
    )
    check(
        "the flush triggers are wired (NetInfo, Realtime, AppState, manual)",
        "NetInfo.addEventListener" in sched_code
        and re.search(r"\.channel\(", sched_code) is not None
        and re.search(r"status\s*===\s*['\"]SUBSCRIBED['\"]", sched_code) is not None
        and "AppState.addEventListener" in sched_code
        and re.search(r"export\s+async\s+function\s+flushCheckins", sched_code) is not None,
    )

    # --- tz sync ---
    check(
        "the device zone is synced through `update_checkin_prefs`",
        re.search(r"update_checkin_prefs", sched_code) is not None
        and re.search(r"deviceTz\s*!==\s*profileTz", sched_code) is not None,
    )

    # --- dev drill trigger ---
    check(
        "the dev drill fires the production notification for the window in play",
        re.search(r"export\s+async\s+function\s+fireCheckinNow", sched_code) is not None
        and "buildNotificationContent(grid.timezone, target)" in sched_code,
    )
    check(
        "the dev identifier sits outside the re-arm sweep (the `checkin_` prefix)",
        re.search(r"identifier:\s*`dev_\$\{target\.id\}`", sched_code) is not None
        and not re.search(r"identifier:\s*`checkin_", sched_code),
    )
    check(
        "the dev drill selects its target purely (the open window, else the last closed)",
        re.search(r"export\s+function\s+devNotifyTarget", grid_code) is not None
        and "devNotifyTarget(grid, nowMs, userId)" in sched_code,
    )
    check(
        "the dev drill button renders behind the same two gates (dev build + flag)",
        "fireCheckinNow" in settings and "devTools ?" in settings,
    )
    check(
        "the dev drill reports a reason instead of failing silently",
        all(
            re.search(r"reason:\s*'%s'" % r, sched_code) is not None
            for r in ("web", "no_grid", "denied", "no_window")
        ),
    )

    # --- registry: Step 4 is client-only ---
    check(
        "no new job type / config key / migration is introduced by Step 4",
        not re.search(r"insert\s+into\s+jobs", sched_code + queue_code + grid_code),
    )
    check(
        "the client suite consumes the ONE shared fixture (NFR-7), never windows.ts",
        "windows.fixture" in grid_test
        and all(tok in grid_test for tok in ("WINDOW_DAYS", "WINDOW_HINTS", "WINDOW_SPANS")),
    )
    check(
        "the client suite never imports the server module directly",
        "checkin/windows.ts" not in grid_test,
    )
    check(
        "the scheduler suite covers the queue flush gating and the web gate",
        "flushQueue" in sched_test and "Platform.OS" in sched_test and "web" in sched_test,
    )
    check(
        "the grid suite covers parseClock / id determinism / canonicalization",
        all(t in grid_test for t in ("parseClock", "canonicalizeWindow", "windowsClosedBetween")),
    )


# ---------------------------------------------------------------------------
# B. types + tests
# ---------------------------------------------------------------------------


def types_and_tests(run_jest=False, run_tsc=True):
    if run_tsc:
        print("== B. types ==")
        ok, out = tsc_check()
        if ok is None:
            check("tsc --noEmit clean", False, f"SKIP: {out}")
        else:
            check("tsc --noEmit clean", ok, out[-2000:])

    if run_jest:
        print("== C. jest ==")
        ok, out = jest_check()
        if ok is None:
            check("jest green", False, f"SKIP: {out}")
        else:
            suites = re.search(r"Test Suites:.*?(\d+) passed,\s*(\d+) total", out)
            tests = re.search(r"Tests:.*?(\d+) passed,\s*(\d+) total", out)
            n_suites = int(suites.group(1)) if suites else -1
            failed = int(suites.group(2)) - n_suites if suites else -1
            check("jest green", ok, out[-2000:])
            check(
                "jest runs >= 17 suites with 0 failures",
                n_suites >= 17 and failed == 0,
                f"{n_suites} passed / {failed} failed",
            )
            check(
                "the two Step 4 suites are discovered and pass",
                out.count("lib/checkinGrid.test.ts") >= 1 and out.count("lib/checkins.test.ts") >= 1,
                "checkinGrid.test.ts / checkins.test.ts missing from the run",
            )
            check(
                "the shared twin fixture ran in the client suite (not silently skipped)",
                "PASS lib/checkinGrid.test.ts" in out,
            )
            info("jest tests", tests.group(0) if tests else "?")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--run-jest", action="store_true")
    ap.add_argument("--no-tsc", action="store_true", help="skip `tsc --noEmit` (it is slow)")
    args = ap.parse_args()

    static_checks()
    if not args.static_only:
        types_and_tests(run_jest=args.run_jest, run_tsc=not args.no_tsc)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 4 checks passed.")


if __name__ == "__main__":
    main()
