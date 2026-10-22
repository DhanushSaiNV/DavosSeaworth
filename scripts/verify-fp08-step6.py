#!/usr/bin/env python3
"""FP-08 Step 6 gate -- the quest lifecycle: accept-quest, the card, and quest_expire.

Covers PLAN Step 6 Verify: "the script green; static asserts -- no metric insert outside
`insertValidatedMetric`, `chat.tsx` + the new pure module are the only client changes,
`git diff` proves zero FP-07 file edits", plus the live lifecycle: stub offer -> accept ->
validated quest metric + future-dated expire job -> points -> completed / failed / expired
with the archived state and the debrief row; the double tap, the decline, and the
one-active-quest conflict.

Static
  accept     : auth-scoped row, gate on the stored formula before the RPC, deadline clamp,
               local expiry, no provider import, decline compare-and-set
  expire     : archived-claim idempotency, verdict, archive before generate, default push,
               quest_debrief metadata
  dispatcher : quest_expire registered, NOT in FAST_JOB_TYPES
  client     : pure card module + tests; chat.tsx uses traceNetworkCall + logger; only the
               two client files changed; zero FP-07 file diffs
  docs       : TECH-SPEC / GLOSSARY / PLAN write-backs

Toolchain
  tsc / full jest / deno check + the FP-03 / FP-04 / FP-05 static gates

Live (network; skipped by --static-only)
  fixture    : one synthetic auth user with a password grant JWT (never the owner)
  offer      : planted late days -> scan -> the real drift handler writes the quest card
  accept     : ok -> metric (is_quest, validated, deadline in bounds) + expire job;
               double tap -> duplicate; second offer -> 409 conflict; decline -> no metric
  lifecycle  : 5/7 -> completed, 1/7 -> failed, 0 -> expired; archived_at, the debrief row,
               and a second force -> duplicate (no second row)
  fp07       : the FP-07 gate family (steps 3-6) green with the quest metric present

Cleanup removes the fixture user (cascade), its jobs (no user FK), and restores stub mode.

Usage: python scripts/verify-fp08-step6.py [--static-only] [--no-toolchain] [--no-fp07]
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
from datetime import date, datetime, time as dtime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACC = "supabase/functions/_shared/accountability"
ACCEPT = "supabase/functions/accept-quest/index.ts"
EXPIRE = f"{ACC}/runQuestExpire.ts"
QUESTS = f"{ACC}/quests.ts"
INTERV = f"{ACC}/interventions.ts"
DOG = "supabase/functions/_shared/checkin/runWatchdog.ts"
CREATE = "supabase/functions/_shared/metrics/create.ts"
DISPATCH = "supabase/functions/job-dispatcher/index.ts"
SMOKE = "supabase/functions/dev-smoke/index.ts"
CHAT = "app/(app)/chat.tsx"
CARD = "lib/questCard.ts"
CARD_TEST = "lib/questCard.test.ts"
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


def req(method, path, body=None, token=None, key=None, headers=None, timeout=120):
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


def set_config(key, value):
    status, body = rest("PATCH", f"/config?key=eq.{key}", {"value": value}, prefer="return=minimal")
    if status not in (200, 204):
        raise RuntimeError(f"config {key} write failed: {status} {body}")


def smoke(path):
    return req("POST", "/functions/v1/dev-smoke?" + path, token=LIVE["smoke"], key=LIVE["smoke"])


def accept_call(message_id, accepted):
    return req("POST", "/functions/v1/accept-quest",
               {"message_id": message_id, "accepted": accepted},
               token=LIVE["jwt"], key=LIVE["anon"])


# ---------------------------------------------------------------------------
# A. static
# ---------------------------------------------------------------------------


def static_checks():
    print("== A. static surface ==")
    accept_src = read(ACCEPT)
    expire_src = read(EXPIRE)
    quests_src = read(QUESTS)
    interv_src = read(INTERV)
    dog_src = read(DOG)
    create_src = read(CREATE)
    dispatch_src = read(DISPATCH)
    smoke_src = read(SMOKE)
    chat_src = read(CHAT)
    card_src = read(CARD)
    card_test = read(CARD_TEST)
    tech_src = read(TECH)
    glos_src = read(GLOSSARY)
    plan_src = read(PLAN)

    for rel, src in ((ACCEPT, accept_src), (EXPIRE, expire_src), (CARD, card_src),
                     (CARD_TEST, card_test)):
        check(f"{rel} exists", bool(src))

    # -- accept-quest
    check("accept-quest authenticates the caller", "resolveUserId(req)" in accept_src)
    check("accept-quest scopes the row to the caller",
          '.eq("user_id", userId)' in accept_src and "row.role !== \"assistant\"" in accept_src)
    check("accept-quest gates the stored formula before the RPC",
          accept_src.find("validateFormula(offer.formula") < accept_src.find('.rpc("accept_quest"'))
    check("a gate failure consumes nothing", 'status: "invalid_formula"' in accept_src
          and "422" in accept_src)
    check("accept-quest clamps the deadline into quest_deadline_bounds",
          'getConfig("quest_deadline_bounds")' in accept_src and "clampDeadlineDays(" in accept_src)
    check("quest_deadline is accept date + days (FR-15)",
          "const deadline = addDays(acceptDate, days)" in accept_src)
    check("expiry is deadline+1 at 01:15 user-local",
          "localWallToUtcMs(timezone, y, mo, d, 1, 15)" in accept_src
          and "86_400_000" in accept_src)
    check("decline is a compare-and-set metadata flip with no metric",
          "quest_declined: true" in accept_src
          and '.is("metadata->>quest_consumed", null)' in accept_src)
    check("accept-quest imports no provider adapter", "llm/adapter" not in accept_src)
    check("the RPC result statuses are mapped", all(
        token in accept_src for token in ('"ok"', '"duplicate"', '"conflict"', '"not_found"')))

    # -- runQuestExpire
    check("expiry loads the metric scoped to the user",
          '.eq("id", metricId)' in expire_src and '.eq("user_id", userId)' in expire_src)
    check("expiry checks archived_at first", 'if (metric.archived_at !== null) return { status: "duplicate" }' in expire_src)
    check("expiry applies the pure verdict table",
          "questVerdict(points.map" in expire_src and "quest_completion_fraction" in expire_src)
    claim = expire_src.find('.is("archived_at", null)')
    generate = expire_src.find("await runLockedPersonaReply({")
    debrief = expire_src.find('source: "quest_debrief"')
    check("the conditional archive is the idempotency claim before generation",
          0 < claim < generate)
    check("archive happens before the debrief row",
          0 < generate < debrief)
    check("the debrief row carries metric_id + quest_status",
          "metric_id: metricId" in expire_src and "quest_status: verdict" in expire_src)
    check("the debrief push is default priority", 'priority: "default"' in expire_src)
    check("expiry writes the verdict + archived_at together",
          "quest_status: verdict, archived_at: nowIso" in expire_src)
    check("the debrief context builder is used", "buildQuestDebriefContext({" in expire_src)

    # -- deliverIntervention
    check("deliverIntervention is exported for the expiry handler",
          "export async function deliverIntervention(" in dog_src)
    check("deliverIntervention can send a default-priority push",
          'priority?: "high" | "default"' in dog_src
          and "createAiMessagePushPayload(args.userId, args.content" in dog_src)

    # -- quest math helpers
    check("quests.ts owns the local date + day arithmetic",
          "export function localDateKey(" in quests_src and "export function addDays(" in quests_src)

    # -- dispatcher
    check("the dispatcher registers quest_expire", "quest_expire: async (payload)" in dispatch_src)
    check("quest_expire is NOT in FAST_JOB_TYPES",
          "FAST_JOB_TYPES = new Set(['smoke_test', 'watchdog_checkin', 'purge_memory', 'metric_eval', 'drift_scan'])" in dispatch_src
          and "quest_expire" not in re.search(
              r"FAST_JOB_TYPES\s*=\s*new Set\((\[[^\]]*\])", dispatch_src).group(1))
    check("the quest_expire handler drives the shared runner",
          "runQuestExpire({ user_id:" not in dispatch_src
          and "await runQuestExpire(payload)" in dispatch_src)

    # -- no metric insert outside the helper
    offenders = []
    for dirpath, _, filenames in os.walk(os.path.join(ROOT, "supabase/functions")):
        for filename in filenames:
            if not filename.endswith((".ts", ".tsx")):
                continue
            path = os.path.join(dirpath, filename)
            rel = os.path.relpath(path, ROOT).replace("\\", "/")
            if rel == CREATE:
                continue
            text = open(path, encoding="utf-8", errors="replace").read()
            for match in re.finditer(r'\.from\("metrics"\)', text):
                window = text[match.end():match.end() + 240]
                if ".insert(" in window:
                    offenders.append(rel)
                    break
    check("no metric insert outside insertValidatedMetric", not offenders, str(offenders))
    check("accept-quest does not insert a metric itself", ".insert(" not in accept_src)

    # -- client
    check("the pure card module imports nothing",
          not re.search(r"^\s*import\s", re.sub(r"//.*", "", card_src), re.M))
    check("the card parses the offer strictly", "export function parseQuestOffer(" in card_src)
    check("the card derives the persisted accepted/declined state",
          "export function persistedState(" in card_src and 'return "declined"' in card_src)
    check("the card maps duplicate to accepted (AC-7)",
          'flagged === "duplicate"' in card_src and 'state: "accepted"' in card_src)
    check("the card has a unit suite", "acceptOutcome" in card_test and "questCardFor" in card_test)
    check("chat.tsx renders the card from the pure module",
          "questCardFor(row.metadata" in chat_src and "questCards.get(item.messageId)" in chat_src)
    check("chat.tsx wraps accept-quest in traceNetworkCall",
          "traceNetworkCall('chat', 'accept-quest'" in chat_src)
    check("chat.tsx uses logger, never raw console", "logger." in chat_src
          and not re.search(r"console\.(log|warn|error|debug|info)\(", chat_src))
    check("the card's accept + decline both call the function",
          "onQuestAnswer(item.messageId!, true)" in chat_src
          and "onQuestAnswer(item.messageId!, false)" in chat_src)
    check("the confirmed state shows the metric id", "quest.metricId.slice(0, 8)" in chat_src)

    # -- only the two client files changed; zero FP-07 diffs
    rc, out = git(["status", "--porcelain", "--", "lib", "app", "components"])
    changed = set()
    for line in out.splitlines():
        path = line[3:].strip().replace("\\", "/")
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        changed.add(path)
    expected_client = {CHAT, CARD, CARD_TEST}
    check("chat.tsx + the pure module are the only client changes",
          changed <= expected_client, str(sorted(changed - expected_client)))
    rc, out = git(["diff", "--name-only", "HEAD", "--"] + FP07_PATHS)
    check("git diff proves zero FP-07 file edits", rc == 0 and out.strip() == "", out.strip())

    # -- docs
    check("TECH-SPEC records the Step 6 build", "As built (FP-08 Step 6)" in tech_src)
    check("GLOSSARY records accept-quest and quest_expire",
          "`accept-quest`" in glos_src and "`runQuestExpire`" in glos_src)
    check("GLOSSARY records the client card state", "`lib/questCard.ts`" in glos_src)
    check("the PLAN tracker marks Step 6 done",
          "| 6 | The quest lifecycle" in plan_src and "| 6 | The quest lifecycle: `accept-quest` + client card + `quest_expire` | ✅ |" in plan_src)
    check("dev-smoke drift-drill gained the quest leg",
          'leg === "quest"' in smoke_src and "await runQuestExpire({ user_id: user, metric_id: metric })" in smoke_src)
    check("the debrief builder is delimited", 'delimit("quest"' in interv_src)


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
        check("jest ran the whole suite", bool(match) and int(match.group(1)) >= 700,
              match.group(0) if match else "no summary")

    rc, out = run(["cmd", "/c", "deno", "check",
                   ACCEPT, EXPIRE, QUESTS, INTERV, DOG, DISPATCH, SMOKE])
    check("deno check is clean over the wired files", rc == 0, out[-1500:])

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
                 "stub": None, "users": [], "jwt": None})


def create_fixture():
    email = f"fp08-step6-{uuid.uuid4().hex[:10]}@example.com"
    password = uuid.uuid4().hex + "Aa1!"
    status, body = req("POST", "/auth/v1/admin/users", {
        "email": email,
        "password": password,
        "email_confirm": True,
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
        "checkin_cadence_minutes": 60,
        "checkin_active_hours_start": "09:00",
        "checkin_active_hours_end": "10:00",
        "trust_score": 50,
    }, prefer="return=minimal")
    if status not in (200, 204):
        raise RuntimeError(f"profile patch failed: {status} {body}")

    status, body = req("POST", "/auth/v1/token?grant_type=password",
                       {"email": email, "password": password}, key=LIVE["anon"])
    if status != 200 or not isinstance(body, dict) or not body.get("access_token"):
        raise RuntimeError(f"password grant failed: {status} {body}")
    LIVE["jwt"] = body["access_token"]
    return uid


def day_iso(anchor, offset_days, hhmm):
    day = (anchor - timedelta(days=offset_days)).strftime("%Y-%m-%d")
    return f"{day}T{hhmm}:00Z"


def insert_late_days(uid, anchor, count=3):
    for offset in range(1, count + 1):
        status, body = rest("POST", "/doings_logs", {
            "user_id": uid, "kind": "doing", "source": "app",
            "logged_at": day_iso(anchor, offset, "12:00"), "content": "fp08 step6 drill",
        })
        if status not in (200, 201):
            raise RuntimeError(f"doing insert failed: {status} {body}")


def scan(uid, now_iso):
    status, body = smoke(f"action=drift-drill&user={uid}&now={now_iso}")
    if status != 200:
        raise RuntimeError(f"drift-drill -> {status}: {body}")
    return body


def jobs_for(uid, job_type=None):
    q = f"/jobs?select=id,type,status,payload,next_retry_at&payload->>user_id=eq.{uid}"
    if job_type:
        q += f"&type=eq.{job_type}"
    return rows(q)


def fabricate_offer(uid, offer):
    status, body = rest("POST", "/messages", {
        "user_id": uid,
        "role": "assistant",
        "content": "A side quest, if you want it.",
        "metadata": {
            "source": "drift_intervention",
            "reason": "drift_late_start",
            "pattern": "late_start",
            "persona": "mentor_tough",
            "domain": "General",
            "rule_ids": [],
            "quest_offer": offer,
        },
    })
    if status not in (200, 201) or not body:
        raise RuntimeError(f"offer message insert failed: {status} {body}")
    return body[0]["id"]


def insert_points(metric_id, accept_day, values):
    for offset, value in enumerate(values):
        day = (accept_day + timedelta(days=offset)).strftime("%Y-%m-%d")
        status, body = rest("POST", "/metric_points", {
            "metric_id": metric_id, "value": value, "computed_for": day,
        })
        if status not in (200, 201):
            raise RuntimeError(f"point insert failed: {status} {body}")


def force_expire(uid, metric_id):
    status, body = smoke(f"action=drift-drill&leg=quest&user={uid}&metric={metric_id}")
    if status != 200:
        raise RuntimeError(f"drift-drill quest -> {status}: {body}")
    return (body or {}).get("outcome") or {}


def debrief_rows(uid, metric_id):
    return rows(f"/messages?select=id,content,metadata,reply_to_message_id&user_id=eq.{uid}"
                f"&metadata->>source=eq.quest_debrief&metadata->>metric_id=eq.{metric_id}")


def live_checks(no_fp07=False):
    print("== C. live: fixture ==")
    LIVE["stub"] = get_config("llm_stub_mode")
    if not LIVE["stub"]:
        set_config("llm_stub_mode", True)

    anchor = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    now_iso = anchor.isoformat().replace("+00:00", "Z")
    uid = create_fixture()
    insert_late_days(uid, anchor)
    print(f"  ..   scan anchored at {now_iso}; user {uid}")

    print("== D. live: the offer ==")
    report = scan(uid, now_iso)
    user = report["per_user"][0]
    check("the planted late days fire late_start",
          sorted(user["patterns"]) == ["compliance_drop", "late_start"], str(user))
    for job in jobs_for(uid, "intervention"):
        rest("PATCH", f"/jobs?id=eq.{job['id']}", {"status": "done"}, prefer="return=minimal")
    offer_job = f"step6-offer-{uuid.uuid4().hex[:10]}"
    status, body = smoke(f"action=intervention-drill&user={uid}"
                         f"&reason=drift_late_start&job_id={offer_job}")
    outcome = (body or {}).get("outcome") or {}
    check("the real drift handler writes the offer row",
          status == 200 and outcome.get("status") == "written", str(body)[:400])
    offer_row = one(f"/messages?select=id,metadata&user_id=eq.{uid}"
                    f"&metadata->>source_job_id=eq.{offer_job}")
    offer = (offer_row or {}).get("metadata", {}).get("quest_offer") or {}
    check("the offer carries FR-14's five fields",
          all(k in offer for k in ("name", "domain", "output_unit", "formula", "deadline_days")),
          str(offer_row)[:400])
    check("the offer deadline is clamped into bounds",
          isinstance(offer.get("deadline_days"), int) and 3 <= offer["deadline_days"] <= 21,
          str(offer))

    print("== E. live: accept, duplicate, conflict, decline ==")
    accept_day = datetime.now(timezone.utc).date()
    status, body = accept_call(offer_row["id"], True)
    check("the first tap accepts", status == 200 and (body or {}).get("status") == "ok", str(body)[:400])
    metric_id = (body or {}).get("metric_id")
    metric = one(f"/metrics?select=*&id=eq.{metric_id}&user_id=eq.{uid}") if metric_id else None
    check("the metric is the accepted quest",
          bool(metric) and metric["is_quest"] is True and metric["quest_status"] == "active"
          and metric["formula_status"] == "validated" and metric["archived_at"] is None,
          str(metric)[:400])
    expected_days = max(3, min(21, int(offer.get("deadline_days", 3))))
    expected_deadline = (accept_day + timedelta(days=expected_days)).strftime("%Y-%m-%d")
    check("quest_deadline is accept date + clamped days",
          bool(metric) and metric["quest_deadline"] == expected_deadline,
          f"{metric.get('quest_deadline') if metric else None} != {expected_deadline}")
    expire_jobs = jobs_for(uid, "quest_expire")
    check("exactly one expire job is queued", len(expire_jobs) == 1, str(expire_jobs))
    expire_job = expire_jobs[0] if expire_jobs else {}
    check("the expire job carries the metric id",
          (expire_job.get("payload") or {}).get("metric_id") == metric_id, str(expire_job))
    expected_expire = datetime.combine(
        date.fromisoformat(expected_deadline) + timedelta(days=1),
        dtime(1, 15), tzinfo=timezone.utc,
    )
    actual_expire = expire_job.get("next_retry_at")
    try:
        actual_dt = datetime.fromisoformat(str(actual_expire).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        actual_dt = None
    check("next_retry_at is deadline+1 at 01:15 user-local (UTC here)",
          expire_job.get("status") == "pending" and actual_dt == expected_expire,
          f"{actual_expire} != {expected_expire.isoformat()}")

    status, body = accept_call(offer_row["id"], True)
    check("a double tap is duplicate", status == 200 and (body or {}).get("status") == "duplicate",
          str(body)[:300])
    check("the double tap writes no second quest",
          len(rows(f"/metrics?select=id&user_id=eq.{uid}&is_quest=eq.true")) == 1)

    conflict_offer_id = fabricate_offer(uid, offer)
    status, body = accept_call(conflict_offer_id, True)
    check("a second offer while one is active is conflict",
          status == 409 and (body or {}).get("status") == "conflict", str(body)[:300])
    check("the conflict writes no metric",
          len(rows(f"/metrics?select=id&user_id=eq.{uid}&is_quest=eq.true")) == 1)

    decline_offer_id = fabricate_offer(uid, offer)
    status, body = accept_call(decline_offer_id, False)
    check("decline answers declined", status == 200 and (body or {}).get("status") == "declined",
          str(body)[:300])
    declined = one(f"/messages?select=metadata&id=eq.{decline_offer_id}")
    check("decline marks the row and writes no metric",
          bool(declined) and declined["metadata"].get("quest_declined") is True
          and len(rows(f"/metrics?select=id&user_id=eq.{uid}&is_quest=eq.true")) == 1,
          str(declined)[:300])
    status, body = accept_call(decline_offer_id, True)
    check("an accept after a decline is duplicate",
          status == 200 and (body or {}).get("status") == "duplicate", str(body)[:300])

    print("== F. live: the three verdicts + debrief ==")
    insert_points(metric_id, accept_day, [1, 1, 1, 1, 1, 0, 0])
    outcome = force_expire(uid, metric_id)
    check("5 passing days complete the quest",
          outcome.get("status") == "written" and outcome.get("verdict") == "completed",
          str(outcome)[:400])
    archived = one(f"/metrics?select=quest_status,archived_at&id=eq.{metric_id}")
    check("the metric is completed and archived",
          bool(archived) and archived["quest_status"] == "completed"
          and archived["archived_at"] is not None, str(archived))
    rows_completed = debrief_rows(uid, metric_id)
    check("exactly one completed debrief lands",
          len(rows_completed) == 1
          and rows_completed[0]["reply_to_message_id"] is None
          and rows_completed[0]["metadata"].get("quest_status") == "completed",
          str(rows_completed)[:400])
    check("the debrief has content", bool(rows_completed) and len(rows_completed[0]["content"]) > 20,
          str(rows_completed)[:300])
    outcome = force_expire(uid, metric_id)
    check("a second force is duplicate", outcome.get("status") == "duplicate", str(outcome))
    check("the duplicate force writes no second debrief", len(debrief_rows(uid, metric_id)) == 1)

    # failed: 1 of 7 passing
    failed_offer_id = fabricate_offer(uid, offer)
    status, body = accept_call(failed_offer_id, True)
    failed_metric = (body or {}).get("metric_id")
    check("a second quest accepts after the first archives",
          status == 200 and (body or {}).get("status") == "ok", str(body)[:300])
    insert_points(failed_metric, datetime.now(timezone.utc).date(), [1, 0, 0, 0, 0, 0, 0])
    outcome = force_expire(uid, failed_metric)
    check("1 of 7 passing fails the quest", outcome.get("verdict") == "failed", str(outcome))
    failed_rows = debrief_rows(uid, failed_metric)
    check("the failed debrief says failed",
          len(failed_rows) == 1 and failed_rows[0]["metadata"].get("quest_status") == "failed",
          str(failed_rows)[:300])

    # expired: zero points
    expired_offer_id = fabricate_offer(uid, offer)
    status, body = accept_call(expired_offer_id, True)
    expired_metric = (body or {}).get("metric_id")
    check("a third quest accepts after the second archives",
          status == 200 and (body or {}).get("status") == "ok", str(body)[:300])
    outcome = force_expire(uid, expired_metric)
    check("zero points expires the quest", outcome.get("verdict") == "expired", str(outcome))
    expired_rows = debrief_rows(uid, expired_metric)
    check("the expired debrief says expired",
          len(expired_rows) == 1 and expired_rows[0]["metadata"].get("quest_status") == "expired",
          str(expired_rows)[:300])

    print("== G. live: the dashboards' data is present, FP-07 untouched ==")
    quest_metrics = rows(f"/metrics?select=id,is_quest,quest_status,quest_deadline,archived_at"
                         f"&user_id=eq.{uid}&is_quest=eq.true&order=created_at.asc")
    check("the three quest metrics are readable by the dashboard",
          len(quest_metrics) == 3
          and [m["quest_status"] for m in quest_metrics] == ["completed", "failed", "expired"]
          and all(m["archived_at"] is not None for m in quest_metrics), str(quest_metrics))
    check("every quest metric has a deadline for the ProgressBar",
          all(isinstance(m["quest_deadline"], str) for m in quest_metrics))

    if not no_fp07:
        print("== H. live: the FP-07 gate family ==")
        for name in ("verify-fp07-step3.py", "verify-fp07-step4.py",
                     "verify-fp07-step5.py", "verify-fp07-step6.py"):
            rc, out = run(["python", f"scripts/{name}"], timeout=1800)
            check(f"{name} is green with quest metrics present", rc == 0, out[-1800:])


def cleanup(verbose=False):
    if not LIVE.get("url"):
        return
    set_config("llm_stub_mode", LIVE.get("stub") if LIVE.get("stub") is not None else False)

    for uid in list(LIVE.get("users") or []):
        rest("DELETE", f"/jobs?payload->>user_id=eq.{uid}", prefer="return=minimal")
        req("DELETE", f"/auth/v1/admin/users/{uid}", token=LIVE["service"], key=LIVE["service"])

    if verbose:
        leftovers = []
        for uid in LIVE.get("users") or []:
            if one(f"/profiles?select=id&id=eq.{uid}"):
                leftovers.append(uid)
            if jobs_for(uid):
                leftovers.append(f"jobs:{uid}")
        check("cleanup removes every fixture user and its jobs", not leftovers, str(leftovers))
        check("cleanup restores llm_stub_mode", get_config("llm_stub_mode") == LIVE["stub"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true", help="skip the network legs")
    ap.add_argument("--no-toolchain", action="store_true", help="skip tsc/jest/deno/earlier gates")
    ap.add_argument("--no-fp07", action="store_true", help="skip the FP-07 live gate family")
    args = ap.parse_args()

    print("== FP-08 Step 6: the quest lifecycle ==")
    static_checks()
    if not args.no_toolchain:
        toolchain_checks()

    if not args.static_only:
        print("== C. live == ")
        live_setup()
        try:
            live_checks(no_fp07=args.no_fp07)
        finally:
            cleanup(verbose=True)

    print()
    if FAILS:
        print(f"FAILED ({len(FAILS)}): " + "; ".join(FAILS))
        sys.exit(1)
    print("ALL PASS")


if __name__ == "__main__":
    main()
