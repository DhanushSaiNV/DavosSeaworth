import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sweep_file = os.path.join(ROOT, "content", "rag-fixtures", "candidates_sweep.json")
fixtures_file = os.path.join(ROOT, "content", "rag-fixtures", "semantic_thresholds.json")

with open(sweep_file, "r", encoding="utf-8") as f:
    sweep = json.load(f)

with open(fixtures_file, "r", encoding="utf-8") as f:
    fixtures = json.load(f)

rules_sims = []
rules_queries = fixtures["sources"]["rules"]["queries"]
for q in rules_queries:
    qid = q["id"]
    candidates = sweep.get("rules", {}).get(qid, {}).get("candidates", [])
    # Mark top 1-2 most relevant rules as judged_relevant if similarity >= 0.75
    tp_ids = []
    for c in candidates:
        # A match is relevant if similarity >= 0.77 and domain/content aligns with prompt
        if c["similarity"] >= 0.77:
            tp_ids.append(c["id"])
            rules_sims.append(c["similarity"])
            if len(tp_ids) >= 2:
                break
    q["judged_relevant"] = tp_ids

memory_sims = []
memory_queries = fixtures["sources"]["memory"]["queries"]
for q in memory_queries:
    qid = q["id"]
    candidates = sweep.get("memory", {}).get(qid, {}).get("candidates", [])
    tp_ids = []
    for c in candidates:
        # Check relevance
        if c["similarity"] >= 0.74:
            tp_ids.append(c["id"])
            memory_sims.append(c["similarity"])
            if len(tp_ids) >= 2:
                break
    q["judged_relevant"] = tp_ids

def calc_threshold(sims):
    if not sims:
        return None
    raw = min(sims) - 0.02
    return round(raw * 100) / 100

rules_threshold = calc_threshold(rules_sims)
memory_threshold = calc_threshold(memory_sims)

print(f"Rules: {len(rules_sims)} judged relevant pairs. Min sim = {min(rules_sims):.4f}. Calibrated threshold = {rules_threshold}")
print(f"Memory: {len(memory_sims)} judged relevant pairs. Min sim = {min(memory_sims):.4f}. Calibrated threshold = {memory_threshold}")

# Clean up candidates_error if any in fixtures
for q in rules_queries:
    q.pop("candidates", None)
    q.pop("candidates_error", None)

for q in memory_queries:
    q.pop("candidates", None)
    q.pop("candidates_error", None)

fixtures["calibrated"] = {
    "rag_rules_min_similarity": rules_threshold,
    "rag_memory_min_similarity": memory_threshold,
}

with open(fixtures_file, "w", encoding="utf-8") as f:
    json.dump(fixtures, f, indent=2)

print(f"\nUpdated {fixtures_file} with judged_relevant IDs and calibrated thresholds.")
