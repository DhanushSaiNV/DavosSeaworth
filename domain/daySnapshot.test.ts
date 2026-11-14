// domain/daySnapshot.test.ts
// Unit tests for pure DaySnapshot, toTimeline, and toThread derivation.

import {
  buildDaySnapshot,
  toTimeline,
  toThread,
  timeStringToMs,
  formatTime24,
  formatDateLabel,
  type PlanItemLike,
  type DoingRecordLike,
  type ThreadMessageLike,
} from './daySnapshot';

describe('domain/daySnapshot', () => {
  // Tuesday, Nov 3, 2026, 18:04:00
  const FIXTURE_NOW = new Date(2026, 10, 3, 18, 4, 0, 0).getTime();

  const samplePlan: PlanItemLike[] = [
    {
      id: 'today_1',
      text: 'Team check-in & sprint alignment',
      time: '15:00',
      order: 1,
      status: 'done',
    },
    {
      id: 'today_2',
      text: 'Review test coverage & run regression drill',
      time: '16:00',
      order: 2,
      status: 'late', // Late answer to missed check-in
    },
    {
      id: 'today_3',
      text: 'Deep work on compiler slice',
      time: '17:00',
      order: 3,
      status: 'done',
    },
    {
      id: 'today_4',
      text: 'Spec review with team',
      time: '18:00',
      order: 4,
      status: 'pending',
    },
    {
      id: 'today_5',
      text: 'Evening reflection & planning',
      time: '20:30',
      order: 5,
      status: 'pending',
    },
  ];

  const sampleDoings: DoingRecordLike[] = [
    {
      id: 'doing_1630',
      what: 'Wrote compiler parser slice',
      when: '16:30',
      kind: 'action',
    },
    {
      id: 'urge_1740',
      what: 'Distraction urge',
      when: '17:40',
      kind: 'impulse_held',
      durationMin: 10,
    },
  ];

  describe('buildDaySnapshot', () => {
    test('computes correct counts and activeBeatId at 18:04', () => {
      const snapshot = buildDaySnapshot(samplePlan, sampleDoings, [], FIXTURE_NOW);

      // Total scheduled before evening reflection: 4 (15:00, 16:00, 17:00, 18:00)
      // All 4 are due so far at 18:04
      expect(snapshot.dueSoFar).toBe(4);
      // Answered: 15:00 (done), 16:00 (late answer), 17:00 (done) = 3
      expect(snapshot.answered).toBe(3);
      // Active beat is the pending 18:00 beat
      expect(snapshot.activeBeatId).toBe('today_4');
      expect(snapshot.beats).toHaveLength(5);
    });

    test('transforms "late" into "missed" state with lateByMin modifier (Blueprint §1, §3.3)', () => {
      const snapshot = buildDaySnapshot(samplePlan, sampleDoings, [], FIXTURE_NOW);
      const beat16 = snapshot.beats.find((b) => b.planItem.time === '16:00');

      expect(beat16).toBeDefined();
      // State is missed, NEVER 'late'
      expect(beat16?.state).toBe('missed');
      expect(beat16?.lateByMin).toBe(5);
      expect(beat16?.note).toBe('Pulled into an urgent production bug');
      expect(beat16?.answeredAt).toBeDefined();
    });

    test('distinguishes all Beat states: done, missed, due, upcoming', () => {
      const snapshot = buildDaySnapshot(samplePlan, sampleDoings, [], FIXTURE_NOW);

      const states = snapshot.beats.map((b) => ({ time: b.planItem.time, state: b.state }));
      expect(states).toEqual([
        { time: '15:00', state: 'done' },
        { time: '16:00', state: 'missed' },
        { time: '17:00', state: 'done' },
        { time: '18:00', state: 'due' },
        { time: '20:30', state: 'upcoming' },
      ]);
    });

    test('formats date label properly', () => {
      expect(formatDateLabel(FIXTURE_NOW)).toBe('Tue 3 Nov');
    });

    test('formats 24-hour time properly', () => {
      expect(formatTime24(FIXTURE_NOW)).toBe('18:04');
    });
  });

  describe('toTimeline', () => {
    test('interleaves plan items, unplanned doings, urge, and now-line chronologically', () => {
      const snapshot = buildDaySnapshot(samplePlan, sampleDoings, [], FIXTURE_NOW);
      const timeline = toTimeline(snapshot);

      // Order should be:
      // 15:00 plan (Team check-in)
      // 16:00 plan (Review test coverage)
      // 16:30 unplanned (Wrote compiler parser slice)
      // 17:00 plan (Deep work)
      // 17:40 unplanned (Urge held)
      // 18:00 plan (Spec review)
      // 18:04 now
      // 20:30 plan (Evening reflection)
      expect(timeline).toHaveLength(8);

      const summary = timeline.map((r) => ({
        kind: r.kind,
        time: formatTime24(r.at),
        spine: r.spine,
      }));

      expect(summary).toEqual([
        { kind: 'plan', time: '15:00', spine: 'elapsed' },
        { kind: 'plan', time: '16:00', spine: 'elapsed' },
        { kind: 'unplanned', time: '16:30', spine: 'elapsed' },
        { kind: 'plan', time: '17:00', spine: 'elapsed' },
        { kind: 'unplanned', time: '17:40', spine: 'elapsed' },
        { kind: 'plan', time: '18:00', spine: 'elapsed' },
        { kind: 'now', time: '18:04', spine: 'elapsed' },
        { kind: 'plan', time: '20:30', spine: 'future' },
      ]);
    });

    test('places now-line immediately after the last item at or before now', () => {
      const snapshot = buildDaySnapshot(samplePlan, sampleDoings, [], FIXTURE_NOW);
      const timeline = toTimeline(snapshot);
      const nowIndex = timeline.findIndex((r) => r.kind === 'now');

      expect(nowIndex).toBe(6); // 7th element (after 18:00 and before 20:30)
      expect(timeline[nowIndex - 1].kind).toBe('plan');
      expect(formatTime24(timeline[nowIndex - 1].at)).toBe('18:00');
      expect(timeline[nowIndex + 1].kind).toBe('plan');
      expect(formatTime24(timeline[nowIndex + 1].at)).toBe('20:30');
    });
  });

  describe('toThread', () => {
    const rawMessages: ThreadMessageLike[] = [
      {
        id: 'msg_15_q',
        role: 'davos',
        text: '15:00. Plan says Team check-in & sprint alignment. Did you do it?',
        time: '15:00',
      },
      {
        id: 'msg_1',
        role: 'user',
        text: 'Completed sprint alignment with team.',
        time: '15:15',
        sendState: 'sent',
      },
      {
        id: 'msg_2',
        role: 'system',
        text: 'Logged. Next check-in 16:00.',
        time: '15:15',
      },
      {
        id: 'msg_16_q',
        role: 'davos',
        text: '16:00. Plan says Review test coverage & run regression drill. Did you do it?',
        time: '16:00',
      },
      {
        id: 'msg_3',
        role: 'system',
        text: '16:00 check-in missed.',
        time: '16:00',
      },
      {
        id: 'msg_4',
        role: 'davos',
        text: 'What got in the way?',
        time: '16:00',
      },
      {
        id: 'msg_5',
        role: 'user',
        text: 'Got pulled into an urgent production bug.',
        time: '16:05',
        sendState: 'sent',
      },
      {
        id: 'msg_6',
        role: 'system',
        text: 'Logged. Next check-in 17:00.',
        time: '16:06',
      },
    ];

    test('silences canned acks and strips prompt time prefix (Blueprint §2.1, §2.2)', () => {
      const snapshot = buildDaySnapshot(samplePlan, sampleDoings, [], FIXTURE_NOW);
      const thread = toThread(rawMessages, snapshot);

      // Canned acks msg_2 ("Logged. Next check-in 16:00.") and msg_6 are dropped
      const texts = thread.map((t) => t.text || t.label);
      expect(texts).not.toContain('Logged. Next check-in 16:00.');
      expect(texts).not.toContain('Logged. Next check-in 17:00.');

      // Leading time "15:00. " is stripped from prompt
      expect(thread[0].text).toBe('Plan says Team check-in & sprint alignment. Did you do it?');
    });

    test('applies 5-minute gutter rule for timestamps', () => {
      const snapshot = buildDaySnapshot(samplePlan, sampleDoings, [], FIXTURE_NOW);
      const thread = toThread(rawMessages, snapshot);

      // First message at 15:00 shows time
      expect(thread[0].showTime).toBe(true);
      expect(thread[0].time).toBe('15:00');

      // 15:15 is >= 5 min after 15:00, so it shows time
      expect(thread[1].showTime).toBe(true);
      expect(thread[1].time).toBe('15:15');

      // 16:00 shows time
      expect(thread[2].showTime).toBe(true);
      expect(thread[2].time).toBe('16:00');

      // Missed event line is at 16:00 (0 min difference, so showTime = false)
      expect(thread[3].showTime).toBe(false);
      expect(thread[3].glyph).toBe('missed');
    });

    test('attaches glyphs to user answers', () => {
      const snapshot = buildDaySnapshot(samplePlan, sampleDoings, [], FIXTURE_NOW);
      const thread = toThread(rawMessages, snapshot);

      // msg_1 user answer has done glyph
      const userMsg1 = thread.find((t) => t.id === 'msg_1');
      expect(userMsg1?.glyph).toBe('done');
    });
  });
});
