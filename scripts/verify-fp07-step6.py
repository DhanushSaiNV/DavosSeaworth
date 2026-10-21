#!/usr/bin/env python3
"""FP-07 Step 6 verification: the dynamic metrics dashboard.

Covers PLAN Step 6 Verify: "tsc + jest clean; the web drill recorded; static asserts --
package.json unchanged (zero new deps), dashboard integrates the metrics section into its
existing Screen layout without raw DOM elements, no client-side metric writes anywhere
(read-only surface)."

  AUTOMATED -- static (no network):
    data       : lib/metricsData.ts is pure; selection, trailing window, component rule,
                 delta, flat/single normalization, progress, heatmap geometry
    components : four registry files import only the data module + theme/ui primitives;
                 no supabase/network/write code
    dashboard  : Screen/PageHeader retained; useFocusEffect + manual refresh; fail-closed
                 metric_history_days; the two read-only PostgREST queries; logger, no console;
                 empty state; toggle + both chart bodies; no raw DOM elements
    writes     : no insert/update/upsert/delete anywhere on the metrics client path
    tests      : the metricsData boundary tables cover 0/1/2/7 points, quest deadline,
                 delta sign, flat series, single-point min=max, and progress edges

  NOT AUTOMATED: the browser render (seeded charts, toggle, empty state). The drill is
  recorded in FP-07-ACCEPTANCE; this script can compile the web bundle with --web-export.

Usage: python scripts/verify-fp07-step6.py [--run-jest] [--web-export]
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = "lib/metricsData.ts"
DATA_TEST = "lib/metricsData.test.ts"
DASH = "app/(app)/dashboard.tsx"
REGISTRY = [
    "components/metrics/StatCard.tsx",
    "components/metrics/TrendLineGraph.tsx",
    "components/metrics/ConsistencyHeatmap.tsx",
    "components/metrics/ProgressBar.tsx",
]

FAILS = []


def read(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def check(label, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + label + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(label)


def run_npx(args, timeout=900):
    """Run npx on Windows without relying on CreateProcess on the .cmd shim."""
    if os.name == "nt":
        cmd = ["cmd", "/c", "npx", *args]
    else:
        cmd = ["npx", *args]
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=timeout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-jest", action="store_true")
    ap.add_argument("--web-export", action="store_true")
    args = ap.parse_args()

    print("== FP-07 Step 6: dynamic metrics dashboard ==\n")
    data = read(DATA)
    test = read(DATA_TEST)
    dash = read(DASH)

    if not data or not dash:
        print("FAILED: Step 6 files missing")
        return 1

    print("== A. Pure data layer ==")
    check(f"{DATA} exists", bool(data))
    check("the data layer has no imports (pure, jest-loadable)", not re.search(r"^import\b", data, re.M))
    check("selection keeps validated non-archived metrics", 'row.formula_status === "validated"' in data and "row.archived_at === null" in data)
    check("the trailing window is historyDays inclusive", "export function trailingStartDate" in data and "start.setDate(start.getDate() - (count - 1))" in data)
    check("series sort ascending and slice to the window", "points.sort(" in data and "points.slice(-limit)" in data)
    check("component rule: stat / trend / progress", 'return "progress";' in data and 'return "trend";' in data and 'return "stat";' in data)
    check("heatmap opens at seven points", "points.length >= 7" in data)
    check("delta is latest minus previous", "points[points.length - 1].value - points[points.length - 2].value" in data)
    check("flat/single normalization is 0.5", "max <= min) return 0.5" in data)
    check("heatmap is a Monday-start calendar grid", "latestWeekday" in data and "startMs" in data)
    check("progress handles no-created/past/before edges", "if (!metric.created_at" in data and "current >= end) return 1" in data and "current <= start) return 0" in data)
    check("numeric formatting is shared", "export function formatMetricNumber" in data and "export function formatMetricDelta" in data)

    print("\n== B. Four registry components ==")
    for rel in REGISTRY:
        src = read(rel)
        check(f"{rel} exists", bool(src))
        check(f"{rel} imports MetricPoint from the data layer", "MetricPoint" in src and "../../lib/metricsData" in src)
        check(f"{rel} has no supabase/network/write surface", not re.search(r"supabase|\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|fetch\(", src))
        check(f"{rel} uses RN primitives only", "<div" not in src and "<span" not in src and "<View" in src)
    progress = read("components/metrics/ProgressBar.tsx")
    check("ProgressBar receives the page-computed fraction", "progress: number" in progress and "accessibilityRole=\"progressbar\"" in progress)
    index = read("components/metrics/index.ts")
    check("the registry exports all four bodies", all(name in index for name in ("TrendLineGraph", "ConsistencyHeatmap", "ProgressBar", "StatCard")))

    print("\n== C. Dashboard integration ==")
    check("keeps Screen + PageHeader", "<Screen" in dash and "<PageHeader" in dash)
    check("fail-closed config read", 'requireConfigNumber(\'metric_history_days\')' in dash and "useConfig()" in dash)
    check("reads metrics then points, both select-only", ".from('metrics')" in dash and ".select(" in dash and ".from('metric_points')" in dash and ".in(" in dash)
    check("no client-side metric writes", not re.search(r"\.(insert|update|upsert|delete)\(", dash))
    check("focus refresh + manual refresh", "useFocusEffect" in dash and 'icon="refresh-cw"' in dash)
    check("empty state exists", "No metrics yet" in dash)
    check("renders all three body kinds", "<StatCard" in dash and "<TrendLineGraph" in dash and "<ProgressBar" in dash)
    check("heatmap is behind the toggle", "<ConsistencyHeatmap" in dash and "<SegmentedControl" in dash)
    check("latest value / unit / delta headers are outside the registry", "formatMetricNumber(view.latest)" in dash and "view.metric.output_unit" in dash and "formatMetricDelta(view.delta)" in dash)
    check("uses logger, never raw console", "from '../../lib/logger'" in dash and "logger." in dash and "console." not in dash)
    check("no raw DOM elements", "<div" not in dash and "<span" not in dash and "<p>" not in dash)
    check("no trust_score / tactical_analysis on the client", "trust_score" not in dash + data and "tactical_analysis" not in dash + data)

    print("\n== D. Boundary tests ==")
    for token in (
        "0–1 points",
        "seven",
        "quest",
        "deadline",
        "day-over-day",
        "flat",
        "single-point",
        "deadline has passed",
        "without a creation time",
    ):
        check(f"test table mentions {token!r}", token in test)
    check("the component boundaries test 0/1/2/7 points", "componentKind(metric(), zero)" in test and "componentKind(metric(), one)" in test and "componentKind(metric(), two)" in test and "componentKind(metric(), seven)" in test)

    print("\n== E. Dependencies ==")
    imported = set()
    for rel in [DATA] + REGISTRY:
        for match in re.finditer(r"from ['\"]([^'\"]+)['\"]", read(rel)):
            imported.add(match.group(1))
    allowed = ("react", "react-native", "../../theme", "../ui", "../../lib/metricsData")
    check("new modules import only existing local/react packages", all(any(spec == a or spec.startswith(a + "/") for a in allowed) for spec in imported), repr(sorted(imported)))
    diff = subprocess.run(
        ["git", "diff", "--ignore-all-space", "--quiet", "--", "package.json", "package-lock.json"],
        cwd=ROOT,
    )
    check("package.json/package-lock content unchanged (zero new deps)", diff.returncode == 0)

    if args.run_jest:
        print("\n== F. jest ==")
        proc = run_npx(["jest", DATA_TEST, "--ci", "--runInBand"])
        print(proc.stdout[-1200:] + proc.stderr[-800:])
        check("metricsData jest suite green", proc.returncode == 0)

    if args.web_export:
        print("\n== G. web export ==")
        out = tempfile.mkdtemp(prefix="fp07-web-")
        proc = run_npx(["expo", "export", "--platform", "web", "--output-dir", out])
        check("web export compiles the dashboard route", proc.returncode == 0)
        check("web export produced index.html + a bundle",
              os.path.exists(os.path.join(out, "index.html"))
              and os.path.exists(os.path.join(out, "_expo", "static", "js", "web")))
        shutil.rmtree(out, ignore_errors=True)

    print()
    if FAILS:
        print(f"FAILED: {len(FAILS)} check(s): {FAILS}")
        return 1
    print("PASS: FP-07 Step 6 static surface")
    print("NOTE: the seeded-charts/toggle/empty-state browser drill is recorded in FP-07-ACCEPTANCE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
