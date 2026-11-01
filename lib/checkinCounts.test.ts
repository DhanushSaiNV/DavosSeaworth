// lib/checkinCounts.test.ts
import { computeCheckinStatus, type CheckinStatusItem } from './checkinCounts';

describe('checkinCounts derivation (PRD Step 0, C.1, C.2, AU41)', () => {
  const sampleItems: CheckinStatusItem[] = [
    { id: '1', time: '09:00', status: 'done' },
    { id: '2', time: '11:00', status: 'late' }, // Answered late after follow-up
    { id: '3', time: '13:00', status: 'done' },
    { id: '4', time: '14:00', status: 'pending' },
    { id: '5', time: '20:30', status: 'pending' }, // Evening reflection (excluded from M)
  ];

  test('counts M scheduled excluding 20:30 evening reflection', () => {
    const res = computeCheckinStatus(sampleItems);
    expect(res.scheduledTotal).toBe(4);
    expect(res.answeredOnTime).toBe(2);
    expect(res.answeredLate).toBe(1);
    expect(res.answeredTotal).toBe(3);
    expect(res.missedTotal).toBe(0);
    expect(res.progressText).toBe('3 of 4 answered');
  });

  test('due check-in resolves to "Due now 14:00" when pending', () => {
    const res = computeCheckinStatus(sampleItems, { dueInterval: '14:00' });
    expect(res.nextOrDue.isDue).toBe(true);
    expect(res.nextOrDue.label).toBe('Due now');
    expect(res.nextOrDue.time).toBe('14:00');
    expect(res.statusLineText).toBe('Due now 14:00 · 3 of 4 answered');
  });

  test('next check-in resolves to "Next check-in 15:00" when none is pending', () => {
    const answeredItems: CheckinStatusItem[] = [
      { id: '1', time: '09:00', status: 'done' },
      { id: '2', time: '11:00', status: 'late' },
      { id: '3', time: '13:00', status: 'done' },
      { id: '4', time: '14:00', status: 'done' },
      { id: '5', time: '20:30', status: 'pending' },
    ];
    const res = computeCheckinStatus(answeredItems, { isPending: false, nextCheckInTime: '15:00' });
    expect(res.nextOrDue.isDue).toBe(false);
    expect(res.nextOrDue.label).toBe('Next check-in');
    expect(res.nextOrDue.time).toBe('15:00');
    expect(res.progressText).toBe('4 of 4 answered');
    expect(res.statusLineText).toBe('Next check-in 15:00 · 4 of 4 answered');
  });

  test('appends " · X missed" when any are missed', () => {
    const withMissed: CheckinStatusItem[] = [
      { id: '1', time: '09:00', status: 'done' },
      { id: '2', time: '11:00', status: 'missed' },
      { id: '3', time: '13:00', status: 'done' },
      { id: '4', time: '14:00', status: 'pending' },
    ];
    const res = computeCheckinStatus(withMissed, { dueInterval: '14:00' });
    expect(res.scheduledTotal).toBe(4);
    expect(res.answeredTotal).toBe(2);
    expect(res.missedTotal).toBe(1);
    expect(res.progressText).toBe('2 of 4 answered · 1 missed');
    expect(res.statusLineText).toBe('Due now 14:00 · 2 of 4 answered · 1 missed');
  });
});
