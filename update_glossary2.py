#!/usr/bin/env python3
# -*- coding: utf-8 -*-

with open(r'C:\dev\DavosSeaworth\docs\GLOSSARY.md', 'r', encoding='utf-8') as f:
    content = f.read()

old = '''| `dev-smoke`      | dev      | Dev-only smoke test (embed, generate, models, seed-rules, clear-rules, seed-exemplars (resumable offset/limit windows, paced; `&source=` content-slot selector), clear-exemplars (`&source=`), clear-exemplars (`&source=`), match-exemplars, classify, retrieve, pipeline = full stages 1–5, eval-classifier = golden-set eval, watchdog-scan = the **production** §7.1 scan with `&now=<iso>` backdating and `&user=<uuid>` scoping); bearer-token gated (`DEV_SMOKE_TOKEN`) | FP-02 Step 1, Step 3; FP-03 Steps 2–7; FP-04 Step 6 |'''

new = '''| `dev-smoke`      | dev      | Dev-only smoke test (embed, generate, models, seed-rules, clear-rules, seed-exemplars (resumable offset/limit windows, paced; `&source=` content-slot selector), clear-exemplars (`&source=`), match-exemplars, classify, retrieve, pipeline = full stages 1–5, eval-classifier = golden-set eval, watchdog-scan = the **production** §7.1 scan with `&now=<iso>` backdating and `&user=<uuid>` scoping, **journal-drill = drives evening chain legs directly**); bearer-token gated (`DEV_SMOKE_TOKEN`) | FP-02 Step 1, Step 3; FP-03 Steps 2–7; FP-04 Step 6; FP-05 Step 8 |'''

if old in content:
    content = content.replace(old, new)
    with open(r'C:\dev\DavosSeaworth\docs\GLOSSARY.md', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Replaced successfully')
else:
    print('Not found')
    # Find the dev-smoke line
    idx = content.find('dev-smoke')
    if idx >= 0:
        print(f'Found at {idx}')
        print(repr(content[idx:idx+200]))