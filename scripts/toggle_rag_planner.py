#!/usr/bin/env python3
"""Toggle rag_planner_enabled in Supabase production config table."""

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
    env = load_env()
    base_url = env.get("EXPO_PUBLIC_SUPABASE_URL", "").rstrip("/")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY")

    if not base_url or not service_key:
        print("ERROR: Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
        sys.exit(1)

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    # 1. Read current value
    get_url = f"{base_url}/rest/v1/config?key=eq.rag_planner_enabled"
    req_get = urllib.request.Request(get_url, headers=headers)
    with urllib.request.urlopen(req_get) as resp:
        rows = json.loads(resp.read().decode())
        if not rows:
            print("ERROR: rag_planner_enabled row not found in config table")
            sys.exit(1)
        current_value = rows[0].get("value")

    new_value = not bool(current_value)
    print(f"Current rag_planner_enabled : {current_value}")
    print(f"Toggling to                 : {new_value}")

    # 2. Update value
    patch_headers = dict(headers)
    patch_headers["Prefer"] = "return=representation"
    patch_body = json.dumps({"value": new_value}).encode()
    req_patch = urllib.request.Request(get_url, data=patch_body, headers=patch_headers, method="PATCH")
    with urllib.request.urlopen(req_patch) as resp:
        updated = json.loads(resp.read().decode())
        print(f"Server response             : {resp.status} - {updated}")

    # 3. Verify
    with urllib.request.urlopen(req_get) as resp:
        verified_rows = json.loads(resp.read().decode())
        verified_value = verified_rows[0].get("value")
        print(f"Verified config value       : {verified_value}")
        if verified_value == new_value:
            print(f"\nSUCCESS: rag_planner_enabled successfully toggled to {new_value}.")
        else:
            print(f"\nERROR: Verification failed! Expected {new_value}, found {verified_value}.")
            sys.exit(1)

if __name__ == "__main__":
    main()
