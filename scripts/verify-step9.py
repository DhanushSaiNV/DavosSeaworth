#!/usr/bin/env python3
"""Automate FP-02 Step 9 verification (offline queue + delivery dedupe).

Covers PLAN Step 9 Verify:
  airplane mode -> send 2 -> queued locally in order -> reconnect ->
  both delivered exactly once, pipeline ran per message, order preserved;
  curl-replay an already-delivered uuid -> no duplicates.

Split by necessity:
  AUTOMATED here --
    (a) static client checks: lib/sendQueue.ts owns storage/ordering/dedupe
        with no network I/O, per-user key, tap-order replay (TECH-SPECS §7.10);
        chat.tsx replays sequentially reusing client uuid + client_sent_at.
    (b) live server dedupe: ordered send of 2 turns, row-count + order checks,
        curl-replay of both uuids, simultaneous double-send race.
  MANUAL (printed at end) --
    the airplane-mode toggle itself: only a device can prove the NetInfo
    offline path enqueues and the reconnect walk replays. Passes AC-8.

Server paths exercised:
  send-message upsert dedupe: supabase/functions/send-message/index.ts:272
  primary-reply guard:        supabase/functions/send-message/index.ts:92

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DAVOS_USER_JWT="<optional; a fresh one is minted if unset>"
  python scripts/verify-step9.py [--run-jest]

Env: same three as scripts/verify-step8.py, plus the optional user JWT (minted if unset).
Stub mode is forced ON during the
live section (zero quota, fast, deterministic) and restored afterwards.
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

FAILURES = []


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


def send(content, cid, sent_at):
    st, body = req(
        "POST",
        "/functions/v1/send-message",
        {"content": content, "client_message_id": cid, "client_sent_at": sent_at},
        key=ANON,
        headers={"Authorization": f"Bearer {JWT}"},
    )
    return st, body or {}


def user_row_by_cid(cid):
    rows = rest_get(
        "/rest/v1/messages?select=id,user_id,content,client_message_id,client_sent_at,created_at"
        f"&client_message_id=eq.{cid}&limit=5"
    )
    return rows


def assistant_rows(user_msg_id):
    if not user_msg_id:
        return []
    path = (
        "/rest/v1/messages?select=id,content,reply_to_message_id,"
        "secondary_reply_to_message_id,metadata,created_at"
        f"&metadata-%3E%3Euser_message_id=eq.{urllib.parse.quote(user_msg_id)}"
        "&order=created_at"
    )
    return req("GET", path, key=SERVICE, headers={"Accept": "application/json"})[1] or []


def static_checks(run_jest):
    print("== A. static client checks (queue module + wiring) ==")
    sq = os.path.join(ROOT, "lib", "sendQueue.ts")
    chat = os.path.join(ROOT, "app", "(app)", "chat.tsx")
    try:
        src = open(sq, encoding="utf-8").read()
    except OSError:
        check("lib/sendQueue.ts exists", False)
        return
    check("lib/sendQueue.ts exists", True)
    for sym in ("loadSendQueue", "enqueueSend", "removeSend", "dueItems",
                "sortQueueAsc", "storageKeyFor", "markQueueAttempt"):
        check(f"sendQueue exports {sym}", sym in src)
    check("queue key per-user (no shared key)", "STORAGE_KEY_PREFIX" in src and "userId" in src)
    check("queue performs no network I/O", "fetch(" not in src and "supabase" not in src.lower())
    check("replay keyed by clientMessageId", "clientMessageId" in src)
    try:
        cs = open(chat, encoding="utf-8").read()
    except OSError:
        check("app/(app)/chat.tsx exists", False)
        return
    for sym in ("NetInfo", "flushQueue", "dueItems", "enqueueSend", "removeSend", "clientSentAt"):
        check(f"chat.tsx wires {sym}", sym in cs)
    check("replay reuses tap client_sent_at verbatim", "clientSentAt: next.clientSentAt" in cs)
    check("sequential replay walk", "for (;;)" in cs and "dueItems(getSendQueue()" in cs)
    for t in (os.path.join(ROOT, "lib", "sendQueue.test.ts"),
              os.path.join(ROOT, "lib", "chat.test.ts")):
        check(f"{os.path.relpath(t, ROOT)} exists", os.path.exists(t))
    if run_jest:
        print("-- running jest (sendQueue + chat) --")
        try:
            import shutil
            use_shell = os.name == "nt"
            if not use_shell and shutil.which("npx") is None:
                check("jest sendQueue+chat green", False, "SKIP: npx not on PATH")
            else:
                p = subprocess.run(
                    "npx jest lib/sendQueue.test.ts lib/chat.test.ts" if use_shell
                    else ["npx", "jest", "lib/sendQueue.test.ts", "lib/chat.test.ts"],
                    cwd=ROOT, capture_output=True, text=True, timeout=300,
                    shell=use_shell, encoding="utf-8", errors="replace",
                )
                out = (p.stdout or "") + (p.stderr or "")
                check("jest sendQueue+chat green", p.returncode == 0, out[-2000:])
        except Exception as e:
            check("jest sendQueue+chat green", False, str(e))


try:
    # Sibling helper (scripts/ is sys.path[0]): the one place this gate picks the user JWT it
    # sends. It prints the token (source, sub, exp, verdict) and never returns one already
    # decoded as expired -- it mints a fresh one instead (owner request, 2026-10-17). When it
    # cannot produce a usable token the gate skips its authenticated legs rather than sending a
    # dead one, which is what used to surface as a wall of unexplained 401s.
    from _mint_dev_jwt import resolve_gate_token
except Exception:  # noqa: BLE001
    resolve_gate_token = None


def live_checks():
    print("== B. live server dedupe (ordered replay simulation) ==")
    global JWT
    if resolve_gate_token is not None:
        JWT, jwt_usable, _note = resolve_gate_token(JWT, URL, SERVICE, os.environ.get("DAVOS_USER_EMAIL"))
    else:
        print("  JWT   note   : _mint_dev_jwt.py unavailable -- using $DAVOS_USER_JWT as supplied")
        jwt_usable = bool(JWT)
    if not jwt_usable:
        print("  FAIL no usable DAVOS_USER_JWT -- refresh it or run `python scripts/_mint_dev_jwt.py`")
        FAILURES.append("no usable user JWT")
        print("  SKIP remaining live checks")
        return
    cfg = {r["key"]: r["value"] for r in rest_get("/rest/v1/config?select=key,value")}
    check("config chat_queue_max_items present", "chat_queue_max_items" in cfg)
    snapshot = {k: cfg.get(k) for k in ("llm_stub_mode", "llm_stub_malformed", "llm_force_fail")}
    try:
        set_config("llm_stub_mode", True)
        set_config("llm_stub_malformed", False)
        set_config("llm_force_fail", "none")

        t0 = datetime.now(timezone.utc).isoformat()
        t1 = datetime.now(timezone.utc).isoformat()  # t1 >= t0; tie broken by send order
        cid_a, cid_b = str(uuid.uuid4()), str(uuid.uuid4())
        msg_a = "STEP9-A offline-simulated first " + cid_a[:8]
        msg_b = "STEP9-B offline-simulated second " + cid_b[:8]

        # Ordered replay: oldest tap first, one at a time (what flushQueue does).
        st_a, body_a = send(msg_a, cid_a, t0)
        st_b, body_b = send(msg_b, cid_b, t1)
        check("send A ok", st_a == 200 and body_a.get("status") in ("ok", "duplicate"),
              f"{st_a} {body_a}")
        check("send B ok", st_b == 200 and body_b.get("status") in ("ok", "duplicate"),
              f"{st_b} {body_b}")
        uid_a = body_a.get("user_message_id")
        uid_b = body_b.get("user_message_id")
        check("distinct turns", bool(uid_a and uid_b and uid_a != uid_b))
        if not uid_a or not uid_b:
            # Sends never authenticated (401) — dependent row checks cannot run.
            # Restore happens in finally; abort the live section without traceback.
            check("live section aborted (send auth failed)", False,
                  "see send A/B failures above")
            return

        ua, ub = user_row_by_cid(cid_a), user_row_by_cid(cid_b)
        check("A stored exactly once", len(ua) == 1, f"got {len(ua)}")
        check("B stored exactly once", len(ub) == 1, f"got {len(ub)}")
        if ua:
            check("A client_sent_at verbatim", ua[0].get("client_sent_at") == t0)
        if ub:
            check("B client_sent_at verbatim", ub[0].get("client_sent_at") == t1)
        if ua and ub:
            check("user-row order preserved", ua[0]["created_at"] <= ub[0]["created_at"])

        ra, rb = assistant_rows(uid_a), assistant_rows(uid_b)
        check("pipeline ran for A (1 primary reply)", len(ra) == 1, f"got {len(ra)}")
        check("pipeline ran for B (1 primary reply)", len(rb) == 1, f"got {len(rb)}")
        if ra and rb:
            check("reply order preserved", ra[0]["created_at"] <= rb[0]["created_at"])
            check("replies anchored as primaries",
                  ra[0]["reply_to_message_id"] == uid_a and rb[0]["reply_to_message_id"] == uid_b)

        # Curl-replay of already-delivered uuids: no new rows, no second pipeline run.
        st, body = send(msg_a, cid_a, t0)
        check("replay A duplicate", st == 200 and body.get("status") == "duplicate"
              and body.get("user_message_id") == uid_a, f"{st} {body}")
        st, body = send("DIFFERENT text, same uuid", cid_a, t0)
        check("replay A with different text still duplicate (stored text wins)",
              st == 200 and body.get("status") == "duplicate"
              and body.get("assistant_message_id") == (ra[0]["id"] if ra else None),
              f"{st} {body}")
        st, body = send(msg_b, cid_b, t1)
        check("replay B duplicate", st == 200 and body.get("status") == "duplicate"
              and body.get("user_message_id") == uid_b, f"{st} {body}")
        check("A still exactly once after replays", len(user_row_by_cid(cid_a)) == 1)
        check("B still exactly once after replays", len(user_row_by_cid(cid_b)) == 1)
        check("A still 1 reply after replays", len(assistant_rows(uid_a)) == 1)
        check("B still 1 reply after replays", len(assistant_rows(uid_b)) == 1)

        # Simultaneous double-send at a fresh uuid: exactly one row + one reply.
        cid_c = str(uuid.uuid4())
        tc = datetime.now(timezone.utc).isoformat()
        out = {}
        def one(slot):
            s, b = send("STEP9-C race " + cid_c[:8], cid_c, tc)
            out[slot] = (s, b)
        th = [threading.Thread(target=one, args=(i,)) for i in (0, 1)]
        [t.start() for t in th]
        [t.join() for t in th]
        statuses = sorted(o[0] for o in out.values())
        check("race: both HTTP 200", statuses == [200, 200], f"{out}")
        uids = {o[1].get("user_message_id") for o in out.values()}
        aids = {o[1].get("assistant_message_id") for o in out.values()}
        check("race: one user row, one reply", len(uids) == 1 and len(aids) == 1, f"{out}")
        rc = user_row_by_cid(cid_c)
        check("race: stored exactly once", len(rc) == 1, f"got {len(rc)}")
        if rc:
            check("race: single primary reply",
                  len(assistant_rows(rc[0]["id"])) == 1)
    finally:
        print("== restore ==")
        for k in ("llm_stub_mode", "llm_stub_malformed", "llm_force_fail"):
            target = snapshot.get(k)
            if target is None:
                target = {"llm_stub_mode": False, "llm_stub_malformed": False,
                          "llm_force_fail": "none"}[k]
            print(f"  restore {k}={target!r}: {'ok' if set_config(k, target) else 'FAILED'}")


def manual_note():
    print("""
== C. MANUAL (owner, one device) — the only part this script cannot do ==
1. Enable llm_stub_mode=true (zero quota) OR keep providers live; note which.
2. Airplane mode ON -> send 2 messages -> both show queued bubbles in tap order.
3. Airplane mode OFF -> both deliver, exactly one reply each, order preserved.
4. Reload the thread: one user row + one reply per turn (row-count check in SQL).
5. `npx tsc --noEmit` + `npx jest lib/sendQueue.test.ts lib/chat.test.ts` if not run here.
Record stub-vs-live + device in the commit message. Passes AC-8 (FP-02 FR-16).
""")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-jest", action="store_true")
    args = ap.parse_args()
    for v in (URL, ANON, SERVICE):
        if not v:
            print("Missing env: need SUPABASE_URL, SUPABASE_ANON_KEY, "
                  "SUPABASE_SERVICE_ROLE_KEY (the user JWT is minted automatically)")
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
    print("All automated Step 9 checks passed (manual device section still required).")


if __name__ == "__main__":
    main()
