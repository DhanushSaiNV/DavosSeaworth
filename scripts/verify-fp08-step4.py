#!/usr/bin/env python3
"""FP-08 Step 4 gate -- lockdown override, oath request/capture (D26), breakdown trigger.

Covers PLAN Step 4 Verify: "the script green; the golden byte-identity tests green (OPEN
turns unchanged -- the hard floor for this step); FP-04's intervention gates green; static
asserts -- the override branch cannot alter an OPEN turn's persona/rule query (branch
coverage in the prompt-builder tests), delimiters present in every new context build."

Static
  pure       : `_shared/accountability/interventions.ts` imports nothing; the Step 2 floor holds
  lockdown   : turn-start read (lazy breaker) before stage 1; the rider's own decision wins;
               forced persona/route; the domain-set retrieval; the gated prompt block
  oath       : send-message calls `maybeRequestOath` with the pre-rider score; the confirm is
               validated BEFORE the user row lands; capture reuses the turn embedding and is
               claim-first; D26 is recorded and FR-10/AC-4 carry it
  breakdown  : trigger post-stage-2, chat-only, pre-rider score, unshifted High band, any
               dialog state; dispatch requires a window only for `missed_checkin`
  delimiters : the new context builders carry the named delimiters

Toolchain
  tsc / full jest / deno check + the FP-03 / FP-04 / FP-05 static gates

Live (network; skipped by --static-only)
  lockdown   : OPEN baseline; entry -> forced confrontation + accountability-only rules;
               domain mismatch -> redirect; lazy breaker exit; concession exit; S1 exit
  oath       : 69 -> no job, 70 -> one job, a second admission in cooldown -> none;
               the demand row; the confirmed capture (verbatim, embedded, consumed);
               a plain next message captures nothing; late flag does not purge
  breakdown  : 69 -> no job, 70 -> one job; the handler's aggregates + delimited oath; row

Every live leg cleans up: the owner's trust/dialog state, drill messages/facts/jobs, any
drill trust_events and `llm_stub_mode` are restored.

Usage: python scripts/verify-fp08-step4.py [--static-only] [--no-toolchain]
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
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
ACC = "supabase/functions/_shared/accountability"
APPLY = f"{ACC}/applyRider.ts"
INTERV = f"{ACC}/interventions.ts"
PIPELINE = "supabase/functions/_shared/pipeline/runPipeline.ts"
GENERATE = "supabase/functions/_shared/pipeline/generate.ts"
SEND = "supabase/functions/send-message/index.ts"
WATCHDOG = "supabase/functions/_shared/checkin/runWatchdog.ts"
DISPATCH = "supabase/functions/job-dispatcher/index.ts"
SMOKE = "supabase/functions/dev-smoke/index.ts"
FP08 = "docs/feature-prds/FP-08/FP-08.md"
DECISIONS = "docs/adr/decisions2.md"
TECH = "docs/TECH-SPEC.md"

FAILS = []

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
    cmd = ["cmd", "/c", *args] if (shell and os.name == "nt") else args
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


def smoke(path):
    return req("POST", "/functions/v1/dev-smoke?" + path, token=LIVE["smoke"], key=LIVE["smoke"])


def drill(params=""):
    status, body = smoke(f"action=accountability-drill&user={LIVE['uid']}" + ("&" + params if params else ""))
    if status != 200:
        raise RuntimeError(f"accountability-drill -> {status}: {body}")
    return body["probe"]


def insert_message(content, metadata=None):
    status, body = rest("POST", "/messages", {
        "user_id": LIVE["uid"], "role": "user", "content": content,
        "metadata": metadata or {"source": "drill_fp08_step4"},
    })
    if status not in (200, 201):
        raise RuntimeError(f"message insert failed: {status} {body}")
    LIVE["ids"]["messages"].append(body[0]["id"])
    return body[0]["id"]


def jobs_for_source(source_id, reason=None):
    q = (f"/jobs?select=id,type,status,payload,created_at&payload->>source_message_id=eq.{source_id}")
    if reason:
        q += f"&payload->>reason=eq.{reason}"
    return rows(q)


def pipeline_leg(params):
    status, body = smoke(f"action=pipeline&user={LIVE['uid']}&rider=1&classifier=stub&" + params)
    if status != 200:
        raise RuntimeError(f"pipeline drill -> {status}: {body}")
    return body


def mark_job_done(job_id):
    rest("PATCH", f"/jobs?id=eq.{job_id}", {"status": "done"}, prefer="return=minimal")


# ---------------------------------------------------------------------------
# A. static
# ---------------------------------------------------------------------------


def static_checks():
    print("== A. static surface ==")
    interv_src = read(INTERV)
    apply_src = read(APPLY)
    pipeline_src = read(PIPELINE)
    gen_src = read(GENERATE)
    send_src = read(SEND)
    dog_src = read(WATCHDOG)
    dispatch_src = read(DISPATCH)
    smoke_src = read(SMOKE)
    fp08_src = read(FP08)
    decisions_src = read(DECISIONS)
    tech_src = read(TECH)

    for rel, src in ((INTERV, interv_src), (APPLY, apply_src), (PIPELINE, pipeline_src),
                     (GENERATE, gen_src), (SEND, send_src), (WATCHDOG, dog_src),
                     (DISPATCH, dispatch_src), (SMOKE, smoke_src)):
        check(f"{rel} exists", bool(src))

    # Purity: interventions.ts imports nothing; the Step 2 eight still do.
    unit = re.sub(r"//.*", "", interv_src)
    unit = re.sub(r"/\*.*?\*/", "", unit, flags=re.S)
    check("interventions.ts has zero imports", not re.search(r"^\s*import\s", unit, re.M))
    offenders = []
    for name in ("rider", "streak", "lockdown", "habits", "quests", "strike", "histogram", "templates"):
        src = read(f"{ACC}/{name}.ts")
        if re.search(r"^\s*import\s", src, re.M):
            offenders.append(name)
    check("the Step 2 pure modules still import nothing", not offenders, f"{offenders}")

    # Lockdown override.
    read_pos = pipeline_src.find("readTurnDialogState(")
    embed_pos = pipeline_src.find("const embedPromise = embed(")
    check("the turn-start dialog read runs before stage 1", -1 < read_pos < embed_pos,
          f"read {read_pos}, embed {embed_pos}")
    check("the rider's own decision wins over the turn-start read",
          "riderDialog ?? turnDialog?.state" in pipeline_src
          and "const riderDialog = riderProbe?.dialog_state;" in pipeline_src)
    check("the override forces the confrontation persona and the direct route",
          "persona: LOCKDOWN_PERSONA" in pipeline_src and 'route: "auto"' in pipeline_src)
    check("the account of the domain set is the lockdown helper", "effectiveDomain(" in pipeline_src
          and "buildRedirectInstruction(" in pipeline_src)
    check("retrieval queries every accountability domain",
          "retrieveLockdownRules(" in pipeline_src and "Promise.all(" in pipeline_src)
    check("the locked prompt block is gated on the effective state",
          "lockdownProbe?.active && userId" in pipeline_src
          and "buildLockdownContext({" in pipeline_src)
    check("generateReply only appends the block when present",
          "if (input.lockdownContext)" in gen_src
          and gen_src.index("if (input.lockdownContext)") < gen_src.index("return withMemoryContext("))
    check("OPEN turns never build the block (undefined, not empty string)",
          "lockdownContext," in pipeline_src)

    # Breakdown trigger.
    cls_pos = pipeline_src.find("const classification: Classification")
    trig_pos = pipeline_src.find("shouldTriggerBreakdown({")
    stage4_pos = pipeline_src.find("// Stage 4")
    check("the breakdown trigger is post-stage-2 and pre-stage-4",
          -1 < cls_pos < trig_pos < stage4_pos, f"classify {cls_pos}, trigger {trig_pos}, stage4 {stage4_pos}")
    check("the trigger is chat-only and needs the rider's pre-rider score",
          "opts.applyRider && userId && riderProbe?.applied" in pipeline_src)
    check("the trigger fires regardless of dialog_state",
          "dialogState" not in pipeline_src[trig_pos:stage4_pos])
    check("the trigger uses the unshifted High band", "readConfidenceBands()" in pipeline_src
          and "highBand: bands.high" in pipeline_src)
    check("the trigger enqueues one intervention job with the source id",
          'type: "intervention"' in pipeline_src and "reason: BREAKDOWN_REASON" in pipeline_src
          and "source_message_id: opts.sourceMessageId ?? null" in pipeline_src)

    # Oath trigger + capture.
    check("send-message calls the oath helper", "maybeRequestOath({" in send_src)
    check("the oath gate reads the PRE-rider score",
          "trustBefore: result.riderProbe?.trust_before ?? null" in send_src)
    check("the oath gate reads the extraction admission flag",
          "extraction?.intent_flags?.admission === true" in send_src)
    validate_pos = send_src.find("await validateOathConfirmation(")
    upsert_pos = send_src.find('from("messages")\n        .upsert(')
    if upsert_pos == -1:
        upsert_pos = send_src.find(".upsert(")
    check("the confirm is validated before the user row lands",
          -1 < validate_pos < upsert_pos, f"validate {validate_pos}, upsert {upsert_pos}")
    check("capture requires the confirm flag AND a request id",
          "const oathConfirmed = body.oath_confirmed === true;" in send_src
          and "oath_request_id must be a uuid when oath_confirmed is set" in send_src)
    check("the request must be the immediately preceding assistant row",
          'order("created_at", { ascending: false })' in send_src
          and 'last.role !== "assistant"' in send_src)
    check("the request must be unconsumed", 'meta.consumed === true' in send_src)
    check("capture reuses the turn embedding (no provider call)",
          "embedding: result.messageEmbedding" in send_src and 'from("llm/' not in send_src)
    check("capture is claim-first (consumed before the fact insert)",
          send_src.index('.is("metadata->>consumed", null)') < send_src.index('from("memory_facts").insert('))
    check("one oath fact per turn (fresh-insert branch only)",
          "if (freshInsert && oathRequestToConsume)" in send_src)
    check("the trigger runs only on the fresh-insert branch",
          "if (freshInsert) {" in send_src and "await maybeRequestOath({" in send_src)

    # Handler branches.
    check("runIntervention branches on both new reasons",
          "args.reason === OATH_REQUEST_REASON" in dog_src and "args.reason === BREAKDOWN_REASON" in dog_src)
    check("the oath branch refuses flagged source text",
          'source.unsavable === true' in dog_src and 'return { status: "skipped", reason: "unsavable" }' in dog_src)
    check("the oath demand is an unprompted row",
          'source: OATH_REQUEST_REASON' in dog_src and "oath_request: true" in dog_src)
    check("the breakdown handler reads the latest unpurged oath",
          'eq("fact_type", "oath")' in dog_src and 'is("purged_at", null)' in dog_src)
    check("the breakdown handler aggregates check-ins, windows, metrics and streak",
          all(k in dog_src for k in ('source === "checkin_reply"', "windowsClosedBetween(",
                                     "metric_points", "streakDays(")))
    check("the new branches generate through the locked-persona path",
          dog_src.count("runLockedPersonaReply({") >= 3)
    check("both new rows carry their source for idempotency",
          dog_src.count("source_message_id: sourceId") >= 2)
    window_guard = "reason === MISSED_CHECKIN_REASON && !windowIso"
    check("the dispatch requires a window only for missed_checkin", window_guard in dispatch_src)
    check("the dispatch forwards the source id",
          "sourceMessageId: asString(payload.source_message_id) ?? null" in dispatch_src)

    # Dev drills drive the production helpers.
    check("dev-smoke registers both new drills",
          '"oath-trigger-drill"' in smoke_src and '"intervention-drill"' in smoke_src)
    check("oath-trigger-drill calls maybeRequestOath", "await maybeRequestOath({" in smoke_src)
    check("intervention-drill calls runIntervention", "await runIntervention({" in smoke_src)
    check("the pipeline drill forwards source_message_id",
          'sourceMessageId: url.searchParams.get("source_message_id") ?? undefined' in smoke_src)

    # Delimiters.
    for tag in ("user_admission", "user_claim", "user_oath", "evidence"):
        check(f"the {tag} delimiter is built", f'delimit("{tag}"' in interv_src)

    # Docs.
    check("D26 is recorded", "Decision 26" in decisions_src and "Confirm affordance" in decisions_src)
    check("FR-10 carries the confirm affordance", "D26 confirm affordance" in fp08_src)
    check("AC-4 carries the confirm leg", "a plain next message without the confirm fields" in fp08_src)
    check("TECH-SPEC §5.4 records D26", "explicit confirm affordance (D26)" in tech_src)
    check("TECH-SPEC records the Step 4 as-built", "As built (FP-08 Step 4)" in tech_src)


def toolchain_checks():
    print("== B. toolchain + earlier gates ==")
    if not os.path.exists(os.path.join(ROOT, "node_modules")):
        skip("tsc/jest", "node_modules missing")
    else:
        rc, out = run(["npx", "tsc", "--noEmit"], shell=True)
        check("tsc --noEmit is clean", rc == 0, out[-1500:])
        rc, out = run(["npx", "jest", "--ci"], shell=True)
        check("the full jest suite is green (byte-identity golden included)", rc == 0, out[-1500:])
        match = re.search(r"Tests:\s+(\d+) passed, (\d+) total", out)
        check("jest ran the whole suite", bool(match) and int(match.group(1)) >= 700,
              match.group(0) if match else "no summary")

    rc, out = run(["deno", "check",
                   "supabase/functions/_shared/accountability/interventions.ts",
                   "supabase/functions/_shared/accountability/applyRider.ts",
                   "supabase/functions/_shared/pipeline/runPipeline.ts",
                   "supabase/functions/_shared/pipeline/generate.ts",
                   "supabase/functions/_shared/checkin/runWatchdog.ts",
                   "supabase/functions/send-message/index.ts",
                   "supabase/functions/job-dispatcher/index.ts",
                   "supabase/functions/dev-smoke/index.ts"])
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
    LIVE.update({"ids": {"messages": [], "jobs": []}, "before_events": set(), "state": None,
                 "stub": None, "since": datetime.now(timezone.utc).isoformat()})


def send_message(content, extra=None):
    body = {"content": content, "client_message_id": str(uuid.uuid4())}
    if extra:
        body.update(extra)
    return req("POST", "/functions/v1/send-message", body,
               token=LIVE["jwt"], key=LIVE["anon"])


def live_checks():
    print("== C. live: lockdown override ==")
    prof = profile()
    LIVE["state"] = {k: prof[k] for k in ("trust_score", "dialog_state", "lockdown_started_at")}
    LIVE["stub"] = get_config("llm_stub_mode")
    LIVE["before_events"] = {e["id"] for e in trust_events()}
    print(f"  ..   owner state: trust={prof['trust_score']} dialog={prof['dialog_state']} "
          f"stub_mode={LIVE['stub']}")

    if not LIVE["stub"]:
        set_config("llm_stub_mode", True)

    patch_profile({"trust_score": 50, "dialog_state": "OPEN", "lockdown_started_at": None})

    # OPEN baseline: no block, normal persona.
    base = pipeline_leg("force=high&emotion=determined&domain=Career")
    probe = base.get("lockdownProbe") or {}
    check("OPEN: the lockdown probe is inactive", probe.get("active") is False, str(probe)[:300])
    check("OPEN: the persona is not confrontation",
          base.get("routeInfo", {}).get("persona") != "confrontation", str(base.get("routeInfo", {}).get("persona")))

    # Entry.
    entry = drill("give_up=1")
    check("give_up enters lockdown", entry["trust_after"] == 50 and profile()["dialog_state"] == "LOCKDOWN", str(entry))

    locked = pipeline_leg("force=high&emotion=determined&domain=Career")
    lprobe = locked.get("lockdownProbe") or {}
    info = locked.get("routeInfo") or {}
    check("LOCKDOWN: the probe is active", lprobe.get("active") is True, str(lprobe)[:300])
    check("LOCKDOWN: persona forced confrontation", info.get("persona") == "confrontation", str(info.get("persona")))
    check("LOCKDOWN: route forced auto", info.get("route") == "auto", str(info.get("route")))
    check("LOCKDOWN: an in-set domain queries only that domain",
          lprobe.get("domains") == ["Career"], str(lprobe.get("domains")))
    check("LOCKDOWN: no redirect when the domain is inside the set",
          lprobe.get("redirect") is None, str(lprobe.get("redirect")))
    rule_ids = info.get("ruleIds") or []
    if rule_ids:
        rule_rows = rows("/rules?select=id,domain&id=in.(" + ",".join(rule_ids) + ")")
        check("LOCKDOWN: every retrieved rule is inside the accountability set",
              all(r["domain"] in ("Career", "Discipline/Habits") for r in rule_rows), str(rule_rows))
    else:
        skip("LOCKDOWN: rule-domain check", "no rules seeded for the owner")

    # Domain mismatch -> deterministic redirect.
    mismatch = pipeline_leg("force=high&emotion=determined&domain=Finance")
    mprobe = mismatch.get("lockdownProbe") or {}
    check("LOCKDOWN: a mismatched domain queries the whole set",
          mprobe.get("domains") == ["Career", "Discipline/Habits"], str(mprobe.get("domains")))
    check("LOCKDOWN: a mismatched domain yields a redirect instruction",
          isinstance(mprobe.get("redirect"), str) and "Finance" in mprobe["redirect"], str(mprobe.get("redirect")))
    check("LOCKDOWN: the mismatch still forces confrontation",
          (mismatch.get("routeInfo") or {}).get("persona") == "confrontation")

    # Lazy breaker: 25 h old -> this turn exits and answers OPEN.
    started = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    patch_profile({"dialog_state": "LOCKDOWN", "lockdown_started_at": started})
    broken = pipeline_leg("force=high&emotion=determined&domain=Career")
    bprobe = broken.get("lockdownProbe") or {}
    check("breaker: the turn-start read exits",
          bprobe.get("active") is False and bprobe.get("breakerExited") is True, str(bprobe)[:300])
    check("breaker: the DB is left OPEN", profile()["dialog_state"] == "OPEN")
    check("breaker: the persona is normal again",
          (broken.get("routeInfo") or {}).get("persona") != "confrontation")

    # Concession exit.
    patch_profile({"dialog_state": "LOCKDOWN", "lockdown_started_at": datetime.now(timezone.utc).isoformat()})
    conceded = drill("concession=1")
    check("concession exits lockdown", conceded["lockdown"]["exit"] is True and profile()["dialog_state"] == "OPEN", str(conceded["lockdown"]))
    after_concession = pipeline_leg("force=high&emotion=determined&domain=Career")
    check("concession: the same-turn pipeline is not confrontational",
          (after_concession.get("lockdownProbe") or {}).get("active") is False)

    # S1 exit.
    patch_profile({"dialog_state": "LOCKDOWN", "lockdown_started_at": datetime.now(timezone.utc).isoformat()})
    s1 = drill("severity=S1")
    check("S1 exits lockdown", s1["lockdown"]["exit"] is True and profile()["dialog_state"] == "OPEN", str(s1["lockdown"]))

    print("== D. live: oath trigger + demand + capture (D26) ==")
    patch_profile({"trust_score": 69, "dialog_state": "OPEN", "lockdown_started_at": None})
    source_a = insert_message("I keep telling people I am fine when I am not, and I am done pretending.")
    LIVE["oath_source"] = source_a

    status, body = smoke(f"action=oath-trigger-drill&user={LIVE['uid']}&trust_before=69&admission=1&source_message_id={source_a}")
    check("oath trigger drill returns 200", status == 200, str(body)[:300])
    check("69: no oath request", (body or {}).get("requested") is False and (body or {}).get("reason") == "gate", str(body))
    check("69: no job written", jobs_for_source(source_a, "oath_request") == [])

    patch_profile({"trust_score": 70})
    status, body = smoke(f"action=oath-trigger-drill&user={LIVE['uid']}&trust_before=70&admission=1&source_message_id={source_a}")
    check("70: one oath request job", (body or {}).get("requested") is True, str(body))
    trigger_jobs = jobs_for_source(source_a, "oath_request")
    check("70: the job carries the reason + source",
          len(trigger_jobs) == 1 and trigger_jobs[0]["type"] == "intervention", str(trigger_jobs))

    source_b = insert_message("A second admission inside the cooldown window.")
    LIVE["ids"]["messages"].append(source_b)
    status, body = smoke(f"action=oath-trigger-drill&user={LIVE['uid']}&trust_before=70&admission=1&source_message_id={source_b}")
    check("cooldown: a second admission writes no request",
          (body or {}).get("requested") is False and (body or {}).get("reason") == "cooldown", str(body))

    if trigger_jobs:
        mark_job_done(trigger_jobs[0]["id"])

    status, body = smoke(f"action=intervention-drill&user={LIVE['uid']}&reason=oath_request&source_message_id={source_a}")
    outcome = (body or {}).get("outcome") or {}
    check("oath handler writes the demand row", status == 200 and outcome.get("status") == "written", str(body)[:400])
    context = outcome.get("context") or ""
    check("the demand context carries the delimited admission",
          "<user_admission>" in context and "done pretending" in context, context[:300])
    request = one(f"/messages?select=id,role,metadata,reply_to_message_id&user_id=eq.{LIVE['uid']}"
                  f"&metadata->>source=eq.oath_request&metadata->>source_message_id=eq.{source_a}")
    check("the demand row is unprompted and flagged for the affordance",
          bool(request) and request["role"] == "assistant" and request["reply_to_message_id"] is None
          and request["metadata"].get("oath_request") is True, str(request))
    if request:
        LIVE["ids"]["messages"].append(request["id"])
        LIVE["request"] = request["id"]

    oath_text = "I swear on my life that I will not stop improving, no matter how I feel."
    status, body = send_message(oath_text, {"oath_confirmed": True, "oath_request_id": LIVE.get("request")})
    check("the confirmed send returns 200", status == 200, str(body)[:400])
    check("the confirmed send is a fresh turn", (body or {}).get("status") in ("ok", "fresh"), str(body))
    confirm_user = (body or {}).get("user_message_id")
    confirm_reply = (body or {}).get("assistant_message_id")
    if confirm_user:
        LIVE["ids"]["messages"].append(confirm_user)
    if confirm_reply:
        LIVE["ids"]["messages"].append(confirm_reply)
    fact = one(f"/memory_facts?select=id,fact,fact_type,source_message_id,embed_model,purged_at"
               f"&user_id=eq.{LIVE['uid']}&source_message_id=eq.{confirm_user}")
    check("the oath fact exists verbatim", bool(fact) and fact["fact"] == oath_text, str(fact))
    check("the oath fact is fact_type='oath'", bool(fact) and fact["fact_type"] == "oath", str(fact))
    check("the oath fact reuses the frozen embedding stamp", bool(fact) and bool(fact["embed_model"]), str(fact))
    if fact:
        LIVE["ids"].setdefault("facts", []).append(fact["id"])
    refreshed = one(f"/messages?select=metadata&id=eq.{LIVE.get('request')}")
    check("the request is consumed with the message link",
          bool(refreshed) and refreshed["metadata"].get("consumed") is True
          and refreshed["metadata"].get("consumed_message_id") == confirm_user, str(refreshed))

    # A plain next message must not capture.
    status, body = send_message("Thanks. I will keep going.")
    plain_user = (body or {}).get("user_message_id")
    plain_reply = (body or {}).get("assistant_message_id")
    check("the plain follow-up is a fresh turn", status == 200 and (body or {}).get("status") in ("ok", "fresh"), str(body)[:300])
    if plain_user:
        LIVE["ids"]["messages"].append(plain_user)
    if plain_reply:
        LIVE["ids"]["messages"].append(plain_reply)
    facts_after = rows(f"/memory_facts?select=id&user_id=eq.{LIVE['uid']}&fact_type=eq.oath")
    check("a plain next message creates no oath fact",
          len([f for f in facts_after if f["id"] != (fact or {}).get("id")]) == 0, str(facts_after))

    # Late flag: the oath is exempt from the purge.
    if confirm_user:
        status, _ = req("POST", "/functions/v1/flag-unsavable", {"message_id": confirm_user},
                        token=LIVE["jwt"], key=LIVE["anon"])
        check("flag-unsavable accepts the late flag", status == 200, str(status))
        still = one(f"/memory_facts?select=id,purged_at&id=eq.{(fact or {}).get('id')}")
        check("a late flag does not purge the oath fact", bool(still) and still["purged_at"] is None, str(still))

    print("== E. live: breakdown trigger + aggregates ==")
    patch_profile({"trust_score": 69, "dialog_state": "OPEN", "lockdown_started_at": None})
    source_c = insert_message("I cannot do this anymore. I am exhausted and everything feels pointless.")
    LIVE["breakdown_source"] = source_c
    pipeline_leg(f"force=high&emotion=exhausted&domain=Career&source_message_id={source_c}")
    check("69: no breakdown job", jobs_for_source(source_c, "breakdown") == [])

    patch_profile({"trust_score": 70})
    pipeline_leg(f"force=high&emotion=exhausted&domain=Career&source_message_id={source_c}")
    bjobs = jobs_for_source(source_c, "breakdown")
    check("70: one breakdown job", len(bjobs) == 1, str(bjobs))
    status, body = smoke(f"action=intervention-drill&user={LIVE['uid']}&reason=breakdown&source_message_id={source_c}")
    outcome = (body or {}).get("outcome") or {}
    check("the breakdown handler writes its row", status == 200 and outcome.get("status") == "written", str(body)[:400])
    bcontext = outcome.get("context") or ""
    check("the breakdown context carries the aggregates",
          "check-in(s) logged" in bcontext and "of" in bcontext, bcontext[:300])
    check("the breakdown context carries the latest oath delimited",
          "<user_oath>" in bcontext and oath_text in bcontext, bcontext[:400])
    brow = one(f"/messages?select=id,metadata,reply_to_message_id&user_id=eq.{LIVE['uid']}"
               f"&metadata->>source=eq.breakdown&metadata->>source_message_id=eq.{source_c}")
    check("the breakdown row is unprompted and sourced",
          bool(brow) and brow["reply_to_message_id"] is None
          and brow["metadata"].get("source_message_id") == source_c, str(brow))
    if brow:
        LIVE["ids"]["messages"].append(brow["id"])
    for job in bjobs:
        LIVE["ids"]["jobs"].append(job["id"])


def cleanup(verbose=False):
    if not LIVE.get("url"):
        return
    ids = LIVE["ids"]
    message_ids = ids.get("messages") or []

    set_config("llm_stub_mode", LIVE.get("stub") if LIVE.get("stub") is not None else False)

    for fact_id in ids.get("facts") or []:
        rest("DELETE", f"/memory_facts?id=eq.{fact_id}", prefer="return=minimal")
    for message_id in message_ids:
        rest("DELETE", f"/memory_facts?source_message_id=eq.{message_id}", prefer="return=minimal")
    for message_id in message_ids:
        rest("DELETE", f"/messages?secondary_reply_to_message_id=eq.{message_id}", prefer="return=minimal")
        rest("DELETE", f"/messages?reply_to_message_id=eq.{message_id}", prefer="return=minimal")
    for message_id in message_ids:
        rest("DELETE", f"/messages?id=eq.{message_id}", prefer="return=minimal")
    for job_id in ids.get("jobs") or []:
        rest("DELETE", f"/jobs?id=eq.{job_id}", prefer="return=minimal")
    for source_id in (LIVE.get("oath_source"), LIVE.get("breakdown_source")):
        if source_id:
            rest("DELETE", f"/jobs?payload->>source_message_id=eq.{source_id}", prefer="return=minimal")

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
        leftovers = {}
        if message_ids:
            leftovers["messages"] = rows("/messages?select=id&id=in.(" + ",".join(message_ids) + ")")
        check("cleanup removes the drill messages",
              all(len(v) == 0 for v in leftovers.values()), str(leftovers))
        check("cleanup restores llm_stub_mode", get_config("llm_stub_mode") == LIVE["stub"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true", help="skip the network legs")
    ap.add_argument("--no-toolchain", action="store_true", help="skip tsc/jest/deno/earlier gates")
    args = ap.parse_args()

    print("== FP-08 Step 4: lockdown + oath + breakdown ==")
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
        print(f"FAILED ({len(FAILS)}): " + "; ".join(FAILS))
        sys.exit(1)
    print("ALL PASS")


if __name__ == "__main__":
    main()
