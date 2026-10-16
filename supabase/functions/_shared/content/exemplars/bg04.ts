// supabase/functions/_shared/content/exemplars/bg04.ts
// FP-03 Step 7 — the BG-04 exemplar content slot (FR-16, AC-8, D19, §6.4).
//
// DRAFT — STAND-IN, NOT OWNER-APPROVED CONTENT.
// AGENTS.md §8.4 / the BG-01 content rule: agent-drafted exemplar content carries
// `status = "draft"` and a visible DRAFT label, and only owner-approved content
// (`status = "approved"`) may be seeded as the real set. This file is the *stable slot*: the
// `&source=BG-04` arm of `dev-smoke ?action=seed-exemplars` reads it, the Step 7 hot-swap drill
// seeds these four items to prove the swap is data-only, and the owner later replaces this
// file's content with the BG-02/BG-04 signed-off set and flips `status` to "approved".
// No classifier, pipeline or schema code changes at that swap — that is FR-16's claim, and one
// stable slot is what makes it literally true.
//
// Why `_shared/content/` and not the repo-root `content/` the BG-01 rule names: an Edge Function
// is bundled from the `supabase/functions` tree only, and this repo deploys API-side (Docker is
// not run locally), so an import from outside that tree is not in the deploy payload. The file
// would pass `deno check` and every local gate and then fail `supabase functions deploy`. The
// `_shared` tree is the documented shared location, and `content/` inside it keeps content
// separate from code; the labelling rule (draft + DRAFT label) is what actually governs here.
//
// The four items are a drill fixture, never a draft of the deliverable: they exist so the
// mechanism (seed `source='BG-04'` → classification shifts → clear → baseline restored) can be
// asserted by `scripts/verify-fp03-step7.py`. Nothing else reads this module — not the
// pipeline, not the classifier, not any non-dev action.
//
// Proof shape: a seeded item's own text self-matches at cosine ≈ 1.0, so seeding these rows
// moves that text's domain argmax onto the label below at a confidence no placeholder row can
// reach; clearing the rows restores the pre-seed result exactly. Texts are authored to be
// disjoint from both `placeholderExemplars.ts` and `goldenSet.ts` (asserted, not assumed).

/** Which exemplar set an item belongs to — mirrors `exemplars.set_kind` (GLOSSARY §14). */
export type Bg04SetKind = "domain" | "emotion" | "quit_signal";

export interface Bg04Exemplar {
  setKind: Bg04SetKind;
  label: string;
  text: string;
}

/** FR-1: the two `exemplars.source` values are `PLACEHOLDER-DEV` and `BG-04`. This module owns the second. */
export const BG04_EXEMPLAR_SOURCE = "BG-04";

/** BG-01 content rule: draft until the owner approves the real set. */
export const BG04_STATUS = "draft";

/** The visible label every reader of this file must see (AGENTS.md §8.4). */
export const BG04_DRAFT_LABEL =
  "DRAFT — stand-in for the owner-approved BG-04 set; not final content";

/** The Step 7 drill fixture: exactly 2 labels × 2 texts (AC-8). */
export const BG04_EXEMPLARS: Bg04Exemplar[] = [
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "I've started asking what my grandchildren would say I stood for.",
  },
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "My name is on a lot of work I don't care about and none of the work I do.",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "Every surface in my flat is a shelf now and none of it is intentional.",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "I want a room where I can close the door and think.",
  },
];
