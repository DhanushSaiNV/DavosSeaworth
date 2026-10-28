#!/usr/bin/env python3
"""FP-09 Step 1 verification: migration 0033 — opening trigger, backfill, proactive tick,
eight config seeds.

Automated (static + linked database):
  * static: exactly two definer functions with pinned search_path; no column/table/index/RLS
    change; the trigger is after-insert on profiles; the backfill is non-complete-only and
    guarded by the source tag; the tick reads every config value fail-closed; the any-status
    dedup has no status predicate; the payload keys are {user_id, slot, kind, gap_key?};
    the cron is */30; eight seeds upsert on key
  * live schema: migration applied; both functions definer/pinned; the trigger; the cron;
    the eight keys and their jsonb types; execute privileges; the touched-table column
    counts still match 0032 (the zero-column-growth proof)
  * opening: a planted profile insert writes exactly one tagged row (persona_key NULL,
    stage intro, content = config); a re-fired profile insert writes no second row; the
    backfill leaves exactly one row per non-complete profile and a re-run inserts none
  * tick truth table via backdated p_now: both windows once per local day, start inclusive /
    end exclusive, overlapping windows skip, silence boundary (120 min fails, 121 min
    passes), onboarding gate, any-status dedup (done + dead), kill switch, malformed config
    fail-closed, and the full gap vector -> kind/gap_key table

The script creates throwaway auth users and deletes them (cascade) at the end. It restores
every config value it patches and never touches a beta user's rows. Per-user job assertions
are scoped by the temp user id.

Usage: python scripts/verify-fp09-step1.py
"""

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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []
TZ = "Asia/Kolkata"

NEW_KEYS = {
    "onboarding_stage_questions": {"intro": 1, "baseline": 3, "goals": 3, "routine": 4,
                                   "metric_selection": 0},
    "onboarding_persona": "mentor_tough",
    "onboarding_opening_text": None,  # asserted dynamically; the placeholder is DRAFT
    "proactive_enabled": True,
    "proactive_windows": ["10:00", "19:30"],
    "proactive_persona": "mentor_tough",
    "proactive_min_silence_minutes": 120,
    "proactive_gap_min_baseline_facts": 5,
}
KEY_TYPES = {
    "onboarding_stage_questions": "object",
    "onboarding_persona": "string",
    "onboarding_opening_text": "string",
    "proactive_enabled": "boolean",
    "proactive_windows": "array",
    "proactive_persona": "string",
    "proactive_min_silence_minutes": "number",
    "proactive_gap_min_baseline_facts": "number",
}
COLUMN_COUNTS = {
    "config": 3,
    "jobs": 11,
    "memory_facts": 10,
    "messages": 13,
    "profiles": 17,
}


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


def req(url, method, path, body=None, token=None, key=None, timeout=60, prefer=None):
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


def rows(url, service, path):
    status, body = req(url, "GET", path, token=service, key=service)
    if status != 200:
        raise RuntimeError(f"GET {path} -> {status}: {body}")
    return body if isinstance(body, list) else []


def insert(url, service, table, payload):
    status, body = req(url, "POST", f"/rest/v1/{table}", payload, token=service, key=service,
                       prefer="return=representation")
    if status not in (200, 201, 204):
        raise RuntimeError(f"POST {table} -> {status}: {body}")
    return body


def patch(url, service, path, payload):
    status, body = req(url, "PATCH", path, payload, token=service, key=service,
                       prefer="return=representation")
    if status not in (200, 204):
        raise RuntimeError(f"PATCH {path} -> {status}: {body}")
    return body


def delete(url, service, path):
    status, body = req(url, "DELETE", path, token=service, key=service)
    if status not in (200, 204):
        raise RuntimeError(f"DELETE {path} -> {status}: {body}")
    return body


def rpc(url, service, fn, args):
    status, body = req(url, "POST", f"/rest/v1/rpc/{fn}", args, token=service, key=service)
    if status != 200:
        raise RuntimeError(f"rpc {fn} -> {status}: {body}")
    return body


def sql_rows(sql):
    """One management-API SQL round trip. Use -f so multi-line SQL survives Windows shells."""
    fd, path = tempfile.mkstemp(suffix=".sql", prefix="fp09-step1-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(sql)
        proc = subprocess.run(
            ["npx", "supabase", "db", "query", "--linked", "-f", path, "--output", "json"],
            cwd=ROOT, capture_output=True, text=True, timeout=120, shell=(os.name == "nt"),
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


def make_user(url, service, tag):
    email = f"{tag}-{uuid.uuid4().hex[:12]}@example.com"
    status, created = req(url, "POST", "/auth/v1/admin/users",
                          {"email": email, "password": uuid.uuid4().hex + "Aa1!",
                           "email_confirm": True},
                          token=service, key=service)
    if status not in (200, 201) or not isinstance(created, dict) or not created.get("id"):
        raise RuntimeError(f"could not create temp user: {status} {created}")
    user_id = created["id"]
    for _ in range(20):
        prof = rows(url, service, f"/rest/v1/profiles?select=id&id=eq.{user_id}")
        if prof:
            return user_id
        time.sleep(0.25)
    raise RuntimeError("temp profile not created by trigger")


def drop_user(url, service, user_id):
    try:
        delete(url, service, f"/rest/v1/jobs?type=eq.proactive&payload->>user_id=eq.{user_id}")
    except Exception as exc:  # noqa: BLE001
        print(f"  (job cleanup warning for {user_id}: {exc})")
    req(url, "DELETE", f"/auth/v1/admin/users/{user_id}", token=service, key=service)


def opening_rows(url, service, user_id):
    return rows(url, service,
                f"/rest/v1/messages?select=id,role,content,metadata,persona_key"
                f"&user_id=eq.{user_id}&metadata->>source=eq.onboarding_opening")


def set_profile(url, service, user_id, fields):
    patch(url, service, f"/rest/v1/profiles?id=eq.{user_id}", fields)


def set_baseline_facts(url, service, user_id, count):
    delete(url, service,
           f"/rest/v1/memory_facts?user_id=eq.{user_id}&fact_type=eq.baseline")
    if count:
        insert(url, service, "memory_facts", [
            {"user_id": user_id, "fact": f"baseline fact {i}", "fact_type": "baseline"}
            for i in range(count)
        ])


def set_all_gap_fields(url, service, user_id):
    set_profile(url, service, user_id, {
        "onboarding_stage": "complete",
        "timezone": TZ,
        "wake_time": "06:30",
        "sleep_time": "22:30",
        "routine": {"summary": "Morning walk, then a deep-work block."},
        "high_dopamine_activities": ["Walk", "Music"],
    })
    set_baseline_facts(url, service, user_id, 5)


def add_user_message(url, service, user_id, created_at, content="a user turn"):
    out = insert(url, service, "messages", [{
        "user_id": user_id, "role": "user", "content": content, "created_at": created_at,
    }])
    return out[0]["id"] if isinstance(out, list) and out else None


def update_message_created_at(url, service, message_id, created_at):
    patch(url, service, f"/rest/v1/messages?id=eq.{message_id}", {"created_at": created_at})


def clear_proactive_jobs(url, service, user_id):
    delete(url, service,
           f"/rest/v1/jobs?type=eq.proactive&payload->>user_id=eq.{user_id}")


def jobs_for_day(url, service, user_id, local_day):
    """Backdated tests use Asia/Kolkata times after 05:30, so UTC date == local date."""
    all_jobs = rows(url, service,
                    f"/rest/v1/jobs?select=id,payload,status,created_at&type=eq.proactive"
                    f"&payload->>user_id=eq.{user_id}&order=created_at")
    return [j for j in all_jobs if (j.get("created_at") or "")[:10] == local_day]


def tick(url, service, p_now):
    return rpc(url, service, "proactive_tick", {"p_now": p_now})


def expect_job(url, service, label, user_id, day, count, slot=None, kind=None, gap_key=None):
    jobs = jobs_for_day(url, service, user_id, day)
    if slot is not None:
        jobs = [j for j in jobs if (j.get("payload") or {}).get("slot") == slot]
    ok = len(jobs) == count
    if ok and count == 1:
        payload = jobs[0]["payload"]
        ok = payload.get("user_id") == user_id
        if slot is not None:
            ok = ok and payload.get("slot") == slot
        if kind is not None:
            ok = ok and payload.get("kind") == kind
        if gap_key is not None:
            ok = ok and payload.get("gap_key") == gap_key
        else:
            ok = ok and "gap_key" not in payload
    check(label, ok, repr(jobs))


def main():
    load_dotenv()
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service:
        sys.exit("need SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY")

    print("== FP-09 Step 1: migration 0033 — opening trigger, backfill, proactive tick ==\n")

    # ---------------------------------------------------------------- static
    path = os.path.join(ROOT, "supabase/migrations/0033_front_door_fp09.sql")
    with open(path, encoding="utf-8") as fh:
        migration = fh.read()

    print("== A. static migration surface ==")
    check("exactly two create-or-replace functions",
          len(re.findall(r"create\s+or\s+replace\s+function\s+public\.", migration, re.I)) == 2)
    check("create_opening_message + proactive_tick are the two functions",
          "create or replace function public.create_opening_message()" in migration
          and "create or replace function public.proactive_tick(" in migration)
    check("both functions are security definer with pinned search_path",
          migration.count("security definer") == 2
          and migration.count("set search_path = public") == 2)
    check("the tick takes an injectable p_now",
          "p_now timestamptz default clock_timestamp()" in migration)
    check("no create table / add column / create index / create policy",
          re.search(r"\bcreate\s+table\b", migration, re.I) is None
          and re.search(r"\badd\s+column\b", migration, re.I) is None
          and re.search(r"\bcreate\s+index\b", migration, re.I) is None
          and re.search(r"\bcreate\s+policy\b", migration, re.I) is None)
    check("no row-level-security change",
          re.search(r"\benable\s+row\s+level\s+security\b", migration, re.I) is None)
    check("trigger is after insert on public.profiles",
          re.search(r"create\s+trigger\s+on_profile_created\s+after\s+insert\s+on\s+public\.profiles",
                    migration, re.I) is not None)
    check("opening row is tagged, stage intro, persona_key NULL",
          "'source', 'onboarding_opening'" in migration
          and "'onboarding_stage', 'intro'" in migration
          and "persona_key" in migration
          and re.search(r"persona_key\)\s*values\s*\(.*?\bnull\b", migration, re.I | re.S) is not None)
    check("trigger is idempotent on the source tag",
          migration.count("m.metadata ->> 'source' = 'onboarding_opening'") >= 2)
    check("backfill is non-complete-only and guarded by the source tag",
          "p.onboarding_stage <> 'complete'" in migration
          and "m.metadata ->> 'source' = 'onboarding_opening'" in migration)
    check("tick reads all five runtime keys",
          all(k in migration for k in (
              "onboarding_opening_text", "proactive_enabled", "proactive_windows",
              "proactive_min_silence_minutes", "proactive_gap_min_baseline_facts")))
    check("tick kill switch is fail-closed",
          "v_enabled is distinct from 'true'::jsonb" in migration)
    check("windows config is fail-closed on non-array",
          "jsonb_typeof(v_windows) <> 'array'" in migration)
    check("silence and gap bounds are fail-closed integers",
          "v_silence_json::text !~ '^[0-9]+$'" in migration
          and "v_gap_min_json::text !~ '^[0-9]+$'" in migration)
    check("window is [slot, slot+30min), start inclusive, end exclusive",
          "v_slot_time + interval '30 minutes'" in migration
          and "v_local_time >= v_slot_time and v_local_time < v_end_time" in migration)
    check("exactly-one-window rule",
          "if v_match_count <> 1 then" in migration)
    check("silence boundary uses >= (exact 120 minutes fails closed)",
          "m.created_at >= p_now - (v_silence_minutes * interval '1 minute')" in migration)
    check("any-status dedup on (user_id, slot, local-day) with no status predicate",
          "j.payload ->> 'user_id' = v_profile.id::text" in migration
          and "j.payload ->> 'slot' = v_matched_slot" in migration
          and "(j.created_at at time zone v_profile.timezone)::date = v_local_date" in migration
          and "j.status" not in migration)
    check("gap order is wake -> sleep -> routine -> activities -> facts",
          migration.index("v_profile.wake_time is null")
          < migration.index("v_profile.sleep_time is null")
          < migration.index("v_profile.routine is null")
          < migration.index("v_profile.high_dopamine_activities is null")
          < migration.index("f.fact_type = 'baseline'"))
    check("payload keys are user_id, slot, kind, optional gap_key",
          all(k in migration for k in ("'user_id'", "'slot'", "'kind'", "'gap_key'")))
    check("eight seed keys are present and upsert on key",
          all(f"('{k}'" in migration for k in NEW_KEYS)
          and len(re.findall(r"^on conflict \(key\) do update", migration, re.M)) == 1)
    check("cron is proactive-tick every 30 minutes and reschedulable",
          "'proactive-tick'" in migration and "'*/30 * * * *'" in migration
          and "cron.unschedule('proactive-tick')" in migration)
    check("both functions are revoked from client roles and granted to service_role",
          migration.count("revoke execute on function public.") == 2
          and migration.count("grant execute on function public.") == 2)

    # ---------------------------------------------------------------- live schema
    print("\n== B. live schema ==")
    ver = sql_rows("select version from supabase_migrations.schema_migrations where version = '0033';")
    check("migration 0033 is applied", bool(ver), repr(ver))
    fn = sql_rows("select proname, prosecdef, proconfig from pg_proc where proname in "
                  "('create_opening_message','proactive_tick') order by proname;")
    fn_map = {r["proname"]: r for r in fn}
    check("both functions exist, definer, pinned search_path",
          set(fn_map) == {"create_opening_message", "proactive_tick"}
          and all(r["prosecdef"] is True and "search_path=public" in (r["proconfig"] or [])
                  for r in fn_map.values()), repr(fn))
    trig = sql_rows("select tgname, tgrelid::regclass::text as tbl, tgenabled "
                    "from pg_trigger where tgname = 'on_profile_created';")
    check("on_profile_created is enabled on public.profiles",
          len(trig) == 1 and trig[0]["tbl"] == "profiles" and trig[0]["tgenabled"] == "O",
          repr(trig))
    priv = sql_rows("select "
                    "has_function_privilege('authenticated', 'public.create_opening_message()', 'execute') as o_auth, "
                    "has_function_privilege('service_role', 'public.create_opening_message()', 'execute') as o_svc, "
                    "has_function_privilege('authenticated', 'public.proactive_tick(timestamptz)', 'execute') as t_auth, "
                    "has_function_privilege('service_role', 'public.proactive_tick(timestamptz)', 'execute') as t_svc;")
    check("trigger fn and tick are not executable by authenticated, executable by service_role",
          bool(priv) and priv[0]["o_auth"] is False and priv[0]["o_svc"] is True
          and priv[0]["t_auth"] is False and priv[0]["t_svc"] is True, repr(priv))
    sched = sql_rows("select jobname, schedule, active from cron.job where jobname = 'proactive-tick';")
    check("proactive-tick scheduled active at */30",
          len(sched) == 1 and sched[0]["schedule"] == "*/30 * * * *" and sched[0]["active"] is True,
          repr(sched))
    cols = sql_rows("select table_name, count(*)::int as n from information_schema.columns "
                    "where table_schema='public' and table_name in "
                    "('config','jobs','memory_facts','messages','profiles') "
                    "group by table_name order by table_name;")
    col_map = {r["table_name"]: r["n"] for r in cols}
    check("zero column growth beyond 0032 on the touched tables",
          col_map == COLUMN_COUNTS, repr(col_map))


    print("\n== C. seed values ==")
    cfg = rows(url, service, "/rest/v1/config?select=key,value&key=in.("
               + ",".join(sorted(KEY_TYPES)) + ")&order=key")
    cfg_map = {r["key"]: r["value"] for r in cfg}
    check("all eight keys present", set(cfg_map) == set(KEY_TYPES),
          repr(sorted(set(KEY_TYPES) - set(cfg_map))))
    for key, expected in NEW_KEYS.items():
        if expected is not None:
            check(f"{key} = {expected!r}", cfg_map.get(key) == expected, repr(cfg_map.get(key)))
    opening = cfg_map.get("onboarding_opening_text")
    check("opening text is a non-empty DRAFT placeholder",
          isinstance(opening, str) and opening.strip() != ""
          and opening.startswith("[DRAFT - BG-06 opening copy pending]"), repr(opening))
    types = sql_rows("select key, jsonb_typeof(value) as t from config where key in ("
                     + ",".join(f"'{k}'" for k in sorted(KEY_TYPES)) + ");")
    tmap = {r["key"]: r["t"] for r in types}
    check("every seed has the expected jsonb type", tmap == KEY_TYPES, repr(tmap))

    # ---------------------------------------------------------------- opening trigger + backfill
    print("\n== D. opening trigger and backfill ==")
    trigger_user = None
    backfill_user = None
    try:
        trigger_user = make_user(url, service, "fp09-step1-open")
        opened = opening_rows(url, service, trigger_user)
        check("a planted profile insert fires the trigger exactly once",
              len(opened) == 1, repr(opened))
        if opened:
            row = opened[0]
            check("opening row is assistant, tagged, stage intro, persona_key NULL",
                  row["role"] == "assistant"
                  and row["metadata"] == {"source": "onboarding_opening",
                                          "onboarding_stage": "intro"}
                  and row["persona_key"] is None,
                  repr(row))
            check("opening content equals the config text",
                  row["content"] == opening, repr(row["content"]))

        # Re-fire: deleting and re-inserting the profile must find the tagged row and skip.
        delete(url, service, f"/rest/v1/profiles?id=eq.{trigger_user}")
        insert(url, service, "profiles", [{"id": trigger_user, "onboarding_stage": "intro"}])
        opened2 = opening_rows(url, service, trigger_user)
        check("a re-fired profile insert adds no second opening row",
              len(opened2) == 1, repr(opened2))

        # Backfill: a non-complete profile with the row removed gets exactly one; a re-run
        # inserts none. This executes the same guard the migration's DO block uses.
        backfill_user = make_user(url, service, "fp09-step1-backfill")
        delete(url, service,
               f"/rest/v1/messages?user_id=eq.{backfill_user}"
               f"&metadata->>source=eq.onboarding_opening")
        backfill_sql = f"""
with inserted as (
  insert into public.messages (user_id, role, content, metadata, persona_key)
  select p.id, 'assistant', c.value #>> '{{}}',
         jsonb_build_object('source','onboarding_opening','onboarding_stage','intro'), null
    from public.profiles p
    cross join public.config c
   where c.key = 'onboarding_opening_text'
     and jsonb_typeof(c.value) = 'string'
     and p.onboarding_stage <> 'complete'
     and p.id = '{backfill_user}'
     and not exists (
       select 1 from public.messages m
        where m.user_id = p.id
          and m.metadata ->> 'source' = 'onboarding_opening'
     )
  returning 1
)
select count(*)::int as n from inserted;
"""
        first = sql_rows(backfill_sql)
        check("backfill plants exactly one row for a qualifying profile",
              bool(first) and first[0]["n"] == 1, repr(first))
        second = sql_rows(backfill_sql)
        check("a backfill re-run inserts none", bool(second) and second[0]["n"] == 0,
              repr(second))
        check("the qualifying profile now has exactly one opening row",
              len(opening_rows(url, service, backfill_user)) == 1)
        bad = sql_rows("select count(*)::int as n from ("
                       "select p.id from public.profiles p "
                       "where p.onboarding_stage <> 'complete' "
                       "and (select count(*) from public.messages m "
                       "where m.user_id = p.id "
                       "and m.metadata->>'source' = 'onboarding_opening') <> 1) x;")
        check("every non-complete profile has exactly one opening row",
              bool(bad) and bad[0]["n"] == 0, repr(bad))
    finally:
        if trigger_user:
            drop_user(url, service, trigger_user)
        if backfill_user:
            drop_user(url, service, backfill_user)

    # ---------------------------------------------------------------- tick
    print("\n== E. proactive_tick truth table ==")
    orig_cfg = {r["key"]: r["value"] for r in rows(
        url, service, "/rest/v1/config?select=key,value&key=in.("
        + ",".join(sorted(KEY_TYPES)) + ")")}
    user_a = None
    user_b = None
    try:
        patch(url, service, "/rest/v1/config?key=eq.proactive_enabled", {"value": True})
        patch(url, service, "/rest/v1/config?key=eq.proactive_windows",
              {"value": ["10:00", "19:30"]})
        patch(url, service, "/rest/v1/config?key=eq.proactive_min_silence_minutes",
              {"value": 120})
        patch(url, service, "/rest/v1/config?key=eq.proactive_gap_min_baseline_facts",
              {"value": 5})

        user_a = make_user(url, service, "fp09-step1-tick")
        set_all_gap_fields(url, service, user_a)
        clear_proactive_jobs(url, service, user_a)

        check("in-window 10:00 inserts one companionship job",
              tick(url, service, "2026-10-20T10:05:00+05:30") == 1)
        expect_job(url, service, "  payload is {user_id, slot:10:00, kind:companionship}",
                   user_a, "2026-10-20", 1, "10:00", "companionship")
        check("a second call in the same window inserts nothing",
              tick(url, service, "2026-10-20T10:05:00+05:30") == 0)
        expect_job(url, service, "  still exactly one 10:00 job", user_a, "2026-10-20", 1,
                   "10:00", "companionship")
        check("10:35 is outside the 10:00 window -> nothing",
              tick(url, service, "2026-10-20T10:35:00+05:30") == 0)
        check("in-window 19:30 inserts a second job the same local day",
              tick(url, service, "2026-10-20T19:35:00+05:30") == 1)
        expect_job(url, service, "  payload is slot:19:30", user_a, "2026-10-20", 1,
                   "19:30", "companionship")
        check("a second 19:30 call inserts nothing",
              tick(url, service, "2026-10-20T19:35:00+05:30") == 0)
        check("the next local day's 10:00 window inserts again",
              tick(url, service, "2026-10-21T10:05:00+05:30") == 1)
        expect_job(url, service, "  next-day job is slot:10:00", user_a, "2026-10-21", 1,
                   "10:00", "companionship")
        check("10:30 is the exclusive end of the 10:00 window -> nothing",
              tick(url, service, "2026-10-21T10:30:00+05:30") == 0)
        check("10:00 is the inclusive start of the window -> inserts",
              tick(url, service, "2026-10-29T10:00:00+05:30") == 1)

        # Overlapping windows are ambiguous -> exactly-one rule inserts nothing.
        clear_proactive_jobs(url, service, user_a)
        patch(url, service, "/rest/v1/config?key=eq.proactive_windows",
              {"value": ["10:00", "10:15"]})
        overlap_cfg = rows(url, service,
                          "/rest/v1/config?select=value&key=eq.proactive_windows")
        check("overlap config applied before the tick",
              bool(overlap_cfg) and overlap_cfg[0]["value"] == ["10:00", "10:15"],
              repr(overlap_cfg))
        check("overlapping windows insert nothing (exactly-one rule)",
              tick(url, service, "2026-10-22T10:20:00+05:30") == 0)
        patch(url, service, "/rest/v1/config?key=eq.proactive_windows",
              {"value": ["10:00", "19:30"]})

        # Silence boundary: exactly 120 minutes is not older -> no job; 121 minutes -> job.
        clear_proactive_jobs(url, service, user_a)
        msg_id = add_user_message(url, service, user_a,
                                  "2026-10-28T08:05:00+05:30", "silence boundary")
        check("exactly 120 minutes of silence still blocks the tick",
              tick(url, service, "2026-10-28T10:05:00+05:30") == 0)
        update_message_created_at(url, service, msg_id, "2026-10-28T08:04:59+05:30")
        check("121 minutes of silence passes the gate",
              tick(url, service, "2026-10-28T10:05:00+05:30") == 1)

        # Onboarding gate.
        clear_proactive_jobs(url, service, user_a)
        set_profile(url, service, user_a, {"onboarding_stage": "intro"})
        check("a non-complete user is gated out", tick(url, service,
                                                       "2026-10-24T10:05:00+05:30") == 0)
        set_profile(url, service, user_a, {"onboarding_stage": "complete"})

        # Kill switch.
        clear_proactive_jobs(url, service, user_a)
        patch(url, service, "/rest/v1/config?key=eq.proactive_enabled", {"value": False})
        check("proactive_enabled=false stops the tick",
              tick(url, service, "2026-10-24T19:35:00+05:30") == 0)
        patch(url, service, "/rest/v1/config?key=eq.proactive_enabled", {"value": True})

        # Malformed config fail-closed table.
        clear_proactive_jobs(url, service, user_a)
        patch(url, service, "/rest/v1/config?key=eq.proactive_windows", {"value": "10:00"})
        check("non-array proactive_windows fails closed",
              tick(url, service, "2026-10-25T10:05:00+05:30") == 0)
        patch(url, service, "/rest/v1/config?key=eq.proactive_windows",
              {"value": ["10:00", "19:30"]})
        patch(url, service, "/rest/v1/config?key=eq.proactive_min_silence_minutes",
              {"value": "120"})
        check("non-number proactive_min_silence_minutes fails closed",
              tick(url, service, "2026-10-25T10:05:00+05:30") == 0)
        patch(url, service, "/rest/v1/config?key=eq.proactive_min_silence_minutes",
              {"value": 120})
        patch(url, service, "/rest/v1/config?key=eq.proactive_gap_min_baseline_facts",
              {"value": "5"})
        check("non-number proactive_gap_min_baseline_facts fails closed",
              tick(url, service, "2026-10-25T10:05:00+05:30") == 0)
        patch(url, service, "/rest/v1/config?key=eq.proactive_gap_min_baseline_facts",
              {"value": 5})
        patch(url, service, "/rest/v1/config?key=eq.proactive_enabled", {"value": "true"})
        check("non-boolean proactive_enabled fails closed",
              tick(url, service, "2026-10-25T10:05:00+05:30") == 0)
        patch(url, service, "/rest/v1/config?key=eq.proactive_enabled", {"value": True})

        # Any-status dedup: a done row and a dead row both suppress the tick.
        clear_proactive_jobs(url, service, user_a)
        insert(url, service, "jobs", [{
            "type": "proactive",
            "payload": {"user_id": user_a, "slot": "10:00", "kind": "companionship"},
            "status": "done",
            "created_at": "2026-10-26T10:05:00+05:30",
        }])
        check("a done proactive job suppresses the tick",
              tick(url, service, "2026-10-26T10:05:00+05:30") == 0)
        insert(url, service, "jobs", [{
            "type": "proactive",
            "payload": {"user_id": user_a, "slot": "10:00", "kind": "companionship"},
            "status": "dead",
            "created_at": "2026-10-27T10:05:00+05:30",
        }])
        check("a dead proactive job suppresses the tick",
              tick(url, service, "2026-10-27T10:05:00+05:30") == 0)
        clear_proactive_jobs(url, service, user_a)
        # Park user_a outside the tick so the gap cases count only user_b's insert.
        set_profile(url, service, user_a, {"onboarding_stage": "intro"})

        # Gap vector -> kind/gap_key table. Each case uses its own local day.
        user_b = make_user(url, service, "fp09-step1-gaps")
        set_all_gap_fields(url, service, user_b)
        cases = [
            ("all fields present -> companionship", "2026-11-01",
             {}, 5, "companionship", None),
            ("null wake_time -> gap/wake_time", "2026-11-02",
             {"wake_time": None}, 5, "gap", "wake_time"),
            ("null sleep_time -> gap/sleep_time", "2026-11-03",
             {"sleep_time": None}, 5, "gap", "sleep_time"),
            ("empty routine -> gap/routine", "2026-11-04",
             {"routine": {}}, 5, "gap", "routine"),
            ("empty high_dopamine_activities -> gap/high_dopamine_activities", "2026-11-05",
             {"high_dopamine_activities": []}, 5, "gap", "high_dopamine_activities"),
            ("4 baseline facts -> gap/baseline_facts", "2026-11-06",
             {}, 4, "gap", "baseline_facts"),
        ]
        for label, day, fields, facts, kind, gap_key in cases:
            set_all_gap_fields(url, service, user_b)
            if fields:
                set_profile(url, service, user_b, fields)
            set_baseline_facts(url, service, user_b, facts)
            clear_proactive_jobs(url, service, user_b)
            check(label, tick(url, service, f"{day}T10:05:00+05:30") == 1)
            expect_job(url, service, f"  {kind}/{gap_key or 'none'}", user_b, day, 1,
                       "10:00", kind, gap_key)
    finally:
        for key, value in orig_cfg.items():
            try:
                patch(url, service, f"/rest/v1/config?key=eq.{key}", {"value": value})
            except Exception as exc:  # noqa: BLE001
                print(f"  (config restore warning for {key}: {exc})")
        if user_a:
            drop_user(url, service, user_a)
        if user_b:
            drop_user(url, service, user_b)

    print("\n== F. result ==")
    if FAILS:
        print(f"FAILED ({len(FAILS)}): " + "; ".join(FAILS))
        sys.exit(1)
    print("PASS: all FP-09 Step 1 checks green")


if __name__ == "__main__":
    main()
