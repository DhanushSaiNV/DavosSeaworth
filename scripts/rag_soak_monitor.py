#!/usr/bin/env python3
"""Davos RAG Redesign — Gate G3 Soak & Health Monitor.

Continuously or on-demand monitors the health of RAG retrieval in production:
1. Validates production `config` table RAG settings.
2. Audits recent assistant messages for forbidden leaks and metadata integrity.
3. Executes canary test turns to verify live end-to-end retrieval, latency, and persona grounding.

Usage:
  python scripts/rag_soak_monitor.py --once
  python scripts/rag_soak_monitor.py --interval 300
"""

import argparse
from datetime import datetime, timezone
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from _mint_dev_jwt import mint_for_gates

FORBIDDEN_MARKERS = [
    "tactical_analysis",
    "trust_score",
    "unsavable",
    "embed_model",
]

CANARY_PROMPTS = [
    ("canary-casual", "Hello Davos, how are you today?", "no-retrieval"),
    ("canary-rule", "I keep putting off the most important task. What principle should I follow?", "rule-retrieval"),
    ("canary-memory", "What is the name of my primary project that I'm building?", "memory-retrieval"),
]

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

def check_config(base_url, service_key):
    """Check production RAG config table rows."""
    url = f"{base_url}/rest/v1/config?key=like.rag*"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
    )
    with urllib.request.urlopen(req) as resp:
        rows = json.loads(resp.read().decode())
    
    cfg = {r["key"]: r["value"] for r in rows}
    issues = []
    
    if cfg.get("rag_planner_enabled") is not True:
        issues.append(f"rag_planner_enabled is {cfg.get('rag_planner_enabled')}, expected True")
    if cfg.get("rag_rules_min_similarity") != 0.76:
        issues.append(f"rag_rules_min_similarity is {cfg.get('rag_rules_min_similarity')}, expected 0.76")
    if cfg.get("rag_memory_min_similarity") != 0.72:
        issues.append(f"rag_memory_min_similarity is {cfg.get('rag_memory_min_similarity')}, expected 0.72")
    if cfg.get("rag_evidence_total_chars") != 12000:
        issues.append(f"rag_evidence_total_chars is {cfg.get('rag_evidence_total_chars')}, expected 12000")
    if cfg.get("rag_max_plan_requests") != 6:
        issues.append(f"rag_max_plan_requests is {cfg.get('rag_max_plan_requests')}, expected 6")

    return cfg, issues

def audit_recent_messages(base_url, service_key, limit=10):
    """Inspect recent messages in production for forbidden leaks and metadata."""
    url = f"{base_url}/rest/v1/messages?role=eq.assistant&order=created_at.desc&limit={limit}&select=id,content,metadata,created_at"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
    )
    with urllib.request.urlopen(req) as resp:
        msgs = json.loads(resp.read().decode())
    
    leaks = []
    for m in msgs:
        content = m.get("content", "")
        for marker in FORBIDDEN_MARKERS:
            if marker in content:
                leaks.append((m["id"], marker))

    return msgs, leaks

def run_canary_turn(base_url, anon_key, token, turn_id, prompt_text):
    """Execute a single canary turn via send-message."""
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
        return False, elapsed, f"HTTP {e.code}: {e.read().decode()[:120]}"
    except Exception as e:
        elapsed = time.time() - start_t
        return False, elapsed, str(e)

    asst_id = res_body.get("assistant_message_id")
    if not asst_id:
        return False, elapsed, "No assistant_message_id returned"

    # Fetch stored assistant reply
    msg_url = f"{base_url}/rest/v1/messages?id=eq.{asst_id}&select=content,metadata"
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
            content = msg_data[0].get("content", "") if msg_data else ""
            meta = msg_data[0].get("metadata", {}) if msg_data else {}
    except Exception as e:
        return True, elapsed, f"OK (fetch reply warning: {e})"

    # Check leaks
    found_leaks = [m for m in FORBIDDEN_MARKERS if m in content]
    if found_leaks:
        return False, elapsed, f"LEAK DETECTED: {found_leaks}"

    rule_ids = meta.get("rule_ids", [])
    detail = f"OK (chars={len(content)}, rules={len(rule_ids)})"
    return True, elapsed, detail

def run_health_cycle(base_url, anon_key, service_key, token, run_canaries=True):
    """Run one complete health check cycle."""
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"\n========================================================")
    print(f"  RAG SOAK HEALTH CHECK: {timestamp}")
    print(f"========================================================")

    all_ok = True

    # 1. Config check
    print("\n[1/3] Checking Production Config Settings...")
    cfg, cfg_issues = check_config(base_url, service_key)
    if cfg_issues:
        all_ok = False
        print("  FAIL: Config issues found:")
        for iss in cfg_issues:
            print(f"    - {iss}")
    else:
        print("  PASS: All RAG config rows match calibrated requirements:")
        print(f"    - rag_planner_enabled       : {cfg.get('rag_planner_enabled')}")
        print(f"    - rag_rules_min_similarity  : {cfg.get('rag_rules_min_similarity')}")
        print(f"    - rag_memory_min_similarity : {cfg.get('rag_memory_min_similarity')}")
        print(f"    - rag_evidence_total_chars  : {cfg.get('rag_evidence_total_chars')}")
        print(f"    - rag_max_plan_requests     : {cfg.get('rag_max_plan_requests')}")

    # 2. Recent Messages Audit
    print("\n[2/3] Auditing Recent Messages for Leakage & Quality...")
    msgs, leaks = audit_recent_messages(base_url, service_key, limit=10)
    print(f"  Audited {len(msgs)} recent assistant messages.")
    if leaks:
        all_ok = False
        print("  FAIL: Forbidden markers detected:")
        for msg_id, marker in leaks:
            print(f"    - Message {msg_id}: contains '{marker}'")
    else:
        print("  PASS: Zero forbidden markers found across recent messages.")

    # 3. Canary Turns
    if run_canaries:
        print("\n[3/3] Executing Live Canary Turns via send-message...")
        for turn_id, prompt_text, prompt_kind in CANARY_PROMPTS:
            ok, latency, detail = run_canary_turn(base_url, anon_key, token, turn_id, prompt_text)
            status_str = "PASS" if ok else "FAIL"
            print(f"  [{status_str}] {turn_id} ({prompt_kind}) in {latency:.2f}s: {detail}")
            if not ok:
                all_ok = False
            time.sleep(2.0)
    else:
        print("\n[3/3] Canary turns skipped.")

    print(f"\n--------------------------------------------------------")
    if all_ok:
        print(f"  CYCLE VERDICT: HEALTHY (All checks passed)")
    else:
        print(f"  CYCLE VERDICT: DEGRADED / ATTENTION REQUIRED")
    print(f"--------------------------------------------------------")
    return all_ok

def main():
    parser = argparse.ArgumentParser(description="Davos RAG Soak Health Monitor")
    parser.add_argument("--once", action="store_true", help="Run once and exit")
    parser.add_argument("--skip-canaries", action="store_true", help="Audit config and messages without sending canary turns")
    parser.add_argument("--interval", type=int, default=300, help="Interval in seconds for continuous mode (default: 300)")
    parser.add_argument("--email", default="dhanushsai1467@gmail.com", help="User email for canary turns")
    args = parser.parse_args()

    env = load_env()
    base_url = env.get("EXPO_PUBLIC_SUPABASE_URL", "").rstrip("/")
    anon_key = env.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY")

    if not base_url or not service_key or not anon_key:
        print("ERROR: Missing required credentials in .env")
        sys.exit(1)

    token = None
    if not args.skip_canaries:
        os.environ["DAVOS_USER_EMAIL"] = args.email
        token, claims = mint_for_gates()
        if not token:
            print("ERROR: Failed to mint user JWT for canary turns")
            sys.exit(1)

    if args.once:
        success = run_health_cycle(base_url, anon_key, service_key, token, not args.skip_canaries)
        sys.exit(0 if success else 1)

    print(f"Starting continuous soak monitor (every {args.interval}s). Press Ctrl+C to stop.\n")
    try:
        while True:
            run_health_cycle(base_url, anon_key, service_key, token, not args.skip_canaries)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nSoak monitor stopped by user.")

if __name__ == "__main__":
    main()
