#!/usr/bin/env python3
"""FP-03 Step 2 verification, as retired on 2026-10-28 (placeholder exemplars -> BG-04 only).

The owner retired the PLACEHOLDER-DEV exemplar corpus on 2026-10-28: the approved 233-row
BG-04 set is the only exemplar content, so the placeholder module and its seed/clear default
are gone. This gate therefore verifies the *retirement contract* plus the surviving seed/clear
mechanics, and it is read-only against the live corpus -- re-embedding 233 approved rows to
prove a seed path that no longer has a placeholder source would burn quota and risk the live
corpus for no new evidence (the swap itself is gated by verify-fp03-step6.py --corpus-source
BG-04 and the swap runbook).

  AUTOMATED -- static (no network):
    module      : `placeholderExemplars.ts` is absent; no code imports it
    dev-smoke   : `seed-exemplars`/`clear-exemplars` are registered (union + `available`);
                  the only slot is BG-04; `&source=` is required (no default) and unknown
                  values are a 400; the seed keeps the `llm_stub_mode` guard, the vector-count
                  assertion, the embed-model stamp, and the paced window contract
    docs        : TECH-SPEC §6.4 records the retirement; GLOSSARY §13 lists both actions with
                  the required source selector

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE/DEV_SMOKE_TOKEN; read-only):
    corpus      : 233 rows, all `source='BG-04'`, no null embeddings, every `embed_model`
                  stamped `gemini-embedding-001@768`, zero `PLACEHOLDER-DEV` rows
    guards      : a bare `seed-exemplars` and a bare `clear-exemplars` are 400s (never touch
                  the live corpus); an unknown `&source=` is a 400

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DEV_SMOKE_TOKEN="<dev-smoke bearer token>"
  python scripts/verify-fp03-step2.py [--static-only]

PREREQUISITES: migration 0024 applied and `dev-smoke` redeployed with the required-source
contract. The live section performs no writes and needs no user JWT.
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
SMOKE_TOKEN = env("DEV_SMOKE_TOKEN")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BG04_SOURCE = "BG-04"
RETIRED_SOURCE = "PLACEHOLDER-DEV"
EXPECTED_TOTAL = 233
EMBED_MODEL = "gemini-embedding-001@768"
MODULE_REL = "supabase/functions/_shared/dev/placeholderExemplars.ts"
SMOKE_REL = "supabase/functions/dev-smoke/index.ts"


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


def dev_smoke(action, **params):
    if not SMOKE_TOKEN:
        return None, {"skipped": "DEV_SMOKE_TOKEN not set"}
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    path = f"/functions/v1/dev-smoke?action={action}" + (f"&{q}" if q else "")
    st, b = req("GET", path, key=ANON, headers={"Authorization": f"Bearer {SMOKE_TOKEN}"}, timeout=140)
    return st, b


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------


def static_checks():
    print("== A. static (no network) ==")

    check("placeholderExemplars.ts is retired (file absent)", read_text(MODULE_REL) is None)
    smoke_raw = read_text(SMOKE_REL) or ""
    # Strip comments so prose about the retirement is not read as a live import.
    smoke = re.sub(r"//[^\n]*", "", smoke_raw)
    check(
        "dev-smoke no longer imports the placeholder exemplar module",
        "placeholderExemplars.ts" not in smoke
        and "PLACEHOLDER_EXEMPLARS" not in smoke
        and "PLACEHOLDER_EXEMPLAR_SOURCE" not in smoke,
    )
    check(
        "the exemplar slot map holds BG-04 only",
        smoke.count("[BG04_EXEMPLAR_SOURCE]: BG04_EXEMPLARS") == 1
        and "[PLACEHOLDER_EXEMPLAR_SOURCE]" not in smoke,
    )
    check(
        "`&source=` is required (no placeholder default)",
        re.search(r'searchParams\.get\("source"\)', smoke) is not None
        and re.search(r"return PLACEHOLDER", smoke) is None
        and re.search(r"if \(raw === null\) return null;", smoke) is not None,
    )
    check(
        "an unknown source is refused with a 400",
        "unknownSourceResponse" in smoke and "status: 400" in smoke,
    )
    check(
        "dev-smoke registers both exemplar actions (union + available)",
        smoke.count('"seed-exemplars"') >= 2 and smoke.count('"clear-exemplars"') >= 2,
    )
    check(
        "seed-exemplars is guarded by llm_stub_mode",
        "seed-exemplars requires llm_stub_mode=false" in smoke,
    )
    check(
        "seed asserts the vector count and stamps the frozen embed model",
        "embedding count mismatch" in smoke and "embed_model: EMBED_MODEL" in smoke,
    )
    check(
        "the seed keeps the paced window contract (offset/limit, 80-item window)",
        "SEED_EXEMPLAR_WINDOW = 80" in smoke
        and 'searchParams.get("offset")' in smoke
        and 'searchParams.get("limit")' in smoke,
    )
    ex_refs = smoke.count('.from("exemplars")')
    check("the exemplar path references only the exemplars table (3 refs)", ex_refs == 3, f"{ex_refs}")

    gloss = read_text("docs/GLOSSARY.md") or ""
    gloss_n = re.sub(r"[ \t]+", " ", gloss)
    smoke_row = [ln for ln in gloss_n.splitlines() if ln.startswith("| `dev-smoke` |")]
    check(
        "GLOSSARY §13 lists both actions with the required source selector",
        bool(smoke_row)
        and "seed-exemplars" in smoke_row[0]
        and "clear-exemplars" in smoke_row[0]
        and "source" in smoke_row[0],
        f"{smoke_row}",
    )

    tech = read_text("docs/TECH-SPEC.md") or ""
    sec64 = tech.split("### 6.4", 1)[-1].split("\n## ", 1)[0] if "### 6.4" in tech else ""
    check(
        "TECH-SPEC §6.4 records the placeholder retirement and names the BG-04 slot",
        "retired" in sec64.lower() and "bg04.ts" in sec64.lower() and "seed-exemplars" in sec64,
    )


# ---------------------------------------------------------------------------
# B. live checks (read-only)
# ---------------------------------------------------------------------------


def live_checks():
    print("== B. live (read-only; needs env) ==")
    if not all((URL, ANON, SERVICE)):
        print("  SKIP live section -- need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY")
        return
    if not SMOKE_TOKEN:
        print("  SKIP live section -- need DEV_SMOKE_TOKEN")
        return

    def count(where=""):
        path = f"/rest/v1/exemplars?select=id&limit=1000{('&' + where) if where else ''}"
        st, rows = req("GET", path, key=SERVICE)
        return st, (len(rows) if st == 200 and isinstance(rows, list) else None)

    st, total = count()
    check(f"the live corpus holds {EXPECTED_TOTAL} rows", st == 200 and total == EXPECTED_TOTAL, f"{st} {total}")
    st, bg04 = count(f"source=eq.{BG04_SOURCE}")
    check(f"every row is source={BG04_SOURCE}", st == 200 and bg04 == EXPECTED_TOTAL, f"{st} {bg04}")
    st, retired = count(f"source=eq.{RETIRED_SOURCE}")
    check("no PLACEHOLDER-DEV rows remain", st == 200 and retired == 0, f"{st} {retired}")
    st, null_emb = count("embedding=is.null")
    check("no row has a null embedding", st == 200 and null_emb == 0, f"{st} {null_emb}")
    st, stamped = count(f"embed_model=eq.{EMBED_MODEL}")
    check(f"every row is stamped {EMBED_MODEL}", st == 200 and stamped == EXPECTED_TOTAL, f"{st} {stamped}")

    st, body = dev_smoke("seed-exemplars")
    check(
        "a bare seed-exemplars is a 400 (never re-embeds the live corpus by default)",
        st == 400 and isinstance(body, dict) and body.get("ok") is False,
        f"{st} {body}",
    )
    st, body = dev_smoke("clear-exemplars")
    check(
        "a bare clear-exemplars is a 400 (never clears the live corpus by default)",
        st == 400 and isinstance(body, dict) and body.get("ok") is False,
        f"{st} {body}",
    )
    st, body = dev_smoke("seed-exemplars", source="NOT-A-SOURCE")
    check("an unknown seed source is a 400", st == 400, f"{st} {body}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    args = ap.parse_args()

    static_checks()
    if not args.static_only:
        live_checks()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:")
        for f in FAILURES:
            print(" - " + f)
        sys.exit(1)
    print("All automated Step 2 checks passed.")


if __name__ == "__main__":
    main()
