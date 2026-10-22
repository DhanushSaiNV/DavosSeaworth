#!/usr/bin/env python3
"""FP-08 Step 8 gate -- interception: log-impulse + client surfaces + histogram_daily.

Covers PLAN Step 8 Verify:
  static  : the sync logger's contract, the rider's candor credit, the histogram's two legs
            (cold start, top-2, future fire times, past skip, any-status dedupe, deterministic
            text, preemptive metadata, the deep link), the dispatcher case + FAST exclusion,
            the dev-smoke leg, the docs write-backs, client logging discipline, no new
            dependency, zero FP-07 edits
  toolchain: tsc / full jest / deno check / the FP-03, FP-04, FP-05 static gates
  live    : log-impulse from both capture paths + content cap + the capped candor credit and
            no server dedupe; 14 failures in one hour -> one fire 15 min before the bucket;
            force-fire -> the deterministic text + row + metadata; re-fire -> duplicate; a
            2-failure user -> nothing; the boundary at 3; two clusters + a third -> top-2;
            empty activities -> the generic text; a past computed_for -> nothing scheduled

The web surface is verified structurally (the button is not Platform-gated; `focus=alternative`
scrolls) because this harness has no browser automation. The owner manual covers the visible
web drill and the Android backgrounded quick action.

Cleanup removes the fixture user (cascade) and its jobs (no user FK).

Usage: python scripts/verify-fp08-step8.py [--static-only] [--no-toolchain]
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACC = "supabase/functions/_shared/accountability"
HIST = f"{ACC}/runHistogram.ts"
HIST_PURE = f"{ACC}/histogram.ts"
TEMPLATES = f"{ACC}/templates.ts"
RIDER = f"{ACC}/rider.ts"
APPLY = f"{ACC}/applyRider.ts"
IMPULSE_FN = "supabase/functions/log-impulse/index.ts"
DISPATCH = "supabase/functions/job-dispatcher/index.ts"
SMOKE = "supabase/functions/dev-smoke/index.ts"
CHAT = "app/(app)/chat.tsx"
LAYOUT = "app/(app)/_layout.tsx"
CLIENT = "lib/impulse.ts"
BUTTON = "lib/impulseButton.ts"
BUTTON_TEST = "lib/impulseButton.test.ts"
TECH = "docs/TECH-SPEC.md"
GLOSSARY = "docs/GLOSSARY.md"
PLAN = "docs/feature-prds/FP-08/FP-08-PLAN.md"

FP07_PATHS = [
    "lib/metricsData.ts",
    "lib/metricsData.test.ts",
    "app/(app)/dashboard.tsx",
    "supabase/functions/_shared/metrics/create.ts",
    "supabase/functions/_shared/metrics/formula.ts",
    "supabase/functions/_shared/metrics/presets.ts",
    "supabase/functions/_shared/metrics/runEval.ts",
    "supabase/functions/metric-eval/index.ts",
]

FAILS = []
LIVE = {}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def read(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def check(label, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + label + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(label)


def skip(label, why):
    print(f"  SKIP {label} ({why})")


def load_dotenv():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


def run(args, timeout=900):
    proc = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=timeout,
                          encoding="utf-8", errors="replace")
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def git(args):
    return run(["git"] + args, timeout=120)


# ---------------------------------------------------------------------------
# REST helpers
# ---------------------------------------------------------------------------


def req(method, path, body=None, token=None, key=None, headers=None, timeout=200):
    h = {"Content-Type": "application/json"}
    if key:
        h["apikey"] = key
    if token:
        h["Authorization"] = f"Bearer {token}"
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(3):
        request = urllib.request.Request(LIVE["url"] + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as resp:
                raw = resp.read().decode()
                return resp.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode()
            try:
                return exc.code, json.loads(raw)
            except Exception:  # noqa: BLE001
                return exc.code, {"raw": raw[:400]}
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def rest(method, path, body=None, prefer="return=representation"):
    headers = {"Prefer": prefer} if prefer else None
    return req(method, "/rest/v1" + path, body, token=LIVE["service"], key=LIVE["service"],
               headers=headers)


def rows(path):
    status, body = rest("GET", path, prefer=None)
    if status != 200:
        raise RuntimeError(f"GET {path} -> {status}: {body}")
    return body if isinstance(body, list) else []


def one(path):
    result = rows(path)
    return result[0] if result else None


def get_config(key):
    row = one(f"/config?select=value&key=eq.{key}")
    return row["value"] if row else None


def smoke(query):
    return req("POST", "/functions/v1/dev-smoke?" + query, token=LIVE["smoke"], key=LIVE["smoke"])


def fn_post(name, body, token=None):
    return req("POST", f"/functions/v1/{name}", body, token=token, key=LIVE.get("anon"))


# ---------------------------------------------------------------------------
# A. static
# ---------------------------------------------------------------------------


def static_checks():
    print("== A. static surface ==")
    hist_src = read(HIST)
    pure_src = read(HIST_PURE)
    templates_src = read(TEMPLATES)
    rider_src = read(RIDER)
    apply_src = read(APPLY)
    fn_src = read(IMPULSE_FN)
    dispatch_src = read(DISPATCH)
    smoke_src = read(SMOKE)
    chat_src = read(CHAT)
    layout_src = read(LAYOUT)
    client_src = read(CLIENT)
    button_src = read(BUTTON)
    button_test = read(BUTTON_TEST)
    tech_src = read(TECH)
    glos_src = read(GLOSSARY)
    plan_src = read(PLAN)
    pkg_src = read("package.json")

    for rel, src in (
        (HIST, hist_src), (IMPULSE_FN, fn_src), (CLIENT, client_src),
        (BUTTON, button_src), (BUTTON_TEST, button_test),
    ):
        check(f"{rel} exists", bool(src))

    # -- log-impulse (FR-20)
    check("log-impulse admits only the two captures",
          '"quick_action" || value === "app"' in fn_src)
    check("content is optional and capped by chat_max_message_chars",
          'getConfigNumber("chat_max_message_chars")' in fn_src
          and "trimmed.length > maxChars" in fn_src)
    check("the insert is impulse_failure with source=capture and server now",
          'kind: "impulse_failure"' in fn_src and "source: body.capture" in fn_src
          and "logged_at: loggedAt" in fn_src)
    check("the ack is {doing_id}", "return json({ doing_id: doingId })" in fn_src)
    check("the candor credit runs after the row is committed",
          fn_src.find("const doingId = inserted[0].id") < fn_src.find("applyImpulseCandorCredit("))
    check("no server dedupe: one doings insert and no pre-read",
          fn_src.count('from("doings_logs")') == 1
          and 'from("doings_logs")' in fn_src
          and fn_src.find('from("doings_logs")') < fn_src.find(".insert("))
    check("a failed credit never loses the impulse", "catch (err)" in fn_src
          and "candor credit failed" in fn_src)
    check("log-impulse imports no provider",
          "llm/" not in fn_src and "gemini" not in fn_src.lower()
          and "groq" not in fn_src.lower())

    # -- the candor credit's pure + applied halves
    check("the pure cap is the first three per day",
          "export function impulseCandorCredit(" in rider_src
          and "creditsAlreadyToday" in rider_src)
    check("the applied credit is the rider's write",
          "export async function applyImpulseCandorCredit(" in apply_src
          and 'kind", "impulse_failure"' in apply_src
          and 'reason: "openness"' in apply_src)
    check("the applied credit counts the committed row (credits - 1)",
          "impulseCandorCredit(creditsToday - 1)" in apply_src)

    # -- the histogram runner
    check("runHistogram has two legs", "export async function runHistogramRebuild(" in hist_src
          and "export async function runHistogramFire(" in hist_src
          and "export async function runHistogram(" in hist_src)
    check("the rebuild reads histogram_window_days + histogram_bucket_min_count",
          'getConfigNumber("histogram_window_days")' in hist_src
          and 'getConfigNumber("histogram_bucket_min_count")' in hist_src)
    check("the rebuild cold-starts below the minimum", "total < config.minCount" in hist_src
          and 'skipped: "cold_start"' in hist_src)
    check("qualifying buckets are capped at top-2",
          "const FIRE_CAP = 2;" in hist_src
          and "qualifyingBuckets(buckets, config.minCount, FIRE_CAP)" in hist_src)
    check("fire jobs are self-inserted at bucket-start minus the lead",
          'getConfigNumber("preemptive_lead_minutes")' in hist_src
          and "fireTime(bucket.hour, config.leadMinutes, computedFor)" in hist_src)
    check("a fire time already passed is skipped", "at <= nowMs" in hist_src
          and "past += 1" in hist_src)
    check("the fire dedupe ignores status",
          'eq("type", "histogram_daily")' in hist_src
          and 'eq("payload->>leg", "fire")' in hist_src
          and 'eq("payload->>computed_for", args.computedFor)' in hist_src
          and 'eq("payload->>bucket_hour"' in hist_src
          and 'eq("status"' not in hist_src.split("async function fireJobExists")[1].split("async function")[0])
    check("the fire leg rotates high_dopamine_activities",
          "rotateActivity(activitiesOf(profile.high_dopamine_activities), dayOrdinal(computedFor))" in hist_src)
    check("the empty list degrades to the generic text",
          "rotateActivity(" in hist_src and "preemptiveText(activity" in hist_src)
    check("the preemptive text is in-code (no model)",
          "preemptiveText" in hist_src and "llm/" not in hist_src
          and "gemini" not in hist_src.lower() and "groq" not in hist_src.lower()
          and "embed(" not in hist_src and "generate(" not in hist_src
          and "fetch(" not in hist_src)
    check("the fire row is unprompted and preemptive-stamped",
          "deliverIntervention({" in hist_src
          and 'source: "preemptive_block"' in hist_src
          and "bucket: bucketHour" in hist_src
          and "activity: activity" in hist_src
          and "computed_for: computedFor" in hist_src)
    check("the fire push deep-links focus=alternative",
          'const DEEP_LINK = "davos://chat?focus=alternative";' in hist_src
          and "deepLink: DEEP_LINK" in hist_src
          and "args.deepLink ?? \"davos://chat\"" in read("supabase/functions/_shared/checkin/runWatchdog.ts")
          and "createAiMessagePushPayload(args.userId, args.content, link)" in read("supabase/functions/_shared/checkin/runWatchdog.ts"))
    check("one structured [histogram] tag", '"[histogram]"' in hist_src)
    check("the fire leg's only external call is the push",
          hist_src.count("deliverIntervention({") == 1
          and "sendPush" not in hist_src and "exp.host" not in hist_src)
    check("the runner is idempotent on the written row",
          "findPreemptiveMessage({" in hist_src and 'status: "duplicate"' in hist_src)

    # -- pure histogram rules (Step 2 floor)
    check("the pure module owns the cap and the fire-time arithmetic",
          "export function qualifyingBuckets(" in pure_src
          and "slice(0, Math.round(cap))" in pure_src
          and "export function fireTime(" in pure_src)
    check("the pure module returns null for an empty activity list",
          "if (!Array.isArray(activities) || activities.length === 0) return null;" in pure_src)

    # -- dispatcher + FAST exclusion
    check("the dispatcher registers histogram_daily", "histogram_daily: async (payload)" in dispatch_src)
    check("the dispatcher drives the shared runner",
          "await runHistogram(payload)" in dispatch_src)
    fast_block = re.search(r"FAST_JOB_TYPES\s*=\s*new Set\((\[[^\]]*\])", dispatch_src)
    check("histogram_daily is NOT in FAST_JOB_TYPES",
          bool(fast_block) and "histogram_daily" not in fast_block.group(1)
          and "strike_fire" not in fast_block.group(1))

    # -- dev-smoke leg
    check("drift-drill gained the histogram leg",
          'leg === "histogram"' in smoke_src
          and "await runHistogramRebuild({" in smoke_src
          and 'computed_for' in smoke_src)

    # -- client surfaces
    check("the Android notification is sticky and app-state driven",
          "sticky: true" in client_src and "autoDismiss: false" in client_src
          and "handleAppStateChange" in client_src
          and "state === \"active\"" in client_src)
    check("the notification rides a dedicated channel + category",
          'const IMPULSE_CHANNEL_ID = "impulse_v1";' in client_src
          and 'const IMPULSE_CATEGORY_ID = "impulse_lost";' in client_src)
    check("the quick action posts capture=quick_action",
          'logImpulse("quick_action")' in client_src)
    check("the in-app button is not Platform-gated",
          "Platform.OS !== \"android\"" in client_src
          and ("logImpulse(\"app\")" in chat_src or "logImpulse('app')" in chat_src))
    check("the client uses logger + traceNetworkCall, zero raw console",
          "logger" in client_src and 'traceNetworkCall("chat", "log-impulse"' in client_src
          and "console." not in client_src and "console." not in button_src
          and "console." not in chat_src)
    check("the app layout arms the persistent surface",
          "armImpulseNotification(userId)" in layout_src
          and "disarmImpulseNotification()" in layout_src)
    check("the button state is a pure jest module",
          "nextImpulseState" in button_src and "nextImpulseState" in button_test)
    check("chat handles focus=alternative by scrolling to the preemptive row",
          "focusParam !== 'alternative'" in chat_src
          and "metadata?.source === 'preemptive_block'" in chat_src
          and "scrollToIndex" in chat_src
          and "onScrollToIndexFailed" in chat_src)

    # -- client dependency discipline
    check("no headless-task dependency was added",
          "expo-task-manager" not in pkg_src)
    rc, out = git(["diff", "--cached", "--name-only", "--", "package.json", "package-lock.json"])
    check("package.json / package-lock.json are not staged", rc == 0 and out.strip() == "",
          out.strip())

    # -- docs
    check("TECH-SPEC records the histogram build", "As built (FP-08 Step 8)" in tech_src)
    check("TECH-SPEC's registry count is fourteen of fifteen",
          "fifteen** with dispatcher handlers" not in tech_src
          and "14 of 15" not in tech_src
          and "fourteen** with dispatcher handlers" in tech_src)
    check("GLOSSARY records log-impulse, the candor credit, and the histogram runner",
          "`log-impulse`" in glos_src and "`applyImpulseCandorCredit`" in glos_src
          and "`runHistogram`" in glos_src and "preemptive_block" in glos_src)
    check("GLOSSARY records the client surfaces + deep link",
          "`armImpulseNotification`" in glos_src
          and "`lib/impulseButton.ts`" in glos_src
          and "`davos://chat?focus=alternative` (client handler)" in glos_src)
    check("the PLAN tracker marks Step 8 done",
          "| 8 | Interception: `log-impulse` + client surfaces + `histogram_daily` | ✅ |" in plan_src)

    # -- zero FP-07 edits
    rc, out = git(["diff", "--name-only", "HEAD", "--"] + FP07_PATHS)
    check("git diff proves zero FP-07 file edits", rc == 0 and out.strip() == "", out.strip())


def toolchain_checks():
    print("== B. toolchain + earlier gates ==")
    if not os.path.exists(os.path.join(ROOT, "node_modules")):
        skip("tsc/jest", "node_modules missing")
    else:
        rc, out = run(["cmd", "/c", "npx", "tsc", "--noEmit"])
        check("tsc --noEmit is clean", rc == 0, out[-1500:])
        rc, out = run(["cmd", "/c", "npx", "jest", "--ci"])
        check("the full jest suite is green", rc == 0, out[-1500:])
        match = re.search(r"Tests:\s+(\d+) passed, (\d+) total", out)
        check("jest ran the whole suite", bool(match) and int(match.group(1)) >= 720,
              match.group(0) if match else "no summary")

    rc, out = run(["cmd", "/c", "deno", "check",
                   HIST, HIST_PURE, TEMPLATES, RIDER, APPLY, IMPULSE_FN, DISPATCH, SMOKE])
    check("deno check is clean over the new/wired files", rc == 0, out[-1500:])

    for label, args in (
        ("FP-03 step 7 static", ["python", "scripts/verify-fp03-step7.py", "--static-only", "--no-jest", "--no-fp02"]),
        ("FP-04 step 6 static", ["python", "scripts/verify-fp04-step6.py", "--static-only", "--no-tsc", "--no-deno"]),
        ("FP-05 step 3 static", ["python", "scripts/verify-fp05-step3.py", "--static-only"]),
    ):
        rc, out = run(args)
        check(f"{label} is green", rc == 0, out[-1800:])


# ---------------------------------------------------------------------------
# C. live
# ---------------------------------------------------------------------------


def live_setup():
    load_dotenv()
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    smoke_token = os.environ.get("DEV_SMOKE_TOKEN")
    if not url or not service or not anon or not smoke_token:
        sys.exit("need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEV_SMOKE_TOKEN")
    LIVE.update({"url": url, "service": service, "anon": anon, "smoke": smoke_token,
                 "users": [], "jwt": None})


def create_fixture(activities):
    email = f"fp08-step8-{uuid.uuid4().hex[:10]}@example.com"
    password = uuid.uuid4().hex + "Aa1!"
    status, body = req("POST", "/auth/v1/admin/users", {
        "email": email, "password": password, "email_confirm": True,
    }, token=LIVE["service"], key=LIVE["service"])
    if status not in (200, 201) or not isinstance(body, dict) or not body.get("id"):
        raise RuntimeError(f"admin createUser failed: {status} {body}")
    uid = body["id"]
    LIVE["users"].append(uid)
    for _ in range(20):
        if one(f"/profiles?select=id&id=eq.{uid}"):
            break
        time.sleep(0.25)
    status, body = rest("PATCH", f"/profiles?id=eq.{uid}", {
        "timezone": "UTC",
        "trust_score": 0,
        "high_dopamine_activities": activities,
    }, prefer="return=minimal")
    if status not in (200, 204):
        raise RuntimeError(f"profile patch failed: {status} {body}")

    status, body = req("POST", "/auth/v1/token?grant_type=password",
                       {"email": email, "password": password}, key=LIVE["anon"])
    if status != 200 or not isinstance(body, dict) or not body.get("access_token"):
        raise RuntimeError(f"password grant failed: {status} {body}")
    LIVE["jwt"] = body["access_token"]
    return uid


def clear_impulses(uid):
    rest("DELETE", f"/doings_logs?user_id=eq.{uid}&kind=eq.impulse_failure",
         prefer="return=minimal")


def clear_jobs(uid):
    rest("DELETE", f"/jobs?payload->>user_id=eq.{uid}", prefer="return=minimal")


def clear_preemptive(uid):
    rest("DELETE", f"/messages?user_id=eq.{uid}&metadata->>source=eq.preemptive_block",
         prefer="return=minimal")


def seed_impulses(uid, end_day, hour, count):
    for offset in range(count):
        day = end_day - timedelta(days=offset)
        iso = f"{day.isoformat()}T{hour:02d}:00:00Z"
        st, body = rest("POST", "/doings_logs", {
            "user_id": uid,
            "kind": "impulse_failure",
            "source": "app",
            "logged_at": iso,
        })
        if st not in (200, 201):
            raise RuntimeError(f"impulse seed failed: {st} {body}")


def rebuild(uid, computed_for):
    status, body = smoke(urllib.parse.urlencode({
        "action": "drift-drill", "leg": "histogram", "user": uid,
        "computed_for": computed_for,
    }))
    if status != 200:
        raise RuntimeError(f"drift-drill histogram -> {status}: {body}")
    return ((body or {}).get("report") or {})


def force_next(job_id):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
    rest("PATCH", f"/jobs?id=eq.{job_id}", {"next_retry_at": past}, prefer="return=minimal")


def dispatch():
    status, body = req("POST", "/functions/v1/job-dispatcher", {},
                       token=LIVE["service"], key=LIVE["service"])
    if status != 200:
        raise RuntimeError(f"job-dispatcher -> {status}: {body}")


def job_row(job_id):
    return one(f"/jobs?select=id,status,attempts,next_retry_at,payload&id=eq.{job_id}")


def preemptive_rows(uid):
    return rows(f"/messages?select=id,content,metadata,reply_to_message_id&user_id=eq.{uid}"
                f"&metadata->>source=eq.preemptive_block")


def preemptive_text(activity, hour, lead):
    window = f"{hour:02d}:00"
    if activity:
        return (f"Danger window at {window}. {lead} minutes before it starts: do {activity} "
                "instead. One swap, nothing more.")
    return (f"Danger window at {window}. {lead} minutes before it starts, pick one alternative "
            "you can begin right now — the point is to break the pattern before it starts, "
            "not to win the day.")


def rotation(activities, day):
    ordinal = (day - date(1970, 1, 1)).days
    return activities[ordinal % len(activities)] if activities else None


def live_checks():
    print("== C. live: fixture ==")
    activities = ["walk the block", "stretch"]
    uid = create_fixture(activities)
    max_chars = int(get_config("chat_max_message_chars") or 4000)

    print("== D. live: log-impulse from both captures + the candor cap ==")
    status, body = fn_post("log-impulse", {"capture": "app"}, token=LIVE["jwt"])
    check("an app log returns 200 + doing_id",
          status == 200 and isinstance(body, dict) and bool(body.get("doing_id")),
          f"{status} {body}")
    check("the ack carries only doing_id", isinstance(body, dict) and set(body) == {"doing_id"},
          str(body))
    app_row = one(f"/doings_logs?select=id,kind,source,content,logged_at&id=eq.{body.get('doing_id')}") if body else None
    check("the app row is an impulse_failure from app with server now",
          bool(app_row) and app_row.get("kind") == "impulse_failure"
          and app_row.get("source") == "app" and app_row.get("content") is None,
          str(app_row))

    status, body = fn_post("log-impulse", {"capture": "quick_action", "content": "  scroll  "},
                           token=LIVE["jwt"])
    quick_id = (body or {}).get("doing_id")
    quick_row = one(f"/doings_logs?select=id,source,content&id=eq.{quick_id}") if quick_id else None
    check("a quick_action log stores the trimmed content",
          status == 200 and bool(quick_row) and quick_row.get("source") == "quick_action"
          and quick_row.get("content") == "scroll", str(quick_row))

    status, _ = fn_post("log-impulse", {"capture": "wat"}, token=LIVE["jwt"])
    check("an unknown capture is a 400", status == 400, str(status))

    status, _ = fn_post("log-impulse", {"capture": "app", "content": "x" * (max_chars + 1)},
                        token=LIVE["jwt"])
    check("content above chat_max_message_chars is a 400", status == 400, str(status))

    status, _ = req("POST", "/functions/v1/log-impulse", {"capture": "app"}, key=LIVE["anon"])
    check("an unauthenticated log is rejected", status in (401, 403), str(status))

    # Two more good logs: four total in the local day. Only the first three earn candor.
    status, body = fn_post("log-impulse", {"capture": "app", "content": "same text"}, token=LIVE["jwt"])
    status2, body2 = fn_post("log-impulse", {"capture": "app", "content": "same text"}, token=LIVE["jwt"])
    check("no server dedupe: the same content logs twice",
          status == 200 and status2 == 200 and body.get("doing_id") != body2.get("doing_id"),
          f"{status}/{status2} {body}/{body2}")
    all_rows = rows(f"/doings_logs?select=id&user_id=eq.{uid}&kind=eq.impulse_failure")
    check("four impulses are on the record", len(all_rows) == 4, str(len(all_rows)))
    events = rows(f"/trust_events?select=delta,reason&user_id=eq.{uid}&reason=eq.openness")
    check("the first three earn one openness credit each", len(events) == 3
          and all(e.get("delta") == 1 for e in events), str(events))
    profile = one(f"/profiles?select=trust_score&id=eq.{uid}")
    check("the fourth earns nothing (trust stays 3)", (profile or {}).get("trust_score") == 3,
          str(profile))

    print("== E. live: 14 in one hour -> one fire 15 min before ==")
    clear_impulses(uid)
    clear_jobs(uid)
    today = datetime.now(timezone.utc).date()
    d1 = today + timedelta(days=1)
    seed_impulses(uid, d1, 20, 14)
    report = rebuild(uid, d1.isoformat())
    check("the rebuild reports one qualifying bucket",
          [b.get("hour") for b in report.get("qualifying", [])] == [20], str(report)[:500])
    check("only one fire is scheduled", len(report.get("scheduled", [])) == 1,
          str(report)[:500])
    job = report["scheduled"][0] if report.get("scheduled") else {}
    expected_fire = f"{d1.isoformat()}T19:45:00+00:00"
    try:
        fire_at = datetime.fromisoformat(str(job.get("fire_at")).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        fire_at = None
    check("the fire time is bucket-start minus 15 minutes",
          fire_at is not None and fire_at.isoformat() == expected_fire,
          f"{job.get('fire_at')} vs {expected_fire}")
    job_db = job_row(job.get("job_id")) if job.get("job_id") else None
    check("the fire job is a histogram_daily fire leg",
          bool(job_db) and (job_db.get("payload") or {}).get("leg") == "fire"
          and (job_db.get("payload") or {}).get("bucket_hour") == 20,
          str(job_db)[:500])
    try:
        retry_at = datetime.fromisoformat(str(job_db.get("next_retry_at")).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        retry_at = None
    check("next_retry_at equals the fire instant",
          retry_at is not None and fire_at is not None and retry_at == fire_at,
          f"{job_db.get('next_retry_at')} vs {job.get('fire_at')}")

    again = rebuild(uid, d1.isoformat())
    check("a second rebuild schedules nothing (any-status dedupe)",
          again.get("scheduled") == [], str(again)[:400])

    print("== F. live: force-fire -> deterministic text + row ==")
    force_next(job["job_id"])
    dispatch()
    job_db = job_row(job["job_id"]) or {}
    check("the fire job completes", job_db.get("status") == "done", str(job_db)[:300])
    seen = preemptive_rows(uid)
    check("exactly one preemptive row lands", len(seen) == 1, str(seen)[:400])
    row = seen[0] if seen else {}
    activity = rotation(activities, d1)
    expected_text = preemptive_text(activity, 20, 15)
    check("the text is the deterministic in-code text",
          row.get("content") == expected_text, str(row.get("content"))[:400])
    check("the row is unprompted", row.get("reply_to_message_id") is None, str(row)[:300])
    meta = row.get("metadata") or {}
    check("the metadata carries source/bucket/activity/computed_for",
          meta.get("source") == "preemptive_block" and meta.get("bucket") == 20
          and meta.get("activity") == activity and meta.get("computed_for") == d1.isoformat(),
          str(meta)[:500])

    # Re-claim the settled row: the message dedupe returns duplicate and writes nothing.
    rest("PATCH", f"/jobs?id=eq.{job['job_id']}", {
        "status": "pending", "attempts": 0, "next_retry_at": "2000-01-01T00:00:00Z",
    }, prefer="return=minimal")
    dispatch()
    check("a re-fire writes no second preemptive row", len(preemptive_rows(uid)) == 1,
          str(len(preemptive_rows(uid))))

    print("== G. live: empty activities -> the generic text ==")
    rest("PATCH", f"/profiles?id=eq.{uid}", {"high_dopamine_activities": []},
         prefer="return=minimal")
    clear_jobs(uid)
    d2 = d1 + timedelta(days=1)
    report = rebuild(uid, d2.isoformat())
    check("the generic scenario still schedules one fire",
          len(report.get("scheduled", [])) == 1, str(report)[:400])
    job2 = report["scheduled"][0] if report.get("scheduled") else {}
    force_next(job2["job_id"])
    dispatch()
    generic = [r for r in preemptive_rows(uid) if (r.get("metadata") or {}).get("computed_for") == d2.isoformat()]
    check("the generic row lands", len(generic) == 1, str(generic)[:300])
    generic_row = generic[0] if generic else {}
    check("the generic text names no activity and offers an alternative",
          generic_row.get("content") == preemptive_text(None, 20, 15)
          and "pick one alternative" in (generic_row.get("content") or ""),
          str(generic_row.get("content"))[:400])
    check("the generic metadata has activity=null",
          (generic_row.get("metadata") or {}).get("activity") is None,
          str(generic_row.get("metadata"))[:300])

    print("== H. live: cold start + the boundary at 3 ==")
    clear_jobs(uid)
    clear_impulses(uid)
    d3 = d2 + timedelta(days=1)
    seed_impulses(uid, d3, 20, 2)
    report = rebuild(uid, d3.isoformat())
    check("two failures are cold start", report.get("skipped") == "cold_start"
          and report.get("scheduled") == [], str(report)[:400])
    seed_impulses(uid, d3, 20, 1)
    clear_jobs(uid)
    d4 = d3 + timedelta(days=1)
    report = rebuild(uid, d4.isoformat())
    check("three failures cross the boundary", len(report.get("scheduled", [])) == 1,
          str(report)[:400])

    print("== I. live: top-2 across three clusters ==")
    clear_jobs(uid)
    clear_impulses(uid)
    d5 = d4 + timedelta(days=1)
    seed_impulses(uid, d5, 20, 14)
    seed_impulses(uid, d5, 7, 5)
    seed_impulses(uid, d5, 12, 4)
    report = rebuild(uid, d5.isoformat())
    scheduled_hours = [s.get("bucket_hour") for s in report.get("scheduled", [])]
    check("exactly two fires are scheduled", len(scheduled_hours) == 2, str(report)[:600])
    check("the top-2 are the highest counts (20 then 7)",
          scheduled_hours == [20, 7], str(scheduled_hours))
    bucket_12 = [b for b in report.get("buckets", []) if b.get("hour") == 12]
    check("the third cluster is counted but not fired",
          bucket_12 and bucket_12[0].get("count") == 4, str(bucket_12))

    print("== J. live: a past computed_for schedules nothing ==")
    past_day = today - timedelta(days=1)
    report = rebuild(uid, past_day.isoformat())
    check("a past bucket is skipped", report.get("scheduled") == []
          and int(report.get("past") or 0) >= 1, str(report)[:500])


def cleanup(verbose=False):
    if not LIVE.get("url"):
        return
    for uid in list(LIVE.get("users") or []):
        rest("DELETE", f"/jobs?payload->>user_id=eq.{uid}", prefer="return=minimal")
        req("DELETE", f"/auth/v1/admin/users/{uid}", token=LIVE["service"], key=LIVE["service"])

    if verbose:
        leftovers = []
        for uid in LIVE.get("users") or []:
            if one(f"/profiles?select=id&id=eq.{uid}"):
                leftovers.append(uid)
        check("cleanup removes every fixture user", not leftovers, str(leftovers))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true", help="skip the network legs")
    ap.add_argument("--no-toolchain", action="store_true", help="skip tsc/jest/deno/earlier gates")
    args = ap.parse_args()

    print("== FP-08 Step 8: interception ==")
    static_checks()
    if not args.no_toolchain:
        toolchain_checks()

    if not args.static_only:
        print("== C. live == ")
        live_setup()
        try:
            live_checks()
        finally:
            cleanup(verbose=True)
        print("  NOTE web drill: the button + focus=alternative are structurally verified here; "
              "the visible browser pass and the Android backgrounded quick action are OWNER MANUAL.")

    print()
    if FAILS:
        print(f"FAILED ({len(FAILS)}): " + "; ".join(FAILS))
        sys.exit(1)
    print("ALL PASS")


if __name__ == "__main__":
    main()
