#!/usr/bin/env python3
# -*- coding: utf-8 -*-

with open(r'C:\dev\DavosSeaworth\docs\GLOSSARY.md', 'r', encoding='utf-8') as f:
    content = f.read()

old = '''| **Evening journal chain**                | The sequential jobs pipeline: `journal_extract` -> optional `journal_probe` -> `anchor_plan` (D16, §7.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## 3. Interventions & Psychological Operations'''

new = '''| **Evening journal chain**                | The sequential jobs pipeline: `journal_extract` -> optional `journal_probe` -> `anchor_plan` (D16, §7.4).                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Journal extraction / `journal_extract`** | Async job: extracts insights from journal entry, writes `vagueness_score`/`severity`/`openness_delta`/`admission_flag` on entry, inserts `memory_facts` (fact_type=journal, batched embed), enqueues `journal_probe` (if vague/severe) + `anchor_plan` (always). Idempotent via payload dedup on `{entry_id}` (D16, §7.4, Step 3). |
| **Journal probe / `journal_probe`**      | Async job: severity-gated targeted follow-up (S1/S2 -> `therapist_empath`; vague S3 -> `mentor_tough`) via `runLockedPersonaReply` (D7 fallback, General domain); writes unprompted assistant row (`metadata.source='journal_probe'`), default-priority Expo push (`davos://chat`), sets `probed` flag. Idempotent via existing-row pre-check + payload dedup (D16, §7.4, Step 4). |
| **Anchor plan / `anchor_plan`**          | Async job: generates next-day anchor plan (1-12 anchors, 5 kinds, HH:mm 24h, no overlaps) via `anchorPlanWith` (1 generate + 1 corrected re-output, fail-soft on 2nd failure); upserts `anchor_plans` (`onConflict: user_id,plan_date`); writes unprompted summary row (`metadata.source='anchor_plan'`); **no push**. Idempotent via payload dedup + upsert (D14, D16, §7.2, Step 5). |
| **JIT riders / day-plan context**        | Stage-5 prompt riders: `runPipeline` loads today's `anchor_plans`, resolves current `free_block`/`boredom_relief` via `resolveCurrentFreeBlock`, renders `dayPlanContext` (anchors block + rescheduling instruction + JIT energy band 1-3/8-10) -> appended to system prompt in `generateReply`. No plan -> byte-identical FP-04 prompt (FR-12/FR-13/FR-14, §5.1, §7.2).

## 3. Interventions & Psychological Operations'''

if old in content:
    content = content.replace(old, new)
    with open(r'C:\dev\DavosSeaworth\docs\GLOSSARY.md', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Replaced successfully')
else:
    print('Not found')
    idx = content.find('Evening journal chain')
    if idx >= 0:
        print('Found at', idx)
        print(repr(content[idx:idx+300]))