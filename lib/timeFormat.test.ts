import { format24Hour } from './timeFormat';

describe('format24Hour', () => {
  it('formats Date object to HH:mm in 24-hour time', () => {
    const d = new Date(2026, 9, 30, 9, 5); // 09:05
    expect(format24Hour(d)).toBe('09:05');

    const evening = new Date(2026, 9, 30, 18, 15); // 18:15
    expect(format24Hour(evening)).toBe('18:15');

    const late = new Date(2026, 9, 30, 23, 59); // 23:59
    expect(format24Hour(late)).toBe('23:59');

    const midnight = new Date(2026, 9, 30, 0, 0); // 00:00
    expect(format24Hour(midnight)).toBe('00:00');
  });

  it('normalises string times cleanly', () => {
    expect(format24Hour('18:00')).toBe('18:00');
    expect(format24Hour('9:05')).toBe('09:05');
    expect(format24Hour('06:15 PM')).toBe('18:15');
    expect(format24Hour('6:15 PM')).toBe('18:15');
    expect(format24Hour('12:00 AM')).toBe('00:00');
    expect(format24Hour('12:00 PM')).toBe('12:00');
    expect(format24Hour('08:30 AM')).toBe('08:30');
  });

  it('handles timestamp numbers', () => {
    const timestamp = new Date(2026, 9, 30, 14, 30).getTime();
    expect(format24Hour(timestamp)).toBe('14:30');
  });

  it('handles 12-hour AM/PM boundary edge cases and casing', () => {
    expect(format24Hour('12:30 AM')).toBe('00:30');
    expect(format24Hour('12:30 PM')).toBe('12:30');
    expect(format24Hour('11:59 PM')).toBe('23:59');
    expect(format24Hour('01:00 AM')).toBe('01:00');
    expect(format24Hour('6:15 pm')).toBe('18:15');
    expect(format24Hour('7:20 am')).toBe('07:20');
  });

  it('handles empty or invalid inputs gracefully', () => {
    expect(format24Hour('invalid')).toBe('00:00');
    expect(format24Hour('')).toBe('00:00');
  });

  it('defaults to current time when invoked without arguments', () => {
    const now = new Date();
    const expected = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    expect(format24Hour()).toBe(expected);
  });
});
