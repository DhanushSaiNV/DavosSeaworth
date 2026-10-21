#!/usr/bin/env python3
"""FP-08 Step 3 gate -- the D20 rider wiring (chat, journal, select-persona, auto-adopt).

Covers PLAN Step 3 Verify: "the script green; tsc + deno check + jest clean; the FP-06
golden tests green; the FP-02/03/04 static legs green; static asserts -- the rider module
has no provider import, `trust_events` writes only in the rider apply, no `trust_score` read
client-side."

Static
  writer     : `applyRider.ts` is the only `trust_events` writer and the only `trust_score`
               / `dialog_state` writer; the pure modules still import nothing
  chat       : send-message opts in (`applyRider: true`); runPipeline applies the rider after
               the extraction resolves and before stage 4; quit_signal is not re-thresholded
  journal    : habit_flag in the interface, schema, required list, validator, stub and prompt;
               the marker writes it; the rider applies with the extraction's severity
  override   : select-persona calls `applyPersonaOverride` after the consumed guard
  auto-adopt : send-message calls `applyAutoAdoptBandShift` after the success RPC
  client     : no client path reads trust_score

Toolchain
  tsc / deno / jest (full) + the FP-03 / FP-04 / FP-05 static gates

Live (network; skipped by --static-only)
  trust      : plant 50 -> drill openness +2 -> 52 + event; admission +10; decrement floor
  neutral    : an all-zero drill writes nothing (score, events, dialog)
  lockdown   : entry, locked-neutral, concession exit, lazy breaker, S1 exit, re-entry refresh
  habits     : confronted -> concession -> watch + strike_at + pending strike_fire; quit_commitment
  journal    : stub extraction on a drill entry -> +1 openness + marker (habit_flag, vagueness)
  chip       : synthetic option message -> select-persona -> user_overrides++ / band_shift-0.02
               / override audit row; a second tap is `duplicate` and writes nothing
  chat       : `pipeline&rider=1` on the stub route -> riderProbe applied, neutral writes zero

Every live leg cleans up: the owner's trust/dialog state, persona_stats row, drill habits,
drill journal entries (+facts/jobs) and the drill messages are restored or removed, and the
drill trust_events are deleted (the pre-run ids are the whitelist).

Usage: python scripts/verify-fp08-step3.py [--static-only] [--no-toolchain]
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
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
ACC = "supabase/functions/_shared/accountability"
APPLY = f"{ACC}/applyRider.ts"
SEND = "supabase/functions/send-message/index.ts"
PIPELINE = "supabase/functions/_shared/pipeline/runPipeline.ts"
SELECT = "supabase/functions/select-persona/index.ts"
RUNCHAIN = "supabase/functions/_shared/journal/runChain.ts"
CONTRACT = "supabase/functions/_shared/journal/extractContract.ts"

FAILS = []
DRILL = "DRILL FP-08 Step 3"

# live state (populated by setup, consumed by the finally-block cleanup)
LIVE = {}


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


def run(args, timeout=900, shell=False):
    if shell and os.name == "nt":
        cmd = ["cmd", "/c", *args]
    else:
        cmd = args
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=timeout,
                          encoding="utf-8", errors="replace")
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


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
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            if attempt == 2:
                raise
            print(f"  ..   transient network error ({exc}); retrying {path}")
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


def patch_profile(patch):
    status, body = rest("PATCH", f"/profiles?id=eq.{LIVE['uid']}", patch, prefer="return=minimal")
    if status not in (200, 204):
        raise RuntimeError(f"profile write failed: {status} {body}")


def profile():
    row = one(f"/profiles?select=trust_score,dialog_state,lockdown_started_at,timezone&id=eq.{LIVE['uid']}")
    if not row:
        raise RuntimeError("owner profile not found")
    return row


def trust_events():
    return rows(f"/trust_events?select=id,reason,delta,created_at&user_id=eq.{LIVE['uid']}&order=created_at.desc")


def local_today(tz_name):
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo(tz_name)).date().isoformat()
    except Exception:  # noqa: BLE001
        if tz_name == "Asia/Kolkata":
            return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date().isoformat()
        return datetime.now(timezone.utc).date().isoformat()


def smoke(path):
    return req("POST", "/functions/v1/dev-smoke?" + path, token=LIVE["smoke"], key=LIVE["smoke"])


def drill(params=""):
    status, body = smoke(f"action=accountability-drill&user={LIVE['uid']}" + ("&" + params if params else ""))
    if status != 200:
        raise RuntimeError(f"accountability-drill -> {status}: {body}")
    return body["probe"]


# ---------------------------------------------------------------------------
# A. static
# ---------------------------------------------------------------------------


def static_checks():
    print("== A. static surface ==")
    apply_src = read(APPLY)
    rider_src = read(f"{ACC}/rider.ts")
    send_src = read(SEND)
    pipeline_src = read(PIPELINE)
    select_src = read(SELECT)
    chain_src = read(RUNCHAIN)
    contract_src = read(CONTRACT)

    for rel, src in ((APPLY, apply_src), (f"{ACC}/rider.ts", rider_src), (SEND, send_src),
                     (PIPELINE, pipeline_src), (SELECT, select_src), (RUNCHAIN, chain_src),
                     (CONTRACT, contract_src)):
        check(f"{rel} exists", bool(src))

    # Single writer.
    writers = []
    for base, _dirs, files in os.walk(os.path.join(ROOT, "supabase/functions")):
        for name in files:
            if not name.endswith(".ts") or name.endswith(".test.ts"):
                continue
            full = os.path.join(base, name)
            src = open(full, encoding="utf-8", errors="replace").read()
            if 'from("trust_events")' in src:
                writers.append(os.path.relpath(full, ROOT).replace("\\", "/"))
    check("applyRider.ts is the only trust_events writer", writers == [APPLY], f"{writers}")
    trust_writers = []
    for base, _dirs, files in os.walk(os.path.join(ROOT, "supabase/functions")):
        for name in files:
            if not name.endswith(".ts") or name.endswith(".test.ts"):
                continue
            full = os.path.join(base, name)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            if rel == APPLY:
                continue
            src = open(full, encoding="utf-8", errors="replace").read()
            if re.search(r"\.(update|insert|upsert)\(\s*\{[^}]*\btrust_score\s*:", src, re.S):
                trust_writers.append(rel)
    check("no other function writes the trust_score column", not trust_writers, f"{trust_writers}")
    check("applyRider has no provider-adapter import", "../llm/" not in apply_src and "adapter" not in apply_src)
    check("the apply module reads the three [SPEC] keys from config",
          all(k in apply_src for k in ("strike_watch_days_default", "lockdown_circuit_breaker_hours",
                                       "quit_signal_threshold", "strike_fire_local_hour")))

    # Chat call site.
    check("send-message opts into the rider", "applyRider: true" in send_src)
    check("send-message calls the band-shift helper after the RPC",
          send_src.index('.rpc("increment_auto_adopt_successes"') < send_src.index("await applyAutoAdoptBandShift"))
    rider_pos = pipeline_src.find("applyTrustRider(")
    stage4_pos = pipeline_src.find("// Stage 4")
    check("runPipeline applies the rider before stage 4", -1 < rider_pos < stage4_pos,
          f"rider {rider_pos}, stage4 {stage4_pos}")
    check("the apply also runs on extraction failure (lazy breaker)",
          "extraction.ok && extraction.data" in pipeline_src and "applyRider && userId" in pipeline_src)
    check("quit_signal is not re-thresholded at the call site",
          "classification.quit_signal ? 1 : 0" in pipeline_src)
    check("the rider apply is non-fatal (caught + logged)",
          "[pipeline] rider apply failed" in pipeline_src)

    # Journal.
    check("ExtractResult carries habit_flag", "habit_flag: boolean;" in contract_src)
    check("EXTRACT_SCHEMA declares habit_flag", '"habit_flag"' in contract_src and "habit flag" in contract_src)
    required_blocks = re.findall(r"required:\s*\[(.*?)\]", contract_src, re.S)
    check("habit_flag is required in the schema",
          any("habit_flag" in block for block in required_blocks), f"{len(required_blocks)} required lists")
    check("the validator checks habit_flag", 'typeof o.habit_flag !== "boolean"' in contract_src)
    check("the stub emits habit_flag", re.search(r"EXTRACT_STUB_RESULT[^\n]*\{.*?habit_flag: false", contract_src, re.S) is not None)
    check("the prompt documents habit_flag", "habit flag" in contract_src and "keeps failing" in contract_src)
    check("the marker write includes habit_flag", '{ vagueness_score, severity, habit_flag }' in chain_src)
    check("journal_extract applies the rider with the journal severity",
          "applyTrustRider({" in chain_src and "severity," in chain_src)
    marker_pos = chain_src.find("marker update failed")
    rider_apply_pos = chain_src.find("await applyTrustRider(")
    check("the journal apply sits after the marker write",
          -1 < marker_pos < rider_apply_pos, f"marker {marker_pos}, apply {rider_apply_pos}")

    # Override + client.
    check("select-persona calls the override helper", "applyPersonaOverride(userId, domain)" in select_src)
    check("the override sits after the consumed guard",
          select_src.index("const existing = await findSecondaryReply") < select_src.index("applyPersonaOverride(userId, domain)"))
    check("the override is non-fatal", "[select-persona] override rider failed" in select_src)
    client_hits = []
    for base, _dirs, files in os.walk(ROOT):
        if any(part in base for part in (".git", "node_modules", "supabase", "scripts", "docs")):
            continue
        for name in files:
            if name.endswith((".ts", ".tsx")):
                full = os.path.join(base, name)
                src = open(full, encoding="utf-8", errors="replace").read()
                if "trust_score" in src:
                    client_hits.append(os.path.relpath(full, ROOT).replace("\\", "/"))
    check("no client path reads trust_score", not client_hits, f"{client_hits}")

    # Empty-write floor: a neutral signal set never reaches a write.
    check("the decision exposes `changed` and the apply gates on it", "if (!decision.changed) return probe;" in apply_src)


def toolchain_checks():
    print("== B. toolchain + earlier gates ==")
    if not os.path.exists(os.path.join(ROOT, "node_modules")):
        skip("tsc/jest", "node_modules missing")
    else:
        rc, out = run(["npx", "tsc", "--noEmit"], shell=True)
        check("tsc --noEmit is clean", rc == 0, out[-1500:])
        rc, out = run(["npx", "jest", "--ci"], shell=True)
        check("the full jest suite is green (FP-06 golden included)", rc == 0, out[-1500:])
        match = re.search(r"Tests:\s+(\d+) passed, (\d+) total", out)
        check("jest ran the whole suite", bool(match) and int(match.group(1)) >= 700,
              match.group(0) if match else "no summary")

    rc, out = run(["deno", "check", "supabase/functions/send-message/index.ts",
                   "supabase/functions/select-persona/index.ts",
                   "supabase/functions/dev-smoke/index.ts",
                   "supabase/functions/_shared/accountability/applyRider.ts",
                   "supabase/functions/_shared/journal/runChain.ts",
                   "supabase/functions/_shared/pipeline/runPipeline.ts"])
    check("deno check is clean over the wired files", rc == 0, out[-1500:])

    for label, args in (
        ("FP-03 step 7 static", ["python", "scripts/verify-fp03-step7.py", "--static-only", "--no-jest", "--no-fp02"]),
        ("FP-04 step 6 static", ["python", "scripts/verify-fp04-step6.py", "--static-only", "--no-tsc", "--no-deno"]),
        ("FP-05 step 3 static", ["python", "scripts/verify-fp05-step3.py", "--static-only"]),
    ):
        rc, out = run(args)
        check(f"{label} is green", rc == 0, out[-1800:])


# ---------------------------------------------------------------------------
# C. live legs
# ---------------------------------------------------------------------------


def live_setup():
    load_dotenv()
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    smoke_token = os.environ.get("DEV_SMOKE_TOKEN")
    anon = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not service or not smoke_token or not anon:
        sys.exit("need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEV_SMOKE_TOKEN")

    sys.path.insert(0, SCRIPTS)
    from _mint_dev_jwt import decode_jwt_claims, resolve_gate_token

    token, usable, note = resolve_gate_token(
        supplied=os.environ.get("DAVOS_USER_JWT"), url=url, service=service
    )
    if not usable:
        sys.exit(f"could not resolve a user JWT: {note}")
    claims = decode_jwt_claims(token) or {}
    uid = claims.get("sub")
    if not uid:
        sys.exit("user JWT has no sub")

    LIVE.update({"url": url, "service": service, "smoke": smoke_token, "anon": anon,
                 "jwt": token, "uid": uid})
    DRILL_IDS = {"habits": [], "entries": [], "messages": [], "jobs": []}
    LIVE.update({"ids": DRILL_IDS, "before_events": set(), "persona": None, "state": None,
                 "stub": None})


def live_checks():
    print("== C. live: the apply half (rider drill) ==")
    prof = profile()
    LIVE["state"] = {
        "trust_score": prof["trust_score"],
        "dialog_state": prof["dialog_state"],
        "lockdown_started_at": prof["lockdown_started_at"],
    }
    LIVE["stub"] = get_config("llm_stub_mode")
    LIVE["before_events"] = {e["id"] for e in trust_events()}
    print(f"  ..   owner state: trust={prof['trust_score']} dialog={prof['dialog_state']} "
          f"stub_mode={LIVE['stub']} events={len(LIVE['before_events'])}")

    patch_profile({"trust_score": 50, "dialog_state": "OPEN", "lockdown_started_at": None})

    # Neutral.
    n = drill()
    check("neutral drill writes no score", n["trust_before"] == 50 and n["trust_after"] == 50, str(n))
    check("neutral drill writes no events", n["events"] == 0, str(n))
    check("neutral drill leaves the dialog OPEN", n["dialog_state"] == "OPEN", str(n))
    check("neutral drill is a zero-write turn", n["lockdown"] == {"enter": False, "exit": False, "refresh_started_at": False})
    check("neutral drill adds no trust_events row", len(trust_events()) == len(LIVE["before_events"]))

    # Openness +2.
    p = drill("openness=2")
    check("openness +2: 50 -> 52", p["trust_before"] == 50 and p["trust_after"] == 52, str(p))
    check("openness +2 writes exactly one event", p["events"] == 1, str(p))
    check("the DB score is 52", profile()["trust_score"] == 52)
    latest = trust_events()[0]
    check("the event is openness/+2", latest["reason"] == "openness" and latest["delta"] == 2, str(latest))

    # Admission +10.
    p = drill("admission=1")
    check("admission: 52 -> 62", p["trust_before"] == 52 and p["trust_after"] == 62, str(p))
    latest = trust_events()[0]
    check("the event is admission/+10", latest["reason"] == "admission" and latest["delta"] == 10, str(latest))

    # Floor guard on the decrement path.
    patch_profile({"trust_score": 2})
    p = drill("openness=-5")
    check("decrement clamps at 0", p["trust_after"] == 0, str(p))
    latest = trust_events()[0]
    check("the event records the raw signal (-5)", latest["reason"] == "openness" and latest["delta"] == -5, str(latest))
    patch_profile({"trust_score": 50})

    print("== D. live: lockdown transitions ==")
    p = drill("give_up=1")
    prof = profile()
    check("give_up enters LOCKDOWN", prof["dialog_state"] == "LOCKDOWN" and prof["lockdown_started_at"], str(p))
    check("entry reports enter=true", p["lockdown"]["enter"] is True, str(p))

    p = drill()
    prof = profile()
    check("a locked neutral turn stays locked", prof["dialog_state"] == "LOCKDOWN", str(p))
    check("a locked neutral turn reports no transition", p["lockdown"] == {"enter": False, "exit": False, "refresh_started_at": False})

    p = drill("concession=1")
    prof = profile()
    check("concession exits before generation", prof["dialog_state"] == "OPEN" and prof["lockdown_started_at"] is None, str(p))

    p = drill("false_constraint=1")
    check("false_constraint enters LOCKDOWN", profile()["dialog_state"] == "LOCKDOWN", str(p))
    rest("PATCH", f"/profiles?id=eq.{LIVE['uid']}",
         {"lockdown_started_at": (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()},
         prefer="return=minimal")
    p = drill()
    check("the 24h breaker exits lazily", profile()["dialog_state"] == "OPEN" and p["lockdown"]["exit"] is True, str(p))

    drill("give_up=1")
    p = drill("severity=S1")
    check("a journal S1 exits lockdown", profile()["dialog_state"] == "OPEN" and p["lockdown"]["exit"] is True, str(p))

    drill("give_up=1")
    rest("PATCH", f"/profiles?id=eq.{LIVE['uid']}",
         {"lockdown_started_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()},
         prefer="return=minimal")
    p = drill("give_up=1")
    prof = profile()
    check("re-entry refreshes the clock without a second entry",
          p["lockdown"]["refresh_started_at"] is True and p["lockdown"]["enter"] is False, str(p))
    check("re-entry keeps LOCKDOWN", prof["dialog_state"] == "LOCKDOWN")
    check("re-entry moved lockdown_started_at forward", prof["lockdown_started_at"] > (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat())
    drill("concession=1")

    print("== E. live: habit transitions + the strike job ==")
    today = local_today(profile()["timezone"] or "UTC")
    status, body = rest("POST", "/habits", {
        "user_id": LIVE["uid"],
        "description": f"{DRILL} — drill habit (concession/watch path)",
        "status": "confronted",
        "watch_days": 7,
    })
    if status not in (200, 201) or not body:
        raise RuntimeError(f"drill habit insert failed: {status} {body}")
    habit_id = body[0]["id"]
    LIVE["ids"]["habits"].append(habit_id)

    p = drill("concession=1")
    habit = one(f"/habits?select=status,watch_started_at,strike_at&id=eq.{habit_id}")
    check("concession moves a confronted habit to watch", habit["status"] == "watch", str(habit))
    check("the watch starts today", habit["watch_started_at"] == today, str(habit))
    check("strike_at is watch_start + 7 days", habit["strike_at"] == (datetime.fromisoformat(today) + timedelta(days=7)).date().isoformat(), str(habit))
    jobs = rows(f"/jobs?select=id,type,next_retry_at,status,payload&type=eq.strike_fire&payload->>habit_id=eq.{habit_id}")
    check("a pending strike_fire job is scheduled", len(jobs) == 1 and jobs[0]["status"] == "pending", str(jobs))
    check("the job carries the habit id", jobs and jobs[0]["payload"].get("habit_id") == habit_id)
    LIVE["ids"]["jobs"].extend(j["id"] for j in jobs)

    p = drill("quit_commitment=1")
    check("quit_commitment cancels a watching habit", one(f"/habits?select=status&id=eq.{habit_id}")["status"] == "quit_committed", str(p))

    print("== F. live: the journal contract + apply (stub extraction) ==")
    set_config("llm_stub_mode", True)
    status, body = rest("POST", "/journal_entries", {
        "user_id": LIVE["uid"],
        "content": f"{DRILL} — drill journal entry (stub extraction). I kept skipping the gym again this week.",
        "entry_date": today,
    })
    if status not in (200, 201) or not body:
        raise RuntimeError(f"drill journal insert failed: {status} {body}")
    entry_id = body[0]["id"]
    LIVE["ids"]["entries"].append(entry_id)

    before = profile()["trust_score"]
    status, body = smoke(f"action=journal-drill&entry_id={entry_id}&leg=extract")
    check("journal-drill extract returns 200", status == 200, str(body))
    after = profile()["trust_score"]
    check("the journal extraction applies +1 openness (stub)", after == before + 1, f"{before} -> {after}")
    latest = trust_events()[0]
    check("the journal event is openness/+1", latest["reason"] == "openness" and latest["delta"] == 1, str(latest))
    marker = one(f"/journal_entries?select=vagueness_score,severity,habit_flag&id=eq.{entry_id}")
    check("the marker writes vagueness + severity", marker["vagueness_score"] is not None and marker["severity"] == "S3", str(marker))
    check("the marker writes habit_flag from the stub contract", marker["habit_flag"] is False, str(marker))
    facts = rows(f"/memory_facts?select=id&source_journal_id=eq.{entry_id}")
    check("the journal chain still writes its facts", len(facts) >= 1, str(facts))
    LIVE["ids"]["jobs"].extend(j["id"] for j in rows(f"/jobs?select=id&payload->>entry_id=eq.{entry_id}"))
    anchored = rows(f"/messages?select=id&user_id=eq.{LIVE['uid']}&metadata->>entry_id=eq.{entry_id}")
    check("leg=extract writes no anchor_plan message", not anchored, str(anchored))

    print("== G. live: the chip tap override ==")
    LIVE["persona"] = one(f"/persona_stats?select=user_overrides,band_shift&user_id=eq.{LIVE['uid']}&domain=eq.Career")
    cli = str(uuid.uuid4())
    status, body = rest("POST", "/messages", {
        "user_id": LIVE["uid"], "role": "user", "content": f"{DRILL} — chip tap user turn",
        "client_message_id": cli,
    })
    if status not in (200, 201) or not body:
        raise RuntimeError(f"drill user message insert failed: {status} {body}")
    user_msg = body[0]["id"]
    LIVE["ids"]["messages"].append(user_msg)

    status, body = rest("POST", "/messages", {
        "user_id": LIVE["uid"], "role": "assistant", "content": f"{DRILL} — chip options",
        "reply_to_message_id": user_msg,
        "metadata": {"domain": "Career", "persona_options": [
            {"key": "mentor_tough", "label": "Tough Mentor", "one_liner": "Direct, accountability-focused"},
            {"key": "trainer", "label": "Trainer", "one_liner": "Structured, progressive"},
        ]},
    })
    if status not in (200, 201) or not body:
        raise RuntimeError(f"drill option message insert failed: {status} {body}")
    option_msg = body[0]["id"]
    LIVE["ids"]["messages"].append(option_msg)

    overrides_before = int((LIVE["persona"] or {}).get("user_overrides") or 0)
    band_before = float((LIVE["persona"] or {}).get("band_shift") or 0)
    events_before = len(trust_events())

    status, body = req("POST", "/functions/v1/select-persona",
                       {"message_id": option_msg, "persona_key": "mentor_tough"},
                       token=LIVE["jwt"], key=LIVE["anon"])
    check("select-persona consumes the tap (200 ok)", status == 200, str(body))
    stat = one(f"/persona_stats?select=user_overrides,band_shift&user_id=eq.{LIVE['uid']}&domain=eq.Career")
    check("user_overrides increments by one", int(stat["user_overrides"]) == overrides_before + 1, str(stat))
    check("band_shift drops by 0.02 (floor -0.10)",
          abs(float(stat["band_shift"]) - max(-0.10, band_before - 0.02)) < 1e-6, f"{band_before} -> {stat['band_shift']}")
    events = trust_events()
    check("an override audit row is written", len(events) == events_before + 1)
    check("the audit row is override/0", events[0]["reason"] == "override" and events[0]["delta"] == 0, str(events[0]))

    status, body = req("POST", "/functions/v1/select-persona",
                       {"message_id": option_msg, "persona_key": "mentor_tough"},
                       token=LIVE["jwt"], key=LIVE["anon"])
    check("a second tap is duplicate", status == 200 and body.get("status") == "duplicate", str(body))
    stat = one(f"/persona_stats?select=user_overrides&user_id=eq.{LIVE['uid']}&domain=eq.Career")
    check("a duplicate tap does not increment again", int(stat["user_overrides"]) == overrides_before + 1, str(stat))

    print("== H. live: the chat call site (stub route, rider probe) ==")
    before = profile()["trust_score"]
    events_before = len(trust_events())
    status, body = smoke(f"action=pipeline&user={LIVE['uid']}&rider=1&classifier=stub")
    check("pipeline&rider=1 returns 200", status == 200, str(body)[:400])
    probe = (body or {}).get("riderProbe") or {}
    check("the chat path reaches applyTrustRider", probe.get("applied") is True, str(probe))
    check("the neutral stub turn writes no score", probe.get("trust_before") == before and probe.get("trust_after") == before, str(probe))
    check("the neutral stub turn writes no event", len(trust_events()) == events_before, f"{events_before}")


def cleanup(verbose=False):
    if not LIVE.get("url"):
        return
    uid = LIVE["uid"]
    ids = LIVE["ids"]

    set_config("llm_stub_mode", LIVE.get("stub") if LIVE.get("stub") is not None else False)

    for entry_id in ids["entries"]:
        # facts first (the FK is ON DELETE SET NULL), then the entry's jobs, then the entry.
        rest("DELETE", f"/memory_facts?source_journal_id=eq.{entry_id}", prefer="return=minimal")
        rest("DELETE", f"/jobs?payload->>entry_id=eq.{entry_id}", prefer="return=minimal")
        rest("DELETE", f"/journal_entries?id=eq.{entry_id}", prefer="return=minimal")
    for habit_id in ids["habits"]:
        rest("DELETE", f"/jobs?payload->>habit_id=eq.{habit_id}", prefer="return=minimal")
        rest("DELETE", f"/habits?id=eq.{habit_id}", prefer="return=minimal")
    for job_id in ids["jobs"]:
        rest("DELETE", f"/jobs?id=eq.{job_id}", prefer="return=minimal")
    for message_id in ids["messages"]:
        rest("DELETE", f"/messages?secondary_reply_to_message_id=eq.{message_id}", prefer="return=minimal")
        rest("DELETE", f"/messages?reply_to_message_id=eq.{message_id}", prefer="return=minimal")
        rest("DELETE", f"/messages?id=eq.{message_id}", prefer="return=minimal")

    # Persona stats: restore the pre-run row or remove the one the drill created.
    if LIVE.get("persona") is not None:
        rest("PATCH", f"/persona_stats?user_id=eq.{uid}&domain=eq.Career",
             {"user_overrides": LIVE["persona"]["user_overrides"],
              "band_shift": LIVE["persona"]["band_shift"]},
             prefer="return=minimal")
    else:
        rest("DELETE", f"/persona_stats?user_id=eq.{uid}&domain=eq.Career", prefer="return=minimal")

    # Drill trust_events: everything not in the pre-run whitelist.
    before = LIVE.get("before_events") or set()
    new_ids = [e["id"] for e in trust_events() if e["id"] not in before]
    for i in range(0, len(new_ids), 40):
        chunk = ",".join(new_ids[i:i + 40])
        rest("DELETE", f"/trust_events?id=in.({chunk})", prefer="return=minimal")

    if LIVE.get("state"):
        patch_profile(LIVE["state"])

    if verbose:
        prof = profile()
        check("cleanup restores the owner's trust/dialog state",
              prof["trust_score"] == LIVE["state"]["trust_score"]
              and prof["dialog_state"] == LIVE["state"]["dialog_state"], str(prof))
        check("cleanup leaves no drill trust_events", set(e["id"] for e in trust_events()) == before)
        leftovers = {}
        for table, key in (("habits", "habits"), ("journal_entries", "entries"), ("messages", "messages")):
            if ids[key]:
                leftovers[table] = rows(f"/{table}?select=id&id=in.(" + ",".join(ids[key]) + ")")
        check("cleanup removes the drill habits/entries/messages",
              all(len(v) == 0 for v in leftovers.values()), str(leftovers))
        check("cleanup restores llm_stub_mode", get_config("llm_stub_mode") == LIVE["stub"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true", help="skip the network legs")
    ap.add_argument("--no-toolchain", action="store_true", help="skip tsc/jest/deno/earlier gates")
    args = ap.parse_args()

    print("== FP-08 Step 3: the D20 rider wiring ==")
    static_checks()
    if not args.no_toolchain:
        toolchain_checks()

    if not args.static_only:
        print("== C. live ==")
        live_setup()
        try:
            live_checks()
        finally:
            cleanup(verbose=True)

    print()
    if FAILS:
        print(f"FAIL: FP-08 Step 3 — {len(FAILS)} check(s) failed")
        for name in FAILS:
            print(f"  - {name}")
        return 1
    print("PASS: FP-08 Step 3")
    return 0


if __name__ == "__main__":
    sys.exit(main())
