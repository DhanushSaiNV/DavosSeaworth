#!/usr/bin/env python3
"""FP-09 Step 3 gate -- the onboarding send-message branch (flag, apply, override, advance,
skips) plus the dev-smoke drill legs.

Refs: FP-09 FR-4, FR-5, AC-2, AC-3; TECH-SPEC §4.3, §5.1, §5.3, §7.6, §7.7; D8, D17,
D20, D21.

Static
  send-message : reads the stage before the D8 counter, skips the recorder during intake,
                 stamps source + stage, passes the prepared context into runPipeline, applies
                 the block, advances by compare-and-set, and asks no oath during intake
  runPipeline  : flags stage 1, forces route/persona, skips dialog/rider/breakdown, skips
                 rule retrieval, passes omitRules + interviewContext, keeps memory
  prompt       : the unflagged branch still renders the rules block; the interview branch
                 omits it and carries no habit/watch/impulse vocabulary
  auto-adopt   : both the check-in and onboarding sources are transparent
  apply        : profile writes, baseline facts with source provenance, stage CAS, reset
  dev-smoke    : onboarding-drill advance/reset/apply legs
  toolchain    : tsc, deno check, jest, eslint (optional --no-toolchain)

Live (network; skipped by --static-only)
  opening      : a fresh user at intro has exactly one DRAFT opening row
  intro        : one answer advances to baseline once; a replay is a duplicate and does not
                 double the advance
  resume       : close mid-stage, send again, the stamped count resumes
  apply        : 06:30 writes wake_time + routine; a malformed time warns and leaves the
                 prior value intact; baseline facts carry source_message_id
  metric       : the routine boundary proposes three chips; a metric_selection free-text
                 turn re-offers the identical list
  intake clean : zero trust_events / persona_stats writes across the whole interview
  complete     : a complete turn is ordinary chat; the rider applies normally after intake
  reset        : the drill deletes onboarding rows, resets the profile and plants one new
                 opening row

Usage: python scripts/verify-fp09-step3.py [--static-only] [--no-toolchain]
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
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
FAILS = []
LIVE = {}

SEND = "supabase/functions/send-message/index.ts"
PIPELINE = "supabase/functions/_shared/pipeline/runPipeline.ts"
GENERATE = "supabase/functions/_shared/pipeline/generate.ts"
PROMPT = "supabase/functions/_shared/pipeline/generatePrompt.ts"
STATE = "supabase/functions/_shared/onboarding/state.ts"
APPLY = "supabase/functions/_shared/onboarding/apply.ts"
AUTO = "supabase/functions/_shared/pipeline/autoAdopt.ts"
SMOKE = "supabase/functions/dev-smoke/index.ts"


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


def run(cmd, timeout=900):
    proc = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


# --------------------------------------------------------------------------- REST


def req(method, path, body=None, token=None, key=None, headers=None, timeout=120):
    h = {"Content-Type": "application/json"}
    if key:
        h["apikey"] = key
    if token:
        h["Authorization"] = f"Bearer {token}"
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
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


def service_req(method, path, body=None, prefer=None):
    headers = {"Prefer": prefer} if prefer else None
    return req(method, "/rest/v1" + path, body, token=LIVE["service"], key=LIVE["service"],
               headers=headers)


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


def message(message_id):
    return one(f"/messages?select=id,role,content,metadata,reply_to_message_id,persona_key"
               f"&id=eq.{message_id}")


def profile():
    return one("/profiles?select=id,onboarding_stage,wake_time,sleep_time,routine,"
               "high_dopamine_activities,trust_score,dialog_state"
               f"&id=eq.{LIVE['uid']}")


def config_value(key):
    row = one(f"/config?select=key,value&key=eq.{key}")
    return row["value"] if row else None


def set_config(key, value):
    patch(f"/config?key=eq.{key}", {"value": value})


def count_events(table, extra=""):
    # Both tables have user_id; persona_stats is keyed by (user_id, domain) and has no id.
    return len(rows(f"/{table}?select=user_id&user_id=eq.{LIVE['uid']}{extra}"))


def opening_rows():
    return rows(f"/messages?select=id,role,content,metadata,persona_key&user_id=eq.{LIVE['uid']}"
                "&metadata->>source=eq.onboarding_opening")


def onboarding_rows(role=None, stage=None):
    q = (f"/messages?select=id,role,content,metadata,reply_to_message_id,persona_key"
         f"&user_id=eq.{LIVE['uid']}&metadata->>source=eq.onboarding")
    if role:
        q += f"&role=eq.{role}"
    if stage:
        q += f"&metadata->>onboarding_stage=eq.{stage}"
    return rows(q)


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


# --------------------------------------------------------------------------- static


def static_checks():
    send_text = read(SEND)
    pipe_text = read(PIPELINE)
    prompt_text = read(PROMPT)
    state_text = read(STATE)
    apply_text = read(APPLY)
    auto_text = read(AUTO)
    smoke_text = read(SMOKE)

    print("== A. static wiring ==")
    check("send-message reads the stage before the D8 counter",
          "onboardingStage = await readOnboardingStage(userId)" in send_text
          and send_text.index("onboardingStage = await readOnboardingStage(userId)")
          < send_text.index("recordAutoAdoptSuccess({"))
    check("send-message records auto-adopt only when the stage is complete",
          'if (onboardingStage === "complete") {' in send_text
          and "recordAutoAdoptSuccess({" in send_text)
    check("send-message prepares the turn and passes it through",
          "prepareOnboardingTurn({" in send_text
          and "onboarding: onboarding ?? undefined" in send_text)
    check("send-message applies the block and advances by CAS",
          "applyOnboardingBlock({" in send_text
          and "advanceOnboardingStage({" in send_text
          and "from: result.onboarding.stage" in send_text)
    check("send-message stamps the onboarding source and stage on the reply",
          "source: result.onboarding ? ONBOARDING_SOURCE : \"pipeline\"" in send_text
          and "metadata.onboarding_stage = result.onboarding.stage" in send_text)
    check("send-message does not offer persona chips or an oath during intake",
          "result.onboarding ? undefined : result.uiMetadata?.persona_options" in send_text
          and "freshInsert && oathRequestToConsume && !result.onboarding" in send_text
          and "freshInsert && !result.onboarding" in send_text)

    check("runPipeline flags stage 1 only on the onboarding branch",
          "extract(text, onboardingTurn ? { onboarding: true } : undefined)" in pipe_text)
    check("runPipeline skips dialog, rider and breakdown during intake",
          "userId && !onboardingTurn" in pipe_text
          and "opts.applyRider && userId && !onboardingTurn" in pipe_text
          and "opts.applyRider && userId && !onboardingTurn && riderProbe?.applied" in pipe_text)
    check("runPipeline forces the onboarding persona and route",
          "overridePrecedence(onboarding.stage, dialogState)" in pipe_text
          and "route: \"auto\"" in pipe_text
          and "persona: onboarding.persona" in pipe_text)
    check("runPipeline skips rule retrieval and passes omitRules/interviewContext",
          "const retrieval: RetrieveRulesResult = onboardingTurn" in pipe_text
          and "omitRules: onboardingTurn" in pipe_text
          and "interviewContext: onboardingInstruction" in pipe_text)
    check("runPipeline keeps memory retrieval as-is", "memoryPromise" in pipe_text)
    check("runPipeline resolves metric chips only at the boundary/selection",
          "loadInterviewMetricContext(userId)" in pipe_text
          and 'onboarding.stage === "metric_selection"' in pipe_text
          and 'onboarding.advanceTo === "metric_selection"' in pipe_text)

    check("the prompt builder omits the rules block when flagged",
          "input.omitRules ? [] : [renderRules(input.rules)]" in prompt_text)
    check("the prompt builder appends the interview instruction before memory",
          prompt_text.index("if (input.interviewContext)") < prompt_text.index("withMemoryContext(parts"))
    check("the prompt builder still has the unflagged rules line",
          "Relevant coaching rules: none retrieved for this turn." in prompt_text)
    check("generate.ts re-exports the moved input type and imports the pure builder",
          "export type { GenerateStageInput };" in read(GENERATE)
          and "from \"./generatePrompt.ts\"" in read(GENERATE))

    check("state.ts adds the deterministic instruction builder",
          "export function buildOnboardingInstruction" in state_text
          and "diagnostic question" in state_text
          and "do not invent a metric" in state_text)
    instruction = state_text[state_text.index("export function buildOnboardingInstruction"):
                             state_text.index("export function overridePrecedence")]
    check("the instruction builder carries no habit/watch/impulse vocabulary",
          not re.search(r"habit|watch|impulse", instruction, re.I), instruction[:300])

    check("apply.ts writes the profile fields and baseline facts",
          "patch.wake_time" in apply_text and "patch.sleep_time" in apply_text
          and 'patch.routine = { summary: block.routine_summary }' in apply_text
          and "patch.high_dopamine_activities" in apply_text
          and 'fact_type: "baseline"' in apply_text
          and "source_message_id: args.messageId" in apply_text)
    check("apply.ts guards baseline facts on the source id",
          '.eq("source_message_id", args.messageId)' in apply_text
          and '.eq("fact_type", "baseline")' in apply_text)
    check("apply.ts advances with a compare-and-set",
          '.eq("onboarding_stage", args.from)' in apply_text)
    check("apply.ts reset refuses oath facts and deletes derived facts first",
          "OnboardingResetRefusedError" in apply_text
          and '.eq("fact_type", "oath")' in apply_text
          and '.in("source_message_id", ids)' in apply_text
          and apply_text.index(".from(\"memory_facts\")\n      .delete()")
          < apply_text.index(".from(\"messages\")\n      .delete()"))

    check("autoAdopt carries both transparent sources",
          "TRANSPARENT_SOURCES" in auto_text
          and "CHECKIN_SOURCE" in auto_text
          and "ONBOARDING_SOURCE" in auto_text)

    check("dev-smoke exposes the onboarding-drill legs",
          'case "onboarding-drill"' in smoke_text
          and 'leg === "advance"' in smoke_text
          and 'leg === "reset"' in smoke_text
          and 'leg === "apply"' in smoke_text
          and "forceOnboardingStage" in smoke_text
          and "resetOnboardingDrill" in smoke_text
          and "applyOnboardingBlock" in smoke_text)

    print("== B. static gates ==")
    rc, status = run("git status --porcelain")
    paths = [line[3:].strip() for line in status.splitlines() if line.strip()]
    check("no migration or SQL file is added by Step 3",
          not any(p.endswith(".sql") for p in paths), repr([p for p in paths if p.endswith(".sql")]))
    function_entries = {
        p.split("/")[2] for p in paths
        if p.startswith("supabase/functions/") and p.endswith("/index.ts")
        and len(p.split("/")) > 3 and p.split("/")[2] != "_shared"
    }
    check("the only touched Edge Function entries are send-message and dev-smoke",
          function_entries <= {"send-message", "dev-smoke"}, repr(function_entries))


# --------------------------------------------------------------------------- live helpers


def expect_onboarding_turn(user_id, assistant_id, stage, persona):
    u = message(user_id)
    a = message(assistant_id)
    um = (u or {}).get("metadata") or {}
    am = (a or {}).get("metadata") or {}
    check(f"  user row is stamped source=onboarding stage={stage}",
          um.get("source") == "onboarding" and um.get("onboarding_stage") == stage, repr(um))
    check(f"  reply is stamped source=onboarding stage={stage}",
          am.get("source") == "onboarding" and am.get("onboarding_stage") == stage, repr(am))
    check("  reply carries an empty rule_ids list",
          am.get("rule_ids") == [], repr(am.get("rule_ids")))
    check("  reply uses the configured onboarding persona",
          am.get("persona") == persona, repr(am.get("persona")))
    check("  reply offers no persona chips", "persona_options" not in am, repr(am))
    check("  reply is a primary reply to the user row",
          (a or {}).get("reply_to_message_id") == user_id)


def apply_leg(message_id, block):
    encoded = urllib.parse.quote(json.dumps(block), safe="")
    status, body = smoke(f"action=onboarding-drill&leg=apply&user={LIVE['uid']}"
                         f"&message_id={message_id}&block={encoded}")
    return status, body


def raw_user_message(content):
    return insert("messages", [{
        "user_id": LIVE["uid"], "role": "user", "content": content,
        "metadata": {"source": "onboarding"},
    }])[0]["id"]


# --------------------------------------------------------------------------- live checks


def live_checks():
    uid, token = make_user("fp09-step3")
    LIVE["uid"] = uid
    LIVE["jwt"] = token

    print("== C. live: opening and the intro advance ==")
    opened = opening_rows()
    opening_text = config_value("onboarding_opening_text")
    check("a fresh intro user has exactly one opening row", len(opened) == 1, repr(opened))
    if opened:
        check("the opening row is a non-generated assistant row with no persona",
              opened[0].get("role") == "assistant" and opened[0].get("persona_key") is None,
              repr(opened[0]))
        check("the opening content is the configured DRAFT text",
              opened[0].get("content") == opening_text, repr(opened[0].get("content")))
        check("the opening row is tagged onboarding_opening / intro",
              (opened[0].get("metadata") or {}).get("source") == "onboarding_opening"
              and (opened[0].get("metadata") or {}).get("onboarding_stage") == "intro")
    check("the new profile starts at intro", profile()["onboarding_stage"] == "intro")

    persona = config_value("onboarding_persona")
    trust_before = count_events("trust_events")
    stats_before = count_events("persona_stats")

    cid, status, body = send("Hi, I'm ready to start.")
    check("the intro answer returns ok", status == 200 and body.get("status") == "ok", str(body))
    expect_onboarding_turn(body["user_message_id"], body["assistant_message_id"], "intro", persona)
    check("the intro answer advances the profile to baseline once",
          profile()["onboarding_stage"] == "baseline", repr(profile()))

    _, status, body = send("Hi, I'm ready to start.", client_id=cid)
    check("a replayed send returns duplicate", status == 200 and body.get("status") == "duplicate",
          str(body))
    check("a replayed send does not advance again", profile()["onboarding_stage"] == "baseline")
    check("a replayed send writes no second onboarding user row",
          len(onboarding_rows(role="user", stage="intro")) == 1,
          repr(onboarding_rows(role="user", stage="intro")))

    print("\n== D. live: baseline resumes mid-stage ==")
    _, status, body = send("I sleep around midnight and my energy is low.")
    check("baseline answer 1 replies", status == 200 and body.get("status") == "ok", str(body))
    expect_onboarding_turn(body["user_message_id"], body["assistant_message_id"], "baseline", persona)
    check("baseline answer 1 leaves the stage in baseline",
          profile()["onboarding_stage"] == "baseline")
    # "close" the app: the next request is a new invocation reading the persisted stage.

    _, status, body = send("My work is a desk job with meetings most mornings.")
    check("baseline answer 2 replies after the close", status == 200 and body.get("status") == "ok",
          str(body))
    check("the resumed turn counts answer 2, not a restart",
          (message(body["assistant_message_id"]).get("metadata") or {}).get("onboarding_stage")
          == "baseline")

    _, status, body = send("I want more energy in the afternoons.")
    check("baseline boundary answer replies", status == 200 and body.get("status") == "ok", str(body))
    check("the baseline boundary advances to goals",
          profile()["onboarding_stage"] == "goals", repr(profile()))
    check("three baseline rows are stamped",
          len(onboarding_rows(role="user", stage="baseline")) == 3,
          repr(len(onboarding_rows(role="user", stage="baseline"))))

    print("\n== E. live: the apply leg (06:30, malformed time, provenance) ==")
    status, body = smoke(f"action=onboarding-drill&leg=advance&user={LIVE['uid']}&to=routine")
    check("the advance leg forces goals -> routine",
          status == 200 and body.get("ok") is True
          and body.get("from") == "goals" and body.get("to") == "routine", str(body))

    provenance_id = raw_user_message("I wake at 6:30 and start work by eight.")
    status, body = apply_leg(provenance_id, {
        "wake_time": "06:30",
        "routine_summary": "Wake at 6:30, walk, then a focused work block.",
        "baseline_facts": ["Wakes at 6:30 and starts work by eight."],
    })
    check("the apply leg accepts a valid 06:30 block",
          status == 200 and body.get("ok") is True, str(body))
    check("the apply leg reports wake_time and routine fields",
          "wake_time" in (body.get("fields") or [])
          and "routine" in (body.get("fields") or []), repr(body))
    check("06:30 lands on the profile", str(profile().get("wake_time") or "").startswith("06:30"),
          repr(profile().get("wake_time")))
    check("the routine summary lands as {summary}",
          (profile().get("routine") or {}).get("summary")
          == "Wake at 6:30, walk, then a focused work block.", repr(profile().get("routine")))
    facts = rows(f"/memory_facts?select=id,fact,fact_type,source_message_id,embed_model"
                 f"&user_id=eq.{LIVE['uid']}&source_message_id=eq.{provenance_id}"
                 "&fact_type=eq.baseline")
    check("the baseline fact carries the turn's source id", len(facts) == 1, repr(facts))
    if facts:
        check("the baseline fact has the frozen embed identity",
              facts[0].get("embed_model") == "gemini-embedding-001@768",
              repr(facts[0].get("embed_model")))
        check("the baseline fact text is the normalized fact",
              facts[0].get("fact") == "Wakes at 6:30 and starts work by eight.", repr(facts[0]))

    malformed_id = raw_user_message("I wake at half six.")
    status, body = apply_leg(malformed_id, {"wake_time": "6:30"})
    warnings = (body or {}).get("warnings") or []
    check("a malformed time still returns ok", status == 200 and body.get("ok") is True, str(body))
    check("a malformed time emits one structured wake_time warning",
          any(w.get("field") == "wake_time" and w.get("code") == "invalid_time"
              for w in warnings), repr(warnings))
    check("a malformed time leaves the prior wake_time intact",
          str(profile().get("wake_time") or "").startswith("06:30"),
          repr(profile().get("wake_time")))
    check("a malformed time writes no fact",
          len(rows(f"/memory_facts?select=id&user_id=eq.{LIVE['uid']}"
                   f"&source_message_id=eq.{malformed_id}")) == 0)

    print("\n== F. live: routine boundary proposal and metric re-offer ==")
    _, status, body = send("My routine starts with coffee and a short walk.")
    check("routine answer 1 replies", status == 200 and body.get("status") == "ok", str(body))
    _, status, body = send("Work runs from nine to five with lunch at one.")
    check("routine answer 2 replies", status == 200 and body.get("status") == "ok", str(body))
    _, status, body = send("Evenings are dinner, a walk, and a little reading.")
    check("routine answer 3 replies", status == 200 and body.get("status") == "ok", str(body))

    _, status, body = send("I usually wind down by ten thirty.")
    check("routine boundary answer replies", status == 200 and body.get("status") == "ok",
          str(body))
    proposal = message(body["assistant_message_id"])
    proposal_meta = (proposal or {}).get("metadata") or {}
    options = proposal_meta.get("metric_options") or []
    check("the routine boundary advances to metric_selection",
          profile()["onboarding_stage"] == "metric_selection", repr(profile()))
    check("the boundary reply proposes exactly three metric chips", len(options) == 3,
          repr(options))
    check("each chip has key/label/domain/output_unit",
          all(all(k in o and o[k] for k in ("key", "label", "domain", "output_unit"))
              for o in options), repr(options))

    _, status, body = send("I'm not sure which one to pick.")
    reoffer = message(body["assistant_message_id"])
    reoffer_meta = (reoffer or {}).get("metadata") or {}
    check("a metric_selection free-text turn re-offers the identical list",
          reoffer_meta.get("metric_options") == options,
          repr(reoffer_meta.get("metric_options")))
    check("the re-offer keeps the stage at metric_selection",
          profile()["onboarding_stage"] == "metric_selection")

    print("\n== G. live: intake writes no trust/persona stats ==")
    trust_after = count_events("trust_events")
    stats_after = count_events("persona_stats")
    check("intake writes zero trust_events", trust_after == trust_before,
          f"{trust_before} -> {trust_after}")
    check("intake writes zero persona_stats", stats_after == stats_before,
          f"{stats_before} -> {stats_after}")

    print("\n== H. live: complete is ordinary chat; the rider applies ==")
    status, body = smoke(f"action=onboarding-drill&leg=advance&user={LIVE['uid']}&to=complete")
    check("the advance leg forces metric_selection -> complete",
          status == 200 and body.get("to") == "complete", str(body))
    _, status, body = send("I want to plan tomorrow.")
    complete_reply = message(body.get("assistant_message_id"))
    complete_meta = (complete_reply or {}).get("metadata") or {}
    check("a complete turn replies normally", status == 200 and body.get("status") == "ok",
          str(body))
    check("a complete turn is not stamped as onboarding",
          complete_meta.get("source") == "pipeline" and "onboarding_stage" not in complete_meta,
          repr(complete_meta))
    check("the stage stays complete after a chat turn",
          profile()["onboarding_stage"] == "complete")

    trust_before_rider = count_events("trust_events")
    status, body = smoke(f"action=accountability-drill&leg=apply&user={LIVE['uid']}"
                         "&openness=2")
    check("the post-complete rider apply succeeds", status == 200 and body.get("ok") is True,
          str(body))
    check("the post-complete rider writes a trust event",
          count_events("trust_events") > trust_before_rider,
          f"{trust_before_rider} -> {count_events('trust_events')}")

    print("\n== I. live: onboarding-drill reset ==")
    status, body = smoke(f"action=onboarding-drill&leg=reset&user={LIVE['uid']}")
    check("the reset leg succeeds", status == 200 and body.get("ok") is True, str(body))
    check("reset returns the profile to intro", profile()["onboarding_stage"] == "intro")
    check("reset plants exactly one fresh opening row", len(opening_rows()) == 1,
          repr(opening_rows()))
    check("reset removes every onboarding turn row", len(onboarding_rows()) == 0,
          repr(len(onboarding_rows())))
    check("reset clears the interview profile fields",
          profile().get("wake_time") is None and profile().get("sleep_time") is None
          and profile().get("routine") == {} and profile().get("high_dopamine_activities") == [],
          repr(profile()))


def toolchain():
    print("\n== J. toolchain ==")
    rc, out = run("npx tsc --noEmit")
    check("tsc --noEmit is clean", rc == 0, out[-1500:])
    rc, out = run("npx jest --ci --runInBand --silent")
    check("jest is green", rc == 0, out[-2500:])
    rc, out = run("deno check supabase/functions/send-message/index.ts "
                  "supabase/functions/dev-smoke/index.ts "
                  "supabase/functions/_shared/pipeline/runPipeline.ts "
                  "supabase/functions/_shared/pipeline/generate.ts "
                  "supabase/functions/_shared/pipeline/generatePrompt.ts "
                  "supabase/functions/_shared/onboarding/apply.ts "
                  "supabase/functions/_shared/onboarding/state.ts")
    check("deno check is clean over the touched entry points", rc == 0, out[-1500:])
    rc, out = run("npx eslint .")
    check("eslint exits 0", rc == 0, out[-1500:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true", help="skip the network legs")
    ap.add_argument("--no-toolchain", action="store_true", help="skip tsc/jest/deno/eslint")
    args = ap.parse_args()

    load_dotenv()
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
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
        sys.exit("need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEV_SMOKE_TOKEN")

    originals = {}
    uid = None
    try:
        for key in ("llm_stub_mode", "classifier_mode", "dev_overrides_enabled"):
            originals[key] = config_value(key)
        set_config("llm_stub_mode", True)
        set_config("classifier_mode", "stub")
        set_config("dev_overrides_enabled", True)
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
        try:
            for key, value in originals.items():
                set_config(key, value)
        except Exception as exc:  # noqa: BLE001
            print(f"  (config restore warning: {exc})")
        if uid:
            drop_user(uid)

    if not args.no_toolchain:
        toolchain()
    return finish()


def finish():
    print("\n" + ("FAIL: " + ", ".join(FAILS) if FAILS else "ALL CHECKS PASS"))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
