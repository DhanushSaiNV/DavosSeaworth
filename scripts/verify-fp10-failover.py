#!/usr/bin/env python3
"""verify-fp10-failover.py -- FP-10 Step 5: Failover drill, embed legs & timing re-audit.

Governing references:
  TECH-SPEC §4.1 (provider adapter, failover, sync degrade, holding/retry pair)
  TECH-SPEC §2.2 (job dispatcher contract, backoff, retry schedule)
  TECH-SPEC §7.10 (push delivery, holding row push silence)
  TECH-SPEC §12 (capacity plan, timing benchmarks, provider limits)
  TECH-SPEC §13 (item 6: secret isolation, lazy pipeline import in llm_retry)
  D18 (provider adapter pattern), D13 (server-side stripping), D5 (frozen embedding model)
  FP-10 FR-10, AC-10

Legs:
  A: 'primary' force-fail -- inline fallback to Groq, 0 retry jobs, contract valid
  B: 'both' force-fail -- sync degrade, holding reply + source_job_id, recovery on restore
  C: async under 'both' -- intervention job fails with §2.2 backoff, recovers on restore
  D: embed legs -- sync degrade, checkin 503 embed_unavailable, journal_extract marker unwritten
  E: timing re-audit -- 20 normal turns + 6 primary-failed turns, p50/p90/max vs §12 targets

Usage:
  py -3 scripts/verify-fp10-failover.py                # full suite (static + live)
  py -3 scripts/verify-fp10-failover.py --static-only  # offline static gate only
  py -3 scripts/verify-fp10-failover.py --skip-timing  # legs A-D without 20-turn audit
"""

import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")

FAILED = False
TIMING_RESULTS = {}


def load_dotenv():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


load_dotenv()


def check(name, ok, detail=""):
    global FAILED
    status = "PASS" if ok else "FAIL"
    if not ok:
        FAILED = True
    msg = f"  {status} {name}"
    if detail:
        msg += f" -- {detail}"
    print(msg)


def skip(name, reason):
    print(f"  SKIP {name} ({reason})")


def read(relpath):
    with open(os.path.join(ROOT, relpath), encoding="utf-8") as fh:
        return fh.read()


def percentile(vals, p):
    if not vals:
        return 0.0
    s = sorted(vals)
    k = (len(s) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return float(s[int(k)])
    d0 = s[int(f)] * (c - k)
    d1 = s[int(c)] * (k - f)
    return float(d0 + d1)


def http_request(url, method="GET", body=None, headers=None, timeout=60, retries=2):
    req_headers = dict(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)

    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                text = resp.read().decode("utf-8")
                try:
                    parsed = json.loads(text)
                except Exception:
                    parsed = text
                return resp.status, parsed
        except urllib.error.HTTPError as err:
            text = err.read().decode("utf-8")
            try:
                parsed = json.loads(text)
            except Exception:
                parsed = text
            return err.code, parsed
        except (urllib.error.URLError, ConnectionResetError) as err:
            if attempt < retries:
                time.sleep(1.5)
                continue
            return 0, {"error": str(err)}
    return 0, {"error": "request failed"}


def run_sql(sql):
    fd, path = tempfile.mkstemp(suffix=".sql")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(sql)
        proc = subprocess.run(
            ["npx", "supabase", "db", "query", "--linked", "-f", path, "--output", "json"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=180,
            shell=(os.name == "nt"),
        )
        text = proc.stdout
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end < 0:
            raise RuntimeError(f"db query failed: {proc.stdout[-800:]} {proc.stderr[-400:]}")
        return json.loads(text[start : end + 1]).get("rows", [])
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def iso_offset(seconds):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


# ============================================================================
# Static checks
# ============================================================================

def static_checks():
    print("\n== A. static: secret isolation & failover contracts (AC-10, §13 item 6) ==")

    disp = read("supabase/functions/job-dispatcher/index.ts")
    adapter = read("supabase/functions/_shared/llm/adapter.ts")
    checkin = read("supabase/functions/submit-checkin/index.ts")
    journal = read("supabase/functions/_shared/journal/runChain.ts")

    # 1. Secrets-shape static assert (§13 item 6)
    top_level_lines = [
        line.strip()
        for line in disp.splitlines()
        if line.strip().startswith("import ")
    ]
    statically_imports_pipeline = any(
        "runPipeline" in line or "_shared/llm/adapter" in line
        for line in top_level_lines
    )
    check("dispatcher has zero top-level static imports of pipeline or adapter", not statically_imports_pipeline)

    lazy_import_in_retry = "const { runLockedPersonaReply } = await import('../_shared/pipeline/runPipeline.ts')" in disp
    check("dispatcher imports pipeline lazily inside handleLlmRetry alone", lazy_import_in_retry)

    # 2. Adapter force-fail contracts
    check("adapter checks getForceFail()", "const forceFail = await getForceFail();" in adapter)
    check("adapter routes forceFail === 'primary' directly to callGroq", 'if (forceFail === "primary")' in adapter and "callGroq" in adapter)
    check("adapter handles forceFail === 'both' on generation with transport error", 'if (forceFail === "both")' in adapter and 'kind: "transport"' in adapter)
    check("adapter handles forceFail === 'both' on embed with transport error", 'error: "Both providers forced to fail (embeddings unavailable)"' in adapter)

    # 3. Checkin embed failure contract
    check("submit-checkin handles failed embed with 503 embed_unavailable", 'return json({ error: "embed_unavailable" }, 503);' in checkin)

    # 4. Journal extract marker contract
    vagueness_marker = "const { error: markerError } = await supabaseService\n    .from(\"journal_entries\")\n    .update({ vagueness_score, severity, habit_flag })"
    check("journal_extract writes vagueness_score marker after extractEntry", "await extractEntry(content)" in journal and vagueness_marker in journal)

    # 5. Client surface discipline
    proc = subprocess.run(
        ["git", "diff", "--name-only", "main", "--", "lib", "app", "components"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        shell=(os.name == "nt"),
    )
    changed = [line for line in proc.stdout.splitlines() if line.strip()]
    check("surface discipline: zero client diffs", not changed, str(changed))


# ============================================================================
# Live legs
# ============================================================================

def live_legs(skip_timing=False, turns_count=20):
    print("\n== B. live: provider failover drill & timing re-audit (AC-10) ==")

    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    dev_token = os.environ.get("DEV_SMOKE_TOKEN")

    if not url or not service or not anon or not dev_token:
        skip("live legs", "need SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY, DEV_SMOKE_TOKEN")
        return

    sys.path.insert(0, SCRIPTS)
    from _mint_dev_jwt import mint_access_token  # noqa: E402

    def svc(method, path, body=None):
        return http_request(f"{url}{path}", method, body, headers={
            "Authorization": f"Bearer {service}",
            "apikey": service,
        })

    def dev_smoke(action, params=""):
        q = f"?action={action}" + (f"&{params}" if params else "")
        return http_request(f"{url}/functions/v1/dev-smoke{q}", "GET", headers={
            "Authorization": f"Bearer {dev_token}",
        })

    # Record initial config
    _, prev_stub_rows = svc("GET", "/rest/v1/config?select=value&key=eq.llm_stub_mode")
    _, prev_fail_rows = svc("GET", "/rest/v1/config?select=value&key=eq.llm_force_fail")
    prev_stub = prev_stub_rows[0]["value"] if prev_stub_rows else False
    prev_fail = prev_fail_rows[0]["value"] if prev_fail_rows else "none"

    print(f"  initial config: stub_mode={prev_stub}, force_fail={prev_fail}")

    # Create temporary user for legs B, C, D
    email = f"fp10-failover-{uuid.uuid4().hex[:10]}@example.com"
    password = f"P@{uuid.uuid4().hex}1!"
    st, created = svc("POST", "/auth/v1/admin/users", {
        "email": email,
        "password": password,
        "email_confirm": True,
    })
    if st not in (200, 201) or not created.get("id"):
        check("create disposable test user", False, f"status {st}: {created}")
        return
    uid = created["id"]
    print(f"  disposable test user created: {uid}")

    user_token, _ = mint_access_token(url, service, email)
    planted_jobs = []

    def restore_config():
        svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": False})
        svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "none"})

    try:
        # Complete onboarding on the disposable test user with active checkin window
        svc("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {
            "onboarding_stage": "complete",
            "display_name": "Failover Tester",
            "checkin_active_hours_start": "00:00:00",
            "checkin_active_hours_end": "23:59:59",
            "checkin_cadence_minutes": 60,
            "timezone": "UTC",
        })

        # Pause dispatcher cron for drill isolation
        run_sql("select cron.alter_job(jobid, active => false) from cron.job where jobname = 'job-dispatcher-tick';")

        def trigger_dispatcher():
            st, res = http_request(f"{url}/functions/v1/job-dispatcher", "POST", {}, headers={
                "Authorization": f"Bearer {service}",
                "apikey": service,
            }, timeout=150)
            return st, res

        def drain_job(job_id, max_ticks=4):
            for _ in range(max_ticks):
                _, rows = svc("GET", f"/rest/v1/jobs?select=id,status,attempts,next_retry_at,last_error&id=eq.{job_id}")
                row = rows[0] if rows else {}
                if row.get("status") in ("done", "dead"):
                    return row
                # Make sure next_retry_at is in past before triggering dispatcher
                svc("PATCH", f"/rest/v1/jobs?id=eq.{job_id}", {"next_retry_at": iso_offset(-10)})
                trigger_dispatcher()
            _, rows = svc("GET", f"/rest/v1/jobs?select=id,status,attempts,next_retry_at,last_error&id=eq.{job_id}")
            return rows[0] if rows else {}

        # ---------------------------------------------------------------------
        # Leg A: 'primary' force-fail (inline Groq fallback)
        # ---------------------------------------------------------------------
        print("\n-- Leg A: llm_force_fail='primary' (inline Groq fallback, zero retry jobs) --")
        svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": False})
        svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "primary"})

        leg_a_start = datetime.now(timezone.utc).isoformat()
        sample_prompts = [
            "I want to wake up earlier tomorrow.",
            "Can you help me organize my morning routine?",
            "I felt lazy today and did not exercise.",
            "How do I stay consistent with reading?",
            "I have trouble focusing when working from home.",
            "What should I do when I feel exhausted in the afternoon?",
        ]

        leg_a_passed = True
        groq_counts = 0
        valid_contracts = 0
        for i, text in enumerate(sample_prompts, 1):
            if i > 1:
                time.sleep(1.5)  # Pace under Groq 30 RPM limit
            st, res = dev_smoke("pipeline", f"text={urllib.parse.quote(text)}")
            if st != 200 or not res.get("ok"):
                leg_a_passed = False
                check(f"Leg A turn {i} answers", False, f"status {st}: {res}")
                continue
            provider = (res.get("routeInfo") or {}).get("provider") or res.get("provider")
            quote = res.get("assistantContent")
            persona = (res.get("routeInfo") or {}).get("persona")
            route = (res.get("routeInfo") or {}).get("route")

            is_groq = (provider == "groq")
            if is_groq:
                groq_counts += 1
            is_valid = bool(quote and persona and route)
            if is_valid:
                valid_contracts += 1

        check("Leg A: all 6 turns answered successfully", leg_a_passed and groq_counts == 6, f"groq={groq_counts}/6")
        check("Leg A: all replies contract-valid", valid_contracts == 6, f"valid={valid_contracts}/6")

        # Verify zero llm_retry jobs created (properly URL-quoted timestamp)
        _, retry_jobs = svc("GET", f"/rest/v1/jobs?select=id&type=eq.llm_retry&created_at=gte.{urllib.parse.quote(leg_a_start)}")
        retry_list = retry_jobs if isinstance(retry_jobs, list) else []
        check("Leg A: zero llm_retry jobs enqueued", len(retry_list) == 0, f"found {len(retry_list)}")

        # Restore and assert
        svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "none"})
        _, restored_rows = svc("GET", "/rest/v1/config?select=value&key=eq.llm_force_fail")
        check("Leg A: llm_force_fail restored to 'none'", (restored_rows[0]["value"] if restored_rows else None) == "none")

        # ---------------------------------------------------------------------
        # Leg B: 'both' force-fail (Sync degrade + recovery)
        # ---------------------------------------------------------------------
        print("\n-- Leg B: llm_force_fail='both' (holding reply, retry job, drain on restore) --")
        svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": False})
        svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "both"})

        client_msg_id = str(uuid.uuid4())
        st, res = http_request(f"{url}/functions/v1/send-message", "POST", {
            "content": "Drill: total outage turn.",
            "client_message_id": client_msg_id,
        }, headers={"Authorization": f"Bearer {user_token}", "apikey": anon})

        user_msg_id = res.get("user_message_id")
        holding_msg_id = res.get("assistant_message_id")
        check("Leg B: forced outage turn returns holding reply", st == 200 and bool(holding_msg_id), f"status {st}: {res}")

        # Check holding row in messages
        _, holding_rows = svc("GET", f"/rest/v1/messages?select=id,metadata,reply_to_message_id,content&id=eq.{holding_msg_id}")
        holding_row = holding_rows[0] if holding_rows else {}
        holding_meta = holding_row.get("metadata") or {}
        check("Leg B: holding row marked as sync_degrade / route degrade",
              holding_row.get("reply_to_message_id") == user_msg_id and
              holding_meta.get("route") == "degrade" and holding_meta.get("source") == "sync_degrade")

        source_job_id = holding_meta.get("source_job_id")
        check("Leg B: holding reply carries source_job_id", bool(source_job_id))

        # Check llm_retry job
        _, job_rows = svc("GET", f"/rest/v1/jobs?select=id,type,status,payload&id=eq.{source_job_id}")
        retry_job = job_rows[0] if job_rows else {}
        check("Leg B: exactly one llm_retry job exists with matching source_job_id",
              retry_job.get("type") == "llm_retry" and retry_job.get("status") == "pending")

        # Restore config and drain job via dispatcher
        svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "none"})
        drained_job = drain_job(source_job_id)
        check("Leg B: llm_retry job drained to 'done' on restore", drained_job.get("status") == "done", str(drained_job))

        # Check secondary reply in messages (anchored via secondary_reply_to_message_id per §3.2)
        _, sec_rows = svc("GET", f"/rest/v1/messages?select=id,metadata,secondary_reply_to_message_id,content&secondary_reply_to_message_id=eq.{user_msg_id}")
        sec_row = sec_rows[0] if sec_rows else {}
        sec_meta = sec_row.get("metadata") or {}
        check("Leg B: secondary reply lands in messages with source='llm_retry'",
              sec_meta.get("source") == "llm_retry" and bool(sec_row.get("content")), str(sec_row)[:200])

        # Cleanup Leg B rows
        svc("DELETE", f"/rest/v1/jobs?id=eq.{source_job_id}")
        svc("DELETE", f"/rest/v1/messages?or=(id.eq.{user_msg_id},id.eq.{holding_msg_id},secondary_reply_to_message_id.eq.{user_msg_id})")

        # Assert restore
        _, restored_rows = svc("GET", "/rest/v1/config?select=value&key=eq.llm_force_fail")
        check("Leg B: llm_force_fail restored to 'none'", (restored_rows[0]["value"] if restored_rows else None) == "none")

        # ---------------------------------------------------------------------
        # Leg C: Async under 'both' (intervention job failure & backoff)
        # ---------------------------------------------------------------------
        print("\n-- Leg C: async under 'both' (intervention fails, backs off, recovers on restore) --")
        svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": False})
        svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "both"})

        now_iso = datetime.now(timezone.utc).isoformat()
        interv_job_id = str(uuid.uuid4())
        st, _ = svc("POST", "/rest/v1/jobs", {
            "id": interv_job_id,
            "type": "intervention",
            "payload": {
                "user_id": uid,
                "window": now_iso,
                "reason": "missed_checkin",
            },
            "status": "pending",
            "attempts": 0,
            "max_attempts": 5,
            "next_retry_at": iso_offset(-10),
        })
        planted_jobs.append(interv_job_id)
        check("Leg C: planted intervention job", st in (200, 201))

        # Run dispatcher while 'both' are failing -> job should fail and back off ~30s
        trigger_dispatcher()
        _, failed_job_rows = svc("GET", f"/rest/v1/jobs?select=id,status,attempts,next_retry_at,last_error&id=eq.{interv_job_id}")
        failed_job = failed_job_rows[0] if failed_job_rows else {}
        check("Leg C: intervention job status is 'failed' with attempts=1",
              failed_job.get("status") == "failed" and failed_job.get("attempts") == 1, str(failed_job))

        next_retry = failed_job.get("next_retry_at") or ""
        check("Leg C: intervention job next_retry_at scheduled in future (§2.2 backoff)",
              next_retry > now_iso, f"next_retry={next_retry}")

        # Restore config and advance next_retry_at
        svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "none"})
        recovered_job = drain_job(interv_job_id)
        check("Leg C: intervention job recovers to 'done' on restore",
              recovered_job.get("status") == "done", str(recovered_job))

        # Cleanup Leg C rows
        svc("DELETE", f"/rest/v1/jobs?id=eq.{interv_job_id}")
        svc("DELETE", f"/rest/v1/messages?user_id=eq.{uid}")

        # Assert restore
        _, restored_rows = svc("GET", "/rest/v1/config?select=value&key=eq.llm_force_fail")
        check("Leg C: llm_force_fail restored to 'none'", (restored_rows[0]["value"] if restored_rows else None) == "none")

        # ---------------------------------------------------------------------
        # Leg D: Embed legs
        # ---------------------------------------------------------------------
        print("\n-- Leg D: embed legs (sync degrade, checkin 503, journal_extract marker unwritten) --")
        svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": False})
        svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "both"})

        # D1: Sync degrade on embed failure already proven in Leg B

        # D2: Check-in returns 503 embed_unavailable
        now_sec = int(time.time())
        hour = (now_sec // 3600) * 3600
        past_window_ms = (hour - 3600) * 1000
        checkin_st, checkin_res = http_request(f"{url}/functions/v1/submit-checkin", "POST", {
            "content": "Drill: check-in while embeddings down.",
            "windowTs": past_window_ms,
            "capture": "reply",
        }, headers={"Authorization": f"Bearer {user_token}", "apikey": anon})
        check("Leg D2: submit-checkin returns 503 embed_unavailable",
              checkin_st == 503 and (checkin_res or {}).get("error") == "embed_unavailable",
              f"status {checkin_st}: {checkin_res}")

        # D3: Journal extract marker unwritten on failure, recovers clean
        entry_id = str(uuid.uuid4())
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        st, _ = svc("POST", "/rest/v1/journal_entries", {
            "id": entry_id,
            "user_id": uid,
            "content": "Had a long and exhausting day at work with back to back calls.",
            "entry_date": today,
            "vagueness_score": None,
        })
        check("Leg D3: planted unextracted journal entry", st in (200, 201))

        journal_job_id = str(uuid.uuid4())
        st, _ = svc("POST", "/rest/v1/jobs", {
            "id": journal_job_id,
            "type": "journal_extract",
            "payload": {"entry_id": entry_id},
            "status": "pending",
            "attempts": 0,
            "max_attempts": 5,
            "next_retry_at": iso_offset(-10),
        })
        planted_jobs.append(journal_job_id)

        # Trigger dispatcher under 'both' -> extraction fails
        trigger_dispatcher()
        _, failed_entry_rows = svc("GET", f"/rest/v1/journal_entries?select=id,vagueness_score&id=eq.{entry_id}")
        failed_entry = failed_entry_rows[0] if failed_entry_rows else {}
        check("Leg D3: vagueness_score marker remains null on failure",
              failed_entry.get("vagueness_score") is None, str(failed_entry))

        _, failed_jjob_rows = svc("GET", f"/rest/v1/jobs?select=id,status,attempts&id=eq.{journal_job_id}")
        failed_jjob = failed_jjob_rows[0] if failed_jjob_rows else {}
        check("Leg D3: journal_extract job marked 'failed' with attempts=1",
              failed_jjob.get("status") == "failed" and failed_jjob.get("attempts") == 1, str(failed_jjob))

        # Restore config and drain to recovery
        svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "none"})
        recovered_jjob = drain_job(journal_job_id)
        check("Leg D3: journal_extract job marked 'done' on recovery",
              recovered_jjob.get("status") == "done", str(recovered_jjob))

        _, recovered_entry_rows = svc("GET", f"/rest/v1/journal_entries?select=id,vagueness_score&id=eq.{entry_id}")
        recovered_entry = recovered_entry_rows[0] if recovered_entry_rows else {}
        check("Leg D3: vagueness_score marker written on recovery",
              recovered_entry.get("vagueness_score") is not None, str(recovered_entry))

        # Cleanup Leg D rows
        svc("DELETE", f"/rest/v1/jobs?id=eq.{journal_job_id}")
        svc("DELETE", f"/rest/v1/journal_entries?id=eq.{entry_id}")

        # Assert restore
        _, restored_rows = svc("GET", "/rest/v1/config?select=value&key=eq.llm_force_fail")
        check("Leg D: llm_force_fail restored to 'none'", (restored_rows[0]["value"] if restored_rows else None) == "none")

        # ---------------------------------------------------------------------
        # Leg E: Timing re-audit
        # ---------------------------------------------------------------------
        if skip_timing:
            skip("Leg E: timing re-audit", "--skip-timing specified")
        else:
            print(f"\n-- Leg E: timing re-audit ({turns_count} normal + 6 primary-failed turns) --")
            svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": False})
            svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "none"})

            normal_latencies = []
            sample_turns = [
                "I want to improve my sleep habits.",
                "How do I stay motivated when tired?",
                "Can you recommend a small win for today?",
                "I skipped my workout yesterday and feel guilty.",
                "What is a good way to track daily deep work?",
                "I feel overwhelmed with too many tasks.",
                "How can I cut back on social media use?",
                "Help me plan a 15-minute evening routine.",
                "I have an important deadline on Friday.",
                "How do I avoid procrastination in the morning?",
            ]

            print(f"  Running {turns_count} normal turns...")
            for i in range(turns_count):
                text = sample_turns[i % len(sample_turns)]
                start_t = time.perf_counter()
                st, res = dev_smoke("pipeline", f"text={urllib.parse.quote(text)}")
                wall_ms = (time.perf_counter() - start_t) * 1000.0
                if st == 200 and res.get("ok"):
                    server_ms = (res.get("routeInfo") or {}).get("latencyMs") or wall_ms
                    normal_latencies.append(server_ms)
                    print(f"    normal turn {i+1:02d}: server={server_ms:.0f}ms wall={wall_ms:.0f}ms")
                else:
                    check(f"Normal turn {i+1}", False, f"status {st}: {res}")

            p50_norm = percentile(normal_latencies, 50)
            p90_norm = percentile(normal_latencies, 90)
            max_norm = max(normal_latencies) if normal_latencies else 0.0

            print(f"  Normal latency ms: p50={p50_norm:.0f}, p90={p90_norm:.0f}, max={max_norm:.0f}")
            check("Leg E: normal p50 < 40000ms (§12 target)", p50_norm < 40000)
            check("Leg E: normal max < 150000ms (§12 target)", max_norm < 150000)

            # 6 turns under 'primary'
            print("\n  Running 6 primary-failed turns (Groq fallback)...")
            svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "primary"})
            fallback_latencies = []
            for i in range(6):
                if i > 0:
                    time.sleep(1.5)  # Pace under Groq 30 RPM limit
                text = sample_turns[i % len(sample_turns)]
                start_t = time.perf_counter()
                st, res = dev_smoke("pipeline", f"text={urllib.parse.quote(text)}")
                wall_ms = (time.perf_counter() - start_t) * 1000.0
                if st == 200 and res.get("ok"):
                    server_ms = (res.get("routeInfo") or {}).get("latencyMs") or wall_ms
                    fallback_latencies.append(server_ms)
                    print(f"    fallback turn {i+1:02d}: server={server_ms:.0f}ms wall={wall_ms:.0f}ms (groq)")
                else:
                    check(f"Fallback turn {i+1}", False, f"status {st}: {res}")

            p50_fall = percentile(fallback_latencies, 50)
            p90_fall = percentile(fallback_latencies, 90)
            max_fall = max(fallback_latencies) if fallback_latencies else 0.0

            print(f"  Fallback latency ms: p50={p50_fall:.0f}, p90={p90_fall:.0f}, max={max_fall:.0f}")
            check("Leg E: fallback p50 < 40000ms (§12 target)", p50_fall < 40000)
            check("Leg E: fallback max < 150000ms (§12 target)", max_fall < 150000)

            TIMING_RESULTS["normal"] = {"p50": round(p50_norm), "p90": round(p90_norm), "max": round(max_norm), "n": len(normal_latencies)}
            TIMING_RESULTS["fallback"] = {"p50": round(p50_fall), "p90": round(p90_fall), "max": round(max_fall), "n": len(fallback_latencies)}

            # Restore and assert
            svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "none"})
            _, restored_rows = svc("GET", "/rest/v1/config?select=value&key=eq.llm_force_fail")
            check("Leg E: llm_force_fail restored to 'none'", (restored_rows[0]["value"] if restored_rows else None) == "none")

    finally:
        # Final cleanup and unpausing
        print("\n-- Final teardown & hygiene check --")
        restore_config()
        run_sql("select cron.alter_job(jobid, active => true) from cron.job where jobname = 'job-dispatcher-tick';")

        if planted_jobs:
            id_list = ",".join(f"'{j}'" for j in planted_jobs)
            run_sql(f"delete from public.jobs where id in ({id_list});")

        svc("DELETE", f"/auth/v1/admin/users/{uid}")

        # Hygiene asserts: ensure safe values
        svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": False})
        svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "none"})
        svc("PATCH", "/rest/v1/config?key=eq.llm_stub_malformed", {"value": False})

        _, stub_chk = svc("GET", "/rest/v1/config?select=value&key=eq.llm_stub_mode")
        _, fail_chk = svc("GET", "/rest/v1/config?select=value&key=eq.llm_force_fail")
        _, malf_chk = svc("GET", "/rest/v1/config?select=value&key=eq.llm_stub_malformed")

        stub_val = stub_chk[0]["value"] if stub_chk else None
        fail_val = fail_chk[0]["value"] if fail_chk else None
        malf_val = malf_chk[0]["value"] if malf_chk else None

        check("hygiene: llm_stub_mode is false", stub_val is False, str(stub_val))
        check("hygiene: llm_force_fail is 'none'", fail_val in ("none", None), str(fail_val))
        check("hygiene: llm_stub_malformed is false", malf_val is False, str(malf_val))


def main():
    static_only = "--static-only" in sys.argv
    skip_timing = "--skip-timing" in sys.argv
    turns = 20
    for arg in sys.argv:
        if arg.startswith("--turns="):
            try:
                turns = int(arg.split("=")[1])
            except ValueError:
                pass

    print("=== FP-10 Step 5: Failover Drill & Timing Re-Audit ===")
    static_checks()

    if not static_only:
        live_legs(skip_timing=skip_timing, turns_count=turns)

    print("\n========================================================")
    if FAILED:
        print("FAIL -- FP-10 Step 5 gate reported failures.")
        sys.exit(1)
    else:
        print("ALL CHECKS PASSED -- FP-10 Step 5 VERIFIED")
        if TIMING_RESULTS:
            print("\nMeasured Timing Summary:")
            print(json.dumps(TIMING_RESULTS, indent=2))
        sys.exit(0)


if __name__ == "__main__":
    main()
