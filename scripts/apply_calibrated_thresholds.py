#!/usr/bin/env python3
"""Apply calibrated RAG similarity thresholds to the config table.

Sets:
  rag_rules_min_similarity = 0.76
  rag_memory_min_similarity = 0.72

Usage:
  python scripts/apply_calibrated_thresholds.py [--dry-run]
"""

import argparse
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_env():
    env = {}
    env_file = os.path.join(ROOT, ".env")
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    return env

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    fixtures_file = os.path.join(ROOT, "content", "rag-fixtures", "semantic_thresholds.json")
    with open(fixtures_file, "r", encoding="utf-8") as f:
        fixtures = json.load(f)

    rules_threshold = fixtures.get("calibrated", {}).get("rag_rules_min_similarity", 0.76)
    memory_threshold = fixtures.get("calibrated", {}).get("rag_memory_min_similarity", 0.72)

    print(f"Calibrated thresholds to apply:")
    print(f"  rag_rules_min_similarity  : {rules_threshold}")
    print(f"  rag_memory_min_similarity : {memory_threshold}")

    if args.dry_run:
        print("[dry-run] No changes made.")
        return

    env = load_env()
    base_url = env.get("EXPO_PUBLIC_SUPABASE_URL", "").rstrip("/")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY")

    if not base_url or not service_key:
        print("ERROR: EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env")
        sys.exit(1)

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    # Update rag_rules_min_similarity
    url_rules = f"{base_url}/rest/v1/config?key=eq.rag_rules_min_similarity"
    body_rules = json.dumps({"value": rules_threshold}).encode()
    req_rules = urllib.request.Request(url_rules, data=body_rules, headers=headers, method="PATCH")
    with urllib.request.urlopen(req_rules) as resp:
        print(f"Updated rag_rules_min_similarity: {resp.status} - {resp.read().decode()}")

    # Update rag_memory_min_similarity
    url_memory = f"{base_url}/rest/v1/config?key=eq.rag_memory_min_similarity"
    body_memory = json.dumps({"value": memory_threshold}).encode()
    req_memory = urllib.request.Request(url_memory, data=body_memory, headers=headers, method="PATCH")
    with urllib.request.urlopen(req_memory) as resp:
        print(f"Updated rag_memory_min_similarity: {resp.status} - {resp.read().decode()}")

    print("\nSUCCESS: Calibrated thresholds written to production config table.")

if __name__ == "__main__":
    main()
