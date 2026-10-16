#!/usr/bin/env python3
"""Automate FP-02 Step 10 verification (D8 `auto_adopt_successes` write path).

Covers PLAN Step 10 Verify (AC-9):
  a user message inside the window of a High-tier auto reply -> +1;
  outside/disabled window -> unchanged; medium/low/fallback -> no increment;
  the Step 8 `llm_retry` secondary row never counts; one arrival scores once.

Split by necessity:
  AUTOMATED here --
    (a) static checks: the migration (key + atomic RPC + service-role-only grant)
        and the detector's shape in `send-message` (fresh-insert branch only,
        primary-only, server clock, [SPEC] window read at runtime).
    (b) live checks: every clause, asserted as a delta on `persona_stats`, with
        the item-16 scenario (a `llm_retry`-shaped secondary row) simulated by a
        direct insert so it needs no provider outage.
  MANUAL (printed at end) --
    the optional end-to-end confirmation that the real retry row behaves the
    same way (llm_force_fail='both' -> holding reply + job -> restore -> reply).

Server paths exercised:
  detector:  supabase/functions/send-message/index.ts  (recordAutoAdoptSuccess)
  increment: public.increment_auto_adopt_successes     (migration 0023)
  config:    auto_adopt_window_minutes                 (migration 0023)

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DAVOS_USER_JWT="<signed-in-user-jwt>"
  python scripts/verify-step10.py [--run-jest]

PREREQUISITES: migrations 0022 + 0023 applied and `send-message` redeployed (the
counter needs the RPC, which only exists after 0023). Stub mode is forced ON
during the live section (zero quota, deterministic routes) and restored after.
The harness deletes the message rows it creates; `persona_stats` rows are left in
place, because they are the evidence under test.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

FAILURES = []
CREATED_IDS = []


def check(name, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + name + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def env(name, *alts):
    for k in (name,) + alts:
        if os.environ.get(k):
            return os.environ[k]
    return None


URL = (env("SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
ANON = env("SUPABASE_ANON_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY")
SERVICE = env("SUPABASE_SERVICE_ROLE_KEY")
JWT = env("DAVOS_USER_JWT")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def req(method, path, body=None, key=None, headers=None):
    url = URL + path
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if key:
        h["apikey"] = key
        h["Authorization"] = f"Bearer {key}"
    if headers:
        h.update(headers)
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=140) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else None
        except Exception:
            return e.code, {"raw": raw}


def rest_get(path):
    return req("GET", path, key=SERVICE, headers={"Accept": "application/json"})[1] or []


def set_config(key_name, value):
    st, _ = req("PATCH", f"/rest/v1/config?key=eq.{key_name}", {"value": value}, key=SERVICE)
    return st in (200, 204)


def send(content, cid, sent_at, dev=None):
    body = {"content": content, "client_message_id": cid, "client_sent_at": sent_at}
    if dev:
        body["dev_force"] = dev
    st, b = req(
        "POST",
        "/functions/v1/send-message",
        body,
        key=ANON,
        headers={"Authorization": f"Bearer {JWT}"},
    )
    return st, b or {}


def user_row_by_cid(cid):
    return rest_get(
        "/rest/v1/messages?select=id,user_id,content,client_message_id,client_sent_at,created_at"
        f"&client_message_id=eq.{cid}&limit=5"
    )


def assistant_rows(user_msg_id):
    if not user_msg_id:
        return []
    path = (
        "/rest/v1/messages?select=id,content,reply_to_message_id,"
        "secondary_reply_to_message_id,metadata,created_at"
        f"&metadata-%3E%3Euser_message_id=eq.{urllib.parse.quote(user_msg_id)}"
        "&order=created_at"
    )
    return rest_get(path)


def insert_message(row):
    return req(
        "POST",
        "/rest/v1/messages",
        row,
        key=SERVICE,
        headers={"Accept": "application/json", "Prefer": "return=representation"},
    )


def persona_stats(user_id):
    rows = rest_get(
        f"/rest/v1/persona_stats?select=domain,auto_adopt_successes&user_id=eq.{user_id}"
    )
    return {r["domain"]: (r["auto_adopt_successes"] or 0) for r in rows}


def stat_total(stats):
    return sum(stats.values())


def expect_delta(name, before, after, delta):
    got = stat_total(after) - stat_total(before)
    check(name, got == delta, f"expected {delta:+d}, got {got:+d}")


def expect_domain_delta(name, before, after, domain, delta):
    got = after.get(domain, 0) - before.get(domain, 0)
    check(name, got == delta, f"expected {delta:+d} for {domain}, got {got:+d}")


def do_turn(label, dev):
    """Send one message; return its ids/route/domain, or None when it never stored."""
    cid = str(uuid.uuid4())
    content = f"STEP10-{label} {cid[:8]}"
    sent_at = datetime.now(timezone.utc).isoformat()
    st, body = send(content, cid, sent_at, dev)
    check(f"{label}: send ok", st == 200 and body.get("status") in ("ok", "duplicate"),
          f"{st} {body}")
    rows = user_row_by_cid(cid)
    check(f"{label}: stored exactly once", len(rows) == 1, f"got {len(rows)}")
    if not rows:
        return None
    u = rows[0]
    CREATED_IDS.append(u["id"])
    replies = assistant_rows(u["id"])
    for r in replies:
        CREATED_IDS.append(r["id"])
    check(f"{label}: one primary reply", len(replies) == 1, f"got {len(replies)}")
    md = (replies[0]["metadata"] if replies else {}) or {}
    return {
        "cid": cid,
        "content": content,
        "sent_at": sent_at,
        "user_id": u["user_id"],
        "user_msg_id": u["id"],
        "route": md.get("route"),
        "domain": md.get("domain"),
    }


def sim_user_turn(user_id, content):
    """Insert a simulated user turn (no pipeline run) for a controlled reply to anchor on.

    Lets a clause be tested with an exactly-shaped reply row — a `llm_retry` secondary row,
    or a primary row with no domain — without staging a provider outage.
    """
    st, rows = insert_message({
        "user_id": user_id, "role": "user", "content": content,
        "client_message_id": str(uuid.uuid4()),
        "client_sent_at": datetime.now(timezone.utc).isoformat(),
    })
    if st not in (200, 201) or not rows:
        check(f"simulated user row inserted ({content})", False, f"{st} {rows}")
        return None
    CREATED_IDS.append(rows[0]["id"])
    return rows[0]["id"]


def static_checks(run_jest):
    print("== A. static checks (migration + detector shape) ==")
    mig = os.path.join(ROOT, "supabase", "migrations", "0023_auto_adopt_config.sql")
    check("migration 0023 exists", os.path.exists(mig))
    src = open(mig, encoding="utf-8").read() if os.path.exists(mig) else ""
    check("0023 seeds auto_adopt_window_minutes", "'auto_adopt_window_minutes'" in src)
    check("0023 window default is 10 [SPEC]",
          re.search(r"'auto_adopt_window_minutes',\s*'10'", src) is not None)
    check("0023 defines increment_auto_adopt_successes", "increment_auto_adopt_successes" in src)
    check("0023 RPC is insert-on-conflict (+1)",
          "on conflict" in src.lower() and "auto_adopt_successes + 1" in src)
    check("0023 RPC is SECURITY DEFINER with pinned search_path",
          "security definer" in src.lower() and "set search_path" in src)
    check("0023 revokes execute from public/anon/authenticated",
          "revoke execute" in src and "from public, anon, authenticated" in src)
    check("0023 grants execute to service_role", "to service_role" in src)

    fn = os.path.join(ROOT, "supabase", "functions", "send-message", "index.ts")
    check("send-message/index.ts exists", os.path.exists(fn))
    fs = open(fn, encoding="utf-8").read() if os.path.exists(fn) else ""
    check("detector reads the window from config, never hardcodes it",
          'getConfigNumber("auto_adopt_window_minutes")' in fs
          and "600_000" not in fs and "10 * 60" not in fs)
    check("detector reads the immediately-preceding row (created_at desc, limit 1)",
          '.lt("created_at"' in fs and "ascending: false" in fs and ".limit(1)" in fs)
    check("narrow rule: a primary reply only",
          "if (!prev.reply_to_message_id) return;" in fs)
    check("narrow rule: route gate is 'auto'", 'metadata.route !== "auto"' in fs)
    check("domain guard (skip, never invent a domain)", "typeof domain" in fs)
    check("window measured on the server clock", "Date.now() - replyAt" in fs)
    check("atomic increment through the RPC",
          'rpc("increment_auto_adopt_successes"' in fs)
    check("counter failure is non-fatal", "auto-adopt counter failed" in fs)
    i_branch = fs.find("if (inserted && inserted.length > 0) {")
    i_call = fs.find("await recordAutoAdoptSuccess(")
    i_repeat = fs.find("// Repeat send. Locate the existing user row.")
    check("call sits in the fresh-insert branch only",
          -1 < i_branch < i_call < i_repeat, f"{i_branch} {i_call} {i_repeat}")

    if run_jest:
        print("-- running jest (full suite) --")
        try:
            import shutil
            use_shell = os.name == "nt"
            if not use_shell and shutil.which("npx") is None:
                check("jest green", False, "SKIP: npx not on PATH")
            else:
                p = subprocess.run(
                    "npx jest --ci" if use_shell else ["npx", "jest", "--ci"],
                    cwd=ROOT, capture_output=True, text=True, timeout=600,
                    shell=use_shell, encoding="utf-8", errors="replace",
                )
                out = (p.stdout or "") + (p.stderr or "")
                check("jest green", p.returncode == 0, out[-2000:])
        except Exception as e:
            check("jest green", False, str(e))


def live_checks():
    print("== B. live checks (counter write path) ==")
    cfg = {r["key"]: r["value"] for r in rest_get("/rest/v1/config?select=key,value")}
    check("config auto_adopt_window_minutes present (0023 applied)",
          "auto_adopt_window_minutes" in cfg)
    if "auto_adopt_window_minutes" not in cfg:
        check("live section aborted — apply migration 0023 first", False)
        return

    keys = ("llm_stub_mode", "llm_stub_malformed", "llm_force_fail",
            "auto_adopt_window_minutes", "dev_overrides_enabled")
    snapshot = {k: cfg.get(k) for k in keys}
    defaults = {"llm_stub_mode": False, "llm_stub_malformed": False,
                "llm_force_fail": "none", "auto_adopt_window_minutes": 10,
                "dev_overrides_enabled": True}
    user_id = None
    try:
        set_config("llm_stub_mode", True)
        set_config("llm_stub_malformed", False)
        set_config("llm_force_fail", "none")
        set_config("dev_overrides_enabled", True)
        set_config("auto_adopt_window_minutes", 10)

        # --- Clause 1+3: a reply inside the window to an auto primary reply counts once ---
        t1 = do_turn("S1-high", {"tier": "high", "domain": "Career"})
        if not t1:
            check("live section aborted (send/auth failed)", False, "see S1 failures above")
            return
        user_id = t1["user_id"]
        check("S1: high tier produced route=auto", t1["route"] == "auto", f"{t1['route']}")
        check("S1: forced domain carried into metadata", t1["domain"] == "Career", f"{t1['domain']}")
        s0 = persona_stats(user_id)

        t2 = do_turn("S2-high", {"tier": "high", "domain": "Career"})
        s1 = persona_stats(user_id)
        expect_domain_delta("S2 (+1): reply to S1's auto reply counts for its domain",
                            s0, s1, "Career", 1)
        check("S2: exactly one success total", stat_total(s1) - stat_total(s0) == 1,
              f"{stat_total(s0)} -> {stat_total(s1)}")

        # --- Clause 4: the window comes from config and is read at runtime ---
        check("window set to 0", set_config("auto_adopt_window_minutes", 0))
        t3 = do_turn("S3-high", {"tier": "high", "domain": "Career"})
        s2 = persona_stats(user_id)
        expect_delta("S3 (0): disabled window counts nothing", s1, s2, 0)
        check("window restored to 10", set_config("auto_adopt_window_minutes", 10))

        # --- Clause 2: a non-auto preceding reply never counts ---
        t4 = do_turn("S4-medium", {"tier": "medium", "domain": "Career"})
        check("S4: medium produced route=options", t4["route"] == "options", f"{t4['route']}")
        s3 = persona_stats(user_id)
        expect_delta("S4 (+1): S3's auto reply still counts (control)", s2, s3, 1)

        t5 = do_turn("S5-medium", {"tier": "medium", "domain": "Career"})
        s4 = persona_stats(user_id)
        expect_delta("S5 (0): preceding reply route=options counts nothing", s3, s4, 0)

        t6 = do_turn("S6-low", {"tier": "low", "domain": "Career"})
        check("S6: low produced route=low_question", t6["route"] == "low_question",
              f"{t6['route']}")
        s5 = persona_stats(user_id)
        expect_delta("S6 (0): preceding reply route=options counts nothing", s4, s5, 0)

        t7 = do_turn("S7-low", {"tier": "low", "domain": "Career"})
        s6 = persona_stats(user_id)
        expect_delta("S7 (0): preceding reply route=low_question counts nothing", s5, s6, 0)

        t8 = do_turn("S8-fallback", {"tier": "fallback"})
        check("S8: fallback produced route=fallback", t8["route"] == "fallback",
              f"{t8['route']}")
        s7 = persona_stats(user_id)
        expect_delta("S8 (0): preceding reply route=low_question counts nothing", s6, s7, 0)

        t9 = do_turn("S9-fallback", {"tier": "fallback"})
        s8 = persona_stats(user_id)
        expect_delta("S9 (0): preceding reply route=fallback counts nothing", s7, s8, 0)

        # --- Clause 1 (the item-16 scenario): an llm_retry secondary row never counts ---
        st, rows = insert_message({
            "user_id": user_id, "role": "assistant",
            "content": "STEP10 simulated llm_retry answer",
            "reply_to_message_id": None,
            "secondary_reply_to_message_id": t9["user_msg_id"],
            "persona_key": "mentor_tough",
            "metadata": {"route": "auto", "domain": "Career", "source": "llm_retry",
                         "user_message_id": t9["user_msg_id"]},
        })
        check("simulated llm_retry secondary row inserted", st in (200, 201), f"{st} {rows}")
        if rows:
            CREATED_IDS.append(rows[0]["id"])
        t10 = do_turn("S10-high", {"tier": "high", "domain": "Career"})
        s9 = persona_stats(user_id)
        expect_delta("S10 (0): llm_retry secondary row with route=auto never counts",
                     s8, s9, 0)

        # --- Positive control: a primary route=auto row DOES count, for its own domain ---
        sim_user = sim_user_turn(user_id, "STEP10 sim primary anchor")
        if sim_user:
            st, rows = insert_message({
                "user_id": user_id, "role": "assistant",
                "content": "STEP10 simulated primary auto reply",
                "reply_to_message_id": sim_user,
                "metadata": {"route": "auto", "domain": "Fitness", "source": "pipeline",
                             "user_message_id": sim_user},
            })
            check("simulated primary auto row inserted", st in (200, 201), f"{st} {rows}")
            if rows:
                CREATED_IDS.append(rows[0]["id"])
        t11 = do_turn("S11-high", {"tier": "high", "domain": "Career"})
        s10 = persona_stats(user_id)
        expect_domain_delta(
            "S11 (+1): a PRIMARY route=auto row counts for its own domain (Fitness)",
            s9, s10, "Fitness", 1)

        # --- Domain safety: route=auto with no domain counts nothing, and never errors ---
        sim_user2 = sim_user_turn(user_id, "STEP10 sim no-domain anchor")
        if sim_user2:
            st, rows = insert_message({
                "user_id": user_id, "role": "assistant",
                "content": "STEP10 simulated auto reply with no domain",
                "reply_to_message_id": sim_user2,
                "metadata": {"route": "auto"},
            })
            check("simulated no-domain auto row inserted", st in (200, 201), f"{st} {rows}")
            if rows:
                CREATED_IDS.append(rows[0]["id"])
        t12 = do_turn("S12-high", {"tier": "high", "domain": "Career"})
        s11 = persona_stats(user_id)
        expect_delta("S12 (0): route=auto with no domain counts nothing (HTTP 200)", s10, s11, 0)

        # --- Exactly-once: the same arrival cannot be scored twice ---
        st, body = send(t2["content"], t2["cid"], t2["sent_at"])
        check("replay of an answered turn returns duplicate",
              st == 200 and body.get("status") == "duplicate", f"{st} {body}")
        s12 = persona_stats(user_id)
        expect_delta("replay scores nothing (one success per arrival)", s11, s12, 0)

        # --- Security: the RPC is service-role only ---
        st, body = req("POST", "/rest/v1/rpc/increment_auto_adopt_successes",
                       {"p_user_id": user_id, "p_domain": "Career"}, key=ANON)
        check("anon key cannot execute the increment RPC", st != 200, f"{st} {body}")

        print("  final persona_stats for the test user: "
              + json.dumps(persona_stats(user_id), sort_keys=True))
    finally:
        print("== restore ==")
        for k in keys:
            target = snapshot.get(k)
            if target is None:
                target = defaults[k]
            print(f"  restore {k}={target!r}: {'ok' if set_config(k, target) else 'FAILED'}")
        if CREATED_IDS:
            st, _ = req("DELETE", f"/rest/v1/messages?id=in.({','.join(CREATED_IDS)})", key=SERVICE)
            print(f"  cleanup: deleted {len(CREATED_IDS)} test message rows ({st})")
            print("  note: persona_stats rows are intentionally left in place (the evidence).")


def manual_note():
    print("""
== C. MANUAL (owner, optional) — confirm the real retry row, not just the simulation ==
The item-16 exclusion is asserted above with a simulated `llm_retry`-shaped row. To see the
real rows take the same path:
1. llm_force_fail='"both"' + a forced high tier -> send -> holding reply (metadata.route
   ='degrade') + exactly one `llm_retry` job.
2. llm_force_fail='"none"' -> next dispatcher tick (<= 2 min) -> the real answer lands as a
   SECONDARY row whose metadata.route is the original turn's ('auto').
3. Reply to that retry row within the window -> `auto_adopt_successes` unchanged (narrow rule).
4. Restore llm_force_fail='"none"'. Record stub-vs-live + device in the commit message.
Passes AC-9 (FP-02 FR-14).
""")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-jest", action="store_true")
    args = ap.parse_args()
    for v in (URL, ANON, SERVICE, JWT):
        if not v:
            print("Missing env: need SUPABASE_URL, SUPABASE_ANON_KEY, "
                  "SUPABASE_SERVICE_ROLE_KEY, DAVOS_USER_JWT")
            sys.exit(2)
    static_checks(args.run_jest)
    live_checks()
    manual_note()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 10 checks passed (manual end-to-end section optional).")


if __name__ == "__main__":
    main()
