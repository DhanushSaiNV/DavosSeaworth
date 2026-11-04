// lib/oathAdapter.ts
// In-memory fake OathAdapter for Flow F4 (Oath Ceremony, S4).
// Rule (AGENTS.md & TASK): Never call a real bind endpoint against production data.
// In-memory fake only; real wiring comes later against a test backend.
// Architectural rule: No edit or delete affordance on a bound Oath anywhere.

export interface OathDraft {
  commitmentText: string;
  reviewDate: string;
}

export interface BoundOath {
  id: string;
  commitmentText: string;
  reviewDate: string;
  boundAt: string;
  standing: 'in_good_standing' | 'broken';
}

export interface OathAdapter {
  saveDraft(draft: OathDraft): Promise<void>;
  discardDraft(): Promise<void>;
  bind(draft: OathDraft): Promise<BoundOath>;
  getDraft(): Promise<OathDraft | null>;
  getBoundOath(): Promise<BoundOath | null>;
}

class InMemoryOathAdapter implements OathAdapter {
  private currentDraft: OathDraft | null = null;
  private boundOath: BoundOath | null = null;
  private oathCounter = 1;

  async saveDraft(draft: OathDraft): Promise<void> {
    this.currentDraft = { ...draft };
  }

  async discardDraft(): Promise<void> {
    this.currentDraft = null;
  }

  async bind(draft: OathDraft): Promise<BoundOath> {
    if (!draft.commitmentText.trim()) {
      throw new Error('Commitment text cannot be empty');
    }

    const bound: BoundOath = {
      id: `oath_${this.oathCounter++}`,
      commitmentText: draft.commitmentText.trim(),
      reviewDate: draft.reviewDate.trim() || '2026-12-03',
      boundAt: '2026-11-03T18:04:00.000Z',
      standing: 'in_good_standing',
    };

    this.boundOath = bound;
    this.currentDraft = null;
    return bound;
  }

  async getDraft(): Promise<OathDraft | null> {
    return this.currentDraft;
  }

  async getBoundOath(): Promise<BoundOath | null> {
    return this.boundOath;
  }
}

// Canonical singleton export
export const oathAdapter: OathAdapter = new InMemoryOathAdapter();
