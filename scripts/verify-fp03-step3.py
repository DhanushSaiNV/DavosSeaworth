#!/usr/bin/env python3
"""Automate FP-03 Step 3 verification (`match_exemplars` RPC, migration 0025).

Covers PLAN Step 3 Verify: with the exemplars seeded, `?action=match-exemplars` returns one
row per label with sane cosine similarities and a sensible ranking; an anon-key RPC call is
rejected while authenticated and service_role calls succeed; with the corpus cleared the
lookup returns zero rows (the Step 4 fallback trigger, proven at the source).

  AUTOMATED -- static (no network):
    migration : `0025_*.sql` exists, defines `public.match_exemplars(query_embedding
                vector(768))` returning `(set_kind, label, sim)`, aggregates with `group by`
                (no LIMIT — the classifier argmaxes over every label), is `security definer`
                with a pinned `search_path`, revokes the default PUBLIC grant and grants
                authenticated + service_role
    untouched : the migration never names `match_rules` (the recorded drift stays out of
                scope), creates/drops no table/index/policy, and alters nothing
    dev-smoke : registers the `match-exemplars` action (union + `available`)
    docs      : TECH-SPEC §6.2 names the RPC

  AUTOMATED -- live (needs SUPABASE_URL/ANON/SERVICE/DEV_SMOKE_TOKEN, 0025
  applied, dev-smoke redeployed; the user JWT is minted if unset; temporarily sets
  `llm_stub_mode`, always restored):
    shape     : 24 rows at full seed (16 domain / 6 emotion / 2 quit_signal), every sim in
                [-1, 1]
    math      : a seeded text sent back verbatim ranks its OWN label #1 with sim >= 0.95 --
                the aggregation + cosine check, independent of embedding quality
    ranking   : two domain-flavored probes put the intended domain inside that set's top 3
                (full rankings printed for Step 6 calibration; Step 6 owns accuracy)
    grants    : anon is denied; authenticated and service_role both succeed
    drift     : informational only -- whether `match_rules` still answers an anon key
    empty     : after clear-exemplars the lookup returns 0 rows, then the corpus is restored

Usage (PowerShell):
  $env:SUPABASE_URL="https://<project>.supabase.co"
  $env:SUPABASE_ANON_KEY="<anon-key>"
  $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
  $env:DAVOS_USER_JWT="<optional; a fresh one is minted if unset>"
  $env:DEV_SMOKE_TOKEN="<dev-smoke bearer token>"
  python scripts/verify-fp03-step3.py [--static-only]

PREREQUISITES: migration 0025 applied (`supabase db push`) AND `dev-smoke` redeployed. The
live section writes `llm_stub_mode` and restores it in a `finally`; it leaves the 228
placeholder exemplars seeded.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _fp03_corpus import PLACEHOLDER_SOURCE, seed_corpus  # noqa: E402

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

EXPECTED_TOTAL = 228
EXPECTED_SET_ROWS = {"domain": 16, "emotion": 6, "quit_signal": 2}
EXPECTED_LOOKUP_ROWS = 24
SELF_MATCH_MIN_SIM = 0.95
MIG_REL_PREFIX = "0025"
# Domain-flavoured probes; intended domain must land inside the set's top 3.
DOMAIN_PROBES = [
    ("Fitness", "I skipped the gym all week and my knees hurt when I squat."),
    ("Finance", "I checked my bank account and there is less in it than I thought."),
]


def read_text(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def strip_sql_comments(text):
    """Drop `-- ...` line comments so structural checks see statements only.

    The migration header deliberately discusses `match_rules` and `LIMIT`; assertions about
    what the migration *does* must not trip over prose about what it does not do.
    """
    return "\n".join(re.sub(r"--.*$", "", ln) for ln in text.splitlines())


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


def exemplar_rows(query="id"):
    st, rows = req("GET", f"/rest/v1/exemplars?select={query}&limit=1000", key=ANON, headers=authed())
    return st, (rows if isinstance(rows, list) else [])


def exemplar_count():
    st, rows = exemplar_rows("id")
    return (len(rows) if st == 200 else None), st


def placeholder_count():
    """(rows, status) for the placeholder subset -- the paced seed's short-circuit/resume point.

    Service role on purpose: an RLS-filtered read answers 200 with 0 rows, which would look
    exactly like an empty corpus and send the seeder back to offset 0 for no reason.
    """
    st, rows = req(
        "GET",
        f"/rest/v1/exemplars?select=id&source=eq.{PLACEHOLDER_SOURCE}&limit=1000",
        key=SERVICE,
    )
    return (len(rows) if st == 200 else None), st


def const_vector():
    return [0.01] * 768


def rpc_match_exemplars(key, headers=None, vector=None):
    body = {"query_embedding": vector if vector is not None else const_vector()}
    return req("POST", "/rest/v1/rpc/match_exemplars", body, key=key, headers=headers)


def domains_ranking(rows):
    """Return [(label, sim)] for the domain set, best first."""
    dom = [r for r in rows if r.get("set_kind") == "domain"]
    dom.sort(key=lambda r: -r.get("sim", 0))
    return [(r["label"], r["sim"]) for r in dom]


# ---------------------------------------------------------------------------
# A. static checks
# ---------------------------------------------------------------------------


def static_checks():
    print("== A. static (no network) ==")

    migs = [
        n
        for n in os.listdir(os.path.join(ROOT, "supabase", "migrations"))
        if n.startswith(MIG_REL_PREFIX) and n.endswith(".sql")
    ]
    check("0025 migration exists (exactly one)", len(migs) == 1, f"{migs}")
    if len(migs) != 1:
        return
    mig_rel = f"supabase/migrations/{migs[0]}"
    info("migration", mig_rel)
    body = read_text(mig_rel) or ""
    sql = strip_sql_comments(body)

    check(
        "defines public.match_exemplars(query_embedding vector(768))",
        re.search(
            r"create or replace function public\.match_exemplars\(\s*query_embedding vector\(768\)\s*\)",
            sql,
            re.I,
        )
        is not None,
    )
    check(
        "returns (set_kind text, label text, sim double precision)",
        re.search(
            r"returns table \(set_kind text,\s*label text,\s*sim double precision\)",
            sql,
            re.I,
        )
        is not None,
    )
    check("is security definer", re.search(r"\bsecurity definer\b", sql, re.I) is not None)
    check("pins search_path", re.search(r"set search_path = public", sql, re.I) is not None)
    check(
        "revokes the default PUBLIC/anon grant",
        re.search(
            r"revoke execute on function public\.match_exemplars\(vector\(768\)\) from public, anon",
            sql,
            re.I,
        )
        is not None,
    )
    check(
        "grants authenticated + service_role",
        re.search(
            r"grant execute on function public\.match_exemplars\(vector\(768\)\) to authenticated, service_role",
            sql,
            re.I,
        )
        is not None,
    )
    check(
        "aggregates per (set_kind, label) with no LIMIT",
        re.search(r"group by e\.set_kind, e\.label", sql, re.I) is not None
        and re.search(r"\blimit\b", sql, re.I) is None,
    )
    check("uses pgvector cosine distance", "<=>" in sql)

    # The recorded match_rules drift stays out of scope: this migration must not touch it,
    # and must not add any other schema object.
    check("migration does not touch match_rules", "match_rules" not in sql)
    check(
        "migration creates/drops no table, index or policy",
        re.search(r"\b(create|drop)\s+(table|index|policy)\b", sql, re.I) is None
        and re.search(r"\balter\s+table\b", sql, re.I) is None,
    )

    smoke = read_text("supabase/functions/dev-smoke/index.ts") or ""
    check(
        "dev-smoke registers the match-exemplars action (union + available)",
        smoke.count('"match-exemplars"') >= 2,
        f"{smoke.count('\"match-exemplars\"')}",
    )
    check("dev-smoke calls the RPC", 'rpc("match_exemplars"' in smoke)

    gloss = read_text("docs/GLOSSARY.md") or ""
    gloss_n = re.sub(r"[ \t]+", " ", gloss)  # table-padding tolerant
    smoke_row = [ln for ln in gloss_n.splitlines() if ln.startswith("| `dev-smoke` |")]
    check(
        "GLOSSARY §13 dev-smoke row lists the new action",
        bool(smoke_row) and "match-exemplars" in smoke_row[0],
        f"{smoke_row}",
    )

    tech = read_text("docs/TECH-SPEC.md") or ""
    sec62 = tech.split("### 6.2", 1)[-1].split("### 6.3", 1)[0] if "### 6.2" in tech else ""
    check("TECH-SPEC §6.2 names match_exemplars", "match_exemplars" in sec62, f"{sec62[:160]}")


# ---------------------------------------------------------------------------
# B. live checks
# ---------------------------------------------------------------------------


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
    print("== B. live (needs env; 0025 applied; dev-smoke redeployed) ==")
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

    if not SMOKE_TOKEN:
        print("  SKIP live section -- need DEV_SMOKE_TOKEN")
        return

    stub_snapshot = get_config("llm_stub_mode")
    info("llm_stub_mode snapshot", repr(stub_snapshot))
    seeded_ok = False

    try:
        if not set_config("llm_stub_mode", False):
            check("could set llm_stub_mode=false", False, "config PATCH failed")
            return

        # --- corpus seeded (idempotent; paced, so a complete corpus is not re-embedded) ---
        st, body = seed_corpus(dev_smoke, placeholder_count, EXPECTED_TOTAL)
        check("seed-exemplars returns 200", st == 200, f"{st} {body}")
        st, total = exemplar_count()
        check("corpus holds 228 rows", st == 200 and total == EXPECTED_TOTAL, f"{st} {total}")

        # --- shape + math: a seeded text returned verbatim must top its own label ---
        st, rows = exemplar_rows("text,label&set_kind=eq.domain&limit=1")
        check("read a seeded domain text", st == 200 and len(rows) == 1, f"{st} {rows}")
        if st != 200 or not rows:
            return
        probe_text, probe_label = rows[0]["text"], rows[0]["label"]
        info("self-match probe", f"{probe_label}: {probe_text[:60]}...")

        st, body = dev_smoke("match-exemplars", text=probe_text)
        body = body if isinstance(body, dict) else {}
        check("match-exemplars returns 200", st == 200, f"{st} {body}")
        lookup = body.get("rows") or []
        check(
            f"lookup returns {EXPECTED_LOOKUP_ROWS} label rows",
            body.get("count") == EXPECTED_LOOKUP_ROWS and len(lookup) == EXPECTED_LOOKUP_ROWS,
            f"{body.get('count')}",
        )
        by_set: dict[str, int] = {}
        for r in lookup:
            by_set[r["set_kind"]] = by_set.get(r["set_kind"], 0) + 1
        check(
            "one row per label in each set (16 / 6 / 2)",
            by_set == EXPECTED_SET_ROWS,
            f"{by_set}",
        )
        sims = [r["sim"] for r in lookup]
        check(
            "every similarity is a sane cosine value",
            sims and all(-1.0001 <= s <= 1.0001 for s in sims),
            f"min={min(sims) if sims else None} max={max(sims) if sims else None}",
        )

        ranking = domains_ranking(lookup)
        top_label, top_sim = ranking[0] if ranking else (None, None)
        check(
            "a seeded text ranks its own label #1 with sim >= 0.95",
            top_label == probe_label and top_sim is not None and top_sim >= SELF_MATCH_MIN_SIM,
            f"got {top_label} {top_sim} (want {probe_label} >= {SELF_MATCH_MIN_SIM})",
        )

        # --- ranking sanity on fresh probes (accuracy is Step 6's gate) ---
        for want, probe in DOMAIN_PROBES:
            st, body = dev_smoke("match-exemplars", text=probe)
            rank = domains_ranking((body or {}).get("rows") or [])
            info(f"ranking for '{probe[:44]}...'", [f"{lbl} {sim:.3f}" for lbl, sim in rank[:5]])
            check(
                f"'{want}' probe lands in the domain top 3",
                st == 200 and want in [lbl for lbl, _ in rank[:3]],
                f"got {[lbl for lbl, _ in rank[:4]]}",
            )

        # --- grants: anon denied, authenticated + service_role allowed ---
        st, _ = rpc_match_exemplars(ANON)
        check("anon RPC call is denied", st not in (200, 206), f"{st}")
        st, _ = rpc_match_exemplars(ANON, authed())
        check("authenticated RPC call succeeds", st in (200, 206), f"{st}")
        st, _ = rpc_match_exemplars(SERVICE)
        check("service_role RPC call succeeds", st in (200, 206), f"{st}")

        # --- informational: the recorded match_rules drift (not asserted) ---
        st, _ = req(
            "POST",
            "/rest/v1/rpc/match_rules",
            {"query_embedding": const_vector(), "match_domain": "Career"},
            key=ANON,
        )
        info("match_rules via anon key (recorded drift, informational)", f"status {st}")

        # --- empty corpus: the Step 4 fallback trigger, at the source ---
        st, _ = dev_smoke("clear-exemplars")
        check("clear-exemplars returns 200", st == 200, f"{st}")
        st, body = dev_smoke("match-exemplars", text=probe_text)
        check(
            "lookup returns 0 rows with the corpus cleared",
            st == 200 and (body or {}).get("count") == 0,
            f"{st} {(body or {}).get('count')}",
        )

        # --- leave the corpus seeded (the clear above emptied it) ---
        st, body = seed_corpus(dev_smoke, placeholder_count, EXPECTED_TOTAL)
        st, total = exemplar_count()
        seeded_ok = st == 200 and total == EXPECTED_TOTAL
        check("corpus restored at the end (228 rows)", seeded_ok, f"{st} {total}")
        st, body = dev_smoke("match-exemplars", text=probe_text)
        check(
            "lookup returns 24 rows again after the restore",
            st == 200 and (body or {}).get("count") == EXPECTED_LOOKUP_ROWS,
            f"{st} {(body or {}).get('count')}",
        )
    finally:
        if stub_snapshot is not None:
            ok = set_config("llm_stub_mode", stub_snapshot)
            print(f"  ..   llm_stub_mode restored to {stub_snapshot!r}: {'ok' if ok else 'FAILED'}")
            if not ok:
                FAILURES.append("llm_stub_mode restore")
        if not seeded_ok:
            dev_smoke("clear-exemplars")
            seed_corpus(dev_smoke, placeholder_count, EXPECTED_TOTAL)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    args = ap.parse_args()

    static_checks()
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
    print("All automated Step 3 checks passed.")


if __name__ == "__main__":
    main()
