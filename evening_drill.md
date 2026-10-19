# FP-05 Manual Evening Drill Procedure

## Prerequisites (run once)

```bash
# 1. Ensure migration 0028 is applied
supabase db push

# 2. Deploy all functions
supabase functions deploy submit-journal
supabase functions deploy job-dispatcher
supabase functions deploy dev-smoke

# 3. Verify config keys exist
supabase db dump --schema-only | grep -A2 "journal_probe_vagueness_threshold\|journal_probe_persona_severe\|journal_probe_persona_vague\|anchor_plan_persona"
```

## Evening Drill (tonight, ~15 min)

### 1. Open the app and navigate to **Journal** screen

### 2. Write a real evening entry with **three distinct blocks**:

```
Block 1 (clear, specific):
Completed the project proposal by 9am. Went for a 5km run at 6pm. Prepped meals for tomorrow.

---

Block 2 (deliberately vague):
Stuff happened today. It was okay I guess. Nothing specific really.

---

Block 3 (deliberately heavy/emotional):
I've been feeling completely hopeless for weeks. Nothing matters anymore. I can't go on like this.
```

**Important:** Do NOT flag any blocks as "Unsavable" — we want all three to transmit.

### 3. Tap **Commit entry** (or "Submit")

- Observe: button shows "Submitting..." then "Submitted"
- Confirmation banner appears: _"Davos received 3 of 3 blocks; he'll read it tonight and come back with a plan"_
- Editor clears, ready for tomorrow

### 4. Wait ~2 minutes, then check **Chat** tab

You should see **three things** appear in sequence:

| Expected                      | What to look for                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Probe 1** (for vague block) | Davos message: _"You said 'Stuff happened today...' — that's pretty vague. What specifically happened? Give me one concrete thing."_ Persona: **mentor_tough** (sharp editor tone) |
| **Probe 2** (for heavy block) | Davos message: _"You said you're feeling hopeless... I'm here. What's the one thing that's weighing heaviest right now?"_ Persona: **therapist_empath** (supportive tone)          |
| **Plan summary**              | Davos message: _"Here's your plan for tomorrow: 09:00-11:00 Deep work... 11:00-12:00 Free block..."_ Persona: **mentor_tough** (plan voice)                                        |

**Verify in chat:**

- [ ] Two probe messages (different tones)
- [ ] One plan summary message
- [ ] All three have `metadata.source` = `journal_probe` / `anchor_plan` (check dev tools if needed)

### 5. Check **Database** (optional, via Supabase dashboard)

```sql
-- Verify journal entry
select id, content, entry_date, vagueness_score, severity, probed
from journal_entries
order by created_at desc limit 1;

-- Verify facts
select fact, fact_type, embed_model
from memory_facts
where source_journal_id = '<entry_id_from_above>';

-- Verify plan
select plan_date, anchors
from anchor_plans
where user_id = '<your_uid>'
order by created_at desc limit 1;

-- Verify jobs completed
select type, status, payload
from jobs
where payload->>'entry_id' = '<entry_id>'
order by created_at;
```

## Next-Day Drill (tomorrow, inside a free block)

### 6. Wait until your **free block** (11:00-12:00 in the plan above)

### 7. Send a **chat message** during that free block

```
"Starting my deep work now"
```

**Observe:** Davos's reply should include a **JIT line** like:

> _"Energy low (1–3) — pick a low-cognitive task or a boredom-relief item now."_
> _(if your energy is 1-3)_

Or:

> _"Energy high (8–10) — tackle a heavy task now."_
> _(if your energy is 8-10)_

### 8. **Try to move an anchor** in the same chat

```
"Can we move the 9-11 deep work to 2-4pm instead?"
```

**Expected:** Davos replies demanding conversational approval:

> _"Moves require your conversational approval. The plan is authoritative — I don't mutate calendars. If you want to shift it, tell me why and we'll agree on the new time."_

### 9. **Check-in** during the same free block

- Trigger a check-in (or wait for notification)
- Answer with energy rating
- **Observe:** JIT rider appears in Davos's reply (same energy-band instruction)

## Web Drill (optional, if testing on web)

1. Open app on `https://your-project.supabase.co`
2. Navigate to Journal → write entry → Submit
3. Verify: Submit works, confirmation banner shows, editor clears
4. Check Chat → probes + plan appear

## iOS Drill (optional)

1. Submit journal on iOS
2. **Do NOT** enable push notifications (no APNs key)
3. Verify: Probe appears **in-thread** on next app open (fallback)

---

## Recording Results

Fill in `docs/feature-prds/FP-05/FP-05-ACCEPTANCE.md`:

| Section       | What to record                                                             |
| ------------- | -------------------------------------------------------------------------- |
| Evening Chain | Probe tones (mentor_tough / therapist_empath), plan quality, facts visible |
| JIT           | Energy band instruction correctness, rescheduling approval demand          |
| Web           | Submit + confirmation render                                               |
| iOS           | In-thread fallback rendering                                               |
| Latency       | Time from submit → probe → plan (seconds)                                  |

---

## Quick Troubleshooting

| Issue            | Fix                                                                       |
| ---------------- | ------------------------------------------------------------------------- |
| No probes appear | Check `job-dispatcher` logs: `supabase functions logs job-dispatcher`     |
| Only one probe   | Check `vagueness_score` threshold (0.6) and severity in `journal_entries` |
| No plan          | Check `anchor_plan` job in `jobs` table; check `dev-smoke` logs           |
| JIT missing      | Verify `anchor_plans` has a `free_block` at current local time            |

---

**Ready?** Start with step 1 tonight. The chain is designed to complete within ~2 minutes of submit. Report back with observations!
