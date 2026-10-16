#!/usr/bin/env python3
"""Automate FP-03 Step 2 verification (placeholder exemplars + seed/clear).

Covers PLAN Step 2 Verify: the placeholder set has the §6.4 sizes and the §3.3 labels, seeding
is idempotent and goes through the real adapter (no stub), every row carries the embed-model
stamp and the PLACEHOLDER-DEV source, the rules' domains are a subset of the exemplar domains,
one batched embed per chunk (NFR-2), and clear removes exactly the placeholder rows.

  AUTOMATED -- static (no network):
    module      : `placeholderExemplars.ts` exists, exports the set + the PLACEHOLDER-DEV source
                  tag, and is built as 16 domain / 6 emotion / 2 quit_signal groups holding
                  exactly the §3.3 domain strings, the config emotion labels, and the two quit
                  labels (labels are data, FR-2)
    dev-smoke   : both actions are registered (union + `available`) and the seed is guarded by
                  `llm_stub_mode` and chunked; the placeholder source tag is the delete predicate
    docs        : GLOSSARY §13 lists both actions; TECH-SPEC §6.4 names the module and the action

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE/DAVOS_USER_JWT/DEV_SMOKE_TOKEN, and 0024
  applied; temporarily sets `llm_stub_mode`, always restored):
    guard       : with `llm_stub_mode=true`, seed-exemplars is refused (400), not a half-seed
    seed        : 200, `seeded == 228`, per-set 160/48/20, `embedCalls <= 3` (NFR-2)
    rows        : 228 rows; `embedding` never null; every `embed_model` stamped
                  `gemini-embedding-001@768`; every `source` = PLACEHOLDER-DEV
    labels      : distinct domains == the §3.3 16 strings exactly; distinct emotions == the live
                  `config.emotion_labels`; distinct quit labels == quit/false_constraint; the
                  rules' domains are a subset of the exemplar domains; all 228 texts distinct
    idempotent  : a second seed leaves exactly 228 rows (no duplicates, no drift)
    clear       : clear-exemplars removes the placeholder rows and nothing else (0 rows)
    restore     : re-seeded at the end, so the corpus is left ready for Step 3

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DAVOS_USER_JWT="<signed-in-user-jwt>"
  $env:DEV_SMOKE_TOKEN="<dev-smoke bearer token>"
  python scripts/verify-fp03-step2.py [--static-only] [--logs <pasted-log-file>]

PREREQUISITES: migration 0024 applied (`supabase db push`) AND `dev-smoke` redeployed with the
two new actions. The live section writes `llm_stub_mode` and restores it in a `finally`; it
leaves the 228 placeholder exemplars seeded. `--logs <file>` additionally counts the real
`"requestId":"embed"` adapter log lines for the seed (optional: Supabase function logs are not
reachable over PostgREST).
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

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
SMOKE_TOKEN = env("DEV_SMOKE_TOKEN")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# §3.3 proposed 16-domain set (content sign-off pending, BG-02) -- verbatim, slashes included.
DOMAIN_LABELS = [
    "Career",
    "Finance",
    "Fitness",
    "Health",
    "Learning",
    "Creativity",
    "Relationships",
    "Family",
    "Social",
    "Mental/Emotional",
    "Spirituality",
    "Discipline/Habits",
    "Communication",
    "Environment/Home",
    "Recreation",
    "Purpose/Legacy",
]
# config.emotion_labels fallback (live config is authoritative when reachable).
EMOTION_LABELS_FALLBACK = [
    "frustrated",
    "exhausted",
    "anxious",
    "proud",
    "determined",
    "avoidant",
]
QUIT_LABELS = ["quit", "false_constraint"]
EXPECTED_COUNTS = {"domain": 160, "emotion": 48, "quit_signal": 20}
EXPECTED_TOTAL = 228
MAX_EMBED_CALLS = 3
EMBED_MODEL = "gemini-embedding-001@768"
PLACEHOLDER_SOURCE = "PLACEHOLDER-DEV"
MODULE_REL = "supabase/functions/_shared/dev/placeholderExemplars.ts"


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


def authed():
    return {"Authorization": f"Bearer {JWT}"}


def get_config(key):
    st, rows = req("GET", f"/rest/v1/config?select=value&key=eq.{key}", key=SERVICE)
    if st == 200 and isinstance(rows, list) and rows:
        return rows[0]["value"]
    return None


def set_config(key, value):
    st, _ = req("PATCH", f"/rest/v1/config?key=eq.{key}", {"value": value}, key=SERVICE)
    return st in (200, 204)


def dev_smoke(action, **params):
    if not SMOKE_TOKEN:
        return None, {"skipped": "DEV_SMOKE_TOKEN not set"}
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    path = f"/functions/v1/dev-smoke?action={action}" + (f"&{q}" if q else "")
    st, b = req("GET", path, key=ANON, headers={"Authorization": f"Bearer {SMOKE_TOKEN}"}, timeout=140)
    return st, b


def rows_where(query):
    st, rows = req("GET", f"/rest/v1/exemplars?select={query}&limit=1000", key=ANON, headers=authed())
    return st, (rows if isinstance(rows, list) else [])


def exemplar_count():
    st, rows = rows_where("id")
    return (len(rows) if st == 200 else None), st


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------


def static_checks():
    print("== A. static (no network) ==")

    src = read_text(MODULE_REL)
    check("placeholderExemplars.ts exists", src is not None)
    if src is None:
        return
    check(
        "module exports the set + the PLACEHOLDER-DEV source tag",
        "export const PLACEHOLDER_EXEMPLARS" in src
        and 'export const PLACEHOLDER_EXEMPLAR_SOURCE = "PLACEHOLDER-DEV"' in src,
    )
    check(
        "module is labelled as placeholder / draft content (AGENTS.md §8.4)",
        "PLACEHOLDER" in src.upper() and "DRAFT" in src.upper(),
    )

    domain_groups = re.findall(r'build\(\s*"domain",\s*"([^"]+)"', src)
    emotion_groups = re.findall(r'build\(\s*"emotion",\s*"([^"]+)"', src)
    quit_groups = re.findall(r'build\(\s*"quit_signal",\s*"([^"]+)"', src)
    check(f"module builds 16 domain groups ({len(domain_groups)})", domain_groups == DOMAIN_LABELS, f"{domain_groups}")
    check(
        f"module builds 6 emotion groups ({len(emotion_groups)})",
        sorted(emotion_groups) == sorted(EMOTION_LABELS_FALLBACK),
        f"{emotion_groups}",
    )
    check(f"module builds 2 quit_signal groups ({len(quit_groups)})", quit_groups == QUIT_LABELS, f"{quit_groups}")

    smoke = read_text("supabase/functions/dev-smoke/index.ts") or ""
    check("dev-smoke registers seed-exemplars in the action union", '"seed-exemplars"' in smoke)
    check("dev-smoke registers clear-exemplars in the action union", '"clear-exemplars"' in smoke)
    check(
        "dev-smoke lists both actions in `available`",
        smoke.count('"seed-exemplars"') >= 2 and smoke.count('"clear-exemplars"') >= 2,
    )
    check(
        "seed-exemplars is guarded by llm_stub_mode",
        "llm_stub_mode" in smoke and "seed-exemplars requires llm_stub_mode=false" in smoke,
    )
    check(
        "seed/clear write and delete on the placeholder source predicate",
        '.from("exemplars")' in smoke and ".eq(\"source\", PLACEHOLDER_EXEMPLAR_SOURCE)" in smoke,
    )
    check(
        "seed stamps embed_model and asserts the vector count",
        "embed_model: PLACEHOLDER_EMBED_MODEL" in smoke and "embedding count mismatch" in smoke,
    )

    # The exemplar path must touch the exemplars table only (seed delete + seed insert +
    # clear delete); verify-step11 AC-11 independently forbids new `rules` insert paths.
    ex_refs = smoke.count('.from("exemplars")')
    check(
        "the exemplar path references only the exemplars table (3 refs)",
        ex_refs == 3,
        f"{ex_refs}",
    )

    gloss = read_text("docs/GLOSSARY.md") or ""
    smoke_row = [ln for ln in gloss.splitlines() if ln.startswith("| `dev-smoke` |")]
    check(
        "GLOSSARY §13 dev-smoke row lists both new actions",
        bool(smoke_row) and "seed-exemplars" in smoke_row[0] and "clear-exemplars" in smoke_row[0],
        f"{smoke_row}",
    )

    tech = read_text("docs/TECH-SPEC.md") or ""
    sec64 = tech.split("### 6.4", 1)[-1].split("\n## ", 1)[0] if "### 6.4" in tech else ""
    check(
        "TECH-SPEC §6.4 names the placeholder module and the seed action",
        "placeholderExemplars.ts" in sec64 and "seed-exemplars" in sec64,
        f"{sec64[:160]}",
    )


# ---------------------------------------------------------------------------
# B. live checks
# ---------------------------------------------------------------------------


def count_rows(query):
    st, rows = rows_where(query)
    return st, (len(rows) if st == 200 else None), rows


def live_checks(log_path=None):
    print("== B. live (needs env; 0024 applied; dev-smoke redeployed) ==")

    if not SMOKE_TOKEN:
        print("  SKIP live section -- need DEV_SMOKE_TOKEN")
        return

    stub_snapshot = get_config("llm_stub_mode")
    info("llm_stub_mode snapshot", repr(stub_snapshot))
    seeded_ok = False

    try:
        # --- guard: with the stub on, the seed is refused before touching the table ---
        if set_config("llm_stub_mode", True):
            st, body = dev_smoke("seed-exemplars")
            check(
                "seed-exemplars refuses to run on llm_stub_mode=true",
                st == 400 and isinstance(body, dict) and "llm_stub_mode" in json.dumps(body),
                f"{st} {body}",
            )
        else:
            check("could set llm_stub_mode for the guard check", False, "config PATCH failed")

        # --- seed with real embeddings ---
        if not set_config("llm_stub_mode", False):
            check("could set llm_stub_mode=false", False, "config PATCH failed")
            return
        st, body = dev_smoke("seed-exemplars")
        body = body if isinstance(body, dict) else {}
        check("seed-exemplars returns 200", st == 200, f"{st} {body}")
        check("seed reports 228 rows", body.get("seeded") == EXPECTED_TOTAL, f"{body.get('seeded')}")
        sets = body.get("sets") or {}
        check(
            "seed reports the §6.4 per-set sizes",
            all(sets.get(k) == v for k, v in EXPECTED_COUNTS.items()),
            f"{sets}",
        )
        calls = body.get("embedCalls")
        check(f"seed reports <= {MAX_EMBED_CALLS} embed calls (NFR-2)", isinstance(calls, int) and calls <= MAX_EMBED_CALLS, f"{calls}")

        # --- rows: counts, stamps, source ---
        st, total, _ = count_rows("id")
        check("exemplars holds 228 rows", st == 200 and total == EXPECTED_TOTAL, f"{st} {total}")
        for kind, want in EXPECTED_COUNTS.items():
            st, got, _ = count_rows(f"id&set_kind=eq.{kind}")
            check(f"{kind} set holds {want} rows", st == 200 and got == want, f"{st} {got}")
        st, null_emb, _ = count_rows("id&embedding=is.null")
        check("no row has a null embedding", st == 200 and null_emb == 0, f"{st} {null_emb}")
        st, stamped, _ = count_rows(f"id&embed_model=eq.{EMBED_MODEL}")
        check(f"every row is stamped {EMBED_MODEL}", st == 200 and stamped == EXPECTED_TOTAL, f"{st} {stamped}")
        st, sourced, _ = count_rows(f"id&source=eq.{PLACEHOLDER_SOURCE}")
        check(
            f"every row carries source={PLACEHOLDER_SOURCE}",
            st == 200 and sourced == EXPECTED_TOTAL,
            f"{st} {sourced}",
        )

        # --- label parity (FR-2: labels are data) ---
        st, rows = rows_where("set_kind,label,text")
        sets_seen = {}
        for r in rows:
            sets_seen.setdefault(r["set_kind"], set()).add(r["label"])
        check(
            "distinct domain labels == the §3.3 16-string set",
            sets_seen.get("domain") == set(DOMAIN_LABELS),
            f"{sorted(sets_seen.get('domain') or [])}",
        )
        cfg_emotions = get_config("emotion_labels")
        want_emotions = (
            set(cfg_emotions)
            if isinstance(cfg_emotions, list) and cfg_emotions
            else set(EMOTION_LABELS_FALLBACK)
        )
        info("expected emotion labels", sorted(want_emotions))
        check(
            "distinct emotion labels == config.emotion_labels",
            sets_seen.get("emotion") == want_emotions,
            f"{sorted(sets_seen.get('emotion') or [])}",
        )
        check(
            "distinct quit labels == quit/false_constraint",
            sets_seen.get("quit_signal") == set(QUIT_LABELS),
            f"{sorted(sets_seen.get('quit_signal') or [])}",
        )

        texts = [r["text"] for r in rows]
        check("all 228 exemplar texts are distinct", len(set(texts)) == len(texts) == EXPECTED_TOTAL, f"{len(set(texts))}")

        # --- rules domains are a subset of the exemplar domains (Step 2 parity) ---
        st, rule_rows = req("GET", "/rest/v1/rules?select=domain&limit=1000", key=ANON, headers=authed())
        rule_domains = sorted({r["domain"] for r in rule_rows}) if st == 200 and isinstance(rule_rows, list) else []
        info("rules domains", rule_domains)
        check(
            "rules' domains are a subset of the exemplar domains",
            st == 200 and set(rule_domains) <= set(DOMAIN_LABELS),
            f"{st} {rule_domains}",
        )

        # --- idempotent re-seed ---
        st, body = dev_smoke("seed-exemplars")
        check("re-seed returns 200", st == 200, f"{st} {body}")
        st, total, _ = count_rows("id")
        check("re-seed leaves exactly 228 rows", st == 200 and total == EXPECTED_TOTAL, f"{st} {total}")

        # --- clear removes exactly the placeholder rows ---
        st, _ = dev_smoke("clear-exemplars")
        check("clear-exemplars returns 200", st == 200, f"{st}")
        st, total, _ = count_rows("id")
        check("clear-exemplars leaves 0 rows", st == 200 and total == 0, f"{st} {total}")

        # --- leave the corpus seeded for the following steps ---
        st, body = dev_smoke("seed-exemplars")
        st, total, _ = count_rows("id")
        seeded_ok = st == 200 and total == EXPECTED_TOTAL
        check("corpus re-seeded at the end (228 rows)", seeded_ok, f"{st} {total}")

        # --- optional: count the real adapter embed log lines ---
        if log_path:
            log = read_text(log_path) or ""
            gemini_embeds = len(re.findall(r'"provider":"gemini"[^\n]*"requestId":"embed"', log)) + len(
                re.findall(r'"requestId":"embed"[^\n]*"provider":"gemini"', log)
            )
            info("gemini embed log lines", gemini_embeds)
            check(
                f"one embed request per chunk, <= {MAX_EMBED_CALLS} (NFR-2)",
                0 < gemini_embeds <= MAX_EMBED_CALLS,
                f"{gemini_embeds}",
            )
    finally:
        if stub_snapshot is not None:
            ok = set_config("llm_stub_mode", stub_snapshot)
            print(f"  ..   llm_stub_mode restored to {stub_snapshot!r}: {'ok' if ok else 'FAILED'}")
            if not ok:
                FAILURES.append("llm_stub_mode restore")
        if not seeded_ok:
            # Best-effort restore so a mid-run failure does not leave the classifier unseeded.
            dev_smoke("clear-exemplars")
            dev_smoke("seed-exemplars")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--logs", default=None, help="path to a pasted dev-smoke log file")
    args = ap.parse_args()

    static_checks()
    if not args.static_only:
        if not all((URL, ANON, SERVICE, JWT)):
            print("  SKIP live section -- need SUPABASE_URL, SUPABASE_ANON_KEY, "
                  "SUPABASE_SERVICE_ROLE_KEY, DAVOS_USER_JWT")
        else:
            live_checks(args.logs)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 2 checks passed.")


if __name__ == "__main__":
    main()
