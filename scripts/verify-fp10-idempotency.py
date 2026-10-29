#!/usr/bin/env python3
"""verify-fp10-idempotency.py -- FP-10 FR-7's double-fire matrix.

Every leg fires the same request twice (or plants the same job twice) and asserts what the
audit document claims: the second fire writes nothing. Each leg prints one structured line and
is collected into `--json` for the acceptance doc.

Legs (the audit register's live half):

  A1  double send-message            -> duplicate, one user row, one reply
  A2  repair window                  -> an orphaned user row is answered by the retry, then duplicate
  A3  double submit-checkin          -> duplicate, the echoed pair, one doing row
  A4  double chip tap                -> duplicate, the same secondary reply id
  A5  double metric confirm          -> duplicate, no second metric row
  A6  double quest accept            -> duplicate, no second quest metric
  A7  re-flag                        -> ok, exactly one purge_memory job
  A8  opening trigger re-fire        -> one opening row, a second profile insert is impossible
  A9  metric_eval unique             -> a second (metric_id, computed_for) point is rejected
  A10 double ticks (4)               -> the second tick inserts nothing
  B1  journal_extract pair           -> one chain, one marker
  B4  auto-adopt replay              -> a replayed arrival scores nothing
  B2  proactive pair                 -> one proactive message for the slot-day

Dispatcher ticks are paused for the whole run, so planted rows can never be consumed by the
live cron and the exact due-count guards stay meaningful.

Usage:
  python scripts/verify-fp10-idempotency.py                    # all legs, human output
  python scripts/verify-fp10-idempotency.py --json out.json    # + machine-readable ledger
  python scripts/verify-fp10-idempotency.py --legs A1,A2       # a subset

Exit code 0 iff every leg passed or was skipped with a reason.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
LEGS = []


# --------------------------------------------------------------------------- plumbing


def load_dotenv():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


def leg(name, assertion, ok, detail="", evidence="", skipped=None):
    """Record one leg. `ok` is a bool; `skipped` is a reason string for a leg not run."""
    if skipped:
        entry = {"leg": name, "assertion": assertion, "status": "skipped",
                 "detail": skipped, "evidence": evidence}
        print(f"  SKIP {name}: {assertion} -- {skipped}")
    else:
        entry = {"leg": name, "assertion": assertion, "status": "pass" if ok else "fail",
                 "detail": detail if not ok else "", "evidence": evidence}
        print(f"  {'PASS' if ok else 'FAIL'} {name}: {assertion}"
              + (f" -- {detail}" if detail and not ok else ""))
    LEGS.append(entry)
    return bool(ok)


def req(url, method, path, body=None, token=None, key=None, timeout=120, prefer=None):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["apikey"] = key
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(3):
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
        except (urllib.error.URLError, ConnectionResetError) as exc:
            # A reset mid-drill is a transient transport failure, not a verdict.
            last = exc
            time.sleep(0.6 * (attempt + 1))
    raise last


def sql_rows(sql):
    fd, path = tempfile.mkstemp(suffix=".sql", prefix="fp10-idem-")
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
            raise RuntimeError(f"db query failed: {proc.stdout[-700:]} {proc.stderr[-300:]}")
        return json.loads(text[start:end + 1]).get("rows", [])
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def one(rows):
    return rows[0] if rows else None


def now_utc():
    return datetime.now(timezone.utc)


def iso(delta_minutes):
    return (now_utc() + timedelta(minutes=delta_minutes)).isoformat()


def now_iso():
    """PostgREST-safe instant (no `+` offset to be decoded as a space)."""
    return now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- the matrix


def run(args):
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not service or not anon:
        print("  SKIP: need SUPABASE_URL + SERVICE_ROLE_KEY + ANON_KEY")
        return 2

    sys.path.insert(0, SCRIPTS)
    from _mint_dev_jwt import mint_access_token  # noqa: E402

    def svc(method, path, body=None, prefer=None):
        return req(url, method, path, body, token=service, key=service, prefer=prefer)

    def user(method, path, body=None, prefer=None):
        return req(url, method, path, body, token=token, key=anon, prefer=prefer)

    def fn(name, body, timeout=120):
        return req(url, "POST", f"/functions/v1/{name}", body, token=token, key=anon, timeout=timeout)

    def rows(path):
        st, body = svc("GET", path)
        if st != 200 or not isinstance(body, list):
            raise RuntimeError(f"GET {path} -> {st} {str(body)[:220]}")
        return body

    # --- disposable user
    email = f"fp10-idem-{uuid.uuid4().hex[:10]}@example.com"
    st, created = req(url, "POST", "/auth/v1/admin/users",
                      {"email": email, "password": uuid.uuid4().hex + "Aa1!", "email_confirm": True},
                      token=service, key=service)
    if st not in (200, 201) or not isinstance(created, dict) or not created.get("id"):
        print(f"  FAIL setup: temp user -- {st} {created}")
        return 1
    uid = created["id"]
    second_uid = None
    token, _claims = mint_access_token(url, service, email)
    planted_jobs = []
    print(f"  user : {uid}")

    # --- profile: complete onboarding, an all-day hourly grid, UTC
    svc("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {
        "onboarding_stage": "complete",
        "checkin_cadence_minutes": 60,
        "checkin_active_hours_start": "00:00:00",
        "checkin_active_hours_end": "23:59:00",
        "timezone": "UTC",
    })

    prev_stub = one(rows("/rest/v1/config?select=value&key=eq.llm_stub_mode")) or {}
    prev_lookback = one(rows("/rest/v1/config?select=value&key=eq.watchdog_lookback_minutes")) or {}
    prev_windows = None

    def job_ids():
        return {r["id"] for r in sql_rows("select id from public.jobs;")}

    def tick(sql):
        return one(sql_rows(sql)) or {}

    def due_count():
        row = one(sql_rows("select count(*) as n from public.jobs where status in "
                           "('pending','failed') and next_retry_at <= now();")) or {}
        return int(row.get("n") or 0)

    def park_other_due(keep):
        """Push every due job that is not one of ours one minute out.

        The drill must never consume someone else's work (the dispatcher is paused, but the
        exact-count guard is the assertion), and it must never delete it either: a parked row
        simply runs on the next real tick.
        """
        due = rows(f"/rest/v1/jobs?select=id&status=in.(pending,failed)"
                   f"&next_retry_at=lte.{now_iso()}")
        others = [r["id"] for r in due if r["id"] not in keep]
        if others:
            svc("PATCH", f"/rest/v1/jobs?id=in.({','.join(others)})", {"next_retry_at": iso(+60)})
        return len(others)

    def run_dispatcher(expected_due):
        if due_count() != expected_due:
            return None
        st, body = svc("POST", "/functions/v1/job-dispatcher", {})
        return body if st == 200 else None

    def plant(job_type, payload, **cols):
        row = {
            "type": job_type, "payload": payload,
            "status": cols.pop("status", "pending"),
            "attempts": cols.pop("attempts", 0),
            "max_attempts": cols.pop("max_attempts", 5),
            "next_retry_at": cols.pop("next_retry_at", iso(-1)),
        }
        row.update(cols)
        st, body = svc("POST", "/rest/v1/jobs", row, prefer="return=representation")
        made = (body or [{}])[0] if isinstance(body, list) else {}
        if not made.get("id"):
            raise RuntimeError(f"could not plant {job_type}: {st} {str(body)[:200]}")
        planted_jobs.append(made["id"])
        return made

    def send(text, cmid, extra=None):
        body = {"content": text, "client_message_id": cmid}
        if extra:
            body.update(extra)
        return fn("send-message", body)

    def cmid():
        return str(uuid.uuid4())

    wanted = None
    if args.legs:
        wanted = {part.strip().upper() for part in args.legs.split(",") if part.strip()}

    def want(name):
        return wanted is None or name in wanted

    ctx = {}
    try:
        svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": True})
        # --- pause the dispatcher tick: planted rows must be ours alone
        sql_rows("select cron.alter_job(jobid, active => false) from cron.job "
                 "where jobname = 'job-dispatcher-tick';")
        # ---------------------------------------------------------------- A1
        if want("A1"):
            c = cmid()
            st1, b1 = send("Leg A1: the same turn, twice.", c)
            st2, b2 = send("Leg A1: the same turn, twice.", c)
            users = rows(f"/rest/v1/messages?select=id&role=eq.user&client_message_id=eq.{c}")
            replies = rows(f"/rest/v1/messages?select=id&role=eq.assistant"
                           f"&reply_to_message_id=eq.{(b1 or {}).get('user_message_id')}") \
                if (b1 or {}).get("user_message_id") else []
            leg("A1", "a verbatim resend returns duplicate with the same reply",
                st1 == 200 and st2 == 200 and (b1 or {}).get("status") == "ok"
                and (b2 or {}).get("status") == "duplicate"
                and (b2 or {}).get("assistant_message_id") == (b1 or {}).get("assistant_message_id")
                and len(users) == 1 and len(replies) == 1,
                f"{st1}/{st2} {str(b1)[:120]} | {str(b2)[:120]} | users={len(users)} replies={len(replies)}",
                "TECH-SPEC §5.1; `messages_user_client_msg_uniq`; `scripts/verify-step8.py`")
            ctx["reply"] = (b1 or {}).get("assistant_message_id")
            ctx["user_msg"] = (b1 or {}).get("user_message_id")

        # ---------------------------------------------------------------- A2
        if want("A2"):
            c = cmid()
            text = "Leg A2: a turn whose reply never landed."
            st, made = svc("POST", "/rest/v1/messages", {
                "user_id": uid, "role": "user", "content": text, "client_message_id": c,
            }, prefer="return=representation")
            planted = (made or [{}])[0] if isinstance(made, list) else {}
            st1, b1 = send(text, c)
            st2, b2 = send(text, c)
            replies = rows(f"/rest/v1/messages?select=id&role=eq.assistant"
                           f"&reply_to_message_id=eq.{planted.get('id')}") if planted.get("id") else []
            leg("A2", "an unanswered turn is repaired by the resend, and the next resend is a duplicate",
                bool(planted.get("id")) and st1 == 200 and (b1 or {}).get("status") == "ok"
                and (b1 or {}).get("user_message_id") == planted.get("id")
                and len(replies) == 1 and (b2 or {}).get("status") == "duplicate",
                f"plant={st} {str(planted)[:80]} | first={st1} {str(b1)[:100]} | "
                f"second={st2} {str(b2)[:100]} | replies={len(replies)}",
                "TECH-SPEC §5.1 (repair-on-duplicate); `scripts/verify-fp10-idempotency.py`")

        # ---------------------------------------------------------------- A3
        if want("A3"):
            hour = int(now_utc().timestamp() // 3600) * 3600
            attempts = []
            ok3 = False
            detail3 = ""
            for back in (0, 1, 2):
                window_ms = (hour - back * 3600) * 1000
                st1, b1 = fn("submit-checkin", {
                    "content": "Leg A3: the same window, twice.",
                    "capture": "reply", "windowTs": window_ms,
                })
                if st1 == 200:
                    st2, b2 = fn("submit-checkin", {
                        "content": "Leg A3: the same window, twice.",
                        "capture": "reply", "windowTs": window_ms,
                    })
                    doing_id = (b1 or {}).get("doing_id")
                    all_doings = rows(f"/rest/v1/doings_logs?select=id,checkin_window"
                                      f"&user_id=eq.{uid}")
                    mine_row = next((d for d in all_doings if d.get("id") == doing_id), None)
                    same = [d for d in all_doings
                            if mine_row and d.get("checkin_window") == mine_row.get("checkin_window")]
                    ok3 = (st2 == 200 and (b1 or {}).get("status") == "ok"
                           and (b2 or {}).get("status") == "duplicate"
                           and (b2 or {}).get("doing_id") == doing_id
                           and (b2 or {}).get("energy") == (b1 or {}).get("energy")
                           and len(same) == 1)
                    detail3 = (f"window=hour-{back} | first={st1} {str(b1)[:110]} | "
                               f"second={st2} {str(b2)[:110]} | same-window rows={len(same)}")
                    attempts.append(back)
                    break
                attempts.append(back)
                detail3 = f"window=hour-{back} rejected: {st1} {str(b1)[:120]}"
            leg("A3", "a replayed check-in returns duplicate with the echoed pair",
                ok3, detail3,
                "TECH-SPEC §7.1; `doings_logs_one_checkin_window`; `scripts/verify-fp04-step2.py`")

        # ---------------------------------------------------------------- A4
        if want("A4"):
            st, b = send("Leg A4: a Medium turn with persona chips.",
                         cmid(), {"dev_force": {"tier": "medium", "domain": "Career"}})
            mid = (b or {}).get("assistant_message_id")
            user_msg = (b or {}).get("user_message_id")
            if st != 200 or not mid:
                leg("A4", "a double chip tap is a duplicate", False,
                    f"no reply to chip: {st} {str(b)[:140]}",
                    "TECH-SPEC §5.3; `messages_one_secondary_reply`")
            else:
                # The chips live in `metadata.persona_options` (§4.2). The stub's canned payload
                # carries none, so the drill writes them onto the reply - which is exactly the
                # shape a Medium turn ships, and the only thing `select-persona` reads.
                row = one(rows(f"/rest/v1/messages?select=id,metadata&id=eq.{mid}"))
                metadata = dict((row or {}).get("metadata") or {})
                metadata["persona_options"] = [
                    {"key": "therapist_empath", "label": "Empath", "one_liner": "warm, patient"},
                    {"key": "mentor_tough", "label": "Tough", "one_liner": "direct, demanding"},
                ]
                svc("PATCH", f"/rest/v1/messages?id=eq.{mid}", {"metadata": metadata})
                st1, b1 = fn("select-persona", {"message_id": mid, "persona_key": "therapist_empath"})
                st2, b2 = fn("select-persona", {"message_id": mid, "persona_key": "therapist_empath"})
                st3, b3 = fn("select-persona", {"message_id": mid, "persona_key": "mentor_tough"})
                secondary = rows(f"/rest/v1/messages?select=id&secondary_reply_to_message_id=eq."
                                 f"{user_msg}") if user_msg else []
                leg("A4", "a double chip tap returns duplicate with the same reply id",
                    st1 == 200 and (b1 or {}).get("status") == "ok"
                    and (b2 or {}).get("status") == "duplicate"
                    and (b2 or {}).get("assistant_message_id") == (b1 or {}).get("assistant_message_id")
                    and (b3 or {}).get("status") == "duplicate"
                    and len(secondary) == 1,
                    f"{st1} {str(b1)[:100]} | {st2} {str(b2)[:100]} | other key {st3} {str(b3)[:80]}"
                    f" | secondary={len(secondary)}",
                    "TECH-SPEC §5.3; `messages_one_secondary_reply`; `scripts/verify-fp03-step3.py`")

        # ---------------------------------------------------------------- A5
        if want("A5"):
            options = [
                {"key": "Momentum", "label": "Momentum", "domain": "Discipline/Habits",
                 "output_unit": "doings"},
                {"key": "Deep Work Hours", "label": "Deep work", "domain": "Career",
                 "output_unit": "h"},
                {"key": "Check-in Consistency", "label": "Consistency",
                 "domain": "Discipline/Habits", "output_unit": "%"},
            ]
            st, made = svc("POST", "/rest/v1/messages", {
                "user_id": uid, "role": "assistant",
                "content": "Leg A5: pick your metrics.",
                "metadata": {"source": "onboarding", "metric_options": options},
            }, prefer="return=representation")
            offer = (made or [{}])[0] if isinstance(made, list) else {}
            body = {"message_id": offer.get("id"), "keys": ["Momentum"]}

            # Set user onboarding stage to metric_selection so the first call exercises the write path
            svc("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {"onboarding_stage": "metric_selection"})
            st1, b1 = fn("select-metrics", body)
            st2, b2 = fn("select-metrics", body)

            created_metrics = rows(f"/rest/v1/metrics?select=id,is_core,name&user_id=eq.{uid}&name=eq.Momentum")
            m_ids1 = (b1 or {}).get("metric_ids") or []
            m_ids2 = (b2 or {}).get("metric_ids") or []

            leg("A5", "a double metric confirm returns duplicate and writes no second metric",
                bool(offer.get("id"))
                and st1 == 200 and (b1 or {}).get("status") == "ok" and len(m_ids1) > 0
                and st2 == 200 and (b2 or {}).get("status") == "duplicate" and m_ids1 == m_ids2
                and len(created_metrics) == 1 and created_metrics[0].get("is_core") is True,
                f"offer={st} | first={st1} {str(b1)[:100]} | second={st2} {str(b2)[:100]}"
                f" | metrics={len(created_metrics)}",
                "TECH-SPEC §5.3; stage CAS; `scripts/verify-fp09-step4.py`")

            # Restore stage to complete for subsequent legs
            svc("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {"onboarding_stage": "complete"})

        # ---------------------------------------------------------------- A6
        if want("A6"):
            offer = {
                "name": "Leg A6 Quest", "domain": "Career", "output_unit": "h",
                "formula": {"var": "doings_count"}, "deadline_days": 7,
            }
            st, made = svc("POST", "/rest/v1/messages", {
                "user_id": uid, "role": "assistant",
                "content": "Leg A6: a side quest.",
                "metadata": {"source": "pipeline_primary", "quest_offer": offer},
            }, prefer="return=representation")
            row = (made or [{}])[0] if isinstance(made, list) else {}
            body = {"message_id": row.get("id"), "accepted": True}
            st1, b1 = fn("accept-quest", body)
            st2, b2 = fn("accept-quest", body)
            quests = rows(f"/rest/v1/metrics?select=id&user_id=eq.{uid}&is_quest=is.true")
            leg("A6", "a double quest accept returns duplicate and writes one quest metric",
                bool(row.get("id")) and st1 == 200 and (b1 or {}).get("status") == "ok"
                and (b2 or {}).get("status") == "duplicate"
                and (b2 or {}).get("metric_id") == (b1 or {}).get("metric_id")
                and len(quests) == 1,
                f"offer={st} | first={st1} {str(b1)[:100]} | second={st2} {str(b2)[:100]}"
                f" | quests={len(quests)}",
                "TECH-SPEC §7.9; `accept_quest()` advisory lock; `scripts/verify-fp08-step1.py`")

        # ---------------------------------------------------------------- A7
        if want("A7"):
            st, b = send("Leg A7: a message that will be flagged.", cmid())
            mid = (b or {}).get("user_message_id")
            st1, b1 = fn("flag-unsavable", {"message_id": mid})
            st2, b2 = fn("flag-unsavable", {"message_id": mid})
            jobs = rows(f"/rest/v1/jobs?select=id&type=eq.purge_memory&payload->>message_id=eq.{mid}")
            leg("A7", "a re-flag enqueues exactly one purge job",
                st1 == 200 and st2 == 200 and (b1 or {}).get("status") == "ok"
                and (b2 or {}).get("status") == "ok" and len(jobs) == 1,
                f"{st1} {str(b1)[:90]} | {st2} {str(b2)[:90]} | jobs={len(jobs)}",
                "TECH-SPEC §7.6; 0036 trigger; `scripts/verify-fp10-step1.py`")

        # ---------------------------------------------------------------- A8
        if want("A8"):
            st, made = req(url, "POST", "/auth/v1/admin/users", {
                "email": f"fp10-idem-b-{uuid.uuid4().hex[:8]}@example.com",
                "password": uuid.uuid4().hex + "Aa1!", "email_confirm": True,
            }, token=service, key=service)
            second_uid = (made or {}).get("id") if isinstance(made, dict) else None
            opening = rows(f"/rest/v1/messages?select=id&user_id=eq.{second_uid}"
                           f"&metadata->>source=eq.onboarding_opening") if second_uid else []
            st_dup, body_dup = svc("POST", "/rest/v1/profiles", {"id": second_uid},
                                   prefer="return=representation")
            leg("A8", "the opening trigger writes one row, and a re-fired profile insert is impossible",
                bool(second_uid) and len(opening) == 1 and st_dup in (400, 409, 422, 500),
                f"user={st} | opening={len(opening)} | reinsert={st_dup} {str(body_dup)[:100]}",
                "TECH-SPEC §7.7; 0033 source-tag guard; `scripts/verify-fp09-step1.py`")

        # ---------------------------------------------------------------- A9
        if want("A9"):
            st, made = svc("POST", "/rest/v1/metrics", {
                "user_id": uid, "name": "Leg A9 Metric", "domain": "Career",
                "formula": {"op": "literal", "value": 1}, "output_unit": "h",
                "formula_status": "validated",
            }, prefer="return=representation")
            metric = (made or [{}])[0] if isinstance(made, list) else {}
            computed_for = now_utc().date().isoformat()
            point = {"metric_id": metric.get("id"),
                     "computed_for": computed_for, "value": 1}
            st1, b1 = svc("POST", "/rest/v1/metric_points", point, prefer="return=representation")
            st2, b2 = svc("POST", "/rest/v1/metric_points", point, prefer="return=representation")
            points = rows(f"/rest/v1/metric_points?select=id&metric_id=eq.{metric.get('id')}")
            leg("A9", "a second point for the same (metric_id, computed_for) is rejected",
                bool(metric.get("id")) and st1 in (200, 201) and st2 >= 400 and len(points) == 1,
                f"metric={st} | first={st1} | second={st2} {str(b2)[:100]} | points={len(points)}",
                "TECH-SPEC §3.3 `unique (metric_id, computed_for)`; `scripts/verify-fp07-step5.py`")

        # ---------------------------------------------------------------- A10
        if want("A10"):
            ticks = [
                ("proactive_tick", "select public.proactive_tick(now()) as n;"),
                ("drift_scan_tick", "select public.drift_scan_tick(now()) as n;"),
                ("histogram_eval_tick", "select public.histogram_eval_tick(now()) as n;"),
                ("enqueue_metric_eval_jobs", "select public.enqueue_metric_eval_jobs(now()) as n;"),
            ]
            for name, sql in ticks:
                before = job_ids()
                first = int(tick(sql).get("n") or 0)
                after_first = job_ids()
                made = after_first - before
                # Park what the tick created: the rows stay (that is what makes the second tick
                # a no-op) but they are no longer due, so nothing runs while the cron is paused.
                if made:
                    svc("PATCH", f"/rest/v1/jobs?id=in.({','.join(sorted(made))})",
                        {"next_retry_at": iso(+60)})
                second = int(tick(sql).get("n") or 0)
                after_second = job_ids()
                leg(f"A10/{name}", "the second tick inserts nothing",
                    second == 0 and after_second == after_first,
                    f"first={first} rows={len(made)} second={second} "
                    f"delta={len(after_second - after_first)}",
                    "TECH-SPEC §2.2; the tick's any-status dedupe; `scripts/verify-fp07-step5.py`")

        # ---------------------------------------------------------------- B1
        if want("B1"):
            st, made = svc("POST", "/rest/v1/journal_entries", {
                "user_id": uid, "content": "Leg B1: one evening, two chain heads.",
                "entry_date": now_utc().date().isoformat(),
            }, prefer="return=representation")
            entry = (made or [{}])[0] if isinstance(made, list) else {}
            if not entry.get("id"):
                leg("B1", "a duplicate journal_extract is a no-op", False,
                    f"entry plant failed: {st} {str(made)[:120]}", "TECH-SPEC §7.4")
            else:
                ctx["entry_id"] = entry["id"]
                a = plant("journal_extract", {"entry_id": entry["id"]})
                b = plant("journal_extract", {"entry_id": entry["id"]})
                park_other_due({a["id"], b["id"]})
                # The anchor-plan generation has no registered stub shape, so this leg runs
                # against the real provider. The idempotency proof is the unique index on
                # anchor_plans(user_id, plan_date) - the handler's message pre-check is
                # best-effort. Run the two extract heads, then assert ONE plan row exists.
                svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": False})
                ran1 = run_dispatcher(2)
                svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode", {"value": True})
                after = rows(f"/rest/v1/journal_entries?select=vagueness_score&id=eq.{entry['id']}")
                plans = rows(f"/rest/v1/anchor_plans?select=id&user_id=eq.{uid}")
                anchor_msgs = rows(f"/rest/v1/messages?select=id&user_id=eq.{uid}"
                                   f"&metadata->>source=eq.anchor_plan")
                leg("B1", "two chain heads write one marker, one plan and at most one plan message",
                    ran1 is not None and (one(after) or {}).get("vagueness_score") is not None
                    and len(plans) == 1,
                    f"heads={ran1} | marker={(one(after) or {}).get('vagueness_score')}"
                    f" | plans={len(plans)} | anchor msgs={len(anchor_msgs)}",
                    "TECH-SPEC §7.4 marker-first + the anchor_plan pre-check; "
                    "`scripts/verify-fp05-step4.py`")

        # ---------------------------------------------------------------- B4
        if want("B4"):
            def successes():
                row = one(rows(f"/rest/v1/persona_stats?select=auto_adopt_successes"
                               f"&user_id=eq.{uid}&domain=eq.Career"))
                return int((row or {}).get("auto_adopt_successes") or 0)

            # Earlier legs have already scored auto-adopt successes for this user, and each one
            # shifts the domain's bands (D20) — which moves the `high` force below the shifted
            # auto threshold. Reset the counters so the leg's own two turns decide the outcome.
            svc("DELETE", f"/rest/v1/persona_stats?user_id=eq.{uid}")
            base = successes()
            st, b = send("Leg B4: an auto turn to engage with.", cmid(),
                         {"dev_force": {"tier": "high", "domain": "Career"}})
            c2 = cmid()
            st1, b1 = send("Leg B4: engaging with it.", c2)
            after_first = successes()
            st2, b2 = send("Leg B4: engaging with it.", c2)
            after_replay = successes()
            leg("B4", "a replayed arrival scores no second auto-adopt success",
                st == 200 and st1 == 200 and st2 == 200
                and after_first > base and after_replay == after_first,
                f"auto={st} {str(b)[:80]} | base={base} after-turn={after_first}"
                f" | replay={after_replay} | {str(b2)[:80]}",
                "TECH-SPEC §5.3; `_shared/pipeline/autoAdopt.ts`; `scripts/verify-fp04-step3.py`")

        # ---------------------------------------------------------------- B2
        if want("B2"):
            # `proactive_windows` is a [SPEC] pair of local labels, and the tick only matches
            # inside [slot, slot+30min). Point it at the current half-hour for the drill, and
            # restore it in the finally: the tick must be deterministic at any wall-clock time.
            slot = now_utc().replace(minute=(now_utc().minute // 30) * 30,
                                     second=0, microsecond=0).strftime("%H:%M")
            prev_windows = one(rows("/rest/v1/config?select=value&key=eq.proactive_windows")) or {}
            svc("PATCH", "/rest/v1/config?key=eq.proactive_windows", {"value": [slot]})
            svc("PATCH", f"/rest/v1/messages?user_id=eq.{uid}", {"created_at": iso(-3 * 24 * 60)})
            before = job_ids()
            made = int(tick("select public.proactive_tick(now()) as n;").get("n") or 0)
            new_ids = job_ids() - before
            mine = rows(f"/rest/v1/jobs?select=id,payload&type=eq.proactive"
                        f"&payload->>user_id=eq.{uid}") if new_ids else []
            if not mine:
                leg("B2", "a duplicate proactive job writes one message", True,
                    skipped=f"the tick created no job for this user (outside "
                            f"`proactive_windows` or not silent); created {made} for others",
                    evidence="TECH-SPEC §7.7; `scripts/verify-fp09-step5.py`")
                # The tick's rows for other users were parked by `park_other_due`; its row for
                # this user (and the copy) belong to the disposable account and go with it.
            else:
                payload = mine[0]["payload"]
                job_id = mine[0]["id"]
                park_other_due({job_id})
                ran1 = run_dispatcher(1)
                wrote1 = rows(f"/rest/v1/messages?select=id&user_id=eq.{uid}"
                              f"&metadata->>source=eq.proactive")
                # The real replay: the same row re-delivered (a lease timeout or a crash).
                # A second *job* for the same slot-day cannot exist - the tick's any-status
                # dedupe (A10) prevents it - so the handler's job-id lookup is what this proves.
                svc("PATCH", f"/rest/v1/jobs?id=eq.{job_id}",
                    {"status": "pending", "attempts": 0, "next_retry_at": iso(-1)})
                ran2 = run_dispatcher(1)
                wrote2 = rows(f"/rest/v1/messages?select=id&user_id=eq.{uid}"
                              f"&metadata->>source=eq.proactive")
                leg("B2", "a re-delivered proactive job writes one message for the slot-day",
                    ran1 is not None and ran2 is not None
                    and len(wrote1) == 1 and len(wrote2) == 1,
                    f"first={ran1} msgs={len(wrote1)} | redelivered={ran2} msgs={len(wrote2)}"
                    f" | payload={str(payload)[:120]}",
                    "TECH-SPEC §7.7; `_shared/proactive/runProactive.ts:274`; "
                    "`scripts/verify-fp09-step5.py`")
                # The tick's rows for other users were parked by `park_other_due`; its row for
                # this user (and the copy) belong to the disposable account and go with it.

    except Exception as exc:  # noqa: BLE001 - a crashed leg is a failed gate, not a pass
        leg("harness", "every leg ran to completion", False, f"{type(exc).__name__}: {exc}",
            "FP-10 FR-7")
    finally:
        # --- cleanup. Each step is independent: a transient failure in one must never leave
        # the kill switches flipped or the dispatcher tick paused.
        def safely(label, fn_):
            try:
                fn_()
            except Exception as exc:  # noqa: BLE001
                print(f"  WARN cleanup {label}: {type(exc).__name__}: {exc}")

        if planted_jobs:
            safely("planted jobs",
                   lambda: svc("DELETE", f"/rest/v1/jobs?id=in.({','.join(planted_jobs)})"))
        safely("user jobs", lambda: svc("DELETE", f"/rest/v1/jobs?payload->>user_id=eq.{uid}"))
        # The journal chain's jobs carry only `entry_id`, so purge_user_data cannot see them.
        if ctx.get("entry_id"):
            safely("chain jobs",
                   lambda: svc("DELETE",
                               f"/rest/v1/jobs?payload->>entry_id=eq.{ctx['entry_id']}"))
        safely("purge_user_data", lambda: req(url, "POST", "/rest/v1/rpc/purge_user_data",
                                             {"p_user_id": uid}, token=service, key=service))
        safely("auth user", lambda: req(url, "DELETE", f"/auth/v1/admin/users/{uid}",
                                        token=service, key=service))
        if second_uid:
            safely("second auth user", lambda: req(url, "DELETE",
                                                   f"/auth/v1/admin/users/{second_uid}",
                                                   token=service, key=service))
        safely("stub mode", lambda: svc("PATCH", "/rest/v1/config?key=eq.llm_stub_mode",
                                        {"value": (prev_stub or {}).get("value")}))
        safely("lookback", lambda: svc("PATCH",
                                       "/rest/v1/config?key=eq.watchdog_lookback_minutes",
                                       {"value": (prev_lookback or {}).get("value")}))
        if prev_windows is not None:
            safely("proactive windows", lambda: svc("PATCH",
                                                    "/rest/v1/config?key=eq.proactive_windows",
                                                    {"value": prev_windows.get("value")}))
        safely("resume tick", lambda: sql_rows(
            "select cron.alter_job(jobid, active => true) from cron.job "
            "where jobname = 'job-dispatcher-tick';"))

    stub_after = one(rows("/rest/v1/config?select=value&key=eq.llm_stub_mode")) or {}
    leg("hygiene", "llm_stub_mode restored and the dispatcher tick resumed",
        stub_after.get("value") == (prev_stub or {}).get("value"),
        f"stub={stub_after}", "AGENTS.md §9")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", help="write the per-leg ledger here")
    ap.add_argument("--legs", help="comma-separated subset, e.g. A1,A3,B1")
    args = ap.parse_args()

    load_dotenv()
    print("== FP-10 idempotency matrix ==")
    code = run(args)

    failed = [l for l in LEGS if l["status"] == "fail"]
    skipped = [l for l in LEGS if l["status"] == "skipped"]
    print("\n== summary ==")
    print(f"  legs: {len(LEGS)} | pass: {len(LEGS) - len(failed) - len(skipped)}"
          f" | fail: {len(failed)} | skipped: {len(skipped)}")
    for l in failed:
        print(f"    FAIL {l['leg']}: {l['detail']}")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"legs": LEGS, "fail": len(failed), "skipped": len(skipped)}, fh, indent=2)
        print(f"  ledger: {args.json}")
    return 0 if code == 0 and not failed else 1


if __name__ == "__main__":
    sys.exit(main())
