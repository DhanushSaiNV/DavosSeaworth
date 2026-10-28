#!/usr/bin/env python3
"""FP-06 live-hardening check (migration 0030).

Implementation-only: this script reads the migration and the extraction runner, never docs.
It covers the three gaps found after the first drill:

  1. match_facts cannot be steered to another user by an authenticated caller.
  2. an unsavable flip purges derived facts in the same transaction (queue failure is moot),
     and a racing extraction cannot leave a live fact behind.
  3. a completed extraction slice — including one that returns zero facts — advances a
     durable watermark so the same messages are not re-sent at every boundary.

Run: python scripts/verify-fp06-hardening.py
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "supabase/migrations/0030_memory_hardening_fp06.sql"
RUN = ROOT / "supabase/functions/_shared/memory/runExtract.ts"
FLAG = ROOT / "supabase/functions/flag-unsavable/index.ts"

failures = 0


def check(label: str, condition: bool) -> None:
    global failures
    print(("PASS  " if condition else "FAIL  ") + label)
    if not condition:
        failures += 1


def main() -> int:
    print("== FP-06 hardening (0030) ==\n")

    mig = MIG.read_text(encoding="utf-8") if MIG.exists() else ""
    run = RUN.read_text(encoding="utf-8")
    flag = FLAG.read_text(encoding="utf-8")

    print("-- retrieval caller scope --")
    check("0030 migration exists", bool(mig))
    check(
        "match_facts replacement is present",
        "create or replace function public.match_facts(" in mig,
    )
    check(
        "service_role is the only JWT role that may pass p_user_id",
        "when auth.role() = 'service_role' then p_user_id" in mig,
    )
    check(
        "all other callers are scoped to auth.uid()",
        "else auth.uid()" in mig,
    )
    check(
        "direct SQL/admin is explicit, not a null-role fallback for JWT callers",
        "auth.role() is null and session_user in ('postgres', 'supabase_admin')" in mig,
    )
    check(
        "the 0029 authenticated grant is revoked (public/anon stay revoked too)",
        "revoke execute on function public.match_facts(uuid, vector(768), int) from public, anon, authenticated;"
        in mig
        and "grant execute on function public.match_facts(uuid, vector(768), int) to authenticated"
        not in mig,
    )
    check(
        "service_role is the only executor",
        "grant execute on function public.match_facts(uuid, vector(768), int) to service_role;"
        in mig,
    )

    print("\n-- synchronous purge on the unsavable flip --")
    check(
        "messages trigger is AFTER UPDATE OF unsavable, only on a false -> true flip",
        "after update of unsavable on public.messages" in mig
        and "when (old.unsavable is not true and new.unsavable is true)" in mig,
    )
    check(
        "trigger uses the shared guarded purge predicate",
        "where source_message_id = new.id" in mig
        and "and purged_at is null" in mig
        and "and fact_type <> 'oath'" in mig,
    )
    check(
        "existing orphaned facts are healed by the migration",
        "Heal flags written before this migration" in mig
        and "where m.id = mf.source_message_id" in mig
        and "and m.unsavable = true" in mig,
    )
    check(
        "fact-birth guard exists and row-locks the source message",
        "create trigger memory_facts_purge_unsavable_source" in mig
        and "before insert or update of source_message_id on public.memory_facts" in mig
        and "for share" in mig,
    )
    check(
        "fact-birth guard marks the new row purged",
        "new.purged_at := coalesce(new.purged_at, now());" in mig,
    )

    print("\n-- durable extraction watermark --")
    check(
        "messages.memory_extracted_at column is added",
        "add column if not exists memory_extracted_at timestamptz" in mig,
    )
    check(
        "partial pending index exists",
        "create index if not exists messages_memory_pending_idx" in mig
        and "where memory_extracted_at is null and unsavable = false" in mig,
    )
    check(
        "migration backfills cited and unsavable rows",
        "set memory_extracted_at = coalesce(m.created_at, now())" in mig
        and "m.unsavable = true" in mig
        and "from public.memory_facts f" in mig,
    )
    check(
        "backlog excludes unsavable rows",
        '.eq("unsavable", false)' in run,
    )
    check(
        "backlog excludes already-watermarked rows",
        '.is("memory_extracted_at", null)' in run,
    )
    check(
        "a completed slice writes the watermark",
        ".update({ memory_extracted_at: new Date().toISOString() })" in run,
    )
    check(
        "the marker is written after every slice, not only when facts were written",
        "await markSliceProcessed(userId, slice.map((m) => m.id));" in run
        and "if (facts.length > 0)" in run,
    )
    check(
        "a short embedding batch never reuses one vector for unrelated facts",
        "embeddings?.length === factIds.length" in run
        and "updateData.embedding = embeddings[i]" in run
        and "else if (embeddings[0])" not in run,
    )
    check(
        "the old zero-fact early continue is gone",
        "facts.length === 0) continue" not in run and "facts.length === 0) continue;" not in run,
    )

    print("\n-- the trigger is the sole enqueuer (FP-10 FR-2 supersedes the backup insert) --")
    check(
        "flag-unsavable carries no job write of its own",
        '.from("jobs")' not in flag,
    )
    check(
        "the function states the trigger enqueues for every actor",
        "sole enqueuer" in flag and "purge_memory" in flag,
    )

    print()
    if failures:
        print(f"FAILED: {failures} check(s)")
        return 1
    print("All hardening checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
