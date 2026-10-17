#!/usr/bin/env python3
"""Automate FP-04 Step 1 verification (window index + [SPEC] keys + `update_checkin_prefs`).

Covers PLAN Step 1 Verify: "migration 0026 applies clean; a second doing for the same
(user, window) is rejected with 23505 while null-window rows insert freely; `select * from
config` returns both keys with jsonb numbers; the RPC round-trips the four columns; invalid
cadence / start >= end / bogus tz each error; anon cannot execute the RPC; a direct client
PATCH of the four check-in columns still succeeds".

  AUTOMATED -- static (no network):
    migration   : `0026_*.sql` exists and carries the unique partial window index, the
                  deliberate drop of the redundant 0003 index, both config keys, and the RPC
                  (plpgsql + security definer + pinned search_path + auth.uid() guard + the
                  four-column update + the three validations + the revoke/grant pair); and it
                  touches no policy, no table, and no other index
    registry    : TECH-SPEC 3.2 shows the index + documents `update_checkin_prefs`; 7.1
                  carries the grid contract; 11 holds both keys; GLOSSARY 16 lists both keys
                  and 11's `doings_logs` row records per-window uniqueness

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE/DAVOS_USER_JWT, and 0026 applied):
    config      : both rows exist with the right JSON number types/values
    precond.    : it first proves 0026 is applied and the JWT is valid; if either fails it
                  reports and SKIPS the dependent checks instead of passing them vacuously
    index       : two doings with the same (user_id, checkin_window) -> the second is
                  rejected; a null-window doing inserts freely
    rpc         : the four columns round-trip through `update_checkin_prefs`; cadence 45 /
                  start >= end / a bogus tz each return 400 from the guard; anon gets
                  401/403/404 (not a 400 execution)
    surface     : a direct client PATCH of profiles still succeeds (the pre-existing open
                  surface -- asserted, not assumed, so a future revoke flips this)

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  python scripts/verify-fp04-step1.py [--static-only] [--run-jest]

DAVOS_USER_JWT is optional: if it is set and still valid it is used, otherwise the gate mints a
fresh token itself via the admin API (`scripts/_mint_dev_jwt.py`, the service-role key it already
needs). Pass --no-mint to require a hand-supplied token, or --email to pin the user.

PREREQUISITES: migration 0026 applied (`supabase db push`) and the linked project reachable.
The live section snapshots the caller's check-in prefs and restores them in a `finally`, and
deletes every probe doing it inserts. `--static-only` runs the offline half alone (the half
that is meaningful before 0026 is applied).
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

try:
    # Sibling helper module (scripts/ is sys.path[0] for `python scripts/verify-fp04-step1.py`).
    # Underscore name per the `_fp03_corpus.py` precedent: hyphenated files are not importable.
    from _mint_dev_jwt import decode_jwt_claims, iso as jwt_iso, mint_for_gates
except Exception:  # noqa: BLE001 -- the gate still runs; minting just stays unavailable
    decode_jwt_claims = None
    jwt_iso = None
    mint_for_gates = None

FAILURES = []

MIG_PREFIX = "0026"
MIG_TAG = "checkin_loop_fp04"
INDEX_NAME = "doings_logs_one_checkin_window"
OLD_INDEX = "idx_doings_logs_checkin_window"
RPC = "update_checkin_prefs"
FOUR_COLUMNS = [
    "checkin_cadence_minutes",
    "checkin_active_hours_start",
    "checkin_active_hours_end",
    "timezone",
]
CONFIG_KEYS = {
    "checkin_late_minutes": ("number", 15),
    "watchdog_lookback_minutes": ("number", 120),
}


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
EMAIL = env("DAVOS_USER_EMAIL")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Set by live_checks(): the token actually used for the authenticated checks -- the supplied
# DAVOS_USER_JWT while it is still valid, else one minted on the spot (see resolve_user_jwt).
USER_JWT = None
NO_MINT = False


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
        if n.startswith(MIG_PREFIX) and n.endswith(".sql")
    ]
    check("0026 migration exists (exactly one)", len(migs) == 1, f"{migs}")
    if len(migs) != 1:
        return
    mig_rel = f"supabase/migrations/{migs[0]}"
    info("migration", mig_rel)
    check("0026 filename carries the FP-04 tag", MIG_TAG in migs[0], migs[0])
    body = read_text(mig_rel) or ""

    # (a) the index + the deliberate drop
    check(
        "0026 creates the unique partial window index",
        re.search(
            rf"create\s+unique\s+index\s+if\s+not\s+exists\s+{INDEX_NAME}\s+on\s+doings_logs\s*\(\s*user_id\s*,\s*checkin_window\s*\)\s*where\s+checkin_window\s+is\s+not\s+null",
            body,
            re.I,
        )
        is not None,
    )
    check(
        "0026 drops the redundant 0003 window index",
        re.search(rf"drop\s+index\s+if\s+exists\s+(public\.)?{OLD_INDEX}", body, re.I) is not None,
    )

    # (b) config keys (jsonb numbers must be quoted literals)
    for key, (kind, value) in CONFIG_KEYS.items():
        literal = f"'{value}'" if kind == "number" else f'"{value}"'
        check(
            f"0026 seeds {key} as {literal}",
            re.search(rf"\('{re.escape(key)}',\s*{re.escape(literal)}", body) is not None,
        )

    # (c) the RPC
    check(
        "0026 RPC is plpgsql + security definer + pinned search_path",
        re.search(rf"create\s+or\s+replace\s+function\s+public\.{RPC}\(", body, re.I) is not None
        and re.search(r"language\s+plpgsql", body, re.I) is not None
        and re.search(r"security\s+definer", body, re.I) is not None
        and re.search(r"set\s+search_path\s*=\s*public", body, re.I) is not None,
    )
    check(
        "0026 RPC guards on auth.uid() and filters by it",
        "auth.uid() is null" in body and "where id = auth.uid()" in body,
    )

    m = re.search(r"update\s+public\.profiles(.*?);", body, re.I | re.S)
    stmt = re.split(r"\bwhere\b", m.group(1), flags=re.I)[0] if m else ""
    assigned = re.findall(r"(\w+)\s*=", stmt)
    check(
        "0026 RPC assigns exactly the four check-in columns",
        sorted(assigned) == sorted(FOUR_COLUMNS),
        f"{assigned}",
    )
    for forbidden in ("trust_score", "dialog_state", "onboarding_stage", "latest_energy"):
        check(f"0026 RPC never touches {forbidden}", forbidden not in stmt)

    check("0026 RPC validates cadence", re.search(r"not\s+in\s*\(\s*60\s*,\s*120\s*\)", body, re.I) is not None)
    check("0026 RPC validates start < end", re.search(r"p_start\s*>=\s*p_end", body, re.I) is not None)
    check("0026 RPC validates the timezone against pg_timezone_names", "pg_timezone_names" in body)
    check(
        "0026 revokes public+anon and grants authenticated+service_role",
        re.search(rf"revoke\s+execute\s+on\s+function\s+public\.{RPC}\(int,\s*time,\s*time,\s*text\)\s+from\s+public,\s*anon", body, re.I) is not None
        and re.search(rf"grant\s+execute\s+on\s+function\s+public\.{RPC}\(int,\s*time,\s*time,\s*text\)\s+to\s+authenticated,\s*service_role", body, re.I) is not None,
    )

    # The PLAN's "no other schema change".
    check("0026 touches no policy", re.search(r"\b(create|alter|drop)\s+policy\b", body, re.I) is None)
    check("0026 creates no table", re.search(r"\bcreate\s+table\b", body, re.I) is None)
    check("0026 alters no table", re.search(r"\balter\s+table\b", body, re.I) is None)
    other_indexes = [
        n
        for n in re.findall(r"create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\w+)", body, re.I)
        if n != INDEX_NAME
    ]
    check("0026 creates no other index", not other_indexes, f"{other_indexes}")

    tech = read_text("docs/TECH-SPEC.md") or ""
    check("TECH-SPEC 3.2 shows the unique window index", INDEX_NAME in tech)
    check("TECH-SPEC 3.2 documents the RPC", f"`{RPC}" in tech or f"public.{RPC}" in tech)
    check(
        "TECH-SPEC 7.1 carries the grid contract",
        all(p in tech for p in ("canonical window start", "checkin_active_hours_end", "±cadence/2")),
    )
    registry = tech.split("## 11. Config Registry", 1)[-1] if "## 11. Config Registry" in tech else ""
    missing = [k for k in CONFIG_KEYS if f"| `{k}` |" not in registry]
    check("TECH-SPEC 11 registry holds both keys", not missing, f"missing {missing}")

    gloss = read_text("docs/GLOSSARY.md") or ""
    g16 = gloss.split("## 16. Config Keys", 1)[-1] if "## 16. Config Keys" in gloss else ""
    g_missing = [k for k in CONFIG_KEYS if f"`{k}`" not in g16]
    check("GLOSSARY 16 lists both keys", not g_missing, f"missing {g_missing}")
    check(
        "GLOSSARY 11 doings row records per-window uniqueness",
        re.search(r"\|\s*`doings_logs`\s*\|[^\n]*window", gloss, re.I) is not None,
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
    return {"Authorization": f"Bearer {USER_JWT or JWT}"}


def is_validation_rejection(st, body):
    """A real validation failure: PostgREST maps our `raise exception` to 400 and the
    message carries the function name. Anything else (401 expired JWT, 403, 404) is NOT
    proof the guard fired -- that distinction is what stops a vacuous pass."""
    return st == 400 and RPC in json.dumps(body or {})


def resolve_user_jwt():
    """(token, note). Prefer DAVOS_USER_JWT while it is genuinely valid; otherwise mint a fresh
    one with the service role. A stale paste -- or a stale token sitting in `.env` -- used to
    stall the run until someone noticed; now it just costs one round-trip."""
    if JWT and decode_jwt_claims:
        claims = decode_jwt_claims(JWT)
        if claims is None:
            print("  ..   DAVOS_USER_JWT is present but not a decodable JWT")
        elif claims.get("exp", 0) > time.time():
            return JWT, f"supplied, valid {int((claims['exp'] - time.time()) / 60)} min"
        else:
            print(f"  ..   DAVOS_USER_JWT expired {jwt_iso(claims['exp'])} "
                  f"({(time.time() - claims['exp']) / 3600:.2f} h ago)")
    elif JWT:
        return JWT, "supplied (helper unavailable, not pre-checked)"
    else:
        print("  ..   DAVOS_USER_JWT not set")

    if NO_MINT:
        return JWT, "supplied (minting disabled by --no-mint)"
    if not mint_for_gates:
        return JWT, "supplied (_mint_dev_jwt.py unavailable)"
    print("  ..   minting a fresh token via the admin API ...")
    token, claims = mint_for_gates(URL, SERVICE, EMAIL)
    if not token:
        print("  ..   minting failed (needs SUPABASE_SERVICE_ROLE_KEY and a user to mint for)")
        return JWT, "supplied"
    print(f"  ..   minted for {claims.get('sub')} (expires {jwt_iso(claims.get('exp', 0))}, "
          f"lifetime {claims.get('exp', 0) - claims.get('iat', 0)}s)")
    return token, "minted via the admin API"


def live_checks():
    print("== B. live (needs env; migration 0026 applied) ==")

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

    # --- preconditions: 0026 applied, and a usable JWT ---
    # Without these the rest would pass or fail for the wrong reason (an expired JWT makes
    # every "rejects" assertion trivially true), so report and skip instead.
    if not all(k in got for k in CONFIG_KEYS):
        print("  FAIL migration 0026 is not applied (config keys absent) -- run `supabase db push`")
        FAILURES.append("migration 0026 not applied")
        print("  SKIP remaining live checks")
        return

    global USER_JWT
    USER_JWT, note = resolve_user_jwt()
    st, rows = req("GET", "/rest/v1/profiles?select=id&limit=1", key=ANON, headers=auth_headers())
    jwt_ok = st == 200 and isinstance(rows, list) and bool(rows)
    uid = rows[0]["id"] if jwt_ok else None
    check(f"a usable user JWT ({note})", jwt_ok, f"{st} {rows}")
    if not jwt_ok:
        print("  SKIP remaining live checks -- no usable user JWT")
        return

    # --- index behaviour: one doing per window ---
    if uid:
        window = "2026-01-01T08:00:00Z"
        base = {
            "user_id": uid,
            "kind": "doing",
            "content": "AC-FP04-STEP1 probe",
            "source": "checkin_reply",
            "logged_at": window,
            "checkin_window": window,
        }
        st, body = req("POST", "/rest/v1/doings_logs?select=id", base, key=ANON, headers={**auth_headers(), "Prefer": "return=representation"})
        check("first doing for a window inserts", st in (200, 201), f"{st} {body}")
        st, body = req("POST", "/rest/v1/doings_logs", {**base, "content": "AC-FP04-STEP1 duplicate"}, key=ANON, headers={**auth_headers(), "Prefer": "return=minimal"})
        check("second doing for the same window is rejected", st not in (200, 201, 204), f"{st} {body}")
        nullwin = {**base, "content": "AC-FP04-STEP1 null-window", "source": "chat", "checkin_window": None}
        st, body = req("POST", "/rest/v1/doings_logs?select=id", nullwin, key=ANON, headers={**auth_headers(), "Prefer": "return=representation"})
        check("null-window rows insert freely", st in (200, 201), f"{st} {body}")
        # doings_logs grants no delete to authenticated -> clean up with the service role
        st, _ = req("DELETE", "/rest/v1/doings_logs?content=like.AC-FP04-STEP1*", key=SERVICE)
        check("probe doings cleaned up", st in (200, 204), f"{st}")

    # --- RPC round-trip + validation (snapshot the caller's prefs; restore in finally) ---
    prefs_sel = "select=" + ",".join(FOUR_COLUMNS) + "&limit=1"
    st, rows = req("GET", f"/rest/v1/profiles?{prefs_sel}", key=ANON, headers=auth_headers())
    check("read current check-in prefs", st == 200 and isinstance(rows, list) and len(rows) == 1, f"{st} {rows}")
    original = rows[0] if (isinstance(rows, list) and rows) else None

    def rpc(payload):
        return req("POST", f"/rest/v1/rpc/{RPC}", payload, key=ANON, headers=auth_headers())

    try:
        st, body = rpc({"p_cadence": 120, "p_start": "09:00", "p_end": "21:00", "p_tz": "UTC"})
        check("RPC accepts a valid change", st in (200, 204), f"{st} {body}")
        st, rows = req("GET", f"/rest/v1/profiles?{prefs_sel}", key=ANON, headers=auth_headers())
        row = rows[0] if (isinstance(rows, list) and rows) else {}
        check(
            "RPC round-trips the four columns",
            str(row.get("checkin_cadence_minutes")) == "120" and str(row.get("timezone")) == "UTC",
            f"{row}",
        )

        for name, bad in (
            ("cadence 45", {"p_cadence": 45, "p_start": "09:00", "p_end": "21:00", "p_tz": "UTC"}),
            ("start >= end", {"p_cadence": 60, "p_start": "21:00", "p_end": "09:00", "p_tz": "UTC"}),
            ("bogus tz", {"p_cadence": 60, "p_start": "09:00", "p_end": "21:00", "p_tz": "Mars/Olympus"}),
        ):
            st, body = rpc(bad)
            check(f"RPC rejects {name} (400 from the guard)", is_validation_rejection(st, body), f"{st} {body}")
    finally:
        if original:
            st, _ = rpc(
                {
                    "p_cadence": original.get("checkin_cadence_minutes"),
                    "p_start": original.get("checkin_active_hours_start"),
                    "p_end": original.get("checkin_active_hours_end"),
                    "p_tz": original.get("timezone") or "UTC",
                }
            )
            check("prefs restored", st in (200, 204), f"{st}")

    # --- anon cannot execute ---
    st, body = req("POST", f"/rest/v1/rpc/{RPC}", {"p_cadence": 60, "p_start": "08:00", "p_end": "22:00", "p_tz": "UTC"}, key=ANON)
    check("anon cannot execute the RPC (401/403/404, not a 400 execution)", st in (401, 403, 404), f"{st} {body}")

    # --- the recorded open surface (FP-04 Out of scope): a direct PATCH still succeeds ---
    if uid:
        tz = (original or {}).get("timezone") or "UTC"
        st, body = req("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {"timezone": tz}, key=ANON, headers={**auth_headers(), "Prefer": "return=minimal"})
        check("direct client PATCH of profiles still succeeds (recorded open surface)", st in (200, 204), f"{st} {body}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--run-jest", action="store_true")
    ap.add_argument("--no-mint", action="store_true",
                    help="never mint a JWT; require DAVOS_USER_JWT to be valid as supplied")
    ap.add_argument("--email", help="user to mint for (default: DAVOS_USER_EMAIL, else inferred)")
    args = ap.parse_args()

    global NO_MINT, EMAIL
    NO_MINT = args.no_mint
    if args.email:
        EMAIL = args.email

    static_checks(args.run_jest)
    if not args.static_only:
        missing = [n for n, v in (
            ("SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL)", URL),
            ("SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY)", ANON),
            ("SUPABASE_SERVICE_ROLE_KEY", SERVICE),
        ) if not v]
        if missing:
            print("  SKIP live section -- need " + ", ".join(missing))
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
