#!/usr/bin/env python3
"""FP-07 Step 3 verification: presets, the create helper, and seed/clear drill actions.

Checks:
  * every preset passes the real gate (the library cannot ship unvalidated)
  * seed-metrics -> exactly the eight library rows, all validated + is_core, read under the
    user's own JWT (RLS own-rows)
  * re-seed -> zero new rows (idempotent by name)
  * a hand-authored foreign-named metric survives clear-metrics; every preset row is gone
  * a direct insertValidatedMetric call with a planted invalid formula is refused and writes
    no row
  * the seed/clear actions report zero adapter calls, and no metric insert exists outside the
    create helper

The script creates a throwaway auth user, seeds into it, and deletes the user (cascade) at the
end. It never touches an existing beta user's metrics.

Usage: python scripts/verify-fp07-step3.py
"""

import contextlib
import io
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []


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


def req(url, method, path, body=None, token=None, key=None, timeout=90):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["apikey"] = key
    if token:
        headers["Authorization"] = f"Bearer {token}"
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
    status, body = req(url, "POST", f"/rest/v1/{table}", payload, token=service, key=service)
    if status not in (200, 201, 204):
        raise RuntimeError(f"POST {table} -> {status}: {body}")
    return body


def delete(url, service, path):
    status, body = req(url, "DELETE", path, token=service, key=service)
    if status not in (200, 204):
        raise RuntimeError(f"DELETE {path} -> {status}: {body}")
    return body


def smoke(url, token, action, user_id, extra=""):
    status, body = req(
        url,
        "POST",
        f"/functions/v1/dev-smoke?action={action}&user={user_id}{extra}",
        token=token,
        key=token,
    )
    return status, body


def preset_names():
    text = open(
        os.path.join(ROOT, "supabase/functions/_shared/metrics/presets.ts"), encoding="utf-8"
    ).read()
    return re.findall(r'name:\s*"([^"]+)"', text)


def main():
    load_dotenv()
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    service = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anon = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    smoke_token = os.environ.get("DEV_SMOKE_TOKEN")
    if not url or not service or not anon or not smoke_token:
        sys.exit("need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEV_SMOKE_TOKEN")

    print("== FP-07 Step 3: presets, create helper, seed/clear ==\n")

    names = preset_names()
    print("== A. static surface ==")
    check("preset library has eight entries", len(names) == 8, repr(names))

    create_src = open(
        os.path.join(ROOT, "supabase/functions/_shared/metrics/create.ts"), encoding="utf-8"
    ).read()
    check(
        "create helper validates before loading the service client",
        create_src.find("validateFormula") < create_src.find('import("../config.ts")'),
    )
    check("create helper writes formula_status='validated'", '"validated"' in create_src)

    metric_insert_sites = []
    for dirpath, _, filenames in os.walk(os.path.join(ROOT, "supabase/functions")):
        for filename in filenames:
            if not filename.endswith((".ts", ".tsx")):
                continue
            path = os.path.join(dirpath, filename)
            text = open(path, encoding="utf-8").read()
            if re.search(r'\.from\(\s*["\']metrics["\']\s*\)\s*\.insert', text):
                metric_insert_sites.append(os.path.relpath(path, ROOT).replace("\\", "/"))
    check(
        "metrics inserts exist only in the create helper",
        metric_insert_sites == ["supabase/functions/_shared/metrics/create.ts"],
        repr(metric_insert_sites),
    )

    dev_src = open(os.path.join(ROOT, "supabase/functions/dev-smoke/index.ts"), encoding="utf-8").read()
    for action in ("seed-metrics", "clear-metrics"):
        check(f"{action} action present", f'case "{action}"' in dev_src)
    check("seed/clear report zero adapter calls", "adapterCalls: 0" in dev_src)
    migration = open(
        os.path.join(ROOT, "supabase/migrations/0031_metrics_fp07.sql"), encoding="utf-8"
    ).read()
    check("migration 0031 does not touch RLS",
          not re.search(r"\b(create|alter|drop)\s+policy\b|enable\s+row\s+level\s+security", migration, re.I))

    print("\n== B. live seed/clear ==")
    email = f"fp07-step3-{uuid.uuid4().hex[:12]}@example.com"
    status, created = req(
        url,
        "POST",
        "/auth/v1/admin/users",
        {"email": email, "password": uuid.uuid4().hex + "Aa1!", "email_confirm": True},
        token=service,
        key=service,
    )
    if status not in (200, 201) or not created.get("id"):
        sys.exit(f"could not create temp user: {status} {created}")
    user_id = created["id"]

    try:
        # Mint a real user JWT for the temp user, so the own-rows read proves the RLS path.
        sys.path.insert(0, os.path.join(ROOT, "scripts"))
        from _mint_dev_jwt import resolve_gate_token  # noqa: E402

        # resolve_gate_token prints the bearer token by design; keep it out of gate logs.
        with contextlib.redirect_stdout(io.StringIO()):
            jwt, usable, note = resolve_gate_token(None, url, service, email)
        check("user JWT minted for the temp user", usable, note)

        status, seeded = smoke(url, smoke_token, "seed-metrics", user_id)
        check("seed-metrics returns 200", status == 200, f"{status} {seeded}")
        check("seed inserts eight", isinstance(seeded, dict) and seeded.get("inserted") == 8, repr(seeded))
        check("seed reports zero adapter calls",
              isinstance(seeded, dict) and seeded.get("adapterCalls") == 0, repr(seeded))

        all_rows = rows(
            url, service,
            f"/rest/v1/metrics?select=id,name,formula_status,is_core,is_quest,output_unit&user_id=eq.{user_id}&order=name",
        )
        check("exactly the eight preset rows exist", len(all_rows) == 8, repr(all_rows))
        check("every row is validated", all(r["formula_status"] == "validated" for r in all_rows))
        check("every row is core", all(r["is_core"] is True for r in all_rows))
        check("names are the library", sorted(r["name"] for r in all_rows) == sorted(names))

        if usable:
            status, own = req(
                url,
                "GET",
                f"/rest/v1/metrics?select=id&user_id=eq.{user_id}",
                token=jwt,
                key=anon,
            )
            check("own-rows JWT read sees the seeded rows", status == 200 and len(own) == 8,
                  f"{status} {own}")

        status, reseeded = smoke(url, smoke_token, "seed-metrics", user_id)
        check("re-seed returns 200", status == 200, f"{status} {reseeded}")
        check("re-seed inserts zero", isinstance(reseeded, dict) and reseeded.get("inserted") == 0,
              repr(reseeded))
        check("re-seed skips eight", isinstance(reseeded, dict) and reseeded.get("skipped") == 8,
              repr(reseeded))
        count = rows(url, service, f"/rest/v1/metrics?select=id&user_id=eq.{user_id}")
        check("row count still eight", len(count) == 8, repr(len(count)))

        # Foreign/hand-authored metric must survive the scoped clear.
        insert(url, service, "metrics", [{
            "user_id": user_id, "name": "Foreign metric", "domain": "General",
            "output_unit": "x", "formula": {"var": "doings_count"},
            "formula_status": "validated",
        }])
        status, cleared = smoke(url, smoke_token, "clear-metrics", user_id)
        check("clear-metrics returns 200", status == 200, f"{status} {cleared}")
        check("clear deletes eight", isinstance(cleared, dict) and cleared.get("deleted") == 8,
              repr(cleared))
        check("clear reports zero adapter calls",
              isinstance(cleared, dict) and cleared.get("adapterCalls") == 0, repr(cleared))
        remaining = rows(url, service, f"/rest/v1/metrics?select=name&user_id=eq.{user_id}")
        check("foreign row survives", [r["name"] for r in remaining] == ["Foreign metric"],
              repr(remaining))

        print("\n== C. create-helper direct call ==")
        before = len(rows(url, service, f"/rest/v1/metrics?select=id&user_id=eq.{user_id}"))
        eval_script = """
import { insertValidatedMetric } from "./supabase/functions/_shared/metrics/create.ts";
const result = await insertValidatedMetric({
  user_id: "00000000-0000-0000-0000-000000000000",
  name: "Planted invalid",
  domain: "Career",
  output_unit: "x",
  formula: { reduce: [{ var: "doings_count" }, 0] },
}, { max_depth: 6, max_nodes: 30, literal_abs_max: 1000 });
console.log(JSON.stringify(result));
"""
        proc = subprocess.run(
            ["deno", "eval", "--allow-read", eval_script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=120,
        )
        output = (proc.stdout or "").strip().splitlines()
        parsed = None
        for line in reversed(output):
            try:
                parsed = json.loads(line)
                break
            except Exception:  # noqa: BLE001
                continue
        check("direct create-helper call ran", parsed is not None, (proc.stdout or "")[-500:] + (proc.stderr or "")[-500:])
        check("invalid formula refused at validation", isinstance(parsed, dict)
              and parsed.get("ok") is False and parsed.get("stage") == "validation", repr(parsed))
        after = len(rows(url, service, f"/rest/v1/metrics?select=id&user_id=eq.{user_id}"))
        check("no row written by the refused formula", before == after, f"{before}->{after}")

    finally:
        try:
            req(url, "DELETE", f"/auth/v1/admin/users/{user_id}", token=service, key=service)
        except Exception:  # noqa: BLE001
            pass

    print()
    if FAILS:
        print(f"FAILED: {len(FAILS)} check(s): {FAILS}")
        return 1
    print("PASS: FP-07 Step 3")
    return 0


if __name__ == "__main__":
    sys.exit(main())
