#!/usr/bin/env python3
"""Automate FP-04 Step 2 verification (the `submit-checkin` function + the twin grid modules).

Covers PLAN Step 2 Verify: "POST stores a doing with energy parsed from the text and one
embedding; a repeat submit (and a shifted-window replay) returns `duplicate` with zero new
embeds; PATCH sets energy on an own row only; window rejections return their named codes;
`deno check` and the grid unit tests are green".

  AUTOMATED -- static (no network):
    files       : the pure/IO split exists (`_shared/checkin/windows.ts` and `parseEnergy.ts`
                  import nothing at all; `loadGrid.ts` owns the service client); the frozen
                  fixture exists; the two jest-discovered `.test.ts` suites exist; no
                  `submit-checkin/config.toml` (verify_jwt default is the contract)
    function    : CORS is byte-identical to the §7.10 four headers *plus* PATCH in the method
                  list; OPTIONS -> 204; only POST/PATCH allowed; resolveUserId; the config cap
                  read at runtime; every body field validated; `loadGrid` + `canonicalizeWindow`
                  used; the duplicate select precedes `embed` (the FR-8 zero-embed order); the
                  insert carries the eight columns with `logged_at` = the window close; 23505
                  re-selects; the FR-5 response keys are exactly the frozen five; no `messages`
                  write (FR-9); no `generate()` (no LLM text on this path); no provider SDK
                  import
    patch       : own-row gate (foreign id -> 404, never 403) + the `user_id` filter on the
                  write + integer 1-10 validation
    types/tests : `deno check` on the entry point and the four check-in modules is clean; jest
                  reports the two new suites PASS with 0 failures (and still >= 11 suites)
    registry    : TECH-SPEC 7.1 (module split, `logged_at` = window close, fixture home, the 503
                  embed contract, the PATCH CORS clause) and 3.2; GLOSSARY 13; the FP-04 docs

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE + a user JWT, and `submit-checkin`
  DEPLOYED):
    precond.    : 0026 is applied, the JWT is valid, and the function is deployed (a 404 fails
                  loudly and SKIPs the function legs instead of passing them vacuously)
    grid        : temporarily pins cadence 60 / 08:00-22:00 / UTC so the gate can compute
                  expected windows itself; restores the caller's prefs AND `latest_energy` in a
                  `finally`, and deletes every probe doing
    submit      : POST -> `ok`, energy parsed (4), `eval_ran`/`intervention` false; the row
                  carries source/energy/checkin_window/logged_at(close)/embedding/embed_model
    duplicate   : a second POST for the same window, sent with a SHIFTED hint, returns
                  `duplicate` with the SAME doing_id and leaves exactly one row
    rejections  : malformed / future / stale / off-grid each return their named 400 `error`
    chat path   : `capture:"chat"` stores `source='chat'` and a null energy (no trailing int)
    patch       : PATCH -> energy 7 on an own row; a foreign user's doing -> 404; bad energies
                  -> 400
    surface     : a direct client INSERT/UPDATE of `doings_logs` still succeeds (the recorded
                  pre-existing open surface -- asserted, not assumed, so a future revoke flips it)
    cors        : OPTIONS allows PATCH; an unauthenticated POST -> 401; PUT -> 405

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  python scripts/verify-fp04-step2.py [--static-only] [--run-jest] [--logs <file>]

DAVOS_USER_JWT is optional: if it is set and still valid it is used, otherwise the gate mints a
fresh token itself via the admin API (`scripts/_mint_dev_jwt.py`). Either way the run PRINTS the
token it will send -- source, `sub`, `exp`, a plain verdict and the raw token -- so an
`expired JWT` 401 is never a mystery. Pass --no-mint to require a hand-supplied token, or
--email to pin the user. A token already decoded as expired is never sent; the gate skips.
A token that decodes valid but is refused by the Edge gateway (401 "Invalid or expired token")
is re-minted once and retried -- see below.

Beware the misleading gateway message: a decodable, unexpired token can still be rejected
(the observed case was a Google-OAuth session token in `.env`: PostgREST accepted it, the Edge
gateway did not). The run prints which token each request actually carried, so that is visible.

--logs <file> adds the FR-8 zero-embed leg: export the run's function log (e.g.
`supabase functions logs submit-checkin > run.log`) and the gate asserts that the number of
`"requestId":"embed"` lines equals the number of `outcome:"ok"` submits -- i.e. one embed per
stored doing and none for the duplicates. Without the file the leg SKIPs (the static
source-order assertion still covers the ordering).

PREREQUISITES: `supabase functions deploy submit-checkin` and migration 0026 applied.
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

try:
    # Sibling helper module (scripts/ is sys.path[0] for `python scripts/verify-fp04-step2.py`).
    from _mint_dev_jwt import resolve_gate_token
except Exception:  # noqa: BLE001 -- the gate still runs; token resolution then falls back
    resolve_gate_token = None

FAILURES = []

FN_DIR = "supabase/functions/submit-checkin"
FN_REL = f"{FN_DIR}/index.ts"
CHECKIN_DIR = "supabase/functions/_shared/checkin"
FN_URL = "/functions/v1/submit-checkin"
PROBE = "FP04S2-PROBE"

# The grid the gate pins for the live run, so it can compute expected windows in Python.
# 08:00-22:00 cadence 60 in UTC: starts 08:00..21:00, the last one closing exactly at 22:00.
GRID_CADENCE_MIN = 60
GRID_START_MIN = 8 * 60
GRID_END_MIN = 22 * 60

RESPONSE_KEYS = {"status", "doing_id", "energy", "eval_ran", "intervention"}
CORS_HEADERS = "Content-Type, Authorization, apikey, x-client-info"


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


def deno_check(rels):
    """`deno check` a set of entry points. Returns (ok, output)."""
    try:
        import shutil

        if shutil.which("deno") is None:
            return None, "deno not on PATH"
        p = subprocess.run(
            ["deno", "check"] + rels,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=600,
            encoding="utf-8",
            errors="replace",
        )
        return p.returncode == 0, (p.stdout or "") + (p.stderr or "")
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def jest_check():
    """Full jest suite. Returns (ok, output). Needs >= 11 suites and 0 failures."""
    try:
        import shutil

        use_shell = os.name == "nt"
        if not use_shell and shutil.which("npx") is None:
            return None, "npx not on PATH"
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
        return p.returncode == 0, (p.stdout or "") + (p.stderr or "")
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def static_checks(run_deno=True, run_jest=False):
    print("== A. static (no network) ==")

    fn = read_text(FN_REL)
    check("submit-checkin/index.ts exists", fn is not None)
    if fn is None:
        return
    check(
        "no submit-checkin/config.toml (verify_jwt default is the contract)",
        not os.path.exists(os.path.join(ROOT, FN_DIR, "config.toml")),
    )

    pure = {
        "windows.ts": read_text(f"{CHECKIN_DIR}/windows.ts"),
        "parseEnergy.ts": read_text(f"{CHECKIN_DIR}/parseEnergy.ts"),
    }
    loader = read_text(f"{CHECKIN_DIR}/loadGrid.ts")
    fixture = read_text(f"{CHECKIN_DIR}/windows.fixture.ts")
    check("the four check-in modules exist", all(pure.values()) and loader and fixture)
    for name, src in pure.items():
        check(f"{name} is pure (imports nothing)", src is not None and not re.search(r"^\s*import\b", src, re.M))
    check(
        "loadGrid.ts owns the service client (the IO half)",
        loader is not None and "supabaseService" in loader and "profiles" in loader,
    )
    check(
        "loadGrid.ts reads the four grid columns",
        loader is not None
        and all(c in loader for c in ("timezone", "checkin_cadence_minutes",
                                      "checkin_active_hours_start", "checkin_active_hours_end")),
    )
    check(
        "loadGrid.ts is fail-closed on an unusable row (null, never a guess)",
        loader is not None and "return null" in loader,
    )
    check(
        "the fixture is the shared twin table (one file, both sides)",
        fixture is not None and "WINDOW_DAYS" in fixture and "WINDOW_HINTS" in fixture,
    )
    for needle, label in (
        ("Asia/Kolkata", "a UTC+5:30 axis"),
        ("2026-03-08", "the spring-forward date"),
        ("2026-11-01", "the fall-back date"),
        ("America/New_York", "a DST zone"),
    ):
        check(f"the fixture carries {label}", needle in (fixture or ""))

    for suite in ("windows.test.ts", "parseEnergy.test.ts"):
        check(f"{suite} exists (jest-discovered, .test.ts per bands.test.ts)", read_text(f"{CHECKIN_DIR}/{suite}") is not None)

    # --- the pure grid contract
    win = pure["windows.ts"] or ""
    check("windows.ts owns window generation", "export function windowsForLocalDay" in win)
    check("windows.ts owns canonicalization", "export function canonicalizeWindow" in win)
    check("windows.ts exports the Step 6 scan", "export function windowsClosedBetween" in win)
    for reason in ("window_malformed", "window_future", "window_stale", "window_off_grid"):
        check(f"windows.ts names the {reason} rejection", reason in win)
    check("the no-overnight rule is a wall-clock comparison", "label + cadence <= endMin" in win)
    check("the tolerance is inclusivity-preserving (<= cadence/2)", "tolerance" in win and "bestDistance > tolerance" in win)
    check(
        "a non-existent local label is skipped, not invented",
        "if (ms === null) continue" in win,
    )
    check("the grid never leaves local wall time for epoch hours", "hourCycle" in win and "timeZone: timezone" in win)

    # --- the function
    check("CORS allows exactly the four §7.10 headers", f'"Access-Control-Allow-Headers": "{CORS_HEADERS}"' in fn)
    check('CORS origin is "*"', '"Access-Control-Allow-Origin": "*"' in fn)
    m = re.search(r'"Access-Control-Allow-Methods":\s*"([^"]+)"', fn)
    methods = (m.group(1) if m else "")
    check("CORS preflight allows POST and PATCH", "POST" in methods and "PATCH" in methods, methods)
    check("OPTIONS answers 204", re.search(r'OPTIONS"\)\s*\{\s*return new Response\(null, \{ status: 204', fn) is not None)
    check(
        "only POST and PATCH are served (405 otherwise)",
        re.search(r'if \(req\.method !== "POST" && req\.method !== "PATCH"\)', fn) is not None,
    )
    check("the user is resolved, never trusted from the body", "resolveUserId(req)" in fn)
    check(
        "the [SPEC] cap is read from config at runtime (§2)",
        'getConfigNumber("chat_max_message_chars")' in fn and "8000" not in fn,
    )
    for field in ("content", "capture", "windowTs", "client_message_id", "doing_id", "energy"):
        check(f"the body's `{field}` is validated", f"body.{field}" in fn)
    check("`capture` must be reply|chat", '"capture must be' in fn)
    check("`client_message_id` is validated but unused (Step 3b consumes it)", "UUID_RE.test(body.client_message_id)" in fn)

    # --- FR-8 ordering: the duplicate select precedes the embed
    dup_at = fn.find("findDoingForWindow(userId, windowIso)")
    embed_at = fn.find("await embed(")
    check(
        "the duplicate check precedes the embed (FR-8: a repeat costs zero embeds)",
        dup_at != -1 and embed_at != -1 and dup_at < embed_at,
        f"dup@{dup_at} embed@{embed_at}",
    )
    check("`embed` goes through the provider adapter (AGENTS §3.5)", 'from "../_shared/llm/adapter.ts"' in fn)
    check("exactly one embed call site", len(re.findall(r"await embed\(", fn)) == 1)
    check("maintains `gemini-embedding-001@768` on the row", "embed_model: embedded.data.model" in fn)
    check(
        "an embed failure stores nothing and asks for a replay (503)",
        "embed_unavailable" in fn and '"embed_unavailable"' in fn and "503" in fn,
    )
    check(
        "the on-track path never generates LLM text (no `generate()`)",
        "generate(" not in fn and "adapter.ts" in fn,
    )
    check(
        "no provider SDK is imported into feature code (AGENTS §3.5)",
        not re.search(r"npm:@google|groq", fn, re.I),
    )
    check("canonicalization is server-side (FR-5)", "canonicalizeWindow(grid, hintMs, nowMs)" in fn)
    check("the grid comes from loadGrid, not the request", "await loadGrid(userId)" in fn)
    check("an unusable grid is a 500, never a guess", "no usable grid" in fn)

    # --- the insert
    ins = re.search(r'from\("doings_logs"\)\s*\.insert\(\{(.*?)\}\)', fn, re.S)
    # Keys are written both fully (`user_id: userId`) and in shorthand (`content`, `energy`,
    # `source`), so match the key at the start of a line followed by either separator.
    cols = re.findall(r"^\s*(\w+)\s*[:,]", ins.group(1), re.M) if ins else []
    for col in ("user_id", "kind", "content", "energy", "source", "logged_at", "checkin_window", "embedding", "embed_model"):
        check(f"the insert sets `{col}`", col in cols, f"{cols}")
    check("kind is 'doing'", 'kind: "doing"' in fn)
    check("logged_at is the canonical window CLOSE (not the submit instant)", "logged_at: new Date(window.closeMs).toISOString()" in fn)
    check("checkin_window stores the canonical window START", "checkin_window: windowIso" in fn)
    check("the vector is the adapter's own output", "embedding: embedded.data.embeddings[0]" in fn)
    check("23505 re-selects the winner instead of failing", '.code === "23505"' in fn and "findDoingForWindow(userId, windowIso)" in fn.split('"23505"')[-1])
    check("the source map is used, not a literal", "sourceForCapture(capture" in fn)
    check("energy comes from the text parse", "parseEnergy(content)" in fn)

    # --- the frozen response shape
    for key in sorted(RESPONSE_KEYS):
        check(f"the FR-5 response carries `{key}`", f"{key}:" in fn)
    check("eval_ran and intervention are structurally false in Step 2", "eval_ran: false" in fn and "intervention: false" in fn)
    check("FR-9: on-track writes no `messages` row", 'from("messages")' not in fn)

    # --- PATCH
    check(
        "PATCH 404s a foreign id (never 403, so it leaks nothing)",
        "data.user_id !== userId" in fn and "doing not found" in fn,
    )
    check("the PATCH write is filtered by user_id (defence in depth)", re.search(r'\.update\(\{ energy \}\)\s*\.eq\("id", doingId\)\s*\.eq\("user_id", userId\)', fn) is not None)
    check(
        "PATCH validates an integer 1-10",
        "Number.isInteger(energy)" in fn and "energy < 1" in fn and "energy > 10" in fn,
    )
    check("`latest_energy` is maintained", "latest_energy: energy" in fn)
    check(
        "the `latest_energy` write is non-fatal (the doing is already committed)",
        re.search(r"async function setLatestEnergy[\s\S]*?\n\}", fn) is not None
        and "throw" not in re.search(r"async function setLatestEnergy[\s\S]*?\n\}", fn).group(0),
    )
    check("no `trust_score` ever leaves the server (§4.7)", "trust_score" not in fn)

    # --- registry / docs
    tech = read_text("docs/TECH-SPEC.md") or ""
    gloss = read_text("docs/GLOSSARY.md") or ""
    plan = read_text("docs/feature-prds/FP-04/FP-04-PLAN.md") or ""
    fprd = read_text("docs/feature-prds/FP-04/FP-04.md") or ""
    check("TECH-SPEC 7.1 documents the pure/IO module split", "_shared/checkin/windows.ts" in tech and "loadGrid.ts" in tech)
    check("TECH-SPEC 3.2 fixes `logged_at` at the canonical window close", "canonical window close" in tech)
    check("TECH-SPEC 7.1 names the fixture as the shared twin table", "windows.fixture.ts" in tech)
    check("TECH-SPEC 7.1 documents the 503 embed contract", "embed_unavailable" in tech)
    check("TECH-SPEC 7.10 records this function's PATCH method", "submit-checkin" in tech)
    check("GLOSSARY 13 documents submit-checkin", "submit-checkin" in gloss)
    step2 = plan.split("## Step 2", 1)[-1].split("## Step 3", 1)[0] if "## Step 2" in plan else ""
    check(
        "the FP-04 plan's Step 2 records the config.toml correction (`index.ts` only)",
        "`index.ts` **only** — no `config.toml`" in step2,
    )
    check("FP-04 records the doings_logs client-write surface out of scope", "doings_logs" in fprd and "Out of scope" in fprd)

    if run_deno:
        print("-- running deno check --")
        ok, out = deno_check(
            [
                FN_REL,
                f"{CHECKIN_DIR}/windows.ts",
                f"{CHECKIN_DIR}/windows.fixture.ts",
                f"{CHECKIN_DIR}/parseEnergy.ts",
                f"{CHECKIN_DIR}/loadGrid.ts",
                f"{CHECKIN_DIR}/windows.test.ts",
                f"{CHECKIN_DIR}/parseEnergy.test.ts",
            ]
        )
        if ok is None:
            check("deno check clean", False, f"SKIP: {out}")
        else:
            check("deno check clean (entry point + four modules + both suites)", ok, out[-2000:])

    if run_jest:
        print("-- running jest (full suite) --")
        ok, out = jest_check()
        if ok is None:
            check("jest green", False, f"SKIP: {out}")
        else:
            suites = re.search(r"Test Suites:.*?(\d+) passed,\s*(\d+) total", out)
            tests = re.search(r"Tests:.*?(\d+) passed,\s*(\d+) total", out)
            n_suites = int(suites.group(1)) if suites else -1
            failed = int(suites.group(2)) - n_suites if suites else -1
            check("jest green", ok, out[-2000:])
            check("jest runs >= 11 suites with 0 failures", n_suites >= 11 and failed == 0, f"{n_suites} passed / {failed} failed")
            check("both check-in suites are discovered and pass", out.count("checkin/windows.test.ts") >= 1 and out.count("checkin/parseEnergy.test.ts") >= 1)
            info("jest tests", tests.group(0) if tests else "?")


# ---------------------------------------------------------------------------
# B. live checks
# ---------------------------------------------------------------------------


def auth_headers():
    return {"Authorization": f"Bearer {USER_JWT or JWT}"}


def resolve_user_jwt():
    """(token, usable, note). Delegates to the shared resolver, which prints exactly which token
    this run will send (source, sub, exp, verdict, the token itself) -- see
    `_mint_dev_jwt.resolve_gate_token`. It never hands back a token already known to be expired;
    when it cannot produce a usable one the gate skips its authenticated legs instead of
    collecting a wall of unexplained 401s."""
    if resolve_gate_token is None:
        print("  JWT   note   : _mint_dev_jwt.py unavailable -- using $DAVOS_USER_JWT as supplied")
        return JWT, bool(JWT), "supplied (helper unavailable, not pre-checked)"
    return resolve_gate_token(JWT, URL, SERVICE, EMAIL, allow_mint=not NO_MINT)


def iso(dt):
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def day_starts(day):
    """The grid's emitted starts for one UTC day, mirroring windowsForLocalDay's rule."""
    out = []
    m = GRID_START_MIN
    while m + GRID_CADENCE_MIN <= GRID_END_MIN:
        out.append(datetime.datetime.combine(day, datetime.time(m // 60, m % 60), tzinfo=datetime.timezone.utc))
        m += GRID_CADENCE_MIN
    return out


def all_starts(now_dt):
    starts = []
    for d in (-2, -1, 0, 1):
        starts += day_starts((now_dt + datetime.timedelta(days=d)).date())
    return starts


def min_distance_minutes(now_dt, t):
    return min(abs((s - t).total_seconds()) / 60.0 for s in all_starts(now_dt))


_POST_AS_USER = object()


def fn_post(body, jwt=_POST_AS_USER):
    """POST to the function as the check-in user, carrying the gate's resolved token.

    Pass `jwt=None` for the single deliberately unauthenticated call in the CORS/auth section
    (it asserts a 401). Anything else sends `USER_JWT` -- resolved after the gateway-probe
    retry, so every later call uses the token the function actually accepts."""
    if jwt is _POST_AS_USER:
        jwt = USER_JWT
    headers = {"Authorization": f"Bearer {jwt}"} if jwt else None
    return req("POST", FN_URL, body, key=ANON, headers=headers)


def fn_patch(body):
    return req("PATCH", FN_URL, body, key=ANON, headers=auth_headers())


def row_for_window(uid, window_iso):
    st, rows = req(
        "GET",
        "/rest/v1/doings_logs?select=id,content,source,energy,logged_at,embed_model,embedding"
        f"&user_id=eq.{uid}&checkin_window=eq.{window_iso}",
        key=SERVICE,
    )
    return (rows or []) if st == 200 and isinstance(rows, list) else None


def live_checks(logfile=None):
    print("== B. live (needs env; function deployed; migration 0026 applied) ==")

    # --- preconditions: 0026 applied, a valid JWT, the function deployed ---
    st, rows = req("GET", "/rest/v1/config?select=key&key=in.(checkin_late_minutes,watchdog_lookback_minutes)", key=SERVICE)
    if st != 200 or not isinstance(rows, list) or len(rows) != 2:
        print("  FAIL migration 0026 is not applied (config keys absent) -- run `supabase db push`")
        FAILURES.append("migration 0026 not applied")
        print("  SKIP remaining live checks")
        return

    global USER_JWT
    USER_JWT, jwt_usable, note = resolve_user_jwt()
    jwt_ok = False
    if jwt_usable:
        st, rows = req("GET", "/rest/v1/profiles?select=id&limit=1", key=ANON, headers=auth_headers())
        jwt_ok = st == 200 and isinstance(rows, list) and bool(rows)
        check(f"a usable user JWT ({note})", jwt_ok, f"{st} {rows}")
    else:
        check(f"a usable user JWT ({note})", False, note)
    if not jwt_ok:
        print("  SKIP remaining live checks -- no usable user JWT")
        return
    uid = rows[0]["id"]

    st, body = fn_post({}, jwt=USER_JWT)
    if st == 401 and resolve_gate_token is not None and not NO_MINT:
        # A token can decode as valid -- 7-day exp, accepted by PostgREST -- and still be
        # rejected here: the Edge gateway answers 401 "Invalid or expired token" for a token
        # PostgREST accepts (e.g. a revoked Google-OAuth session token). Never let that
        # masquerade as an expiry problem: mint a fresh one and retry once.
        print("  ..   the Edge gateway rejected the token (401) though it decodes valid -- "
              "minting a fresh one and retrying once")
        fresh, fresh_ok, _fresh_note = resolve_gate_token("", URL, SERVICE, EMAIL, allow_mint=True)
        if fresh_ok:
            USER_JWT = fresh
            st, body = fn_post({}, jwt=USER_JWT)
    if st == 404:
        print("  FAIL `submit-checkin` is not deployed -- run `supabase functions deploy submit-checkin`")
        FAILURES.append("submit-checkin not deployed")
        print("  SKIP remaining live checks")
        return
    check("the function is reachable and accepts the token (a body-less POST is a 400)", st == 400, f"{st} {body}")
    check("the body-less POST names the missing field", "content" in json.dumps(body or {}), f"{body}")

    # --- CORS + method + auth (no grid needed) ---
    st, _ = req(
        "OPTIONS",
        FN_URL,
        key=ANON,
        headers={
            "Origin": "https://example.com",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    check("OPTIONS preflight is 204", st == 204, f"{st}")
    st, _ = req("PUT", FN_URL, {}, key=ANON, headers=auth_headers())
    check("an unsupported verb is 405", st == 405, f"{st}")
    st, body = fn_post({"content": "hi", "capture": "reply", "windowTs": iso(datetime.datetime.now(datetime.timezone.utc))}, jwt=None)
    check("an unauthenticated POST is rejected by the gateway (401)", st == 401, f"{st} {body}")

    # --- pin a known grid so the gate can compute expected windows itself ---
    prefs_sel = "select=checkin_cadence_minutes,checkin_active_hours_start,checkin_active_hours_end,timezone,latest_energy&limit=1"
    st, rows = req("GET", f"/rest/v1/profiles?{prefs_sel}", key=ANON, headers=auth_headers())
    check("read the current check-in prefs", st == 200 and isinstance(rows, list) and len(rows) == 1, f"{st} {rows}")
    original = rows[0] if (isinstance(rows, list) and rows) else {}
    original_latest_energy = original.get("latest_energy")

    now_dt = datetime.datetime.now(datetime.timezone.utc)
    try:
        st, body = req(
            "POST",
            "/rest/v1/rpc/update_checkin_prefs",
            {"p_cadence": GRID_CADENCE_MIN, "p_start": "08:00", "p_end": "22:00", "p_tz": "UTC"},
            key=ANON,
            headers=auth_headers(),
        )
        check("pin the gate's grid (60 / 08:00-22:00 / UTC)", st in (200, 204), f"{st} {body}")

        # --- pick two free, already-closed windows (never touch a real user row) ---
        now_dt = datetime.datetime.now(datetime.timezone.utc)
        closed = [
            s
            for s in sorted(all_starts(now_dt), reverse=True)
            if s + datetime.timedelta(minutes=GRID_CADENCE_MIN) <= now_dt
            and now_dt - s <= datetime.timedelta(hours=23)
        ]
        free = []
        for s in closed:
            if len(free) >= 2:
                break
            if not row_for_window(uid, iso(s)):
                free.append(s)
        if len(free) < 2:
            print("  FAIL no free closed windows to probe (a real check-in occupies them?) -- SKIP")
            FAILURES.append("no free closed windows to probe")
            return
        w1, w2 = free[0], free[1]
        w1_iso, w2_iso = iso(w1), iso(w2)
        info("probe windows", f"{w1_iso} (close {iso(w1 + datetime.timedelta(minutes=GRID_CADENCE_MIN))}), {w2_iso}")

        # --- submit: one doing, energy from the text, one embed ---
        st, body = fn_post({"content": f"{PROBE} finished the report, drained 4", "capture": "reply", "windowTs": w1_iso})
        check("POST stores a check-in doing (200 ok)", st == 200 and isinstance(body, dict) and body.get("status") == "ok", f"{st} {body}")
        check("the FR-5 response shape is exactly the frozen five keys", isinstance(body, dict) and set(body.keys()) == RESPONSE_KEYS, f"{list((body or {}).keys())}")
        check("the energy is parsed from the text (4)", isinstance(body, dict) and body.get("energy") == 4, f"{body}")
        check("eval_ran is false in Step 2", isinstance(body, dict) and body.get("eval_ran") is False)
        check("intervention is false in Step 2", isinstance(body, dict) and body.get("intervention") is False)
        doing_id = (body or {}).get("doing_id")

        rows = row_for_window(uid, w1_iso)
        row = rows[0] if rows else {}
        check("exactly one row answers the window", len(rows or []) == 1, f"{len(rows or [])}")
        check("the row's source is checkin_reply", row.get("source") == "checkin_reply", f"{row.get('source')}")
        check("the row's energy is 4", row.get("energy") == 4, f"{row.get('energy')}")
        check("the row's content is the submitted text", PROBE in str(row.get("content")))
        check(
            "logged_at is the canonical window CLOSE",
            str(row.get("logged_at", "")).startswith(iso(w1 + datetime.timedelta(minutes=GRID_CADENCE_MIN))[:19]),
            f"{row.get('logged_at')} vs {iso(w1 + datetime.timedelta(minutes=GRID_CADENCE_MIN))}",
        )
        check("the row carries an embedding (one embed per doing)", row.get("embedding") is not None)
        check("embed_model is the frozen identity", row.get("embed_model") == "gemini-embedding-001@768", f"{row.get('embed_model')}")

        st, rows = req("GET", f"/rest/v1/profiles?select=latest_energy&limit=1", key=ANON, headers=auth_headers())
        check("profiles.latest_energy tracks the parsed energy", (rows or [{}])[0].get("latest_energy") == 4, f"{rows}")

        # --- duplicate: same window, SHIFTED hint, zero new rows ---
        shifted = iso(w1 + datetime.timedelta(minutes=4))
        st, body = fn_post({"content": f"{PROBE} replay with a shifted hint 9", "capture": "reply", "windowTs": shifted})
        check("a shifted-hint replay returns duplicate", st == 200 and isinstance(body, dict) and body.get("status") == "duplicate", f"{st} {body}")
        check("the duplicate returns the SAME doing_id", isinstance(body, dict) and body.get("doing_id") == doing_id, f"{body}")
        check("the duplicate echoes the stored (not the resubmitted) energy", isinstance(body, dict) and body.get("energy") == 4, f"{body}")
        check("the duplicate carries the frozen shape", isinstance(body, dict) and set(body.keys()) == RESPONSE_KEYS)
        rows = row_for_window(uid, w1_iso)
        check("the replay created no second row", len(rows or []) == 1, f"{len(rows or [])}")
        check("the replay did not overwrite the content", PROBE in str((rows or [{}])[0].get("content")) and "replay" not in str((rows or [{}])[0].get("content")))

        # --- the named window rejections ---
        rejections = [
            ("malformed", {"content": f"{PROBE} x", "capture": "reply", "windowTs": "not-a-timestamp"}, "window_malformed"),
            ("future", {"content": f"{PROBE} x", "capture": "reply", "windowTs": iso(now_dt + datetime.timedelta(hours=2))}, "window_future"),
            ("stale", {"content": f"{PROBE} x", "capture": "reply", "windowTs": iso(now_dt - datetime.timedelta(hours=25))}, "window_stale"),
        ]
        for name, payload, expected in rejections:
            st, body = fn_post(payload)
            check(f"a {name} window is rejected as {expected}", st == 400 and isinstance(body, dict) and body.get("error") == expected, f"{st} {body}")

        off_grid = None
        for k in range(1, 49):
            candidate = now_dt - datetime.timedelta(minutes=30 * k)
            if min_distance_minutes(now_dt, candidate) > GRID_CADENCE_MIN / 2:
                off_grid = candidate
                break
        check("an off-grid probe instant exists within the trailing 24 h", off_grid is not None)
        if off_grid:
            st, body = fn_post({"content": f"{PROBE} x", "capture": "reply", "windowTs": iso(off_grid)})
            check("an off-grid window is rejected as window_off_grid", st == 400 and isinstance(body, dict) and body.get("error") == "window_off_grid", f"{st} {body} ({iso(off_grid)})")

        st, body = fn_post({"content": f"{PROBE} x", "capture": "reply"})
        check("a missing windowTs is window_malformed", st == 400 and isinstance(body, dict) and body.get("error") == "window_malformed", f"{st} {body}")
        st, body = fn_post({"content": "", "capture": "reply", "windowTs": w2_iso})
        check("an empty content is 400", st == 400, f"{st} {body}")
        st, body = fn_post({"content": f"{PROBE} x", "capture": "nonsense", "windowTs": w2_iso})
        check("an invalid capture is 400", st == 400, f"{st} {body}")
        st, body = fn_post({"content": f"{PROBE} x", "capture": "reply", "windowTs": w2_iso, "client_message_id": "nope"})
        check("a malformed client_message_id is 400", st == 400, f"{st} {body}")
        st, cfg = req("GET", "/rest/v1/config?select=value&key=eq.chat_max_message_chars", key=SERVICE)
        cap = int((cfg or [{}])[0].get("value", 8000)) if isinstance(cfg, list) else 8000
        st, body = fn_post({"content": "x" * (cap + 1), "capture": "reply", "windowTs": w2_iso})
        check("content over chat_max_message_chars is 400", st == 400, f"{st} {body}")

        # --- the chat path: null energy, source 'chat' ---
        st, body = fn_post({"content": f"{PROBE} a walk after lunch, no score", "capture": "chat", "windowTs": w2_iso})
        check("the chat path stores too", st == 200 and isinstance(body, dict) and body.get("status") == "ok", f"{st} {body}")
        check("a text without a trailing 1-10 stores a null energy", isinstance(body, dict) and body.get("energy") is None, f"{body}")
        rows = row_for_window(uid, w2_iso)
        check("the chat row's source is chat", ((rows or [{}])[0]).get("source") == "chat", f"{rows}")
        chat_id = (rows or [{}])[0].get("id")

        # --- PATCH own row / foreign row ---
        st, body = fn_patch({"doing_id": doing_id, "energy": 7})
        check("PATCH sets the energy on an own row", st == 200 and isinstance(body, dict) and body.get("ok") is True and body.get("energy") == 7, f"{st} {body}")
        rows = row_for_window(uid, w1_iso)
        check("the PATCH persisted", ((rows or [{}])[0]).get("energy") == 7, f"{rows}")
        st, rows = req("GET", "/rest/v1/profiles?select=latest_energy&limit=1", key=ANON, headers=auth_headers())
        check("latest_energy follows the chip", (rows or [{}])[0].get("latest_energy") == 7, f"{rows}")

        for bad in (0, 11, 4.5, "4"):
            st, body = fn_patch({"doing_id": doing_id, "energy": bad})
            check(f"PATCH rejects energy {bad!r}", st == 400, f"{st} {body}")
        st, body = fn_patch({"doing_id": "not-a-uuid", "energy": 5})
        check("PATCH rejects a malformed doing_id", st == 400, f"{st} {body}")
        st, body = fn_patch({"doing_id": "00000000-0000-4000-8000-000000000000", "energy": 5})
        check("PATCH 404s an unknown doing", st == 404, f"{st} {body}")

        # a foreign user's doing: visible to the service role, invisible to us
        st, others = req("GET", f"/rest/v1/profiles?select=id&id=neq.{uid}&limit=1", key=SERVICE)
        other = (others or [{}])[0].get("id") if isinstance(others, list) and others else None
        if other:
            st, foreign = req(
                "POST",
                "/rest/v1/doings_logs?select=id",
                {
                    "user_id": other,
                    "kind": "doing",
                    "content": f"{PROBE} foreign",
                    "source": "chat",
                    "logged_at": iso(now_dt),
                },
                key=SERVICE,
                headers={"Prefer": "return=representation"},
            )
            foreign_id = (foreign or [{}])[0].get("id") if isinstance(foreign, list) and foreign else None
            if foreign_id:
                st, body = fn_patch({"doing_id": foreign_id, "energy": 5})
                check("PATCH on another user's doing is a 404 (never a 403)", st == 404, f"{st} {body}")
                st, rows = req("GET", f"/rest/v1/doings_logs?select=energy&id=eq.{foreign_id}", key=SERVICE)
                check("the foreign row was not modified", ((rows or [{}])[0]).get("energy") is None, f"{rows}")
        else:
            print("  ..   SKIP the foreign-row PATCH check -- only one user in the project")

        info("chat-path doing id", chat_id)

        # --- the recorded open surface (FP-04 Out of scope): the client can write doings itself ---
        # Asserted, not assumed, so a future revoke flips this assertion deliberately. A fabricated
        # 400-day-old window is exactly what `submit-checkin` would reject as stale — which is the
        # point: nothing on this path canonicalizes, embeds, or maintains `latest_energy`.
        st, body = req(
            "POST",
            "/rest/v1/doings_logs?select=id",
            {
                "user_id": uid,
                "kind": "doing",
                "content": f"{PROBE} fabricated client-side, bypassing submit-checkin",
                "source": "app",
                "energy": 1,
                "logged_at": iso(now_dt),
                "checkin_window": iso(now_dt - datetime.timedelta(days=400)),
            },
            key=ANON,
            headers={**auth_headers(), "Prefer": "return=representation"},
        )
        check("a direct client INSERT into doings_logs still succeeds (recorded open surface)", st in (200, 201), f"{st} {body}")
        fabricated_id = (body or [{}])[0].get("id") if isinstance(body, list) and body else None
        if fabricated_id:
            st, body = req(
                "PATCH",
                f"/rest/v1/doings_logs?id=eq.{fabricated_id}",
                {"energy": 9},
                key=ANON,
                headers={**auth_headers(), "Prefer": "return=minimal"},
            )
            check("a direct client UPDATE of doings_logs still succeeds (recorded open surface)", st in (200, 204), f"{st} {body}")
        else:
            print("  ..   SKIP the direct-UPDATE assertion -- the INSERT did not return a row")

    finally:
        # --- no residue: probe rows gone, prefs and latest_energy restored ---
        st, _ = req("DELETE", f"/rest/v1/doings_logs?content=like.{PROBE}*", key=SERVICE)
        check("probe doings cleaned up", st in (200, 204), f"{st}")
        if original:
            st, _ = req(
                "POST",
                "/rest/v1/rpc/update_checkin_prefs",
                {
                    "p_cadence": original.get("checkin_cadence_minutes"),
                    "p_start": original.get("checkin_active_hours_start"),
                    "p_end": original.get("checkin_active_hours_end"),
                    "p_tz": original.get("timezone") or "UTC",
                },
                key=ANON,
                headers=auth_headers(),
            )
            check("check-in prefs restored", st in (200, 204), f"{st}")
            st, _ = req(
                "PATCH",
                f"/rest/v1/profiles?id=eq.{uid}",
                {"latest_energy": original_latest_energy},
                key=SERVICE,
                headers={"Prefer": "return=minimal"},
            )
            check("latest_energy restored", st in (200, 204), f"{st}")


def log_checks(path):
    """The FR-8 zero-embed leg: one embed per stored doing, none for a duplicate."""
    print("== C. log cross-check (--logs) ==")
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except Exception as e:  # noqa: BLE001
        check("log file readable", False, str(e))
        return
    embeds = text.count('"requestId":"embed"')
    oks = len(re.findall(r'\[submit-checkin\] submit\s+\{[^\n]*"outcome":"ok"', text))
    dups = len(re.findall(r'\[submit-checkin\] submit\s+\{[^\n]*"outcome":"duplicate"', text))
    info("log lines", f"embed={embeds} ok={oks} duplicate={dups}")
    check("the log carries the run's submit lines", oks >= 1, f"ok={oks}")
    check("the log carries a duplicate (so the zero-embed claim is exercised)", dups >= 1, f"duplicate={dups}")
    check(
        "exactly one embed per stored doing and none for a duplicate (FR-8)",
        embeds == oks,
        f"embed={embeds} != ok={oks}",
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--run-jest", action="store_true")
    ap.add_argument("--no-deno", action="store_true", help="skip `deno check`")
    ap.add_argument("--logs", help="an exported submit-checkin log file for the zero-embed leg")
    ap.add_argument("--no-mint", action="store_true",
                    help="never mint a JWT; require DAVOS_USER_JWT to be valid as supplied")
    ap.add_argument("--email", help="user to mint for (default: DAVOS_USER_EMAIL, else inferred)")
    args = ap.parse_args()

    global NO_MINT, EMAIL
    NO_MINT = args.no_mint
    if args.email:
        EMAIL = args.email

    static_checks(run_deno=not args.no_deno, run_jest=args.run_jest)
    if not args.static_only:
        missing = [n for n, v in (
            ("SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL)", URL),
            ("SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY)", ANON),
            ("SUPABASE_SERVICE_ROLE_KEY", SERVICE),
        ) if not v]
        if missing:
            print("  SKIP live section -- need " + ", ".join(missing))
        else:
            live_checks(args.logs)
    if args.logs:
        log_checks(args.logs)
    elif not args.static_only:
        print("== C. log cross-check (--logs) ==")
        print("  SKIP the zero-embed leg -- pass --logs <file> with an export of this run's")
        print("       submit-checkin log (`supabase functions logs submit-checkin > run.log`)")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 2 checks passed.")


if __name__ == "__main__":
    main()
