// lib/proofService.test.ts
// Unit tests for proofService metrics and ledger calculations.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('./supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('./todayService', () => {
  const actual = jest.requireActual('./todayService');
  return {
    ...actual,
    fetchUserScheduleProfile: jest.fn().mockResolvedValue({
      id: 'u1',
      checkin_cadence_minutes: 60,
      checkin_active_hours_start: '09:00',
      checkin_active_hours_end: '18:00',
      timezone: 'UTC',
    }),
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { formatWeekRangeLabel, fetchProofData } from './proofService';

describe('proofService unit tests', () => {
  const mockStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
  const mockSupabase = supabase as jest.Mocked<typeof supabase>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('formatWeekRangeLabel', () => {
    it('formats single-month range', () => {
      const startMs = Date.UTC(2026, 9, 24);
      const endMs = Date.UTC(2026, 9, 30);
      const label = formatWeekRangeLabel(startMs, endMs);
      expect(label).toContain('Oct');
    });

    it('formats cross-month range', () => {
      const startMs = Date.UTC(2026, 9, 28);
      const endMs = Date.UTC(2026, 10, 3);
      const label = formatWeekRangeLabel(startMs, endMs);
      expect(label).toContain('Oct');
      expect(label).toContain('Nov');
    });
  });

  describe('fetchProofData', () => {
    it('returns empty figures for empty userId', async () => {
      const res = await fetchProofData('');
      expect(res.checkinsRatio).toBe('0 of 0');
      expect(res.ledgerDays).toEqual([]);
    });

    it('computes metrics and groups ledger days correctly from real doings', async () => {
      const nowMs = Date.UTC(2026, 10, 3, 18, 0, 0);

      const mockDoings = [
        {
          id: 'd1',
          user_id: 'u1',
          kind: 'doing',
          content: 'Built compiler slice',
          energy: 9,
          source: 'app',
          logged_at: new Date(Date.UTC(2026, 10, 3, 10, 0, 0)).toISOString(),
          checkin_window: new Date(Date.UTC(2026, 10, 3, 10, 0, 0)).toISOString(),
        },
        {
          id: 'd2',
          user_id: 'u1',
          kind: 'impulse_failure',
          content: 'Lost focus on phone',
          energy: null,
          source: 'app',
          logged_at: new Date(Date.UTC(2026, 10, 3, 11, 0, 0)).toISOString(),
          checkin_window: null,
        },
      ];

      mockSupabase.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValueOnce({ data: mockDoings, error: null }),
      } as any);

      mockStorage.getItem.mockResolvedValueOnce(
        JSON.stringify([
          { timestamp: nowMs - 100000, trigger: 'Snacking' },
          { timestamp: nowMs - 200000, trigger: 'Smoking' },
        ])
      );

      const res = await fetchProofData('u1', nowMs);

      expect(res.onTimePercent).toBe('100%');
      expect(res.urgesHeld).toBe(2);
      expect(res.ledgerDays.length).toBe(1);
      expect(res.ledgerDays[0].doings.length).toBe(2);
      expect(res.ledgerDays[0].doings[0].what).toBe('Built compiler slice');
      expect(res.ledgerDays[0].doings[1].kind).toBe('impulse_yielded');
    });
  });
});
