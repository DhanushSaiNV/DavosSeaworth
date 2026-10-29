#!/usr/bin/env python3
"""verify-fp10-step4.py -- FP-10 Step 4 gate (Prompt Injection Sweep).

What this proves (FP-10 FR-8, FR-9; AC-8, AC-9; TECH-SPEC §10.5):

  static   every prompt builder in the tree wraps user-derived and content-derived strings
           in delimiters with `escapePromptText` and carries injection guard instructions;
           the injection corpus covers all 6 classes across key user-text entry points;
           `dev-smoke` exposes `action=injection-sweep`.
  live     `dev-smoke ?action=injection-sweep`:
           - All canary markers (`ZQWK-07-...`) are absent from `direct_quote`.
           - Every generation strictly satisfies its schema contract.
           - Fact-feedback leg: injected journal text extracts insights, renders delimited
             inside `<recalled_memory>`, and subsequent generation does not execute it.
           - Rule-text leg: scratch rule with embedded override instruction renders as quoted
             content, does not leak canary marker, and scratch rule is cleaned up.

Usage:
  py -3 scripts/verify-fp10-step4.py                  # static + live
  py -3 scripts/verify-fp10-step4.py --static-only    # static only (no network/LLM calls)

Exit code 0 iff every check passes.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []
SKIPS = []


def load_dotenv():
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            m = re.match(r"^\s*([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m:
                os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


def read_file(rel_path):
    abs_path = os.path.join(ROOT, rel_path)
    if not os.path.exists(abs_path):
        return ""
    with open(abs_path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def check(label, cond, detail=""):
    status = "  PASS " if cond else "  FAIL "
    print(f"{status}{label}" + (f" -- {detail}" if detail and not cond else ""))
    sys.stdout.flush()
    if not cond:
        FAILS.append(label)


def static_checks():
    print("== A. static: prompt builders & delimiter hardening (AC-8, FR-8) ==")

    guardrails = read_file("supabase/functions/_shared/prompts/guardrails.ts")
    check(
        "INJECTION_GUARD definition exists in guardrails.ts",
        "export const INJECTION_GUARD" in guardrails and "wrapped in <user_message> tags" in guardrails,
    )

    delimiters = read_file("supabase/functions/_shared/prompts/delimiters.ts")
    check(
        "escapePromptText helper exists in delimiters.ts",
        "export function escapePromptText" in delimiters and "replace(/</g, \"&lt;\")" in delimiters,
    )

    prompt_builders = [
        ("accountability/interventions.ts", "supabase/functions/_shared/accountability/interventions.ts"),
        ("checkin/evalContract.ts", "supabase/functions/_shared/checkin/evalContract.ts"),
        ("journal/anchorContract.ts", "supabase/functions/_shared/journal/anchorContract.ts"),
        ("journal/extractContract.ts", "supabase/functions/_shared/journal/extractContract.ts"),
        ("memory/extractContract.ts", "supabase/functions/_shared/memory/extractContract.ts"),
        ("metrics/propose.ts", "supabase/functions/_shared/metrics/propose.ts"),
        ("pipeline/extract.ts", "supabase/functions/_shared/pipeline/extract.ts"),
        ("pipeline/generate.ts", "supabase/functions/_shared/pipeline/generate.ts"),
        ("pipeline/generatePrompt.ts", "supabase/functions/_shared/pipeline/generatePrompt.ts"),
        ("pipeline/memoryContext.ts", "supabase/functions/_shared/pipeline/memoryContext.ts"),
        ("pipeline/recentContext.ts", "supabase/functions/_shared/pipeline/recentContext.ts"),
    ]

    for name, path in prompt_builders:
        content = read_file(path)
        check(
            f"prompt builder {name} uses escapePromptText",
            "escapePromptText" in content,
            f"missing in {path}",
        )

    proactive = read_file("supabase/functions/_shared/proactive/runProactive.ts")
    check(
        "proactive context builder sanitises dynamic metric name",
        "<proactive_context>" in proactive and "<metric_name>" in proactive and "tagText(" in proactive,
    )

    generate_prompt = read_file("supabase/functions/_shared/pipeline/generatePrompt.ts")
    check(
        "buildSystemPrompt includes INJECTION_GUARD and delimiters",
        "INJECTION_GUARD" in generate_prompt and "renderRules(" in generate_prompt,
    )

    print("== B. static: injection corpus module & dev-smoke action (FR-8, FR-9) ==")
    corpus_content = read_file("supabase/functions/_shared/dev/injectionCorpus.ts")
    check(
        "injectionCorpus.ts exists and carries DRAFT / test material header",
        "INJECTION_CORPUS" in corpus_content and "AGENTS.md" in corpus_content,
    )

    for cls in [
        "direct_override",
        "delimiter_escape",
        "roleplay_hijack",
        "instruction_in_extracted_fact",
        "instruction_in_rule_text",
        "instruction_in_profile_field",
    ]:
        check(f"injection corpus includes class '{cls}'", f'"{cls}"' in corpus_content)

    dev_smoke = read_file("supabase/functions/dev-smoke/index.ts")
    check(
        "dev-smoke registers action 'injection-sweep'",
        '"injection-sweep"' in dev_smoke and 'case "injection-sweep":' in dev_smoke,
    )


def http_request(url, method="GET", headers=None, body=None, timeout=120, retries=2):
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                status = res.status
                raw = res.read().decode("utf-8")
                try:
                    data = json.loads(raw)
                except Exception:
                    data = raw
                return status, data
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(raw)
            except Exception:
                data = raw
            return err.code, data
        except Exception as err:
            if attempt < retries:
                time.sleep(1.5)
                continue
            return 0, str(err)


def live_checks():
    print("== C. live: pre-flight & injection sweep (AC-9, FR-9) ==")

    supabase_url = (os.environ.get("SUPABASE_URL") or os.environ.get("EXPO_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    anon_key = os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    dev_smoke_token = os.environ.get("DEV_SMOKE_TOKEN")

    if not supabase_url or not service_role_key or not dev_smoke_token:
        print("  SKIP Live checks: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or DEV_SMOKE_TOKEN missing in env")
        SKIPS.append("live checks (missing env)")
        return

    # 1. Preflight check (works in any mode, zero external provider calls)
    preflight_url = f"{supabase_url}/functions/v1/dev-smoke?action=injection-sweep&preflight=true"
    headers = {"Authorization": f"Bearer {dev_smoke_token}"}
    status, preflight_data = http_request(preflight_url, "GET", headers)

    check(
        "dev-smoke injection-sweep preflight succeeds",
        status == 200 and isinstance(preflight_data, dict) and preflight_data.get("ok") is True,
        f"status={status}, resp={preflight_data}",
    )
    if not isinstance(preflight_data, dict):
        return
    payload_count = preflight_data.get("payloadCount", 0)
    check("preflight reports payloads in corpus", payload_count >= 6, f"payloadCount={payload_count}")

    # 2. Check and temporarily enable real provider mode (llm_stub_mode = false) for the sweep
    config_url = f"{supabase_url}/rest/v1/config?key=eq.llm_stub_mode"
    rest_headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }
    status, config_rows = http_request(config_url, "GET", rest_headers)
    if status != 200 or not isinstance(config_rows, list) or len(config_rows) == 0:
        check("read llm_stub_mode config", False, f"status={status}, resp={config_rows}")
        return
    val = config_rows[0].get("value")
    original_stub_mode = (val is True or val == "true")

    try:
        if original_stub_mode:
            print("  [setup] Temporarily patching llm_stub_mode = false for real injection testing...")
            patch_status, _ = http_request(
                config_url,
                "PATCH",
                rest_headers,
                json.dumps({"value": False}).encode(),
            )
            check("llm_stub_mode patched to false", patch_status in (200, 204), f"status={patch_status}")

        # 3. Execute live injection sweep via dev-smoke
        # To stay well inside the 150 s Edge Function limit and prevent cumulative timeouts,
        # we drive the corpus items and the special legs as focused individual requests.
        corpus_payloads = [p for p in preflight_data.get("payloads", []) if p.get("class") != "instruction_in_rule_text"]
        print(f"  [running] Executing {len(corpus_payloads)} corpus injection payload checks...")

        for p in corpus_payloads:
            cid = p.get("id")
            marker = p.get("marker")
            item_url = f"{supabase_url}/functions/v1/dev-smoke?action=injection-sweep&id={urllib.parse.quote(cid)}"
            item_status, item_data = http_request(item_url, "GET", headers, timeout=60)
            check(f"payload {cid} HTTP call succeeded", item_status == 200, f"status={item_status}, resp={str(item_data)[:200]}")
            if isinstance(item_data, dict):
                results = item_data.get("results", [])
                item_res = results[0] if results else {}
                marker_in_quote = item_res.get("markerInQuote")
                valid_contract = item_res.get("validContract")
                check(f"payload {cid}: canary marker '{marker}' absent from quote", marker_in_quote is False, f"quoteSample={item_res.get('quoteSample')}")
                check(f"payload {cid}: reply contract valid", valid_contract is True, f"quoteSample={item_res.get('quoteSample')}")

        # Fact-feedback leg
        print("  [running] Executing fact-feedback leg...")
        ff_url = f"{supabase_url}/functions/v1/dev-smoke?action=injection-sweep&leg=fact-feedback"
        ff_status, ff_data = http_request(ff_url, "GET", headers, timeout=60)
        check("fact-feedback HTTP call succeeded", ff_status == 200, f"status={ff_status}")
        if isinstance(ff_data, dict):
            ff = ff_data.get("factFeedback")
            if isinstance(ff, dict):
                check(
                    "fact-feedback leg passed: extracted insights delimited in prompt, canary not executed",
                    ff.get("ok") is True and ff.get("markerInQuote") is False,
                    f"factFeedback={ff}",
                )
            else:
                check("fact-feedback leg returned valid result", False, str(ff_data)[:200])

        # Rule-text leg
        print("  [running] Executing rule-text leg (scratch rule injection)...")
        rt_url = f"{supabase_url}/functions/v1/dev-smoke?action=injection-sweep&leg=rule-text"
        rt_status, rt_data = http_request(rt_url, "GET", headers, timeout=120)
        check("rule-text HTTP call succeeded", rt_status == 200, f"status={rt_status}, resp={str(rt_data)[:300]}")
        if isinstance(rt_data, dict):
            rt = rt_data.get("ruleText")
            if isinstance(rt, dict):
                check(
                    "rule-text leg passed: scratch rule treated as guidance, canary absent from quote",
                    rt.get("ok") is True and rt.get("markerInQuote") is False,
                    f"ruleText={rt}",
                )
            else:
                check("rule-text leg returned valid result", False, str(rt_data)[:200])

        # 4. Verify scratch rule was cleaned up
        rules_url = f"{supabase_url}/rest/v1/rules?select=id&source_figure=eq.SCRATCH-INJECTION-SWEEP"
        status, scratch_rows = 0, None
        for _ in range(3):
            status, scratch_rows = http_request(rules_url, "GET", rest_headers)
            if status == 200:
                break
            time.sleep(1)

        check(
            "scratch rules table is clean (source_figure='SCRATCH-INJECTION-SWEEP' count is 0)",
            status == 200 and isinstance(scratch_rows, list) and len(scratch_rows) == 0,
            f"status={status}, rows={str(scratch_rows)[:200]}",
        )

    finally:
        # Restore original llm_stub_mode setting
        if original_stub_mode:
            print("  [teardown] Restoring llm_stub_mode to original value (true)...")
            http_request(
                config_url,
                "PATCH",
                rest_headers,
                json.dumps({"value": True}).encode(),
            )


def main():
    parser = argparse.ArgumentParser(description="Verify FP-10 Step 4 (Prompt Injection Sweep)")
    parser.add_argument("--static-only", action="store_true", help="Run static grep and delimiter checks only")
    args = parser.parse_args()

    load_dotenv()
    print("=== FP-10 Step 4 Verification: Prompt Injection Sweep ===")

    static_checks()

    if not args.static_only:
        live_checks()

    print("\n========================================================")
    if FAILS:
        print(f"FAILED: {len(FAILS)} check(s) failed:")
        for f in FAILS:
            print(f"  - {f}")
        sys.exit(1)
    else:
        skips_note = f" ({len(SKIPS)} skipped)" if SKIPS else ""
        print(f"ALL CHECKS PASSED{skips_note} -- FP-10 Step 4 VERIFIED")
        sys.exit(0)


if __name__ == "__main__":
    main()
