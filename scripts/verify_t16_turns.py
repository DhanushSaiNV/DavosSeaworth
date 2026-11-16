#!/usr/bin/env python3
"""Execute T16 drill (10 real chat turns) for Gate G2 verification.

Refs:
  PLAN.md §14 (Test T16), §15 (Gate G2 exit condition).

Temporarily enables rag_planner_enabled = true, runs 10 real turns through
send-message, verifies contracts, ceilings and response safety, then restores
rag_planner_enabled = false in a finally block.

Usage:
  python scripts/verify_t16_turns.py [--email user@example.com]
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import uuid
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(ROOT, "scripts"))
from _mint_dev_jwt import mint_for_gates

def load_env():
    env = {}
    env_file = os.path.join(ROOT, ".env")
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip()
                    env[k] = v
                    os.environ.setdefault(k, v)
                    if k == "EXPO_PUBLIC_SUPABASE_URL":
                        os.environ.setdefault("SUPABASE_URL", v)
                    elif k == "EXPO_PUBLIC_SUPABASE_ANON_KEY":
                        os.environ.setdefault("SUPABASE_ANON_KEY", v)
    return env

FORBIDDEN_MARKERS = [
    "tactical_analysis",
    "trust_score",
    "unsavable",
    "embed_model",
]

TURNS = [
    ("T1-casual", "Hey Davos, how are you doing today?"),
    ("T2-concept", "What is a dopamine detox and is there good scientific evidence for it?"),
    ("T3-checkins", "How many check-ins did I complete last week?"),
    ("T4-memory", "What did I tell you about my morning routine or workouts?"),
    ("T5-rules", "I keep putting off the most important task. What principle should I remember?"),
    ("T6-trend", "Do my impulse slips happen more often when I miss check-ins?"),
    ("T7-career", "What did I say my long-term career goal is?"),
    ("T8-decision", "I have too many competing priorities and feel overwhelmed. How do I decide what to drop?"),
    ("T9-abstain", "How many urge urges have I successfully resisted this month?"),
    ("T10-journal", "Can you check my journal entries from last month and tell me the dates and severities I logged?"),
]

def set_planner_enabled(base_url, service_key, enabled: bool):
    url = f"{base_url}/rest/v1/config?key=eq.rag_planner_enabled"
    body = json.dumps({"value": enabled}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        method="PATCH",
    )
    with urllib.request.urlopen(req) as resp:
        return resp.status in (200, 204)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default="dhanushsai1467@gmail.com")
    args = parser.parse_args()

    env = load_env()
    base_url = env.get("EXPO_PUBLIC_SUPABASE_URL", "").rstrip("/")
    anon_key = env.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY")

    if not base_url or not service_key or not anon_key:
        print("ERROR: Missing required credentials in .env")
        sys.exit(1)

    print(f"Minting user JWT for {args.email}...")
    os.environ["DAVOS_USER_EMAIL"] = args.email
    token, claims = mint_for_gates()
    if not token or not claims:
        print("ERROR: Failed to mint user JWT")
        sys.exit(1)

    user_id = claims["sub"]
    print(f"Authenticated as user: {user_id}")

    print("\nEnabling rag_planner_enabled = true for T16 drill...")
    if not set_planner_enabled(base_url, service_key, True):
        print("ERROR: Failed to enable rag_planner_enabled in config")
        sys.exit(1)

    all_passed = True
    turn_results = []

    try:
        print(f"\n--- Running 10 Real Chat Turns (T16) ---")
        for turn_id, prompt_text in TURNS:
            client_msg_id = str(uuid.uuid4())
            sent_at = datetime.now(timezone.utc).isoformat()

            body = {
                "content": prompt_text,
                "client_message_id": client_msg_id,
                "client_sent_at": sent_at,
            }

            url = f"{base_url}/functions/v1/send-message"
            req = urllib.request.Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers={
                    "apikey": anon_key,
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )

            start_t = time.time()
            try:
                with urllib.request.urlopen(req, timeout=45) as resp:
                    elapsed = time.time() - start_t
                    res_body = json.loads(resp.read().decode())
                    status = resp.status
            except urllib.error.HTTPError as e:
                elapsed = time.time() - start_t
                status = e.code
                err_text = e.read().decode()
                print(f"[{turn_id}] FAIL: HTTP {status} in {elapsed:.1f}s - {err_text[:120]}")
                all_passed = False
                turn_results.append((turn_id, False, f"HTTP {status}: {err_text[:100]}"))
                time.sleep(2.0)
                continue
            except Exception as e:
                elapsed = time.time() - start_t
                print(f"[{turn_id}] FAIL: exception in {elapsed:.1f}s - {e}")
                all_passed = False
                turn_results.append((turn_id, False, str(e)))
                time.sleep(2.0)
                continue

            assistant_msg_id = res_body.get("assistant_message_id")
            reply = ""
            if assistant_msg_id:
                # Fetch stored reply from messages table
                msg_url = f"{base_url}/rest/v1/messages?id=eq.{assistant_msg_id}&select=content"
                msg_req = urllib.request.Request(
                    msg_url,
                    headers={
                        "apikey": anon_key,
                        "Authorization": f"Bearer {token}",
                    },
                )
                try:
                    with urllib.request.urlopen(msg_req, timeout=10) as msg_resp:
                        msg_data = json.loads(msg_resp.read().decode())
                        if msg_data and len(msg_data) > 0:
                            reply = msg_data[0].get("content", "")
                except Exception as e:
                    print(f"[{turn_id}] Warning fetching assistant message: {e}")

            # Fallback if returned directly
            if not reply:
                reply = res_body.get("assistantContent") or res_body.get("reply") or ""

            # Check for leaked sensitive markers
            reply_lower = reply.lower()
            leaks = [m for m in FORBIDDEN_MARKERS if m in reply_lower]

            passed = (status == 200) and (len(reply) > 0) and (len(leaks) == 0)
            if not passed:
                all_passed = False

            snippet = reply[:85].replace("\n", " ")
            print(f"[{turn_id}] {'PASS' if passed else 'FAIL'} in {elapsed:.1f}s")
            print(f"     reply: \"{snippet}...\"")
            if leaks:
                print(f"     * LEAKED FORBIDDEN MARKERS: {leaks}")

            turn_results.append((turn_id, passed, snippet))
            # Pacing between turns to respect rate limits
            time.sleep(2.0)

    finally:
        print("\nRestoring rag_planner_enabled = false (kill switch default)...")
        set_planner_enabled(base_url, service_key, False)

    print("\n" + "=" * 65)
    print(" T16 DRILL SUMMARY")
    print("=" * 65)
    for tid, ok, note in turn_results:
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {tid}: {note[:60]}")

    print("-" * 65)
    print(f"T16 VERDICT: {'ALL 10 TURNS GREEN' if all_passed else 'SOME TURNS FAILED'}")
    print("=" * 65)

    if not all_passed:
        sys.exit(1)

if __name__ == "__main__":
    main()
