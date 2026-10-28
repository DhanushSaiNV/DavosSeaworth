#!/usr/bin/env python3
"""Decision 27 / TECH-SPEC §7.13 - account lifecycle: data reset + account deletion.

Static (no network):
  migration : 0034 defines both SECURITY DEFINER functions, the per-user advisory lock,
              service-role-only grants, the jobs-payload delete, and the kill-switch seed
  function  : delete-account derives the user from the JWT, validates the exact
              confirmation word, honours the kill switch, and treats a 404 as success
  client    : lib/account.ts clears every device cache and signs out locally; the
              Settings Account card is gated and type-to-confirm; reset routes to the
              interview without refreshSession()
  content   : the copy file is explicitly status=draft|approved and keeps {word}
  drill     : dev-smoke registers account-drill in the type union and available list
  docs      : Decision 27, TECH-SPEC §7.13 + config registry, GLOSSARY terms

Live (network; skipped by --static-only or a missing DEV_SMOKE_TOKEN):
  drill     : dev-smoke?action=account-drill&leg=full runs the disposable-user drill
              against the deployed endpoint (reset, then delete, then a stale token)

Usage: python scripts/verify-account-lifecycle.py [--static-only]
Exit 0 = all checks pass.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRATION = "supabase/migrations/0034_account_lifecycle.sql"
FUNCTION = "supabase/functions/delete-account/index.ts"
CONTRACT = "supabase/functions/_shared/account/lifecycleContract.ts"
CLIENT = "lib/account.ts"
CARD = "components/AccountCard.tsx"
SETTINGS = "app/(app)/settings.tsx"
COPY = "content/ui-copy/account-settings.json"
SMOKE = "supabase/functions/dev-smoke/index.ts"
DECISIONS = "docs/adr/decisions2.md"
TECH = "docs/TECH-SPEC.md"
GLOS = "docs/GLOSSARY.md"

FAILS: list[str] = []


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"  {'PASS' if ok else 'FAIL'} {name}" + (f" -- {detail}" if detail and not ok else ""))
    if not ok:
        FAILS.append(name)
    return ok


def env(*names: str) -> str | None:
    for name in names:
        if os.environ.get(name):
            return os.environ[name]
    return None


def main() -> int:
    static_only = "--static-only" in sys.argv

    print("== migration 0034 ==")
    migration = read(MIGRATION)
    check(
        "purge_user_data defined",
        "create or replace function public.purge_user_data(p_user_id uuid)" in migration,
    )
    check(
        "reset_user_data defined",
        "create or replace function public.reset_user_data(p_user_id uuid)" in migration,
    )
    check(
        "per-user advisory lock (0032's key)",
        "pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0))" in migration,
    )
    check(
        "jobs deleted by payload",
        "delete from public.jobs" in migration and "payload ->> 'user_id'" in migration,
    )
    check(
        "facts deleted before their source messages",
        migration.index("delete from public.memory_facts")
        < migration.index("delete from public.messages"),
    )
    check(
        "execute revoked from public roles",
        migration.count("revoke execute on function") >= 2
        and migration.count("from public, anon, authenticated") >= 2,
    )
    check("execute granted to service_role only", migration.count("to service_role") >= 2)
    check("kill switch seeded", "account_lifecycle_enabled" in migration)
    check(
        "reset recreates the profile after the purge",
        migration.index("v_counts := public.purge_user_data(p_user_id);")
        < migration.index("insert into public.profiles"),
    )

    print("== delete-account function ==")
    fn = read(FUNCTION)
    check("user comes from the JWT", "resolveUserId(req)" in fn)
    check("shared contract parser used", "parseAccountBody(body)" in fn)
    check(
        "kill switch read per request",
        'getConfigBoolean("account_lifecycle_enabled")' in fn,
    )
    check(
        "purge precedes admin delete",
        fn.index('rpc("purge_user_data"') < fn.index("auth.admin.deleteUser(userId)"),
    )
    check("admin 404 treated as success", "status !== 404" in fn)
    check("no id from the request body", "body.user_id" not in fn and "body.userId" not in fn)
    check(
        "reset path calls reset_user_data",
        'rpc("reset_user_data"' in fn,
    )
    contract = read(CONTRACT)
    check(
        "confirmation is exact and case-sensitive",
        "if (confirm !== expected)" in contract
        and 'return mode === "reset" ? "RESET" : "DELETE";' in contract,
    )

    print("== client ==")
    client = read(CLIENT)
    for symbol in ("resetAccountData", "deleteAccount", "clearLocalAccountState"):
        check(f"exports {symbol}", f"export async function {symbol}" in client)
    check(
        "never refreshes the session",
        "supabase.auth.refreshSession" not in client and ".refreshSession(" not in client,
    )
    check("signs out locally", 'scope: "local"' in client)
    for call in (
        "clearSendQueue",
        "clearCheckinState",
        "cancelCheckins",
        "clearLoadedGrid",
        "disarmImpulseNotification",
    ):
        check(f"clears {call}", call in client)
    check(
        "send queue exposes clearSendQueue",
        "export async function clearSendQueue" in read("lib/sendQueue.ts"),
    )
    check(
        "check-in queue exposes clearCheckinState",
        "export async function clearCheckinState" in read("lib/checkinQueue.ts"),
    )
    check("check-ins expose clearLoadedGrid", "export function clearLoadedGrid" in read("lib/checkins.ts"))

    print("== UI ==")
    card = read(CARD)
    settings = read(SETTINGS)
    check("card is mounted in Settings", "<AccountCard devTools={devTools} />" in settings)
    check("reset shares the Developer gate", "devTools ? (" in card)
    check("type-to-confirm is exact", "typed === word" in card)
    check(
        "reset navigates to the interview",
        "router.replace('/(onboarding)/interview')" in card,
    )
    copy = json.loads(read(COPY))
    check("copy has an explicit review status", copy.get("status") in ("draft", "approved"))
    check("copy keeps the {word} placeholder", "{word}" in copy["strings"]["confirm_label"])

    print("== drill ==")
    smoke = read(SMOKE)
    check("account-drill in the action union", '| "account-drill"' in smoke)
    check("account-drill listed as available", '"account-drill",' in smoke)
    check("drill calls the real endpoint", "/functions/v1/delete-account" in smoke)
    check("drill creates a disposable user", "auth.admin.createUser" in smoke)
    check("drill asserts the opening survives reset", "opening_messages" in smoke)

    print("== docs ==")
    check("Decision 27 recorded", "Decision 27 — Account lifecycle" in read(DECISIONS))
    tech = read(TECH)
    check("TECH-SPEC §7.13 present", "### 7.13 Account lifecycle (Decision 27)" in tech)
    check("kill switch in the §11 registry", "| `account_lifecycle_enabled` |" in tech)
    check("§14 records the completion", "Account lifecycle (Decision 27 / §7.13)" in tech)
    glos = read(GLOS)
    check("GLOSSARY edge-function row", "| `delete-account`" in glos)
    check("GLOSSARY account term", "| **Account lifecycle**" in glos)
    check("GLOSSARY config key listed", "account_lifecycle_enabled" in glos)

    if static_only:
        print("\nlive drill skipped (--static-only)")
    else:
        url = (env("SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
        token = env("DEV_SMOKE_TOKEN")
        if not url or not token:
            print("\n  SKIP live -- need SUPABASE_URL and DEV_SMOKE_TOKEN")
        else:
            print("== live drill ==")
            query = urllib.parse.urlencode({"action": "account-drill", "leg": "full"})
            request = urllib.request.Request(
                f"{url}/functions/v1/dev-smoke?{query}",
                method="POST",
                headers={"Authorization": f"Bearer {token}"},
            )
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    status = response.status
                    body = json.loads(response.read().decode() or "null")
            except urllib.error.HTTPError as err:
                status = err.code
                raw = err.read().decode()
                try:
                    body = json.loads(raw)
                except Exception:  # noqa: BLE001
                    body = {"raw": raw[:400]}
            except Exception as err:  # noqa: BLE001
                status, body = 0, {"raw": str(err)}

            check("drill responded 200", status == 200, f"{status} {body}")
            report = body if isinstance(body, dict) else {}
            checks = report.get("checks") or {}
            check("drill reports ok", report.get("ok") is True, json.dumps(report)[:600])
            check("wrong word refused (400)", checks.get("refusal_status") == 400)
            check("reset returned 200", checks.get("reset_status") == 200)
            check("delete returned 200", checks.get("delete_status") == 200)
            check("stale token refused (401)", checks.get("stale_token_status") == 401)
            check("auth user survived reset", checks.get("auth_survived_reset") is True)
            check("auth user gone after delete", checks.get("auth_gone_after_delete") is True)

            after_reset = (report.get("reset") or {}).get("counts") or {}
            check("reset kept exactly one profile", after_reset.get("profiles") == 1)
            check(
                "reset left only the opening message",
                after_reset.get("opening_messages", 0) > 0
                and after_reset.get("messages") == after_reset.get("opening_messages"),
            )
            zeroed = [
                key
                for key in (
                    "doings_logs",
                    "journal_entries",
                    "metrics",
                    "metric_points",
                    "anchor_plans",
                    "habits",
                    "persona_stats",
                    "trust_events",
                    "push_tokens",
                    "memory_facts",
                    "jobs",
                )
                if after_reset.get(key) != 0
            ]
            check("reset wiped every other table", not zeroed, ",".join(zeroed))

            after_delete = (report.get("delete") or {}).get("counts") or {}
            remaining = {key: value for key, value in after_delete.items() if value != 0}
            check("delete left zero rows", not remaining, json.dumps(remaining))

    print()
    if FAILS:
        print(f"FAILED ({len(FAILS)}): {', '.join(FAILS)}")
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
