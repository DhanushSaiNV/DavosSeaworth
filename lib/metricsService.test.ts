// lib/metricsService.test.ts
// Unit tests for metricsService data-fetching layer.

jest.mock('./supabase', () => {
  const queryBuilder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    order: jest.fn(),
  };

  return {
    supabase: {
      from: jest.fn((table: string) => queryBuilder),
    },
    __queryBuilder: queryBuilder,
  };
});

jest.mock('./config', () => ({
  requireConfigNumber: jest.fn().mockReturnValue(14),
}));

import { fetchUserMetrics, CORE_METRIC_PRESETS } from './metricsService';
import { supabase } from './supabase';

const { __queryBuilder: qb } = jest.requireMock('./supabase');

describe('metricsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes the 8 core metric presets', () => {
    expect(CORE_METRIC_PRESETS).toHaveLength(8);
    const names = CORE_METRIC_PRESETS.map((p) => p.name);
    expect(names).toContain('Momentum');
    expect(names).toContain('Deep Work Hours');
    expect(names).toContain('Check-in Consistency');
  });

  it('returns empty result when userId is falsy', async () => {
    const res = await fetchUserMetrics('');
    expect(res.views).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('fetches metrics and trailing points and builds views', async () => {
    // 1st query: metrics table
    qb.order.mockResolvedValueOnce({
      data: [
        {
          id: 'm1',
          name: 'Momentum',
          domain: 'Discipline/Habits',
          output_unit: 'doings',
          is_quest: false,
          quest_status: null,
          quest_deadline: null,
          created_at: '2026-10-01T00:00:00Z',
          formula_status: 'validated',
          archived_at: null,
        },
      ],
      error: null,
    });

    // 2nd query: metric_points table
    qb.order.mockResolvedValueOnce({
      data: [
        { metric_id: 'm1', value: 4, computed_for: '2026-10-19' },
        { metric_id: 'm1', value: 6, computed_for: '2026-10-20' },
      ],
      error: null,
    });

    const now = new Date(2026, 9, 20, 12, 0, 0);
    const result = await fetchUserMetrics('user-123', now);

    expect(result.views).toHaveLength(1);
    expect(result.views[0].metric.name).toBe('Momentum');
    expect(result.views[0].kind).toBe('trend'); // 2 points -> trend
    expect(result.views[0].latest).toBe(6);
    expect(result.views[0].delta).toBe(2);
    expect(result.historyDays).toBe(14);
  });

  it('handles metric query failure by throwing structured error', async () => {
    qb.order.mockResolvedValueOnce({
      data: null,
      error: { message: 'Database connection failed' },
    });

    await expect(fetchUserMetrics('user-123')).rejects.toThrow(
      'Failed to load metrics: Database connection failed'
    );
  });
});
