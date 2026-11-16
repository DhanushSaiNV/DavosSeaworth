#!/usr/bin/env python3
"""Run the RAG redesign 10-prompt smoke test suite against production dev-smoke.

Refs:
  PRD §14.1 D (the 10 prompts)
  PLAN.md §15 (P4 / Gate G2)

Usage:
  python scripts/run_rag_smoke.py [--email user@example.com]
"""

import argparse
import json
import os
import sys
import urllib.request

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

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default="dhanushsai1467@gmail.com")
    args = parser.parse_args()

    env = load_env()
    base_url = env.get("EXPO_PUBLIC_SUPABASE_URL", "").rstrip("/")
    smoke_token = env.get("DEV_SMOKE_TOKEN")

    if not base_url or not smoke_token:
        print("ERROR: EXPO_PUBLIC_SUPABASE_URL or DEV_SMOKE_TOKEN missing from .env")
        sys.exit(1)

    print(f"Minting user JWT for {args.email}...")
    if args.email:
        os.environ["DAVOS_USER_EMAIL"] = args.email
    token, claims = mint_for_gates()
    if not token or not claims:
        print("ERROR: Failed to mint user JWT")
        sys.exit(1)

    user_id = claims["sub"]
    print(f"Authenticated as user: {user_id}")

    smoke_prompts_file = os.path.join(ROOT, "content", "rag-fixtures", "smoke_prompts.json")
    with open(smoke_prompts_file, "r", encoding="utf-8") as f:
        smoke_set = json.load(f)

    print(f"Running smoke test on {len(smoke_set.get('prompts', []))} prompts...")
    url = f"{base_url}/functions/v1/dev-smoke?action=rag-smoke&user={user_id}"
    req = urllib.request.Request(
        url,
        data=json.dumps(smoke_set).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {smoke_token}",
            "X-User-JWT": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTPError: {e.code} - {e.read().decode()}")
        sys.exit(1)
    except Exception as e:
        print(f"Error calling dev-smoke: {e}")
        sys.exit(1)

    results = data.get("results", [])
    observations = {obs["promptId"]: obs for obs in data.get("observations", [])}
    summary = data.get("summary", {})

    print("\n" + "=" * 65)
    print(" RAG REDESIGN SMOKE DRILL RESULTS (PRD §14.1 D / PLAN.md §15)")
    print("=" * 65)

    for r in results:
        pid = r["promptId"]
        verdict = r["verdict"].upper()
        obs = observations.get(pid, {})
        datasets = obs.get("requestedDatasets", [])
        chars = obs.get("totalChars", 0)
        requests = obs.get("generationRequests", 0)
        plan_state = obs.get("planState", "unknown")

        color = "\033[92m" if verdict == "PASS" else "\033[93m" if verdict == "WARN" else "\033[91m"
        reset = "\033[0m"
        print(f"\n{color}[{verdict}]{reset} {pid}")
        print(f"     plan: {plan_state} | datasets: {datasets} | evidence: {chars} chars | LLM requests: {requests}")
        for note in r.get("notes", []):
            print(f"     * {note}")

    print("\n" + "-" * 65)
    print(f"SUMMARY: {summary.get('pass', 0)} PASS, {summary.get('warn', 0)} WARN, {summary.get('fail', 0)} FAIL")
    print(f"GATE G2 VERDICT: {'PASSED (Non-blocking)' if not summary.get('blocking', True) else 'FAILED (Blocking)'}")
    print("-" * 65)

    if summary.get("blocking", True):
        sys.exit(1)

if __name__ == "__main__":
    main()
