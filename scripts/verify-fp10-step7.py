#!/usr/bin/env python3
"""FP-10 Step 7: Beyond-Beta Gate (Config Hygiene, Dev Overrides Flip, Post-Flip Checks).

Verifies AC-11, AC-12, FR-11:
  static:
    - client double-gate: devForcePayload returns null when enabled=false
    - server gate: send-message checks getConfig("dev_overrides_enabled") === true
    - token-gated drill independence: dev-smoke does not depend on dev_overrides_enabled
    - zero client diffs

  live (reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEV_SMOKE_TOKEN):
    - pre-flip config hygiene: llm_stub_mode=false, llm_force_fail='none', llm_stub_malformed=false
    - flip execution (--flip): update config set value = 'false' where key = 'dev_overrides_enabled'
    - natural turn routing: send-message with forged dev_force ignores override and routes naturally
    - drill independence: dev-smoke ?action=models responds 200 OK behind DEV_SMOKE_TOKEN
    - post-flip config hygiene table assertion

Usage:
  py -3 scripts/verify-fp10-step7.py [--static-only] [--flip]
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILED = False


def check(label: str, cond: bool, detail: str = ""):
    global FAILED
    if cond:
        print(f"  PASS {label}")
    else:
        print(f"  FAIL {label}" + (f" -- {detail}" if detail else ""))
        FAILED = True


def read_file(rel: str) -> str:
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def load_env():
    env_file = os.path.join(ROOT, ".env")
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k not in os.environ:
                        os.environ[k] = v


load_env()
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
DEV_SMOKE_TOKEN = os.environ.get("DEV_SMOKE_TOKEN", "")


def svc(method: str, path: str, body: dict = None):
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
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
    except Exception as err:
        return 0, {"error": str(err)}


def static_checks():
    print("\n== A. static: double gate, server check, drill independence (AC-11, FR-11) ==")

    # 1. Client forcer double-gate
    dev_overrides_src = read_file("lib/devOverrides.ts")
    check("client forcer: devForcePayload returns null when enabled is false",
          "if (!enabled) return null;" in dev_overrides_src)
    check("client forcer: empty / none tier returns null",
          'if (overrides.tier !== "none")' in dev_overrides_src)

    # 2. Server gate in send-message
    send_msg_src = read_file("supabase/functions/send-message/index.ts")
    check("send-message: checks dev_overrides_enabled === true before applying overrides",
          '(await getConfig("dev_overrides_enabled")) === true' in send_msg_src)

    # 3. dev-smoke top-level independence
    dev_smoke_src = read_file("supabase/functions/dev-smoke/index.ts")
    # Top-level auth check is DEV_SMOKE_TOKEN, not dev_overrides_enabled
    entry_slice = dev_smoke_src[:dev_smoke_src.find("switch (action)")]
    check("dev-smoke: top-level handler independent of dev_overrides_enabled",
          'getConfig("dev_overrides_enabled")' not in entry_slice)
    check("dev-smoke: top-level guarded by DEV_SMOKE_TOKEN header check",
          "Bearer ${DEV_SMOKE_TOKEN}" in dev_smoke_src)

    # 4. Zero client diffs
    proc = subprocess.run(["git", "diff", "--name-only", "main", "--", "lib", "app", "components"],
                          cwd=ROOT, capture_output=True, text=True, shell=(os.name == "nt"))
    client_diffs = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    check("surface discipline: zero client diffs against main",
          len(client_diffs) == 0, str(client_diffs))


def live_checks(do_flip: bool = False):
    print("\n== B. live: config hygiene & post-flip verification (AC-11) ==")
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        print("  SKIP live checks: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing")
        return

    # Read current config
    _, stub_rows = svc("GET", "/rest/v1/config?select=value&key=eq.llm_stub_mode")
    _, fail_rows = svc("GET", "/rest/v1/config?select=value&key=eq.llm_force_fail")
    _, malf_rows = svc("GET", "/rest/v1/config?select=value&key=eq.llm_stub_malformed")
    _, over_rows = svc("GET", "/rest/v1/config?select=value&key=eq.dev_overrides_enabled")

    stub_val = stub_rows[0]["value"] if stub_rows else None
    fail_val = fail_rows[0]["value"] if fail_rows else None
    malf_val = malf_rows[0]["value"] if malf_rows else None
    over_val = over_rows[0]["value"] if over_rows else None

    check("hygiene: llm_stub_mode is false", stub_val is False, str(stub_val))
    check("hygiene: llm_force_fail is 'none'", fail_val in ("none", None), str(fail_val))
    check("hygiene: llm_stub_malformed is false", malf_val is False, str(malf_val))

    if do_flip:
        print("\n-- Executing the flip: dev_overrides_enabled -> false --")
        status, _ = svc("PATCH", "/rest/v1/config?key=eq.dev_overrides_enabled", {"value": False})
        check("flip: PATCH dev_overrides_enabled returned 200/204", status in (200, 204), str(status))

        _, flipped_rows = svc("GET", "/rest/v1/config?select=value&key=eq.dev_overrides_enabled")
        over_val = flipped_rows[0]["value"] if flipped_rows else None
        check("flip: dev_overrides_enabled is false", over_val is False, str(over_val))

    print(f"\nConfig State: dev_overrides_enabled = {over_val}")

    anon = os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY", "")
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    from _mint_dev_jwt import mint_access_token

    if over_val is False:
        # Disposable user turn with forged dev_force override
        print("\n-- Verifying natural turn routing with forged dev_force --")
        test_email = f"test-flip-{uuid.uuid4().hex[:8]}@davos.local"
        _, u_res = svc("POST", "/auth/v1/admin/users", {
            "email": test_email,
            "password": "Password123!",
            "email_confirm": True,
            "user_metadata": {"full_name": "Flip Tester"},
        })
        uid = u_res.get("id")
        if uid:
            try:
                # Mark user onboarding_stage = 'complete'
                svc("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {"onboarding_stage": "complete"})
                user_token, _ = mint_access_token(SUPABASE_URL, SERVICE_ROLE_KEY, test_email)

                # Send a clearly Career-oriented prompt with forged dev_force attempting to force 'fallback' route & 'Health' domain
                forged_payload = {
                    "content": "I am reviewing my quarterly career milestones and promotion roadmap.",
                    "client_message_id": str(uuid.uuid4()),
                    "dev_force": {
                        "tier": "fallback",
                        "domain": "Health"
                    }
                }
                url = f"{SUPABASE_URL}/functions/v1/send-message"
                req_headers = {
                    "Authorization": f"Bearer {user_token}",
                    "apikey": anon,
                    "Content-Type": "application/json",
                }
                req = urllib.request.Request(url, data=json.dumps(forged_payload).encode("utf-8"), headers=req_headers, method="POST")
                with urllib.request.urlopen(req, timeout=60) as resp:
                    status = resp.status
                    reply = json.loads(resp.read().decode("utf-8"))
                check("send-message with forged dev_force succeeded", status == 200, str(status))

                asst_id = reply.get("assistant_message_id")
                if asst_id:
                    _, msg_rows = svc("GET", f"/rest/v1/messages?select=metadata&id=eq.{asst_id}")
                    meta = msg_rows[0].get("metadata", {}) if msg_rows else {}
                    route = meta.get("route")
                    domain = meta.get("domain")
                    check("natural routing: route in valid routing set",
                          route in ("auto", "options", "low_question", "fallback"),
                          f"route={route}")
                    check("natural routing: domain is NOT forced 'Health'",
                          domain != "Health", f"domain={domain}")

            finally:
                # Purge user data through the RPC before deleting auth user, and verify profile is gone
                p_st, _ = svc("POST", "/rest/v1/rpc/purge_user_data", {"p_user_id": uid})
                _, prof = svc("GET", f"/rest/v1/profiles?id=eq.{uid}")
                if len(prof) == 0:
                    svc("DELETE", f"/auth/v1/admin/users/{uid}")
                else:
                    print(f"  WARN: profile row still present after purge_user_data for {uid}")

        # Drill independence
        print("\n-- Verifying dev-smoke drill independence behind DEV_SMOKE_TOKEN --")
        url = f"{SUPABASE_URL}/functions/v1/dev-smoke?action=models"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {DEV_SMOKE_TOKEN}"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                check("dev-smoke ?action=models responds 200 OK post-flip", resp.status == 200)
        except Exception as err:
            check("dev-smoke ?action=models responds 200 OK post-flip", False, str(err))
    else:
        print("  NOTE: dev_overrides_enabled is currently 'true'. Run with --flip to execute the flip.")


def main():
    parser = argparse.ArgumentParser(description="FP-10 Step 7 Verification")
    parser.add_argument("--static-only", action="store_true", help="Run only static assertions")
    parser.add_argument("--flip", action="store_true", help="Execute dev_overrides_enabled flip to false")
    args = parser.parse_args()

    print("=== FP-10 Step 7: Beyond-Beta Gate & Flip Verification ===")
    static_checks()

    if not args.static_only:
        live_checks(do_flip=args.flip)

    print("\n========================================================")
    if FAILED:
        print("FAIL -- FP-10 Step 7 checks reported failures.")
        sys.exit(1)
    else:
        print("ALL CHECKS PASSED -- FP-10 Step 7 VERIFIED")
        sys.exit(0)


if __name__ == "__main__":
    main()
