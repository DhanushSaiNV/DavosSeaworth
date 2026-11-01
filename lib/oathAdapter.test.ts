// lib/oathAdapter.test.ts
import { oathAdapter } from './oathAdapter';

describe('oathAdapter (in-memory fake)', () => {
  beforeEach(async () => {
    await oathAdapter.discardDraft();
  });

  it('saves and retrieves an oath draft', async () => {
    await oathAdapter.saveDraft({
      commitmentText: 'I will write daily spec code without excuses.',
      reviewDate: '2026-12-01',
    });

    const draft = await oathAdapter.getDraft();
    expect(draft).toEqual({
      commitmentText: 'I will write daily spec code without excuses.',
      reviewDate: '2026-12-01',
    });
  });

  it('discards a draft', async () => {
    await oathAdapter.saveDraft({
      commitmentText: 'Draft to discard',
      reviewDate: '2026-12-01',
    });

    await oathAdapter.discardDraft();
    const draft = await oathAdapter.getDraft();
    expect(draft).toBeNull();
  });

  it('binds an oath, clears draft, and establishes immutable standing', async () => {
    const bound = await oathAdapter.bind({
      commitmentText: 'I will maintain total focus on core job deliverables.',
      reviewDate: '2026-12-01',
    });

    expect(bound.id).toMatch(/^oath_/);
    expect(bound.commitmentText).toBe('I will maintain total focus on core job deliverables.');
    expect(bound.standing).toBe('in_good_standing');
    expect(bound.boundAt).toBeDefined();

    // Draft is cleared upon binding
    const draft = await oathAdapter.getDraft();
    expect(draft).toBeNull();

    // Bound oath is persisted in memory
    const retrieved = await oathAdapter.getBoundOath();
    expect(retrieved).toEqual(bound);
  });

  it('rejects binding with empty commitment text', async () => {
    await expect(
      oathAdapter.bind({
        commitmentText: '   ',
        reviewDate: '2026-12-01',
      })
    ).rejects.toThrow('Commitment text cannot be empty');
  });
});
