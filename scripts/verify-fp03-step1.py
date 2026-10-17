#!/usr/bin/env python3
"""Automate FP-03 Step 1 verification (`exemplars.source` + real-classifier config keys).

Covers PLAN Step 1 Verify: "migration 0024 applies clean, the `source` column lands with the
right default, the four config keys land with the right jsonb types, RLS deltas are exactly
zero, and the classifier still reads `stub`".

  AUTOMATED -- static (no network):
    migration   : `0024_*.sql` exists and contains the `exemplars.source` alter + the four
                  config keys, and touches NO policy and NO schema other than that one column
                  (the PLAN's "no other schema change")
    registry    : TECH-SPEC §3.3 shows the column; TECH-SPEC §11 + GLOSSARY §16 hold the four
                  keys; GLOSSARY §11's `exemplars` row records the tag
    untouched   : TECH-SPEC §3.3's `embedding vector(768) not null` is unchanged

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE, and 0024 applied; the user JWT is minted
  if unset):
    config      : the four rows exist with the right JSON types/values (`classifier_mode` a
                  string, the other three numbers) -- a stringified number would break
                  `getConfigNumber` at runtime, so the type is asserted, not just presence
    exemplars   : a `select` naming `source` succeeds for authenticated (the column exists)
                  and zero rows are returned; an `anon` select is denied
    RLS delta   : an authenticated insert is denied (0006's read-only grant is intact)
    default     : a service-role probe insert that omits `source` reads back
                  `'PLACEHOLDER-DEV'` (the default proven, not assumed), then is deleted
    constraints : a bad `set_kind` is rejected and a missing `embedding` is rejected -- i.e.
                  0006's check + not-null survived the alter

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DAVOS_USER_JWT="<optional; a fresh one is minted if unset>"
  python scripts/verify-fp03-step1.py [--static-only] [--run-jest]

PREREQUISITES: migration 0024 applied (`supabase db push`) and the linked project reachable.
The live section writes exactly one probe row and deletes it in a `finally`; it changes no
config. `--static-only` runs the offline half alone (it is the half that is meaningful before
0024 is applied).
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + name + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def info(label, value):
    print(f"  ..   {label}: {value}")


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

CONFIG_KEYS = {
    "classifier_mode": ("string", "stub"),
    "quit_signal_threshold": ("number", 0.75),
    "energy_exhausted_max": ("number", 3),
    "energy_determined_min": ("number", 8),
}


def read_text(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def req(method, path, body=None, key=None, headers=None, timeout=60):
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
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, (json.loads(raw) if raw else None)
        except Exception:  # noqa: BLE001
            return e.code, {"raw": raw}


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------


def static_checks(run_jest=False):
    print("== A. static (no network) ==")

    migs = [
        n
        for n in os.listdir(os.path.join(ROOT, "supabase", "migrations"))
        if n.startswith("0024") and n.endswith(".sql")
    ]
    check("0024 migration exists (exactly one)", len(migs) == 1, f"{migs}")
    if len(migs) != 1:
        return
    mig_rel = f"supabase/migrations/{migs[0]}"
    info("migration", mig_rel)
    body = read_text(mig_rel) or ""

    check(
        "0024 adds exemplars.source with the PLACEHOLDER-DEV default",
        "alter table exemplars" in body.lower()
        and re.search(r"add column if not exists source text not null default 'PLACEHOLDER-DEV'", body, re.I) is not None,
    )
    for key, (kind, value) in CONFIG_KEYS.items():
        literal = f"'{value}'" if kind == "number" else f'\'"{value}"\''
        check(f"0024 seeds {key} as {literal}", re.search(rf"\('{re.escape(key)}',\s*{re.escape(literal)}", body) is not None)

    # The PLAN's "no other schema change": no policy DDL at all, and no table other than
    # `exemplars` is altered / created / dropped.
    check("0024 touches no policy", re.search(r"\b(create|alter|drop)\s+policy\b", body, re.I) is None)
    check("0024 creates/drops no table or index", re.search(r"\b(create|drop)\s+(table|index)\b", body, re.I) is None)
    other_alters = [m for m in re.findall(r"alter\s+table\s+(\w+)", body, re.I) if m.lower() != "exemplars"]
    check("0024 alters nothing but exemplars", not other_alters, f"{other_alters}")

    tech = read_text("docs/TECH-SPEC.md") or ""
    check(
        "TECH-SPEC §3.3 exemplars DDL carries the source column",
        re.search(r"source text not null default 'PLACEHOLDER-DEV'", tech) is not None,
    )
    check(
        "TECH-SPEC §3.3 embedding not-null is unchanged",
        "embedding vector(768) not null" in tech,
    )
    registry = tech.split("## 11. Config Registry", 1)[-1] if "## 11. Config Registry" in tech else ""
    missing = [k for k in CONFIG_KEYS if f"| `{k}` |" not in registry]
    check("TECH-SPEC §11 registry holds the four keys", not missing, f"missing {missing}")

    gloss = read_text("docs/GLOSSARY.md") or ""
    g_missing = [k for k in CONFIG_KEYS if f"`{k}`" not in gloss.split("## 16. Config Keys", 1)[-1]]
    check("GLOSSARY §16 lists the four keys", not g_missing, f"missing {g_missing}")
    check(
        "GLOSSARY §11 exemplars row records the source tag",
        re.search(r"\|\s*`exemplars`\s*\|[^\n]*`source`", gloss) is not None,
    )

    if run_jest:
        print("-- running jest (full suite) --")
        try:
            import shutil

            use_shell = os.name == "nt"
            if not use_shell and shutil.which("npx") is None:
                check("jest green", False, "SKIP: npx not on PATH")
            else:
                p = subprocess.run(
                    "npx jest --ci" if use_shell else ["npx", "jest", "--ci"],
                    cwd=ROOT,
                    capture_output=True,
                    text=True,
                    timeout=900,
                    shell=use_shell,
                    encoding="utf-8",
                    errors="replace",
                )
                out = (p.stdout or "") + (p.stderr or "")
                check("jest green", p.returncode == 0, out[-2000:])
        except Exception as e:  # noqa: BLE001
            check("jest green", False, str(e))


# ---------------------------------------------------------------------------
# B. live checks
# ---------------------------------------------------------------------------


def auth_headers():
    return {"Authorization": f"Bearer {JWT}"}


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
    print("== B. live (needs env; migration 0024 applied) ==")
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

    # --- config: presence AND json type (a stringified number breaks getConfigNumber) ---
    keys = ",".join(CONFIG_KEYS)
    st, rows = req("GET", f"/rest/v1/config?select=key,value&key=in.({keys})", key=SERVICE)
    check("config query ok", st == 200, f"{st}")
    got = {r["key"]: r["value"] for r in (rows or [])} if isinstance(rows, list) else {}
    for key, (kind, value) in CONFIG_KEYS.items():
        check(f"config has {key}", key in got)
        if key in got:
            actual_kind = "string" if isinstance(got[key], str) else ("number" if isinstance(got[key], (int, float)) else type(got[key]).__name__)
            check(f"config {key} is a JSON {kind} = {value!r}", actual_kind == kind and got[key] == value, f"got {got[key]!r}")

    # --- exemplars: column exists (authenticated read names `source`) ---
    st, rows = req("GET", "/rest/v1/exemplars?select=id,source&limit=1", key=ANON, headers=auth_headers())
    check("authenticated select of exemplars.source ok", st == 200, f"{st} {rows}")
    check("exemplars is empty pre-seed (0 rows)", isinstance(rows, list) and len(rows) == 0, f"{rows}")

    # --- anon is denied (0006 granted select to authenticated only) ---
    st, _ = req("GET", "/rest/v1/exemplars?select=id&limit=1", key=ANON)
    check("anon select of exemplars is denied", st not in (200, 206), f"{st}")

    # --- RLS delta: authenticated write is denied (no insert policy, no grant) ---
    probe_id = str(uuid.uuid4())
    vector = "[" + ",".join(["0"] * 768) + "]"
    valid = {"id": probe_id, "set_kind": "domain", "label": "AC-STEP1", "text": "AC-STEP1 probe", "embedding": vector}
    st, body = req("POST", "/rest/v1/exemplars", valid, key=ANON, headers={**auth_headers(), "Prefer": "return=representation"})
    check("authenticated insert of exemplars is denied", st not in (200, 201, 204), f"{st} {body}")

    try:
        # --- default proven: insert WITHOUT `source`, read it back ---
        created = None
        st, body = req(
            "POST",
            "/rest/v1/exemplars?select=id,source,set_kind",
            valid,
            key=SERVICE,
            headers={"Prefer": "return=representation"},
        )
        check("service-role insert ok", st in (200, 201), f"{st} {body}")
        if isinstance(body, list) and body:
            created = body[0]
            check("omitted source defaults to PLACEHOLDER-DEV", created.get("source") == "PLACEHOLDER-DEV", f"{created}")

        # --- constraints survived the alter ---
        bad_kind = {**valid, "id": str(uuid.uuid4()), "set_kind": "bogus"}
        st, _ = req("POST", "/rest/v1/exemplars", bad_kind, key=SERVICE)
        check("bad set_kind is rejected (check intact)", st not in (200, 201, 204), f"{st}")

        no_embedding = {"id": str(uuid.uuid4()), "set_kind": "domain", "label": "x", "text": "x"}
        st, _ = req("POST", "/rest/v1/exemplars", no_embedding, key=SERVICE)
        check("missing embedding is rejected (not-null intact)", st not in (200, 201, 204), f"{st}")
    finally:
        st, _ = req("DELETE", f"/rest/v1/exemplars?id=eq.{probe_id}", key=SERVICE)
        check("probe row cleaned up", st in (200, 204), f"{st}")
        st, rows = req("GET", f"/rest/v1/exemplars?select=id&id=eq.{probe_id}", key=SERVICE)
        check("exemplars back to 0 rows after cleanup", isinstance(rows, list) and len(rows) == 0, f"{rows}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--run-jest", action="store_true")
    args = ap.parse_args()

    static_checks(args.run_jest)
    if not args.static_only:
        if not all((URL, ANON, SERVICE)):
            print("  SKIP live section -- need SUPABASE_URL, SUPABASE_ANON_KEY, "
                  "SUPABASE_SERVICE_ROLE_KEY (the user JWT is minted automatically)")
        else:
            live_checks()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 1 checks passed.")


if __name__ == "__main__":
    main()
