#!/usr/bin/env python3
"""verify-fp10-step2.py -- FP-10 Step 2 gate.

What this proves (FR-4, FR-5, FR-6; AC-4, AC-5):

  static    the degrade path is one RPC call (no direct job write, no second PostgREST
            round-trip); the pair module owns the request/response shape; the dispatcher
            imports the pure contract module; the registry is untouched.
  degrade   a forced provider outage produces a holding reply AND its `llm_retry` job,
            with the job id already written into the holding row's metadata.
  claim     `claim_jobs` claims the oldest ten due rows, marks them running, and
            increments attempts exactly once.
  snooze    three real snoozes through the dispatcher leave the row `pending` with
            attempts at zero and `next_retry_at` pushed.
  dead      a failing `smoke_test` row with `max_attempts=1` dead-letters in one tick.
  lease     a `running` row older than the lease returns to `pending` with its attempt
            increment kept (the safety valve).
  budget    unit-only: forcing a spent budget live is not bounded, so the arithmetic is
            pinned by `contract.test.ts` and this leg records the reason.

Every dispatcher invocation is guarded: the leg aborts unless the only due rows are its own,
so a live tick can never consume someone else's work.

Usage:
  python scripts/verify-fp10-step2.py                  # static + live
  python scripts/verify-fp10-step2.py --static-only    # no network, no DB

Exit code 0 iff every check passes.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
FAILS = []
SKIPS = []


def load_dotenv():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


def check(label, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + label + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(label)


def skip(label, why):
    print(f"  SKIP {label} -- {why}")
    SKIPS.append(label)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def req(url, method, path, body=None, token=None, key=None, timeout=90, prefer=None):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["apikey"] = key
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url + path, data=data, headers=headers, method=method)
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


def sql_rows(sql):
    fd, path = tempfile.mkstemp(suffix=".sql", prefix="fp10-step2-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(sql)
        proc = subprocess.run(
            ["npx", "supabase", "db", "query", "--linked", "-f", path, "--output", "json"],
            cwd=ROOT, capture_output=True, text=True, timeout=180, shell=(os.name == "nt"),
        )
        text = proc.stdout
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end < 0:
            raise RuntimeError(f"db query failed: {proc.stdout[-800:]} {proc.stderr[-400:]}")
        return json.loads(text[start:end + 1]).get("rows", [])
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def one(rows):
    return rows[0] if rows else None


def iso(delta_minutes):
    return (datetime.now(timezone.utc) + timedelta(minutes=delta_minutes)).isoformat()


# --------------------------------------------------------------------------- static

def static_legs():
    print("\n== A. static ==")
    replies = read("supabase/functions/_shared/replies.ts")
    pair = read("supabase/functions/_shared/degradePair.ts")
    disp = read("supabase/functions/job-dispatcher/index.ts")
    contract = read("supabase/functions/_shared/jobs/contract.ts")

    check("degrade helper calls the pair RPC", "writeDegradePair(" in replies)
    check("degrade helper writes no job directly", '.from("jobs")' not in replies)
    check("degrade helper keeps the fatal config read",
          'getConfig("sync_degrade_reply")' in replies)
    check("degrade helper mints the job id before the write", "crypto.randomUUID()" in replies)
    check("pair module owns the RPC name", '"write_degrade_pair"' in pair)
    pair_code = "\n".join(
        line for line in pair.splitlines() if not line.strip().startswith("//"))
    check("pair module is pure (no imports, no Deno runtime, no client construction)",
          "\nimport " not in pair_code and "Deno." not in pair_code
          and "createClient" not in pair_code)
    check("pair module keeps the as-built metadata keys",
          all(k in pair for k in ('route: "degrade"', 'source: "sync_degrade"',
                                  "source_job_id: jobId", "user_message_id: userMessageId")))
    check("pair module throws on an RPC error", "if (error)" in pair and "failed:" in pair)
    check("pair module reports race_lost without claiming a reply", '"race_lost"' in pair)

    check("dispatcher imports the contract module", "_shared/jobs/contract.ts" in disp)
    check("dispatcher has no inline backoff curve", "Math.pow(2" not in disp)
    check("dispatcher derives the dead-letter status from the contract",
          "failedStatusFor(attempt, maxAttempts)" in disp)
    check("dispatcher releases through the contract",
          "releaseUpdate(job.attempts" in disp)
    check("dispatcher resets leases through the contract",
          "leaseResetCutoff(Date.now(), LEASE_MINUTES)" in disp)
    check("dispatcher documents the smoke_test snooze seam",
          'asString(payload?.snooze_until)' in disp)
    check("contract module exports the four helpers",
          all(f"export function {n}(" in contract for n in
              ("backoffSecondsFor", "failedStatusFor", "releaseUpdate", "leaseResetCutoff")))

    check("registry untouched: FAST_JOB_TYPES",
          "new Set(['smoke_test', 'watchdog_retry'" not in disp
          and "new Set(['smoke_test', 'watchdog_checkin', 'purge_memory', 'metric_eval', 'drift_scan'])"
          in disp)

    check("degrade-pair unit suite exists",
          os.path.exists(os.path.join(ROOT, "supabase/functions/_shared/degradePair.test.ts")))
    check("contract unit suite exists",
          os.path.exists(os.path.join(ROOT, "supabase/functions/_shared/jobs/contract.test.ts")))

    proc = subprocess.run(["git", "diff", "--name-only", "main", "--", "lib", "app", "components"],
                          cwd=ROOT, capture_output=True, text=True, shell=(os.name == "nt"))
    changed = [line for line in proc.stdout.splitlines() if line.strip()]
    check("surface discipline: zero client diffs", not changed, str(changed))


# --------------------------------------------------------------------------- live

def live_legs():
    print("\n== B. live ==")
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not service or not anon:
        skip("live legs", "need SUPABASE_URL + SERVICE_ROLE_KEY + ANON_KEY")
        return

    sys.path.insert(0, SCRIPTS)
    from _mint_dev_jwt import mint_access_token  # noqa: E402

    def svc(method, path, body=None, prefer=None):
        return req(url, method, path, body, token=service, key=service, prefer=prefer)

    email = f"fp10-step2-{uuid.uuid4().hex[:10]}@example.com"
    password = uuid.uuid4().hex + "Aa1!"
    status, created = req(url, "POST", "/auth/v1/admin/users",
                          {"email": email, "password": password, "email_confirm": True},
                          token=service, key=service)
    if status not in (200, 201) or not isinstance(created, dict) or not created.get("id"):
        check("temp user created", False, f"{status} {created}")
        return
    uid = created["id"]
    planted_jobs = []
    print(f"  user  : {uid}")

    try:
        token, _claims = mint_access_token(url, service, email)

        # Pause the every-minute dispatcher tick for the drill. Every leg asserts an exact due
        # count so a live tick can never consume someone else's work - and the tick must not
        # consume ours mid-leg either. Restored in the finally.
        sql_rows("select cron.alter_job(jobid, active => false) from cron.job "
                 "where jobname = 'job-dispatcher-tick';")
        paused = one(sql_rows("select active from cron.job where jobname = 'job-dispatcher-tick';")) or {}
        check("drill owns the dispatcher tick", paused.get("active") is False, str(paused))

        # --- degrade end-to-end (forced outage, zero provider calls)
        svc("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {"onboarding_stage": "complete"})
        prev_stub = one(svc("GET", "/rest/v1/config?select=value&key=eq.llm_stub_mode")[1] or [])
        prev_fail = one(svc("GET", "/rest/v1/config?select=value&key=eq.llm_force_fail")[1] or [])
        svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": False})
        svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": "both"})
        try:
            client_message_id = str(uuid.uuid4())
            st, body = req(url, "POST", "/functions/v1/send-message",
                           {"content": "Drill: force a total outage.", "client_message_id": client_message_id},
                           token=token, key=anon)
            user_msg = (body or {}).get("user_message_id")
            holding = (body or {}).get("assistant_message_id")
            check("forced outage still answers the turn", st == 200 and bool(holding),
                  f"{st} {str(body)[:200]}")

            reply = one(svc(
                "GET",
                f"/rest/v1/messages?select=id,metadata,reply_to_message_id&id=eq.{holding}")[1] or [])
            meta = (reply or {}).get("metadata") or {}
            check("holding row is the degrade's primary reply",
                  bool(reply) and reply.get("reply_to_message_id") == user_msg
                  and meta.get("route") == "degrade" and meta.get("source") == "sync_degrade",
                  str(reply)[:300])
            job_id = meta.get("source_job_id")
            job = one(svc("GET", f"/rest/v1/jobs?select=id,type,payload&id=eq.{job_id}")[1] or [])
            check("exactly its llm_retry job exists, with the pre-minted id",
                  bool(job) and job.get("type") == "llm_retry"
                  and (job.get("payload") or {}).get("user_message_id") == user_msg,
                  str(job)[:300])
            payload = (job or {}).get("payload") or {}
            check("the job's payload carries the routing decision keys",
                  all(k in payload for k in ("route", "persona", "domain")),
                  str(payload)[:200])
            # Clean up before anything can run the retry: the turn's own jobs first, then the rows.
            svc("DELETE", f"/rest/v1/jobs?payload->>user_id=eq.{uid}")
            svc("DELETE", f"/rest/v1/messages?or=(id.eq.{user_msg},id.eq.{holding})")
        finally:
            svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": (prev_stub or {}).get("value")})
            svc("PATCH", "/rest/v1/config?key=eq.llm_force_fail", {"value": (prev_fail or {}).get("value")})

        # --- dispatcher contract drills (guarded)
        def due_count():
            row = one(sql_rows(
                "select count(*) as n from public.jobs "
                "where status in ('pending','failed') and next_retry_at <= now()"
            )) or {}
            return int(row.get("n") or 0)

        def invoke_dispatcher(expected_due, label):
            due = due_count()
            if due != expected_due:
                check(label, False, f"queue guard: {due} due rows, expected {expected_due}")
                return False
            st, body = svc("POST", "/functions/v1/job-dispatcher", {})
            return st == 200 and bool(body) and "processed" in (body or {})

        def plant(job_type, payload, **cols):
            row = {
                "type": job_type,
                "payload": payload,
                "status": cols.pop("status", "pending"),
                "attempts": cols.pop("attempts", 0),
                "max_attempts": cols.pop("max_attempts", 5),
                "next_retry_at": cols.pop("next_retry_at", iso(-1)),
            }
            row.update(cols)
            st, body = svc("POST", "/rest/v1/jobs", row, prefer="return=representation")
            created_row = (body or [{}])[0] if isinstance(body, list) else {}
            if not created_row.get("id"):
                raise RuntimeError(f"could not plant a {job_type} row: {st} {str(body)[:200]}")
            planted_jobs.append(created_row["id"])
            return created_row["id"]

        def job_row(job_id):
            return one(svc("GET", f"/rest/v1/jobs?select=id,status,attempts,next_retry_at,last_error&id=eq.{job_id}")[1] or [])

        # claim: 12 due rows, the oldest ten claimed, attempts incremented exactly once
        claim_ids = [plant("smoke_test", {}, next_retry_at=iso(-12 + i)) for i in range(12)]
        st, claimed = svc("POST", "/rest/v1/rpc/claim_jobs", {"batch_size": 10, "lease_minutes": 5})
        claimed = claimed or []
        check("claim_jobs returns at most the batch size", len(claimed) == 10, str(len(claimed)))
        check("claim_jobs takes only our rows",
              all(c["id"] in claim_ids for c in claimed), str([c.get("id") for c in claimed])[:200])
        check("claim_jobs marks them running with one attempt",
              all(c["status"] == "running" and c["attempts"] == 1 for c in claimed))
        order_ok = [c["next_retry_at"] for c in claimed] == sorted(c["next_retry_at"] for c in claimed)
        check("claim_jobs claims in next_retry_at order", order_ok)
        left = [i for i in claim_ids if i not in {c["id"] for c in claimed}]
        check("the two newest rows are left pending", len(left) == 2, str(len(left)))
        svc("DELETE", f"/rest/v1/jobs?id=in.({','.join(claim_ids)})")
        planted_jobs[:] = [j for j in planted_jobs if j not in claim_ids]

        # snooze: three real dispatcher deferrals
        snooze_id = plant("smoke_test", {"snooze_until": iso(+2)})
        snooze_ok = True
        for i in range(3):
            svc("PATCH", f"/rest/v1/jobs?id=eq.{snooze_id}", {"next_retry_at": iso(-1)})
            pre = job_row(snooze_id) or {}
            if not (pre.get("status") == "pending" and pre.get("attempts") == 0):
                check(f"snooze tick {i + 1} pre-state", False, str(pre))
                snooze_ok = False
                break
            if not invoke_dispatcher(1, f"snooze tick {i + 1}"):
                snooze_ok = False
                break
            row = job_row(snooze_id) or {}
            if not (row.get("status") == "pending" and row.get("attempts") == 0
                    and row.get("next_retry_at", "") > iso(0)):
                snooze_ok = False
                check(f"snooze tick {i + 1} settles the row", False, str(row))
                break
        if snooze_ok:
            check("three snoozes leave pending, attempts 0, retry pushed", True)

        # dead-letter: a forced failure with max_attempts 1
        dead_id = plant("smoke_test", {"fail": True}, max_attempts=1)
        if invoke_dispatcher(1, "dead-letter tick"):
            row = job_row(dead_id) or {}
            check("a failing row with max_attempts 1 dead-letters in one tick",
                  row.get("status") == "dead" and "forced failure" in (row.get("last_error") or ""),
                  str(row))

        # lease: a stale running row returns to pending, attempt increment kept
        lease_id = plant("smoke_test", {}, status="running", attempts=2,
                         next_retry_at=iso(+60), updated_at=iso(-6))
        if invoke_dispatcher(0, "lease tick"):
            row = job_row(lease_id) or {}
            check("a lease-expired running row is reclaimed",
                  row.get("status") == "pending" and row.get("attempts") == 2, str(row))

        skip("budget release", "forcing a spent budget live is unbounded; pinned by contract.test.ts")

        # The two switches the degrade leg flipped must be back where they were.
        stub_now = one(svc("GET", "/rest/v1/config?select=value&key=eq.llm_stub_mode")[1] or []) or {}
        fail_now = one(svc("GET", "/rest/v1/config?select=value&key=eq.llm_force_fail")[1] or []) or {}
        check("llm_stub_mode restored", stub_now.get("value") == (prev_stub or {}).get("value"),
              str(stub_now))
        check("llm_force_fail restored", fail_now.get("value") == (prev_fail or {}).get("value"),
              str(fail_now))
    finally:
        if planted_jobs:
            svc("DELETE", f"/rest/v1/jobs?id=in.({','.join(planted_jobs)})")
        # The degrade turn enqueues its own follow-ups; they belong to the disposable user.
        svc("DELETE", f"/rest/v1/jobs?payload->>user_id=eq.{uid}")
        req(url, "POST", "/rest/v1/rpc/purge_user_data", {"p_user_id": uid}, token=service, key=service)
        req(url, "DELETE", f"/auth/v1/admin/users/{uid}", token=service, key=service)
        sql_rows("select cron.alter_job(jobid, active => true) from cron.job "
                 "where jobname = 'job-dispatcher-tick';")
        resumed = one(sql_rows("select active from cron.job where jobname = 'job-dispatcher-tick';")) or {}
        check("dispatcher tick resumed", resumed.get("active") is True, str(resumed))
        check("disposable user removed",
              not (req(url, "GET", f"/rest/v1/profiles?select=id&id=eq.{uid}",
                       token=service, key=service)[1] or []))

    # The orphan count is Step 1's one-time number; re-read here as the residual check.
    orphans = one(sql_rows("""
      select count(*) as n
        from public.messages m
       where m.metadata->>'source' = 'sync_degrade'
         and m.reply_to_message_id is not null
         and not exists (select 1 from public.jobs j where j.id::text = m.metadata->>'source_job_id')
    """)) or {}
    check("no sync_degrade orphan holds a reply without its retry",
          int(orphans.get("n") or 0) == 0, str(orphans))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--static-only", action="store_true", help="skip DB and network legs")
    args = ap.parse_args()

    load_dotenv()
    static_legs()
    if not args.static_only:
        try:
            live_legs()
        except Exception as exc:  # noqa: BLE001 - a crashed leg is a failed gate, not a pass
            check("live legs completed", False, f"{type(exc).__name__}: {exc}")

    print("\n== summary ==")
    if SKIPS:
        print(f"  skipped: {len(SKIPS)}")
    if FAILS:
        print(f"  FAILED: {len(FAILS)}")
        for f in FAILS:
            print(f"    - {f}")
        return 1
    print("  ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
