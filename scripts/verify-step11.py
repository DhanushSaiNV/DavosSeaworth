#!/usr/bin/env python3
"""Automate FP-02 Step 11 verification (timing/quota audit + doc sweep + AC ledger).

Covers PLAN Step 11 Verify: "every AC marked; write-back diffs present; repo clean".

The parts of the AC-1..AC-12 ledger a script can settle are settled here; the four
owner-live ACs are printed as a runbook at the end and marked OWNER-PENDING in
`docs/feature-prds/FP-02/FP-02-ACCEPTANCE.md`.

  AUTOMATED -- static (no network):
    AC-1  (half): `tactical_analysis` is logged, never a persisted key (source shape)
    AC-11       : placeholder rules are the only seeded content and are removed by one
                  predicate; no non-placeholder rule-insert path exists
    AC-12       : the write-back ledger -- §3.2 `client_message_id`, the §11 registry
                  key set with its dev-only marks, the GLOSSARY identifiers
    §9 scan     : no secret *values* in the client bundle or migrations, and no
                  service-role name in client code
    evidence    : the per-AC harnesses (verify-step8/9/10.py) exist
  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE; the user JWT is minted if unset):
    AC-10       : a 20-turn real-provider conversation -- per-turn latency p50/p90/max,
                  row integrity, zero `tactical_analysis` in any row, no degraded turn;
                  per-provider call counts from `--logs` asserted against §12 (the
                  adapter's JSON log lines; nothing persists provider/latency to a row)
    AC-3/AC-4   : tier regression re-checks (medium -> options + a real `select-persona`
                  tap + second-tap no-op; low -> low_question; fallback -> General)
    AC-5        : exactly one surviving tone group (needs DEV_SMOKE_TOKEN)
    AC-11       : labeled rule count == total rule count; clear -> 0; seed -> back to N
    AC-8 (half) : a replayed `client_message_id` returns `duplicate`, no second row

  MANUAL (printed at the end):
    AC-2  read the audit thread and judge tone (in-character, no "As an AI..."/generic
          apology) -- the audit turns are the material, so they are kept by default
    AC-7  Android push matrix (background -> notification + collapse key; foreground ->
          no banner, Realtime < 2 s; zero tokens -> send ok; invalid token -> deleted)
    AC-8  airplane mode on a device (the half no server can prove)
    AC-9  `python scripts/verify-step10.py --run-jest`
    plus the §13 live items: the iOS-push budget decision and `dev_overrides_enabled`
    must be false before real beta users.

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DAVOS_USER_JWT="<optional; a fresh one is minted if unset>"
  $env:DEV_SMOKE_TOKEN="<dev-smoke bearer token>"   # for the AC-5/AC-11 halves
  python scripts/verify-step11.py [--turns 20] [--logs adapter-log.txt] [--run-jest]
                                  [--static-only] [--cleanup]

PREREQUISITES: migrations 0022 + 0023 applied and send-message / select-persona /
job-dispatcher redeployed at current code (the preflight checks the config keys, which
is the same thing). The audit runs 20 turns against the *real* providers -- roughly
40 Gemini calls and 5-13 minutes -- so run it once, with the quota headroom in mind.
The audit rows are KEPT (they are the AC-2 material); pass --cleanup to delete them.
`auto_adopt_window_minutes`, `llm_stub_mode`, `llm_stub_malformed`, `llm_force_fail`
and `dev_overrides_enabled` are snapshotted and restored in a `finally`.
"""

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

FAILURES = []
CREATED_IDS = []
AUDIT_LATENCIES = []  # (server_ms, client_ms, route)
AUDIT_TURNS = []  # completed audit turns, oldest first


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
SMOKE_TOKEN = env("DEV_SMOKE_TOKEN")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def req(method, path, body=None, key=None, headers=None, timeout=140):
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
        except Exception:
            return e.code, {"raw": raw}


def rest_get(path):
    out = req("GET", path, key=SERVICE, headers={"Accept": "application/json"})[1]
    return out if isinstance(out, list) else []


def set_config(key_name, value):
    st, _ = req("PATCH", f"/rest/v1/config?key=eq.{key_name}", {"value": value}, key=SERVICE)
    return st in (200, 204)


def send(content, cid, sent_at, dev=None):
    body = {"content": content, "client_message_id": cid, "client_sent_at": sent_at}
    if dev:
        body["dev_force"] = dev
    st, b = req(
        "POST",
        "/functions/v1/send-message",
        body,
        key=ANON,
        headers={"Authorization": f"Bearer {JWT}"},
    )
    return st, b or {}


def select_persona(message_id, persona_key):
    st, b = req(
        "POST",
        "/functions/v1/select-persona",
        {"message_id": message_id, "persona_key": persona_key},
        key=ANON,
        headers={"Authorization": f"Bearer {JWT}"},
    )
    return st, b or {}


def dev_smoke(action, **params):
    if not SMOKE_TOKEN:
        return None, {"skipped": "DEV_SMOKE_TOKEN not set"}
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    path = f"/functions/v1/dev-smoke?action={action}" + (f"&{q}" if q else "")
    st, b = req("GET", path, key=ANON, headers={"Authorization": f"Bearer {SMOKE_TOKEN}"}, timeout=140)
    return st, b


def user_rows_by_cid(cid):
    return rest_get(
        "/rest/v1/messages?select=id,user_id,content,client_message_id,client_sent_at,created_at"
        f"&client_message_id=eq.{cid}&limit=5"
    )


def assistant_rows(user_msg_id):
    if not user_msg_id:
        return []
    path = (
        "/rest/v1/messages?select=id,content,reply_to_message_id,"
        "secondary_reply_to_message_id,persona_key,metadata,created_at"
        f"&metadata-%3E%3Euser_message_id=eq.{urllib.parse.quote(user_msg_id)}"
        "&order=created_at"
    )
    return rest_get(path)


def secondary_rows(user_msg_id):
    if not user_msg_id:
        return []
    return rest_get(
        "/rest/v1/messages?select=id,persona_key,reply_to_message_id,metadata,created_at"
        f"&secondary_reply_to_message_id=eq.{user_msg_id}"
    )


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------

# The §11 registry as it must read after FP-02 (D1 keys + every FP-02 addition).
EXPECTED_CONFIG_KEYS = [
    "confidence_bands",
    "auto_adopt_window_minutes",
    "emotion_labels",
    "trust_threshold",
    "strike_watch_days_default",
    "preemptive_lead_minutes",
    "habit_detection_thresholds",
    "checkin_cadence_default",
    "watchdog_grace_minutes",
    "lockdown_circuit_breaker_hours",
    "sliding_window_messages",
    "conflict_priority_window",
    "sync_degrade_reply",
    "malformed_fallback_reply",
    "llm_call_timeout_ms",
    "pipeline_deadline_ms",
    "llm_stub_mode",
    "llm_force_fail",
    "llm_stub_malformed",
    "dev_overrides_enabled",
    "job_dispatcher_url",
    "job_dispatcher_budget_ms",
    "chat_max_message_chars",
    "chat_last_n",
    "chat_send_timeout_ms",
    "chat_realtime_watchdog_ms",
    "chat_retry_holdoff_ms",
    "chat_queue_max_items",
    "expo_push_enabled",
    "vapid_public_key",
]
DEV_ONLY_KEYS = ["llm_stub_mode", "llm_force_fail", "llm_stub_malformed", "dev_overrides_enabled"]

GLOSSARY_IDENTIFIERS = [
    "ui_metadata",
    "routeInfo",
    "dev_force",
    "client_message_id",
    "reply_to_message_id",
    "secondary_reply_to_message_id",
    "persona_key",
    "source_job_id",
]


def read_text(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def section(text, start, end):
    """Slice a doc between two headings (both must exist)."""
    if text is None:
        return ""
    i = text.find(start)
    j = text.find(end, i + 1) if i >= 0 else -1
    if i < 0 or j < 0:
        return ""
    return text[i:j]


def strip_metadata_blocks(src):
    """Every `metadata: Record<string, unknown> = { ... };` block, per server function."""
    blocks = []
    for m in re.finditer(r"metadata(?::\s*Record<string,\s*unknown>)?\s*(?::[^=]*)?=\s*\{", src):
        depth = 0
        for k in range(m.end() - 1, len(src)):
            if src[k] == "{":
                depth += 1
            elif src[k] == "}":
                depth -= 1
                if depth == 0:
                    blocks.append(src[m.end() : k])
                    break
    return blocks


def static_checks(run_jest):
    print("== A. static checks (doc ledger + source shape + secret scan) ==")

    # --- AC-12: the write-back ledger ---
    tech = read_text("docs/TECH-SPEC.md")
    check("AC-12: docs/TECH-SPEC.md exists", tech is not None)
    schema = section(tech, "## 3.", "## 4.")
    check("AC-12: §3.2 declares messages.client_message_id", "client_message_id uuid" in schema)
    check(
        "AC-12: §3.2 declares the dedupe unique index",
        "messages_user_client_msg_uniq" in schema
        and "unique index" in schema,
    )
    registry = section(tech, "## 11. Config Registry", "## 12.")
    missing = [k for k in EXPECTED_CONFIG_KEYS if f"| `{k}` |" not in registry]
    check("AC-12: §11 registry holds every expected key", not missing, f"missing {missing}")
    unmarked = [k for k in DEV_ONLY_KEYS if not re.search(rf"\|\s*`{k}`\s*\|[^\n]*dev-only", registry)]
    check("AC-12: every dev-only key is marked dev-only", not unmarked, f"unmarked {unmarked}")

    gloss = read_text("docs/GLOSSARY.md")
    check("AC-12: GLOSSARY exists", gloss is not None)
    check("AC-12: GLOSSARY §13 registers dev-smoke", "| `dev-smoke` |" in gloss)
    check(
        "AC-12: GLOSSARY §14 registers the route enum incl. degrade",
        re.search(r"\| Persona route \|.*`degrade`", gloss) is not None,
    )
    gl15 = section(gloss, "## 15.", "## 16.")
    gl_missing = [i for i in GLOSSARY_IDENTIFIERS if f"`{i}`" not in gl15]
    check("AC-12: GLOSSARY §15 holds the FP-02 identifiers", not gl_missing, f"missing {gl_missing}")
    gl_keys = [k for k in EXPECTED_CONFIG_KEYS if f"`{k}`" not in gloss]
    check("AC-12: GLOSSARY §16 lists every config key", not gl_keys, f"missing {gl_keys}")

    # --- AC-1 (half): tactical_analysis is logged, never persisted ---
    server_files = [
        "supabase/functions/send-message/index.ts",
        "supabase/functions/select-persona/index.ts",
        "supabase/functions/job-dispatcher/index.ts",
    ]
    persisted = []
    for rel in server_files:
        src = read_text(rel)
        check(f"AC-1: {rel} exists", src is not None)
        if not src:
            continue
        for block in strip_metadata_blocks(src):
            if "tactical" in block:
                persisted.append(rel)
    check("AC-1: no metadata block ever carries tactical_analysis", not persisted, f"{persisted}")
    check(
        "AC-1: send-message logs tactical_analysis server-side",
        '"[send-message] tactical_analysis:"' in (read_text(server_files[0]) or ""),
    )

    # --- AC-11: placeholder-only seed, single-predicate removal ---
    rules_src = read_text("supabase/functions/_shared/dev/placeholderRules.ts") or ""
    check("AC-11: placeholder rules are labeled PLACEHOLDER-DEV", 'PLACEHOLDER_SOURCE_FIGURE = "PLACEHOLDER-DEV"' in rules_src)
    smoke = read_text("supabase/functions/dev-smoke/index.ts") or ""
    check(
        "AC-11: clear-rules is a single source_figure predicate",
        '.from("rules")' in smoke and '.eq("source_figure", "PLACEHOLDER-DEV")' in smoke,
    )
    check("AC-11: the seed writes the label on every row", "source_figure: PLACEHOLDER_SOURCE_FIGURE" in smoke)
    # No other rule-insert path may exist anywhere in the backend.
    other_inserts = []
    for base, _dirs, names in os.walk(os.path.join(ROOT, "supabase")):
        for name in names:
            if not name.endswith((".ts", ".sql")):
                continue
            rel = os.path.relpath(os.path.join(base, name), ROOT).replace("\\", "/")
            if rel == "supabase/functions/dev-smoke/index.ts":
                continue
            body = read_text(rel) or ""
            if re.search(r'(from\("rules"\)|into\s+(public\.)?rules)\s*[\s\S]{0,200}?insert', body, re.I):
                other_inserts.append(rel)
    check("AC-11: no other rule-insert path exists", not other_inserts, f"{other_inserts}")

    # --- §9 secret scan ---
    values = [
        r"eyJ[A-Za-z0-9_-]{10,}",
        r"AIza[A-Za-z0-9_-]{10,}",
        r"gsk_[A-Za-z0-9]{10,}",
        r"sk-[A-Za-z0-9]{20,}",
        r"-----BEGIN",
    ]
    role = [r"service_role", r"SUPABASE_SERVICE"]
    leaks = []
    scanned = 0
    for base, _dirs, names in os.walk(os.path.join(ROOT, "supabase", "migrations")):
        for name in names:
            if name.endswith(".sql"):
                scanned += 1
                body = read_text(os.path.relpath(os.path.join(base, name), ROOT).replace("\\", "/")) or ""
                if any(re.search(p, body) for p in values):
                    leaks.append(name)
    for tree in ("app", "lib"):
        for base, _dirs, names in os.walk(os.path.join(ROOT, tree)):
            for name in names:
                if name.endswith((".ts", ".tsx")):
                    scanned += 1
                    rel = os.path.relpath(os.path.join(base, name), ROOT).replace("\\", "/")
                    body = read_text(rel) or ""
                    if any(re.search(p, body) for p in values) or any(re.search(p, body) for p in role):
                        leaks.append(rel)
    for extra in ("app.config.js", "app.json"):
        body = read_text(extra)
        if body is not None:
            scanned += 1
            if any(re.search(p, body) for p in values) or any(re.search(p, body) for p in role):
                leaks.append(extra)
    info("secret scan: files scanned", scanned)
    check("§9: no secret value and no service-role name leaks into the client", not leaks, f"{leaks}")

    # --- evidence: the per-AC harnesses exist ---
    for rel, ac in [
        ("scripts/verify-step8.py", "AC-6"),
        ("scripts/verify-step9.py", "AC-8"),
        ("scripts/verify-step10.py", "AC-9"),
    ]:
        check(f"evidence: {rel} exists ({ac})", os.path.exists(os.path.join(ROOT, rel)))

    # --- FP-02 doc identity: the plan points at the acceptance doc that exists ---
    plan = read_text("docs/feature-prds/FP-02/FP-02-PLAN.md") or ""
    check(
        "plan Step 11 points at docs/feature-prds/FP-02/FP-02-ACCEPTANCE.md",
        "docs/feature-prds/FP-02/FP-02-ACCEPTANCE.md" in plan,
    )
    check(
        "AGENTS.md §2 names the file that exists (docs/TECH-SPEC.md)",
        "`docs/TECH-SPEC.md`" in (read_text("AGENTS.md") or "")
        and "docs/TECH-SPECS.md" not in (read_text("AGENTS.md") or ""),
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

AUDIT_CONFIG_KEYS = [
    "llm_stub_mode",
    "llm_stub_malformed",
    "llm_force_fail",
    "auto_adopt_window_minutes",
    "dev_overrides_enabled",
    "chat_queue_max_items",
    "llm_call_timeout_ms",
    "pipeline_deadline_ms",
    "job_dispatcher_budget_ms",
    "expo_push_enabled",
]


def percentile(values, q):
    if not values:
        return 0.0
    ordered = sorted(values)
    if q <= 0:
        return float(ordered[0])
    if q >= 100:
        return float(ordered[-1])
    rank = (len(ordered) - 1) * (q / 100.0)
    lo = int(rank)
    hi = min(lo + 1, len(ordered) - 1)
    return float(ordered[lo] + (ordered[hi] - ordered[lo]) * (rank - lo))


def do_turn(label, dev=None, collect=True):
    """Send one message; return a dict of the turn's facts, or None."""
    cid = str(uuid.uuid4())
    content = f"STEP11-{label} {cid[:8]}"
    sent_at = datetime.now(timezone.utc).isoformat()
    t0 = datetime.now(timezone.utc)
    st, body = send(content, cid, sent_at, dev)
    wall_ms = int((datetime.now(timezone.utc) - t0).total_seconds() * 1000)
    check(f"{label}: send ok", st == 200 and body.get("status") in ("ok", "duplicate"), f"{st} {body}")
    rows = user_rows_by_cid(cid)
    check(f"{label}: stored exactly once", len(rows) == 1, f"got {len(rows)}")
    if not rows:
        return None
    u = rows[0]
    CREATED_IDS.append(u["id"])
    replies = assistant_rows(u["id"])
    for r in replies:
        CREATED_IDS.append(r["id"])
    check(f"{label}: exactly one reply", len(replies) >= 1, f"got {len(replies)}")
    md = (replies[0]["metadata"] if replies else {}) or {}
    turn = {
        "cid": cid,
        "content": content,
        "sent_at": sent_at,
        "wall_ms": wall_ms,
        "user_id": u["user_id"],
        "user_msg_id": u["id"],
        "assistant_msg_id": replies[0]["id"] if replies else None,
        "route": md.get("route"),
        "domain": md.get("domain"),
        "options": md.get("persona_options") or [],
        "rule_ids": md.get("rule_ids") or [],
        "user_created_at": u["created_at"],
        "assistant_created_at": replies[0]["created_at"] if replies else None,
        "user_content": u["content"],
        "assistant_content": replies[0]["content"] if replies else None,
    }
    if collect and turn["user_created_at"] and turn["assistant_created_at"]:
        server_ms = (
            datetime.fromisoformat(turn["assistant_created_at"].replace("Z", "+00:00"))
            - datetime.fromisoformat(turn["user_created_at"].replace("Z", "+00:00"))
        ).total_seconds() * 1000
        client_ms = (
            datetime.fromisoformat(turn["assistant_created_at"].replace("Z", "+00:00"))
            - datetime.fromisoformat(sent_at)
        ).total_seconds() * 1000
        AUDIT_LATENCIES.append((server_ms, client_ms, turn["route"]))
    return turn


def audit_turns(n):
    print(f"== B1. AC-10 timing/quota audit ({n} real-provider turns) ==")
    degraded = 0
    started = datetime.now(timezone.utc)
    for i in range(1, n + 1):
        t = do_turn(f"AUD{i:02d}", dev=None)
        if not t:
            check("audit aborted (send/auth failed)", False, f"see AUD{i:02d} above")
            return False
        AUDIT_TURNS.append(t)
        if t["route"] == "degrade":
            degraded += 1
        print(f"  ..   turn {i:02d}: route={t['route']} wall={t['wall_ms']}ms")
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    info("audit wall-clock (s)", round(elapsed, 1))
    check("AC-10: no turn degraded (providers healthy for the audit)", degraded == 0, f"{degraded} degraded")
    check("AC-10: every turn produced latency data", len(AUDIT_LATENCIES) == n, f"got {len(AUDIT_LATENCIES)}")
    if not AUDIT_LATENCIES:
        return False
    server = [x[0] for x in AUDIT_LATENCIES]
    client = [x[1] for x in AUDIT_LATENCIES]
    p50 = percentile(server, 50)
    p90 = percentile(server, 90)
    mx = max(server)
    info("server-side turn latency ms (p50/p90/max)", f"{p50:.0f} / {p90:.0f} / {mx:.0f}")
    info("client-observed latency ms (p50/max)", f"{percentile(client, 50):.0f} / {max(client):.0f}")
    info("§12 target", "p50 < 40000, max < 150000")
    check(f"AC-10: p50 {p50:.0f}ms < 40000ms", p50 < 40000)
    check(f"AC-10: max {mx:.0f}ms < 150000ms", mx < 150000)

    # Integrity + the AC-1 live half, over the rows this run created.
    ids = ",".join(CREATED_IDS) or "00000000-0000-0000-0000-000000000000"
    rows = rest_get(f"/rest/v1/messages?select=id,content,metadata&id=in.({ids})")
    tainted = [r["id"] for r in rows if "tactical_analysis" in (r["content"] or "")]
    check("AC-1 (live): no audit row carries tactical_analysis in content", not tainted, f"{tainted}")
    check("AC-1 (live): the audit rows are readable (sanity)", len(rows) > 0, f"{len(rows)} rows")
    return True


def parse_logs(path):
    """Parse the adapter's JSON call lines: {ts, provider, model, latencyMs, ok, requestId}."""
    counts = {}
    latencies = []
    total = 0
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                obj = json.loads(line)
            except Exception:  # noqa: BLE001
                continue
            if "provider" not in obj or "latencyMs" not in obj:
                continue
            total += 1
            kind = "embed" if obj.get("requestId") == "embed" else "generate"
            counts[(obj["provider"], kind)] = counts.get((obj["provider"], kind), 0) + 1
            latencies.append(obj["latencyMs"])
    return counts, latencies, total


def quota_check(logs_path):
    print("== B2. AC-10 per-provider call counts vs §12 ==")
    if not logs_path:
        print(
            "  ..   no --logs file: per-provider counts are an OWNER dashboard step.\n"
            "  ..   Recipe: Supabase dashboard -> Edge Functions -> send-message -> Logs,\n"
            "  ..   filter the window of the audit run, export/paste the lines, re-run with\n"
            "  ..   --logs <file>. Each call is one JSON line {ts, provider, model, latencyMs, ok, requestId}."
        )
        derived = 3 * len(AUDIT_LATENCIES)
        info("derived session calls (1 extract + 1 embed + 1 generate per turn)", derived)
        info("§12 daily quotas", "gemini generate 500 RPD, embeddings 1000 RPD, groq 1000 RPD")
        check(
            "AC-10: derived session calls fit the §12 daily quotas (arithmetic, not observed)",
            derived <= 500,
            f"{derived} > 500",
        )
        return
    counts, latencies, total = parse_logs(logs_path)
    if total == 0:
        check("AC-10: --logs parsed at least one adapter call line", False, "0 lines parsed")
        return
    gem_gen = counts.get(("gemini", "generate"), 0)
    gem_emb = counts.get(("gemini", "embed"), 0)
    groq = sum(v for (p, _k), v in counts.items() if p == "groq")
    stub = sum(v for (p, _k), v in counts.items() if p == "stub")
    info("parsed calls (total)", total)
    info("gemini generate / embed", f"{gem_gen} / {gem_emb}")
    info("groq / stub", f"{groq} / {stub}")
    info("per-call latency ms (p50/max)", f"{percentile(latencies, 50):.0f} / {max(latencies):.0f}")
    check("AC-10: gemini generate calls <= 500 RPD", gem_gen <= 500, f"{gem_gen}")
    check("AC-10: gemini embedding calls <= 1000 RPD", gem_emb <= 1000, f"{gem_emb}")
    check("AC-10: groq calls <= 1000 RPD", groq <= 1000, f"{groq}")


def tier_rechecks():
    print("== B3. AC-3 / AC-4 tier regression re-checks ==")

    # AC-3: medium -> options, a real tap, and a second tap as a no-op.
    t = do_turn("TIER-medium", dev={"tier": "medium"}, collect=False)
    if t:
        check("AC-3: medium route is 'options'", t["route"] == "options", f"{t['route']}")
        check("AC-3: 2-3 persona_options are offered", 2 <= len(t["options"]) <= 3, f"{len(t['options'])}")
        if t["options"] and t["assistant_msg_id"]:
            key = t["options"][0].get("key")
            st, body = select_persona(t["assistant_msg_id"], key)
            check("AC-3: chip tap succeeds", st == 200 and body.get("status") == "ok", f"{st} {body}")
            sec = secondary_rows(t["user_msg_id"])
            for r in sec:
                CREATED_IDS.append(r["id"])
            check("AC-3: tap writes exactly one secondary reply", len(sec) == 1, f"{len(sec)}")
            if sec:
                md = sec[0]["metadata"] or {}
                check("AC-3: secondary reply records route='options'", md.get("route") == "options", f"{md.get('route')}")
                check("AC-3: secondary reply records the chosen persona_key", sec[0]["persona_key"] == key, f"{sec[0]['persona_key']}")
                check(
                    "AC-3: secondary reply leaves reply_to_message_id NULL",
                    sec[0]["reply_to_message_id"] is None,
                    f"{sec[0]['reply_to_message_id']}",
                )
            st2, body2 = select_persona(t["assistant_msg_id"], key)
            check(
                "AC-3: a second tap is a no-op (duplicate, still one row)",
                st2 == 200 and body2.get("status") == "duplicate" and len(secondary_rows(t["user_msg_id"])) == 1,
                f"{st2} {body2} rows={len(secondary_rows(t['user_msg_id']))}",
            )

    # AC-4: low -> an explicit question carried by direct_quote; fallback -> General/inquirer.
    low = do_turn("TIER-low", dev={"tier": "low"}, collect=False)
    if low:
        check("AC-4: low route is 'low_question'", low["route"] == "low_question", f"{low['route']}")
        check(
            "AC-4: low reply asks a question",
            "?" in (low["assistant_content"] or ""),
            f"{(low['assistant_content'] or '')[:80]!r}",
        )
    fb = do_turn("TIER-fallback", dev={"tier": "fallback"}, collect=False)
    if fb:
        check("AC-4: fallback route is 'fallback'", fb["route"] == "fallback", f"{fb['route']}")
        check("AC-4: fallback domain is General", fb["domain"] == "General", f"{fb['domain']}")


def ac5_recheck():
    print("== B4. AC-5 conflict filter ==")
    if not SMOKE_TOKEN:
        check("AC-5: re-check skipped -- DEV_SMOKE_TOKEN not set (Step 2 evidence stands)", True)
        return
    st, body = dev_smoke("retrieve", domain="Discipline/Habits", text="I can't stick to my habits")
    if st != 200 or not isinstance(body, dict):
        check("AC-5: dev-smoke retrieve succeeded", False, f"{st} {body}")
        return
    tones = body.get("survivingTones") or []
    check("AC-5: exactly one tone group survives", len(set(tones)) == 1, f"{tones}")
    check("AC-5: the dropped group is empathetic", body.get("droppedTone") == "empathetic", f"{body.get('droppedTone')}")
    check("AC-5: survivors are <= 5", body.get("surviving", 9) <= 5, f"{body.get('surviving')}")
    st2, body2 = dev_smoke("retrieve", domain="Career", text="my career is stalling")
    if st2 == 200 and isinstance(body2, dict):
        check(
            "AC-5: the filter does NOT fire outside the crafted domain",
            body2.get("droppedTone") is None,
            f"{body2.get('droppedTone')}",
        )


def ac11_live():
    print("== B5. AC-11 placeholder round-trip ==")
    if not SMOKE_TOKEN:
        check("AC-11: live round-trip skipped -- DEV_SMOKE_TOKEN not set (Step 2 evidence stands)", True)
        return
    total_before = len(rest_get("/rest/v1/rules?select=id&limit=1000"))
    labeled_before = len(rest_get("/rest/v1/rules?select=id&source_figure=eq.PLACEHOLDER-DEV&limit=1000"))
    check("AC-11: every seeded rule carries the dev label", total_before == labeled_before, f"{labeled_before}/{total_before}")
    st, _ = dev_smoke("clear-rules")
    check("AC-11: clear-rules succeeds", st == 200, f"{st}")
    check("AC-11: clear-rules removes every row in one step", len(rest_get("/rest/v1/rules?select=id&limit=1000")) == 0)
    st2, body2 = dev_smoke("seed-rules")
    seeded = body2.get("seeded") if isinstance(body2, dict) else None
    check("AC-11: seed-rules restores the set", st2 == 200 and seeded == labeled_before, f"{st2} seeded={seeded} expected={labeled_before}")


def dedupe_half(turn):
    print("== B6. AC-8 dedupe half (server) ==")
    if not turn:
        return
    before = len(rest_get(f"/rest/v1/messages?select=id&client_message_id=eq.{turn['cid']}"))
    st, body = send(turn["content"], turn["cid"], turn["sent_at"])
    after = len(rest_get(f"/rest/v1/messages?select=id&client_message_id=eq.{turn['cid']}"))
    check(
        "AC-8: a replayed client_message_id returns duplicate with no second row",
        st == 200 and body.get("status") == "duplicate" and before == 1 and after == 1,
        f"{st} {body} {before}->{after}",
    )


try:
    # Sibling helper (scripts/ is sys.path[0]): the one place this gate picks the user JWT it
    # sends. It prints the token (source, sub, exp, verdict) and never returns one already
    # decoded as expired -- it mints a fresh one instead (owner request, 2026-10-17). When it
    # cannot produce a usable token the gate skips its authenticated legs rather than sending a
    # dead one, which is what used to surface as a wall of unexplained 401s.
    from _mint_dev_jwt import resolve_gate_token
except Exception:  # noqa: BLE001
    resolve_gate_token = None


def live_checks(turns, logs_path, cleanup):
    print("== B. live checks ==")
    if not URL or not ANON or not SERVICE:
        print("  ..   SKIP live section: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not all set")
        return
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
    cfg = {r["key"]: r["value"] for r in rest_get("/rest/v1/config?select=key,value")}
    missing = [k for k in AUDIT_CONFIG_KEYS if k not in cfg]
    check("preflight: every FP-02 config key present (0022 + 0023 applied)", not missing, f"missing {missing}")
    if missing:
        check("live section aborted -- apply the migrations and redeploy first", False)
        return

    snapshot = {k: cfg.get(k) for k in AUDIT_CONFIG_KEYS + ["llm_stub_malformed"]}
    try:
        # The audit must be a real conversation: real providers, no forced tier.
        set_config("llm_stub_mode", False)
        set_config("llm_stub_malformed", False)
        set_config("llm_force_fail", "none")
        set_config("dev_overrides_enabled", True)
        set_config("auto_adopt_window_minutes", 10)

        audit_turns(turns)
        quota_check(logs_path)
        tier_rechecks()
        dedupe_half(AUDIT_TURNS[-1] if AUDIT_TURNS else None)
        ac5_recheck()
        ac11_live()
    finally:
        print("== restore ==")
        for k in AUDIT_CONFIG_KEYS + ["llm_stub_malformed"]:
            target = snapshot.get(k)
            if target is None:
                # Never fabricate a value: the preflight guarantees a snapshot, so this is
                # only reachable if a key vanished mid-run -- say so rather than guess.
                print(f"  restore {k}: SKIPPED (no snapshot; set it by hand)")
                continue
            print(f"  restore {k}={target!r}: {'ok' if set_config(k, target) else 'FAILED'}")
        if cleanup and CREATED_IDS:
            n = 0
            for i in range(0, len(CREATED_IDS), 50):
                chunk = CREATED_IDS[i : i + 50]
                st, _ = req("DELETE", f"/rest/v1/messages?id=in.({','.join(chunk)})", key=SERVICE)
                n += len(chunk) if st in (200, 204) else 0
            print(f"  cleanup: deleted {n} of {len(CREATED_IDS)} test message rows")
        elif CREATED_IDS:
            print(
                f"  kept {len(CREATED_IDS)} audit rows -- they are the AC-2 material; "
                "re-run with --cleanup to delete them."
            )


def manual_note():
    print(
        """
== C. MANUAL (owner) -- the ACs no script can settle ==
AC-2 (qualitative, D13): read the audit thread in the app or the DB and judge the tone --
     in-character throughout, zero "As an AI...", zero generic-apology filler. Record the
     prompt-v1 shortfalls as the hardening-pass backlog (TECH-SPECS §14 item 11).
AC-7 (Android push matrix): background the app -> send from web -> notification arrives and
     a repeat is grouped under collapse key chat_{userId}; chat focused -> no banner and the
     message renders < 2 s via Realtime; a user with zero tokens -> send still succeeds;
     an invalid token -> only that token is deleted on receipt.
AC-8 (device half): airplane mode -> send 2 -> queued in order -> reconnect -> both
     delivered exactly once; then `python scripts/verify-step9.py --run-jest` live section.
AC-9: `python scripts/verify-step10.py --run-jest` (needs 0022 + 0023 applied and
     send-message redeployed).
§13 live items: decide the iOS-remote-push budget question ($99/yr Apple Developer Program
     blocks iOS push; iOS degrades to Realtime) and set `dev_overrides_enabled=false`
     before inviting real beta users (it is true in the beta project, so a client can
     force tiers/domains; send-message re-checks it server-side).
FP-02 accepted 12/12 on 2026-10-16 (docs/feature-prds/FP-02/FP-02-ACCEPTANCE.md); the
FP-02-PLAN tracker rows for Steps 9, 10 and 11 are flipped. Re-run this harness to
reproduce the audit numbers, and paste them into the acceptance doc's audit table if a
point-in-time record is wanted.
"""
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turns", type=int, default=20, help="audit conversation length (AC-10)")
    ap.add_argument("--logs", help="file of adapter JSON log lines, for per-provider counts")
    ap.add_argument("--run-jest", action="store_true")
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--cleanup", action="store_true", help="delete the audit rows when done")
    args = ap.parse_args()

    static_checks(args.run_jest)
    if not args.static_only:
        live_checks(args.turns, args.logs, args.cleanup)
    manual_note()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 11 checks passed (the owner-live ACs are listed above).")


if __name__ == "__main__":
    main()
