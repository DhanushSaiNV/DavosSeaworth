// lib/journal/journalService.test.ts
// Unit tests for journalService: draft persistence, client-side stripping on submit,
// and overnight anchor plan simulation.

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => store[key] || null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
    clear: jest.fn(async () => {
      store = {};
    }),
  };
});

jest.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
    rpc: jest.fn().mockResolvedValue({ error: null }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import {
  JOURNAL_DRAFT_KEY,
  loadJournalDraft,
  saveJournalDraft,
  clearJournalDraft,
  submitJournalEntry,
  simulateOvernightAnchorPlan,
} from './journalService';

describe('journalService', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  describe('Draft Persistence', () => {
    it('returns null when no draft is stored', async () => {
      const draft = await loadJournalDraft();
      expect(draft).toBeNull();
    });

    it('saves and loads a valid draft', async () => {
      const testDraft = {
        raw: 'First paragraph.\n\nSecond paragraph.',
        flaggedTexts: ['Second paragraph.'],
        updatedAt: '2026-11-06T18:00:00.000Z',
      };
      await saveJournalDraft(testDraft);
      const loaded = await loadJournalDraft();
      expect(loaded).toEqual(testDraft);
    });

    it('clears draft from AsyncStorage', async () => {
      await saveJournalDraft({
        raw: 'Some draft',
        flaggedTexts: [],
        updatedAt: '2026-11-06T18:00:00.000Z',
      });
      await clearJournalDraft();
      const loaded = await loadJournalDraft();
      expect(loaded).toBeNull();
    });
  });

  describe('submitJournalEntry (Client Strip Enforcement)', () => {
    it('rejects submission if content is empty', async () => {
      const result = await submitJournalEntry('', []);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Cannot submit empty journal');
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('rejects submission if 100% of blocks are flagged unsavable', async () => {
      const text = 'Secret block 1.\n\nSecret block 2.';
      const flagged = ['Secret block 1.', 'Secret block 2.'];
      const result = await submitJournalEntry(text, flagged);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('All blocks may have been marked unsavable');
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('strips flagged blocks and submits only permitted blocks', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
        data: { entry_id: 'entry-123' },
        error: null,
      });

      const text = 'Block to keep.\n\nSensitive block to strip.\n\nAnother block to keep.';
      const flagged = ['Sensitive block to strip.'];

      const result = await submitJournalEntry(text, flagged, '2026-11-06');
      expect(result.ok).toBe(true);
      expect(result.entryId).toBe('entry-123');
      expect(result.sentBlocks).toBe(2);
      expect(result.totalBlocks).toBe(3);

      expect(supabase.functions.invoke).toHaveBeenCalledWith('submit-journal', {
        body: {
          content: 'Block to keep.\n\nAnother block to keep.',
          entry_date: '2026-11-06',
        },
      });

      // Verifies draft is cleared on successful submit
      const rawStored = await AsyncStorage.getItem(JOURNAL_DRAFT_KEY);
      expect(rawStored).toBeNull();
    });

    it('handles server function error gracefully without throwing', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'Server rate limit exceeded' },
      });

      const result = await submitJournalEntry('A valid journal block.', []);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Server rate limit exceeded');
    });
  });

  describe('simulateOvernightAnchorPlan', () => {
    it('generates next-day anchor plans matching the anchor_plan schema', async () => {
      const anchors = await simulateOvernightAnchorPlan(
        'user-1',
        '2026-11-07',
        'Had a great workout at the gym and did some deep coding on the app.'
      );

      expect(anchors.length).toBeGreaterThanOrEqual(4);
      expect(anchors.some((a) => a.kind === 'commitment')).toBe(true);
      expect(anchors.some((a) => a.kind === 'routine')).toBe(true);
      expect(anchors.some((a) => a.kind === 'free_block')).toBe(true);
      expect(anchors.some((a) => a.kind === 'boredom_relief')).toBe(true);

      for (const a of anchors) {
        expect(a.start).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
        expect(a.end).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
        expect(a.label.length).toBeGreaterThan(0);
      }
    });
  });
});
