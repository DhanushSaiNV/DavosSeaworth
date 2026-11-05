// lib/todayService.test.ts
// Unit tests for real data services: todayService, chatService, urgeService.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('./supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    })),
    removeChannel: jest.fn(),
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

import {
  toDateString,
  deriveTrackerFromGridAndDoings,
  correlateAnchorsWithDoings,
  mapDoingsToActivityItems,
  type UserProfileSchedule,
  type DoingRow,
  type StoredAnchor,
} from './todayService';
import { formatMessageTime, toThreadMessage, type MessageRow } from './chatService';
import type { PlanAnchor } from '../domain/daySnapshot';

describe('todayService unit tests', () => {
  const mockProfile: UserProfileSchedule = {
    id: 'user_123',
    checkin_cadence_minutes: 60,
    checkin_active_hours_start: '09:00',
    checkin_active_hours_end: '18:00',
    timezone: 'UTC',
  };

  describe('toDateString', () => {
    it('formats a date as YYYY-MM-DD', () => {
      const d = new Date(Date.UTC(2026, 9, 20, 12, 0, 0));
      expect(toDateString(d)).toBe('2026-10-20');
    });
  });

  describe('deriveTrackerFromGridAndDoings', () => {
    it('creates tracker segments for windows and identifies reported windows', () => {
      // 12:30 UTC on Oct 20, 2026
      const nowMs = Date.UTC(2026, 9, 20, 12, 30, 0);

      const doings: DoingRow[] = [
        {
          id: 'doing_1',
          user_id: 'user_123',
          kind: 'doing',
          content: 'Working on project',
          energy: 8,
          source: 'app',
          logged_at: new Date(Date.UTC(2026, 9, 20, 10, 5, 0)).toISOString(),
          checkin_window: new Date(Date.UTC(2026, 9, 20, 10, 0, 0)).toISOString(),
        },
      ];

      const tracker = deriveTrackerFromGridAndDoings(mockProfile, doings, nowMs);

      expect(tracker.totalCount).toBeGreaterThan(0);
      expect(tracker.reportedCount).toBe(1);
      expect(tracker.segments.length).toBe(tracker.totalCount);
    });
  });

  describe('correlateAnchorsWithDoings', () => {
    it('marks anchor as done with evidence when overlapping doing exists', () => {
      const nowMs = Date.UTC(2026, 9, 20, 14, 0, 0);

      const anchors: StoredAnchor[] = [
        {
          id: 'anchor_deepwork',
          start: '10:00',
          end: '12:00',
          label: 'Deep Work Session',
          kind: 'commitment',
        },
        {
          id: 'anchor_evening',
          start: '16:00',
          end: '17:00',
          label: 'Evening Review',
          kind: 'routine',
        },
      ];

      const doings: DoingRow[] = [
        {
          id: 'doing_deepwork',
          user_id: 'user_123',
          kind: 'doing',
          content: 'Built core search module without distractions',
          energy: 9,
          source: 'app',
          logged_at: new Date(Date.UTC(2026, 9, 20, 11, 0, 0)).toISOString(),
          checkin_window: null,
        },
      ];

      const correlated = correlateAnchorsWithDoings(anchors, doings, mockProfile, nowMs);

      const deepwork = correlated.find((a) => a.id === 'anchor_deepwork');
      expect(deepwork).toBeDefined();
      expect(deepwork?.status).toBe('done');
      expect(deepwork?.evidence?.text).toContain('Built core search module');

      const evening = correlated.find((a) => a.id === 'anchor_evening');
      expect(evening).toBeDefined();
      expect(evening?.status).toBe('scheduled');
    });
  });

  describe('mapDoingsToActivityItems', () => {
    it('maps doings and impulse records to ActivityItem structures', () => {
      const doings: DoingRow[] = [
        {
          id: 'd1',
          user_id: 'user_123',
          kind: 'doing',
          content: 'Morning sprint completed',
          energy: 8,
          source: 'app',
          logged_at: new Date(Date.UTC(2026, 9, 20, 10, 15, 0)).toISOString(),
          checkin_window: null,
        },
        {
          id: 'd2',
          user_id: 'user_123',
          kind: 'impulse_failure',
          content: 'Browsing social media',
          energy: null,
          source: 'app',
          logged_at: new Date(Date.UTC(2026, 9, 20, 11, 30, 0)).toISOString(),
          checkin_window: null,
        },
      ];

      const activities = mapDoingsToActivityItems(doings, mockProfile);
      expect(activities.length).toBe(2);

      expect(activities[0].kind).toBe('report');
      expect(activities[0].title).toBe('Morning sprint completed');
      expect(activities[0].sub).toContain('Energy 8/10');

      expect(activities[1].kind).toBe('urge');
      expect(activities[1].title).toBe('Browsing social media');
      expect(activities[1].outcome).toBe('yielded');
    });
  });
});

describe('chatService unit tests', () => {
  describe('formatMessageTime', () => {
    it('formats ISO string to HH:MM', () => {
      const iso = new Date(2026, 9, 20, 14, 25).toISOString();
      const time = formatMessageTime(iso);
      expect(time).toMatch(/^\d{2}:\d{2}$/);
    });

    it('gracefully returns fallback on invalid date', () => {
      expect(formatMessageTime('invalid-date')).toBe('12:00');
    });
  });

  describe('toThreadMessage', () => {
    it('converts assistant row to davos ThreadMessage', () => {
      const row: MessageRow = {
        id: 'msg_1',
        user_id: 'u1',
        role: 'assistant',
        content: 'Good morning!',
        unsavable: false,
        client_message_id: null,
        reply_to_message_id: null,
        client_sent_at: null,
        created_at: new Date().toISOString(),
      };

      const msg = toThreadMessage(row);
      expect(msg.role).toBe('davos');
      expect(msg.text).toBe('Good morning!');
      expect(msg.sendState).toBe('sent');
    });

    it('converts user row to user ThreadMessage', () => {
      const row: MessageRow = {
        id: 'msg_2',
        user_id: 'u1',
        role: 'user',
        content: 'Ready for the day.',
        unsavable: false,
        client_message_id: 'cid_2',
        reply_to_message_id: null,
        client_sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      const msg = toThreadMessage(row);
      expect(msg.role).toBe('user');
      expect(msg.text).toBe('Ready for the day.');
    });
  });
});
