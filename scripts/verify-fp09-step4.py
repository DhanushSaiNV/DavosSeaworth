#!/usr/bin/env python3
"""FP-09 Step 4 gate -- `select-metrics`, the chat chips, the interview route and the
app-shell route gate.

Refs: FP-09 FR-7, FR-8, FR-9, FR-10; TECH-SPEC §5.3, §7.7, §7.9, §9; D10, D17;
PRD §3.5, §4.1.

Static
  select-metrics : sync, zero providers; the 400/404 table; the stage guard; the gate-before-
                   persist insert; rows before the compare-and-set; duplicate at complete
  no bypass      : no `metrics` insert outside `insertValidatedMetric`
  scope          : package.json unchanged; the enumerated client touch set is the whole
                   client diff; no FP-07 file, migration or SQL file changes
  gate           : `(app)` reads the stage first; `AppTabs` (scheduler/push/impulse) mounts
                   only on a resolved `complete`; a read failure shows retry, never tabs
  interview      : the same `ChatScreen` in mode `interview`; no app-only surfaces; five-step
                   indicator; focus-time completion redirect; device-TZ mount sync
  chips          : row-derived `metric_options`; multi-select 1-2 + Confirm; settled names
  toolchain      : tsc, deno check, jest, eslint (optional --no-toolchain)

Live (network; skipped by --static-only)
  setup          : a fresh user at `intro`; a second user for the foreign-message case
  proposal       : force to `routine`, answer the boundary, three deterministic chips with
                   the most frequent classified domain at the top
  re-offer       : a metric_selection free-text turn returns the identical list
  table          : malformed body / keys, unknown and foreign ids, non-assistant row, row
                   without options, keys outside the options
  confirm        : two `is_core` rows through the gate, stage `complete`, `{status:'ok'}`
  dashboard      : the user-RLS read returns both rows; the FP-07 files are untouched
  eval           : the next metric_eval tick qualifies the user and the forced leg lands
                   points for both metrics
  retry          : a second confirm returns `duplicate`; a one-row state re-confirms without
                   duplicating the surviving row
  guard          : an earlier stage is 409
  routing        : fresh -> interview, complete -> app; the deep-link bounce is asserted
                   structurally (the `(app)` gate precedes `AppTabs`)

Owner-manual (reported, never claimed):
  * the web/device click drill (chips, indicator, redirect)
  * `profiles.timezone` after a real client mount equal to the device zone

Usage: python scripts/verify-fp09-step4.py [--static-only] [--no-toolchain]
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []
SKIPS = []
LIVE = {}

SELECT_METRICS = "supabase/functions/select-metrics/index.ts"
CHAT = "app/(app)/chat.tsx"
APP_LAYOUT = "app/(app)/_layout.tsx"
INTERVIEW = "app/(onboarding)/interview.tsx"
ONBOARDING_LAYOUT = "app/(onboarding)/_layout.tsx"
PURE = "lib/onboarding.ts"
STAGE = "lib/onboardingStage.ts"
CHAT_LIB = "lib/chat.ts"
CHECKINS = "lib/checkins.ts"

CLIENT_TOUCH_SET = {
    CHAT,
    APP_LAYOUT,
    INTERVIEW,
    ONBOARDING_LAYOUT,
    "lib/chat.test.ts",
    CHAT_LIB,
    CHECKINS,
    PURE,
    "lib/onboarding.test.ts",
    STAGE,
}

ALLOWED_TOUCH_SET = CLIENT_TOUCH_SET | {
    SELECT_METRICS,
    "scripts/verify-fp09-step4.py",
    "docs/TECH-SPEC.md",
    "docs/GLOSSARY.md",
}

FP07_FILES = {
    "app/(app)/dashboard.tsx",
    "lib/metricsData.ts",
    "components/metrics/ConsistencyHeatmap.tsx",
    "components/metrics/ProgressBar.tsx",
    "components/metrics/StatCard.tsx",
    "components/metrics/TrendLineGraph.tsx",
}


def read(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def check(label, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + label +
          (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(label)


def skip(label, why):
    print(f"  SKIP {label} ({why})")
    SKIPS.append(label)


def load_dotenv():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


def run(cmd, timeout=900):
    proc = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def run_stdout(cmd, timeout=120):
    proc = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    return proc.returncode, proc.stdout or ""


# --------------------------------------------------------------------------- REST


def req(method, path, body=None, token=None, key=None, headers=None, timeout=120,
        raw=None):
    h = {"Content-Type": "application/json"}
    if key:
        h["apikey"] = key
    if token:
        h["Authorization"] = f"Bearer {token}"
    if headers:
        h.update(headers)
    if raw is not None:
        data = raw.encode()
    else:
        data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(LIVE["url"] + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            text = resp.read().decode()
            return resp.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as exc:
        text = exc.read().decode()
        try:
            return exc.code, json.loads(text)
        except Exception:  # noqa: BLE001
            return exc.code, {"raw": text[:400]}


def service_req(method, path, body=None, prefer=None):
    headers = {"Prefer": prefer} if prefer else None
    return req(method, "/rest/v1" + path, body, token=LIVE["service"], key=LIVE["service"],
               headers=headers)


def user_req(method, path, token=None, body=None):
    return req(method, "/rest/v1" + path, body, token=token or LIVE["jwt"],
               key=LIVE["anon"])


def rows(path):
    status, body = service_req("GET", path)
    if status != 200:
        raise RuntimeError(f"GET {path} -> {status}: {body}")
    return body if isinstance(body, list) else []


def one(path):
    found = rows(path)
    return found[0] if found else None


def insert(table, payload):
    status, body = service_req("POST", f"/{table}", payload, prefer="return=representation")
    if status not in (200, 201, 204):
        raise RuntimeError(f"POST {table} -> {status}: {body}")
    return body


def patch(path, payload):
    status, body = service_req("PATCH", path, payload, prefer="return=representation")
    if status not in (200, 204):
        raise RuntimeError(f"PATCH {path} -> {status}: {body}")
    return body


def delete(path):
    status, body = service_req("DELETE", path)
    if status not in (200, 204):
        raise RuntimeError(f"DELETE {path} -> {status}: {body}")
    return body


def rpc(name, payload):
    return req("POST", f"/rest/v1/rpc/{name}", payload, token=LIVE["service"],
               key=LIVE["service"])


def config_value(key):
    row = one(f"/config?select=key,value&key=eq.{key}")
    return row["value"] if row else None


def set_config(key, value):
    patch(f"/config?key=eq.{key}", {"value": value})


def make_user(tag):
    email = f"{tag}-{uuid.uuid4().hex[:12]}@example.com"
    password = uuid.uuid4().hex + "Aa1!"
    status, created = req("POST", "/auth/v1/admin/users",
                          {"email": email, "password": password, "email_confirm": True},
                          token=LIVE["service"], key=LIVE["service"])
    if status not in (200, 201) or not isinstance(created, dict) or not created.get("id"):
        raise RuntimeError(f"could not create temp user: {status} {created}")
    uid = created["id"]
    for _ in range(40):
        if rows(f"/profiles?select=id&id=eq.{uid}"):
            break
        time.sleep(0.25)
    else:
        raise RuntimeError("temp profile not created by trigger")
    for _ in range(40):
        if rows(f"/messages?select=id&user_id=eq.{uid}"
                "&metadata->>source=eq.onboarding_opening"):
            break
        time.sleep(0.25)

    status, session = req("POST", "/auth/v1/token?grant_type=password",
                          {"email": email, "password": password}, key=LIVE["anon"])
    if status != 200 or not isinstance(session, dict) or not session.get("access_token"):
        raise RuntimeError(f"could not sign in temp user: {status} {session}")
    return uid, session["access_token"]


def drop_user(uid):
    try:
        delete(f"/jobs?payload->>user_id=eq.{uid}")
    except Exception as exc:  # noqa: BLE001
        print(f"  (job cleanup warning for {uid}: {exc})")
    req("DELETE", f"/auth/v1/admin/users/{uid}", token=LIVE["service"], key=LIVE["service"])


def send(content, client_id=None):
    cid = client_id or str(uuid.uuid4())
    status, body = req("POST", "/functions/v1/send-message",
                       {"content": content, "client_message_id": cid,
                        "client_sent_at": datetime.now(timezone.utc).isoformat()},
                       token=LIVE["jwt"], key=LIVE["anon"])
    return cid, status, body


def smoke(query):
    return req("POST", "/functions/v1/dev-smoke?" + query, token=LIVE["smoke"],
               key=LIVE["smoke"])


def select_metrics(message_id, keys, token=None):
    return req("POST", "/functions/v1/select-metrics",
               {"message_id": message_id, "keys": keys},
               token=token or LIVE["jwt"], key=LIVE["anon"])


def message(message_id):
    return one("/messages?select=id,role,content,metadata,reply_to_message_id,persona_key"
               f"&id=eq.{message_id}")


def profile():
    return one("/profiles?select=id,onboarding_stage,wake_time,sleep_time,routine,"
               "high_dopamine_activities,timezone,trust_score,dialog_state"
               f"&id=eq.{LIVE['uid']}")


def metric_rows(user_id=None, ids=None):
    path = ("/metrics?select=id,name,domain,output_unit,formula,formula_status,is_core,"
            "is_quest,archived_at,created_at&order=created_at")
    if user_id:
        path += f"&user_id=eq.{user_id}"
    if ids:
        path += f"&id=in.({','.join(ids)})"
    return rows(path)


def onboarding_rows(role=None, stage=None):
    q = ("/messages?select=id,role,content,metadata,reply_to_message_id,persona_key"
         f"&user_id=eq.{LIVE['uid']}&metadata->>source=eq.onboarding")
    if role:
        q += f"&role=eq.{role}"
    if stage:
        q += f"&metadata->>onboarding_stage=eq.{stage}"
    return rows(q)


def opening_row(user_id):
    found = rows("/messages?select=id,role,metadata&user_id=eq."
                 f"{user_id}&metadata->>source=eq.onboarding_opening")
    return found[0] if found else None


# --------------------------------------------------------------------------- static


STEP3_BASE = "0565f0e"
STEP4_COMMIT = "f76c874"


def git_paths():
    # Pin the historical touch set to the Step 4 commit. A base-relative diff would pick
    # up every later FP-09 step and turn this into a branch-wide check.
    rc, diff = run_stdout(f"git diff --name-only {STEP3_BASE} {STEP4_COMMIT}")
    if rc != 0:
        raise RuntimeError(diff)
    return sorted({p.strip() for p in diff.splitlines() if p.strip()})


def static_checks():
    print("== A. static: select-metrics contract ==")
    src = read(SELECT_METRICS)
    check("select-metrics exists", bool(src))
    check("resolves the caller through the shared auth helper",
          "resolveUserId(req)" in src and "auth.userId" in src)
    check("validates message_id as a uuid", "UUID_RE.test(messageId)" in src)
    check("rejects malformed bodies and 1-2 unique keys",
          "Invalid JSON body" in src and "keys must be 1–2 unique non-empty strings" in src
          and "raw.length < 1 || raw.length > 2" in src and "keys.includes(key)" in src)
    check("scopes the proposal row to the caller",
          '.eq("id", messageId)' in src and '.eq("user_id", userId)' in src)
    check("rejects non-assistant rows", 'option.role !== "assistant"' in src)
    check("requires exactly three stored chips",
          "raw.length !== 3" in src and "message carries no metric options" in src)
    check("requires keys to be a subset of that row's options",
          "keys must be a subset of this message's metric options" in src
          and "offered.has(key)" in src)
    check("unknown/foreign ids are 404", 'json({ error: "message not found" }, 404)' in src)
    check("the stage guard accepts metric_selection and the routine advance race",
          'new Set(["metric_selection", "routine"])' in src
          and "onboarding is not at metric selection" in src
          and "}, 409)" in src)
    check("complete is a duplicate no-op returning existing rows",
          'stage === "complete"' in src and 'status: "duplicate"' in src
          and "metric_ids: orderedIds(keys, existing)" in src)
    check("reuses active core rows by preset name before inserting",
          '.eq("is_core", true)' in src and '.is("archived_at", null)' in src
          and '.in("name", keys)' in src and "existing.get(key)" in src)
    check("every missing row goes through the gate-before-persist helper",
          "insertValidatedMetric(" in src and "formula: preset.formula" in src
          and "is_core: true" in src)
    check("no direct metrics insert in select-metrics",
          not re.search(r'\.from\("metrics"\)\s*\.insert', src))
    check("rows land before the compare-and-set",
          src.index("insertValidatedMetric(") < src.index("advanceOnboardingStage("))
    check("the stage compare-and-set is from the read stage to complete",
          "from: stage as" in src and 'to: "complete"' in src)
    check("a lost race re-reads and returns duplicate or 409",
          "winnerStage === \"complete\"" in src
          and "onboarding stage changed during selection" in src)
    check("zero provider imports in the function",
          not re.search(r'_shared/(llm|providers)|llm/adapter', src))
    check("success returns status ok + metric_ids",
          'return json({ status: "ok", metric_ids: metricIds })' in src)

    print("\n== B. static: no metric-write bypass ==")
    offenders = []
    for base, _, files in os.walk(os.path.join(ROOT, "supabase/functions")):
        for name in files:
            if not name.endswith(".ts"):
                continue
            path = os.path.join(base, name)
            text = open(path, encoding="utf-8", errors="replace").read()
            if re.search(r'\.from\("metrics"\)\s*\.(insert|upsert)', text):
                rel = os.path.relpath(path, ROOT).replace("\\", "/")
                if rel != "supabase/functions/_shared/metrics/create.ts":
                    offenders.append(rel)
    check("metrics inserts exist only in insertValidatedMetric",
          not offenders, repr(offenders))

    print("\n== C. static: scope and touch set ==")
    paths = git_paths()
    check("no migration or SQL file is added", not any(p.endswith(".sql") for p in paths),
          repr([p for p in paths if p.endswith(".sql")]))
    check("no FP-07 file is touched",
          not any(p in FP07_FILES for p in paths),
          repr([p for p in paths if p in FP07_FILES]))
    extra = [p for p in paths if p not in ALLOWED_TOUCH_SET]
    check("the enumerated touch set is the whole diff", not extra, repr(extra))
    missing_client = [p for p in CLIENT_TOUCH_SET if p not in paths]
    check("every planned client file is in the diff", not missing_client, repr(missing_client))
    rc, diff = run(f"git diff --quiet {STEP3_BASE} {STEP4_COMMIT} -- package.json package-lock.json")
    check("package.json and package-lock.json are unchanged", rc == 0, diff[-300:])

    print("\n== D. static: app-shell gate and scheduler ==")
    layout = read(APP_LAYOUT)
    check("the gate reads the profile stage", "readOnboardingStage(userId)" in layout)
    check("the gate redirects every non-complete stage to the interview",
          "next !== 'complete'" in layout
          and "router.replace('/(onboarding)/interview')" in layout)
    check("the gate never mounts tabs on an unknown stage",
          "resolved?.userId !== userId" in layout
          and "resolved.stage !== 'complete'" in layout)
    check("a read failure shows retry, not the tab shell",
          "<ErrorState" in layout and "onboarding stage read failed" in layout)
    check("AppTabs is a separate component mounted only after the gate",
          "function AppTabs()" in layout and "return <AppTabs />;" in layout)
    app_tabs_at = layout.index("function AppTabs()")
    complete_at = layout.index("resolved.stage !== 'complete'")
    return_tabs_at = layout.index("return <AppTabs />;")
    check("the complete check precedes the AppTabs return",
          complete_at < return_tabs_at)
    check("armCheckins lives inside AppTabs",
          "armCheckins(userId)" in layout
          and layout.index("armCheckins(userId)") > app_tabs_at)
    check("push and impulse effects also live inside AppTabs",
          layout.index("registerPushToken(user.id)") > app_tabs_at
          and layout.index("armImpulseNotification(userId)") > app_tabs_at)

    print("\n== E. static: interview route, chips and surfaces ==")
    interview = read(INTERVIEW)
    chat = read(CHAT)
    onboarding_layout = read(ONBOARDING_LAYOUT)
    check("the interview route reuses ChatScreen",
          "import { ChatScreen }" in interview
          and '<ChatScreen mode="interview"' in interview)
    check("completion replaces the route with the app chat",
          "router.replace('/(app)/chat')" in interview)
    check("onboarding loads config and dev overrides without the app shell",
          "loadConfig()" in onboarding_layout and "loadDevOverrides()" in onboarding_layout)
    check("ChatScreen has a named export with a mode prop",
          "export function ChatScreen({ mode = 'app', onComplete }" in chat
          and "export default function ChatRoute()" in chat)
    check("the indicator uses the five-step pure module",
          "ONBOARDING_STEPS.map" in chat and "onboardingStepIndex(indicatorStage)" in chat
          and "onboardingStepLabel(indicatorStage)" in chat)
    check("the interview reads the stage on focus and redirects on complete",
          "interview stage read failed" in chat
          and "if (next === 'complete') onComplete?.()" in chat)
    check("the interview syncs the device timezone on mount",
          "syncDeviceTimezone(userId)" in chat
          and "export async function syncDeviceTimezone" in read(CHECKINS))
    check("check-in, energy and impulse surfaces are guarded by interview mode",
          "!isInterview && bannerWindow" in chat
          and "!isInterview && checkInMode" in chat
          and "!isInterview && energyDoingId" in chat
          and "{!isInterview ? (" in chat)
    check("no tab bar is imported into the interview thread",
          "Tabs" not in chat)
    check("metric chips render from the row metadata",
          "item.metricOptions.map" in chat and "metricOptionsOf(row.metadata)" in read(CHAT_LIB))
    check("Confirm posts keys to select-metrics and settles with names",
          "functions.invoke('select-metrics'" in chat
          and "metricChoiceLabels(options, selected)" in chat
          and "type: 'settle', status, names" in chat)
    check("the pure module pins the routing table and chip reducer",
          "entryRouteForStage" in read(PURE)
          and "metricChipReducer" in read(PURE)
          and "entryRouteForStage" in read("lib/onboarding.test.ts")
          and "multi-toggles up to two keys" in read("lib/onboarding.test.ts"))
    check("the deep-link bounce is structural: every (app) entry passes the gate",
          "router.replace('/(onboarding)/interview')" in layout
          and "return <AppTabs />" in layout)
    raw_console = [p for p in (CLIENT_TOUCH_SET | {ONBOARDING_LAYOUT})
                   if p.endswith((".tsx", ".ts")) and re.search(r"\bconsole\.", read(p))]
    check("client logging uses logger, never raw console", not raw_console, repr(raw_console))

    print("\n== F. static: doc write-backs ==")
    tech = read("docs/TECH-SPEC.md")
    glossary = read("docs/GLOSSARY.md")
    check("TECH-SPEC records the Step 4 as-built", "FP-09 Step 4" in tech
          and "select-metrics" in tech)
    check("GLOSSARY records select-metrics and the client route gate",
          "select-metrics" in glossary and "route gate" in glossary)


# --------------------------------------------------------------------------- toolchain


def toolchain():
    print("\n== G. toolchain ==")
    rc, out = run("npx tsc --noEmit", timeout=900)
    check("tsc --noEmit clean", rc == 0, out[-800:])
    rc, out = run("npx jest --runInBand", timeout=1200)
    check("jest green", rc == 0, out[-1200:])
    rc, out = run("deno check supabase/functions/select-metrics/index.ts", timeout=600)
    check("deno check clean", rc == 0, out[-800:])
    rc, out = run("npx eslint .", timeout=900)
    check("eslint has no errors", rc == 0, out[-1200:])


# --------------------------------------------------------------------------- live


def live_checks():
    uid, token = make_user("fp09-step4")
    LIVE["uid"] = uid
    LIVE["jwt"] = token

    foreign_uid, foreign_token = make_user("fp09-step4-foreign")
    LIVE["foreign_uid"] = foreign_uid
    LIVE["foreign_jwt"] = foreign_token
    foreign_opening = opening_row(foreign_uid)
    check("a second user exists for the foreign-message 404", bool(foreign_opening),
          repr(foreign_opening))

    print("\n== H. live: fresh stage and the interview proposal ==")
    check("the fresh profile starts at intro", profile()["onboarding_stage"] == "intro",
          repr(profile()))
    check("the fresh profile opens exactly one DRAFT row", len(rows(
        f"/messages?select=id&user_id=eq.{uid}&metadata->>source=eq.onboarding_opening")) == 1)

    status, body = smoke(f"action=onboarding-drill&leg=advance&user={uid}&to=routine")
    check("the drill forces the profile to routine",
          status == 200 and body.get("ok") is True and body.get("to") == "routine",
          str(body))

    routine = [
        "My routine starts with coffee and a short walk.",
        "Work runs from nine to five with lunch at one.",
        "Evenings are dinner, a walk, and a little reading.",
        "I usually wind down by ten thirty.",
    ]
    proposal_id = None
    for index, text in enumerate(routine, start=1):
        _, status, body = send(text)
        check(f"routine answer {index} replies", status == 200 and body.get("status") == "ok",
              str(body))
        if index == len(routine):
            proposal_id = body.get("assistant_message_id")
            proposal_stage = profile()["onboarding_stage"]
            check("the routine boundary advances to metric_selection",
                  proposal_stage == "metric_selection", repr(proposal_stage))

    proposal = message(proposal_id)
    proposal_meta = (proposal or {}).get("metadata") or {}
    options = proposal_meta.get("metric_options") or []
    check("the proposal carries exactly three chips", len(options) == 3, repr(options))
    check("each chip has key/label/domain/output_unit",
          all(all(k in o and o[k] for k in ("key", "label", "domain", "output_unit"))
              for o in options), repr(options))

    classified = [((row.get("metadata") or {}).get("domain"))
                  for row in onboarding_rows(role="assistant")
                  if (row.get("metadata") or {}).get("domain")]
    counts = {}
    for domain in classified:
        counts[domain] = counts.get(domain, 0) + 1
    dominant = max(counts, key=counts.get) if counts else None
    check("the interview turns carry a classified domain", bool(dominant), repr(counts))
    check("the top chip's domain is the most frequent classified domain",
          bool(options) and options[0].get("domain") == dominant,
          f"{options[:1]} vs {counts}")
    expected_keys = ["Deep Work Hours", "Momentum", "Check-in Consistency"]
    check("the three chips are deterministic (frequency then catalog order)",
          [o.get("key") for o in options] == expected_keys,
          repr([o.get("key") for o in options]))

    print("\n== I. live: free-text re-offer ==")
    _, status, body = send("I'm not sure which one to pick.")
    check("the metric_selection free-text turn replies",
          status == 200 and body.get("status") == "ok", str(body))
    reoffer = message(body.get("assistant_message_id"))
    reoffer_meta = (reoffer or {}).get("metadata") or {}
    check("the re-offer carries the identical list",
          reoffer_meta.get("metric_options") == options,
          repr(reoffer_meta.get("metric_options")))
    check("the re-offer keeps the stage at metric_selection",
          profile()["onboarding_stage"] == "metric_selection")

    print("\n== J. live: the 400/404 table ==")
    status, body = select_metrics(proposal_id, [])
    check("empty keys -> 400", status == 400, f"{status} {body}")
    status, body = select_metrics(proposal_id, [o["key"] for o in options])
    check("three keys -> 400", status == 400, f"{status} {body}")
    status, body = select_metrics(proposal_id, [options[0]["key"], options[0]["key"]])
    check("duplicate keys -> 400", status == 400, f"{status} {body}")
    status, body = select_metrics(proposal_id, [123])  # type: ignore[list-item]
    check("non-string key -> 400", status == 400, f"{status} {body}")
    status, body = select_metrics("not-a-uuid", [options[0]["key"]])
    check("malformed message_id -> 400", status == 400, f"{status} {body}")
    status, body = req("POST", "/functions/v1/select-metrics", {"message_id": proposal_id},
                       token=token, key=LIVE["anon"])
    check("missing keys -> 400", status == 400, f"{status} {body}")
    status, body = req("POST", "/functions/v1/select-metrics", {"keys": [options[0]["key"]]},
                       token=token, key=LIVE["anon"])
    check("missing message_id -> 400", status == 400, f"{status} {body}")
    status, body = req("POST", "/functions/v1/select-metrics", raw="{not json",
                       token=token, key=LIVE["anon"])
    check("malformed JSON body -> 400", status == 400, f"{status} {body}")
    status, body = select_metrics(str(uuid.uuid4()), [options[0]["key"]])
    check("unknown message -> 404", status == 404, f"{status} {body}")
    if foreign_opening:
        status, body = select_metrics(foreign_opening["id"], [options[0]["key"]])
        check("foreign message -> 404", status == 404, f"{status} {body}")
    last_user = rows(f"/messages?select=id&user_id=eq.{uid}&role=eq.user"
                     "&order=created_at.desc&limit=1")[0]["id"]
    status, body = select_metrics(last_user, [options[0]["key"]])
    check("a user row is not an option message -> 400", status == 400, f"{status} {body}")
    own_opening = opening_row(uid)
    status, body = select_metrics(own_opening["id"], [options[0]["key"]])
    check("an assistant row without metric_options -> 400", status == 400, f"{status} {body}")
    status, body = select_metrics(proposal_id, ["Not A Preset"])
    check("a key outside the row's options -> 400", status == 400, f"{status} {body}")

    print("\n== K. live: confirm two, stage complete, dashboard data ==")
    chosen = [options[0]["key"], options[1]["key"]]
    status, body = select_metrics(proposal_id, chosen)
    check("confirm returns 200 ok", status == 200 and body.get("status") == "ok",
          f"{status} {body}")
    metric_ids = body.get("metric_ids") or []
    check("confirm returns two metric ids", len(metric_ids) == 2, repr(metric_ids))
    check("the profile is complete after confirm",
          profile()["onboarding_stage"] == "complete", repr(profile()))

    created = metric_rows(uid, metric_ids)
    check("two metric rows were created", len(created) == 2, repr(created))
    by_name = {row["name"]: row for row in created}
    check("both rows are core", all(row.get("is_core") is True for row in created),
          repr(created))
    check("both rows are validated", all(row.get("formula_status") == "validated"
                                         for row in created), repr(created))
    check("both rows are active", all(row.get("archived_at") is None for row in created),
          repr(created))
    check("Deep Work Hours stores the preset formula",
          (by_name.get("Deep Work Hours") or {}).get("formula") == {"var": "hours_logged"},
          repr(by_name.get("Deep Work Hours")))
    check("Momentum stores the preset formula",
          (by_name.get("Momentum") or {}).get("formula") == {"var": "doings_count"},
          repr(by_name.get("Momentum")))

    status, dash = user_req(
        "GET",
        "/metrics?select=id,name,domain,output_unit,is_quest,quest_status,quest_deadline,"
        "created_at,formula_status,archived_at"
        f"&user_id=eq.{uid}&formula_status=eq.validated&archived_at=is.null"
        "&order=created_at.asc",
    )
    check("the dashboard's user-RLS read returns both rows",
          status == 200 and isinstance(dash, list)
          and {row["id"] for row in dash} == set(metric_ids), repr(dash))
    check("the dashboard contract still has no client writes",
          not re.search(r"\.(insert|update|upsert|delete)\(",
                        read("app/(app)/dashboard.tsx")))
    check("zero FP-07 files changed (git-diff assert)",
          not any(p in FP07_FILES for p in git_paths()))

    print("\n== L. live: the metric_eval tick and points ==")
    target = date.today() - timedelta(days=1)
    patch(f"/profiles?id=eq.{uid}", {"timezone": "UTC"})
    p_now = f"{target + timedelta(days=1)}T00:31:00Z"
    status, enqueued = rpc("enqueue_metric_eval_jobs", {"p_now": p_now})
    check("the enqueue RPC accepts p_now", status == 200, f"{status} {enqueued}")
    jobs = rows(f"/jobs?select=id,type,payload&payload->>user_id=eq.{uid}"
                f"&payload->>computed_for=eq.{target}")
    check("the tick qualifies this user", any(j.get("type") == "metric_eval" for j in jobs),
          repr(jobs))

    status, report = smoke(f"action=metric-drill&leg=eval&user={uid}&date={target}")
    check("the forced eval leg returns 200", status == 200, f"{status} {report}")
    check("the eval sees both metrics", report.get("metrics") == 2, repr(report))
    check("the forced eval writes two points", report.get("pointsWritten") == 2,
          repr(report))
    points = rows(f"/metric_points?select=metric_id,value,computed_for"
                  f"&metric_id=in.({','.join(metric_ids)})&computed_for=eq.{target}")
    check("both metric points landed", len(points) == 2, repr(points))

    status, dup = select_metrics(proposal_id, chosen)
    check("a second confirm returns duplicate",
          status == 200 and dup.get("status") == "duplicate", f"{status} {dup}")
    check("duplicate returns the same metric ids",
          set(dup.get("metric_ids") or []) == set(metric_ids), repr(dup))

    print("\n== M. live: one-row re-confirm does not duplicate ==")
    status, body = smoke(f"action=onboarding-drill&leg=advance&user={uid}"
                         "&to=metric_selection")
    check("the drill reopens metric_selection", status == 200 and body.get("ok") is True,
          str(body))
    delete(f"/metrics?id=eq.{metric_ids[1]}")
    status, retry = select_metrics(proposal_id, chosen)
    check("the one-row re-confirm returns ok", status == 200
          and retry.get("status") == "ok", f"{status} {retry}")
    check("the surviving row is reused",
          (retry.get("metric_ids") or [None])[0] == metric_ids[0], repr(retry))
    check("the missing row is re-created",
          (retry.get("metric_ids") or [None, None])[1] != metric_ids[1], repr(retry))
    check("the re-confirm keeps exactly two active core rows",
          len(metric_rows(uid)) == 2, repr(metric_rows(uid)))
    status, dup2 = select_metrics(proposal_id, chosen)
    check("the re-confirm still ends in duplicate",
          status == 200 and dup2.get("status") == "duplicate", f"{status} {dup2}")

    print("\n== N. live: stage guard and routing table ==")
    status, body = smoke(f"action=onboarding-drill&leg=advance&user={uid}&to=intro")
    check("the drill forces an earlier stage", status == 200 and body.get("ok") is True,
          str(body))
    status, body = select_metrics(proposal_id, chosen)
    check("an earlier stage is 409", status == 409, f"{status} {body}")
    check("fresh/intake routing is interview", profile()["onboarding_stage"] != "complete")
    # The complete half was asserted above (stage == complete before the guard leg). The
    # deep-link bounce is structural: the (app) layout gate precedes AppTabs.
    skip("profiles.timezone equals the device TZ post-mount",
         "owner-manual web/device drill; no browser automation in the repo")


# --------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true", help="skip the network legs")
    ap.add_argument("--no-toolchain", action="store_true", help="skip tsc/jest/deno/eslint")
    args = ap.parse_args()

    load_dotenv()
    url = (os.environ.get("SUPABASE_URL") or
           os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    smoke_token = os.environ.get("DEV_SMOKE_TOKEN")
    LIVE.update({"url": url, "service": service, "anon": anon, "smoke": smoke_token})

    static_checks()
    if args.static_only:
        if not args.no_toolchain:
            toolchain()
        return finish()

    if not url or not service or not anon or not smoke_token:
        sys.exit("need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, "
                 "DEV_SMOKE_TOKEN")

    originals = {}
    uid = None
    foreign_uid = None
    try:
        for key in ("llm_stub_mode", "classifier_mode", "dev_overrides_enabled",
                    "metric_eval_enabled"):
            originals[key] = config_value(key)
        set_config("llm_stub_mode", True)
        set_config("classifier_mode", "stub")
        set_config("dev_overrides_enabled", True)
        set_config("metric_eval_enabled", True)
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL config setup: {exc}")
        FAILS.append("config setup")
        return finish()

    try:
        live_checks()
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL live leg crashed: {exc}")
        FAILS.append("live leg crashed")
    finally:
        uid = LIVE.get("uid")
        foreign_uid = LIVE.get("foreign_uid")
        try:
            for key, value in originals.items():
                set_config(key, value)
        except Exception as exc:  # noqa: BLE001
            print(f"  (config restore warning: {exc})")
        if uid:
            drop_user(uid)
        if foreign_uid:
            drop_user(foreign_uid)

    if not args.no_toolchain:
        toolchain()
    return finish()


def finish():
    print("\n" + ("FAIL: " + ", ".join(FAILS) if FAILS else "ALL CHECKS PASS"))
    if SKIPS:
        print("OWNER MANUAL: " + ", ".join(SKIPS))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
