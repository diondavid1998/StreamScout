const {
  todayInAppZone,
  weekdayFromDateString,
  daysBetween,
  formatShortDate,
  isEndedStatus,
  describeSeries,
} = require('../../seriesSchedule');

describe('todayInAppZone', () => {
  test('reports the US Central calendar date, not the UTC one', () => {
    // 02:00 UTC on the 15th is 21:00 on the 14th in Chicago (CDT, UTC-5).
    expect(todayInAppZone(new Date('2026-09-15T02:00:00Z'))).toBe('2026-09-14');
  });

  test('handles the standard-time offset too', () => {
    // 04:00 UTC on 1 Jan is 22:00 on 31 Dec in Chicago (CST, UTC-6).
    expect(todayInAppZone(new Date('2027-01-01T04:00:00Z'))).toBe('2026-12-31');
  });
});

describe('weekdayFromDateString', () => {
  test('names the calendar date rather than shifting it', () => {
    // The trap: new Date('2026-09-13') is UTC midnight, which is the 12th in
    // Central. Reading the date as a date rather than an instant avoids it.
    expect(weekdayFromDateString('2026-09-13')).toBe('Sunday');
    expect(weekdayFromDateString('2026-09-03')).toBe('Thursday');
  });

  test('rejects anything that is not a bare date', () => {
    expect(weekdayFromDateString('')).toBeNull();
    expect(weekdayFromDateString(null)).toBeNull();
    expect(weekdayFromDateString('2026-02-31')).toBeNull();
    expect(weekdayFromDateString('2026-9-3')).toBeNull();
    expect(weekdayFromDateString('2026-09-03T12:00:00Z')).toBeNull();
  });
});

describe('daysBetween', () => {
  test('counts whole days in either direction', () => {
    expect(daysBetween('2026-09-02', '2026-09-09')).toBe(7);
    expect(daysBetween('2026-09-09', '2026-09-02')).toBe(-7);
    expect(daysBetween('2026-09-02', '2026-09-02')).toBe(0);
  });

  test('crosses a DST boundary without losing or gaining a day', () => {
    // US DST ends 1 Nov 2026. Arithmetic is done in UTC precisely so this is 8.
    expect(daysBetween('2026-10-28', '2026-11-05')).toBe(8);
  });
});

test('formatShortDate', () => {
  expect(formatShortDate('2026-09-14')).toBe('Sep 14');
  expect(formatShortDate('2026-12-03')).toBe('Dec 3');
  expect(formatShortDate('nonsense')).toBeNull();
});

test('isEndedStatus accepts both spellings and ignores case', () => {
  expect(isEndedStatus('Ended')).toBe(true);
  expect(isEndedStatus('Canceled')).toBe(true);
  expect(isEndedStatus('Cancelled')).toBe(true);
  expect(isEndedStatus('Returning Series')).toBe(false);
  expect(isEndedStatus(null)).toBe(false);
});

describe('describeSeries', () => {
  const today = '2026-09-02'; // a Wednesday

  test('a scheduled episode gives the day of the week', () => {
    const result = describeSeries(
      { status: 'Returning Series', nextAirDate: '2026-09-03' },
      today
    );
    expect(result.state).toBe('airing');
    expect(result.message).toBe('New episodes Thursdays');
  });

  test('a season starting more than a week out names the start date', () => {
    const result = describeSeries(
      { status: 'Returning Series', nextAirDate: '2026-12-03' },
      today
    );
    expect(result.message).toBe('New episodes Thursdays from Dec 3');
  });

  test('exactly a week out is still just the weekday', () => {
    const result = describeSeries(
      { status: 'Returning Series', nextAirDate: '2026-09-09' },
      today
    );
    expect(result.message).toBe('New episodes Wednesdays');
  });

  test('a recently passed date still describes the rhythm', () => {
    // Nothing refreshes on a schedule, so a row can be a few days behind. A
    // weekday is a pattern, and the pattern has not changed in three days.
    const result = describeSeries(
      { status: 'Returning Series', nextAirDate: '2026-08-30' },
      today
    );
    expect(result.state).toBe('airing');
    expect(result.message).toBe('New episodes Sundays');
  });

  test('a long-stale date stops being evidence', () => {
    const result = describeSeries(
      { status: 'Returning Series', nextAirDate: '2026-06-01' },
      today
    );
    expect(result.state).toBe('all_out');
    expect(result.message).toBe('All episodes out');
  });

  test('returning with nothing scheduled reads as all episodes out', () => {
    const result = describeSeries({ status: 'Returning Series' }, today);
    expect(result.state).toBe('all_out');
    expect(result.message).toBe('All episodes out');
  });

  test('an ended show reads as all episodes and seasons out', () => {
    const result = describeSeries({ status: 'Ended', lastAirDate: '2025-05-19' }, today);
    expect(result.state).toBe('ended');
    expect(result.message).toBe('All episodes and seasons out');
    expect(result.lastAirDate).toBe('2025-05-19');
  });

  test('a dated future episode outranks a stale Ended status', () => {
    const result = describeSeries(
      { status: 'Ended', nextAirDate: '2026-09-03' },
      today
    );
    expect(result.state).toBe('airing');
  });

  test('accepts a Date for "now" as well as a date string', () => {
    const result = describeSeries(
      { status: 'Returning Series', nextAirDate: '2026-09-03' },
      new Date('2026-09-02T18:00:00Z')
    );
    expect(result.message).toBe('New episodes Thursdays');
  });
});
