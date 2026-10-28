#!/usr/bin/env python3
"""verify-fp10-step3.py — FP-10 Step 3 gate.

Two independent checks:
1. Static reference audit: every `path:line` reference in FP-10-IDEMPOTENCY-AUDIT.md
   resolves to a file that exists and the cited line is in range.
2. Live idempotency matrix: invokes `verify-fp10-idempotency.py` and merges its ledger
   with the static audit results into a single JSON report.

Exit 0 iff both checks pass (no broken references, no failed legs).
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(ROOT, "docs", "feature-prds", "FP-10", "FP-10-IDEMPOTENCY-AUDIT.md")
HARNESS = os.path.join(ROOT, "scripts", "verify-fp10-idempotency.py")


def load_dotenv():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


def resolve_path(ref):
    """Resolve a reference like `migrations/0008_jobs.sql:42` or `lib/chat.ts:246`
    to an absolute path on disk, following the convention from the audit doc."""
    if ref.startswith("migrations/"):
        return os.path.join(ROOT, "supabase", ref)
    elif ref.startswith("_shared/") or ref.endswith("/index.ts"):
        return os.path.join(ROOT, "supabase", "functions", ref)
    else:
        return os.path.join(ROOT, ref)


def check_references():
    if not os.path.exists(DOC):
        return [f"audit doc not found: {DOC}"], []

    text = open(DOC, encoding="utf-8").read()
    # Find all `path:line` backtick references, including combined `path:1,2`
    refs = set(re.findall(r"`([A-Za-z0-9_./()-]+\.(?:ts|tsx|sql|py|md)):(\d+(?:,\d+)*)`", text))
    problems = []
    for path, lines in refs:
        abs_path = resolve_path(path)
        if not os.path.exists(abs_path):
            problems.append(f"missing file: {path} (resolved to {abs_path})")
            continue
        src = open(abs_path, encoding="utf-8", errors="replace").read().splitlines()
        for ln in lines.split(","):
            n = int(ln)
            if n < 1 or n > len(src):
                problems.append(f"line out of range: {path}:{ln} (file has {len(src)} lines)")
    return problems, refs


def run_harness():
    proc = subprocess.run(
        [sys.executable, HARNESS, "--json", "-"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=900,
    )
    if proc.returncode not in (0, 1):  # 1 means failed legs
        return None, f"harness crashed: {proc.stderr[-500:]}"
    try:
        # The harness prints human output to stdout; the JSON is the last line on stdout?
        # Actually the harness writes JSON to the file path; we passed "-" which means stdout.
        # But the harness prints summary etc. to stdout as well. We need to parse the JSON file.
        # Let's instead invoke with a temp file.
        pass
    except Exception as exc:
        return None, f"harness parse error: {exc}"
    return None, "not implemented"


def run_harness_to_file(json_path):
    proc = subprocess.run(
        [sys.executable, HARNESS, "--json", json_path],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=900,
    )
    if proc.returncode not in (0, 1):
        return False, f"harness crashed ({proc.returncode}): {proc.stderr[-500:]}"
    if not os.path.exists(json_path):
        return False, f"harness produced no JSON at {json_path}"
    with open(json_path, encoding="utf-8") as fh:
        data = json.load(fh)
    failed = data.get("fail", 0)
    return failed == 0, f"{data.get('fail', 0)} failed legs" if failed else "all legs passed"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", help="write the combined report here")
    args = ap.parse_args()

    load_dotenv()
    print("== FP-10 Step 3: idempotency audit ==")

    # 1) Static reference check
    print("\n--- static reference audit ---")
    problems, refs = check_references()
    if problems:
        for p in problems:
            print(f"  FAIL {p}")
        static_ok = False
    else:
        print(f"  PASS all {len(refs)} references resolve")
        static_ok = True

    # 2) Live harness
    print("\n--- live idempotency matrix ---")
    json_file = os.path.join(tempfile.gettempdir(), f"fp10-idem-{int(time.time())}.json")
    harness_ok, msg = run_harness_to_file(json_file)
    print(f"  {'PASS' if harness_ok else 'FAIL'} {msg}")

    # Combined report
    report = {
        "static": {"ok": static_ok, "refs_checked": len(refs) if not problems else 0,
                   "problems": problems},
        "live": {"ok": harness_ok, "detail": msg, "ledger": json_file if os.path.exists(json_file) else None},
        "gate": "pass" if static_ok and harness_ok else "fail",
    }

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)
        print(f"\n  report: {args.json}")

    if not static_ok:
        print("\nFAIL: broken references in the audit document")
        return 1
    if not harness_ok:
        print("\nFAIL: live matrix has failing legs")
        return 1
    print("\nALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())