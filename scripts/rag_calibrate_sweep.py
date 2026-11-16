#!/usr/bin/env python3
"""Run candidate retrieval sweep for RAG semantic threshold calibration.

Queries the live corpus via dev-smoke?action=rag-calibrate for the 20 rules
and 20 memory queries defined in content/rag-fixtures/semantic_thresholds.json.

Usage:
  python scripts/rag_calibrate_sweep.py [--source rules|memory|both] [--out candidates.json]
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(ROOT, "scripts"))
from _mint_dev_jwt import mint_for_gates

def load_env():
    env_file = os.path.join(ROOT, ".env")
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip()
                    os.environ.setdefault(k, v)
                    if k == "EXPO_PUBLIC_SUPABASE_URL":
                        os.environ.setdefault("SUPABASE_URL", v)
                    elif k == "EXPO_PUBLIC_SUPABASE_ANON_KEY":
                        os.environ.setdefault("SUPABASE_ANON_KEY", v)
    return dict(os.environ)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["rules", "memory", "both"], default="both")
    parser.add_argument("--email", default=None, help="User email to mint JWT for (defaults to .env or Dhanush's account)")
    parser.add_argument("--out", default=os.path.join(ROOT, "content", "rag-fixtures", "candidates_sweep.json"))
    args = parser.parse_args()

    env = load_env()
    base_url = env.get("EXPO_PUBLIC_SUPABASE_URL", "").rstrip("/")
    smoke_token = env.get("DEV_SMOKE_TOKEN")

    if not base_url or not smoke_token:
        print("ERROR: EXPO_PUBLIC_SUPABASE_URL or DEV_SMOKE_TOKEN missing from .env")
        sys.exit(1)

    print("Minting user JWT...")
    if args.email:
        os.environ["DAVOS_USER_EMAIL"] = args.email
    token, claims = mint_for_gates()
    if not token or not claims:
        print("ERROR: Failed to mint user JWT")
        sys.exit(1)

    user_id = claims["sub"]
    print(f"Authenticated as user: {user_id}")

    fixtures_path = os.path.join(ROOT, "content", "rag-fixtures", "semantic_thresholds.json")
    with open(fixtures_path, "r", encoding="utf-8") as f:
        fixtures = json.load(f)

    results = {"rules": {}, "memory": {}}

    headers = {
        "Authorization": f"Bearer {smoke_token}",
        "X-User-JWT": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    if args.source in ("rules", "both"):
        rules_queries = fixtures["sources"]["rules"]["queries"]
        print(f"\n--- Sweeping {len(rules_queries)} Rules Queries ---")
        for q in rules_queries:
            qid = q["id"]
            text = q["query"]
            params = urllib.parse.urlencode({
                "action": "rag-calibrate",
                "user": user_id,
                "source": "rules",
                "rules_limit": 5,
                "text": text,
            })
            url = f"{base_url}/functions/v1/dev-smoke?{params}"
            req = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode())
                    matched = data.get("rules", [])
                    results["rules"][qid] = {
                        "query": text,
                        "candidates": matched,
                    }
                    print(f"\n[{qid}] {text}")
                    for r in matched:
                        print(f"  ({r['similarity']:.4f}) [{r['domain']}] {r['id']}: {r['text'][:75]}...")
            except Exception as e:
                print(f"ERROR on {qid}: {e}")

    if args.source in ("memory", "both"):
        memory_queries = fixtures["sources"]["memory"]["queries"]
        print(f"\n--- Sweeping {len(memory_queries)} Memory Queries ---")
        for q in memory_queries:
            qid = q["id"]
            text = q["query"]
            params = urllib.parse.urlencode({
                "action": "rag-calibrate",
                "user": user_id,
                "source": "memory",
                "facts_limit": 5,
                "text": text,
            })
            url = f"{base_url}/functions/v1/dev-smoke?{params}"
            req = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode())
                    matched = data.get("memory", [])
                    results["memory"][qid] = {
                        "query": text,
                        "candidates": matched,
                    }
                    print(f"\n[{qid}] {text}")
                    if matched:
                        for m in matched:
                            print(f"  ({m['similarity']:.4f}) [{m['fact_type']}] {m['id']}: {m['fact'][:75]}...")
                    else:
                        print("  (No facts returned)")
            except Exception as e:
                print(f"ERROR on {qid}: {e}")

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved candidates to {args.out}")

if __name__ == "__main__":
    main()
