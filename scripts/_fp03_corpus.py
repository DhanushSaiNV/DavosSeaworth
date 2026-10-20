"""Shared FP-03 exemplar-corpus seeding for the step gates.

`dev-smoke?action=seed-exemplars` cannot seed a full exemplar slot in one invocation:
Gemini counts *every item* of a `batchEmbedContents` call against the embedding quota
(TECH-SPEC §12 -- 100 RPM / 1,000 RPD, measured at 140/100 RPM in the Cloud console during the
first Step 6 live run), so 228 items need ~2.3 minutes of quota, while one Edge invocation is
capped at 150 s. The action is therefore resumable (`&offset=`/`&limit=`, and the response always
carries `next`/`done`); this helper drives the loop, paces the windows so no rolling minute
exceeds the RPM budget, retries a quota refusal (429) after a backoff, and returns an aggregate
body shaped like the old single-call one (`seeded`/`sets`/`embedCalls`).

Callers supply two of their own helpers:

    dev_smoke(action, **params) -> (status, body)
    count() -> (rows, status)   # rows in the selected source's subset of `exemplars`

`count()` is expected to read the selected source (for example
`exemplars?source=eq.BG-04&select=id`) with whatever credentials the calling gate already
uses for the corpus.
"""

from __future__ import annotations

import time

PLACEHOLDER_SOURCE = "PLACEHOLDER-DEV"
SEED_WINDOW = 80        # items per call: <= the API's 100-request cap and the per-minute budget
SEED_PACE_S = 65.0      # > 60 s, so no rolling minute sees two windows (80 items <= 100 RPM)
SEED_RETRY_S = 30.0     # backoff after a quota refusal
SEED_DEADLINE_S = 900.0  # give up when a window keeps refusing (a full seed needs ~3 min)


def seed_corpus(
    dev_smoke,
    count,
    total,
    *,
    source=PLACEHOLDER_SOURCE,
    force=False,
    window=SEED_WINDOW,
    pace=SEED_PACE_S,
    retry=SEED_RETRY_S,
    deadline=SEED_DEADLINE_S,
    say=print,
):
    """Seed the placeholder corpus window by window. Returns (status, body).

    A complete corpus is left alone -- every re-seed costs `total` embedding units (~23% of the
    daily RPD) -- unless `force=True`, which a gate needs when a real re-embed *is* the thing it
    verifies (Step 2's seed and idempotence legs). An incomplete corpus resumes at the last
    window boundary instead of re-embedding what is already there. A non-200 window is passed
    straight through, so a stub-mode 400 still reaches the caller unchanged.

    The aggregate `sets` accumulates the windows *this call* seeded, so it is empty when a
    complete corpus was reused; `seeded` is the corpus's own placeholder count after the run.
    """
    started = time.monotonic()
    rows, st = count()
    if st != 200:
        return st, {"ok": False, "error": f"the exemplar corpus is unreadable (HTTP {st})"}
    if rows == total and not force:
        return 200, {"ok": True, "seeded": rows, "sets": {}, "embedCalls": 0, "reused": True}
    if rows > total:
        # Never delete a larger slot to make it fit a smaller expected count. A stale
        # caller (the 233-vs-228 mismatch on 2026-10-20) must fail loudly instead of
        # destroying already-embedded rows.
        return 409, {
            "ok": False,
            "error": f"the exemplar corpus has {rows} rows but the caller expected {total}; refusing to reset",
        }

    offset = rows if 0 < rows < total and rows % window == 0 else 0
    embed_calls = 0
    sets = {}
    while offset < total:
        st, body = dev_smoke("seed-exemplars", source=source, offset=offset, limit=window)
        if st == 429:
            if time.monotonic() - started > deadline:
                return st, (body if isinstance(body, dict) else {"raw": body})
            say(f"  ..   embedding quota (429) at offset {offset} -- waiting {retry:.0f}s")
            time.sleep(retry)
            continue
        if st != 200 or not isinstance(body, dict) or body.get("ok") is not True:
            return st, (body if isinstance(body, dict) else {"raw": body})
        nxt = body.get("next")
        if not isinstance(nxt, int) or nxt <= offset:
            return st, {"ok": False, "error": f"the seed did not advance from offset {offset}: {body}"}
        calls = body.get("embedCalls")
        embed_calls += calls if isinstance(calls, int) else 0
        for kind, n in (body.get("sets") or {}).items():
            sets[kind] = sets.get(kind, 0) + n
        offset = nxt
        if body.get("done"):
            break
        say(f"  ..   seeded {body.get('seeded')} ({offset}/{total}) -- pacing {pace:.0f}s")
        time.sleep(pace)

    rows, st = count()
    if st != 200:
        return st, {"ok": False, "error": f"the exemplar corpus is unreadable (HTTP {st})"}
    return 200, {"ok": True, "seeded": rows, "sets": sets, "embedCalls": embed_calls, "reused": False}
